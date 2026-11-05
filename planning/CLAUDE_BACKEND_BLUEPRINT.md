# Signature Trade Links — backend and admin blueprint

Prepared 5 November 2026. This document is an implementation handoff, not confirmation of commercial terms or production readiness.

## Assignment and existing work

Codex owns the customer storefront and visual design. Claude owns the backend, admin portal, customer authentication/account services, persistence, payments, fulfilment, assessment tools and integration. Work in this project; preserve the storefront direction and its accessible responsive behaviour. There is no connected Claude session in this workspace: this file is ready to give to Claude, and no backend work is claimed as started.

The business sells gadgets and appliances, including headsets, TVs, air conditioners and washing machines. Two distinct paths must be visible: regular retail (pay outright) and hire purchase (apply for a business-led assessment). Approval is a human business decision. Do not create automatic approval, assumed interest rates, deposits or eligibility rules.

Working name: Signature Trade Links, taken from the workspace. Confirm with owner. Country, currency, company details, provider and hosting have not been confirmed. Ghana/GHS may be appropriate but must not be silently treated as approved.

## Current frontend

React, Vite and lucide-react; run `npm install`, `npm run dev`, `npm run build`.

- `src/main.jsx`: customer homepage, category browsing, case-insensitive search, purchase-option filter, product modal, preview cart, application process walkthrough and support dialog.
- `src/catalogue.js`: six explicitly illustrative product records. No real prices, quantities, specifications or repayment figures.
- `src/styles.css`: white/charcoal/orange visual language inspired by supplied reference, with muted olive accents. Responsive layouts, reduced-motion support, dialog focus handling.
- `public/`: local illustrative stock photos. AC and washing machine are CSS illustrations. Replace with owner's exact product media before live selling.
- No API, customer account, payment collection, document uploads, order creation, application submission or durable customer records exist. Cart lives only in memory.
- Header and metadata label this as a noindex preview. Keep preview boundaries until end-to-end release checks pass and the owner authorizes launch.

## Proposed architecture — confirm before provisioning

Use Firebase Auth, Firestore, Cloud Storage and server-side Cloud Functions/Cloud Run for a practical default; Firebase Hosting can host the Vite storefront. Keep business logic in backend services. An alternative stack is acceptable if documented and its API honours the contract below. No infrastructure has been provisioned. Confirm region, budget, deployment accounts and payment provider first. Backend dependencies and provider integration must use current official documentation.

Recommended folder boundaries: preserve `src/`; add `backend/` and an independently routed `admin/` app. Add `src/services/` for typed API integration or a shared `shared/` contract package. Never put provider secrets in Vite variables. Public Firebase config is distinct from privileged credentials. Use emulators/sandbox services before production.

## Required customer journeys

### Pay outright

1. Browse published products and select an actual purchasable variant.
2. Show confirmed price, currency, availability, delivery eligibility, fees and warranty/returns information supplied by the owner.
3. Cart contains retail items only. Recalculate all prices and delivery charges on the server; never accept a browser amount as authoritative.
4. Collect validated customer/delivery details and present final total and relevant policies.
5. Create an idempotent order and timed inventory reservation transactionally, then initiate hosted provider checkout server-side.
6. Verify signed provider webhook and transaction server-side. Browser redirects are advisory only.
7. On verified success, mark paid and confirm fulfilment. Expired/failed checkout releases reservations. Duplicate and out-of-order callbacks must never duplicate stock changes, orders or receipts.
8. Let customers see their own orders and fulfilment updates. Include cancellation/refund tooling with explicit permissions and audit history.

### Hire purchase

1. Product has hire purchase enabled by an authorized staff member. Customer chooses a variant and quantity. No generic monthly instalment number until owner-approved terms exist.
2. Start a separate application, not a retail checkout. Prefer verified customer contact/account for retrieval; confirm the identity flow with the owner.
3. Collect minimum approved assessment fields only, with a versioned privacy notice and explicit consent. Identity/employment/income documents must not be added speculatively.
4. Submit securely with an idempotency key. Return a reference and `submitted`; communicate “submitted for assessment”, never “approved”.
5. Assessor reviews, requests additional information, or recommends a decision. Authorized approver records approval/decline and reason. Customer-safe messages must exclude internal notes.
6. Approval produces a versioned, expiring offer: exact items, retail reference price, hire-purchase total, deposit, financed balance, fees, currency, schedule, payment frequency, due dates, delivery conditions and full terms. Require policy/legal review for the applicable jurisdiction before launch.
7. Customer explicitly accepts the current unexpired offer and terms; record offer/terms version and acceptance timestamp. Do not let staff silently accept on the customer's behalf.
8. Convert accepted offer to an agreement through a transaction, create server-controlled deposit payment, and gate fulfilment on agreed conditions and verified payment. Do not reserve stock for an indefinite application unless the owner approves a reservation policy.
9. Maintain an auditable repayment ledger, due/paid balances, receipts, arrears status and permitted adjustments. Payment notifications cannot replace ledger verification.
10. Notify customers only through approved channels with recorded preferences. Include withdrawal and complaints handling based on owner-approved policies.

