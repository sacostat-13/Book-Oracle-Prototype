// src/views/Refund.jsx — v0.37
import { useRouter } from '../lib/RouterContext';
import { useT } from '../lib/I18nContext';

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
  return (
    <>
      <div className="breadcrumb"><a onClick={() => go('about')}>{t('nav.about')}</a> · Refund Policy</div>
      <div className="page-header">
        <div className="page-eyebrow">Legal</div>
        <h1 className="page-title">Refund <span className="accent">Policy</span></h1>
        <p className="legal-updated">Last updated: June 25, 2026</p>
      </div>
      <div className="legal-page">
        <S title="Our approach">
          <P>We want you to be happy with The Books Oracle Pro. If you subscribed and feel it isn't right for you, we will make it right.</P>
        </S>
        <S title="14-day money-back guarantee">
          <P>If you subscribe to The Books Oracle Pro and are not satisfied for any reason, you can request a full refund within 14 days of your initial purchase — no questions asked.</P>
          <P>Email support@thebooksoracle.com with subject "Refund request" and the email address on your account. We will process the refund within 5 business days.</P>
        </S>
        <S title="Renewals">
          <P>Monthly renewals are not automatically refundable after they are charged. Cancel before the renewal date from your Profile page to avoid the next charge. If a renewal charge occurred due to a technical error on our part, contact us within 7 days for a full refund.</P>
        </S>
        <S title="Service outages">
          <P>If The Books Oracle experiences a significant outage affecting AI features for more than 48 consecutive hours, subscribers may request a prorated credit or refund for the affected period.</P>
        </S>
        <S title="How refunds are processed">
          <P>Payments are processed by Paddle. Refunds return to the original payment method and typically take 5–10 business days to appear. After a refund, your subscription downgrades to the free tier. Your reading data is retained.</P>
        </S>
        <S title="Exceptions">
          <P>We reserve the right to decline refund requests in cases of clear abuse, such as repeatedly subscribing and refunding or using multiple accounts to circumvent limits.</P>
        </S>
        <S title="Contact">
          <P>For refunds or billing questions: support@thebooksoracle.com — we typically respond within 1–2 business days.</P>
        </S>
      </div>
    </>
  );
}
