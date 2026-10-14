// no-orphan-modules.test.js
//
// Every module under src/ must be imported by something. A file nothing imports
// is invisible: it keeps passing review, keeps showing up in searches, and gets
// "fixed" alongside the real code — the code-health spike (2026-10-12) found
// ~1,500 lines of these, including a 737-line BookModal still carrying its own
// copy of the similar-books scoring.
//
// "Imported" means a static `import … from`, a side-effect `import '…'` or a
// dynamic `import('…')` with a relative path, from any file in src/, netlify/,
// batch-scripts/, scripts/, tests/ or the root config files. src/main.jsx is the
// entry point (index.html loads it), so it is exempt.
//
// If a file is genuinely meant to be unused for now, delete it instead — git
// keeps it.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

// fileURLToPath, not .pathname: on Windows .pathname is "/C:/...", every
// directory looked missing, and this test passed having checked nothing.
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SOURCE_EXT = ['.js', '.jsx', '.mjs'];
const IMPORTER_DIRS = ['src', 'netlify', 'batch-scripts', 'scripts', 'tests'];
const ROOT_CONFIGS = ['vite.config.js', 'eslint.config.mjs'];
const ENTRY_POINTS = new Set(['src/main.jsx']);

// Paths inside this test are repo-relative with "/" separators on every OS, so
// they compare equal to ENTRY_POINTS and to each other; join(ROOT, rel) turns
// them into real paths only at the moment the filesystem is touched.

/** Recursively list source files under `dir` (relative to ROOT, "/"-separated). */
function listSourceFiles(dir) {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs).flatMap((name) => {
    if (name === 'node_modules' || name === 'output') return [];
    const rel = `${dir}/${name}`;
    if (statSync(join(ROOT, rel)).isDirectory()) return listSourceFiles(rel);
    return SOURCE_EXT.some((ext) => name.endsWith(ext)) ? [rel] : [];
  });
}

/** All relative import specifiers in a file's source text. */
function relativeSpecifiers(text) {
  const rx = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)['"](\.{1,2}\/[^'"]+)['"]/g;
  return [...text.matchAll(rx)].map((m) => m[1]);
}

/** Resolve a specifier the way Vite would for our extensions. */
function resolveSpecifier(fromFile, spec) {
  const base = posix.normalize(posix.join(posix.dirname(fromFile), spec));
  const candidates = [base, ...SOURCE_EXT.map((e) => base + e), ...SOURCE_EXT.map((e) => `${base}/index${e}`)];
  return candidates.find((c) => existsSync(join(ROOT, c)) && statSync(join(ROOT, c)).isFile()) || null;
}

describe('src/ has no orphan modules', () => {
  it('every src module is imported by something', () => {
    const srcFiles = listSourceFiles('src');
    // A wrong ROOT returns no files and would pass vacuously. src/ has hundreds.
    expect(srcFiles.length, `found only ${srcFiles.length} files under ${join(ROOT, 'src')}`).toBeGreaterThan(100);
    const importers = [...IMPORTER_DIRS.flatMap(listSourceFiles), ...ROOT_CONFIGS.filter((f) => existsSync(join(ROOT, f)))];

    const referenced = new Set();
    for (const file of importers) {
      const text = readFileSync(join(ROOT, file), 'utf8');
      for (const spec of relativeSpecifiers(text)) {
        const target = resolveSpecifier(file, spec);
        if (target && target !== file) referenced.add(target);
      }
    }

    const orphans = srcFiles.filter((f) => !ENTRY_POINTS.has(f) && !referenced.has(f));
    expect(orphans, `Unimported modules — delete them or import them:\n  ${orphans.join('\n  ')}`).toEqual([]);
  });
});
