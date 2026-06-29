import { useRef, useState, useMemo } from 'react';
import { useData } from '../lib/DataContext';
import { useT } from '../lib/I18nContext';
import { useOracleQuota } from '../lib/OracleQuotaContext';
import { parseGoodreadsToReadCSV, parseGoodreadsCSV } from '../lib/goodreadsImport';
import { findBookByTitle, bookKey } from '../lib/bookHelpers';
import { extractAsinFromUrl, lookupByAsin, lookupByTitle, parseTitleList } from '../lib/bookLookup';
import { callClaude, QuotaExceededError, parseJSONResponse } from '../lib/claudeApi';

async function claudeBookFallback(title, author) {
  try {
    const query = author ? `${title} by ${author}` : title;
    const systemPrompt = 'You are a book identification assistant. Return only valid JSON with no markdown fences.';
    const prompt = `Identify this book: "${query}"\nReturn ONLY valid JSON (no markdown, no explanation):\n{"t":"exact title","a":"author full name","d":"2-3 sentence description","g":"primary genre","s":{"name":"series name or null","n":1,"total":null}}\nSet s to null if not part of a series. Return the JSON literal null if you cannot confidently identify the book.`;
    let raw = null;
    try {
      raw = await callClaude(prompt, systemPrompt);
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
  const { state, addToWishlist, bulkAddToLibrary, importGoodreads, showToast } = useData();
  const t = useT();
  const { handleQuotaError, onCallSucceeded } = useOracleQuota();

  const isLibrary = target === 'library';
  const goodreadsAvailable = !isLibrary || !state.profile.goodreadsImported;
  const targetWord = isLibrary ? t('bulkImport.targetLibrary') : t('bulkImport.targetWishlist');

  const tabs = useMemo(() => {
    const arr = [];
    if (goodreadsAvailable) {
      arr.push({
        id: 'goodreads',
        label: t('bulkImport.tabGoodreads'),
        sub: isLibrary ? t('bulkImport.tabGoodreadsReadSub') : t('bulkImport.tabGoodreadsToReadSub'),
      });
    }
    arr.push({ id: 'titles', label: t('bulkImport.tabTitles'), sub: t('bulkImport.tabTitlesSub') });
    arr.push({ id: 'amazon', label: t('bulkImport.tabAmazon'), sub: t('bulkImport.tabAmazonSub') });
    return arr;
  }, [goodreadsAvailable, isLibrary]);

  const [tab, setTab] = useState(tabs[0].id);
  const [results, setResults] = useState([]);
  const [progress, setProgress] = useState(null);
  const [titleText, setTitleText] = useState('');
  const [amazonText, setAmazonText] = useState('');
  const [importing, setImporting] = useState(false);
  const csvRef = useRef(null);

  async function handleGoodreadsFile(file) {
    try {
      const text = await file.text();
      const books = isLibrary ? parseGoodreadsCSV(text) : parseGoodreadsToReadCSV(text);
      if (books.length === 0) {
        showToast(isLibrary ? t('bulkImport.goodreadsCsvError') : t('bulkImport.goodreadsCsvErrorToRead'), true);
        return;
      }
      const rows = books.map((b) => {
        const dup = isAlreadyOnTarget(b);
        if (dup) return { input: `${b.t} — ${b.a}`, status: 'duplicate', book: b };
        const match = findBookByTitle(b.t, state.wishlist);
        const enriched = match ? { ...match, ...b } : b;
        return { input: `${b.t} — ${b.a}`, status: 'found', book: enriched };
      });
      setResults(rows);
    } catch { showToast(t('bulkImport.csvReadError'), true); }
  }

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

  async function lookupAmazonUrls() {
    const urls = amazonText.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
    if (urls.length === 0) { showToast(t('bulkImport.pasteUrlsFirst'), true); return; }
    setProgress({ done: 0, total: urls.length });
    setResults(urls.map((u) => ({ input: u, status: 'pending' })));

    const out = [];
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      const asin = extractAsinFromUrl(url);
      let row;
      if (!asin) {
        row = { input: url, status: 'missing', error: url.includes('amzn.to') ? t('bulkImport.shortLinkError') : t('bulkImport.asinError') };
      } else {
        const book = await lookupByAsin(asin, url);
        if (!book) {
          row = { input: url, status: 'missing', error: t('bulkImport.asinNotFound', { asin }) };
        } else {
          const existing = findExistingDuplicate(book, book);
          row = existing ? { input: url, status: 'duplicate', book } : { input: url, status: 'found', book };
        }
      }
      out.push(row);
      setResults([...out, ...urls.slice(i + 1).map((u2) => ({ input: u2, status: 'pending' }))]);
      setProgress({ done: i + 1, total: urls.length });
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
    return null;
  }

  function isAlreadyOnTarget(book) { return findExistingDuplicate(book) !== null; }

  async function confirmImport() {
    const toAdd = results.filter((r) => (r.status === 'found' || r.status === 'unmatched') && r.book);
    if (toAdd.length === 0) { showToast(t('bulkImport.nothingToImport', { target: targetWord }), true); return; }
    setImporting(true);
    let added = 0;
    const books = toAdd.map((r) => r.book);
    if (isLibrary) {
      if (tab === 'goodreads') { await importGoodreads(books); added = books.length; }
      else { added = await bulkAddToLibrary(books); }
    } else {
      for (const row of toAdd) { const ok = await addToWishlist(row.book); if (ok) added++; }
    }
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
    <div className="manual-add-form" style={{ marginBottom: '1.5rem' }}>
      <div className="manual-add-header">
        <h3>{isLibrary ? t('bulkImport.titleLibrary') : t('bulkImport.titleWishlist')}</h3>
        <button className="manual-add-close" onClick={onClose}>×</button>
      </div>

      <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        {tabs.map((tb) => (
          <button key={tb.id} className={`toggle-btn ${tab === tb.id ? 'active' : ''}`} onClick={() => switchTab(tb.id)} style={{ flex: '1 1 auto', minWidth: '160px' }}>
            {tb.label}<span className="toggle-sub">{tb.sub}</span>
          </button>
        ))}
      </div>

      {tab === 'goodreads' && !hasResults && (
        <>
          <input ref={csvRef} type="file" className="file-hidden" accept=".csv,text/csv" onChange={(e) => { const f = e.target.files[0]; if (f) handleGoodreadsFile(f); }} />
          <div className="upload-zone" onClick={() => csvRef.current?.click()}>
            <div className="upload-icon">📚</div>
            <div className="upload-text">{t('bulkImport.goodreadsUploadText')}</div>
            <div className="upload-sub">
              {isLibrary ? <><strong>{t('bulkImport.goodreadsReadShelf')}</strong></> : <><strong>{t('bulkImport.goodreadsToReadShelf')}</strong></>}
            </div>
          </div>
          <div className="upload-help">
            <strong>{t('bulkImport.goodreadsHowTo')}</strong>{' '}
            <a href="https://www.goodreads.com/review/import" target="_blank" rel="noreferrer">{t('bulkImport.goodreadsHowToLink')}</a>{' '}{t('bulkImport.goodreadsHowToSteps')}
            {isLibrary && <> {t('bulkImport.goodreadsOneTime')}</>}
          </div>
        </>
      )}

      {tab === 'titles' && !hasResults && (
        <>
          <div className="field field-full">
            <label>{t('bulkImport.titlesOnePerLine')}</label>
            <textarea placeholder={t('bulkImport.titlesPlaceholder')} rows={10} value={titleText} onChange={(e) => setTitleText(e.target.value)} style={{ fontFamily: 'monospace', fontSize: '0.9rem' }} />
          </div>
          <div className="upload-help">{t('bulkImport.titlesHelp')}</div>
          <div className="manual-add-actions" style={{ marginTop: '1rem' }}>
            <span className="manual-add-note">{isLibrary ? t('bulkImport.titlesNoteLibrary') : t('bulkImport.titlesNoteWishlist')}</span>
            <button className="btn" onClick={lookupTitleList} disabled={!titleText.trim()}>{t('bulkImport.lookUpBtn')}</button>
          </div>
        </>
      )}

      {tab === 'amazon' && !hasResults && (
        <>
          <div className="field field-full">
            <label>{t('bulkImport.amazonOnePerLine')}</label>
            <textarea placeholder="https://www.amazon.com/dp/B07XYZ1234" rows={10} value={amazonText} onChange={(e) => setAmazonText(e.target.value)} style={{ fontFamily: 'monospace', fontSize: '0.85rem' }} />
          </div>
          <div className="upload-help">{t('bulkImport.amazonHelp')}</div>
          <div className="manual-add-actions" style={{ marginTop: '1rem' }}>
            <span className="manual-add-note">{t('bulkImport.amazonNote')}</span>
            <button className="btn" onClick={lookupAmazonUrls} disabled={!amazonText.trim()}>{t('bulkImport.lookUpBtn')}</button>
          </div>
        </>
      )}

      {hasResults && (
        <>
          <div style={{ marginBottom: '1rem', display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ color: 'var(--paper-aged)' }}>
              {progress ? (
                <>{t('bulkImport.lookingUp', { done: progress.done, total: progress.total })}</>
              ) : (
                <>
                  <span style={{ color: 'var(--gilt-bright)' }}>{t('bulkImport.readyCount', { count: foundCount })}</span>
                  {unmatchedCount > 0 && <> · <span style={{ color: 'var(--gilt)' }}>{t('bulkImport.addAsIs', { count: unmatchedCount })}</span></>}
                  {dupCount > 0 && <> · <span style={{ opacity: 0.6 }}>{t('bulkImport.alreadyHave', { count: dupCount })}</span></>}
                  {missCount > 0 && <> · <span style={{ color: 'var(--blood-bright)' }}>{t('bulkImport.notFoundCount', { count: missCount })}</span></>}
                </>
              )}
            </span>
          </div>

          <div style={{ maxHeight: '50vh', overflowY: 'auto', border: '1px solid rgba(176, 140, 63, 0.2)', borderRadius: 'var(--ro-radius-sm)' }}>
            {results.map((r, i) => (
              <ResultRow key={i} row={r} t={t} onRemove={() => setResults(results.filter((_, idx) => idx !== i))} />
            ))}
          </div>

          <div className="manual-add-actions" style={{ marginTop: '1rem' }}>
            <span className="manual-add-note">
              {t('bulkImport.resultsReadyNote')}{' '}
              {unmatchedCount > 0 && <em style={{ opacity: 0.7 }}>{t('bulkImport.resultsUnmatchedNote')}</em>}
            </span>
            <button className="btn btn-ghost" onClick={clearResults} disabled={importing}>{t('bulkImport.startOver')}</button>
            <button className="btn" onClick={confirmImport} disabled={(foundCount + unmatchedCount) === 0 || importing || progress}>
              {importing ? t('bulkImport.adding') : t('bulkImport.addBtn', { count: foundCount + unmatchedCount, target: targetWord })}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function ResultRow({ row, onRemove, t }) {
  const statusBadge = {
    pending:   { label: t('bulkImport.statusPending'),   color: 'var(--paper-aged)' },
    found:     { label: t('bulkImport.statusFound'),     color: 'var(--gilt-bright)' },
    duplicate: { label: t('bulkImport.statusDuplicate'), color: 'var(--paper-aged)' },
    missing:   { label: t('bulkImport.statusMissing'),   color: 'var(--blood-bright)' },
    unmatched: { label: t('bulkImport.statusUnmatched'), color: 'var(--gilt)' },
  }[row.status] || { label: row.status, color: 'var(--paper-aged)' };

  return (
    <div style={{ padding: '0.7rem 0.9rem', borderBottom: '1px solid rgba(176, 140, 63, 0.1)', display: 'flex', alignItems: 'center', gap: '0.8rem', opacity: row.status === 'pending' || row.status === 'duplicate' || row.status === 'missing' ? 0.7 : 1 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        {row.book ? (
          <>
            <div style={{ color: 'var(--paper)', fontFamily: 'var(--ro-font-display)', fontStyle: 'italic', fontSize: '1.05rem' }}>{row.book.t}</div>
            <div style={{ color: 'var(--paper-aged)', fontSize: '0.85rem' }}>
              {row.book.a}
              {row.book.g && <> · {row.book.g}</>}
              {row.book.rating > 0 && <> · <span style={{ color: 'var(--gilt-bright)' }}>{'★'.repeat(row.book.rating)}</span></>}
            </div>
          </>
        ) : (
          <div style={{ color: 'var(--paper-aged)', fontSize: '0.9rem', wordBreak: 'break-all' }}>{row.input}</div>
        )}
        {row.error && <div style={{ color: 'var(--blood-bright)', fontSize: '0.8rem', marginTop: '0.2rem' }}>{row.error}</div>}
      </div>
      <span style={{ fontFamily: 'var(--ro-font-mono)', fontSize: '0.7rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: statusBadge.color, whiteSpace: 'nowrap' }}>
        {statusBadge.label}
      </span>
      <button onClick={onRemove} style={{ background: 'none', border: 'none', color: 'var(--paper-aged)', opacity: 0.5, cursor: 'pointer', fontSize: '1.2rem', padding: '0 0.3rem' }} title={t('bulkImport.removeRow')}>
        ×
      </button>
    </div>
  );
}
