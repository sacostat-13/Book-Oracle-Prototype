# Oracle Provenance — v1 spec

*Know which books the Oracle chose, so a rating can say something about the
Oracle and not just about the reader.*

## Principle

**Capture is invisible and complete; interpretation comes later.** v1 adds no UI,
no user-facing feature and no change to any recommendation. It records what the
Oracle offered and what the reader did with it, so that in three months there is
something to look at. Nothing in this spec changes what the Oracle recommends —
that decision needs the data this produces, and making both changes at once would
mean never knowing which one moved the numbers.

**Why it cannot wait.** Provenance is the one thing here that is impossible to
backfill. A rating can be collected later; a preference can be re-derived. But
whether a book was the Oracle's idea or the reader's is knowable only at the
moment it is offered, and every recommendation accepted before this ships is that
fact lost permanently. This is the argument for doing it now and the measurement
work later, not the reverse.

## What exists already (v1 builds on, not beside)

- `aiSuggested: true` is already stamped on every result object in
  `OracleAsk.jsx`, `OracleSimilar.jsx` and `OracleCategories.jsx`. It is a render
  flag with no persistence — it dies the moment `addToWishlist(book)` runs. **The
  provenance link is already half-built and thrown away.**
- `oracle_call_log` (schema_v44) already records one row per Oracle call with its
  surface and timestamp. A recommendation can point at the call that produced it
  for free.
- `read_books.source` already exists with values `manual | user |
  goodreads_import | curated | verified`. `'oracle'` has an obvious home.
- `read_books.rating` is `numeric(2,1)`, 1–5, and schema_v34 already codifies the
  reading of a NULL: *unrated means no signal, not disliked.* v1 inherits that
  rule rather than inventing a second one.
- `buildTasteProfile` / `describeTasteProfile` already turn ratings into genre
  affinity and complexity/depth preference that feed every Oracle prompt. The
  rating→prompt loop exists. What it lacks is any notion of which books the
  Oracle picked.

## The thing worth getting right: impressions, not conversions

The obvious design is to stamp provenance when a recommended book is added. It is
also the design that cannot answer the question you actually care about.

Only recommendations the reader **accepts** would ever be recorded. The Oracle's
worst suggestions are precisely the ones nobody adds — so they would never appear,
and the average rating of "Oracle books" would be systematically flattering by
construction. You would be measuring the Oracle's hits against its hits.

So v1 records **every book the Oracle surfaces**, at the moment it is surfaced,
and marks the outcome afterwards. Three to five rows per Oracle call, five calls a
month on Free: the volume is trivial and the difference in what it can tell you is
not. Accept rate also arrives in *seconds* rather than waiting for someone to
finish a novel — which matters, because the reader who prompted this described a
loop measured in weeks.

## Data

### New table: `oracle_recommendations`

```sql
create table public.oracle_recommendations (
  id            bigserial   primary key,
  user_id       uuid        not null references auth.users(id) on delete cascade,
  call_id       bigint      references public.oracle_call_log(id) on delete set null,
  surface       text        not null,   -- spark | ask | similar | categories | plan
  position      smallint,               -- rank within the result set, 1-based
  -- Snapshot, not a link. See "Why not book_id alone" below.
  book_title    text        not null,
  book_author   text,
  book_id       uuid        references public.books(id) on delete set null,
  -- Outcome, written later. NULL = still just an impression.
  outcome       text,                   -- accepted | dismissed
  outcome_at    timestamptz,
  shown_at      timestamptz not null default now()
);

create index oracle_recommendations_user_shown_idx
  on public.oracle_recommendations(user_id, shown_at desc);
create index oracle_recommendations_outcome_idx
  on public.oracle_recommendations(user_id, outcome)
  where outcome is not null;
```

RLS: owner-read, no client write — same shape as `oracle_call_log`. Writes go
through a `SECURITY DEFINER` RPC (`log_oracle_recommendations`) that takes the
whole result set in one call, so a five-book recommendation is one round trip and
one transaction, not five.

**Why not `book_id` alone.** The Oracle recommends from world literature, not from
the catalog — `OracleAsk`'s prompt says so explicitly. Most recommendations have no
`books` row at the moment they are shown; one is only created by
`upsertBookOnServer` if the reader adds the book. Storing only `book_id` would
therefore record exactly the accepted subset and drop every rejected one, which is
the failure this whole design exists to avoid. Title and author are snapshotted;
`book_id` is backfilled on accept, when it becomes available.

**Why `position`.** If the reader consistently takes the third suggestion, the
Oracle's ranking is wrong even when its picks are good. That is a different fix
from "recommend better books", and it is invisible without the rank.

### Change to `read_books`

No schema change. On accept, `source` is set to `'oracle'` instead of `'user'`.
The recommendation row carries the detail; `read_books.source` is the cheap join
key that makes "Oracle books vs self-chosen books" a one-line filter.

## Write path

**On show** — in each of the three Oracle views, immediately after results are
parsed and set (`setResults(...)`), fire the log RPC. Guest sessions
(`!user`) skip it silently; there is no account to attribute to.

