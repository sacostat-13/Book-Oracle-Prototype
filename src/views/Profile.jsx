import { useRef, useMemo } from 'react';
import { useData } from '../lib/DataContext';
import { useAuth } from '../lib/AuthContext';
import { useRouter } from '../lib/RouterContext';
import { useI18n } from '../lib/I18nContext';
import { parseGoodreadsCSV } from '../lib/goodreadsImport';
import { findBookByTitle, bookKey } from '../lib/bookHelpers';

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
function PaceChart({ books }) {
  // Last 12 months
  const now = new Date();
  const months = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      label: d.toLocaleDateString(undefined, { month: 'short' }),
      count: 0,
    });
  }
  for (const b of books) {
    if (!b.dateRead) continue;
    const d = new Date(b.dateRead);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const m = months.find((m) => m.key === key);
    if (m) m.count++;
  }
  const maxCount = Math.max(...months.map((m) => m.count), 1);

  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: '4px', height: '64px' }}>
      {months.map((m) => (
        <div key={m.key} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px' }}>
          <div
            title={`${m.count} book${m.count !== 1 ? 's' : ''} in ${m.label}`}
            style={{
              width: '100%',
              height: `${Math.max(m.count / maxCount * 48, m.count > 0 ? 4 : 1)}px`,
              background: m.count > 0 ? 'var(--gilt)' : 'rgba(176, 140, 63, 0.15)',
              borderRadius: '1px',
              transition: 'height 0.3s',
            }}
          />
          <div style={{ fontSize: '0.55rem', color: 'var(--paper-aged)', opacity: 0.5, letterSpacing: '0.05em' }}>
            {m.label[0]}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function Profile() {
  const { state, resetAll, importGoodreads, showToast } = useData();
  const { user } = useAuth();
  const { go } = useRouter();
  const { lang } = useI18n();
  const isSpanish = lang === 'es';
  const fileRef = useRef(null);

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
        showToast(isSpanish ? 'No se encontraron libros en ese archivo.' : "Couldn't find any read books in that file.", true);
        return;
      }
      const enriched = books.map((gb) => {
        const match = findBookByTitle(gb.t);
        return match ? { ...match, ...gb } : { ...gb, g: 'Imported' };
      });
      await importGoodreads(enriched);
    } catch {
      showToast(isSpanish ? 'No se pudo leer ese archivo.' : "Couldn't read that file.", true);
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
        <a onClick={() => go('dashboard')}>Dashboard</a> · {isSpanish ? 'Perfil' : 'Profile'}
      </div>
      <div className="page-header">
        <div className="page-eyebrow">{isSpanish ? 'Perfil' : 'Profile'}</div>
        <h1 className="page-title">
          {isSpanish ? 'Tu perfil de ' : 'Your '}
          <span className="accent">{isSpanish ? 'lectora' : 'reader'}</span>
          {isSpanish ? '' : ' profile'}
        </h1>
        {hasStats && (
          <p className="page-subtitle">
            {isSpanish
              ? `${stats.totalBooks} libros leídos${stats.totalPages > 0 ? ` · ${stats.totalPages.toLocaleString()} páginas` : ''}`
              : `${stats.totalBooks} books read${stats.totalPages > 0 ? ` · ${stats.totalPages.toLocaleString()} pages` : ''}`
            }
          </p>
        )}
      </div>

      {/* ── Reading Stats ─────────────────────────────────────────────────── */}
      {hasStats && (
        <div style={{ maxWidth: '720px', marginBottom: '2rem' }}>

          {sectionTitle(isSpanish ? 'Estadísticas' : 'Reading stats')}

          {/* Top-line numbers */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem', marginBottom: '1.5rem' }}>
            <StatCard
              value={stats.totalBooks}
              label={isSpanish ? 'libros leídos' : 'books read'}
              sub={stats.booksThisYear > 0 ? `${stats.booksThisYear} ${isSpanish ? 'este año' : 'this year'}` : null}
            />
            {stats.totalPages > 0 && (
              <StatCard
                value={stats.totalPages.toLocaleString()}
                label={isSpanish ? 'páginas' : 'pages'}
                sub={stats.pagesThisYear > 0 ? `${stats.pagesThisYear.toLocaleString()} ${isSpanish ? 'este año' : 'this year'}` : null}
              />
            )}
            {stats.pace && (
              <StatCard
                value={stats.pace}
                label={isSpanish ? 'libros/mes' : 'books/month'}
                sub={isSpanish ? 'últimos 12 meses' : 'last 12 months'}
              />
            )}
            {stats.avgRating && (
              <StatCard
                value={`${stats.avgRating}★`}
                label={isSpanish ? 'calificación media' : 'avg rating'}
              />
            )}
            {stats.seriesCompleted > 0 && (
              <StatCard
                value={stats.seriesCompleted}
                label={isSpanish ? 'sagas completas' : 'series finished'}
              />
            )}
          </div>

          {/* Pace chart */}
          {stats.datedBooks.length > 0 && (
            <>
              {sectionTitle(isSpanish ? 'Ritmo de lectura — últimos 12 meses' : 'Reading pace — last 12 months')}
              <div style={{ padding: '1rem 1.25rem', background: 'rgba(176, 140, 63, 0.04)', border: '1px solid rgba(176, 140, 63, 0.18)', borderRadius: '2px', marginBottom: '1.5rem' }}>
                <PaceChart books={stats.datedBooks} />
              </div>
            </>
          )}

          {/* Top genres */}
          {stats.topGenres.length > 0 && (
            <>
              {sectionTitle(isSpanish ? 'Géneros más leídos' : 'Top genres')}
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
              {sectionTitle(isSpanish ? 'Autor/a favorita' : 'Most read author')}
              <p style={{ color: 'var(--paper)', fontFamily: "'Cormorant Garamond', serif", fontStyle: 'italic', fontSize: '1.15rem', marginBottom: '1.5rem' }}>
                {stats.topAuthor[0]}
                <span style={{ color: 'var(--paper-aged)', fontSize: '0.9rem', fontStyle: 'normal', marginLeft: '0.6rem', opacity: 0.7 }}>
                  · {stats.topAuthor[1]} {isSpanish ? 'libros' : 'books'}
                </span>
              </p>
            </>
          )}

          {/* Series in progress */}
          {stats.seriesInProgress.length > 0 && (
            <>
              {sectionTitle(isSpanish ? 'Sagas en progreso' : 'Series in progress')}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1.5rem' }}>
                {stats.seriesInProgress.map((s) => (
                  <div
                    key={s.name}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.6rem 1rem', background: 'rgba(176, 140, 63, 0.04)', border: '1px solid rgba(176, 140, 63, 0.15)', borderRadius: '2px', cursor: 'pointer' }}
                    onClick={() => go('series-page', { seriesName: s.name, from: 'profile', fromLabel: isSpanish ? 'Perfil' : 'Profile' })}
                    title={isSpanish ? 'Abrir saga' : 'Open Series'}
                  >
                    <div>
                      <div style={{ color: 'var(--paper)', fontFamily: "'Cormorant Garamond', serif", fontStyle: 'italic' }}>{s.name}</div>
                      <div style={{ color: 'var(--paper-aged)', fontSize: '0.8rem', opacity: 0.7 }}>
                        {s.read} of {s.total} {isSpanish ? 'leídos' : 'read'}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                      <span style={{ fontFamily: "'Special Elite', monospace", fontSize: '0.6rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--gilt)', opacity: 0.8 }}>
                        {isSpanish ? 'Abrir ↗' : 'Open ↗'}
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
              {isSpanish
                ? 'Abrí cualquier libro en tu biblioteca, tocá "Editar calificación" y agregá la fecha en que lo terminaste para ver el ritmo de lectura.'
                : 'Open any book in your library, tap "Edit rating" and add the date you finished it to see your reading pace.'}
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
              {isSpanish ? 'Cuenta' : 'Account'}
            </h2>
            <p style={{ color: 'var(--paper-aged)', marginBottom: '1rem' }}>
              {state.profile.displayName || user.email}
              <br />
              <span style={{ color: 'var(--gilt)', fontSize: '0.9rem' }}>
                {isSpanish ? 'Sincronizado · accesible desde cualquier dispositivo' : 'Synced to your account · accessible from any device'}
              </span>
            </p>
          </>
        )}

        <h2 style={{ fontFamily: "'Cormorant Garamond', serif", fontStyle: 'italic', margin: user ? '1.5rem 0 1rem' : '0 0 1rem', color: 'var(--paper)' }}>
          {isSpanish ? 'Nivel de lectura' : 'Reading level'}
        </h2>
        <p style={{ color: 'var(--paper-aged)', marginBottom: '1rem' }}>
          {LEVEL_NAMES[state.profile.readingLevel] || (isSpanish ? 'No configurado' : 'Not set')}
        </p>

        <h2 style={{ fontFamily: "'Cormorant Garamond', serif", fontStyle: 'italic', margin: '1.5rem 0 1rem', color: 'var(--paper)' }}>
          {isSpanish ? 'Objetivo' : 'Goal'}
        </h2>
        <p style={{ color: 'var(--paper-aged)', marginBottom: '1rem' }}>
          {GOAL_NAMES[state.profile.goal] || (isSpanish ? 'No configurado' : 'Not set')}
        </p>

        <h2 style={{ fontFamily: "'Cormorant Garamond', serif", fontStyle: 'italic', margin: '1.5rem 0 1rem', color: 'var(--paper)' }}>
          {isSpanish ? 'Biblioteca' : 'Library'}
        </h2>
        <p style={{ color: 'var(--paper-aged)', marginBottom: '1.5rem' }}>
          {state.library.length} {isSpanish ? 'libros leídos' : 'books read'} · {state.readNext.length} {isSpanish ? 'en cola' : 'queued'}
          {state.profile.goodreadsImported && (
            <><br /><span style={{ color: 'var(--gilt)' }}>✓ Goodreads {isSpanish ? 'importado' : 'imported'}</span></>
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
              ? (isSpanish ? 'Re-importar CSV de Goodreads' : 'Re-import Goodreads CSV')
              : (isSpanish ? 'Importar CSV de Goodreads' : 'Import Goodreads CSV')}
          </button>
        </div>

        <div style={{ borderTop: '1px solid rgba(176, 140, 63, 0.2)', paddingTop: '1.5rem', marginTop: '2rem' }}>
          <button
            className="btn btn-ghost"
            onClick={() => {
              if (confirm(isSpanish
                ? '¿Borrar perfil, biblioteca, cola y plan de lectura?'
                : 'This will erase your profile, library, queue, and reading plan. Continue?')) {
                resetAll();
                go('dashboard');
              }
            }}
          >
            {isSpanish ? 'Reiniciar perfil' : 'Reset profile & start over'}
          </button>
        </div>
      </div>
    </>
  );
}
