// src/components/CommentThread.jsx — v0.29
// Renders a list of comments with one level of replies.
// Used both for free session comments and for question answer threads.
//
// Props:
//   comments      — array of comment objects (with .replies array)
//   onPost(body, parentId?)  — called when user submits a new comment or reply
//   onDelete(commentId)      — called when user deletes their own comment
//   onEdit(commentId, body)  — called when user edits their own comment
//   placeholder   — input placeholder text
//   compact       — smaller visual footprint (used inside question threads)

import { useState } from 'react';
import { useAuth } from '../lib/AuthContext';
import { useT } from '../lib/I18nContext';

function Avatar({ displayName, avatarUrl, size = 26 }) {
  const [failed, setFailed] = useState(false);
  const initials = (displayName || '?').split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  if (avatarUrl && !failed) {
    return <img src={avatarUrl} alt={displayName} onError={() => setFailed(true)} style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />;
  }
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: 'rgba(176,140,63,0.15)', border: '1px solid rgba(176,140,63,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--ro-font-mono)', fontSize: size * 0.36, color: 'var(--gilt)', flexShrink: 0 }}>
      {initials}
    </div>
  );
}

function relativeTime(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return t('discussion.justNow');
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function CommentInput({ onPost, placeholder = 'Add a comment…', autoFocus = false }) {
  const t = useT();
  const [body, setBody] = useState('');
  const [posting, setPosting] = useState(false);

  async function handlePost() {
    if (!body.trim() || posting) return;
    setPosting(true);
    await onPost(body.trim());
    setBody('');
    setPosting(false);
  }

  return (
    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end' }}>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handlePost(); }}
        placeholder={placeholder}
        rows={2}
        autoFocus={autoFocus}
        style={{
          flex: 1,
          background: 'rgba(176,140,63,0.04)',
          border: '1px solid rgba(176,140,63,0.2)',
          borderRadius: 'var(--ro-radius-sm)',
          padding: '0.45rem 0.7rem',
          color: 'var(--paper)',
          fontFamily: 'var(--ro-font-display)',
          fontSize: '0.95rem',
          resize: 'none',
          lineHeight: 1.5,
          colorScheme: 'dark',
        }}
      />
      <button
        className="li-action"
        onClick={handlePost}
        disabled={!body.trim() || posting}
        style={{ flexShrink: 0, alignSelf: 'flex-end', paddingBottom: '0.45rem' }}
      >
        {posting ? t('discussion.posting') : t('discussion.post')}
      </button>
    </div>
  );
}

function EditInput({ initialBody, onSave, onCancel }) {
  const [body, setBody] = useState(initialBody);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!body.trim() || saving) return;
    setSaving(true);
    await onSave(body.trim());
    setSaving(false);
  }

  return (
    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end', marginTop: '0.35rem' }}>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={2}
        autoFocus
        style={{
          flex: 1,
          background: 'rgba(176,140,63,0.04)',
          border: '1px solid rgba(176,140,63,0.3)',
          borderRadius: 'var(--ro-radius-sm)',
          padding: '0.45rem 0.7rem',
          color: 'var(--paper)',
          fontFamily: 'var(--ro-font-display)',
          fontSize: '0.95rem',
          resize: 'none',
          colorScheme: 'dark',
        }}
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
        <button className="li-action" onClick={handleSave} disabled={!body.trim() || saving}>{saving ? '…' : 'Save'}</button>
        <button className="li-action" onClick={onCancel}>{t('discussion.cancelReply')}</button>
      </div>
    </div>
  );
}

function SingleComment({ comment, onPost, onDelete, onEdit, isReply = false }) {
  const t = useT();
  const { user } = useAuth();
  const [replying, setReplying] = useState(false);
  const [editing, setEditing] = useState(false);

  const isMine = comment.is_mine || comment.created_by === user?.id;

  async function handleReply(body) {
    await onPost(body, comment.id);
    setReplying(false);
  }

  async function handleEdit(body) {
    await onEdit(comment.id, body);
    setEditing(false);
  }

  return (
    <div style={{ display: 'flex', gap: '0.6rem', marginBottom: isReply ? '0.5rem' : '0.85rem' }}>
      <Avatar displayName={comment.display_name} avatarUrl={comment.avatar_url} size={isReply ? 22 : 26} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', marginBottom: '0.2rem' }}>
          <span style={{ fontSize: '0.82rem', fontWeight: 500, color: 'var(--paper)' }}>
            {comment.display_name || 'Anonymous'}
          </span>
          <span style={{ fontSize: '0.72rem', color: 'var(--paper-aged)', opacity: 0.45 }}>
            {relativeTime(comment.created_at)}
            {comment.updated_at && comment.updated_at !== comment.created_at && t('discussion.edited')}
          </span>
        </div>

        {editing ? (
          <EditInput initialBody={comment.body} onSave={handleEdit} onCancel={() => setEditing(false)} />
        ) : (
          <p style={{
            fontFamily: 'var(--ro-font-display)',
            fontSize: '1rem',
            color: 'var(--paper-aged)',
            lineHeight: 1.55,
            margin: 0,
            wordBreak: 'break-word',
          }}>
            {comment.body}
          </p>
        )}

        {!editing && (
          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.3rem' }}>
            {!isReply && (
              <button
                onClick={() => setReplying(!replying)}
                style={{ fontSize: '0.72rem', color: 'var(--paper-aged)', opacity: 0.5, background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'var(--ro-font-mono)', letterSpacing: '0.05em' }}
              >
                {replying ? t('discussion.cancelReply') : t('discussion.reply')}
              </button>
            )}
            {isMine && (
              <>
                <button
                  onClick={() => setEditing(true)}
                  style={{ fontSize: '0.72rem', color: 'var(--paper-aged)', opacity: 0.5, background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'var(--ro-font-mono)', letterSpacing: '0.05em' }}
                >
                  {t('discussion.edit')}
                </button>
                <button
                  onClick={() => onDelete(comment.id)}
                  style={{ fontSize: '0.72rem', color: 'rgba(180,60,60,0.6)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'var(--ro-font-mono)', letterSpacing: '0.05em' }}
                >{t('discussion.delete')}</button>
              </>
            )}
          </div>
        )}

        {/* Replies */}
        {comment.replies?.length > 0 && (
          <div style={{ marginTop: '0.6rem', paddingLeft: '0.75rem', borderLeft: '1px solid rgba(176,140,63,0.12)' }}>
            {comment.replies.map((r) => (
              <SingleComment
                key={r.id}
                comment={r}
                onPost={onPost}
                onDelete={onDelete}
                onEdit={onEdit}
                isReply
              />
            ))}
          </div>
        )}

        {/* Reply input */}
        {replying && (
          <div style={{ marginTop: '0.5rem' }}>
            <CommentInput onPost={handleReply} placeholder="Write a reply…" autoFocus />
          </div>
        )}
      </div>
    </div>
  );
}

export default function CommentThread({ comments = [], onPost, onDelete, onEdit, placeholder, compact = false }) {
  const t = useT();
  const { user } = useAuth();

  return (
    <div>
      {comments.map((c) => (
        <SingleComment
          key={c.id}
          comment={c}
          onPost={(body, parentId) => onPost(body, parentId)}
          onDelete={onDelete}
          onEdit={onEdit}
        />
      ))}

      {user && (
        <div style={{ marginTop: comments.length > 0 ? '0.5rem' : 0 }}>
          <CommentInput
            onPost={(body) => onPost(body, null)}
            placeholder={placeholder || t('discussion.commentPlaceholder')}
          />
        </div>
      )}
    </div>
  );
}
