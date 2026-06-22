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
import { callClaude } from '../lib/claudeApi';
import CommentThread from './CommentThread';
import { useT } from '../lib/I18nContext';



const labelStyle = {
  display: 'block',
  fontFamily: "'Special Elite', monospace",
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
  borderRadius: '2px',
  padding: '0.55rem 0.8rem',
  color: 'var(--paper)',
  fontFamily: "'Cormorant Garamond', serif",
  fontSize: '1rem',
  resize: 'vertical',
  colorScheme: 'dark',
};

// ── Oracle question suggestion fetch ─────────────────────────────────────────

async function fetchOracleQuestions({ book, existingQuestions = [] }) {
  const t = useT();
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

  const raw = await callClaude(prompt, 'You are a thoughtful book club facilitator. Respond only with the JSON array requested. No preamble, no markdown fences.');
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
    <div style={{
      marginBottom: '1rem',
      padding: '1rem 1.1rem',
      border: '1px solid rgba(176,140,63,0.3)',
      borderRadius: 2,
      background: 'rgba(176,140,63,0.04)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
        <div style={{ fontFamily: "'Special Elite', monospace", fontSize: '0.65rem', letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--gilt)', opacity: 0.9 }}>
          {t('discussion.oracleSuggestionsTitle')}
        </div>
        <button
          onClick={onDismiss}
          style={{ fontSize: '0.7rem', color: 'var(--paper-aged)', opacity: 0.4, background: 'none', border: 'none', cursor: 'pointer', fontFamily: "'Special Elite', monospace", letterSpacing: '0.05em' }}
        >
          {t('discussion.oracleDismiss')}
        </button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
        {suggestions.map((s, i) => {
          const done = added.has(i);
          return (
            <div
              key={i}
              onClick={() => !done && handlePick(s, i)}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0.6rem',
                padding: '0.55rem 0.75rem',
                borderRadius: 2,
                border: `1px solid ${done ? 'rgba(176,140,63,0.35)' : 'rgba(176,140,63,0.12)'}`,
                background: done ? 'rgba(176,140,63,0.08)' : 'transparent',
                cursor: done ? 'default' : 'pointer',
                transition: 'all 0.15s',
                opacity: done ? 0.6 : 1,
              }}
              onMouseEnter={(e) => { if (!done) e.currentTarget.style.background = 'rgba(176,140,63,0.06)'; }}
              onMouseLeave={(e) => { if (!done) e.currentTarget.style.background = done ? 'rgba(176,140,63,0.08)' : 'transparent'; }}
            >
              <span style={{ fontFamily: "'Special Elite', monospace", fontSize: '0.7rem', color: done ? 'var(--gilt)' : 'rgba(176,140,63,0.4)', flexShrink: 0, marginTop: 2 }}>
                {done ? '✦' : '+'}
              </span>
              <span style={{ fontFamily: "'Cormorant Garamond', serif", fontStyle: 'italic', fontSize: '0.98rem', color: 'var(--paper-aged)', lineHeight: 1.4 }}>
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
    <div style={{ marginBottom: '1rem', padding: '1rem', border: '1px solid rgba(176,140,63,0.2)', borderRadius: 2, background: 'rgba(176,140,63,0.03)' }}>
      <label style={labelStyle}>New discussion question</label>
      <textarea
        style={{ ...inputStyle, marginBottom: '0.75rem' }}
        {...{placeholder: t('discussion.newQuestionPlaceholder')}}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={2}
        autoFocus
      />
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button className="btn btn-ghost" onClick={onCancel} style={{ fontSize: '0.85rem' }}>Cancel</button>
        <button className="btn" onClick={handleAdd} disabled={!body.trim() || saving} style={{ fontSize: '0.85rem' }}>
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
    <div style={{ marginBottom: '1.5rem', paddingBottom: '1.5rem', borderBottom: '1px solid rgba(176,140,63,0.08)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', marginBottom: '0.75rem' }}>
        <div style={{
          width: 24, height: 24, borderRadius: '50%',
          background: 'rgba(176,140,63,0.15)', border: '1px solid rgba(176,140,63,0.3)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: "'Special Elite', monospace", fontSize: '0.65rem', color: 'var(--gilt)',
          flexShrink: 0, marginTop: 2,
        }}>
          Q
        </div>
        <div style={{ flex: 1 }}>
          <p style={{ fontFamily: "'Cormorant Garamond', serif", fontStyle: 'italic', fontSize: '1.1rem', color: 'var(--paper)', margin: 0, lineHeight: 1.4 }}>
            {question.body}
          </p>
          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.3rem' }}>
            <button
              onClick={() => setCollapsed(!collapsed)}
              style={{ fontSize: '0.72rem', color: 'var(--paper-aged)', opacity: 0.45, background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: "'Special Elite', monospace", letterSpacing: '0.05em' }}
            >
              {(collapsed ? (question.answers?.length === 1 ? t('discussion.showAnswers', { count: 1 }) : t('discussion.showAnswersPlural', { count: question.answers?.length || 0 })) : t('discussion.collapseAnswers'))}
            </button>
            {isAdmin && (
              <button
                onClick={() => onDelete(question.id)}
                style={{ fontSize: '0.72rem', color: 'rgba(180,60,60,0.55)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: "'Special Elite', monospace", letterSpacing: '0.05em' }}
              >
                {t('discussion.removeQuestion')}
              </button>
            )}
          </div>
        </div>
      </div>

      {!collapsed && (
        <div style={{ paddingLeft: '2rem' }}>
          <CommentThread
            comments={question.answers || []}
            onPost={(body) => onPostAnswer(body, question.id)}
            onDelete={onDeleteComment}
            onEdit={onEditComment}
            {...{placeholder: t('discussion.answerPlaceholder')}}
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

  const t = useT();


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
      <div style={{ color: 'var(--text-dim)', fontSize: '0.9rem', fontStyle: 'italic', padding: '1rem 0' }}>
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
        <section style={{ marginBottom: '2rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
            <div style={labelStyle}>{t('discussion.questionsLabel')}</div>
            {isAdmin && (
              <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                <button
                  className="li-action"
                  onClick={handleOracleSuggest}
                  disabled={oracleLoading}
                  style={{ color: 'var(--gilt)', fontSize: '0.72rem' }}
                >
                  {oracleLoading ? t('discussion.oracleThinking') : t('discussion.oracleSuggestsBtn')}
                </button>
                {!showAddQuestion && (
                  <button className="li-action" style={{ fontSize: '0.72rem' }} onClick={() => setShowAddQuestion(true)}>
                    {t('discussion.addQuestion')}
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
            <div style={{ color: 'var(--text-dim)', fontStyle: 'italic', fontSize: '0.88rem', marginBottom: '1rem' }}>
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
            <span style={{ opacity: 0.4, marginLeft: '0.5rem', textTransform: 'none', letterSpacing: 0 }}>
              · {comments.length}
            </span>
          )}
        </div>
        {comments.length === 0 && (
          <div style={{ color: 'var(--text-dim)', fontStyle: 'italic', fontSize: '0.88rem', marginBottom: '0.75rem' }}>
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
