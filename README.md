# Signature Trade Links

Local customer storefront preview for a gadget and appliance retailer. Built in React + Vite, inspired by the supplied white/orange headphone reference. Working business name comes from the workspace and needs confirmation.

## Run

```sh
npm install
npm run dev
```

Build with `npm run build`; serve the build with `npm run preview`.

Backend API and admin portal (milestones 1–2, local only):

```sh
npm run seed:fixtures                       # test-only illustrative catalogue
npm run admin:bootstrap -- --email you@example.com --name "Your Name"
npm run api                                 # API on 127.0.0.1:8787, proxied at /api by Vite
npm test                                    # backend test suite
```

Admin portal: `/admin/` on the Vite dev server. Details, security notes and verification are in `planning/BACKEND_HANDOFF.md`; the API contract is `shared/openapi.yaml`.

## Available now

Responsive homepage reading the backend catalogue API (with a labelled offline fallback to bundled fixtures), category browsing, case-insensitive search, purchase-mode filtering, product details, in-memory retail bag with quantities/removal, hire-purchase process walkthrough, FAQs and a support information dialog. Product cards distinguish pay outright from assessed hire purchase.

All products and photography are illustrative. Prices are unconfirmed. AC and washer visuals are CSS illustrations. Checkout, payments, account management and application submission are not connected. No personal assessment information is collected. Refreshing clears the preview bag. No infrastructure or public deployment has been created.

## Work split

- Codex: customer storefront/UI.
- Claude: backend, admin, authentication, persistence, payments, assessments, agreements and operational workflows.

Give Claude `planning/CLAUDE_BACKEND_BLUEPRINT.md`. It includes the proposed architecture, data model, roles, status transitions, API contracts, testing and launch requirements. Claude has delivered milestones 1–2 (contract, catalogue/inventory/staff admin); see `planning/BACKEND_HANDOFF.md`.

## Before live use

Confirm real branding, catalogue/media, currency, prices, stock, payment provider, delivery, hire-purchase policy and legal/privacy/contract terms. Connect and verify backend flows; owner authorizes production launch. No application approval or repayment terms should be inferred from this preview.

## Media

Local stock images downloaded from Unsplash image URLs on 5 November 2026; visual placeholders, not proof of brands/stock/specifications. Source URLs are in `planning/MEDIA.md`. Supplied design reference is inspiration and was not copied into product assets.
