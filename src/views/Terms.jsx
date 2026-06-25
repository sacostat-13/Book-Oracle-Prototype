// src/views/Terms.jsx — v0.37
import { useRouter } from '../lib/RouterContext';
import { useT } from '../lib/I18nContext';

function S({ title, children }) {
  return (
    <div style={{ marginBottom: '2rem' }}>
      <h2 style={{ fontFamily: "'Cormorant Garamond', serif", fontStyle: 'italic', fontSize: '1.35rem', color: 'var(--paper)', marginBottom: '0.75rem' }}>{title}</h2>
      <div style={{ color: 'var(--paper-aged)', lineHeight: 1.75, fontSize: '0.95rem' }}>{children}</div>
    </div>
  );
}
function P({ children }) { return <p style={{ margin: '0 0 0.75rem' }}>{children}</p>; }

export default function Terms() {
  const { go } = useRouter();
  const t = useT();
  return (
    <>
      <div className="breadcrumb"><a onClick={() => go('about')}>{t('nav.about')}</a> · Terms of Service</div>
      <div className="page-header">
        <div className="page-eyebrow">Legal</div>
        <h1 className="page-title">Terms of <span className="accent">Service</span></h1>
        <p style={{ color: 'var(--paper-aged)', fontSize: '0.85rem', marginTop: '0.5rem' }}>Last updated: June 25, 2026</p>
      </div>
      <div style={{ maxWidth: '680px' }}>
        <S title="Acceptance">
          <P>By creating an account or using Book Oracle (readingoracle.com), you agree to these Terms. If you do not agree, please do not use the service. These terms form a binding agreement between you and the operator of Book Oracle, an individual developer based in Costa Rica.</P>
        </S>
        <S title="The service">
          <P>Book Oracle is a personal reading companion providing library tracking, AI-powered book recommendations, reading plans, and book clubs. We provide the service on a best-effort basis and reserve the right to modify or discontinue any part of it with reasonable notice via in-app release notes.</P>
        </S>
        <S title="Your account">
          <P>You must sign in with a valid Google account and be at least 13 years old. One account per person — creating multiple accounts to circumvent quota limits or other restrictions may result in account termination.</P>
        </S>
        <S title="Acceptable use">
          <P>You agree not to: circumvent AI quotas via multiple accounts; reverse engineer or scrape the service at scale; use the service unlawfully; post harmful content in clubs; or attempt to access other users' data.</P>
        </S>
        <S title="Your content">
          <P>Your reading data belongs to you. You grant us a limited license to store and process it solely to provide the service. Content you share in book clubs is visible to other club members and is your responsibility. You can delete your account and all content at any time from Profile.</P>
        </S>
        <S title="AI features and accuracy">
          <P>Oracle recommendations, reading plans, and categorizations are AI-generated and provided for entertainment and discovery. They may contain inaccuracies. We do not guarantee accuracy, completeness, or suitability of AI-generated content.</P>
        </S>
        <S title="Subscriptions and payment">
          <P>The Pro plan is billed monthly at $5 USD via Paddle, who acts as Merchant of Record. Subscriptions renew automatically until cancelled. You can cancel from Profile at any time; access continues through the current billing period. We reserve the right to change pricing with 30 days notice to active subscribers.</P>
        </S>
        <S title="Intellectual property">
          <P>The Book Oracle application, design, and original content are owned by the operator. Book metadata is sourced from third-party catalogs and subject to their respective licenses.</P>
        </S>
        <S title="Disclaimer and limitation of liability">
          <P>Book Oracle is provided "as is" without warranties. We are not responsible for data loss, service interruptions, or inaccuracies in AI-generated content. Our total liability for any claim shall not exceed the amount you paid us in the preceding 12 months.</P>
        </S>
        <S title="Governing law">
          <P>These terms are governed by the laws of Costa Rica. Questions: support@readingoracle.com</P>
        </S>
      </div>
    </>
  );
}
