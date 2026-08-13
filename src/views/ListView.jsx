// src/views/ListView.jsx — v0.46
//
// The public, signed-out view of a shared list or plan. This is the page an
// influencer's followers land on, so it is the first thing anyone sees of the
// Oracle — and until now it was rendering against a stylesheet that no longer
// exists.
//
// WHAT WAS WRONG
//
// Every structural class in this file predated the design-system overhaul and
// none of them survived it. `page-header`, `page-eyebrow`, `page-title`,
// `list-item`, `li-num`, `li-content`, `li-title`, `li-author`, `li-actions`
// and `level-pill` all resolve to nothing in `src/styles/` — zero matches
// between them. The markup was therefore unstyled: correct content, browser
// defaults. That is the "styling from before the redesign" report, and it is
// really "no styling at all", which is why it looked older than any previous
// version rather than like a specific old one.
//
// Nothing here changes what the page says. It is a port onto the current
// vocabulary — `ls-page-head` for the header (same as ListDetail), `lv-list` /
// `lv-row` for the rows, `BookCover` for the art, `BookLoader` and `lv-empty`
// for the loading and error states.
//
// The hand-rolled `CoverImg` went with it. It hardcoded `rgba(233,217,182,.5)`
// and a raw gradient, which is exactly the token-discipline rule the project
// already has: no hardcoded parchment values. `BookCover` handles the missing
// cover case and is what every other surface uses.

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from '../lib/RouterContext';
import { useAuth } from '../lib/AuthContext';
// tNode, not t: the curator's name is spliced in as a real <strong> element.
// `t()` runs String(value) over its vars, so passing a React element there
// renders the literal text "[object Object]" — and the two strings were
// missing their {name} placeholder entirely, so the name was silently dropped.
import { useT, useTNode } from '../lib/I18nContext';
import { supabase } from '../lib/supabase';
import { buildBookPageParams, shelfStateOf, shelfKeySets } from '../lib/bookHelpers';
import { useData } from '../lib/DataContext';
import { moodTitleKey, knownMoods } from '../lib/moods';
import BookCover from '../components/BookCover';
import BookLoader from '../components/BookLoader';
import FollowListButton from '../components/FollowListButton';
import SignInGate from '../components/SignInGate';

// The RPC returns `row_to_json(b)` straight off the books table, so the shape
// is snake_case DB columns — not the short-key book objects the rest of the app
// passes around. Normalise once here so the row markup and buildBookPageParams
// both get what they expect, instead of every call site doing
// `entry.book.title || entry.book.t`.
function toAppBook(raw) {
  if (!raw) return null;
  return {
    bookId:   raw.id ?? raw.bookId,
    t:        raw.title ?? raw.t ?? '',
    a:        raw.author ?? raw.a ?? '',
    d:        raw.description ?? raw.d,
    g:        raw.genre ?? raw.g,
    pp:       raw.pages ?? raw.pp,
    c:        raw.complexity ?? raw.c,
    p:        raw.depth ?? raw.p,
    coverUrl: raw.cover_url ?? raw.coverUrl,
  };
}

