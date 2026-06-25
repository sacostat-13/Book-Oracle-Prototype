// src/components/Footer.jsx — v0.37
// App footer with legal links and copyright.
// Shown at the bottom of every page via App.jsx.

import { useRouter } from '../lib/RouterContext';
import { useT } from '../lib/I18nContext';

export default function Footer() {
  const { go } = useRouter();
  const t = useT();
  const year = new Date().getFullYear();

  return (
    <footer style={{
      borderTop:     '1px solid rgba(201,162,75,0.12)',
      marginTop:     '4rem',
      padding:       '1.5rem 0 2rem',
      display:       'flex',
      alignItems:    'center',
      justifyContent:'space-between',
      flexWrap:      'wrap',
      gap:           '0.75rem',
    }}>
      <div style={{
        fontFamily:    "'Special Elite', monospace",
        fontSize:      '0.7rem',
        letterSpacing: '0.1em',
        color:         'var(--paper-aged)',
        opacity:       0.45,
      }}>
        © {year} Reading Oracle
      </div>

      <div style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap' }}>
        {[
          ['privacy', t('footer.privacy')],
          ['terms',   t('footer.terms')],
          ['refund',  t('footer.refund')],
          ['about',   t('footer.about')],
        ].map(([route, label]) => (
          <button
            key={route}
            onClick={() => go(route)}
            style={{
              background:    'none',
              border:        'none',
              cursor:        'pointer',
              fontFamily:    "'Special Elite', monospace",
              fontSize:      '0.68rem',
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color:         'var(--paper-aged)',
              opacity:       0.45,
              padding:       0,
              transition:    'opacity 0.15s',
            }}
            onMouseEnter={(e) => e.currentTarget.style.opacity = '0.75'}
            onMouseLeave={(e) => e.currentTarget.style.opacity = '0.45'}
          >
            {label}
          </button>
        ))}
      </div>
    </footer>
  );
}
