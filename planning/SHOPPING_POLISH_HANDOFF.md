# Storefront clarity and shopping polish — 6 November 2026

Owner approved the improvements following a storefront review. Owner confirmed there is **no confirmed price/stock list, warranty/delivery policy or genuine review material yet**. No business facts, customer quotes, prices, inventory or repayment terms were invented. No deployment or production data change in this update.

**Superseded in part:** the hire-purchase link on cards, the monthly option on product pages and the hire-purchase wording were removed at the owner's request. See "The rule" in `planning/RETAIL_HP_SEPARATION.md`.

The owner also asked that no AI-generated or AI-retouched labels appear anywhere on the site, so those labels were removed. "Illustrative photo" labels on placeholder products remain.

Implemented:
- Hero: six direct selectors, previous/next controls, progress line, five-second rotation, focus/visibility/offscreen pausing, keyboard navigation and reduced-motion support. Clean white product-led layout retained.
- Cards: confirmed brand where present, availability label, one specification from the existing product-detail API (viewport-triggered and cached by the discovery provider), and a separate assessed hire-purchase link for eligible products. Unknown specifications remain labelled as unconfirmed.
- Retail detail: pay-in-full and monthly-assessment options displayed together. Exact personalised deposit, monthly schedule, hire charges and total remain in the existing authenticated approved-customer quote/agreement flow. Public API does not currently expose confirmed public instalment offers; do not derive figures from a guessed rate.
- Room feature: TV and audio markers select category products from the current catalogue, with product links and category navigation. Concept image remains labelled illustrative; listed products are browsing suggestions, not a claim they are the exact models pictured or a priced bundle.
- Confidence section: owner-supplied WhatsApp/call contact +233549329735; delivery areas/fees and returns policy read from existing checkout options when supplied. Missing policies remain clearly marked. Support dialog now recognises the supplied business number.
- Responsive typography and touch targets improved across categories, cards, discovery, hire-purchase invitation, FAQs and footer. Mobile hero navigation stays below the product image.

Still requires business/backend content:
- Publish verified models, specifications, prices, stock and genuine media through the admin catalogue.
- Configure actual delivery/collection, warranty and returns terms. Current checkout gate remains enforced.
- Genuine customer reviews were not available; no fake testimonials, empty review carousel or star ratings were added. Connect a moderated review source once available.
- Keep exact hire-purchase offers tied to approved server quotes. Existing private agreement flow retains its authority.

Checks: production build and five discovery model tests pass. Browser checks cover selector/arrows/keyboard navigation, room category selection and product links, paired payment options, reduced-motion auto-rotation, no page errors, and no horizontal overflow at 320, 390 and 768 pixels. Mock API checks exercise confirmed specifications/brand/price/stock and actual configured delivery/returns rather than only the offline placeholders.

Scope: customer frontend only. Backend/admin files and live data unchanged. Local preview uses fixture fallback if catalogue API is not running.
