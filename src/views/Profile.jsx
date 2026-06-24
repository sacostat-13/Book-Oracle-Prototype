import { useRef, useMemo, useState, useEffect } from 'react';
import { useData } from '../lib/DataContext';
import { useAuth } from '../lib/AuthContext';
import { useRouter } from '../lib/RouterContext';
import { useT } from '../lib/I18nContext';
import { useOracleQuota } from '../lib/OracleQuotaContext';
import { parseGoodreadsCSV } from '../lib/goodreadsImport';
import { findBookByTitle, bookKey, openBookTab } from '../lib/bookHelpers';

const LEVEL_NAMES = {
  1: 'Casual companion', 2: 'Steady reader', 3: 'Devoted reader',
  4: 'Literary appetite', 5: 'Voracious + experimental',
};
const GOAL_NAMES = {
  'level-up': 'Level up my reading',
  explore: 'Get into a new topic or genre',
  random: 'Just give me something to read',
};

// ── Small stat card ──────────────────────────────────────────────────────────
function StatCard({ value, label, sub }) {
  return (
    <div style={{
      background: 'rgba(176, 140, 63, 0.04)',
      border: '1px solid rgba(176, 140, 63, 0.18)',
      borderRadius: '2px',
      padding: '1.1rem 1.25rem',
      minWidth: 0,
    }}>
      <div style={{
        fontFamily: "'Cormorant Garamond', serif",
        fontStyle: 'italic',
        fontSize: '2.2rem',
        color: 'var(--gilt-bright)',
        lineHeight: 1,
        marginBottom: '0.25rem',
      }}>
        {value}
      </div>
      <div style={{
        fontFamily: "'Special Elite', monospace",
        fontSize: '0.62rem',
        letterSpacing: '0.2em',
        textTransform: 'uppercase',
        color: 'var(--paper-aged)',
        opacity: 0.8,
      }}>
        {label}
      </div>
      {sub && (
        <div style={{ fontSize: '0.8rem', color: 'var(--paper-aged)', opacity: 0.55, marginTop: '0.3rem' }}>
          {sub}
        </div>
      )}
    </div>
  );
}

