# Backend & admin — milestone 1–2 handoff

Prepared 5 November 2026 by Claude in response to `CLAUDE_BACKEND_BLUEPRINT.md`. Updated the same day for the move to Firestore and Cloud Functions on the owner's Firebase project `signaturetradelinks`. No messages were sent.

## What exists now

| Area | Location | Notes |
| --- | --- | --- |
| Contract | `shared/openapi.yaml`, `shared/contract.js` | OpenAPI 3.1 for implemented endpoints plus every blueprint endpoint not built yet. Roles, permissions, state machines and error codes shared by backend and admin. |
| API server | `backend/src/` | Node 22+, `node:http` handler on Firestore via `firebase-admin`. Runs as the Cloud Function `api` (`backend/src/function.js`, europe-west1) behind Firebase Hosting's `/api/**` rewrite, or locally with `npm run api`. Base `/api/v1`. |
| Firebase config | `firebase.json`, `firestore.rules`, `firestore.indexes.json` | Firestore in europe-west1. Rules deny all client access; only the API reads and writes. |
| Admin portal | `admin/` → served at `/admin/` | React + Vite (second entry in `vite.config.js`). Sign-in, invite acceptance, overview, catalogue, SKUs/prices, inventory ledger, staff/roles, settings, audit log. |
| Tests | `backend/test/` | Run with `npm test` against the Firestore emulator. Each suite gets its own emulator project. |
| Tooling | `backend/scripts/` | Owner bootstrap, test-only fixture seeding. |

The customer storefront now reads the public API through `src/services/catalogue.js` (milestone 6, catalogue part):
- **Products and categories:** they come from `/api/v1`, and only published items are shown. The card, the product modal and the bag show the confirmed price, or "Price to be confirmed".
- **Product modal:** it loads the full description and verified specifications on open. Items marked out of stock can't be added to the bag.
- **Placeholder labels:** the "illustrative" labels and the preview-strip notices appear only when they're true.
- **Offline fallback:** if the API can't be reached, the storefront falls back to the bundled fixtures and says so in an "Offline preview" note. It never shows them as live data.
- **Search and filters:** these run in the browser over the loaded catalogue. That's fine at this size; switch to the server's `q`/`category` parameters if the catalogue grows to hundreds of products.
- **Order:** products are listed alphabetically, as the API returns them. The earlier hand-picked order is gone; add a `sortOrder` field if the owner wants a curated order.
- **Not changed:** the bag still lives only in the browser and checkout is not open. Customer accounts, order and application screens wait on milestones 3–5.

## Retail checkout

Built and tested locally on 5 November 2026. **Not live until the steps below are done.**

- **Customer flow:** `/checkout` takes contact details, then delivery (zone and GhanaPostGPS address) or in-store collection, then sends the customer to Paystack's hosted page. `/order/:reference` shows the result. Guests only; there are no customer accounts in retail.
- **Prices:** the browser sends SKUs and quantities, and the server prices everything. An order is refused with `price_changed` if the total moved after the customer saw it.
- **Stock:** held when the order is placed, deducted with a `retail_sale` ledger entry when payment is verified, and released by the `releaseExpiredOrders` job (every 5 minutes) if unpaid when the hold ends.
- **Paid status:** only a signed Paystack webhook or a server-side verify call can set it. Returning to the order page proves nothing. An amount or currency mismatch is flagged for staff and not marked paid. A payment arriving after stock was resold is flagged `paid_without_stock`.
- **Order access:** each order has a private token kept in the customer's browser and stored hashed on the server. A wrong token looks like a missing order, so the order page only works on the device that placed the order.
- **Admin:** Orders list and detail, fulfilment steps, cancelling unpaid orders, and forms for each checkout setting.
- **Closed until configured:** the storefront shows "Checkout opens soon" until the currency, a delivery zone or pickup point, the hold time, the returns wording and the Paystack key are all set. Products without a priced SKU show "Not on sale yet".

**Not built:** refunds (cancelling a paid order returns `refund_required`, so refund in the Paystack dashboard), customer order emails (needs an email provider), and a way to reopen an order on another device.

**Tested against:** a scripted stand-in for Paystack, in both the test suite and the browser check. Real Paystack calls have not run yet, so place one order with test keys before taking real payments.

### To turn it on

1. Set the key. `backend/src/function.js` declares this secret, so the function cannot deploy until it exists. Use the Paystack test key first:
   ```sh
   firebase functions:secrets:set PAYSTACK_SECRET_KEY --project signaturetradelinks
   ```