## State machines and invariants

Retail orders: `pending_payment -> paid -> processing -> dispatched -> delivered`; also `payment_expired`, `cancelled`, and explicit refund states. Enforce legal transitions server-side. Payment status and fulfilment status should be separate fields where a single status cannot represent both.

Applications: `draft -> submitted -> under_review -> needs_information -> under_review -> approved | declined`; `withdrawn` allowed only at appropriate points. `approved` is not an active agreement. Offer status is separate: `draft -> issued -> accepted | declined | expired | superseded`. Active agreement requires accepted offer and verified deposit if required. Application amendment after issuance invalidates or supersedes the offer through explicit re-review.

Agreements: `awaiting_deposit -> active -> completed`; track arrears separately from lifecycle. Cancellation/default actions need explicit policy, permissions and immutable audit events. Do not implement automated repossession or penalties without approved policy.

Every transition: authorize actor; validate current state and version; use transaction/optimistic concurrency; append audit event; emit retryable event for notifications. Two assessors acting simultaneously must not silently overwrite decisions.

## Admin portal scope

- Dashboard: real order, inventory, application and repayment summaries with defined time zones; no invented metrics.
- Catalogue: categories, brands, products, variants/SKUs, factual specifications, retail prices, currency, images/alt text, availability, hire-purchase eligibility, draft/published/archived lifecycle.
- Inventory: stock movements and reservation ledger; controlled adjustments with reasons. Prevent overselling across retail and approved agreements.
- Orders: verified payment visibility, pick/pack/dispatch/delivery, customer details only where role requires them, cancellations, refunds and receipts.
- Assessments: queue, assignment, customer-safe requests for information, private notes, authorized decisions, offer preparation and version history.
- Agreements: accepted documents, deposit/payment history, instalment schedule, outstanding balance, arrears and reconciliation. Manual payments require evidence and an authorized audited reconciliation action, not an arbitrary paid toggle.
- Customers: restricted account lookup and history; ownership controls and sensitive data protections.
- Content/settings: real contacts, delivery zones/fees, policies, FAQs, purchase terms and branding. Version agreements and privacy policies.
- Staff/security: invite/deactivate users, role management and audit log. No public self-registration to admin roles. Owner bootstrap through trusted server-side tooling.

## Roles

| Role | Intended access |
| --- | --- |
| Customer | Own public profile, cart, orders, applications and accepted agreements only |
| Catalogue manager | Product publishing and approved inventory tasks; no assessment documents |
| Assessor | Assigned application evidence, private notes and recommendations; no role administration |
| Approver | Decisions and offer issuance within approved policy |
| Finance | Verified payment reconciliation, refunds and repayment ledger under scoped permission |
| Fulfilment | Paid/authorized fulfilment information and delivery updates; no financial evidence |
| Owner/admin | Configuration and staff management, with audited sensitive operations |

Allow the owner to hold multiple roles. Document segregation-of-duty policy rather than assuming every small team has different people. Deny by default and enforce on server/database/storage, not just hidden buttons.

## Data model

Use server IDs, UTC timestamps and integer minor currency units, never floats for money. Preserve immutable order/agreement snapshots even when catalogue prices change.

