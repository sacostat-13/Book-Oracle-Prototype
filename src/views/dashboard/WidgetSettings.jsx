// src/views/dashboard/WidgetSettings.jsx — show, hide and reorder Dashboard widgets.

import { useState } from 'react';
import { WIDGET_LABELS } from './layout';
import { IconSparkle } from './WidgetShell';

export default function WidgetSettings({ layout, onClose, onChange, t }) {
  const [local, setLocal] = useState(layout);

  function toggle(id) {
    setLocal((l) => l.map((w) => w.id === id ? { ...w, visible: !w.visible } : w));
  }
  function move(id, dir) {
    setLocal((l) => {
      const idx = l.findIndex((w) => w.id === id);
      if (idx < 0) return l;
      const next = [...l]; const swap = idx + dir;
      if (swap < 0 || swap >= next.length) return l;
      [next[idx], next[swap]] = [next[swap], next[idx]];
      return next;
    });
  }
  function save() { onChange(local); onClose(); }

  return (
    <div className="db-settings-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="db-settings">
        <div className="db-settings__head">
          <div>
            <div className="db-settings__eyebrow">
              <IconSparkle /> {t('dashboard.widgetSettingsTitle')}
            </div>
            <div className="db-settings__sub">{t('dashboard.widgetSettingsSub')}</div>
          </div>
          <button className="btn-icon" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="db-settings__list">
          {local.map((w, i) => (
            <div key={w.id} className={`db-settings__row${w.visible ? '' : ' db-settings__row--hidden'}`}>
              <button
                className={`db-settings__toggle${w.visible ? ' db-settings__toggle--on' : ''}`}
                onClick={() => toggle(w.id)}
                title={w.visible ? t('dashboard.widgetHide') : t('dashboard.widgetShow')}
              >
                {w.visible ? '✓' : '○'}
              </button>
              <span className="db-settings__name">
                {t(`dashboard.${WIDGET_LABELS[w.id] || w.id}`)}
              </span>
              <div className="db-settings__moves">
                <button className="db-settings__move" onClick={() => move(w.id, -1)} disabled={i === 0} title="Up">↑</button>
                <button className="db-settings__move" onClick={() => move(w.id, 1)} disabled={i === local.length - 1} title="Down">↓</button>
              </div>
            </div>
          ))}
        </div>

        <button className="btn-primary btn--block" onClick={save}>
          {t('dashboard.widgetDone')}
        </button>
      </div>
    </div>
  );
}
