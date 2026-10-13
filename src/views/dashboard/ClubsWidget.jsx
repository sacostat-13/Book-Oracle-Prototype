import Avatar from '../../components/Avatar';
import CoverThumb from '../../components/CoverThumb';
import { IconDiamond, WidgetShell } from './WidgetShell';

export default function ClubsWidget({ clubs, summary, go, t }) {
  if (!clubs?.length) return null;
  // summary === null while the get_dashboard_clubs_summary RPC is still loading —
  // fall back to the plain name/member-count row for that brief window rather
  // than blocking the whole widget.
  const summaryById = new Map((summary || []).map((s) => [s.id, s]));

  return (
    <WidgetShell icon={<IconDiamond />} label={t('dashboard.yourClubs')}>
      <div className="db-clubs-list">
        {clubs.map((c) => {
          const s = summaryById.get(c.id);
          const hasBook = s?.current_book_title;
          return (
            <div key={c.id} className="db-club-row"
              onClick={() => go('book-club-detail', { clubId: c.id })}>

              {hasBook && (
                <CoverThumb book={{ coverUrl: s.current_book_cover, t: s.current_book_title }} width={44} />
              )}

              <div className="db-club-body">
                <div className="db-club-row__head">
                  <div className="db-club-title">{c.name}</div>
                  {s?.session_number && s.session_status && (
                    <span className={`db-club-session-badge db-club-session-badge--${s.session_status}`}>
                      {t('dashboard.clubSession', { n: s.session_number })}
                    </span>
                  )}
                </div>
                <div className="db-club-meta">
                  {hasBook
                    ? t('dashboard.clubReadingMeta', { title: s.current_book_title })
                    : (s?.member_count
                      ? t('dashboard.clubMemberCount', { count: s.member_count })
                      : (c.memberCount ? t('dashboard.clubMemberCount', { count: c.memberCount }) : ''))}
                </div>
                {s?.member_avatars?.length > 0 && (
                  <div className="db-club-avatars">
                    <div className="db-club-avatars__stack">
                      {s.member_avatars.slice(0, 3).map((m, i) => (
                        <Avatar key={i} displayName={m.display_name} avatarUrl={m.avatar_url} />
                      ))}
                    </div>
                    {s.member_count > 3 && (
                      <span className="db-club-avatars__more">
                        {t('dashboard.clubReadingAlong', { count: s.member_count - 3 })}
                      </span>
                    )}
                  </div>
                )}
              </div>

              <div className="db-club-cta">{t('dashboard.viewPlan')}</div>
            </div>
          );
        })}
      </div>
    </WidgetShell>
  );
}
