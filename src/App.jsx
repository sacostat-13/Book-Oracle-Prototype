import { useState, useRef, useEffect } from 'react';
import { bookKey, openBookTab } from './lib/bookHelpers';
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
import SignInGate from './components/SignInGate';

import Onboarding from './views/Onboarding';
import Dashboard from './views/Dashboard';
import Landing from './views/Landing';
import Wishlist from './views/Wishlist';
import Library from './views/Library';
import ReadNext from './views/ReadNext';
import CurrentlyReading from './views/CurrentlyReading';
import Profile from './views/Profile';
import FriendProfile from './views/FriendProfile';
import Friends from './views/Friends';
import About from './views/About';
import Changelog from './views/Changelog';
import Privacy from './views/Privacy';
import Terms from './views/Terms';
import Refund from './views/Refund';
import NotFound from './views/NotFound';
import SitemapPage from './views/SitemapPage';
import OracleFork from './views/OracleFork';
import OracleCategories from './views/OracleCategories';
import OracleSimilar from './views/OracleSimilar';
import OracleAsk from './views/OracleAsk';
import PlanCreate from './views/PlanCreate';
import PlanList from './views/PlanList';
import PlanView from './views/PlanView';
import BookPage from './views/BookPage';
import ListView from './views/ListView';
import Lists from './views/Lists';
import ListDetail from './views/ListDetail';
import SeriesPage from './views/SeriesPage';
// v0.28: book clubs
import BookClubs from './views/BookClubs';
import ClubDirectory from './views/ClubDirectory';
import BookClubCreate from './views/BookClubCreate';
import BookClubDetail from './views/BookClubDetail';
import SessionCreate from './views/SessionCreate';
import SessionDetail from './views/SessionDetail';
import JoinClub from './views/JoinClub';
import Footer from './components/Footer';

export default function App() {
  const { state, loading } = useData();
  const { route, go } = useRouter();
  const { user, loading: authLoading } = useAuth();
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
    'oracle-categories': { title: 'Explore by Genre — The Books Oracle' },
    'oracle-similar': { title: 'Find Similar Books — The Books Oracle' },
    'oracle-ask': { title: 'Ask the Oracle — The Books Oracle' },
    'plan-create': { title: 'New Reading Plan — The Books Oracle' },
    'plan-list': { title: 'Reading Plans — The Books Oracle' },
    lists: { title: 'My Lists — The Books Oracle' },
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
  useDocumentMeta(isLandingVisit ? {} : (ROUTE_META[route.name] || {}));

  // v0.39: keep <link rel="canonical"> in sync with the current path, now that
  // paths are real routes instead of a hash. Always points at thebooksoracle.com
  // regardless of which domain/alias served the request, so .net/.org visitors
  // and any lingering readingoracle.com traffic canonicalize correctly.
  useEffect(() => {
    const canonicalUrl = `https://thebooksoracle.com${window.location.pathname}${window.location.search}`;
    let link = document.querySelector('link[rel="canonical"]');
    if (!link) {
      link = document.createElement('link');
      link.setAttribute('rel', 'canonical');
      document.head.appendChild(link);
    }
    link.setAttribute('href', canonicalUrl);
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
  const previewBookRef = useRef(null);
  function setPreviewBook(book) { previewBookRef.current = book; }

  // ── Public routes — render immediately, no auth or data required ────────────
  // These pages read content from the URL snapshot and progressively enhance
  // with auth-dependent actions once the user is signed in and data is loaded.
  const PUBLIC_ROUTES = new Set(['book-page', 'list-view', 'plan-view', 'join-club', 'privacy', 'terms', 'refund', 'not-found', 'sitemap']);
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
    openBookTab(book, 'app');
  }

  let page;
  switch (route.name) {
    case 'wishlist': page = <Wishlist onOpenBook={openBook} />; break;
    case 'library': page = <Library onOpenBook={openBook} />; break;
    case 'read-next': page = <ReadNext onOpenBook={openBook} />; break;
    case 'currently-reading': page = <CurrentlyReading onOpenBook={openBook} />; break;
    case 'profile': page = <Profile />; break;
    case 'friend-profile': page = <FriendProfile />; break;
    case 'friends': page = <Friends />; break;
    case 'about': page = <About />; break;
    case 'changelog': page = <Changelog />; break;
    case 'privacy': page = <Privacy />; break;
    case 'terms': page = <Terms />; break;
    case 'refund': page = <Refund />; break;
    case 'oracle': page = <OracleFork />; break;
    case 'oracle-categories': page = <OracleCategories onOpenBook={openBook} />; break;
    case 'oracle-similar': page = <OracleSimilar onOpenBook={openBook} />; break;
    case 'oracle-ask': page = <OracleAsk onOpenBook={openBook} />; break;
    case 'plan-create': page = <PlanCreate />; break;
    case 'plan-list': page = <PlanList />; break;
    // 'plan-view' is handled earlier in the public-routes branch (it renders
    // for shared links without auth), so it never reaches this switch.
    case 'book-page': page = <BookPage previewBookRef={previewBookRef} />; break;
    case 'series-page': page = <SeriesPage />; break;
    case 'lists': page = <Lists />; break;
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

  return (
    <div className="app">
      <Nav onPreviewBook={setPreviewBook} />
      <div className="container">
        {page}
      </div>
      <Footer />
      <Toast />
      {/* v0.43: global action-share modal — fires after completions */}
      <ShareMomentModal />
    </div>
  );
}
