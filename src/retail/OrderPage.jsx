// Where a customer lands after checkout or returning from Paystack. Payment status always comes from the server,
// which asks Paystack directly; arriving on this page proves nothing by itself.
import { useCallback, useEffect, useState } from 'react';
import { ArrowUpRight, CheckCircle2, Clock, XCircle } from 'lucide-react';
import { Link } from '../router';
import { formatPrice } from '../services/catalogue';
import { orderToken, startPayment, verifyPayment } from '../services/checkout';

const money = (amountMinor, currency) => formatPrice({ amountMinor, currency });
const POLL_MS = 3000;
const POLL_TRIES = 6;

const FULFILMENT_TEXT = {
  not_started: 'We’ll start preparing your order shortly.',
  processing: 'We’re preparing your order.',
  dispatched: 'Your order is on its way.',
  delivered: 'Your order has been delivered.',
};

export default function OrderPage({ reference, search }) {
  const [order, setOrder] = useState(null);
  const [error, setError] = useState(null);
  const [payError, setPayError] = useState(null);
  const [paying, setPaying] = useState(false);
  const hasToken = Boolean(orderToken(reference));
  // Paystack adds these when it sends the customer back, and the webhook may land a moment later.
  const returning = /[?&](trxref|reference)=/.test(search);

  const refresh = useCallback(() => verifyPayment(reference).then(data => { setOrder(data); setError(null); return data; }), [reference]);

  useEffect(() => {
    if (!hasToken) return undefined;
    let cancelled = false;
    let timer;
    let tries = 0;
    const tick = () => refresh().then(data => {
      if (!cancelled && returning && data.paymentStatus === 'pending_payment' && ++tries < POLL_TRIES) timer = setTimeout(tick, POLL_MS);
    }, failure => { if (!cancelled) setError(failure); });
    tick();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [hasToken, refresh, returning]);

  async function pay() {
    setPaying(true);
    setPayError(null);
    try {
      const { authorizationUrl } = await startPayment(reference);
      window.location.assign(authorizationUrl);
    } catch (failure) {
      setPaying(false);
      setPayError(failure.message);
      refresh().catch(() => {});
    }
  }

  if (!hasToken || error?.status === 404) {
    return (
      <main className="section narrow-page">
        <p className="eyebrow">ORDER {reference}</p>
        <h1 className="page-title">Open this on the device you ordered from.</h1>
        <p className="muted">For your privacy, order details only show on the device that placed the order. Your payment receipt from Paystack also has your reference.</p>
        <Link className="button dark" to="/shop">Back to the shop <ArrowUpRight size={18} /></Link>
      </main>
    );
  }
  if (error) {
    return (
      <main className="section narrow-page">
        <h1 className="page-title">We couldn’t load your order.</h1>
        <p className="muted">{error.message} Your reference is <strong>{reference}</strong>.</p>
        <button className="button dark" onClick={() => { setError(null); refresh().catch(setError); }}>Try again</button>
      </main>
    );
  }
  if (!order) return <main className="section"><p className="muted">Loading your order…</p></main>;

  const cancelled = order.fulfilmentStatus === 'cancelled';
  const paid = order.paymentStatus === 'paid';
  const pending = order.paymentStatus === 'pending_payment' && !cancelled;
  const { fulfilment } = order;

  return (
    <main className="section order-page">
      <div className={`order-status ${paid ? 'paid' : pending ? 'pending' : 'closed'}`}>
        {paid ? <CheckCircle2 size={28} /> : pending ? <Clock size={28} /> : <XCircle size={28} />}
        <div>
          <p className="eyebrow">ORDER {order.reference}</p>
          <h1 className="page-title">
            {paid ? `Thank you, ${order.contact.name.split(' ')[0]}.` : cancelled ? 'This order was cancelled.' : pending ? 'Waiting for your payment.' : 'This order has expired.'}
          </h1>
          <p className="muted">
            {paid && (FULFILMENT_TEXT[order.fulfilmentStatus] ?? '')}
            {pending && `Your items are held until ${new Date(order.reservationExpiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. If you’ve just paid, this can take a moment to update.`}
            {!paid && !pending && !cancelled && 'It wasn’t paid in time, so the items went back on sale. You have not been charged for this order.'}
          </p>
          {pending && (
            <div className="row-actions">
              <button className="button dark" onClick={pay} disabled={paying}>{paying ? 'Taking you to payment…' : `Pay ${money(order.totalMinor, order.currency)}`}</button>
              <button className="button outline" onClick={() => refresh().catch(setError)}>Check again</button>
            </div>
          )}
          {payError && <p className="co-error" role="alert">{payError}</p>}
          {!paid && !pending && <Link className="button dark" to="/shop">Back to the shop <ArrowUpRight size={18} /></Link>}
        </div>
      </div>

      <div className="order-grid">
        <section className="order-card">
          <h2>Items</h2>
          <ul className="order-lines">
            {order.items.map(line => <li key={line.sku}><span>{line.title} <span className="muted">× {line.quantity}</span></span><span>{money(line.lineTotalMinor, order.currency)}</span></li>)}
          </ul>
          <dl className="summary-totals">
            <div><dt>Subtotal</dt><dd>{money(order.subtotalMinor, order.currency)}</dd></div>
            <div><dt>Delivery</dt><dd>{order.deliveryFeeMinor ? money(order.deliveryFeeMinor, order.currency) : 'Free'}</dd></div>
            <div className="summary-total"><dt>Total</dt><dd>{money(order.totalMinor, order.currency)}</dd></div>
          </dl>
        </section>
        <section className="order-card">
          <h2>{fulfilment.method === 'pickup' ? 'Collect from' : `Delivering to ${fulfilment.zoneName}`}</h2>
          {fulfilment.method === 'pickup'
            ? <p className="muted">{fulfilment.pickup.address}<br />{fulfilment.pickup.hours}</p>
            : <p className="muted">{fulfilment.address.digitalAddress}<br />{fulfilment.address.area}{fulfilment.address.landmark && <><br />{fulfilment.address.landmark}</>}</p>}
          <h2>Contact</h2>
          <p className="muted">{order.contact.name}<br />{order.contact.phone}<br />{order.contact.email}</p>
        </section>
      </div>
    </main>
  );
}