// ── Horizontal bar for genre breakdown ───────────────────────────────────────
function GenreBar({ name, count, max }) {
  const pct = max > 0 ? Math.round((count / max) * 100) : 0;
  return (
    <div style={{ marginBottom: '0.6rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
        <span style={{ color: 'var(--paper-aged)', fontSize: '0.88rem' }}>{name}</span>
        <span style={{ color: 'var(--paper-aged)', fontSize: '0.88rem', opacity: 0.6 }}>{count}</span>
      </div>
      <div style={{ height: '3px', background: 'rgba(176, 140, 63, 0.12)', borderRadius: '2px' }}>
        <div style={{
          height: '100%',
          width: `${pct}%`,
          background: 'var(--gilt)',
          borderRadius: '2px',
          transition: 'width 0.4s',
        }} />
      </div>
    </div>
  );
}

// ── Reading pace by month ─────────────────────────────────────────────────────
function PaceChart({ books, onOpenBook }) {
  const [hovered, setHovered] = useState(null);   // month key being hovered
  const [selected, setSelected] = useState(null); // month key clicked for drill-down

  // Last 12 months
  const now = new Date();
  const months = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      label: d.toLocaleDateString(undefined, { month: 'short' }),
      fullLabel: d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
      count: 0,
      booksInMonth: [],
    });
  }
  for (const b of books) {
    if (!b.dateRead) continue;
    const d = new Date(b.dateRead);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const m = months.find((m) => m.key === key);
    if (m) { m.count++; m.booksInMonth.push(b); }
  }
  const maxCount = Math.max(...months.map((m) => m.count), 1);

  const selectedMonth = selected ? months.find((m) => m.key === selected) : null;

  return (
    <div>
      {/* Bar chart */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: '4px', height: '72px' }}>
        {months.map((m) => {
          const isHovered = hovered === m.key;
          const isSelected = selected === m.key;
          return (
            <div
              key={m.key}
              style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px', position: 'relative' }}
              onMouseEnter={() => setHovered(m.key)}
              onMouseLeave={() => setHovered(null)}
            >
              {/* Tooltip */}
              {isHovered && (
                <div style={{
                  position: 'absolute',
                  bottom: '100%',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  background: 'var(--surface-raised)',
                  border: '1px solid var(--border-mid)',
                  borderRadius: '2px',
                  padding: '4px 8px',
                  whiteSpace: 'nowrap',
                  fontSize: '0.65rem',
                  fontFamily: "'Special Elite', monospace",
                  letterSpacing: '0.05em',
                  color: 'var(--paper)',
                  zIndex: 10,
                  pointerEvents: 'none',
                  marginBottom: '4px',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
                }}>
                  {m.count} book{m.count !== 1 ? 's' : ''}<br />
                  <span style={{ opacity: 0.6 }}>{m.fullLabel}</span>
                  {m.count > 0 && <div style={{ opacity: 0.5, marginTop: 2 }}>click to see list</div>}
                </div>
              )}
              {/* Bar */}
              <div
                onClick={() => m.count > 0 && setSelected(selected === m.key ? null : m.key)}
                style={{
                  width: '100%',
                  height: `${Math.max(m.count / maxCount * 52, m.count > 0 ? 4 : 1)}px`,
                  background: isSelected
                    ? 'var(--gilt-bright)'
                    : m.count > 0
                    ? (isHovered ? 'var(--gilt-bright)' : 'var(--gilt)')
                    : 'rgba(176,140,63,0.15)',
                  borderRadius: '1px',
                  transition: 'height 0.3s, background 0.15s',
                  cursor: m.count > 0 ? 'pointer' : 'default',
                  outline: isSelected ? '1px solid var(--gilt)' : 'none',
                }}
              />
              {/* Month label */}
              <div style={{ fontSize: '0.55rem', color: 'var(--paper-aged)', opacity: isSelected ? 1 : 0.5, letterSpacing: '0.05em' }}>
                {m.label[0]}
              </div>
            </div>
          );
        })}
      </div>

      {/* Drill-down list for selected month */}
      {selectedMonth && selectedMonth.booksInMonth.length > 0 && (
        <div style={{
          marginTop: '1rem',
          padding: '0.85rem 1rem',
          background: 'var(--surface-tint)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '2px',
        }}>
          <div style={{
            fontFamily: "'Special Elite', monospace",
            fontSize: '0.65rem',
            letterSpacing: '0.15em',
            textTransform: 'uppercase',
            color: 'var(--gilt)',
            opacity: 0.8,
            marginBottom: '0.6rem',
          }}>
            {selectedMonth.fullLabel} · {selectedMonth.count} book{selectedMonth.count !== 1 ? 's' : ''}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {selectedMonth.booksInMonth.map((b, i) => (
              <div
                key={b.bookId || b.t + i}
                onClick={() => onOpenBook?.(b)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.6rem',
                  cursor: onOpenBook ? 'pointer' : 'default',
                  padding: '0.2rem 0',
                }}
              >
                {b.coverUrl ? (
                  <img src={b.coverUrl} alt={b.t} style={{ width: 28, height: 42, objectFit: 'cover', borderRadius: 1, flexShrink: 0 }} />
                ) : (
                  <div style={{ width: 28, height: 42, background: 'var(--surface-raised)', borderRadius: 1, flexShrink: 0 }} />
                )}
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontFamily: "'Cormorant Garamond', serif", fontStyle: 'italic', fontSize: '0.9rem', color: 'var(--paper)', lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.t}</div>
                  <div style={{ fontFamily: "'Special Elite', monospace", fontSize: '0.6rem', letterSpacing: '0.08em', color: 'var(--paper-aged)', opacity: 0.7, marginTop: '0.15rem' }}>{b.a}</div>
                  {b.rating > 0 && (
                    <div style={{ color: 'var(--gilt)', fontSize: '0.7rem', marginTop: '0.1rem' }}>
                      {'★'.repeat(b.rating)}<span style={{ color: 'rgba(176,140,63,0.3)' }}>{'★'.repeat(5 - b.rating)}</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Profile() {
  const { state, resetAll, importGoodreads, showToast } = useData();
  const { user } = useAuth();
  const { go, route } = useRouter();
  const t = useT();
  const fileRef = useRef(null);
  const { quota, refresh: refreshQuota } = useOracleQuota();
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);

  // Refresh quota when returning from Stripe Checkout so the tier badge
  // updates immediately. Must be in useEffect — never call setState during render.
  const checkoutResult = route.params?.checkout;
  useEffect(() => {
    if (checkoutResult === 'success') {
      showToast(t('subscription.checkoutSuccess'));
      // Poll a couple of times — webhook may take a moment to update the profile
      refreshQuota();
      const t1 = setTimeout(() => refreshQuota(), 2000);
      const t2 = setTimeout(() => refreshQuota(), 5000);
      return () => { clearTimeout(t1); clearTimeout(t2); };
    }
    if (checkoutResult === 'cancelled') {
      showToast(t('subscription.checkoutCancelled'));
    }
  }, [checkoutResult]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleUpgrade() {
    if (!user) return;
    setCheckoutLoading(true);
    try {
      const { data } = await import('../lib/supabase').then(m => m.supabase.auth.getSession());
      const token = data?.session?.access_token;
      const res = await fetch('/.netlify/functions/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      });
      const json = await res.json();
      if (json.url) window.location.href = json.url;
      else showToast(json.error || 'Checkout failed', true);
    } catch (e) {
      showToast('Could not open checkout. Try again.', true);
    } finally {
      setCheckoutLoading(false);
    }
  }

  async function handleManage() {
    if (!user) return;
    setPortalLoading(true);
    try {
      const { data } = await import('../lib/supabase').then(m => m.supabase.auth.getSession());
      const token = data?.session?.access_token;
      const res = await fetch('/.netlify/functions/manage-subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      });
      const json = await res.json();
      if (json.url) window.location.href = json.url;
      else showToast(json.error || 'Could not open billing portal', true);
    } catch (e) {
      showToast('Could not open billing portal. Try again.', true);
    } finally {
      setPortalLoading(false);
    }
  }

  // ── Stats derivation ────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const lib = state.library;
    const genres = state.genresByBookId || {};
    const now = new Date();
    const thisYear = now.getFullYear();

    // Total books & pages
    const totalBooks = lib.length;
    const totalPages = lib.reduce((s, b) => s + (b.pp || 0), 0);

    // This year
    const booksThisYear = lib.filter((b) => {
      if (!b.dateRead) return false;
      return new Date(b.dateRead).getFullYear() === thisYear;
    });
    const pagesThisYear = booksThisYear.reduce((s, b) => s + (b.pp || 0), 0);

    // Books with dates (for pace)
    const datedBooks = lib.filter((b) => b.dateRead);

    // Reading pace — books per month over last 12 months
    const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1);
    const recentDated = datedBooks.filter((b) => new Date(b.dateRead) >= twelveMonthsAgo);
    const pace = recentDated.length > 0
      ? (recentDated.length / 12).toFixed(1)
      : null;

    // Genre breakdown
    const genreCount = {};
    for (const b of lib) {
      const gs = genres[b.bookId] || [];
      for (const g of gs) {
        genreCount[g.name] = (genreCount[g.name] || 0) + 1;
      }
    }
    const topGenres = Object.entries(genreCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, count]) => ({ name, count }));

    // Series completion
    const seriesMap = {};
    const allBooks = [...lib, ...state.wishlist, ...state.readNext];
    for (const b of allBooks) {
      if (!b.s?.name) continue;
      const n = b.s.name;
      if (!seriesMap[n]) seriesMap[n] = { name: n, total: b.s.total || null, read: 0, known: 0 };
      seriesMap[n].known++;
      if (lib.some((l) => bookKey(l) === bookKey(b))) seriesMap[n].read++;
    }
    const seriesInProgress = Object.values(seriesMap)
      .filter((s) => s.read > 0 && s.total && s.read < s.total)
      .sort((a, b) => b.read - a.read)
      .slice(0, 5);
    const seriesCompleted = Object.values(seriesMap)
      .filter((s) => s.total && s.read >= s.total)
      .length;

    // Average rating
    const rated = lib.filter((b) => b.rating > 0);
    const avgRating = rated.length > 0
      ? (rated.reduce((s, b) => s + b.rating, 0) / rated.length).toFixed(1)
      : null;

    // Favourite author (most books read)
    const authorCount = {};
    for (const b of lib) {
      if (b.a) authorCount[b.a] = (authorCount[b.a] || 0) + 1;
    }
    const topAuthor = Object.entries(authorCount).sort((a, b) => b[1] - a[1])[0];

    return {
      totalBooks, totalPages, booksThisYear: booksThisYear.length,
      pagesThisYear, pace, topGenres, seriesInProgress, seriesCompleted,
      avgRating, topAuthor, datedBooks,
    };
  }, [state.library, state.wishlist, state.readNext, state.genresByBookId]);

  async function handleReimport(file) {
    try {
      const text = await file.text();
      const books = parseGoodreadsCSV(text);
      if (books.length === 0) {
        showToast(t('profile.csvErrorNoBooks'), true);
        return;
      }
      const enriched = books.map((gb) => {
        const match = findBookByTitle(gb.t);
        return match ? { ...match, ...gb } : { ...gb, g: 'Imported' };
      });
      await importGoodreads(enriched);
    } catch {
      showToast(t('profile.csvReadError'), true);
    }
  }

  const hasStats = stats.totalBooks > 0;
  const sectionTitle = (t) => (
    <div style={{
      fontFamily: "'Special Elite', monospace",
      fontSize: '0.65rem',
      letterSpacing: '0.25em',
      textTransform: 'uppercase',
      color: 'var(--gilt)',
      opacity: 0.7,
      marginBottom: '1rem',
      marginTop: '2rem',
    }}>
      {t}
    </div>
  );

  return (
    <>
      <div className="breadcrumb">
        <a onClick={() => go('dashboard')}>Dashboard</a> · {t('profile.breadcrumb')}
      </div>
      <div className="page-header">
        <div className="page-eyebrow">{t('profile.eyebrowTitle')}</div>
        <h1 className="page-title">
          {t('profile.titlePrefix', { val: '' }).replace(/(Your |Tu perfil de )/, '') || 'Your '}
          <span className="accent">{t('profile.titleAccent')}</span>{' profile'}
        </h1>
        {hasStats && (
          <p className="page-subtitle">
            {t('profile.subtitleStats', {
              books: stats.totalBooks,
              pages: stats.totalPages > 0 ? t('profile.subtitlePages', { pages: stats.totalPages.toLocaleString() }) : '',
            })}
          </p>
        )}
      </div>

      {/* ── Reading Stats ─────────────────────────────────────────────────── */}
      {hasStats && (
        <div style={{ maxWidth: '720px', marginBottom: '2rem' }}>

          {sectionTitle(t('profile.sectionStats'))}

          {/* Top-line numbers */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem', marginBottom: '1.5rem' }}>
            <StatCard
              value={stats.totalBooks}
              label={t('profile.statBooksRead')}
              sub={stats.booksThisYear > 0 ? t('profile.statThisYear', { count: stats.booksThisYear }) : null}
            />
            {stats.totalPages > 0 && (
              <StatCard
                value={stats.totalPages.toLocaleString()}
                label={t('profile.statPages')}
                sub={stats.pagesThisYear > 0 ? t('profile.statThisYear', { count: stats.pagesThisYear.toLocaleString() }) : null}
              />
            )}
            {stats.pace && (
              <StatCard
                value={stats.pace}
                label={t('profile.statBooksMonth')}
                sub={t('profile.statLast12')}
              />
            )}
            {stats.avgRating && (
              <StatCard
                value={`${stats.avgRating}★`}
                label={t('profile.statAvgRating')}
              />
            )}
            {stats.seriesCompleted > 0 && (
              <StatCard
                value={stats.seriesCompleted}
                label={t('profile.statSeriesFinished')}
              />
            )}
          </div>

          {/* Pace chart */}
          {stats.datedBooks.length > 0 && (
            <>
              {sectionTitle(t('profile.sectionPace'))}
              <div style={{ padding: '1rem 1.25rem', background: 'rgba(176, 140, 63, 0.04)', border: '1px solid rgba(176, 140, 63, 0.18)', borderRadius: '2px', marginBottom: '1.5rem' }}>
                <PaceChart books={stats.datedBooks} onOpenBook={(b) => openBookTab(b, 'profile')} />
              </div>
            </>
          )}

          {/* Top genres */}
          {stats.topGenres.length > 0 && (
            <>
              {sectionTitle(t('profile.sectionTopGenres'))}
              <div style={{ marginBottom: '1.5rem' }}>
                {stats.topGenres.map((g) => (
                  <GenreBar key={g.name} name={g.name} count={g.count} max={stats.topGenres[0].count} />
                ))}
              </div>
            </>
          )}

          {/* Favourite author */}
          {stats.topAuthor && stats.topAuthor[1] > 1 && (
            <>
              {sectionTitle(t('profile.sectionTopAuthor'))}
              <p style={{ color: 'var(--paper)', fontFamily: "'Cormorant Garamond', serif", fontStyle: 'italic', fontSize: '1.15rem', marginBottom: '1.5rem' }}>
                {stats.topAuthor[0]}
                <span style={{ color: 'var(--paper-aged)', fontSize: '0.9rem', fontStyle: 'normal', marginLeft: '0.6rem', opacity: 0.7 }}>
                  · {t('profile.topAuthorBooks', { count: stats.topAuthor[1] })}
                </span>
              </p>
            </>
          )}

          {/* Series in progress */}
          {stats.seriesInProgress.length > 0 && (
            <>
              {sectionTitle(t('profile.sectionSeries'))}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1.5rem' }}>
                {stats.seriesInProgress.map((s) => (
                  <div
                    key={s.name}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.6rem 1rem', background: 'rgba(176, 140, 63, 0.04)', border: '1px solid rgba(176, 140, 63, 0.15)', borderRadius: '2px', cursor: 'pointer' }}
                    onClick={() => go('series-page', { seriesName: s.name, from: 'profile', fromLabel: t('profile.fromProfile') })}
                    title={t('profile.openSeries')}
                  >
                    <div>
                      <div style={{ color: 'var(--paper)', fontFamily: "'Cormorant Garamond', serif", fontStyle: 'italic' }}>{s.name}</div>
                      <div style={{ color: 'var(--paper-aged)', fontSize: '0.8rem', opacity: 0.7 }}>
                        {t('profile.seriesRead', { read: s.read, total: s.total })}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                      <span style={{ fontFamily: "'Special Elite', monospace", fontSize: '0.6rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--gilt)', opacity: 0.8 }}>
                        {t('profile.openLink')}
                      </span>
                      <div style={{ display: 'flex', gap: '4px' }}>
                      {Array.from({ length: s.total }).map((_, i) => (
                        <div key={i} style={{ width: '8px', height: '8px', borderRadius: '50%', background: i < s.read ? 'var(--gilt)' : 'rgba(176, 140, 63, 0.2)' }} />
                      ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* No date data nudge */}
          {stats.datedBooks.length === 0 && stats.totalBooks > 0 && (
            <p style={{ color: 'var(--paper-aged)', fontSize: '0.88rem', opacity: 0.6, fontStyle: 'italic', marginBottom: '1.5rem' }}>
              {t('profile.paceNudge')}
            </p>
          )}

          <div style={{ borderTop: '1px solid rgba(176, 140, 63, 0.15)', marginTop: '0.5rem' }} />
        </div>
      )}

      {/* ── Profile settings ──────────────────────────────────────────────── */}
      <div className="onboarding-card" style={{ maxWidth: '720px' }}>
        {user && (
          <>
            <h2 style={{ fontFamily: "'Cormorant Garamond', serif", fontStyle: 'italic', marginBottom: '1rem', color: 'var(--paper)' }}>
              {t('profile.sectionAccount')}
            </h2>
            <p style={{ color: 'var(--paper-aged)', marginBottom: '1rem' }}>
              {state.profile.displayName || user.email}
              <br />
              <span style={{ color: 'var(--gilt)', fontSize: '0.9rem' }}>
                {t('profile.accountSynced')}
              </span>
            </p>
          </>
        )}

        <h2 style={{ fontFamily: "'Cormorant Garamond', serif", fontStyle: 'italic', margin: user ? '1.5rem 0 1rem' : '0 0 1rem', color: 'var(--paper)' }}>
          {t('profile.labelReadingLevel')}
        </h2>
        <p style={{ color: 'var(--paper-aged)', marginBottom: '1rem' }}>
          {LEVEL_NAMES[state.profile.readingLevel] || t('profile.notSet')}
        </p>

        <h2 style={{ fontFamily: "'Cormorant Garamond', serif", fontStyle: 'italic', margin: '1.5rem 0 1rem', color: 'var(--paper)' }}>
          {t('profile.labelGoal')}
        </h2>
        <p style={{ color: 'var(--paper-aged)', marginBottom: '1rem' }}>
          {GOAL_NAMES[state.profile.goal] || (t('profile.notSet'))}
        </p>

        <h2 style={{ fontFamily: "'Cormorant Garamond', serif", fontStyle: 'italic', margin: '1.5rem 0 1rem', color: 'var(--paper)' }}>
          {t('profile.labelLibrary')}
        </h2>
        <p style={{ color: 'var(--paper-aged)', marginBottom: '1.5rem' }}>
          {t('profile.librarySummary', { books: state.library.length, queued: state.readNext.length })}
          {state.profile.goodreadsImported && (
            <><br /><span style={{ color: 'var(--gilt)' }}>{t('profile.goodreadsImported')}</span></>
          )}
        </p>

        <div style={{ marginTop: '1rem' }}>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="file-hidden"
            onChange={(e) => {
              const f = e.target.files[0];
              if (f) handleReimport(f);
            }}
          />
          <button className="btn btn-ghost" onClick={() => fileRef.current?.click()}>
            {state.profile.goodreadsImported
              ? t('profile.reimportGoodreads') : t('profile.importGoodreads')}
          </button>
        </div>

        {/* ── Subscription section ──────────────────────────────────────────── */}
        {user && (
          <div style={{ borderTop: '1px solid rgba(176, 140, 63, 0.2)', paddingTop: '1.5rem', marginTop: '1.5rem' }}>
            <h2 style={{ fontFamily: "'Cormorant Garamond', serif", fontStyle: 'italic', marginBottom: '1rem', color: 'var(--paper)' }}>
              {t('subscription.sectionTitle')}
            </h2>

            {/* Tier badge */}
            {(() => {
              const status = quota?.subscription_status || 'free';
              const isPro     = status === 'active';
              const isPastDue = status === 'past_due';
              return (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
                  <span style={{
                    fontFamily:    "'Special Elite', monospace",
                    fontSize:      '0.7rem',
                    letterSpacing: '0.15em',
                    textTransform: 'uppercase',
                    padding:       '0.25rem 0.75rem',
                    borderRadius:  '2px',
                    border:        `1px solid ${isPro ? 'rgba(201,162,75,0.6)' : isPastDue ? 'rgba(180,60,60,0.5)' : 'rgba(201,162,75,0.25)'}`,
                    background:    isPro ? 'rgba(201,162,75,0.12)' : isPastDue ? 'rgba(180,60,60,0.08)' : 'transparent',
                    color:         isPro ? 'var(--gilt-bright, #e8c560)' : isPastDue ? 'rgba(220,80,80,0.9)' : 'var(--paper-aged)',
                  }}>
                    {isPro ? `✦ ${t('subscription.tierPro')}` : isPastDue ? `⚠ ${t('subscription.tierPastDue')}` : t('subscription.tierFree')}
                  </span>
                  <span style={{ color: 'var(--paper-aged)', fontSize: '0.88rem', opacity: 0.7 }}>
                    {isPro
                      ? t('subscription.proDesc')
                      : isPastDue
                      ? t('subscription.pastDueDesc')
                      : t('subscription.freeDesc', {
                          remaining: quota?.calls_remaining ?? 5,
                          limit:     quota?.calls_limit ?? 5,
                        })}
                  </span>
                </div>
              );
            })()}

            {/* Quota bar for free users */}
            {quota && !quota.unlimited && (
              <div style={{ marginBottom: '1.25rem' }}>
                <div style={{ height: '3px', background: 'rgba(201,162,75,0.12)', borderRadius: '2px', overflow: 'hidden', marginBottom: '0.4rem' }}>
                  <div style={{
                    height: '100%',
                    width: `${Math.round(((quota.calls_used ?? 0) / (quota.calls_limit ?? 5)) * 100)}%`,
                    background: quota.calls_remaining === 0 ? 'rgba(180,60,60,0.7)' : 'var(--gilt)',
                    borderRadius: '2px',
                    transition: 'width 0.3s ease',
                  }} />
                </div>
                {quota.reset_at && (
                  <div style={{ fontSize: '0.78rem', color: 'var(--paper-aged)', opacity: 0.55 }}>
                    {t('subscription.resetsOn', { date: new Date(quota.reset_at).toLocaleDateString(undefined, { month: 'long', day: 'numeric' }) })}
                  </div>
                )}
              </div>
            )}

            {/* CTA */}
            {quota?.subscription_status === 'active' ? (
              <button className="btn btn-ghost" onClick={handleManage} disabled={portalLoading}>
                {portalLoading ? t('subscription.redirecting') : t('subscription.manageBtn')}
              </button>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxWidth: '380px' }}>
                <button className="btn" onClick={handleUpgrade} disabled={checkoutLoading}>
                  {checkoutLoading ? t('subscription.redirecting') : t('subscription.upgradeBtn')}
                </button>
                <div style={{ fontSize: '0.8rem', color: 'var(--paper-aged)', opacity: 0.55 }}>
                  {t('subscription.upgradePrice')} ·{' '}
                  {[
                    t('subscription.upgradeFeature1'),
                    t('subscription.upgradeFeature2'),
                    t('subscription.upgradeFeature3'),
                  ].join(' · ')}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Danger zone ───────────────────────────────────────────────────── */}
        <div style={{ borderTop: '1px solid rgba(176, 140, 63, 0.2)', paddingTop: '1.5rem', marginTop: '2rem' }}>
          <button
            className="btn btn-ghost"
            onClick={() => {
              if (confirm(t('library.confirmReset'))) {
                resetAll();
                go('dashboard');
              }
            }}
          >
            {t('profile.resetProfile')}
          </button>
        </div>
      </div>
    </>
  );
}
