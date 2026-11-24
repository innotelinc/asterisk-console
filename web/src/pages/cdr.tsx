import React, { useCallback, useEffect, useState } from 'react';
import { api, type Session } from '../lib/api';
import {
  Badge, Confirm, EmptyState, Icon, Spinner, fmtDate, fmtDuration, renderCell,
  useDebounced, useToast
} from '../lib/ui';
import { useLive } from '../lib/live';

/* ------------------------------------------------------------------- CDR */
export function CdrPage({ session }: { session: Session }) {
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [direction, setDirection] = useState('');
  const [disposition, setDisposition] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [limit, setLimit] = useState(100);
  const [clearing, setClearing] = useState(false);
  const debouncedQ = useDebounced(q, 250);
  const { push } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.cdr({
        q: debouncedQ, direction, disposition,
        from: from ? `${from} 00:00:00` : '',
        to: to ? `${to} 23:59:59` : '',
        limit
      });
      setRows(res.rows);
      setTotal(res.total);
    } catch (err: any) {
      push(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [debouncedQ, direction, disposition, from, to, limit, push]);

  useEffect(() => { load(); }, [load]);

  const totalMinutes = Math.round(rows.reduce((n, r) => n + (r.billsec || 0), 0) / 60);

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <h1>Call detail records</h1>
          <p>{total} records · {totalMinutes} billed minutes in the current view</p>
        </div>
        <div className="page-actions">
          <button className="btn" onClick={load}><Icon name="RefreshCw" size={15} />Refresh</button>
          {session.role === 'admin' && (
            <button className="btn danger" onClick={() => setClearing(true)}>
              <Icon name="Trash2" size={15} />Clear
            </button>
          )}
        </div>
      </div>

      <div className="card">
        <div className="toolbar">
          <div className="search">
            <Icon name="Search" size={15} className="faint" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Number, caller ID…" aria-label="Search calls" />
          </div>
          <select className="select" style={{ width: 140 }} value={direction} onChange={(e) => setDirection(e.target.value)} aria-label="Direction">
            <option value="">All directions</option>
            <option value="inbound">Inbound</option>
            <option value="internal">Internal</option>
          </select>
          <select className="select" style={{ width: 150 }} value={disposition} onChange={(e) => setDisposition(e.target.value)} aria-label="Disposition">
            <option value="">All dispositions</option>
            <option value="ANSWERED">Answered</option>
            <option value="NO ANSWER">No answer</option>
            <option value="BUSY">Busy</option>
            <option value="FAILED">Failed</option>
          </select>
          <input className="input" type="date" style={{ width: 148 }} value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
          <input className="input" type="date" style={{ width: 148 }} value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
          <select className="select" style={{ width: 110 }} value={limit} onChange={(e) => setLimit(Number(e.target.value))} aria-label="Rows">
            <option value={50}>50 rows</option>
            <option value={100}>100 rows</option>
            <option value={250}>250 rows</option>
            <option value={500}>500 rows</option>
          </select>
        </div>

        {loading ? (
          <div style={{ padding: 20 }}><Spinner label="Querying call records…" /></div>
        ) : rows.length === 0 ? (
          <EmptyState icon="Table2" title="No calls match these filters" message="Adjust the date range or clear the search." />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Time</th><th>Caller</th><th>Destination</th><th>Context</th>
                  <th>Direction</th><th className="num">Ring</th><th className="num">Talk</th>
                  <th>Disposition</th><th>Answered by</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="nowrap muted">{fmtDate(r.calldate)}</td>
                    <td><span className="mono">{r.src}</span></td>
                    <td><span className="mono">{r.dst}</span>{r.queue ? <span className="tiny faint"> · {r.queue}</span> : null}</td>
                    <td className="tiny muted">{r.dcontext}</td>
                    <td><Badge tone={r.direction === 'inbound' ? 'info' : ''}>{r.direction}</Badge></td>
                    <td className="num mono">{fmtDuration(Math.max(0, (r.duration || 0) - (r.billsec || 0)))}</td>
                    <td className="num mono">{fmtDuration(r.billsec)}</td>
                    <td><Badge tone={r.disposition === 'ANSWERED' ? 'ok' : r.disposition === 'NO ANSWER' ? 'warn' : 'bad'}>{r.disposition}</Badge></td>
                    <td>{renderCell(r.answered_by)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {clearing && (
        <Confirm
          title="Clear call records"
          message="Every CDR row will be deleted. This cannot be undone."
          confirmLabel="Delete all records"
          onClose={() => setClearing(false)}
          onConfirm={async () => {
            try {
              await api.clearCdr();
              push('Call records cleared');
              setClearing(false);
              await load();
            } catch (err: any) { push(err.message, 'error'); }
          }}
        />
      )}
    </>
  );
}

/* --------------------------------------------------------------- live calls */
export function CallsPage({ navigate }: { navigate: (h: string) => void }) {
  const { tick, connected } = useLive();
  const calls = tick?.calls || [];
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <h1>Call activity</h1>
          <p>Live channel state, streamed from the server every 4 seconds.</p>
        </div>
        <div className="page-actions">
          <span className={`badge ${connected ? 'ok' : 'warn'}`}>
            <span className={`dot ${connected ? 'ok pulse' : 'warn'}`} style={{ width: 6, height: 6 }} />
            {connected ? 'Streaming' : 'Reconnecting'}
          </span>
          <button className="btn" onClick={() => navigate('#/cdr')}><Icon name="Table2" size={15} />Call records</button>
        </div>
      </div>

      <div className="kpi-grid">
        <div className="kpi">
          <span className="kpi-icon"><Icon name="PhoneCall" size={18} /></span>
          <span className="kpi-label">Active channels</span>
          <span className="kpi-value">{tick?.counters.active ?? 0}</span>
          <span className="kpi-foot">Ringing, queued or talking</span>
        </div>
        <div className="kpi">
          <span className="kpi-icon"><Icon name="Clock" size={18} /></span>
          <span className="kpi-label">Waiting in queue</span>
          <span className="kpi-value">{tick?.counters.waiting ?? 0}</span>
          <span className="kpi-foot">Connected to a queue, no agent yet</span>
        </div>
        <div className="kpi">
          <span className="kpi-icon"><Icon name="PhoneOutgoing" size={18} /></span>
          <span className="kpi-label">Talking</span>
          <span className="kpi-value">{tick?.counters.talking ?? 0}</span>
          <span className="kpi-foot">Bridged calls</span>
        </div>
        <div className="kpi">
          <span className="kpi-icon"><Icon name="Wifi" size={18} /></span>
          <span className="kpi-label">AMI link</span>
          <span className="kpi-value" style={{ fontSize: 18 }}>{tick?.ami?.connected ? 'Connected' : 'Simulated'}</span>
          <span className="kpi-foot">{tick?.ami?.lastError || (tick?.ami?.connected ? 'Asterisk Manager Interface' : 'Configure AMI in settings')}</span>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div className="grow"><h3>Channel monitor</h3><p>Caller → destination, live duration</p></div>
          <Badge tone={calls.length ? 'accent' : ''}>{calls.length} active</Badge>
        </div>
        {calls.length === 0 ? (
          <EmptyState icon="PhoneCall" title="Idle" message="No calls are in progress. Channels will appear here as they connect." />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>State</th><th>Caller</th><th>Destination</th><th>Direction</th><th>Queue</th><th className="num">Duration</th></tr>
              </thead>
              <tbody>
                {calls.map((c: any) => (
                  <tr key={c.id}>
                    <td><Badge tone={c.state === 'talking' ? 'ok' : c.state === 'waiting' ? 'warn' : 'info'}>{c.state}</Badge></td>
                    <td><strong>{c.callerName}</strong> <span className="mono tiny muted">{c.caller}</span></td>
                    <td><strong>{c.calleeName}</strong> <span className="mono tiny muted">{c.callee}</span></td>
                    <td><Badge tone={c.direction === 'inbound' ? 'info' : ''}>{c.direction}</Badge></td>
                    <td>{c.queue || <span className="faint">—</span>}</td>
                    <td className="num mono">{fmtDuration((now - c.startedAt) / 1000)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="alert info" style={{ marginTop: 14 }}>
        <Icon name="Info" size={15} />
        <div>
          Without an AMI connection the console generates representative channel activity so the interface stays
          testable. Configure <span className="mono">ami_host</span> and credentials under Advanced Settings to read
          real Asterisk status.
        </div>
      </div>
    </>
  );
}
