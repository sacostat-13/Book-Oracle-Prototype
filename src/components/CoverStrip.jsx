// src/components/CoverStrip.jsx — v0.63
//
// A row of small covers used as a preview on curated-list cards. The covers are
// the only honest signal of what a list actually is: a title and a genre chip
// say very little, six spines say a lot at a glance.
//
// Plain <img> rather than <BookCover>. BookCover exists to RESOLVE a missing
// cover — it fires a lookup per book when no url is supplied. On a directory
// page showing twenty lists that would be a hundred and twenty network calls to
// decorate a preview. `search_public_lists` already filters out books with no
// cover_url, so every url here is known good, and a broken one just drops out.
import { useState } from 'react';

export default function CoverStrip({ urls, max = 6, onClick }) {
  // Tracks urls that failed to load so a dead image leaves no gap. State rather
  // than hiding via CSS because a broken <img> still occupies layout.
  const [broken, setBroken] = useState(() => new Set());

  const shown = (urls || []).filter((u) => u && !broken.has(u)).slice(0, max);
  if (shown.length === 0) return null;

  return (
    <div
      className="cover-strip"
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); }
      } : undefined}
    >
      {shown.map((url) => (
        <img
          key={url}
          className="cover-strip__cover"
          src={url}
          alt=""
          // Decorative: the list title and book count carry the meaning, and a
          // screen reader reading six empty alt strings is noise.
          aria-hidden="true"
          loading="lazy"
          onError={() => setBroken((prev) => new Set(prev).add(url))}
        />
      ))}
    </div>
  );
}
