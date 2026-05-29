import { useData } from '../lib/DataContext';
import { useRouter } from '../lib/RouterContext';
import { useAuth } from '../lib/AuthContext';

export default function Nav() {
  const { state } = useData();
  const { route, go } = useRouter();
  const { user, signInWithGoogle, signOut } = useAuth();
  const wishCount = state.wishlist.length;

  return (
    <nav className="topnav">
      <div className="brand" onClick={() => go('dashboard')} role="button" tabIndex={0}>
        The <span className="accent">Wishlist</span> Oracle
      </div>
      <div className="nav-spacer"></div>
      <div className="nav-links">
        <button
          className={`nav-btn ${route.name === 'wishlist' ? 'active' : ''}`}
          onClick={() => go('wishlist')}
        >
          Wishlist {wishCount > 0 && <span className="nav-badge">{wishCount}</span>}
        </button>
        <button
          className={`nav-btn ${route.name === 'library' ? 'active' : ''}`}
          onClick={() => go('library')}
        >
          Library {state.library.length > 0 && <span className="nav-badge">{state.library.length}</span>}
        </button>
        <button
          className={`nav-btn ${route.name === 'read-next' ? 'active' : ''}`}
          onClick={() => go('read-next')}
        >
          Read Next {state.readNext.length > 0 && <span className="nav-badge">{state.readNext.length}</span>}
        </button>
        <button
          className={`nav-btn ${route.name === 'profile' ? 'active' : ''}`}
          onClick={() => go('profile')}
        >
          Profile
        </button>
        {user ? (
          <button className="nav-btn" onClick={signOut} title={user.email}>
            Sign out
          </button>
        ) : (
          <button className="nav-btn" onClick={signInWithGoogle}>
            Sign in
          </button>
        )}
      </div>
    </nav>
  );
}
