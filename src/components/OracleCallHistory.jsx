// src/components/OracleCallHistory.jsx — v0.58
//
// "I used my free calls up pretty quickly and I'm not actually fully sure how."
//
// A counter cannot answer that; this can. Collapsed behind a History button in
// Profile → Subscription, directly under the quota bar it explains.
//
// Two registers, deliberately:
//   - a breakdown of the CURRENT period, which reconciles line-for-line with
//     the bar above it. This is the part that answers the question.
//   - a paginated log going back further, for anyone who wants to check.
//
// Rows carry no book titles, questions or plan goals — only which surface and
// when (schema_v44). The quota page should not double as a record of what
// someone has been reading and wondering about.

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useT, useI18n } from '../lib/I18nContext';

const PAGE_SIZE = 20;

// Falls back to the raw key rather than "undefined" if a future surface ships
// its label before its translation.
function sourceLabel(t, source) {
  const key = `oracleHistory.source.${source}`;
  const label = t(key);
  return label === key ? source : label;
}

export default function OracleCallHistory() {
  const t = useT();
  const { lang } = useI18n();
  const [open, setOpen]       = useState(false);
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(false);
  const [offset, setOffset]   = useState(0);
  const [entries, setEntries] = useState([]);

  const load = useCallback(async (nextOffset) => {
    setLoading(true);
    setError(false);
    const { data: res, error: err } = await supabase.rpc('get_oracle_call_history', {
      p_limit: PAGE_SIZE, p_offset: nextOffset,
    });
    setLoading(false);
    if (err || !res || res.status === 'error') {
      console.error('get_oracle_call_history error:', err || res);
      setError(true);
      return;
    }
    setData(res);
    // Append on "load more", replace on first open, so paging back through a
    // long history doesn't refetch what's already on screen.
    setEntries((prev) => (nextOffset === 0 ? res.entries : [...prev, ...res.entries]));
    setOffset(nextOffset);
  }, []);

  // Refetch on every open, not just the first. Someone who opens this, spends
  // a call in another tab and opens it again is checking precisely because
  // they expect the number to have moved.
  useEffect(() => {
    if (open) load(0);
  }, [open, load]);

  const totals = data?.period_totals || {};
  const totalEntries = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  const spentThisPeriod = totalEntries.reduce((n, [, v]) => n + v, 0);
  const isDay = data?.period === 'day';

  return (
    <div className="oracle-history">
      <button
        className="btn-text btn--sm oracle-history__toggle"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        {open ? t('oracleHistory.hide') : t('oracleHistory.show')}
      </button>

      {open && (
        <div className="oracle-history__panel">
          {loading && entries.length === 0 && (
            <p className="db-ai__note">{t('oracleHistory.loading')}</p>
          )}

          {error && (
            <p className="db-ai__note">
              {t('oracleHistory.error')}{' '}
              <button className="btn-text btn--sm" onClick={() => load(0)}>
                {t('oracleHistory.retry')}
              </button>
            </p>
          )}

          {data && !error && (
            <>
              {/* Current period — the part that reconciles with the bar above */}
              <div className="oracle-history__summary">
                <div className="oracle-history__summary-title">
                  {t(isDay ? 'oracleHistory.summaryToday' : 'oracleHistory.summaryMonth', {
                    count: spentThisPeriod,
                  })}
                </div>
                {totalEntries.length > 0 ? (
                  <ul className="oracle-history__breakdown">
                    {totalEntries.map(([source, n]) => (
                      <li key={source}>
                        <span>{sourceLabel(t, source)}</span>
                        <span className="oracle-history__count">{n}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="db-ai__note">
                    {t(isDay ? 'oracleHistory.noneToday' : 'oracleHistory.noneMonth')}
                  </p>
                )}
              </div>

              <div className="session-divider" style={{ width: 48, margin: '4px 0' }} />

              {/* Full log */}
              {entries.length === 0 ? (
                <p className="db-ai__note">{t('oracleHistory.empty')}</p>
              ) : (
                <ul className="oracle-history__list">
                  {entries.map((e) => (
                    <li key={e.id} className="oracle-history__row">
                      <span className="oracle-history__source">
                        {sourceLabel(t, e.source)}
                      </span>
                      <span className="oracle-history__when">
                        {new Date(e.created_at).toLocaleString(lang === 'es' ? 'es-AR' : undefined, {
                          month: 'short', day: 'numeric',
                          hour: '2-digit', minute: '2-digit',
                        })}
                      </span>
                      {/* An uncharged row is the useful one: it is the proof
                          that a 40-book categorization run cost one call and
                          not eight. */}
                      <span className={`oracle-history__cost${e.charged ? '' : ' oracle-history__cost--free'}`}>
                        {e.charged
                          ? t('oracleHistory.costOne')
                          : t(e.period === 'exempt' ? 'oracleHistory.costExempt' : 'oracleHistory.costRun')}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              {data.has_more && (
                <button
                  className="btn-text btn--sm"
                  disabled={loading}
                  onClick={() => load(offset + PAGE_SIZE)}
                >
                  {loading ? t('oracleHistory.loading') : t('oracleHistory.loadMore')}
                </button>
              )}

              <p className="oracle-history__note">{t('oracleHistory.privacyNote')}</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
