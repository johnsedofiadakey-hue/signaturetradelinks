import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  LayoutGrid, Package, Boxes, ShoppingCart, Users, Settings, ScrollText, LogOut, Plus, ArrowLeft, Search, Check, X, AlertTriangle,
  Copy, Trash2, RefreshCw, ShieldCheck, ExternalLink, ClipboardCheck, FileText,
} from 'lucide-react';
import { ASSESSMENT_CHECKS, ASSESSMENT_DOCUMENTS, ASSESSMENT_SECTIONS, fieldApplies } from '../shared/assessment.js';
import { INVENTORY_REASONS, PRODUCT_ILLUSTRATIONS, STAFF_ROLES } from '../shared/contract.js';
import { ApiFailure, api, formatDate, formatMoney, setCsrfToken, toMajorText, toMinor } from './api.js';
import './admin.css';

const NAV = [
  { path: 'dashboard', label: 'Overview', icon: LayoutGrid, permission: 'dashboard:read' },
  { path: 'products', label: 'Catalogue', icon: Package, permission: 'catalogue:read' },
  { path: 'inventory', label: 'Inventory', icon: Boxes, permission: 'inventory:read' },
  { path: 'orders', label: 'Orders', icon: ShoppingCart, permission: 'orders:read' },
  { path: 'applications', label: 'Applications', icon: ClipboardCheck, permission: 'applications:read' },
  { path: 'agreements', label: 'Agreements', icon: FileText, permission: 'agreements:read' },
  { path: 'staff', label: 'Staff', icon: Users, permission: 'staff:manage' },
  { path: 'settings', label: 'Settings', icon: Settings, permission: 'settings:manage' },
  { path: 'audit', label: 'Audit log', icon: ScrollText, permission: 'audit:read' },
];

const ROLE_LABELS = {
  owner: 'Owner', catalogue_manager: 'Catalogue manager', assessor: 'Assessor', approver: 'Approver', finance: 'Finance', fulfilment: 'Fulfilment',
};
const REASON_LABELS = {
  stock_received: 'Stock received', count_correction: 'Count correction', damaged: 'Damaged', returned_to_supplier: 'Returned to supplier', other: 'Other', retail_sale: 'Retail sale',
};
const STATUS_ACTIONS = {
  draft: [['publish', 'Publish']],
  published: [['unpublish', 'Unpublish'], ['archive', 'Archive']],
  archived: [['restore', 'Restore to draft']],
};

const newKey = () => crypto.randomUUID();

function useHashRoute() {
  const read = () => window.location.hash.replace(/^#\/?/, '') || 'dashboard';
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const update = () => setRoute(read());
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  return route;
}

const go = path => { window.location.hash = `#/${path}`; };

/* ---------- shared UI ---------- */

function Field({ label, error, hint, children, className = '' }) {
  return (
    <label className={`field ${error ? 'has-error' : ''} ${className}`}>
      <span className="field-label">{label}</span>
      {children}
      {error ? <span className="field-error">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

function ErrorBanner({ error }) {
  if (!error) return null;
  return (
    <div className="banner error" role="alert">
      <AlertTriangle size={18} />
      <div>
        <strong>{error.message}</strong>
        {error.requestId && <span className="muted"> Reference {error.requestId}</span>}
      </div>
    </div>
  );
}

function StatusChip({ status }) {
  return <span className={`chip chip-${status}`}>{status.replace('_', ' ')}</span>;
}

function Toast({ message }) {
  if (!message) return null;
  return <div className="toast" role="status"><Check size={16} />{message}</div>;
}

/** Native <dialog> that collects a mandatory reason before a sensitive action. */
function ReasonDialog({ request, onClose }) {
  const ref = useRef(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (request) { setReason(''); setError(null); ref.current?.showModal(); } else ref.current?.close();
  }, [request]);
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await request.onConfirm(reason.trim());
      onClose();
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog ref={ref} className="dialog" onClose={onClose} aria-labelledby="reason-title">
      {request && (
        <form onSubmit={submit}>
          <h2 id="reason-title">{request.title}</h2>
          <p className="muted">{request.description}</p>
          <ErrorBanner error={error} />
          <Field label="Reason (kept in the audit log)" error={error?.fieldErrors?.reason}>
            <textarea required minLength={3} maxLength={500} rows={3} value={reason} onChange={e => setReason(e.target.value)} autoFocus />
          </Field>
          <div className="row end">
            <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
            <button className={`btn ${request.danger ? 'danger' : 'primary'}`} disabled={busy || reason.trim().length < 3}>{busy ? 'Saving…' : request.confirmLabel}</button>
          </div>
        </form>
      )}
    </dialog>
  );
}

/* ---------- auth screens ---------- */

function AuthLayout({ title, children }) {
  return (
    <main className="auth">
      <div className="auth-card">
        <div className="brand"><span className="brand-mark">s<span>.</span></span><span>SIGNATURE TRADE LINKS<small>Admin portal</small></span></div>
        <h1>{title}</h1>
        {children}
      </div>
      <p className="auth-foot"><ShieldCheck size={14} /> Staff access only. Accounts are created by invitation.</p>
    </main>
  );
}

function Login({ onSignedIn }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const data = await api('POST', '/admin/auth/login', { email, password });
      setCsrfToken(data.csrfToken);
      onSignedIn(data.staff);
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }
  return (
    <AuthLayout title="Sign in">
      <form onSubmit={submit} className="stack">
        <ErrorBanner error={error} />
        <Field label="Email"><input type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} autoFocus /></Field>
        <Field label="Password"><input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></Field>
        <button className="btn primary full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <a className="link small" href="#/accept-invite">Have an invitation? Set your password</a>
      </form>
    </AuthLayout>
  );
}

function AcceptInvite() {
  const params = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
  const [form, setForm] = useState({ email: params.get('email') ?? '', token: '', password: '' });
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('POST', '/admin/auth/accept-invite', form);
      setDone(true);
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }
  if (done) {
    return (
      <AuthLayout title="You're all set">
        <p className="muted">Your password is saved. Sign in to continue.</p>
        <a className="btn primary full" href="#/dashboard">Go to sign in</a>
      </AuthLayout>
    );
  }
  return (
    <AuthLayout title="Accept your invitation">
      <form onSubmit={submit} className="stack">
        <ErrorBanner error={error} />
        <Field label="Email" error={error?.fieldErrors?.email}><input type="email" required value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></Field>
        <Field label="Invitation code" hint="The owner shared this with you. It expires after 72 hours." error={error?.fieldErrors?.token}>
          <input required autoComplete="off" value={form.token} onChange={e => setForm({ ...form, token: e.target.value.trim() })} />
        </Field>
        <Field label="New password" hint="At least 12 characters." error={error?.fieldErrors?.password}>
          <input type="password" autoComplete="new-password" required minLength={12} value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} />
        </Field>
        <button className="btn primary full" disabled={busy}>{busy ? 'Saving…' : 'Set password'}</button>
        <a className="link small" href="#/dashboard">Back to sign in</a>
      </form>
    </AuthLayout>
  );
}

/* ---------- dashboard ---------- */

function Dashboard({ can }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => { api('GET', '/admin/dashboard').then(setData, setError); }, []);
  if (error) return <ErrorBanner error={error} />;
  if (!data) return <p className="muted">Loading…</p>;
  const tiles = [
    ['Published products', data.products.published, 'products'],
    ['Draft products', data.products.draft, 'products'],
    ['Active SKUs', data.variants.active, 'inventory'],
    ['Unpriced SKUs', data.variants.unpriced, 'products'],
    ['SKUs with no stock', data.variants.outOfStock, 'inventory'],
  ];
  return (
    <>
      <header className="page-head"><div><p className="eyebrow">Overview</p><h1>Store at a glance</h1></div><span className="muted small">Live counts · {formatDate(data.generatedAt)}</span></header>
      <section className="tiles">
        {tiles.map(([label, value, path]) => (
          <a key={label} className="tile" href={`#/${path}`}><span>{label}</span><strong>{value}</strong></a>
        ))}
      </section>
      {data.settingsMissing.length > 0 && (
        <div className="banner warn">
          <AlertTriangle size={18} />
          <div>
            <strong>Owner settings needed before prices and checkout can go live.</strong>
            <span> Missing: {data.settingsMissing.join(', ')}. {can('settings:manage') && <a className="link" href="#/settings">Open settings</a>}</span>
          </div>
        </div>
      )}
      {data.unavailable?.length > 0 && <section className="panel">
        <h2>Not yet available</h2>
        <p className="muted">These modules need owner decisions (hire-purchase plans, agreements and legal review) before they can be built and switched on. The API answers them with a clear "not configured" response rather than pretending to work.</p>
        <ul className="pill-list">{data.unavailable.map(item => <li key={item}>{item.replaceAll('_', ' ')}</li>)}</ul>
      </section>}
    </>
  );
}

/* ---------- catalogue ---------- */

