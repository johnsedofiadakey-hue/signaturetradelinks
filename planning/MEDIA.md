# Illustrative media

Replace with actual product photos before launch. These are stock illustrations of product categories, not factual product listings. Original bytes retained locally; no generated or edited photographic product assets.

- `public/headphones.jpg`: https://images.unsplash.com/photo-1546435770-a3e426bf472b?auto=format&fit=crop&w=1200&q=85
- `public/television.jpg`: https://images.unsplash.com/photo-1593359677879-a4bb92f829d1?auto=format&fit=crop&w=800&q=80
- `public/phone.jpg`: https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?auto=format&fit=crop&w=800&q=80
- `public/speaker.jpg`: https://images.unsplash.com/photo-1608043152269-423dbba4e7e1?auto=format&fit=crop&w=800&q=80

Air conditioner and washing machine: CSS illustrations in `src/styles.css`.


## Supplied brand artwork

`public/brand/signature-tradelink-original.png` is the original logo supplied by the owner on 5 November 2026. Its bytes are preserved unchanged. The `BrandLogo` component frames the logo with CSS to fit the header/footer; no photographic or AI alteration was performed.


## Product-led hero revision

Five AI-retouched transparent hero PNGs are saved in `public/hero/`. Manufacturer reference images remain under `public/hero/sources/`. See `HERO_IMAGE_PROMPTS.md` for source URLs, exact prompts and output paths. The original unedited stock images remain in use for the illustrative catalogue; hero art is a separate presentation layer.

## Complete landing-page pass

New lifestyle room, generic AC concept, edited phone and edited portable speaker originals are retained alongside web exports. See `LANDING_VISUAL_HANDOFF.md` for exact prompts, references, paths and export details. The room is labelled AI-generated in the page. All preview catalogue studio images are labelled AI-retouched preview. No owner-supplied real catalogue image is replaced by the presentation mapper.

## Payment logos

In `public/payment/`, shown on the product page, cart, checkout and footer. These are the brands' own marks; the owner should confirm use is allowed before launch, and replace Visa and Mastercard with the files from their brand centres if those schemes or Paystack ask.

| File | Source | Change |
| --- | --- | --- |
| `mtn.svg` | mtn.com.gh | None |
| `mtn-momo.png` | momo.mtn.com, MoMo app badge | Resized |
| `telecel-cash.png` | telecel.com.gh | Cropped out of its red panel, resized |
| `at-money.png` | at.com.gh | Trimmed margin, resized |
| `visa.svg` | Wikimedia Commons, `Visa Inc. logo (2021–present).svg` | None |
| `mastercard.svg` | Wikimedia Commons, `Mastercard 2019 logo.svg` | None |
| `paystack.svg` | paystack.com site header | None |

Mastercard's own download requires accepting its artwork agreement, which the owner has to do personally. Bank transfer has no single brand, so it uses a generic icon.
