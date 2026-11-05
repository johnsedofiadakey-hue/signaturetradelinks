import {ClipboardCheck,UserCheck,ShoppingBag} from 'lucide-react';

export default function AssessmentPath(){
 return <div className="assessment-path" aria-label="Apply, team assessment, then shop if approved">
  <svg className="assessment-line" viewBox="0 0 350 100" aria-hidden="true"><path className="assessment-rail" d="M45 45H305"/><path className="assessment-draw" d="M45 45H305"/><circle className="assessment-traveller" r="3" cx="45" cy="45"/></svg>
  {[['Apply',ClipboardCheck],['Team assessment',UserCheck],['Shop if approved',ShoppingBag]].map(([label,Icon],i)=><div className="assessment-stop" key={label}><span className="assessment-node"><Icon size={19} strokeWidth={1.4}/></span><span>{label}</span></div>)}
 </div>
}
