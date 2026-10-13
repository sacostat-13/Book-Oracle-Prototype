import { lazy, Suspense, useState, useRef, useEffect } from 'react';
import { bookKey, openBookTab } from './lib/bookHelpers';
import { canonicalUrl } from './lib/siteUrl';
import { useAuth } from './lib/AuthContext';
import { useData } from './lib/DataContext';
import { useRouter } from './lib/RouterContext';
import { useT, useTNode } from './lib/I18nContext';
import { useDocumentMeta } from './lib/useDocumentMeta';

import Nav from './components/Nav';
import LandingNav from './components/LandingNav';
import LandingFooter from './components/LandingFooter';
import CornerBrackets from './components/CornerBrackets';
import BookLoader from './components/BookLoader';
import Toast from './components/Toast';
import ShareMomentModal from './components/ShareMomentModal';
import ImportProgressToast from './components/ImportProgressToast';
import OracleGateDialog from './components/OracleGateDialog';
import SignInGate from './components/SignInGate';
import PasswordResetGate from './components/PasswordResetGate';

import Onboarding from './views/Onboarding';
import Dashboard from './views/Dashboard';
import Landing from './views/Landing';
import BookPage from './views/BookPage';
// v0.28: book clubs
import Footer from './components/Footer';

// Pages load on demand (code-health spike L6): each lazy page is its own chunk,
// fetched the first time it is opened. Kept eager on purpose:
//   Landing, Dashboard — the first screen for visitors / signed-in readers;
//     lazy would add a second round trip before anything paints.
//   BookPage — the most-opened page, and the target of the cover morph
//     (coverMorph.js renders it synchronously and waits ≤450 ms for its cover).
//   Onboarding — the first screen after sign-up.
// Navigations run in a transition (RouterContext), so the current page stays on
// screen while the next chunk downloads; the Suspense fallback in App only
// shows on a cold first load.
const Stacks = lazy(() => import('./views/Stacks'));
const Wishlist = lazy(() => import('./views/Wishlist'));
const Library = lazy(() => import('./views/Library'));
const ReadNext = lazy(() => import('./views/ReadNext'));
const CurrentlyReading = lazy(() => import('./views/CurrentlyReading'));
const Profile = lazy(() => import('./views/Profile'));
const ReaderProfile = lazy(() => import('./views/ReaderProfile'));
const Kindred = lazy(() => import('./views/Kindred'));
const About = lazy(() => import('./views/About'));
const Changelog = lazy(() => import('./views/Changelog'));
const Privacy = lazy(() => import('./views/Privacy'));
const Terms = lazy(() => import('./views/Terms'));
const Refund = lazy(() => import('./views/Refund'));
const NotFound = lazy(() => import('./views/NotFound'));
const SitemapPage = lazy(() => import('./views/SitemapPage'));
const OracleFork = lazy(() => import('./views/OracleFork'));
const OracleCategories = lazy(() => import('./views/OracleCategories'));
const OracleSimilar = lazy(() => import('./views/OracleSimilar'));
const OracleAsk = lazy(() => import('./views/OracleAsk'));
const PlanCreate = lazy(() => import('./views/PlanCreate'));
const PlanList = lazy(() => import('./views/PlanList'));
const PlanView = lazy(() => import('./views/PlanView'));
const ListView = lazy(() => import('./views/ListView'));
const Lists = lazy(() => import('./views/Lists'));
const CuratedLists = lazy(() => import('./views/CuratedLists'));
const ListDirectory = lazy(() => import('./views/ListDirectory'));
const ListDetail = lazy(() => import('./views/ListDetail'));
const SeriesPage = lazy(() => import('./views/SeriesPage'));
const BookClubs = lazy(() => import('./views/BookClubs'));
const ClubDirectory = lazy(() => import('./views/ClubDirectory'));
const BookClubCreate = lazy(() => import('./views/BookClubCreate'));
const BookClubDetail = lazy(() => import('./views/BookClubDetail'));
const SessionCreate = lazy(() => import('./views/SessionCreate'));
const SessionDetail = lazy(() => import('./views/SessionDetail'));
const JoinClub = lazy(() => import('./views/JoinClub'));
const GenresIndex = lazy(() => import('./views/GenresIndex'));
const FamilyPage = lazy(() => import('./views/FamilyPage'));
const GenrePage = lazy(() => import('./views/GenrePage'));

