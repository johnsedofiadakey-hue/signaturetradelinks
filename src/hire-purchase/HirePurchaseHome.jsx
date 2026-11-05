// The hire-purchase store's front door: who it is for, how approval works, what to have ready, eligible products.
// No instalment figures appear anywhere until a customer is approved and an agreement is prepared for them.
import { ArrowUpRight, BadgeCheck, ClipboardCheck, CreditCard, FileText, IdCard, MapPin, Plus, UserCheck, Users, Wallet } from 'lucide-react';
import { OfflineNote, useReveal } from '../components/shared';
import { Link } from '../router';
import { useCatalogue } from '../state';
import { ProductCard } from '../retail/RetailHome';

const STAGES = [
  { icon: ClipboardCheck, title: 'Apply', text: 'Create your account with Google or your email, then complete a short assessment. It saves as you go.' },
  { icon: UserCheck, title: 'Get approved', text: 'A member of our team reviews your application and sets the amount you are approved for. We email you a link to sign in.' },
  { icon: Wallet, title: 'Buy through your account', text: 'Choose eligible products within your approved amount, review the full agreement, then pay your deposit.' },
];

const NEEDS = [
  { icon: IdCard, title: 'Ghana Card', text: 'Photos of the front and back, and a quick selfie to confirm it is you.' },
  { icon: MapPin, title: 'Digital address', text: 'Your GhanaPostGPS address and a nearby landmark.' },
  { icon: FileText, title: 'Proof of income', text: 'Your last 3 payslips, or 6 months of bank or mobile money statements if you are self-employed.' },
  { icon: Users, title: 'A guarantor', text: 'If we ask for one: their name, phone number and Ghana Card number.' },
];

const FAQ = [
  ['Is approval automatic?', 'No. A person on our team reviews every application. We may ask you for more information before deciding.'],
  ['Will I see my repayments before I commit?', 'Yes. Once approved, each purchase comes with a full agreement: the cash price, the total hire-purchase price, your deposit and every instalment with its due date. Nothing is final until you accept it.'],
  ['How long does a decision take?', 'Review times will be confirmed when applications open. You can check your status in your account at any time.'],
  ['What happens to my documents?', 'They are stored privately, seen only by the staff assessing your application, and kept only as long as our privacy policy allows.'],
  ['Can I just buy outright instead?', 'Of course. Everything in the shop can be bought outright by anyone, no account needed.'],
];

export default function HirePurchaseHome() {
  const { status, products } = useCatalogue();
  const eligible = products.filter(p => p.hirePurchase);
  useReveal([status]);

  return (
    <main className="hp">
      <section className="hp-hero">
        <div className="hp-hero-copy">
          <p className="eyebrow">HIRE PURCHASE</p>
          <h1>Own it now.<br /><span>Pay over time.</span></h1>
          <p className="lede">For customers approved by our team. Apply once, get approved, then buy eligible products through your own account.</p>
          <div className="row-actions">
            <Link className="button dark" to="/hire-purchase/apply">Start your application <ArrowUpRight size={18} /></Link>
            <Link className="button outline" to="/hire-purchase#eligible">See eligible products</Link>
          </div>
          <p className="fine">Subject to assessment and approval. Terms are shown in full before you accept anything.</p>
        </div>
        <ol className="hp-stage-list" id="how-it-works">
          {STAGES.map(({ icon: Icon, title, text }, index) => (
            <li key={title} data-reveal>
              <span className="stage-index">{String(index + 1).padStart(2, '0')}</span>
              <Icon size={22} strokeWidth={1.6} />
              <div><h2>{title}</h2><p>{text}</p></div>
            </li>
          ))}
        </ol>
      </section>

      <section className="section hp-needs" id="what-you-need">
        <div className="section-top" data-reveal>
          <div><p className="eyebrow">WHAT YOU WILL NEED</p><h2>Have these ready.</h2></div>
          <span className="muted small">The same checks used across Ghana for credit, kept private.</span>
        </div>
        <div className="needs-grid">
          {NEEDS.map(({ icon: Icon, title, text }) => (
            <div className="need" key={title} data-reveal><Icon size={24} strokeWidth={1.5} /><h3>{title}</h3><p>{text}</p></div>
          ))}
        </div>
      </section>

      <section className="section" id="eligible">
        <div className="section-top" data-reveal>
          <div><p className="eyebrow">ELIGIBLE PRODUCTS</p><h2>Available on hire purchase.</h2></div>
          <span className="muted small">Approved customers buy these through their account.</span>
        </div>
        <OfflineNote />
        <div className="product-grid">
          {eligible.map(p => <ProductCard key={p.id} product={p} to={`/hire-purchase/p/${p.slug}`} />)}
        </div>
        {status === 'ready' && eligible.length === 0 && <p className="muted">No products are available on hire purchase yet.</p>}
      </section>

      <section className="hp-trust section" data-reveal>
        <div className="trust-item"><BadgeCheck size={22} /><p><strong>Real people decide.</strong><span>Every application is reviewed by our team.</span></p></div>
        <div className="trust-item"><CreditCard size={22} /><p><strong>No surprises.</strong><span>Deposit and every instalment are shown before you accept.</span></p></div>
        <div className="trust-item"><FileText size={22} /><p><strong>Your data, protected.</strong><span>Documents are private and seen only by assessors.</span></p></div>
      </section>

      <section className="faq-section section" data-reveal>
        <div><p className="eyebrow">A FEW THINGS TO KNOW</p><h2>Hire purchase,<br />explained.</h2></div>
        <div className="faq-list">{FAQ.map(([q, a]) => <details key={q}><summary>{q}<Plus size={17} /></summary><p>{a}</p></details>)}</div>
      </section>
    </main>
  );
}
