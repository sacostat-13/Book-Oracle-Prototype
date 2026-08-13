// src/lib/moods.js
//
// The single mood vocabulary.
//
// Introduced at onboarding (v0.38), then copied into BookClubCreate so clubs
// could be tagged and filtered by the same chips. Curated Lists is the third
// surface to want it, and a third copy is exactly how three lists that are
// supposed to be identical stop being identical — at which point a mood exists
// on lists but not clubs, and the "same filters as Book Clubs" promise the
// Discover page makes quietly becomes false.
//
// The ids are i18n keys, not display strings. Labels live under
// `onboarding.moods.<id>.title` (and `.sub`) in both catalogs, so adding a mood
// means adding it here AND to en.json + es.json — the label lookup will
// otherwise render the key.
export const MOODS = [
  'comfort',
  'challenge',
  'escapism',
  'mind-bending',
  'character-driven',
  'atmospheric',
  'fast-paced',
  'short-read',
];

// Label helpers, so no caller has to remember where the strings live.
export const moodTitleKey = (id) => `onboarding.moods.${id}.title`;
export const moodSubKey   = (id) => `onboarding.moods.${id}.sub`;

// Drops anything not in the taxonomy. Moods arrive from the database as free
// text (`list_moods.mood` is a plain column, same as `book_club_moods.mood`),
// so a value retired from this list would otherwise render as a raw i18n key on
// every card that still carries it.
export function knownMoods(moods) {
  if (!Array.isArray(moods)) return [];
  return moods.filter((m) => MOODS.includes(m));
}
