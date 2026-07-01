import { useEffect, useState } from 'react';
import { fetchCoverURL } from '../lib/coverService';
import { PALETTES, ORNAMENTS, hashStr } from '../lib/bookHelpers';

export default function BookCover({ title, author, coverUrl, className = '', eager = false }) {
  // If a cached coverUrl is provided, use it immediately and skip the network fetch.
  const [url, setUrl] = useState(coverUrl || null);
  // Track image-load state so we can add the `.loaded` class that triggers the
  // fade-in defined in main.scss (`.cover img { opacity: 0 } .cover img.loaded { opacity: 1 }`).
  // Without this, real covers stay invisible because the rule sets opacity: 0 by default.
  const [loaded, setLoaded] = useState(false);

  // Reset loaded flag whenever the URL changes (e.g. switching from placeholder to real cover)
  useEffect(() => {
    setLoaded(false);
  }, [url]);

  useEffect(() => {
    // If we have a cached URL, nothing to do.
    if (coverUrl) {
      setUrl(coverUrl);
      return;
    }
    let cancelled = false;
    const run = () => {
      fetchCoverURL(title, author).then((u) => {
        if (!cancelled) setUrl(u);
      });
    };
    if (eager) {
      run();
    } else {
      const t = setTimeout(run, 50);
      return () => {
        cancelled = true;
        clearTimeout(t);
      };
    }
    return () => {
      cancelled = true;
    };
  }, [title, author, coverUrl, eager]);

  if (url) {
    // If the image is cached by the browser, onLoad may fire before the
    // listener attaches. Use complete check on mount via ref callback as a fallback.
    return (
      <img
        className={`${className}${loaded ? ' loaded' : ''}`.trim()}
        src={url}
        alt={`${title} cover`}
        loading="lazy"
        onLoad={() => setLoaded(true)}
        onError={() => {
          // Image failed (broken link, blocked, etc.) — drop back to placeholder
          setUrl(null);
        }}
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        ref={(el) => {
          // Handle the case where the image is already cached by the browser
          // and was complete before onLoad could fire.
          if (el && el.complete && el.naturalWidth > 0 && !loaded) {
            setLoaded(true);
          }
        }}
      />
    );
  }
  // placeholder
  const palette = PALETTES[hashStr(title) % PALETTES.length];
  const orn = ORNAMENTS[hashStr(author || '') % ORNAMENTS.length];
  return (
    <div className={`placeholder ${className}`} style={{ background: palette.bg }}>
      <div className="ph-ornament">{orn}</div>
      <div className="ph-title">{title}</div>
      <div className="ph-author">{author || ''}</div>
      <div className="ph-ornament">{orn}</div>
    </div>
  );
}
