import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError, type Meta, type Session } from './lib/api';
import { Icon, ToastProvider, useToast } from './lib/ui';
import { LiveCtx, type Tick } from './lib/live';
import LoginPage from './pages/login';
import SetupPage from './pages/setup';
import DashboardPage from './pages/dashboard';
import EntityPage from './pages/entities';
import { CdrPage, CallsPage } from './pages/cdr';
import ToolsPage from './pages/tools';
import { SettingsPage, TokensPage, AuditPage, SystemPage, ModulesPage } from './pages/admin';

/* ------------------------------------------------------------------ routes */
type Route = { page: string; entity?: string };

function parseHash(): Route {
  const raw = (window.location.hash || '#/dashboard').replace(/^#\/?/, '');
  const [page, ...rest] = raw.split('/');
  if (page === 'e' && rest[0]) return { page: 'entity', entity: rest[0] };
  return { page: page || 'dashboard' };
}

const PAGE_META: Record<string, string> = {
  dashboard: 'Dashboard',
  calls: 'Call Activity',
  cdr: 'Call Detail Records',
  tools: 'Config & Dialplan',
  settings: 'Advanced Settings',
  audit: 'Audit Log',
  system: 'System Status',
  tokens: 'API Tokens',
  modules: 'Module Registry',
  setup: 'Setup Wizard'
};

const THEME_KEY = 'ac-theme';

function useTheme() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);
  return { theme, toggle: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')) };
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [booting, setBooting] = useState(true);
  const [route, setRoute] = useState<Route>(parseHash);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [tick, setTick] = useState<Tick | null>(null);
  const [liveConnected, setLiveConnected] = useState(false);
  const [wizardDismissed, setWizardDismissed] = useState(false);
  const { theme, toggle } = useTheme();

  useEffect(() => {
    const onHash = () => {
      setRoute(parseHash());
      setSidebarOpen(false);
      window.scrollTo({ top: 0 });
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const boot = useCallback(async () => {
    try {
      const me = await api.me();
      setSession(me.user);
      setNeedsSetup(me.needsSetup);
      if (me.user) setMeta(await api.meta());
    } catch {
      setSession(null);
    } finally {
      setBooting(false);
    }
  }, []);

  useEffect(() => { boot(); }, [boot]);

  // Live stream
  useEffect(() => {
    if (!session) return;
    let source: EventSource | null = null;
    let retry: any;
    const connect = () => {
      source = new EventSource('/api/events');
      source.addEventListener('hello', () => setLiveConnected(true));
      source.addEventListener('tick', (e) => {
        setLiveConnected(true);
        try { setTick(JSON.parse((e as MessageEvent).data)); } catch {}
      });
      source.onerror = () => {
        setLiveConnected(false);
        source?.close();
        retry = setTimeout(connect, 5000);
      };
    };
    connect();
    return () => {
      source?.close();
      clearTimeout(retry);
      setLiveConnected(false);
    };
  }, [session]);

  // Global shortcut for the command palette
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const navigate = useCallback((hash: string) => {
    window.location.hash = hash;
    setPaletteOpen(false);
  }, []);

  if (booting) {
    return (
      <div className="loading-screen">
        <div className="brand-mark" style={{ width: 40, height: 40 }}>
          <Icon name="PhoneCall" size={20} />
        </div>
        <span className="spinner" />
      </div>
    );
  }

  if (!session) {
    return (
      <ToastProvider>
        <LoginPage needsSetup={needsSetup} onAuthenticated={() => { setBooting(true); boot(); }} />
      </ToastProvider>
    );
  }

  // A fresh install lands in the wizard once the administrator exists; it can be
  // re-run from Settings, and "skip for now" only hides it for this session.
  if (meta && (route.page === 'setup' || (!meta.app.setupCompleted && !wizardDismissed))) {
    return (
      <ToastProvider>
        <SetupPage
          onDone={async () => {
            setWizardDismissed(false);
            setBooting(true);
            await boot();
            navigate('#/dashboard');
          }}
          onSkip={() => {
            setWizardDismissed(true);
            navigate('#/dashboard');
          }}
        />
      </ToastProvider>
    );
  }

  const activeEntity = route.page === 'entity' ? route.entity : undefined;
  const navLabel = activeEntity
    ? meta?.entities[activeEntity]?.plural || activeEntity
    : PAGE_META[route.page] || 'Asterisk Console';

  const page = (() => {
    if (route.page === 'entity' && activeEntity) return <EntityPage key={activeEntity} name={activeEntity} meta={meta!} session={session} />;
    switch (route.page) {
      case 'dashboard': return <DashboardPage meta={meta!} navigate={navigate} />;
      case 'calls': return <CallsPage navigate={navigate} />;
      case 'cdr': return <CdrPage session={session} />;
      case 'tools': return <ToolsPage meta={meta!} session={session} />;
      case 'settings': return <SettingsPage meta={meta!} session={session} navigate={navigate} />;
      case 'tokens': return <TokensPage meta={meta!} session={session} />;
      case 'audit': return <AuditPage />;
      case 'system': return <SystemPage meta={meta!} />;
      case 'modules': return <ModulesPage meta={meta!} navigate={navigate} />;
      default: return <DashboardPage meta={meta!} navigate={navigate} />;
    }
  })();

  return (
    <ToastProvider>
      <LiveCtx.Provider value={{ tick, connected: liveConnected }}>
        <div className="shell">
          {sidebarOpen && <div className="scrim" onClick={() => setSidebarOpen(false)} />}
          <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
            <div className="brand">
              <div className="brand-mark"><Icon name="PhoneCall" size={17} /></div>
              <div className="brand-text">
                <div className="brand-title">{meta?.app.name || 'Asterisk Console'}</div>
                <div className="brand-sub">v{meta?.app.version} · no PHP</div>
              </div>
            </div>
            <nav className="nav" aria-label="Modules">
              {meta?.nav.map((group) => (
                <NavGroup
                  key={group.id}
                  group={group}
                  activeKey={activeEntity || route.page}
                  onNavigate={navigate}
                />
              ))}
            </nav>
            <div className="sidebar-foot">
              <div className="live">
                <span className={`dot ${liveConnected ? 'ok pulse' : 'bad'}`} />
                {liveConnected ? 'Live telemetry connected' : 'Reconnecting…'}
              </div>
              <div className="live">
                <span className={`dot ${meta?.app.amiConfigured ? 'ok' : 'warn'}`} />
                {meta?.app.amiConfigured ? 'Asterisk AMI configured' : 'AMI not configured'}
              </div>
            </div>
          </aside>

          <div className="main">
            <header className="topbar">
              <button className="icon-btn mobile-only" onClick={() => setSidebarOpen((v) => !v)} aria-label="Toggle navigation">
                <Icon name="Menu" size={18} />
              </button>
              <div className="topbar-title">
                <strong>{navLabel}</strong>
                {activeEntity && <span>{meta?.entities[activeEntity]?.label} records</span>}
              </div>
              <div className="topbar-spacer" />
              <button className="search-trigger" onClick={() => setPaletteOpen(true)}>
                <Icon name="Search" size={15} />
                <span className="label">Search modules and settings…</span>
                <span className="kbd">Ctrl K</span>
              </button>
              <button className="icon-btn" onClick={toggle} aria-label="Toggle theme" title="Toggle theme">
                <Icon name={theme === 'dark' ? 'Sun' : 'Moon'} size={17} />
              </button>
              <UserMenu session={session} onLogout={async () => { await api.logout(); setSession(null); setMeta(null); }} />
            </header>

            <main className="content">{page}</main>
          </div>
        </div>

        {paletteOpen && (
          <CommandPalette meta={meta!} navigate={navigate} onClose={() => setPaletteOpen(false)} />
        )}
      </LiveCtx.Provider>
    </ToastProvider>
  );
}

/* --------------------------------------------------------------- nav group */
function NavGroup({
  group, activeKey, onNavigate
}: { group: Meta['nav'][number]; activeKey?: string; onNavigate: (hash: string) => void }) {
  const storageKey = `ac-nav-${group.id}`;
  const [open, setOpen] = useState(() => {
    const saved = localStorage.getItem(storageKey);
    return saved === null ? true : saved === '1';
  });
  const containsActive = group.items.some((i) => (i.entity || i.key) === activeKey);
  useEffect(() => {
    localStorage.setItem(storageKey, open ? '1' : '0');
  }, [open, storageKey]);
  useEffect(() => {
    if (containsActive) setOpen(true);
  }, [containsActive]);

  return (
    <div className="nav-group">
      <button className="nav-group-head" data-open={open} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {group.label}
        <Icon name="ChevronDown" size={13} className="chev" />
      </button>
      {open && (
        <div className="nav-items">
          {group.items.map((item) => {
            const key = item.entity ? item.entity : item.key!;
            const href = item.entity ? `#/e/${item.entity}` : `#/${item.key}`;
            const active = key === activeKey;
            return (
              <a
                key={key}
                className={`nav-item ${active ? 'active' : ''}`}
                href={href}
                onClick={(e) => { e.preventDefault(); onNavigate(href); }}
                aria-current={active ? 'page' : undefined}
              >
                <Icon name={item.icon} size={15} />
                <span className="truncate">{item.label}</span>
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------- user menu */
function UserMenu({ session, onLogout }: { session: Session; onLogout: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);
  const initials = (session.name || session.username).slice(0, 2).toUpperCase();
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="icon-btn" onClick={() => setOpen((v) => !v)} aria-label="Account menu" aria-expanded={open}>
        <span className="call-avatar" style={{ width: 26, height: 26, fontSize: 10.5 }}>{initials}</span>
      </button>
      {open && (
        <div
          className="card"
          style={{ position: 'absolute', right: 0, top: 42, width: 218, zIndex: 60, boxShadow: 'var(--shadow-md)' }}
        >
          <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)' }}>
            <div style={{ fontWeight: 600, fontSize: 13 }}>{session.name}</div>
            <div className="tiny muted">{session.username} · {session.role}</div>
          </div>
          <button
            className="nav-item"
            style={{ color: 'var(--text)', padding: '9px 14px', borderRadius: 0 }}
            onClick={async () => { setOpen(false); await onLogout(); }}
          >
            <Icon name="LogOut" size={15} />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

/* --------------------------------------------------------- command palette */
function CommandPalette({ meta, navigate, onClose }: { meta: Meta; navigate: (h: string) => void; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const items = useMemo(() => {
    const base: { label: string; group: string; hash: string; icon: string }[] = [];
    for (const group of meta.nav) {
      for (const item of group.items) {
        base.push({
          label: item.label,
          group: group.label,
          hash: item.entity ? `#/e/${item.entity}` : `#/${item.key}`,
          icon: item.icon
        });
      }
    }
    const q = query.trim().toLowerCase();
    if (!q) return base;
    return base.filter((i) => `${i.label} ${i.group}`.toLowerCase().includes(q));
  }, [meta, query]);

  useEffect(() => { setActive(0); }, [query]);

  const choose = (hash: string) => navigate(hash);

  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <input
          ref={inputRef}
          value={query}
          placeholder="Jump to a module…"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, items.length - 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
            if (e.key === 'Enter' && items[active]) choose(items[active].hash);
            if (e.key === 'Escape') onClose();
          }}
        />
        <div className="palette-list">
          {items.length === 0 && <div className="palette-empty">No matches for “{query}”</div>}
          {items.map((item, i) => (
            <button
              key={`${item.hash}-${item.label}`}
              className="palette-item"
              data-active={i === active}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(item.hash)}
            >
              <Icon name={item.icon} size={15} />
              {item.label}
              <span className="group">{item.group}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export { useToast, ApiError };
