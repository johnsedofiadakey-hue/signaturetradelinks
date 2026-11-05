# Signature Tradelink — luxury storefront update

**Superseded:** the owner rejected this direction and requested the original white, clean design with less hero text. Current implementation: `planning/CLEAN_UI_HANDOFF.md`.

5 November 2026. Local preview update by Codex, on top of Claude's catalogue service integration and backend/admin work. No deployment performed as part of this update. Existing backend, API contracts, admin, Firestore and hosting configuration were not edited by Codex.

## Brand and design

- Owner-supplied Signature Tradelink logo, retained byte-for-byte under `public/brand/`. Header and footer frame the original with CSS.
- Emerald (`#103e38`), deep emerald (`#092d29`), champagne (`#dfc38b`), gold (`#b58d42`) and ivory (`#f7f5ef`).
- Cormorant Garamond editorial headings paired with existing sans-serif typography; system fallbacks remain available.
- New arch-shaped hero product stage, fine orbit graphics, textured emerald background, refined category strip, product cards and hire-purchase section.
- Outright purchase gets a filled green action. Eligible products get a separate outlined application action and visible assessment qualification.

## Five-product hero

`src/components/HeroCarousel.jsx` owns the editorial showcase: headphones, TV, AC, washer and phone. Current visuals remain the labelled illustrative assets from the preview, not promises of actual brands, models or stock. The carousel is an editorial presentation; catalogue cards continue to use Claude's API adapter and its labelled fixture fallback. To replace hero artwork later, update the editorial feature mapping/media with approved product photography.

- Advances every 6.5 seconds; crossfade and gentle slide transition.
- Five direct selectors, previous/next, pause/resume and left/right keyboard navigation.
- Touch swipes on product showcase.
- Pauses on showcase hover, focus within the hero, offscreen hero, hidden browser tab and explicit pause.
- Reduced-motion preference disables automatic rotation and decorative animation; manual slide controls remain usable.
- Automatic changes do not announce continuous updates to screen readers. Inactive slides are hidden from the accessibility tree.
- Product float, orbit, slow sparkle rotation, progress indicators and one-time viewport reveals. No new animation dependency.

## Files

- `src/components/BrandLogo.jsx`: original artwork presentation.
- `src/components/HeroCarousel.jsx`: five-product showcase and motion lifecycle.
- `src/luxury.css`: brand styling, responsive overrides, keyframes and reduced-motion/print rules.
- `src/main.jsx`: component integration, one-time reveal observer, assessment labels and image loading hints. Existing catalogue fetching, details, cart and assessment preview retained.
- `index.html`: customer-facing title.

The existing API integration, preview commerce restrictions and backend/admin work remain in place. Do not infer a payment or assessment implementation from the new visuals. Real prices, terms and catalogue assets still need owner confirmation.
