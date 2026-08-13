// src/components/FollowListButton.jsx — v0.63
//
// Follow / Following for a curated list. Used on Discover cards and on the
// public list page, so the two cannot disagree about what the states look like
// or what happens when you are signed out.
//
// Optimistic: the button flips immediately and reverts if the call fails.
// Following is not a destructive action and the round-trip is a Supabase RPC —
// a spinner on every tap would make the page feel slower than it is.
//
// Signed out, it prompts to sign in rather than disappearing. Discover is
// reachable without an account by design, and a visitor who arrived from a
// social post should be able to see that following is possible; hiding the
// button entirely hides the feature.
import { useState } from 'react';
import { useData } from '../lib/DataContext';
import { useAuth } from '../lib/AuthContext';
import { useT } from '../lib/I18nContext';

export default function FollowListButton({ listId, following, onChange, onRequireSignIn }) {
  const { followList, unfollowList, showToast } = useData();
  const { user } = useAuth();
  const t = useT();
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (!user) {
      if (onRequireSignIn) onRequireSignIn();
      else showToast(t('lists.followSignIn'), true);
      return;
    }
    if (busy) return;

    const next = !following;
    setBusy(true);
    onChange?.(next); // optimistic

    const ok = next ? await followList(listId) : await unfollowList(listId);

    setBusy(false);
    if (!ok) {
      onChange?.(!next); // put it back
      showToast(t('lists.followError'), true);
      return;
    }
    if (next) showToast(t('lists.followedToast'));
  }

  return (
    <button
      type="button"
      className={following ? 'btn-secondary' : 'btn-primary'}
      onClick={toggle}
      disabled={busy}
      aria-pressed={!!following}
    >
      {following ? `❦ ${t('lists.followingBtn')}` : t('lists.followBtn')}
    </button>
  );
}