export default function ListView() {
  const { route, go } = useRouter();
  const { user } = useAuth();
  const { state, markListSeen } = useData();
  const t = useT();
  const tNode = useTNode();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [following, setFollowing] = useState(false);
  const [followerCount, setFollowerCount] = useState(0);
  const [signingIn, setSigningIn] = useState(false);

  const listId = route.params?.listId;
  const planId = route.params?.planId;
  const mode = listId ? 'list' : 'plan';

  // The VIEWER's shelves, not the curator's — see shelfStateOf. Empty for a
  // signed-out visitor, which is exactly right: there is nothing to compare
  // against, so no badges appear.
  //
  // Above the early returns below, because these are hooks.
  const { readKeys, wishKeys } = useMemo(() => shelfKeySets(state), [state]);

  useEffect(() => {
    async function load() {
      setLoading(true); setError(null);
      try {
        if (mode === 'list') {
          const { data: d, error: e } = await supabase.rpc('get_public_list', { p_list_id: listId });
          if (e || !d) throw new Error(t('lists.notFound'));
          setData(d);
          setFollowing(!!d.caller_follows);
          setFollowerCount(Number(d.follower_count) || 0);
          // Clears the "changed since you looked" dot on the landing page. A
          // no-op for anyone who is not a follower.
          if (d.caller_follows) markListSeen(listId);
        } else {
          const { data: d, error: e } = await supabase.rpc('get_public_plan', { p_plan_id: planId });
          if (e || !d) throw new Error(t('lists.notFound'));
          setData(d);
        }
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    if (listId || planId) load();
    // `mode` is derived from listId/planId, both already here, so it cannot
    // change without one of them changing. `t` is excluded on purpose — it is
    // read only for a fallback error message, and adding it would refetch the
    // whole list every time the reader toggles language.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listId, planId]);

  // Opening a book does NOT require an account.
  //
  // The button that did this was wrapped in `{user && ...}`, so a signed-out
  // visitor — the entire audience for a shared link — got a list of titles they
  // could not act on. `book-page` has been a public route since v0.39 and
  // renders fine without a session; the gate was left over from when it wasn't.
  //
  // Same-tab navigation rather than openBookTab's new window: a visitor who
  // arrived from a social post is already in a tab they chose, and spawning
  // another one is both surprising and liable to be blocked by the popup
  // blocker when it is not the direct result of a trusted click.
  function openBook(book) {
    go('book-page', buildBookPageParams(book, 'list-view', t('lists.fromList')));
  }

  if (loading) return <BookLoader text={t('lists.loading')} fullHeight />;

  if (error || !data) return (
    <div className="lv-empty">
      <div className="lv-empty-icon">❦</div>
      <div className="lv-empty-title">{error || t('lists.notFound')}</div>
      <div className="lv-empty-text">{t('lists.notFoundText')}</div>
      {user && (
        <button className="btn-primary" onClick={() => go('dashboard')}>
          {t('lists.toDashboard')}
        </button>
      )}
    </div>
  );

  // ── List view ────────────────────────────────────────────────────────────────
  if (mode === 'list') {
    const { list, owner, books } = data;
    // Added to get_public_list in the v0.63 migration; defaulted so a client
    // running against an un-migrated database still renders the list rather
    // than throwing on `.map` of undefined.
    const genreNames = data.genre_names || [];
    const moods = knownMoods(data.moods || []);
    return (
      <>
        <div className="ls-page-head">
          <div className="ls-page-head__label lv-curated-by">
            {tNode('lists.curatedBy', { name: <strong className="lv-curator-name">{owner.display_name}</strong> })}
          </div>
          <h1 className="ls-page-title">{list.title}</h1>
          {list.description && (
            <p className="ls-page-desc">{list.description}</p>
          )}
          <div className="ls-page-head__meta">
            <span className="plan-badge">▤ {t('lists.bookCount', { count: books.length })}</span>
            {followerCount > 0 && (
              <span className="plan-badge">❦ {t('lists.followerCount', { count: followerCount })}</span>
            )}
          </div>
          {(genreNames.length > 0 || moods.length > 0) && (
            <div className="list-meta__summary">
              {genreNames.map((g) => (
                <span key={g} className="directory-tag">{g}</span>
              ))}
              {moods.map((m) => (
                <span key={m} className="directory-tag directory-tag--mood">{t(moodTitleKey(m))}</span>
              ))}
            </div>
          )}
        </div>

        <div className="plan-divider"><span className="plan-divider__glyph">✦</span></div>

        <div className="bp-actions">
          {/* Follow is offered to signed-out visitors too — it opens the gate
              rather than vanishing. Hiding it would hide the feature from
              exactly the audience a shared link is aimed at. */}
          <FollowListButton
            listId={listId}
            following={following}
            onChange={(next) => {
              setFollowing(next);
              setFollowerCount((c) => Math.max(0, c + (next ? 1 : -1)));
            }}
            onRequireSignIn={() => setSigningIn(true)}
          />
          {user && (
            <button className="btn-secondary" onClick={() => go('lists')}>
              {t('lists.saveToMyLists')}
            </button>
          )}
          <button className="btn-text" onClick={() => go('lists-discover')}>
            {t('lists.discoverBtn')}
          </button>
        </div>

        {signingIn && !user && <SignInGate onClose={() => setSigningIn(false)} />}

        {books.length === 0 ? (
          <div className="lv-empty">
            <div className="lv-empty-icon">❦</div>
            <div className="lv-empty-title">{t('listDetail.emptyTitle')}</div>
          </div>
        ) : (
          <div className="lv-list">
            {books.map((entry, i) => {
              const book = toAppBook(entry.book);
              const shelf = shelfStateOf(book, readKeys, wishKeys);
              return (
                <div
                  key={book.bookId || i}
                  className="lv-row lv-row--clickable"
                  role="button"
                  tabIndex={0}
                  onClick={() => openBook(book)}
                  // The whole row is the target, so it has to answer to the
                  // keyboard too — a div with an onClick and no key handling is
                  // unreachable without a mouse.
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openBook(book); }
                  }}
                >
                  <div className="lv-row__num">{i + 1}</div>
                  <div className={`lv-row__cover${shelf ? ` is-${shelf}` : ''}`}>
                    <BookCover title={book.t} author={book.a} coverUrl={book.coverUrl} />
                  </div>
                  <div className="lv-row__content">
                    <div className="lv-row__title">
                      {book.t}
                      {shelf && (
                        <span className={`shelf-badge shelf-badge--${shelf}`}>
                          {shelf === 'library' ? t('lists.badgeRead') : t('lists.badgeWishlist')}
                        </span>
                      )}
                    </div>
                    <div className="lv-row__author">{book.a}</div>
                    {entry.note && <div className="lv-item-note">{entry.note}</div>}
                  </div>
                  <div className="lv-row__actions">
                    <button
                      className="btn-text"
                      onClick={(e) => { e.stopPropagation(); openBook(book); }}
                    >
                      {t('lists.viewBook')}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </>
    );
  }

  // ── Plan view ────────────────────────────────────────────────────────────────
  const { plan, owner } = data;
  const content = plan.content || {};
  const books = content.books || [];

  return (
    <>
      <div className="ls-page-head">
        <div className="ls-page-head__label lv-curated-by">
          {tNode('plans.planBy', { name: <strong className="lv-curator-name">{owner.display_name}</strong> })}
        </div>
        <h1 className="ls-page-title">{plan.title || content.title}</h1>
        {content.intro && (
          <p className="ls-page-desc">{content.intro}</p>
        )}
        <div className="ls-page-head__meta">
          <span className="plan-badge">▤ {t('plans.viewBooks', { count: books.length })}</span>
          {content.timeline && <span className="plan-badge">◷ {t('plans.timeline', { count: content.timeline })}</span>}
        </div>
      </div>

      <div className="plan-divider"><span className="plan-divider__glyph">✦</span></div>

      {user && (
        <div className="bp-actions">
          <button className="btn-primary" onClick={() => go('plan-view', { planId: plan.id })}>
            {t('plans.savePlan')}
          </button>
        </div>
      )}

      {/* Plan entries carry no book_id — they come out of the plan's JSON
          content, which stores titles and authors rather than catalog rows. So
          these stay non-clickable: buildBookPageParams would produce a bookKey
          with no book behind it, and a link that lands on "not found" is worse
          than no link. Wiring these up means resolving them against the catalog
          first, which is its own piece of work. */}
      {/* Same month-card markup PlanView uses, so the public and signed-in
          views of a plan finally look like the same product. The old
          `plan-step` / `plan-book` / `plan-author` / `plan-reason` classes were
          part of the same dead set as the list rows above. */}
      <div className="plan-months plan-months--thread">
        {books.map((b, i) => (
          <div className="plan-month-card" key={i}>
            <div className="plan-month-card__label">{t('plans.month', { n: b.month || i + 1 })}</div>
            <div className="plan-month-card__content">
              <div className="plan-month-card__title">{b.title || b.t}</div>
              <div className="plan-month-card__author">{b.author || b.a}</div>
              {b.reason && <div className="plan-month-card__blurb">{b.reason}</div>}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
