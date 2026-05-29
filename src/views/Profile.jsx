import { useRef } from 'react';
import { useData } from '../lib/DataContext';
import { useAuth } from '../lib/AuthContext';
import { useRouter } from '../lib/RouterContext';
import { parseGoodreadsCSV } from '../lib/goodreadsImport';
import { findBookByTitle } from '../lib/bookHelpers';

const LEVEL_NAMES = {
  1: 'Casual companion', 2: 'Steady reader', 3: 'Devoted reader',
  4: 'Literary appetite', 5: 'Voracious + experimental',
};
const GOAL_NAMES = {
  'level-up': 'Level up my reading',
  explore: 'Get into a new topic or genre',
  random: 'Just give me something to read',
};

export default function Profile() {
  const { state, resetAll, importGoodreads, showToast } = useData();
  const { user } = useAuth();
  const { go } = useRouter();
  const fileRef = useRef(null);

  async function handleReimport(file) {
    try {
      const text = await file.text();
      const books = parseGoodreadsCSV(text);
      if (books.length === 0) {
        showToast("Couldn't find any read books in that file.", true);
        return;
      }
      const enriched = books.map((gb) => {
        const match = findBookByTitle(gb.t);
        return match ? { ...match, ...gb } : { ...gb, g: 'Imported' };
      });
      await importGoodreads(enriched);
    } catch {
      showToast("Couldn't read that file.", true);
    }
  }

  return (
    <>
      <div className="breadcrumb">
        <a onClick={() => go('dashboard')}>Dashboard</a> · Profile
      </div>
      <div className="page-header">
        <div className="page-eyebrow">Profile</div>
        <h1 className="page-title">Your <span className="accent">reader</span> profile</h1>
      </div>

      <div className="onboarding-card" style={{ maxWidth: '720px' }}>
        {user && (
          <>
            <h2 style={{ fontFamily: "'Cormorant Garamond', serif", fontStyle: 'italic', marginBottom: '1rem', color: 'var(--paper)' }}>Signed in as</h2>
            <p style={{ color: 'var(--paper-aged)', marginBottom: '1rem' }}>
              {state.profile.displayName || user.email}
              <br />
              <span style={{ color: 'var(--gilt)', fontSize: '0.9rem' }}>Synced to your account · accessible from any device</span>
            </p>
          </>
        )}

        <h2 style={{ fontFamily: "'Cormorant Garamond', serif", fontStyle: 'italic', margin: user ? '1.5rem 0 1rem' : '0 0 1rem', color: 'var(--paper)' }}>
          Reading level
        </h2>
        <p style={{ color: 'var(--paper-aged)', marginBottom: '1rem' }}>
          {LEVEL_NAMES[state.profile.readingLevel] || 'Not set'}
        </p>

        <h2 style={{ fontFamily: "'Cormorant Garamond', serif", fontStyle: 'italic', margin: '1.5rem 0 1rem', color: 'var(--paper)' }}>Goal</h2>
        <p style={{ color: 'var(--paper-aged)', marginBottom: '1rem' }}>
          {GOAL_NAMES[state.profile.goal] || 'Not set'}
        </p>

        <h2 style={{ fontFamily: "'Cormorant Garamond', serif", fontStyle: 'italic', margin: '1.5rem 0 1rem', color: 'var(--paper)' }}>Library</h2>
        <p style={{ color: 'var(--paper-aged)', marginBottom: '1.5rem' }}>
          {state.library.length} books read · {state.readNext.length} books queued
          {state.profile.goodreadsImported && (
            <><br /><span style={{ color: 'var(--gilt)' }}>✓ Goodreads imported</span></>
          )}
        </p>

        <div style={{ marginTop: '1rem' }}>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="file-hidden"
            onChange={(e) => {
              const f = e.target.files[0];
              if (f) handleReimport(f);
            }}
          />
          <button className="btn btn-ghost" onClick={() => fileRef.current?.click()}>
            {state.profile.goodreadsImported ? 'Re-import Goodreads CSV' : 'Import Goodreads CSV'}
          </button>
        </div>

        <div style={{ borderTop: '1px solid rgba(176, 140, 63, 0.2)', paddingTop: '1.5rem', marginTop: '2rem' }}>
          <button
            className="btn btn-ghost"
            onClick={() => {
              if (confirm('This will erase your profile, library, queue, and reading plan. Continue?')) {
                resetAll();
                go('dashboard');
              }
            }}
          >
            Reset profile & start over
          </button>
        </div>
      </div>
    </>
  );
}
