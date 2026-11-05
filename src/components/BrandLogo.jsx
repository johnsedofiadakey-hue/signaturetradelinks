import { Link } from '../router';

export default function BrandLogo({ to = '/' }) {
  return <Link className="brand-logo" to={to} aria-label="Signature Tradelink home"><span className="brand-logo-frame"><img src="/brand/signature-tradelink-original.png" alt="Signature Tradelink" width="1800" height="1200" /></span></Link>;
}
