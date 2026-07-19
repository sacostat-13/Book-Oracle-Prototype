// src/lib/avatars.js — v0.52
//
// The preset avatar gallery, driven entirely by the contents of
// public/avatars/ — the virtual:avatar-manifest module (vite.config.js) lists
// the folder at build/dev time, and everything else derives from a filename
// convention. To add an avatar, drop an SVG in the folder; there is no array
// to maintain here.
//
// Filename convention:
//   g-<label-slug>.svg     Genre set, solid variant
//   g-<label-slug>-o.svg   Genre set, outline (ring) variant
//   <anything-else>.svg    Standard set (an s- prefix is stripped for the label)
//
// The label is the slug, title-cased: g-fairy-tale-retelling.svg shows as
// "Fairy Tale Retelling". Genre slugs must not themselves end in "-o".
//
// A preset is "chosen" by writing its site-relative path into
// profiles.avatar_url; every render surface already displays whatever URL that
// column holds. isPresetAvatar distinguishes a chosen preset from an OAuth
// photo URL so the picker can offer "use your Google photo" only when there is
// one to go back to.

import files from 'virtual:avatar-manifest';

function labelFrom(slug) {
  return slug
    .split('-')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

const standard = [];
const genreByBase = new Map(); // slug -> { label, solid, outline }

for (const file of files) {
  const name = file.replace(/\.svg$/, '');
  const url = `/avatars/${file}`;
  if (name.startsWith('g-')) {
    const outline = name.endsWith('-o');
    const base = outline ? name.slice(2, -2) : name.slice(2);
    const entry = genreByBase.get(base) || { key: base, label: labelFrom(base), solid: null, outline: null };
    entry[outline ? 'outline' : 'solid'] = url;
    genreByBase.set(base, entry);
  } else {
    const base = name.startsWith('s-') ? name.slice(2) : name;
    standard.push({ key: base, label: labelFrom(base), file: url });
  }
}

export const STANDARD_AVATARS = standard;

// A genre entry missing one variant (someone dropped only a solid, or only an
// outline) still renders — the picker skips the absent variant.
export const GENRE_AVATARS = [...genreByBase.values()];

export function isPresetAvatar(url) {
  return typeof url === 'string' && /^\/avatars\/[a-z0-9-]+\.svg$/.test(url);
}
