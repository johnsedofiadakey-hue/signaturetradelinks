// Minimal History API router: real paths (/p/:slug, /hire-purchase/...) so pages can be linked and shared.
// Hosting rewrites every unknown path to index.html (see firebase.json); Vite does the same in dev.
import { useEffect, useState } from 'react';

const listeners = new Set();
const current = () => ({ path: window.location.pathname, search: window.location.search, hash: window.location.hash });

function settle(hash) {
  // After the new page renders, jump to the anchor if there is one, otherwise start at the top.
  requestAnimationFrame(() => {
    const target = hash && document.getElementById(hash.slice(1));
    if (target) target.scrollIntoView({ behavior: 'smooth' });
    else window.scrollTo({ top: 0 });
  });
}

export function navigate(to, { replace = false } = {}) {
  const url = new URL(to, window.location.origin);
  const samePage = url.pathname === window.location.pathname && url.search === window.location.search;
  window.history[replace ? 'replaceState' : 'pushState'](null, '', url.pathname + url.search + url.hash);
  listeners.forEach(listener => listener());
  if (samePage && url.hash) settle(url.hash);
  else if (!samePage) settle(url.hash);
}

export function useLocation() {
  const [location, setLocation] = useState(current);
  useEffect(() => {
    const update = () => setLocation(current());
    listeners.add(update);
    window.addEventListener('popstate', update);
    return () => {
      listeners.delete(update);
      window.removeEventListener('popstate', update);
    };
  }, []);
  return location;
}

/** Match "/p/:slug" against a path. Returns the params, or null. */
export function match(pattern, path) {
  const want = pattern.split('/').filter(Boolean);
  const have = path.replace(/\/+$/, '').split('/').filter(Boolean);
  if (want.length !== have.length) return null;
  const params = {};
  for (let i = 0; i < want.length; i++) {
    if (want[i].startsWith(':')) params[want[i].slice(1)] = decodeURIComponent(have[i]);
    else if (want[i] !== have[i]) return null;
  }
  return params;
}

/** An <a> that navigates in-app on a plain click and behaves normally otherwise (new tab, copy link). */
export function Link({ to, onClick, children, ...props }) {
  return (
    <a
      href={to}
      onClick={event => {
        onClick?.(event);
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || props.target) return;
        event.preventDefault();
        navigate(to);
      }}
      {...props}
    >
      {children}
    </a>
  );
}
