# Asterisk Console

A modern, all-in-one administration console for Asterisk — a clean-room reconstruction of the
FreePBX 17 admin UI, with **no PHP**, no module marketplace, and no external services. It ships as a
single Docker container.

```
export ADMIN_PASSWORD='choose-a-long-password'   # the only source of the first admin password
docker run -d --name asterisk-console -p 8080:8080 \
  -v pbx-data:/data -e ADMIN_PASSWORD \
  --restart unless-stopped asterisk-console
```

Open <http://localhost:8080> and sign in as `admin` (or `ADMIN_USER`). `ADMIN_PASSWORD` is the only
source of the bootstrap password: without it the app waits for the first-run setup screen, and a
short password aborts startup rather than creating a weak account.

---

## What was observed

The source system was inspected through REA over the live Chrome DevTools Protocol session
(`list-browser-targets` → `inspect-web-page` on port 9222), not guessed from screenshots.

| Observation | Evidence |
| --- | --- |
| Target: `FreePBX Administration`, `https://voice.innotel.us/admin/config.php` | target list, `target_id AE3928…` |
| Version string `17.0.33.4` (asset query strings) | 32 recorded resources |
| UI stack: Bootstrap 4.6.1, jQuery 3.6.0, Font Awesome 4.7, notie, bootstrap-select, bootstrap-table, jQuery UI 1.13.2, Typeahead, CanvasJS, Packery + Draggabilly | resource inventory |
| Layout: top navbar (hamburger, brand image, two collapsible nav levels), left module sidebar, dashboard widget grid, Sangoma/GPL footer | DOM tree (1,293 nodes) + accessibility tree (540 nodes) |
| Navigation: 5 groups — Admin, Applications, Connectivity, Reports, Settings | accessibility roles `button expanded=false` |
| **84 modules** reachable via `config.php?display=…` | 192 DOM URLs, de-duplicated |
| Global search cached in `localStorage` under `search&command=global` keys | storage key names (values redacted) |
| Dashboard widgets: Asterisk, Uptime, CPU, Memory, Disk, Network, `eth0@if77` | accessibility node names |

The compiled theme stylesheet is auth-gated (`302`), so colours and spacing were **not** copied.
The visual language here is a deliberate new design; the *structure* (groups, modules, dashboard
widgets, two-level nav) preserves what the target actually does.

Inferences, kept separate from observations: the nav is a collapsible sidebar rather than a
mega-menu (inferred from `aria-expanded` buttons wrapping nested `<ul>` lists), and the dashboard
is a draggable widget board (inferred from Packery/Draggabilly and per-widget toggle buttons).

---

## What this build does

### 1. No PHP, modern interface

Node 24 + Express serving a React 18 SPA. Server-rendered PHP templates, jQuery DOM mutation and
the `lessphp` runtime compiler are gone. Assets are content-hashed and immutable-cacheable; the
whole client is ~253 kB (73 kB gzipped).

### 2. Robust interface

- Schema-driven modules: one declaration drives DDL, validation, CSV, config generation and UI.
- Real form validation with friendly errors (`Display name is required`), unique-constraint
  handling (409), optimistic UI refresh, debounced search.
- Keyboard command palette (`Ctrl/⌘ K`), collapsible nav with persisted state, light/dark theme,
  responsive drawer under 1024 px, print styles.
- Accessibility: focus-visible rings, ARIA dialogs, labelled controls, tabular numerals, no
  colour-only status (every dot is paired with text).
- Toasts, confirm dialogs, empty states, skeleton loaders, and per-module JSON hints.

### 3. New features (not in the original)

