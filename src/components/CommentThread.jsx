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
    return <img src={avatarUrl} alt={displayName} onError={() => setFailed(true)} className="friend-avatar" style={{ '--fa-sz': `${size}px` }} />;
  }
  return (
    <div className="friend-avatar--fallback" style={{ '--fa-sz': `${size}px`, fontSize: size * 0.36 }}>
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
    <div className="comment-reply-row">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handlePost(); }}
        placeholder={placeholder}
        rows={2}
        autoFocus={autoFocus}
        className="textarea" style={{
          flex: 1,
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
        className="comment-reply-send"
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
    <div className="comment-reply-row">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={2}
        autoFocus
        className="textarea" style={{
          flex: 1,
          fontSize: '0.95rem',
          resize: 'none',
          colorScheme: 'dark',
        }}
      />
      <div className="comment-reply-compose">
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
    <div className="comment-item">
      <Avatar displayName={comment.display_name} avatarUrl={comment.avatar_url} size={isReply ? 22 : 26} />
      <div className="comment-item__body">
        <div className="comment-item__head">
          <span className="comment-item__name">
            {comment.display_name || 'Anonymous'}
          </span>
          <span className="comment-item__meta">
            {relativeTime(comment.created_at)}
            {comment.updated_at && comment.updated_at !== comment.created_at && t('discussion.edited')}
          </span>
        </div>

        {editing ? (
          <EditInput initialBody={comment.body} onSave={handleEdit} onCancel={() => setEditing(false)} />
        ) : (
          <p className="comment-item__text">
            {comment.body}
          </p>
        )}

        {!editing && (
          <div className="comment-item__actions">
            {!isReply && (
              <button
                onClick={() => setReplying(!replying)}
                className="comment-item__reply"
              >
                {replying ? t('discussion.cancelReply') : t('discussion.reply')}
              </button>
            )}
            {isMine && (
              <>
                <button
                  onClick={() => setEditing(true)}
                  className="comment-item__reply"
                >
                  {t('discussion.edit')}
                </button>
                <button
                  onClick={() => onDelete(comment.id)}
                  className="comment-item__reply" style={{ color: "var(--ro-error)" }}
                >{t('discussion.delete')}</button>
              </>
            )}
          </div>
        )}

        {/* Replies */}
        {comment.replies?.length > 0 && (
          <div className="session-prompt" style={{ marginTop: "0.6rem", marginBottom: 0 }}>
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
          <div >
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
        <div >
          <CommentInput
            onPost={(body) => onPost(body, null)}
            placeholder={placeholder || t('discussion.commentPlaceholder')}
          />
        </div>
      )}
    </div>
  );
}
