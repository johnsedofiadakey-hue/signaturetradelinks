# Signature Tradelink

Local customer storefront preview for a gadget and appliance retailer. Built in React + Vite. The customer storefront uses the supplied Signature Tradelink logo, the original clean white design and a simple five-product crossfade. The dark luxury concept was rejected; keep the hero minimal. See `planning/CLEAN_UI_HANDOFF.md` for the current direction.

## Run

```sh
npm install
npm run dev
```

Build with `npm run build`; serve the build with `npm run preview`.

Backend API and admin portal (Firestore + Cloud Functions; local development uses the Firestore emulator, which needs Java 21+):

```sh
npm run emulators                           # terminal 1
npm run seed:fixtures && npm run admin:bootstrap -- --email you@example.com --name "Your Name"
npm run api                                 # terminal 2: API on 127.0.0.1:8787, proxied at /api by Vite
npm test                                    # backend tests on the emulator
npm run deploy                              # Firestore rules/indexes, api function, hosting
```

Admin portal: `/admin/` on the Vite dev server, or `https://signaturetradelinks.web.app/admin/` once the API function is deployed. Details, security notes and verification are in `planning/BACKEND_HANDOFF.md`; the API contract is `shared/openapi.yaml`.

## Available now

Responsive homepage reading the backend catalogue API (with a labelled offline fallback to bundled fixtures), category browsing, case-insensitive search, purchase-mode filtering, product details, in-memory retail bag with quantities/removal, hire-purchase process walkthrough, FAQs and a support information dialog. Product cards distinguish pay outright from assessed hire purchase.

All products and photography are illustrative. Prices are unconfirmed. AC and washer visuals are CSS illustrations. Checkout, payments, account management and application submission are not connected. No personal assessment information is collected. Refreshing clears the preview bag. Preview deployed to Firebase Hosting at https://signaturetradelinks.web.app (noindex); see `planning/BACKEND_HANDOFF.md` for deployment state.

## Work split

- Codex: customer storefront/UI.
- Claude: backend, admin, authentication, persistence, payments, assessments, agreements and operational workflows.

Give Claude `planning/CLAUDE_BACKEND_BLUEPRINT.md`. It includes the proposed architecture, data model, roles, status transitions, API contracts, testing and launch requirements. Claude has delivered milestones 1–2 (contract, catalogue/inventory/staff admin); see `planning/BACKEND_HANDOFF.md`.

## Before live use

Confirm real branding, catalogue/media, currency, prices, stock, payment provider, delivery, hire-purchase policy and legal/privacy/contract terms. Connect and verify backend flows; owner authorizes production launch. No application approval or repayment terms should be inferred from this preview.

## Media

Local stock images downloaded from Unsplash image URLs on 5 November 2026; visual placeholders, not proof of brands/stock/specifications. Source URLs are in `planning/MEDIA.md`. Supplied design reference is inspiration and was not copied into product assets.


## Latest landing-page visuals

The white product-led landing page now includes photographic categories, a consistent studio preview collection, one labelled AI-generated room feature and an ivory hire-purchase invitation with reduced-motion-aware animations. Source/prompt and integration notes: `planning/LANDING_VISUAL_HANDOFF.md`. Local update; not a new deployment.

## Shopping discovery

Homepage product finder, retail quick view/comparison (up to three), browser-local recently viewed history and product-specific WhatsApp drafts are implemented. Owner-provided enquiry number: +233549329735; override with public `VITE_WHATSAPP_NUMBER` if needed. Catalogue facts drive matching; missing prices/specifications remain unconfirmed. Read `planning/SHOPPING_DISCOVERY_HANDOFF.md`. Model checks: `node --test tests/discovery.test.mjs`.