2. Deploy functions, Firestore indexes and hosting.
3. In the Paystack dashboard, set the webhook URL to `https://signaturetradelinks.web.app/api/v1/webhooks/paystack`.
4. In admin, under Settings, enter the currency (GHS), delivery areas and fees, pickup address and hours, hold time, and returns wording.
5. Price and stock at least one product, place a test order, then switch to the live key.

## Run locally

Needs Java 21+ for the Firestore emulator. The npm scripts find a Homebrew JDK 21 automatically.

```sh
npm install
npm run emulators                           # terminal 1: Firestore emulator on 127.0.0.1:8085, project demo-signature
npm run seed:fixtures                       # illustrative products, unpriced
npm run admin:bootstrap -- --email you@example.com --name "Your Name"   # prints a generated password once
npm run api                                 # terminal 2: http://127.0.0.1:8787/api/v1
npm run dev                                 # terminal 3: storefront /, admin /admin/ (Vite proxies /api)
npm test                                    # starts its own emulator
```

Local data is saved to `backend/.emulator-data/` (git-ignored) when the emulator stops. Local scripts default to the `demo-signature` emulator project and cannot touch live data unless you pass `--project signaturetradelinks`. Seeding a live project also needs `--confirm-live`.

## Deploy

```sh
npm run deploy                              # build, then firebase deploy: Firestore rules/indexes, the api function, hosting
npm run admin:bootstrap -- --project signaturetradelinks --email you@example.com --name "Your Name"   # once, first owner on live
```

## Stack decision (ADR-001, revised)

**First version:** a self-contained Node + SQLite service, chosen while hosting was unconfirmed.

**Now:** the owner chose Firestore. The same `node:http` handler runs as a 2nd-gen Cloud Function (Cloud Run underneath) in europe-west1, behind the existing Hosting site. Storefront, admin and API therefore share one origin, and the admin cookie stays first-party. The HTTP contract and the tests did not change, apart from one SQLite-trigger test replaced by Firestore rules and ledger-consistency tests.

**How the guarantees map to Firestore:**
- **Transactions:** every multi-document write runs in a Firestore transaction, which retries on contention. Version checks, stock checks and uniqueness happen inside the transaction.
- **Uniqueness:** enforced by index documents keyed by the unique value: `productSlugs`, `categorySlugs`, `skus` (SKU), and `staffEmails` (SHA-256 of the lowercased email).
- **Stock:** each SKU doc carries `onHand`/`reserved` counters, updated in the same transaction as the immutable `inventoryMovements` entry. A test checks that the counter equals the ledger sum.
- **Append-only collections:** the ledger and audit log are only ever created, never updated or deleted. The Admin SDK bypasses rules, so this is enforced in code, and clients are denied all access by `firestore.rules`.
- **Rate limits:** stored in Firestore (`rateLimits`), so they hold across instances. The per-account limit is keyed by email alone, because forwarded IPs can be spoofed.
- **Cookie name:** the session cookie is named `__session`, the only cookie Firebase Hosting forwards to functions.
- **Indexes:** queries avoid composite indexes except the five in `firestore.indexes.json`. Catalogue, inventory and dashboard reads load whole collections and filter in memory. That's fine for a few hundred products; move to denormalised summaries beyond that.

**Housekeeping not yet set up:**
- TTL policies to purge expired `sessions`, `idempotencyKeys` and `rateLimits` docs.
- Scheduled Firestore backups.
- An Artifact Registry cleanup policy (`firebase functions:artifacts:setpolicy`).

## Security properties (tested)

- **Sessions:** staff sessions use an `HttpOnly; SameSite=Strict` cookie named `__session`, scoped to `/api/v1/admin`. Firestore stores only a SHA-256 of the token, and sessions expire after 8 hours. The cookie is `Secure` in the live environment.
- **CSRF:** every admin write needs a per-session `X-CSRF-Token` and a JSON body. Foreign `Origin` headers are rejected. Live origins default to `signaturetradelinks.web.app` and `.firebaseapp.com`; add a custom domain via `STL_ALLOWED_ORIGINS`. Locally, any localhost port is allowed so Vite can pick a free port.
- **Passwords:** hashed with scrypt (N=32768). Unknown emails and wrong passwords get the same response and comparable timing. Each account is limited to 5 failures per 15 minutes, and each IP to 30, with counters stored in Firestore.
- **Accounts:** there is no self-registration. The first owner is created by a server-side CLI that refuses to run once any owner exists. Other staff join by owner invitation: a one-time code, stored hashed, valid for 72 hours, which the owner shares out of band.
- **Permissions:** deny by default, enforced on the server on every request (see `ROLE_PERMISSIONS`). Staff cannot change their own roles. There must always be an active owner. Role changes and deactivation end the target's sessions immediately.
- **Concurrency:** every versioned write uses an optimistic `expectedVersion` check, and a mismatch returns 409.
- **Stock:** adjustments need an `Idempotency-Key` and are append-only ledger rows. Stock can never drop below zero or below reserved quantities; concurrent last-unit removals are tested.
- **Audit:** the audit log is append-only and never stores password hashes or invitation codes. Clients can't read or write it directly (tested against the rules).
- **Money:** stored as integer minor units. A price can only be set after the owner confirms `store.currency`, and must be in that currency. The admin converts typed amounts to minor units with string arithmetic, not floats.
- **Unbuilt endpoints:** checkout, orders, hire-purchase, offers, agreements, uploads and webhooks return `503 not_configured`, never a success-looking response.

