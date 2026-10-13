// src/components/CoverThumb.jsx — a small cover that never touches the network.
//
// Two cover components, two jobs:
//   - BookCover resolves a MISSING cover (it fetches one) and draws the
//     ornamented placeholder. Use it where a book is the subject of the view.
//   - CoverThumb only shows the cover it is given, or the title on a plain
//     tile. Use it in feeds, strips and lists, where a lookup per book would be
//     dozens of network calls to decorate a preview (see CoverStrip's note).
//
// Replaces the local `Cover` copies in Dashboard and ReaderProfile. Styles are
// global (components/_cover-thumb.scss) so a page can adjust a thumb in its own
// context, as the Dashboard feed does.

/**
 * @param {object} props
 * @param {{ t?: string, coverUrl?: string }} props.book
 * @param {number} [props.width=60]   px
 * @param {number} [props.height]     px; defaults to width × 1.5 (book proportions)
 * @param {(e: React.MouseEvent) => void} [props.onClick]
 * @param {string} [props.className]  extra class on the thumb
 */
export default function CoverThumb({ book, width = 60, height, onClick, className }) {
  const h = height || Math.round(width * 1.5);
  const style = { '--cover-w': `${width}px`, '--cover-h': `${h}px` };
  const cls = (extra) => ['cover-thumb', extra, onClick && 'cover-thumb--link', className].filter(Boolean).join(' ');

  if (book?.coverUrl) {
    return <img src={book.coverUrl} alt={book.t || ''} className={cls()} style={style} onClick={onClick} loading="lazy" />;
  }
  return (
    <div className={cls('cover-thumb--placeholder')} style={style} onClick={onClick} role="img" aria-label={book?.t || ''}>
      <span className="cover-thumb__label" style={{ fontSize: Math.max(7, width / 9) }} aria-hidden="true">
        {book?.t?.slice(0, 16)}
      </span>
    </div>
  );
}
