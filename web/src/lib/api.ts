/** Typed-ish fetch wrapper: same-origin cookies + CSRF header on mutations. */

export type Session = { sub: number; username: string; name: string; role: 'admin' | 'operator' | 'readonly' };
/** State the first-run setup wizard starts from. */
export type SetupState = {
  completed: boolean;
  adminExists: boolean;
  counts: Record<string, number>;
  settings: {
    pbx_name: string; pbx_timezone: string; pbx_language: string;
    ami_host: string; ami_port: string; ami_user: string; ami_secret: string;
    ast_config_dir: string;
  };
};
/** An Asterisk line the console can install, with its upstream release and support date. */
export type EngineVersion = { id: string; label: string; image: string; release: string; support: string; recommended?: boolean };
/** Docker reachability, the engine container if one exists, and install progress. */
export type EngineState = {
  docker: { available: boolean; socket: string; error: string | null };
  versions: EngineVersion[];
  installed: { id: string; version: string; image: string; running: boolean; status: string; startedAt: string | null } | null;
  install: { phase: 'idle' | 'pulling' | 'configuring' | 'starting' | 'waiting' | 'done' | 'error'; message: string; error: string | null; startedAt: string | null; finishedAt: string | null };
  settings: { ami_host: string; ami_port: string; ami_user: string; ast_config_dir: string; engine_version: string };
};
/** The paste-on-the-host install for a version, when the console has no socket. */
export type EngineCommand = { version: string; command: string; compose: string };
/** Whether Asterisk was told to re-read its music-on-hold classes, and why not. */
export type MohReload = { reloaded: boolean; reason: string };
export type Field = {
  key: string; label: string; type: string; required?: boolean; unique?: boolean;
  options?: [string, string][]; help?: string; default?: any; list?: boolean;
  width?: number; relation?: string; secret?: boolean; wide?: boolean;
  /** A destination field that writes the sibling type field when a value is picked. */
  setsType?: string;
};
export type Entity = {
  label: string; plural: string; icon: string; fields: Field[]; searchable?: string[];
  order?: string; configFile?: string; system?: boolean; ai?: 'recording' | 'jingle';
};
export type Meta = {
  app: { name: string; version: string; asteriskConfigDir: string; amiConfigured: boolean; seeded: boolean; setupCompleted: boolean };
  nav: { id: string; label: string; items: { key?: string; entity?: string; label: string; icon: string }[] }[];
  entities: Record<string, Entity>;
  settingsGroups: { group: string; items: Field[] }[];
  modules: { id: string; label: string; group: string; entity: string | null }[];
  destinations: Record<string, { value: any; label: string }[]>;
};

