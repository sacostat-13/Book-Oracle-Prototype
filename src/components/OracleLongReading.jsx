// src/components/OracleLongReading.jsx — v0.73 (Pro)
//
// "Why this book, for you" — the long reading. Sits on BookPage (v0.71.1 —
// it was first placed in BookModal, which nothing renders) under the
// one-line reason. Where that line says why, this one shows its working:
// a few short paragraphs tying the book to named books on the reader's own
// shelf, and what the book might ask of them.
//
// Free readers see a single quiet line pointing at Pro — no teaser text, no
// blurred paragraphs. Pro readers see the cached reading if there is one,
// otherwise a button. Nothing runs on open: a modal that spends Oracle calls
// by being looked at would be a very bad surprise on the day Pro stops being
// unlimited for someone (a downgrade, the fair-use ceiling).

import { useEffect, useMemo, useState } from 'react';
import { useData } from '../lib/DataContext';
import { useT, useI18n, langDirective } from '../lib/I18nContext';
import { useOracleQuota } from '../lib/OracleQuotaContext';
import { useProLimits } from '../lib/proGates';
import { useAuth } from '../lib/AuthContext';
import { bookKey, buildBookPageParams } from '../lib/bookHelpers';
import { useRouter } from '../lib/RouterContext';
import BookCover from './BookCover';
import { callClaude, parseJSONResponse, QuotaExceededError } from '../lib/claudeApi';
import { buildShelfSignature, normalizeTitle } from '../lib/oraclePrompt';
import { buildTasteProfile, describeTasteProfile } from '../lib/matchHelpers';
import { loadReading, saveReading } from '../lib/oracleReadings';

export default function OracleLongReading({ book, reason = null }) {
  const t = useT();
  const { lang } = useI18n();
  const { state } = useData();
  const { handleQuotaError, onCallSucceeded, confirmOracleCall } = useOracleQuota();
  const { isPro, goUpgrade } = useProLimits();
  const { user } = useAuth();
  const { go } = useRouter();

  const key = book ? bookKey(book) : null;

  // v0.71.1: echoes are books from the reader's own shelf, so they are matched
  // back to the real shelf rows — which carry the cover the reader already
  // knows them by, and let the echo open that book. The Oracle only names a
  // title (and, from v0.71.1, an author); anything it names that is not found
  // still renders, with BookCover fetching a cover by title and author.
  const shelfByTitle = useMemo(() => {
    const m = new Map();
    const add = (list, shelf) => (list || []).forEach((b) => {
      const k = normalizeTitle(b?.t);
      if (k && !m.has(k)) m.set(k, { book: b, shelf });
    });
    add(state.library, 'library');
    add(state.readNext, 'library');
    add(state.wishlist, 'wishlist');
    return m;
  }, [state.library, state.readNext, state.wishlist]);
  const [reading, setReading] = useState(null);
  const [status, setStatus] = useState('idle'); // idle | loading | error

  useEffect(() => {
    if (!isPro || !key) return undefined;
    let cancelled = false;
    setReading(null);
    loadReading('why_long', key, lang).then((r) => { if (!cancelled && r) setReading(r); });
    return () => { cancelled = true; };
  }, [isPro, key, lang]);

  // Guests see nothing: the reading is built from a shelf they do not have,
  // and the upgrade link would land on a Profile they cannot open.
  if (!book?.t || !user) return null;

  if (!isPro) {
    return (
      <div className="oracle-long oracle-long--locked">
        <button type="button" className="btn-text btn--sm" onClick={goUpgrade}>
          ✦ {t('pro.longReadingLocked')}
        </button>
      </div>
    );
  }

  async function draw() {
    if (status === 'loading') return;
    if (!(await confirmOracleCall('why_long'))) return;
    setStatus('loading');

    const taste = describeTasteProfile(buildTasteProfile(state.library, state.genresByBookId, state.profile));
    const shelf = buildShelfSignature(state);
    const prompt = `${taste ? taste + '\n\n' : ''}${shelf}

The reader is looking at: "${book.t}"${book.a ? ` by ${book.a}` : ''}.${reason ? `\nThe Oracle's one-line reason for them was: "${reason}"` : ''}

Write the long reading: why THIS book, for THIS reader, now. Tie it to specific books on their shelf by name — what it shares with them, where it departs. Say plainly what it may ask of them (pace, difficulty, darkness), and be honest if it is a stretch. Do not summarise the plot beyond a line.

Return ONLY valid JSON:
{"paragraphs":["...","...","..."],"echoes":[{"title":"a book from their shelf","author":"its author","note":"a short phrase on the connection"}],"asks":"one sentence on what the book asks of the reader"}
Three short paragraphs at most. Up to three echoes, and only books that appear above.`;

    try {
      const raw = await callClaude(
        prompt,
        `You are a literary oracle giving one reader a considered, personal reading of one book. Speak to them directly. Offer guidance, never ownership: the choice is always theirs. ${langDirective(lang)} Every natural-language field MUST be in that language; titles stay in their original language. Always return valid JSON.`,
        { source: 'why_long', maxTokens: 1200 }
      );
      const parsed = parseJSONResponse(raw);
      if (!parsed?.paragraphs?.length) { setStatus('error'); return; }
      const body = {
        paragraphs: parsed.paragraphs.filter((p) => typeof p === 'string').slice(0, 3),
        echoes: (parsed.echoes || []).filter((e) => e?.title).slice(0, 3),
        asks: typeof parsed.asks === 'string' ? parsed.asks : null,
      };
      setReading({ ...body, createdAt: new Date().toISOString() });
      setStatus('idle');
      onCallSucceeded?.();
      saveReading('why_long', key, lang, body);
    } catch (e) {
      if (e instanceof QuotaExceededError) handleQuotaError(e);
      setStatus('error');
    }
  }

  if (!reading) {
    return (
      <div className="oracle-long">
        <button type="button" className="btn-tertiary btn--sm" onClick={draw} disabled={status === 'loading'}>
          {status === 'loading' ? t('pro.longReadingDrawing') : `✦ ${t('pro.longReadingCta')}`}
        </button>
        {status === 'error' && <p className="db-ai__note">{t('pro.longReadingError')}</p>}
      </div>
    );
  }

  return (
    <div className="oracle-long oracle-long--open">
      <div className="bp-section__label">{t('pro.longReadingLabel')}</div>
      {reading.paragraphs.map((p, i) => (
        <p key={i} className="oracle-long__para">{p}</p>
      ))}
      {reading.echoes?.length > 0 && (
        <>
          <div className="bp-section__label oracle-long__echoes-label">{t('pro.longReadingEchoes')}</div>
          <ul className="oracle-long__echoes">
            {reading.echoes.map((e, i) => {
              const match = shelfByTitle.get(normalizeTitle(e.title));
              const b = match?.book || { t: e.title, a: e.author || '' };
              const open = match
                ? () => go('book-page', buildBookPageParams(b, match.shelf, t(`nav.${match.shelf}`)))
                : null;
              const Tag = open ? 'button' : 'div';
              return (
                <li key={i} className="oracle-long__echo">
                  <Tag
                    {...(open ? { type: 'button', onClick: open } : {})}
                    className="oracle-long__echo-inner"
                  >
                    <div className="oracle-long__echo-cover">
                      <BookCover title={b.t} author={b.a} coverUrl={b.coverUrl} />
                    </div>
                    <cite className="oracle-long__echo-title">{b.t}</cite>
                    {e.note && <span className="oracle-long__echo-note">{e.note}</span>}
                  </Tag>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {reading.asks && <p className="oracle-long__asks">{reading.asks}</p>}
    </div>
  );
}
