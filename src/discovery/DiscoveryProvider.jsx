import {createContext,useCallback,useContext,useEffect,useMemo,useRef,useState} from 'react';
import {ArrowUpRight,Check,Columns3,Eye,MessageCircle,SlidersHorizontal,X} from 'lucide-react';
import {Modal,ProductImage} from '../components/shared';
import {Link,useLocation} from '../router';
import {useCatalogue} from '../state';
import {formatPrice,loadProductDetail} from '../services/catalogue';
import {MAX_COMPARE,RECENT_KEY,rememberSlug,whatsappUrl} from './model';
import {WHATSAPP_NUMBER} from './contact';
import FinderDialog from './FinderDialog';

const Context=createContext(null);
export const useDiscovery=()=>useContext(Context);
function readRecent(){try{const saved=JSON.parse(localStorage.getItem(RECENT_KEY)??'[]');return Array.isArray(saved)?[...new Set(saved.filter(s=>typeof s==='string'&&s.length<251))].slice(0,8):[]}catch{return []}}
export function DiscoveryProvider({children}){
 const {products,source}=useCatalogue();
 const {path}=useLocation();
 const [recent,setRecent]=useState(readRecent),[selected,setSelected]=useState([]),[dialog,setDialog]=useState(null),[details,setDetails]=useState({}),[feedback,setFeedback]=useState('');
 const pending=useRef(new Map()),cached=useRef({});
 const close=useCallback(()=>setDialog(null),[]);
 const track=useCallback(slug=>setRecent(items=>rememberSlug(items,slug)),[]);
 const clearRecent=useCallback(()=>setRecent([]),[]);
 useEffect(()=>{try{localStorage.setItem(RECENT_KEY,JSON.stringify(recent))}catch{}},[recent]);
 useEffect(()=>{if(!feedback)return;const timer=setTimeout(()=>setFeedback(''),3500);return()=>clearTimeout(timer)},[feedback]);
 useEffect(()=>()=>{pending.current.forEach(controller=>controller.abort())},[]);
 const ensureDetails=useCallback((product,{retry=false}={})=>{
  if(!product||pending.current.has(product.slug))return;
  if(!retry&&cached.current[product.slug])return;
  if(source!=='api'){
   const data={status:'ready',description:product.description??'',specifications:Array.isArray(product.specifications)?product.specifications:[],useCases:Array.isArray(product.useCases)?product.useCases:[]};
   cached.current[product.slug]=data;setDetails(current=>({...current,[product.slug]:data}));return;
  }
  const controller=new AbortController();pending.current.set(product.slug,controller);
  setDetails(current=>({...current,[product.slug]:{status:'loading'}}));
  loadProductDetail(product.slug,controller.signal).then(data=>{const result={...data,status:'ready'};cached.current[product.slug]=result;setDetails(current=>({...current,[product.slug]:result}))},error=>{if(error.name!=='AbortError'){const result={status:'error',specifications:[]};cached.current[product.slug]=result;setDetails(current=>({...current,[product.slug]:result}))}}).finally(()=>pending.current.delete(product.slug));
 },[source]);
 const toggleCompare=useCallback(slug=>setSelected(current=>{
  if(current.includes(slug))return current.filter(s=>s!==slug);
  if(current.length>=MAX_COMPARE){setFeedback('You can compare up to 3 products. Remove one first.');return current;}
  return [...current,slug];
 }),[]);
 const quickView=useCallback(slug=>setDialog({type:'quick',slug}),[]);
 const openFinder=useCallback(()=>setDialog({type:'finder'}),[]);
 const selectedProducts=selected.map(slug=>products.find(p=>p.slug===slug)).filter(Boolean);
 const trayVisible=selectedProducts.length>0&&!path.startsWith('/hire-purchase')&&!path.startsWith('/checkout')&&!path.startsWith('/order/');
 const value=useMemo(()=>({recent,track,clearRecent,selected,toggleCompare,quickView,openFinder,details,ensureDetails}),[recent,track,clearRecent,selected,toggleCompare,quickView,openFinder,details,ensureDetails]);
 return <Context.Provider value={value}><div className={`discovery-shell ${trayVisible?'has-comparison':''}`}><div inert={dialog?true:undefined}>{children}</div>
 {trayVisible&&<aside className="comparison-tray" aria-label="Selected products for comparison" inert={dialog?true:undefined}><div className="comparison-tray-items">{selectedProducts.map(p=><div className="tray-item" key={p.slug}><span><ProductImage product={p}/></span><span>{p.name}</span><button onClick={()=>toggleCompare(p.slug)} aria-label={`Remove ${p.name} from comparison`}><X size={14}/></button></div>)}</div><div className="tray-actions"><button className="button dark" onClick={()=>{setFeedback('');setDialog({type:'compare'})}}><Columns3 size={16}/>Compare ({selectedProducts.length}/3)</button><button className="tray-clear" onClick={()=>setSelected([])}>Clear</button></div></aside>}
 {feedback&&<div className="discovery-feedback" role="status">{feedback}</div>}
 {dialog?.type==='quick'&&<QuickView slug={dialog.slug} onClose={close}/>}
 {dialog?.type==='compare'&&<ComparisonDialog products={selectedProducts} onClose={close}/>}
 {dialog?.type==='finder'&&<FinderDialog onClose={close}/>}
 </div></Context.Provider>
}
export function useTrackProduct(product){const {track}=useDiscovery();useEffect(()=>{if(product?.slug)track(product.slug)},[product?.slug,track])}
export function CardDiscoveryActions({product}){
 const {selected,toggleCompare,quickView}=useDiscovery();const chosen=selected.includes(product.slug);
 return <div className="card-discovery-actions"><button onClick={()=>quickView(product.slug)} aria-label={`Quick view ${product.name}`}><Eye size={13}/>Quick view</button><button aria-pressed={chosen} onClick={()=>toggleCompare(product.slug)} aria-label={`${chosen?'Remove':'Compare'} ${product.name}${chosen?' from comparison':''}`}>{chosen?<Check size={13}/>:<Columns3 size={13}/>}<span>{chosen?'Selected':'Compare'}</span></button></div>
}
export function WhatsAppEnquiry({product}){
 const url=whatsappUrl(WHATSAPP_NUMBER,product,window.location.origin);
 return <div className="whatsapp-enquiry">{url?<a href={url} target="_blank" rel="noopener noreferrer" className="enquiry-link"><MessageCircle size={17}/>Ask about this product <ArrowUpRight size={15}/></a>:<><button disabled className="enquiry-link"><MessageCircle size={17}/>WhatsApp enquiry unavailable</button><small>Business contact number is not configured.</small></>}<small>{url?'Opens WhatsApp with a draft. You choose when to send.':''}</small></div>
}
function DetailState({product,detail}){
 const {ensureDetails}=useDiscovery();
 if(!detail||detail.status==='loading')return <p className="discovery-note" role="status">Loading product details…</p>;
 if(detail.status==='error')return <p className="discovery-note">Details couldn’t be loaded. <button className="inline-link" onClick={()=>ensureDetails(product,{retry:true})}>Try again</button></p>;
 return <>{detail.description&&<p className="quick-description">{detail.description}</p>}{detail.specifications?.length?<dl className="quick-specs">{detail.specifications.slice(0,5).map((s,i)=><div key={`${s.label}-${i}`}><dt>{s.label}</dt><dd>{String(s.value)}</dd></div>)}</dl>:<p className="discovery-note">Specifications have not been confirmed yet.</p>}</>
}
function QuickView({slug,onClose}){
 const {products}=useCatalogue();const product=products.find(p=>p.slug===slug);const {details,ensureDetails,selected,toggleCompare}=useDiscovery();useTrackProduct(product);
 useEffect(()=>{if(product)ensureDetails(product)},[product,ensureDetails]);
 if(!product)return <Modal onClose={onClose}><h2 id="dialog-title">Product unavailable</h2><p>This product may have been removed from the catalogue.</p></Modal>;
 return <Modal onClose={onClose} className="quick-view-modal"><div className="quick-view-grid"><div className="quick-view-image"><ProductImage product={product} eager/>{product.illustrative&&<span className="media-label">Illustrative preview</span>}</div><div className="quick-view-copy"><p className="eyebrow">{product.category} · QUICK VIEW</p><h2 id="dialog-title">{product.name}</h2><p className="quick-price">{formatPrice(product.price)}</p><p className="quick-availability">{availabilityLabel(product.availability)}</p><DetailState product={product} detail={details[slug]}/><Link className="button dark full" to={`/p/${product.slug}`} onClick={onClose}>View full product <ArrowUpRight size={17}/></Link><button className="quick-compare" aria-pressed={selected.includes(slug)} onClick={()=>toggleCompare(slug)}><Columns3 size={15}/>{selected.includes(slug)?'Remove from comparison':'Add to comparison'}</button><WhatsAppEnquiry product={product}/></div></div></Modal>
}
export function availabilityLabel(value){return value==='in_stock'?'In stock':value==='out_of_stock'?'Out of stock':'Availability to be confirmed'}
function ComparisonDialog({products,onClose}){
 const {details,ensureDetails,toggleCompare}=useDiscovery();
 useEffect(()=>products.forEach(p=>ensureDetails(p)),[products.map(p=>p.slug).join('|'),ensureDetails]);
 const specLabels=new Map();for(const p of products)for(const s of details[p.slug]?.specifications??[]){const key=String(s.label).trim().toLowerCase();if(!specLabels.has(key))specLabels.set(key,s.label)}
 return <Modal onClose={onClose} className="compare-modal"><p className="eyebrow">SIDE BY SIDE</p><h2 id="dialog-title">Find your favourite.</h2><p className="discovery-note">Compare up to three products. Missing details are shown as unconfirmed.</p>{products.length>0?<><div className="comparison-table-scroll" tabIndex={0} aria-label="Product comparison table, scroll horizontally"><table className="comparison-table"><caption className="visually-hidden">Product prices, availability and confirmed specifications</caption><thead><tr><th scope="col">Compare</th>{products.map(p=><th scope="col" key={p.slug}><div className="compare-product-image"><ProductImage product={p} eager/></div><span>{p.name}</span><button className="compare-remove" onClick={()=>toggleCompare(p.slug)} aria-label={`Remove ${p.name} from comparison`}><X size={13}/>Remove</button></th>)}</tr></thead><tbody>{[['Category',p=>p.category],['Brand',p=>p.brand||'Not confirmed'],['Price',p=>formatPrice(p.price)],['Availability',p=>availabilityLabel(p.availability)]].map(([label,get])=><tr key={label}><th scope="row">{label}</th>{products.map(p=><td key={p.slug}>{get(p)}</td>)}</tr>)}{[...specLabels].map(([key,label])=><tr key={key}><th scope="row">{label}</th>{products.map(p=><td key={p.slug}>{String(details[p.slug]?.specifications?.find(s=>String(s.label).trim().toLowerCase()===key)?.value??'Not confirmed')}</td>)}</tr>)}<tr><th scope="row">Details</th>{products.map(p=><td key={p.slug}>{details[p.slug]?.status==='error'?<button className="inline-link" onClick={()=>ensureDetails(p,{retry:true})}>Retry loading details</button>:details[p.slug]?.status==='loading'?'Loading…':!details[p.slug]?.specifications?.length?'Specifications not confirmed':'Confirmed specifications shown'}</td>)}</tr><tr><th scope="row">Explore</th>{products.map(p=><td key={p.slug}><Link className="compare-product-link" to={`/p/${p.slug}`} onClick={onClose}>View product <ArrowUpRight size={14}/></Link></td>)}</tr></tbody></table></div>{new Set(products.map(p=>p.categorySlug)).size>1&&<p className="discovery-note">You’re comparing different categories; shared specifications may be limited.</p>}</>:<div className="empty"><h3>No products selected</h3><button className="button dark" onClick={onClose}>Continue browsing</button></div>}</Modal>
}
export function ProductFinderBanner(){const {openFinder}=useDiscovery();return <div className="finder-banner"><div className="finder-banner-icon"><SlidersHorizontal size={23} strokeWidth={1.4}/></div><div><h3>Not sure where to start?</h3><p>Three quick choices. A shorter list.</p></div><button className="button dark" onClick={openFinder}>Find my upgrade <ArrowUpRight size={17}/></button></div>}
export function RecentlyViewed(){
 const {products}=useCatalogue();const {recent,clearRecent,quickView}=useDiscovery();const items=recent.map(slug=>products.find(p=>p.slug===slug)).filter(Boolean).slice(0,4);
 if(!items.length)return null;
 return <section className="recently-viewed" aria-labelledby="recent-title"><div className="recent-heading"><div><p className="eyebrow">PICK UP WHERE YOU LEFT OFF</p><h2 id="recent-title">Recently viewed</h2></div><button onClick={clearRecent}>Clear history</button></div><div className="recent-grid">{items.map(p=><article className="recent-item" key={p.slug}><Link to={`/p/${p.slug}`} className="recent-image"><ProductImage product={p}/></Link><div><h3><Link to={`/p/${p.slug}`}>{p.name}</Link></h3><p>{formatPrice(p.price)}</p><button onClick={()=>quickView(p.slug)}>Quick view <Eye size={12}/></button></div></article>)}</div><p className="recent-privacy">Saved in this browser only.</p></section>
}
