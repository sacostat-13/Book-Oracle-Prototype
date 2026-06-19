// src/components/SessionDiscussion.jsx — v0.29
// Handles the full discussion section of a session page:
//   - Admin-pinned discussion questions, each with its own answer thread
//   - Free comments section below
//   - Admin controls: add/delete questions
//
// Loads discussion data from get_session_discussion RPC and stays local.
// Parent (SessionDetail) passes session + club context.

import { useState, useEffect, useCallback } from 'react';
import { useData } from '../lib/DataContext';
import { supabase } from '../lib/supabase';
import CommentThread from './CommentThread';

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

function AddQuestionForm({ onAdd, onCancel, nextPosition }) {
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleAdd() {
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
        placeholder="e.g. What did you think of the ending?"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={2}
        autoFocus
      />
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button className="btn btn-ghost" onClick={onCancel} style={{ fontSize: '0.85rem' }}>Cancel</button>
        <button className="btn" onClick={handleAdd} disabled={!body.trim() || saving} style={{ fontSize: '0.85rem' }}>
          {saving ? 'Adding…' : 'Add question ❦'}
        </button>
      </div>
    </div>
  );
}

function QuestionBlock({ question, isAdmin, onPostAnswer, onDelete, onEditComment, onDeleteComment }) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div style={{ marginBottom: '1.5rem', paddingBottom: '1.5rem', borderBottom: '1px solid rgba(176,140,63,0.08)' }}>
      {/* Question header */}
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
              {collapsed ? `Show ${question.answers?.length || 0} answer${question.answers?.length !== 1 ? 's' : ''}` : 'Collapse'}
            </button>
            {isAdmin && (
              <button
                onClick={() => onDelete(question.id)}
                style={{ fontSize: '0.72rem', color: 'rgba(180,60,60,0.55)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: "'Special Elite', monospace", letterSpacing: '0.05em' }}
              >
                Remove question
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Answers */}
      {!collapsed && (
        <div style={{ paddingLeft: '2rem' }}>
          <CommentThread
            comments={question.answers || []}
            onPost={(body) => onPostAnswer(body, question.id)}
            onDelete={onDeleteComment}
            onEdit={onEditComment}
            placeholder="Share your thoughts on this question…"
            compact
          />
        </div>
      )}
    </div>
  );
}

export default function SessionDiscussion({ sessionId, clubId, isAdmin }) {
  const { postComment, deleteComment, editComment, addQuestion, deleteQuestion } = useData();
  const [discussion, setDiscussion] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showAddQuestion, setShowAddQuestion] = useState(false);

  const loadDiscussion = useCallback(async () => {
    const { data, error } = await supabase.rpc('get_session_discussion', { p_session_id: sessionId });
    setLoading(false);
    if (!error) setDiscussion(data);
  }, [sessionId]);

  useEffect(() => { loadDiscussion(); }, [loadDiscussion]);

  // Post a free comment on the session
  async function handlePostComment(body, parentId = null) {
    const comment = await postComment({ sessionId, clubId, body, parentId });
    if (comment) await loadDiscussion();
  }

  // Post an answer to a specific question
  async function handlePostAnswer(body, questionId) {
    const comment = await postComment({ sessionId, clubId, body, questionId });
    if (comment) await loadDiscussion();
  }

  async function handleDeleteComment(commentId) {
    await deleteComment(commentId);
    await loadDiscussion();
  }

  async function handleEditComment(commentId, body) {
    await editComment(commentId, body);
    await loadDiscussion();
  }

  async function handleAddQuestion(body, position) {
    const q = await addQuestion({ sessionId, clubId, body, position });
    if (q) { setShowAddQuestion(false); await loadDiscussion(); }
  }

  async function handleDeleteQuestion(questionId) {
    if (!confirm('Remove this discussion question? Existing answers will also be deleted.')) return;
    await deleteQuestion(questionId);
    await loadDiscussion();
  }

  if (loading) {
    return (
      <div style={{ color: 'rgba(233,223,202,0.3)', fontSize: '0.9rem', fontStyle: 'italic', padding: '1rem 0' }}>
        Loading discussion…
      </div>
    );
  }

  const questions = discussion?.questions || [];
  const comments = discussion?.comments || [];

  return (
    <div>
      {/* Discussion questions section */}
      {(questions.length > 0 || isAdmin) && (
        <section style={{ marginBottom: '2rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
            <div style={labelStyle}>Discussion questions</div>
            {isAdmin && !showAddQuestion && (
              <button className="li-action" style={{ fontSize: '0.72rem' }} onClick={() => setShowAddQuestion(true)}>
                + Add question
              </button>
            )}
          </div>

          {showAddQuestion && (
            <AddQuestionForm
              onAdd={handleAddQuestion}
              onCancel={() => setShowAddQuestion(false)}
              nextPosition={questions.length}
            />
          )}

          {questions.length === 0 && !showAddQuestion && (
            <div style={{ color: 'rgba(233,223,202,0.3)', fontStyle: 'italic', fontSize: '0.88rem', marginBottom: '1rem' }}>
              No discussion questions yet. Add one to get the conversation started.
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

      {/* Free comments section */}
      <section>
        <div style={labelStyle}>
          Comments
          {comments.length > 0 && <span style={{ opacity: 0.4, marginLeft: '0.5rem', textTransform: 'none', letterSpacing: 0 }}>· {comments.length}</span>}
        </div>
        {comments.length === 0 && (
          <div style={{ color: 'rgba(233,223,202,0.3)', fontStyle: 'italic', fontSize: '0.88rem', marginBottom: '0.75rem' }}>
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
