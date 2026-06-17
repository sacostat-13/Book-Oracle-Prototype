import { useState, useRef } from 'react';
import { useAuth } from './lib/AuthContext';
import { useData } from './lib/DataContext';
import { useRouter } from './lib/RouterContext';
import { useT } from './lib/I18nContext';

import Nav from './components/Nav';
import Toast from './components/Toast';
import BookModal from './components/BookModal';

import Onboarding from './views/Onboarding';
import Dashboard from './views/Dashboard';
import Wishlist from './views/Wishlist';
import Library from './views/Library';
import ReadNext from './views/ReadNext';
import Profile from './views/Profile';
import About from './views/About';
import OracleFork from './views/OracleFork';
import OracleCategories from './views/OracleCategories';
import OracleSimilar from './views/OracleSimilar';
import PlanCreate from './views/PlanCreate';
import PlanView from './views/PlanView';
import BookPage from './views/BookPage';
import SeriesPage from './views/SeriesPage';

function SignInGate({ onGuest }) {
  const { signInWithGoogle } = useAuth();
  const t = useT();
  return (
    <div className="onboarding-wrap">
      <div className="onboarding-card" style={{ maxWidth: 520 }}>
        <div className="onb-eyebrow">{t('signIn.eyebrow')}</div>
        <h1 className="onb-title">
          {t('app.brand', { wishlist: <span className="accent">{t('app.brandAccent')}</span> })}
        </h1>
        <p className="onb-desc">{t('signIn.desc')}</p>
        <div className="onb-actions">
          <div></div>
          <button className="btn" onClick={signInWithGoogle}>
            {t('signIn.continueGoogle')}
          </button>
        </div>
        <p style={{ marginTop: '1.5rem', color: 'var(--paper-aged)', opacity: 0.6, fontSize: '0.85rem' }}>
          {t('signIn.guestPrompt', {
            link: (
              <a href="#" onClick={(e) => { e.preventDefault(); onGuest(); }}>
                {t('signIn.guestLink')}
              </a>
            ),
          })}
        </p>
      </div>
    </div>
  );
}

export default function App() {
  const { state, loading } = useData();
  const { route } = useRouter();
  const { user, loading: authLoading } = useAuth();
  const t = useT();
  const [modalBook, setModalBook] = useState(null);
  const [allowGuest, setAllowGuest] = useState(false);
  // previewBook holds a book from search results that isn't in the collection yet.
  // BookPage reads this ref when route.params.preview === 'true'.
  const previewBookRef = useRef(null);
  function setPreviewBook(book) { previewBookRef.current = book; }

  // Wait for auth to settle first — this is fast (local session check)
  if (authLoading) {
    return (
      <div className="app">
        <div className="loading" style={{ paddingTop: '6rem' }}>
          <div className="loading-spinner"></div>
          <div className="loading-text">{t('app.loading')}</div>
        </div>
      </div>
    );
  }

  // No session and not browsing as guest → show sign-in gate immediately.
  // Don't wait on DataContext loading here — there's no user data to load yet.
  if (!user && !allowGuest) {
    return (
      <div className="app">
        <SignInGate onGuest={() => setAllowGuest(true)} />
        <Toast />
      </div>
    );
  }

  // Authenticated (or guest) — now wait for DataContext to finish loading user data
  if (loading) {
    return (
      <div className="app">
        <div className="loading" style={{ paddingTop: '6rem' }}>
          <div className="loading-spinner"></div>
          <div className="loading-text">{t('app.loading')}</div>
        </div>
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
    setModalBook(book);
  }

  let page;
  switch (route.name) {
    case 'wishlist': page = <Wishlist onOpenBook={openBook} />; break;
    case 'library': page = <Library onOpenBook={openBook} />; break;
    case 'read-next': page = <ReadNext onOpenBook={openBook} />; break;
    case 'profile': page = <Profile />; break;
    case 'about': page = <About />; break;
    case 'oracle': page = <OracleFork />; break;
    case 'oracle-categories': page = <OracleCategories onOpenBook={openBook} />; break;
    case 'oracle-similar': page = <OracleSimilar onOpenBook={openBook} />; break;
    case 'plan-create': page = <PlanCreate />; break;
    case 'plan-view': page = <PlanView />; break;
    case 'book-page': page = <BookPage previewBookRef={previewBookRef} />; break;
    case 'series-page': page = <SeriesPage />; break;
    case 'dashboard':
    default:
      page = <Dashboard onOpenBook={openBook} />;
  }

  return (
    <div className="app">
      <Nav onPreviewBook={setPreviewBook} />
      <div className="container">{page}</div>
      {modalBook && (
        <BookModal
          book={modalBook}
          onClose={() => setModalBook(null)}
          onOpenBook={(b) => setModalBook(b)}
        />
      )}
      <Toast />
    </div>
  );
}
