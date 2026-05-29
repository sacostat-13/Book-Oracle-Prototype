import { useRef, useState } from 'react';
import { useData } from '../lib/DataContext';
import { parseGoodreadsToReadCSV } from '../lib/goodreadsImport';
import { findBookByTitle } from '../lib/bookHelpers';
import {
  extractAsinFromUrl,
  lookupByAsin,
  lookupByTitle,
  parseTitleList,
} from '../lib/bookLookup';

const TABS = [
  { id: 'goodreads', label: 'Goodreads CSV', sub: 'to-read shelf' },
  { id: 'titles', label: 'Paste titles', sub: 'one per line' },
  { id: 'amazon', label: 'Amazon URLs', sub: 'one per line' },
];

// Result row shape: { input, status: 'pending'|'found'|'missing'|'duplicate', book?, error? }

export default function BulkImport({ onClose }) {
  const { state, addToWishlist, showToast } = useData();
  const [tab, setTab] = useState('goodreads');
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
      const books = parseGoodreadsToReadCSV(text);
      if (books.length === 0) {
        showToast(
          "Couldn't find any 'to-read' books in that CSV. Make sure your Goodreads export includes the to-read shelf.",
          true
        );
        return;
      }
      // Goodreads gives us title + author directly. Enrich against catalog
      // for genre/complexity tags where possible — no network needed.
      const rows = books.map((b) => {
        const dup = isAlreadyInWishlistOrLibrary(b);
        if (dup) return { input: `${b.t} — ${b.a}`, status: 'duplicate', book: b };
        const match = findBookByTitle(b.t, state.wishlist);
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
      // Try catalog first (instant, no network) before OL
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
        row = { input: p.raw, status: 'missing' };
      } else if (isAlreadyInWishlistOrLibrary(book)) {
        row = { input: p.raw, status: 'duplicate', book };
      } else {
        row = { input: p.raw, status: 'found', book };
      }
      out.push(row);
      // update progressively so the user sees rows fill in
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
          row = { input: url, status: 'missing', error: `ASIN ${asin} not found in OpenLibrary` };
        } else if (isAlreadyInWishlistOrLibrary(book)) {
          row = { input: url, status: 'duplicate', book };
        } else {
          row = { input: url, status: 'found', book };
        }
      }
      out.push(row);
      setResults([...out, ...urls.slice(i + 1).map((u2) => ({ input: u2, status: 'pending' }))]);
      setProgress({ done: i + 1, total: urls.length });
    }
    setProgress(null);
  }

  function isAlreadyInWishlistOrLibrary(book) {
    const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const k = norm(book.t) + '|' + norm(book.a).slice(0, 10);
    if (state.wishlist.some((b) => norm(b.t) + '|' + norm(b.a).slice(0, 10) === k)) return true;
    if (state.library.some((b) => norm(b.t) + '|' + norm(b.a).slice(0, 10) === k)) return true;
    return false;
  }

  async function confirmImport() {
    const toAdd = results.filter((r) => r.status === 'found' && r.book);
    if (toAdd.length === 0) {
      showToast('Nothing to import — every row is missing or already in your library.', true);
      return;
    }
    setImporting(true);
    let added = 0;
    for (const row of toAdd) {
      const ok = await addToWishlist(row.book);
      if (ok) added++;
    }
    setImporting(false);
    showToast(`Added ${added} ${added === 1 ? 'book' : 'books'} to your wishlist`);
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
  const dupCount = results.filter((r) => r.status === 'duplicate').length;
  const missCount = results.filter((r) => r.status === 'missing').length;
  const hasResults = results.length > 0;

  return (
    <div className="manual-add-form" style={{ marginBottom: '1.5rem' }}>
      <div className="manual-add-header">
        <h3>Bulk import to wishlist</h3>
        <button className="manual-add-close" onClick={onClose}>×</button>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        {TABS.map((t) => (
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
            <div className="upload-sub">We'll pull books from your <strong>to-read</strong> shelf</div>
          </div>
          <div className="upload-help">
            <strong>How to export from Goodreads:</strong>{' '}
            <a href="https://www.goodreads.com/review/import" target="_blank" rel="noreferrer">
              goodreads.com/review/import
            </a>{' '}→ Export Library → wait → download. This is the same file you'd use for your read books; we just look at a different shelf.
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
            <span className="manual-add-note">We'll look each one up in OpenLibrary and let you review before adding.</span>
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
              Only books marked <strong style={{ color: 'var(--gilt-bright)' }}>ready</strong> will be added.
            </span>
            <button className="btn btn-ghost" onClick={clearResults} disabled={importing}>
              Start over
            </button>
            <button className="btn" onClick={confirmImport} disabled={foundCount === 0 || importing || progress}>
              {importing ? 'Adding…' : `Add ${foundCount} to wishlist ❦`}
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
  }[row.status];

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
