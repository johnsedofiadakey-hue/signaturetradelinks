// Where an application starts. Customer accounts (Google or an emailed sign-in link) and the assessment form
// are the next milestone; until then this page shows exactly what the application will ask and collects nothing.
import { ArrowLeft, Lock, Mail } from 'lucide-react';
import { Link } from '../router';
import { useCatalogue } from '../state';

const SECTIONS = [
  ['Identity', 'Ghana Card number, photos of the card, and a selfie to confirm it is you.'],
  ['Contact', 'Your email and mobile number, plus your mobile money number if different.'],
  ['Where you live', 'GhanaPostGPS digital address, area and nearest landmark, and how long you have lived there.'],
  ['Work and income', 'Your employer or business, monthly income, and payslips or statements.'],
  ['Existing commitments', 'Other loans or hire purchase you are paying, and how much each month.'],
  ['Guarantor', 'Someone who can vouch for you, if our team asks for one.'],
  ['Review and consent', 'Check your answers and agree to the assessment and privacy terms.'],
];

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

export default function Apply({ search }) {
  const { products } = useCatalogue();
  const interested = products.find(p => p.slug === new URLSearchParams(search).get('product'));
  return (
    <main className="apply section">
      <nav className="breadcrumb" aria-label="Breadcrumb"><Link to="/hire-purchase"><ArrowLeft size={14} /> Hire purchase</Link></nav>
      <div className="apply-grid">
        <div>
          <p className="eyebrow">APPLY FOR HIRE PURCHASE</p>
          <h1 className="page-title">Create your account to apply.</h1>
          <p className="muted">One application covers you, not a single product. Once approved, you can buy any eligible product within your approved amount.{interested && <> You were looking at the <strong>{interested.name}</strong>.</>}</p>

          <div className="status-card" role="status">
            <Lock size={20} />
            <div>
              <strong>Applications open soon</strong>
              <p>Sign-in and the application form are being set up. Nothing on this page collects your information yet.</p>
            </div>
          </div>

          <div className="signin-options">
            <button className="signin-button" disabled><GoogleMark /> Continue with Google</button>
            <button className="signin-button" disabled><Mail size={18} /> Email me a sign-in link</button>
          </div>
          <p className="muted small">No password to remember. Only you and the assessment team can see your application.</p>
        </div>

        <aside className="apply-outline" aria-label="What the application asks">
          <h2>What the application asks</h2>
          <ol>
            {SECTIONS.map(([title, text]) => <li key={title}><strong>{title}</strong><span>{text}</span></li>)}
          </ol>
          <p className="muted small">After you submit, your account shows <strong>Under review</strong>. We may ask for more information. You’ll get an email when there’s a decision.</p>
        </aside>
      </div>
    </main>
  );
}
