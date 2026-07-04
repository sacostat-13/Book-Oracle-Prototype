import { useState, useRef } from 'react';
import { useData } from '../lib/DataContext';
import { useRouter } from '../lib/RouterContext';
import { useT, useTNode } from '../lib/I18nContext';
import { parseGoodreadsCSV } from '../lib/goodreadsImport';
import CornerBrackets from '../components/CornerBrackets';
import { findBookByTitle } from '../lib/bookHelpers';

// v0.38: fixed set of mood/intent chips for the "what are you looking for right now" step.
// Multi-select, up to MOOD_MAX. IDs are stable — used as keys in profile.currentMood and in i18n lookups.
const MOODS = ['comfort', 'challenge', 'escapism', 'mind-bending', 'character-driven', 'atmospheric', 'fast-paced', 'short-read'];
const MOOD_MAX = 3;
const GENRE_MAX = 5;

export default function Onboarding() {
  const { state, setProfile, setOnboarded, importGoodreads, showToast } = useData();
  const { go } = useRouter();
  const t = useT();
  const tNode = useTNode();
  const [step, setStep] = useState(1);
  const [readingLevel, setReadingLevel] = useState(null);
  const [favoriteGenres, setFavoriteGenres] = useState([]);
  const [currentMood, setCurrentMood] = useState([]);
  const [goal, setGoal] = useState(null);
  const [goodreadsBooks, setGoodreadsBooks] = useState([]);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef(null);

  const TOTAL_STEPS = 5;

  const LEVELS = [1, 2, 3, 4, 5].map((v) => ({
    v,
    title: t(`onboarding.levels.${v}.title`),
    sub: t(`onboarding.levels.${v}.sub`),
  }));

  const GOALS = ['level-up', 'explore', 'random'].map((v) => ({
    v,
    title: t(`onboarding.goals.${v}.title`),
    sub: t(`onboarding.goals.${v}.sub`),
  }));

  const MOOD_CHOICES = MOODS.map((id) => ({
    id,
    title: t(`onboarding.moods.${id}.title`),
    sub: t(`onboarding.moods.${id}.sub`),
  }));

  const genreOptions = (state.genres || []).slice().sort((a, b) => a.name.localeCompare(b.name));

  function toggleGenre(name) {
    setFavoriteGenres((cur) => {
      if (cur.includes(name)) return cur.filter((g) => g !== name);
      if (cur.length >= GENRE_MAX) return cur;
      return [...cur, name];
    });
  }

  function toggleMood(id) {
    setCurrentMood((cur) => {
      if (cur.includes(id)) return cur.filter((m) => m !== id);
      if (cur.length >= MOOD_MAX) return cur;
      return [...cur, id];
    });
  }

  async function handleFile(file) {
    try {
      const text = await file.text();
      const books = parseGoodreadsCSV(text);
      if (books.length === 0) {
        showToast(t('library.goodreadsHelp'), true);
        return;
      }
      setGoodreadsBooks(books);
      showToast(t('bulkImport.added', { count: books.length, target: t('library.targetLibrary') }));
    } catch {
      showToast(t('library.goodreadsHelp'), true);
    }
  }

  async function finish() {
    setProfile({ readingLevel, goal, favoriteGenres, currentMood, goodreadsImported: goodreadsBooks.length > 0 });
    setOnboarded(true);
    if (goodreadsBooks.length > 0) {
      const enriched = goodreadsBooks.map((gb) => {
        const match = findBookByTitle(gb.t);
        return match ? { ...match, ...gb } : { ...gb, g: 'Imported' };
      });
      await importGoodreads(enriched);
    }
    setTimeout(() => go('dashboard'), 50);
  }

  return (
    <div className="onboarding-wrap">
      <div className="onboarding-card onboarding-card--wide">
        <CornerBrackets />
        <div className="onb-steps">
          {Array.from({ length: TOTAL_STEPS }, (_, i) => i + 1).map((n) => (
            <div key={n} className={`onb-step-dot ${step === n ? 'active' : step > n ? 'done' : ''}`}></div>
          ))}
        </div>

        {step === 1 && (
          <>
            <div className="onb-eyebrow">{t('onboarding.step1Eyebrow')}</div>
            <h1 className="onb-title">{t('onboarding.step1Title')}</h1>
            <p className="onb-desc">{t('onboarding.step1Desc')}</p>
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
              <button className="btn-primary" disabled={readingLevel == null} onClick={() => setStep(2)}>
                {t('onboarding.continue')}
              </button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <div className="onb-eyebrow">{t('onboarding.step2Eyebrow')}</div>
            <h1 className="onb-title">{t('onboarding.step2Title')}</h1>
            <p className="onb-desc">{t('onboarding.step2Desc')}</p>
            <div className="chip-grid">
              {genreOptions.map((g) => (
                <button
                  key={g.id}
                  className={`chip ${favoriteGenres.includes(g.name) ? 'selected' : ''}`}
                  disabled={!favoriteGenres.includes(g.name) && favoriteGenres.length >= GENRE_MAX}
                  onClick={() => toggleGenre(g.name)}
                >
                  {g.name}
                </button>
              ))}
            </div>
            <p className="onb-hint">{t('onboarding.genreCount', { count: favoriteGenres.length, max: GENRE_MAX })}</p>
            <div className="onb-actions">
              <button className="btn-secondary" onClick={() => setStep(1)}>{t('onboarding.back')}</button>
              <button className="btn-primary" onClick={() => setStep(3)}>{t('onboarding.continue')}</button>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <div className="onb-eyebrow">{t('onboarding.step3Eyebrow')}</div>
            <h1 className="onb-title">{t('onboarding.step3Title')}</h1>
            <p className="onb-desc">{t('onboarding.step3Desc')}</p>
            <div className="choice-grid">
              {MOOD_CHOICES.map((m) => (
                <button
                  key={m.id}
                  className={`choice ${currentMood.includes(m.id) ? 'selected' : ''}`}
                  disabled={!currentMood.includes(m.id) && currentMood.length >= MOOD_MAX}
                  onClick={() => toggleMood(m.id)}
                >
                  <div className="choice-title">{m.title}</div>
                  <div className="choice-sub">{m.sub}</div>
                </button>
              ))}
            </div>
            <div className="onb-actions">
              <button className="btn-secondary" onClick={() => setStep(2)}>{t('onboarding.back')}</button>
              <button className="btn-primary" onClick={() => setStep(4)}>{t('onboarding.continue')}</button>
            </div>
          </>
        )}

        {step === 4 && (
          <>
            <div className="onb-eyebrow">{t('onboarding.step4Eyebrow')}</div>
            <h1 className="onb-title">{t('onboarding.step4Title')}</h1>
            <p className="onb-desc">{t('onboarding.step4Desc')}</p>

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
                className="sr-only"
                accept=".csv,text/csv"
                onChange={(e) => { const file = e.target.files[0]; if (file) handleFile(file); }}
              />
              <div className="upload-icon">📚</div>
              <div className="upload-text">
                {goodreadsBooks.length > 0
                  ? <><strong className="lv-hl">{goodreadsBooks.length}</strong> {t('onboarding.uploadLoaded', { count: '' }).trim()}</>
                  : t('onboarding.uploadDrop')}
              </div>
              <div className="upload-sub">
                {goodreadsBooks.length > 0 ? t('onboarding.uploadReplace') : t('onboarding.uploadClickToChoose')}
              </div>
            </div>
            <div className="upload-help">
              <strong>{t('onboarding.uploadHowTo')}</strong> {t('library.goodreadsHelp')}<br />
              {tNode('onboarding.uploadNoFile', {
                link: <a href="#" onClick={(e) => { e.preventDefault(); setStep(5); }}>{t('onboarding.skipStep')}</a>
              })}
            </div>

            <div className="onb-actions">
              <button className="btn-secondary" onClick={() => setStep(3)}>{t('onboarding.back')}</button>
              <button className="btn-primary" onClick={() => setStep(5)}>{t('onboarding.continue')}</button>
            </div>
          </>
        )}

        {step === 5 && (
          <>
            <div className="onb-eyebrow">{t('onboarding.step5Eyebrow')}</div>
            <h1 className="onb-title">{t('onboarding.step5Title')}</h1>
            <p className="onb-desc">{t('onboarding.step5Desc')}</p>
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
              <button className="btn-secondary" onClick={() => setStep(4)}>{t('onboarding.back')}</button>
              <button className="btn-primary" disabled={goal == null} onClick={finish}>
                {t('onboarding.enterLibrary')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
