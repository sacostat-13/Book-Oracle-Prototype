# Feature Discovery — v1 spec

*Roadmap: "Help readers find what the app can already do — organically, in the
moment, never blocking. Discovery that meets them where they are, not a tour
that stands in the doorway."*

## Principle

The site has grown a lot of capability — memories, the ledger, plans, user
categories, lists, book clubs — and none of it is worth much if readers never
find it. But the fix must feel like the rest of the app: **quiet, contextual,
skippable.** Three rules:

1. **Never block.** Nothing gatekeeps the app on first visit. No forced tour,
   no modal a reader must dismiss before they can act.
2. **Teach at the moment of intent, not up front.** The best place to explain a
   feature is the empty version of that feature — the reader is already looking
   at it. Contextual hints beat upfront tutorials, and beat a random tips banner
   (which readers learn to ignore within days).
3. **Once, then gone.** Any hint a reader has seen and dismissed does not come
   back. If they never engage, the app looks exactly as it does today.

*Why this shape (from the research):* ~70% of product tours get skipped and
completion collapses past ~5 steps; contextual empty-state and coach-mark
patterns outperform both tours and banners because they arrive when the feature
is relevant. So v1 leans entirely on context, and defers the blog (a separate,
slower SEO play) to a later phase.

## What exists already (v1 builds on, not beside)

- **Empty states exist but are fragmented and passive.** At least half a dozen
  bespoke variants — `lv-empty` (Lists), `empty-state` (several views),
  `fp-empty`, `clubs-empty-text`, `ldetail-empty`, `bp-no-rating` — most of
  which say "nothing here" without teaching what the feature *does* or offering
  the action that fills it. Lists is the closest to the target shape (icon +
  title + text) but still doesn't act.
- **Release notes already render, just not where they're found.**
  `releases.js` (`publishedReleases()`, `CURRENT_VERSION`) already feeds
  `ReleaseNotesModal`, `CurrentReleaseFooter`, and `About.jsx`. The content is
  bilingual and good — it's simply buried in About, which (as noted) readers
  don't open, and it isn't a public, indexable page.
- **No coach-mark or "what's new" infrastructure exists.** There is no
  dismissible in-context hint primitive, and no "you haven't seen this version"
  signal anywhere in the nav.

So v1 is three moves, cheapest-first, each grounded in the above.

## Move 1 — Empty states that teach and act (the workhorse)

One shared component, `EmptyState`, replacing the bespoke variants:

```
<EmptyState
  ornament="❦"
  title={t('lists.emptyTitle')}
  body={t('lists.emptyBody')}      // one sentence: what this is FOR
  action={{ label, onClick }}      // the button that fills it (optional)
/>
```

Rolled out to the highest-value empty surfaces first — the features readers
most often don't know exist: **Lists, Book Clubs, Plans, Read Next, user
Categories** (and the Ledger, which already has its `ledger.lede` line). The
copy shifts from "You have no lists" to "Lists let you group books however you
like — start your first," with the create action right there. This is the whole
of the "pro-tips" idea, relocated from a random banner into the exact place the
tip is true.

No behavioural change when a surface is non-empty — this only touches the
zero-state branch each view already has.

## Move 2 — Contextual coach-marks (the "tour", de-fanged)

A single small primitive, `CoachMark`: a dismissible pointer anchored to one
real element, shown at most **once per reader per mark**.

- **One per page, ever.** Not a sequence. It points at the one non-obvious
  thing on a page a first-time visitor would miss (e.g. the Oracle categorize
  button, or "tap a milestone to share it" on the Ledger).
- **Skippable and self-dismissing.** An × closes it; acting on the target
  closes it; it never reappears once seen.
- **Seen-state persistence:** `state.coachmarksSeen` — an array of mark ids —
  rides the same storage as everything else (localStorage for guests,
  `profile.preferences` for authed users, exactly like `readNext` /
  `dashboardLayout` today). A mark whose id is in the set never renders.

This satisfies the intent behind idea 1 (a first-visit tour) without the part
readers hate — it's never a multi-step gate, just a single quiet pointer that
appears once and then never again.

## Move 3 — A public changelog + a "what's new" dot

The content is already written; it just needs a public home and a signal.

- **Public `/changelog` route** rendering `publishedReleases()` with no login
  required — an indexable page (its own URL, real headings per version) rather
  than a modal buried in About. This is the one SEO asset in v1: it captures
  searches for the product and feature names. `About.jsx` links to it instead of
  inlining the list.
- **A "what's new" dot** in the nav (reusing the existing `ReleaseNotesModal`):
  lit when `CURRENT_VERSION` is newer than the reader's last-seen version
  (`state.lastSeenVersion`, persisted like `coachmarksSeen`). Opening the modal
  clears it. In-app signals like this are seen far more than email or a footer —
  it's the cheapest way to turn a shipped feature into an actually-noticed one.

## No-nag rules (carry these into the build)

No random rotating tips banner (readers go banner-blind — Move 1 replaces it
with context). No multi-step or blocking tour. Every hint is dismissible and
one-time. Nothing here fires a notification. If a reader dismisses everything,
the app is visually unchanged.

## Out of scope for v1 (deliberately)

The **blog** — it's the best *permanent* SEO play but high-effort and
independent of the in-app work here; it gets its own later phase (a few
evergreen "how to use X" guides, once the changelog page proves the indexing
path). Also out: analytics on hint engagement (add once the primitives exist),
gamified/streak-based discovery, and any AI-driven "suggested next feature."

## Build checklist

1. `EmptyState` shared component + `_misc.scss` styles (DS tokens; consolidate
   `lv-empty` / `empty-state` variants behind it).
2. Convert the priority zero-states: Lists, Book Clubs, Plans, Read Next,
   Categories — teaching copy + primary action; i18n `empty.*` (EN/ES).
3. `CoachMark` primitive + `state.coachmarksSeen` (guest localStorage + authed
   `profile.preferences`); place 3–4 marks on the highest-value pages.
4. `/changelog` public route from `publishedReleases()`; point `About.jsx` at it.
5. "What's new" dot in Nav + `state.lastSeenVersion`; clears on opening
   `ReleaseNotesModal`.
6. i18n EN + es (rioplatense); `releases.js` (EN/ES) + `README.md`.
