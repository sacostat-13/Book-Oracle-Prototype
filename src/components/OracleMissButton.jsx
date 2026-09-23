// src/components/OracleMissButton.jsx — v0.71
//
// "None of these call to me." Sits under an Oracle result set.
// Spec: docs/pro-tier-v1-spec.md §4 · RPC: report_oracle_miss (v0.71 migration)
//
// Two jobs, in this order:
//   1. The signal. Every miss marks the draw's recommendations 'dismissed' and
//      records why — the rejected half of the provenance log, which until now
//      only ever learned about misses by their silence.
//   2. The refund. A charged free draw comes back, up to twice a month. The
//      server decides; this component only reports what it was told.
//
// Renders nothing unless the books carry recommendation ids: a draw that was
// never logged (guest, provenance failure) has nothing to report against, and
// a button that can only fail is worse than no button.
//
// Keyed by the draw: the parent passes `key={drawKey}` or the ids change, and
// the component resets itself when a new draw arrives.

import { useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useT } from '../lib/I18nContext';
import { useOracleQuota } from '../lib/OracleQuotaContext';

const REASONS = ['not_my_taste', 'already_known', 'off_request', 'other'];

export default function OracleMissButton({ surface, books }) {
  const t = useT();
  const { refresh } = useOracleQuota();

  const ids = useMemo(
    () => (books || []).map((b) => b?.recommendationId).filter((id) => id != null),
    [books]
  );
  const idsKey = ids.join(',');

  // One state object per draw, so a new draw can never inherit the last one's
  // "sent" line. Compared by the id list rather than reset in an effect.
  const [state, setState] = useState({ key: idsKey, step: 'idle', result: null });
  const current = state.key === idsKey ? state : { key: idsKey, step: 'idle', result: null };

  if (ids.length === 0) return null;

  async function send(reason) {
    setState({ key: idsKey, step: 'sending', result: null });
    try {
      const { data, error } = await supabase.rpc('report_oracle_miss', {
        p_surface: surface,
        p_recommendation_ids: ids,
        p_reason: reason,
      });
      if (error || data?.status !== 'ok') {
        // Most likely "Draw not eligible": already reported, or a book from it
        // was already taken. Either way the reader has nothing to do about it.
        if (error) console.error('report_oracle_miss failed:', error);
        setState({ key: idsKey, step: 'done', result: { refunded: false } });
        return;
      }
      setState({ key: idsKey, step: 'done', result: data });
      if (data.refunded) refresh();
    } catch (e) {
      console.error('report_oracle_miss threw:', e);
      setState({ key: idsKey, step: 'done', result: { refunded: false } });
    }
  }

  if (current.step === 'done') {
    return (
      <p className="oracle-miss__result" role="status">
        {t(current.result?.refunded ? 'oracle.missRefunded' : 'oracle.missNoted')}
      </p>
    );
  }

  if (current.step === 'asking' || current.step === 'sending') {
    const busy = current.step === 'sending';
    return (
      <div className="oracle-miss oracle-miss--open">
        <span className="oracle-miss__prompt">{t('oracle.missPrompt')}</span>
        <div className="oracle-miss__reasons">
          {REASONS.map((r) => (
            <button
              key={r}
              type="button"
              className="oracle-miss__reason"
              disabled={busy}
              onClick={() => send(r)}
            >
              {t(`oracle.missReason.${r}`)}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="oracle-miss">
      <button
        type="button"
        className="btn-tertiary btn--sm"
        onClick={() => setState({ key: idsKey, step: 'asking', result: null })}
      >
        {t('oracle.missButton')}
      </button>
    </div>
  );
}
