// Approved customers buying on hire purchase. Every route checks for a current approval, and only the customer's own agreements are reachable.
import { hirePurchaseFigures } from '../../../shared/assessment.js';
import {
  applyInstalmentPayment, availableLimit, isInstalmentReference, loadBuyingSettings, newInstalmentReference, nextInstalment, outstandingOf,
} from '../agreements.js';
import { approvalActive, loadApplication } from '../applications.js';
import { recordAudit } from '../audit.js';
import { stockLevels } from '../catalogue.js';
import { requireCustomer } from '../customers.js';
import { C, now, read, sortKey, transaction } from '../firestore.js';
import { fail } from '../http.js';
import { idempotent } from '../idempotency.js';
import { applyVerifiedPayment, createOrder, expireIfDue, loadCheckoutSettings, newOrderReference, priceBasket } from '../orders.js';
import { SKU, bool, int, str, validate } from '../validate.js';
import { addressRule, fulfilmentRule, returnOrigin } from './checkout.js';

const today = () => now().slice(0, 10);

export const agreementDto = agreement => {
  const next = nextInstalment(agreement);
  return {
    id: agreement.id,
    status: agreement.status,
    cancelReason: agreement.cancelReason ?? null,
    orderReference: agreement.orderReference,
    product: agreement.product,
    plan: agreement.plan,
    currency: agreement.currency,
    figures: agreement.figures,
    fulfilment: agreement.fulfilment,
    customer: agreement.customer,
    terms: agreement.terms,
    instalments: agreement.instalments.map(item => ({ ...item, overdue: item.status !== 'paid' && Boolean(item.dueDate) && item.dueDate < today() })),
    nextInstalmentNumber: next?.number ?? null,
    paymentPending: Boolean(agreement.pendingPayment),
    outstandingMinor: outstandingOf(agreement),
    acceptedAt: agreement.acceptedAt,
    activatedAt: agreement.activatedAt ?? null,
    completedAt: agreement.completedAt ?? null,
    createdAt: agreement.createdAt,
    version: agreement.version,
  };
};

/** Whatever is still needed before customers can buy. Each of these is the owner's to set. */
function buyingMissing(settings, buying, payments) {
  const missing = [];
  if (!settings.currency) missing.push('store.currency');
  if (!settings.reservationMinutes) missing.push('checkout.reservationMinutes');
  if (!settings.deliveryZones.length && !settings.pickup) missing.push('checkout.deliveryZones');
  if (!buying.plans.length) missing.push('hirePurchase.plans');
  if (!buying.terms) missing.push('hirePurchase.agreementTerms');
  if (!payments.configured) missing.push('payment_provider');
  return missing;
}

const agreementsOf = async (db, uid, tx) => (await read(db.collection(C.hpAgreements).where('uid', '==', uid), tx)).docs.map(doc => doc.data());

