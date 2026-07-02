// src/views/Terms.jsx — v0.37
import { useRouter } from '../lib/RouterContext';
import { useT, useTNode, useI18n } from '../lib/I18nContext';

function S({ title, children }) {
  return (
    <div className="legal-section">
      <h2 className="legal-section__title">{title}</h2>
      <div className="legal-section__body">{children}</div>
    </div>
  );
}
function P({ children }) { return <p >{children}</p>; }

export default function Terms() {
  const { go } = useRouter();
  const t = useT();
  const tNode = useTNode();

  return (
    <>
      <div className="breadcrumb"><a onClick={() => go('about')}>{t('nav.about')}</a> · {t('terms.breadcrumbs')}</div>
      <div className="page-header">
        <div className="page-eyebrow">Legal</div>
        <h1 className="page-head__title">{tNode('terms.title')}</h1>

        <p className="page-head__lead">{t('terms.lastUpdated')}</p>
      </div>
      <div className="legal-page">
        <S title={t('terms.acceptanceTitle')}>
          <p>{tNode('terms.acceptancePara1')}</p>
        </S>
        <S title={t('terms.theServiceTitle')}>
          <p>{tNode('terms.theServicePara1')}</p>
        </S>
        <S title={t('terms.yourAccountTitle')}>
          <p>{tNode('terms.yourAccountPara1')}</p>
        </S>
        <S title={t('terms.acceptableUseTitle')}>
          <p>{tNode('terms.acceptableUsePara1')}</p>
        </S>
        <S title={t('terms.yourContentTitle')}>
          <p>{tNode('terms.yourContentPara1')}</p>
        </S>
        <S title={t('terms.aiFeaturesAndAccuracyTitle')}>
          <p>{tNode('terms.aiFeaturesAndAccuracyPara1')}</p>
        </S>
        <S title={t('terms.subscriptionsAndPaymentTitle')}>
          <p>{tNode('terms.subscriptionsAndPaymentPara1')}</p>
        </S>
        <S title={t('terms.intellectualPropertyTitle')}>
          <p>{tNode('terms.intellectualPropertyPara1')}</p>
        </S>
        <S title={t('terms.disclaimerAndLimitationOfLiabilityTitle')}>
          <p>{tNode('terms.disclaimerAndLimitationOfLiabilityPara1')}</p>
        </S>
        <S title={t('terms.governingLawTitle')}>
          <p>{tNode('terms.governingLawPara1')}</p>
        </S>

      </div>
    </>
  );
}
