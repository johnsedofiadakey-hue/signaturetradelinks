// The first thing a visitor sees: what we sell, in one changing word, and how to buy it now.
import {useEffect,useRef,useState} from 'react';
import {ArrowUpRight,ChevronLeft,ChevronRight,Pause,Play} from 'lucide-react';
import {Link} from '../router';

const duration=5000;
const features=[
 {id:'tv',word:'TV',category:'tv-and-entertainment',image:'/hero/lg-oled-hero-v1.webp',alt:'LG OLED television with magenta and blue screen artwork'},
 {id:'fridge',word:'fridge',category:'home-appliances',image:'/hero/lg-fridge-hero-v1.webp',alt:'Graphite LG InstaView refrigerator'},
 {id:'washer',word:'washer',category:'home-appliances',image:'/hero/lg-washer-hero-v1.webp',alt:'Graphite LG front-loading washing machine'},
 {id:'ac',word:'AC',category:'cooling',image:'/hero/ac-studio-v1.webp',alt:'White wall-mounted air conditioner'},
 {id:'audio',word:'sound system',category:'audio',image:'/hero/lg-audio-hero-v1.webp',alt:'LG subwoofer, soundbar and rear speakers'},
 {id:'phone',word:'phone',category:'phones-and-computing',image:'/hero/phone-studio-v1.webp',alt:'Smartphone with a blue and teal screen'},
];

export default function HeroCarousel(){
 const [active,setActive]=useState(0),[paused,setPaused]=useState(false),[focused,setFocused]=useState(false),[reduced,setReduced]=useState(()=>typeof matchMedia!=='undefined'&&matchMedia('(prefers-reduced-motion: reduce)').matches),[inView,setInView]=useState(true);
 const root=useRef(null),swipeStart=useRef(null);
 const stopped=paused||focused||reduced||!inView;
 useEffect(()=>{const media=matchMedia('(prefers-reduced-motion: reduce)');const update=()=>setReduced(media.matches);media.addEventListener('change',update);const observer=new IntersectionObserver(([entry])=>setInView(entry.isIntersecting),{threshold:.15});observer.observe(root.current);return()=>{media.removeEventListener('change',update);observer.disconnect()}},[]);
 useEffect(()=>{if(stopped)return;const timer=setInterval(()=>{if(!document.hidden)setActive(i=>(i+1)%features.length)},duration);return()=>clearInterval(timer)},[active,stopped]);
 function change(delta){setActive(i=>(i+delta+features.length)%features.length)}
 const slide=features[active];
 return <section ref={root} className="sell-hero" data-feature={slide.id} aria-label="Featured products" aria-roledescription="carousel" onFocusCapture={()=>setFocused(true)} onBlurCapture={e=>{if(!e.currentTarget.contains(e.relatedTarget))setFocused(false)}} onKeyDown={e=>{if(e.key==='ArrowRight'){e.preventDefault();change(1)}if(e.key==='ArrowLeft'){e.preventDefault();change(-1)}}}>
  <h1 className="sell-hero-title">
   <span className="sell-hero-sr">Your next TV, fridge, washer, AC, sound system or phone.</span>
   <span aria-hidden="true">Your next<span className="sell-hero-word" key={slide.id}>{slide.word}.</span></span>
  </h1>
  <div className="sell-hero-media" onPointerDown={e=>{if(e.pointerType==='touch')swipeStart.current=e.clientX}} onPointerUp={e=>{if(swipeStart.current!==null){const delta=e.clientX-swipeStart.current;if(Math.abs(delta)>45)change(delta<0?1:-1);swipeStart.current=null}}} onPointerCancel={()=>{swipeStart.current=null}}>
   <Link className="sell-hero-stage" to={`/shop/${slide.category}`} aria-label={`Shop for your next ${slide.word}`}>
    {features.map((s,i)=><img key={s.id} className={i===active?'is-active':''} src={s.image} alt={i===active?s.alt:''} fetchPriority={i===0?'high':'low'} decoding={i===0?'sync':'async'}/>)}
   </Link>
   <div className="hero-navigation" aria-label="Featured product controls"><button type="button" className="hero-arrow" aria-label="Previous product" onClick={()=>change(-1)}><ChevronLeft size={18}/></button><div className="hero-selectors">{features.map((feature,index)=><button key={feature.id} type="button" className={active===index?'active':''} aria-label={`Show ${feature.word}`} aria-pressed={active===index} onClick={()=>setActive(index)}><span aria-hidden="true"/><span className="sell-hero-sr">{feature.word}</span></button>)}</div><button type="button" className="hero-arrow" aria-label="Next product" onClick={()=>change(1)}><ChevronRight size={18}/></button></div>
   <div className="hero-progress" key={`${slide.id}-${stopped}`} aria-hidden="true"><span style={{animationDuration:`${duration}ms`,animationPlayState:stopped?'paused':'running'}}/></div>
   <div className="sell-hero-foot"><span>{active+1}/{features.length}</span><button type="button" aria-label={paused?'Resume changing products':'Pause changing products'} aria-pressed={paused} onClick={()=>setPaused(v=>!v)}>{paused?<Play size={12}/>:<Pause size={12}/>}</button></div>
  </div>
  <div className="sell-hero-offer">
   <p>Pay with MoMo or card.</p>
   <div className="sell-hero-actions"><Link className="button dark" to="/shop">Shop now <ArrowUpRight size={18}/></Link></div>
  </div>
 </section>
}
