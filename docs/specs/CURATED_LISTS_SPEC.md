# Curated Lists — implementation brief

**Target version:** next feature release after v0.62.3 (numbering to be confirmed — the
roadmap in project notes still refers to a v0.4x series that the live versioning
has long passed; current shipped version is v0.62.3)
**Status:** spec, not yet built. One item is already done — see §7.
**Author of record:** Simon
**Written against:** repo state 2026-08-12

---

## 0. Why this exists

Lists today are a private organising tool that happens to have a public URL. The
ask is to turn them into a **distribution surface**: something an influencer can
build on the Oracle, post about, and have people arrive at, follow, and be
notified about. That is a different product, and it needs three things Lists
does not currently have — discoverability, a follow relationship, and enough
metadata to be filterable.

The design principle throughout: **Book Clubs already solved this.** Clubs have
public/private visibility, genre and mood tags, a directory with filters, a
membership relation, and notifications on activity. Curated Lists should reuse
that vocabulary rather than invent a parallel one, so a reader who has used the
club directory already knows how to use the list directory. Where this spec says
"same as clubs", it means literally the same filter chips, the same sort options,
the same mood taxonomy — not merely similar.

**Naming:** "Lists" becomes **Curated Lists** in all user-facing copy, EN and ES.
The route name `lists` and the tables `lists` / `list_items` stay as they are —
renaming them buys nothing and touches every file that references them.

---

## 1. What ships

| # | Item | Notes |
|---|---|---|
| 1 | Genres on a list (optional, many) | Mirrors `book_club_genres` |
| 2 | Moods on a list (optional, many) | Mirrors `book_club_moods`, same 8-value taxonomy |
| 3 | Read / Wishlist badges on list books | Reuses the Stacks ring + badge treatment |
| 4 | Discover Curated Lists page | Mirrors `ClubDirectory`, same filters and sorts |
| 5 | Follow a list + notifications on change | New `list_followers` table, new notification type |
| 6 | Three-page IA | Landing / My lists / Discover |
| 7 | ~~Search lag when adding a book~~ | **Shipped in v0.62.3** — see §7 |

---

## 2. Data model

Five migrations' worth of change, deliverable as one file:
`supabase/migrations/<ts>_curated_lists.sql`.

### 2.1 Genres and moods

Straight copies of the club tables, same shape, same constraints:

```sql
create table public.list_genres (
  list_id  uuid not null references public.lists(id)  on delete cascade,
  genre_id uuid not null references public.genres(id) on delete cascade,
  primary key (list_id, genre_id)
);

create table public.list_moods (
  list_id uuid not null references public.lists(id) on delete cascade,
  mood    text not null,
  primary key (list_id, mood)
);
```

The mood vocabulary is **not** a new list. It is the onboarding taxonomy already
hardcoded in `src/views/BookClubCreate.jsx`:

```
comfort · challenge · escapism · mind-bending
character-driven · atmospheric · fast-paced · short-read
```

That constant is currently duplicated in the club create view. Lift it to
`src/lib/moods.js` and import it in both places as part of this work — a third
copy is how the taxonomies drift, and a mood that exists on lists but not clubs
breaks the "same filters" promise the directory makes.

