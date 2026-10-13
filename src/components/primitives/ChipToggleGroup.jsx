// src/components/primitives/ChipToggleGroup.jsx — pick several from a set.
//
// The genre and mood pickers (onboarding, profile, list editor, club creation)
// each rendered their own row of toggle buttons with their own toggle
// function. This is that row once: role="group", aria-pressed on each option,
// and the "at most N" rule (unselected options are disabled at the max).
//
// Looks come from the existing global classes, chosen per context, so nothing
// changes visually: `chip` + `chip--active` (filled) in forms, `chip` +
// `selected` (tinted) in onboarding and profile, `choice` cards for moods.
// Cleaning up the three overlapping `.chip` definitions is styling work for
// the CSS Modules migration, not this component.

import { toggleInList } from '../../lib/selection';

const cx = (...c) => c.filter(Boolean).join(' ');

/**
 * @template V
 * @param {object} props
 * @param {Array<{ value: V, label: React.ReactNode, title?: string }>} props.options
 * @param {V[]} props.value                  selected values
 * @param {(next: V[]) => void} props.onChange
 * @param {number} [props.max]                at most this many may be selected
 * @param {boolean} [props.disabled=false]
 * @param {string} [props.label]              accessible name for the group
 * @param {string} [props.className]          container class (layout)
 * @param {string} [props.optionClassName='chip']
 * @param {string} [props.selectedClassName='chip--active']
 * @param {React.ReactNode} [props.children]  extra controls after the options (e.g. "show all")
 */
export default function ChipToggleGroup({
  options,
  value,
  onChange,
  max = Infinity,
  disabled = false,
  label,
  className,
  optionClassName = 'chip',
  selectedClassName = 'chip--active',
  children,
}) {
  const selected = Array.isArray(value) ? value : [];
  const atMax = selected.length >= max;

  function toggle(v) {
    const next = toggleInList(selected, v, { max });
    if (next !== selected) onChange(next);
  }

  return (
    <div className={className} role="group" aria-label={label}>
      {options.map((o) => {
        const isOn = selected.includes(o.value);
        return (
          <button
            key={String(o.value)}
            type="button"
            className={cx(optionClassName, isOn && selectedClassName)}
            aria-pressed={isOn}
            title={o.title}
            disabled={disabled || (!isOn && atMax)}
            onClick={() => toggle(o.value)}
          >
            {o.label}
          </button>
        );
      })}
      {children}
    </div>
  );
}
