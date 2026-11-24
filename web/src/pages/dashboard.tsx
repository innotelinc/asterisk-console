import React, { useEffect, useState } from 'react';
import { api, type Meta } from '../lib/api';
import {
  AreaChart, Badge, Donut, EmptyState, HBars, Icon, Spinner, fmtBytes, fmtDate, fmtDuration,
  fmtUptime, timeAgo
} from '../lib/ui';
import { useLive } from '../lib/live';

export default function DashboardPage({ meta, navigate }: { meta: Meta; navigate: (h: string) => void }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const { tick, connected } = useLive();

  const load = async () => {
    try {
      setData(await api.dashboard());
      setError('');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  if (loading) return <div style={{ padding: 40 }}><Spinner label="Loading telemetry…" /></div>;
  if (error) return <div className="alert error"><Icon name="CircleX" size={15} /><div>{error}</div></div>;

  const k = data.kpis;
  const sys = tick?.system || data.system;
  const calls = tick?.calls || [];
  const amiOk = tick?.ami?.connected ?? data.ami?.connected;

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <h1>System overview</h1>
          <p>
            {meta.app.name} · {k.extensions} active extensions · {k.trunks} trunks · {k.queues} queues
          </p>
        </div>
        <div className="page-actions">
          <span className={`badge ${connected ? 'ok' : 'warn'}`}>
            <span className={`dot ${connected ? 'ok pulse' : 'warn'}`} style={{ width: 6, height: 6 }} />
            {connected ? 'Live' : 'Offline'}
          </span>
          <button className="btn" onClick={() => navigate('#/tools')}>
            <Icon name="FileCode2" size={15} />
            View config
          </button>
          <button className="btn primary" onClick={() => navigate('#/e/extensions')}>
            <Icon name="Plus" size={15} />
            Add extension
          </button>
        </div>
      </div>

      <div className="kpi-grid">
        <Kpi label="Calls today" value={k.callsToday} foot={`${k.answerRate}% answered`} icon="PhoneCall" />
        <Kpi label="Active calls" value={tick?.counters.active ?? 0} foot={`${tick?.counters.waiting ?? 0} waiting · ${tick?.counters.talking ?? 0} talking`} icon="Activity" />
        <Kpi label="Missed today" value={k.missedToday} foot="No answer, busy or failed" icon="PhoneIncoming" />
        <Kpi label="Avg. talk time" value={fmtDuration(k.avgTalkSeconds)} foot="Answered calls, all time" icon="Gauge" />
      </div>

      <div className="grid dash" style={{ marginBottom: 14 }}>
        <div className="card">
          <div className="card-head">
            <div className="grow">
              <h3>Call volume</h3>
              <p>Last 24 hours, grouped by hour</p>
            </div>
            <Badge tone="accent">{k.callsToday} today</Badge>
          </div>
          <div className="card-body">
            {data.hourly.length ? (
              <AreaChart
                data={data.hourly}
                xKey="hour"
                series={[
                  { key: 'calls', label: 'Total calls', color: '#0d9488' },
                  { key: 'answered', label: 'Answered', color: '#38bdf8' }
                ]}
              />
            ) : <EmptyState icon="Activity" title="No calls in the last 24 hours" />}
          </div>
        </div>

        <div className="card">
          <div className="card-head"><div className="grow"><h3>Dispositions</h3><p>All recorded calls</p></div></div>
          <div className="card-body">
            <Donut data={data.dispositions} />
          </div>
        </div>
      </div>

      <div className="grid dash" style={{ marginBottom: 14 }}>
        <div className="card">
          <div className="card-head">
            <div className="grow"><h3>Active calls</h3><p>Streamed every 4 seconds</p></div>
            <button className="btn ghost sm" onClick={() => navigate('#/calls')}>Open monitor <Icon name="ArrowRight" size={13} /></button>
          </div>
          <div className="call-list">
            {calls.length === 0 && <EmptyState icon="PhoneCall" title="No active calls" message="Channels appear here as calls are placed." />}
            {calls.map((c: any) => (
              <div className="call-item" key={c.id}>
                <span className="call-avatar">{String(c.caller).slice(-2)}</span>
                <div className="call-meta">
                  <strong className="truncate">{c.callerName} → {c.calleeName}</strong>
                  <span>
                    {c.caller} → {c.callee} · {c.direction}
                    {c.queue ? ` · ${c.queue}` : ''}
                  </span>
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <Badge tone={c.state === 'talking' ? 'ok' : c.state === 'waiting' ? 'warn' : 'info'}>{c.state}</Badge>
                  <span className="mono tiny muted">{fmtDuration((Date.now() - c.startedAt) / 1000)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-head"><div className="grow"><h3>Queues</h3><p>Static agents configured</p></div></div>
          <div className="call-list">
            {data.queues.map((q: any) => (
              <div className="call-item" key={q.number}>
                <span className="call-avatar"><Icon name="ListOrdered" size={13} /></span>
                <div className="call-meta">
                  <strong>{q.name}</strong>
                  <span>{q.number} · {q.strategy} · {q.timeout}s timeout</span>
                </div>
                <Badge tone="info">{q.agents} agents</Badge>
              </div>
            ))}
            {data.queues.length === 0 && <EmptyState icon="ListOrdered" title="No queues configured" />}
          </div>
        </div>
      </div>

      <div className="grid three">
        <div className="card">
          <div className="card-head">
            <div className="grow"><h3>Weekly trend</h3><p>Last 7 days</p></div>
          </div>
          <div className="card-body">
            {data.trend.length ? (
              <HBars data={data.trend.map((t: any) => ({ label: t.day.slice(5), value: t.calls }))} />
            ) : <EmptyState icon="Activity" title="Not enough history" />}
            <div className="row" style={{ marginTop: 14, gap: 18 }}>
              <div>
                <div className="tiny faint">Answered</div>
                <strong style={{ fontSize: 17 }}>{data.trend.reduce((n: number, t: any) => n + t.answered, 0)}</strong>
              </div>
              <div>
                <div className="tiny faint">Talk minutes</div>
                <strong style={{ fontSize: 17 }}>{data.trend.reduce((n: number, t: any) => n + t.minutes, 0)}</strong>
              </div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-head"><div className="grow"><h3>Top destinations</h3><p>Most dialled numbers</p></div></div>
          <div className="card-body">
            {data.topDestinations.length
              ? <HBars data={data.topDestinations} />
              : <EmptyState icon="Hash" title="No call history" />}
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <div className="grow"><h3>System health</h3><p>{sys.hostname}</p></div>
            <span className={`dot ${amiOk ? 'ok' : 'warn'}`} title={amiOk ? 'AMI connected' : 'AMI not configured'} />
          </div>
          <div className="card-body col" style={{ gap: 12 }}>
            <HealthRow icon="Server" label="Uptime" value={fmtUptime(sys.uptimeSeconds)} />
            <HealthRow icon="Cpu" label="Load (1m)" value={`${sys.load1} / ${sys.cpus} cores`} />
            <HealthRow icon="MemoryStick" label="Memory" value={`${sys.memoryPct}% of ${fmtBytes(sys.memoryTotal)}`} />
            <div className="bar-track" style={{ height: 6 }}>
              <div className="bar-fill" style={{ width: `${sys.memoryPct}%`, background: sys.memoryPct > 85 ? 'var(--danger)' : 'var(--accent)' }} />
            </div>
            <HealthRow icon="Database" label="Storage" value="SQLite (WAL)" />
            <HealthRow icon="Boxes" label="Modules" value={`${meta.modules.length} consolidated`} />
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-head">
          <div className="grow"><h3>Recent calls</h3><p>Latest records from the CDR</p></div>
          <button className="btn ghost sm" onClick={() => navigate('#/cdr')}>All records <Icon name="ArrowRight" size={13} /></button>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Time</th><th>Caller</th><th>Destination</th><th>Direction</th>
                <th className="num">Duration</th><th>Disposition</th>
              </tr>
            </thead>
            <tbody>
              {data.recent.map((r: any) => (
                <tr key={r.id}>
                  <td className="nowrap muted">{fmtDate(r.calldate)}</td>
                  <td><span className="mono">{r.src}</span></td>
                  <td><span className="mono">{r.dst}</span> <span className="tiny faint">{r.queue || ''}</span></td>
                  <td><Badge tone={r.direction === 'inbound' ? 'info' : ''}>{r.direction}</Badge></td>
                  <td className="num mono">{fmtDuration(r.billsec)}</td>
                  <td>
                    <Badge tone={r.disposition === 'ANSWERED' ? 'ok' : r.disposition === 'NO ANSWER' ? 'warn' : 'bad'}>
                      {r.disposition}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="tiny faint" style={{ marginTop: 16 }}>
        Data refreshed {timeAgo(data.system ? new Date().toISOString() : '')} · live channel events arrive over SSE
      </p>
    </>
  );
}

function Kpi({ label, value, foot, icon }: { label: string; value: React.ReactNode; foot: string; icon: string }) {
  return (
    <div className="kpi">
      <span className="kpi-icon"><Icon name={icon} size={18} /></span>
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">{value}</span>
      <span className="kpi-foot">{foot}</span>
    </div>
  );
}

function HealthRow({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="spread" style={{ fontSize: 12.5 }}>
      <span className="row" style={{ gap: 8, color: 'var(--text-dim)' }}>
        <Icon name={icon} size={14} />
        {label}
      </span>
      <strong style={{ fontWeight: 600 }}>{value}</strong>
    </div>
  );
}
