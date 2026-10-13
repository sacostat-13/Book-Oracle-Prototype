// src/views/profile/overview/PaceChart.jsx — books finished per month, last 12 months.

import { useState } from 'react';
import StarRating from '../../../components/primitives/StarRating';

// ── Reading pace by month ─────────────────────────────────────────────────────
export default function PaceChart({ books, onOpenBook }) {
  const [hovered, setHovered] = useState(null);   // month key being hovered
  const [selected, setSelected] = useState(null); // month key clicked for drill-down

  // Last 12 months
  const now = new Date();
  const months = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      label: d.toLocaleDateString(undefined, { month: 'short' }),
      fullLabel: d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
      count: 0,
      booksInMonth: [],
    });
  }
  for (const b of books) {
    if (!b.dateRead) continue;
    const d = new Date(b.dateRead);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const m = months.find((m) => m.key === key);
    if (m) { m.count++; m.booksInMonth.push(b); }
  }
  const maxCount = Math.max(...months.map((m) => m.count), 1);

  const selectedMonth = selected ? months.find((m) => m.key === selected) : null;

  return (
    <div className="pf-pace-panel">
      {/* Bar chart */}
      <div className="pf-pace-bars">
        {months.map((m) => {
          const isHovered = hovered === m.key;
          const isSelected = selected === m.key;
          return (
            <div
              key={m.key}
              className="pf-pace-bar-col"
              onMouseEnter={() => setHovered(m.key)}
              onMouseLeave={() => setHovered(null)}
            >
              {/* Tooltip */}
              {isHovered && (
                <div className="pf-pace-tooltip">
                  {m.count} book{m.count !== 1 ? 's' : ''}<br />
                  <span className="pf-pace-tooltip__meta">{m.fullLabel}</span>
                  {m.count > 0 && <div className="pf-pace-tooltip__hint">click to see list</div>}
                </div>
              )}
              {/* Bar */}
              <div
                onClick={() => m.count > 0 && setSelected(selected === m.key ? null : m.key)}
                className={`pf-pace-bar${isSelected ? ' pf-pace-bar--active' : isHovered && m.count > 0 ? ' pf-pace-bar--hover' : ''}`}
                style={{ '--pf-pace-h': `${Math.max(m.count / maxCount * 52, m.count > 0 ? 4 : 1)}px` }}
              />
              {/* Month label */}
              <div className="pf-pace-label">
                {m.label[0]}
              </div>
            </div>
          );
        })}
      </div>

      {/* Drill-down list for selected month */}
      {selectedMonth && selectedMonth.booksInMonth.length > 0 && (
        <div className="pf-pace-drill">
          <div className="pf-pace-drill__heading">
            {selectedMonth.fullLabel} · {selectedMonth.count} book{selectedMonth.count !== 1 ? 's' : ''}
          </div>
          <div className="pf-pace-drill__list">
            {selectedMonth.booksInMonth.map((b, i) => (
              <div
                key={b.bookId || b.t + i}
                onClick={() => onOpenBook?.(b)}
                className={`pf-pace-drill__row${onOpenBook ? ' pf-pace-drill__row--clickable' : ''}`}
              >
                {b.coverUrl ? (
                  <img src={b.coverUrl} alt={b.t} className="pf-pace-drill__cover" />
                ) : (
                  <div className="pf-pace-drill__cover--placeholder" />
                )}
                <div style={{ minWidth: 0 }}>
                  <div className="pf-pace-drill__title">{b.t}</div>
                  <div className="pf-pace-drill__author">{b.a}</div>
                  <StarRating as="div" className="pf-pace-drill__stars" value={b.rating} showEmpty emptyClassName="dim" />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
