// ImportCompleteModal — shown when a Goodreads import finishes.
//
// This is the one moment a reader has a full library and has never used the
// Oracle. Importing happens once, so this is effectively a single teaching
// opportunity: rather than just saying "done", it points at the two surfaces
// that only become useful now that there are books to work with.
//
// Deliberately not a generic "what's new" modal — it names what the reader
// can do with the shelf they just brought over.
//
// v0.59

import { useEffect } from 'react';
import { useT } from '../lib/I18nContext';
import { useRouter } from '../lib/RouterContext';
import CornerBrackets from './CornerBrackets';

export default function ImportCompleteModal({ count, onClose }) {
  const t = useT();
  const { go } = useRouter();

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose?.(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  function goTo(route) {
    onClose?.();
    go(route);
  }

  return (
    <div
      className="rating-modal-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
    >
      {/* .modal-wide sets padding:0 — the head/body/foot sections own their
          own spacing. Skipping .modal-body was why the copy sat flush against
          the divider and the buttons had no breathing room. */}
      <div className="rating-modal modal-wide">
        <CornerBrackets />

        <div className="modal-head">
          <div>
            <div className="rn-version">{t('onboarding.import.readyEyebrow')}</div>
            <h2 className="rn-title">{t('onboarding.import.readyTitle')}</h2>
          </div>
          <button className="modal-close-btn" onClick={onClose} aria-label={t('onboarding.import.dismiss')}>×</button>
        </div>

        <div className="modal-body">
          <p className="import-next__intro">{t('onboarding.import.readyIntro', { count })}</p>

          <div className="import-next">
            {/* Wishlist, not 'oracle-categories' — that route is Explore by
                Genre, a different feature.

                v0.61: this card no longer points at an action. The Oracle
                Categorize button it used to advertise is gone; curation runs
                nightly instead, and the copy now sets that expectation rather
                than promising a tap. Wishlist is still where it lands, because
                that is where CurationNotice reports what is queued — and the
                footer already offers Library. */}
            <button className="import-next__card" onClick={() => goTo('wishlist')}>
              <div className="import-next__title">{t('onboarding.import.nextCategorizeTitle')}</div>
              <div className="import-next__sub">{t('onboarding.import.nextCategorizeBody')}</div>
            </button>

            <button className="import-next__card" onClick={() => goTo('oracle-similar')}>
              <div className="import-next__title">{t('onboarding.import.nextSimilarTitle')}</div>
              <div className="import-next__sub">{t('onboarding.import.nextSimilarBody')}</div>
            </button>
          </div>

          {/* Imported books usually carry no read date — Goodreads only records
              one when the reader dated the shelving. Say so here, because the
              reading challenge showing 0 after a 500-book import is otherwise
              indistinguishable from a broken import. */}
          <p className="import-next__note">{t('onboarding.import.undatedNote')}</p>
        </div>

        <div className="modal-foot">
          <button className="btn-secondary" onClick={onClose}>
            {t('onboarding.import.readyDismiss')}
          </button>
          <button className="btn-primary" onClick={() => goTo('library')}>
            {t('onboarding.import.readyLibrary')}
          </button>
        </div>
      </div>
    </div>
  );
}
