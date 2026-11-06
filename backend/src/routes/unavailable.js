import { fail } from '../http.js';

// Contract endpoints that depend on owner decisions (payment provider, prices, delivery,
// hire-purchase policy, consent copy). They fail loudly instead of returning success-looking data.
const UNAVAILABLE = [
  ['GET', '/me/orders'],
  ['GET', '/me/orders/:id'],
  ['POST', '/webhooks/:provider'],
  ['GET', '/admin/payments'],
];

export function registerUnavailable(route) {
  for (const [method, path] of UNAVAILABLE) {
    route(method, path, () => fail('not_configured', 'This service is not available yet.'), { skipBody: true });
  }
}
