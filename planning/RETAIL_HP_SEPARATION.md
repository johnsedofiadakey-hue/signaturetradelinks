# Retail and hire purchase: two stores, one catalogue

Status, 5 Nov 2026:
- **Built:** step 1 of "Suggested order":
  - The two stores, with real paths: `/`, `/p/:slug`, `/checkout`, `/hire-purchase`, `/hire-purchase/p/:slug`, `/hire-purchase/apply`.
  - The admin "Where it is sold" section.
- **Not built yet:** checkout and the hire-purchase application. Their pages show what each will ask for, say plainly that they are not open yet, and collect nothing.

## The idea

Today both ways of buying share every surface: each product card carries two buttons, the product dialog has "Pay outright / Hire purchase" tabs, and hire purchase is a section on the retail home page. That makes hire purchase feel like a payment option bolted onto retail. It is not. Retail is a purchase anyone completes alone in minutes. Hire purchase is a relationship: the business assesses a person once, approves them for an amount, and that person then buys on credit through their account.

So we split them into two stores that share one catalogue:

| | Retail store | Hire purchase store |
| --- | --- | --- |
| Address | `/` | `/hire-purchase` |
| Who can buy | Anyone, no account needed | Only customers the business has approved |
| What it shows | Every published product | Only products staff marked eligible |
| Starts with | Browsing | Creating an account and completing an assessment |
| Container | Bag (many items) | A purchase against the customer's approved limit |
| Ends in | Paid order, delivery | Accepted agreement, deposit paid, delivery, instalments |
| Money shown | Confirmed retail price | Cash price, then hire-purchase figures from the owner's plans |
| Who decides | The customer | The business approves the person; the customer accepts each agreement |

One catalogue keeps a single source of truth for products, specifications, images and stock. Stock is shared, so a unit reserved by a retail order cannot also be promised to a hire-purchase agreement.

## Retail store (`/`)

The retail store reads as a normal, complete shop. Hire purchase is not mentioned on cards, in the bag or at checkout.

1. **Browse:** home, categories, search, product grid. The "Hire purchase available" filter and the twin buttons on cards are removed.
2. **Product page:** its own route (`/p/:slug`) instead of a dialog (built), so it can be shared and indexed later. Shows the price, availability, variant picker, quantity and **Add to bag**. If the product is eligible, one quiet line at the bottom says "Also available on hire purchase" and links to `/hire-purchase`.
3. **Bag:** retail items only. The server recalculates every price.
4. **Checkout** (`/checkout`), one page with clear steps:
   1. Contact: name, phone, email. Guest checkout; no account required.
   2. Delivery: a delivery zone, or in-store pickup. The fee comes from the server quote.
   3. Review: line items, delivery fee and total, all from `POST /checkout/quote`. The quote expires.
   4. Pay: `POST /orders` (idempotent, reserves stock for a set time), then `POST /orders/:id/payments` hands off to Paystack's hosted page.
5. **Confirmation** (`/order/:reference`): the order reference, its status, and what happens next. Payment is confirmed only by Paystack's verified webhook, never by the browser's return to the site.

## Hire purchase store (`/hire-purchase`)

A distinct entrance with its own tone: calm, explanatory, human. The journey has three stages: **apply**, **get approved**, **buy through your account**.

### Stage 1: Create an account and apply

1. **Landing:** what hire purchase is, who it is for, what to have ready (Ghana Card, proof of income, digital address), how long review takes, and that a person at Signature Tradelink reviews every application. Eligible products are shown as a preview, without a buy button.
2. **Create an account:** **Continue with Google** (Gmail), or **email me a sign-in link** for people without Gmail. No passwords to remember or leak.
3. **Assessment:** a guided form, saved as you go, in the sections below.
4. **Submit:** the customer reviews everything, gives the consents, and submits. The account status becomes **Under review**.

A signed-in customer who is not yet approved can see **only** their own application: complete it, check its status, upload documents the team asks for, or withdraw it. They cannot see hire-purchase pricing or buy anything. That is how "only approved people can use it" works while still letting people apply.

### Assessment questions (Ghanaian practice)

