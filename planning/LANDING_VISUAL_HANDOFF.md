# Clean photographic landing-page update

5 November 2026. Implemented locally after the owner's approval of the complete visual-improvement list. No deployment or database mutation was performed by this update.

## Current direction

White and quiet grey surfaces, small deep-green actions and warm-gold details. Keep the large product hero and minimal copy. Do not restore the rejected dark, ornate luxury concept.

- Individual hero product compositions; slide crossfades, gentle entrance and animated progress indicator.
- Reduced mobile hero stage and tighter device/title/control spacing.
- Six photographic category controls, using the same studio assets as the product grid.
- Consistent studio product photography in all eight offline preview records. Added unpriced fridge and home-audio system fixtures to match the hero. These additions are not confirmed stock and do not add hire-purchase eligibility.
- One luminous lifestyle feature with working television/audio category links. Clearly labelled AI-generated room concept.
- Ivory hire-purchase invitation, working separate-store link and one-time animated assessment path. The existing separate retail and hire-purchase journeys are preserved.
- Restrained image hover lift, header/button interactions, staggered viewport entrances and finite gold SVG line/wave animations. No new animation dependency.
- Reduced-motion mode stops the autoplay and decorative animations, keeps manual carousel navigation and displays all content.

## Media and source boundaries

`src/productMedia.js` upgrades only the original known illustrative fixture media. Owner-supplied real catalogue media is not replaced. Product detail and hire-purchase cards reuse the same shared media renderer. The original reference photos, PNG edits and earlier preview snapshots remain available.

New final originals, all under `/Users/truth/Developer/Signature Trade Links/`:

- `public/hero/ac-studio-v1.png` — generated, generic unbranded air conditioner concept.
- `public/hero/phone-studio-v1.png` — edited existing phone stock photo.
- `public/hero/speaker-studio-v1.png` — edited existing portable speaker stock photo.
- `public/editorial/living-room-v1.png` — generated room concept using previously edited OLED/audio assets as references.

Each has a sibling `.webp` export. The site uses WebP exports for these and the existing five hero assets; the full-resolution transparent PNG masters are retained. Exporting changed encoding only, not the artwork. Combined image export weight: 16,697,643 PNG bytes -> 1,692,920 WebP bytes (89.9% smaller); this is file-size evidence, not a measured network speed claim.

The original five edited asset sources/prompts remain in `HERO_IMAGE_PROMPTS.md`. New prompts below used the built-in image generation tool, not a CLI/API fallback.

## Backend handoff

No backend/admin, payment, assessment, stock or authorization logic changed. No seed script was run. The offline fixture list now has eight items; an already-populated API catalogue will still return its own records and stock. The frontend does not inject illustrative products into a successful live API response. If the owner wants the new categories/products live, use real approved catalogue records and media in admin. Keep price and availability unconfirmed until supplied.

## Verification

Production build passed for the storefront and existing admin entry. Browser checks passed: eight studio fixtures, photographic category counts, hero auto/manual navigation, search and filtering, fridge detail with unpriced sale blocked, lifestyle links, separate hire-purchase routing, FAQ, mobile menu and entry SVG animation. No horizontal overflow at 320/390/768/1024/1440. Reduced-motion browser checks stopped hero autoplay and SVG motion while retaining manual controls. No page errors recorded.

Media mapping checks confirmed real owner images are preserved, known illustrative paths are upgraded and PNG references can use matching WebP exports. Full-page desktop/mobile screenshots were visually reviewed. This does not claim to verify live payments, identity or assessment workflows.

## Exact new image prompts

### Lifestyle room

Inputs: `public/hero/lg-oled-hero-v1.png` and `public/hero/lg-audio-hero-v1.png`; `transparent_background: false`.

Use case: compositing / ads-marketing. Asset: one wide high-resolution editorial lifestyle photograph for a CLEAN WHITE electronics shop landing page. Reference 1 is the exact TV to show, reference 2 is the soundbar/subwoofer/speakers; preserve their physical design and recognisable screen artwork. Scene: a beautifully restrained contemporary living room, warm white plaster walls, low pale-oak media console, ivory upholstery partly visible foreground, daylight through sheer curtains, one minimal olive-green ceramic vase. TV on console with soundbar directly below, subwoofer on floor to one side, smaller rear speakers subtly positioned. Product installation must be plausible and grounded, not floating. Camera straight-on slightly wide room view, uncluttered editorial architectural photography, luminous afternoon light, natural fine shadows. Cream, soft white and oak with the TV's magenta/cyan display as the only vivid accent. Compose TV in middle-left, generous surrounding white wall, no copy or typography. Landscape composition approximately 16:9. NO dark dramatic room, NO gold ornament, NO people, NO watermarks, NO price badges. This is an AI-generated room concept using reference products, not a real customer installation.

### Air conditioner

No input photo; `transparent_background: true`.

Use case: product-mockup. Asset: high-resolution ecommerce cutout for a clean white gadget and appliance store. Subject: one generic unbranded premium white wall-mounted split air conditioner indoor unit, closed smooth front with realistic thin louver vent along bottom, subtle tiny operating indicator, no invented feature labels or model. Three-quarter view very slightly from below, entire product visible, wide landscape canvas with device filling 90 percent of width. Sophisticated photorealistic softbox product photography, crisp edges, white satin plastic, fine material texture, realistic restrained shadows. Genuine transparent alpha background, delicate soft shadow falling below fading into transparency. No room, no wall, no outdoor unit, no furniture, no promotional text, no logos, no watermarks. Clearly a generic illustrative product concept; do not imitate a named exact model.

### Phone

Input: `public/phone.jpg`; `transparent_background: true`.

Use case: precise-object-edit / background-extraction. Edit target: supplied illustrative smartphone photograph. Make a high-resolution premium studio ecommerce cutout. Preserve the physical phone silhouette, dark bezel, notch, rounded corners and teal edge. Remove desk, laptop and all background completely; genuine transparent alpha. Show just the phone at a refined small three-quarter tilt, entire object visible, portrait composition filling 85 percent height. Replace app icons and all screen text with a beautiful subtle teal/blue abstract gradient wallpaper so there are no garbled UI claims. Keep device physical geometry and materials plausible, clean softbox highlights, delicate natural contact shadow into alpha below. No added brands, model labels, text, accessories, stand or watermarks. Illustrative marketing retouch, not an exact SKU specification image.

### Portable speaker

Input: `public/speaker.jpg`; `transparent_background: true`.

Use case: precise-object-edit / background-extraction. Edit target: supplied black portable speaker photograph. Isolate ONLY the exact speaker, preserving cylindrical body, original fabric texture, end radiator, existing red JBL badge and physical proportions. Remove wooden table, wall and all background; genuine transparent alpha. High-resolution premium studio ecommerce product retouch: crisp edges, subtly lifted black fabric detail and realistic highlights. Same low three-quarter view with full body visible, subject fills 85 percent of landscape composition, delicate soft contact shadow fading into alpha below. Do not add or change branding, text, controls, accessories or specifications. No furniture, room, desk, marketing copy or watermarks. A retouched illustrative reference photograph.

## Vibrant colour revision

Owner requested more colour and energy. The white layout now uses orange action buttons, distinct lime/yellow/blue/mint/peach/lavender category tiles, matching product surfaces, subtle per-slide hero colour washes and brighter lifestyle/hire-purchase panels. Existing finite motion and reduced-motion handling remain. Category colour identity is based on slug, so it stays consistent in the dedicated shop routes. Existing category links and shop routing were preserved. No commercial facts or transaction behaviour changed.
