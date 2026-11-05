# Backend & admin — milestone 1–2 handoff

Prepared 5 November 2026 by Claude in response to `CLAUDE_BACKEND_BLUEPRINT.md`. Local only: no infrastructure was provisioned, nothing was deployed, and no messages were sent.

## What exists now

| Area | Location | Notes |
| --- | --- | --- |
| Contract | `shared/openapi.yaml`, `shared/contract.js` | OpenAPI 3.1 for implemented endpoints plus every blueprint endpoint not built yet. Roles, permissions, state machines and error codes shared by backend and admin. |
| API server | `backend/src/` | Node 24, zero runtime dependencies: `node:http` + built-in `node:sqlite`. Base `/api/v1`. |
| Admin portal | `admin/` → served at `/admin/` | React + Vite (second entry in `vite.config.js`). Sign-in, invite acceptance, overview, catalogue, SKUs/prices, inventory ledger, staff/roles, settings, audit log. |
| Tests | `backend/test/` | 38 tests run with `npm test`. |
| Tooling | `backend/scripts/` | Owner bootstrap, test-only fixture seeding. |

The customer storefront now reads the public API through `src/services/catalogue.js` (milestone 6, catalogue part):
- **Products and categories:** they come from `/api/v1`, and only published items are shown. The card, the product modal and the bag show the confirmed price, or "Price to be confirmed".
- **Product modal:** it loads the full description and verified specifications on open. Items marked out of stock can't be added to the bag.
- **Placeholder labels:** the "illustrative" labels and the preview-strip notices appear only when they're true.
- **Offline fallback:** if the API can't be reached, the storefront falls back to the bundled fixtures and says so in an "Offline preview" note. It never shows them as live data.
- **Search and filters:** these run in the browser over the loaded catalogue. That's fine at this size; switch to the server's `q`/`category` parameters if the catalogue grows to hundreds of products.
- **Order:** products are listed alphabetically, as the API returns them. The earlier hand-picked order is gone; add a `sortOrder` field if the owner wants a curated order.
- **Not changed:** the bag still lives only in the browser and checkout is not open. Customer accounts, order and application screens wait on milestones 3–5.

## Run locally

```sh
npm install
npm run seed:fixtures                       # test-only illustrative products, unpriced
npm run admin:bootstrap -- --email you@example.com --name "Your Name"   # prints a generated password once
npm run api                                 # http://127.0.0.1:8787/api/v1
npm run dev                                 # storefront /, admin /admin/ (Vite proxies /api)
npm test
```

Data lives in `backend/data/dev.sqlite`, which git ignores. Set `STL_DB_PATH` to use another file. To reset, stop the API and delete `backend/data/`.

## Stack decision (ADR-001)

**Decision:** for milestones 1–2, use a self-contained Node + SQLite service instead of Firebase. The blueprint allows an alternative stack that is documented and honours the contract.

**Why:** the owner has not confirmed hosting, region, budget or accounts. This stack runs with no accounts and needs no emulators. It also gives real ACID transactions (`BEGIN IMMEDIATE`) for the inventory and version checks the blueprint requires. Immutable ledgers and audit logs are enforced by database triggers as well as in code.

**Consequences / migration path:** persistence is plain SQL behind the route handlers. The HTTP contract, not the storage, is the stable interface. Moving to Firebase (Cloud Run + Firestore) or to Postgres means reimplementing the queries in `backend/src/` while keeping `shared/openapi.yaml` and the tests. Postgres is the easier fit for the ledger-heavy milestones 3–5. Two current limits:
- Login rate limiting is in-memory, so it is per process.
- SQLite supports a single writer node.

Both are fine for one instance. Revisit them before scaling out.

## Security properties (tested)

