-- Curators are not Pro. 2026-10-13 (code-health Sprint 3).
--
-- Curator and Pro are separate things: curator is a granted role (Vault
-- catalogue, unmetered categorization), Pro is a paid subscription. Until now
-- is_pro() also returned true for curators, so every curator got every Pro
-- feature for free: unlimited clubs / Anthologies / Passages, Anthology covers,
-- the insights breakdown, and (via claude.js) the Pro-only Oracle sources.
-- Decision (Simon, 2026-10-13): a future curator should not get Pro for free.
--
-- Unchanged: curators' own privileges — the Vault, and categorization running
-- outside the call quota (oracle quota RPCs, 20260923120000).
--
-- Mirrored in src/hooks/useProLimits.js isProAccount() and
-- netlify/functions/claude.js. To revert, add `or is_curator` back here and
-- in those two places.
--
-- Idempotent.

create or replace function public.is_pro(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select subscription_status = 'active' from public.profiles where id = p_uid),
    false
  );
$$;

revoke execute on function public.is_pro(uuid) from public, anon;
grant  execute on function public.is_pro(uuid) to authenticated, service_role;
