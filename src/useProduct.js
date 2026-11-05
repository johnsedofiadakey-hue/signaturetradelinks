// One product for a product page: the catalogue summary plus, when the API is live, its full detail.
import { useEffect, useState } from 'react';
import { loadProductDetail } from './services/catalogue';
import { useCatalogue } from './state';

export function useProduct(slug) {
  const { status, source, products } = useCatalogue();
  const product = products.find(p => p.slug === slug) ?? null;
  const [detail, setDetail] = useState({ slug: null, status: 'idle' });

  useEffect(() => {
    if (source !== 'api' || !product) return undefined;
    const controller = new AbortController();
    setDetail({ slug, status: 'loading' });
    loadProductDetail(slug, controller.signal).then(
      data => setDetail({ slug, status: 'ready', ...data }),
      error => { if (error.name !== 'AbortError') setDetail({ slug, status: 'error' }); },
    );
    return () => controller.abort();
  }, [slug, source, product?.id]);

  const current = detail.slug === slug ? detail : { status: source === 'api' ? 'loading' : 'idle' };
  return {
    loading: status === 'loading',
    product,
    // Fixtures carry their own description; the API detail carries description, specifications and variants.
    description: source === 'api' ? current.description : product?.description,
    specifications: current.specifications ?? [],
    variants: current.variants ?? [],
    detailStatus: current.status,
  };
}
