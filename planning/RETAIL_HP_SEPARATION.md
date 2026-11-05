# Retail and hire purchase: two stores, one catalogue

Status: design proposal, 5 Nov 2026. Nothing below is built yet.

## The idea

Today both ways of buying share every surface: each product card carries two buttons, the product dialog has "Pay outright / Hire purchase" tabs, and hire purchase is a section on the retail home page. That makes hire purchase feel like a payment option bolted onto retail. It is not. Retail is a purchase the customer completes alone in minutes. Hire purchase is an application that a person at the business assesses and may decline.

So we split them into two stores that share one catalogue:

| | Retail store | Hire purchase store |
| --- | --- | --- |
| Address | `/` | `/hire-purchase` |
| What it shows | Every published product | Only products staff marked eligible |
| Customer goal | Buy it now | Apply, then decide after an offer |
| Container | Bag (many items) | One application per product choice |
| Ends in | Paid order, delivery | Submitted application, then offer, then agreement |
| Money shown | Confirmed retail price | No instalment figures until an individual offer exists |
| Who decides | The customer | The business, then the customer |

One catalogue keeps a single source of truth for products, specifications, images and stock. Stock is shared, so a unit reserved by a retail order cannot also be promised to an approved agreement.

## Retail store (`/`)

The retail store reads as a normal, complete shop. Hire purchase is not mentioned on cards, in the product page's main area, or in the bag.

1. **Browse:** home, categories, search, product grid. The "Hire purchase available" filter and the twin buttons on cards are removed.
2. **Product page:** its own route (`/p/:slug`) instead of a dialog, so it can be shared and indexed later. Shows the price, availability, variant picker, quantity and **Add to bag**. If the product is eligible, a single quiet line at the bottom says "Also available on hire purchase" and links to `/hire-purchase/p/:slug`.
3. **Bag:** retail items only. The server recalculates every price.
4. **Checkout** (`/checkout`), one page with clear steps:
   1. Contact: name, phone, email.
   2. Delivery: delivery zone or in-store pickup. The fee comes from the server quote.
   3. Review: line items, delivery fee and total, all from `POST /checkout/quote`. The quote expires.
   4. Pay: `POST /orders` (idempotent, reserves stock for a set time), then `POST /orders/:id/payments` hands off to the provider's hosted page.
5. **Confirmation** (`/order/:reference`): the order reference, its status, and what happens next. Payment is confirmed only by the provider's verified webhook, never by the browser's return to the site.

## Hire purchase store (`/hire-purchase`)

A distinct entrance with its own tone: calmer, more explanatory, human.

1. **Landing:** how it works (choose, apply, assessment, offer, accept), what the customer will need, and the honest promise: "no figures until your offer".
2. **Eligible catalogue:** only products where staff enabled hire purchase. This is the only place hire-purchase buttons appear.
3. **Product page** (`/hire-purchase/p/:slug`): the same product content, with **Apply for this product** instead of a bag. No retail add-to-bag here, and no invented instalment amounts.
4. **Application** (`/hire-purchase/apply/:slug`): contact, verification, the assessment fields the owner approves, consent (versioned). It ends with a reference and the status "Submitted", never "approved".
5. **Track** (`/hire-purchase/status`): the customer sees the status (submitted, under review, needs information, approved with an offer, declined), answers requests for information, and reviews and accepts a versioned, expiring offer.

## Admin: hire purchase is decided when the product is added

- The **New product** form gets a "Where it is sold" section:
  - **Retail store:** always on for a published product.
  - **Hire purchase store:** off by default. Switching it on requires a short reason, for example "Approved by credit committee, 5 Nov", which goes into the audit log.
- Who may switch it on stays a permission (`catalogue:hire_purchase`). Owners and approvers hold it. A catalogue manager sees the switch locked with the note "An approver marks hire-purchase eligibility". The product can still be created, and an approver turns eligibility on later from the same panel that exists today.
- The products list gets a "Stores" column showing Retail or Retail + HP, plus a filter, so staff can see the hire-purchase range at a glance.
- Removing eligibility does not affect applications already submitted. They keep a snapshot of the product as applied for.

## Backend changes

- `POST /admin/products` accepts `hirePurchase: { enabled, reason }` at creation, permission-checked and audited the same way as the existing toggle endpoint.
- `GET /products?store=hire_purchase` returns only eligible, published products. Retail queries are unchanged.
- Retail: quote, order and stock reservation, payment session, webhook, and admin order screens (milestone 3).
- Hire purchase: applications, assessment queue, information requests, decisions, offers and acceptance (milestones 4–5). This depends on the owner's hire-purchase policy and is not needed for the retail launch.

## Decisions only the owner can make

Decided by the owner on 5 Nov 2026:

1. **Store currency:** GHS (Ghana cedi).
2. **Payment:** Paystack hosted checkout. Built against Paystack test mode first. Live keys are added by the owner as a Cloud secret and are never committed.
3. **Delivery:** both delivery zones and in-store pickup.
4. **Storefront:** the split is built on Codex's luxury UI, which is committed first as the baseline.

Still needed before retail checkout goes live. Until they are set, the affected steps stay switched off and say so.

- Delivery zones and the fee for each, plus the pickup address and opening hours.
- How long stock stays reserved for an unpaid order.
- Returns and warranty wording shown at checkout.
- A Paystack account. Test keys are enough to build; live keys are needed to launch.

Hire purchase additionally needs the assessment fields, the consent and privacy text, and the offer terms policy. It can launch after retail.

## Suggested order

1. Split the storefront into the two stores and add the admin "Where it is sold" section. This needs no owner input and makes the separation real immediately.
2. Build retail checkout up to the payment step, using the owner's answers above.
3. Build the hire purchase application and tracking flow once its policy is supplied.
