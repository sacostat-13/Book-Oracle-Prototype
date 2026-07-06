import { useState, useRef, useEffect } from 'react';
import { bookKey, openBookTab } from './lib/bookHelpers';
import { useAuth } from './lib/AuthContext';
import { useData } from './lib/DataContext';
import { useRouter } from './lib/RouterContext';
import { useT, useTNode } from './lib/I18nContext';
import { useDocumentMeta } from './lib/useDocumentMeta';

import Nav from './components/Nav';
import CornerBrackets from './components/CornerBrackets';
import BookLoader from './components/BookLoader';
import Toast from './components/Toast';

import Onboarding from './views/Onboarding';
import Dashboard from './views/Dashboard';
import Wishlist from './views/Wishlist';
import Library from './views/Library';
import ReadNext from './views/ReadNext';
import CurrentlyReading from './views/CurrentlyReading';
import Profile from './views/Profile';
import FriendProfile from './views/FriendProfile';
import Friends from './views/Friends';
import About from './views/About';
import Privacy from './views/Privacy';
import Terms from './views/Terms';
import Refund from './views/Refund';
import NotFound from './views/NotFound';
import SitemapPage from './views/SitemapPage';
import OracleFork from './views/OracleFork';
import OracleCategories from './views/OracleCategories';
import OracleSimilar from './views/OracleSimilar';
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
import BookClubCreate from './views/BookClubCreate';
import BookClubDetail from './views/BookClubDetail';
import SessionCreate from './views/SessionCreate';
import SessionDetail from './views/SessionDetail';
import JoinClub from './views/JoinClub';
import Footer from './components/Footer';

