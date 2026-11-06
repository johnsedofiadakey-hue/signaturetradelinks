// The assessment form, one section at a time. Each section is saved on the server when you continue, so you can stop and come back on any device.
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, ShieldCheck } from 'lucide-react';
import { ASSESSMENT_DOCUMENTS, ASSESSMENT_SECTIONS, fieldApplies } from '../../shared/assessment.js';
import { navigate } from '../router';
import { formatPrice } from '../services/catalogue';
import { CustomerError, saveSection, submitApplication } from '../services/customer';
import DocumentsStep from './DocumentsStep';

const toDraft = (field, value) => {
  if (value === null || value === undefined) return '';
  return field.type === 'money' ? (value / 100).toFixed(2) : String(value);
};

function toValue(field, draft) {
  const text = draft.trim();
  if (!text) return null;
  if (field.type === 'money') {
    const amount = Number(text.replaceAll(',', ''));
    return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) : text;
  }
  return field.type === 'dayOfMonth' ? Number(text) : text;
}

const draftsFrom = sections => Object.fromEntries(ASSESSMENT_SECTIONS.map(section => [
  section.id,
  Object.fromEntries(section.fields.map(field => [field.key, toDraft(field, sections?.[section.id]?.[field.key])])),
]));

const DOCUMENTS_STEP = ASSESSMENT_SECTIONS.length;
const REVIEW_STEP = DOCUMENTS_STEP + 1;
const documentsMissing = application => ASSESSMENT_DOCUMENTS.some(document => !document.optional && !application?.documents?.[document.id]);

const INPUT_TYPES = { date: 'date', month: 'month', phone: 'tel', dayOfMonth: 'number' };

