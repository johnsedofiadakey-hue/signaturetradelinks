// The customer's own hire-purchase page. Everyone sees their application's status; only a current approval opens the account.
import { useEffect, useState } from 'react';
import { ArrowUpRight, BadgeCheck, Clock, FileText, Info } from 'lucide-react';
import { Link } from '../router';
import { formatPrice } from '../services/catalogue';
import { CustomerError, loadAgreements, loadApplication, loadBuying, restartApplication, signOutCustomer, withdrawApplication } from '../services/customer';
import { useCatalogue } from '../state';
import { ProductCard } from '../retail/RetailHome';
import { ConfirmLinkEmail, SignIn, useCustomer } from './SignIn';

const AGREEMENT_LABELS = { awaiting_deposit: 'Deposit due', active: 'Active', completed: 'Paid in full', cancelled: 'Ended' };
const dateText = text => new Intl.DateTimeFormat('en-GB', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${text}T00:00:00Z`));

function StatusCard({ icon: Icon, title, children }) {
  return (
    <div className="status-card" role="status">
      <Icon size={20} />
      <div><strong>{title}</strong>{children}</div>
    </div>
  );
}

function Approved({ account }) {
  const { products } = useCatalogue();
  const eligible = products.filter(product => product.hirePurchase);
  const [buying, setBuying] = useState(null);
  const [agreements, setAgreements] = useState([]);
  useEffect(() => {
    if (!account.active) return;
    loadBuying().then(setBuying, () => {});
    loadAgreements().then(setAgreements, () => {});
  }, [account.active]);
  const money = amountMinor => formatPrice({ amountMinor, currency: account.currency });
  if (!account.active) {
    return (
      <StatusCard icon={Clock} title="Your approval has ended">
        <p>It lasted until {dateText(account.validUntil)}. Please contact us to have your application looked at again.</p>
      </StatusCard>
    );
  }
  return (
    <>
      <div className="hp-approved">
        <BadgeCheck size={26} />
        <div>
          <p className="eyebrow">YOU’RE APPROVED</p>
          <strong className="hp-approved-amount">{formatPrice({ amountMinor: account.limitMinor, currency: account.currency })}</strong>
          <p className="muted small">Your approved amount, until {dateText(account.validUntil)}.{buying && <> <strong>{money(buying.availableMinor)}</strong> available now.</>}</p>
          {account.conditions && <p className="small">Conditions: {account.conditions}</p>}
        </div>
      </div>
      {agreements.length > 0 && (
        <section>
          <h2 className="hp-account-heading">Your agreements</h2>
          <ul className="hp-agreement-list">
            {agreements.map(agreement => (
              <li key={agreement.id}>
                <Link to={`/hire-purchase/agreements/${agreement.id}`}>
                  <span><strong>{agreement.product.title}</strong><small className="muted">{agreement.id}</small></span>
                  <span>{AGREEMENT_LABELS[agreement.status]}{agreement.status === 'active' && <small className="muted">{money(agreement.outstandingMinor)} left</small>}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {buying && !buying.open && (
        <StatusCard icon={Info} title="Buying through your account opens soon">
          <p>Deposits, instalment plans and agreements are being finalised. We’ll let you know when you can buy. Nothing is charged until you accept an agreement.</p>
        </StatusCard>
      )}
      {eligible.length > 0 && (
        <section>
          <h2 className="hp-account-heading">Products you can choose from</h2>
          <div className="product-grid">{eligible.map(product => <ProductCard key={product.id} product={product} to={buying?.open ? `/hire-purchase/buy/${product.slug}` : `/hire-purchase/p/${product.slug}`} />)}</div>
        </section>
      )}
    </>
  );
}

function Status({ application, onChange, setError }) {
  const [busy, setBusy] = useState(false);
  const act = fn => async () => {
    setBusy(true);
    setError(null);
    try {
      onChange(await fn(application.version));
    } catch (error) {
      setError(error instanceof CustomerError ? error.message : 'We could not reach the server. Please try again.');
    }
    setBusy(false);
  };
  const withdraw = () => { if (window.confirm('Withdraw your application? You can start it again later.')) act(withdrawApplication)(); };
  switch (application.status) {
    case 'draft':
      return (
        <StatusCard icon={FileText} title="You haven’t finished yet">
          <p>Your answers are saved, and nobody at Signature Tradelink can see them until you submit.</p>
          <Link className="button dark compact hp-status-action" to="/hire-purchase/apply">Continue your application <ArrowUpRight size={16} /></Link>
        </StatusCard>
      );
    case 'submitted':
    case 'under_review':
      return (
        <StatusCard icon={Clock} title="Under review">
          <p>Our team is reviewing your application. We’ll contact you if we need anything else.</p>
          <button type="button" className="link-button" disabled={busy} onClick={withdraw}>Withdraw application</button>
        </StatusCard>
      );
    case 'needs_information':
      return (
        <StatusCard icon={Info} title="We need something from you">
          <p>{application.informationRequest}</p>
          <Link className="button dark compact hp-status-action" to="/hire-purchase/apply">Update your application <ArrowUpRight size={16} /></Link>
        </StatusCard>
      );
    case 'declined':
      return (
        <StatusCard icon={Info} title="We can’t offer hire purchase on this application">
          <p>Thank you for applying. You can still buy any product outright in the shop, and you’re welcome to contact us with any questions.</p>
          <Link className="button dark compact hp-status-action" to="/shop">Go to the shop <ArrowUpRight size={16} /></Link>
        </StatusCard>
      );
    case 'withdrawn':
      return (
        <StatusCard icon={Info} title="You withdrew this application">
          <p>Your answers are saved if you’d like to pick it back up.</p>
          <button type="button" className="button dark compact hp-status-action" disabled={busy} onClick={act(restartApplication)}>Start again</button>
        </StatusCard>
      );
    default:
      return null;
  }
}

export default function AccountPage() {
  const customer = useCustomer();
  const [application, setApplication] = useState(undefined);
  const [error, setError] = useState(null);
  const uid = customer.user?.uid;

  useEffect(() => {
    if (!uid) { setApplication(undefined); return undefined; }
    let current = true;
    loadApplication().then(data => { if (current) setApplication(data); }, failure => { if (current) setError(failure instanceof CustomerError ? failure.message : 'We could not reach the server. Please try again shortly.'); });
    return () => { current = false; };
  }, [uid]);

  if (customer.ready && !customer.user) {
    return (
      <main className="apply section narrow-page">
        <p className="eyebrow">HIRE PURCHASE ACCOUNT</p>
        <h1 className="page-title">Sign in to your account.</h1>
        <p className="muted">See your application or, once approved, your hire purchase account.</p>
        {customer.linkPending
          ? <ConfirmLinkEmail onConfirm={customer.finishLink} error={customer.linkError} />
          : <SignIn returnPath="/hire-purchase/account" notice={customer.linkError} />}
        <p className="muted small">New here? <Link className="inline-link" to="/hire-purchase/apply">Apply for hire purchase</Link>.</p>
      </main>
    );
  }

  return (
    <main className="apply section">
      <p className="eyebrow">HIRE PURCHASE ACCOUNT</p>
      <div className="hp-form-head">
        <h1 className="page-title">Your account</h1>
        {customer.user && <p className="muted small">Signed in as {customer.user.email}. <button type="button" className="link-button" onClick={signOutCustomer}>Sign out</button></p>}
      </div>
      {error && <p className="co-error" role="alert">{error}</p>}
      {(!customer.ready || (application === undefined && !error)) && <p className="muted">Loading…</p>}
      {application === null && (
        <StatusCard icon={FileText} title="You haven’t applied yet">
          <p>Only customers our team has approved can buy on hire purchase. It starts with a short application.</p>
          <Link className="button dark compact hp-status-action" to="/hire-purchase/apply">Apply for hire purchase <ArrowUpRight size={16} /></Link>
        </StatusCard>
      )}
      {application?.status === 'approved' && <Approved account={application.account} />}
      {application && application.status !== 'approved' && <Status application={application} onChange={setApplication} setError={setError} />}
    </main>
  );
}
