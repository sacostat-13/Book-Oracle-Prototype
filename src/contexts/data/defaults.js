// src/contexts/data/defaults.js — the shape of DataProvider's `state` and its storage keys.
//
// Every field the reader's data can have, with its empty value. Loading, the
// local and session caches and resetAll all start from this object.


export const LOCAL_KEY    = 'wishlist_oracle_state_v2';

export const SESSION_KEY  = 'wishlist_oracle_session_v3'; // bumped v0.31: genres now included in cache

export const defaultState = {
  onboarded: false,
  profile: {
    readingLevel: null,
    goal: null,
    goodreadsImported: false,
    favoriteGenres: [], // v0.38: onboarding — up to 5 genre names
    currentMood: [],    // v0.38: onboarding — up to 3 mood/intent chip ids
    // v0.66 — follows.
    bio: null,
    // Who may read this reader's shelves: 'public' | 'followers' | 'private'.
    // Mirrors profiles.shelf_visibility, which is what the RLS policy actually
    // consults. This copy is for rendering the setting, never for deciding
    // access — the server already decided that.
    shelfVisibility: 'followers',
    // Whose updates reach the feed: 'follows' | 'mutuals' | 'both'.
    feedScope: 'both',
    isCurator: false,
    // v0.51: the earned Reader Title the user chose to wear (tier key from
    // titles.js), or null. App-granted only — the picker offers earned tiers.
    displayTitle: null,
    displayName: null,
    username: null,
    avatarUrl: null,
    isDiscoverable: true,
    emailNotifications: true,
    // v0.45: set once the retroactive accomplishments backfill has run for
    // this profile (server column profiles.accomplishments_backfilled_at;
    // for guests it rides localStorage with the rest of profile).
    accomplishmentsBackfilledAt: null,
  },
  library: [],
  readNext: [],
  wishlist: [],
  currentPlan: null,
  plans: [],
  lists: [],
  shelfSortMode: 'recent',
  oracleMode: 'wishlist',
  // v0.35: dashboard layout — ordered list of widget configs
  dashboardLayout: null,  // null = use DEFAULT_DASHBOARD_LAYOUT
  // v0.35: numeric reading goal (books per year), null = not set
  readingGoalCount: null,
  // v0.12: a Map keyed by book_id (uuid) → array of { categoryId, name,
  // verified, usageCount, source: 'verified' | 'user' }. Populated on load
  // and kept in sync by addCategoryToBook / removeCategoryFromBook.
  // Books not in this map have no categories (empty array, not null).
  categoriesByBookId: {},
  // v0.15 phase 2.3: canonical genre taxonomy. keyed by book_id (uuid) →
  // array of { genreId, name, normalizedName, source, usageCount, assignedBySource,
  // description, familySlug, familyName, familySort }.
  // Global (not user-scoped). Populated from book_genres_view on load.
  genresByBookId: {},
  // Full genre catalog: [{ id, name, normalizedName, source, usageCount, description,
  //   familySlug, familyName, familySort }]
  // Sorted alphabetically. Used by PlanCreate genre select and genre browsers.
  genres: [],
  // v0.22: books currently being read. Each entry is a full book client object
  // with an extra `startedAt` (ISO date string) field.
  currentlyReading: [],
  // v0.65 — { [bookId]: reader_editions row }. Which edition THIS reader read,
  // keyed by book so it is reachable from any shelf. See src/lib/book/editions.js.
  editionsByBookId: {},
  // v0.28: book clubs. Each entry is { id, name, description, joinToken,
  // createdBy, createdAt, callerRole: 'member'|'admin', memberCount }.
  // Full detail (members, sessions) is fetched on demand by the club views.
  clubs: [],
  // v0.44: Reading Memory. Keyed by bookId (authed) or bookKey (guest) →
  // array of { id, kind: 'progress'|'finished', body, pagesAt, pctAt,
  // createdAt }, newest first. Private per user; guests persist via
  // localStorage with the rest of state.
  memories: {},
  // v0.45: Reading Accomplishments — the persistent, retroactive ledger.
  // Flat array of { id, key, kind, bookId, meta, earnedAt }, newest first.
  // Earned once and kept; deduped by `key`. Guests persist via localStorage.
  accomplishments: [],
  // v0.46: Feature-discovery coach-marks the reader has dismissed. Flat array
  // of mark ids; a mark whose id is here never renders again. Rides
  // profile.preferences (authed) / localStorage (guest), like dashboardLayout.
  coachmarksSeen: [],
  // v0.46: the release version the reader last opened in the "what's new"
  // panel. When it differs from CURRENT_VERSION, the nav shows an unseen dot.
  lastSeenVersion: null,
};
