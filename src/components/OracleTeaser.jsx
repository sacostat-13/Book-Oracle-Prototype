// src/components/OracleTeaser.jsx
//
// The Oracle, once, for a visitor who is not signed in. The site's value — a
// reading drawn from your books, with the reason why — used to sit entirely
// behind sign-up, so a visitor from search saw a book page much like any other.
// Here they can ask what might follow THIS book and get three picks, each with
// the Oracle's reason, each a link to its own page. Saving one asks for an
// account; the closing line says what the Oracle does with a whole shelf.
//
// One reading per book and language is generated server-side and shared by
// every later visitor (netlify/functions/book-teaser.js), so asking costs the
// visitor nothing and costs us one model call per book, ever. Nothing about
// the visitor goes into it.
//
// Shown to signed-out visitors only — readers have the full Oracle.

import { useState } from 'react';
import { useT, useI18n } from '../contexts/I18nContext';
import { useAuthPrompt } from '../contexts/AuthPromptContext';
import { RouteLink } from '../contexts/RouterContext';
import { fetchBookTeaser } from '../lib/api/bookTeaser';
import { trackEvent } from '../lib/api/funnel';
import BookCover from './BookCover';

/**
 * @param {{ book: { t: string, a?: string }, bookKey: string }} props
 *        bookKey: the share key of this page's book (canonical when known)
 */
export default function OracleTeaser({ book, bookKey }) {
  const t = useT();
  const { lang } = useI18n();
  const { openAuth } = useAuthPrompt();
  const [state, setState] = useState('idle'); // idle | asking | ok | empty | busy
  const [picks, setPicks] = useState([]);

  if (!book?.t || !bookKey) return null;

  async function ask() {
    setState('asking');
    trackEvent('teaser_open', null, 'book-page');
    const res = await fetchBookTeaser(bookKey, lang);
    if (res.status === 'ok') {
      setPicks(res.picks);
      setState('ok');
      trackEvent('teaser_result', { count: res.picks.length, cached: !!res.cached }, 'book-page');
    } else {
      setState(res.status);
    }
  }

  function save(pick) {
    trackEvent('teaser_save', null, 'book-page');
    openAuth({
      mode: 'signup',
      from: 'teaser_save',
      context: t('growth.auth.saveBook', { title: pick.title }),
      intent: {
        type: 'wishlist',
        book: { t: pick.title, a: pick.author, coverUrl: pick.coverUrl || undefined },
        route: { name: 'book-page', params: { bookKey: pick.shareKey } },
      },
    });
  }

  function openShelf() {
    trackEvent('cta_click', { cta: 'teaser_outro' }, 'book-page');
    openAuth({ mode: 'signup', from: 'teaser_outro' });
  }

  return (
    <section className="bp-section oracle-teaser" aria-live="polite">
      <div className="bp-section__label">{t('growth.teaser.label')}</div>

      {(state === 'idle' || state === 'asking') && (
        <div className="oracle-teaser__ask">
          <p className="oracle-teaser__prompt">{t('growth.teaser.prompt', { title: book.t })}</p>
          <button className="btn-accent" onClick={ask} disabled={state === 'asking'}>
            {state === 'asking' ? t('growth.teaser.asking') : t('growth.teaser.ask')}
          </button>
        </div>
      )}

      {state === 'ok' && (
        <>
          <p className="oracle-teaser__lead">{t('growth.teaser.lead', { title: book.t })}</p>
          <ol className="oracle-teaser__picks">
            {picks.map((p) => (
              <li key={p.shareKey} className="oracle-teaser__pick">
                <RouteLink
                  to="book-page"
                  params={{ bookKey: p.shareKey }}
                  className="oracle-teaser__cover"
                  aria-hidden="true"
                  tabIndex={-1}
                >
                  <BookCover title={p.title} author={p.author} coverUrl={p.coverUrl} />
                </RouteLink>
                <div className="oracle-teaser__body">
                  <RouteLink to="book-page" params={{ bookKey: p.shareKey }} className="oracle-teaser__title">
                    {p.title}
                  </RouteLink>
                  <div className="oracle-teaser__author">{p.author}</div>
                  <p className="oracle-teaser__why">{p.why}</p>
                </div>
                <button className="btn-secondary btn--sm oracle-teaser__save" onClick={() => save(p)}>
                  {t('growth.teaser.save')}
                </button>
              </li>
            ))}
          </ol>
          <div className="oracle-teaser__outro">
            <p>{t('growth.teaser.outro')}</p>
            <button className="btn-primary" onClick={openShelf}>{t('growth.teaser.outroCta')}</button>
          </div>
        </>
      )}

      {state === 'empty' && <p className="oracle-teaser__quiet">{t('growth.teaser.quiet')}</p>}
      {state === 'busy' && <p className="oracle-teaser__quiet">{t('growth.teaser.busy')}</p>}
    </section>
  );
}
