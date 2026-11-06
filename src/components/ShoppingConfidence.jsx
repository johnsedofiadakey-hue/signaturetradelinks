import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Check, MessageCircle, ShieldCheck, Truck } from 'lucide-react';
import { useDiscovery } from '../discovery/DiscoveryProvider';
import { WHATSAPP_NUMBER, businessEnquiry } from '../discovery/contact';
import { Link } from '../router';
import { formatPrice } from '../services/catalogue';
import { loadCheckoutOptions } from '../services/checkout';



// Reuse the discovery cache; fetch specifications only when a card enters the viewport.
export function ProductFacts({ product }) {
  const ref = useRef(null);
  const { details, ensureDetails } = useDiscovery();
  useEffect(() => {
    if (!('IntersectionObserver' in window)) { ensureDetails(product); return; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { ensureDetails(product); observer.disconnect(); }
    }, { rootMargin: '100px' });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [product.slug, ensureDetails]);
  const detail = details[product.slug];
  const spec = detail?.specifications?.find(item => item.label && item.value);
  const stock = product.availability === 'in_stock' ? 'In stock' : product.availability === 'out_of_stock' ? 'Out of stock' : 'Check availability';
  return <div className="product-facts" ref={ref}>
    {product.brand && <span className="product-brand">{product.brand}</span>}
    <p className="product-key-spec">{spec ? `${spec.label}: ${spec.value}` : detail?.status === 'loading' ? 'Loading specifications…' : 'Model & specifications to be confirmed'}</p>
    <span className={`product-stock ${product.availability === 'in_stock' ? 'available' : ''}`}>{product.availability === 'in_stock' && <Check size={12} />}{stock}</span>
  </div>;
}

export default function ShoppingConfidence() {
  const [options, setOptions] = useState(null);
  useEffect(() => {
    const controller = new AbortController();
    loadCheckoutOptions(controller.signal).then(setOptions, () => {});
    return () => controller.abort();
  }, []);
  return <section className="confidence section" aria-labelledby="confidence-title">
    <div className="section-top"><div><p className="eyebrow">BEFORE YOU BUY</p><h2 id="confidence-title">A little more confidence.</h2></div><a className="confidence-contact" href={businessEnquiry('Hello Signature Tradelink, I have a question before buying.')} target="_blank" rel="noopener noreferrer"><MessageCircle size={18}/>Talk to us <ArrowUpRight size={16}/></a></div>
    <div className="confidence-grid">
      <article><Truck size={24}/><h3>Delivery & collection</h3>{options?.deliveryZones?.length ? <><p>Available delivery areas:</p><ul>{options.deliveryZones.map(zone => <li key={zone.id}>{zone.name}{Number.isInteger(zone.feeMinor) && options.currency ? ` · ${formatPrice({ amountMinor: zone.feeMinor, currency: options.currency })}` : ''}</li>)}</ul><p>Final availability and charges are confirmed at checkout.</p></> : <p>Delivery coverage, fees and collection details are awaiting confirmation.</p>}<Link to="/checkout">Check checkout options <ArrowUpRight size={14}/></Link></article>
      <article><ShieldCheck size={24}/><h3>Warranty & returns</h3><p>Warranty terms vary by product. Ask us to confirm coverage before you buy.</p>{options?.returnsPolicy ? <details><summary>Read the returns policy</summary><p className="policy-copy">{options.returnsPolicy}</p></details> : <p className="confidence-pending">The returns policy is awaiting confirmation.</p>}<a href={businessEnquiry('Hello Signature Tradelink, please confirm the warranty and returns terms for the product I want to buy.')} target="_blank" rel="noopener noreferrer">Ask about coverage <ArrowUpRight size={14}/></a></article>
      <article><MessageCircle size={24}/><h3>Speak to Signature</h3><p>Need help choosing? Send us a WhatsApp enquiry.</p><a className="confidence-number" href={`tel:${WHATSAPP_NUMBER}`}>{WHATSAPP_NUMBER}</a><a href={businessEnquiry('Hello Signature Tradelink, please help me choose my next upgrade.')} target="_blank" rel="noopener noreferrer">Chat on WhatsApp <ArrowUpRight size={14}/></a></article>
    </div>
  </section>;
}
