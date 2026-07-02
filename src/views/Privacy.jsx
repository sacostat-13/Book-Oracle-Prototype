// src/views/Privacy.jsx — v0.37
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

export default function Privacy() {
  const { go } = useRouter();
  const t = useT();
  const tNode = useTNode();

  return (
    <>
      <div className="breadcrumb"><a onClick={() => go('about')}>{t('nav.about')}</a> · {t('privacy.breadcrumbs')}</div>
      <div className="page-header">
        <div className="page-eyebrow">Legal</div>
        <h1 className="page-head__title">{tNode('privacy.title')}</h1>
        <p className="page-head__lead">{t('privacy.lastUpdated')}</p>
      </div>
      <div className="legal-page">
        <S title={t('privacy.whoWeAreTitle')}>
          <p>{tNode('privacy.whoWeArePara1')}</p>
        </S>
        <S title={tNode('privacy.whatDataWeCollectTitle')}>
          <p>{tNode('privacy.whatDataWeCollectPara1')}</p>
          <p> {tNode('privacy.whatDataWeCollectPara2')}</p>
          <p>{tNode('privacy.whatDataWeCollectPara3')}</p>
          <p> {tNode('privacy.whatDataWeCollectPara4')}</p >
          <p>{tNode('privacy.whatDataWeCollectPara5')}</p >
        </S>
        <S title={t('privacy.whatDataWeDoNotCollectTitle')}>
          <p>{tNode('privacy.whatDataWeDoNotCollectPara1')}</p>
        </S>
        <S title={t('privacy.howDoWeUseYourDataTitle')}>
          <p>{tNode('privacy.howDoWeUseYourDataPara1')}</p>
          <p>{tNode('privacy.howDoWeUseYourDataPara2')}</p>

        </S>
        <S title={t('privacy.dataStorageTitle')}>
          <p>{tNode('privacy.dataStoragePara1')}</p>
        </S>
        <S title={t('privacy.thirdPartyTitle')}>
          <p>{tNode('privacy.thirdPartyPara1')}</p>
        </S>
        <S title={t('privacy.yourRightsTitle')}>
          <p>{tNode('privacy.yourRightsPara1')}</p>
        </S>
        <S title={t('privacy.cookiesTitle')}>
          <p>{tNode('privacy.cookiesPara1')}</p>
        </S>
        <S title={t('privacy.childrenTitle')}>
          <p>{tNode('privacy.childrenPara1')}</p>
        </S>
        <S title={t('privacy.changesTitle')}>
          <p>{tNode('privacy.changesPara1')}</p>
        </S>
      </div>
    </>
  );
}
