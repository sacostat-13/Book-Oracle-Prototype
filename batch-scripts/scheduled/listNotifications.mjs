// listNotifications.mjs — v1
//
// Turns a day of curated-list edits into at most one notification per follower
// per list, then prunes the change log.
//
// WHY A SCHEDULED SCRIPT AND NOT A TRIGGER
//
// The obvious place to notify from is the trigger on `list_items`, and it is
// the wrong place. Someone building a fifty-book list adds books one at a time.
// Notifying per insert means fifty notifications to every follower for one
// afternoon's work, which is not a feature — it is a very efficient way to
// teach people to unfollow. A trigger also cannot know whether more edits are
// coming, so it cannot batch on its own.
//
// So the triggers only append to `public.list_change_log`, and this rolls that
// up. All the work happens inside `rollup_list_notifications()` — one statement
// that claims the pending rows with UPDATE ... RETURNING and aggregates what it
// claimed, so a change logged mid-run is left for the next run rather than
// being marked processed and silently dropped. This file is the scheduler's
// handle on that function, nothing more.
//
// COSTS NOTHING. Two RPC calls against Supabase, no external API, no model.
// That is why it belongs in scheduled/ rather than manual/ — see
// batch-scripts/README.md for the rule.
//
// Usage:
//   node batch-scripts/scheduled/listNotifications.mjs
//   node batch-scripts/scheduled/listNotifications.mjs --dry-run
//   node batch-scripts/scheduled/listNotifications.mjs --no-prune
//
// Required in .env.local:
//   VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createServiceClient } from '../_shared/supabaseClient.mjs';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const NO_PRUNE = args.includes('--no-prune');

const envText = readFileSync(join(__dirname, '..', '..', '.env.local'), 'utf8');
const env = Object.fromEntries(
  envText.split('\n')
    .filter((l) => l.trim() && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')];
    })
);

const SUPABASE_URL = env['VITE_SUPABASE_URL'] || '';
const SERVICE_KEY = env['SUPABASE_SERVICE_ROLE_KEY'] || '';

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('[listNotifications] Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const supabase = createServiceClient(SUPABASE_URL, SERVICE_KEY);

async function main() {
  console.log(`[listNotifications] dryRun=${DRY_RUN}`);

  if (DRY_RUN) {
    // Report what a real run WOULD send without claiming anything. Reads the
    // log directly rather than calling the function, because the function's
    // first act is to mark rows processed — there is no non-destructive mode of
    // it, by design.
    const { data, error } = await supabase
      .from('list_change_log')
      .select('list_id, change')
      .eq('processed', false);
    if (error) {
      console.error('[listNotifications] could not read change log:', error.message);
      process.exit(1);
    }
    const byList = new Map();
    for (const row of data || []) {
      const cur = byList.get(row.list_id) || { added: 0, removed: 0, edited: 0 };
      if (row.change === 'books_added') cur.added++;
      else if (row.change === 'books_removed') cur.removed++;
      else cur.edited++;
      byList.set(row.list_id, cur);
    }
    console.log(`[listNotifications] ${data?.length || 0} pending change(s) across ${byList.size} list(s)`);
    for (const [listId, c] of byList) {
      console.log(`  ${listId}  +${c.added} -${c.removed} edits=${c.edited}`);
    }
    console.log('[listNotifications] DRY RUN — nothing claimed, nothing sent');
    return;
  }

  const { data: sent, error } = await supabase.rpc('rollup_list_notifications');
  if (error) {
    console.error('[listNotifications] rollup failed:', error.message);
    process.exit(1);
  }
  console.log(`[listNotifications] notifications=${sent ?? 0}`);

  if (!NO_PRUNE) {
    const { data: pruned, error: pruneErr } = await supabase.rpc('prune_list_change_log');
    if (pruneErr) {
      // Housekeeping failing is not worth a red run — the notifications went
      // out, which is the job. Warn and move on.
      console.warn('[listNotifications] prune failed (non-fatal):', pruneErr.message);
    } else {
      console.log(`[listNotifications] pruned=${pruned ?? 0}`);
    }
  }
}

main().catch((e) => {
  console.error('[listNotifications] fatal:', e);
  process.exit(1);
});
