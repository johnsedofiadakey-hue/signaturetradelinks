import {useEffect,useRef,useState} from 'react';
import {ArrowLeft,ArrowRight,ArrowUpRight,Check,Search,SlidersHorizontal} from 'lucide-react';
import {Modal,ProductImage} from '../components/shared';
import {Link} from '../router';
import {useCatalogue} from '../state';
import {formatPrice} from '../services/catalogue';
import {USE_OPTIONS,findProducts,minorBudget} from './model';
import {useDiscovery} from './DiscoveryProvider';

export default function FinderDialog({onClose}){
 const {products,categories,status}=useCatalogue();const {details,ensureDetails}=useDiscovery();
 const heading=useRef(null);
 const [step,setStep]=useState(1),[category,setCategory]=useState('all'),[budget,setBudget]=useState(''),[currency,setCurrency]=useState(''),[use,setUse]=useState('any');
 useEffect(()=>{heading.current?.focus({preventScroll:true});const modal=heading.current?.closest('.modal');if(modal)modal.scrollTop=0},[step]);
 const currencies=[...new Set(products.map(p=>p.price?.currency).filter(Boolean))];const chosenCurrency=currency||currencies[0]||'';
 const results=findProducts(products,details,{category,budget,currency:chosenCurrency,use});
 const scope=products.filter(p=>category==='all'||p.categorySlug===category);
 // Fetch only the selected category when suitability is requested. This reuses the comparison/quick-view cache.
 useEffect(()=>{if(step>=3&&use!=='any')scope.forEach(p=>ensureDetails(p))},[step,use,category,products,ensureDetails]);
 const loading=use!=='any'&&scope.some(p=>!details[p.slug]||details[p.slug].status==='loading');
 const invalidBudget=budget.trim()!==''&&minorBudget(budget,chosenCurrency)===null;
 const shown=results.matches.length?results.matches:results.incomplete;
 const fallback=results.matches.length===0&&results.incomplete.length>0;
 const resultTitle=loading?'Checking confirmed details…':fallback?'A few products to explore.':results.matches.length?'Your shortlist.':'No confirmed matches yet.';
 function next(){if(step<4)setStep(s=>s+1)}
 return <Modal onClose={onClose} className="finder-modal"><p className="eyebrow"><SlidersHorizontal size={14}/> FIND MY UPGRADE</p><h2 id="dialog-title" ref={heading} tabIndex={-1}>{step===1?'What are you looking for?':step===2?'What’s your budget?':step===3?'What will you use it for?':resultTitle}</h2><div className="finder-progress" aria-label={`Step ${Math.min(step,3)} of 3${step===4?', results':''}`}>{['Product type','Budget','Your everyday'].map((label,i)=><span key={label} className={step>=i+1?'complete':''}><i>{step>i+1?<Check size={11}/>:i+1}</i>{label}</span>)}</div>
 {status==='loading'?<p role="status">Loading the collection…</p>:<>
 {step===1&&<div className="finder-options">{[{slug:'all',label:'Explore everything'},...categories].map(c=><button key={c.slug} onClick={()=>setCategory(c.slug)} aria-pressed={category===c.slug} className={category===c.slug?'chosen':''}>{c.label}{category===c.slug&&<Check size={16}/>}</button>)}</div>}
 {step===2&&<div className="finder-budget"><p className="discovery-note">We’ll check the catalogue’s listed starting prices. Delivery and any variant price differences are confirmed on the product page and at checkout.</p>{currencies.length?<><div className="finder-budget-fields">{currencies.length>1&&<label>Currency<select aria-label="Budget currency" value={chosenCurrency} onChange={e=>setCurrency(e.target.value)}>{currencies.map(c=><option key={c}>{c}</option>)}</select></label>}<label>Maximum budget ({chosenCurrency})<input aria-label={`Maximum budget (${chosenCurrency})`} type="number" min="0.01" step="any" inputMode="decimal" value={budget} onChange={e=>setBudget(e.target.value)} placeholder="Any budget" aria-invalid={invalidBudget}/></label></div>{invalidBudget&&<p className="finder-error" role="alert">Enter a positive amount, or leave it blank for any budget.</p>}<button className="text-button" onClick={()=>setBudget('')}>Use any budget</button></>:<div className="finder-data-note"><strong>Prices haven’t been confirmed yet.</strong><p>We can help you explore by category. Budget matching will become available when prices are added.</p></div>}</div>}
 {step===3&&<><p className="discovery-note">Suitability is matched only against confirmed product details. We won’t infer it from the photo or product name.</p><div className="finder-options">{USE_OPTIONS.map(option=><button key={option.id} onClick={()=>setUse(option.id)} className={use===option.id?'chosen':''} aria-pressed={use===option.id}>{option.label}{use===option.id&&<Check size={16}/>}</button>)}</div></>}
 {step===4&&<div className="finder-results" aria-live="polite">{loading?<p className="discovery-note" role="status">Loading product suitability information…</p>:<>{fallback&&<p className="finder-data-note">These match your category, but their price or suitability information is incomplete. They are <strong>not confirmed matches</strong> for every choice you made.</p>}{results.matches.length>0&&<p className="discovery-note">{results.matches.length} {results.matches.length===1?'product matches':'products match'} your selected criteria.{use==='any'?' No suitability preference was applied.':''}{results.limit===null?' No budget limit was applied.':''} Availability is shown on each product.</p>}{!shown.length&&<div className="finder-empty"><Search size={28}/><p>Try another category, a higher budget or no use preference.</p></div>}<div className="finder-result-list">{shown.slice(0,6).map(p=><Link to={`/p/${p.slug}`} onClick={onClose} key={p.slug} className="finder-result"><div><ProductImage product={p} eager/></div><span><strong>{p.name}</strong><small>{formatPrice(p.price)}</small>{p.price?.varies&&<small>Starting price — select a variant to confirm.</small>}</span><ArrowUpRight size={17}/></Link>)}</div>{shown.length>6&&<p className="discovery-note">Showing the first six products. Refine your choices for a shorter list.</p>}{results.matches.length>0&&results.incomplete.length>0&&<p className="discovery-note">{results.incomplete.length} other products have incomplete details and weren’t counted as confirmed matches.</p>}</>}</div>}
 <div className="finder-actions">{step>1?<button className="finder-back" onClick={()=>setStep(s=>s-1)}><ArrowLeft size={15}/>Back</button>:<span/>}{step<4?<button className="button dark" disabled={step===2&&invalidBudget} onClick={next}>{step===3?'See my shortlist':'Continue'}<ArrowRight size={16}/></button>:<button className="button outline" onClick={()=>{setStep(1);setCategory('all');setBudget('');setCurrency('');setUse('any')}}>Start again</button>}</div>
 </>}
 </Modal>
}