**RLS.** Both tables: read allowed when the parent list is public *or* owned by
the caller; write allowed to the owner only. Same predicate shape as
`list_items` — an `exists` against `public.lists`. That predicate does not
recurse (lists' own policy does not reference these tables), so no
`SECURITY DEFINER` helper is needed here.

### 2.2 Followers

```sql
create table public.list_followers (
  list_id     uuid not null references public.lists(id) on delete cascade,
  user_id     uuid not null references auth.users(id)   on delete cascade,
  followed_at timestamptz not null default now(),
  -- Set when the follower last opened the list. Drives the "updated since you
  -- last looked" affordance on the landing page without a second table.
  last_seen_at timestamptz,
  primary key (list_id, user_id)
);

create index list_followers_user_idx on public.list_followers (user_id);
create index list_followers_list_idx on public.list_followers (list_id);
```

**A follow is only valid against a public list.** Enforce in the insert policy,
not only in the UI — otherwise a list that goes private keeps notifying people
who can no longer read it. On flipping `is_public` to false, delete the
followers rather than keeping them dormant: a dormant follower is a privacy
question nobody wants to answer later.

**You cannot follow your own list.** It would appear twice on the landing page
and every edit would notify you about yourself.

### 2.3 Notification type

One new type: `list_updated`. Payload:

```json
{ "list_id": "...", "list_title": "...", "change": "books_added", "count": 3 }
```

`change` is one of `books_added` | `books_removed` | `renamed` | `described`.

**Batching is mandatory, not an optimisation.** An influencer building a
fifty-book list adds books one at a time; naive per-insert notifications means
fifty notifications to every follower, which is how a follow feature teaches
people to unfollow. Two defences, both needed:

1. A trigger on `list_items` / `lists` writes to a small `list_change_log`
   (list_id, change, count, at) rather than notifying directly.
2. A **scheduled** job — `batch-scripts/scheduled/`, therefore free, therefore
   allowed on a timer per `batch-scripts/README.md` — rolls the log into one
   notification per (list, follower) per day and clears it.

Do not do the rollup in a trigger with a time window. The trigger has no way to
know whether more edits are coming, and `auth.uid()` is NULL in trigger context
(see the standing note in project memory) so the actor has to come from the row,
not the session.

Follow the existing pattern in `src/lib/useNotifications.js`: add `list_updated`
to `notificationLabel` and to `notificationRoute` (route to
`['list-view', { listId }]`). Add the EN and ES strings under
`notifications.listUpdated`.

Also add it to the notification **preferences** screen. Every existing type is
individually switchable and a new one that cannot be turned off is a support
ticket.

### 2.4 The directory RPC

`search_public_lists`, modelled directly on `search_public_clubs`
(`supabase/migrations/20260806212127_remote_schema.sql`, line ~2437). Same
signature shape, same `SECURITY DEFINER`, same `search_path` pin:

```sql
create function public.search_public_lists (
  p_query     text    default null,
  p_genre_ids uuid[]  default null,
  p_moods     text[]  default null,
  p_sort      text    default 'followers'
) returns table (
  id             uuid,
  title          text,
  description    text,
  created_at     timestamptz,
  owner_username text,
  owner_display  text,
  owner_avatar   text,
  book_count     bigint,
  follower_count bigint,
  genre_names    text[],
  moods          text[],
  cover_urls     text[],      -- first 6, for the preview strip
  caller_follows boolean
)
```

Sorts: `followers` (default) · `newest` · `books`. Clubs offer
`activity | members | newest`; `followers` is the direct analogue of `members`
and `activity` has no meaning for a list, so it is dropped rather than faked.

`caller_follows` exists so the Follow button renders in the right state from the
first paint. Computing it client-side means the button flickers from "Follow" to
"Following" on every directory load, which reads as a bug.

**Two things to copy deliberately from `search_public_clubs`:**

- It raises when `auth.uid()` is null. Keep that. Public lists are readable
  anonymously by direct URL — that is what sharing means — but the *directory*
  is a signed-in surface, same as the club directory, and `caller_follows` is
  meaningless without a caller.
- The genre and mood filters are `exists` subqueries, not joins. A join
  multiplies rows when a list has three genres, and the row count then has to be
  de-duplicated in the sort. The clubs function already avoids this; do not
  reintroduce it.

---

## 3. Screens

Three routes, replacing the current single `lists` route.

### 3.1 `lists` — Curated Lists (landing)

The signed-in home for the feature. In order down the page:

1. **Header** — title, and a primary **Discover** button routing to
   `lists-discover`.
2. **Lists you follow** — cards for each followed list, with the owner's name
   and avatar, book count, and a marker when the list has changed since
   `last_seen_at`. This block is what makes the follow relationship feel real;
   it goes above the fold.
3. **Your lists** — a compact strip with "See all" → `lists-mine`, plus the
   existing create-list action.

Empty state when the reader follows nothing: point at Discover. Reuse
`EmptyState`, already imported in `Lists.jsx`.

### 3.2 `lists-mine` — Your Curated Lists

Essentially today's `Lists.jsx`, plus per-list genre/mood editing and a follower
count on public lists. The create/edit modal gains two optional fields:

- **Genres** — multi-select from `state.genres` (the canonical taxonomy already
  loaded by `DataContext`). Chips, same component vocabulary as
  `BookClubCreate`.
- **Mood** — multi-select from the shared `MOODS` constant.

Both optional and both only meaningful on public lists — mirror
`BookClubCreate`, which already only submits moods when `isPublic`.

### 3.3 `lists-discover` — Discover Curated Lists

A near-copy of `ClubDirectory.jsx`. Same layout, same chip row, same
active-filter count, same debounce on the query field. Card contents: title,
owner (avatar + display name, linking to their friend profile), first six covers,
book count, follower count, genre and mood chips, Follow button.

Keep the filter chips visually identical to the club directory. This is the
whole reason to build it this way — a reader who filters clubs by "atmospheric"
should not have to learn a second control to filter lists by the same thing.

---

## 4. Read / Wishlist badges

On the list detail page (and on the public `list-view`), each book shows whether
the viewer has already read it or has it on their wishlist.

**Reuse the Stacks treatment exactly.** `src/styles/pages/_stacks.scss` already
defines it, and the comment there explains the reasoning — the signal is
deliberately redundant across three channels because any one of them can be lost
against a particular cover:

- 3px ring via `::after` with `border: 3px solid currentColor`
- corner badge
- tinted title
- plus a slight opacity drop on the art so the ring stays dominant

Colours, already established and not to be re-picked:

| State | Token | Class |
|---|---|---|
| Read (in library) | `--ro-forest` | `.is-library` |
| On wishlist | `--ro-gold` | `.is-wishlist` |

Implementation: lift the `.stack-card.is-library` / `.is-wishlist` block out of
`_stacks.scss` into a shared placeholder or mixin and `@extend` it from the list
card, rather than copying the declarations. If the two drift, the colour that
means "read" in The Stacks will mean nothing in particular on a list, which is
worse than having no badge at all.

**Only for the signed-in viewer, and only for their own shelves.** On a public
list viewed by a stranger, no badges. Do not show the *owner's* read state — the
question the badge answers is "have I read this", and answering a different
question with the same visual is actively misleading.

---

## 5. Follow behaviour

- Follow / Unfollow available on the list detail page and on Discover cards.
- Following a list does not grant any write access.
- The owner sees a follower count; **not** a follower list. Nobody asked for
  that, it is a privacy surface, and it can be added later if wanted.
- Unfollow deletes the row. No soft delete — there is nothing to preserve.
- If the owner makes a public list private, followers are deleted and no
  notification is sent. Notifying people that they have lost access to something
  is worse than silence.
- If the owner deletes the list, the cascade removes followers. Pending
  notifications referencing it should degrade to a generic label rather than
  render a dead link — `notificationRoute` already returns `null` for unknown
  cases, so route `list_updated` through the same guard when `list_id` no longer
  resolves.

---

## 6. Copy

All strings EN + ES (rioplatense), added in the same pass, per the standing
bilingual rule. Keys to add:

```
lists.curatedTitle            lists.discoverBtn
lists.followingSection        lists.yourListsSection
lists.followBtn               lists.followingBtn
lists.followerCount           lists.updatedSinceYouLooked
lists.fieldGenres             lists.fieldMoods
lists.discoverTitle           lists.discoverLead
lists.discoverEmpty           lists.badgeRead
lists.badgeWishlist
notifications.listUpdated
```

Voice check on every one of these: **the Oracle offers, it never takes
ownership.** A list belongs to the reader who made it. Copy like "the Oracle
picked these for you" is wrong here in a way it would not be on a suggestion
surface — a curated list is explicitly a *person's* taste, and that is the whole
value of the feature for influencer distribution. Say who made it, always.

---

## 7. Already fixed: the search lag

Shipped in v0.62.3, ahead of the rest of this spec, because it is a pure
performance bug with no design question attached.

`AddBookPicker` in `src/views/ListDetail.jsx` rebuilt its candidate pool inside
the render body on every keystroke:

```js
const pool = [...wishlist, ...library, ...readNext]
  .filter((b, i, arr) => arr.findIndex(x => bookKey(x) === bookKey(b)) === i)
```

`findIndex` inside `filter` is a linear scan per element — O(n²). Across ~1,200
books on the three shelves that is over a million `bookKey()` calls, each one
building a string, before the search filter had even started; then the filter
lowercased every title and author again from scratch. React re-rendered
synchronously per keystroke, so the typing itself stalled.

Fixed by: `Set`-based dedupe (O(n)), `useMemo` on the pool so it survives
keystrokes, and one precomputed lowercase haystack per book instead of one per
book per keystroke. No debounce needed once the per-keystroke work is
proportional to the number of books rather than its square.

**Watch this again when Discover ships.** The directory searches the whole
public corpus, not the reader's shelves, so it must go through
`search_public_lists` with the same debounce `ClubDirectory` already uses — not
a client-side filter over a fetched list.

---

## 8. Build order

Each step leaves the app shippable.

1. **Migration** — `list_genres`, `list_moods`, `list_followers`,
   `list_change_log`, `search_public_lists`, RLS on all of it. Nothing
   user-visible yet.
2. **`src/lib/moods.js`** — lift the taxonomy, update `BookClubCreate` to import
   it. Pure refactor, no behaviour change.
3. **Genres + moods in the list editor** — writes real data, so Discover has
   something to filter on the day it lands.
4. **Read / Wishlist badges** — self-contained, no dependency on 1–3, and the
   most immediately visible improvement to lists as they exist today.
5. **Discover page + three-route IA.**
6. **Follow** — table already exists from step 1; add the button, the landing
   page section, and `caller_follows` wiring.
7. **Notifications** — trigger, change log, scheduled rollup, preference toggle.
   Last on purpose: it is the only piece that can annoy people at scale, and it
   is the only piece that wants a real list with real followers to test against.

Per the standing requirement, the release is not done until `releases.js` (EN +
ES) and `README.md` are updated.

---

## 9. Open questions for Simon

1. **Follow limit.** Any cap on lists followed, or lists a single account can
   make public? Relevant if this is promoted to influencers — a spam surface
   with no cap is a spam surface.
2. **Notification default.** Should `list_updated` default ON or OFF for new
   followers? ON is more useful and more annoying; OFF makes the follow feel
   inert. Suggest ON with the daily rollup, given the batching in §2.3.
3. **Ordering inside a list.** `list_items.position` exists and defaults to 0.
   Curation implies deliberate order — is manual reordering in scope here, or a
   later pass? Not listed in the ask, so assumed out.
4. **Pro gating.** Public lists, or following, or the number of lists — any of
   these could sit behind the Pro tier. Currently assumed all free.
5. **Anonymous Discover.** §2.4 keeps Discover signed-in, matching clubs. If
   influencer promotion means linking Discover itself from social, that has to
   change and `caller_follows` needs a null-safe path.
