# Styles — conventions

How to write and change styles in The Books Oracle. These rules apply to **new
and edited** code; existing code is brought in line when it is touched, not in
a big-bang pass.

> Agreed 2026-10-12 (code-health spike, item S1). The direction after this —
> CSS Modules for feature styles, `@layer`, a z-index scale — is spike items
> S3–S5 and is described at the end; until those land, follow the rules below.

## Where styles live

```
main.scss              the only entry point — @use's everything below, in order
_tokens.scss           Sass maps + mixins: type scale, spacing, radius, breakpoints
_themes.scss           --ro-* custom properties for dark and light (parchment) themes
_reset.scss  _typography.scss  _global.scss
layout/                app shell, nav, footer
components/            anything used by more than one view
pages/                 styles used by exactly one view
```

**Rule of placement:** if a class is used by a component in `src/components/`,
or by two views, it belongs in `components/`. Page partials hold page-only
styles. A shared look defined in a page partial (today: the modal shell
`.rating-modal*` in `pages/_social.scss`) is a bug to move, not a pattern to
copy.

## Naming — BEM

```
.block                 a standalone piece:      .db-streak
.block__element        a part of it:            .db-streak__num
.block--modifier       a design variant:        .db-streak__num--hot
.is-state              a state JS toggles:      .is-active, .is-open, .is-selected
```

- **Page blocks** keep the page prefix (`db-` Dashboard, `bp-` Book page, `pf-`
  Profile, `lp-`/`lps-` Landing…). **Shared components** use a plain name with no
  page prefix (`.modal`, `.chip`, `.book-tile`).
- A class name describes **what the thing is**, not where it was first used. If
  a block starts being used for something else, rename it rather than reuse a
  misleading name (`bp-similar-*` now also renders the author strip).
- **One state convention: `is-*`.** It is already the most used (`is-active`
  appears ~34 times). Bare `selected`, `active`, `done`, `hidden` are
  deprecated — convert them when you touch the component.
- **Modifiers use `--`**, including on buttons: new code writes `btn--primary`;
  existing `btn-primary` stays until the button component is built (spike U-items).
- Write the full class in JSX — `db-streak__num--${temperature}` is fine,
  but don't assemble block names from fragments, or nothing can find them.

## Nesting

- Nest only `&__element`, `&--modifier`, `&.is-state`, pseudo-classes and media
  queries. Max depth **3**.
- No descendant-tag selectors for layout (`.card div span`); give the element a class.

## Tokens — never raw values

| For | Use | Not |
|---|---|---|
| colour | `var(--ro-*)` — `--ro-text`, `--ro-text-2`, `--ro-muted`, `--ro-dim`, `--ro-surface(-2/-3)`, `--ro-border(-strong)`, `--ro-bg(-deep)`, `--ro-gold`, `--ro-accent`… | hex, `rgba()`, unprefixed vars (`--gold`, `--border`) |
| spacing | `var(--ro-space-1…16)` — 4, 8, 12, 16, 20, 24, 32, 48, 64 px | raw px |
| type | `@include tokens.ro-type(display \| section \| quote \| title \| body-lg \| body \| button \| label \| caption \| overline)` | raw `font-size` |
| radius | `var(--ro-radius-sm \| md \| lg \| xl \| pill)` | raw px |
| breakpoints | `@include tokens.ro-up(…)` / `ro-down(…)` / `ro-between(…)` with `mobile 640 · tablet 768 · desktop 1024 · midnav 1180 · wide 1280` | `@media (max-width: 767px)` |
| fonts | the type mixin or `var(--ro-font-*)` | a font-family string |

Need a value that isn't a token? Add the token (both themes, in `_themes.scss`)
in the same change — don't hard-code it "just this once". For a translucent
version of a token colour, use `color-mix(in srgb, var(--ro-gold) 20%, transparent)`.

Today the codebase still has ~740 raw font sizes, ~930 raw px spacings, ~210
colour literals outside the token files and 43 raw media queries; leave them
until you edit that rule, then convert.

## Reuse

- Prefer a **mixin** or a **shared class** over `@extend`. Cross-file `@extend`
  (there are ~78) couples partials invisibly; never add a new one. `%placeholder`
  extends inside the same file are acceptable.
- Before writing a new modal, chip picker, tab bar, star rating or cover, check
  [`components/primitives/README.md`](../components/primitives/README.md) — and
  if the shared version doesn't fit, extend it.

## `!important`

Only to beat third-party or inline styles you cannot change, with a comment
saying which. (There are 20 today; `@layer` should remove most.)

## Removing styles

When you delete a component or class from JSX, delete its rules in the same
change. `docs/audits/DEAD_CLASS_AUDIT_v0.62.3.md` describes how to find unstyled and
unused classes.

## Where this is heading

Recorded so new work leans the right way (code-health spike §5):

1. **CSS Modules for feature styles** — `Component.module.scss` next to
   `Component.jsx`, locally scoped class names, deleted with the component. The
   global layer shrinks to tokens, themes, reset, typography and shared
   primitives. **Piloted on `Modal`** (S4, `components/primitives/Modal.module.scss`);
   next, view by view (S5). Two rules from the pilot:
   - wrap module rules in `:where()` so page classes passed via `className`
     still win (module CSS is emitted after `main.scss`);
   - never look a module class up from JS or another stylesheet — it is
     hashed. Use a role/attribute (`[aria-modal="true"]`) or a prop
     (`overlayClassName`) instead.
2. **`@layer reset, tokens, base, primitives, features, overrides`** so order,
   not specificity or `!important`, decides who wins.
3. **A z-index scale** (`--ro-z-base … --ro-z-toast`) replacing the 77 raw
   values (S3).
4. **stylelint** enforcing the token table above, at warning level first.
