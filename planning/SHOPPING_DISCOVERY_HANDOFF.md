# Shopping discovery features

5 November 2026. Local storefront work by Codex. No deployment, database write or message sending performed.

## Delivered

- **Find my upgrade:** compact homepage entry, three-step category/budget/use finder and linked product shortlist. Budget entry is available when the catalogue has confirmed prices and a currency; otherwise the customer can continue browsing by category. Starting prices and variant caveats remain explicit.
- **Compare:** retail home/shop card controls; selection retained across route navigation during the current page session; maximum three items; removable selections and clear action; responsive comparison table with prices, availability, brand and union of actual supplied specification labels. Different-category comparison is disclosed. Missing details are labelled unconfirmed. Detail API errors have a retry action.
- **Recently viewed:** retail product pages and quick view record a slug in browser-local history. Eight retained, most recent four displayed on the homepage, deduplicated and moved to the front when revisited. Clear-history action affects only this key. Storage failure falls back to memory. No assessment, customer or order data is recorded.
- **Quick view:** accessible dialog with image, current catalogue price and availability, fetched description/specifications, comparison action, full product link and WhatsApp enquiry. Choosing a priced variant and buying remains on the existing product page; the dialog does not bypass purchase controls.
- **WhatsApp enquiries:** business number explicitly supplied by owner: **+233549329735**. Product-specific links prepare a draft with product name and the current-origin product URL. The user still chooses to send. Links use `wa.me`, encoded text, a new tab and `noopener noreferrer`. No message was sent by Codex.

## Contact configuration

`src/discovery/contact.js` contains the public owner-provided default. A deployment can override with `VITE_WHATSAPP_NUMBER` in international format. Validation lives in `model.js`. An invalid/missing number fails closed in the enquiry control; no invented contact is substituted. This is public business contact configuration, not a secret.

## Matching rules and data boundaries

Category matches use catalogue category IDs/slugs. Price checks use integer minor units with the currency's precision, exclude out-of-stock records and do not compare across currencies. Variant prices shown as “From” remain starting-price checks; customer-facing copy says to choose a variant and confirm price/delivery.

Use-case matching needs explicit owner-maintained data. The frontend accepts optional string-array `useCases` metadata if the API supplies it, or existing specification rows labelled `Use cases`, `Recommended use`, `Intended use` or `Suitable for`, with comma/semicolon/pipe-separated values. Supported values include `movies`/`films`, `gaming`, `music`, `chores`, `work`, or the exact corresponding UI labels. Names, photographs and categories are not treated as proof of suitability. Unsupported or missing data does not become a positive claim.

Products with known budget/currency/use mismatches are excluded; products missing required facts are kept separate from confirmed matches. If no confirmed match exists, the UI can show explicitly unverified category suggestions. A failed detail request is not represented as successful suitability matching.

The fixture catalogue remains unpriced and illustrative. The finder still provides category exploration but cannot promise a budget or suitability match until facts are supplied. No prices/specifications were invented to fill the table or finder.

## Integration

New code: `src/discovery/` (`DiscoveryProvider.jsx`, `FinderDialog.jsx`, `model.js`, `contact.js`, `discovery.css`). Provider wraps the existing app inside `StoreProvider`, so it reads the same catalogue. `CardDiscoveryActions` is added only for retail destinations; hire-purchase cards keep their separate application journey. Product-page tracking is a small hook and WhatsApp component. Existing wishlist/cart work was preserved.

`src/services/catalogue.js` now safely retains optional use-case metadata and normalizes absent specifications to an empty array. Backend endpoints/contracts/authorization and all payment/assessment business logic were not changed. Detail loading is shared/cached within the discovery provider, aborts on provider unmount and supports retries. No new package was installed.

## Verification

- Production build passed for storefront and existing admin entry; upstream non-blocking lucide directive warnings remain.
- `node --test tests/discovery.test.mjs`: five meaningful checks covering known matches vs missing/unsuitable/over-budget/out-of-stock/currency-mismatched records, explicit suitability evidence, currency precision, recent-history limits/deduplication and WhatsApp context encoding.
- Offline browser scenario: finder disclosure, three-step flow, quick view, correct WhatsApp URL without opening/sending, Escape/focus restoration, local recent persistence and clearing, comparison maximum three, removing selections, product-page integration and unpriced purchase gate.
- Mock API browser scenario: positive/negative budget and use matches, validation, unpriced exclusion, merged supplied comparison specs, failed request and successful retry. Test catalogue responses were intercepted only in the browser and never written to the project catalogue/database.
- Responsive checks at 320/390/768/1440, no page overflow. Narrow header spacing was adjusted to accommodate existing search/wishlist/cart/menu actions.
- Desktop quick-view/finder/comparison screenshots and mobile dialog captures saved under `outputs/`. No browser page errors in the passing runs.

This validates the new browser features. It does not claim to validate live orders, payments, customer accounts or assessment submission. Real catalogue facts are still needed for useful live comparisons and suitability recommendations.
