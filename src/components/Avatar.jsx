// src/components/Avatar.jsx — v0.52
//
// THE avatar. One component for every place a reader's face appears —
// replaces five copy-pasted local Avatar implementations (CommentThread,
// BookClubDetail, SessionDetail, Dashboard's ClubAvatar, Friends).
//
// Two fixes baked in that the copies lacked:
//   1. referrerPolicy="no-referrer" — Google serves lh3.googleusercontent.com
//      profile photos a 403 when a Referer header rides along, which is why
//      Google avatars "randomly" failed to render. With no-referrer they load.
//   2. onError fallback to initials — stale Google URLs (user changed their
//      photo) degrade to the initials disc instead of a broken image.
//
// Styling stays on the existing .friend-avatar / .friend-avatar--fallback
// classes (sized via --fa-sz), so call sites keep their look.

import { useState, useEffect } from 'react';

export default function Avatar({ displayName, avatarUrl, size = 26, className = '' }) {
  const [failed, setFailed] = useState(false);
  // A new URL deserves a fresh attempt (e.g. user just picked a preset).
  useEffect(() => { setFailed(false); }, [avatarUrl]);

  const suffix = className ? ` ${className}` : '';
  if (avatarUrl && !failed) {
    return (
      <img
        src={avatarUrl}
        alt={displayName || ''}
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className={`friend-avatar${suffix}`}
        style={{ '--fa-sz': `${size}px` }}
      />
    );
  }
  const initials = (displayName || '?').split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  return (
    <div className={`friend-avatar--fallback${suffix}`} style={{ '--fa-sz': `${size}px`, fontSize: Math.round(size * 0.36) }}>
      {initials}
    </div>
  );
}
