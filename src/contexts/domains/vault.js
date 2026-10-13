// src/contexts/domains/vault.js — the Vault: the curated catalogue every
// curator's shelves feed, loaded once per session.

import { useCallback, useState } from 'react';
import { supabase } from '../../lib/api/supabase';
import { ALL_BOOKS } from '../../lib/book/bookHelpers';
import { bookRowToClient } from '../../lib/book/bookRow';

/**
 * Called once by DataProvider; returns vault, loadVault.
 * Takes no arguments.
 */
export function useVault() {
  // ---------- The Vault ----------
  // v0.49 Vault Source Upgrade: the Vault is fed by the get_curated_catalog
  // RPC — the union of every curator's wishlist (taste) and library
  // (experience; explicit ratings < 3 excluded server-side, unrated reads
  // kept). Guests get the same catalog: the function is granted to anon and
  // exposes no PII. This replaces both the old source='curated' books query
  // (signed-in) and the bundled ALL_BOOKS seed (guests) — ALL_BOOKS is now
  // only the emergency fallback when the RPC fails or returns empty.
  // Rows carry vault_source ('wishlist'|'library'|'both') and curator_rating
  // — stored on the client book as future ranking signal, unused for now.
  const [vault, setVault] = useState(null);
  const loadVault = useCallback(async () => {
    if (vault) return vault;
    try {
      // PostgREST caps every response at the project's Max Rows setting
      // (default 1000) — including RPC results — so a single call silently
      // truncates once the catalog outgrows it (first seen at 1352 books).
      // Paginate with .range() until a short page, same tradeoff
      // og-prerender.js makes. Ordering is stable (the function orders by
      // title), so pages don't overlap. MAX_PAGES is a runaway guard.
      const PAGE_SIZE = 1000;
      const MAX_PAGES = 20;
      const rows = [];
      for (let page = 0; page < MAX_PAGES; page++) {
        const { data, error } = await supabase
          .rpc('get_curated_catalog')
          .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
        if (error) throw error;
        if (!Array.isArray(data)) break;
        rows.push(...data);
        if (data.length < PAGE_SIZE) break;
      }
      if (rows.length > 0) {
        const v = rows.map((b) => bookRowToClient(b, {
          vaultSource: b.vault_source || undefined,
          curatorRating: b.curator_rating ?? undefined,
        }));
        setVault(v);
        return v;
      }
      console.error('Vault RPC returned empty');
    } catch (err) {
      console.error('Vault RPC failed', err);
    }
    const v = ALL_BOOKS.map((b) => ({ ...b, status: 'verified', verifiedSource: 'curated_seed', source: 'curated' }));
    setVault(v);
    return v;
  }, [vault]);

  return { vault, loadVault };
}