This is deliberately fire-and-forget: a failure to log must never surface to the
reader or block the results they just spent a call on. Log the error to console
and move on.

**On accept** — `addToWishlist(book)` already receives the whole book object, so
`aiSuggested` rides along today and is simply discarded. v1 adds a
`recommendationId` to the result objects alongside `aiSuggested`, and
`addToWishlist` / `markAsRead` stamp `outcome = 'accepted'` when one is present.

**On dismiss** — a recommendation that is still `outcome IS NULL` seven days after
`shown_at` is treated as dismissed by the metrics queries. Nothing needs to write
it, and inferring it at read time avoids a background job for a fact that only
matters in aggregate.

**Deduplication.** The same book can be recommended on several occasions. Each
impression is its own row — that is the point, since a book offered three times and
never taken is a stronger signal than one offered once. The accept stamp goes on
the most recent unresolved row for that title.

## What this makes answerable

The schema above is shaped by these three queries; if it cannot answer them it is
the wrong schema.

**1. Accept rate, per surface.** The fastest signal, available within days.

```sql
select surface,
       count(*)                                              as shown,
       count(*) filter (where outcome = 'accepted')          as accepted,
       round(100.0 * count(*) filter (where outcome = 'accepted') / count(*), 1) as pct
from public.oracle_recommendations
where shown_at < now() - interval '7 days'
group by surface order by pct desc;
```

**2. The rating delta — does the Oracle pick better books than you do?** The
question the tester was really asking. Slow: needs someone to finish a book.

```sql
select source = 'oracle' as oracle_chosen,
       count(*) filter (where rating is not null) as rated,
       round(avg(rating), 2)                      as avg_rating
from public.read_books
where source in ('oracle', 'user', 'manual')
group by 1;
```

**Read this one carefully.** Even with impressions logged, this compares accepted
Oracle books against self-chosen books — still a survivorship comparison, just an
honest one now that query 1 sits beside it to show what was refused. A high average
with a low accept rate means the Oracle is right when it is right and ignored
otherwise, which is a ranking problem, not a taste problem.

**3. Position bias.** Whether the ordering is carrying its weight.

```sql
select position,
       round(100.0 * count(*) filter (where outcome = 'accepted') / count(*), 1) as accept_pct
from public.oracle_recommendations
where shown_at < now() - interval '7 days'
group by position order by position;
```

## Privacy

`oracle_call_log` deliberately stores no content, and the v0.58 announcement said
so in as many words: *"never your question, and never which book you were
reading."* This table stores book titles. That is a real difference and it must not
be allowed to quietly contradict a promise already made.

The distinction that keeps both true: the call log records *what you asked*, this
records *what the Oracle offered you*. The first is the reader's own words; the
second is the app's output. The v0.58 promise is about the former and stays intact.

Required before this ships:

- Privacy policy gains a line covering recommendation history — what is kept, why,
  and that it is owner-scoped.
- RLS owner-read, no client write, matching `oracle_call_log`.
- `on delete cascade` from `auth.users` so account deletion takes it with them.
- **Not** surfaced in the Oracle call history panel. That panel answers "where did
  my quota go" and adding book titles to it would both muddy that answer and
  re-open the content question the panel was designed to avoid.

## Out of scope for v1 (deliberately)

- **Any change to what the Oracle recommends.** No prompt changes, no per-user
  weighting, no negative constraints. v1 is instrumentation; acting on it is a
  later decision that should be made against real numbers.
- **A dashboard.** Three SQL queries you run occasionally, not a feature.
- **Distinguishing "wrong book for me" from "good pick, bad book".** A star rating
  cannot separate these, and only the first should ever influence future
  recommendations. If v2 acts on ratings, it needs this distinction first — noted
  here so it is not forgotten, not built now.
- **Per-user personalization.** Five calls a month means a free user might rate two
  Oracle books a year. Deriving per-user adjustment from n=2 is noise dressed as
  personalization; it needs population-level data first, which is what v1 collects.

## Build checklist

- [ ] `schema_v45_migration.sql` — table, indexes, RLS, `log_oracle_recommendations`
      RPC (batch insert, SECURITY DEFINER), `resolve_oracle_recommendation` RPC.
- [ ] `src/lib/oracleProvenance.js` — thin client wrapper; no-ops for guests, never
      throws into a caller.
- [ ] `OracleAsk` / `OracleSimilar` / `OracleCategories` — log on `setResults`,
      attach `recommendationId` to each result object beside the existing
      `aiSuggested`.
- [ ] `DataContext.addToWishlist` / `markAsRead` — stamp accept when
      `book.recommendationId` is present; set `read_books.source = 'oracle'`.
- [ ] Privacy policy line, EN + ES.
- [ ] Verification: recommend 3 books → 3 rows with `outcome IS NULL`; add one →
      that row flips to `accepted` and its `read_books.source` reads `oracle`;
      confirm a second account sees zero rows.

## Open question for later

Spark recommends from the reader's own wishlist — books they already chose. Its
accept rate is not comparable to Ask or Similar, which recommend from world
literature. Logged with `surface = 'spark'` so it can be separated, but the metrics
above should probably exclude it until there is a reason not to.
