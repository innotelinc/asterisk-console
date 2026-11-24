import React, { useEffect, useMemo, useState } from 'react';
import { api, saveBlob, type Meta, type Session } from '../lib/api';
import {
  Badge, Confirm, CopyButton, EmptyState, Icon, Spinner, fmtDate, useToast
} from '../lib/ui';

/** Colourise an Asterisk config file without pulling in a syntax-highlight lib. */
function highlight(content: string) {
  return content.split('\n').map((line, i) => {
    let cls = '';
    if (line.trimStart().startsWith(';')) cls = 'cmt';
    else if (/^\[.*\]$/.test(line.trim())) cls = 'sec';
    else if (/^[A-Za-z_]+=/.test(line.trim())) cls = 'key';
    return (
      <div key={i} className={cls}>
        {line || '\u00a0'}
      </div>
    );
  });
}

export default function ToolsPage({ meta, session }: { meta: Meta; session: Session }) {
  const [tab, setTab] = useState<'config' | 'dialplan'>('config');
  const [config, setConfig] = useState<any>(null);
  const [selected, setSelected] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [confirmApply, setConfirmApply] = useState(false);
  const { push } = useToast();

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.config();
      setConfig(res);
      if (!selected && res.files.length) setSelected(res.files[0].name);
    } catch (err: any) {
      push(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const file = useMemo(() => config?.files.find((f: any) => f.name === selected), [config, selected]);

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <h1>Config &amp; dialplan</h1>
          <p>
            Generated deterministically from the database. Output directory:{' '}
            <span className="mono">{meta.app.asteriskConfigDir}</span>
          </p>
        </div>
        <div className="page-actions">
          <button className="btn" onClick={load}><Icon name="RefreshCw" size={15} />Regenerate</button>
          {session.role === 'admin' && (
            <button className="btn primary" onClick={() => setConfirmApply(true)}>
              <Icon name="Save" size={15} />Apply to disk
            </button>
          )}
        </div>
      </div>

      <div className="tabs" style={{ marginBottom: 14 }}>
        <button className={`tab ${tab === 'config' ? 'active' : ''}`} onClick={() => setTab('config')}>
          Generated configuration
        </button>
        <button className={`tab ${tab === 'dialplan' ? 'active' : ''}`} onClick={() => setTab('dialplan')}>
          Dialplan tester
        </button>
      </div>

      {tab === 'config' && (
        loading ? <div style={{ padding: 30 }}><Spinner label="Compiling configuration…" /></div> :
        !config ? <EmptyState icon="FileCode2" title="Configuration unavailable" /> : (
          <>
            <div className="kpi-grid">
              <MiniKpi label="Files" value={config.summary.files} />
              <MiniKpi label="Lines" value={config.summary.lines} />
              <MiniKpi label="Extensions" value={config.summary.extensions} />
              <MiniKpi label="Routes" value={config.summary.inboundRoutes + config.summary.outboundRoutes} />
              <MiniKpi label="Queues" value={config.summary.queues} />
              <MiniKpi label="IVRs" value={config.summary.ivrs} />
            </div>

            {config.warnings.length > 0 && (
              <div className="alert warn" style={{ marginBottom: 14 }}>
                <Icon name="AlertTriangle" size={15} />
                <div>
                  {config.warnings.map((w: string, i: number) => <div key={i}>{w}</div>)}
                </div>
              </div>
            )}

            <div className="grid" style={{ gridTemplateColumns: 'minmax(200px, 240px) minmax(0, 1fr)', gap: 14 }}>
              <div className="card" style={{ alignSelf: 'start' }}>
                <div className="card-head"><div className="grow"><h3>Files</h3></div></div>
                <div style={{ padding: 6 }}>
                  {config.files.map((f: any) => (
                    <button
                      key={f.name}
                      className={`nav-item ${selected === f.name ? 'active' : ''}`}
                      style={{ color: selected === f.name ? 'var(--text)' : 'var(--text-dim)' }}
                      onClick={() => setSelected(f.name)}
                    >
                      <Icon name="FileCode2" size={14} />
                      <span className="mono truncate" style={{ fontSize: 12 }}>{f.name}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="card" style={{ overflow: 'hidden' }}>
                <div className="card-head">
                  <div className="grow">
                    <h3 className="mono" style={{ fontSize: 13 }}>{file?.name}</h3>
                    <p>{file?.module} · {file?.content.split('\n').length} lines</p>
                  </div>
                  {file && (
                    <>
                      <CopyButton text={file.content} label="Copy" />
                      <button
                        className="btn sm"
                        onClick={() => saveBlob(new Blob([file.content], { type: 'text/plain' }), file.name)}
                      >
                        <Icon name="Download" size={13} />Download
                      </button>
                    </>
                  )}
                </div>
                <pre className="code">{file ? highlight(file.content) : ''}</pre>
              </div>
            </div>

            <p className="tiny faint" style={{ marginTop: 12 }}>
              Generated {fmtDate(config.generatedAt)}. Nothing is written to Asterisk until you apply.
            </p>
          </>
        )
      )}

      {tab === 'dialplan' && <DialplanTester />}

      {confirmApply && (
        <Confirm
          title="Write configuration to disk"
          message={
            <>
              All generated files will be written to <span className="mono">{meta.app.asteriskConfigDir}</span>,
              overwriting files of the same name. Reload Asterisk afterwards for changes to take effect.
            </>
          }
          confirmLabel="Write files"
          onClose={() => setConfirmApply(false)}
          onConfirm={async () => {
            setApplying(true);
            try {
              const res = await api.config(true);
              if (res.writeError) push(res.writeError, 'error');
              else {
                push(`Wrote ${res.files.length} file(s) to ${res.writtenTo}`);
                setConfig(res);
              }
              setConfirmApply(false);
            } catch (err: any) {
              push(err.message, 'error');
            } finally {
              setApplying(false);
            }
          }}
        />
      )}
    </>
  );
}

function MiniKpi({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="kpi" style={{ padding: '10px 13px' }}>
      <span className="kpi-label">{label}</span>
      <span className="kpi-value" style={{ fontSize: 19 }}>{value}</span>
    </div>
  );
}

function DialplanTester() {
  const [number, setNumber] = useState('6000');
  const [callerId, setCallerId] = useState('1001');
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const { push } = useToast();

  const run = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    try {
      setResult(await api.dialplanTest(number, callerId));
    } catch (err: any) {
      push(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid two">
      <div className="card">
        <div className="card-head">
          <div className="grow">
            <h3>Trace a dialled number</h3>
            <p>Shows how the generated dialplan resolves a call before it is placed.</p>
          </div>
        </div>
        <div className="card-body">
          <form onSubmit={run} className="col">
            <div className="form-grid">
              <div className="field">
                <label htmlFor="dp-number">Number</label>
                <input id="dp-number" className="input mono" value={number} onChange={(e) => setNumber(e.target.value)} placeholder="6000 or 15551234567" />
                <span className="hint">Extension, queue, IVR, feature code or external number</span>
              </div>
              <div className="field">
                <label htmlFor="dp-caller">Caller ID</label>
                <input id="dp-caller" className="input mono" value={callerId} onChange={(e) => setCallerId(e.target.value)} placeholder="1001" />
              </div>
            </div>
            <div className="row">
              <button className="btn primary" type="submit" disabled={busy}>
                {busy ? <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> : <Icon name="Play" size={15} />}
                Trace call
              </button>
              {result && (
                <Badge tone={result.matched ? 'ok' : 'bad'}>
                  {result.matched ? 'Routable' : 'Would fail'}
                </Badge>
              )}
            </div>
          </form>

          <div className="alert info" style={{ marginTop: 16 }}>
            <Icon name="Lightbulb" size={15} />
            <div>Try <span className="mono">6000</span> (queue), <span className="mono">7000</span> (IVR), <span className="mono">*8</span> (feature) or <span className="mono">15551239999</span> (outbound).</div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div className="grow"><h3>Resolution</h3><p>{result ? (result.destination || 'No matching destination') : 'Awaiting a trace'}</p></div>
        </div>
        <div className="card-body">
          {!result ? (
            <EmptyState icon="Workflow" title="Nothing traced yet" message="Enter a number and run a trace to see each decision." />
          ) : (
            <div className="col" style={{ gap: 0 }}>
              {result.steps.map((s: any, i: number) => (
                <div key={i} className="row" style={{ alignItems: 'flex-start', gap: 10, padding: '9px 0', borderBottom: i < result.steps.length - 1 ? '1px solid var(--border)' : 'none' }}>
                  <span className={`dot ${s.status === 'match' ? 'ok' : s.status === 'error' ? 'bad' : s.status === 'ok' ? 'ok' : 'warn'}`} style={{ marginTop: 6 }} />
                  <div style={{ minWidth: 0 }}>
                    <div className="tiny faint" style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}>{s.step}</div>
                    <div style={{ fontSize: 12.8 }}>{s.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
