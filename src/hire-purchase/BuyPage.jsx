// Buying one product on hire purchase. Every figure comes from the server, and the customer sees it all before they agree.
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Info, ShieldCheck, Store, Truck } from 'lucide-react';
import { SecureLine } from '../components/PaymentMethods';
import { ProductImage } from '../components/shared';
import { Link, navigate } from '../router';
import { formatPrice } from '../services/catalogue';
import { CustomerError, acceptAgreement, loadBuying, requestHpQuote, startDeposit } from '../services/customer';
import { useProduct } from '../useProduct';
import { ConfirmLinkEmail, SignIn, useCustomer } from './SignIn';

const percent = basisPoints => `${(basisPoints / 100).toLocaleString('en-GB', { maximumFractionDigits: 2 })}%`;

function Notice({ title, children }) {
  return <div className="status-card" role="status"><Info size={20} /><div><strong>{title}</strong><p>{children}</p></div></div>;
}

function Figures({ figures, currency }) {
  const money = amountMinor => formatPrice({ amountMinor, currency });
  const { instalments } = figures;
  return (
    <>
      <dl className="summary-totals">
        <div><dt>Cash price</dt><dd>{money(figures.cashPriceMinor)}</dd></div>
        <div><dt>Hire charge</dt><dd>{money(figures.chargeMinor)}</dd></div>
        <div><dt>Hire purchase price</dt><dd>{money(figures.hirePurchasePriceMinor)}</dd></div>
        <div><dt>Deposit</dt><dd>{money(figures.depositMinor)}</dd></div>
        {figures.deliveryFeeMinor > 0 && <div><dt>Delivery</dt><dd>{money(figures.deliveryFeeMinor)}</dd></div>}
        <div className="summary-total"><dt>To pay now</dt><dd>{money(figures.dueNowMinor)}</dd></div>
      </dl>
      <p className="small hp-schedule-line">Then <strong>{instalments.length} monthly {instalments.length === 1 ? 'instalment' : 'instalments'}</strong> of {money(instalments[0].amountMinor)}{instalments.at(-1).amountMinor !== instalments[0].amountMinor && <> (last one {money(instalments.at(-1).amountMinor)})</>}, the first a month after your deposit.</p>
    </>
  );
}

