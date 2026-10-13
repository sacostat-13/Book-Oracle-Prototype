// src/contexts/domains/profile.js — the reader's profile and settings: reading
// preferences, onboarding, layout, coach marks, what's-new, goal, username,
// display name, avatar, privacy. Most persist through the preferences save in
// data/load.js; the column-backed ones write to `profiles` directly.

import { useCallback } from 'react';
import { supabase } from '../../lib/api/supabase';
import { CURRENT_VERSION } from '../../data/releases';

/**
 * Called once by DataProvider; returns setProfile, setOnboarded, setShelfSortMode, setOracleMode, setDashboardLayout, dismissCoachmark, markReleasesSeen, setReadingGoalCount, updateUsername, updateDisplayName, updateAvatar, updatePrivacyPrefs.
 * @param {object} deps  user, setState — from DataProvider and earlier domains
 */
export function useProfileSettings({ user, setState }) {
  const setProfile = useCallback((patch) => {
    setState((s) => ({ ...s, profile: { ...s.profile, ...patch } }));
  }, [setState]);

  const setOnboarded = useCallback((v) => {
    // v0.70: finishing onboarding also marks the current release as seen.
    //
    // Without this, `lastSeenVersion === null` is ambiguous — it means both
    // "brand new account" and "long-time reader who never clicked the sparkle"
    // — and the what's-new modal has to guess which. Stamping it here makes
    // null mean only the second, so a reader who starts on v0.70 is not
    // told what is new in the version they arrived on, and everyone else is.
    setState((s) => ({
      ...s,
      onboarded: v,
      lastSeenVersion: v ? CURRENT_VERSION : s.lastSeenVersion,
    }));
  }, [setState]);

  const setShelfSortMode = useCallback((mode) => {
    setState((s) => ({ ...s, shelfSortMode: mode }));
  }, [setState]);

  const setOracleMode = useCallback((mode) => {
    setState((s) => ({ ...s, oracleMode: mode }));
  }, [setState]);

  // v0.35: dashboard layout customization
  const setDashboardLayout = useCallback((layout) => {
    setState((s) => ({ ...s, dashboardLayout: layout }));
  }, [setState]);

  // v0.46: dismiss a feature-discovery coach-mark for good. Idempotent — a mark
  // already seen is not re-added. Persists via the normal preferences path.
  const dismissCoachmark = useCallback((id) => {
    if (!id) return;
    setState((s) => {
      const seen = s.coachmarksSeen || [];
      if (seen.includes(id)) return s;
      return { ...s, coachmarksSeen: [...seen, id] };
    });
  }, [setState]);

  // v0.46: mark the current release as seen — clears the nav "what's new" dot.
  const markReleasesSeen = useCallback(() => {
    setState((s) => (s.lastSeenVersion === CURRENT_VERSION
      ? s
      : { ...s, lastSeenVersion: CURRENT_VERSION }));
  }, [setState]);

  // v0.35: numeric reading goal (books per year)
  const setReadingGoalCount = useCallback((count) => {
    setState((s) => ({ ...s, readingGoalCount: count }));
  }, [setState]);

  // v0.36: update username — writes directly to profiles.username
  const updateUsername = useCallback(async (username) => {
    if (!user) return { error: 'not_authed' };
    const { error } = await supabase
      .from('profiles')
      .update({ username: username.toLowerCase().trim(), updated_at: new Date().toISOString() })
      .eq('id', user.id);
    if (error) return { error: error.message };
    setState((s) => ({ ...s, profile: { ...s.profile, username: username.toLowerCase().trim() } }));
    return { ok: true };
  }, [user, setState]);

  // v0.36: update display name — writes to profiles.display_name
  const updateDisplayName = useCallback(async (displayName) => {
    if (!user) return { error: 'not_authed' };
    const trimmed = displayName.trim() || null;
    const { error } = await supabase
      .from('profiles')
      .update({ display_name: trimmed, updated_at: new Date().toISOString() })
      .eq('id', user.id);
    if (error) return { error: error.message };
    setState((s) => ({ ...s, profile: { ...s.profile, displayName: trimmed } }));
    return { ok: true };
  }, [user, setState]);

  // v0.52: update avatar — writes to profiles.avatar_url. Accepts a preset
  // sigil path (/avatars/<name>.svg), the reader's OAuth photo URL (to switch
  // back), or null to clear down to the initials disc.
  const updateAvatar = useCallback(async (avatarUrl) => {
    if (!user) return { error: 'not_authed' };
    const url = avatarUrl || null;
    const { error } = await supabase
      .from('profiles')
      .update({ avatar_url: url, updated_at: new Date().toISOString() })
      .eq('id', user.id);
    if (error) return { error: error.message };
    setState((s) => ({ ...s, profile: { ...s.profile, avatarUrl: url } }));
    return { ok: true };
  }, [user, setState]);

  // v0.36: update privacy preferences
  const updatePrivacyPrefs = useCallback(async ({ isDiscoverable, emailNotifications }) => {
    if (!user) return;
    const patch = {};
    if (isDiscoverable  !== undefined) patch.is_discoverable     = isDiscoverable;
    if (emailNotifications !== undefined) patch.email_notifications = emailNotifications;
    patch.updated_at = new Date().toISOString();
    await supabase.from('profiles').update(patch).eq('id', user.id);
    setState((s) => ({
      ...s,
      profile: {
        ...s.profile,
        ...(isDiscoverable    !== undefined ? { isDiscoverable }    : {}),
        ...(emailNotifications !== undefined ? { emailNotifications } : {}),
      },
    }));
  }, [user, setState]);

  return { setProfile, setOnboarded, setShelfSortMode, setOracleMode, setDashboardLayout, dismissCoachmark, markReleasesSeen, setReadingGoalCount, updateUsername, updateDisplayName, updateAvatar, updatePrivacyPrefs };
}
