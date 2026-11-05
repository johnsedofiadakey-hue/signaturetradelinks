// Shared storefront state: the catalogue (loaded once for both stores) the retail cart and the wishlist.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { loadCatalogue } from './services/catalogue';
import { loadCheckoutOptions } from './services/checkout';

const CatalogueContext = createContext(null);
const BagContext = createContext(null);
const WishlistContext = createContext(null);
const BAG_KEY = 'stl.bag.v1';
const WISHLIST_KEY = 'stl.wishlist.v1';

function readList(key) {
  try {
    const saved = JSON.parse(window.localStorage.getItem(key) ?? '[]');
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

export function StoreProvider({ children }) {
  const [catalogue, setCatalogue] = useState({ status: 'loading', source: null, categories: [], products: [], checkoutOpen: false });
  const [bag, setBag] = useState(() => readList(BAG_KEY));
  const [wishlist, setWishlist] = useState(() => readList(WISHLIST_KEY));
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    loadCatalogue(controller.signal).then(data => setCatalogue(current => ({ ...current, status: 'ready', ...data })), () => {});
    // Preview wording stays up until the store can actually take orders.
    loadCheckoutOptions(controller.signal).then(({ canOrder }) => setCatalogue(current => ({ ...current, checkoutOpen: canOrder })), () => {});
    return () => controller.abort();
  }, []);

  // The bag is a per-browser convenience; the server re-prices everything at checkout.
  useEffect(() => {
    try { window.localStorage.setItem(BAG_KEY, JSON.stringify(bag)); } catch { /* storage unavailable: keep it in memory */ }
  }, [bag]);

  useEffect(() => {
    try { window.localStorage.setItem(WISHLIST_KEY, JSON.stringify(wishlist)); } catch { /* storage unavailable: keep it in memory */ }
  }, [wishlist]);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(''), 3500);
    return () => clearTimeout(timer);
  }, [notice]);

  const add = useCallback((product, { sku = null, price = product.price, quantity = 1 } = {}) => {
    const key = sku ?? product.slug;
    setBag(items => {
      const existing = items.find(item => item.key === key);
      if (existing) return items.map(item => (item.key === key ? { ...item, quantity: item.quantity + quantity } : item));
      const { slug, name, category, image, imageAlt, illustration } = product;
      return [...items, { key, sku, slug, name, category, image, imageAlt, illustration, price, quantity }];
    });
    setNotice(`${product.name} added to your cart`);
  }, []);
  const toggleWish = useCallback(product => {
    const saved = wishlist.includes(product.slug);
    setWishlist(slugs => (saved ? slugs.filter(slug => slug !== product.slug) : [...slugs, product.slug]));
    setNotice(`${product.name} ${saved ? 'removed from' : 'saved to'} your wishlist`);
  }, [wishlist]);
  const clear = useCallback(() => setBag([]), []);
  const changeQuantity = useCallback((key, delta) => setBag(items => items.map(item => (item.key === key ? { ...item, quantity: item.quantity + delta } : item)).filter(item => item.quantity > 0)), []);
  const remove = useCallback(key => setBag(items => items.filter(item => item.key !== key)), []);

  const bagValue = useMemo(() => ({ items: bag, count: bag.reduce((sum, item) => sum + item.quantity, 0), add, changeQuantity, remove, clear, notice, setNotice }), [bag, add, changeQuantity, remove, clear, notice]);

  const wishlistValue = useMemo(() => ({ slugs: wishlist, toggle: toggleWish }), [wishlist, toggleWish]);

  return (
    <CatalogueContext.Provider value={catalogue}>
      <BagContext.Provider value={bagValue}>
        <WishlistContext.Provider value={wishlistValue}>{children}</WishlistContext.Provider>
      </BagContext.Provider>
    </CatalogueContext.Provider>
  );
}

export const useCatalogue = () => useContext(CatalogueContext);
export const useBag = () => useContext(BagContext);
export const useWishlist = () => useContext(WishlistContext);

/** Subtotal when every line has a confirmed price in one currency; otherwise null (confirmed at checkout). */
export function bagSubtotal(items) {
  if (!items.length || items.some(item => !item.price || item.price.varies)) return null;
  const currency = items[0].price.currency;
  if (items.some(item => item.price.currency !== currency)) return null;
  return { amountMinor: items.reduce((sum, item) => sum + item.price.amountMinor * item.quantity, 0), currency };
}
