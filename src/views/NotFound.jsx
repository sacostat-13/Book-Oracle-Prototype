import { useRouter } from '../lib/RouterContext';
import { useT } from '../lib/I18nContext';
import { useDocumentMeta } from '../lib/useDocumentMeta';
import CornerBrackets from '../components/CornerBrackets';

// A closed, weeping eye — the Oracle, unable to see this particular path.
const IconClosedEye = () => (
  <svg width="56" height="56" viewBox="0 0 64 64" fill="none" aria-hidden>
    <path
      d="M6 32C6 32 18 14 32 14C46 14 58 32 58 32C58 32 46 50 32 50C18 50 6 32 6 32Z"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    />
    <path d="M14 32C14 32 21 25 32 25C43 25 50 32 50 32" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.5" />
    <line x1="10" y1="14" x2="54" y2="50" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <path d="M32 38 L30 46 M32 38 L34 46" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />
  </svg>
);

export default function NotFound() {
  const { route, go } = useRouter();
  const t = useT();

  useDocumentMeta({
    title: t('notFound.title') || "The Oracle can't see that far — The Books Oracle",
    noindex: true,
  });

  return (
    <div className="onboarding-wrap onboarding-wrap--nested">
      <div className="onboarding-card onboarding-card--centered">
        <CornerBrackets />
        <div className="onb-eyebrow">{t('notFound.eyebrow') || '404 · Off the map'}</div>
        <div className="not-found__icon">
          <IconClosedEye />
        </div>
        <h1 className="onb-title onb-title--centered">
          {t('notFound.title') || "The Oracle can't see where you're going."}
        </h1>
        <p className="onb-desc onb-desc--centered">
          {t('notFound.desc') || "This path leads nowhere the Oracle can find. The page may have moved, or never existed at all."}
        </p>
        <div className="onb-actions onb-actions--centered">
          <button className="btn-primary" onClick={() => go('dashboard')}>
            {t('notFound.cta') || 'Return to the library ❦'}
          </button>
        </div>
      </div>
    </div>
  );
}
