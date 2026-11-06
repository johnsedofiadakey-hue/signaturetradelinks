import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { C } from '../src/firestore.js';
import { ownerClient, staffClient, startTestServer } from './helpers.js';

const SECTIONS = {
  identity: { fullName: 'Ama Mensah', dateOfBirth: '1990-04-12', gender: 'female', ghanaCardPin: 'gha-123456789-0' },
  contact: { phone: '024 123 4567', momoNumber: '024 123 4567' },
  residence: { digitalAddress: 'GA-183-8164', region: 'Greater Accra', town: 'Accra', area: 'Osu', residentialStatus: 'renting', timeAtAddress: '1_to_3_years' },
  employment: { employmentType: 'private_salaried', employer: 'Acme Ltd', workLocation: 'Accra', jobTitle: 'Accountant', startDate: '2021-03', monthlyIncomeMinor: 500000 },
  commitments: { hasExistingCredit: 'no' },
  guarantor: { name: 'Kofi Mensah', ghanaCardPin: 'GHA-987654321-0', phone: '020 123 4567', relationship: 'Brother', occupation: 'Teacher' },
};
const CHECKS = { identity_confirmed: true, address_confirmed: true, employment_confirmed: true, income_reviewed: true, commitments_reviewed: true, guarantor_contacted: false };
const FUTURE = '2999-12-31';

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]);
const PDF = Buffer.from('%PDF-1.7 test file');
const REQUIRED_DOCUMENTS = ['ghana_card_front', 'ghana_card_back', 'selfie', 'income_1'];

let server;
let owner;
let assessor;
let approver;
const sentTo = [];
let emailWorks = true;
// Tokens here are just "uid:email:verified", so tests can act as any customer without Firebase.
const customerAuth = {
  async verifyIdToken(token) {
    const [uid, email, verified] = token.split(':');
    if (!uid || !email) throw new Error('bad token');
    return { uid, email, email_verified: verified !== 'unverified' };
  },
};
const stored = new Map();
const documents = {
  async save(path, bytes, contentType) { stored.set(path, { bytes, contentType }); },
  async read(path) { return stored.get(path).bytes; },
  async remove(path) { stored.delete(path); },
};
const signInEmail = { async send(email) { sentTo.push(email); return emailWorks ? { sent: true } : { sent: false, reason: 'refused' }; } };

