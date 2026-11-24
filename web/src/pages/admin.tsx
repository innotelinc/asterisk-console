import React, { useEffect, useMemo, useState } from 'react';
import { api, type Meta, type Session } from '../lib/api';
import {
  Badge, Confirm, CopyButton, DataTable, EmptyState, FieldControl, Icon, Modal,
  Spinner, fmtBytes, fmtDate, fmtUptime, renderCell, timeAgo, useToast
} from '../lib/ui';

/* ---------------------------------------------------------------- settings */
export function SettingsPage({ meta, session }: { meta: Meta; session: Session }) {
  const [group, setGroup] = useState(meta.settingsGroups[0]?.group || '');
  const [values, setValues] = useState<Record<string, any> | null>(null);
  const [dirty, setDirty] = useState<Record<string, any>>({});
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const { push } = useToast();
  const readOnly = session.role !== 'admin';

  useEffect(() => {
    (async () => {
      try {
        const res = await api.settings();
        setValues(res.values);
      } catch (err: any) {
        push(err.message, 'error');
      } finally {
        setLoading(false);
      }
    })();
  }, [push]);

  const active = meta.settingsGroups.find((g) => g.group === group);
  const current = { ...(values || {}), ...dirty };

  const save = async () => {
    if (!Object.keys(dirty).length) return;
    setBusy(true);
    try {
      const res = await api.saveSettings(dirty);
      setValues(res.values);
      setDirty({});
      push('Settings saved');
    } catch (err: any) {
      push(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div style={{ padding: 30 }}><Spinner label="Loading settings…" /></div>;

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <h1>Advanced settings</h1>
          <p>Stored in the application database and consumed by config generation and the AMI client.</p>
        </div>
        <div className="page-actions">
          {readOnly && <Badge tone="warn">Read only</Badge>}
          <button className="btn primary" onClick={save} disabled={busy || readOnly || !Object.keys(dirty).length}>
            {busy ? <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> : <Icon name="Save" size={15} />}
            Save changes{Object.keys(dirty).length ? ` (${Object.keys(dirty).length})` : ''}
          </button>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'minmax(180px, 220px) minmax(0, 1fr)' }}>
        <div className="card" style={{ alignSelf: 'start' }}>
          <div style={{ padding: 6 }}>
            {meta.settingsGroups.map((g) => (
              <button
                key={g.group}
                className={`nav-item ${group === g.group ? 'active' : ''}`}
                style={{ color: group === g.group ? 'var(--text)' : 'var(--text-dim)' }}
                onClick={() => setGroup(g.group)}
              >
                <Icon name="Settings2" size={14} />
                {g.group}
              </button>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <div className="grow"><h3>{active?.group}</h3><p>{active?.items.length} settings</p></div>
          </div>
          <div className="card-body">
            <div className="form-grid">
              {active?.items.map((item) => (
                <FieldControl
                  key={item.key}
                  field={item}
                  value={current[item.key] ?? ''}
                  onChange={(v) => { if (!readOnly) setDirty((d) => ({ ...d, [item.key]: v })); }}
                />
              ))}
            </div>
            {group === 'Asterisk' && (
              <div className="alert info" style={{ marginTop: 16 }}>
                <Icon name="Info" size={15} />
                <div>
                  AMI credentials enable live channel data. The console only issues read-only actions
                  (<span className="mono">CoreStatus</span>) and never executes dialplan commands.
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ tokens */
export function TokensPage({ meta, session }: { meta: Meta; session: Session }) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<any | null>(null);
  const [issued, setIssued] = useState<{ name: string; token: string } | null>(null);
  const { push } = useToast();
  const isAdmin = session.role === 'admin';

  const load = async () => {
    setLoading(true);
    try { setRows((await api.list('api_keys')).rows); } catch (err: any) { push(err.message, 'error'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <h1>API tokens</h1>
          <p>Long-lived credentials for automation, sent as <span className="mono">Authorization: Bearer …</span>. Hashed with SHA-256 and shown once.</p>
        </div>
        <div className="page-actions">
          {isAdmin && (
            <button className="btn primary" onClick={() => setCreating(true)}>
              <Icon name="Plus" size={15} />New token
            </button>
          )}
        </div>
      </div>

      <div className="card">
        <DataTable
          loading={loading}
          rows={rows}
          columns={[
            { key: 'name', label: 'Name', render: (r) => <strong>{r.name}</strong> },
            { key: 'role', label: 'Scope', render: (r) => <Badge tone={r.role === 'admin' ? 'violet' : r.role === 'operator' ? 'info' : ''}>{r.role}</Badge> },
            { key: 'prefix', label: 'Prefix', render: (r) => <span className="chip">{r.prefix || '—'}…</span> },
            { key: 'created_at', label: 'Created', render: (r) => <span className="muted">{fmtDate(r.created_at)}</span> },
            { key: 'last_used', label: 'Last used', render: (r) => <span className="muted">{r.last_used || 'never'}</span> },
            {
              key: 'actions', label: '', width: 60,
              render: (r) => isAdmin ? (
                <div className="actions">
                  <button className="icon-btn danger" onClick={() => setRevoking(r)} aria-label="Revoke"><Icon name="Trash2" size={14} /></button>
                </div>
              ) : null
            }
          ]}
          empty={<EmptyState icon="KeySquare" title="No API tokens" message={isAdmin ? 'Create a token for scripts and integrations.' : 'Ask an administrator to create one.'} />}
        />
      </div>

      {creating && (
        <TokenForm
          onClose={() => setCreating(false)}
          onCreated={async (name, token) => {
            setCreating(false);
            setIssued({ name, token });
            await load();
          }}
        />
      )}

      {issued && (
        <Modal
          title="Token created"
          subtitle="Copy it now — only its hash is stored."
          onClose={() => setIssued(null)}
          footer={<button className="btn primary" onClick={() => setIssued(null)}>Done</button>}
        >
          <div className="field">
            <label>{issued.name}</label>
            <div className="input-group">
              <input className="input mono" readOnly value={issued.token} onFocus={(e) => e.currentTarget.select()} />
              <CopyButton text={issued.token} />
            </div>
          </div>
          <pre className="code" style={{ margin: 0 }}>{`curl -H "Authorization: Bearer ${issued.token}" ${window.location.origin}/api/meta`}</pre>
        </Modal>
      )}

      {revoking && (
        <Confirm
          title="Revoke token"
          message={<><strong>{revoking.name}</strong> will stop working immediately.</>}
          confirmLabel="Revoke"
          onClose={() => setRevoking(null)}
          onConfirm={async () => {
            try {
              await api.remove('api_keys', revoking.id);
              push('Token revoked');
              setRevoking(null);
              await load();
            } catch (err: any) { push(err.message, 'error'); }
          }}
        />
      )}
    </>
  );
}

function TokenForm({ onClose, onCreated }: { onClose: () => void; onCreated: (name: string, token: string) => void }) {
  const [name, setName] = useState('');
  const [role, setRole] = useState('readonly');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!name.trim()) return setError('Give the token a recognizable name.');
    setBusy(true);
    try {
      const res = await api.create('api_keys', { name, role });
      onCreated(name, res.token || '');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      narrow
      title="New API token"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={submit} disabled={busy}>
            {busy ? <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> : <Icon name="KeySquare" size={15} />}
            Create token
          </button>
        </>
      }
    >
      <div className="col">
        {error && <div className="alert error"><Icon name="CircleX" size={15} /><div>{error}</div></div>}
        <div className="field">
          <label htmlFor="token-name">Name</label>
          <input id="token-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Terraform / monitoring" autoFocus />
        </div>
        <div className="field">
          <label htmlFor="token-role">Scope</label>
          <select id="token-role" className="select" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="readonly">Read only</option>
            <option value="operator">Operator</option>
            <option value="admin">Administrator</option>
          </select>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------- audit */
export function AuditPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');

  useEffect(() => {
    (async () => {
      try { setRows((await api.audit()).rows); } catch {} finally { setLoading(false); }
    })();
  }, []);

  const filtered = useMemo(() => {
    if (!q.trim()) return rows;
    const needle = q.toLowerCase();
    return rows.filter((r) => `${r.actor} ${r.action} ${r.entity} ${r.detail}`.toLowerCase().includes(needle));
  }, [rows, q]);

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <h1>Audit log</h1>
          <p>Every mutation, sign-in and configuration write, newest first.</p>
        </div>
      </div>
      <div className="card">
        <div className="toolbar">
          <div className="search">
            <Icon name="Search" size={15} className="faint" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by actor, action or module…" />
          </div>
          <span className="right tiny faint">{filtered.length} entries</span>
        </div>
        <DataTable
          loading={loading}
          rows={filtered}
          columns={[
            { key: 'ts', label: 'When', width: 150, render: (r) => <span className="muted nowrap">{fmtDate(r.ts)}</span> },
            { key: 'actor', label: 'Actor', render: (r) => <strong>{r.actor}</strong> },
            { key: 'action', label: 'Action', render: (r) => <Badge tone={r.action.includes('delete') ? 'bad' : r.action.includes('login') ? 'info' : 'accent'}>{r.action}</Badge> },
            { key: 'entity', label: 'Module', render: (r) => <span className="mono tiny">{r.entity || '—'}</span> },
            { key: 'entity_id', label: 'ID', width: 70 },
            { key: 'detail', label: 'Detail', render: (r) => <span className="tiny muted truncate" style={{ maxWidth: 380, display: 'inline-block' }} title={r.detail}>{String(r.detail || '').slice(0, 120)}</span> },
            { key: 'ip', label: 'IP', render: (r) => <span className="mono tiny faint">{String(r.ip || '').replace('::ffff:', '')}</span> }
          ]}
          empty={<EmptyState icon="ScrollText" title="Nothing logged yet" />}
        />
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ system */
export function SystemPage({ meta }: { meta: Meta }) {
  const [data, setData] = useState<any>(null);
  const [config, setConfig] = useState<any>(null);

  useEffect(() => {
    (async () => {
      try {
        const [d, c] = await Promise.all([api.dashboard(), api.config()]);
        setData(d);
        setConfig(c);
      } catch {}
    })();
  }, []);

  if (!data) return <div style={{ padding: 30 }}><Spinner label="Reading system status…" /></div>;
  const sys = data.system;

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <h1>System status</h1>
          <p>{sys.hostname} · {sys.platform} · Node {sys.node}</p>
        </div>
      </div>

      <div className="kpi-grid">
        <Stat label="Host uptime" value={fmtUptime(sys.uptimeSeconds)} icon="Server" />
        <Stat label="Process uptime" value={fmtUptime(sys.processUptimeSeconds)} icon="Activity" />
        <Stat label="Load average" value={sys.load1.toFixed(2)} icon="Cpu" foot={`${sys.cpus} cores · 5m ${sys.load5} · 15m ${sys.load15}`} />
        <Stat label="Memory used" value={`${sys.memoryPct}%`} icon="MemoryStick" foot={`${fmtBytes(sys.memoryUsed)} of ${fmtBytes(sys.memoryTotal)}`} />
      </div>

      <div className="grid two">
        <div className="card">
          <div className="card-head"><div className="grow"><h3>Asterisk integration</h3><p>Manager interface and generated config</p></div></div>
          <div className="card-body col">
            <Row label="AMI status" value={data.ami?.connected ? <Badge tone="ok">Connected</Badge> : <Badge tone="warn">Not connected</Badge>} />
            <Row label="Last poll" value={data.ami?.lastPoll ? timeAgo(data.ami.lastPoll) : '—'} />
            {data.ami?.lastError && <Row label="Last error" value={<span className="mono tiny" style={{ color: 'var(--danger)' }}>{data.ami.lastError}</span>} />}
            <Row label="Config directory" value={<span className="mono tiny">{meta.app.asteriskConfigDir}</span>} />
            <Row label="Generated files" value={config?.summary?.files ?? '—'} />
            <Row label="Generated lines" value={config?.summary?.lines ?? '—'} />
            {config?.warnings?.length ? (
              <div className="alert warn" style={{ marginTop: 4 }}>
                <Icon name="AlertTriangle" size={15} />
                <div>{config.warnings.join(' ')}</div>
              </div>
            ) : null}
          </div>
        </div>

        <div className="card">
          <div className="card-head"><div className="grow"><h3>Application</h3><p>Build and data footprint</p></div></div>
          <div className="card-body col">
            <Row label="Version" value={meta.app.version} />
            <Row label="Storage" value="SQLite (WAL mode)" />
            <Row label="Demo data" value={meta.app.seeded ? <Badge tone="ok">Loaded</Badge> : <Badge>Empty</Badge>} />
            <Row label="Modules consolidated" value={`${meta.modules.length}`} />
            <Row label="Data modules" value={`${Object.keys(meta.entities).length}`} />
            <Row label="Runtime" value="Single container, no PHP" />
            <Row label="Auth" value="scrypt + signed cookies" />
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-head"><div className="grow"><h3>Configuration summary</h3><p>What the current database compiles to</p></div></div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Metric</th><th className="num">Value</th></tr></thead>
            <tbody>
              {config && Object.entries(config.summary).map(([k, v]) => (
                <tr key={k}><td style={{ textTransform: 'capitalize' }}>{k.replace(/([A-Z])/g, ' $1')}</td><td className="num mono">{String(v)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function Stat({ label, value, icon, foot }: { label: string; value: React.ReactNode; icon: string; foot?: string }) {
  return (
    <div className="kpi">
      <span className="kpi-icon"><Icon name={icon} size={18} /></span>
      <span className="kpi-label">{label}</span>
      <span className="kpi-value" style={{ fontSize: 21 }}>{value}</span>
      {foot && <span className="kpi-foot">{foot}</span>}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="spread" style={{ fontSize: 12.8 }}>
      <span className="muted">{label}</span>
      <span style={{ textAlign: 'right' }}>{value}</span>
    </div>
  );
}

/* ----------------------------------------------------------------- modules */
export function ModulesPage({ meta, navigate }: { meta: Meta; navigate: (h: string) => void }) {
  const [q, setQ] = useState('');
  const [group, setGroup] = useState('');
  const groups = useMemo(() => Array.from(new Set(meta.modules.map((m) => m.group))), [meta.modules]);

  const filtered = useMemo(() => {
    const needle = q.toLowerCase().trim();
    return meta.modules.filter((m) => {
      if (group && m.group !== group) return false;
      if (!needle) return true;
      return `${m.id} ${m.label} ${m.group} ${m.entity || ''}`.toLowerCase().includes(needle);
    });
  }, [meta.modules, q, group]);

  const mapped = meta.modules.filter((m) => m.entity).length;

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <h1>Module registry</h1>
          <p>
            All {meta.modules.length} modules from the original navigation are present. {mapped} map directly onto a
            data module; the rest are consolidated into the config, dialplan and reporting surfaces.
          </p>
        </div>
      </div>

      <div className="kpi-grid">
        <div className="kpi"><span className="kpi-label">Legacy modules</span><span className="kpi-value">{meta.modules.length}</span><span className="kpi-foot">Observed in the source system</span></div>
        <div className="kpi"><span className="kpi-label">Data-backed</span><span className="kpi-value">{mapped}</span><span className="kpi-foot">Full CRUD + CSV</span></div>
        <div className="kpi"><span className="kpi-label">Consolidated</span><span className="kpi-value">{meta.modules.length - mapped}</span><span className="kpi-foot">Served by config/reports</span></div>
        <div className="kpi"><span className="kpi-label">Plugins needed</span><span className="kpi-value">0</span><span className="kpi-foot">Everything ships built in</span></div>
      </div>

      <div className="card">
        <div className="toolbar">
          <div className="search">
            <Icon name="Search" size={15} className="faint" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search 84 modules…" />
          </div>
          <select className="select" style={{ width: 170 }} value={group} onChange={(e) => setGroup(e.target.value)}>
            <option value="">All groups</option>
            {groups.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
          <span className="right tiny faint">{filtered.length} shown</span>
        </div>
        <DataTable
          rows={filtered}
          columns={[
            { key: 'label', label: 'Module', render: (m) => <strong>{m.label}</strong> },
            { key: 'id', label: 'Legacy ID', render: (m) => <span className="chip">{m.id}</span> },
            { key: 'group', label: 'Group', render: (m) => <Badge>{m.group}</Badge> },
            {
              key: 'entity', label: 'Now served by', render: (m) => m.entity ? (
                <button className="btn sm" onClick={() => navigate(`#/e/${m.entity}`)}>
                  {meta.entities[m.entity]?.plural || m.entity}
                  <Icon name="ArrowRight" size={12} />
                </button>
              ) : (
                <span className="tiny muted">Config, dialplan &amp; reporting surface</span>
              )
            }
          ]}
          empty={<EmptyState icon="Boxes" title="No modules match" />}
        />
      </div>
    </>
  );
}
