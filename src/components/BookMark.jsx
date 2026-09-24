// src/components/BookMark.jsx — the site's "nothing here yet" mark.
//
// An open book, drawn in SVG, replacing the ❦ fleuron that used to stand in
// for every empty state and for the pre-boot screen. A fleuron said
// "decoration"; a book says what the space is for.
//
// Sized in em and coloured with currentColor, so it drops into any existing
// ornament slot (.ornament, .lv-empty-icon, .quota-wall__icon, a table cell)
// and takes that slot's font-size and colour — no per-site styling needed.
//
//   <BookMark />          static — inline and list uses
//   <BookMark animate />  a single leaf turns, slowly — empty states
//
// Decorative by default (aria-hidden). Pass `title` when it carries meaning.
// The same drawing is inlined in index.html for the pre-boot screen; keep the
// two in step if the shape changes.
export const BOOK_MARK_PATHS = {
  board: 'M2 9v23.5c7.5-1.6 15.2-1 22 2 6.8-3 14.5-3.6 22-2V9',
  left: 'M24 7.5C18 4.8 10.5 4.3 4.5 5.6v24.2c6-1.2 13.5-.7 19.5 2Z',
  right: 'M24 7.5c6-2.7 13.5-3.2 19.5-1.9v24.2c-6-1.2-13.5-.7-19.5 2Z',
  lines: 'M8.5 11.2c4-.8 8.2-.5 11.8.9M8.5 16.2c4-.8 8.2-.5 11.8.9M8.5 21.2c4-.8 8.2-.5 11.8.9M39.5 11.2c-4-.8-8.2-.5-11.8.9M39.5 16.2c-4-.8-8.2-.5-11.8.9M39.5 21.2c-4-.8-8.2-.5-11.8.9',
};

export default function BookMark({ animate = false, className = '', title }) {
  const P = BOOK_MARK_PATHS;
  return (
    <svg
      className={`book-mark${animate ? ' book-mark--animate' : ''}${className ? ` ${className}` : ''}`}
      viewBox="0 0 48 36"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : 'true'}
      aria-label={title || undefined}
      focusable="false"
    >
      <path className="book-mark__board" d={P.board} />
      <path className="book-mark__page" d={P.left} />
      <path className="book-mark__page" d={P.right} />
      <path className="book-mark__lines" d={P.lines} />
      {animate && <path className="book-mark__leaf" d={P.right} />}
    </svg>
  );
}
