// Two stores over one catalogue: the retail shop at / and the hire-purchase store at /hire-purchase.
// See planning/RETAIL_HP_SEPARATION.md for the design.
import React, { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import './clean.css';
import './stores.css';
import { Footer, HelpDialog, HirePurchaseHeader, PreviewStrip, RetailHeader, Toast } from './components/shared';
import Apply from './hire-purchase/Apply';
import HirePurchaseHome from './hire-purchase/HirePurchaseHome';
import HirePurchaseProduct from './hire-purchase/HirePurchaseProduct';
import BagDialog from './retail/BagDialog';
import Checkout from './retail/Checkout';
import ProductPage, { NotFound } from './retail/ProductPage';
import RetailHome from './retail/RetailHome';
import { match, navigate, useLocation } from './router';
import { StoreProvider, useCatalogue } from './state';

function useTitle(title) {
  useEffect(() => { document.title = title ? `${title} — Signature Tradelink` : 'Signature Tradelink — Upgrade your everyday'; }, [title]);
}

function App() {
  const { path, search } = useLocation();
  const { products } = useCatalogue();
  const [help, setHelp] = useState(false);
  const [bagOpen, setBagOpen] = useState(false);
  const [query, setQuery] = useState('');
  const openHelp = useCallback(() => setHelp(true), []);
  const closeHelp = useCallback(() => setHelp(false), []);
  const closeBag = useCallback(() => setBagOpen(false), []);

  const hirePurchase = path === '/hire-purchase' || path.startsWith('/hire-purchase/');
  const productSlug = match('/p/:slug', path)?.slug;
  const hpSlug = match('/hire-purchase/p/:slug', path)?.slug;
  const nameOf = slug => products.find(p => p.slug === slug)?.name;

  let page;
  let title;
  if (path === '/' || path === '') { page = <RetailHome search={search} query={query} onResetQuery={() => setQuery('')} />; }
  else if (productSlug) { page = <ProductPage slug={productSlug} />; title = nameOf(productSlug); }
  else if (match('/checkout', path)) { page = <Checkout />; title = 'Checkout'; }
  else if (match('/hire-purchase', path)) { page = <HirePurchaseHome />; title = 'Hire purchase'; }
  else if (hpSlug) { page = <HirePurchaseProduct slug={hpSlug} />; title = `${nameOf(hpSlug) ?? 'Product'} · Hire purchase`; }
  else if (match('/hire-purchase/apply', path)) { page = <Apply search={search} />; title = 'Apply for hire purchase'; }
  else { page = <NotFound />; title = 'Not found'; }
  useTitle(title);

  // Searching always searches the shop, so leave other pages for the product list.
  const onQuery = value => {
    setQuery(value);
    if (path !== '/') navigate('/#shop');
  };

  return (
    <div className={hirePurchase ? 'store-hp' : 'store-retail'}>
      <PreviewStrip />
      {hirePurchase ? <HirePurchaseHeader onHelp={openHelp} /> : <RetailHeader onHelp={openHelp} onBag={() => setBagOpen(true)} query={query} onQuery={onQuery} />}
      {page}
      <Footer onHelp={openHelp} note={hirePurchase ? 'Hire purchase is subject to assessment and approval' : 'Design preview · Catalogue & policies awaiting confirmation'} />
      <Toast />
      {help && <HelpDialog onClose={closeHelp} />}
      {bagOpen && <BagDialog onClose={closeBag} />}
    </div>
  );
}

createRoot(document.getElementById('root')).render(<StoreProvider><App /></StoreProvider>);
