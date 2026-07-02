import { useRouter } from '../lib/RouterContext';
import { OracleQuotaBadge } from '../components/OracleQuotaBadge';
import { useT, useTNode } from '../lib/I18nContext';

export default function OracleFork() {
  const { go } = useRouter();
  const t = useT();
  const tNode = useTNode();

  return (
    <>
      <div className="breadcrumb">
        <a onClick={() => go('dashboard')}>{t('oracle.breadcrumbDashboard')}</a> · {t('oracle.forkEyebrow')}
      </div>
      <div className="page-head">
        <div className="page-head__eyebrow">{t('oracle.forkEyebrow')}</div>
        <h1 className="page-head__title">{tNode('oracle.forkPageTitle')}</h1>
        <p className="page-head__lead">
          {t('oracle.forkSubtitle')}
          {' '}<OracleQuotaBadge />
        </p>
      </div>
      <div className="oracle-fork-grid">
        <button className="oracle-fork-card" onClick={() => go('oracle-categories')}>
          <h2 className="oracle-fork-card__label">❦ {tNode('oracle.forkByGenres')}</h2>
          <p className="oracle-fork-card__sub">{t('oracle.forkByGenresDesc')}</p>
        </button>
        <button className="oracle-fork-card" onClick={() => go('oracle-similar')}>
          <h2 className="oracle-fork-card__label">✦ {tNode('oracle.forkBySimilar')}</h2>
          <p className="oracle-fork-card__sub">{t('oracle.forkBySimilarDesc')}</p>
        </button>
      </div>
    </>
  );
}
