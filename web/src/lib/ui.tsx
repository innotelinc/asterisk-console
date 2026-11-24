import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  LayoutDashboard, PhoneCall, Terminal, UserRound, Cable, Hash, LogIn, LogOut,
  CircuitBoard, MessageSquare, Users, ListOrdered, GitBranch, Clock, CalendarClock,
  Megaphone, Podcast, Radio, Voicemail, SquareParking, KeyRound, Shuffle, Table2,
  Disc3, ScrollText, Activity, Asterisk, Ban, ShieldCheck, Contact, Music4, UserCog,
  Settings2, KeySquare, Boxes, Search, Plus, Pencil, Trash2, X, Check, ChevronDown,
  Moon, Sun, Menu, RefreshCw, Download, Upload, Copy, Play, Save, AlertTriangle,
  Info, Server, Cpu, HardDrive, MemoryStick, Network, PhoneIncoming, PhoneOutgoing,
  Gauge, Wifi, Zap, CircleCheck, CircleX, ExternalLink, Filter, ArrowRight, Loader2,
  CircleSlash, Lightbulb, FileCode2, Workflow, ShieldAlert, Database
} from 'lucide-react';
import type { Field } from './api';

/* ------------------------------------------------------------------ icons */
const ICONS: Record<string, any> = {
  LayoutDashboard, PhoneCall, Terminal, UserRound, Cable, Hash, LogIn, LogOut,
  CircuitBoard, MessageSquare, Users, ListOrdered, GitBranch, Clock, CalendarClock,
  Megaphone, Podcast, Radio, Voicemail, SquareParking, KeyRound, Shuffle, Table2,
  Disc3, ScrollText, Activity, Asterisk, Ban, ShieldCheck, Contact, Music4, UserCog,
  Settings2, KeySquare, Boxes, Search, Plus, Pencil, Trash2, X, Check, ChevronDown,
  Moon, Sun, Menu, RefreshCw, Download, Upload, Copy, Play, Save, AlertTriangle,
  Info, Server, Cpu, HardDrive, MemoryStick, Network, PhoneIncoming, PhoneOutgoing,
  Gauge, Wifi, Zap, CircleCheck, CircleX, ExternalLink, Filter, ArrowRight, Loader2,
  CircleSlash, Lightbulb, FileCode2, Workflow, ShieldAlert, Database
};

export function Icon({ name, size = 16, ...rest }: { name: string; size?: number; [k: string]: any }) {
  const Cmp = ICONS[name] || Info;
  return <Cmp size={size} {...rest} />;
}

/* ----------------------------------------------------------------- toasts */
type Toast = { id: number; text: string; tone: 'ok' | 'error' | 'info' };
const ToastCtx = createContext<{ push: (text: string, tone?: Toast['tone']) => void }>({ push: () => {} });
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const seq = useRef(0);
  const push = useCallback((text: string, tone: Toast['tone'] = 'ok') => {
    const id = ++seq.current;
    setItems((prev) => [...prev, { id, text, tone }]);
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 4200);
  }, []);
  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.tone}`}>
            <Icon name={t.tone === 'ok' ? 'CircleCheck' : t.tone === 'error' ? 'CircleX' : 'Info'} size={16} />
            <div>{t.text}</div>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* ------------------------------------------------------------------ modal */
export function Modal({
  title, subtitle, children, footer, onClose, wide, narrow, closable = true
}: {
  title: string; subtitle?: string; children: React.ReactNode; footer?: React.ReactNode;
  onClose: () => void; wide?: boolean; narrow?: boolean; closable?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && closable) onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose, closable]);

  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget && closable) onClose(); }}>
      <div className={`modal ${wide ? 'wide' : ''} ${narrow ? 'narrow' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <div className="grow">
            <h3>{title}</h3>
            {subtitle && <p>{subtitle}</p>}
          </div>
          {closable && (
            <button className="icon-btn" onClick={onClose} aria-label="Close">
              <X size={17} />
            </button>
          )}
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Confirm({
  title, message, confirmLabel = 'Delete', onConfirm, onClose
}: { title: string; message: React.ReactNode; confirmLabel?: string; onConfirm: () => void; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      narrow
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button
            className="btn danger"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try { await onConfirm(); } finally { setBusy(false); }
            }}
          >
            {busy ? <Loader2 size={15} className="spin" /> : <Trash2 size={15} />}
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="alert warn">
        <AlertTriangle size={16} />
        <div>{message}</div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ inputs */
export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <label className="switch">
      <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="track" />
      {label && <span>{label}</span>}
    </label>
  );
}