function cookie(name: string): string {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : '';
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T = any>(path: string, options: { method?: string; body?: any; raw?: boolean } = {}): Promise<T> {
  const method = options.method || 'GET';
  const headers: Record<string, string> = {};
  if (method !== 'GET' && method !== 'HEAD') {
    headers['x-csrf'] = cookie('ac_csrf');
    if (options.raw) headers['Content-Type'] = 'text/csv';
    else headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(path, {
    method,
    headers,
    credentials: 'same-origin',
    body: options.body === undefined ? undefined : options.raw ? options.body : JSON.stringify(options.body)
  });
  const text = await res.text();
  let data: any = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  if (!res.ok) {
    throw new ApiError((data && data.error) || `Request failed (${res.status})`, res.status);
  }
  return data as T;
}

export const api = {
  me: () => request<{ user: Session | null; needsSetup: boolean }>('/api/auth/me'),
  login: (username: string, password: string) =>
    request<{ user: Session }>('/api/auth/login', { method: 'POST', body: { username, password } }),
  setup: (body: { username: string; password: string; name?: string; email?: string }) =>
    request<{ user: Session }>('/api/auth/setup', { method: 'POST', body }),
  logout: () => request('/api/auth/logout', { method: 'POST' }),

  setupState: () => request<SetupState>('/api/setup'),
  completeSetup: (body: Record<string, any>) =>
    request<{ ok: boolean }>('/api/setup/complete', { method: 'POST', body }),
  testAmi: (body: { host: string; port: number | string; user: string; secret: string }) =>
    request<{ ok: boolean; error?: string }>('/api/setup/ami-test', { method: 'POST', body }),
  engineState: () => request<EngineState>('/api/setup/engine'),
  installEngine: (version: string) =>
    request<{ started: boolean; alreadyRunning?: boolean; needsDocker?: boolean; error?: string; command?: string; compose?: string }>(
      '/api/setup/engine/install', { method: 'POST', body: { version } }
    ),
  engineCommand: (version: string) => request<EngineCommand>(`/api/setup/engine/command?version=${encodeURIComponent(version)}`),
  // The from-source build for a line, when the rolling registry tag is behind.
  engineBuild: (version: string) =>
    request<{ version: string; image: string; command: string }>(`/api/setup/engine/build?version=${encodeURIComponent(version)}`),

  meta: () => request<Meta>('/api/meta'),
  list: (entity: string, query: Record<string, any> = {}) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v !== '' && v !== undefined && v !== null) params.set(k, String(v));
    const qs = params.toString();
    return request<{ rows: any[]; total: number }>(`/api/entities/${entity}${qs ? `?${qs}` : ''}`);
  },
  create: (entity: string, body: any) => request<{ row: any; token?: string }>(`/api/entities/${entity}`, { method: 'POST', body }),
  update: (entity: string, id: number, body: any) => request<{ row: any }>(`/api/entities/${entity}/${id}`, { method: 'PUT', body }),
  remove: (entity: string, id: number) => request<{ ok: boolean; reload?: MohReload }>(`/api/entities/${entity}/${id}`, { method: 'DELETE' }),
  exportUrl: (entity: string) => `/api/entities/${entity}/export.csv`,
  importCsv: (entity: string, csv: string) => request<{ imported: number; errors: string[] }>(`/api/entities/${entity}/import`, { method: 'POST', body: csv, raw: true }),
  download: async (entity: string) => {
    const res = await fetch(`/api/entities/${entity}/export.csv`, { credentials: 'same-origin' });
    if (!res.ok) throw new ApiError('Export failed', res.status);
    return res.blob();
  },

  settings: () => request<{ values: Record<string, string> }>('/api/settings'),
  saveSettings: (values: Record<string, any>) => request<{ values: Record<string, string> }>('/api/settings', { method: 'PUT', body: values }),

  config: (write = false) => request<any>(`/api/config${write ? '?write=1' : ''}`),
  dialplanTest: (number: string, callerId: string) =>
    request<any>('/api/tools/dialplan-test', { method: 'POST', body: { number, callerId } }),

  dashboard: () => request<any>('/api/dashboard'),
  cdr: (query: Record<string, any> = {}) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v !== '' && v !== undefined && v !== null) params.set(k, String(v));
    return request<{ rows: any[]; total: number }>(`/api/cdr?${params.toString()}`);
  },
  clearCdr: () => request('/api/cdr', { method: 'DELETE' }),
  audit: () => request<{ rows: any[] }>('/api/audit'),

  aiStatus: () => request<{
    configured: boolean; ttsModel: string; sttModel: string; voices: string[]; output: string;
  }>('/api/ai/status'),
  createRecording: (body: { name: string; text: string; voice?: string; language?: string }) =>
    request<{ row: any; file: string; text: string }>('/api/ai/recordings', { method: 'POST', body }),
  // A recording built from audio the operator already has (upload or mic).
  uploadRecording: async (name: string, blob: Blob, filename?: string) => {
    const res = await fetch('/api/recordings/audio', {
      method: 'POST',
      headers: {
        'x-csrf': cookie('ac_csrf'),
        'Content-Type': 'application/octet-stream',
        'x-name': encodeURIComponent(name),
        'x-filename': encodeURIComponent(filename || 'recording.wav')
      },
      credentials: 'same-origin',
      body: blob
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new ApiError((data && data.error) || `Upload failed (${res.status})`, res.status);
    return data as { row: any; file: string; converted: boolean; source: string };
  },
  // Replace one recording's audio in place, keeping every reference to it.
  replaceRecordingAudio: async (id: number, file: File | Blob, filename?: string) => {
    const res = await fetch(`/api/entities/recordings/${id}/audio`, {
      method: 'POST',
      headers: {
        'x-csrf': cookie('ac_csrf'),
        'Content-Type': 'application/octet-stream',
        'x-filename': encodeURIComponent(filename || (file instanceof File ? file.name : 'recording.wav'))
      },
      credentials: 'same-origin',
      body: file
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new ApiError((data && data.error) || `Upload failed (${res.status})`, res.status);
    return data as { row: any; file: string; converted: boolean; source: string };
  },
  createJingle: (body: { name: string; prompt: string; voice?: string }) =>
    request<{ row: any; file: string; tagline: string; seconds: number; directory: string; reload: MohReload }>('/api/ai/jingle', { method: 'POST', body }),
  // Upload own hold music; the server converts it to 8 kHz mono WAV.
  uploadMusicAudio: async (id: number, file: File) => {
    const res = await fetch(`/api/entities/music/${id}/audio`, {
      method: 'POST',
      headers: {
        'x-csrf': cookie('ac_csrf'),
        'Content-Type': 'application/octet-stream',
        'x-filename': encodeURIComponent(file.name)
      },
      credentials: 'same-origin',
      body: file
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new ApiError((data && data.error) || `Upload failed (${res.status})`, res.status);
    return data as { file: string; directory: string; bytes: number; converted: boolean; source: string; replace: boolean; reload: MohReload };
  },
  // Ask Asterisk to re-read the hold-music directories; says whether it did.
  reloadMusic: () => request<{ reload: MohReload }>('/api/moh/reload', { method: 'POST' }),
  transcribe: async (blob: Blob) => {
    const res = await fetch('/api/ai/transcribe?format=wav', {
      method: 'POST',
      headers: { 'x-csrf': cookie('ac_csrf'), 'Content-Type': 'audio/wav' },
      credentials: 'same-origin',
      body: blob
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new ApiError((data && data.error) || 'Transcription failed', res.status);
    return data as { text: string };
  }
};

export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
