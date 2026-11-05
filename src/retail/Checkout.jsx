// Retail checkout. The steps are fixed by the design (contact, delivery, review, pay); they switch on as the
// backend quote, order and Paystack endpoints go live. Until then the page says so plainly and takes nothing.
import { ArrowLeft, ArrowUpRight, Lock } from 'lucide-react';
import { ProductImage } from '../components/shared';
import { Link } from '../router';
import { formatPrice } from '../services/catalogue';
import { bagSubtotal, useBag } from '../state';

const STEPS = [
  ['Contact', 'Your name, phone and email for order updates.'],
  ['Delivery', 'Delivery to your area, or collection from our store.'],
  ['Review', 'Items, delivery fee and total, confirmed by our system.'],
  ['Pay', 'Pay securely on Paystack’s page. Your order is confirmed when payment clears.'],
];

export default function Checkout() {
  const { items, count } = useBag();
  const subtotal = bagSubtotal(items);
  return (
    <main className="checkout section">
      <nav className="breadcrumb" aria-label="Breadcrumb"><Link to="/#shop"><ArrowLeft size={14} /> Continue shopping</Link></nav>
      <h1 className="page-title">Checkout</h1>
      <div className="checkout-grid">
        <div className="checkout-steps">
          <div className="status-card" role="status">
            <Lock size={20} />
            <div>
              <strong>Checkout opens soon</strong>
              <p>Online payment through Paystack and delivery options are being set up. Nothing is charged or ordered on this page yet. Your bag is saved on this device.</p>
            </div>
          </div>
          <ol className="step-outline">
            {STEPS.map(([title, text], index) => (
              <li key={title} aria-disabled="true">
                <span className="step-number">{index + 1}</span>
                <div><strong>{title}</strong><p>{text}</p></div>
              </li>
            ))}
          </ol>
        </div>
        <aside className="order-summary" aria-label="Order summary">
          <h2>Your order <span className="muted">({count})</span></h2>
          {items.length === 0 ? (
            <>
              <p className="muted">Your bag is empty.</p>
              <Link className="button dark full" to="/#shop">Explore the collection <ArrowUpRight size={18} /></Link>
            </>
          ) : (
            <>
              <ul className="summary-lines">
                {items.map(item => (
                  <li key={item.key}>
                    <div className="summary-image"><ProductImage product={item} /></div>
                    <div><strong>{item.name}</strong><span className="muted">Qty {item.quantity}</span></div>
                    <span>{item.price && !item.price.varies ? formatPrice({ ...item.price, amountMinor: item.price.amountMinor * item.quantity }) : formatPrice(item.price)}</span>
                  </li>
                ))}
              </ul>
              <dl className="summary-totals">
                <div><dt>Subtotal</dt><dd>{subtotal ? formatPrice(subtotal) : 'To be confirmed'}</dd></div>
                <div><dt>Delivery</dt><dd>Chosen at checkout</dd></div>
              </dl>
            </>
          )}
        </aside>
      </div>
    </main>
  );
}
