// The retail cart. Only outright purchases live here; the server re-prices everything at checkout.
import { ArrowRight, Minus, Plus, ShoppingCart } from 'lucide-react';
import { SecureLine } from '../components/PaymentMethods';
import { Modal, ProductImage } from '../components/shared';
import { Link } from '../router';
import { formatPrice } from '../services/catalogue';
import { bagSubtotal, useBag } from '../state';

export default function BagDialog({ onClose }) {
  const { items, count, changeQuantity, remove } = useBag();
  const subtotal = bagSubtotal(items);
  return (
    <Modal onClose={onClose} className="cart-modal">
      <p className="eyebrow">YOUR CART</p>
      <h2 id="dialog-title">Your cart <span className="muted">({count})</span></h2>
      {items.length ? (
        <>
          <div className="cart-items">
            {items.map(item => (
              <div className="cart-item" key={item.key}>
                <div className="cart-image"><ProductImage product={item} /></div>
                <div>
                  <h3><Link to={`/p/${item.slug}`} onClick={onClose}>{item.name}</Link></h3>
                  <p>{formatPrice(item.price)}{item.sku && <span className="sku"> · {item.sku}</span>}</p>
                  <div className="quantity">
                    <button onClick={() => changeQuantity(item.key, -1)} aria-label={`Remove one ${item.name}`}><Minus size={14} /></button>
                    <span>{item.quantity}</span>
                    <button onClick={() => changeQuantity(item.key, 1)} aria-label={`Add one ${item.name}`}><Plus size={14} /></button>
                    <button className="remove" onClick={() => remove(item.key)}>Remove</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="bag-total">
            <span>Subtotal</span>
            <strong>{subtotal ? formatPrice(subtotal) : 'Confirmed at checkout'}</strong>
          </div>
          <p className="muted small">Delivery or collection is chosen at checkout.</p>
          <Link className="button dark full" to="/checkout" onClick={onClose}>Go to checkout <ArrowRight size={18} /></Link>
          <SecureLine />
          <button className="text-button" onClick={onClose}>Continue shopping</button>
        </>
      ) : (
        <div className="empty">
          <ShoppingCart size={35} />
          <h3>A little room for an upgrade.</h3>
          <p>Your cart is empty.</p>
          <Link className="button dark" to="/shop" onClick={onClose}>Explore the collection <ArrowRight size={18} /></Link>
        </div>
      )}
    </Modal>
  );
}