- **Sessions:** staff sessions use an `HttpOnly; SameSite=Strict` cookie scoped to `/api/v1/admin`. The DB stores only a SHA-256 of the token, and sessions expire after 8 hours. The cookie is `Secure` when `NODE_ENV=production`.
- **CSRF:** every admin write needs a per-session `X-CSRF-Token` and a JSON body. Foreign `Origin` headers are rejected. Outside production, any localhost port is allowed so Vite can pick a free port. Set the real origins in `STL_ALLOWED_ORIGINS` for production.
- **Passwords:** hashed with scrypt (N=32768). Unknown emails and wrong passwords get the same response and comparable timing. Each account is limited to 5 failures per 15 minutes, and each IP to 30.
- **Accounts:** there is no self-registration. The first owner is created by a server-side CLI that refuses to run once any owner exists. Other staff join by owner invitation: a one-time code, stored hashed, valid for 72 hours, which the owner shares out of band.
- **Permissions:** deny by default, enforced on the server on every request (see `ROLE_PERMISSIONS`). Staff cannot change their own roles. There must always be an active owner. Role changes and deactivation end the target's sessions immediately.
- **Concurrency:** every versioned write uses an optimistic `expectedVersion` check, and a mismatch returns 409.
- **Stock:** adjustments need an `Idempotency-Key` and are append-only ledger rows. Stock can never drop below zero or below reserved quantities; concurrent last-unit removals are tested.
- **Audit:** the audit log is append-only (enforced by a trigger) and never stores password hashes or invitation codes.
- **Money:** stored as integer minor units. A price can only be set after the owner confirms `store.currency`, and must be in that currency. The admin converts typed amounts to minor units with string arithmetic, not floats.
- **Unbuilt endpoints:** checkout, orders, hire-purchase, offers, agreements, uploads and webhooks return `503 not_configured`, never a success-looking response.

## Decisions made that the owner may want to revisit

- Hire-purchase eligibility can be changed by **owner or approver** only, never a catalogue manager, and always with a recorded reason.
- A published product's web address is locked. Unpublish it before changing the slug, so customer links never break silently.
- A product can be published without a price. The storefront then shows "price to be confirmed" and the product is not purchasable.
- Seeded fixtures are flagged `illustrative: true` in both the public and admin APIs.

## Verification performed (5 Nov 2026)

- `npm test`: 38/38 passing. The suite covers:
  - auth, rate limiting, CSRF/origin and content-type checks
  - role escalation, last-owner protection and session revocation
  - publish state machine, readiness and slug lock
  - stale-version conflicts and validation (unknown fields, unsafe image URLs, float prices)
  - currency gating and public price exposure
  - idempotent stock receipt and key reuse
  - the stock floor, concurrent last-unit removal and immutable ledger/audit rows
  - 503 for unbuilt services, 404/405 handling
- `npm run build`: storefront and admin both build. The existing lucide-react `use client` warnings are unchanged.
- Browser check in the built-in Chromium against a scratch database, at desktop width and 375px mobile:
  - owner sign-in, the overview, setting the currency
  - adding a SKU at GHS 4,999.50 (stored as 499950)
  - recording +8 stock, then confirming `GET /products/smart-television` returned the price and `in_stock`
  - no horizontal page overflow on mobile
  - two UI defects (a SKU input pattern and the mobile grid width) were found and fixed during this check

Not verified: real-device testing, a full accessibility audit, load testing, backup/restore, and any deployment.

## Next milestones and what blocks them

| Milestone | Blocked on owner input |
| --- | --- |
| 3 Retail checkout | Payment provider and sandbox account, delivery zones/fees, reservation timeout, returns/warranty copy, customer identity approach |
| 4 Hire-purchase applications | Approved assessment fields, consent/privacy notice text and version, whether document uploads are allowed, retention rules |
| 5 Agreements & finance | Deposit, fees, tenors, schedule and rounding rules, late-payment and early-settlement policy, jurisdiction review |
| 6 Storefront integration | Catalogue reads done. Account, order and application screens follow milestones 3–5. Codex owns the storefront design, so coordinate any visual changes |
| 7 Release | Hosting account/region/budget, production origins, backup plan, owner launch authorization |
