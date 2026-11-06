// Retail checkout: contact, delivery or collection, review, then pay on Paystack's hosted page.
// The total shown is always the server's; the order is refused if it moved after the customer saw it.
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowUpRight, Lock, ShieldCheck, Store, Truck } from 'lucide-react';
import { SecurePayment } from '../components/PaymentMethods';
import { ProductImage } from '../components/shared';
import { Link, navigate } from '../router';
import { formatPrice } from '../services/catalogue';
import { CheckoutError, loadCheckoutOptions, placeOrder, rememberOrderToken, requestQuote, startPayment } from '../services/checkout';
import { bagSubtotal, useBag } from '../state';

const money = (amountMinor, currency) => formatPrice({ amountMinor, currency });
const EMPTY_FORM = { name: '', phone: '', email: '', digitalAddress: '', area: '', landmark: '' };

function Field({ label, error, hint, wide, children }) {
  return (
    <label className={`co-field ${wide ? 'wide' : ''}`}>
      <span>{label}</span>
      {children}
      {hint && !error && <small className="muted">{hint}</small>}
      {error && <small className="co-error">{error}</small>}
    </label>
  );
}

function Summary({ items, count, quote, quoteError, onRemove }) {
  const subtotal = bagSubtotal(items);
  return (
    <aside className="order-summary" aria-label="Order summary">
      <h2>Your order <span className="muted">({count})</span></h2>
      <ul className="summary-lines">
        {items.map(item => (
          <li key={item.key}>
            <div className="summary-image"><ProductImage product={item} /></div>
            <div>
              <strong>{item.name}</strong>
              <span className="muted">Qty {item.quantity}</span>
              {!item.sku && <button type="button" className="link-button" onClick={() => onRemove(item.key)}>Not on sale. Remove</button>}
            </div>
            <span>{item.price && !item.price.varies ? money(item.price.amountMinor * item.quantity, item.price.currency) : formatPrice(item.price)}</span>
          </li>
        ))}
      </ul>
      {quoteError && <p className="co-error" role="alert">{quoteError}</p>}
      <dl className="summary-totals">
        <div><dt>Subtotal</dt><dd>{quote ? money(quote.subtotalMinor, quote.currency) : subtotal ? formatPrice(subtotal) : 'To be confirmed'}</dd></div>
        <div><dt>Delivery</dt><dd>{quote ? (quote.deliveryFeeMinor ? money(quote.deliveryFeeMinor, quote.currency) : 'Free') : 'Choose below'}</dd></div>
        <div className="summary-total"><dt>Total</dt><dd>{quote ? money(quote.totalMinor, quote.currency) : '—'}</dd></div>
      </dl>
    </aside>
  );
}

