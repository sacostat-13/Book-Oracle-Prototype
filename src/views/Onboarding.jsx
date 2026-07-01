import { useState, useRef } from 'react';
import { useData } from '../lib/DataContext';
import { useRouter } from '../lib/RouterContext';
import { useT } from '../lib/I18nContext';
import { parseGoodreadsCSV } from '../lib/goodreadsImport';
import { findBookByTitle } from '../lib/bookHelpers';

export default function Onboarding() {
  const { setProfile, setOnboarded, importGoodreads, showToast } = useData();
  const { go } = useRouter();
  const t = useT();
  const [step, setStep] = useState(1);
  const [readingLevel, setReadingLevel] = useState(null);
  const [goal, setGoal] = useState(null);
  const [goodreadsBooks, setGoodreadsBooks] = useState([]);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef(null);

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
    setProfile({ readingLevel, goal, goodreadsImported: goodreadsBooks.length > 0 });
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
      <div className="onboarding-card">
        <div className="progress">
          <div className={`progress-dot ${step === 1 ? 'active' : step > 1 ? 'done' : ''}`}></div>
          <div className={`progress-dot ${step === 2 ? 'active' : step > 2 ? 'done' : ''}`}></div>
          <div className={`progress-dot ${step === 3 ? 'active' : ''}`}></div>
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
              <button className="btn" disabled={readingLevel == null} onClick={() => setStep(2)}>
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
              {t('onboarding.uploadNoFile', {
                link: <a href="#" onClick={(e) => { e.preventDefault(); setStep(3); }}>{t('onboarding.skipStep')}</a>
              })}
            </div>

            <div className="onb-actions">
              <button className="btn btn-secondary" onClick={() => setStep(1)}>{t('onboarding.back')}</button>
              <button className="btn" onClick={() => setStep(3)}>{t('onboarding.continue')}</button>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <div className="onb-eyebrow">{t('onboarding.step3Eyebrow')}</div>
            <h1 className="onb-title">{t('onboarding.step3Title')}</h1>
            <p className="onb-desc">{t('onboarding.step3Desc')}</p>
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
              <button className="btn btn-secondary" onClick={() => setStep(2)}>{t('onboarding.back')}</button>
              <button className="btn" disabled={goal == null} onClick={finish}>
                {t('onboarding.enterLibrary')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