function SignInGate() {
  const { signInWithGoogle, signInWithApple, signInWithFacebook, signInWithEmail } = useAuth();
  const t = useT();
  const tNode = useTNode();
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState(null);
  const [error, setError] = useState(null);

  async function handleEmailSubmit(e) {
    e.preventDefault();
    if (!email.trim() || sending) return;
    setSending(true);
    setError(null);
    const { error: err } = await signInWithEmail(email.trim());
    setSending(false);
    if (err) setError(t('signIn.emailErrorGeneric'));
    else setSentTo(email.trim());
  }

  return (
    <div className="onboarding-wrap">
      <div className="onboarding-card">
        <CornerBrackets />
        <div className="onb-eyebrow">{t('signIn.eyebrow')}</div>
        <h1 className="onb-title">
          {tNode('app.brand', { wishlist: <span className="accent">{t('app.brandAccent')}</span> })}
        </h1>
        <p className="onb-desc">{t('signIn.desc')}</p>

        {sentTo ? (
          <div className="sign-in-confirm">
            <div className="pf-account-card__section-title">{t('signIn.checkInboxTitle')}</div>
            <p className="onb-desc">{t('signIn.checkInboxText', { email: sentTo })}</p>
            <button className="btn-text" onClick={() => setSentTo(null)}>
              {t('signIn.useAnotherEmail')}
            </button>
          </div>
        ) : (
          <>
            <div className="sso-stack">
              <button className="btn-secondary btn--block" onClick={signInWithGoogle}>
                {t('signIn.continueGoogle')}
              </button>
              {/* <button className="btn-secondary btn--block" onClick={signInWithApple}>
                {t('signIn.continueApple')}
              </button>
              <button className="btn-secondary btn--block" onClick={signInWithFacebook}>
                {t('signIn.continueFacebook')}
              </button> */}
            </div>

            <div className="sso-divider"><span>{t('signIn.orDivider')}</span></div>

            <form className="sso-email-form" onSubmit={handleEmailSubmit}>
              <input
                type="email"
                required
                className="input"
                placeholder={t('signIn.emailPlaceholder')}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <button type="submit" className="btn-primary btn--block" disabled={sending || !email.trim()}>
                {sending ? t('signIn.sendingLink') : t('signIn.sendLink')}
              </button>
              {error && <div className="pf-error">{error}</div>}
            </form>
          </>
        )}
        <div className="sign-in-legal">
          <a className="btn btn-text" href="#privacy" target="_blank" rel="noopener noreferrer">{t('footer.privacy') || 'Privacy Policy'}</a>
          <span className="sign-in-legal__sep">·</span>
          <a className="btn btn-text" href="#terms" target="_blank" rel="noopener noreferrer">{t('footer.terms') || 'Terms of Service'}</a>
          <span className="sign-in-legal__sep">·</span>
          <a className="btn btn-text" href="#refund" target="_blank" rel="noopener noreferrer">{t('footer.refund') || 'Refund Policy'}</a>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const { state, loading } = useData();
  const { route } = useRouter();

  // v0.39: default <title>/description per static route. book-page and
  // series-page are deliberately excluded — those own their own title/meta
  // once their data resolves (BookPage.jsx / SeriesPage.jsx), and setting a
  // generic default here would race with and overwrite their effect since
  // child effects commit before parent effects in React.
  const ROUTE_META = {
    dashboard: { title: 'Dashboard — The Books Oracle', description: 'Your wishlist, library, and reading plans in one place.' },
    wishlist: { title: 'Wishlist — The Books Oracle' },
    library: { title: 'Library — The Books Oracle' },
    'read-next': { title: 'Read Next — The Books Oracle' },
    'currently-reading': { title: 'Currently Reading — The Books Oracle' },
    profile: { title: 'Profile — The Books Oracle' },
    about: { title: 'About — The Books Oracle', description: 'The Books Oracle — wishlist, library, reading plans and an Oracle that knows what you will love next.' },
    oracle: { title: 'Oracle — The Books Oracle' },
    'oracle-categories': { title: 'Explore by Genre — The Books Oracle' },
    'oracle-similar': { title: 'Find Similar Books — The Books Oracle' },
    'plan-create': { title: 'New Reading Plan — The Books Oracle' },
    'plan-list': { title: 'Reading Plans — The Books Oracle' },
    lists: { title: 'My Lists — The Books Oracle' },
    'book-clubs': { title: 'Book Clubs — The Books Oracle' },
    'book-club-create': { title: 'Start a Book Club — The Books Oracle' },
    privacy: { title: 'Privacy Policy — The Books Oracle' },
    terms: { title: 'Terms of Service — The Books Oracle' },
    refund: { title: 'Refund Policy — The Books Oracle' },
    sitemap: { title: 'Sitemap — The Books Oracle', description: 'A map of every section of The Books Oracle.' },
    'not-found': { title: "The Oracle can't see that far — The Books Oracle", noindex: true },
  };
  useDocumentMeta(ROUTE_META[route.name] || {});

  // v0.39: keep <link rel="canonical"> in sync with the current path, now that
  // paths are real routes instead of a hash. Always points at thebooksoracle.com
  // regardless of which domain/alias served the request, so .net/.org visitors
  // and any lingering readingoracle.com traffic canonicalize correctly.
  // Full per-route <title>/meta/OG tags are a separate, still-pending v0.39 task —
  // this only handles canonical for now.
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
  const { user, loading: authLoading } = useAuth();
  const t = useT();
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
    // Nav is always visible; Footer and Nav switch to guest mode for unauthenticated viewers.
    const legalViews = { privacy: Privacy, terms: Terms, refund: Refund, sitemap: SitemapPage, 'not-found': NotFound };
    if (legalViews[route.name]) {
      const View = legalViews[route.name];
      return (
        <div className="app">
          <Nav onPreviewBook={setPreviewBook} guestMode={!isAuthed} />
          <div className="container">
            <View />
          </div>
          <Footer guestMode={!isAuthed} />
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

  // No session → show the sign-in gate. Sign-in is required; there is no
  // longer a guest/offline bypass.
  // Don't wait on DataContext loading here — there's no user data to load yet.
  if (!user) {
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
  if (!state.onboarded) {
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
    case 'privacy': page = <Privacy />; break;
    case 'terms': page = <Terms />; break;
    case 'refund': page = <Refund />; break;
    case 'oracle': page = <OracleFork />; break;
    case 'oracle-categories': page = <OracleCategories onOpenBook={openBook} />; break;
    case 'oracle-similar': page = <OracleSimilar onOpenBook={openBook} />; break;
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
    </div>
  );
}
