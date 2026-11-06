// Photos of the Ghana Card, a selfie, and income evidence. They go straight to private storage, and each replaces the last.
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, FileText, Upload } from 'lucide-react';
import { ASSESSMENT_DOCUMENTS } from '../../shared/assessment.js';
import { CustomerError, loadDocument, removeDocument, uploadDocument } from '../services/customer';

function Preview({ type, stored }) {
  const [url, setUrl] = useState(null);
  const isPdf = stored.contentType === 'application/pdf';
  useEffect(() => {
    if (isPdf) return undefined;
    let current = true;
    let objectUrl = null;
    loadDocument(type).then(blob => {
      if (!current) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }, () => {});
    return () => { current = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [type, stored.uploadedAt, isPdf]);
  if (isPdf) return <span className="doc-thumb"><FileText size={24} /></span>;
  return <span className="doc-thumb">{url && <img src={url} alt="" />}</span>;
}

function DocumentCard({ document, stored, error, onChange }) {
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState(null);

  async function pick(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBusy(true);
    setFailure(null);
    try {
      onChange(await uploadDocument(document.id, file));
    } catch (problem) {
      if (!(problem instanceof CustomerError)) setFailure('The upload did not finish. Check your connection and try again.');
      else if (problem.status === 413) setFailure('That file is too big. Use one under 8 MB.');
      else setFailure(problem.fieldErrors.file ?? problem.message);
    }
    setBusy(false);
  }

  async function remove() {
    setBusy(true);
    setFailure(null);
    try {
      onChange(await removeDocument(document.id));
    } catch (problem) {
      setFailure(problem instanceof CustomerError ? problem.message : 'We could not reach the server. Please try again.');
    }
    setBusy(false);
  }

  return (
    <div className={`doc-card ${stored ? 'done' : ''}`}>
      {stored ? <Preview type={document.id} stored={stored} /> : <span className="doc-thumb empty"><Upload size={20} /></span>}
      <div className="doc-body">
        <strong>{document.label}{document.optional && <em className="muted"> optional</em>}{stored && <Check size={14} />}</strong>
        {document.hint && <small className="muted">{document.hint}</small>}
        <div className="doc-actions">
          <input
            ref={input}
            hidden
            type="file"
            aria-label={document.label}
            accept={`image/jpeg,image/png,image/webp${document.pdf ? ',application/pdf' : ''}`}
            capture={document.capture}
            onChange={pick}
          />
          <button type="button" className="button outline compact" disabled={busy} onClick={() => input.current.click()}>{busy ? 'Working…' : stored ? 'Replace' : document.capture ? 'Take a selfie' : document.pdf ? 'Add a photo or file' : 'Add a photo'}</button>
          {stored && !busy && <button type="button" className="link-button" onClick={remove}>Remove</button>}
        </div>
        {(failure || error) && <small className="co-error" role="alert">{failure ?? error}</small>}
      </div>
    </div>
  );
}

export default function DocumentsStep({ application, errors, formError, onChange, onBack, onNext }) {
  return (
    <div className="co-section">
      <h2>Your documents</h2>
      <p className="muted small hp-intro">Only the assessment team can open these, and each time they do it is recorded.</p>
      <div className="doc-list">
        {ASSESSMENT_DOCUMENTS.map(document => (
          <DocumentCard key={document.id} document={document} stored={application?.documents?.[document.id]} error={errors[document.id]} onChange={onChange} />
        ))}
      </div>
      {formError && <p className="co-error" role="alert">{formError}</p>}
      <div className="hp-form-actions">
        <button type="button" className="button outline" onClick={onBack}><ArrowLeft size={16} /> Back</button>
        <button type="button" className="button dark" onClick={onNext}>Continue <ArrowRight size={16} /></button>
      </div>
    </div>
  );
}