function customer(uid, email = `${uid}@example.test`, verified = 'verified') {
  const request = async (method, path, body) => {
    const response = await fetch(`${server.base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${uid}:${email}:${verified}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  };
  const upload = async (type, bytes) => {
    const response = await fetch(`${server.base}/me/hire-purchase/application/documents/${type}`, { method: 'PUT', headers: { Authorization: `Bearer ${uid}:${email}:${verified}`, 'Content-Type': 'application/octet-stream' }, body: bytes });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  };
  return { request, upload, get: path => request('GET', path), patch: (path, body) => request('PATCH', path, body), post: (path, body) => request('POST', path, body) };
}

const setSetting = async (key, value) => {
  const settings = await owner.get('/admin/settings');
  const { version } = settings.body.data.find(setting => setting.key === key);
  const result = await owner.put(`/admin/settings/${key}`, { value, expectedVersion: version });
  assert.equal(result.status, 200, JSON.stringify(result.body));
};

async function fill(person) {
  let version = (await person.get('/me/hire-purchase/application')).body.data?.version ?? 0;
  for (const [section, values] of Object.entries(SECTIONS)) {
    const saved = await person.patch('/me/hire-purchase/application', { section, values, expectedVersion: version });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    version = saved.body.data.version;
  }
  return version;
}

async function submit(person) {
  await fill(person);
  let version;
  for (const type of REQUIRED_DOCUMENTS) {
    const uploaded = await person.upload(type, type === 'income_1' ? PDF : JPEG);
    assert.equal(uploaded.status, 200, JSON.stringify(uploaded.body));
    version = uploaded.body.data.version;
  }
  const { body: { data: terms } } = await person.get('/hire-purchase/options');
  const submitted = await person.post('/me/hire-purchase/application/submit', { expectedVersion: version, privacyVersion: terms.privacyVersion, declarationVersion: terms.declarationVersion });
  assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
  return submitted.body.data;
}

/** Take a submitted application through to "waiting for a decision", and return its version. */
async function recommend(uid, version, recommendation = 'approve') {
  const started = await assessor.client.post(`/admin/applications/${uid}/start-review`, { expectedVersion: version });
  assert.equal(started.status, 200, JSON.stringify(started.body));
  const reviewed = await assessor.client.put(`/admin/applications/${uid}/review`, { checks: CHECKS, recommendation, note: 'Payslips look right.', expectedVersion: started.body.data.version });
  assert.equal(reviewed.status, 200, JSON.stringify(reviewed.body));
  return reviewed.body.data.version;
}

before(async () => {
  server = await startTestServer({ customerAuth, signInEmail, documents });
  owner = await ownerClient(server.base);
  assessor = await staffClient(server.base, owner, { email: 'assessor@example.test', roles: ['assessor'] });
  approver = await staffClient(server.base, owner, { email: 'approver@example.test', roles: ['approver'] });
});
after(() => server.close());

test('applications stay closed, and collect nothing, until the owner sets the wording', async () => {
  assert.deepEqual((await customer('early').get('/hire-purchase/options')).body.data, { open: false });
  const saved = await customer('early').patch('/me/hire-purchase/application', { section: 'contact', values: { phone: '024 123 4567' }, expectedVersion: 0 });
  assert.equal(saved.status, 422);
  assert.equal(saved.body.error.code, 'commercial_setting_missing');
  assert.equal((await server.db.collection(C.hpApplications).doc('early').get()).exists, false);

  await setSetting('store.currency', 'GHS');
  await setSetting('hirePurchase.privacyNotice', 'Test privacy notice.');
  await setSetting('hirePurchase.declaration', 'Test declaration.');
  const open = (await customer('early').get('/hire-purchase/options')).body.data;
  assert.equal(open.open, true);
  assert.equal(open.declaration, 'Test declaration.');
  assert.equal(open.currency, 'GHS');
});

test('customer routes need a signed-in customer with a confirmed email', async () => {
  const anonymous = await fetch(`${server.base}/me/hire-purchase/application`);
  assert.equal(anonymous.status, 401);
  const bad = await fetch(`${server.base}/me/hire-purchase/application`, { headers: { Authorization: 'Bearer nonsense' } });
  assert.equal(bad.status, 401);
  assert.equal((await customer('nope', 'nope@example.test', 'unverified').get('/me/hire-purchase/application')).status, 403);
  // A staff session is not a customer sign-in.
  assert.equal((await owner.get('/me/hire-purchase/application')).status, 401);
  assert.equal((await customer('fresh').get('/me/hire-purchase/application')).body.data, null);
});

test('drafts save section by section, tolerate blanks, and refuse anything invalid', async () => {
  const person = customer('drafter');
  const first = await person.patch('/me/hire-purchase/application', { section: 'identity', values: { fullName: 'Ama', ghanaCardPin: 'gha-123456789-0' }, expectedVersion: 0, productSlug: 'test-tv' });
  assert.equal(first.status, 200);
  assert.equal(first.body.data.status, 'draft');
  assert.equal(first.body.data.sections.identity.ghanaCardPin, 'GHA-123456789-0', 'the PIN is stored in the printed form');
  assert.equal(first.body.data.productSlug, 'test-tv');

  const badPin = await person.patch('/me/hire-purchase/application', { section: 'identity', values: { ghanaCardPin: 'GHA-99' }, expectedVersion: 1 });
  assert.equal(badPin.status, 422);
  assert.ok(badPin.body.error.fieldErrors.ghanaCardPin);
  assert.ok(!JSON.stringify(badPin.body).includes('GHA-99'), 'errors do not echo the number back');

  assert.equal((await person.patch('/me/hire-purchase/application', { section: 'nonsense', values: {}, expectedVersion: 1 })).status, 422);
  assert.equal((await person.patch('/me/hire-purchase/application', { section: 'identity', values: { extra: 'x' }, expectedVersion: 1 })).status, 422);
  assert.equal((await person.patch('/me/hire-purchase/application', { section: 'contact', values: {}, expectedVersion: 0 })).body.error.code, 'stale_version');

  // An answer to a question that no longer applies is dropped.
  const dropped = await person.patch('/me/hire-purchase/application', { section: 'commitments', values: { hasExistingCredit: 'no', monthlyCommitmentsMinor: 5000 }, expectedVersion: 1 });
  assert.equal(dropped.body.data.sections.commitments.monthlyCommitmentsMinor, null);
});

test('submitting needs every required answer, a real adult, a different guarantor and the current wording', async () => {
  const person = customer('submitter');
  const partial = await person.patch('/me/hire-purchase/application', { section: 'contact', values: SECTIONS.contact, expectedVersion: 0 });
  const terms = (await person.get('/hire-purchase/options')).body.data;
  const accept = version => ({ expectedVersion: version, privacyVersion: terms.privacyVersion, declarationVersion: terms.declarationVersion });
  const incomplete = await person.post('/me/hire-purchase/application/submit', accept(partial.body.data.version));
  assert.equal(incomplete.status, 422);
  assert.ok(incomplete.body.error.fieldErrors['identity.fullName']);
  assert.ok(incomplete.body.error.fieldErrors['guarantor.phone']);
  assert.equal(incomplete.body.error.fieldErrors['identity.cagdStaffId'], undefined);

  let version = await (async () => { await server.db.collection(C.hpApplications).doc('submitter').delete(); return fill(person); })();
  const minor = await person.patch('/me/hire-purchase/application', { section: 'identity', values: { ...SECTIONS.identity, dateOfBirth: new Date().toISOString().slice(0, 10) }, expectedVersion: version });
  version = minor.body.data.version;
  assert.ok((await person.post('/me/hire-purchase/application/submit', accept(version))).body.error.fieldErrors['identity.dateOfBirth']);

  const self = await person.patch('/me/hire-purchase/application', { section: 'identity', values: { ...SECTIONS.identity, ghanaCardPin: SECTIONS.guarantor.ghanaCardPin }, expectedVersion: version });
  version = self.body.data.version;
  assert.ok((await person.post('/me/hire-purchase/application/submit', accept(version))).body.error.fieldErrors['guarantor.ghanaCardPin']);

  const fixed = await person.patch('/me/hire-purchase/application', { section: 'identity', values: SECTIONS.identity, expectedVersion: version });
  version = fixed.body.data.version;
  const oldWording = await person.post('/me/hire-purchase/application/submit', { ...accept(version), declarationVersion: terms.declarationVersion - 1 || 99 });
  assert.equal(oldWording.body.error.code, 'stale_version');

  const noDocuments = await person.post('/me/hire-purchase/application/submit', accept(version));
  assert.ok(noDocuments.body.error.fieldErrors['documents.selfie'], 'the required photos must be there first');
  for (const type of REQUIRED_DOCUMENTS) version = (await person.upload(type, JPEG)).body.data.version;

  const done = await person.post('/me/hire-purchase/application/submit', accept(version));
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal(done.body.data.status, 'submitted');
  const stored = (await server.db.collection(C.hpApplications).doc('submitter').get()).data();
  assert.equal(stored.consent.declaration, 'Test declaration.', 'the exact wording agreed to is recorded');
  assert.ok(stored.consent.acceptedAt);

  const locked = await person.patch('/me/hire-purchase/application', { section: 'contact', values: SECTIONS.contact, expectedVersion: done.body.data.version });
  assert.equal(locked.body.error.code, 'invalid_transition');
});

test('documents are checked by their content, stay private and can be replaced', async () => {
  const person = customer('uploader');
  assert.equal((await person.upload('nonsense', JPEG)).status, 404);
  assert.ok((await person.upload('selfie', Buffer.from('<html>not a photo</html>'))).body.error.fieldErrors.file, 'a false file type is refused');
  assert.ok((await person.upload('selfie', PDF)).body.error.fieldErrors.file, 'a selfie must be a photo');
  assert.equal((await person.upload('selfie', Buffer.alloc(9 * 1024 * 1024, 0xff))).status, 413);

  const first = await person.upload('selfie', JPEG);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.data.documents.selfie.contentType, 'image/jpeg');
  assert.ok(!JSON.stringify(first.body).includes('hp-documents'), 'where it is stored stays on the server');
  assert.equal((await person.upload('income_1', PDF)).body.data.documents.income_1.contentType, 'application/pdf');

  const own = await fetch(`${server.base}/me/hire-purchase/application/documents/selfie`, { headers: { Authorization: 'Bearer uploader:uploader@example.test:verified' } });
  assert.equal(own.status, 200);
  assert.equal(own.headers.get('content-type'), 'image/jpeg');
  assert.ok(own.headers.get('content-security-policy').includes('sandbox'));
  assert.deepEqual(Buffer.from(await own.arrayBuffer()), JPEG);
  assert.equal((await customer('stranger').get('/me/hire-purchase/application/documents/selfie')).status, 404);
  assert.equal((await fetch(`${server.base}/me/hire-purchase/application/documents/selfie`)).status, 401);
  assert.equal((await assessor.client.get('/admin/applications/uploader/documents/selfie')).status, 404, 'staff cannot open files from a draft');

  const count = stored.size;
  await person.upload('selfie', Buffer.concat([JPEG, JPEG]));
  assert.equal(stored.size, count, 'the old photo is deleted when it is replaced');
  const removed = await person.request('DELETE', '/me/hire-purchase/application/documents/selfie');
  assert.equal(removed.body.data.documents.selfie, undefined);
  assert.equal(stored.size, count - 1);
});

test('staff can open submitted documents, each view is audited, and they lock on submission', async () => {
  const person = customer('filed');
  const submitted = await submit(person);
  assert.equal((await person.upload('selfie', JPEG)).body.error.code, 'invalid_transition');
  assert.equal((await person.request('DELETE', '/me/hire-purchase/application/documents/selfie')).body.error.code, 'invalid_transition');
  assert.ok(submitted.documents.selfie);

  const fulfilment = await staffClient(server.base, owner, { email: 'fulfil-docs@example.test', roles: ['fulfilment'] });
  const headers = cookie => ({ headers: { Cookie: cookie } });
  assert.equal((await fetch(`${server.base}/admin/applications/filed/documents/selfie`, headers(fulfilment.client.cookie))).status, 403);
  const opened = await fetch(`${server.base}/admin/applications/filed/documents/income_1`, headers(assessor.client.cookie));
  assert.equal(opened.status, 200);
  assert.equal(opened.headers.get('content-type'), 'application/pdf');
  const events = await owner.get('/admin/audit-events?resourceType=hp_application&resourceId=filed&limit=50');
  const viewed = events.body.data.items.find(event => event.action === 'application.document_viewed');
  assert.equal(viewed.metadata.document, 'income_1');
  assert.ok((await assessor.client.get('/admin/applications/filed')).body.data.documents.selfie);
});

test('staff never see drafts, and roles limit who can do what', async () => {
  const drafter = customer('quiet-draft');
  await drafter.patch('/me/hire-purchase/application', { section: 'contact', values: SECTIONS.contact, expectedVersion: 0 });
  const list = await assessor.client.get('/admin/applications');
  assert.equal(list.status, 200);
  assert.ok(!list.body.data.items.some(item => item.id === 'quiet-draft'));
  assert.equal((await assessor.client.get('/admin/applications/quiet-draft')).status, 404);

  const submitted = await submit(customer('roles'));
  const fulfilment = await staffClient(server.base, owner, { email: 'fulfil@example.test', roles: ['fulfilment'] });
  assert.equal((await fulfilment.client.get('/admin/applications')).status, 403);
  assert.equal((await fulfilment.client.get('/admin/applications/roles')).status, 403);
  assert.equal((await approver.client.post('/admin/applications/roles/start-review', { expectedVersion: submitted.version })).status, 403, 'approvers do not review');
  assert.equal((await assessor.client.post('/admin/applications/roles/decide', { outcome: 'decline', reason: 'x', expectedVersion: submitted.version })).status, 403, 'assessors do not decide');
  assert.equal((await fetch(`${server.base}/admin/applications`)).status, 401);
});

test('a customer sees status only, never staff notes, recommendations or reasons', async () => {
  const person = customer('private');
  const submitted = await submit(person);
  const version = await recommend('private', submitted.version, 'decline');
  const midway = (await person.get('/me/hire-purchase/application')).body;
  assert.equal(midway.data.status, 'under_review');
  assert.ok(!JSON.stringify(midway).includes('Payslips look right'));
  assert.ok(!JSON.stringify(midway).includes('recommendation'));

  const declined = await approver.client.post('/admin/applications/private/decide', { outcome: 'decline', reason: 'Internal reason text', expectedVersion: version });
  assert.equal(declined.status, 200, JSON.stringify(declined.body));
  const after = (await person.get('/me/hire-purchase/application')).body;
  assert.equal(after.data.status, 'declined');
  assert.ok(!JSON.stringify(after).includes('Internal reason text'));
  assert.equal(after.data.account, null);
  assert.equal((await person.get('/me/hire-purchase/account')).status, 403);
  assert.equal((await person.get('/me/hire-purchase/account')).body.error.code, 'not_approved');
});

test('asking for more information sends it back to the customer, who can fix and resend', async () => {
  const person = customer('moreinfo');
  const submitted = await submit(person);
  const started = await assessor.client.post('/admin/applications/moreinfo/start-review', { expectedVersion: submitted.version });
  const asked = await assessor.client.post('/admin/applications/moreinfo/request-information', { message: 'Please confirm your employer.', expectedVersion: started.body.data.version });
  assert.equal(asked.body.data.status, 'needs_information');
  const seen = (await person.get('/me/hire-purchase/application')).body.data;
  assert.equal(seen.status, 'needs_information');
  assert.equal(seen.informationRequest, 'Please confirm your employer.');

  const edited = await person.patch('/me/hire-purchase/application', { section: 'employment', values: { ...SECTIONS.employment, employer: 'Acme Ghana Ltd' }, expectedVersion: seen.version });
  assert.equal(edited.status, 200);
  const terms = (await person.get('/hire-purchase/options')).body.data;
  const resent = await person.post('/me/hire-purchase/application/submit', { expectedVersion: edited.body.data.version, privacyVersion: terms.privacyVersion, declarationVersion: terms.declarationVersion });
  assert.equal(resent.body.data.status, 'submitted');
  assert.equal(resent.body.data.informationRequest, null);
});

test('approval needs a recommendation from someone else, then opens the account and emails a link', async () => {
  const person = customer('approved', 'Approved@Example.test');
  const submitted = await submit(person);
  const decide = { outcome: 'approve', reason: 'Meets our criteria.', limitMinor: 300000, validUntil: FUTURE, conditions: 'Salary mandate', expectedVersion: submitted.version };
  const early = await approver.client.post('/admin/applications/approved/decide', decide);
  assert.equal(early.body.error.code, 'invalid_transition', 'cannot decide before review');

  const started = await owner.post('/admin/applications/approved/start-review', { expectedVersion: submitted.version });
  const reviewed = await owner.put('/admin/applications/approved/review', { checks: CHECKS, recommendation: 'approve', note: 'Fine.', expectedVersion: started.body.data.version });
  const version = reviewed.body.data.version;
  assert.equal((await approver.client.post('/admin/applications/approved/decide', { ...decide, expectedVersion: version - 1 })).body.error.code, 'stale_version');
  const own = await owner.post('/admin/applications/approved/decide', { ...decide, expectedVersion: version });
  assert.equal(own.status, 409);
  assert.equal(own.body.error.code, 'separation_of_duties', 'even the owner cannot approve their own recommendation');

  assert.equal((await approver.client.post('/admin/applications/approved/decide', { outcome: 'approve', reason: 'x', expectedVersion: version })).status, 422, 'approved amount and validity are required');
  assert.equal((await approver.client.post('/admin/applications/approved/decide', { ...decide, validUntil: '2020-01-01', expectedVersion: version })).status, 422);

  sentTo.length = 0;
  const approved = await approver.client.post('/admin/applications/approved/decide', { ...decide, expectedVersion: version });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  assert.equal(approved.body.data.status, 'approved');
  assert.equal(approved.body.data.decision.currency, 'GHS');
  assert.equal(approved.body.data.notification.status, 'sent');
  assert.deepEqual(sentTo, ['approved@example.test']);

  const opened = await person.get('/me/hire-purchase/account');
  assert.equal(opened.status, 200);
  assert.equal(opened.body.data.limitMinor, 300000);
  assert.equal(opened.body.data.active, true);
  assert.ok(!JSON.stringify(opened.body).includes('Meets our criteria'));
  assert.equal((await person.post('/me/hire-purchase/application/withdraw', { expectedVersion: approved.body.data.version })).body.error.code, 'invalid_transition');
});

test('an expired approval and a reopened one both close the account', async () => {
  const person = customer('lapsing');
  const submitted = await submit(person);
  const version = await recommend('lapsing', submitted.version);
  const approved = await approver.client.post('/admin/applications/lapsing/decide', { outcome: 'approve', reason: 'ok', limitMinor: 1000, validUntil: FUTURE, expectedVersion: version });
  assert.equal((await person.get('/me/hire-purchase/account')).status, 200);

  const ref = server.db.collection(C.hpApplications).doc('lapsing');
  const decision = (await ref.get()).data().decision;
  await ref.update({ decision: { ...decision, validUntil: '2020-01-01' } });
  assert.equal((await person.get('/me/hire-purchase/account')).status, 403);
  assert.equal((await person.get('/me/hire-purchase/application')).body.data.account.active, false);
  await ref.update({ decision });
  assert.equal((await person.get('/me/hire-purchase/account')).status, 200);

  assert.equal((await assessor.client.post('/admin/applications/lapsing/reopen', { reason: 'x', expectedVersion: approved.body.data.version })).status, 403);
  const reopened = await approver.client.post('/admin/applications/lapsing/reopen', { reason: 'New information.', expectedVersion: approved.body.data.version });
  assert.equal(reopened.status, 200);
  assert.equal(reopened.body.data.status, 'under_review');
  assert.equal(reopened.body.data.decision, null);
  assert.equal(reopened.body.data.previousDecision.reopenReason, 'New information.');
  assert.equal((await person.get('/me/hire-purchase/account')).status, 403);
});

test('a failed email does not undo the approval, tells staff, and can be resent', async () => {
  const person = customer('nomail');
  const submitted = await submit(person);
  const version = await recommend('nomail', submitted.version);
  emailWorks = false;
  const approved = await approver.client.post('/admin/applications/nomail/decide', { outcome: 'approve', reason: 'ok', limitMinor: 1000, validUntil: FUTURE, expectedVersion: version });
  emailWorks = true;
  assert.equal(approved.body.data.status, 'approved');
  assert.equal(approved.body.data.notification.status, 'not_sent');
  assert.equal((await person.get('/me/hire-purchase/account')).status, 200, 'they can still sign in with Google');
  const resent = await approver.client.post('/admin/applications/nomail/send-sign-in-link', {});
  assert.equal(resent.body.data.notification.status, 'sent');
  assert.equal((await approver.client.post('/admin/applications/roles/send-sign-in-link', {})).status, 409, 'only approved customers get links');
});

test('staff cannot act on their own application', async () => {
  const person = customer('selfie', 'assessor@example.test');
  const submitted = await submit(person);
  const own = await assessor.client.post('/admin/applications/selfie/start-review', { expectedVersion: submitted.version });
  assert.equal(own.body.error.code, 'separation_of_duties');
});

test('withdrawing stops the review, and the customer can start again', async () => {
  const person = customer('changed-mind');
  const submitted = await submit(person);
  const withdrawn = await person.post('/me/hire-purchase/application/withdraw', { expectedVersion: submitted.version });
  assert.equal(withdrawn.body.data.status, 'withdrawn');
  assert.equal((await assessor.client.post('/admin/applications/changed-mind/start-review', { expectedVersion: withdrawn.body.data.version })).body.error.code, 'invalid_transition');
  const restarted = await person.post('/me/hire-purchase/application/reopen', { expectedVersion: withdrawn.body.data.version });
  assert.equal(restarted.body.data.status, 'draft');
  assert.equal(restarted.body.data.sections.identity.fullName, 'Ama Mensah');
});

test('every view and decision is audited, and no answers reach the audit log', async () => {
  await assessor.client.get('/admin/applications/approved');
  const events = await owner.get('/admin/audit-events?resourceType=hp_application&resourceId=approved&limit=50');
  assert.equal(events.status, 200);
  const actions = events.body.data.items.map(event => event.action);
  for (const action of ['application.viewed', 'application.submitted', 'application.review_started', 'application.recommended', 'application.approved', 'application.sign_in_link']) {
    assert.ok(actions.includes(action), `missing ${action}`);
  }
  const everything = await server.db.collection(C.auditEvents).get();
  const text = JSON.stringify(everything.docs.map(doc => doc.data()));
  assert.ok(!text.includes('GHA-'), 'no Ghana Card numbers');
  assert.ok(!text.includes('Ama Mensah'), 'no names');
  assert.ok(!text.includes('Kofi Mensah'), 'no guarantor details');
});
