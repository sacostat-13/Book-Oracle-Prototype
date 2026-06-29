// src/views/Privacy.jsx — v0.37
import { useRouter } from '../lib/RouterContext';
import { useT } from '../lib/I18nContext';

function S({ title, children }) {
  return (
    <div style={{ marginBottom: '2rem' }}>
      <h2 style={{ fontFamily: 'var(--ro-font-display)', fontStyle: 'italic', fontSize: '1.35rem', color: 'var(--paper)', marginBottom: '0.75rem' }}>{title}</h2>
      <div style={{ color: 'var(--paper-aged)', lineHeight: 1.75, fontSize: '0.95rem' }}>{children}</div>
    </div>
  );
}
function P({ children }) { return <p style={{ margin: '0 0 0.75rem' }}>{children}</p>; }

export default function Privacy() {
  const { go } = useRouter();
  const t = useT();
  return (
    <>
      <div className="breadcrumb"><a onClick={() => go('about')}>{t('nav.about')}</a> · Privacy Policy</div>
      <div className="page-header">
        <div className="page-eyebrow">Legal</div>
        <h1 className="page-title">Privacy <span className="accent">Policy</span></h1>
        <p style={{ color: 'var(--paper-aged)', fontSize: '0.85rem', marginTop: '0.5rem' }}>Last updated: June 25, 2026</p>
      </div>
      <div style={{ maxWidth: '680px' }}>
        <S title="Who we are">
          <P>The The Books Oracle (accessible at thebooksoracle.com) is a personal reading companion application operated by an individual developer based in Costa Rica.</P>
          <P>For privacy-related questions: support@thebooksoracle.com</P>
        </S>
        <S title="What data we collect">
          <P><strong style={{ color: 'var(--paper)' }}>Account data.</strong> When you sign in with Google, we receive your name, email address, and profile photo. We store these to identify your account.</P>
          <P><strong style={{ color: 'var(--paper)' }}>Reading data.</strong> Your library, wishlist, read-next queue, ratings, notes, reading dates, and progress belong to you and are stored in your account.</P>
          <P><strong style={{ color: 'var(--paper)' }}>Usage data.</strong> We track how many times you use AI features per month to enforce free-tier quotas and monitor infrastructure costs. This counter resets monthly.</P>
          <P><strong style={{ color: 'var(--paper)' }}>Subscription data.</strong> If you subscribe to Pro, we store your Paddle customer ID and subscription ID. We never store card numbers or payment details — all payment processing is handled by Paddle.</P>
          <P><strong style={{ color: 'var(--paper)' }}>Club data.</strong> Your display name, reading activity, and any posts or discussion contributions in book clubs are visible to other club members.</P>
        </S>
        <S title="What we do not collect">
          <P>We do not collect your location, device identifiers, browsing history outside the app, or biometric data. We do not run advertising and have no advertising partners. We do not sell your data to any third party.</P>
        </S>
        <S title="How we use your data">
          <P>Your reading data powers app features — displaying your library, generating Oracle recommendations, building reading plans, and tracking progress. Your email may be used for transactional notifications if you opt in. We do not send marketing emails without explicit consent.</P>
          <P>AI features send prompts to Anthropic's Claude API. These include book titles and genre preferences but not your name, email, or any personally identifying information.</P>
        </S>
        <S title="Data storage and security">
          <P>Your data is stored in Supabase (PostgreSQL on AWS) with row-level security policies ensuring users can only access their own data. All data is transmitted over HTTPS. Service role credentials are stored only in server-side environment variables and are never exposed to the client.</P>
        </S>
        <S title="Third-party services">
          <P>We use: Google OAuth (sign-in only), Supabase (database), Anthropic Claude (AI features), Paddle (payments — Merchant of Record), Netlify (hosting), Hardcover / OpenLibrary (book metadata).</P>
        </S>
        <S title="Your rights">
          <P>You can delete your account and all data at any time from Profile → Reset profile. You can request a copy of your data or ask us to delete specific records by emailing support@thebooksoracle.com. We respond within 30 days. EEA users have GDPR rights including access, rectification, erasure, and portability.</P>
        </S>
        <S title="Cookies">
          <P>The app uses browser localStorage and sessionStorage to cache reading data locally for performance. These are not advertising cookies and do not track you across other sites. No third-party tracking cookies are set.</P>
        </S>
        <S title="Children">
          <P>The Books Oracle is not directed at children under 13. If you believe a child has provided personal data, contact us and we will delete it promptly.</P>
        </S>
        <S title="Changes">
          <P>We may update this policy from time to time. Significant changes will be noted in the in-app release notes.</P>
        </S>
      </div>
    </>
  );
}
