import React from 'react';
import { Icon } from './ui';

/**
 * IVR menu builder.
 *
 * A menu entry is one key and one destination. The old form asked for both as
 * JSON, which meant looking up numbers by hand; this picks the destination from
 * what already exists, numbers the keys for you, and never produces a menu the
 * dialplan generator cannot read.
 */

export type MenuEntry = { key: string; type: string; target: string };

const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '*', '#'];

const TYPE_LABELS: Record<string, string> = {
  extension: 'Extension',
  ring_group: 'Ring group',
  queue: 'Queue',
  ivr: 'IVR',
  time_condition: 'Time condition',
  announcement: 'Announcement',
  voicemail: 'Voicemail',
  conference: 'Conference',
  parking: 'Parking',
  disa: 'DISA',
  misc: 'Misc destination',
  terminate: 'Hang up'
};

function parse(value: any): MenuEntry[] {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value || '[]'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function IvrMenuField({
  value, onChange, destinations
}: {
  value: any;
  onChange: (value: string) => void;
  destinations?: Record<string, { value: any; label: string }[]>;
}) {
  const entries = parse(value);
  const used = new Set(entries.map((e) => e.key));
  const duplicate = entries.some((e, i) => entries.findIndex((x) => x.key === e.key) !== i);

  const commit = (next: MenuEntry[]) => onChange(JSON.stringify(next));

  const update = (index: number, patch: Partial<MenuEntry>) => {
    commit(entries.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)));
  };

  const nextKey = () => DIGITS.find((d) => !used.has(d)) || '';

  const add = () => {
    const firstType = Object.keys(destinations || {}).find((t) => destinations![t]?.length);
    commit([...entries, { key: nextKey(), type: firstType || 'extension', target: '' }]);
  };

  const types = Object.keys(destinations || {}).filter((t) => destinations![t]?.length);

  return (
    <div className="field span-2">
      <label>Menu entries</label>
      <div style={{ display: 'grid', gap: 6 }}>
        {entries.length === 0 && (
          <div className="tiny faint">
            No keys yet. Add one and pick where it goes — the greeting recording is played first.
          </div>
        )}
        {entries.map((entry, index) => {
          const list = destinations?.[entry.type] || [];
          return (
            <div key={index} className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              <select
                className="select"
                value={entry.key}
                onChange={(e) => update(index, { key: e.target.value })}
                style={{ width: 84 }}
                aria-label={`Key for entry ${index + 1}`}
              >
                {DIGITS.map((d) => (
                  <option key={d} value={d} disabled={used.has(d) && d !== entry.key}>{d}</option>
                ))}
                {!DIGITS.includes(entry.key) && <option value={entry.key}>{entry.key || '—'}</option>}
              </select>
              <select
                className="select"
                value={entry.type}
                onChange={(e) => update(index, { type: e.target.value, target: '' })}
                style={{ width: 160 }}
                aria-label={`Destination type for entry ${index + 1}`}
              >
                {Object.entries(destinations || {}).map(([type, items]) => (
                  <option key={type} value={type} disabled={!items.length}>
                    {TYPE_LABELS[type] || type}
                  </option>
                ))}
                {!types.includes(entry.type) && <option value={entry.type}>{TYPE_LABELS[entry.type] || entry.type}</option>}
              </select>
              <select
                className="select"
                value={entry.target}
                onChange={(e) => update(index, { target: e.target.value })}
                style={{ flex: '1 1 200px' }}
                aria-label={`Destination for entry ${index + 1}`}
              >
                <option value="">— choose —</option>
                {list.map((d) => <option key={String(d.value)} value={String(d.value)}>{d.label} · {d.value}</option>)}
                {entry.target && !list.some((d) => String(d.value) === String(entry.target)) && (
                  <option value={entry.target}>{entry.target} (missing)</option>
                )}
              </select>
              <button
                className="icon-btn danger"
                type="button"
                title="Remove this key"
                onClick={() => commit(entries.filter((_, i) => i !== index))}
                aria-label={`Remove entry ${index + 1}`}
              >
                <Icon name="Trash2" size={14} />
              </button>
            </div>
          );
        })}
        <div className="row" style={{ gap: 8 }}>
          <button className="btn" type="button" onClick={add} disabled={!nextKey()}>
            <Icon name="Plus" size={15} /> Add key
          </button>
          {entries.length > 0 && (
            <span className="tiny faint">
              Callers press {entries.map((e) => e.key).join(', ')}. Anything else goes to the invalid destination.
            </span>
          )}
        </div>
        {duplicate && (
          <div className="tiny" style={{ color: 'var(--bad, #dc2626)' }}>
            Two entries use the same key; the later one wins in the dialplan.
          </div>
        )}
      </div>
      <span className="hint">Written as <span className="mono">exten =&gt; &lt;key&gt;</span> entries in the IVR context.</span>
    </div>
  );
}
