import { useState, useMemo } from 'react';
import { useData } from '../lib/DataContext';
import { useRouter } from '../lib/RouterContext';
import { useT } from '../lib/I18nContext';
import { useOracleQuota } from '../lib/OracleQuotaContext';
import { findBookByTitle, bookKey, cleanTitle } from '../lib/bookHelpers';
import { lookupByTitle, parseTitleList } from '../lib/bookLookup';
import { callClaude, QuotaExceededError, parseJSONResponse } from '../lib/claudeApi';

// v0.58 — this was the quota leak.
//
// Every row of an import that Hardcover/OL/Wikipedia could not resolve landed
// here, and this called callClaude with no `feature`, so each one was charged
// as a full metered Oracle call. A Goodreads CSV with five unmatched titles
// silently emptied a free account's entire monthly budget before the user had
// used a single Oracle surface — which is exactly the "I used my free calls up
// pretty quickly and I'm not actually fully sure how" report.
//
// It is the same job NavSearch and bookLookup do, and they already run it on
// the free tier: identifying a book you may not even keep should not cost a
// call. `feature: 'search'` puts it there — server-forced to Haiku with a
// 400-token cap and a per-user rate limit, which is the throttle that was
// actually protecting this path all along. The 5-call quota never was.
async function claudeBookFallback(title, author) {
  try {
    const query = author ? `${title} by ${author}` : title;
    const systemPrompt = 'You are a book identification assistant. Return only valid JSON with no markdown fences.';
    const prompt = `Identify this book: "${query}"\nReturn ONLY valid JSON (no markdown, no explanation):\n{"t":"exact title","a":"author full name","d":"2-3 sentence description","g":"primary genre","s":{"name":"series name or null","n":1,"total":null}}\nSet s to null if not part of a series. Return the JSON literal null if you cannot confidently identify the book.`;
    let raw = null;
    try {
      raw = await callClaude(prompt, systemPrompt, { feature: 'search', maxTokens: 400 });
    } catch (err) {
      if (err instanceof QuotaExceededError) return null; // treated as no match
      throw err;
    }
    const parsed = parseJSONResponse(raw);
    if (!parsed || !parsed.t || !parsed.a) return null;
    return { ...parsed, fromClaude: true, needsReview: true };
  } catch { return null; }
}

