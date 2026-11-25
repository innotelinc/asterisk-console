import React, { useEffect, useState } from 'react';
import { api, type EngineCommand, type EngineState, type SetupState } from '../lib/api';
import { Icon, Spinner, useToast } from '../lib/ui';

/**
 * First-run setup wizard.
 *
 * It writes the same settings the Advanced Settings page edits and then records
 * that setup is done, so it appears once after the administrator is created and
 * can be re-run from Settings. Nothing is seeded: every step is optional except
 * naming the PBX, and a skipped step leaves the console empty rather than
 * inventing sample data.
 */

type Values = SetupState['settings'];

const STEPS = [
  {
    id: 'identity',
    title: 'Name this PBX',
    blurb: 'How the console identifies itself, and the timezone its time conditions are written in.'
  },
  {
    id: 'asterisk',
    title: 'Connect Asterisk',
    blurb: 'Optional. With AMI credentials the console shows live channels and stores the call records Asterisk emits.'
  },
  {
    id: 'extension',
    title: 'Create the first extension',
    blurb: 'Optional. One working extension is enough to test a dialplan end to end.'
  },
  {
    id: 'review',
    title: 'Review and finish',
    blurb: 'Settings are stored in the database. Generated configuration is only written when you apply it.'
  }
] as const;

const TIMEZONES = [
  'UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'America/Sao_Paulo', 'Europe/London', 'Europe/Berlin', 'Europe/Madrid', 'Africa/Johannesburg',
  'Asia/Dubai', 'Asia/Kolkata', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney'
];

