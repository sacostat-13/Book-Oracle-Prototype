// src/views/Refund.jsx — v0.37
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

export default function Refund() {
  const { go } = useRouter();
  const t = useT();
  const tNode = useTNode();


  return (
    <>
      <div className="breadcrumb"><a onClick={() => go('about')}>{t('nav.about')}</a> · {t('refunds.breadcrumbs')}</div>
      <div className="page-header">
        <div className="page-eyebrow">Legal</div>
        <h1 className="page-head__title">{tNode('refunds.title')}</h1>
        <p className="page-head__lead">{t('refunds.lastUpdated')}</p>
      </div>
      <div className="legal-page">
        <S title={t('refunds.ourApproachTitle')}>
          <p>{tNode('refunds.ourApproachPara1')}</p>
        </S>
        <S title={t('refunds.day14MoneyBackGuaranteeTitle')}>
          <p>{tNode('refunds.day14MoneyBackGuaranteePara1')}</p>
          <p>{tNode('refunds.day14MoneyBackGuaranteePara2')}</p>
        </S>
        <S title={t('refunds.renewalsTitle')}>
          <p>{tNode('refunds.renewalsPara1')}</p>
        </S>
        <S title={t('refunds.serviceOutagesTitle')}>
          <p>{tNode('refunds.serviceOutagesPara1')}</p>
        </S>
        <S title={t('refunds.howRefundsAreProcessedTitle')}>
          <p>{tNode('refunds.howRefundsAreProcessedPara1')}</p>
          <p>{tNode('refunds.howRefundsAreProcessedPara2')}</p>

        </S>
        <S title={t('refunds.exceptionsTitle')}>
          <p>{tNode('refunds.exceptionsPara1')}</p>
        </S>
        <S title={t('refunds.contactTitle')}>
          <p>{tNode('refunds.contactPara1')}</p>
        </S>

      </div>
    </>
  );
}
