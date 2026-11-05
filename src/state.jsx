// Shared storefront state: the catalogue (loaded once for both stores) and the retail bag.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { loadCatalogue } from './services/catalogue';

const CatalogueContext = createContext(null);
const BagContext = createContext(null);
const BAG_KEY = 'stl.bag.v1';

function readBag() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(BAG_KEY) ?? '[]');
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

export function StoreProvider({ children }) {
  const [catalogue, setCatalogue] = useState({ status: 'loading', source: null, categories: [], products: [] });
  const [bag, setBag] = useState(readBag);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    loadCatalogue(controller.signal).then(data => setCatalogue({ status: 'ready', ...data }), () => {});
    return () => controller.abort();
  }, []);

  // The bag is a per-browser convenience; the server re-prices everything at checkout.
  useEffect(() => {
    try { window.localStorage.setItem(BAG_KEY, JSON.stringify(bag)); } catch { /* storage unavailable: keep it in memory */ }
  }, [bag]);

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
    setNotice(`${product.name} added to your bag`);
  }, []);
  const changeQuantity = useCallback((key, delta) => setBag(items => items.map(item => (item.key === key ? { ...item, quantity: item.quantity + delta } : item)).filter(item => item.quantity > 0)), []);
  const remove = useCallback(key => setBag(items => items.filter(item => item.key !== key)), []);

  const bagValue = useMemo(() => ({ items: bag, count: bag.reduce((sum, item) => sum + item.quantity, 0), add, changeQuantity, remove, notice, setNotice }), [bag, add, changeQuantity, remove, notice]);

  return (
    <CatalogueContext.Provider value={catalogue}>
      <BagContext.Provider value={bagValue}>{children}</BagContext.Provider>
    </CatalogueContext.Provider>
  );
}

export const useCatalogue = () => useContext(CatalogueContext);
export const useBag = () => useContext(BagContext);

/** Subtotal when every line has a confirmed price in one currency; otherwise null (confirmed at checkout). */
export function bagSubtotal(items) {
  if (!items.length || items.some(item => !item.price || item.price.varies)) return null;
  const currency = items[0].price.currency;
  if (items.some(item => item.price.currency !== currency)) return null;
  return { amountMinor: items.reduce((sum, item) => sum + item.price.amountMinor * item.quantity, 0), currency };
}
