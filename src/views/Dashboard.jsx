import { useData } from '../lib/DataContext';
import { useRouter } from '../lib/RouterContext';
import { SPINE_COLORS, hashStr, bookKey } from '../lib/bookHelpers';

const LEVEL_NAMES = { 1: 'Casual', 2: 'Steady', 3: 'Devoted', 4: 'Literary', 5: 'Voracious' };
const GOAL_NAMES = { 'level-up': 'Level up', explore: 'Exploring', random: 'Random monthly' };
const SORT_MODES = {
  recent: { label: 'Most recent', icon: '⟲' },
  genre: { label: 'By genre', icon: '◐' },
  complexity: { label: 'By complexity', icon: '▲' },
  shuffle: { label: 'Shuffle', icon: '✦' },
};

function Shelves({ onSpineClick }) {
  const { state, setShelfSortMode } = useData();
  const mode = state.shelfSortMode || 'recent';
  const modeInfo = SORT_MODES[mode];

  function cycle() {
    const modes = ['recent', 'genre', 'complexity', 'shuffle'];
    const idx = modes.indexOf(mode);
    setShelfSortMode(mode === 'shuffle' ? 'shuffle' : modes[(idx + 1) % modes.length]);
  }

  const controls = (
    <div className="shelf-controls">
      <span className="shelf-mode-label">
        Arranged: <strong>{modeInfo.label}</strong>
      </span>
      <button className="shelf-refresh" onClick={cycle} title="Re-arrange shelves">
        {modeInfo.icon} <span>Re-arrange</span>
      </button>
    </div>
  );

  if (state.library.length === 0) {
    return (
      <>
        {controls}
        <div className="library-shelves">
          {[0, 1].map((i) => (
            <div className="shelf" key={i}>
              <div className="shelf-empty">
                {i === 0 ? <>Your shelves are empty.<br />Read a book or pick from your queue to fill them.</> : '\u00A0'}
              </div>
              <div className="shelf-board"></div>
            </div>
          ))}
        </div>
      </>
    );
  }

  let books = [...state.library];
  if (mode === 'recent') books.reverse();
  else if (mode === 'genre') books.sort((a, b) => (a.g || 'zzz').localeCompare(b.g || 'zzz'));
  else if (mode === 'complexity') books.sort((a, b) => (a.c || 3) - (b.c || 3));
  else if (mode === 'shuffle') {
    for (let i = books.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [books[i], books[j]] = [books[j], books[i]];
    }
  }

  const perShelf = Math.max(10, Math.ceil(books.length / 3));
  const shelves = [];
  for (let i = 0; i < books.length; i += perShelf) {
    shelves.push(books.slice(i, i + perShelf));
  }
  while (shelves.length < 2) shelves.push([]);

  return (
    <>
      {controls}
      <div className="library-shelves">
        {shelves.map((shelf, sIdx) => (
          <div className="shelf" key={sIdx}>
            {shelf.length === 0 ? (
              <div className="shelf-empty">&nbsp;</div>
            ) : (
              shelf.map((b, bIdx) => {
                let color;
                if (mode === 'genre' && b.g) color = SPINE_COLORS[hashStr(b.g) % SPINE_COLORS.length];
                else if (mode === 'complexity' && b.c) {
                  const grad = ['#8a6e3a', '#6b1a1a', '#5a2a4a', '#3d2418', '#1a0d08'];
                  color = grad[Math.max(0, Math.min(4, (b.c || 3) - 1))];
                } else color = SPINE_COLORS[hashStr(b.t) % SPINE_COLORS.length];
                const width = 22 + (hashStr(b.a || '') % 14);
                return (
                  <div
                    key={`${bookKey(b)}-${sIdx}-${bIdx}`}
                    className="book-spine"
                    style={{ '--spine-color': color, minWidth: `${width}px` }}
                    title={`${b.t} — ${b.a}`}
                    onClick={() => onSpineClick?.(b)}
                  >
                    <div className="spine-text">
                      {b.t.length > 30 ? b.t.slice(0, 28) + '…' : b.t}
                    </div>
                  </div>
                );
              })
            )}
            <div className="shelf-board"></div>
          </div>
        ))}
      </div>
    </>
  );
}

export default function Dashboard({ onOpenBook }) {
  const { state } = useData();
  const { go } = useRouter();

  return (
    <>
      <div className="page-header">
        <div className="page-eyebrow">Your Library</div>
        <h1 className="page-title">
          Welcome <span className="accent">back</span>
        </h1>
        <div style={{ marginTop: '0.8rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {state.profile.readingLevel && (
            <span className="level-pill">📖 {LEVEL_NAMES[state.profile.readingLevel]} reader</span>
          )}
          {state.profile.goal && (
            <span className="level-pill">🎯 {GOAL_NAMES[state.profile.goal]}</span>
          )}
          <span className="level-pill">📚 {state.library.length} read</span>
          <span className="level-pill">❦ {state.readNext.length} queued</span>
        </div>
      </div>

      <div className="library-hero">
        <Shelves onSpineClick={onOpenBook} />
      </div>

      <div className="dashboard-ctas">
        <div className="cta-card" onClick={() => go('oracle')}>
          <div className="cta-ornament">❦</div>
          <h2 className="cta-title">
            The <span className="accent">Wishlist</span> Oracle
          </h2>
          <p className="cta-desc">Draw books from the vault — by mood, by category, or by the books you already love.</p>
        </div>
        <div className="cta-card" onClick={() => go('plan-create')}>
          <div className="cta-ornament">✦</div>
          <h2 className="cta-title">
            Create a <span className="accent">Reading Plan</span>
          </h2>
          <p className="cta-desc">Tell us where you want to go. We'll build a curated, paced path from where you are to where you're headed.</p>
        </div>
      </div>

      {state.currentPlan && (
        <div className="list-section">
          <h2>Your Current Plan</h2>
          <div className="list-item" style={{ borderLeftColor: 'var(--blood-bright)' }}>
            <div className="li-num">✦</div>
            <div className="li-content">
              <div className="li-title">{state.currentPlan.title || 'Active plan'}</div>
              <div className="li-author">
                {(state.currentPlan.books || []).length} books over {state.currentPlan.timeline} months
              </div>
            </div>
            <div className="li-actions">
              <button className="li-action" onClick={() => go('plan-view')}>
                View →
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