This is a proposed default set, based on what Ghanaian lenders and hire-purchase retailers commonly ask. The owner confirms which questions are required. A lawyer should review it before launch (see "Legal review").

1. **Identity: Ghana Card**
   - Full name exactly as on the Ghana Card, date of birth, gender.
   - Ghana Card PIN (format `GHA-XXXXXXXXX-X`).
   - Photos of the card front and back, and a live selfie taken in the browser. The Bank of Ghana treats the Ghana Card as the only accepted identification for financial transactions and requires a liveness check on digital channels. We follow the same standard even though a retailer is not a bank.
2. **Contact**
   - Email (verified by the sign-in itself).
   - Mobile number, and a mobile money number if different. Verified by an SMS code once an SMS provider is chosen.
3. **Where you live**
   - GhanaPostGPS digital address (for example `GA-183-8164`), region, town or city, area and nearest landmark.
   - Residential status (own, rent, family), and time at this address.
4. **Work and income**
   - Employment type: public sector salaried, private sector salaried, self-employed, business owner, other.
   - Employer or business name, location, job title, start date.
   - Monthly net income (GHS) and payday.
   - Evidence: the last 3 payslips if salaried, or the last 6 months of bank or mobile money statements if self-employed.
   - Public-sector staff: Controller and Accountant-General's Department staff ID, if the owner offers payroll deduction.
5. **Existing commitments:** other loans, hire purchase or credit, and the total monthly repayments.
6. **Guarantor:** full name, Ghana Card PIN, phone, relationship, occupation. The guarantor confirms by a link sent to their phone or email. The owner decides whether a guarantor is always required, never required, or required above a certain amount.
7. **Consent and declaration**, each versioned and recorded with time and wording:
   - The information is true and complete.
   - Consent to a credit bureau check, if the owner uses one.
   - Consent to processing personal data under the privacy notice.
   - Consent to be contacted about the application.

### Stage 2: Admin approves the person

1. **Assessment queue** in admin: new applications, needs information, ready for decision. Each shows a checklist (identity matched, address confirmed, income evidence, guarantor confirmed, bureau report if used).
2. **Separation of duties**, using the roles that already exist:
   - An **assessor** reviews documents, requests missing information and recommends approve or decline.
   - An **approver** or the **owner** makes the decision. Nobody approves their own recommendation.
   - Every document view, request and decision is audit-logged.
3. **Approval** records:
   - the approved credit limit in GHS, entered by the approver
   - how long the approval is valid before re-assessment
   - any conditions, for example "guarantor required"
   - the reason

   Nothing is approved automatically, and the system suggests no limits.
4. **Decline** records a reason for internal use. The customer receives a respectful, neutral message, with wording the owner approves.
5. **Notification email:** on approval, the customer gets an email: "You're approved for hire purchase", the approved limit, and a **Sign in to your account** button. The button is a single-use magic link that expires after 72 hours. After that first sign-in, they keep using Google or a fresh email link.

### Stage 3: Buy through the account

1. The approved customer signs in and sees the full hire-purchase store: eligible products, their remaining limit, and their agreements.
2. **Choose a product:** the page shows the cash price and the hire-purchase options from the owner's plans (term lengths, deposit, instalments). Products above the remaining limit show "Above your approved limit" instead of a buy button.
3. **Agreement:** before anything is paid, the customer sees the full agreement with the details the Hire-Purchase Act, 1974 (NRCD 292) expects:
   - the cash price
   - the total hire-purchase price
   - the deposit
   - each instalment and its due date
   - fees
   - the customer's rights

   They accept it explicitly. The accepted version is frozen.
4. **Deposit:** paid through Paystack. Stock is reserved when the agreement is accepted and released if the deposit is not paid in time.
5. **Delivery or pickup**, then instalments tracked in the account, with a statement showing paid, due and overdue amounts.

## Admin: hire purchase is decided when the product is added

- The **New product** form gets a "Where it is sold" section:
  - **Retail store:** always on for a published product.
  - **Hire purchase store:** off by default. Switching it on requires a short reason, which goes into the audit log.
