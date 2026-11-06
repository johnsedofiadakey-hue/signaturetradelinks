// Staff review of hire-purchase applications. An assessor recommends, an approver or the owner decides, and nobody
// decides on their own recommendation or on their own application. Every view and decision is audited, never the answers.
import { ASSESSMENT_CHECKS, ASSESSMENT_DOCUMENTS } from '../../../shared/assessment.js';
import { APPLICATION_STATUSES } from '../../../shared/contract.js';
import { applicationRef, expectVersion, loadApplication, loadApplicationTerms } from '../applications.js';
import { auditFrom, recordAudit } from '../audit.js';
import { requireStaff } from '../auth.js';
import { C, now, transaction } from '../firestore.js';
import { decodeCursor, encodeCursor, fail, parseLimit } from '../http.js';
import { bool, int, nullable, oneOf, shape, str, validate } from '../validate.js';
import { documentsDto } from './hire-purchase.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const summaryDto = application => ({
  id: application.uid,
  status: application.status,
  name: application.sections?.identity?.fullName ?? null,
  email: application.email,
  employmentType: application.sections?.employment?.employmentType ?? null,
  recommendation: application.review?.recommendation ?? null,
  submittedAt: application.submittedAt ?? null,
  version: application.version,
});

const detailDto = application => ({
  ...summaryDto(application),
  sections: application.sections,
  documents: documentsDto(application),
  productSlug: application.productSlug ?? null,
  consent: application.consent ?? null,
  assessor: application.assessor ?? null,
  informationRequest: application.informationRequest ?? null,
  review: application.review ?? null,
  decision: application.decision ?? null,
  previousDecision: application.previousDecision ?? null,
  notification: application.notification ?? null,
  updatedAt: application.updatedAt,
});

const named = staff => ({ staffId: staff.id, staffName: staff.displayName });

function assertNotOwn(application, staff) {
  if (application.email === staff.email.toLowerCase()) fail('separation_of_duties', 'You cannot act on your own application.');
}

/** Load, check and save an application in one transaction, with its audit event. `change` returns the fields to update and what to audit. */
async function move(ctx, staff, expectedVersion, change) {
  return transaction(ctx.db, async tx => {
    const extra = change.read ? await change.read(tx) : null;
    const application = await loadApplication(ctx.db, ctx.params.id, tx);
    if (!application || application.status === 'draft') fail('not_found', 'Application not found.');
    expectVersion(application, expectedVersion);
    assertNotOwn(application, staff);
    const { fields, action, after = {} } = change.apply(application, extra);
    const next = { ...application, ...fields, version: application.version + 1, updatedAt: now() };
    tx.set(applicationRef(ctx.db, ctx.params.id), next);
    recordAudit(ctx.db, tx, {
      ...auditFrom(ctx, staff), action, resourceType: 'hp_application', resourceId: ctx.params.id,
      before: { status: application.status }, after: { status: next.status, ...after },
    });
    return next;
  });
}

const requireStatus = (application, status, message) => { if (application.status !== status) fail('invalid_transition', message); };

