// src/components/SessionDiscussion.jsx — v0.29
// Handles the full discussion section of a session page:
//   - Admin-pinned discussion questions, each with its own answer thread
//   - Free comments section below
//   - Admin controls: add/delete questions, Oracle question suggestions
//
// Props:
//   sessionId  — UUID
//   clubId     — UUID
//   isAdmin    — boolean
//   book       — { title, author, description } for Oracle context

import { useState, useEffect, useCallback } from 'react';
import { useData } from '../lib/DataContext';
import { supabase } from '../lib/supabase';
import { callClaude, QuotaExceededError } from '../lib/claudeApi';
import CommentThread from './CommentThread';
import { useT } from '../lib/I18nContext';
import { useOracleQuota } from '../lib/OracleQuotaContext';

const labelStyle = {
  display: 'block',
  fontFamily: 'var(--ro-font-mono)',
  fontSize: '0.7rem',
  letterSpacing: '0.15em',
  textTransform: 'uppercase',
  color: 'var(--gilt)',
  marginBottom: '0.6rem',
};

const inputStyle = {
  width: '100%',
  boxSizing: 'border-box',
  background: 'rgba(176,140,63,0.04)',
  border: '1px solid rgba(176,140,63,0.25)',
  borderRadius: 'var(--ro-radius-sm)',
  padding: '0.55rem 0.8rem',
  color: 'var(--paper)',
  fontFamily: 'var(--ro-font-display)',
  fontSize: '1rem',
  resize: 'vertical',
  colorScheme: 'dark',
};

// ── Oracle question suggestion fetch ─────────────────────────────────────────

async function fetchOracleQuestions({ book, existingQuestions = [] }) {
  const t = useT();
  const { handleQuotaError, onCallSucceeded } = useOracleQuota();
  const existingList = existingQuestions.length
    ? existingQuestions.map((q) => `- ${q.body}`).join('\n')
    : t('discussion.noQuestions');

  const prompt = `You are helping a book club run a discussion for "${book.title}"${book.author ? ` by ${book.author}` : ''}.
${book.description ? `\nBook description: ${book.description}\n` : ''}
Existing discussion questions already added:
${existingList}

Suggest 5 discussion questions that would spark rich conversation in a book club setting.
Avoid duplicating the existing questions. Focus on themes, characters, emotional resonance, and reader reactions.

Respond with ONLY valid JSON — no preamble, no markdown, no explanation:
["Question one?", "Question two?", "Question three?", "Question four?", "Question five?"]`;

  let raw = null;
  try {
    raw = await callClaude(prompt, 'You are a thoughtful book club facilitator. Respond only with the JSON array requested. No preamble, no markdown fences.');
    onCallSucceeded?.();
  } catch (err) {
    if (err instanceof QuotaExceededError) {
      handleQuotaError(err);
      return null;
    }
    throw err;
  }
  const text = typeof raw === 'string' ? raw : raw?.content?.[0]?.text || '';
  const clean = text.replace(/```json|```/g, '').trim();
  return JSON.parse(clean);
}

// ── Oracle suggestion pick-list ───────────────────────────────────────────────

