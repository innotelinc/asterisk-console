import React, { useEffect, useState } from 'react';
import { api, type SetupState } from '../lib/api';
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
