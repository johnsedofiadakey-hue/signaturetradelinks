// The applicant's side of hire purchase. Each customer has one application, and sees only their own answers and status.
// Staff notes, recommendations and decline reasons never appear in these responses.
import { APPLICATION_EDITABLE, APPLICATION_WITHDRAWABLE, ASSESSMENT_DOCUMENTS } from '../../../shared/assessment.js';
import { approvalActive, applicationRef, cleanSection, expectVersion, loadApplication, loadApplicationTerms, submissionErrors } from '../applications.js';
import { recordAudit } from '../audit.js';
import { RateLimiter } from '../auth.js';
import { requireCustomer } from '../customers.js';
import { MAX_DOCUMENT_BYTES, sniffType } from '../documents.js';
import { newId, now, sortKey, transaction } from '../firestore.js';
import { fail, readRaw } from '../http.js';
import { SLUG, int, nullable, str, validate } from '../validate.js';

const account = application => ({
  active: approvalActive(application),
  limitMinor: application.decision.limitMinor,
  currency: application.decision.currency,
  validUntil: application.decision.validUntil,
  conditions: application.decision.conditions,
  approvedAt: application.decision.decidedAt,
});

// Where a file is stored is never sent to a browser.
export const documentsDto = application => Object.fromEntries(Object.entries(application.documents ?? {}).map(([id, { contentType, size, uploadedAt }]) => [id, { contentType, size, uploadedAt }]));

const applicationDto = application => application && ({
  status: application.status,
  version: application.version,
  email: application.email,
  sections: application.sections,
  documents: documentsDto(application),
  productSlug: application.productSlug ?? null,
  informationRequest: application.status === 'needs_information' ? application.informationRequest : null,
  submittedAt: application.submittedAt ?? null,
  updatedAt: application.updatedAt,
  account: application.status === 'approved' ? account(application) : null,
});

// A customer has no staff record, so their changes are audited as system events marked with who acted. Answers are never copied here.
const auditCustomer = (ctx, tx, action, uid, before, after) => recordAudit(ctx.db, tx, {
  action, resourceType: 'hp_application', resourceId: uid, before: { status: before }, after: { status: after }, metadata: { by: 'customer' }, requestId: ctx.requestId,
});

