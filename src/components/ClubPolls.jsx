// src/components/ClubPolls.jsx — v0.29
// Handles the full polls section of a club detail page:
//   - List of open + closed polls with voting
//   - Admin: create a poll manually or trigger the Oracle for suggestions
//   - Oracle flow: Claude suggests 3 books → becomes a poll automatically
//
// Props:
//   clubId    — the club's UUID
//   clubName  — for Oracle prompt context
//   clubGenres— genre names for Oracle context
//   isAdmin   — controls create/close actions
//   recentBooks — books from past sessions for Oracle context (title, author)

import { useState, useEffect, useCallback } from 'react';
import { useData } from '../lib/DataContext';
import { useAuth } from '../lib/AuthContext';
import { supabase } from '../lib/supabase';
import BookCover from './BookCover';
import { callClaude, QuotaExceededError } from '../lib/claudeApi';
import { useT } from '../lib/I18nContext';
import { useOracleQuota } from '../lib/OracleQuotaContext';

// ── Oracle suggestion flow ────────────────────────────────────────────────────

async function fetchOracleSuggestions({ clubName, clubGenres = [], recentBooks = [] }) {
  const t = useT();
  const { handleQuotaError, onCallSucceeded } = useOracleQuota();
  const genreList = clubGenres.join(', ') || 'general fiction';
  const recentList = recentBooks.length
    ? recentBooks.map((b) => `"${b.title}" by ${b.author}`).join(', ')
    : 'no books read yet';

  const prompt = `You are suggesting books for a book club called "${clubName}".
Club genres: ${genreList}.
Recently read: ${recentList}.

Suggest exactly 3 books that would make great next reads for this club.
Each suggestion must be a real, published book.

Respond with ONLY valid JSON — no preamble, no markdown, no explanation:
[
  {"title": "...", "author": "...", "reason": "one sentence why this fits the club"},
  {"title": "...", "author": "...", "reason": "..."},
  {"title": "...", "author": "...", "reason": "..."}
]`;

  const systemPrompt = 'You are a knowledgeable book curator. Respond only with the JSON array requested. No preamble, no markdown fences.';

  let raw = null;
  try {
    raw = await callClaude(prompt, systemPrompt);
    onCallSucceeded?.();
  } catch (err) {
    if (err instanceof QuotaExceededError) {
      handleQuotaError(err);
      return null; // caller checks for null
    }
    throw err;
  }
  const text = typeof raw === 'string' ? raw : raw?.content?.[0]?.text || '';
  const clean = text.replace(/```json|```/g, '').trim();
  return JSON.parse(clean);
}

// ── Poll option card ──────────────────────────────────────────────────────────

function PollOptionCard({ option, selected, myVote, totalVotes, closed, onVote }) {
  const t = useT();
  const isLeading = option.vote_count > 0 && !closed
    ? false
    : option.vote_count === Math.max(...([])); // handled by parent
  const pct = totalVotes > 0 ? Math.round((option.vote_count / totalVotes) * 100) : 0;
  const isMyVote = myVote === option.id;

  return (
    <div
      onClick={!closed ? () => onVote(option.id) : undefined}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.75rem',
        padding: '0.65rem 0.85rem',
        border: `1px solid ${isMyVote ? 'rgba(176,140,63,0.5)' : 'rgba(176,140,63,0.15)'}`,
        borderRadius: 2,
        background: isMyVote ? 'rgba(176,140,63,0.07)' : 'transparent',
        cursor: closed ? 'default' : 'pointer',
        transition: 'all 0.15s',
        position: 'relative',
        overflow: 'hidden',
      }}
      onMouseEnter={(e) => { if (!closed) e.currentTarget.style.background = 'rgba(176,140,63,0.05)'; }}
      onMouseLeave={(e) => { if (!closed && !isMyVote) e.currentTarget.style.background = 'transparent'; }}
    >
      {/* Vote fill bar behind content */}
      {(closed || myVote) && totalVotes > 0 && (
        <div style={{
          position: 'absolute', left: 0, top: 0, bottom: 0,
          width: `${pct}%`,
          background: isMyVote ? 'rgba(176,140,63,0.1)' : 'rgba(176,140,63,0.04)',
          transition: 'width 0.4s ease',
          pointerEvents: 'none',
        }} />
      )}

      {/* Cover thumbnail */}
      {option.cover_url && (
        <div style={{ width: 28, height: 42, flexShrink: 0, overflow: 'hidden', borderRadius: 1, zIndex: 1 }}>
          <BookCover title={option.label} author={option.book_author} coverUrl={option.cover_url} />
        </div>
      )}

      {/* Label + author */}
      <div style={{ flex: 1, minWidth: 0, zIndex: 1 }}>
        <div style={{ fontFamily: 'var(--ro-font-display)', fontStyle: 'italic', fontSize: '1rem', color: 'var(--paper)', lineHeight: 1.2 }}>
          {option.label}
        </div>
        {option.book_author && (
          <div style={{ fontSize: '0.78rem', color: 'var(--paper-aged)', opacity: 0.6, marginTop: 1 }}>
            {option.book_author}
          </div>
        )}
      </div>

      {/* Vote count / % */}
      {(myVote || closed) && totalVotes > 0 && (
        <div style={{ fontFamily: 'var(--ro-font-mono)', fontSize: '0.72rem', letterSpacing: '0.06em', color: isMyVote ? 'var(--gilt)' : 'var(--paper-aged)', opacity: isMyVote ? 1 : 0.5, flexShrink: 0, zIndex: 1 }}>
          {option.vote_count} · {pct}%
        </div>
      )}

      {/* My vote indicator */}
      {isMyVote && (
        <div style={{ fontFamily: 'var(--ro-font-mono)', fontSize: '0.65rem', color: 'var(--gilt)', flexShrink: 0, zIndex: 1 }}>
          ✦
        </div>
      )}
    </div>
  );
}

