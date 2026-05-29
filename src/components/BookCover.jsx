import { useEffect, useState } from 'react';
import { fetchCoverURL } from '../lib/coverService';
import { PALETTES, ORNAMENTS, hashStr } from '../lib/bookHelpers';

export default function BookCover({ title, author, className = '', eager = false }) {
  const [url, setUrl] = useState(null);
  const [tried, setTried] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!eager) {
      // Defer fetch a bit so we don't pummel APIs on first paint
      const t = setTimeout(() => {
        fetchCoverURL(title, author).then((u) => {
          if (!cancelled) {
            setUrl(u);
            setTried(true);
          }
        });
      }, 50);
      return () => {
        cancelled = true;
        clearTimeout(t);
      };
    }
    fetchCoverURL(title, author).then((u) => {
      if (!cancelled) {
        setUrl(u);
        setTried(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [title, author, eager]);

  if (url) {
    return <img className={className} src={url} alt={`${title} cover`} loading="lazy" />;
  }
  // placeholder
  const palette = PALETTES[hashStr(title) % PALETTES.length];
  const orn = ORNAMENTS[hashStr(author || '') % ORNAMENTS.length];
  return (
    <div className={`placeholder ${className}`} style={{ background: palette.bg }}>
      <div className="ph-ornament" style={{ color: palette.accent }}>{orn}</div>
      <div className="ph-title">{title}</div>
      <div className="ph-author" style={{ color: palette.accent }}>{author || ''}</div>
      <div className="ph-ornament" style={{ color: palette.accent }}>{orn}</div>
    </div>
  );
}
