# Pro tier v1 — "Unlimited" rethink

Written 2026-09-22, against v0.70. **Status: all five phases implemented in the v0.71 working tree (2026-09-22), not yet deployed.** Migrations `20260923120000` through `20260926120000`.

---

## 1. The problem, as the code actually has it

The live quota (from `consume_oracle_call` / `get_oracle_quota`):

| Tier | Limit | Period |
|---|---|---|
| Free | 5 | calendar month (UTC) |
| Pro ($5.99) | 5 | **day** |

The free tier was already monthly. What's wrong is Pro. "Five a day" sells
150 readings a month to people who use 3–4 and then go and read for a few
weeks. Nobody runs into the Pro limit, so nobody sees a reason to pay.

**The usage data (all time, `oracle_call_log`):**

| Calls in a month | Reader-months |
|---|---|
| 1 | 3 |
| 3 | 2 |
| 4 | 1 |
| 23 | 1 |

6 of 7 reader-months stay under 5. The query counted *every* log row,
charged or not, and did not exclude the admin account. The 23 is
almost certainly curator or testing traffic. Re-run with `where charged` and
`user_id <> '<admin uuid>'` before reading anything into it. Seven
reader-months is too few to set prices from. That's fine: the decisions below are
product decisions, and the data only confirms the obvious. **Nobody is
constrained by a daily limit.**

## 2. Decisions

| # | Decision | Status |
|---|---|---|
| D1 | Free stays **5 Oracle readings per month**. | Agreed |
| D2 | **Welcome month:** 10 readings during the first 30 days after signup. | Agreed |
| D3 | Pro becomes **Unlimited**. A silent fair-use ceiling of 30/day protects against scripts, not readers. | Agreed |
| D4 | **"None of these call to me"** button on every Oracle result set. It always records the miss and refunds the reading when the Oracle got it wrong. | Agreed; refund rule below |
| D5 | Price stays **$5.99/month**. An annual variant is offered alongside it in Lemon Squeezy, not instead of it. | Agreed |
| D6 | Pro gates: more than one book club, Anthology limits and insights, Passages, a Pro mark, Oracle extras. | Agreed; details §5 |
| D8 | **Book club Oracle features (poll suggestions, discussion prompts) are Pro.** Free readers run one plain club by hand. | Agreed 2026-09-22 |
| D9 | The 30/day fair-use ceiling stands. | Agreed 2026-09-22 |
| D10 | The welcome month applies to every account in its first 30 days, existing ones included. | Agreed 2026-09-22 |
| D7 | Sharing, joining and following stay free forever. | Agreed |

### D4 refund rule

The miss is recorded every time. That record is the recommendation-quality signal
and the main point of the button. The reading comes back when **all** of these
are true:

- the reader is on Free (Pro has nothing to refund);
- the draw was actually charged (a Vault or tag-matched draw cost nothing);
- the charge falls in the current quota month;
- the reader has had fewer than **2 refunds this month**.

Why refund per miss, capped, instead of "one free after N misses": a threshold
rule is invisible. The reader can't see it coming and it feels arbitrary
when it fires. "If none of these fit, this one's on the Oracle" is easy to
understand, and it answers the "is this site scamming me" worry at the
moment the worry comes up. The cap of 2 is what makes it safe. In the worst
case a free reader gets 7 readings in a month instead of 5.

## 3. Security prerequisites (ship with v0.71 — blocking)

Going to "Unlimited" makes Pro worth stealing. The repo's migrations show three ways in.
**Verify each against the live DB before v0.71**. The dump is from
2026-08-06, and a fix made in the dashboard would not show up here.

1. **`profiles` is fully self-writable.** The policy "Users can update own
   safe profile fields" is `USING (auth.uid() = id)` with no column
   restriction, `authenticated` has `GRANT ALL`, and no trigger guards it. A
   signed-in reader can run
   `supabase.from('profiles').update({ subscription_status: 'active' })` from
   the console and become Pro. The same goes for `is_curator` and for zeroing
   their own counters.
   **Fix:** `BEFORE UPDATE` trigger `profiles_guard_privileged` that raises if
   `current_user` is `anon`/`authenticated` and any of `subscription_status`,
   `is_curator`, `oracle_calls_*` changed. The webhook (service role) and the
   quota RPCs (definer, owned by `postgres`) pass through. No client code writes
   those columns today (checked: `DataContext` patch, `Onboarding`, `Profile`
   notification prefs, `markIntroSeen`).
2. **`consume_oracle_call(p_user_id, …)` is executable by `anon` and
   `authenticated`.** It takes the user id as a parameter, so anyone can burn
   another reader's quota. Only `claude.js` (service role) should call it.
   **Fix:** revoke from `public, anon, authenticated`.
