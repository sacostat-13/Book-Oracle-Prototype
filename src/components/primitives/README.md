# UI primitives

Shared building blocks. **Before writing a dialog, rating, cover, picker or tab
bar, use one of these** — or extend it, if it doesn't fit. Each file's header
says what it owns and why.

| Need | Use | Notes |
|---|---|---|
| A dialog of any kind | [`Modal`](Modal.jsx) | Escape/backdrop close (topmost only), focus trap and return, scroll lock, portal. `size` sm/md/lg, `layout` card/sections/fullscreen, `dismissible={false}` while saving. Always centred. |
| "Are you sure?" | [`useConfirm()`](ConfirmDialog.jsx) | `if (!(await confirm({ message, confirmLabel, danger: true }))) return;` Never `window.confirm`. |
| A reader's rating, read-only | [`StarRating`](StarRating.jsx) | `starString(n)` for tooltips. The clickable form is `RatingModal`. |
| Pick several (genres, moods) | [`ChipToggleGroup`](ChipToggleGroup.jsx) | `max`, `selectedClassName="selected"` for the tinted look, `optionClassName="choice"` for cards. Logic only: [`toggleInList`](../../lib/selection.js). |
| A tab bar | [`Tabs`](Tabs.jsx) | Keyboard: arrows, Home, End. |

Also shared, outside this folder:

| Need | Use |
|---|---|
| A book's cover, resolving a missing one | [`BookCover`](../BookCover.jsx) |
| A small cover with no network calls (feeds, strips) | [`CoverThumb`](../CoverThumb.jsx) |
| A cover in a picker row | [`BookThumb`](../BookThumb.jsx) |
| Close on Escape (topmost layer only) | [`useEscape`](../../hooks/useEscape.js) |
| Close on outside press | [`useClickOutside`](../../hooks/useClickOutside.js) |
| Stop the page scrolling behind an overlay | [`useScrollLock`](../../hooks/useScrollLock.js) |

## Styling

`Modal` is the CSS Modules pilot: `Modal.module.scss` sits next to the
component and its rules are wrapped in `:where()` (zero specificity), so a page
class passed through `className` always wins over the module's defaults. The
exception is anything a global reset also sets (e.g. `margin`): module CSS loads
*before* `main.scss`, so those need real class specificity or the reset wins. The
others render existing global classes so nothing moved visually. See
[`src/styles/README.md`](../../styles/README.md).

Guard tests in `tests/ui-primitives.test.js` fail if hand-rolled overlays,
`window.confirm`, tablists, toggle functions or `'★'.repeat` come back.