export function registerHirePurchase(route, customerAuth, documents) {
  const documentType = id => {
    const type = ASSESSMENT_DOCUMENTS.find(candidate => candidate.id === id);
    if (!type) fail('not_found', 'Unknown document.');
    return type;
  };

  route('GET', '/hire-purchase/options', async ctx => {
    const { open, privacyNotice, privacyVersion, declaration, declarationVersion, currency } = await loadApplicationTerms(ctx.db);
    return { data: open ? { open, privacyNotice, privacyVersion, declaration, declarationVersion, currency } : { open } };
  }, { skipBody: true });

  route('GET', '/me/hire-purchase/application', async ctx => {
    const customer = await requireCustomer(ctx, customerAuth);
    return { data: applicationDto(await loadApplication(ctx.db, customer.uid)) };
  }, { skipBody: true });

  // Saves one section. The first save creates the application; nobody on the team can see it until it is submitted.
  route('PATCH', '/me/hire-purchase/application', async ctx => {
    const customer = await requireCustomer(ctx, customerAuth);
    const input = validate(ctx.body, {
      section: str({ max: 40 }),
      values: value => (value && typeof value === 'object' && !Array.isArray(value) ? { value } : { error: 'Must be an object.' }),
      productSlug: nullable(str({ max: 120, pattern: SLUG })),
      expectedVersion: int({ min: 0 }),
    }, { optional: ['productSlug'] });
    const values = cleanSection(input.section, input.values);
    const saved = await transaction(ctx.db, async tx => {
      const terms = await loadApplicationTerms(ctx.db, tx);
      const application = await loadApplication(ctx.db, customer.uid, tx);
      if (!terms.open) fail('commercial_setting_missing', 'Applications are not open yet.');
      expectVersion(application, input.expectedVersion);
      if (application && !APPLICATION_EDITABLE.includes(application.status)) fail('invalid_transition', 'This application cannot be changed right now.');
      const at = now();
      const next = {
        ...(application ?? { uid: customer.uid, status: 'draft', sections: {}, createdAt: at }),
        email: customer.email,
        sections: { ...application?.sections, [input.section]: values },
        productSlug: input.productSlug ?? application?.productSlug ?? null,
        version: (application?.version ?? 0) + 1,
        updatedAt: at,
      };
      tx.set(applicationRef(ctx.db, customer.uid), next);
      return next;
    });
    return { data: applicationDto(saved) };
  });

  route('POST', '/me/hire-purchase/application/submit', async ctx => {
    const customer = await requireCustomer(ctx, customerAuth);
    const input = validate(ctx.body, { expectedVersion: int({ min: 1 }), privacyVersion: int({ min: 1 }), declarationVersion: int({ min: 1 }) });
    const submitted = await transaction(ctx.db, async tx => {
      const terms = await loadApplicationTerms(ctx.db, tx);
      const application = await loadApplication(ctx.db, customer.uid, tx);
      if (!terms.open) fail('commercial_setting_missing', 'Applications are not open yet.');
      if (!application) fail('not_found', 'Start your application first.');
      expectVersion(application, input.expectedVersion);
      if (!APPLICATION_EDITABLE.includes(application.status)) fail('invalid_transition', 'This application has already been submitted.');
      // They must have agreed to the wording in force now, so a change while they were filling in the form means reading it again.
      if (input.privacyVersion !== terms.privacyVersion || input.declarationVersion !== terms.declarationVersion) {
        fail('stale_version', 'The terms were updated. Please read them again and confirm.');
      }
      const fieldErrors = submissionErrors(application);
      if (Object.keys(fieldErrors).length) fail('validation_failed', 'Some details need attention.', { fieldErrors });
      const at = now();
      const next = {
        ...application,
        status: 'submitted',
        email: customer.email,
        submittedAt: at,
        sortKey: sortKey(at, customer.uid),
        informationRequest: null,
        review: null,
        // A record of exactly what they agreed to and when.
        consent: { privacyNotice: terms.privacyNotice, privacyVersion: terms.privacyVersion, declaration: terms.declaration, declarationVersion: terms.declarationVersion, acceptedAt: at },
        version: application.version + 1,
        updatedAt: at,
      };
      tx.set(applicationRef(ctx.db, customer.uid), next);
      auditCustomer(ctx, tx, 'application.submitted', customer.uid, application.status, 'submitted');
      return next;
    });
    return { data: applicationDto(submitted) };
  });

  route('POST', '/me/hire-purchase/application/withdraw', async ctx => {
    const customer = await requireCustomer(ctx, customerAuth);
    const input = validate(ctx.body, { expectedVersion: int({ min: 1 }) });
    const withdrawn = await transaction(ctx.db, async tx => {
      const application = await loadApplication(ctx.db, customer.uid, tx);
      if (!application) fail('not_found', 'There is no application to withdraw.');
      expectVersion(application, input.expectedVersion);
      if (!APPLICATION_WITHDRAWABLE.includes(application.status)) fail('invalid_transition', 'This application can no longer be withdrawn.');
      const next = { ...application, status: 'withdrawn', version: application.version + 1, updatedAt: now() };
      tx.set(applicationRef(ctx.db, customer.uid), next);
      auditCustomer(ctx, tx, 'application.withdrawn', customer.uid, application.status, 'withdrawn');
      return next;
    });
    return { data: applicationDto(withdrawn) };
  });

  // Someone who withdrew can pick it back up. A declined application is reopened only by staff.
  route('POST', '/me/hire-purchase/application/reopen', async ctx => {
    const customer = await requireCustomer(ctx, customerAuth);
    const input = validate(ctx.body, { expectedVersion: int({ min: 1 }) });
    const reopened = await transaction(ctx.db, async tx => {
      const application = await loadApplication(ctx.db, customer.uid, tx);
      if (!application) fail('not_found', 'There is no application to reopen.');
      expectVersion(application, input.expectedVersion);
      if (application.status !== 'withdrawn') fail('invalid_transition', 'Only a withdrawn application can be restarted.');
      const next = { ...application, status: 'draft', version: application.version + 1, updatedAt: now() };
      tx.set(applicationRef(ctx.db, customer.uid), next);
      auditCustomer(ctx, tx, 'application.restarted', customer.uid, 'withdrawn', 'draft');
      return next;
    });
    return { data: applicationDto(reopened) };
  });

  // The file itself is the request body. It's checked by content and stored privately under a new name.
  route('PUT', '/me/hire-purchase/application/documents/:type', async ctx => {
    const customer = await requireCustomer(ctx, customerAuth);
    const type = documentType(ctx.params.type);
    const limiter = new RateLimiter(ctx.db, { name: 'hp-upload', limit: 60, windowMs: 60 * 60_000 });
    await limiter.check(customer.uid);
    const bytes = await readRaw(ctx.req, MAX_DOCUMENT_BYTES);
    const contentType = sniffType(bytes);
    if (!contentType || (contentType === 'application/pdf' && !type.pdf)) {
      fail('validation_failed', 'Some details need attention.', { fieldErrors: { file: type.pdf ? 'Use a photo or a PDF.' : 'Use a photo (JPEG, PNG or WebP).' } });
    }
    const opening = await loadApplicationTerms(ctx.db);
    if (!opening.open) fail('commercial_setting_missing', 'Applications are not open yet.');
    await limiter.record(customer.uid);
    const path = `hp-documents/${customer.uid}/${type.id}-${newId('doc')}`;
    await documents.save(path, bytes, contentType);
    let replaced = null;
    let saved;
    try {
      saved = await transaction(ctx.db, async tx => {
        const application = await loadApplication(ctx.db, customer.uid, tx);
        if (application && !APPLICATION_EDITABLE.includes(application.status)) fail('invalid_transition', 'This application cannot be changed right now.');
        const at = now();
        replaced = application?.documents?.[type.id]?.path ?? null;
        const next = {
          ...(application ?? { uid: customer.uid, status: 'draft', sections: {}, createdAt: at, version: 0 }),
          email: customer.email,
          documents: { ...application?.documents, [type.id]: { path, contentType, size: bytes.length, uploadedAt: at } },
          updatedAt: at,
        };
        next.version += 1;
        tx.set(applicationRef(ctx.db, customer.uid), next);
        return next;
      });
    } catch (error) {
      await documents.remove(path);
      throw error;
    }
    if (replaced) await documents.remove(replaced);
    return { data: applicationDto(saved) };
  }, { skipBody: true });

  route('DELETE', '/me/hire-purchase/application/documents/:type', async ctx => {
    const customer = await requireCustomer(ctx, customerAuth);
    const type = documentType(ctx.params.type);
    let removed = null;
    const saved = await transaction(ctx.db, async tx => {
      const application = await loadApplication(ctx.db, customer.uid, tx);
      if (!application?.documents?.[type.id]) fail('not_found', 'That document is not on your application.');
      if (!APPLICATION_EDITABLE.includes(application.status)) fail('invalid_transition', 'This application cannot be changed right now.');
      const { [type.id]: gone, ...rest } = application.documents;
      removed = gone.path;
      const next = { ...application, documents: rest, version: application.version + 1, updatedAt: now() };
      tx.set(applicationRef(ctx.db, customer.uid), next);
      return next;
    });
    await documents.remove(removed);
    return { data: applicationDto(saved) };
  }, { skipBody: true });

  route('GET', '/me/hire-purchase/application/documents/:type', async ctx => {
    const customer = await requireCustomer(ctx, customerAuth);
    const type = documentType(ctx.params.type);
    const stored = (await loadApplication(ctx.db, customer.uid))?.documents?.[type.id];
    if (!stored) fail('not_found', 'That document is not on your application.');
    return { file: { bytes: await documents.read(stored.path), contentType: stored.contentType } };
  }, { skipBody: true });

  // The gate for buying: only someone with a current approval gets their account back.
  route('GET', '/me/hire-purchase/account', async ctx => {
    const customer = await requireCustomer(ctx, customerAuth);
    const application = await loadApplication(ctx.db, customer.uid);
    if (!approvalActive(application)) fail('not_approved', 'Your hire purchase account is not approved.');
    return { data: account(application) };
  }, { skipBody: true });
}