3. **`get_oracle_quota(p_user_id, …)` has the same shape.** Anyone can read any
   reader's subscription status and usage. The client needs it for its own id.
   **Fix:** revoke from `anon`, and refuse inside the function when
   `auth.uid()` is set and differs from `p_user_id`.

Quick live check:

```sql
select has_function_privilege('anon', 'public.consume_oracle_call(uuid,uuid,text,text)', 'execute');
select tgname from pg_trigger where tgrelid = 'public.profiles'::regclass and not tgisinternal;
```

## 4. Phase 1 — v0.71 "Unlimited" (quota model + misses)

### 4.1 Database — `20260923120000_pro_unlimited_and_misses.sql`

- Guard trigger + revokes (§3).
- `consume_oracle_call` / `get_oracle_quota` rewritten:
  - free limit = `10` if `profiles.created_at > now() - 30 days`, else `5`.
    Returned as `calls_limit` plus `welcome: true|false`.
  - Pro: `unlimited: true`, `calls_limit: null`, while `calls_today < 30`.
    At the ceiling the quota returns `unlimited: false, period: 'day',
    calls_limit: 30, calls_remaining: 0`. The existing day-wall renders it
    without any new UI, and without the upgrade note because `isPro`.
- `oracle_misses` table: `user_id, surface, recommendation_ids bigint[],
  reason, refunded, refunded_call_id, created_at`. RLS: select own. Writes only
  through the RPC.
- `report_oracle_miss(p_surface, p_recommendation_ids, p_reason)`, security
  definer:
  - ids must belong to `auth.uid()`, be shown within 24h, and be unresolved
    (`outcome is null`). None may already be in a miss.
  - marks them `outcome = 'dismissed'`.
  - finds the charge: the latest `oracle_call_log` row for the user with
    `source = p_surface`, `charged`, created in
    `[first shown_at − 10 min, first shown_at]`. (`call_id` is never populated
    on `oracle_recommendations`, so linking by time window is the only option. If
    `call_id` gets wired up later, prefer it.)
  - on refund: flips that log row to `charged = false, period = 'refunded'`
    and decrements `oracle_calls_this_month`. Flipping the log row rather
    than inserting a credit keeps `get_oracle_call_history`'s period totals
    (charged rows only) matching the quota bar with no change to that function.
  - returns `{ status, refunded, refunds_left, calls_remaining }`.
  - reasons allowlisted: `not_my_taste`, `already_known`, `off_request`,
    `other`.

### 4.2 Client

- `components/OracleMissButton.jsx`: sits under the result grid in Ask,
  Similar and By genres. It shows only when the books carry
  `recommendationId`s. First tap opens four reason chips, and a chip submits.
  The result line says *"Noted — this reading is on the Oracle"* or
  *"Noted — the Oracle will learn from it"*. Then `refresh()` the quota.
- Spark (the single dashboard card) is out of scope for v1. It has its own
  redraw flow and one card isn't really a set of options.
- `OracleCallHistory`: `period === 'refunded'` renders as "refunded".
- `OracleQuotaContext`: carries `welcome`.
- Copy: every "5 a day" string becomes Unlimited. Terms and Privacy still say
  **Paddle, $5**. Correct both to Lemon Squeezy at $5.99 while touching
  pricing. (I'm not a lawyer. Those are factual corrections, not new terms.)

### 4.3 Copy

| Key | EN | ES |
|---|---|---|
| `oracle.missButton` | None of these call to me | Ninguno me llama |
| `oracle.missPrompt` | What missed? | ¿Qué falló? |
| `oracle.missReason.not_my_taste` | Not my taste | No es mi estilo |
| `oracle.missReason.already_known` | Already know these | Ya los conozco |
| `oracle.missReason.off_request` | Not what I asked for | No es lo que pedí |
| `oracle.missReason.other` | Something else | Otra cosa |
| `oracle.missRefunded` | Noted — this reading is on the Oracle. | Anotado — esta lectura corre por cuenta del Oráculo. |
| `oracle.missNoted` | Noted — the Oracle will learn from it. | Anotado — el Oráculo va a aprender de esto. |
| Pro headline | Unlimited Oracle readings | Lecturas del Oráculo ilimitadas |
| Welcome | Your first month: 10 readings | Tu primer mes: 10 lecturas |

The Oracle voice rule holds: the reader is the one judging the draw, not the
Oracle judging itself.

## 5. Phase 2 — v0.72 Pro gates (creation limits)

All enforced **server-side** by `BEFORE INSERT` triggers calling one helper,
`is_pro(uid)` (`subscription_status = 'active'`, curators included). The UI
gate is a courtesy on top. **Existing content is grandfathered.** Only
*creating* past the limit is blocked. A downgrade never deletes or hides
anything.

| Feature | Free | Pro |
|---|---|---|
| Book clubs | Join any; **own 1** | Own unlimited |
| Anthologies | **3**, all shareable | Unlimited · collaborative · custom cover · insights (Phase 4) |
| Passages | **1 active** | Unlimited |
| Titles | All earned Titles, as today | Plus an *Adept* mark on profile and Kindred cards |

Notes:
- **Titles are earned, so they stay free.** Putting reading achievements
  behind payment would undercut the Ledger. Pro gets a cosmetic mark instead.
  *Your call if you want more than this.*
- **Sharing stays free.** Every shared Anthology is an acquisition channel
  and an indexable page.
- The wall copy names what's gated and never threatens:
  *"Your first club is yours. More than one is part of Pro."*

## 6. Phase 3 — v0.73 Oracle extras (Pro)

- **Why this book — the long reading.** From any Oracle-recommended book, a
  few paragraphs connecting it to named books on the reader's shelf (the
  shelf signature already exists in `oraclePrompt.js`). Free readers see the
  one-line reason they get today.
