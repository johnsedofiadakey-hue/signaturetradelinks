import { useState } from 'react';
import { ArrowUpRight, Plus } from 'lucide-react';
import { Link } from '../router';
import { useCatalogue } from '../state';
import { formatPrice } from '../services/catalogue';
import { ProductImage } from './shared';

const edits = {
  tv: { category: 'tv-and-entertainment', label: 'Televisions', action: 'Explore televisions' },
  audio: { category: 'audio', label: 'Home audio', action: 'Explore home audio' },
};
export default function ShoppableRoom() {
  const [selected, setSelected] = useState('tv');
  const { products } = useCatalogue();
  const edit = edits[selected];
  const matches = products.filter(product => product.categorySlug === edit.category).slice(0, 2);
  return <section className="lifestyle-feature shoppable-room" aria-labelledby="lifestyle-title" data-reveal>
    <div className="lifestyle-media"><img src="/editorial/living-room-v1.webp" alt="Bright living room with a television, soundbar and subwoofer" loading="lazy" decoding="async"/>
      {Object.entries(edits).map(([key, item]) => <button key={key} className={`room-pin room-pin-${key} ${selected === key ? 'selected' : ''}`} aria-label={`Explore ${item.label.toLowerCase()} in this room`} aria-pressed={selected === key} aria-controls="room-selection" onClick={() => setSelected(key)}><Plus size={18}/><span>{item.label}</span></button>)}
    </div>
    <div className="lifestyle-copy"><span className="editorial-number">01 / SHOP THE ROOM</span><h2 id="lifestyle-title">Make a<br/>night of it.</h2><p>Tap a marker. Find your own setup.</p>
      <div className="room-tabs" role="group" aria-label="Explore room categories">{Object.entries(edits).map(([key, item]) => <button key={key} aria-pressed={selected === key} onClick={() => setSelected(key)}>{item.label}</button>)}</div>
      <div id="room-selection" className="room-selection" aria-live="polite" aria-atomic="true"><h3>{edit.label}</h3>{matches.length ? matches.map(product => <Link key={product.id} className="room-product" to={`/p/${product.slug}`}><span><ProductImage product={product}/></span><span><strong>{product.name}</strong><small>{formatPrice(product.price)}</small></span><ArrowUpRight size={16}/></Link>) : <p>Products will appear here when the catalogue is ready.</p>}</div>
      <div className="lifestyle-links"><Link to={`/shop/${edit.category}`}>{edit.action} <ArrowUpRight size={17}/></Link></div>
    </div>
  </section>;
}
