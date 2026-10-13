import { useTNode } from '../../contexts/I18nContext';

// ─── Quick Actions ─────────────────────────────────────────────────────────────
export default function QuickActionsWidget({ go, t }) {
  const tNode = useTNode();
  const actions = [
    { richLabel: 'dashboard.ctaWishlist', sub: t('dashboard.ctaWishlistSub'), glyph: '↗', route: 'wishlist', isAccent: false },
    { richLabel: 'dashboard.ctaLibrary', sub: t('dashboard.ctaLibrarySub'), glyph: '▤', route: 'library', isAccent: false },
    { richLabel: 'dashboard.ctaOracle', sub: t('dashboard.ctaOracleSub'), glyph: '✧', route: 'oracle', isAccent: true },
    { richLabel: 'dashboard.ctaPlan', sub: t('dashboard.ctaPlanSub'), glyph: '✦', route: 'plan-create', isAccent: false },
    // v0.62.2: the Stacks, curated Lists and the club directory all existed and
    // were only reachable from the nav. Ordered after the four originals
    // deliberately — these are places to wander, not the things a reader most
    // often arrives wanting to do.
    { richLabel: 'dashboard.ctaStacks', sub: t('dashboard.ctaStacksSub'), glyph: '▦', route: 'stacks', isAccent: false },
    { richLabel: 'dashboard.ctaList', sub: t('dashboard.ctaListSub'), glyph: '❧', route: 'lists', isAccent: false },
    { richLabel: 'dashboard.ctaClubs', sub: t('dashboard.ctaClubsSub'), glyph: '◈', route: 'club-directory', isAccent: false },
  ];
  return (
    <section className="db-ctas">
      {actions.map(({ richLabel, sub, glyph, route, isAccent }) => (
        <button key={route}
          className={`db-cta-card${isAccent ? ' db-cta-card--ro-accent' : ''}`}
          onClick={() => go(route)}>
          <div className="db-cta-glyph">{glyph}</div>
          <div className="db-cta-label">{tNode(richLabel)}</div>
          <div className="db-cta-sub">{sub}</div>
        </button>
      ))}
    </section>
  );
}