- Only roles with `catalogue:hire_purchase` (owner, approver) can switch it on. A catalogue manager sees the switch locked with the note "An approver marks hire-purchase eligibility". The product can still be created, and an approver turns eligibility on later from the product page.
- The products list gets a "Stores" column (Retail, or Retail + HP) and a filter for it.
- Removing eligibility does not affect agreements already accepted; they keep a frozen copy of the product.
- New admin sections: **Applications** (the assessment queue), **Customers** (approved, declined, suspended; limits and expiry), **Agreements** (deposits, schedules, payments, overdue).

## How it is built

- **Customer sign-in:** Firebase Authentication with the Google and email-link providers, kept completely separate from staff sign-in. The browser sends a Firebase ID token to the API, which checks it and looks up the customer's status. Staff accounts and customer accounts never mix.
- **Access rule, enforced on the server:**
  - A customer whose status is not `approved`, or whose approval has expired, can reach only their own application endpoints.
  - Hire-purchase pricing, limits and agreement endpoints check for an approved, unexpired status on every request.
- **Magic link on approval:** generated by the server (Firebase Admin `generateSignInWithEmailLink`) and sent in a branded email through a transactional email provider from the business's own domain.
- **Documents:** Ghana Card images, selfies, payslips and statements go to private Cloud Storage. Nobody can open them by URL. Assessors view them through short-lived links the API issues, and each view is audited. Ghana Card PINs are never written to logs.
- **Retention:** applications and documents are kept only as long as the owner's retention policy says, then deleted on a schedule.
- **New API areas:**
  - `/me/hire-purchase/application` (save, upload, submit, withdraw)
  - `/me/hire-purchase/account` (status, limit)
  - `/me/hire-purchase/agreements` (quote, accept, pay deposit)
  - `/admin/applications`, `/admin/customers` and `/admin/agreements`, behind the existing roles

## Decisions

Decided by the owner on 5 Nov 2026:

1. **Store currency:** GHS (Ghana cedi).
2. **Retail payment:** Paystack hosted checkout, built in test mode first.
3. **Delivery:** both delivery zones and in-store pickup.
4. **Storefront:** built on Codex's luxury UI, committed first as the baseline.
5. **Hire purchase:**
   - account first, then assessment, then admin approval
   - the approval email carries a magic link
   - Google sign-in is allowed
   - only approved customers can buy

Still needed. Until each is set, the step that depends on it stays switched off and says so.

| For | The owner needs to decide |
| --- | --- |
| Retail checkout | Delivery zones and fees; pickup address and hours; how long stock is held for an unpaid order; returns and warranty wording; Paystack account (test keys to build, live keys to launch) |
| Approval emails | Sending domain (for example `notify@signaturetradelink.com`) and an email provider |
| Assessment | Which questions and documents are required; guarantor policy; whether to use a credit bureau and which one; whether Ghana Card checks are manual (staff compare photo and card) or through a paid identity-verification service |
| Approval | How limits are set; how long an approval lasts; who may approve above a given amount |
| Buying on hire purchase | Plans: deposit, term lengths, how the hire-purchase price is calculated, fees, late-payment handling, how instalments are paid (Paystack, mobile money, payroll deduction) |

### Legal review before hire purchase launches

These need a Ghanaian lawyer, not software:

- The agreement template and its disclosures under the Hire-Purchase Act, 1974 (NRCD 292). This includes the hirer's termination rights and the repossession limits; sources disagree on the exact threshold, so the statute itself must be checked.
- The privacy notice, consent wording, retention periods and registration with the Data Protection Commission under the Data Protection Act, 2012 (Act 843).
- Credit bureau consent wording, if a bureau is used.

## Suggested order

1. **Separate the stores** and add the admin "Where it is sold" section. This needs no owner input.
2. **Retail checkout** to Paystack test mode, using the delivery and returns answers.
3. **Hire-purchase accounts and assessment:** customer sign-in, the application form, private document upload and the admin assessment queue. This can be built against the proposed question set and adjusted after the owner confirms it.
4. **Approval and the magic-link email**, once the sending domain exists.
5. **Hire-purchase buying and agreements**, once the plans and the legal review are done.