- `products`: slug, title, description, categoryId, brand, verified specifications, image assets, publishStatus, hirePurchaseEnabled, createdAt/updatedAt.
- `variants`: productId, sku, attributes, retailPriceMinor, currency, active; inventory derived from controlled stock ledger/reservations.
- `customers`: auth subject, verified contact references, minimal profile and notification preferences.
- `orders`: customerId, idempotencyKey, immutable line snapshots, validated delivery snapshot, totals, currency, paymentStatus, fulfilmentStatus, reservationId, timestamps, version.
- `inventoryMovements` / `reservations`: SKU, signed quantity, event reason/source, unique source key, expiry and lifecycle.
- `payments`: order/agreement linkage, provider reference/event IDs, amount/currency, verified status, normalized events and timestamps. Unique provider references prevent double application.
- `applications`: customerId, selected SKU/quantity, consentVersion, approved assessment schema version, status, assignee, sanitized customer status, internal assessment reference, version.
- `assessmentDocuments`: applicationId, private storage object reference, MIME, size, scanStatus, access classification, retention timestamps. Never public download URLs.
- `offers`: applicationId, version, item snapshot, all monetary terms, schedule, termsVersion, status, expiry, authorized approver and issuance/acceptance evidence.
- `agreements`: acceptedOfferId/version, customerId, immutable accepted terms, linked order, lifecycle and ledger-derived balance.
- `instalments`: agreementId, sequence, due date, amountMinor; allocations derived from payment ledger.
- `ledgerEntries`: immutable debit/credit/adjustment/reversal entries, currency, source and author; append corrections rather than rewriting history.
- `auditEvents`: actor, scope, resource, action, allowed metadata, prior/new state references, timestamp; no sensitive document contents or secrets.
- `notificationOutbox`: event key, template version, channel, recipient reference, delivery state/retry metadata.

Avoid sensitive data in IDs, public logs, analytics, URLs or general notification content. Separate private assessment records from customer-readable summaries.

## Frontend API contract v1

Base `/api/v1`. JSON with server-generated `requestId`. Authenticated endpoints use secure session or bearer token, verified server-side. Cookie auth needs CSRF protection, secure HttpOnly cookie attributes and explicit origin handling. Never return internal notes to the customer.

Success shape: `{ "data": ..., "requestId": "..." }`.
Error shape: `{ "error": { "code": "...", "message": "Customer-safe message", "fieldErrors": {} }, "requestId": "..." }`.
Use 400/401/403/404/409/422/429 appropriately. 409 for stale versions, expired offers, stock conflicts and idempotency-key payload mismatch. Paginated lists return `{ items, nextCursor }` within data. Amount fields use `...Minor` suffix and explicit ISO currency.

| Method/path | Contract |
| --- | --- |
| `GET /categories` | Published id, slug, label, ordering |
| `GET /products?category=&q=&hirePurchase=&cursor=&limit=` | Public published catalogue summaries with stable IDs, title, category, images, confirmed price/currency, availability, hirePurchaseEnabled |
| `GET /products/:slug` | Verified description/specifications, available variants, purchase modes and applicable policies |
| `POST /checkout/quote` | Input SKU/quantity and delivery zone; server returns item, fee and total breakdown plus expiry; no payment creation |
| `POST /orders` | Auth/customer details per approved flow, validated items/delivery and quote reference; `Idempotency-Key` required; returns orderId/reference, current totals and checkout next action |
| `POST /orders/:id/payments` | Authorized payable order; idempotent server-created provider session; return provider URL/reference only |
| `GET /me/orders` / `GET /me/orders/:id` | Owned order summaries/detail, payment and fulfilment state |
| `POST /hire-purchase/applications` | Verified customer, SKU/quantity, consentVersion and approved fields; idempotent; returns applicationId/reference/status, never approval |
| `GET /me/applications` / `GET /me/applications/:id` | Owned sanitized status, allowed actions and current offer if issued |
| `POST /me/applications/:id/information` | Requested validated information only, request/version reference and idempotency key |
| `POST /me/applications/:id/withdraw` | Authorized valid state transition with version |
| `GET /me/offers/:id` | Full current offer, schedule, expiry, terms version and total cost |
| `POST /me/offers/:id/accept` | Exact offerVersion, termsVersion and explicit acceptance; idempotent and transactional |
| `GET /me/agreements/:id` | Owned accepted terms, repayment schedule, ledger-derived balance and receipts |
| `POST /me/agreements/:id/payments` | Server determines payable deposit/instalment amount under policy; idempotent provider session |
| `POST /uploads/assessment-intent` | Only if uploads are approved; checks owner, requested field, MIME/size and state, returns short-lived private upload intent |
| `POST /webhooks/:provider` | Signature verification on raw body, deduplication, amount/currency/reference verification; internal event handling only |
| `GET /admin/applications` | Role-scoped queue; paginated and auditable |
| `POST /admin/applications/:id/transitions` | Role, expectedVersion, action and reason; server validation |
| `POST /admin/applications/:id/offers` | Authorized complete offer creation/issuance with version and schedule checks |
| `/admin/products`, `/admin/inventory`, `/admin/orders`, `/admin/payments`, `/admin/staff` | Implement documented role-scoped endpoints with validation and concurrency control |

