-- schema_v29_migration.sql
-- v0.39: Pin search_path on SECURITY DEFINER functions (rls_audit.sql
-- section F findings).
--
-- A SECURITY DEFINER function without a pinned search_path resolves
-- unqualified table/function names through the CALLER's search_path, so a
-- malicious user who can create objects in a schema earlier in that path
-- could shadow a table the function reads and run their code with the
-- function owner's privileges. Pinning to 'public' closes this.
--
-- Flagged: get_curated_catalog(), get_public_list(p_list_id),
-- get_public_plan(p_plan_id). The latter two were created in the dashboard
-- and have no committed DDL, so we resolve their exact signatures from
-- pg_proc instead of hardcoding argument types.
--
-- Safe to re-run: already-pinned functions are skipped by the audit filter
-- but re-altering them is harmless anyway.

do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as sig
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.prosecdef
      and p.proname in ('get_curated_catalog', 'get_public_list', 'get_public_plan')
  loop
    execute format('alter function %s set search_path = public', fn.sig);
    raise notice 'pinned search_path on %', fn.sig;
  end loop;
end $$;

-- ── Verification (should return zero rows) ────────────────────────────────────
-- select p.proname, p.proconfig
-- from pg_proc p
-- where p.pronamespace = 'public'::regnamespace
--   and p.prosecdef
--   and (p.proconfig is null
--        or not exists (select 1 from unnest(p.proconfig) cfg
--                       where cfg like 'search_path=%'));
