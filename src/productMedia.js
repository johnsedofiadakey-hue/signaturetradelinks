// Presentation-only upgrades for the original illustrative fixtures. Never replace real catalogue media.
const legacyStudio = {
  '/headphones.jpg': '/hero/headphones-hero-v1.webp',
  '/television.jpg': '/hero/lg-oled-hero-v1.webp',
  '/phone.jpg': '/hero/phone-studio-v1.webp',
  '/speaker.jpg': '/hero/speaker-studio-v1.webp',
};
export function productMedia(product) {
  let src = product.image;
  if (product.illustrative) {
    src = legacyStudio[src] ?? src;
    if (!src && product.illustration === 'ac') src = '/hero/ac-studio-v1.webp';
    if (!src && product.illustration === 'washer') src = '/hero/lg-washer-hero-v1.webp';
  }
  // Known studio PNG originals can also arrive from the API; use their web exports.
  const known = new Set(['/hero/lg-audio-hero-v1.png', '/hero/lg-oled-hero-v1.png', '/hero/phone-studio-v1.png', '/hero/headphones-hero-v1.png', '/hero/ac-studio-v1.png', '/hero/speaker-studio-v1.png', '/hero/lg-fridge-hero-v1.png', '/hero/lg-washer-hero-v1.png']);
  if (known.has(src)) src = src.replace(/\.png$/, '.webp');
  return { src, studio: Boolean(src?.startsWith('/hero/')) };
}
export const categoryPhotos = {
  all: ['/hero/headphones-hero-v1.webp', '/hero/lg-fridge-hero-v1.webp'],
  audio: ['/hero/headphones-hero-v1.webp'],
  'tv-and-entertainment': ['/hero/lg-oled-hero-v1.webp'],
  cooling: ['/hero/ac-studio-v1.webp'],
  'home-appliances': ['/hero/lg-fridge-hero-v1.webp', '/hero/lg-washer-hero-v1.webp'],
  'phones-and-computing': ['/hero/phone-studio-v1.webp'],
};
