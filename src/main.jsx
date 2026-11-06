// Two stores over one catalogue: the retail shop at / and the hire-purchase store at /hire-purchase.
// See planning/RETAIL_HP_SEPARATION.md for the design.
import React, { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import './clean.css';
import './stores.css';
import './landing.css';
import './discovery/discovery.css';
import {DiscoveryProvider} from './discovery/DiscoveryProvider';
import { Footer, HelpDialog, HirePurchaseHeader, PreviewStrip, RetailHeader, Toast } from './components/shared';
import HirePurchaseHome from './hire-purchase/HirePurchaseHome';
import HirePurchaseProduct from './hire-purchase/HirePurchaseProduct';
import BagDialog from './retail/BagDialog';
import Checkout from './retail/Checkout';
import OrderPage from './retail/OrderPage';
import ProductPage, { NotFound } from './retail/ProductPage';
import RetailHome from './retail/RetailHome';
import ShopPage from './retail/ShopPage';
import WishlistPage from './retail/WishlistPage';
import { match, navigate, useLocation } from './router';
import { StoreProvider, useCatalogue } from './state';

// Sign-in code is only downloaded by people who go to these two pages.
const Apply = lazy(() => import('./hire-purchase/Apply'));
const AccountPage = lazy(() => import('./hire-purchase/AccountPage'));
const BuyPage = lazy(() => import('./hire-purchase/BuyPage'));
const AgreementPage = lazy(() => import('./hire-purchase/AgreementPage'));

function useTitle(title) {
  useEffect(() => { document.title = title ? `${title} — Signature Tradelink` : 'Signature Tradelink — Upgrade your everyday'; }, [title]);
}

function App() {
  const { path, search } = useLocation();
  const { categories, products, checkoutOpen } = useCatalogue();
  const [help, setHelp] = useState(false);
  const [bagOpen, setBagOpen] = useState(false);
  const [query, setQuery] = useState('');
  const openHelp = useCallback(() => setHelp(true), []);
  const closeHelp = useCallback(() => setHelp(false), []);
  const closeBag = useCallback(() => setBagOpen(false), []);
  const resetQuery = useCallback(() => setQuery(''), []);

  // Links shared before the shop had its own page still land in the right place.
  useEffect(() => {
    if (path !== '/') return;
    const legacy = new URLSearchParams(search).get('category');
    if (legacy) navigate(`/shop/${legacy}`, { replace: true });
    else if (window.location.hash === '#shop') navigate('/shop', { replace: true });
  }, [path, search]);

  const hirePurchase = path === '/hire-purchase' || path.startsWith('/hire-purchase/');
  const shopCategory = match('/shop/:category', path)?.category;
  const productSlug = match('/p/:slug', path)?.slug;
  const hpSlug = match('/hire-purchase/p/:slug', path)?.slug;
  const nameOf = slug => products.find(p => p.slug === slug)?.name;

  let page;
  let title;
  if (path === '/' || path === '') { page = <RetailHome />; }
  else if (match('/shop', path)) { page = <ShopPage query={query} onResetQuery={resetQuery} />; title = 'Shop'; }
  else if (shopCategory) { page = <ShopPage categorySlug={shopCategory} query={query} onResetQuery={resetQuery} />; title = categories.find(c => c.slug === shopCategory)?.label ?? 'Shop'; }
  else if (match('/wishlist', path)) { page = <WishlistPage />; title = 'Wishlist'; }
  else if (productSlug) { page = <ProductPage slug={productSlug} />; title = nameOf(productSlug); }
  else if (match('/checkout', path)) { page = <Checkout />; title = 'Checkout'; }
  else if (match('/order/:reference', path)) { page = <OrderPage reference={match('/order/:reference', path).reference} search={search} />; title = 'Your order'; }
  else if (match('/hire-purchase', path)) { page = <HirePurchaseHome />; title = 'Hire purchase'; }
  else if (hpSlug) { page = <HirePurchaseProduct slug={hpSlug} />; title = `${nameOf(hpSlug) ?? 'Product'} · Hire purchase`; }
  else if (match('/hire-purchase/apply', path)) { page = <Apply search={search} />; title = 'Apply for hire purchase'; }
  else if (match('/hire-purchase/account', path)) { page = <AccountPage />; title = 'Your account'; }
  else if (match('/hire-purchase/buy/:slug', path)) { page = <BuyPage slug={match('/hire-purchase/buy/:slug', path).slug} />; title = 'Buy on hire purchase'; }
  else if (match('/hire-purchase/agreements/:id', path)) { page = <AgreementPage id={match('/hire-purchase/agreements/:id', path).id} search={search} />; title = 'Your agreement'; }
  else { page = <NotFound />; title = 'Not found'; }
  useTitle(title);

  // Searching always searches the shop, so leave other pages for the product list.
  const onQuery = value => {
    setQuery(value);
    if (value && !match('/shop', path) && !shopCategory) navigate('/shop');
  };

  return (
    <div className={hirePurchase ? 'store-hp' : 'store-retail'}>
      <PreviewStrip />
      {hirePurchase ? <HirePurchaseHeader onHelp={openHelp} /> : <RetailHeader onHelp={openHelp} onBag={() => setBagOpen(true)} query={query} onQuery={onQuery} />}
      <Suspense fallback={<main className="section"><p className="muted">Loading…</p></main>}>{page}</Suspense>
      <Footer onHelp={openHelp} showPayment={!hirePurchase} note={hirePurchase ? 'Hire purchase is subject to assessment and approval' : checkoutOpen ? '' : 'Design preview · Catalogue & policies awaiting confirmation'} />
      <Toast />
      {help && <HelpDialog onClose={closeHelp} />}
      {bagOpen && <BagDialog onClose={closeBag} />}
    </div>
  );
}

createRoot(document.getElementById('root')).render(<StoreProvider><DiscoveryProvider><App /></DiscoveryProvider></StoreProvider>);