const LANGUAGES: [string, string][] = [['en', 'English'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German']];

function randomSecret() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {hint && <div className="tiny faint" style={{ marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

/**
 * Install Asterisk from the wizard, or print the install for a host the console
 * cannot reach. Progress is polled: the first image pull outlives a request.
 */
function EngineInstaller({ onInstalled }: { onInstalled: (values: { host: string; port: string; user: string }) => void }) {
  const [engine, setEngine] = useState<EngineState | null>(null);
  const [version, setVersion] = useState('22');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fallback, setFallback] = useState<EngineCommand | null>(null);
  const [copied, setCopied] = useState('');

  const load = async () => {
    try {
      const next = await api.engineState();
      setEngine(next);
      if (next.install.phase === 'done' && next.settings.ami_host) {
        onInstalled({ host: next.settings.ami_host, port: next.settings.ami_port || '5038', user: next.settings.ami_user });
      }
    } catch (err: any) {
      setError(err.message || 'Could not read the Asterisk install state');
    }
  };

  useEffect(() => { load(); }, []);

  const running = Boolean(engine && ['pulling', 'configuring', 'starting', 'waiting'].includes(engine.install.phase));
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(load, 2000);
    return () => clearInterval(timer);
  }, [running]);

  const install = async () => {
    setError('');
    setFallback(null);
    setBusy(true);
    try {
      if (engine && !engine.docker.available) {
        setFallback(await api.engineCommand(version));
        return;
      }
      await api.installEngine(version);
      await load();
    } catch (err: any) {
      setError(err.message || 'The install could not start');
    } finally {
      setBusy(false);
    }
  };

  const copy = async (text: string, which: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      setTimeout(() => setCopied(''), 1500);
    } catch {
      setError('The clipboard is not available here — select the text and copy it.');
    }
  };

  const chosen = engine?.versions.find((v) => v.id === version);

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="alert info">
        <Icon name="Download" size={15} />
        <div>
          The console can install Asterisk itself: it pulls the image for the version you pick, writes the AMI
          account and a base configuration, and starts one container. Nothing else on the host is touched.
        </div>
      </div>

      {error && (
        <div className="alert error">
          <Icon name="CircleX" size={15} />
          <div>{error}</div>
        </div>
      )}

      <div className="form-grid">
        <Field
          label="Asterisk version"
          hint={chosen ? `Security support until ${chosen.support}. Image ${chosen.image}.` : undefined}
        >
          <select className="input" value={version} onChange={(e) => setVersion(e.target.value)} disabled={running}>
            {(engine?.versions || []).map((v) => (
              <option key={v.id} value={v.id}>{v.label}{v.recommended ? ' — recommended' : ''}</option>
            ))}
          </select>
        </Field>
        <Field label="Install" hint="Reinstalling keeps the configuration files and the AMI secret.">
          <button className="btn primary" type="button" onClick={install} disabled={busy || running || !engine}>
            {busy || running
              ? <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
              : <Icon name="Download" size={15} />}
            {engine?.installed ? 'Reinstall this version' : 'Install Asterisk'}
          </button>
        </Field>
      </div>

      {engine && engine.docker.available && engine.docker.error && (
        <div className="alert error">
          <Icon name="CircleX" size={15} />
          <div>Docker did not answer on {engine.docker.socket}: {engine.docker.error}</div>
        </div>
      )}

      {engine && !engine.docker.available && (
        <div className="alert info">
          <Icon name="Info" size={15} />
          <div>
            This console has no Docker socket at <span className="mono">{engine.docker.socket}</span>, so it cannot
            start the container itself. Pick a version and press Install to get the exact command for the host.
          </div>
        </div>
      )}

      {running && (
        <div className="alert info">
          <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
          <div>{engine?.install.message || 'Installing…'}</div>
        </div>
      )}

      {!running && engine?.install.phase === 'error' && (
        <div className="alert error">
          <Icon name="CircleX" size={15} />
          <div>{engine.install.error}</div>
        </div>
      )}

      {engine?.installed && (
        <div className="alert info">
          <Icon name="CircleCheck" size={15} />
          <div>
            {engine.installed.image} is {engine.installed.running ? 'running' : 'stopped'} ({engine.installed.status}).
            AMI is reachable at <span className="mono">{engine.settings.ami_host}:{engine.settings.ami_port}</span>.
          </div>
        </div>
      )}

      {fallback && (
        <div style={{ display: 'grid', gap: 8 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <strong style={{ fontSize: 12.5 }}>Run this on the Docker host</strong>
            <button className="btn" type="button" onClick={() => copy(fallback.command, 'command')}>
              <Icon name={copied === 'command' ? 'Check' : 'Copy'} size={14} />
              {copied === 'command' ? 'Copied' : 'Copy command'}
            </button>
          </div>
          <pre className="mono" style={{ margin: 0, padding: 12, background: 'var(--bg-inset, #0f172a)', color: 'var(--text)', borderRadius: 8, overflowX: 'auto', fontSize: 11.5, lineHeight: 1.6 }}>
            {fallback.command}
          </pre>
          <details>
            <summary className="tiny muted" style={{ cursor: 'pointer' }}>Or the same install as a compose file</summary>
            <div className="row" style={{ justifyContent: 'flex-end', marginTop: 6 }}>
              <button className="btn" type="button" onClick={() => copy(fallback.compose, 'compose')}>
                <Icon name={copied === 'compose' ? 'Check' : 'Copy'} size={14} />
                {copied === 'compose' ? 'Copied' : 'Copy compose'}
              </button>
            </div>
            <pre className="mono" style={{ margin: 0, padding: 12, background: 'var(--bg-inset, #0f172a)', color: 'var(--text)', borderRadius: 8, overflowX: 'auto', fontSize: 11.5, lineHeight: 1.6 }}>
              {fallback.compose}
            </pre>
          </details>
          <div className="tiny faint">
            The AMI account and base configuration are already written to this console's pbx directory, so point
            PBX_DIR at that directory on the host and the started Asterisk is usable as-is. Once it is up, fill in
            the host below and press Test connection.
          </div>
        </div>
      )}
    </div>
  );
}

export default function SetupPage({ onDone, onSkip }: { onDone: () => void; onSkip: () => void }) {
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(true);
  const [state, setState] = useState<SetupState | null>(null);
  const [values, setValues] = useState<Values>({
    pbx_name: 'Asterisk Console',
    pbx_timezone: 'UTC',
    pbx_language: 'en',
    ami_host: '',
    ami_port: '5038',
    ami_user: '',
    ami_secret: '',
    ast_config_dir: '/etc/asterisk'
  });
  const [ext, setExt] = useState({ extension: '', name: '', secret: randomSecret() });
  const [createdExt, setCreatedExt] = useState<string | null>(null);
  const [amiTest, setAmiTest] = useState<{ state: 'idle' | 'busy' | 'ok' | 'fail'; message?: string }>({ state: 'idle' });
  const [amiMode, setAmiMode] = useState<'external' | 'install'>('external');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const { push } = useToast();

  useEffect(() => {
    (async () => {
      try {
        const s = await api.setupState();
        setState(s);
        setValues((current) => ({
          ...current,
          ...s.settings,
          pbx_name: s.settings.pbx_name || 'Asterisk Console',
          pbx_timezone: s.settings.pbx_timezone || 'UTC',
          ami_port: s.settings.ami_port || '5038',
          ast_config_dir: s.settings.ast_config_dir || '/etc/asterisk'
        }));
      } catch (err: any) {
        setError(err.message || 'Could not read the current configuration');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const set = (patch: Partial<Values>) => setValues((v) => ({ ...v, ...patch }));

  const runAmiTest = async () => {
    setError('');
    setAmiTest({ state: 'busy' });
    try {
      const res = await api.testAmi({
        host: values.ami_host,
        port: values.ami_port,
        user: values.ami_user,
        secret: values.ami_secret
      });
      setAmiTest(res.ok
        ? { state: 'ok', message: 'Signed in to AMI. Live channels and call records will follow.' }
        : { state: 'fail', message: res.error || 'Asterisk refused the login.' });
    } catch (err: any) {
      setAmiTest({ state: 'fail', message: err.message || 'The test could not run.' });
    }
  };

  const createExtension = async () => {
    setError('');
    if (!/^\d{2,6}$/.test(ext.extension.trim())) return setError('An extension number is 2 to 6 digits.');
    if (!ext.name.trim()) return setError('Give the extension a display name.');
    setBusy(true);
    try {
      await api.create('extensions', {
        extension: Number(ext.extension.trim()),
        name: ext.name.trim(),
        secret: ext.secret || randomSecret(),
        tech: 'pjsip',
        voicemail: 0,
        context: 'from-internal',
        codecs: 'ulaw,alaw',
        max_contacts: 3,
        recording: 'never',
        ring_time: 20,
        enabled: 1
      });
      setCreatedExt(`${ext.extension.trim()} · ${ext.name.trim()}`);
      push('Extension created');
      setStep((s) => s + 1);
    } catch (err: any) {
      setError(err.message || 'The extension could not be created');
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    setError('');
    setBusy(true);
    try {
      await api.completeSetup(values);
      push('Setup complete');
      onDone();
    } catch (err: any) {
      setError(err.message || 'Setup could not be saved');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="brand-mark" style={{ width: 40, height: 40 }}><Icon name="PhoneCall" size={20} /></div>
        <Spinner label="Reading configuration…" />
      </div>
    );
  }

  const current = STEPS[step];
  const amiReady = Boolean(values.ami_host.trim() && values.ami_user.trim());

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '32px 20px' }}>
      <div style={{ width: '100%', maxWidth: 780 }}>
        <div className="row" style={{ marginBottom: 18 }}>
          <div className="brand-mark"><Icon name="PhoneCall" size={17} /></div>
          <div className="grow">
            <strong style={{ fontSize: 14 }}>Asterisk Console</strong>
            <div className="tiny muted">{state?.completed ? 'Re-running setup' : 'First-run setup'}</div>
          </div>
          <button className="btn" type="button" onClick={onSkip}>Skip for now</button>
        </div>

        <div className="row" style={{ gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
          {STEPS.map((s, i) => (
            <button
              key={s.id}
              type="button"
              className={`nav-item ${i === step ? 'active' : ''}`}
              style={{ flex: '1 1 150px', color: i === step ? 'var(--text)' : 'var(--text-dim)', cursor: i <= step ? 'pointer' : 'default' }}
              onClick={() => { if (i <= step) { setError(''); setStep(i); } }}
              aria-current={i === step ? 'step' : undefined}
            >
              <span
                style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  width: 18, height: 18, borderRadius: 9, marginRight: 8, fontSize: 11,
                  background: i <= step ? 'var(--accent)' : 'var(--border)',
                  color: i <= step ? '#fff' : 'var(--text-dim)'
                }}
              >
                {i < step ? <Icon name="Check" size={11} /> : i + 1}
              </span>
              <span className="truncate">{s.title}</span>
            </button>
          ))}
        </div>

        <div className="card">
          <div className="card-head">
            <div className="grow">
              <h3>{current.title}</h3>
              <p>{current.blurb}</p>
            </div>
          </div>
          <div className="card-body">
            {error && (
              <div className="alert error" style={{ marginBottom: 14 }}>
                <Icon name="CircleX" size={15} />
                <div>{error}</div>
              </div>
            )}

            {step === 0 && (
              <div className="form-grid">
                <Field label="System name" hint="Shown in the sidebar and in generated file headers.">
                  <input
                    className="input"
                    value={values.pbx_name}
                    onChange={(e) => set({ pbx_name: e.target.value })}
                    placeholder="Asterisk Console"
                    autoFocus
                  />
                </Field>
                <Field label="Timezone" hint="Used by time conditions and by generated dialplan.">
                  <input
                    className="input"
                    list="setup-timezones"
                    value={values.pbx_timezone}
                    onChange={(e) => set({ pbx_timezone: e.target.value })}
                    placeholder="UTC"
                  />
                  <datalist id="setup-timezones">
                    {TIMEZONES.map((tz) => <option key={tz} value={tz} />)}
                  </datalist>
                </Field>
                <Field label="Default language">
                  <select className="input" value={values.pbx_language} onChange={(e) => set({ pbx_language: e.target.value })}>
                    {LANGUAGES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </Field>
                <Field label="Config output directory" hint="Where “apply to disk” writes generated Asterisk files.">
                  <input
                    className="input"
                    value={values.ast_config_dir}
                    onChange={(e) => set({ ast_config_dir: e.target.value })}
                    placeholder="/etc/asterisk"
                  />
                </Field>
              </div>
            )}

            {step === 1 && (
              <div style={{ display: 'grid', gap: 14 }}>
                <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <button
                    className={`btn ${amiMode === 'external' ? 'primary' : ''}`}
                    type="button"
                    onClick={() => setAmiMode('external')}
                  >
                    <Icon name="Server" size={15} /> Connect to an existing PBX
                  </button>
                  <button
                    className={`btn ${amiMode === 'install' ? 'primary' : ''}`}
                    type="button"
                    onClick={() => setAmiMode('install')}
                  >
                    <Icon name="Download" size={15} /> Install Asterisk
                  </button>
                </div>
                {amiMode === 'install' && (
                  <EngineInstaller
                    onInstalled={(values) => {
                      set({ ami_host: values.host, ami_port: values.port, ami_user: values.user });
                      setAmiTest({ state: 'idle' });
                    }}
                  />
                )}
                <div className="form-grid">
                <Field label="AMI host" hint="Hostname or IP of the PBX. Leave empty to stay offline.">
                  <input
                    className="input"
                    value={values.ami_host}
                    onChange={(e) => { set({ ami_host: e.target.value }); setAmiTest({ state: 'idle' }); }}
                    placeholder="freepbx"
                    autoFocus
                  />
                </Field>
                <Field label="AMI port">
                  <input
                    className="input"
                    value={values.ami_port}
                    onChange={(e) => { set({ ami_port: e.target.value }); setAmiTest({ state: 'idle' }); }}
                    placeholder="5038"
                    inputMode="numeric"
                  />
                </Field>
                <Field label="AMI user" hint="Needs read classes system,call,log,verbose,agent,user,config,reporting,cdr,dialplan and the command write class.">
                  <input
                    className="input"
                    value={values.ami_user}
                    onChange={(e) => { set({ ami_user: e.target.value }); setAmiTest({ state: 'idle' }); }}
                    autoComplete="off"
                  />
                </Field>
                <Field label="AMI secret">
                  <input
                    className="input"
                    type="password"
                    value={values.ami_secret}
                    onChange={(e) => { set({ ami_secret: e.target.value }); setAmiTest({ state: 'idle' }); }}
                    autoComplete="new-password"
                  />
                </Field>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <button className="btn" type="button" onClick={runAmiTest} disabled={!amiReady || amiTest.state === 'busy'}>
                    {amiTest.state === 'busy'
                      ? <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
                      : <Icon name="Wifi" size={15} />}
                    Test connection
                  </button>
                  {amiTest.state === 'ok' && (
                    <span className="row tiny" style={{ gap: 6, color: 'var(--ok, #16a34a)' }}>
                      <Icon name="CircleCheck" size={14} />{amiTest.message}
                    </span>
                  )}
                  {amiTest.state === 'fail' && (
                    <span className="row tiny" style={{ gap: 6, color: 'var(--bad, #dc2626)' }}>
                      <Icon name="CircleX" size={14} />{amiTest.message}
                    </span>
                  )}
                </div>
                <div className="alert info" style={{ gridColumn: '1 / -1' }}>
                  <Icon name="Info" size={15} />
                  <div>
                    The test signs in and asks for the core status without saving anything. You can finish setup
                    without AMI and add it later in Settings → Asterisk.
                  </div>
                </div>
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="form-grid">
                {createdExt ? (
                  <div className="alert info" style={{ gridColumn: '1 / -1' }}>
                    <Icon name="CircleCheck" size={15} />
                    <div>Created extension {createdExt}. It is included the next time you generate configuration.</div>
                  </div>
                ) : (
                  <>
                    <Field label="Extension number" hint="2 to 6 digits.">
                      <input
                        className="input"
                        value={ext.extension}
                        onChange={(e) => setExt((v) => ({ ...v, extension: e.target.value }))}
                        placeholder="1000"
                        inputMode="numeric"
                        autoFocus
                      />
                    </Field>
                    <Field label="Display name">
                      <input
                        className="input"
                        value={ext.name}
                        onChange={(e) => setExt((v) => ({ ...v, name: e.target.value }))}
                        placeholder="Main Reception"
                      />
                    </Field>
                    <Field label="SIP secret" hint="Generated for you; replace it with your own if you prefer.">
                      <div style={{ display: 'flex', gap: 8 }}>
                        <input
                          className="input"
                          value={ext.secret}
                          onChange={(e) => setExt((v) => ({ ...v, secret: e.target.value }))}
                          style={{ fontFamily: 'var(--mono, monospace)' }}
                        />
                        <button className="btn" type="button" onClick={() => setExt((v) => ({ ...v, secret: randomSecret() }))} title="Generate a new secret">
                          <Icon name="RefreshCw" size={15} />
                        </button>
                      </div>
                    </Field>
                  </>
                )}
              </div>
            )}

            {step === 3 && (
              <div style={{ display: 'grid', gap: 10 }}>
                {[
                  ['System name', values.pbx_name || '—'],
                  ['Timezone', values.pbx_timezone || 'UTC'],
                  ['Language', LANGUAGES.find(([value]) => value === values.pbx_language)?.[1] || values.pbx_language],
                  ['Config directory', values.ast_config_dir || '/etc/asterisk'],
                  ['AMI', amiReady ? `${values.ami_host}:${values.ami_port || 5038} as ${values.ami_user}` : 'Not configured (offline mode)'],
                  ['First extension', createdExt || 'Not created']
                ].map(([label, value]) => (
                  <div key={label} className="row" style={{ justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
                    <span className="tiny muted">{label}</span>
                    <span className="mono" style={{ fontSize: 12.5 }}>{value}</span>
                  </div>
                ))}
                <div className="alert info" style={{ marginTop: 6 }}>
                  <Icon name="Lightbulb" size={15} />
                  <div>
                    After finishing, add trunks, routes and more extensions from the sidebar. Generated configuration
                    is previewed under Config &amp; Dialplan before anything is written to disk.
                  </div>
                </div>
              </div>
            )}
          </div>

          <div
            className="row"
            style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', gap: 8 }}
          >
            <button className="btn" type="button" onClick={() => { setError(''); setStep((s) => Math.max(0, s - 1)); }} disabled={step === 0}>
              Back
            </button>
            <div className="grow" />
            {step === 1 && (
              <button className="btn" type="button" onClick={() => { setError(''); setStep(2); }}>Skip</button>
            )}
            {step === 2 && !createdExt && (
              <button className="btn" type="button" onClick={() => { setError(''); setStep(3); }}>Skip</button>
            )}
            {step === 0 && (
              <button className="btn primary" type="button" onClick={() => { setError(''); setStep(1); }} disabled={!values.pbx_name.trim()}>
                Continue<Icon name="ArrowRight" size={15} />
              </button>
            )}
            {step === 1 && (
              <button className="btn primary" type="button" onClick={() => { setError(''); setStep(2); }}>
                Continue<Icon name="ArrowRight" size={15} />
              </button>
            )}
            {step === 2 && !createdExt && (
              <button className="btn primary" type="button" onClick={createExtension} disabled={busy}>
                {busy ? <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> : <Icon name="Plus" size={15} />}
                Create extension
              </button>
            )}
            {step === 2 && createdExt && (
              <button className="btn primary" type="button" onClick={() => { setError(''); setStep(3); }}>
                Continue<Icon name="ArrowRight" size={15} />
              </button>
            )}
            {step === 3 && (
              <button className="btn primary" type="button" onClick={finish} disabled={busy}>
                {busy ? <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> : <Icon name="Check" size={15} />}
                Finish setup
              </button>
            )}
          </div>
        </div>

        <p className="tiny faint" style={{ marginTop: 14, lineHeight: 1.6 }}>
          {state?.counts && Object.values(state.counts).some((n) => n > 0)
            ? `This console already holds ${state.counts.extensions} extension(s), ${state.counts.trunks} trunk(s) and ${state.counts.queues} queue(s); the wizard only changes the settings above.`
            : 'A fresh install starts empty: no sample extensions, trunks or call records.'}
        </p>
      </div>
    </div>
  );
}