## Decisions made that the owner may want to revisit

- Hire-purchase eligibility can be changed by **owner or approver** only, never a catalogue manager, and always with a recorded reason.
- A published product's web address is locked. Unpublish it before changing the slug, so customer links never break silently.
- A product can be published without a price. The storefront then shows "price to be confirmed" and the product is not purchasable.
- Seeded fixtures are flagged `illustrative: true` in both the public and admin APIs.

## Verification performed (5 Nov 2026)

- `npm test`: 39/39 passing on the Firestore emulator (originally 38/38 on SQLite). The suite covers:
  - auth, rate limiting, CSRF/origin and content-type checks
  - role escalation, last-owner protection and session revocation
  - publish state machine, readiness and slug lock
  - stale-version conflicts and validation (unknown fields, unsafe image URLs, float prices)
  - currency gating and public price exposure
  - idempotent stock receipt and key reuse
  - the stock floor, concurrent last-unit removal, stock counters matching the ledger, and Firestore rules denying direct client access
  - 503 for unbuilt services, 404/405 handling
- `npm run build`: storefront and admin both build. The existing lucide-react `use client` warnings are unchanged.
- Browser check in the built-in Chromium against a scratch database, at desktop width and 375px mobile (done on the SQLite version; the API contract is unchanged):
  - owner sign-in, the overview, setting the currency
  - adding a SKU at GHS 4,999.50 (stored as 499950)
  - recording +8 stock, then confirming `GET /products/smart-television` returned the price and `in_stock`
  - no horizontal page overflow on mobile
  - two UI defects (a SKU input pattern and the mobile grid width) were found and fixed during this check

Not verified: real-device testing, a full accessibility audit, load testing and backup/restore.

## Deployment state (5 Nov 2026)

- **Live:** https://signaturetradelinks.web.app (storefront) and https://signaturetradelinks.web.app/admin/ (admin portal). Hosting rewrites `/api/**` to the `api` function (Cloud Functions v2, europe-west1, Node 22).
- **Firestore:** europe-west1. Rules (deny all client access) and indexes are deployed. The catalogue is seeded with the 6 illustrative, unpriced products.
- **IAM grants made:**
  - `roles/cloudbuild.builds.builder` on the build service account `173781217052-compute@developer.gserviceaccount.com`, so the function can build.
  - A dedicated runtime service account `stl-api@signaturetradelinks.iam.gserviceaccount.com` holding only `roles/datastore.user`. The function runs as this account (`backend/src/function.js`), not the default compute account.
- **Artifact cleanup:** container images in europe-west1 are deleted after 3 days (`firebase functions:artifacts:setpolicy`).
- **Verified live:** public products/categories return 200, the storefront renders API data (no offline note), a bad login returns 401, and `/admin/` loads.
- **Not done (owner):** no staff account exists on live yet. The owner creates it with `npm run admin:bootstrap -- --project signaturetradelinks ...` so the password never passes through anyone else.
- **Not done:** Firestore TTL policies for `sessions`, `rateLimits` and `idempotencyKeys` (expired rows are ignored, but not yet purged), scheduled Firestore backups, a custom domain, and alerting.

## Next milestones and what blocks them

| Milestone | Blocked on owner input |
| --- | --- |
| 3 Retail checkout | Payment provider and sandbox account, delivery zones/fees, reservation timeout, returns/warranty copy, customer identity approach |
| 4 Hire-purchase applications | Approved assessment fields, consent/privacy notice text and version, whether document uploads are allowed, retention rules |
| 5 Agreements & finance | Deposit, fees, tenors, schedule and rounding rules, late-payment and early-settlement policy, jurisdiction review |
| 6 Storefront integration | Catalogue reads done. Account, order and application screens follow milestones 3–5. Codex owns the storefront design, so coordinate any visual changes |
| 7 Release | Custom domain, backups and TTL policies, real-device and accessibility checks, owner launch authorization |
