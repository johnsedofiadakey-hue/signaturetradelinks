// One hire purchase agreement: what was agreed, what's been paid and what's next. Status always comes from the server, which asks Paystack directly.
import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, CheckCircle2, Clock, Info, ShieldCheck } from 'lucide-react';
import { Link } from '../router';
import { formatPrice } from '../services/catalogue';
import { CustomerError, loadAgreement, startDeposit, startInstalment, verifyAgreement } from '../services/customer';
import { ConfirmLinkEmail, SignIn, useCustomer } from './SignIn';

const POLL_MS = 3000;
const POLL_TRIES = 6;
const dateText = text => new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${text.slice(0, 10)}T00:00:00Z`));

export default function AgreementPage({ id, search }) {
  const customer = useCustomer();
  const [agreement, setAgreement] = useState(null);
  const [failure, setFailure] = useState(null);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(() => /[?&](trxref|reference)=/.test(search));
  const [unconfirmed, setUnconfirmed] = useState(false);
  const uid = customer.user?.uid;

  const explain = error => setFailure(error instanceof CustomerError ? error.message : 'We could not reach the server. Please try again.');

  useEffect(() => {
    if (!uid) return;
    loadAgreement(id).then(setAgreement, explain);
  }, [uid, id]);

  // Back from Paystack. The webhook may land a moment later, so keep asking until the payment settles or we run out of tries.
  useEffect(() => {
    if (!uid || !checking) return undefined;
    let tries = 0;
    let timer;
    let stopped = false;
    const check = async () => {
      try {
        const latest = await verifyAgreement(id);
        if (stopped) return;
        setAgreement(latest);
        tries += 1;
        const waiting = latest.status === 'awaiting_deposit' || (latest.status === 'active' && latest.paymentPending);
        if (!waiting) { setChecking(false); return; }
        if (tries >= POLL_TRIES) { setChecking(false); setUnconfirmed(true); return; }
        timer = setTimeout(check, POLL_MS);
      } catch (error) {
        explain(error);
        setChecking(false);
      }
    };
    check();
    return () => { stopped = true; clearTimeout(timer); };
  }, [uid, id, checking]);

  const pay = useCallback(start => async () => {
    setBusy(true);
    setFailure(null);
    try {
      const { authorizationUrl } = await start(id);
      window.location.assign(authorizationUrl);
    } catch (error) {
      explain(error);
      setBusy(false);
      loadAgreement(id).then(setAgreement, () => {});
    }
  }, [id]);

  const back = <nav className="breadcrumb" aria-label="Breadcrumb"><Link to="/hire-purchase/account"><ArrowLeft size={14} /> Your account</Link></nav>;

  if (customer.ready && !customer.user) {
    return (
      <main className="apply section narrow-page">
        <h1 className="page-title">Sign in to see your agreement.</h1>
        {customer.linkPending ? <ConfirmLinkEmail onConfirm={customer.finishLink} error={customer.linkError} /> : <SignIn returnPath={`/hire-purchase/agreements/${id}`} notice={customer.linkError} />}
      </main>
    );
  }
  if (!agreement) return <main className="apply section">{back}{failure ? <p className="co-error" role="alert">{failure}</p> : <p className="muted">Loading…</p>}</main>;

  const money = amountMinor => formatPrice({ amountMinor, currency: agreement.currency });
  const { status, figures, instalments } = agreement;
  const next = instalments.find(item => item.number === agreement.nextInstalmentNumber);
  return (
    <main className="apply section">
      {back}
      <p className="eyebrow">AGREEMENT {agreement.id}</p>
      <h1 className="page-title">{agreement.product.title}</h1>
      {failure && <p className="co-error" role="alert">{failure}</p>}
      {checking && <div className="status-card" role="status"><Clock size={20} /><div><strong>Checking your payment…</strong><p>This usually takes a few seconds.</p></div></div>}
      {unconfirmed && <div className="status-card" role="status"><Info size={20} /><div><strong>We haven’t seen your payment yet</strong><p>If you did pay, it can take a few minutes to show here, so please check back before paying again.</p></div></div>}
      {!checking && status === 'awaiting_deposit' && (
        <div className="status-card" role="status">
          <Clock size={20} />
          <div>
            <strong>Pay your deposit to start this agreement</strong>
            <p>{money(figures.dueNowMinor)} is due now. We’re holding your product for a short time.</p>
            <button type="button" className="button dark compact hp-status-action" disabled={busy} onClick={pay(startDeposit)}>{busy ? 'Taking you to payment…' : `Pay ${money(figures.dueNowMinor)}`} <ShieldCheck size={16} /></button>
          </div>
        </div>
      )}
      {status === 'cancelled' && <div className="status-card" role="status"><Info size={20} /><div><strong>This agreement has ended</strong><p>{agreement.cancelReason === 'deposit_not_paid' ? 'The deposit wasn’t paid in time, so nothing is owed and the product went back on sale.' : 'Please contact us if you have any questions.'}</p></div></div>}
      {status === 'completed' && <div className="hp-approved"><CheckCircle2 size={26} /><div><p className="eyebrow">PAID IN FULL</p><p className="small">You’ve paid every instalment. Thank you.</p></div></div>}
      {status === 'active' && next && (
        <div className="hp-approved">
          <Clock size={26} />
          <div>
            <p className="eyebrow">{next.overdue ? 'OVERDUE' : 'NEXT PAYMENT'}</p>
            <strong className="hp-approved-amount">{money(next.amountMinor)}</strong>
            <p className="muted small">Instalment {next.number} of {instalments.length}, due {dateText(next.dueDate)}. {money(agreement.outstandingMinor)} left in total.</p>
            <button type="button" className="button dark compact hp-status-action" disabled={busy} onClick={pay(startInstalment)}>{busy ? 'Taking you to payment…' : `Pay ${money(next.amountMinor)}`} <ShieldCheck size={16} /></button>
          </div>
        </div>
      )}

      <div className="hp-agreement-grid">
        <section className="co-section">
          <h2>Instalments</h2>
          <table className="hp-schedule">
            <thead><tr><th>No.</th><th>Due</th><th>Amount</th><th>Status</th></tr></thead>
            <tbody>
              {instalments.map(item => (
                <tr key={item.number}>
                  <td>{item.number}</td>
                  <td>{item.dueDate ? dateText(item.dueDate) : 'After deposit'}</td>
                  <td>{money(item.amountMinor)}</td>
                  <td className={item.overdue ? 'co-error' : ''}>{item.status === 'paid' ? `Paid ${dateText(item.paidAt)}` : item.overdue ? 'Overdue' : 'To pay'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <aside className="order-summary">
          <h2>What you agreed</h2>
          <dl className="summary-totals">
            <div><dt>Plan</dt><dd>{agreement.plan.name}</dd></div>
            <div><dt>Cash price</dt><dd>{money(figures.cashPriceMinor)}</dd></div>
            <div><dt>Hire charge</dt><dd>{money(figures.chargeMinor)}</dd></div>
            <div><dt>Hire purchase price</dt><dd>{money(figures.hirePurchasePriceMinor)}</dd></div>
            <div><dt>Deposit</dt><dd>{money(figures.depositMinor)}</dd></div>
            {figures.deliveryFeeMinor > 0 && <div><dt>Delivery</dt><dd>{money(figures.deliveryFeeMinor)}</dd></div>}
            <div><dt>Accepted</dt><dd>{dateText(agreement.acceptedAt)}</dd></div>
          </dl>
          <details className="co-policy"><summary>Agreement wording</summary><p className="hp-terms-text">{agreement.terms.wording}</p></details>
        </aside>
      </div>
    </main>
  );
}
