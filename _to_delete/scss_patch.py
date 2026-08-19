# v0.65.1 — progress modal: sticky actions, full-width fields, h/m pairs.

# ── src/styles/pages/_misc.scss ──────────────────────────────────────────────
p = 'src/styles/pages/_misc.scss'
s = open(p, encoding='utf-8').read()

old = """.pu-actions {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin-top: 1.5rem;
}"""
new = """.pu-actions {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  justify-content: flex-end;
  margin-top: 1.5rem;
}

// v0.65.1 — the actions must never scroll out of reach.
//
// .rating-modal caps itself at the viewport and scrolls its own content
// (see the v0.60.3 note in _social.scss). That fixed modals growing PAST the
// screen; it did not stop the buttons being below the fold of the scroll, and
// the progress modal is now long enough that they always are. A reader who
// opens it sees four fields and no way to commit them, which reads as broken
// rather than as scrollable.
//
// Sticky rather than fixed: it stays inside the surface, inherits its
// background, and needs no knowledge of where the modal happens to be on
// screen. The negative margins pull it out to the shell's edges so the divider
// spans the full width instead of floating inside the padding, and the
// matching bottom offset cancels the shell's own bottom padding so the bar
// sits flush against the end of the scroll.
.pu-modal {
  --pu-pad: 32px;

  .pu-actions {
    position: sticky;
    bottom: calc(var(--pu-pad) * -1);
    margin: 1.5rem calc(var(--pu-pad) * -1) calc(var(--pu-pad) * -1);
    padding: 14px var(--pu-pad) var(--pu-pad);
    background: var(--ro-surface);
    border-top: 1px solid var(--ro-border);
    // Above the corner brackets, which are absolutely positioned on the shell
    // and would otherwise draw over the buttons at the bottom edge.
    z-index: 3;
  }
}"""
assert s.count(old) == 1, f'pu-actions block: {s.count(old)}'
s = s.replace(old, new)
open(p, 'w', encoding='utf-8').write(s)
print(p, 'ok')

# ── src/styles/components/_forms.scss ────────────────────────────────────────
p = 'src/styles/components/_forms.scss'
s = open(p, encoding='utf-8').read()

old = """// ── Edition picker (ProgressUpdateModal) ──────────────────────────────────────
// Grew out of the single "edition pages" input, so it inherits the modal's field
// rhythm rather than introducing its own.
.pu-edition {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.pu-edition__isbn {
  display: flex;
  gap: 8px;
  align-items: center;

  .input { flex: 1 1 auto; }
}"""
new = """// ── Edition picker (ProgressUpdateModal) ──────────────────────────────────────
// Grew out of the single "edition pages" input, so it inherits the modal's field
// rhythm rather than introducing its own.
.pu-edition {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.pu-edition__isbn {
  display: flex;
  gap: 8px;
  align-items: center;

  // min-width:0 is not decoration. A flex item's default min-width is `auto`,
  // which for an input is its `size` attribute — so without this the ISBN field
  // refuses to shrink and pushes the Look up button off the right edge on a
  // narrow screen.
  .input { flex: 1 1 auto; min-width: 0; }
}

// ── Progress modal form (v0.65.1) ─────────────────────────────────────────────
//
// One width for every control. The modal had grown a mix of .pf-input--narrow
// (a fixed 120px, borrowed from the reading-challenge target), full-width text
// inputs and intrinsically-sized selects, so five stacked fields had four
// different right edges and the eye had nothing to line up on. Nothing in this
// form benefits from being narrow — a page count in a 120px box is not easier
// to read than one in a full-width box, it is just a ragged column.
//
// Scoped to .pu-form rather than fixed at the source, because .pf-input--narrow
// is doing the right thing where it came from.
.pu-form {
  display: flex;
  flex-direction: column;
  gap: var(--ro-space-4);
  margin-top: var(--ro-space-4);

  .input,
  select.input,
  .textarea { width: 100%; }

  // Neutralised rather than removed from the markup, so a control that still
  // carries the class does not become the one odd width again.
  .pf-input--narrow { width: 100%; flex: 1 1 auto; }

  // These two carry their own bottom margins for use outside a gapped column.
  .pu-input-row,
  .pu-progress-label { margin-bottom: 0; }

  .pu-input-row {
    align-items: center;
    .input { flex: 1 1 auto; min-width: 0; }
  }
}

.pu-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

// Hours and minutes, as two fields with their units between them. Grid rather
// than flex so both inputs are exactly the same width whatever the unit labels
// translate to — "h"/"m" in English, "h"/"min" in Spanish.
.pu-hm {
  display: grid;
  grid-template-columns: 1fr auto 1fr auto;
  align-items: center;
  gap: 8px;

  .input { min-width: 0; }
}

.pu-hm__unit {
  font-family: var(--ro-font-mono);
  font-size: 0.8rem;
  color: var(--ro-muted);
}

// The quiet line under a field. Same voice as .pu-progress-label but without
// its bottom margin, because inside .pu-form the column gap owns the spacing.
.pu-note {
  font-family: var(--ro-font-mono);
  font-size: 0.72rem;
  letter-spacing: .06em;
  line-height: 1.5;
  color: var(--ro-muted);
}

.pu-form__reset { align-self: flex-start; }"""
assert s.count(old) == 1, f'pu-edition block: {s.count(old)}'
s = s.replace(old, new)
open(p, 'w', encoding='utf-8').write(s)
print(p, 'ok')