// ── Single poll card ──────────────────────────────────────────────────────────

function PollCard({ poll, isAdmin, onVote, onClose, onDelete, onCreateSession }) {
  const t = useT();
  const { user } = useAuth();
  const totalVotes = poll.options.reduce((s, o) => s + Number(o.vote_count), 0);
  const maxVotes = Math.max(...poll.options.map((o) => Number(o.vote_count)), 0);
  const winner = poll.closed && poll.options.find((o) => Number(o.vote_count) === maxVotes && maxVotes > 0);

  const fmtDate = (d) => new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  return (
    <div style={{ padding: '1.25rem', border: '1px solid rgba(176,140,63,0.2)', borderRadius: 2, marginBottom: '1rem' }}>
      {/* Poll header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.75rem', marginBottom: '0.85rem' }}>
        <div style={{ flex: 1 }}>
          {poll.is_oracle_pick && (
            <div style={{ fontFamily: 'var(--ro-font-mono)', fontSize: '0.6rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--gilt)', opacity: 0.8, marginBottom: '0.25rem' }}>
              {t('polls.oracleLabel')}
            </div>
          )}
          <div style={{ fontFamily: 'var(--ro-font-display)', fontStyle: 'italic', fontSize: '1.1rem', color: 'var(--paper)', lineHeight: 1.3 }}>
            {poll.question}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--paper-aged)', opacity: 0.4, marginTop: '0.25rem', fontFamily: 'var(--ro-font-mono)', letterSpacing: '0.04em' }}>
            {totalVotes} vote{totalVotes !== 1 ? 's' : ''}
            {poll.closes_at && !poll.closed && ` · ${t('polls.closesOn', { date: fmtDate(poll.closes_at) })}`}
            {poll.closed && t('polls.closed')}
          </div>
        </div>
        {isAdmin && (
          <div style={{ display: 'flex', gap: '0.35rem', flexShrink: 0 }}>
            {!poll.closed && (
              <button className="li-action" style={{ fontSize: '0.7rem' }} onClick={() => onClose(poll.id)}>
                {t('polls.closePoll')}
              </button>
            )}
            <button className="li-action danger" style={{ fontSize: '0.7rem' }} onClick={() => onDelete(poll.id)}>
              {t('polls.deletePoll')}
            </button>
          </div>
        )}
      </div>

      {/* Options */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
        {poll.options.map((opt) => (
          <PollOptionCard
            key={opt.id}
            option={opt}
            myVote={poll.my_vote}
            totalVotes={totalVotes}
            closed={poll.closed}
            onVote={(optionId) => onVote(poll.id, optionId)}
          />
        ))}
      </div>

      {/* Winner + create session CTA */}
      {winner && isAdmin && !poll.result_session_id && (
        <div style={{ marginTop: '0.85rem', padding: '0.65rem 0.85rem', background: 'rgba(176,140,63,0.07)', borderRadius: 2 }}>
          <div style={{ fontFamily: 'var(--ro-font-mono)', fontSize: '0.68rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--gilt)', marginBottom: '0.4rem' }}>
            Winner: {winner.label}
          </div>
          <button className="li-action" onClick={() => onCreateSession(winner)}>
            {t('polls.createSessionFromWinner')}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Create poll form ──────────────────────────────────────────────────────────

function CreatePollForm({ onAdd, onCancel }) {
  const t = useT();
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState([{ label: '' }, { label: '' }]);
  const [saving, setSaving] = useState(false);

  function setOptionLabel(i, val) {
  const t = useT();
    setOptions((opts) => opts.map((o, idx) => idx === i ? { ...o, label: val } : o));
  }

  const validOptions = options.filter((o) => o.label.trim()).length >= 2;

  async function handleAdd() {
  const t = useT();
    if (!question.trim() || !validOptions || saving) return;
    setSaving(true);
    await onAdd({
      question: question.trim(),
      options: options.filter((o) => o.label.trim()).map((o) => ({ label: o.label.trim() })),
      isOraclePick: false,
    });
    setSaving(false);
  }

  return (
    <div style={{ padding: '1rem', border: '1px solid rgba(176,140,63,0.2)', borderRadius: 2, marginBottom: '1rem', background: 'rgba(176,140,63,0.03)' }}>
      <div style={{ fontFamily: 'var(--ro-font-mono)', fontSize: '0.7rem', letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--gilt)', marginBottom: '0.75rem' }}>
        {t('polls.newPollLabel')}
      </div>
      <div style={{ marginBottom: '0.75rem' }}>
        <input
          {...{placeholder: t('polls.oraclePollQuestion')}}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          autoFocus
          style={{ width: '100%', boxSizing: 'border-box', background: 'rgba(176,140,63,0.04)', border: '1px solid rgba(176,140,63,0.25)', borderRadius: 2, padding: '0.5rem 0.75rem', color: 'var(--paper)', fontFamily: 'var(--ro-font-display)', fontSize: '1rem', colorScheme: 'dark' }}
        />
      </div>
      {options.map((opt, i) => (
        <div key={i} style={{ marginBottom: '0.4rem', display: 'flex', gap: '0.4rem' }}>
          <input
            {...{placeholder: t('polls.optionPlaceholder', { n: i + 1 })}}
            value={opt.label}
            onChange={(e) => setOptionLabel(i, e.target.value)}
            style={{ flex: 1, background: 'rgba(176,140,63,0.04)', border: '1px solid rgba(176,140,63,0.2)', borderRadius: 2, padding: '0.45rem 0.7rem', color: 'var(--paper)', fontFamily: 'var(--ro-font-display)', fontSize: '0.95rem', colorScheme: 'dark' }}
          />
          {options.length > 2 && (
            <button className="li-action danger" style={{ fontSize: '0.7rem' }} onClick={() => setOptions((o) => o.filter((_, idx) => idx !== i))}>✕</button>
          )}
        </div>
      ))}
      {options.length < 5 && (
        <button className="li-action" style={{ fontSize: '0.72rem', marginTop: '0.35rem' }} onClick={() => setOptions((o) => [...o, { label: '' }])}>
          {t('polls.addOption')}
        </button>
      )}
      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.85rem' }}>
        <button className="btn btn-ghost" onClick={onCancel} style={{ fontSize: '0.85rem' }}>{t('polls.cancel')}</button>
        <button className="btn" onClick={handleAdd} disabled={!question.trim() || !validOptions || saving} style={{ fontSize: '0.85rem' }}>
          {saving ? t('polls.creating') : t('polls.createPollBtn')}
        </button>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ClubPolls({ clubId, clubName, clubGenres = [], isAdmin, recentBooks = [], onCreateSession }) {
  const t = useT();
  const { createPoll, castVote, closePoll, deletePoll } = useData();
  const [polls, setPolls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [oracleLoading, setOracleLoading] = useState(false);
  const [oracleError, setOracleError] = useState(null);

  const loadPolls = useCallback(async () => {
    const { data, error } = await supabase.rpc('get_club_polls', { p_club_id: clubId });
    setLoading(false);
    if (!error && data) setPolls(data);
  }, [clubId]);

  useEffect(() => { loadPolls(); }, [loadPolls]);

  async function handleVote(pollId, optionId) {
  const t = useT();
    const updatedCounts = await castVote(pollId, optionId);
    if (!updatedCounts) return;
    // Optimistically update vote counts + my_vote
    setPolls((ps) => ps.map((p) => {
      if (p.id !== pollId) return p;
      return {
        ...p,
        my_vote: optionId,
        options: p.options.map((o) => {
          const found = updatedCounts.find((u) => u.id === o.id);
          return found ? { ...o, vote_count: found.vote_count } : o;
        }),
      };
    }));
  }

  async function handleClose(pollId) {
  const t = useT();
    await closePoll(pollId);
    setPolls((ps) => ps.map((p) => p.id === pollId ? { ...p, closed: true } : p));
  }

  async function handleDelete(pollId) {
  const t = useT();
    if (!confirm(t('polls.confirmDeletePoll'))) return;
    await deletePoll(pollId);
    setPolls((ps) => ps.filter((p) => p.id !== pollId));
  }

  async function handleCreate({ question, options, isOraclePick }) {
  const t = useT();
    const poll = await createPoll({ clubId, question, options, isOraclePick });
    if (poll) { setShowCreate(false); await loadPolls(); }
  }

  async function handleOracleSuggest() {
  const t = useT();
    setOracleLoading(true);
    setOracleError(null);
    try {
      const suggestions = await fetchOracleSuggestions({ clubName, clubGenres, recentBooks });
      // Turn Oracle suggestions into a poll automatically
      await handleCreate({
        question: t('polls.oraclePollQuestion'),
        options: suggestions.map((s) => ({
          label: s.title,
          bookAuthor: s.author,
          coverUrl: null,
        })),
        isOraclePick: true,
      });
    } catch (e) {
      console.error('Oracle suggest failed', e);
      setOracleError(t('polls.oracleError'));
    }
    setOracleLoading(false);
  }

  if (loading) return null;

  const openPolls = polls.filter((p) => !p.closed);
  const closedPolls = polls.filter((p) => p.closed);

  return (
    <section style={{ marginBottom: '2.5rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.85rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div style={{ fontFamily: 'var(--ro-font-mono)', fontSize: '0.7rem', letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--gilt)' }}>
          Polls
        </div>
        {isAdmin && (
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
            <button
              className="li-action"
              onClick={handleOracleSuggest}
              disabled={oracleLoading}
              style={{ color: 'var(--gilt)', fontSize: '0.72rem' }}
            >
              {oracleLoading ? t('polls.oracleThinking') : t('polls.oracleSuggestsBtn')}
            </button>
            {!showCreate && (
              <button className="li-action" style={{ fontSize: '0.72rem' }} onClick={() => setShowCreate(true)}>
                {t('polls.newPoll')}
              </button>
            )}
          </div>
        )}
      </div>

      {oracleError && (
        <div style={{ fontSize: '0.82rem', color: 'rgba(180,60,60,0.8)', marginBottom: '0.75rem' }}>
          {oracleError}
        </div>
      )}

      {showCreate && (
        <CreatePollForm onAdd={handleCreate} onCancel={() => setShowCreate(false)} />
      )}

      {polls.length === 0 && !showCreate && (
        <div style={{ color: 'var(--ro-text-dim)', fontStyle: 'italic', fontSize: '0.88rem' }}>
          {isAdmin ? t('polls.noPollsAdmin') : t('polls.noPolls')}
        </div>
      )}

      {/* Open polls */}
      {openPolls.map((poll) => (
        <PollCard
          key={poll.id}
          poll={poll}
          isAdmin={isAdmin}
          onVote={handleVote}
          onClose={handleClose}
          onDelete={handleDelete}
          onCreateSession={onCreateSession}
        />
      ))}

      {/* Closed polls */}
      {closedPolls.length > 0 && (
        <>
          <div style={{ fontFamily: 'var(--ro-font-mono)', fontSize: '0.65rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--paper-aged)', opacity: 0.35, margin: '1rem 0 0.75rem' }}>
            {t('polls.pastPolls')}
          </div>
          {closedPolls.map((poll) => (
            <PollCard
              key={poll.id}
              poll={poll}
              isAdmin={isAdmin}
              onVote={handleVote}
              onClose={handleClose}
              onDelete={handleDelete}
              onCreateSession={onCreateSession}
            />
          ))}
        </>
      )}
    </section>
  );
}
