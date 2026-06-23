import { useRouter } from '../lib/RouterContext';
import { OracleQuotaBadge } from '../components/OracleQuotaBadge';
import { useT } from '../lib/I18nContext';

export default function OracleFork() {
  const { go } = useRouter();
  const t = useT();

  return (
    <>
      <div className="breadcrumb">
        <a onClick={() => go('dashboard')}>{t('oracle.breadcrumbDashboard')}</a> · {t('oracle.forkEyebrow')}
      </div>
      <div className="page-header">
        <div className="page-eyebrow">{t('oracle.forkEyebrow')}</div>
        <h1 className="page-title">{t('oracle.forkTitle', { accent: <span className="accent">{t('oracle.forkTitleAccent')}</span> })}</h1>
        <p className="page-subtitle">
          {t('oracle.forkSubtitle')}
          {' '}<OracleQuotaBadge style={{ verticalAlign: 'middle' }} />
        </p>
      </div>
      <div className="oracle-fork">
        <div className="cta-card" onClick={() => go('oracle-categories')}>
          <div className="cta-ornament">❦</div>
          <h2 className="cta-title">{t('oracle.forkByGenres')} <span className="accent">{t('oracle.forkByGenresAccent')}</span></h2>
          <p className="cta-desc">{t('oracle.forkByGenresDesc')}</p>
        </div>
        <div className="cta-card" onClick={() => go('oracle-similar')}>
          <div className="cta-ornament">✦</div>
          <h2 className="cta-title">{t('oracle.forkBySimilar')} <span className="accent">{t('oracle.forkBySimilarAccent')}</span></h2>
          <p className="cta-desc">{t('oracle.forkBySimilarDesc')}</p>
        </div>
      </div>
    </>
  );
}
