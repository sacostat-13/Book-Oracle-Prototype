// src/components/GuestShelfCta.jsx
//
// The action a signed-out visitor sees where a reader sees their shelf
// buttons: save this book (or start this series), free. Clicking it opens the
// sign-in window on "Create account", remembers the book, and IntentResumer
// puts it on their wishlist and brings them back here once they are in.
//
// Replaces `<a href={window.location.pathname}>Sign in to add ↗</a>`, which
// linked to the page it was on.

import { useRouter } from '../contexts/RouterContext';
import { useT } from '../contexts/I18nContext';
import { useAuthPrompt } from '../contexts/AuthPromptContext';
import { trackEvent } from '../lib/api/funnel';

/**
 * @param {{
 *   book: object,                       // the book that goes on the wishlist
 *   cta: string,                        // funnel label, e.g. 'book_save'
 *   label: string,                      // button text
 *   context: string,                    // line shown above the sign-up form
 *   returnTo: { name: string, params: object },
 *   hint?: string,                      // small line under the button
 *   className?: string,
 * }} props
 */
export default function GuestShelfCta({ book, cta, label, context, returnTo, hint, className = 'btn-primary' }) {
  const { route } = useRouter();
  const t = useT();
  const { openAuth } = useAuthPrompt();

  function onClick() {
    trackEvent('cta_click', { cta }, route.name);
    openAuth({
      mode: 'signup',
      from: cta,
      context,
      intent: book ? { type: 'wishlist', book, route: returnTo } : null,
    });
  }

  return (
    <div className="guest-cta">
      <button className={className} onClick={onClick}>{label}</button>
      <span className="guest-cta__hint">{hint ?? t('growth.book.saveHint')}</span>
    </div>
  );
}
