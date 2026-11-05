// Pieces both stores use: product media, the dialog shell, header, footer and the scroll reveal.
import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Check, Menu, Search, ShoppingBag, X } from 'lucide-react';
import BrandLogo from './BrandLogo';
import { Link, navigate } from '../router';
import { useBag, useCatalogue } from '../state';

export function Appliance({ type }) {
  return (
    <div className={`appliance ${type}`} aria-label={`Illustration of ${type === 'ac' ? 'an air conditioner' : 'a washing machine'}`} role="img">
      {type === 'ac'
        ? <><div className="ac-light" /><div className="ac-vent" /><span>···</span></>
        : <><div className="washer-controls"><i /><b /><span>···</span></div><div className="washer-door"><div /></div></>}
    </div>
  );
}

export function ProductImage({ product, eager = false }) {
  return product.image
    ? <img src={product.image} alt={product.imageAlt ?? product.name} loading={eager ? 'eager' : 'lazy'} fetchPriority={eager ? 'high' : 'auto'} />
    : <Appliance type={product.illustration} />;
}

/** Reveal [data-reveal] elements once as they scroll into view. Re-runs when the listed inputs change. */
export function useReveal(deps) {
  useEffect(() => {
    if (!('IntersectionObserver' in window)) return undefined;
    const observer = new IntersectionObserver(entries => entries.forEach(entry => {
      if (entry.isIntersecting) { entry.target.dataset.visible = 'true'; observer.unobserve(entry.target); }
    }), { threshold: 0.08 });
    document.querySelectorAll('[data-reveal]:not([data-visible])').forEach(el => observer.observe(el));
    document.documentElement.classList.add('motion-ready');
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/** Accessible dialog: traps focus, closes on Escape or backdrop click, restores focus to the opener. */
export function Modal({ onClose, className = '', labelledBy = 'dialog-title', children }) {
  const dialog = useRef(null);
  useEffect(() => {
    const opener = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.current?.focus();
    function key(event) {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab') return;
      const items = [...dialog.current.querySelectorAll('button,input,select,a,[tabindex="0"]')].filter(item => !item.disabled);
      if (!items.length) return;
      const first = items[0];
      const last = items.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', key);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener('keydown', key);
      opener?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="modal-overlay" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
      <section className={`modal ${className}`} role="dialog" aria-modal="true" aria-labelledby={labelledBy} tabIndex={-1} ref={dialog}>
        <button className="modal-close icon-button" onClick={onClose} aria-label="Close dialog"><X /></button>
        {children}
      </section>
    </div>
  );
}

export function HelpDialog({ onClose }) {
  return (
    <Modal onClose={onClose}>
      <p className="eyebrow">HERE TO HELP</p>
      <h2 id="dialog-title">Let’s make it clear.</h2>
      <p>This storefront is being prepared for Signature Tradelink. The business contact number, location, opening hours and support channels have not been supplied yet.</p>
      <div className="checkout-note">
        <strong>Two ways to buy</strong>
        <p>The shop sells outright to anyone. Hire purchase is a separate store for customers our team has assessed and approved.</p>
      </div>
      <div className="row-actions">
        <Link className="button dark" to="/" onClick={onClose}>Visit the shop <ArrowUpRight size={17} /></Link>
        <Link className="button outline" to="/hire-purchase" onClick={onClose}>Hire purchase <ArrowUpRight size={17} /></Link>
      </div>
    </Modal>
  );
}

export function PreviewStrip() {
  const { products } = useCatalogue();
  return (
    <div className="preview-strip">
      DESIGN PREVIEW <span>{products.some(p => p.illustrative) && 'Illustrative products & imagery · '}{products.some(p => !p.price) && 'Some prices to be confirmed · '}No live orders</span>
    </div>
  );
}

/** Retail header: shop navigation, search and the bag. */
export function RetailHeader({ onHelp, onBag, query, onQuery }) {
  const { count } = useBag();
  const [menu, setMenu] = useState(false);
  const [searchOpen, setSearchOpen] = useState(Boolean(query));
  const shop = to => { setMenu(false); navigate(to); };
  return (
    <>
      <header className="header">
        <BrandLogo />
        <nav className={menu ? 'nav expanded' : 'nav'} aria-label="Main navigation">
          <button onClick={() => shop('/#shop')}>Shop all</button>
          <button onClick={() => shop('/?category=home-appliances#shop')}>Home appliances</button>
          <Link to="/hire-purchase" onClick={() => setMenu(false)}>Hire purchase <span className="nav-dot" /></Link>
          <button onClick={() => { setMenu(false); onHelp(); }}>Help & support</button>
        </nav>
        <div className="header-actions">
          <button className="icon-button" aria-label="Search products" aria-expanded={searchOpen} onClick={() => { setSearchOpen(!searchOpen); setTimeout(() => document.getElementById('search')?.focus(), 0); }}><Search size={21} /></button>
          <button className="bag-button" aria-label={`Open shopping bag, ${count} items`} onClick={onBag}><ShoppingBag size={20} /><span>{count}</span></button>
          <button className="icon-button mobile-menu" aria-label="Toggle menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>{menu ? <X /> : <Menu />}</button>
        </div>
      </header>
      {searchOpen && (
        <div className="search-bar">
          <Search size={20} />
          <input id="search" aria-label="Search the shop" value={query} onChange={event => onQuery(event.target.value)} placeholder="Search headphones, televisions, appliances…" />
          <button onClick={() => { onQuery(''); setSearchOpen(false); }} aria-label="Close search"><X size={20} /></button>
        </div>
      )}
    </>
  );
}

/** Hire-purchase header: its own navigation, no bag. Approved customers will sign in here. */
export function HirePurchaseHeader({ onHelp }) {
  const [menu, setMenu] = useState(false);
  const go = to => { setMenu(false); navigate(to); };
  return (
    <header className="header hp-header">
      <div className="hp-brand">
        <BrandLogo to="/hire-purchase" />
        <span className="hp-badge">Hire purchase</span>
      </div>
      <nav className={menu ? 'nav expanded' : 'nav'} aria-label="Hire purchase navigation">
        <button onClick={() => go('/hire-purchase#how-it-works')}>How it works</button>
        <button onClick={() => go('/hire-purchase#eligible')}>Eligible products</button>
        <button onClick={() => go('/hire-purchase#what-you-need')}>What you need</button>
        <button onClick={() => { setMenu(false); onHelp(); }}>Help</button>
      </nav>
      <div className="header-actions">
        <Link className="hp-shop-link" to="/">Back to the shop</Link>
        <Link className="button dark compact" to="/hire-purchase/apply">Apply</Link>
        <button className="icon-button mobile-menu" aria-label="Toggle menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>{menu ? <X /> : <Menu />}</button>
      </div>
    </header>
  );
}

export function Footer({ onHelp, note }) {
  return (
    <footer>
      <div className="footer-top">
        <BrandLogo />
        <p>Good tech.<br />More possibilities.</p>
        <button onClick={onHelp}>Let’s talk upgrades <ArrowUpRight size={20} /></button>
      </div>
      <div className="footer-links">
        <Link to="/">Shop</Link>
        <Link to="/hire-purchase">Hire purchase</Link>
        <Link to="/checkout">Checkout</Link>
      </div>
      <div className="footer-bottom"><span>© {new Date().getFullYear()} Signature Tradelink.</span><span>{note}</span></div>
    </footer>
  );
}

export function Toast() {
  const { notice } = useBag();
  return notice ? <div className="toast" role="status"><Check size={18} />{notice}</div> : null;
}

export function OfflineNote() {
  const { source } = useCatalogue();
  return source === 'fixtures'
    ? <p className="offline-note" role="status">Offline preview: the catalogue service isn’t reachable, so these are the bundled illustrative products.</p>
    : null;
}
