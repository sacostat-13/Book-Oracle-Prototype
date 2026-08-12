// eslint.config.mjs — v0.62.3
//
// WHY THIS EXISTS
//
// v0.62.3 shipped a `useMemo` placed below an early return in BookPage and
// BookModal. React matches hooks by call order, so the hook ran on some renders
// and not others, and opening any book page threw:
//
//   Rendered more hooks than during the previous render.
//
// The build was green. Vite does not care where a hook is called, and there was
// no linter in the repo at all — so nothing between writing the bug and a
// reader hitting it had any opinion about it. A third instance
// (`useSelection` in ListDetail, below the `!list` guard) had been latent since
// selection mode was added and was found by the first run of this config.
//
// DELIBERATELY MINIMAL
//
// One rule at error, one at warn. This is not a style pass and should not
// become one — the codebase has no formatting linter and adding a hundred
// cosmetic errors is how a lint config gets ignored and then deleted. Add
// rules only when a real bug proves one would have caught it.
//
//   npm install     # once, to pull the two devDependencies
//   npm run lint

import hooks from 'eslint-plugin-react-hooks';

export default [
  {
    // Only two rules are enabled here, so this config is in no position to
    // judge an `eslint-disable` aimed at a third — it reports every such
    // directive as "unused" when the truth is that the rule simply is not on.
    // `ShareCard.jsx` has a legitimate `no-unused-vars` disable over a
    // destructure-to-omit; enabling that rule to satisfy the check produces 334
    // warnings across the codebase, which is not a trade worth making.
    //
    // Turning this off keeps the baseline at zero. A lint run that always
    // prints the same handful of warnings is one people stop reading, and then
    // the real error hides in the noise.
    linterOptions: { reportUnusedDisableDirectives: 'off' },
  },
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      '.netlify/**',
      'vite.config.js.timestamp-*',
      'src/styles/**',
    ],
  },
  {
    files: ['src/**/*.jsx', 'src/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { 'react-hooks': hooks },
    rules: {
      // Non-negotiable. This is the rule that would have caught v0.62.3's
      // regression before it left the machine.
      'react-hooks/rules-of-hooks': 'error',

      // Warn, not error. There are legitimate suppressed dependency arrays in
      // this codebase — the book-page enrichment effects intentionally omit
      // `book` to avoid a refetch loop — and each carries an explanatory
      // eslint-disable comment. Promoting this to error would demand either
      // rewriting those or adding noise.
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
];
