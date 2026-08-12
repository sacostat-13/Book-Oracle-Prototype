# Unstyled class audit — v0.62.3

A class name in JSX that resolves to no CSS rule is invisible in review: the
markup is correct, the build is green, nothing errors. It only shows up as "this
page looks like an older version of the site", which is how the public list view
was reported. This is the standing list.

## Method

Two sources of truth, unioned:

1. **Compiled CSS** — class names in the built stylesheet. Sass has already
   resolved nesting and `@extend`, so this catches everything that produces a
   rule.
2. **SCSS source, nesting resolved with a brace stack** — because a parent that
   declares nothing of its own (`.footer-brand { &__wordmark { … } }`) emits no
   rule and is *not* a bug. Checking compiled CSS alone reports it as missing;
   that produced a dozen false positives on the first pass.

Then every `className` string literal in `src/**/*.jsx` is checked against the
union, with `${…}` interpolations stripped.

To re-run after changes:

```bash
node node_modules/vite/bin/vite.js build --outDir /tmp/bo-audit --emptyOutDir
# then the resolver against /tmp/bo-audit/assets/*.css
```

## Fixed in this release

| Class | Where | Why it mattered |
|---|---|---|
| `page-header`, `page-eyebrow`, `page-title` | 9 views | The header block on Book Clubs, Club Directory, Session Create, Book Club Create, Currently Reading, Read Next, Privacy, Terms, Refund rendered at browser defaults |
| `toast`, `show`, `error` | `Toast.jsx` | **Every** confirmation and error in the app was an unstyled block in normal flow |
| `quota-badge`, `quota-dot`, `quota-count` | `OracleQuotaBadge.jsx` | Remaining-calls indicator was three bare inline spans on every Oracle surface |
| `sign-in-legal`, `sign-in-legal__sep` | `SignInGate.jsx` | Privacy/Terms/Refund links stacked as blocks with orphaned separators, on the first screen a new reader sees |
| `list-item`, `li-num`, `li-content`, `li-title`, `li-author`, `li-actions`, `level-pill` | `ListView.jsx` | The original report — the public shared-list page |

## Outstanding

Grouped by what a reader would actually notice. None break the build.

### Tier 1 — structural, on a page readers reach often

| Class | File | Note |
|---|---|---|
| `friend-row__body`, `friend-row__meta`, `friend-row__name`, `friend-row__name-row` | `Friends.jsx` | Four of the row's layout hooks. The row's own class is styled, so this is partial collapse rather than nothing |
| `feed-sub`, `feed-tag`, `feed-load-more`, `feed-row--clickable` | `Dashboard.jsx` | Activity feed secondary text, genre tag, and the load-more affordance |
| `nav-search-input` | `NavSearch.jsx` | The search field itself; inherits whatever `.input` siblings give it, which is nothing here |
| `poll-card__body`, `poll-card__actions` | `ClubPolls.jsx` | Poll body and button row |
| `cr-info`, `li-genres` | `CurrentlyReading.jsx` | `li-genres` is paired with `cr-genres`, which **is** styled — likely a safe deletion rather than a style to write |
| `changelog-list` | `Changelog.jsx` | Wrapper around the release list |
| `cover-shelf` | `ListDetail.jsx` | Sits inside `.cover-grid-shelves`, which is styled; may be a redundant wrapper |

### Tier 2 — landing page

`lp-footer__brand` · `lp-nav__signup` · `lps-faq__list` · `lps-offering__head` ·
`lps-mock--deal` · `lps-mock--plan` · `lps-mock--record` · `oc--dealfront` ·
`oc--facefront` · `is-seeker`

These belong to the landing-story components. Several look like modifier hooks
whose base class carries all the styling, which is legitimate. **Do not write
speculative styles here** — check them against `LANDING_STORY_SPEC.md` and the
prototypes first; guessing at a visual treatment for a mock card is how you end
up with two designs.

### Tier 3 — probably deletions, not styles

| Class | Note |
|---|---|
| `btn` | Always paired with `btn-primary` / `btn-secondary` / `btn-text`, which carry everything. A no-op token; remove it from the 9 files rather than defining it |
| `btn-sm` (`Friends.jsx`) | The convention elsewhere is `btn--sm`. Likely a typo — check before styling |
| `tn-accent` (`ClubPolls.jsx`), `session-hero__share` (`SessionDetail.jsx`), `share-card--framed` / `share-card__book-author` (`ShareCard.jsx`), `session-prompt--question` / `session-prompt--answers` (`SessionDiscussion.jsx`), `oracle-history__summary` (`OracleCallHistory.jsx`) | Single-use hooks; each needs a look at the component to decide style-vs-delete |

## Not bugs

`actionClass`, `actionVariant`, `badgeClass`, `btnClass`, `className` — these are
JavaScript variable names the extractor picked up out of `className={…}`
expressions. Ignore them; they are noise in the tool, not in the app.

## Preventing recurrence

The reason this accumulated is that a renamed CSS class and a JSX file that
still references the old name are, to every tool in the pipeline, two entirely
unrelated facts. Nothing connects them.

Worth considering: run the resolver in CI against the built stylesheet and fail
on Tier-1-shaped findings. It needs the compiled CSS, so it belongs after the
build step, not in a linter.
