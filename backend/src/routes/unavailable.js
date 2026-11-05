import { fail } from '../http.js';

// Contract endpoints that depend on owner decisions (payment provider, prices, delivery,
// hire-purchase policy, consent copy). They fail loudly instead of returning success-looking data.
const UNAVAILABLE = [
  ['POST', '/checkout/quote'],
  ['POST', '/orders'],
  ['POST', '/orders/:id/payments'],
  ['GET', '/me/orders'],
  ['GET', '/me/orders/:id'],
  ['POST', '/hire-purchase/applications'],
  ['GET', '/me/applications'],
  ['GET', '/me/applications/:id'],
  ['POST', '/me/applications/:id/information'],
  ['POST', '/me/applications/:id/withdraw'],
  ['GET', '/me/offers/:id'],
  ['POST', '/me/offers/:id/accept'],
  ['GET', '/me/agreements/:id'],
  ['POST', '/me/agreements/:id/payments'],
  ['POST', '/uploads/assessment-intent'],
  ['POST', '/webhooks/:provider'],
  ['GET', '/admin/applications'],
  ['POST', '/admin/applications/:id/transitions'],
  ['POST', '/admin/applications/:id/offers'],
  ['GET', '/admin/orders'],
  ['GET', '/admin/payments'],
];

export function registerUnavailable(route) {
  for (const [method, path] of UNAVAILABLE) {
    route(method, path, () => fail('not_configured', 'This service is not available yet.'), { skipBody: true });
  }
}