function OracleSuggestions({ suggestions, onPick, onDismiss }) {
  const t = useT();
  const [added, setAdded] = useState(new Set());

  async function handlePick(suggestion, i) {
    const t = useT();
    await onPick(suggestion);
    setAdded((prev) => new Set([...prev, i]));
  }

  return (
    <div className="sd-checklist">
      <div className="sd-checklist__head">
        <div className="sd-checklist__label">
          {t('discussion.oracleSuggestionsTitle')}
        </div>
        <button
          onClick={onDismiss}
          className="sd-checklist__clear"
        >
          {t('discussion.oracleDismiss')}
        </button>
      </div>
      <div className="sd-checklist__list">
        {suggestions.map((s, i) => {
          const done = added.has(i);
          return (
            <div key={i} onClick={() => !done && handlePick(s, i)} className="sd-check-item" style={{ opacity: done ? 0.6 : 1, cursor: done ? "default" : "pointer" }}>
              <span className={`sd-check-item__tick${done ? " sd-check-item__tick--done" : " sd-check-item__tick--empty"}`}>
                {done ? '✦' : '+'}
              </span>
              <span className={`sd-check-item__text${done ? " sd-check-item__text--done" : ""}`}>
                {s}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Add question form ─────────────────────────────────────────────────────────

function AddQuestionForm({ onAdd, onCancel, nextPosition }) {
  const t = useT();
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleAdd() {
    const t = useT();
    if (!body.trim() || saving) return;
    setSaving(true);
    await onAdd(body.trim(), nextPosition);
    setSaving(false);
    setBody('');
  }

  return (
    <div className="sd-checklist">
      <label className="session-section-label">New discussion question</label>
      <textarea
        className="textarea"
        {...{ placeholder: t('discussion.newQuestionPlaceholder') }}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={2}
        autoFocus
      />
      <div className="club-form__actions">
        <button className="btn-tertiary" onClick={onCancel}>Cancel</button>
        <button className="btn-primary" onClick={handleAdd} disabled={!body.trim() || saving}>
          {saving ? t('discussion.adding') : t('discussion.addQuestionBtn')}
        </button>
      </div>
    </div>
  );
}

// ── Question block ────────────────────────────────────────────────────────────

function QuestionBlock({ question, isAdmin, onPostAnswer, onDelete, onEditComment, onDeleteComment }) {
  const t = useT();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="session-prompt" style={{ paddingBottom: "1.5rem", marginBottom: "1.5rem" }}>
      <div className="club-member-row">
        <div className="friend-avatar--fallback" style={{ "--fa-sz": "24px", fontSize: "0.65rem" }}>
          Q
        </div>
        <div className="session-form__book-wrap">
          <p className="session-hero__title" style={{ fontSize: "1.1rem", margin: 0 }}>
            {question.body}
          </p>
          <div className="comment-item__actions">
            <button
              onClick={() => setCollapsed(!collapsed)}
              className="comment-item__reply"
            >
              {(collapsed ? (question.answers?.length === 1 ? t('discussion.showAnswers', { count: 1 }) : t('discussion.showAnswersPlural', { count: question.answers?.length || 0 })) : t('discussion.collapseAnswers'))}
            </button>
            {isAdmin && (
              <button
                onClick={() => onDelete(question.id)}
                className="comment-item__reply" style={{ color: "var(--ro-error)" }}
              >
                {t('discussion.removeQuestion')}
              </button>
            )}
          </div>
        </div>
      </div>

      {!collapsed && (
        <div className="session-prompt" style={{ paddingLeft: "2rem", borderLeft: "none", marginBottom: 0 }}>
          <CommentThread
            comments={question.answers || []}
            onPost={(body) => onPostAnswer(body, question.id)}
            onDelete={onDeleteComment}
            onEdit={onEditComment}
            {...{ placeholder: t('discussion.answerPlaceholder') }}
            compact
          />
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function SessionDiscussion({ sessionId, clubId, isAdmin, book = {} }) {
  const { postComment, deleteComment, editComment, addQuestion, deleteQuestion } = useData();
  const [discussion, setDiscussion] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showAddQuestion, setShowAddQuestion] = useState(false);
  const [oracleLoading, setOracleLoading] = useState(false);
  const [oracleError, setOracleError] = useState(null);
  const [oracleSuggestions, setOracleSuggestions] = useState(null);

  const loadDiscussion = useCallback(async () => {
    const { data, error } = await supabase.rpc('get_session_discussion', { p_session_id: sessionId });
    setLoading(false);
    if (!error) setDiscussion(data);
  }, [sessionId]);

  useEffect(() => { loadDiscussion(); }, [loadDiscussion]);

  async function handlePostComment(body, parentId = null) {
    const t = useT();
    const comment = await postComment({ sessionId, clubId, body, parentId });
    if (comment) await loadDiscussion();
  }

  async function handlePostAnswer(body, questionId) {
    const t = useT();
    const comment = await postComment({ sessionId, clubId, body, questionId });
    if (comment) await loadDiscussion();
  }

  async function handleDeleteComment(commentId) {
    const t = useT();
    await deleteComment(commentId);
    await loadDiscussion();
  }

  async function handleEditComment(commentId, body) {
    const t = useT();
    await editComment(commentId, body);
    await loadDiscussion();
  }

  async function handleAddQuestion(body, position) {
    const t = useT();
    const q = await addQuestion({ sessionId, clubId, body, position });
    if (q) { setShowAddQuestion(false); await loadDiscussion(); }
  }

  async function handleDeleteQuestion(questionId) {
    const t = useT();
    if (!confirm(t('discussion.confirmRemoveQuestion'))) return;
    await deleteQuestion(questionId);
    await loadDiscussion();
  }

  async function handleOracleSuggest() {
    const t = useT();
    setOracleLoading(true);
    setOracleError(null);
    setOracleSuggestions(null);
    try {
      const suggestions = await fetchOracleQuestions({
        book,
        existingQuestions: discussion?.questions || [],
      });
      setOracleSuggestions(suggestions);
    } catch (e) {
      console.error('Oracle questions failed', e);
      setOracleError(t('discussion.oracleError'));
    }
    setOracleLoading(false);
  }

  async function handlePickSuggestion(body) {
    const t = useT();
    const position = (discussion?.questions || []).length;
    await addQuestion({ sessionId, clubId, body, position });
    await loadDiscussion();
  }

  if (loading) {
    return (
      <div className="session-no-comments">
        Loading discussion…
      </div>
    );
  }

  const questions = discussion?.questions || [];
  const comments = discussion?.comments || [];

  return (
    <div>
      {/* Discussion questions */}
      {(questions.length > 0 || isAdmin) && (
        <section className="db-section">
          <div className="club-card__head">
            <div style={labelStyle}>{t('discussion.questionsLabel')}</div>
            {isAdmin && (
              <div className="friend-row__actions">
                <button
                  className="li-action"
                  onClick={handleOracleSuggest}
                  disabled={oracleLoading}

                >
                  {oracleLoading ? t('discussion.oracleThinking') : t('discussion.oracleSuggestsBtn')}
                </button>
                {!showAddQuestion && (
                  <button className="li-action" onClick={() => setShowAddQuestion(true)}>
                    {t('discussion.addQuestion')}
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

          {oracleSuggestions && (
            <OracleSuggestions
              suggestions={oracleSuggestions}
              onPick={handlePickSuggestion}
              onDismiss={() => setOracleSuggestions(null)}
            />
          )}

          {showAddQuestion && (
            <AddQuestionForm
              onAdd={handleAddQuestion}
              onCancel={() => setShowAddQuestion(false)}
              nextPosition={questions.length}
            />
          )}

          {questions.length === 0 && !showAddQuestion && !oracleSuggestions && (
            <div className="session-no-comments">
              {isAdmin ? t('discussion.noQuestionsAdmin') : t('discussion.noQuestions')}
            </div>
          )}

          {questions.map((q) => (
            <QuestionBlock
              key={q.id}
              question={q}
              isAdmin={isAdmin}
              onPostAnswer={handlePostAnswer}
              onDelete={handleDeleteQuestion}
              onEditComment={handleEditComment}
              onDeleteComment={handleDeleteComment}
            />
          ))}
        </section>
      )}

      {/* Free comments */}
      <section>
        <div style={labelStyle}>
          {t('discussion.commentsLabel')}
          {comments.length > 0 && (
            <span className="club-form__optional">
              · {comments.length}
            </span>
          )}
        </div>
        {comments.length === 0 && (
          <div className="session-no-comments">
            No comments yet. Be the first.
          </div>
        )}
        <CommentThread
          comments={comments}
          onPost={handlePostComment}
          onDelete={handleDeleteComment}
          onEdit={handleEditComment}
          placeholder="Share a thought about this session… (Cmd+Enter to post)"
        />
      </section>
    </div>
  );
}
