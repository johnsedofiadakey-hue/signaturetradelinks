// The ways to pay on Paystack's hosted page in Ghana, shown with each brand's own logo. See planning/MEDIA.md for where each file came from.
import { Landmark, Lock, ShieldCheck } from 'lucide-react';

const METHODS = [
  { id: 'mtn', name: 'MTN MoMo', logos: [['/payment/mtn.svg', 'MTN'], ['/payment/mtn-momo.png', 'MoMo']] },
  { id: 'telecel', name: 'Telecel Cash', logos: [['/payment/telecel-cash.png', 'Telecel Cash']] },
  { id: 'at', name: 'AT Money, formerly AirtelTigo Money', logos: [['/payment/at-money.png', 'AT Money']] },
  { id: 'visa', name: 'Visa', logos: [['/payment/visa.svg', 'Visa']] },
  { id: 'mastercard', name: 'Mastercard', logos: [['/payment/mastercard.svg', 'Mastercard']] },
];

export function PaymentBadges({ label = 'Ways to pay' }) {
  return (
    <ul className="pay-badges" aria-label={label}>
      {METHODS.map(({ id, name, logos }) => (
        <li key={id} className={`pay-badge pay-${id}`} title={name}>
          {logos.map(([src, alt]) => <img key={src} src={src} alt={alt} loading="lazy" decoding="async" />)}
        </li>
      ))}
      <li className="pay-badge pay-bank" title="Bank transfer"><Landmark size={15} /> Bank transfer</li>
    </ul>
  );
}

/** The full reassurance block for checkout. Every line here must stay true of Paystack's hosted page. */
export function SecurePayment() {
  return (
    <div className="secure-payment">
      <div className="secure-heading">
        <ShieldCheck size={20} />
        <div>
          <strong>Secure payment</strong>
          <span className="secured-by">Secured by <img src="/payment/paystack.svg" alt="Paystack" /></span>
          <span>A PCI DSS Level 1 certified payment provider.</span>
        </div>
      </div>
      <PaymentBadges />
      <p className="secure-note"><Lock size={13} /> You pay on Paystack’s encrypted page. We never see your card number or mobile money PIN.</p>
    </div>
  );
}

/** A compact version for the product page and cart. */
export function SecureLine() {
  return (
    <div className="secure-compact">
      <p className="secure-line"><Lock size={13} /> Secure payment by <img src="/payment/paystack.svg" alt="Paystack" /></p>
      <PaymentBadges />
    </div>
  );
}