| Feature | Why it matters |
| --- | --- |
| **Dialplan tracer** | Shows step by step how a dialled number resolves (extension → queue → feature code → blacklist → outbound pattern) before placing a call. |
| **Live channel monitor** | Server-Sent Events stream of active calls, queue waits and talk duration. |
| **Generated-config viewer** | Every file is previewed with syntax colouring, line counts, warnings, copy/download, and an explicit *apply to disk* step. |
| **CSV import/export** | Extension bulk load upserts by extension number; exports exclude secrets. |
| **Audit log** | Every mutation, login, settings change and config write, with actor and IP. |
| **Scoped API tokens** | 192-bit random, SHA-256-hashed, shown once and sent as `Authorization: Bearer …`; requests run with the token's `readonly` / `operator` / `admin` scope and are logged. |
| **Config warnings** | e.g. flags `chan_sip` extensions as deprecated, missing SIP secrets. |
| **Host telemetry** | Uptime, load, memory and storage on the dashboard and system page. |

### AI recordings and music on hold

Recordings and music-on-hold classes can be generated from text or from your voice. Everything
routes through one OpenAI-compatible gateway (set `OMNIROUTE_BASE_URL`, default
`https://gateway.innotel.us/v1`, and `OMNIROUTE_API_KEY`):

- **Recordings → Generate with AI**: text is rendered to `8 kHz mono WAV` by the TTS model
  (`AI_TTS_MODEL`, default `google/gemini-2.5-flash-preview-tts`), stored on the `/data` volume and
  added as a recording. **Record voice input** captures the microphone in the browser, converts it
  to WAV locally and transcribes it (`AI_STT_MODEL`) so you can dictate the script instead of typing.
- **Music on Hold → Generate Jingle**: the model writes a one-line tagline from your brief, voices
  it, and mixes it over a synthesized music bed, then creates or updates the music class. Generating
  again **replaces** that class's audio instead of stacking a second Jingle in front of the first.

Generated files live in `/data/media/moh/<class>` (hold music) and `/data/media/recordings`, and are
served to signed-in users at `/api/media/…` with a **Preview** action on each record.

You can also upload your own audio for a class (**Upload** on a Music on Hold row). Anything ffmpeg can
read — MP3, M4A/AAC, OGG/Opus, FLAC, 44.1 kHz stereo WAV — is converted to `8 kHz mono 16-bit PCM WAV`
first, so Asterisk always plays it, and a file that is already in that shape is stored untouched. The
Docker image ships ffmpeg; a local `npm start` needs `ffmpeg` on `PATH` (or `FFMPEG_PATH`) only when a
file actually needs converting. A conversion that runs past 30 seconds or 64 MB of output is killed,
so a malformed or very long file fails the request instead of holding it open. Uploading replaces the
class's own audio by default (the new file is written before the old one is removed), and deleting a
class removes only the files the console wrote — audio an operator added by hand, or another class's
files in a shared directory, is never deleted.

After a Jingle, upload or delete changes a class's audio, the console reloads `res_musiconhold.so` over
AMI so Asterisk plays the new files at once (the AMI user needs the `command` write class). The
response says whether that reload happened, and when AMI is not configured it says plainly that
Asterisk was not reloaded instead of implying the new audio is already live.

**Reload hold music** on the Music on Hold page asks for that same reload on demand, so files dropped
into a class directory by hand go live without generating a Jingle.

`docker-compose.yml` mounts the `pbx-moh` volume at both `/data/media/moh` and the stock Asterisk
hold-music path `/var/lib/asterisk/moh`, and `musiconhold.conf` names the stock path, so generated
hold music plays without a manual copy. With a plain `docker run`, add both mounts:

```
docker run -d --name asterisk-console -p 8080:8080 \
  -v pbx-data:/data -v pbx-moh:/data/media/moh -v pbx-moh:/var/lib/asterisk/moh \
  -e ADMIN_PASSWORD -e SESSION_SECRET asterisk-console
```

A class is only auto-filled when it still uses the stock `/var/lib/asterisk/moh` default: it moves to
the console's store and gets a generated bed when empty. A deliberately custom directory is never
rewritten or written into — the config page warns when it holds no readable audio.

The stock path is only written into `musiconhold.conf` when that directory really holds the class's
audio; an unmounted or empty `/var/lib/asterisk/moh` keeps the console store path and raises a config
warning instead of pointing Asterisk at silence.