export default function BuyPage({ slug }) {
  const customer = useCustomer();
  const { loading, product, variants, detailStatus } = useProduct(slug);
  const [buying, setBuying] = useState(null);
  const [failure, setFailure] = useState(null);
  const [notApproved, setNotApproved] = useState(false);
  const [sku, setSku] = useState(null);
  const [planId, setPlanId] = useState(null);
  const [method, setMethod] = useState(null);
  const [zoneId, setZoneId] = useState('');
  const [address, setAddress] = useState({ digitalAddress: '', area: '', landmark: '' });
  const [quote, setQuote] = useState(null);
  const [quoteError, setQuoteError] = useState(null);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const attempt = useRef(null);
  const uid = customer.user?.uid;

  useEffect(() => {
    if (!uid) return;
    loadBuying().then(data => {
      setBuying(data);
      if (data.address) setAddress(data.address);
    }, error => {
      if (error instanceof CustomerError && error.code === 'not_approved') setNotApproved(true);
      else setFailure('We could not reach the server. Please try again shortly.');
    });
  }, [uid]);

  const available = variants.filter(variant => variant.availability !== 'out_of_stock');
  const chosenSku = sku ?? (available.length === 1 ? available[0].sku : null);
  const fulfilment = method === 'pickup' ? { method: 'pickup' } : method === 'delivery' && zoneId ? { method: 'delivery', zoneId } : null;
  const quoteKey = JSON.stringify([chosenSku, planId, fulfilment]);

  useEffect(() => {
    attempt.current = null;
    setQuote(null);
    setQuoteError(null);
    if (!chosenSku || !planId || !fulfilment) return undefined;
    let current = true;
    requestHpQuote({ sku: chosenSku, planId, fulfilment }).then(data => { if (current) setQuote(data); }, error => { if (current) setQuoteError(error.message); });
    return () => { current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quoteKey]);

  async function accept(event) {
    event.preventDefault();
    if (!quote || busy) return;
    setBusy(true);
    setFailure(null);
    attempt.current ??= crypto.randomUUID();
    let id = null;
    try {
      const agreement = await acceptAgreement({
        sku: chosenSku, planId, fulfilment, ...(method === 'delivery' ? { address } : {}), accepted: true, termsVersion: buying.termsVersion,
        expectedDueNowMinor: quote.figures.dueNowMinor, expectedHirePurchasePriceMinor: quote.figures.hirePurchasePriceMinor,
      }, attempt.current);
      id = agreement.id;
      const { authorizationUrl } = await startDeposit(id);
      window.location.assign(authorizationUrl);
    } catch (error) {
      setBusy(false);
      // The agreement exists but payment did not start: its page can retry without making a second one.
      if (id) { navigate(`/hire-purchase/agreements/${id}`); return; }
      attempt.current = null;
      const firstField = error instanceof CustomerError ? Object.values(error.fieldErrors)[0] : null;
      setFailure(firstField ?? (error instanceof CustomerError ? error.message : 'We could not reach the server. Check your connection and try again.'));
    }
  }

  const page = children => (
    <main className="checkout section">
      <nav className="breadcrumb" aria-label="Breadcrumb"><Link to="/hire-purchase/account"><ArrowLeft size={14} /> Your account</Link></nav>
      <p className="eyebrow">BUY ON HIRE PURCHASE</p>
      {children}
    </main>
  );

  if (customer.ready && !customer.user) {
    return page(
      <div className="narrow-page">
        <h1 className="page-title">Sign in to buy.</h1>
        {customer.linkPending ? <ConfirmLinkEmail onConfirm={customer.finishLink} error={customer.linkError} /> : <SignIn returnPath={`/hire-purchase/buy/${slug}`} notice={customer.linkError} />}
      </div>,
    );
  }
  if (notApproved) {
    return page(
      <>
        <h1 className="page-title">Approved customers only.</h1>
        <Notice title="Your account isn’t approved">Only customers our team has approved can buy on hire purchase. <Link className="inline-link" to="/hire-purchase/account">See your application</Link>.</Notice>
      </>,
    );
  }
  if (failure && !buying) return page(<p className="co-error" role="alert">{failure}</p>);
  if (!buying || loading || detailStatus === 'loading') return page(<p className="muted">Loading…</p>);
  if (!buying.open) return page(<><h1 className="page-title">Buying opens soon.</h1><Notice title="Plans are being finalised">Deposits, instalment plans and agreements are still being set up. Nothing can be ordered yet.</Notice></>);
  if (!product?.hirePurchase) return page(<><h1 className="page-title">This product isn’t on hire purchase.</h1><Link className="button dark" to="/hire-purchase/account">See what’s available</Link></>);

  if (!available.length) return page(<><h1 className="page-title">{product.name}</h1><Notice title="You can’t buy this one yet">It’s either not priced yet or out of stock. <Link className="inline-link" to="/hire-purchase/account">See what else you can choose from</Link>.</Notice></>);

  const money = amountMinor => formatPrice({ amountMinor, currency: buying.currency });
  const setField = key => event => setAddress(current => ({ ...current, [key]: event.target.value }));
  const overLimit = quote && !quote.withinLimit;
  return page(
    <>
      <h1 className="page-title">{product.name}</h1>
      <p className="muted">You have <strong>{money(buying.availableMinor)}</strong> of your approved amount available.</p>
      <div className="checkout-grid">
        <form className="co-form" onSubmit={accept}>
          {available.length > 1 && (
            <section className="co-section">
              <h2>Which one</h2>
              <div className="co-methods" role="radiogroup" aria-label="Product option">
                {available.map(variant => (
                  <label className={`co-method ${chosenSku === variant.sku ? 'selected' : ''}`} key={variant.sku}>
                    <input type="radio" name="variant" checked={chosenSku === variant.sku} onChange={() => setSku(variant.sku)} />
                    <span><strong>{Object.values(variant.attributes ?? {}).join(' · ') || variant.sku}</strong><small>{formatPrice(variant.price)}</small></span>
                  </label>
                ))}
              </div>
            </section>
          )}
          <section className="co-section">
            <h2>Choose a plan</h2>
            <div className="co-methods" role="radiogroup" aria-label="Hire purchase plan">
              {buying.plans.map(plan => (
                <label className={`co-method ${planId === plan.id ? 'selected' : ''}`} key={plan.id}>
                  <input type="radio" name="plan" checked={planId === plan.id} onChange={() => setPlanId(plan.id)} />
                  <span><strong>{plan.name}</strong><small>{percent(plan.depositBasisPoints)} deposit, {plan.instalments} monthly {plan.instalments === 1 ? 'instalment' : 'instalments'}, {percent(plan.chargeBasisPoints)} hire charge on the balance</small></span>
                </label>
              ))}
            </div>
          </section>
          <section className="co-section">
            <h2>How you’ll get it</h2>
            <div className="co-methods" role="radiogroup" aria-label="Delivery or collection">
              {buying.deliveryZones.length > 0 && (
                <label className={`co-method ${method === 'delivery' ? 'selected' : ''}`}>
                  <input type="radio" name="method" checked={method === 'delivery'} onChange={() => setMethod('delivery')} />
                  <Truck size={20} /><span><strong>Delivery</strong><small>To your area, for a fee.</small></span>
                </label>
              )}
              {buying.pickup && (
                <label className={`co-method ${method === 'pickup' ? 'selected' : ''}`}>
                  <input type="radio" name="method" checked={method === 'pickup'} onChange={() => setMethod('pickup')} />
                  <Store size={20} /><span><strong>Collect in store</strong><small>Free.</small></span>
                </label>
              )}
            </div>
            {method === 'delivery' && (
              <div className="co-grid">
                <label className="co-field wide"><span>Delivery area</span>
                  <select required value={zoneId} onChange={event => setZoneId(event.target.value)}>
                    <option value="">Choose your area</option>
                    {buying.deliveryZones.map(zone => <option key={zone.id} value={zone.id}>{zone.name} · {zone.feeMinor ? money(zone.feeMinor) : 'Free'}</option>)}
                  </select>
                </label>
                <label className="co-field"><span>GhanaPostGPS address</span><input required maxLength={20} value={address.digitalAddress} onChange={setField('digitalAddress')} /></label>
                <label className="co-field"><span>Town or suburb</span><input required maxLength={120} value={address.area} onChange={setField('area')} /></label>
                <label className="co-field wide"><span>Nearest landmark</span><input maxLength={200} value={address.landmark} onChange={setField('landmark')} /></label>
              </div>
            )}
            {method === 'pickup' && <div className="co-pickup"><strong>{buying.pickup.address}</strong><span className="muted">{buying.pickup.hours}</span></div>}
          </section>
          <section className="co-section">
            <h2>Your agreement</h2>
            {quote && <div className="hp-figures-inline"><h3>What you’ll pay</h3><Figures figures={quote.figures} currency={quote.currency} /></div>}
            {quoteError && <p className="co-error hp-figures-inline" role="alert">{quoteError}</p>}
            <div className="hp-consent">
              <p>{buying.terms}</p>
              <label><input type="checkbox" required checked={agreed} onChange={event => setAgreed(event.target.checked)} /> I have read this agreement and I accept it, with the figures shown here.</label>
            </div>
            <SecureLine />
            {failure && <p className="co-error" role="alert">{failure}</p>}
            {overLimit && <p className="co-error" role="alert">This is more than your available approved amount. Try a plan with a bigger deposit, or contact us.</p>}
            <button className="button dark full" disabled={!quote || overLimit || busy}>
              {busy ? 'Taking you to payment…' : quote ? `Accept and pay ${money(quote.figures.dueNowMinor)}` : 'Choose your options'} <ShieldCheck size={18} />
            </button>
            <p className="muted small">We hold this product for {buying.reservationMinutes} minutes while you pay. Your agreement starts once your deposit is paid.</p>
          </section>
        </form>
        <aside className="order-summary hp-buy-summary" aria-label="What you will pay">
          <div className="summary-image hp-buy-image"><ProductImage product={product} /></div>
          <h2>What you’ll pay</h2>
          {quoteError && <p className="co-error" role="alert">{quoteError}</p>}
          {quote ? <Figures figures={quote.figures} currency={quote.currency} /> : !quoteError && <p className="muted small">Choose a plan and how you’ll get it to see every figure.</p>}
        </aside>
      </div>
    </>,
  );
}
