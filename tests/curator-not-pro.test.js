// Curator and Pro are separate (decided 2026-10-13). Pro is an active
// subscription and nothing else, in all three places that decide it.

import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

vi.mock('../src/contexts/DataContext', () => ({ useData: () => ({}) }));
vi.mock('../src/contexts/AuthContext', () => ({ useAuth: () => ({}) }));
vi.mock('../src/contexts/OracleQuotaContext', () => ({ useOracleQuota: () => ({}) }));
vi.mock('../src/contexts/RouterContext', () => ({ useRouter: () => ({}) }));

const { isProAccount } = await import('../src/hooks/useProLimits.js');
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

describe('who is Pro', () => {
  it.each([
    ['active subscriber', { subscription_status: 'active' }, true],
    ['active subscriber who is also a curator', { subscription_status: 'active', is_curator: true }, true],
    ['curator without a subscription', { subscription_status: null, is_curator: true }, false],
    ['cancelled subscription', { subscription_status: 'canceled' }, false],
    ['quota not loaded', null, false],
  ])('%s', (_, quota, expected) => {
    expect(isProAccount(quota)).toBe(expected);
  });

  it('the newest public.is_pro() does not count curators', () => {
    const dir = new URL('../supabase/migrations/', import.meta.url);
    const latest = readdirSync(dir).sort().filter((f) => read(`../supabase/migrations/${f}`).includes('function public.is_pro(')).pop();
    const sql = read(`../supabase/migrations/${latest}`);
    const body = sql.slice(sql.indexOf('function public.is_pro('), sql.indexOf('$$;', sql.indexOf('function public.is_pro(')));
    expect(body).toContain("subscription_status = 'active'");
    expect(body).not.toContain('is_curator');
  });

  it("claude.js gates Pro-only sources on the subscription alone", () => {
    const src = read('../netlify/functions/claude.js');
    const line = src.split('\n').find((l) => l.includes('PRO_ONLY_SOURCES.includes(source)'));
    expect(line).toContain("subscription_status !== 'active'");
    expect(line).not.toContain('is_curator');
  });
});