**Upgrading:** hold music used to live inside `pbx-data`. The new `pbx-moh` mount would hide it, so
compose runs a one-off `moh-seed` service that copies `pbx-data/media/moh` into `pbx-moh` before the
app starts (a no-op once it has audio). On a plain `docker run`, the app keeps classes on the media
volume, logs the one-off copy to run, and any class still empty gets a generated bed:

```
docker run --rm --user root -v <data-volume>:/from:ro -v <moh-volume>:/to asterisk-console \
  sh -c 'cp -a /from/media/moh/. /to/'
```

### 4. Plug and play

```
cp docker-compose.yml .
ADMIN_PASSWORD='a-long-password' docker compose up -d
```

- First boot creates the admin from `ADMIN_PASSWORD` only — no default, no test credential. Without
  it you get the first-run setup screen; a password under 8 characters stops startup with a clear
  error before the server listens.
- `SEED_DEMO=1` (default) loads a working configuration: 6 extensions, 2 trunks, 3 DIDs,
  inbound/outbound routes, 2 ring groups, 2 queues, an IVR, time groups/conditions, voicemail,
  parking, DISA, feature codes, contacts, music classes and call history.
- `SIMULATE_CALLS=1` (off by default) animates live channel activity on the dashboard for a demo
  instance with no AMI feed. Simulated calls are never written to the CDR table.
- Point the console at Asterisk's AMI and the demo data gives way to the real thing: with
  `ami_host` / `ami_port` / `ami_user` / `ami_secret` set (Settings → Asterisk), the console keeps one
  AMI session open, Asterisk's channel events feed the live channel list and `cdr_manager`'s `Cdr`
  events are stored as call records. The AMI user needs read classes
  `system,call,log,verbose,agent,user,config,reporting,cdr,dialplan` and write class `command` (for
  the hold-music reload), and `manager.conf` must bind beyond `127.0.0.1` with that address permitted.
  Reach the AMI address from this container: either join the PBX's Docker network and use its container
  alias (for example `ami_host=freepbx`), or publish 5038 on the host and use the host address.
- Data lives in one SQLite file on the `/data` volume (WAL mode).
- No native modules, no build toolchain, no Redis, no MariaDB, no PHP-FPM.
- `HEALTHCHECK` hits `/api/health`; `SESSION_SECRET` makes sessions survive restarts.

### 5. Docker

Multi-stage build: Vite compiles the SPA, then a slim `node:24-alpine` runtime installs production
dependencies only, runs as the unprivileged `node` user, and serves API + SPA on port 8080.

### 6. All modules in one

The 84 observed modules are consolidated into **27 data modules** plus config, dialplan and
reporting surfaces. The **Module Registry** page lists all 84 with the module that now owns each
one's data, so nothing silently disappeared:

- Extension Manager + Custom Extensions + Follow Me → **Extensions**
- Inbound Routes / DIDs / DAHDI Channel DIDs → **Inbound Routes, DIDs, DAHDI**
- Ring Groups, Queues, Queue Priorities, IVR, Time Conditions/Groups, Announcements,
  Conferences, Paging, Parking, DISA, Misc Destinations → dedicated modules
- Voicemail + Voicemail Blast + Voicemail Admin → **Voicemail**
- Blacklist, Allowlist, Contact Manager, CID Lookup, Directory → **Blacklist, Allowlist, Contacts**
- Module Admin, Updates, Certman, Backup, PHP Info, Config Edit → replaced by built-in
  config generation, the registry page and the API

The one thing that cannot be carried over is PHP module code itself; equivalent behaviour is
implemented natively.

---

## Architecture

```
server/
  schema.js     entity + field declarations, nav, module registry  ← single source of truth
  db.js         node:sqlite DDL, migrations, demo seed
  auth.js       scrypt, HMAC sessions, CSRF, throttling
  asterisk.js   config generation, dialplan tracer, AMI client, telemetry
  index.js      REST API, CSV, SSE, static SPA
web/src/
  app.tsx       shell: sidebar, topbar, palette, theme, SSE
  lib/          api client, live context, UI kit + SVG charts
  pages/        dashboard, entities (generic CRUD), cdr, tools, admin, login
```

