// ScanModal — scan a pile of books by their barcodes.
//
// The shape of this screen is set by what the reader is physically doing:
// pull a book off the shelf, flip it, hold it up, drop it on the done pile.
// That is 2–3 seconds per book and the UI gets none of them, so scanning is
// continuous and there is no per-book tap. The two things the reader needs are
// (1) instant confirmation of what was just added, and (2) a visible pile, and
// both live over the camera so nobody has to leave the viewfinder.
//
// The confirmation card never waits on the network. It appears the moment the
// barcode is decoded, with the cover and title filling in when the lookup
// lands. Coupling it to Hardcover's response time would make a fast feature
// feel slow.

import { useState, useRef, useEffect, useCallback } from 'react';
import { useData } from '../lib/DataContext';
import { useT } from '../lib/I18nContext';
import { createScanner, screenCode } from '../lib/barcodeScanner';
import { resolveIsbn } from '../lib/scanResolve';
import { bookKey } from '../lib/bookHelpers';

const CONFIRM_MS = 2200;

export default function ScanModal({ onClose, target = null }) {
  const t = useT();
  const { state, bulkAddToLibrary, bulkAddToWishlist, showToast } = useData();

  const videoRef = useRef(null);
  const scannerRef = useRef(null);
  const confirmTimer = useRef(null);
  // The pile is also held in a ref so the scanner callback — which closes over
  // its first render — can dedupe against the current list rather than a stale one.
  const pileRef = useRef([]);

  const [phase, setPhase] = useState('gate');      // gate | scanning | review
  const [pile, setPile] = useState([]);
  const [confirm, setConfirm] = useState(null);    // the card over the camera
  const [status, setStatus] = useState(null);      // { engine, torch, ... }
  const [problem, setProblem] = useState(null);    // blocking failure
  const [torchOn, setTorchOn] = useState(false);
  const [manual, setManual] = useState('');
  const [saving, setSaving] = useState(false);
  const [destination, setDestination] = useState(target || 'wishlist');

  const buzz = (pattern) => { try { navigator.vibrate?.(pattern); } catch { /* unsupported */ } };

  const showConfirm = useCallback((card) => {
    setConfirm(card);
    clearTimeout(confirmTimer.current);
    confirmTimer.current = setTimeout(() => setConfirm(null), CONFIRM_MS);
  }, []);

  // ---- adding -------------------------------------------------------------
  const addIsbn = useCallback(async (isbn) => {
    if (pileRef.current.some((b) => b.isbn === isbn)) {
      buzz([8, 40, 8]);
      showConfirm({ isbn, state: 'duplicate' });
      return;
    }

    const entry = { isbn, state: 'resolving', book: null, owned: false };
    pileRef.current = [...pileRef.current, entry];
    setPile(pileRef.current);
    buzz(12);
    showConfirm({ isbn, state: 'resolving' });

    const { book } = await resolveIsbn(isbn);

    // Already on a shelf? Say so rather than adding it twice — the reader is
    // standing in a shop deciding whether to buy it, and that is the single
    // most useful thing the app can tell them at that moment.
    let owned = false;
    if (book) {
      const key = bookKey(book);
      owned = state.wishlist.some((b) => bookKey(b) === key)
        || state.library.some((b) => bookKey(b) === key);
    }

    const resolved = { isbn, state: book ? 'found' : 'unresolved', book, owned };
    pileRef.current = pileRef.current.map((e) => (e.isbn === isbn ? resolved : e));
    setPile(pileRef.current);
    setConfirm((c) => (c && c.isbn === isbn ? { ...resolved } : c));
  }, [showConfirm, state.wishlist, state.library]);

  // ---- scanner lifecycle --------------------------------------------------
  const startScanning = useCallback(() => {
    setPhase('scanning');
    const scanner = createScanner({
      video: videoRef.current,
      onAccept: (isbn) => { addIsbn(isbn); },
      onReady: (info) => { setStatus(info); setProblem(null); },
      onError: (err) => {
        if (err.kind === 'engine-fallback') return;
        setProblem(err.kind);
      },
    });
    scannerRef.current = scanner;
    scanner.start();
  }, [addIsbn]);

  useEffect(() => () => {
    clearTimeout(confirmTimer.current);
    scannerRef.current?.stop();
  }, []);

  // Stop decoding while the review sheet is open: it is wasted battery, and a
  // barcode drifting through frame behind the sheet should not add a book the
  // reader cannot see arrive.
  useEffect(() => {
    if (!scannerRef.current) return;
    if (phase === 'review') scannerRef.current.pause();
    else if (phase === 'scanning') scannerRef.current.resume();
  }, [phase]);

  // ---- manual + photo -----------------------------------------------------
  function submitManual(e) {
    e.preventDefault();
    const screened = screenCode(manual);
    if (!screened.ok) { showToast(t('scan.manualInvalid'), true); return; }
    addIsbn(screened.isbn);
    setManual('');
  }

  async function onPhoto(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const scanner = scannerRef.current || createScanner({ video: videoRef.current });
    scannerRef.current = scanner;
    const isbn = await scanner.decodeImageFile(file);
    if (isbn) addIsbn(isbn);
    else showToast(t('scan.photoNoCode'), true);
  }

  async function toggleTorch() {
    const next = !torchOn;
    const ok = await scannerRef.current?.setTorch(next);
    if (ok) setTorchOn(next);
  }

  // ---- saving -------------------------------------------------------------
  const keepable = pile.filter((e) => e.book && !e.owned);

  async function save() {
    if (keepable.length === 0) { showToast(t('scan.nothingToAdd'), true); return; }
    setSaving(true);
    const books = keepable.map((e) => e.book);
    const added = destination === 'library'
      ? await bulkAddToLibrary(books)
      : await bulkAddToWishlist(books);
    setSaving(false);
    const where = destination === 'library' ? t('scan.destLibrary') : t('scan.destWishlist');
    showToast(added === 1
      ? t('scan.savedOne', { target: where })
      : t('scan.savedMany', { count: added, target: where }));
    onClose();
  }

  function removeAt(isbn) {
    pileRef.current = pileRef.current.filter((e) => e.isbn !== isbn);
    setPile(pileRef.current);
  }

  const problemCopy = {
    'camera-denied': t('scan.errCameraDenied'),
    'no-camera-api': t('scan.errNoCamera'),
    'no-decoder': t('scan.errNoDecoder'),
  }[problem];

  return (
    <div className="overlay scan-overlay" role="dialog" aria-modal="true" aria-label={t('scan.title')}>
      <div className="scan">

        <div className="scan__stage">
          <video ref={videoRef} className="scan__video" playsInline muted />
          <div className="scan__scrim" aria-hidden="true" />

          <div className={`scan__reticle${confirm ? ' is-locked' : ''}`} aria-hidden="true">
            <span className="scan__corner scan__corner--tl" />
            <span className="scan__corner scan__corner--tr" />
            <span className="scan__corner scan__corner--bl" />
            <span className="scan__corner scan__corner--br" />
          </div>

          <div className="scan__bar">
            <span className="scan__heading">{t('scan.title')}</span>
            <span className="scan__spacer" />
            {status?.torch && (
              <button
                type="button"
                className={`scan__chip${torchOn ? ' is-on' : ''}`}
                onClick={toggleTorch}
                aria-pressed={torchOn}
              >{t('scan.torch')}</button>
            )}
            <button type="button" className="scan__chip" onClick={onClose}>{t('scan.close')}</button>
          </div>

          {phase === 'scanning' && !problem && !confirm && (
            <p className="scan__hint">{t('scan.hint')}</p>
          )}

          {/* The gate. Start exists because applying continuous autofocus is
              only reliably honoured after a user gesture, and without autofocus
              a barcode at reading distance is a smear no decoder can read. */}
          {phase === 'gate' && (
            <div className="scan__gate">
              <h2 className="scan__gate-title">{t('scan.gateTitle')}</h2>
              <p className="scan__gate-copy">{t('scan.gateCopy')}</p>
              <button type="button" className="btn-primary scan__start" onClick={startScanning}>
                {t('scan.start')}
              </button>
            </div>
          )}

          {problemCopy && (
            <div className="scan__problem" role="alert">
              <p>{problemCopy}</p>
              <p className="scan__problem-alt">{t('scan.problemAlt')}</p>
            </div>
          )}

          {confirm && <ConfirmCard card={confirm} t={t} />}
        </div>

        {/* Always-available paths that do not depend on the camera. */}
        {phase !== 'review' && (
          <form className="scan__manual" onSubmit={submitManual}>
            <input
              id="scan-manual-isbn"
              className="scan__input"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              placeholder={t('scan.manualPlaceholder')}
              aria-label={t('scan.manualLabel')}
            />
            <button type="submit" className="btn-secondary scan__manual-btn" disabled={!manual.trim()}>
              {t('scan.manualAdd')}
            </button>
            <label className="btn-secondary scan__photo">
              {t('scan.photo')}
              <input type="file" accept="image/*" capture="environment" onChange={onPhoto} hidden />
            </label>
          </form>
        )}

        {/* The pile. Visible while scanning so it fills up in front of the
            reader — that is the whole reward loop of doing forty books. */}
        <button
          type="button"
          className="scan__pile"
          onClick={() => setPhase(phase === 'review' ? 'scanning' : 'review')}
          aria-expanded={phase === 'review'}
        >
          <span className="scan__thumbs" aria-hidden="true">
            {pile.slice(-3).reverse().map((e) => (
              <span
                key={e.isbn}
                className="scan__thumb"
                style={e.book?.coverUrl ? { backgroundImage: `url(${e.book.coverUrl})` } : undefined}
              />
            ))}
          </span>
          <span className="scan__count">{pile.length}</span>
          <span className="scan__count-label">
            {pile.length === 1 ? t('scan.inPileOne') : t('scan.inPile')}
          </span>
          <span className="scan__spacer" />
          <span className="scan__pile-action">
            {phase === 'review' ? t('scan.backToCamera') : t('scan.reviewPile')}
          </span>
        </button>

        {phase === 'review' && (
          <div className="scan__review">
            {pile.length === 0 && <p className="scan__empty">{t('scan.pileEmpty')}</p>}

            <div className="scan__list">
              {pile.slice().reverse().map((e) => (
                <PileRow key={e.isbn} entry={e} t={t} onRemove={() => removeAt(e.isbn)} />
              ))}
            </div>

            {pile.length > 0 && (
              <>
                <div className="scan__dest">
                  <span className="scan__dest-label">{t('scan.destLabel')}</span>
                  <div className="scan__dest-choices">
                    {['wishlist', 'library'].map((d) => (
                      <button
                        key={d}
                        type="button"
                        className={`scan__dest-btn${destination === d ? ' is-active' : ''}`}
                        onClick={() => setDestination(d)}
                        aria-pressed={destination === d}
                      >
                        {d === 'library' ? t('scan.destLibrary') : t('scan.destWishlist')}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="scan__actions">
                  <button type="button" className="btn-secondary" onClick={() => setPhase('scanning')} disabled={saving}>
                    {t('scan.keepScanning')}
                  </button>
                  <button type="button" className="btn-primary" onClick={save} disabled={saving || keepable.length === 0}>
                    {saving
                      ? t('scan.saving')
                      : t('scan.save', {
                          count: keepable.length,
                          target: destination === 'library' ? t('scan.destLibrary') : t('scan.destWishlist'),
                        })}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// The quick confirmation. Cover and title fill in when the lookup lands; the
// card itself is on screen the instant the barcode decodes.
function ConfirmCard({ card, t }) {
  const { state: s, book, isbn, owned } = card;
  const cls = `scan__confirm scan__confirm--${s}`;

  if (s === 'duplicate') {
    return (
      <div className={cls} role="status">
        <div className="scan__confirm-body">
          <span className="scan__confirm-kicker">{t('scan.alreadyInPile')}</span>
          <span className="scan__confirm-isbn">{isbn}</span>
        </div>
      </div>
    );
  }

  return (
    <div className={cls} role="status">
      <div
        className="scan__confirm-cover"
        style={book?.coverUrl ? { backgroundImage: `url(${book.coverUrl})` } : undefined}
        aria-hidden="true"
      />
      <div className="scan__confirm-body">
        <span className="scan__confirm-kicker">
          {s === 'resolving' && t('scan.added')}
          {s === 'found' && (owned ? t('scan.alreadyOnShelf') : t('scan.added'))}
          {s === 'unresolved' && t('scan.notIdentified')}
        </span>
        <span className="scan__confirm-title">
          {book ? book.t : (s === 'resolving' ? t('scan.looking') : isbn)}
        </span>
        {book?.a && <span className="scan__confirm-author">{book.a}</span>}
      </div>
    </div>
  );
}

function PileRow({ entry, onRemove, t }) {
  const { book, isbn, state: s, owned } = entry;
  const badge = owned
    ? { label: t('scan.badgeOwned'), cls: 'is-muted' }
    : s === 'found'
      ? { label: t('scan.badgeReady'), cls: 'is-ready' }
      : s === 'unresolved'
        ? { label: t('scan.badgeUnknown'), cls: 'is-error' }
        : { label: t('scan.badgeResolving'), cls: 'is-muted' };

  return (
    <div className={`scan__row${owned ? ' is-dim' : ''}`}>
      <span
        className="scan__row-cover"
        style={book?.coverUrl ? { backgroundImage: `url(${book.coverUrl})` } : undefined}
        aria-hidden="true"
      />
      <span className="scan__row-meta">
        <span className="scan__row-title">{book ? book.t : t('scan.notIdentified')}</span>
        <span className="scan__row-sub">{book?.a || isbn}</span>
      </span>
      <span className={`scan__row-badge ${badge.cls}`}>{badge.label}</span>
      <button type="button" className="scan__row-remove" onClick={onRemove} aria-label={t('scan.removeRow')}>×</button>
    </div>
  );
}
