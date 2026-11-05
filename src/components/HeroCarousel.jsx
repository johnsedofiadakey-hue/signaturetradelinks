import {useEffect,useRef,useState} from 'react';
import {ArrowLeft,ArrowRight,ArrowUpRight,Pause,Play} from 'lucide-react';

const duration=6500;
const features=[
 {id:'oled',category:'tv-and-entertainment',title:'LG OLED TV',image:'/hero/lg-oled-hero-v1.png',alt:'AI-retouched LG OLED television with magenta and blue screen artwork'},
 {id:'washer',category:'home-appliances',title:'Washing machines',image:'/hero/lg-washer-hero-v1.png',alt:'AI-retouched graphite LG front-loading washing machine'},
 {id:'audio',category:'audio',title:'Home audio',image:'/hero/lg-audio-hero-v1.png',alt:'AI-retouched LG subwoofer, soundbar and rear speakers'},
 {id:'fridge',category:'home-appliances',title:'Fridges',image:'/hero/lg-fridge-hero-v1.png',alt:'AI-retouched graphite LG InstaView refrigerator'},
 {id:'headphones',category:'audio',title:'Headphones',image:'/hero/headphones-hero-v1.png',alt:'AI-retouched black over-ear headphones'},
];

export default function HeroCarousel({onBrowse}){
 const [active,setActive]=useState(0),[paused,setPaused]=useState(false),[hovered,setHovered]=useState(false),[focused,setFocused]=useState(false),[reduced,setReduced]=useState(()=>typeof matchMedia!=='undefined'&&matchMedia('(prefers-reduced-motion: reduce)').matches),[hidden,setHidden]=useState(document.hidden),[inView,setInView]=useState(true);
 const root=useRef(null),swipeStart=useRef(null);
 const stopped=paused||hovered||focused||reduced||hidden||!inView;
 useEffect(()=>{const media=matchMedia('(prefers-reduced-motion: reduce)');const update=()=>setReduced(media.matches);media.addEventListener('change',update);const visibility=()=>setHidden(document.hidden);document.addEventListener('visibilitychange',visibility);const observer=new IntersectionObserver(([entry])=>setInView(entry.isIntersecting),{threshold:.15});observer.observe(root.current);return()=>{media.removeEventListener('change',update);document.removeEventListener('visibilitychange',visibility);observer.disconnect()}},[]);
 useEffect(()=>{if(stopped)return;const timer=setTimeout(()=>setActive(i=>(i+1)%features.length),duration);return()=>clearTimeout(timer)},[active,stopped]);
 function change(delta){setActive(i=>(i+delta+features.length)%features.length)}
 const slide=features[active];
 return <section ref={root} className="feature-hero" aria-roledescription="carousel" aria-label="Featured product collections" onFocusCapture={()=>setFocused(true)} onBlurCapture={e=>{if(!e.currentTarget.contains(e.relatedTarget))setFocused(false)}} onKeyDown={e=>{if(e.key==='ArrowRight'){e.preventDefault();change(1)}if(e.key==='ArrowLeft'){e.preventDefault();change(-1)}}}>
  <div className="feature-copy"><h1>{slide.title}</h1><button className="button dark" onClick={()=>onBrowse(slide.category)}>Explore <ArrowUpRight size={18}/></button></div>
  <div className="feature-showcase" onMouseEnter={()=>setHovered(true)} onMouseLeave={()=>setHovered(false)} onPointerDown={e=>{if(e.pointerType==='touch')swipeStart.current=e.clientX}} onPointerUp={e=>{if(swipeStart.current!==null){const delta=e.clientX-swipeStart.current;if(Math.abs(delta)>45)change(delta<0?1:-1);swipeStart.current=null}}} onPointerCancel={()=>{swipeStart.current=null}}>
   <div className="feature-stage">
   {features.map((s,i)=><div key={s.id} role="group" aria-roledescription="slide" aria-label={`${i+1} of ${features.length}: ${s.title}`} aria-hidden={i!==active} className={`showcase-slide slide-${s.id} ${i===active?'is-active':''}`}><div className="showcase-visual"><img src={s.image} alt={s.alt} loading={i===0?'eager':'lazy'} fetchPriority={i===0?'high':'auto'} decoding="async"/></div></div>)}
   </div>
   <div className="feature-controls"><span className="featured-name">AI-retouched showcase</span><div className="feature-navigation"><div className="slide-indicators" aria-label="Choose a featured product">{features.map((s,i)=><button key={s.id} className={i===active?'active':''} aria-label={`Show slide ${i+1}: ${s.title}`} aria-current={i===active?'true':undefined} onClick={()=>setActive(i)}><span/></button>)}</div><div className="carousel-arrows"><button onClick={()=>change(-1)} aria-label="Previous product"><ArrowLeft size={15}/></button><button aria-label={paused?'Resume automatic slideshow':'Pause automatic slideshow'} aria-pressed={paused} onClick={()=>setPaused(v=>!v)}>{paused?<Play size={12}/>:<Pause size={12}/>}</button><button onClick={()=>change(1)} aria-label="Next product"><ArrowRight size={15}/></button></div></div></div>
  </div>
 </section>
}