- **Taste profile — "Your reader's chart".** A written portrait of the reader's
  shelf: recurring themes, pull toward complexity or depth, blind spots, and
  three directions they haven't explored. Regenerated at most monthly and
  cached on the profile.
- Both are unmetered for Pro and charged under the fair-use ceiling like any
  other call. New `LOGGED_SOURCES`: `why_long`, `taste_chart`.
- **Misses feed back in.** The dismissed titles and their reasons join the
  exclude hint and the prompt ("recently rejected as *not my taste*: …"). That
  closes the loop D4 opened.

## 7. Phase 4 — v0.74 Anthology insights (Pro)

For curators and influencers. The pitch is *"see which of your lists actually
moves readers"*.

- Per Anthology: views, unique visitors, follows, books added to a shelf from
  the Anthology, and signups that arrived through its link (`?ref=a:<id>`).
- Aggregates only, with no visitor identities. Show a count only when it reaches
  **5**, so a small audience can't be de-anonymised. This fits the
  aggregate-only stance in `activity-events-v1-spec.md`, and Phase 1 of that
  spec is a dependency.
- Free owners see the total view count as a teaser. Pro sees the breakdown and
  a ranking across their Anthologies.

## 8. Phase 5 — annual option

- A second Lemon Squeezy variant. Suggested **$49.99/year** (≈ 2 months free).
  The price is Simon's call.
- `create-checkout-session` takes `plan: 'monthly' | 'annual'`, allowlisted,
  mapped to `LEMON_SQUEEZY_REDIRECT_URL` / `LEMON_SQUEEZY_REDIRECT_URL_ANNUAL`.
- The webhook is already variant-agnostic (it reads status only), so it needs no change.
- Pricing UI: monthly stays the default and the headline. Annual is a quiet
  second option.

## 9. Resolved questions and implementation notes

1. **Fair-use ceiling.** 30/day was confirmed. It is a constant in both quota
   functions (`v_pro_ceiling`).
2. **Welcome month.** It applies to existing accounts too. It is automatic,
   since it keys on `profiles.created_at`.
3. **Club Oracle features.** They are metered and **Pro only** (D8). This is enforced in
   `claude.js` (403 `pro_required`) and in the UI (`ClubPolls`,
   `SessionDiscussion`). Manual polls and questions stay free.

Where the build differs from the text above:

- **"1 active Passage"** is implemented as **one Passage kept at a time**. `plans`
  has no status column, so "active" means "exists". To make another one, a Free reader
  finishes or removes the current one.
- **The long reading** is offered on **every** book in BookModal, not only
  Oracle-drawn ones.
- **Anthology "adds"** count a signed-in reader shelving (wishlist, read-next,
  start reading or mark read) the same book they opened from the Anthology,
  within 2 hours. **Signups** count an account under 2 days old that
  finishes onboarding within 7 days of last opening that Anthology signed out.
- **Guard trigger vs. gate trigger.** The profiles guard tests `current_user`
  (definer RPCs acting for the reader must pass). The creation gates test the
  JWT role (an RPC creating a club is still the reader creating one).

Still open:

- Profiles are fully readable (`"Anyone can read curator flag"` is
  `USING (true)` with table-level `GRANT ALL`). That exposes
  `subscription_status` and the quota counters for every reader. It's not introduced
  here, but worth narrowing to a column list or a view.
- The annual price. The code only needs `VITE_ANNUAL_PRICE` and
  `LEMON_SQUEEZY_REDIRECT_URL_ANNUAL`. Terms still say "billed monthly".
  Add an annual sentence once the variant exists.
