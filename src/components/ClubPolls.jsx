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
    <div onClick={!closed ? () => onVote(option.id) : undefined} className={`poll-option${isMyVote ? ' poll-option--selected' : ''}`}>
      {/* Vote fill bar behind content */}
      {(closed || myVote) && totalVotes > 0 && (
        <div className="poll-option__bar" style={{ '--poll-pct': `${pct}%` }} />
      )}

      {/* Cover thumbnail */}
      {option.cover_url && (
        <div className="poll-option__cover--placeholder">
          <BookCover title={option.label} author={option.book_author} coverUrl={option.cover_url} />
        </div>
      )}

      {/* Label + author */}
      <div className="poll-option__body">
        <div className="poll-option__title">
          {option.label}
        </div>
        {option.book_author && (
          <div className="poll-option__author">
            {option.book_author}
          </div>
        )}
      </div>

      {/* Vote count / % */}
      {(myVote || closed) && totalVotes > 0 && (
        <div className={`poll-option__votes${isMyVote ? ' poll-option__votes--mine' : ' poll-option__votes--other'}`}>
          {option.vote_count} · {pct}%
        </div>
      )}

      {/* My vote indicator */}
      {isMyVote && (
        <div className="poll-option__leader">
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
    <div className="poll-card">
      {/* Poll header */}
      <div className="poll-card__head">
        <div className="poll-card__body">
          {poll.is_oracle_pick && (
            <div className="session-section-label">
              {t('polls.oracleLabel')}
            </div>
          )}
          <div className="poll-card__question">
            {poll.question}
          </div>
          <div className="poll-card__meta">
            {totalVotes} vote{totalVotes !== 1 ? 's' : ''}
            {poll.closes_at && !poll.closed && ` · ${t('polls.closesOn', { date: fmtDate(poll.closes_at) })}`}
            {poll.closed && t('polls.closed')}
          </div>
        </div>
        {isAdmin && (
          <div className="poll-card__actions">
            {!poll.closed && (
              <button className="btn tn-accent" onClick={() => onClose(poll.id)}>
                {t('polls.closePoll')}
              </button>
            )}
            <button className="btn btn-danger" onClick={() => onDelete(poll.id)}>
              {t('polls.deletePoll')}
            </button>
          </div>
        )}
      </div>

      {/* Options */}
      <div className="poll-compose">
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
        <div className="session-form__book-row">
          <div className="session-section-label">
            Winner: {winner.label}
          </div>
          <button className="btn btn-primary" onClick={() => onCreateSession(winner)}>
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
    <div className="poll-card">
      <div className="session-section-label">
        {t('polls.newPollLabel')}
      </div>
      <div >
        <input
          {...{ placeholder: t('polls.oraclePollQuestion') }}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          autoFocus
          className="input"
        />
      </div>
      {options.map((opt, i) => (
        <div key={i} className="club-form__actions">
          <input
            {...{ placeholder: t('polls.optionPlaceholder', { n: i + 1 }) }}
            value={opt.label}
            onChange={(e) => setOptionLabel(i, e.target.value)}
            className="input"
          />
          {options.length > 2 && (
            <button className="btn-secondary" onClick={() => setOptions((o) => o.filter((_, idx) => idx !== i))}>✕</button>
          )}
        </div>
      ))}
      {options.length < 5 && (
        <button className="btn btn-secondary" onClick={() => setOptions((o) => [...o, { label: '' }])}>
          {t('polls.addOption')}
        </button>
      )}
      <div className="club-form__actions">
        <button className="btn-tertiary" onClick={onCancel}>{t('polls.cancel')}</button>
        <button className="btn-primary" onClick={handleAdd} disabled={!question.trim() || !validOptions || saving}>
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
    <section className="db-section" style={{ marginTop: '32px' }}>
      {/* Header */}
      <div className="club-card__head">
        <div className="session-section-label">
          Polls
        </div>
        {isAdmin && (
          <div className="club-card__actions">
            <button
              className="btn btn-accent"
              onClick={handleOracleSuggest}
              disabled={oracleLoading}

            >
              {oracleLoading ? t('polls.oracleThinking') : t('polls.oracleSuggestsBtn')}
            </button>
            {!showCreate && (
              <button className="btn btn-secondary" onClick={() => setShowCreate(true)}>
                {t('polls.newPoll')}
              </button>
            )}
          </div>
        )}
      </div>

      {oracleError && (
        <div className="pf-error">
          {oracleError}
        </div>
      )}

      {showCreate && (
        <CreatePollForm onAdd={handleCreate} onCancel={() => setShowCreate(false)} />
      )}

      {polls.length === 0 && !showCreate && (
        <div className="clubs-empty">
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
          <div className="pf-overline" style={{ opacity: .35, margin: "1rem 0 0.75rem" }}>
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