export function FieldControl({
  field, value, onChange, destinations, relations, autoFocus
}: {
  field: Field;
  value: any;
  onChange: (v: any) => void;
  destinations?: Record<string, { value: any; label: string }[]>;
  relations?: { value: any; label: string }[];
  autoFocus?: boolean;
}) {
  const common = { id: `f-${field.key}`, autoFocus };
  const label = (
    <label htmlFor={common.id}>
      {field.label}
      {field.required && <span className="req">*</span>}
    </label>
  );

  if (field.type === 'toggle') {
    return (
      <div className={`field ${field.wide ? 'span-2' : ''}`}>
        <label>{field.label}</label>
        <div style={{ paddingTop: 3 }}>
          <Toggle checked={!!value} onChange={onChange} label={value ? 'Enabled' : 'Disabled'} />
        </div>
        {field.help && <span className="hint">{field.help}</span>}
      </div>
    );
  }

  if (field.type === 'select') {
    return (
      <div className="field">
        {label}
        <select className="select" {...common} value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
          <option value="">— select —</option>
          {(field.options || []).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        {field.help && <span className="hint">{field.help}</span>}
      </div>
    );
  }

  if (field.type === 'relation') {
    return (
      <div className="field">
        {label}
        <select className="select" {...common} value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
          <option value="">— none —</option>
          {(relations || []).map((r) => <option key={String(r.value)} value={r.value}>{r.label}</option>)}
        </select>
      </div>
    );
  }

  if (field.type === 'destination') {
    return (
      <div className="field">
        {label}
        <input
          className="input"
          {...common}
          value={value ?? ''}
          placeholder="Number of the selected destination"
          onChange={(e) => onChange(e.target.value)}
        />
        {destinations && Object.keys(destinations).length > 0 && (
          <span className="hint">
            {Object.entries(destinations).slice(0, 4).map(([type, list]) => (
              <span key={type} style={{ marginRight: 10 }}>
                {type}: {list.slice(0, 4).map((d) => d.value).join(', ') || '—'}
              </span>
            ))}
          </span>
        )}
      </div>
    );
  }

  if (field.type === 'textarea' || field.type === 'json') {
    return (
      <div className="field span-2">
        {label}
        <textarea
          className={`textarea ${field.type === 'json' ? 'mono' : ''}`}
          {...common}
          rows={field.type === 'json' ? 6 : 3}
          value={typeof value === 'object' && value !== null ? JSON.stringify(value, null, 2) : value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
        />
        {field.help && <span className="hint">{field.help}</span>}
      </div>
    );
  }

  if (field.type === 'tags') {
    return (
      <div className="field">
        {label}
        <input
          className="input mono"
          {...common}
          value={Array.isArray(value) ? value.join(',') : value ?? ''}
          placeholder="comma,separated,values"
          onChange={(e) => onChange(e.target.value)}
        />
        {field.help && <span className="hint">{field.help}</span>}
      </div>
    );
  }

  return (
    <div className="field">
      {label}
      <input
        className="input"
        {...common}
        type={field.type === 'password' ? 'password' : field.type === 'number' ? 'number' : field.type === 'email' ? 'email' : 'text'}
        value={value ?? ''}
        placeholder={field.help && field.type !== 'password' ? '' : undefined}
        autoComplete={field.type === 'password' ? 'new-password' : 'off'}
        onChange={(e) => onChange(field.type === 'number' ? e.target.value : e.target.value)}
      />
      {field.help && <span className="hint">{field.help}</span>}
    </div>
  );
}

/* ------------------------------------------------------------------ table */
export type Column = {
  key: string;
  label: string;
  width?: number | string;
  align?: 'left' | 'right';
  render?: (row: any) => React.ReactNode;
};

export function DataTable({
  columns, rows, loading, empty, onRowClick
}: { columns: Column[]; rows: any[]; loading?: boolean; empty?: React.ReactNode; onRowClick?: (row: any) => void }) {
  if (loading) {
    return (
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {[0, 1, 2, 3, 4].map((i) => <div key={i} className="skeleton" style={{ height: 34 }} />)}
      </div>
    );
  }
  if (!rows.length) return <>{empty}</>;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={c.align === 'right' ? 'num' : ''} style={{ width: c.width }}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={row.id ?? i}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              style={onRowClick ? { cursor: 'pointer' } : undefined}
            >
              {columns.map((c) => (
                <td key={c.key} className={c.align === 'right' ? 'num' : ''}>
                  {c.render ? c.render(row) : renderCell(row[c.key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function renderCell(value: any): React.ReactNode {
  if (value === null || value === undefined || value === '') return <span className="faint">—</span>;
  if (typeof value === 'boolean') return <Badge tone={value ? 'ok' : ''}>{value ? 'Yes' : 'No'}</Badge>;
  if (value === 1 || value === 0) return <Badge tone={value ? 'ok' : ''}>{value ? 'Enabled' : 'Disabled'}</Badge>;
  const str = String(value);
  if (str.length > 62) return <span title={str}>{str.slice(0, 60)}…</span>;
  return str;
}

export function Badge({ tone = '', children }: { tone?: string; children: React.ReactNode }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export function EmptyState({ icon = 'Search', title, message, action }: { icon?: string; title: string; message?: string; action?: React.ReactNode }) {
  return (
    <div className="empty">
      <div className="icon-wrap"><Icon name={icon} size={20} /></div>
      <strong>{title}</strong>
      {message && <span style={{ maxWidth: 380 }}>{message}</span>}
      {action}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="row" style={{ gap: 8, color: 'var(--text-dim)', fontSize: 13 }}>
      <span className="spinner" />
      {label && <span>{label}</span>}
    </div>
  );
}

/* ------------------------------------------------------------------ charts */
export function AreaChart({
  data, xKey, series, height = 160
}: {
  data: any[]; xKey: string; series: { key: string; label: string; color: string }[]; height?: number;
}) {
  const width = 640;
  const pad = { l: 8, r: 8, t: 10, b: 22 };
  const innerW = width - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;
  const max = Math.max(1, ...data.flatMap((d) => series.map((s) => Number(d[s.key]) || 0)));
  const points = (key: string) =>
    data.map((d, i) => {
      const x = pad.l + (data.length === 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
      const y = pad.t + innerH - ((Number(d[key]) || 0) / max) * innerH;
      return [x, y];
    });

  const path = (key: string) => points(key).map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = (key: string) => {
    const pts = points(key);
    if (!pts.length) return '';
    return `${path(key)} L${pts[pts.length - 1][0].toFixed(1)},${(pad.t + innerH).toFixed(1)} L${pts[0][0].toFixed(1)},${(pad.t + innerH).toFixed(1)} Z`;
  };

  return (
    <div>
      <svg className="chart-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Call volume chart">
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <line
            key={f}
            x1={pad.l}
            x2={width - pad.r}
            y1={pad.t + innerH * (1 - f)}
            y2={pad.t + innerH * (1 - f)}
            stroke="var(--border)"
            strokeDasharray="3 4"
          />
        ))}
        {series.map((s) => (
          <g key={s.key}>
            <path d={area(s.key)} fill={s.color} opacity={0.1} />
            <path d={path(s.key)} fill="none" stroke={s.color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          </g>
        ))}
        {data.map((d, i) => {
          if (data.length > 12 && i % 2 !== 0) return null;
          const x = pad.l + (data.length === 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
          return (
            <text key={i} x={x} y={height - 6} fontSize={9.5} fill="var(--text-faint)" textAnchor="middle">
              {String(d[xKey]).replace(':00', '')}
            </text>
          );
        })}
      </svg>
      <div className="chart-legend" style={{ marginTop: 6 }}>
        {series.map((s) => (
          <span className="key" key={s.key}>
            <span className="swatch" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

export function Donut({ data, size = 150 }: { data: { label: string; value: number }[]; size?: number }) {
  const total = data.reduce((n, d) => n + d.value, 0) || 1;
  const colors = ['#0d9488', '#38bdf8', '#a78bfa', '#fbbf24', '#f87171', '#94a3b8'];
  const r = size / 2 - 12;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="row" style={{ gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Disposition breakdown">
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          {data.map((d, i) => {
            const len = (d.value / total) * c;
            const el = (
              <circle
                key={d.label}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={colors[i % colors.length]}
                strokeWidth={14}
                strokeDasharray={`${len} ${c - len}`}
                strokeDashoffset={-offset}
                strokeLinecap="butt"
              />
            );
            offset += len;
            return el;
          })}
        </g>
        <text x={size / 2} y={size / 2 - 2} textAnchor="middle" fontSize={19} fontWeight={700} fill="var(--text)">
          {total}
        </text>
        <text x={size / 2} y={size / 2 + 14} textAnchor="middle" fontSize={9.5} fill="var(--text-faint)">CALLS</text>
      </svg>
      <div className="col" style={{ gap: 6, flex: 1, minWidth: 130 }}>
        {data.slice(0, 6).map((d, i) => (
          <div key={d.label} className="spread" style={{ fontSize: 12 }}>
            <span className="row" style={{ gap: 7 }}>
              <span className="swatch" style={{ width: 9, height: 9, borderRadius: 3, background: colors[i % colors.length] }} />
              <span className="muted">{d.label}</span>
            </span>
            <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{d.value}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

export function HBars({ data, max }: { data: { label: string; value: number }[]; max?: number }) {
  const top = max || Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="col" style={{ gap: 9 }}>
      {data.map((d) => (
        <div key={d.label} className="bar-row">
          <span className="truncate mono" title={d.label}>{d.label}</span>
          <span className="bar-track"><span className="bar-fill" style={{ width: `${(d.value / top) * 100}%` }} /></span>
          <span className="right mono tiny muted">{d.value}</span>
        </div>
      ))}
    </div>
  );
}

export function Sparkline({ values, color = 'var(--accent)', height = 34 }: { values: number[]; color?: string; height?: number }) {
  const w = 120;
  const max = Math.max(1, ...values);
  const pts = values.map((v, i) => {
    const x = values.length === 1 ? w / 2 : (i / (values.length - 1)) * w;
    const y = height - (v / max) * (height - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
    </svg>
  );
}

/* --------------------------------------------------------------- utilities */
export function fmtDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds || 0));
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h) return `${h}h ${m % 60}m`;
  if (m) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

export function fmtUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}

export function fmtBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function timeAgo(iso: string): string {
  if (!iso) return '—';
  const then = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z').getTime();
  const diff = Math.max(0, Date.now() - then) / 1000;
  if (diff < 60) return `${Math.round(diff)}s ago`;
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  return `${Math.round(diff / 86400)}d ago`;
}

export function fmtDate(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function useDebounced<T>(value: T, delay = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return v;
}

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="btn sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1600);
        } catch {}
      }}
    >
      {done ? <Check size={13} /> : <Copy size={13} />}
      {done ? 'Copied' : label}
    </button>
  );
}