function ProductList({ categories }) {
  const [status, setStatus] = useState('');
  const [store, setStore] = useState('');
  const [q, setQ] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const load = useCallback(async cursor => {
    const params = new URLSearchParams({ ...(status && { status }), ...(store && { store }), ...(q.trim() && { q: q.trim() }), ...(cursor && { cursor }) });
    try {
      const data = await api('GET', `/admin/products?${params}`);
      setResult(prev => (cursor ? { items: [...prev.items, ...data.items], nextCursor: data.nextCursor } : data));
      setError(null);
    } catch (failure) {
      setError(failure);
    }
  }, [status, store, q]);
  useEffect(() => { const t = setTimeout(() => load(), 200); return () => clearTimeout(t); }, [load]);
  const categoryLabel = id => categories.find(c => c.id === id)?.label ?? '—';
  return (
    <>
      <header className="page-head">
        <div><p className="eyebrow">Catalogue</p><h1>Products</h1></div>
        <a className="btn primary" href="#/products/new"><Plus size={16} /> New product</a>
      </header>
      <div className="toolbar">
        <label className="search"><Search size={16} /><input aria-label="Search products" placeholder="Search title or web address" value={q} onChange={e => setQ(e.target.value)} /></label>
        <select aria-label="Filter by status" value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">All statuses</option><option value="draft">Draft</option><option value="published">Published</option><option value="archived">Archived</option>
        </select>
        <select aria-label="Filter by store" value={store} onChange={e => setStore(e.target.value)}>
          <option value="">All stores</option><option value="hire_purchase">Hire purchase store</option>
        </select>
      </div>
      <ErrorBanner error={error} />
      {result && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Product</th><th>Category</th><th>Status</th><th>Stores</th><th>SKUs</th><th>Updated</th></tr></thead>
            <tbody>
              {result.items.map(p => (
                <tr key={p.id} onClick={() => go(`products/${p.id}`)} className="clickable">
                  <td>
                    <a href={`#/products/${p.id}`} onClick={e => e.stopPropagation()}><strong>{p.title}</strong></a>
                    <span className="sub">/{p.slug}{p.illustrative && <span className="tag">illustrative</span>}</span>
                  </td>
                  <td>{categoryLabel(p.categoryId)}</td>
                  <td><StatusChip status={p.publishStatus} /></td>
                  <td>{p.hirePurchaseEnabled ? <span className="tag hp">Retail + HP</span> : <span className="muted">Retail</span>}</td>
                  <td>{p.variants.length}</td>
                  <td className="muted">{formatDate(p.updatedAt)}</td>
                </tr>
              ))}
              {result.items.length === 0 && <tr><td colSpan={6} className="empty-cell">No products match.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {result?.nextCursor && <button className="btn ghost" onClick={() => load(result.nextCursor)}>Load more</button>}
    </>
  );
}

const emptyProduct = categoryId => ({
  slug: '', title: '', tagline: '', categoryId: categoryId ?? '', brand: '', description: '', images: [], illustration: null, specifications: [],
  hirePurchase: { enabled: false, reason: '' },
});

function productForm(product) {
  return {
    slug: product.slug, title: product.title, tagline: product.tagline ?? '', categoryId: product.categoryId, brand: product.brand ?? '',
    description: product.description, images: product.images, illustration: product.illustration, specifications: product.specifications,
  };
}

function formPayload(form) {
  // Only the new-product form carries hirePurchase; later changes go through the audited eligibility endpoint.
  const hirePurchase = form.hirePurchase && { enabled: form.hirePurchase.enabled, reason: form.hirePurchase.enabled ? form.hirePurchase.reason.trim() || null : null };
  return {
    ...form,
    ...(hirePurchase && { hirePurchase }),
    tagline: form.tagline.trim() || null,
    brand: form.brand.trim() || null,
    images: form.images.filter(i => i.src.trim() || i.alt.trim()),
    specifications: form.specifications.filter(s => s.label.trim() || s.value.trim()),
  };
}

function ProductEditor({ id, categories, can, notify, currency, setReasonRequest }) {
  const isNew = id === 'new';
  const [product, setProduct] = useState(null);
  const [form, setForm] = useState(isNew ? emptyProduct(categories[0]?.id) : null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const editable = can('catalogue:write');

  const load = useCallback(async () => {
    try {
      const data = await api('GET', `/admin/products/${id}`);
      setProduct(data);
      setForm(productForm(data));
      setError(null);
    } catch (failure) {
      setError(failure);
    }
  }, [id]);
  useEffect(() => { if (!isNew) load(); }, [isNew, load]);
  // Categories may arrive after the new-product form was created; default to the first so the select and the payload agree.
  useEffect(() => {
    if (isNew && categories[0]) setForm(f => (f.categoryId ? f : { ...f, categoryId: categories[0].id }));
  }, [isNew, categories]);

  async function save(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (isNew) {
        const created = await api('POST', '/admin/products', formPayload(form));
        notify('Product created as a draft');
        go(`products/${created.id}`);
      } else {
        const updated = await api('PATCH', `/admin/products/${id}`, { ...formPayload(form), expectedVersion: product.version });
        setProduct(updated);
        setForm(productForm(updated));
        notify('Changes saved');
      }
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }

  async function transition(action) {
    setError(null);
    try {
      const updated = await api('POST', `/admin/products/${id}/transitions`, { action, expectedVersion: product.version });
      setProduct(updated);
      setForm(productForm(updated));
      notify(`Product ${updated.publishStatus}`);
    } catch (failure) {
      setError(failure);
    }
  }

  function toggleHirePurchase() {
    const enabling = !product.hirePurchaseEnabled;
    setReasonRequest({
      title: enabling ? 'Add to the hire purchase store' : 'Remove from the hire purchase store',
      description: enabling
        ? 'Approved hire-purchase customers will be able to buy this product on credit. Retail is unaffected.'
        : 'New hire-purchase purchases of this product stop. Agreements already accepted are unaffected.',
      confirmLabel: enabling ? 'Enable' : 'Disable',
      onConfirm: async reason => {
        const updated = await api('POST', `/admin/products/${id}/hire-purchase`, { enabled: enabling, expectedVersion: product.version, reason });
        setProduct(updated);
        notify(enabling ? 'Hire purchase enabled' : 'Hire purchase disabled');
      },
    });
  }

  if (!form) return error ? <ErrorBanner error={error} /> : <p className="muted">Loading…</p>;
  const fe = error?.fieldErrors ?? {};
  const set = patch => setForm(f => ({ ...f, ...patch }));
  const updateList = (key, index, patch) => set({ [key]: form[key].map((item, i) => (i === index ? { ...item, ...patch } : item)) });

  return (
    <>
      <header className="page-head">
        <div>
          <a className="back" href="#/products"><ArrowLeft size={15} /> Products</a>
          <h1>{isNew ? 'New product' : product.title}</h1>
          {!isNew && (
            <div className="row">
              <StatusChip status={product.publishStatus} />
              {product.illustrative && <span className="tag">illustrative fixture</span>}
              <span className="muted small">Version {product.version} · updated {formatDate(product.updatedAt)}</span>
            </div>
          )}
        </div>
        {!isNew && (
          <div className="row">
            {product.publishStatus === 'published' && <a className="btn ghost" href={`/#shop`} target="_blank" rel="noreferrer"><ExternalLink size={15} /> Storefront</a>}
            {can('catalogue:publish') && STATUS_ACTIONS[product.publishStatus].map(([action, label]) => (
              <button key={action} className={`btn ${action === 'publish' ? 'primary' : 'ghost'}`} onClick={() => transition(action)}>{label}</button>
            ))}
          </div>
        )}
      </header>
      <ErrorBanner error={error} />
      <div className="editor-grid">
        <form className="panel stack" onSubmit={save}>
          <fieldset disabled={!editable} className="stack">
            <h2>Details</h2>
            <div className="two">
              <Field label="Title" error={fe.title}><input required maxLength={120} value={form.title} onChange={e => set({ title: e.target.value })} /></Field>
              <Field label="Web address" hint={product?.publishStatus === 'published' ? 'Locked while published.' : 'Lowercase, hyphenated.'} error={fe.slug}>
                <input required pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={80} value={form.slug} disabled={product?.publishStatus === 'published'} onChange={e => set({ slug: e.target.value })} />
              </Field>
              <Field label="Category" error={fe.categoryId}>
                <select required value={form.categoryId} onChange={e => set({ categoryId: e.target.value })}>
                  {categories.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              </Field>
              <Field label="Brand" hint="Only a confirmed brand." error={fe.brand}><input maxLength={80} value={form.brand} onChange={e => set({ brand: e.target.value })} /></Field>
            </div>
            <Field label="Tagline" error={fe.tagline}><input maxLength={60} value={form.tagline} onChange={e => set({ tagline: e.target.value })} /></Field>
            <Field label="Description" error={fe.description}><textarea rows={4} maxLength={4000} value={form.description} onChange={e => set({ description: e.target.value })} /></Field>

            <h2>Media</h2>
            {form.images.map((image, index) => (
              <div className="list-row" key={index}>
                <Field label="Image path or https URL"><input value={image.src} onChange={e => updateList('images', index, { src: e.target.value })} /></Field>
                <Field label="Alt text"><input value={image.alt} onChange={e => updateList('images', index, { alt: e.target.value })} /></Field>
                <button type="button" className="icon-btn" aria-label="Remove image" onClick={() => set({ images: form.images.filter((_, i) => i !== index) })}><Trash2 size={16} /></button>
              </div>
            ))}
            {fe.images && <span className="field-error">{fe.images}</span>}
            <div className="row">
              <button type="button" className="btn ghost small" onClick={() => set({ images: [...form.images, { src: '', alt: '' }] })}><Plus size={14} /> Add image</button>
              <Field label="Or illustration" className="inline">
                <select value={form.illustration ?? ''} onChange={e => set({ illustration: e.target.value || null })}>
                  <option value="">None</option>{PRODUCT_ILLUSTRATIONS.map(i => <option key={i} value={i}>{i}</option>)}
                </select>
              </Field>
            </div>

            <h2>Specifications</h2>
            <p className="muted small">Only verified facts from the manufacturer or owner.</p>
            {form.specifications.map((spec, index) => (
              <div className="list-row" key={index}>
                <Field label="Label"><input value={spec.label} onChange={e => updateList('specifications', index, { label: e.target.value })} /></Field>
                <Field label="Value"><input value={spec.value} onChange={e => updateList('specifications', index, { value: e.target.value })} /></Field>
                <button type="button" className="icon-btn" aria-label="Remove specification" onClick={() => set({ specifications: form.specifications.filter((_, i) => i !== index) })}><Trash2 size={16} /></button>
              </div>
            ))}
            {fe.specifications && <span className="field-error">{fe.specifications}</span>}
            <button type="button" className="btn ghost small" onClick={() => set({ specifications: [...form.specifications, { label: '', value: '' }] })}><Plus size={14} /> Add specification</button>

            {isNew && (
              <>
                <h2>Where it is sold</h2>
                <div className="store-choices">
                  <label className="store-choice locked">
                    <input type="checkbox" checked disabled />
                    <span><strong>Retail store</strong><span className="muted small">Every published product is sold outright to anyone.</span></span>
                  </label>
                  <label className={`store-choice${can('catalogue:hire_purchase') ? '' : ' locked'}`}>
                    <input
                      type="checkbox"
                      checked={form.hirePurchase.enabled}
                      disabled={!can('catalogue:hire_purchase')}
                      onChange={e => set({ hirePurchase: { ...form.hirePurchase, enabled: e.target.checked } })}
                    />
                    <span>
                      <strong>Hire purchase store</strong>
                      <span className="muted small">
                        {can('catalogue:hire_purchase')
                          ? 'Approved hire-purchase customers can buy this on credit.'
                          : 'An approver marks hire-purchase eligibility. They can enable it after you create the product.'}
                      </span>
                    </span>
                  </label>
                  {form.hirePurchase.enabled && (
                    <Field label="Reason for hire-purchase eligibility" hint="Recorded in the audit log." error={fe['hirePurchase.reason']}>
                      <input required minLength={3} maxLength={500} value={form.hirePurchase.reason} placeholder="e.g. Approved for the HP range, 5 Nov" onChange={e => set({ hirePurchase: { ...form.hirePurchase, reason: e.target.value } })} />
                    </Field>
                  )}
                </div>
              </>
            )}
          </fieldset>
          {editable && <div className="row end sticky-actions"><button className="btn primary" disabled={busy}>{busy ? 'Saving…' : isNew ? 'Create draft' : 'Save changes'}</button></div>}
        </form>

        {!isNew && (
          <aside className="stack">
            <section className="panel">
              <h2>Where it is sold</h2>
              <dl className="store-status">
                <div><dt>Retail store</dt><dd>Always</dd></div>
                <div><dt>Hire purchase store</dt><dd>{product.hirePurchaseEnabled ? <span className="tag hp">Eligible</span> : 'Not eligible'}</dd></div>
              </dl>
              {can('catalogue:hire_purchase')
                ? <button className="btn ghost full" onClick={toggleHirePurchase}>{product.hirePurchaseEnabled ? 'Remove from hire purchase store' : 'Add to hire purchase store'}</button>
                : <p className="muted small">Only an owner or approver can change hire-purchase eligibility.</p>}
            </section>
            <Variants product={product} editable={editable} currency={currency} onChange={load} notify={notify} />
          </aside>
        )}
      </div>
    </>
  );
}

function Variants({ product, editable, currency, onChange, notify }) {
  const [form, setForm] = useState({ sku: '', attributes: '', price: '' });
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState(null);

  function parseAttributes(text) {
    const entries = text.split(',').map(part => part.split(':').map(s => s.trim())).filter(([k, v]) => k && v);
    return Object.fromEntries(entries);
  }

  function pricePayload(text) {
    if (!text.trim()) return { retailPriceMinor: null, currency: null };
    if (!currency) throw new ApiFailure(422, { code: 'commercial_setting_missing', message: 'The owner must set the store currency before prices can be added.' });
    const minor = toMinor(text, currency);
    if (minor === null) throw new ApiFailure(422, { code: 'validation_failed', message: 'Enter the price as a number, for example 1250.00.' });
    return { retailPriceMinor: minor, currency };
  }

  async function add(event) {
    event.preventDefault();
    setError(null);
    try {
      await api('POST', `/admin/products/${product.id}/variants`, { sku: form.sku.trim().toUpperCase(), attributes: parseAttributes(form.attributes), ...pricePayload(form.price) });
      setForm({ sku: '', attributes: '', price: '' });
      notify('SKU added');
      onChange();
    } catch (failure) {
      setError(failure);
    }
  }

  async function savePrice(variant) {
    setError(null);
    try {
      await api('PATCH', `/admin/variants/${variant.id}`, { ...pricePayload(editing.price), expectedVersion: variant.version });
      setEditing(null);
      notify('Price updated');
      onChange();
    } catch (failure) {
      setError(failure);
    }
  }

  async function toggleActive(variant) {
    setError(null);
    try {
      await api('PATCH', `/admin/variants/${variant.id}`, { active: !variant.active, expectedVersion: variant.version });
      onChange();
    } catch (failure) {
      setError(failure);
    }
  }

  return (
    <section className="panel stack">
      <h2>SKUs & prices</h2>
      {!currency && <p className="banner warn small"><AlertTriangle size={16} /> Prices are locked until the owner sets the store currency.</p>}
      <ErrorBanner error={error} />
      {product.variants.length === 0 && <p className="muted small">No SKUs yet. The storefront shows "price to be confirmed".</p>}
      {product.variants.map(variant => (
        <div key={variant.id} className={`variant ${variant.active ? '' : 'inactive'}`}>
          <div className="row between">
            <strong>{variant.sku}</strong>
            <span className="muted small">{variant.stock.available} available</span>
          </div>
          {Object.keys(variant.attributes).length > 0 && <span className="sub">{Object.entries(variant.attributes).map(([k, v]) => `${k}: ${v}`).join(' · ')}</span>}
          {editing?.id === variant.id ? (
            <div className="row">
              <input aria-label={`Price for ${variant.sku}`} placeholder={currency ? `Amount in ${currency}` : 'Currency not set'} value={editing.price} onChange={e => setEditing({ ...editing, price: e.target.value })} />
              <button className="icon-btn" aria-label="Save price" onClick={() => savePrice(variant)}><Check size={16} /></button>
              <button className="icon-btn" aria-label="Cancel" onClick={() => setEditing(null)}><X size={16} /></button>
            </div>
          ) : (
            <div className="row between">
              <span>{formatMoney(variant.retailPriceMinor, variant.currency)}</span>
              {editable && (
                <span className="row">
                  <button className="link small" onClick={() => setEditing({ id: variant.id, price: toMajorText(variant.retailPriceMinor, variant.currency) })}>Edit price</button>
                  <button className="link small" onClick={() => toggleActive(variant)}>{variant.active ? 'Deactivate' : 'Activate'}</button>
                </span>
              )}
            </div>
          )}
        </div>
      ))}
      {editable && (
        <form onSubmit={add} className="stack add-variant">
          <Field label="New SKU" hint="Uppercase letters, numbers and hyphens."><input required pattern="[A-Za-z0-9][A-Za-z0-9\-]{1,39}" value={form.sku} onChange={e => setForm({ ...form, sku: e.target.value })} /></Field>
          <Field label="Attributes" hint="For example: colour: Black, size: 55 inch"><input value={form.attributes} onChange={e => setForm({ ...form, attributes: e.target.value })} /></Field>
          <Field label={`Retail price${currency ? ` (${currency})` : ''}`} hint="Leave blank until the price is confirmed.">
            <input inputMode="decimal" disabled={!currency} value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} />
          </Field>
          <button className="btn ghost full"><Plus size={14} /> Add SKU</button>
        </form>
      )}
    </section>
  );
}

/* ---------- inventory ---------- */

function Inventory({ can, notify }) {
  const [items, setItems] = useState(null);
  const [movements, setMovements] = useState(null);
  const [error, setError] = useState(null);
  const [form, setForm] = useState({ sku: '', quantity: '', reason: 'stock_received', note: '' });
  const [formError, setFormError] = useState(null);
  // One key per intended adjustment, so a retry after a network failure cannot double-apply it.
  const attemptKey = useRef(newKey());

  const load = useCallback(async () => {
    try {
      const [stock, history] = await Promise.all([api('GET', '/admin/inventory'), api('GET', '/admin/inventory/movements?limit=25')]);
      setItems(stock.items);
      setMovements(history.items);
      setForm(f => ({ ...f, sku: f.sku || stock.items[0]?.sku || '' }));
    } catch (failure) {
      setError(failure);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  function update(patch) {
    attemptKey.current = newKey();
    setForm(f => ({ ...f, ...patch }));
  }

  async function submit(event) {
    event.preventDefault();
    setFormError(null);
    try {
      await api('POST', '/admin/inventory/movements', {
        sku: form.sku, quantity: Number(form.quantity), reason: form.reason, ...(form.note.trim() && { note: form.note.trim() }),
      }, { idempotencyKey: attemptKey.current });
      attemptKey.current = newKey();
      setForm(f => ({ ...f, quantity: '', note: '' }));
      notify('Stock adjusted');
      load();
    } catch (failure) {
      setFormError(failure);
    }
  }

  const rule = INVENTORY_REASONS[form.reason];
  return (
    <>
      <header className="page-head"><div><p className="eyebrow">Inventory</p><h1>Stock ledger</h1></div><button className="btn ghost" onClick={load}><RefreshCw size={15} /> Refresh</button></header>
      <ErrorBanner error={error} />
      <div className="editor-grid">
        <div className="stack">
          <div className="table-wrap">
            <table>
              <thead><tr><th>SKU</th><th>Product</th><th className="num">On hand</th><th className="num">Reserved</th><th className="num">Available</th></tr></thead>
              <tbody>
                {items?.map(item => (
                  <tr key={item.sku} className={item.active ? '' : 'inactive'}>
                    <td><strong>{item.sku}</strong>{!item.active && <span className="tag">inactive</span>}</td>
                    <td><a href={`#/products/${item.product.id}`}>{item.product.title}</a></td>
                    <td className="num">{item.onHand}</td><td className="num">{item.reserved}</td>
                    <td className={`num ${item.available <= 0 ? 'warn-text' : ''}`}>{item.available}</td>
                  </tr>
                ))}
                {items?.length === 0 && <tr><td colSpan={5} className="empty-cell">No SKUs yet. Add SKUs to products in the catalogue.</td></tr>}
              </tbody>
            </table>
          </div>
          <section className="panel">
            <h2>Recent movements</h2>
            <ul className="timeline">
              {movements?.map(m => (
                <li key={m.id}>
                  <span className={`qty ${m.quantity > 0 ? 'in' : 'out'}`}>{m.quantity > 0 ? `+${m.quantity}` : m.quantity}</span>
                  <div><strong>{m.sku}</strong> · {REASON_LABELS[m.reason] ?? m.reason}{m.note && <span className="sub">{m.note}</span>}</div>
                  <span className="muted small">{formatDate(m.createdAt)}</span>
                </li>
              ))}
              {movements?.length === 0 && <li className="muted">No movements recorded.</li>}
            </ul>
          </section>
        </div>
        {can('inventory:adjust') && items?.length > 0 && (
          <form className="panel stack" onSubmit={submit}>
            <h2>Record adjustment</h2>
            <p className="muted small">Adjustments are permanent ledger entries. Fix mistakes with a new correcting entry.</p>
            <ErrorBanner error={formError} />
            <Field label="SKU"><select value={form.sku} onChange={e => update({ sku: e.target.value })}>{items.map(i => <option key={i.sku} value={i.sku}>{i.sku} — {i.product.title}</option>)}</select></Field>
            <Field label="Reason"><select value={form.reason} onChange={e => update({ reason: e.target.value })}>{Object.keys(INVENTORY_REASONS).map(r => <option key={r} value={r}>{REASON_LABELS[r]}</option>)}</select></Field>
            <Field label="Quantity" hint={rule.sign > 0 ? 'Positive number added to stock.' : rule.sign < 0 ? 'Negative number removed from stock.' : 'Positive adds, negative removes.'} error={formError?.fieldErrors?.quantity}>
              <input type="number" required step={1} value={form.quantity} onChange={e => update({ quantity: e.target.value })} />
            </Field>
            <Field label={`Note${rule.noteRequired ? '' : ' (optional)'}`} error={formError?.fieldErrors?.note}>
              <textarea rows={2} maxLength={500} required={rule.noteRequired} value={form.note} onChange={e => update({ note: e.target.value })} />
            </Field>
            <button className="btn primary full">Record</button>
          </form>
        )}
      </div>
    </>
  );
}

/* ---------- staff ---------- */

function Staff({ me, notify, setReasonRequest }) {
  const [staff, setStaff] = useState(null);
  const [error, setError] = useState(null);
  const [form, setForm] = useState({ email: '', displayName: '', roles: [] });
  const [formError, setFormError] = useState(null);
  const [invite, setInvite] = useState(null);
  const [roleEdit, setRoleEdit] = useState(null);

  const load = useCallback(() => api('GET', '/admin/staff').then(setStaff, setError), []);
  useEffect(() => { load(); }, [load]);

  const toggle = (list, role) => (list.includes(role) ? list.filter(r => r !== role) : [...list, role]);

  async function submit(event) {
    event.preventDefault();
    setFormError(null);
    try {
      const data = await api('POST', '/admin/staff', form);
      setInvite({ ...data, email: data.staff.email });
      setForm({ email: '', displayName: '', roles: [] });
      load();
    } catch (failure) {
      setFormError(failure);
    }
  }

  async function saveRoles(member) {
    setError(null);
    try {
      await api('PUT', `/admin/staff/${member.id}/roles`, { roles: roleEdit.roles, expectedVersion: member.version });
      setRoleEdit(null);
      notify('Roles updated');
      load();
    } catch (failure) {
      setError(failure);
    }
  }

  async function reissue(member) {
    setError(null);
    try {
      const data = await api('POST', `/admin/staff/${member.id}/invite`, { expectedVersion: member.version });
      setInvite({ ...data, email: member.email });
      load();
    } catch (failure) {
      setError(failure);
    }
  }

  function deactivate(member) {
    setReasonRequest({
      title: `Deactivate ${member.displayName}`,
      description: 'They will be signed out everywhere and cannot sign in again. Their audit history is kept.',
      confirmLabel: 'Deactivate',
      danger: true,
      onConfirm: async reason => {
        await api('POST', `/admin/staff/${member.id}/deactivate`, { expectedVersion: member.version, reason });
        notify('Account deactivated');
        load();
      },
    });
  }

  const inviteLink = invite && `${window.location.origin}/admin/#/accept-invite?email=${encodeURIComponent(invite.email)}`;
  return (
    <>
      <header className="page-head"><div><p className="eyebrow">Staff</p><h1>Team & roles</h1></div></header>
      <ErrorBanner error={error} />
      {invite && (
        <section className="panel invite" role="status">
          <h2>Invitation ready for {invite.email}</h2>
          <p className="muted small">Share the link and code with them through a channel you trust. The code is shown once and expires {formatDate(invite.inviteExpiresAt)}.</p>
          <div className="copy-row"><code>{inviteLink}</code><button className="icon-btn" aria-label="Copy link" onClick={() => navigator.clipboard.writeText(inviteLink)}><Copy size={15} /></button></div>
          <div className="copy-row"><code>{invite.inviteToken}</code><button className="icon-btn" aria-label="Copy code" onClick={() => navigator.clipboard.writeText(invite.inviteToken)}><Copy size={15} /></button></div>
          <button className="btn ghost small" onClick={() => setInvite(null)}>Done</button>
        </section>
      )}
      <div className="editor-grid">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Roles</th><th>Status</th><th /></tr></thead>
            <tbody>
              {staff?.map(member => (
                <tr key={member.id}>
                  <td><strong>{member.displayName}</strong>{member.id === me.id && <span className="tag">you</span>}<span className="sub">{member.email}</span></td>
                  <td>
                    {roleEdit?.id === member.id ? (
                      <div className="checks">
                        {STAFF_ROLES.map(role => (
                          <label key={role}><input type="checkbox" checked={roleEdit.roles.includes(role)} onChange={() => setRoleEdit({ ...roleEdit, roles: toggle(roleEdit.roles, role) })} /> {ROLE_LABELS[role]}</label>
                        ))}
                        <div className="row"><button className="btn primary small" onClick={() => saveRoles(member)}>Save</button><button className="btn ghost small" onClick={() => setRoleEdit(null)}>Cancel</button></div>
                      </div>
                    ) : member.roles.map(r => ROLE_LABELS[r]).join(', ')}
                  </td>
                  <td><StatusChip status={member.status} /></td>
                  <td className="actions">
                    {member.status !== 'deactivated' && !roleEdit && <button className="link small" onClick={() => setRoleEdit({ id: member.id, roles: member.roles })}>Edit roles</button>}
                    {member.status === 'invited' && <button className="link small" onClick={() => reissue(member)}>New code</button>}
                    {member.status !== 'deactivated' && member.id !== me.id && <button className="link small danger-text" onClick={() => deactivate(member)}>Deactivate</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form className="panel stack" onSubmit={submit}>
          <h2>Invite staff</h2>
          <ErrorBanner error={formError} />
          <Field label="Name" error={formError?.fieldErrors?.displayName}><input required maxLength={80} value={form.displayName} onChange={e => setForm({ ...form, displayName: e.target.value })} /></Field>
          <Field label="Email" error={formError?.fieldErrors?.email}><input type="email" required value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></Field>
          <fieldset className="checks">
            <legend className="field-label">Roles</legend>
            {STAFF_ROLES.map(role => (
              <label key={role}><input type="checkbox" checked={form.roles.includes(role)} onChange={() => setForm({ ...form, roles: toggle(form.roles, role) })} /> {ROLE_LABELS[role]}</label>
            ))}
            {formError?.fieldErrors?.roles && <span className="field-error">{formError.fieldErrors.roles}</span>}
          </fieldset>
          <button className="btn primary full" disabled={!form.roles.length}>Create invitation</button>
        </form>
      </div>
    </>
  );
}

/* ---------- settings & audit ---------- */

const SETTING_TITLES = {
  'store.currency': 'Store currency',
  'checkout.deliveryZones': 'Delivery areas and fees',
  'checkout.pickup': 'In-store collection',
  'checkout.reservationMinutes': 'Stock hold for unpaid orders',
  'checkout.returnsPolicy': 'Returns and warranty wording',
  'hirePurchase.plans': 'Hire purchase plans',
  'hirePurchase.agreementTerms': 'Hire purchase agreement wording',
  'hirePurchase.privacyNotice': 'Hire purchase privacy notice',
  'hirePurchase.declaration': 'Hire purchase declaration and consent',
};

const slugify = text => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Convert between what the form shows and what the API stores. Empty means "not set". */
const SETTING_FORMS = {
  'store.currency': { toDraft: value => value ?? '', toValue: draft => draft.trim().toUpperCase() || null },
  'checkout.deliveryZones': {
    toDraft: (value, currency) => (value ?? []).map(zone => ({ name: zone.name, fee: toMajorText(zone.feeMinor, currency) })),
    toValue: (draft, currency) => {
      const zones = draft.filter(zone => zone.name.trim());
      if (!zones.length) return null;
      if (!currency) throw new ApiFailure(422, { code: 'validation_failed', message: 'Set the store currency first.' });
      return zones.map(zone => {
        const feeMinor = toMinor(zone.fee.trim() || '0', currency);
        if (feeMinor === null) throw new ApiFailure(422, { code: 'validation_failed', message: `Enter the fee for ${zone.name.trim()} as a number, for example 25.00.` });
        return { id: slugify(zone.name), name: zone.name.trim(), feeMinor };
      });
    },
  },
  'checkout.pickup': {
    toDraft: value => value ?? { address: '', hours: '' },
    toValue: draft => (draft.address.trim() || draft.hours.trim() ? { address: draft.address.trim(), hours: draft.hours.trim() } : null),
  },
  'checkout.reservationMinutes': { toDraft: value => (value ?? '').toString(), toValue: draft => (draft.trim() ? Number(draft) : null) },
  'checkout.returnsPolicy': { toDraft: value => value ?? '', toValue: draft => draft.trim() || null },
  'hirePurchase.plans': {
    toDraft: value => (value ?? []).map(plan => ({ name: plan.name, deposit: String(plan.depositBasisPoints / 100), instalments: String(plan.instalments), charge: String(plan.chargeBasisPoints / 100) })),
    toValue: draft => {
      const plans = draft.filter(plan => plan.name.trim());
      if (!plans.length) return null;
      return plans.map(plan => {
        const deposit = Number(plan.deposit);
        const charge = Number(plan.charge);
        const instalments = Number(plan.instalments);
        const invalid = message => new ApiFailure(422, { code: 'validation_failed', message: `${plan.name.trim()}: ${message}` });
        if (!plan.deposit.trim() || !(deposit >= 1 && deposit <= 90)) throw invalid('the deposit must be between 1% and 90%.');
        if (!Number.isInteger(instalments) || instalments < 1 || instalments > 60) throw invalid('instalments must be a whole number from 1 to 60.');
        if (!plan.charge.trim() || !(charge >= 0 && charge <= 300)) throw invalid('the hire charge must be between 0% and 300%.');
        return { id: slugify(plan.name), name: plan.name.trim(), depositBasisPoints: Math.round(deposit * 100), instalments, chargeBasisPoints: Math.round(charge * 100) };
      });
    },
  },
  'hirePurchase.agreementTerms': { toDraft: value => value ?? '', toValue: draft => draft.trim() || null },
  'hirePurchase.privacyNotice': { toDraft: value => value ?? '', toValue: draft => draft.trim() || null },
  'hirePurchase.declaration': { toDraft: value => value ?? '', toValue: draft => draft.trim() || null },
};

function SettingEditor({ setting, draft, onChange, currency }) {
  switch (setting.key) {
    case 'store.currency':
      return <input aria-label={SETTING_TITLES[setting.key]} maxLength={3} placeholder="e.g. GHS" value={draft} onChange={e => onChange(e.target.value)} />;
    case 'checkout.deliveryZones':
      return (
        <div className="stack">
          {!currency && <span className="muted small">Set the store currency first, so fees can be entered.</span>}
          {draft.map((zone, index) => (
            <div className="list-row" key={index}>
              <Field label="Area"><input maxLength={80} placeholder="e.g. Accra" value={zone.name} onChange={e => onChange(draft.map((z, i) => (i === index ? { ...z, name: e.target.value } : z)))} /></Field>
              <Field label={`Fee${currency ? ` (${currency})` : ''}`}><input inputMode="decimal" placeholder="0.00" value={zone.fee} disabled={!currency} onChange={e => onChange(draft.map((z, i) => (i === index ? { ...z, fee: e.target.value } : z)))} /></Field>
              <button type="button" className="icon-btn" aria-label="Remove area" onClick={() => onChange(draft.filter((_, i) => i !== index))}><Trash2 size={16} /></button>
            </div>
          ))}
          <button type="button" className="btn ghost small" onClick={() => onChange([...draft, { name: '', fee: '' }])}><Plus size={14} /> Add area</button>
        </div>
      );
    case 'hirePurchase.plans':
      return (
        <div className="stack">
          {draft.map((plan, index) => {
            const set = key => e => onChange(draft.map((p, i) => (i === index ? { ...p, [key]: e.target.value } : p)));
            return (
              <div className="plan-row" key={index}>
                <Field label="Plan name" className="plan-name"><input maxLength={80} placeholder="e.g. Six months" value={plan.name} onChange={set('name')} /></Field>
                <Field label="Deposit %"><input inputMode="decimal" value={plan.deposit} onChange={set('deposit')} /></Field>
                <Field label="Monthly payments"><input inputMode="numeric" value={plan.instalments} onChange={set('instalments')} /></Field>
                <Field label="Hire charge %"><input inputMode="decimal" value={plan.charge} onChange={set('charge')} /></Field>
                <button type="button" className="icon-btn" aria-label="Remove plan" onClick={() => onChange(draft.filter((_, i) => i !== index))}><Trash2 size={16} /></button>
              </div>
            );
          })}
          <button type="button" className="btn ghost small" onClick={() => onChange([...draft, { name: '', deposit: '', instalments: '', charge: '' }])}><Plus size={14} /> Add plan</button>
        </div>
      );
    case 'checkout.pickup':
      return (
        <div className="two">
          <Field label="Store address"><input maxLength={300} value={draft.address} onChange={e => onChange({ ...draft, address: e.target.value })} /></Field>
          <Field label="Opening hours"><input maxLength={200} value={draft.hours} onChange={e => onChange({ ...draft, hours: e.target.value })} /></Field>
        </div>
      );
    case 'checkout.reservationMinutes':
      return <label className="row"><input aria-label={SETTING_TITLES[setting.key]} type="number" min={5} max={1440} value={draft} onChange={e => onChange(e.target.value)} /> <span className="muted small">minutes (5 to 1440)</span></label>;
    default:
      return <textarea aria-label={SETTING_TITLES[setting.key]} rows={setting.key.startsWith('hirePurchase.') ? 8 : 4} maxLength={setting.key === 'hirePurchase.agreementTerms' ? 30000 : setting.key.startsWith('hirePurchase.') ? 8000 : 2000} value={draft} onChange={e => onChange(e.target.value)} />;
  }
}

function SettingsPage({ notify, onCurrencyChange }) {
  const [settings, setSettings] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [error, setError] = useState(null);
  const [errorKey, setErrorKey] = useState(null);
  const currencyOf = list => list.find(s => s.key === 'store.currency')?.value ?? null;
  const load = useCallback(() => api('GET', '/admin/settings').then(data => {
    setSettings(data);
    setDrafts(Object.fromEntries(data.map(s => [s.key, SETTING_FORMS[s.key].toDraft(s.value, currencyOf(data))])));
  }, setError), []);
  useEffect(() => { load(); }, [load]);
  const currency = settings ? currencyOf(settings) : null;

  async function save(setting) {
    setError(null);
    setErrorKey(null);
    try {
      const value = SETTING_FORMS[setting.key].toValue(drafts[setting.key], currency);
      await api('PUT', `/admin/settings/${setting.key}`, { value, expectedVersion: setting.version });
      notify('Setting saved');
      if (setting.key === 'store.currency') onCurrencyChange(value);
      load();
    } catch (failure) {
      setError(failure);
      setErrorKey(setting.key);
    }
  }

  return (
    <>
      <header className="page-head"><div><p className="eyebrow">Settings</p><h1>Commercial settings</h1></div></header>
      <p className="muted">Only values the owner has confirmed. Anything left unset keeps the dependent features switched off.</p>
      {!errorKey && <ErrorBanner error={error} />}
      {settings?.map(setting => (
        <section key={setting.key} className="panel stack narrow">
          <div className="row between"><h2>{SETTING_TITLES[setting.key] ?? setting.key}</h2>{setting.configured ? <span className="chip chip-published">set</span> : <span className="chip chip-draft">not set</span>}</div>
          <p className="muted small">{setting.description}</p>
          <SettingEditor setting={setting} draft={drafts[setting.key]} currency={currency} onChange={value => setDrafts({ ...drafts, [setting.key]: value })} />
          <div className="row end"><button className="btn primary" onClick={() => save(setting)}>Save</button></div>
          {errorKey === setting.key && <span className="field-error">{error.fieldErrors?.value ?? error.message}</span>}
          {setting.updatedAt && <span className="muted small">Last changed {formatDate(setting.updatedAt)}</span>}
        </section>
      ))}
    </>
  );
}

/* ---------- orders ---------- */

const PAYMENT_LABELS = { pending_payment: 'Awaiting payment', paid: 'Paid', payment_expired: 'Expired', refund_pending: 'Refund pending', partially_refunded: 'Partly refunded', refunded: 'Refunded' };
const PAYMENT_CHIPS = { pending_payment: 'chip-draft', paid: 'chip-published', payment_expired: 'chip-archived' };
const FULFILMENT_LABELS = { not_started: 'Not started', processing: 'Processing', dispatched: 'Dispatched', delivered: 'Delivered', cancelled: 'Cancelled' };
const FULFILMENT_NEXT = { not_started: ['start_processing', 'Start processing'], processing: ['dispatch', 'Mark dispatched'], dispatched: ['deliver', 'Mark delivered'] };
const ATTENTION_LABELS = {
  payment_mismatch: 'Paystack reported an amount or currency that does not match this order. It has not been marked paid. Check it in your Paystack dashboard.',
  paid_without_stock: 'This order was paid after its hold expired, and the stock has since gone. Contact the customer, and restock or refund in Paystack.',
};

function Orders() {
  const [status, setStatus] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const load = useCallback(async cursor => {
    const params = new URLSearchParams({ ...(status && { paymentStatus: status }), ...(cursor && { cursor }) });
    try {
      const data = await api('GET', `/admin/orders?${params}`);
      setResult(prev => (cursor ? { items: [...prev.items, ...data.items], nextCursor: data.nextCursor } : data));
      setError(null);
    } catch (failure) {
      setError(failure);
    }
  }, [status]);
  useEffect(() => { load(); }, [load]);
  return (
    <>
      <header className="page-head"><div><p className="eyebrow">Retail</p><h1>Orders</h1></div></header>
      <div className="toolbar">
        <select aria-label="Filter by payment" value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">All payments</option>{Object.keys(PAYMENT_CHIPS).map(key => <option key={key} value={key}>{PAYMENT_LABELS[key]}</option>)}
        </select>
      </div>
      <ErrorBanner error={error} />
      {result && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Order</th><th>Customer</th><th>Total</th><th>Payment</th><th>Fulfilment</th><th>Placed</th></tr></thead>
            <tbody>
              {result.items.map(order => (
                <tr key={order.reference} onClick={() => go(`orders/${order.reference}`)} className="clickable">
                  <td><a href={`#/orders/${order.reference}`} onClick={e => e.stopPropagation()}><strong>{order.reference}</strong></a>{order.attention && <span className="tag warn">needs attention</span>}</td>
                  <td>{order.contact.name}</td>
                  <td>{formatMoney(order.totalMinor, order.currency)}</td>
                  <td><span className={`chip ${PAYMENT_CHIPS[order.paymentStatus] ?? 'chip-draft'}`}>{PAYMENT_LABELS[order.paymentStatus]}</span></td>
                  <td>{FULFILMENT_LABELS[order.fulfilmentStatus]}</td>
                  <td className="muted">{formatDate(order.createdAt)}</td>
                </tr>
              ))}
              {result.items.length === 0 && <tr><td colSpan={6} className="empty-cell">No orders yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {result?.nextCursor && <button className="btn ghost" onClick={() => load(result.nextCursor)}>Load more</button>}
    </>
  );
}

function OrderDetail({ reference, can, notify, setReasonRequest }) {
  const [order, setOrder] = useState(null);
  const [error, setError] = useState(null);
  const load = useCallback(() => api('GET', `/admin/orders/${reference}`).then(setOrder, setError), [reference]);
  useEffect(() => { load(); }, [load]);
  if (!order) return error ? <ErrorBanner error={error} /> : <p className="muted">Loading…</p>;

  const next = order.paymentStatus === 'paid' ? FULFILMENT_NEXT[order.fulfilmentStatus] : null;
  async function advance() {
    setError(null);
    try {
      setOrder(await api('POST', `/admin/orders/${reference}/fulfilment`, { action: next[0], expectedVersion: order.version }));
      notify('Order updated');
    } catch (failure) {
      setError(failure);
    }
  }
  function cancel() {
    setReasonRequest({
      title: 'Cancel this unpaid order',
      description: 'Held stock goes back on sale straight away. The customer can no longer pay for this order.',
      confirmLabel: 'Cancel order',
      onConfirm: async reason => {
        setOrder(await api('POST', `/admin/orders/${reference}/cancel`, { expectedVersion: order.version, reason }));
        notify('Order cancelled');
      },
    });
  }
  const canCancel = can('orders:fulfil') && order.paymentStatus !== 'paid' && order.fulfilmentStatus !== 'cancelled';
  const { fulfilment, contact } = order;
  return (
    <>
      <header className="page-head">
        <div>
          <a className="back" href="#/orders"><ArrowLeft size={15} /> Orders</a>
          <h1>{order.reference}</h1>
          <div className="row">
            <span className={`chip ${PAYMENT_CHIPS[order.paymentStatus] ?? 'chip-draft'}`}>{PAYMENT_LABELS[order.paymentStatus]}</span>
            <span className="muted small">{FULFILMENT_LABELS[order.fulfilmentStatus]} · placed {formatDate(order.createdAt)}</span>
            {order.agreementId && <a className="tag hp" href={`#/agreements/${order.agreementId}`}>Hire purchase deposit · {order.agreementId}</a>}
          </div>
        </div>
        <div className="row">
          {canCancel && <button className="btn ghost" onClick={cancel}>Cancel order</button>}
          {next && can('orders:fulfil') && <button className="btn primary" onClick={advance}>{next[1]}</button>}
        </div>
      </header>
      <ErrorBanner error={error} />
      {order.attention && <div className="banner warn"><AlertTriangle size={18} /><div><strong>Needs attention.</strong> <span>{ATTENTION_LABELS[order.attention] ?? order.attention}</span></div></div>}
      <div className="editor-grid">
        <section className="panel">
          <h2>Items</h2>
          <div className="table-wrap flush">
            <table>
              <thead><tr><th>Product</th><th>SKU</th><th>Qty</th><th>Unit</th><th>Total</th></tr></thead>
              <tbody>
                {order.items.map(line => <tr key={line.sku}><td>{line.title}</td><td className="muted">{line.sku}</td><td>{line.quantity}</td><td>{formatMoney(line.unitPriceMinor, order.currency)}</td><td>{formatMoney(line.lineTotalMinor, order.currency)}</td></tr>)}
              </tbody>
            </table>
          </div>
          <dl className="store-status order-totals">
            <div><dt>Subtotal</dt><dd>{formatMoney(order.subtotalMinor, order.currency)}</dd></div>
            <div><dt>Delivery</dt><dd>{formatMoney(order.deliveryFeeMinor, order.currency)}</dd></div>
            <div><dt>Total</dt><dd>{formatMoney(order.totalMinor, order.currency)}</dd></div>
          </dl>
        </section>
        <aside className="stack">
          <section className="panel">
            <h2>Customer</h2>
            <p>{contact.name}<br /><a className="link" href={`tel:${contact.phone.replace(/\s/g, '')}`}>{contact.phone}</a><br /><a className="link" href={`mailto:${contact.email}`}>{contact.email}</a></p>
          </section>
          <section className="panel">
            <h2>{fulfilment.method === 'pickup' ? 'In-store collection' : `Delivery · ${fulfilment.zoneName}`}</h2>
            {fulfilment.method === 'pickup'
              ? <p className="muted small">{fulfilment.pickup.address}<br />{fulfilment.pickup.hours}</p>
              : <p className="muted small">{fulfilment.address.digitalAddress}<br />{fulfilment.address.area}{fulfilment.address.landmark && <><br />{fulfilment.address.landmark}</>}</p>}
          </section>
          <section className="panel">
            <h2>Stock</h2>
            <p className="muted small">{order.stockDeducted ? 'Taken from stock when paid.' : order.stockHeld ? `Held until ${formatDate(order.reservationExpiresAt)}.` : 'Not holding stock.'}</p>
          </section>
        </aside>
      </div>
    </>
  );
}

/* ---------- hire purchase applications ---------- */

const APPLICATION_LABELS = { submitted: 'New', under_review: 'Under review', needs_information: 'Waiting on customer', approved: 'Approved', declined: 'Declined', withdrawn: 'Withdrawn' };
const APPLICATION_CHIPS = { submitted: 'chip-draft', under_review: 'chip-draft', needs_information: 'chip-archived', approved: 'chip-published', declined: 'chip-archived', withdrawn: 'chip-archived' };
const NOTIFICATION_REASONS = {
  not_configured: 'Email is not set up on this server.',
  refused: 'Firebase refused to send it. Check that the Email link sign-in method is switched on.',
  unreachable: 'Firebase could not be reached.',
};
const employmentLabel = value => ASSESSMENT_SECTIONS.find(s => s.id === 'employment').fields.find(f => f.key === 'employmentType').options.find(o => o.value === value)?.label ?? '—';

function answerText(field, value, currency) {
  if (value === null || value === undefined || value === '') return '—';
  if (field.type === 'select') return field.options.find(choice => choice.value === value)?.label ?? value;
  if (field.type === 'money') return formatMoney(value, currency);
  return String(value);
}

function Applications() {
  const [status, setStatus] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const load = useCallback(async cursor => {
    const params = new URLSearchParams({ ...(status && { status }), ...(cursor && { cursor }) });
    try {
      const data = await api('GET', `/admin/applications?${params}`);
      setResult(prev => (cursor ? { items: [...prev.items, ...data.items], nextCursor: data.nextCursor } : data));
      setError(null);
    } catch (failure) {
      setError(failure);
    }
  }, [status]);
  useEffect(() => { load(); }, [load]);
  return (
    <>
      <header className="page-head"><div><p className="eyebrow">Hire purchase</p><h1>Applications</h1></div></header>
      <p className="muted">Unfinished drafts stay private to the customer. Opening an application is recorded in the audit log.</p>
      <div className="toolbar">
        <select aria-label="Filter by status" value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">All applications</option>{Object.keys(APPLICATION_LABELS).map(key => <option key={key} value={key}>{APPLICATION_LABELS[key]}</option>)}
        </select>
      </div>
      <ErrorBanner error={error} />
      {result && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Applicant</th><th>Work</th><th>Status</th><th>Recommendation</th><th>Submitted</th></tr></thead>
            <tbody>
              {result.items.map(item => (
                <tr key={item.id} onClick={() => go(`applications/${item.id}`)} className="clickable">
                  <td><a href={`#/applications/${item.id}`} onClick={e => e.stopPropagation()}><strong>{item.name ?? 'No name given'}</strong></a><br /><span className="muted small">{item.email}</span></td>
                  <td>{employmentLabel(item.employmentType)}</td>
                  <td><span className={`chip ${APPLICATION_CHIPS[item.status]}`}>{APPLICATION_LABELS[item.status]}</span></td>
                  <td>{item.recommendation ? (item.recommendation === 'approve' ? 'Approve' : 'Decline') : '—'}</td>
                  <td className="muted">{formatDate(item.submittedAt)}</td>
                </tr>
              ))}
              {result.items.length === 0 && <tr><td colSpan={5} className="empty-cell">No applications yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {result?.nextCursor && <button className="btn ghost" onClick={() => load(result.nextCursor)}>Load more</button>}
    </>
  );
}

function ReviewPanel({ application, run }) {
  const [checks, setChecks] = useState(() => application.review?.checks ?? Object.fromEntries(ASSESSMENT_CHECKS.map(check => [check.id, false])));
  const [recommendation, setRecommendation] = useState(application.review?.recommendation ?? '');
  const [note, setNote] = useState(application.review?.note ?? '');
  const [question, setQuestion] = useState('');
  const save = event => {
    event.preventDefault();
    run('PUT', 'review', { checks, recommendation, note }, 'Recommendation saved');
  };
  return (
    <>
      <form className="panel stack" onSubmit={save}>
        <h2>Your assessment</h2>
        <div className="checks">
          {ASSESSMENT_CHECKS.map(check => (
            <label key={check.id}><input type="checkbox" checked={checks[check.id]} onChange={e => setChecks({ ...checks, [check.id]: e.target.checked })} /> {check.label}</label>
          ))}
        </div>
        <Field label="Your recommendation">
          <select required value={recommendation} onChange={e => setRecommendation(e.target.value)}>
            <option value="">Choose</option><option value="approve">Approve</option><option value="decline">Decline</option>
          </select>
        </Field>
        <Field label="Your notes" hint="For the team only. The customer never sees this."><textarea required rows={4} maxLength={2000} value={note} onChange={e => setNote(e.target.value)} /></Field>
        <div className="row end"><button className="btn primary">Send to approver</button></div>
      </form>
      <form className="panel stack" onSubmit={event => { event.preventDefault(); run('POST', 'request-information', { message: question }, 'Sent to the customer'); }}>
        <h2>Ask the customer</h2>
        <Field label="What you need" hint="The customer sees this when they sign in, and can change their answers."><textarea required rows={3} maxLength={1000} value={question} onChange={e => setQuestion(e.target.value)} /></Field>
        <div className="row end"><button className="btn ghost">Send back to customer</button></div>
      </form>
    </>
  );
}

function DecisionPanel({ application, currency, run, setError }) {
  const [amount, setAmount] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [conditions, setConditions] = useState('');
  const [reason, setReason] = useState('');
  const decide = outcome => {
    if (!reason.trim()) { setError(new ApiFailure(422, { code: 'validation_failed', message: 'Record the reason for your decision.' })); return; }
    if (outcome === 'decline') { run('POST', 'decide', { outcome, reason }, 'Application declined'); return; }
    const limitMinor = currency ? toMinor(amount.trim(), currency) : null;
    if (!limitMinor) { setError(new ApiFailure(422, { code: 'validation_failed', message: currency ? 'Enter the approved amount as a number, for example 3000.00.' : 'Set the store currency first.' })); return; }
    run('POST', 'decide', { outcome, reason, limitMinor, validUntil, conditions: conditions.trim() || null }, 'Customer approved');
  };
  return (
    <form className="panel stack" onSubmit={event => event.preventDefault()}>
      <h2>Your decision</h2>
      <p className="muted small">{application.review.staffName} recommends <strong>{application.review.recommendation === 'approve' ? 'approving' : 'declining'}</strong>. You decide the amount and terms, nothing is suggested.</p>
      <div className="two">
        <Field label={`Approved amount${currency ? ` (${currency})` : ''}`}><input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} /></Field>
        <Field label="Approval lasts until"><input type="date" value={validUntil} onChange={e => setValidUntil(e.target.value)} /></Field>
      </div>
      <Field label="Conditions" hint="Optional. The customer sees these."><input maxLength={1000} value={conditions} onChange={e => setConditions(e.target.value)} /></Field>
      <Field label="Reason" hint="Internal. A declined customer only gets a neutral message."><textarea rows={3} maxLength={2000} value={reason} onChange={e => setReason(e.target.value)} /></Field>
      <div className="row end">
        <button type="button" className="btn ghost" onClick={() => decide('decline')}>Decline</button>
        <button type="button" className="btn primary" onClick={() => decide('approve')}>Approve and email link</button>
      </div>
    </form>
  );
}

/** Files open only on request, because each opening is recorded in the audit log. */
function DocumentViewer({ applicationId, documents }) {
  const [open, setOpen] = useState(null);
  const [failure, setFailure] = useState(null);
  useEffect(() => () => { if (open) URL.revokeObjectURL(open.url); }, [open]);
  async function view(type) {
    setFailure(null);
    try {
      const response = await fetch(`/api/v1/admin/applications/${applicationId}/documents/${type}`, { cache: 'no-store' });
      if (!response.ok) throw new Error('unavailable');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      if (blob.type === 'application/pdf') window.open(url, '_blank', 'noopener');
      setOpen({ type, url, image: blob.type !== 'application/pdf' });
    } catch {
      setFailure('This document could not be opened. Please try again.');
    }
  }
  const present = ASSESSMENT_DOCUMENTS.filter(type => documents?.[type.id]);
  if (!present.length) return <p className="muted small">No documents were uploaded.</p>;
  return (
    <div className="stack">
      <p className="muted small">Opening a document is recorded in the audit log.</p>
      <div className="row wrap">
        {present.map(type => <button key={type.id} type="button" className={`btn ghost small ${open?.type === type.id ? 'active' : ''}`} onClick={() => view(type.id)}>{type.label}</button>)}
      </div>
      {failure && <span className="field-error">{failure}</span>}
      {open?.image && <img className="doc-preview" src={open.url} alt={ASSESSMENT_DOCUMENTS.find(type => type.id === open.type).label} />}
    </div>
  );
}

function ApplicationDetail({ id, me, can, currency, notify, setReasonRequest }) {
  const [application, setApplication] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => { api('GET', `/admin/applications/${id}`).then(setApplication, setError); }, [id]);
  if (!application) return error ? <ErrorBanner error={error} /> : <p className="muted">Loading…</p>;

  async function run(method, action, body, message) {
    setError(null);
    try {
      setApplication(await api(method, `/admin/applications/${id}/${action}`, { ...body, expectedVersion: application.version }));
      notify(message);
    } catch (failure) {
      setError(failure);
    }
  }
  async function resend() {
    setError(null);
    try {
      setApplication(await api('POST', `/admin/applications/${id}/send-sign-in-link`, {}));
    } catch (failure) {
      setError(failure);
    }
  }
  const reopen = () => setReasonRequest({
    title: 'Reopen this application',
    description: application.status === 'approved' ? 'The customer loses their approval straight away and the application goes back to review.' : 'The application goes back to review.',
    confirmLabel: 'Reopen',
    onConfirm: async reason => {
      setApplication(await api('POST', `/admin/applications/${id}/reopen`, { reason, expectedVersion: application.version }));
      notify('Application reopened');
    },
  });

  const { status, review, decision, previousDecision, notification, consent } = application;
  const reviewing = status === 'under_review';
  const ownRecommendation = review?.staffId === me.id;
  return (
    <>
      <header className="page-head">
        <div>
          <a className="back" href="#/applications"><ArrowLeft size={15} /> Applications</a>
          <h1>{application.name ?? 'No name given'}</h1>
          <div className="row">
            <span className={`chip ${APPLICATION_CHIPS[status]}`}>{APPLICATION_LABELS[status]}</span>
            <span className="muted small">{application.email} · submitted {formatDate(application.submittedAt)}{application.assessor && ` · assessor ${application.assessor.staffName}`}</span>
          </div>
        </div>
        <div className="row">
          {status === 'submitted' && can('applications:review') && <button className="btn primary" onClick={() => run('POST', 'start-review', {}, 'Review started')}>Start review</button>}
          {['approved', 'declined'].includes(status) && can('applications:decide') && <button className="btn ghost" onClick={reopen}>Reopen</button>}
        </div>
      </header>
      <ErrorBanner error={error} />
      {status === 'needs_information' && <div className="banner warn"><AlertTriangle size={18} /><div><strong>Waiting on the customer.</strong> <span>{application.informationRequest}</span></div></div>}
      {notification?.status === 'not_sent' && (
        <div className="banner warn"><AlertTriangle size={18} /><div>
          <strong>The sign-in email did not go out.</strong> <span>{NOTIFICATION_REASONS[notification.reason] ?? ''} The customer is still approved and can sign in on the site.</span>
        </div></div>
      )}
      <div className="editor-grid">
        <div className="stack">
          {ASSESSMENT_SECTIONS.map(section => (
            <section className="panel" key={section.id}>
              <h2>{section.title}</h2>
              <dl className="store-status">
                {section.fields.filter(field => fieldApplies(field, application.sections[section.id])).map(field => (
                  <div key={field.key}><dt>{field.label}</dt><dd>{answerText(field, application.sections[section.id]?.[field.key], currency)}</dd></div>
                ))}
              </dl>
            </section>
          ))}
          <section className="panel">
            <h2>Documents</h2>
            <DocumentViewer applicationId={id} documents={application.documents} />
          </section>
        </div>
        <aside className="stack">
          {reviewing && can('applications:review') && <ReviewPanel key={application.version} application={application} run={run} />}
          {review && (
            <section className="panel">
              <h2>Assessment by {review.staffName}</h2>
              <p className="muted small">Recommends <strong>{review.recommendation === 'approve' ? 'approving' : 'declining'}</strong> · {formatDate(review.recommendedAt)}</p>
              <ul className="check-result">
                {ASSESSMENT_CHECKS.map(check => <li key={check.id}>{review.checks[check.id] ? <Check size={14} /> : <X size={14} />} {check.label}</li>)}
              </ul>
              <p className="small">{review.note}</p>
            </section>
          )}
          {reviewing && review && can('applications:decide') && (ownRecommendation
            ? <div className="banner warn"><AlertTriangle size={18} /><div><strong>Someone else must decide.</strong> <span>You made this recommendation, so another approver or the owner makes the decision.</span></div></div>
            : <DecisionPanel key={application.version} application={application} currency={currency} run={run} setError={setError} />)}
          {decision && (
            <section className="panel">
              <h2>{decision.outcome === 'approve' ? 'Approved' : 'Declined'} by {decision.staffName}</h2>
              <p className="muted small">{formatDate(decision.decidedAt)}</p>
              {decision.outcome === 'approve' && (
                <dl className="store-status">
                  <div><dt>Approved amount</dt><dd>{formatMoney(decision.limitMinor, decision.currency)}</dd></div>
                  <div><dt>Lasts until</dt><dd>{decision.validUntil}</dd></div>
                  {decision.conditions && <div><dt>Conditions</dt><dd>{decision.conditions}</dd></div>}
                </dl>
              )}
              <p className="small">{decision.reason}</p>
              {status === 'approved' && can('applications:decide') && (
                <div className="row between">
                  <span className="muted small">{notification?.status === 'sent' ? `Sign-in email sent ${formatDate(notification.at)}` : 'No sign-in email sent'}</span>
                  <button className="btn ghost small" onClick={resend}>Send sign-in link</button>
                </div>
              )}
            </section>
          )}
          {previousDecision && (
            <section className="panel">
              <h2>Earlier decision</h2>
              <p className="muted small">{previousDecision.outcome === 'approve' ? 'Approved' : 'Declined'} by {previousDecision.staffName}, reopened by {previousDecision.reopenedBy.staffName} on {formatDate(previousDecision.reopenedAt)}.</p>
              <p className="small">{previousDecision.reopenReason}</p>
            </section>
          )}
          {consent && (
            <section className="panel">
              <h2>Consent</h2>
              <p className="muted small">Agreed {formatDate(consent.acceptedAt)} to privacy notice version {consent.privacyVersion} and declaration version {consent.declarationVersion}.</p>
              <details className="small"><summary>Wording they agreed to</summary><p>{consent.privacyNotice}</p><p>{consent.declaration}</p></details>
            </section>
          )}
        </aside>
      </div>
    </>
  );
}

/* ---------- hire purchase agreements ---------- */

const AGREEMENT_LABELS = { awaiting_deposit: 'Deposit due', active: 'Active', completed: 'Paid in full', cancelled: 'Ended' };
const AGREEMENT_CHIPS = { awaiting_deposit: 'chip-draft', active: 'chip-published', completed: 'chip-archived', cancelled: 'chip-archived' };
const AGREEMENT_ATTENTION = {
  payment_mismatch: 'Paystack reported an amount that does not match the instalment, so it was not counted. Check it in your Paystack dashboard.',
  duplicate_payment: 'A payment arrived for an instalment that was already paid. Check it in your Paystack dashboard and refund if needed.',
};
const PAYMENT_METHODS = { paystack: 'Paystack', cash: 'Cash', mobile_money: 'Mobile money', bank_transfer: 'Bank transfer', other: 'Other' };

function Agreements() {
  const [status, setStatus] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const load = useCallback(async cursor => {
    const params = new URLSearchParams({ ...(status && { status }), ...(cursor && { cursor }) });
    try {
      const data = await api('GET', `/admin/agreements?${params}`);
      setResult(prev => (cursor ? { items: [...prev.items, ...data.items], nextCursor: data.nextCursor } : data));
      setError(null);
    } catch (failure) {
      setError(failure);
    }
  }, [status]);
  useEffect(() => { load(); }, [load]);
  return (
    <>
      <header className="page-head"><div><p className="eyebrow">Hire purchase</p><h1>Agreements</h1></div></header>
      <div className="toolbar">
        <select aria-label="Filter by status" value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">All agreements</option>{Object.keys(AGREEMENT_LABELS).map(key => <option key={key} value={key}>{AGREEMENT_LABELS[key]}</option>)}
        </select>
      </div>
      <ErrorBanner error={error} />
      {result && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Agreement</th><th>Customer</th><th>Product</th><th>Left to pay</th><th>Next due</th><th>Status</th></tr></thead>
            <tbody>
              {result.items.map(item => {
                const next = item.instalments.find(entry => entry.number === item.nextInstalmentNumber);
                return (
                  <tr key={item.id} onClick={() => go(`agreements/${item.id}`)} className="clickable">
                    <td><a href={`#/agreements/${item.id}`} onClick={e => e.stopPropagation()}><strong>{item.id}</strong></a>{item.attention && <span className="tag warn">needs attention</span>}</td>
                    <td>{item.customer.name}</td>
                    <td>{item.product.title}</td>
                    <td>{formatMoney(item.outstandingMinor, item.currency)}</td>
                    <td>{next?.dueDate ?? '—'}{next?.overdue && <span className="tag warn">overdue</span>}</td>
                    <td><span className={`chip ${AGREEMENT_CHIPS[item.status]}`}>{AGREEMENT_LABELS[item.status]}</span></td>
                  </tr>
                );
              })}
              {result.items.length === 0 && <tr><td colSpan={6} className="empty-cell">No agreements yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {result?.nextCursor && <button className="btn ghost" onClick={() => load(result.nextCursor)}>Load more</button>}
    </>
  );
}

function AgreementDetail({ id, can, notify, setReasonRequest }) {
  const [agreement, setAgreement] = useState(null);
  const [error, setError] = useState(null);
  const [method, setMethod] = useState('cash');
  const [note, setNote] = useState('');
  useEffect(() => { api('GET', `/admin/agreements/${id}`).then(setAgreement, setError); }, [id]);
  if (!agreement) return error ? <ErrorBanner error={error} /> : <p className="muted">Loading…</p>;

  const money = amountMinor => formatMoney(amountMinor, agreement.currency);
  const next = agreement.instalments.find(item => item.number === agreement.nextInstalmentNumber);
  async function record(event) {
    event.preventDefault();
    setError(null);
    try {
      setAgreement(await api('POST', `/admin/agreements/${id}/payments`, { method, note, expectedVersion: agreement.version }));
      setNote('');
      notify('Payment recorded');
    } catch (failure) {
      setError(failure);
    }
  }
  const end = () => setReasonRequest({
    title: 'End this agreement',
    description: 'This only records that it ended, and the customer can no longer pay through the site. Handle the goods, refunds and anything owed separately, on legal advice.',
    confirmLabel: 'End agreement',
    onConfirm: async reason => {
      setAgreement(await api('POST', `/admin/agreements/${id}/cancel`, { reason, expectedVersion: agreement.version }));
      notify('Agreement ended');
    },
  });
  const { figures } = agreement;
  return (
    <>
      <header className="page-head">
        <div>
          <a className="back" href="#/agreements"><ArrowLeft size={15} /> Agreements</a>
          <h1>{agreement.id}</h1>
          <div className="row">
            <span className={`chip ${AGREEMENT_CHIPS[agreement.status]}`}>{AGREEMENT_LABELS[agreement.status]}</span>
            <span className="muted small">{agreement.product.title} · accepted {formatDate(agreement.acceptedAt)}</span>
          </div>
        </div>
        {agreement.status === 'active' && can('applications:decide') && <button className="btn ghost" onClick={end}>End agreement</button>}
      </header>
      <ErrorBanner error={error} />
      {agreement.attention && <div className="banner warn"><AlertTriangle size={18} /><div><strong>Needs attention.</strong> <span>{AGREEMENT_ATTENTION[agreement.attention] ?? agreement.attention}</span></div></div>}
      <div className="editor-grid">
        <section className="panel">
          <h2>Instalments</h2>
          <div className="table-wrap flush">
            <table>
              <thead><tr><th>No.</th><th>Due</th><th>Amount</th><th>Status</th><th>How paid</th></tr></thead>
              <tbody>
                {agreement.instalments.map(item => (
                  <tr key={item.number}>
                    <td>{item.number}</td>
                    <td>{item.dueDate ?? 'After deposit'}</td>
                    <td>{money(item.amountMinor)}</td>
                    <td>{item.status === 'paid' ? `Paid ${formatDate(item.paidAt)}` : item.overdue ? <span className="tag warn">overdue</span> : 'To pay'}</td>
                    <td className="muted">{PAYMENT_METHODS[item.paymentMethod] ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <details className="small"><summary>Agreement wording they accepted (version {agreement.terms.version})</summary><p className="pre-line">{agreement.terms.wording}</p></details>
        </section>
        <aside className="stack">
          {agreement.status === 'active' && next && can('agreements:payments') && (
            <form className="panel stack" onSubmit={record}>
              <h2>Record a payment</h2>
              <p className="muted small">For money taken outside Paystack. This marks instalment {next.number} ({money(next.amountMinor)}) as paid in full.</p>
              <Field label="How they paid">
                <select value={method} onChange={e => setMethod(e.target.value)}>
                  {['cash', 'mobile_money', 'bank_transfer', 'other'].map(key => <option key={key} value={key}>{PAYMENT_METHODS[key]}</option>)}
                </select>
              </Field>
              <Field label="Receipt or reference"><input required maxLength={300} value={note} onChange={e => setNote(e.target.value)} /></Field>
              <div className="row end"><button className="btn primary">Record {money(next.amountMinor)}</button></div>
            </form>
          )}
          <section className="panel">
            <h2>Customer</h2>
            <p>{agreement.customer.name}<br /><a className="link" href={`tel:${agreement.customer.phone.replace(/\s/g, '')}`}>{agreement.customer.phone}</a><br /><a className="link" href={`mailto:${agreement.customer.email}`}>{agreement.customer.email}</a></p>
            {can('applications:read') && <a className="link small" href={`#/applications/${agreement.applicationId}`}>Open their application</a>}
          </section>
          <section className="panel">
            <h2>{agreement.plan.name}</h2>
            <dl className="store-status">
              <div><dt>Cash price</dt><dd>{money(figures.cashPriceMinor)}</dd></div>
              <div><dt>Hire charge</dt><dd>{money(figures.chargeMinor)}</dd></div>
              <div><dt>Hire purchase price</dt><dd>{money(figures.hirePurchasePriceMinor)}</dd></div>
              <div><dt>Deposit</dt><dd>{money(figures.depositMinor)}</dd></div>
              <div><dt>Left to pay</dt><dd>{money(agreement.outstandingMinor)}</dd></div>
            </dl>
            {can('orders:read') && <a className="link small" href={`#/orders/${agreement.orderReference}`}>Deposit and delivery: {agreement.orderReference}</a>}
          </section>
          {agreement.cancelNote && <section className="panel"><h2>Why it ended</h2><p className="small">{agreement.cancelNote}</p></section>}
        </aside>
      </div>
    </>
  );
}

function AuditLog() {
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const load = useCallback(async cursor => {
    try {
      const data = await api('GET', `/admin/audit-events?limit=50${cursor ? `&cursor=${cursor}` : ''}`);
      setResult(prev => (cursor ? { items: [...prev.items, ...data.items], nextCursor: data.nextCursor } : data));
    } catch (failure) {
      setError(failure);
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  const summarise = event => {
    const parts = [];
    if (event.before && event.after) {
      for (const key of new Set([...Object.keys(event.before), ...Object.keys(event.after)])) {
        const a = JSON.stringify(event.before[key]);
        const b = JSON.stringify(event.after[key]);
        if (a !== b && a?.length < 60 && b?.length < 60) parts.push(`${key}: ${a ?? '—'} → ${b ?? '—'}`);
      }
    }
    if (event.metadata?.reason) parts.push(`reason: ${event.metadata.reason}`);
    return parts.slice(0, 4).join(' · ');
  };
  return (
    <>
      <header className="page-head"><div><p className="eyebrow">Audit log</p><h1>Every change, on record</h1></div></header>
      <ErrorBanner error={error} />
      <div className="table-wrap">
        <table>
          <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Resource</th><th>Detail</th></tr></thead>
          <tbody>
            {result?.items.map(event => (
              <tr key={event.id}>
                <td className="muted nowrap">{formatDate(event.createdAt)}</td>
                <td>{event.actorName ?? event.actorType}</td>
                <td><code>{event.action}</code></td>
                <td className="muted">{event.resourceType}{event.resourceId && <span className="sub">{event.resourceId}</span>}</td>
                <td className="small">{summarise(event)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {result?.nextCursor && <button className="btn ghost" onClick={() => load(result.nextCursor)}>Load more</button>}
    </>
  );
}

/* ---------- shell ---------- */

function Shell({ me, onSignOut }) {
  const route = useHashRoute();
  const [toast, setToast] = useState('');
  const [categories, setCategories] = useState([]);
  const [currency, setCurrency] = useState(null);
  const [reasonRequest, setReasonRequest] = useState(null);
  const can = permission => me.permissions.includes(permission);
  const [section, id] = route.split('/');

  useEffect(() => { api('GET', '/admin/categories').then(setCategories, () => {}); }, []);
  useEffect(() => { api('GET', '/admin/dashboard').then(d => setCurrency(d.storeCurrency), () => {}); }, []);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 3000); return () => clearTimeout(t); }, [toast]);

  const visible = NAV.filter(item => can(item.permission));
  const allowed = visible.find(item => item.path === section);
  let page;
  if (!allowed) page = <div className="panel"><h1>Not available</h1><p className="muted">You do not have access to this area.</p></div>;
  else if (section === 'dashboard') page = <Dashboard can={can} />;
  else if (section === 'products' && id) page = <ProductEditor key={id} id={id} categories={categories} can={can} notify={setToast} currency={currency}setReasonRequest={setReasonRequest} />;
  else if (section === 'products') page = <ProductList categories={categories} />;
  else if (section === 'inventory') page = <Inventory can={can} notify={setToast} />;
  else if (section === 'staff') page = <Staff me={me} notify={setToast} setReasonRequest={setReasonRequest} />;
  else if (section === 'orders' && id) page = <OrderDetail reference={id} can={can} notify={setToast} setReasonRequest={setReasonRequest} />;
  else if (section === 'orders') page = <Orders />;
  else if (section === 'applications' && id) page = <ApplicationDetail key={id} id={id} me={me} can={can} currency={currency} notify={setToast} setReasonRequest={setReasonRequest} />;
  else if (section === 'applications') page = <Applications />;
  else if (section === 'agreements' && id) page = <AgreementDetail key={id} id={id} can={can} notify={setToast} setReasonRequest={setReasonRequest} />;
  else if (section === 'agreements') page = <Agreements />;
  else if (section === 'settings') page = <SettingsPage notify={setToast} onCurrencyChange={setCurrency} />;
  else if (section === 'audit') page = <AuditLog />;

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">s<span>.</span></span><span>SIGNATURE<small>Admin</small></span></div>
        <nav aria-label="Admin sections">
          {visible.map(({ path, label, icon: Icon }) => (
            <a key={path} href={`#/${path}`} className={section === path ? 'active' : ''} aria-current={section === path ? 'page' : undefined}><Icon size={18} strokeWidth={1.6} /><span>{label}</span></a>
          ))}
        </nav>
        <div className="me">
          <strong>{me.displayName}</strong>
          <span>{me.roles.map(r => ROLE_LABELS[r]).join(', ')}</span>
          <button className="link small" onClick={onSignOut}><LogOut size={14} /> Sign out</button>
        </div>
      </aside>
      <main className="content">
        <div className="env-strip">Local environment · Illustrative fixtures</div>
        {page}
      </main>
      <Toast message={toast} />
      <ReasonDialog request={reasonRequest} onClose={() => setReasonRequest(null)} />
    </div>
  );
}

function App() {
  const route = useHashRoute();
  const [me, setMe] = useState(undefined);
  useEffect(() => {
    api('GET', '/admin/auth/session').then(data => { setCsrfToken(data.csrfToken); setMe(data.staff); }, () => setMe(null));
  }, []);
  async function signOut() {
    await api('POST', '/admin/auth/logout', {}).catch(() => {});
    setCsrfToken('');
    setMe(null);
  }
  if (route.startsWith('accept-invite')) return <AcceptInvite />;
  if (me === undefined) return <main className="auth"><p className="muted">Loading…</p></main>;
  if (!me) return <Login onSignedIn={setMe} />;
  return <Shell me={me} onSignOut={signOut} />;
}

createRoot(document.getElementById('root')).render(<App />);
