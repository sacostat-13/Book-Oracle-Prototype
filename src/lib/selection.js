// src/lib/selection.js — multi-select list helpers.
//
// Genre and mood pickers (onboarding, profile, list editor, club creation)
// each re-implemented "toggle this id in the selected list, unless that would
// pass the maximum". This is that rule once. It is pure, so it works whatever
// holds the list: local state, a prop callback, or a profile setter.

/**
 * Add `value` to `list` if absent (respecting `max`), remove it if present.
 * Never mutates `list`.
 *
 * @template T
 * @param {readonly T[] | null | undefined} list  current selection
 * @param {T} value  the item that was toggled
 * @param {{ max?: number }} [opts]  `max`: adding is ignored once the list is this long
 * @returns {T[]} the new selection, or `list` itself when nothing changed (at the
 *          max), so callers can skip a save with `if (next === list) return`
 */
export function toggleInList(list, value, { max = Infinity } = {}) {
  const cur = Array.isArray(list) ? list : [];
  if (cur.includes(value)) return cur.filter((v) => v !== value);
  if (cur.length >= max) return list;
  return [...cur, value];
}
