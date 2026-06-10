import { useRef, useState, useMemo } from 'react';
import { useData } from '../lib/DataContext';
import { parseGoodreadsToReadCSV, parseGoodreadsCSV } from '../lib/goodreadsImport';
import { findBookByTitle, bookKey } from '../lib/bookHelpers';
import {
  extractAsinFromUrl,
  lookupByAsin,
  lookupByTitle,
  parseTitleList,
} from '../lib/bookLookup';

// Result row shape: { input, status: 'pending'|'found'|'missing'|'duplicate'|'unmatched', book?, error? }

// `target` controls which shelf the books are added to.
//   'wishlist' (default) — original behavior, adds via addToWishlist
//   'library'            — v0.9: adds via bulkAddToLibrary or importGoodreads
//
// For target='library', the Goodreads CSV tab is treated as a one-time
// migration: it's hidden once the user has imported their Goodreads library
// (state.profile.goodreadsImported). The other two tabs (titles, Amazon URLs)
// remain available for ongoing additions.
export default function BulkImport({ onClose, target = 'wishlist' }) {
  const {
    state,
    addToWishlist,
    bulkAddToLibrary,
    importGoodreads,
    showToast,
  } = useData();

  const isLibrary = target === 'library';
  const goodreadsAvailable = !isLibrary || !state.profile.goodreadsImported;

  // Tab definitions, conditional on target + goodreads-already-imported
  const tabs = useMemo(() => {
    const t = [];
    if (goodreadsAvailable) {
      t.push({
        id: 'goodreads',
        label: 'Goodreads CSV',
        sub: isLibrary ? 'read shelf · one-time' : 'to-read shelf',
      });
    }
    t.push({ id: 'titles', label: 'Paste titles', sub: 'one per line' });
    t.push({ id: 'amazon', label: 'Amazon URLs', sub: 'one per line' });
    return t;
  }, [goodreadsAvailable, isLibrary]);

  const [tab, setTab] = useState(tabs[0].id);
  const [results, setResults] = useState([]); // rows after lookup
  const [progress, setProgress] = useState(null); // { done, total }
  const [titleText, setTitleText] = useState('');
  const [amazonText, setAmazonText] = useState('');
  const [importing, setImporting] = useState(false);
  const csvRef = useRef(null);

  // ----- Goodreads CSV flow -----
  async function handleGoodreadsFile(file) {
    try {
      const text = await file.text();
      // For wishlist target: pull the to-read shelf.
      // For library target: pull the read shelf (and the rating Goodreads has).
      const books = isLibrary
        ? parseGoodreadsCSV(text)
        : parseGoodreadsToReadCSV(text);
      if (books.length === 0) {
        showToast(
          isLibrary
            ? "Couldn't find any read books in that CSV. Make sure it's the full Goodreads export."
            : "Couldn't find any 'to-read' books in that CSV. Make sure your Goodreads export includes the to-read shelf.",
          true
        );
        return;
      }
      const rows = books.map((b) => {
        const dup = isAlreadyOnTarget(b);
        if (dup) return { input: `${b.t} — ${b.a}`, status: 'duplicate', book: b };
        const match = findBookByTitle(b.t, state.wishlist);
        // Preserve the Goodreads rating (b.rating) on the enriched book
        const enriched = match ? { ...match, ...b } : b;
        return { input: `${b.t} — ${b.a}`, status: 'found', book: enriched };
      });
      setResults(rows);
    } catch {
      showToast("Couldn't read that file.", true);
    }
  }

  // ----- Title list flow -----
  async function lookupTitleList() {
    const parsed = parseTitleList(titleText);
    if (parsed.length === 0) {
      showToast('Paste one book per line first.', true);
      return;
    }
    setProgress({ done: 0, total: parsed.length });
    setResults(parsed.map((p) => ({ input: p.raw, status: 'pending' })));

    const out = [];
    for (let i = 0; i < parsed.length; i++) {
      const p = parsed[i];
      // Try catalog first (instant, no network) before lookup chain
      const local = findBookByTitle(p.t, state.wishlist);
      let book;
      if (local) {
        book = { ...local };
      } else {
        const found = await lookupByTitle(p.t, p.a);
        book = found;
      }
      let row;
      if (!book) {
        // lookupByTitle now always returns at least the raw input,
        // so this branch should be unreachable. Keep it as safety.
        row = { input: p.raw, status: 'missing' };
      } else {
        // Dedup checks BOTH the user's typed title AND the resolved canonical
        // title, so translated editions don't slip past as duplicates.
        const candidate = { t: p.t, a: p.a };
        const existing = findExistingDuplicate(candidate, book);
        if (existing) {
          row = { input: p.raw, status: 'duplicate', book };
        } else if (book.noApiMatch) {
          // All APIs missed — flag as a "missing" warning but still let the
          // user add it (it will be inserted as unverified)
          row = { input: p.raw, status: 'unmatched', book };
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

  // ----- Amazon URL flow -----
  async function lookupAmazonUrls() {
    const urls = amazonText
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    if (urls.length === 0) {
      showToast('Paste one Amazon URL per line first.', true);
      return;
    }
    setProgress({ done: 0, total: urls.length });
    setResults(urls.map((u) => ({ input: u, status: 'pending' })));

    const out = [];
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      const asin = extractAsinFromUrl(url);
      let row;
      if (!asin) {
        row = {
          input: url,
          status: 'missing',
          error: url.includes('amzn.to')
            ? "Short links can't be resolved — paste the full amazon.com URL"
            : "Couldn't extract ASIN from this URL",
        };
      } else {
        const book = await lookupByAsin(asin, url);
        if (!book) {
          row = { input: url, status: 'missing', error: `ASIN ${asin} not found in any catalog` };
        } else {
          const existing = findExistingDuplicate(book, book);
          if (existing) {
            row = { input: url, status: 'duplicate', book };
          } else {
            row = { input: url, status: 'found', book };
          }
        }
      }
      out.push(row);
      setResults([...out, ...urls.slice(i + 1).map((u2) => ({ input: u2, status: 'pending' }))]);
      setProgress({ done: i + 1, total: urls.length });
    }
    setProgress(null);
  }

  // Dedup helper. Takes a `candidate` (typed by user) and optionally the
  // `resolved` book returned by the lookup. Checks against BOTH the wishlist
  // AND library regardless of target — adding a book you've already read to
  // your wishlist makes no sense and vice versa.
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
      // Also try matching by ISBN if both have one
      if (resolved.isbn) {
        const byIsbn =
          state.wishlist.find((b) => b.isbn && b.isbn === resolved.isbn) ||
          state.library.find((b) => b.isbn && b.isbn === resolved.isbn);
        if (byIsbn) return byIsbn;
      }
      // Also try matching by hardcoverId
      if (resolved.hardcoverId) {
        const byHc =
          state.wishlist.find((b) => b.hardcoverId === resolved.hardcoverId) ||
          state.library.find((b) => b.hardcoverId === resolved.hardcoverId);
        if (byHc) return byHc;
      }
    }
    return null;
  }

  function isAlreadyOnTarget(book) {
    return findExistingDuplicate(book) !== null;
  }

  async function confirmImport() {
    const toAdd = results.filter(
      (r) => (r.status === 'found' || r.status === 'unmatched') && r.book
    );
    if (toAdd.length === 0) {
      const targetWord = isLibrary ? 'library' : 'wishlist';
      showToast(`Nothing to import — every row is missing or already in your ${targetWord}.`, true);
      return;
    }
    setImporting(true);
    let added = 0;
    const books = toAdd.map((r) => r.book);

    if (isLibrary) {
      // Library path: Goodreads tab goes through importGoodreads (sets the
      // goodreadsImported flag so the tab disappears next time). The other
      // tabs go through bulkAddToLibrary (no rating, no flag changes).
      if (tab === 'goodreads') {
        await importGoodreads(books);
        added = books.length; // importGoodreads handles dedup internally
      } else {
        added = await bulkAddToLibrary(books);
      }
    } else {
      // Wishlist path: same as before
      for (const row of toAdd) {
        const ok = await addToWishlist(row.book);
        if (ok) added++;
      }
    }

    setImporting(false);
    const targetWord = isLibrary ? 'library' : 'wishlist';
    showToast(`Added ${added} ${added === 1 ? 'book' : 'books'} to your ${targetWord}`);
    onClose();
  }

  function clearResults() {
    setResults([]);
    setProgress(null);
  }

  function switchTab(t) {
    setTab(t);
    clearResults();
  }

  const foundCount = results.filter((r) => r.status === 'found').length;
  const unmatchedCount = results.filter((r) => r.status === 'unmatched').length;
  const dupCount = results.filter((r) => r.status === 'duplicate').length;
  const missCount = results.filter((r) => r.status === 'missing').length;
  const hasResults = results.length > 0;

  const headerWord = isLibrary ? 'library' : 'wishlist';

  return (
    <div className="manual-add-form" style={{ marginBottom: '1.5rem' }}>
      <div className="manual-add-header">
        <h3>Bulk import to {headerWord}</h3>
        <button className="manual-add-close" onClick={onClose}>×</button>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        {tabs.map((t) => (
          <button
            key={t.id}
            className={`toggle-btn ${tab === t.id ? 'active' : ''}`}
            onClick={() => switchTab(t.id)}
            style={{ flex: '1 1 auto', minWidth: '160px' }}
          >
            {t.label}
            <span className="toggle-sub">{t.sub}</span>
          </button>
        ))}
      </div>

      {/* Per-tab input */}
      {tab === 'goodreads' && !hasResults && (
        <>
          <input
            ref={csvRef}
            type="file"
            className="file-hidden"
            accept=".csv,text/csv"
            onChange={(e) => {
              const f = e.target.files[0];
              if (f) handleGoodreadsFile(f);
            }}
          />
          <div className="upload-zone" onClick={() => csvRef.current?.click()}>
            <div className="upload-icon">📚</div>
            <div className="upload-text">Drop your Goodreads CSV here</div>
            <div className="upload-sub">
              {isLibrary
                ? <>We'll pull books from your <strong>read</strong> shelf along with any ratings you gave them</>
                : <>We'll pull books from your <strong>to-read</strong> shelf</>}
            </div>
          </div>
          <div className="upload-help">
            <strong>How to export from Goodreads:</strong>{' '}
            <a href="https://www.goodreads.com/review/import" target="_blank" rel="noreferrer">
              goodreads.com/review/import
            </a>{' '}→ Export Library → wait → download.
            {isLibrary && (
              <> This is a <strong>one-time</strong> import — once you've brought in your read history, the tab will disappear.</>
            )}
          </div>
        </>
      )}

      {tab === 'titles' && !hasResults && (
        <>
          <div className="field field-full">
            <label>One book per line</label>
            <textarea
              placeholder={`The Reformatory — Tananarive Due\nWe Have Always Lived in the Castle by Shirley Jackson\nKindred\nAnnihilation - Jeff VanderMeer`}
              rows={10}
              value={titleText}
              onChange={(e) => setTitleText(e.target.value)}
              style={{ fontFamily: 'monospace', fontSize: '0.9rem' }}
            />
          </div>
          <div className="upload-help">
            Author is optional but helps. Separators we recognize: <code>—</code>, <code>–</code>, <code> - </code>, or <code> by </code>. Lines starting with <code>#</code> are skipped.
          </div>
          <div className="manual-add-actions" style={{ marginTop: '1rem' }}>
            <span className="manual-add-note">
              {isLibrary
                ? "We'll look each one up so we have proper metadata in your library."
                : "We'll look each one up in OpenLibrary and let you review before adding."}
            </span>
            <button className="btn" onClick={lookupTitleList} disabled={!titleText.trim()}>
              Look up books ❦
            </button>
          </div>
        </>
      )}

      {tab === 'amazon' && !hasResults && (
        <>
          <div className="field field-full">
            <label>One Amazon URL per line</label>
            <textarea
              placeholder={`https://www.amazon.com/dp/B07XYZ1234\nhttps://www.amazon.com/Title-Of-Book/dp/0593240502`}
              rows={10}
              value={amazonText}
              onChange={(e) => setAmazonText(e.target.value)}
              style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}
            />
          </div>
          <div className="upload-help">
            We extract the ASIN/ISBN from each URL and look the book up via OpenLibrary. Amazon doesn't expose its catalog publicly, so titles and authors come from OL. Short links (<code>amzn.to/…</code>) can't be resolved — paste the full URL.
          </div>
          <div className="manual-add-actions" style={{ marginTop: '1rem' }}>
            <span className="manual-add-note">Your Amazon URL is preserved on each book so "View on Amazon" works.</span>
            <button className="btn" onClick={lookupAmazonUrls} disabled={!amazonText.trim()}>
              Look up books ❦
            </button>
          </div>
        </>
      )}

      {/* Results panel */}
      {hasResults && (
        <>
          <div style={{ marginBottom: '1rem', display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ color: 'var(--paper-aged)' }}>
              {progress ? (
                <>Looking up… <strong>{progress.done}/{progress.total}</strong></>
              ) : (
                <>
                  <span style={{ color: 'var(--gilt-bright)' }}>{foundCount} ready</span>
                  {unmatchedCount > 0 && <> · <span style={{ color: 'var(--gilt)' }}>{unmatchedCount} add as-is</span></>}
                  {dupCount > 0 && <> · <span style={{ opacity: 0.6 }}>{dupCount} already in library/wishlist</span></>}
                  {missCount > 0 && <> · <span style={{ color: 'var(--blood-bright)' }}>{missCount} not found</span></>}
                </>
              )}
            </span>
          </div>

          <div style={{ maxHeight: '50vh', overflowY: 'auto', border: '1px solid rgba(176, 140, 63, 0.2)', borderRadius: '2px' }}>
            {results.map((r, i) => (
              <ResultRow key={i} row={r} onRemove={() => setResults(results.filter((_, idx) => idx !== i))} />
            ))}
          </div>

          <div className="manual-add-actions" style={{ marginTop: '1rem' }}>
            <span className="manual-add-note">
              Books marked <strong style={{ color: 'var(--gilt-bright)' }}>ready</strong> or{' '}
              <strong style={{ color: 'var(--gilt)' }}>add as-is</strong> will be added.{' '}
              {unmatchedCount > 0 && (
                <em style={{ opacity: 0.7 }}>
                  Books we couldn't find in any catalog are added with just your typed title — flagged for review.
                </em>
              )}
            </span>
            <button className="btn btn-ghost" onClick={clearResults} disabled={importing}>
              Start over
            </button>
            <button className="btn" onClick={confirmImport} disabled={(foundCount + unmatchedCount) === 0 || importing || progress}>
              {importing
                ? 'Adding…'
                : `Add ${foundCount + unmatchedCount} to ${headerWord} ❦`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function ResultRow({ row, onRemove }) {
  const statusBadge = {
    pending: { label: '…', color: 'var(--paper-aged)' },
    found: { label: 'ready', color: 'var(--gilt-bright)' },
    duplicate: { label: 'already have it', color: 'var(--paper-aged)' },
    missing: { label: 'not found', color: 'var(--blood-bright)' },
    unmatched: { label: 'add as-is', color: 'var(--gilt)' },
  }[row.status] || { label: row.status, color: 'var(--paper-aged)' };

  return (
    <div
      style={{
        padding: '0.7rem 0.9rem',
        borderBottom: '1px solid rgba(176, 140, 63, 0.1)',
        display: 'flex',
        alignItems: 'center',
        gap: '0.8rem',
        opacity: row.status === 'pending' || row.status === 'duplicate' || row.status === 'missing' ? 0.7 : 1,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        {row.book ? (
          <>
            <div style={{ color: 'var(--paper)', fontFamily: "'Cormorant Garamond', serif", fontStyle: 'italic', fontSize: '1.05rem' }}>
              {row.book.t}
            </div>
            <div style={{ color: 'var(--paper-aged)', fontSize: '0.85rem' }}>
              {row.book.a}
              {row.book.g && <> · {row.book.g}</>}
              {row.book.rating > 0 && <> · <span style={{ color: 'var(--gilt-bright)' }}>{'★'.repeat(row.book.rating)}</span></>}
            </div>
          </>
        ) : (
          <div style={{ color: 'var(--paper-aged)', fontSize: '0.9rem', wordBreak: 'break-all' }}>
            {row.input}
          </div>
        )}
        {row.error && (
          <div style={{ color: 'var(--blood-bright)', fontSize: '0.8rem', marginTop: '0.2rem' }}>
            {row.error}
          </div>
        )}
      </div>
      <span
        style={{
          fontFamily: "'Special Elite', monospace",
          fontSize: '0.7rem',
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: statusBadge.color,
          whiteSpace: 'nowrap',
        }}
      >
        {statusBadge.label}
      </span>
      <button
        onClick={onRemove}
        style={{
          background: 'none',
          border: 'none',
          color: 'var(--paper-aged)',
          opacity: 0.5,
          cursor: 'pointer',
          fontSize: '1.2rem',
          padding: '0 0.3rem',
        }}
        title="Remove from list"
      >
        ×
      </button>
    </div>
  );
}
