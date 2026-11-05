// Shared API contract v1 — enums, roles and error codes used by the backend, admin portal and storefront.
// Keep in sync with shared/openapi.yaml.

export const API_BASE = '/api/v1';

export const STAFF_ROLES = Object.freeze(['owner', 'catalogue_manager', 'assessor', 'approver', 'finance', 'fulfilment']);

// Deny by default: a permission not listed for a role is not granted.
export const ROLE_PERMISSIONS = Object.freeze({
  owner: [
    'catalogue:read', 'catalogue:write', 'catalogue:publish', 'catalogue:hire_purchase',
    'inventory:read', 'inventory:adjust', 'staff:manage', 'audit:read', 'settings:manage', 'dashboard:read',
    'orders:read', 'orders:fulfil',
  ],
  catalogue_manager: ['catalogue:read', 'catalogue:write', 'catalogue:publish', 'inventory:read', 'inventory:adjust', 'dashboard:read'],
  // Approvers decide hire-purchase policy, so they control which products are eligible.
  approver: ['catalogue:read', 'catalogue:hire_purchase', 'dashboard:read'],
  assessor: ['catalogue:read', 'dashboard:read'],
  finance: ['catalogue:read', 'inventory:read', 'dashboard:read', 'orders:read'],
  fulfilment: ['catalogue:read', 'inventory:read', 'dashboard:read', 'orders:read', 'orders:fulfil'],
});

export function permissionsFor(roles) {
  return [...new Set(roles.flatMap(role => ROLE_PERMISSIONS[role] ?? []))].sort();
}

export const STAFF_STATUSES = Object.freeze(['invited', 'active', 'deactivated']);

export const PRODUCT_STATUSES = Object.freeze(['draft', 'published', 'archived']);

export const PRODUCT_TRANSITIONS = Object.freeze({
  publish: { from: ['draft'], to: 'published' },
  unpublish: { from: ['published'], to: 'draft' },
  archive: { from: ['draft', 'published'], to: 'archived' },
  restore: { from: ['archived'], to: 'draft' },
});

export const PRODUCT_ILLUSTRATIONS = Object.freeze(['ac', 'washer']);

export const AVAILABILITY = Object.freeze(['in_stock', 'out_of_stock', 'unconfirmed']);

// sign: +1 must add stock, -1 must remove stock, 0 either. noteRequired forces an explanation.
export const INVENTORY_REASONS = Object.freeze({
  stock_received: { sign: 1, noteRequired: false },
  count_correction: { sign: 0, noteRequired: true },
  damaged: { sign: -1, noteRequired: true },
  returned_to_supplier: { sign: -1, noteRequired: false },
  other: { sign: 0, noteRequired: true },
});

// Owner-configured commercial settings. Unset settings block the actions that depend on them.
export const SETTINGS = Object.freeze({
  'store.currency': { description: 'ISO 4217 currency for every retail price. Required before any price can be set.' },
  'checkout.deliveryZones': { description: 'Areas you deliver to and the fee for each. Customers choose one at checkout.' },
  'checkout.pickup': { description: 'Store address and opening hours for in-store collection.' },
  'checkout.reservationMinutes': { description: 'How long stock is held for an unpaid order before it is released.' },
  'checkout.returnsPolicy': { description: 'Returns and warranty wording shown to customers at checkout.' },
});

// Fulfilment moves forward only. Cancelling is separate because it also releases stock.
export const ORDER_FULFILMENT_TRANSITIONS = Object.freeze({
  start_processing: { from: 'not_started', to: 'processing' },
  dispatch: { from: 'processing', to: 'dispatched' },
  deliver: { from: 'dispatched', to: 'delivered' },
});

// Retail and hire-purchase states (milestones 3–5). Declared now so the contract is stable.
export const ORDER_PAYMENT_STATUSES = Object.freeze(['pending_payment', 'paid', 'payment_expired', 'refund_pending', 'partially_refunded', 'refunded']);
export const ORDER_FULFILMENT_STATUSES = Object.freeze(['not_started', 'processing', 'dispatched', 'delivered', 'cancelled']);
export const APPLICATION_STATUSES = Object.freeze(['draft', 'submitted', 'under_review', 'needs_information', 'approved', 'declined', 'withdrawn']);
export const OFFER_STATUSES = Object.freeze(['draft', 'issued', 'accepted', 'declined', 'expired', 'superseded']);
export const AGREEMENT_STATUSES = Object.freeze(['awaiting_deposit', 'active', 'completed', 'cancelled']);

export const ERROR_CODES = Object.freeze({
  bad_request: 400,
  invalid_json: 400,
  unsupported_media_type: 415,
  unauthenticated: 401,
  invalid_signature: 401,
  invalid_credentials: 401,
  forbidden: 403,
  csrf_failed: 403,
  not_found: 404,
  stale_version: 409,
  conflict: 409,
  invalid_transition: 409,
  insufficient_stock: 409,
  item_unavailable: 409,
  price_changed: 409,
  order_expired: 409,
  refund_required: 409,
  idempotency_key_reused: 409,
  slug_locked: 409,
  currency_in_use: 409,
  last_owner: 409,
  payload_too_large: 413,
  validation_failed: 422,
  not_ready: 422,
  commercial_setting_missing: 422,
  rate_limited: 429,
  internal_error: 500,
  payment_provider_error: 502,
  not_configured: 503,
});