export function registerAdminApplications(route, signInEmail, documents) {
  /** Email the sign-in link and record whether it went. A failure is shown to staff; the approval itself stands either way. */
  async function sendLink(ctx, staff, application) {
    const { sent, reason } = await signInEmail.send(application.email);
    const notification = { kind: 'approval_sign_in_link', status: sent ? 'sent' : 'not_sent', reason: reason ?? null, at: now() };
    await applicationRef(ctx.db, application.uid).update({ notification });
    await recordAudit(ctx.db, null, { ...auditFrom(ctx, staff), action: 'application.sign_in_link', resourceType: 'hp_application', resourceId: application.uid, after: { status: notification.status } });
    return { ...application, notification };
  }

  route('GET', '/admin/applications', async ctx => {
    await requireStaff(ctx, 'applications:read');
    const limit = parseLimit(ctx.query.get('limit'), { fallback: 50, max: 100 });
    const cursor = decodeCursor(ctx.query.get('cursor') ?? undefined, 1);
    const status = ctx.query.get('status');
    if (status && !APPLICATION_STATUSES.includes(status)) fail('validation_failed', 'Unknown status.', { fieldErrors: { status: 'Unknown status.' } });
    // Drafts have no sortKey until first submitted, so this never lists them: staff only ever see what was sent to them.
    let query = ctx.db.collection(C.hpApplications);
    if (status) query = query.where('status', '==', status);
    query = query.orderBy('sortKey', 'desc');
    if (cursor) query = query.startAfter(cursor[0]);
    const snap = await query.limit(limit + 1).get();
    const page = snap.docs.slice(0, limit);
    return {
      data: {
        items: page.map(doc => summaryDto(doc.data())),
        nextCursor: snap.docs.length > limit ? encodeCursor([page.at(-1).data().sortKey]) : null,
      },
    };
  }, { skipBody: true });

  route('GET', '/admin/applications/:id', async ctx => {
    const staff = await requireStaff(ctx, 'applications:read');
    const application = await loadApplication(ctx.db, ctx.params.id);
    if (!application || !application.submittedAt) fail('not_found', 'Application not found.');
    await recordAudit(ctx.db, null, { ...auditFrom(ctx, staff), action: 'application.viewed', resourceType: 'hp_application', resourceId: ctx.params.id });
    return { data: detailDto(application) };
  }, { skipBody: true });

  // Each file a member of staff opens goes in the audit log. Files only reach staff through here, never by a link.
  route('GET', '/admin/applications/:id/documents/:type', async ctx => {
    const staff = await requireStaff(ctx, 'applications:read');
    const application = await loadApplication(ctx.db, ctx.params.id);
    const stored = application?.submittedAt && ASSESSMENT_DOCUMENTS.some(type => type.id === ctx.params.type) ? application.documents?.[ctx.params.type] : null;
    if (!stored) fail('not_found', 'Document not found.');
    const bytes = await documents.read(stored.path);
    await recordAudit(ctx.db, null, { ...auditFrom(ctx, staff), action: 'application.document_viewed', resourceType: 'hp_application', resourceId: ctx.params.id, metadata: { document: ctx.params.type } });
    return { file: { bytes, contentType: stored.contentType } };
  }, { skipBody: true });

  route('POST', '/admin/applications/:id/start-review', async ctx => {
    const staff = await requireStaff(ctx, 'applications:review');
    const { expectedVersion } = validate(ctx.body, { expectedVersion: int({ min: 1 }) });
    const updated = await move(ctx, staff, expectedVersion, {
      apply: application => {
        requireStatus(application, 'submitted', 'Only a newly submitted application can be picked up.');
        return { action: 'application.review_started', fields: { status: 'under_review', assessor: named(staff) } };
      },
    });
    return { data: detailDto(updated) };
  });

  route('POST', '/admin/applications/:id/request-information', async ctx => {
    const staff = await requireStaff(ctx, 'applications:review');
    const input = validate(ctx.body, { message: str({ max: 1000 }), expectedVersion: int({ min: 1 }) });
    const updated = await move(ctx, staff, input.expectedVersion, {
      apply: application => {
        requireStatus(application, 'under_review', 'Pick up the application before asking for information.');
        return { action: 'application.information_requested', fields: { status: 'needs_information', informationRequest: input.message, review: null } };
      },
    });
    return { data: detailDto(updated) };
  });

  route('PUT', '/admin/applications/:id/review', async ctx => {
    const staff = await requireStaff(ctx, 'applications:review');
    const input = validate(ctx.body, {
      checks: shape(Object.fromEntries(ASSESSMENT_CHECKS.map(check => [check.id, bool()]))),
      recommendation: oneOf(['approve', 'decline']),
      note: str({ max: 2000 }),
      expectedVersion: int({ min: 1 }),
    });
    const updated = await move(ctx, staff, input.expectedVersion, {
      apply: application => {
        requireStatus(application, 'under_review', 'Pick up the application before recommending.');
        return {
          action: 'application.recommended',
          after: { recommendation: input.recommendation },
          fields: { review: { ...named(staff), checks: input.checks, recommendation: input.recommendation, note: input.note, recommendedAt: now() } },
        };
      },
    });
    return { data: detailDto(updated) };
  });

  route('POST', '/admin/applications/:id/decide', async ctx => {
    const staff = await requireStaff(ctx, 'applications:decide');
    const input = validate(ctx.body, {
      outcome: oneOf(['approve', 'decline']),
      reason: str({ max: 2000 }),
      limitMinor: int({ min: 1, max: 100_000_000_000 }),
      validUntil: str({ max: 10, pattern: DATE, patternMessage: 'Enter a date.' }),
      conditions: nullable(str({ max: 1000 })),
      expectedVersion: int({ min: 1 }),
    }, { optional: ['limitMinor', 'validUntil', 'conditions'] });
    const approving = input.outcome === 'approve';
    if (approving) {
      const fieldErrors = {};
      if (input.limitMinor === undefined) fieldErrors.limitMinor = 'Enter the approved amount.';
      if (!input.validUntil) fieldErrors.validUntil = 'Enter how long the approval lasts.';
      else if (input.validUntil <= now().slice(0, 10)) fieldErrors.validUntil = 'Choose a date in the future.';
      if (Object.keys(fieldErrors).length) fail('validation_failed', 'Some details need attention.', { fieldErrors });
    }
    const decided = await move(ctx, staff, input.expectedVersion, {
      read: tx => loadApplicationTerms(ctx.db, tx),
      apply: (application, terms) => {
        requireStatus(application, 'under_review', 'This application is not waiting for a decision.');
        if (!application.review) fail('invalid_transition', 'An assessor must make a recommendation first.');
        if (application.review.staffId === staff.id) fail('separation_of_duties', 'Someone other than the person who recommended must decide.');
        if (approving && !terms.currency) fail('commercial_setting_missing', 'Set the store currency first.');
        const decision = {
          ...named(staff),
          outcome: input.outcome,
          reason: input.reason,
          limitMinor: approving ? input.limitMinor : null,
          currency: approving ? terms.currency : null,
          validUntil: approving ? input.validUntil : null,
          conditions: approving ? input.conditions ?? null : null,
          decidedAt: now(),
        };
        return {
          action: approving ? 'application.approved' : 'application.declined',
          after: { limitMinor: decision.limitMinor, validUntil: decision.validUntil },
          fields: { status: approving ? 'approved' : 'declined', decision },
        };
      },
    });
    return { data: detailDto(approving ? await sendLink(ctx, staff, decided) : decided) };
  });

  // Sends a new link, for when the first expired or could not be sent.
  route('POST', '/admin/applications/:id/send-sign-in-link', async ctx => {
    const staff = await requireStaff(ctx, 'applications:decide');
    const application = await loadApplication(ctx.db, ctx.params.id);
    if (!application?.submittedAt) fail('not_found', 'Application not found.');
    requireStatus(application, 'approved', 'Only an approved customer can be sent a sign-in link.');
    return { data: detailDto(await sendLink(ctx, staff, application)) };
  });

  // Back to review. This takes away an approved customer's access straight away, and the earlier decision is kept for reference.
  route('POST', '/admin/applications/:id/reopen', async ctx => {
    const staff = await requireStaff(ctx, 'applications:decide');
    const input = validate(ctx.body, { reason: str({ max: 1000 }), expectedVersion: int({ min: 1 }) });
    const updated = await move(ctx, staff, input.expectedVersion, {
      apply: application => {
        if (!['approved', 'declined'].includes(application.status)) fail('invalid_transition', 'Only a decided application can be reopened.');
        return {
          action: 'application.reopened',
          fields: { status: 'under_review', review: null, decision: null, notification: null, previousDecision: { ...application.decision, reopenedBy: named(staff), reopenReason: input.reason, reopenedAt: now() } },
        };
      },
    });
    return { data: detailDto(updated) };
  });
}