export function registerHirePurchaseBuying(route, customerAuth, payments) {
  async function requireApproved(ctx, tx) {
    const customer = await requireCustomer(ctx, customerAuth);
    const application = await loadApplication(ctx.db, customer.uid, tx);
    if (!approvalActive(application)) fail('not_approved', 'Your hire purchase account is not approved.');
    return { customer, application };
  }

  /** Price one product on one plan. Reads only, so it can run inside the transaction that creates the agreement. */
  async function quote(db, input, settings, buying, tx) {
    const plan = buying.plans.find(candidate => candidate.id === input.planId);
    if (!plan) fail('validation_failed', 'Some details need attention.', { fieldErrors: { planId: 'Choose a plan from the list.' } });
    const priced = await priceBasket(db, { items: [{ sku: input.sku, quantity: 1 }], fulfilment: input.fulfilment }, settings, tx);
    const line = priced.lines[0];
    const product = (await read(db.collection(C.products).doc(line.productId), tx)).data();
    if (!product.hirePurchaseEnabled) fail('item_unavailable', 'This product is not available on hire purchase.');
    return { plan, priced, line, figures: hirePurchaseFigures({ cashPriceMinor: line.unitPriceMinor, plan, deliveryFeeMinor: priced.deliveryFeeMinor }) };
  }

  const loadOwn = async (ctx, uid) => {
    const agreement = (await ctx.db.collection(C.hpAgreements).doc(ctx.params.id).get()).data();
    // Someone else's agreement looks exactly like one that doesn't exist.
    if (!agreement || agreement.uid !== uid) fail('not_found', 'Agreement not found.');
    return agreement;
  };

  route('GET', '/me/hire-purchase/buying', async ctx => {
    const { customer, application } = await requireApproved(ctx);
    const [settings, buying, agreements] = await Promise.all([loadCheckoutSettings(ctx.db), loadBuyingSettings(ctx.db), agreementsOf(ctx.db, customer.uid)]);
    const open = buyingMissing(settings, buying, payments).length === 0;
    const { digitalAddress, area, landmark } = application.sections.residence;
    return {
      data: {
        open,
        availableMinor: availableLimit(application.decision.limitMinor, agreements),
        currency: application.decision.currency,
        ...(open ? {
          plans: buying.plans, terms: buying.terms, termsVersion: buying.termsVersion, reservationMinutes: settings.reservationMinutes,
          deliveryZones: settings.deliveryZones, pickup: settings.pickup, address: { digitalAddress, area, landmark: landmark ?? '' },
        } : {}),
      },
    };
  }, { skipBody: true });

  const quoteSpec = { sku: str({ max: 40, pattern: SKU, patternMessage: 'Invalid SKU.' }), planId: str({ max: 60 }), fulfilment: fulfilmentRule };

  route('POST', '/me/hire-purchase/quote', async ctx => {
    const { customer, application } = await requireApproved(ctx);
    const input = validate(ctx.body, quoteSpec);
    const [settings, buying, agreements] = await Promise.all([loadCheckoutSettings(ctx.db), loadBuyingSettings(ctx.db), agreementsOf(ctx.db, customer.uid)]);
    if (buyingMissing(settings, buying, payments).length) fail('not_configured', 'Buying on hire purchase is not open yet.');
    const { figures, priced } = await quote(ctx.db, input, settings, buying);
    return { data: { figures, currency: priced.currency, withinLimit: figures.financedMinor <= availableLimit(application.decision.limitMinor, agreements) } };
  });

  // Accepting creates the agreement and holds the product. It starts only when the deposit is paid.
  route('POST', '/me/hire-purchase/agreements', async ctx => {
    const customer = await requireCustomer(ctx, customerAuth);
    const input = validate(ctx.body, {
      ...quoteSpec, address: addressRule, accepted: bool(), termsVersion: int({ min: 1 }), expectedDueNowMinor: int({ min: 0 }), expectedHirePurchasePriceMinor: int({ min: 0 }),
    }, { optional: ['address'] });
    if (!input.accepted) fail('validation_failed', 'Some details need attention.', { fieldErrors: { accepted: 'Please agree to the terms to continue.' } });
    if (input.fulfilment.method === 'delivery' && !input.address) fail('validation_failed', 'Some details need attention.', { fieldErrors: { address: 'Enter your delivery address.' } });

    return idempotent(ctx, `hp-agreement:${customer.uid}`, async tx => {
      const application = await loadApplication(ctx.db, customer.uid, tx);
      if (!approvalActive(application)) fail('not_approved', 'Your hire purchase account is not approved.');
      const settings = await loadCheckoutSettings(ctx.db, tx);
      const buying = await loadBuyingSettings(ctx.db, tx);
      if (buyingMissing(settings, buying, payments).length) fail('not_configured', 'Buying on hire purchase is not open yet.');
      if (input.termsVersion !== buying.termsVersion) fail('stale_version', 'The agreement was updated. Please read it again and confirm.');
      const { plan, priced, line, figures } = await quote(ctx.db, input, settings, buying, tx);
      // They agreed to specific figures. If anything moved, they must see the new ones first.
      if (figures.dueNowMinor !== input.expectedDueNowMinor || figures.hirePurchasePriceMinor !== input.expectedHirePurchasePriceMinor) {
        fail('price_changed', 'The price has changed. Please review it again.');
      }
      const agreements = await agreementsOf(ctx.db, customer.uid, tx);
      if (figures.financedMinor > availableLimit(application.decision.limitMinor, agreements)) fail('limit_exceeded', 'This is more than your available approved amount.');
      const stockBySku = await stockLevels(ctx.db, [line.sku], tx);

      const id = newOrderReference().replace('STL-', 'HP-');
      const at = now();
      const { identity, contact } = application.sections;
      const contactDetails = { name: identity.fullName, phone: contact.phone, email: customer.email };
      const address = input.fulfilment.method === 'delivery' ? input.address : null;
      const { order } = createOrder(ctx.db, tx, {
        priced: { ...priced, subtotalMinor: figures.depositMinor, totalMinor: figures.dueNowMinor }, contact: contactDetails, address, reservationMinutes: settings.reservationMinutes, stockBySku, agreementId: id,
      });
      const agreement = {
        id,
        uid: customer.uid,
        status: 'awaiting_deposit',
        orderReference: order.reference,
        product: { sku: line.sku, title: line.title, slug: line.slug, attributes: line.attributes, image: line.image },
        plan,
        currency: priced.currency,
        figures: { ...figures, instalments: undefined },
        fulfilment: order.fulfilment,
        customer: contactDetails,
        // The exact wording they accepted, kept with the agreement.
        terms: { wording: buying.terms, version: buying.termsVersion },
        instalments: figures.instalments.map(item => ({ ...item, status: 'due', dueDate: null, paidAt: null })),
        pendingPayment: null,
        attention: null,
        acceptedAt: at,
        createdAt: at,
        updatedAt: at,
        sortKey: sortKey(at, id),
        version: 1,
      };
      tx.create(ctx.db.collection(C.hpAgreements).doc(id), agreement);
      recordAudit(ctx.db, tx, {
        action: 'agreement.accepted', resourceType: 'hp_agreement', resourceId: id, after: { status: 'awaiting_deposit', financedMinor: figures.financedMinor, currency: priced.currency, termsVersion: buying.termsVersion },
        metadata: { by: 'customer', uid: customer.uid }, requestId: ctx.requestId,
      });
      return { status: 201, data: agreementDto(agreement) };
    });
  });

  route('GET', '/me/hire-purchase/agreements', async ctx => {
    const customer = await requireCustomer(ctx, customerAuth);
    const agreements = await agreementsOf(ctx.db, customer.uid);
    return { data: agreements.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(agreementDto) };
  }, { skipBody: true });

  route('GET', '/me/hire-purchase/agreements/:id', async ctx => {
    const customer = await requireCustomer(ctx, customerAuth);
    return { data: agreementDto(await loadOwn(ctx, customer.uid)) };
  }, { skipBody: true });

  route('POST', '/me/hire-purchase/agreements/:id/deposit', async ctx => {
    const customer = await requireCustomer(ctx, customerAuth);
    if (!payments.configured) fail('not_configured', 'Online payment is not available yet.');
    const agreement = await loadOwn(ctx, customer.uid);
    if (agreement.status !== 'awaiting_deposit') fail('invalid_transition', 'The deposit for this agreement cannot be paid now.');
    const orderRef = ctx.db.collection(C.orders).doc(agreement.orderReference);
    const order = (await orderRef.get()).data();
    if (order.reservationExpiresAt <= now()) {
      await expireIfDue(ctx.db, order.reference);
      fail('order_expired', 'The time to pay this deposit has run out. Please start again.');
    }
    // One Paystack transaction per deposit, so retries reuse the same page and it can't be paid twice.
    if (order.authorizationUrl) return { data: { authorizationUrl: order.authorizationUrl } };
    const { authorizationUrl } = await payments.initialize({
      email: order.contact.email, amountMinor: order.totalMinor, currency: order.currency, reference: order.reference,
      callbackUrl: `${returnOrigin(ctx)}/hire-purchase/agreements/${agreement.id}`,
    });
    await orderRef.update({ authorizationUrl, updatedAt: now() });
    return { data: { authorizationUrl } };
  });

  route('POST', '/me/hire-purchase/agreements/:id/pay', async ctx => {
    const customer = await requireCustomer(ctx, customerAuth);
    if (!payments.configured) fail('not_configured', 'Online payment is not available yet.');
    const agreement = await loadOwn(ctx, customer.uid);
    const next = nextInstalment(agreement);
    if (agreement.status !== 'active' || !next) fail('invalid_transition', 'There is nothing to pay on this agreement right now.');
    if (agreement.pendingPayment?.number === next.number) return { data: { authorizationUrl: agreement.pendingPayment.authorizationUrl } };
    const reference = newInstalmentReference(agreement.id, next.number);
    const { authorizationUrl } = await payments.initialize({
      email: agreement.customer.email, amountMinor: next.amountMinor, currency: agreement.currency, reference, callbackUrl: `${returnOrigin(ctx)}/hire-purchase/agreements/${agreement.id}`,
    });
    await transaction(ctx.db, async tx => {
      const ref = ctx.db.collection(C.hpAgreements).doc(agreement.id);
      const current = (await tx.get(ref)).data();
      tx.update(ref, { pendingPayment: { number: next.number, reference, authorizationUrl, createdAt: now() }, version: current.version + 1, updatedAt: now() });
    });
    return { data: { authorizationUrl } };
  });

  // The return from Paystack proves nothing by itself, so the server asks Paystack what happened.
  route('POST', '/me/hire-purchase/agreements/:id/verify', async ctx => {
    const customer = await requireCustomer(ctx, customerAuth);
    const agreement = await loadOwn(ctx, customer.uid);
    if (payments.configured && agreement.status === 'awaiting_deposit') {
      const order = (await ctx.db.collection(C.orders).doc(agreement.orderReference).get()).data();
      if (order.authorizationUrl) {
        const verified = await payments.verify(order.reference);
        if (verified.success) await applyVerifiedPayment(ctx.db, { reference: order.reference, ...verified, source: 'verify' });
      }
    } else if (payments.configured && isInstalmentReference(agreement.pendingPayment?.reference ?? '')) {
      const { reference } = agreement.pendingPayment;
      const verified = await payments.verify(reference);
      if (verified.success) await applyInstalmentPayment(ctx.db, { reference, ...verified, source: 'verify' });
    }
    return { data: agreementDto(await loadOwn(ctx, customer.uid)) };
  });
}
