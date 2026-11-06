// Where an application starts: sign in, then the assessment form. Applications stay closed until the owner has set the consent wording.
import { useEffect, useState } from 'react';
import { ArrowLeft, Lock } from 'lucide-react';
import { Link, navigate } from '../router';
import { CustomerError, loadApplication, loadOptions, signOutCustomer } from '../services/customer';
import { useCatalogue } from '../state';
import ApplicationForm from './ApplicationForm';
import { ConfirmLinkEmail, SignIn, useCustomer } from './SignIn';

const SECTIONS = [
  ['Identity', 'Your name as on your Ghana Card, date of birth and card number.'],
  ['Contact', 'Your mobile number and the mobile money number you would pay from.'],
  ['Where you live', 'GhanaPostGPS digital address, area and nearest landmark, and how long you have lived there.'],
  ['Work and income', 'Your employer or business and monthly income.'],
  ['Existing commitments', 'Other loans or hire purchase you are paying, and how much each month.'],
  ['Guarantor', 'Someone who can vouch for you. They should know you are naming them.'],
  ['Documents', 'Photos of both sides of your Ghana Card, a selfie, and a payslip or statement.'],
  ['Review and consent', 'Check your answers and agree to the assessment and privacy terms.'],
];

function Outline() {
  return (
    <aside className="apply-outline" aria-label="What the application asks">
      <h2>What the application asks</h2>
      <ol>
        {SECTIONS.map(([title, text]) => <li key={title}><strong>{title}</strong><span>{text}</span></li>)}
      </ol>
      <p className="muted small">After you submit, your account shows <strong>Under review</strong>. We may ask for more information.</p>
    </aside>
  );
}

export default function Apply({ search }) {
  const { products } = useCatalogue();
  const productSlug = new URLSearchParams(search).get('product');
  const interested = products.find(p => p.slug === productSlug);
  const customer = useCustomer();
  const [options, setOptions] = useState(null);
  const [application, setApplication] = useState(undefined);
  const [failure, setFailure] = useState(null);
  const uid = customer.user?.uid;

  useEffect(() => { loadOptions().then(setOptions, () => setFailure('We could not reach the server. Please try again shortly.')); }, []);

  useEffect(() => {
    if (!uid) { setApplication(undefined); return undefined; }
    let current = true;
    setFailure(null);
    loadApplication().then(data => { if (current) setApplication(data); }, error => { if (current) setFailure(error instanceof CustomerError ? error.message : 'We could not reach the server. Please try again shortly.'); });
    return () => { current = false; };
  }, [uid]);

  // Anything past the form belongs on the account page.
  useEffect(() => {
    if (application && !['draft', 'needs_information'].includes(application.status)) navigate('/hire-purchase/account', { replace: true });
  }, [application]);

  const intro = (
    <>
      <nav className="breadcrumb" aria-label="Breadcrumb"><Link to="/hire-purchase"><ArrowLeft size={14} /> Hire purchase</Link></nav>
      <p className="eyebrow">APPLY FOR HIRE PURCHASE</p>
    </>
  );

  if (customer.user && options?.open && application !== undefined) {
    return (
      <main className="apply section">
        {intro}
        <div className="hp-form-head">
          <h1 className="page-title">Your application</h1>
          <p className="muted small">Signed in as {customer.user.email}. <button type="button" className="link-button" onClick={signOutCustomer}>Sign out</button></p>
        </div>
        <ApplicationForm application={application} options={options} productSlug={productSlug} email={customer.user.email} onChange={setApplication} />
      </main>
    );
  }

  const closed = options && !options.open;
  return (
    <main className="apply section">
      {intro}
      <div className="apply-grid">
        <div>
          <h1 className="page-title">{closed ? 'Applications open soon.' : 'Create your account to apply.'}</h1>
          <p className="muted">One application covers you, not a single product. Once approved, you can buy any eligible product within your approved amount.{interested && <> You were looking at the <strong>{interested.name}</strong>.</>}</p>
          {failure && <p className="co-error" role="alert">{failure}</p>}
          {closed && (
            <div className="status-card" role="status">
              <Lock size={20} />
              <div>
                <strong>Applications open soon</strong>
                <p>The application is being finalised. Nothing on this page collects your information yet. Already approved? <Link className="inline-link" to="/hire-purchase/account">Sign in to your account</Link>.</p>
              </div>
            </div>
          )}
          {options?.open && (!customer.ready || (customer.user && application === undefined && !failure)) && !customer.linkPending && <p className="muted">Loading…</p>}
          {options?.open && customer.linkPending && !customer.user && <ConfirmLinkEmail onConfirm={customer.finishLink} error={customer.linkError} />}
          {options?.open && customer.ready && !customer.user && !customer.linkPending && <SignIn returnPath="/hire-purchase/apply" notice={customer.linkError} />}
        </div>
        <Outline />
      </div>
    </main>
  );
}