export default function BulkImport({ onClose, target = 'wishlist' }) {
  // v0.59: addToWishlist dropped from this destructure — the only caller was
  // the per-book import loop, now replaced by bulkAddToWishlist.
  const { state, bulkAddToLibrary, bulkAddToWishlist, showToast } = useData();
  const { go } = useRouter();
  const t = useT();
  const { handleQuotaError, onCallSucceeded } = useOracleQuota();

  const isLibrary = target === 'library';
  const targetWord = isLibrary ? t('bulkImport.targetLibrary') : t('bulkImport.targetWishlist');

  // v0.59: down to one source.
  //
  // - Goodreads CSV moved to Profile, where the direct RSS import lives. Two
  //   import routes in two places was the confusing part, not the CSV itself.
  // - Amazon URL paste removed. It asked the reader to collect product URLs by
  //   hand, which is more work than typing the titles into the box next to it.
  //
  // Kept as an array rather than collapsed to a constant: the tab strip and
  // switching logic still work as-is, and adding a source back is a one-liner.
  const tabs = useMemo(() => ([
    { id: 'titles', label: t('bulkImport.tabTitles'), sub: t('bulkImport.tabTitlesSub') },
  ]), [t]);

  const [tab, setTab] = useState(tabs[0].id);
  const [results, setResults] = useState([]);
  const [progress, setProgress] = useState(null);
  const [titleText, setTitleText] = useState('');
  const [importing, setImporting] = useState(false);
  // v0.44: { done, total } while the confirm-phase import is running
  const [importProgress, setImportProgress] = useState(null);

  async function lookupTitleList() {
    const parsed = parseTitleList(titleText);
    if (parsed.length === 0) { showToast(t('bulkImport.pasteTitlesFirst'), true); return; }
    setProgress({ done: 0, total: parsed.length });
    setResults(parsed.map((p) => ({ input: p.raw, status: 'pending' })));

    const out = [];
    for (let i = 0; i < parsed.length; i++) {
      const p = parsed[i];
      const local = findBookByTitle(p.t, state.wishlist);
      let book = local ? { ...local } : await lookupByTitle(p.t, p.a);
      let row;
      if (!book) {
        row = { input: p.raw, status: 'missing' };
      } else {
        const existing = findExistingDuplicate({ t: p.t, a: p.a }, book);
        if (existing) {
          row = { input: p.raw, status: 'duplicate', book };
        } else if (book.noApiMatch) {
          const claudeBook = await claudeBookFallback(p.t, p.a);
          row = claudeBook
            ? { input: p.raw, status: 'found', book: claudeBook }
            : { input: p.raw, status: 'unmatched', book };
        } else {
          row = { input: p.raw, status: 'found', book };
        }
      }
      out.push(row);
      setResults([...out, ...parsed.slice(i + 1).map((p2) => ({ input: p2.raw, status: 'pending' }))]);
      setProgress({ done: i + 1, total: parsed.length });
    }
    setProgress(null);
  }

  function findExistingDuplicate(candidate, resolved = null) {
    const wishKeys = new Set(state.wishlist.map(bookKey));
    const libKeys = new Set(state.library.map(bookKey));
    const candKey = bookKey(candidate);
    if (wishKeys.has(candKey)) return state.wishlist.find((b) => bookKey(b) === candKey);
    if (libKeys.has(candKey)) return state.library.find((b) => bookKey(b) === candKey);
    if (resolved) {
      const resKey = bookKey(resolved);
      if (resKey !== candKey) {
        if (wishKeys.has(resKey)) return state.wishlist.find((b) => bookKey(b) === resKey);
        if (libKeys.has(resKey)) return state.library.find((b) => bookKey(b) === resKey);
      }
      if (resolved.isbn) {
        const byIsbn = state.wishlist.find((b) => b.isbn && b.isbn === resolved.isbn) || state.library.find((b) => b.isbn && b.isbn === resolved.isbn);
        if (byIsbn) return byIsbn;
      }
      if (resolved.hardcoverId) {
        const byHc = state.wishlist.find((b) => b.hardcoverId === resolved.hardcoverId) || state.library.find((b) => b.hardcoverId === resolved.hardcoverId);
        if (byHc) return byHc;
      }
    }
    // v0.44 (Goodreads import polish): edition-insensitive fallback. Exact
    // bookKey misses when one side carries a parenthetical the other lacks —
    // "The Hobbit (75th Anniversary Edition)" vs "The Hobbit". Compare again
    // with parentheticals stripped via cleanTitle. Runs only when the exact
    // passes above found nothing, so it can't demote a stronger match.
    const editionKey = (b) => bookKey({ t: cleanTitle(b.t || ''), a: b.a });
    const candEdKey = editionKey(candidate);
    const byEdition = state.wishlist.find((b) => editionKey(b) === candEdKey)
      || state.library.find((b) => editionKey(b) === candEdKey);
    if (byEdition) return byEdition;
    return null;
  }

  async function confirmImport() {
    const toAdd = results.filter((r) => (r.status === 'found' || r.status === 'unmatched') && r.book);
    if (toAdd.length === 0) { showToast(t('bulkImport.nothingToImport', { target: targetWord }), true); return; }
    setImporting(true);
    let added = 0;
    const books = toAdd.map((r) => r.book);
    // v0.44 (Goodreads import polish): per-book progress on the import phase —
    // large libraries (500+) take minutes of sequential upserts, so the save
    // button counts up instead of showing an indeterminate "Adding…".
    const onImportProgress = (done, total) => setImportProgress({ done, total });
    if (isLibrary) {
      added = await bulkAddToLibrary(books, onImportProgress);
    } else {
      // v0.59: was a per-book addToWishlist loop, which fired a toast and a
      // state commit for every single book. Fine for a handful, unusable for
      // a 500-title "Want to Read" shelf.
      added = await bulkAddToWishlist(books, onImportProgress);
    }
    setImportProgress(null);
    setImporting(false);
    showToast(added === 1
      ? t('bulkImport.added', { count: added, target: targetWord })
      : t('bulkImport.addedPlural', { count: added, target: targetWord }));
    onClose();
  }

  function clearResults() { setResults([]); setProgress(null); }
  function switchTab(id) { setTab(id); clearResults(); }

  const foundCount = results.filter((r) => r.status === 'found').length;
  const unmatchedCount = results.filter((r) => r.status === 'unmatched').length;
  const dupCount = results.filter((r) => r.status === 'duplicate').length;
  const missCount = results.filter((r) => r.status === 'missing').length;
  const hasResults = results.length > 0;

  return (
    <div className="bulk-form">
      <div className="manual-add-header">
        <h3>{isLibrary ? t('bulkImport.titleLibrary') : t('bulkImport.titleWishlist')}</h3>
        <button className="manual-add-close" onClick={onClose}>×</button>
      </div>

      <div className="bulk-tabs">
        {tabs.map((tb) => (
          <button key={tb.id} className={`source-tab ${tab === tb.id ? 'active' : ''}`} onClick={() => switchTab(tb.id)}>
            <div className="source-tab__head">
              <span className="source-tab__title">{tb.label}</span>
            </div>
            <div className="source-tab__sub">{tb.sub}</div>
          </button>
        ))}
      </div>

      {tab === 'titles' && !hasResults && (
        <>
          <div className="field field-full">
            <label>{t('bulkImport.titlesOnePerLine')}</label>
            <textarea placeholder={t('bulkImport.titlesPlaceholder')} rows={10} value={titleText} onChange={(e) => setTitleText(e.target.value)} className="textarea" style={{ fontFamily: "monospace" }} />
          </div>
          <div className="upload-help">{t('bulkImport.titlesHelp')}</div>
          <div className="bulk-actions">
            <span className="manual-add-note">{isLibrary ? t('bulkImport.titlesNoteLibrary') : t('bulkImport.titlesNoteWishlist')}</span>
            <button className="btn-primary" onClick={lookupTitleList} disabled={!titleText.trim()}>{t('bulkImport.lookUpBtn')}</button>
          </div>
        </>
      )}

      {/* v0.59: Goodreads now has one home. Say where it is rather than
          leaving readers to hunt for a tab that used to be here. */}
      {!hasResults && (
        <div className="bulk-moved-note">
          {t('onboarding.import.movedNotice')}{' '}
          <a
            href="#"
            onClick={(e) => { e.preventDefault(); onClose(); go('profile'); }}
          >
            {t('onboarding.import.movedLink')}
          </a>
        </div>
      )}

      {hasResults && (
        <>
          <div className="bulk-source-row">
            <span className="bulk-summary">
              {progress ? (
                <>{t('bulkImport.lookingUp', { done: progress.done, total: progress.total })}</>
              ) : (
                <>
                  <span className="bulk-hl">{t('bulkImport.readyCount', { count: foundCount })}</span>
                  {unmatchedCount > 0 && <> · <span className="bulk-hl">{t('bulkImport.addAsIs', { count: unmatchedCount })}</span></>}
                  {dupCount > 0 && <> · <span className="bulk-hl-muted">{t('bulkImport.alreadyHave', { count: dupCount })}</span></>}
                  {missCount > 0 && <> · <span className="bulk-error bulk-error--inline">{t('bulkImport.notFoundCount', { count: missCount })}</span></>}
                </>
              )}
            </span>
          </div>

          <div className="bulk-result-list">
            {results.map((r, i) => (
              <ResultRow key={i} row={r} t={t} onRemove={() => setResults(results.filter((_, idx) => idx !== i))} />
            ))}
          </div>

          <div className="bulk-actions">
            <span className="manual-add-note">
              {t('bulkImport.resultsReadyNote')}{' '}
              {unmatchedCount > 0 && <em style={{ opacity: .7 }}>{t('bulkImport.resultsUnmatchedNote')}</em>}
            </span>
            <button className="btn-secondary" onClick={clearResults} disabled={importing}>{t('bulkImport.startOver')}</button>
            <button className="btn-primary" onClick={confirmImport} disabled={(foundCount + unmatchedCount) === 0 || importing || progress}>
              {importing
                ? (importProgress
                    ? t('bulkImport.addingProgress', { done: importProgress.done, total: importProgress.total })
                    : t('bulkImport.adding'))
                : t('bulkImport.addBtn', { count: foundCount + unmatchedCount, target: targetWord })}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function ResultRow({ row, onRemove, t }) {
  const statusBadge = {
    pending: { label: t('bulkImport.statusPending'), color: 'var(--ro-muted)' },
    found: { label: t('bulkImport.statusFound'), color: 'var(--ro-gold-text)' },
    duplicate: { label: t('bulkImport.statusDuplicate'), color: 'var(--ro-muted)' },
    missing: { label: t('bulkImport.statusMissing'), color: 'var(--ro-error)' },
    unmatched: { label: t('bulkImport.statusUnmatched'), color: 'var(--ro-gold)' },
  }[row.status] || { label: row.status, color: 'var(--ro-muted)' };

  return (
    <div className="bulk-result-row" style={{ opacity: row.status === 'pending' || row.status === 'duplicate' || row.status === 'missing' ? 0.7 : 1 }}>
      <div className="bulk-result-info">
        {row.book ? (
          <>
            <div className="bulk-result-title">{row.book.t}</div>
            <div className="bulk-result-meta">
              {row.book.a}
              {row.book.g && <> · {row.book.g}</>}
              {row.book.rating > 0 && <> · <span className="bulk-hl">{'★'.repeat(row.book.rating)}</span></>}
            </div>
          </>
        ) : (
          <div className="bulk-result-meta" style={{ wordBreak: "break-all" }}>{row.input}</div>
        )}
        {row.error && <div className="bulk-error">{row.error}</div>}
      </div>
      <span className="bulk-status" style={{ color: statusBadge.color }}>
        {statusBadge.label}
      </span>
      <button onClick={onRemove} className="modal-close-btn" style={{ fontSize: "1.2rem" }} title={t('bulkImport.removeRow')}>
        ×
      </button>
    </div>
  );
}