export default function Checkout() {
  const { items, count, remove, clear } = useBag();
  const [options, setOptions] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [method, setMethod] = useState(null);
  const [zoneId, setZoneId] = useState('');
  const [quote, setQuote] = useState(null);
  const [quoteError, setQuoteError] = useState(null);
  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState(null);
  const [busy, setBusy] = useState(false);
  // One key per attempt at this exact order, so a double click or a retry cannot create two orders.
  const attempt = useRef(null);

  useEffect(() => {
    const controller = new AbortController();
    loadCheckoutOptions(controller.signal).then(setOptions, error => { if (error.name !== 'AbortError') setOptions({ canOrder: false, missing: ['unreachable'], deliveryZones: [], pickup: null }); });
    return () => controller.abort();
  }, []);

  const buyable = useMemo(() => items.filter(item => item.sku).map(item => ({ sku: item.sku, quantity: item.quantity })), [items]);
  const fulfilment = method === 'pickup' ? { method: 'pickup' } : method === 'delivery' && zoneId ? { method: 'delivery', zoneId } : null;
  const basketKey = JSON.stringify([buyable, fulfilment]);

  useEffect(() => {
    attempt.current = null;
    setQuote(null);
    setQuoteError(null);
    if (!options?.canQuote || !fulfilment || !buyable.length) return undefined;
    const controller = new AbortController();
    requestQuote({ items: buyable, fulfilment }, controller.signal).then(setQuote, error => { if (error.name !== 'AbortError') setQuoteError(error.message); });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basketKey, options?.canQuote]);

  const set = key => event => setForm(current => ({ ...current, [key]: event.target.value }));
  const hasUnsellable = items.some(item => !item.sku);

  async function pay(event) {
    event.preventDefault();
    if (!quote || busy || !options?.canOrder) return;
    setBusy(true);
    setErrors({});
    setSubmitError(null);
    attempt.current ??= crypto.randomUUID();
    let reference = null;
    try {
      const { order, accessToken } = await placeOrder({
        items: buyable,
        fulfilment,
        contact: { name: form.name, phone: form.phone, email: form.email },
        ...(method === 'delivery' ? { address: { digitalAddress: form.digitalAddress, area: form.area, landmark: form.landmark } } : {}),
        expectedTotalMinor: quote.totalMinor,
      }, attempt.current);
      reference = order.reference;
      rememberOrderToken(reference, accessToken);
      clear();
      const { authorizationUrl } = await startPayment(reference);
      window.location.assign(authorizationUrl);
    } catch (error) {
      setBusy(false);
      // The order exists but payment did not start: its page can retry without placing a second order.
      if (reference) { navigate(`/order/${reference}`); return; }
      if (!(error instanceof CheckoutError)) { setSubmitError('We could not reach the server. Check your connection and try again.'); return; }
      if (error.code === 'price_changed') {
        attempt.current = null;
        requestQuote({ items: buyable, fulfilment }).then(setQuote, failure => setQuoteError(failure.message));
      }
      const { contact, address, ...rest } = error.fieldErrors;
      setErrors({ contact, address, ...rest });
      setSubmitError(error.message);
    }
  }

  // While leaving for payment the bag is already cleared, so don't flash the empty state.
  if (!items.length && !busy) {
    return (
      <main className="section narrow-page">
        <h1 className="page-title">Your cart is empty.</h1>
        <p className="muted">Add something to your cart to check out.</p>
        <Link className="button dark" to="/shop">Explore the collection <ArrowUpRight size={18} /></Link>
      </main>
    );
  }

  // With prices and delivery set, customers can see their total; only paying waits for the payment setup.
  const closed = options && !options.canQuote;
  return (
    <main className="checkout section">
      <nav className="breadcrumb" aria-label="Breadcrumb"><Link to="/shop"><ArrowLeft size={14} /> Continue shopping</Link></nav>
      <h1 className="page-title">Checkout</h1>
      <div className="checkout-grid">
        <div className="checkout-steps">
          {!options && <p className="muted">Loading checkout…</p>}
          {closed && (
            <div className="status-card" role="status">
              <Lock size={20} />
              <div>
                <strong>Checkout opens soon</strong>
                <p>Online payment and delivery options are being set up. Nothing can be ordered yet. Your cart is saved on this device.</p>
              </div>
            </div>
          )}
          {options?.canQuote && (
            <form className="co-form" onSubmit={pay} noValidate={false}>
              <section className="co-section">
                <h2><span className="step-number">1</span> Your details</h2>
                <div className="co-grid">
                  <Field label="Full name" error={errors.contact}><input required autoComplete="name" minLength={2} maxLength={120} value={form.name} onChange={set('name')} /></Field>
                  <Field label="Phone number"><input required type="tel" autoComplete="tel" placeholder="024 123 4567" value={form.phone} onChange={set('phone')} /></Field>
                  <Field wide label="Email" hint="For your receipt from Paystack."><input required type="email" autoComplete="email" value={form.email} onChange={set('email')} /></Field>
                </div>
              </section>

              <section className="co-section">
                <h2><span className="step-number">2</span> How you’ll get it</h2>
                <div className="co-methods" role="radiogroup" aria-label="Delivery or collection">
                  {options.deliveryZones.length > 0 && (
                    <label className={`co-method ${method === 'delivery' ? 'selected' : ''}`}>
                      <input type="radio" name="method" checked={method === 'delivery'} onChange={() => setMethod('delivery')} />
                      <Truck size={20} /><span><strong>Delivery</strong><small>To your area, for a fee.</small></span>
                    </label>
                  )}
                  {options.pickup && (
                    <label className={`co-method ${method === 'pickup' ? 'selected' : ''}`}>
                      <input type="radio" name="method" checked={method === 'pickup'} onChange={() => setMethod('pickup')} />
                      <Store size={20} /><span><strong>Collect in store</strong><small>Free.</small></span>
                    </label>
                  )}
                </div>
                {method === 'delivery' && (
                  <div className="co-grid">
                    <Field wide label="Delivery area">
                      <select required value={zoneId} onChange={event => setZoneId(event.target.value)}>
                        <option value="">Choose your area</option>
                        {options.deliveryZones.map(zone => <option key={zone.id} value={zone.id}>{zone.name} · {zone.feeMinor ? money(zone.feeMinor, options.currency) : 'Free'}</option>)}
                      </select>
                    </Field>
                    <Field label="GhanaPostGPS address" error={errors.address}><input required placeholder="GA-183-8164" maxLength={20} value={form.digitalAddress} onChange={set('digitalAddress')} /></Field>
                    <Field label="Town or suburb"><input required maxLength={120} value={form.area} onChange={set('area')} /></Field>
                    <Field label="Nearest landmark"><input maxLength={200} value={form.landmark} onChange={set('landmark')} /></Field>
                  </div>
                )}
                {method === 'pickup' && (
                  <div className="co-pickup">
                    <strong>{options.pickup.address}</strong>
                    <span className="muted">{options.pickup.hours}</span>
                  </div>
                )}
              </section>

              <section className="co-section">
                <h2><span className="step-number">3</span> Review and pay</h2>
                {options.returnsPolicy && (
                  <details className="co-policy">
                    <summary>Returns and warranty</summary>
                    <p>{options.returnsPolicy}</p>
                  </details>
                )}
                <SecurePayment />
                {submitError && <p className="co-error" role="alert">{submitError}</p>}
                <button className="button dark full" disabled={!quote || busy || hasUnsellable || !options.canOrder}>
                  {busy ? 'Taking you to payment…' : quote ? `Pay ${money(quote.totalMinor, quote.currency)}` : 'Choose how you’ll get it'} <ShieldCheck size={18} />
                </button>
                {options.canOrder
                  ? <p className="muted small">You’ll finish on Paystack’s page, then come back here. We hold your items for {options.reservationMinutes} minutes while you pay.</p>
                  : <p className="muted small" role="status">Online payment isn’t switched on yet, so orders can’t be placed. Your cart is saved on this device.</p>}
              </section>
            </form>
          )}
        </div>
        <Summary items={items} count={count} quote={quote} quoteError={quoteError} onRemove={remove} />
      </div>
    </main>
  );
}
