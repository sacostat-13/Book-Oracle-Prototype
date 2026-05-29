import { useState } from 'react';
import { useAuth } from './lib/AuthContext';
import { useData } from './lib/DataContext';
import { useRouter } from './lib/RouterContext';

import Nav from './components/Nav';
import Toast from './components/Toast';
import BookModal from './components/BookModal';

import Onboarding from './views/Onboarding';
import Dashboard from './views/Dashboard';
import Wishlist from './views/Wishlist';
import Library from './views/Library';
import ReadNext from './views/ReadNext';
import Profile from './views/Profile';
import OracleFork from './views/OracleFork';
import OracleCategories from './views/OracleCategories';
import OracleSimilar from './views/OracleSimilar';
import PlanCreate from './views/PlanCreate';
import PlanView from './views/PlanView';

function SignInGate({ children }) {
  const { user, loading, signInWithGoogle } = useAuth();
  if (loading) return null;
  if (!user) {
    return (
      <div className="onboarding-wrap">
        <div className="onboarding-card" style={{ maxWidth: 520 }}>
          <div className="onb-eyebrow">Welcome</div>
          <h1 className="onb-title">The Wishlist <span className="accent">Oracle</span></h1>
          <p className="onb-desc">
            Sign in to keep your library, wishlist, and reading plans synced across all your devices.
          </p>
          <div className="onb-actions">
            <div></div>
            <button className="btn" onClick={signInWithGoogle}>
              Continue with Google ❦
            </button>
          </div>
          <p style={{ marginTop: '1.5rem', color: 'var(--paper-aged)', opacity: 0.6, fontSize: '0.85rem' }}>
            Prefer to try it offline first? You can also{' '}
            <a href="#" onClick={(e) => { e.preventDefault(); children._setGuest?.(); }}>
              continue as guest
            </a>
            {' '}(your data will live in this browser only).
          </p>
        </div>
      </div>
    );
  }
  return children;
}

export default function App() {
  const { state, loading } = useData();
  const { route } = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [modalBook, setModalBook] = useState(null);
  const [allowGuest, setAllowGuest] = useState(false);

  if (authLoading || loading) {
    return (
      <div className="app">
        <div className="loading" style={{ paddingTop: '6rem' }}>
          <div className="loading-spinner"></div>
          <div className="loading-text">Opening the library…</div>
        </div>
      </div>
    );
  }

  // Sign-in gate, with a guest option
  if (!user && !allowGuest) {
    return (
      <div className="app">
        <SignInGate _setGuest={() => setAllowGuest(true)}>
          {/* placeholder; gate replaces children when no user */}
          <></>
        </SignInGate>
        <Toast />
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
    case 'read-next': page = <ReadNext />; break;
    case 'profile': page = <Profile />; break;
    case 'oracle': page = <OracleFork />; break;
    case 'oracle-categories': page = <OracleCategories onOpenBook={openBook} />; break;
    case 'oracle-similar': page = <OracleSimilar onOpenBook={openBook} />; break;
    case 'plan-create': page = <PlanCreate />; break;
    case 'plan-view': page = <PlanView />; break;
    case 'dashboard':
    default:
      page = <Dashboard onOpenBook={openBook} />;
  }

  return (
    <div className="app">
      <Nav />
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