// Overlays that must work on EVERY screen a reader can act on. They used to be
// mounted only in the main shell at the bottom of AppRoutes, so the early-return
// shells (book page, list view, plan view, join club…) had none of them:
// finishing a book on its own page queued the share moment, but nothing showed
// it until the reader navigated to a main-shell page; an Oracle call from the
// book page could wait on a confirmation dialog that wasn't mounted. Rendering
// them once, around every route, makes that class of bug impossible. Each one
// renders nothing until its state says otherwise.
export default function App() {
  return (
    <>
      <Suspense fallback={<BookLoader fullHeight />}>
        <AppRoutes />
      </Suspense>
      <ShareMomentModal />
      <ImportProgressToast />
      {/* Inside RouterProvider (main.jsx) because its upgrade CTA needs the router. */}
      <OracleGateDialog />
    </>
  );
}

function AppRoutes() {
  const { state, loading, upsertDiscoveredBook } = useData();
  const { route, go } = useRouter();
  const { user, loading: authLoading, recoveringPassword } = useAuth();
  const t = useT();

  // v0.55.4: bump to re-read the DEV onboarding-replay session flag (see effect below).
  const [, forceRerender] = useState(0);
  const devReplayOnboarding = import.meta.env.DEV
    && (() => { try { return window.sessionStorage.getItem('bo_dev_replay_onboarding') === '1'; } catch { return false; } })();

  // v0.39: default <title>/description per static route. book-page and
  // series-page are deliberately excluded — those own their own title/meta
  // once their data resolves (BookPage.jsx / SeriesPage.jsx), and setting a
  // generic default here would race with and overwrite their effect since
  // child effects commit before parent effects in React.
  //
  // v0.40: 'dashboard' is excluded the same way for signed-out visitors —
  // Landing.jsx sets its own marketing title/description/JSON-LD, and this
  // generic default would otherwise stomp it for the same child-before-parent
  // reason.
  const ROUTE_META = {
    dashboard: { title: 'Dashboard — The Books Oracle', description: 'Your wishlist, library, and reading plans in one place.' },
    wishlist: { title: 'Wishlist — The Books Oracle' },
    library: { title: 'Library — The Books Oracle' },
    'read-next': { title: 'Read Next — The Books Oracle' },
    'currently-reading': { title: 'Currently Reading — The Books Oracle' },
    profile: { title: 'Profile — The Books Oracle' },
    about: { title: 'About — The Books Oracle', description: 'The Books Oracle — wishlist, library, reading plans and an Oracle that knows what you will love next.' },
    changelog: { title: 'What’s New — The Books Oracle', description: 'Every release of The Books Oracle: new features, improvements, and fixes across the reading app.' },
    oracle: { title: 'Oracle — The Books Oracle' },
    'stacks': { title: 'Wander the Stacks — The Books Oracle' },
    // family-page and genre-page set their own meta from the row they load —
    // a static title here would override the specific one on first paint.
    'genres-index': { title: 'Browse by Genre — The Books Oracle', description: 'Sixteen shelves and every genre on them — find your next book by the kind of book it is.' },
    'oracle-categories': { title: 'Explore by Genre — The Books Oracle' },
    'oracle-similar': { title: 'Find Similar Books — The Books Oracle' },
    'oracle-ask': { title: 'Ask the Oracle — The Books Oracle' },
    'plan-create': { title: 'New Reading Plan — The Books Oracle' },
    'plan-list': { title: 'Reading Plans — The Books Oracle' },
    lists: { title: 'Curated Lists — The Books Oracle' },
    'lists-mine': { title: 'My Lists — The Books Oracle' },
    'lists-discover': { title: 'Discover Curated Lists — The Books Oracle', description: 'Reading lists made by other readers — browse by genre and mood, and follow the ones worth keeping.' },
    'book-clubs': { title: 'Book Clubs — The Books Oracle' },
    'club-directory': { title: 'Find a Book Club — The Books Oracle' },
    'book-club-create': { title: 'Start a Book Club — The Books Oracle' },
    privacy: { title: 'Privacy Policy — The Books Oracle' },
    terms: { title: 'Terms of Service — The Books Oracle' },
    refund: { title: 'Refund Policy — The Books Oracle' },
    sitemap: { title: 'Sitemap — The Books Oracle', description: 'A map of every section of The Books Oracle.' },
    'not-found': { title: "The Oracle can't see that far — The Books Oracle", noindex: true },
  };
  const isLandingVisit = route.name === 'dashboard' && !authLoading && !user;
  // 2026-10-07: routes that own their meta get `pending` here, not `{}`. An
  // empty object is not "say nothing": it still writes og:url from the
  // location and resets robots to the index default -- and because this parent
  // effect commits AFTER the child's, it overwrote BookPage's canonical og:url
  // and its noindex on the first render. That only went unnoticed because
  // BookPage used to re-run its effect when its fetch landed; now that it can
  // render from the prerender's seed on the first pass, there is no second run
  // to repair it.
  const OWNS_META = new Set(['book-page', 'series-page', 'genre-page', 'family-page']);
  useDocumentMeta(
    OWNS_META.has(route.name)
      ? { pending: true }
      : isLandingVisit ? {} : (ROUTE_META[route.name] || {})
  );

  // v0.39: keep <link rel="canonical"> in sync with the current path, now that
  // paths are real routes instead of a hash. Always points at one host
  // regardless of which domain/alias served the request, so .net/.org visitors
  // and any lingering readingoracle.com traffic canonicalize correctly.
  //
  // v0.61.2, two corrections:
  //
  // 1. www. The host was thebooksoracle.com, which 301s to www — so this tag
  //    named a URL that is never the one served. See index.html for the four
  //    places that must agree.
  // 2. index.html now ships a static canonical for `/`. This effect still runs
  //    and still updates it per route, but it is no longer the ONLY source of
  //    one. It used to be: the tag was created in an effect, so it existed only
  //    after React mounted — which is precisely the rendering pass a canonical
  //    is supposed to be robust against. The static tag is the floor; this
  //    keeps it accurate as the reader navigates.
  //
  // v0.61.2 also drops window.location.search from the canonical. `?lang=en`
  // is a UI preference, not a different document — including it told Google
  // that `/` and `/?lang=en` were two pages competing for the same content.
  // See src/lib/siteUrl.js.
  useEffect(() => {
    // 2026-09-08: series-page owns its canonical and this effect must not fight
    // it. Two spellings of one series ("Chronicles of Narnia" / "The Chronicles
    // of Narnia") resolve to the same row, so the canonical has to come from
    // the catalog's series.name rather than from whichever spelling was
    // requested. SeriesPage passes it to useDocumentMeta; effects commit
    // child-before-parent, so without this guard the parent would overwrite the
    // child's correct value a moment later -- the same ordering hazard the
    // ROUTE_META comment above describes.
    //
    // 2026-10-07: book-page too. BookPage builds its canonical from the row's
    // share key (the prerender's, when it supplied one), so every spelling of a
    // book URL names one canonical. This effect would overwrite that with
    // whichever spelling was requested.
    if (route.name === 'series-page' || route.name === 'book-page') return;
    const canonical = canonicalUrl();
    let link = document.querySelector('link[rel="canonical"]');
    if (!link) {
      link = document.createElement('link');
      link.setAttribute('rel', 'canonical');
      document.head.appendChild(link);
    }
    link.setAttribute('href', canonical);
  }, [route.name, route.params]);

  // v0.55.4: local-only onboarding replay. Visiting the app with ?onboarding=reset
  // in a DEV build raises a session flag that forces the onboarding flow to show,
  // without touching the DB, so it can be tested without creating a new account.
  // The flag is read directly by the render gate below (not stored in React
  // state) so it survives DataContext reloading `onboarded` from the DB — which
  // would otherwise immediately bounce back to the dashboard. Onboarding clears
  // the flag on finish. The param is stripped from the URL so a refresh is
  // normal. No-op in production builds regardless of the query string.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('onboarding') === 'reset') {
      try { window.sessionStorage.setItem('bo_dev_replay_onboarding', '1'); } catch { /* private mode */ }
      params.delete('onboarding');
      const qs = params.toString();
      const newUrl = window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash;
      window.history.replaceState({}, '', newUrl);
      forceRerender((n) => n + 1); // pick up the flag now that the param is gone
    }
  }, []);

  // previewBook holds a book from search results that isn't in the collection yet.
  // BookPage reads this ref when route.params.preview === 'true'.
  //
  // ONE SLOT, NEVER CLEARED. It holds the most recent search selection for the
  // rest of the session, which means it is not on its own an answer to "which
  // book is this page for" — a second search overwrites it while older preview
  // URLs stay in browser history pointing at it. BookPage compares
  // bookKey(previewBookRef.current) against route.params.bookKey before
  // trusting it; anything that reads this ref must do the same, or it will
  // render the wrong book after any second search (fixed in v0.62.2).
  const previewBookRef = useRef(null);
  function setPreviewBook(book) { previewBookRef.current = book; }

  // ── Password recovery ───────────────────────────────────────────────────────
  // Checked before the public-route branch and before the auth gate, because a
  // recovery link can land on ANY url — whatever the reader had open when they
  // asked for the reset, or whatever Supabase's Site URL points at. Letting a
  // public route render first would swallow the one moment we have to ask for
  // the new password, and the recovery session is short-lived.
  if (recoveringPassword) {
    return (
      <div className="app">
        <PasswordResetGate />
        <Toast />
      </div>
    );
  }

  // ── Public routes — render immediately, no auth or data required ────────────
  // These pages read content from the URL snapshot and progressively enhance
  // with auth-dependent actions once the user is signed in and data is loaded.
  // v0.63 — 'lists-discover' joins the public set. Curated lists exist to be
  // promoted off-site, so the directory is a landing page as much as an
  // internal one; gating it would put a wall in front of the first thing a
  // visitor from social media sees. search_public_lists is anon-callable and
  // returns caller_follows = false for them.
  // 2026-08-24 — 'series-page' joins the public set, and it is the omission
  // that cost the most. netlify/functions/sitemap.js submits every /series/:name
  // to Google; og-prerender.js serves crawlers a page titled "<series> series in
  // order — every book"; Search Console shows those URLs ranking for "<series>
  // books in order". And every visitor who clicked one hit the sign-in gate,
  // because this Set did not list the route. We were advertising a page nobody
  // could read.
  //
  // 'book-page' was public from the start; the series route simply never got
  // the same treatment when v0.39 introduced path routing.
  const PUBLIC_ROUTES = new Set(['book-page', 'series-page', 'list-view', 'plan-view', 'join-club', 'privacy', 'terms', 'refund', 'not-found', 'sitemap', 'lists-discover', 'genres-index', 'family-page', 'genre-page', 'about', 'changelog']);
  if (PUBLIC_ROUTES.has(route.name)) {
    // During the brief auth check (~100ms), treat as loading not signed-out.
    // This prevents the sign-in prompt flashing before the session is confirmed.
    const isAuthed = !authLoading && !!user;
    const authPending = authLoading; // still checking session
    const dataReady = isAuthed && !loading && state.onboarded;
    if (route.name === 'book-page') {
      return (
        <div className="app">
          {isAuthed && <Nav onPreviewBook={setPreviewBook} />}
          <div className="container">
            <BookPage
              previewBookRef={previewBookRef}
              isAuthed={isAuthed}
              authPending={authPending}
              dataReady={dataReady}
            />
          </div>
          <Toast />
        </div>
      );
    }
    // NOT an unconditional early return, unlike the branches below.
    //
    // A signed-in reader keeps the full app shell from the main switch (Nav,
    // Footer). The global overlays — share moments, import progress, the Oracle
    // gate — are mounted by App around every route, so no branch can drop them.
    // The public shell is for the visitor who has no shell to keep.
    //
    // While authPending, isAuthed is false and this renders the public view with
    // its CTA suppressed — no sign-in flash — then hands over once auth resolves.
    // v0.67 — the genre surface, following the series-page pattern exactly: a
    // signed-out visitor gets the public shell, a signed-in reader falls
    // through to the main switch and keeps the full app chrome. These pages are
    // catalogue-only, so the two renders differ in navigation, never in
    // content — which is what makes the prerender honest.
    if ((route.name === 'genres-index' || route.name === 'family-page' || route.name === 'genre-page') && !isAuthed) {
      const View = route.name === 'genres-index' ? GenresIndex
        : route.name === 'family-page' ? FamilyPage
        : GenrePage;
      return (
        <div className="app">
          <View />
          <Footer />
          <Toast />
        </div>
      );
    }

    if (route.name === 'series-page' && !isAuthed) {
      return (
        <div className="app">
          <div className="container">
            <SeriesPage
              isAuthed={isAuthed}
              authPending={authPending}
              dataReady={dataReady}
            />
          </div>
          {/* Same call as lists-discover: for a signed-out visitor this IS a
              landing page — it is what someone searching "<series> books in
              order" arrives on — so it gets the marketing footer. */}
          {!isAuthed && <LandingFooter />}
          <Toast />
        </div>
      );
    }
    if (route.name === 'list-view') {
      return (
        <div className="app">
          {isAuthed && <Nav onPreviewBook={setPreviewBook} />}
          <div className="container">
            <ListView isAuthed={isAuthed} dataReady={dataReady} />
          </div>
          <Toast />
        </div>
      );
    }
    if (route.name === 'lists-discover') {
      return (
        <div className="app">
          {isAuthed && <Nav onPreviewBook={setPreviewBook} />}
          <div className="container">
            <ListDirectory />
          </div>
          {!isAuthed && <LandingFooter />}
          <Toast />
        </div>
      );
    }
    if (route.name === 'plan-view') {
      return (
        <div className="app">
          {isAuthed && <Nav onPreviewBook={setPreviewBook} />}
          <div className="container">
            <PlanView isAuthed={isAuthed} dataReady={dataReady} />
          </div>
          <Toast />
        </div>
      );
    }
    if (route.name === 'join-club') {
      return (
        <div className="app">
          {isAuthed && <Nav onPreviewBook={setPreviewBook} />}
          <div className="container">
            <JoinClub />
          </div>
          <Toast />
        </div>
      );
    }

    // About and What's New — public for signed-out visitors, in the landing
    // chrome like the legal pages. Before this they were missing from
    // PUBLIC_ROUTES and fell through to <SignInGate/>: the prerender served
    // Googlebot the About copy while a person clicking through from a search
    // result, a link in bio or an outreach email got a sign-in wall. A
    // signed-in reader falls through to the main switch and keeps the full
    // app chrome, exactly as before.
    if ((route.name === 'about' || route.name === 'changelog') && !isAuthed && !authPending) {
      const View = route.name === 'about' ? About : Changelog;
      return (
        <div className="app lp-root">
          <LandingNav onOpenAuth={(mode) => go('dashboard', { auth: mode })} />
          <div className="container lp-legal-container">
            <View />
          </div>
          <LandingFooter />
          <Toast />
        </div>
      );
    }

    // Legal pages — public, no auth required.
    // Signed-in visitors keep the authenticated app chrome (Nav + Footer).
    // Signed-out visitors now get the PUBLIC marketing chrome — the same
    // LandingNav/LandingFooter used on '/' — per the landing-page guideline:
    // "if you're not logged in, you will see the legal pages opening on the
    // landing page interface, which is with the nav, footer and styling of
    // the landing page."
    const legalViews = { privacy: Privacy, terms: Terms, refund: Refund, sitemap: SitemapPage, 'not-found': NotFound };
    if (legalViews[route.name]) {
      const View = legalViews[route.name];
      if (isAuthed) {
        return (
          <div className="app">
            <Nav onPreviewBook={setPreviewBook} />
            <div className="container">
              <View />
            </div>
            <Footer />
            <Toast />
          </div>
        );
      }
      return (
        <div className="app lp-root">
          <LandingNav onOpenAuth={(mode) => go('dashboard', { auth: mode })} />
          <div className="container lp-legal-container">
            <View />
          </div>
          <LandingFooter />
          <Toast />
        </div>
      );
    }
  }

  // Wait for auth to settle first — this is fast (local session check)
  if (authLoading) {
    return (
      <div className="app">
        <BookLoader text={t('app.loading')} fullHeight />
      </div>
    );
  }

  // No session on the public root → show the Landing page (marketing site),
  // not the sign-in gate directly. Landing's own CTAs open the sign-in modal
  // (a reused <SignInGate>) so first-time visitors get context before being
  // asked to commit. Every other authenticated route still gates on sign-in
  // as before — there is no guest/offline bypass beyond '/'.
  if (!user) {
    if (route.name === 'dashboard') {
      return (
        <div className="app">
          <Landing />
          <Toast />
        </div>
      );
    }
    return (
      <div className="app">
        <SignInGate />
        <Toast />
      </div>
    );
  }

  // Authenticated — now wait for DataContext to finish loading user data
  if (loading) {
    return (
      <div className="app">
        <BookLoader text={t('app.loading')} fullHeight />
      </div>
    );
  }

  // Onboarding
  if (!state.onboarded || devReplayOnboarding) {
    return (
      <div className="app">
        <Onboarding />
        <Toast />
      </div>
    );
  }

  function openBook(book) {
    // 2026-10-08: an Oracle pick the catalogue has never seen had no `books`
    // row, so its /book/<key> URL only worked inside the tab that carried the
    // snapshot. Refresh, cmd-click or share it and every reader got "Book not
    // found" (reported: How to Make an American Quilt, The Quilter's
    // Apprentice, The Persian Pickle Club). Record it as `discovered`, as
    // search already does, so the address resolves for anyone. Fire and
    // forget: the new tab paints from its snapshot and does not wait on this.
    // upsertDiscoveredBook skips guests and books already on a shelf.
    Promise.resolve(upsertDiscoveredBook?.(book)).catch((err) => {
      console.warn('[openBook] discovered upsert failed', err?.message || err);
    });
    openBookTab(book, 'app');
  }

  let page;
  switch (route.name) {
    case 'wishlist': page = <Wishlist onOpenBook={openBook} />; break;
    case 'library': page = <Library onOpenBook={openBook} />; break;
    case 'read-next': page = <ReadNext onOpenBook={openBook} />; break;
    case 'currently-reading': page = <CurrentlyReading onOpenBook={openBook} />; break;
    case 'profile': page = <Profile />; break;
    case 'reader-profile': page = <ReaderProfile />; break;
    case 'kindred': page = <Kindred />; break;
    case 'about': page = <About />; break;
    case 'changelog': page = <Changelog />; break;
    case 'privacy': page = <Privacy />; break;
    case 'terms': page = <Terms />; break;
    case 'refund': page = <Refund />; break;
    case 'oracle': page = <OracleFork />; break;
    case 'stacks': page = <Stacks />; break;
    case 'genres-index': page = <GenresIndex />; break;
    case 'family-page': page = <FamilyPage />; break;
    case 'genre-page': page = <GenrePage />; break;
    case 'oracle-categories': page = <OracleCategories onOpenBook={openBook} />; break;
    case 'oracle-similar': page = <OracleSimilar onOpenBook={openBook} />; break;
    case 'oracle-ask': page = <OracleAsk onOpenBook={openBook} />; break;
    case 'plan-create': page = <PlanCreate />; break;
    case 'plan-list': page = <PlanList />; break;
    // 'plan-view' is handled earlier in the public-routes branch (it renders
    // for shared links without auth), so it never reaches this switch.
    case 'book-page': page = <BookPage previewBookRef={previewBookRef} />; break;
    case 'series-page': page = <SeriesPage />; break;
    // v0.63 — `lists` is the hub; the old management view moved to lists-mine.
    case 'lists': page = <CuratedLists />; break;
    case 'lists-mine': page = <Lists />; break;
    case 'lists-discover': page = <ListDirectory />; break;
    case 'list-detail': page = <ListDetail />; break;
    case 'list-view': page = <ListView />; break;
    // v0.28: book clubs
    case 'book-clubs': page = <BookClubs />; break;
    case 'club-directory': page = <ClubDirectory />; break;
    case 'book-club-create': page = <BookClubCreate />; break;
    case 'book-club-detail': page = <BookClubDetail />; break;
    case 'session-create': page = <SessionCreate />; break;
    case 'session-detail': page = <SessionDetail />; break;
    case 'join-club': page = <JoinClub />; break;
    case 'dashboard':
    default:
      page = <Dashboard onOpenBook={openBook} />;
  }

  // Loader preview (three.js-motion experiment): add ?loaderPreview=1 to any
  // signed-in page to see the Oracle's long-wait screen with your own shelf,
  // without calling the Oracle. ?spreadAfter=2000 shortens the 8 s wait
  // before the cards appear. Nothing is sent anywhere; it is just the loader.
  if (route.params?.loaderPreview) {
    page = (
      <BookLoader
        text={t('oracle.askAsking')}
        spread
        spreadAfterMs={Number(route.params.spreadAfter) || undefined}
      />
    );
  }

  return (
    <div className="app">
      <Nav onPreviewBook={setPreviewBook} />
      <div className="container">
        {page}
      </div>
      <Footer />
      <Toast />
    </div>
  );
}
