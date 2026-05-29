import { useState, useRef } from 'react';
import { useData } from '../lib/DataContext';
import { useRouter } from '../lib/RouterContext';
import { parseGoodreadsCSV } from '../lib/goodreadsImport';
import { findBookByTitle } from '../lib/bookHelpers';

const LEVELS = [
  { v: 1, title: 'Casual companion', sub: "A book a month or two. I like a story that pulls me along — cozy fantasy, thrillers, page-turners." },
  { v: 2, title: 'Steady reader', sub: "A book or two a month. Open to most genres if the writing's good. Not afraid of a slow start." },
  { v: 3, title: 'Devoted reader', sub: "Reading is a major part of my life. I'll go anywhere a great book takes me — literary, weird, dark, demanding." },
  { v: 4, title: 'Literary appetite', sub: "I'll wrestle with Faulkner and Han Kang. Difficult prose is part of the pleasure." },
  { v: 5, title: 'Voracious + experimental', sub: "I want to be undone. Bring me the prose that breaks itself open — Donoso, Lispector, Cărtărescu." },
];
const GOALS = [
  { v: 'level-up', title: 'Level up my reading', sub: "Stretch me. Build a path that takes me from where I am to something harder, deeper, weirder." },
  { v: 'explore', title: 'Get into a new topic or genre', sub: "Introduce me to a category I haven't explored — Korean literature, folk horror, Latin American gothic — with a guided path." },
  { v: 'random', title: 'Just give me something to read', sub: "I'm not trying to grow. I want a good book each month, suited to my taste. Surprise me." },
];

export default function Onboarding() {
  const { setProfile, setOnboarded, importGoodreads, seedWishlistIfNeeded, showToast } = useData();
  const { go } = useRouter();
  const [step, setStep] = useState(1);
  const [readingLevel, setReadingLevel] = useState(null);
  const [goal, setGoal] = useState(null);
  const [goodreadsBooks, setGoodreadsBooks] = useState([]);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef(null);

  async function handleFile(file) {
    try {
      const text = await file.text();
      const books = parseGoodreadsCSV(text);
      if (books.length === 0) {
        showToast("Couldn't find any read books in that file. Make sure it's the Goodreads export CSV.", true);
        return;
      }
      setGoodreadsBooks(books);
      showToast(`Loaded ${books.length} books from your Goodreads library`);
    } catch {
      showToast("Couldn't read that file. Try downloading a fresh Goodreads export.", true);
    }
  }

  async function finish() {
    setProfile({ readingLevel, goal, goodreadsImported: goodreadsBooks.length > 0 });
    setOnboarded(true);

    if (goodreadsBooks.length > 0) {
      // enrich with catalog matches for genre/complexity tags
      const enriched = goodreadsBooks.map((gb) => {
        const match = findBookByTitle(gb.t);
        return match ? { ...match, ...gb } : { ...gb, g: 'Imported' };
      });
      await importGoodreads(enriched);
    }
    // Seed wishlist on next tick after onboarded flips true
    setTimeout(() => {
      seedWishlistIfNeeded();
      go('dashboard');
    }, 50);
  }

  return (
    <div className="onboarding-wrap">
      <div className="onboarding-card">
        <div className="progress">
          <div className={`progress-dot ${step === 1 ? 'active' : step > 1 ? 'done' : ''}`}></div>
          <div className={`progress-dot ${step === 2 ? 'active' : step > 2 ? 'done' : ''}`}></div>
          <div className={`progress-dot ${step === 3 ? 'active' : ''}`}></div>
        </div>

        {step === 1 && (
          <>
            <div className="onb-eyebrow">Step 1 of 3 · Reader profile</div>
            <h1 className="onb-title">What kind of reader are you, right now?</h1>
            <p className="onb-desc">No judgment, no pressure. This just helps us calibrate suggestions and reading plans to where you actually are.</p>
            <div className="choice-grid">
              {LEVELS.map((l) => (
                <button
                  key={l.v}
                  className={`choice ${readingLevel === l.v ? 'selected' : ''}`}
                  onClick={() => setReadingLevel(l.v)}
                >
                  <div className="choice-title">{l.title}</div>
                  <div className="choice-sub">{l.sub}</div>
                </button>
              ))}
            </div>
            <div className="onb-actions">
              <div></div>
              <button className="btn" disabled={readingLevel == null} onClick={() => setStep(2)}>
                Continue ❦
              </button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <div className="onb-eyebrow">Step 2 of 3 · Your shelves</div>
            <h1 className="onb-title">Bring your reading history with you.</h1>
            <p className="onb-desc">Export your Goodreads library and drop the CSV here. We'll fill your virtual library with what you've already read so suggestions can be smarter — and so the shelves don't start empty.</p>

            <div
              className={`upload-zone ${dragOver ? 'dragover' : ''}`}
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const file = e.dataTransfer.files[0];
                if (file) handleFile(file);
              }}
            >
              <input
                ref={fileRef}
                type="file"
                className="file-hidden"
                accept=".csv,text/csv"
                onChange={(e) => {
                  const file = e.target.files[0];
                  if (file) handleFile(file);
                }}
              />
              <div className="upload-icon">📚</div>
              <div className="upload-text">
                {goodreadsBooks.length > 0
                  ? <><strong style={{ color: 'var(--gilt)' }}>{goodreadsBooks.length}</strong> books loaded</>
                  : 'Drop your goodreads_library_export.csv here'}
              </div>
              <div className="upload-sub">
                {goodreadsBooks.length > 0 ? 'Tap to replace, or continue below' : 'or click to choose a file'}
              </div>
            </div>
            <div className="upload-help">
              <strong>How to export from Goodreads:</strong> Go to{' '}
              <a href="https://www.goodreads.com/review/import" target="_blank" rel="noreferrer">goodreads.com/review/import</a> → click "Export Library" → wait a moment → download the CSV.<br />
              Don't have one yet? You can{' '}
              <a href="#" onClick={(e) => { e.preventDefault(); setStep(3); }}>skip this step</a> and add books manually later.
            </div>

            <div className="onb-actions">
              <button className="btn btn-ghost" onClick={() => setStep(1)}>← Back</button>
              <button className="btn" onClick={() => setStep(3)}>Continue ❦</button>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <div className="onb-eyebrow">Step 3 of 3 · Your goal</div>
            <h1 className="onb-title">What are you hoping to get from this?</h1>
            <p className="onb-desc">This shapes the kind of reading plans we'll suggest. You can change it anytime in your profile.</p>
            <div className="choice-grid">
              {GOALS.map((g) => (
                <button
                  key={g.v}
                  className={`choice ${goal === g.v ? 'selected' : ''}`}
                  onClick={() => setGoal(g.v)}
                >
                  <div className="choice-title">{g.title}</div>
                  <div className="choice-sub">{g.sub}</div>
                </button>
              ))}
            </div>
            <div className="onb-actions">
              <button className="btn btn-ghost" onClick={() => setStep(2)}>← Back</button>
              <button className="btn" disabled={goal == null} onClick={finish}>
                Enter the library ❦
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
