// src/components/primitives/Tabs.jsx — a row of tabs.
//
// Replaces three hand-rolled tablists (sign-in, Profile, Kindred). Beyond the
// role/aria-selected they already had, it adds what the ARIA tabs pattern
// expects from a keyboard: only the active tab is in the Tab order, and
// ArrowLeft/ArrowRight/Home/End move between tabs (and select them).
//
// Looks come from the classes each place already used (tabClassName /
// activeClassName), so nothing changes visually.

import { useRef } from 'react';

const cx = (...c) => c.filter(Boolean).join(' ');

/**
 * @template {string} Id
 * @param {object} props
 * @param {Array<{ id: Id, label: React.ReactNode }>} props.tabs
 * @param {Id} props.value                    the selected tab id
 * @param {(id: Id) => void} props.onChange
 * @param {string} [props.label]              accessible name for the tab list
 * @param {string} [props.className]          tablist class
 * @param {string} props.tabClassName         class on every tab
 * @param {string} props.activeClassName      added to the selected tab
 */
export default function Tabs({ tabs, value, onChange, label, className, tabClassName, activeClassName }) {
  const refs = useRef([]);

  function onKeyDown(e, index) {
    const last = tabs.length - 1;
    const target = {
      ArrowRight: index === last ? 0 : index + 1,
      ArrowLeft: index === 0 ? last : index - 1,
      Home: 0,
      End: last,
    }[e.key];
    if (target === undefined) return;
    e.preventDefault();
    onChange(tabs[target].id);
    refs.current[target]?.focus();
  }

  return (
    <div className={className} role="tablist" aria-label={label}>
      {tabs.map((tab, i) => {
        const active = tab.id === value;
        return (
          <button
            key={tab.id}
            ref={(el) => { refs.current[i] = el; }}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            className={cx(tabClassName, active && activeClassName)}
            onClick={() => onChange(tab.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
