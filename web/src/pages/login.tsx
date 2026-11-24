import React, { useState } from 'react';
import { api } from '../lib/api';
import { Icon, useToast } from '../lib/ui';

export default function LoginPage({ needsSetup, onAuthenticated }: { needsSetup: boolean; onAuthenticated: () => void }) {
  const [mode, setMode] = useState<'login' | 'setup'>(needsSetup ? 'setup' : 'login');
  const [username, setUsername] = useState(needsSetup ? 'admin' : '');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const { push } = useToast();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (mode === 'setup') {
      if (password.length < 8) return setError('Choose a password of at least 8 characters.');
      if (password !== confirm) return setError('Passwords do not match.');
    }
    setBusy(true);
    try {
      if (mode === 'setup') {
        await api.setup({ username, password, name, email });
        push('Administrator created. Welcome aboard.');
      } else {
        await api.login(username, password);
        push('Signed in.');
      }
      onAuthenticated();
    } catch (err: any) {
      setError(err.message || 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <section className="auth-art">
        <div>
          <span className="auth-badge">
            <Icon name="Zap" size={13} />
            All-in-one PBX administration
          </span>
          <h1 style={{ marginTop: 22 }}>Every PBX module. One console. No PHP.</h1>
          <p className="lede">
            Extensions, trunks, routes, queues, IVRs, time conditions and reporting — consolidated into a single
            application that generates real Asterisk configuration.
          </p>
          <div className="auth-features">
            {[
              ['Boxes', '84 legacy modules consolidated into one app'],
              ['FileCode2', 'Deterministic Asterisk config generation'],
              ['Activity', 'Live call telemetry over server-sent events'],
              ['Workflow', 'Dialplan tracer explains any dialled number']
            ].map(([icon, text]) => (
              <div className="f" key={text}>
                <Icon name={icon} size={16} />
                {text}
              </div>
            ))}
          </div>
        </div>
        <div className="tiny" style={{ color: '#7fa5a1' }}>
          Ships as a single Docker container · SQLite storage · No external services
        </div>
      </section>

      <section className="auth-form-side">
        <div className="auth-card">
          <div className="row" style={{ marginBottom: 18 }}>
            <div className="brand-mark"><Icon name="PhoneCall" size={17} /></div>
            <strong style={{ fontSize: 14 }}>Asterisk Console</strong>
          </div>
          <h2>{mode === 'setup' ? 'Create your administrator' : 'Sign in'}</h2>
          <p className="sub">
            {mode === 'setup'
              ? 'This is the first run. The account you create here becomes the system administrator.'
              : 'Use your administrator or operator credentials.'}
          </p>

          <form onSubmit={submit}>
            {error && (
              <div className="alert error">
                <Icon name="CircleX" size={15} />
                <div>{error}</div>
              </div>
            )}

            <div className="field">
              <label htmlFor="username">Username</label>
              <input
                id="username"
                className="input"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                autoFocus
                required
              />
            </div>

            {mode === 'setup' && (
              <>
                <div className="field">
                  <label htmlFor="name">Full name</label>
                  <input id="name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Administrator" />
                </div>
                <div className="field">
                  <label htmlFor="email">Email <span className="faint">(optional)</span></label>
                  <input id="email" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
              </>
            )}

            <div className="field">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                className="input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === 'setup' ? 'new-password' : 'current-password'}
                required
              />
            </div>

            {mode === 'setup' && (
              <div className="field">
                <label htmlFor="confirm">Confirm password</label>
                <input id="confirm" type="password" className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
              </div>
            )}

            <button className="btn primary block" type="submit" disabled={busy} style={{ height: 38 }}>
              {busy ? <span className="spinner" style={{ width: 15, height: 15, borderWidth: 2 }} /> : <Icon name="ArrowRight" size={16} />}
              {mode === 'setup' ? 'Create account and sign in' : 'Sign in'}
            </button>
          </form>

          <p className="tiny faint" style={{ marginTop: 18, lineHeight: 1.6 }}>
            Sessions are signed HTTP-only cookies. Mutations require a CSRF token. Passwords are hashed with scrypt.
          </p>
        </div>
      </section>
    </div>
  );
}