Before integrating, Claude should produce a checked-in OpenAPI specification and shared types matching implemented endpoints. Coordinate any shape changes; do not silently change the frontend business flow. Never send an object with a success-looking state when an underlying service fails.

## Hire-purchase calculation requirements

Business owner must approve: eligible products/quantities, deposit requirements, markup/fees/interest if any, permitted tenors, payment frequency, rounding, due-date rules, late-payment policy, cancellation, refund and early-settlement policy. Obtain jurisdiction-appropriate review for credit/consumer/data requirements. None are supplied today.

Server validates that deposit plus scheduled payments equals total payable, fees are not hidden, all values share currency, dates are ordered and amounts are positive as appropriate. Freeze the accepted schedule. An illustrative calculator must say “estimate” and must not invent defaults. Do not add one before terms are provided.

## Security and operational requirements

- Validate schemas, document enums and enforce ownership on every request, database rule and storage path. Staff roles must not be client writable. Test direct API access, not just UI navigation.
- Rate-limit login, application, checkout and upload endpoints; use bot protection where justified. Avoid account enumeration.
- Uploads require server-minted scoped intents, MIME/content validation, size limits, malware/quarantine policy, expiry and private staff access. Signed download access must be short-lived. Retention and deletion policy require owner confirmation.
- Use sandbox payment credentials and test webhooks before production. Reconcile paid-but-not-confirmed and charged-but-out-of-stock edge cases. Never store raw card data.
- Server authority for totals, offers, permissions, stock, status transitions and ledger. Never trust localStorage or hidden form fields.
- Structured redacted logging, alerting for payment/reconciliation failures, secret management, backups and restore exercise. Document deployment and rollback, data migration and region.
- Email/SMS/WhatsApp integrations require approved provider configuration and owner-approved customer communications. Do not send messages from this handoff.
- Confirm privacy, returns/warranty, delivery/installation, terms and application-consent copy before launch. Avoid unsupported guarantees about stock, authenticity, warranty, approval speed or delivery.

## Delivery milestones and acceptance

1. Architecture + owner-input resolution: schema, environment plan, OpenAPI contract, roles and assessment policy; no invented commercial defaults.
2. Catalogue + admin: draft/publish, variant/media management, transactional inventory and role tests. Seed fixtures clearly marked test-only.
3. Retail: server quotes, idempotent order/reservation lifecycle, provider sandbox checkout/webhooks, order management.
4. Hire purchase: customer application, private assessment queue, information requests, authorized decisions, versioned offers and explicit acceptance.
5. Agreements + finance: verified deposit, agreed fulfilment gate, exact schedule/ledger, partial/duplicate/reversed payments, reconciliation and receipts.
6. Frontend integration: replace fixture reads through service adapter; preserve dual purchase choices. Add customer account/order/application status screens and integrate real admin without rebranding storefront.
7. Release: test, review business facts and policies with owner, provide evidence and ask owner for launch authorization if not already given. Keep preview disabled for transactions until authorized and ready.

Required tests: unauthorized role escalation; cross-customer access; private document access; tampered totals; invalid/stale transitions; concurrent last-unit purchases; failed/expired reservations; duplicate/out-of-order webhooks; provider amount/currency mismatch; duplicate application/acceptance; changed/expired offers; declined applications cannot purchase through approval path; exact schedule sums/rounding; deposit verification gates; partial/over/reversed payment allocations; accessible customer forms; real-device responsive review; backup/restore and deployment smoke checks. Passing build alone does not verify payments or authentication.

## Owner inputs still needed

Business name/logo and legal entity; service country/currency; exact catalogue, SKU/model/specifications and licensed photos; prices/stock; store contacts/location; delivery zones, fees and installation; payment provider/accounts; warranty/returns; hire-purchase eligibility, assessment fields/evidence and staff decisions; deposit, fees and schedules; contract/consent/privacy/retention rules; staff roles; approved hosting budget/accounts and launch scope.

## Claude starting instruction

Read this file, `README.md`, `src/catalogue.js` and the existing storefront before editing. Implement backend and admin in milestones with a documented interface. Do not treat illustrative products, model names, prices or imagery as business truth. Keep retail checkout and hire-purchase assessment distinct. Begin with the contract and emulator-backed catalogue/admin; commercial details that are unknown must stay unconfigured and block affected live actions. Report exact verification performed, unresolved inputs and deployment state at each handoff.
