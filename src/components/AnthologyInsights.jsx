// src/components/AnthologyInsights.jsx — v0.74
//
// "Which of your Anthologies moves readers." Sits on the owner's Anthologies
// page. Free: one line with the month's views, and the door to Pro. Pro: every
// public Anthology ranked by the last 30 days.
//
// Counts only, by construction — get_anthology_insights never returns who.
// Adds and signups under 5 come back null and read as "fewer than 5".

import { useEffect, useState } from 'react';
import { useT } from '../lib/I18nContext';
import { useProLimits } from '../lib/proGates';
import { fetchAnthologyInsights } from '../lib/anthologyInsights';

function Small({ value, k, t }) {
  if (value == null) return <span className="anth-insights__few">{t('insights.fewer', { k })}</span>;
  return <>{value}</>;
}

export default function AnthologyInsights({ listCount = 0 }) {
  const t = useT();
  const { goUpgrade } = useProLimits();
  const [data, setData] = useState(null);

  useEffect(() => {
    let cancelled = false;
    if (listCount === 0) return undefined;
    fetchAnthologyInsights().then((d) => { if (!cancelled) setData(d); });
    return () => { cancelled = true; };
  }, [listCount]);

  if (!data || !data.lists?.length) return null;

  const publicLists = data.lists.filter((l) => l.is_public);
  const views30 = data.lists.reduce((n, l) => n + (l.views_30d || 0), 0);

  if (!data.pro) {
    return (
      <section className="anth-insights anth-insights--free">
        <p className="anth-insights__lead">
          {publicLists.length === 0 ? t('insights.freeNoPublic') : t('insights.freeLead', { count: views30 })}
        </p>
        <button type="button" className="btn-tertiary btn--sm" onClick={goUpgrade}>
          ✦ {t('insights.freeCta')}
        </button>
      </section>
    );
  }

  return (
    <section className="anth-insights">
      <h2 className="anth-insights__title">{t('insights.title')}</h2>
      <p className="anth-insights__lead">{t('insights.lead')}</p>
      {publicLists.length === 0 ? (
        <p className="db-ai__note">{t('insights.noPublic')}</p>
      ) : (
        <div className="anth-insights__scroll">
          <table className="anth-insights__table">
            <thead>
              <tr>
                <th scope="col">{t('insights.colAnthology')}</th>
                <th scope="col">{t('insights.colVisitors')}</th>
                <th scope="col">{t('insights.colViews')}</th>
                <th scope="col">{t('insights.colOpens')}</th>
                <th scope="col">{t('insights.colFollowers')}</th>
                <th scope="col">{t('insights.colAdds')}</th>
                <th scope="col">{t('insights.colSignups')}</th>
              </tr>
            </thead>
            <tbody>
              {publicLists.map((l) => (
                <tr key={l.list_id}>
                  <th scope="row">{l.title}</th>
                  <td>{l.visitors_30d}</td>
                  <td>{l.views_30d}</td>
                  <td>{l.opens_30d}</td>
                  <td>{l.followers}</td>
                  <td><Small value={l.adds_all} k={data.k} t={t} /></td>
                  <td><Small value={l.signups_all} k={data.k} t={t} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="db-ai__note">{t('insights.privacy', { k: data.k })}</p>
    </section>
  );
}
