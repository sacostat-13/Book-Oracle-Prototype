// src/views/CuratedLists.jsx — the Curated Lists landing page (v0.63)
//
// `/lists` used to be the management view. It is now the hub, and management
// moved to `/lists/mine`.
//
// The order down the page is the argument for the split. Lists only became
// worth three pages when they stopped being a private organising tool, and what
// makes them public is following someone else's — so "Lists you follow" is
// above the fold and your own lists are a strip beneath it. Putting your own
// first would have been the old page with a new section bolted on, and the
// follow relationship would have read as an afterthought.

import { useEffect, useState, useCallback } from 'react';
import { useData } from '../lib/DataContext';
import { useRouter } from '../lib/RouterContext';
import { useT, useTNode } from '../lib/I18nContext';
import EmptyState from '../components/EmptyState';
import CoverStrip from '../components/CoverStrip';
import BookLoader from '../components/BookLoader';

function FollowedCard({ list, onOpen }) {
  const t = useT();
  return (
    <div className="cl-follow-card" role="button" tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
    >
      <div className="cl-follow-card__head">
        <div className="cl-follow-card__title">
          {list.title}
          {/* Changed since you last opened it. The point of following is being
              told; a dot you can see without reading a notification is the
              cheapest possible version of that. */}
          {list.hasUpdates && <span className="cl-follow-card__dot" title={t('lists.updatedSinceYouLooked')} />}
        </div>
        <div className="cl-follow-card__meta">
          {t('lists.byCurator', { name: list.ownerDisplay || list.ownerUsername || t('nav.someone') })}
          {' · '}
          {t('lists.bookCount', { count: list.bookCount })}
        </div>
      </div>
      {list.coverUrls.length > 0 && <CoverStrip urls={list.coverUrls} max={6} />}
    </div>
  );
}

export default function CuratedLists() {
  const { state, fetchFollowedLists } = useData();
  const { go } = useRouter();
  const t = useT();
  const tNode = useTNode();

  const [followed, setFollowed] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setFollowed(await fetchFollowedLists());
    setLoading(false);
  }, [fetchFollowedLists]);

  useEffect(() => { load(); }, [load]);

  const mine = state.lists || [];
  const minePreview = mine.slice(0, 4);

  return (
    <>
      <div className="ls-dash-head">
        <div className="page-head__eyebrow"><span>{t('lists.curatedEyebrow')}</span></div>
        <h1 className="page-head__title">{tNode('lists.curatedPageTitle')}</h1>
        <p className="page-head__lead">{t('lists.curatedSubtitle')}</p>
      </div>

      <div className="bp-actions">
        <button className="btn-primary" onClick={() => go('lists-discover')}>
          ✦ {t('lists.discoverBtn')}
        </button>
        <button className="btn-secondary" onClick={() => go('lists-mine')}>
          {t('lists.myListsBtn')}
        </button>
      </div>

      <div className="plan-divider"><span className="plan-divider__glyph">✦</span></div>

      {/* ── Lists you follow ── */}
      <section className="cl-section">
        <h2 className="pf-section__title">{t('lists.followingSection')}</h2>
        {loading ? (
          <BookLoader text={t('lists.loading')} />
        ) : followed.length === 0 ? (
          <EmptyState
            ornament="❦"
            title={t('lists.noFollowsTitle')}
            body={t('lists.noFollowsBody')}
            action={{ label: t('lists.discoverBtn'), onClick: () => go('lists-discover') }}
          />
        ) : (
          <div className="cl-follow-grid">
            {followed.map((l) => (
              <FollowedCard key={l.id} list={l} onOpen={() => go('list-view', { listId: l.id })} />
            ))}
          </div>
        )}
      </section>

      {/* ── Your lists ── */}
      <section className="cl-section">
        <div className="cl-section__head">
          <h2 className="pf-section__title">{t('lists.yourListsSection')}</h2>
          {mine.length > 0 && (
            <button className="btn-text" onClick={() => go('lists-mine')}>
              {t('lists.seeAll', { count: mine.length })}
            </button>
          )}
        </div>
        {mine.length === 0 ? (
          <EmptyState
            ornament="❦"
            title={t('lists.emptyTitle')}
            body={t('lists.emptyText')}
            action={{ label: t('lists.emptyCta'), onClick: () => go('lists-mine') }}
          />
        ) : (
          <div className="cl-follow-grid">
            {minePreview.map((l) => (
              <div
                key={l.id}
                className="cl-follow-card"
                role="button"
                tabIndex={0}
                onClick={() => go('list-detail', { listId: l.id })}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go('list-detail', { listId: l.id }); } }}
              >
                <div className="cl-follow-card__head">
                  <div className="cl-follow-card__title">{l.title}</div>
                  <div className="cl-follow-card__meta">
                    {t('lists.bookCount', { count: (l.books || []).length })}
                    {l.is_public && <> · {t('lists.publicBadge')}</>}
                  </div>
                </div>
                {(l.books || []).length > 0 && (
                  <CoverStrip urls={(l.books || []).map((b) => b.coverUrl).filter(Boolean)} max={6} />
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