function Answer({ field, value, error, currency, onChange }) {
  const label = field.type === 'money' ? `${field.label} (${currency})` : field.label;
  return (
    <label className={`co-field ${field.wide ? 'wide' : ''}`}>
      <span>{label}{field.optional && <em className="muted"> optional</em>}</span>
      {field.type === 'select' ? (
        <select value={value} onChange={event => onChange(event.target.value)}>
          <option value="">Choose</option>
          {field.options.map(choice => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
        </select>
      ) : (
        <input
          type={INPUT_TYPES[field.type] ?? 'text'}
          inputMode={field.type === 'money' ? 'decimal' : undefined}
          placeholder={field.placeholder}
          autoComplete={field.autoComplete ?? 'off'}
          maxLength={field.type === 'date' || field.type === 'month' || field.type === 'dayOfMonth' ? undefined : field.max ?? 120}
          min={field.type === 'dayOfMonth' ? 1 : undefined}
          max={field.type === 'dayOfMonth' ? 31 : undefined}
          value={value}
          onChange={event => onChange(event.target.value)}
        />
      )}
      {field.hint && !error && <small className="muted">{field.hint}</small>}
      {error && <small className="co-error">{error}</small>}
    </label>
  );
}

function reviewText(field, draft, currency) {
  if (!draft) return '—';
  if (field.type === 'select') return field.options.find(choice => choice.value === draft)?.label ?? draft;
  return field.type === 'money' ? formatPrice({ amountMinor: Math.round(Number(draft.replaceAll(',', '')) * 100), currency }) : draft;
}

export default function ApplicationForm({ application, options, productSlug, email, onChange }) {
  const [drafts, setDrafts] = useState(() => draftsFrom(application?.sections));
  const firstGap = ASSESSMENT_SECTIONS.findIndex(section => !application?.sections?.[section.id]);
  const [step, setStep] = useState(firstGap !== -1 ? firstGap : documentsMissing(application) ? DOCUMENTS_STEP : REVIEW_STEP);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [agreed, setAgreed] = useState({ privacy: false, declaration: false });
  const version = application?.version ?? 0;
  const section = ASSESSMENT_SECTIONS[step];
  const reviewing = step === REVIEW_STEP;
  // On a phone the steps scroll sideways, so keep the current one in view.
  useEffect(() => {
    const list = document.querySelector('.hp-steps');
    const current = list?.querySelector('.current');
    if (current) list.scrollLeft += current.getBoundingClientRect().left - list.getBoundingClientRect().left;
  }, [step]);
  const saved = useMemo(() => new Set(Object.keys(application?.sections ?? {})), [application]);
  // The review shows what the server holds, so an answer typed but never saved can't look submitted.
  const savedAnswers = useMemo(() => draftsFrom(application?.sections), [application]);

  const goTo = next => {
    setErrors({});
    setFormError(null);
    setStep(next);
    window.scrollTo({ top: 0, behavior: 'instant' });
  };

  function explain(error) {
    if (!(error instanceof CustomerError)) { setFormError('We could not reach the server. Your last saved answers are safe. Try again.'); return; }
    setFormError(error.message);
    setErrors(error.fieldErrors);
  }

  async function saveAndContinue(event) {
    event.preventDefault();
    setBusy(true);
    setErrors({});
    setFormError(null);
    try {
      const values = Object.fromEntries(section.fields.map(field => [field.key, toValue(field, drafts[section.id][field.key])]));
      const updated = await saveSection({ section: section.id, values, expectedVersion: version, ...(productSlug ? { productSlug } : {}) });
      onChange(updated);
      setDrafts(current => ({ ...current, [section.id]: draftsFrom(updated.sections)[section.id] }));
      goTo(step + 1);
    } catch (error) {
      explain(error);
    }
    setBusy(false);
  }

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setErrors({});
    setFormError(null);
    try {
      onChange(await submitApplication({ expectedVersion: version, privacyVersion: options.privacyVersion, declarationVersion: options.declarationVersion }));
      navigate('/hire-purchase/account');
    } catch (error) {
      explain(error);
      // Take them to the first answer that needs attention.
      const first = Object.keys(error.fieldErrors ?? {})[0];
      if (first) {
        const [sectionId, key] = first.split('.');
        setStep(sectionId === 'documents' ? DOCUMENTS_STEP : ASSESSMENT_SECTIONS.findIndex(candidate => candidate.id === sectionId));
        setErrors({ [key]: error.fieldErrors[first] });
        setFormError(`${Object.keys(error.fieldErrors).length === 1 ? 'One answer needs' : 'Some answers need'} attention before you can submit.`);
      }
    }
    setBusy(false);
  }

  return (
    <div className="hp-form-grid">
      <ol className="hp-steps" aria-label="Application sections">
        {ASSESSMENT_SECTIONS.map((candidate, index) => (
          <li key={candidate.id} className={index === step ? 'current' : ''}>
            <button type="button" onClick={() => goTo(index)} aria-current={index === step ? 'step' : undefined}>
              <span className="step-number">{saved.has(candidate.id) && index !== step ? <Check size={13} /> : index + 1}</span>{candidate.title}
            </button>
          </li>
        ))}
        <li className={step === DOCUMENTS_STEP ? 'current' : ''}>
          <button type="button" onClick={() => goTo(DOCUMENTS_STEP)} aria-current={step === DOCUMENTS_STEP ? 'step' : undefined}>
            <span className="step-number">{!documentsMissing(application) && step !== DOCUMENTS_STEP ? <Check size={13} /> : DOCUMENTS_STEP + 1}</span>Documents
          </button>
        </li>
        <li className={reviewing ? 'current' : ''}>
          <button type="button" onClick={() => goTo(REVIEW_STEP)} aria-current={reviewing ? 'step' : undefined}>
            <span className="step-number">{REVIEW_STEP + 1}</span>Review and consent
          </button>
        </li>
      </ol>

      <div>
        {application?.status === 'needs_information' && (
          <div className="status-card" role="status"><ShieldCheck size={20} /><div><strong>Our team needs something from you</strong><p>{application.informationRequest}</p></div></div>
        )}
        {section && (
          <form className="co-section" onSubmit={saveAndContinue} key={section.id} noValidate>
            <h2>{section.title}</h2>
            <p className="muted small hp-intro">{section.intro}</p>
            {section.id === 'contact' && <p className="small hp-intro">Email: <strong>{email}</strong></p>}
            <div className="co-grid">
              {section.fields.filter(field => fieldApplies(field, drafts[section.id])).map(field => (
                <Answer
                  key={field.key}
                  field={field}
                  value={drafts[section.id][field.key]}
                  error={errors[field.key]}
                  currency={options.currency}
                  onChange={value => setDrafts(current => ({ ...current, [section.id]: { ...current[section.id], [field.key]: value } }))}
                />
              ))}
            </div>
            {formError && <p className="co-error" role="alert">{formError}</p>}
            <div className="hp-form-actions">
              {step > 0 ? <button type="button" className="button outline" onClick={() => goTo(step - 1)}><ArrowLeft size={16} /> Back</button> : <span />}
              <button className="button dark" disabled={busy}>{busy ? 'Saving…' : 'Save and continue'} <ArrowRight size={16} /></button>
            </div>
          </form>
        )}
        {step === DOCUMENTS_STEP && (
          <DocumentsStep application={application} errors={errors} formError={formError} onChange={onChange} onBack={() => goTo(step - 1)} onNext={() => goTo(REVIEW_STEP)} />
        )}
        {reviewing && (
          <form className="co-section" onSubmit={submit}>
            <h2>Review and consent</h2>
            {ASSESSMENT_SECTIONS.map((candidate, index) => (
              <section className="hp-review" key={candidate.id}>
                <div className="hp-review-head"><h3>{candidate.title}</h3><button type="button" className="link-button" onClick={() => goTo(index)}>Change</button></div>
                <dl>
                  {candidate.fields.filter(field => fieldApplies(field, savedAnswers[candidate.id])).map(field => (
                    <div key={field.key}><dt>{field.label}</dt><dd>{reviewText(field, savedAnswers[candidate.id][field.key], options.currency)}</dd></div>
                  ))}
                </dl>
              </section>
            ))}
            <section className="hp-review">
              <div className="hp-review-head"><h3>Documents</h3><button type="button" className="link-button" onClick={() => goTo(DOCUMENTS_STEP)}>Change</button></div>
              <dl>
                {ASSESSMENT_DOCUMENTS.filter(document => !document.optional || application?.documents?.[document.id]).map(document => (
                  <div key={document.id}><dt>{document.label}</dt><dd>{application?.documents?.[document.id] ? 'Added' : 'Missing'}</dd></div>
                ))}
              </dl>
            </section>
            <div className="hp-consent">
              <h3>Privacy notice</h3>
              <p>{options.privacyNotice}</p>
              <label><input type="checkbox" required checked={agreed.privacy} onChange={event => setAgreed({ ...agreed, privacy: event.target.checked })} /> I have read the privacy notice.</label>
              <h3>Declaration</h3>
              <p>{options.declaration}</p>
              <label><input type="checkbox" required checked={agreed.declaration} onChange={event => setAgreed({ ...agreed, declaration: event.target.checked })} /> I agree to this declaration.</label>
            </div>
            {formError && <p className="co-error" role="alert">{formError}</p>}
            <p className="muted small">After you submit, our team reviews your application and may ask you for more information.</p>
            <div className="hp-form-actions">
              <button type="button" className="button outline" onClick={() => goTo(step - 1)}><ArrowLeft size={16} /> Back</button>
              <button className="button dark" disabled={busy}>{busy ? 'Submitting…' : 'Submit application'} <ShieldCheck size={16} /></button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