Adding a module: append an entry to `ENTITIES` in `server/schema.js` and an item to `NAV_GROUPS`.
The table, REST routes, CSV, form, list view and validation all follow automatically.

### API sketch

```
GET    /api/meta                       nav, entities, destinations, module registry
# Automation can authenticate with:  Authorization: Bearer ac_…
GET    /api/entities/:entity?q=        list + search
POST   /api/entities/:entity           create (operator+)
PUT    /api/entities/:entity/:id       update
DELETE /api/entities/:entity/:id       delete
GET    /api/entities/:entity/export.csv
POST   /api/entities/:entity/import    text/csv body
POST   /api/entities/music/:id/audio   raw audio body; converted to 8 kHz mono WAV (?append=1 to stack)
GET    /api/config[?write=1]           generated Asterisk files
POST   /api/tools/dialplan-test        {"number":"6000","callerId":"1001"}
GET    /api/dashboard | /api/cdr | /api/audit | /api/settings | /api/events (SSE)
```

### Generated configuration

`pjsip.conf`, `extensions.conf`, `queues.conf`, `voicemail.conf`, `features.conf`,
`musiconhold.conf`, `chan_dahdi.conf` (+ `sip_additional.conf` when legacy extensions exist), all
built from the database with `; Generated … do not edit` headers. Writing to disk is an explicit
admin action.

---

## Security

- scrypt password hashing; HTTP-only, `SameSite=Lax`, signed session cookies (Secure over HTTPS).
- Double-submit CSRF token required on every mutation.
- Roles: `admin` (everything), `operator` (data + config apply), `readonly` (no mutations, secrets
  redacted in responses).
- API tokens: 192-bit random values, only their SHA-256 digest is stored, scope-limited, revocable
  and recorded in `api_requests`. They are not cookie-bound, so they skip CSRF; cookie sessions still
  require it.
- Login throttling per IP+username; last-admin and self-delete protections. `X-Forwarded-For` is
  ignored unless `TRUST_PROXY=1` (set it only behind a trusted reverse proxy).
- CSP, `nosniff`, `X-Frame-Options`, referrer policy, permissions policy.
- Parameterised SQL everywhere; identifiers quoted; secrets never returned to read-only callers.

## Verification performed

Built (`vite build`, 1,590 modules) and exercised against a live server: health, login, meta
(27 entities / 84 modules / 12 destination types), CRUD incl. duplicate → 409 and missing-field →
400, CSRF rejection → 403, unauthenticated → 401, role enforcement (operator blocked from
settings, allowed to create extensions), config generation with zero warnings and correct
`GotoIfTime`/queue/outbound/from-trunk output, dialplan traces (queue, emergency, outbound,
unmatched), dashboard metrics, CDR filters, CSV export, settings update, API-token issuance, audit
entries, SSE ticks, SPA shell + deep-link routing and asset content types.

The Docker image was built and run as a non-root container against a fresh volume, and the browser
UI was exercised for sign-in, dashboard, the extension list and the create-extension form.

**Verified against a real PBX:** with a FreePBX/Asterisk 22 AMI link configured, the console logs
in over its persistent session, tracks live channels from Asterisk's channel events, and stores
the `cdr_manager` records Asterisk emits at hangup. The UI was not clicked through page by page.

## Limitations

- Asterisk is not bundled: this container manages configuration and state; point
  `ast_config_dir` at a shared volume (or mount it) and reload Asterisk after applying.
- Demo call history is seeded once by `SEED_DEMO`, and live channel activity can be animated with
  `SIMULATE_CALLS=1`; neither writes simulated calls into `cdr` after boot. Real CDRs arrive over
  AMI from `cdr_manager`, which is enabled by default in FreePBX; records are de-duplicated on
  `uniqueid`, so a CDR Asterisk finalizes twice is stored once with its final duration.
- FreePBX `.conf` imports, commercial modules (endpoint manager, fax pro, etc.) and PHP hook
  modules are out of scope by design.
