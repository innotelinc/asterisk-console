/**
 * Asterisk engine installation.
 *
 * The console is a control plane: it can drive a PBX that already exists, or it
 * can install one for you. This module owns the second half. It talks to the
 * Docker socket the console was given (DOCKER_SOCKET, default
 * /var/run/docker.sock) and starts a single Asterisk container of the chosen
 * version, with:
 *
 *   - the console's own data directory mounted at /etc/asterisk, so "apply to
 *     disk" writes the files the running Asterisk actually reads;
 *   - an AMI user generated here, restricted to private address ranges, so the
 *     console can read events and reload modules without exposing AMI publicly;
 *   - the console's Docker network plus the alias `asterisk`, so AMI needs no
 *     published port and no host IP.
 *
 * Without a Docker socket nothing is installed and nothing fails silently: the
 * caller gets the exact `docker run` command and compose file for the chosen
 * version instead, with the same AMI secret, so the operator can run it on the
 * host and the console will connect on the next attempt.
 */
import http from 'node:http';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getSetting, setSetting } from './db.js';
import { testAmiConnection, restartAmi } from './asterisk.js';

const DATA_DIR = process.env.DATA_DIR || '/data';

/** The container this module owns. A fixed name keeps reinstalls idempotent. */
export const ENGINE_CONTAINER = 'asterisk-console-pbx';
const ENGINE_LABEL = 'com.asterisk-console.engine';

/**
 * The Asterisk long-term-support lines the console can install: 22 (current
 * LTS), 24 (LTS, released 5 November 2026) and 20 (previous LTS). `image` is
 * the maintained rolling build from andrius/asterisk and `release` the upstream
 * tarball that line is on; the two drift, because the rolling tag is rebuilt on
 * the publisher's schedule. When a locally built
 * `asterisk-console/asterisk:<release>` image exists the installer prefers it,
 * so an operator can compile the current release from asterisk/Dockerfile.
 * The support date is the upstream end-of-security-support date, so the picker
 * says what you are committing to.
 */
export const ENGINE_VERSIONS = [
  { id: '22', label: 'Asterisk 22 LTS', image: 'andrius/asterisk:22', release: '22.12.0', support: '2029-10', recommended: true },
  { id: '24', label: 'Asterisk 24 LTS', image: 'andrius/asterisk:24-rc', release: '24.0.0', support: '2031-10' },
  { id: '20', label: 'Asterisk 20 LTS', image: 'andrius/asterisk:20', release: '20.22.0', support: '2027-10' }
];

export function engineVersion(id) {
  return ENGINE_VERSIONS.find((v) => v.id === String(id)) || null;
}

/**
 * The Asterisk version a container was started from, read off its image
 * reference: `andrius/asterisk:23` → 23, `andrius/asterisk:24-rc` → 24,
 * `asterisk-console/asterisk:22.12.0` → 22.12.0. Containers started from the
 * printed `docker run` carry no label, so this is the only version they have;
 * an image with a symbolic tag (`stable`, `latest`) or a bare image id yields
 * an empty string rather than a guess.
 */
export function versionFromImage(ref) {
  const image = String(ref || '').split('@')[0];
  const tag = image.includes(':') ? image.slice(image.lastIndexOf(':') + 1) : '';
  const match = /^(\d+(?:\.\d+)*)/.exec(tag);
  return match ? match[1] : '';
}

/** The tag a source build of this line produces. */
export function engineSourceImage(chosen) {
  return `asterisk-console/asterisk:${chosen.release}`;
}

/**
 * The image a source build of this line produced, when the host has one. It is
 * the current release even while the rolling registry tag is an older one.
 */
async function builtImage(chosen) {
  const image = engineSourceImage(chosen);
  try {
    await docker('GET', `/images/${encodeURIComponent(image)}/json`);
    return image;
  } catch {
    return null;
  }
}

/** Where the console keeps the Asterisk configuration it writes. */
export function engineDir() {
  return join(DATA_DIR, 'pbx');
}

function socketPath() {
  const raw = process.env.DOCKER_SOCKET || '/var/run/docker.sock';
  return raw.startsWith('unix://') ? raw.slice('unix://'.length) : raw;
}

/**
 * Where the Docker Engine API is, as something http.request accepts.
 *
 * A mounted socket is the direct case. `DOCKER_HOST=tcp://host:port` covers a
 * host that cannot bind-mount its socket into this container (Coolify's API
 * refuses bind mounts, for one) and runs a socket proxy instead.
 */
function dockerTarget() {
  // PBX_DOCKER_HOST first: a platform that exports DOCKER_HOST for its own
  // builder will otherwise point the build at the proxy and fail the build.
  const host = String(process.env.PBX_DOCKER_HOST || process.env.DOCKER_HOST || '');
  const match = /^tcp:\/\/([^:/]+):(\d+)$/.exec(host);
  if (match) return { host: match[1], port: Number(match[2]) };
  return { socketPath: socketPath() };
}

/** A short label for the endpoint, for messages and status. */
export function dockerEndpointLabel() {
  const target = dockerTarget();
  return target.socketPath ? target.socketPath : `tcp://${target.host}:${target.port}`;
}

export function dockerAvailable() {
  if (dockerTarget().host) return true; // a TCP endpoint is only proven by a call
  try {
    return existsSync(socketPath());
  } catch {
    return false;
  }
}

/** One Docker Engine API call over the unix socket. */
function docker(method, path, { body, timeout = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = http.request(
      {
        ...dockerTarget(),
        path,
        method,
        headers: {
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {})
        },
        timeout
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try { json = text ? JSON.parse(text) : null; } catch { json = null; }
          if (res.statusCode >= 400) {
            const message = json?.message || text.slice(0, 300) || `Docker answered ${res.statusCode}`;
            return reject(new Error(message));
          }
          resolve({ status: res.statusCode, json, text });
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('Docker did not answer in time')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/** Pull an image, following Docker's progress stream to the end. */
function pullImage(image, tag, onProgress) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        ...dockerTarget(),
        path: `/images/create?fromImage=${encodeURIComponent(image)}&tag=${encodeURIComponent(tag)}`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        timeout: 600000
      },
      (res) => {
        if (res.statusCode >= 400) {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            let message = Buffer.concat(chunks).toString('utf8');
            try { message = JSON.parse(message).message || message; } catch {}
            reject(new Error(message || `Docker could not pull ${image}:${tag}`));
          });
          return;
        }
        let buffer = '';
        res.on('data', (chunk) => {
          buffer += chunk.toString('utf8');
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const event = JSON.parse(line);
              if (event.error) return reject(new Error(event.error));
              if (event.status && onProgress) onProgress(event.status, event.progress);
            } catch {}
          }
        });
        res.on('end', resolve);
      }
    );
    req.on('timeout', () => req.destroy(new Error('The image pull did not finish in ten minutes')));
    req.on('error', reject);
    req.end();
  });
}

async function findContainer() {
  const filters = encodeURIComponent(JSON.stringify({ name: [`^/${ENGINE_CONTAINER}$`] }));
  const res = await docker('GET', `/containers/json?all=1&filters=${filters}`);
  return (res.json || []).find((c) => (c.Names || []).includes(`/${ENGINE_CONTAINER}`)) || null;
}

/**
 * The network the console itself runs on, so the PBX can join it and be reached
 * as `asterisk` without publishing AMI. Null when the console is not in Docker
 * (or is on the default bridge, which containers cannot join).
 */
async function consoleNetwork() {
  try {
    const self = await docker('GET', `/containers/${os.hostname()}/json`);
    const networks = Object.keys(self.json?.NetworkSettings?.Networks || {});
    return networks.find((name) => name !== 'bridge' && name !== 'host' && name !== 'none') || null;
  } catch {
    return null;
  }
}

/**
 * How the Asterisk container should see this console's data directory.
 *
 * A bind mount needs a host path, and a named volume needs the volume plus a
 * subpath — the console's own /data/pbx is neither on its own. Ask Docker how
 * /data is mounted into this console and mirror it, so the PBX reads exactly the
 * files "apply to disk" writes. When the console is not containerized its data
 * directory already is a host path.
 */
async function dataMountBase() {
  const dir = engineDir();
  try {
    const self = await docker('GET', `/containers/${os.hostname()}/json`);
    const mount = (self.json?.Mounts || [])
      .filter((m) => dir === m.Destination || dir.startsWith(`${m.Destination.replace(/\/$/, '')}/`))
      .sort((a, b) => b.Destination.length - a.Destination.length)[0];
    if (mount) {
      const subpath = dir.slice(mount.Destination.replace(/\/$/, '').length).replace(/^\//, '');
      if (mount.Type === 'volume' && mount.Name) return { kind: 'volume', name: mount.Name, subpath };
      if (mount.Type === 'bind') return { kind: 'bind', base: join(mount.Source, subpath) };
    }
  } catch {
    // Not in Docker, or Docker would not say: fall through to the plain path.
  }
  return { kind: 'bind', base: dir };
}

function engineMounts(base) {
  const spec = (target, sub) => (base.kind === 'volume'
    ? { Type: 'volume', Source: base.name, Target: target, VolumeOptions: sub ? { Subpath: sub } : {} }
    : { Type: 'bind', Source: sub ? join(base.base, sub) : base.base, Target: target });
  return [
    spec('/etc/asterisk', base.subpath),
    spec('/var/lib/asterisk', base.subpath ? `${base.subpath}/lib` : 'lib'),
    spec('/var/spool/asterisk', base.subpath ? `${base.subpath}/spool` : 'spool'),
    spec('/var/log/asterisk', base.subpath ? `${base.subpath}/log` : 'log')
  ];
}

function writeIfMissing(file, content) {
  const target = join(engineDir(), file);
  if (existsSync(target)) return false;
  writeFileSync(target, content, 'utf8');
  return true;
}

/**
 * The files a fresh Asterisk needs before the console can talk to it. Files the
 * operator already edited are left alone; "apply to disk" owns the rest.
 */
function writeManager({ amiUser, amiSecret }) {
  mkdirSync(engineDir(), { recursive: true });
  // AMI is reachable only from private ranges: the console joins the container
  // network, so no public interface ever needs to answer on 5038.
  const manager = [
    '; Written by Asterisk Console — the AMI account the console signs in with.',
    '[general]',
    'enabled = yes',
    'port = 5038',
    'bindaddr = 0.0.0.0',
    'displayconnects = no',
    '',
    `[${amiUser}]`,
    `secret = ${amiSecret}`,
    'deny = 0.0.0.0/0.0.0.0',
    'permit = 127.0.0.1/255.255.255.255',
    'permit = 10.0.0.0/8',
    'permit = 172.16.0.0/12',
    'permit = 192.168.0.0/16',
    'read = system,call,log,verbose,command,agent,user,config,dtmf,reporting,cdr,dialplan,originate,message',
    'write = command',
    ''
  ].join('\n');
  writeFileSync(join(engineDir(), 'manager.conf'), manager, 'utf8');
  return 'manager.conf';
}

function writeBaseConfig({ amiUser, amiSecret, sipPort, rtpStart, rtpEnd, externalAddress }) {
  mkdirSync(engineDir(), { recursive: true });
  mkdirSync(join(engineDir(), 'lib'), { recursive: true });
  mkdirSync(join(engineDir(), 'spool'), { recursive: true });
  mkdirSync(join(engineDir(), 'log'), { recursive: true });

  const rtp = [
    '; Written by Asterisk Console — keep the range in step with the published ports.',
    '[general]',
    `rtpstart = ${rtpStart}`,
    `rtpend = ${rtpEnd}`,
    ''
  ].join('\n');

  const pjsip = [
    '; Written by Asterisk Console — replaced when you apply generated configuration.',
    '[transport-udp]',
    'type = transport',
    'protocol = udp',
    `bind = 0.0.0.0:${sipPort}`,
    ...(externalAddress ? [
      `external_media_address = ${externalAddress}`,
      `external_signaling_address = ${externalAddress}`,
      'local_net = 10.0.0.0/8',
      'local_net = 172.16.0.0/12',
      'local_net = 192.168.0.0/16'
    ] : []),
    ''
  ].join('\n');

  const extensions = [
    '; Written by Asterisk Console — apply generated configuration to replace this.',
    '[general]',
    'static = yes',
    'writeprotect = no',
    '',
    '[from-internal]',
    'exten => _X.,1,NoOp(No dialplan has been applied yet)',
    ' same => n,Hangup()',
    '',
    '[from-trunk]',
    'exten => _X.,1,Hangup()',
    ''
  ].join('\n');

  const logger = [
    '[general]',
    '',
    '[logfiles]',
    'console => notice,warning,error',
    'messages => notice,warning,error',
    ''
  ].join('\n');

  const written = [writeManager({ amiUser, amiSecret })];
  if (writeIfMissing('rtp.conf', rtp)) written.push('rtp.conf');
  if (writeIfMissing('pjsip.conf', pjsip)) written.push('pjsip.conf');
  if (writeIfMissing('extensions.conf', extensions)) written.push('extensions.conf');
  if (writeIfMissing('logger.conf', logger)) written.push('logger.conf');
  if (writeIfMissing('modules.conf', '[modules]\nautoload = yes\n')) written.push('modules.conf');
  return written;
}

/** Write manager.conf when the AMI account it holds is not the one in settings. */
function ensureManagerSecret({ amiUser, amiSecret, sipPort, rtpStart, rtpEnd, externalAddress }) {
  const target = join(engineDir(), 'manager.conf');
  const current = existsSync(target) ? readFileSync(target, 'utf8') : '';
  if (current.includes(`secret = ${amiSecret}`) && current.includes(`[${amiUser}]`)) {
    // Keep the remaining base files present even when manager.conf is current.
    return writeBaseConfig({ amiUser, amiSecret, sipPort, rtpStart, rtpEnd, externalAddress }).filter((f) => f !== 'manager.conf');
  }
  return writeBaseConfig({ amiUser, amiSecret, sipPort, rtpStart, rtpEnd, externalAddress });
}

function settingsForEngine() {
  return {
    amiUser: getSetting('ami_user', '') || 'console',
    amiSecret: getSetting('ami_secret', '') || randomBytes(12).toString('hex'),
    sipPort: Number(getSetting('pbx_sip_port', '5060')) || 5060,
    rtpStart: Number(getSetting('pbx_rtp_start', '10000')) || 10000,
    rtpEnd: Number(getSetting('pbx_rtp_end', '10199')) || 10199,
    externalAddress: getSetting('pbx_external_address', '') || ''
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Wait for AMI to answer, which is the first moment the console can use it. */
async function waitForAmi({ host, port, user, secret }, deadlineMs = 90000) {
  const until = Date.now() + deadlineMs;
  let last = 'Asterisk has not answered AMI yet';
  while (Date.now() < until) {
    const result = await testAmiConnection({ host, port, user, secret });
    if (result.ok) return { ok: true };
    last = result.error || last;
    await sleep(2500);
  }
  return { ok: false, error: last };
}

// One install at a time: a second click joins the first instead of racing it.
let installState = { phase: 'idle', message: '', error: null, startedAt: null, finishedAt: null };
let installRunning = null;

export function engineInstallState() {
  return installState;
}

/**
 * Install (or reinstall) the engine for a version. Runs in the background and
 * reports progress through engineInstallState(), because a first image pull
 * easily outlives a reverse proxy's request timeout.
 */
export function startEngineInstall(version) {
  const chosen = engineVersion(version);
  if (!chosen) return { started: false, error: `Unknown Asterisk version "${version}"` };
  if (installRunning) return { started: true, alreadyRunning: true };
  if (!dockerAvailable()) {
    return {
      started: false,
      needsDocker: true,
      error: `No Docker endpoint at ${dockerEndpointLabel()}. Run the generated command on the host, or give the console a Docker socket or proxy.`
    };
  }

  const cfg = settingsForEngine();
  installState = { phase: 'pulling', message: `Pulling ${chosen.image}…`, error: null, startedAt: new Date().toISOString(), finishedAt: null };

  installRunning = (async () => {
    let usedRegistry = false;
    try {
      // A source build of the current release wins over the rolling tag: the
      // operator built it because the tag was behind.
      const built = await builtImage(chosen);
      const image = built || chosen.image;
      if (built) {
        installState = { ...installState, phase: 'configuring', message: `Using the locally built ${built}…` };
      } else {
        usedRegistry = true;
        await pullImage('andrius/asterisk', chosen.image.split(':')[1], (status) => {
          if (status && status !== 'Downloading') {
            installState = { ...installState, message: `${status} ${chosen.image}` };
          }
        });
      }

      installState = { ...installState, phase: 'configuring', message: 'Writing manager.conf and the base configuration…' };
      ensureManagerSecret(cfg);

      installState = { ...installState, phase: 'starting', message: 'Starting the Asterisk container…' };
      const existing = await findContainer();
      if (existing) {
        await docker('POST', `/containers/${existing.Id}/stop?t=10`).catch(() => {});
        await docker('DELETE', `/containers/${existing.Id}?force=1`);
      }

      const network = await consoleNetwork();
      const mountBase = await dataMountBase();
      // The container listens on the configured ports and they are published
      // one to one, so rtp.conf, pjsip.conf and the host mapping all agree.
      // Docker's API takes one entry per port; the CLI expands a range for you,
      // so do the same here instead of handing the engine a range it rejects.
      const ports = { [`${cfg.sipPort}/udp`]: [{ HostPort: String(cfg.sipPort) }] };
      const span = Math.min(cfg.rtpEnd - cfg.rtpStart, 999);
      for (let port = cfg.rtpStart; port <= cfg.rtpStart + span; port += 1) {
        ports[`${port}/udp`] = [{ HostPort: String(port) }];
      }
      if (!network) ports['5038/tcp'] = [{ HostPort: '5038' }];

      const created = await docker('POST', `/containers/create?name=${ENGINE_CONTAINER}`, {
        body: {
          Image: image,
          Env: ['PUID=1000', 'PGID=1000'],
          Labels: { [ENGINE_LABEL]: chosen.id, 'com.asterisk-console.version': chosen.id },
          ExposedPorts: Object.fromEntries(Object.keys(ports).map((p) => [p, {}])),
          HostConfig: {
            RestartPolicy: { Name: 'unless-stopped' },
            Mounts: engineMounts(mountBase),
            PortBindings: ports,
            ...(network ? { NetworkMode: network } : {})
          },
          ...(network ? { NetworkingConfig: { EndpointsConfig: { [network]: { Aliases: ['asterisk'] } } } } : {})
        }
      });
      await docker('POST', `/containers/${created.json.Id}/start`);

      const host = network ? 'asterisk' : '127.0.0.1';
      installState = { ...installState, phase: 'waiting', message: `Waiting for AMI on ${host}:5038…` };
      const ami = await waitForAmi({ host, port: 5038, user: cfg.amiUser, secret: cfg.amiSecret });

      setSetting('ami_host', host);
      setSetting('ami_port', '5038');
      setSetting('ami_user', cfg.amiUser);
      setSetting('ami_secret', cfg.amiSecret);
      setSetting('ast_config_dir', engineDir());
      setSetting('pbx_engine', 'installed');
      setSetting('pbx_engine_version', chosen.id);

      if (!ami.ok) throw new Error(`Asterisk started but AMI did not answer: ${ami.error}`);

      // The AMI client is still holding the socket it opened for the previous
      // settings.  Without this the wizard reports a signed-in engine while the
      // console keeps talking to whatever host it was pointed at before.
      restartAmi();

      installState = {
        phase: 'done',
        message: `${chosen.label} is running; the console is signed in to AMI at ${host}:5038.`,
        error: null,
        startedAt: installState.startedAt,
        finishedAt: new Date().toISOString()
      };
    } catch (err) {
      const hint = usedRegistry
        ? ` The rolling ${chosen.image} tag can lag the ${chosen.release} release; the wizard can build that release from source instead.`
        : '';
      installState = {
        phase: 'error',
        message: installState.message,
        error: `${err.message}${hint}`,
        startedAt: installState.startedAt,
        finishedAt: new Date().toISOString()
      };
    } finally {
      installRunning = null;
    }
  })();

  return { started: true };
}

/** What the wizard shows: Docker availability, the running engine, progress. */
export async function engineStatus() {
  const cfg = settingsForEngine();
  const status = {
    docker: { available: dockerAvailable(), socket: dockerEndpointLabel(), error: null },
    versions: ENGINE_VERSIONS,
    installed: null,
    install: installState,
    settings: {
      ami_host: getSetting('ami_host', ''),
      ami_port: getSetting('ami_port', '5038'),
      ami_user: getSetting('ami_user', ''),
      ast_config_dir: getSetting('ast_config_dir', '/etc/asterisk'),
      engine_version: getSetting('pbx_engine_version', '')
    }
  };
  if (!status.docker.available) {
    status.docker.error = `No Docker endpoint at ${dockerEndpointLabel()}: the wizard can print the install command, but not run it.`;
    return status;
  }
  try {
    const container = await findContainer();
    if (container) {
      // The label names the line the console installed. A container started by
      // hand has none, so fall back to its image tag and then to the version
      // recorded at install time — an operator who installed 23 before the
      // picker narrowed to 20/22/24 still sees 23, not a bare "Asterisk".
      const labelled = container.Labels?.[ENGINE_LABEL]
        || container.Labels?.['com.asterisk-console.version']
        || '';
      status.installed = {
        id: container.Id.slice(0, 12),
        version: labelled || versionFromImage(container.Image) || status.settings.engine_version,
        image: container.Image,
        running: container.State === 'running',
        status: container.Status || container.State || '',
        startedAt: container.Created ? new Date(container.Created * 1000).toISOString() : null
      };
    }
  } catch (err) {
    status.docker.error = err.message;
  }
  return status;
}

/**
 * Write the AMI account and base configuration now, so a command printed for
 * the host starts an Asterisk the console can already sign in to.
 */
export function prepareEngineConfig() {
  return ensureManagerSecret(settingsForEngine());
}

/** The `docker run` an operator can paste when the console has no socket. */
export function engineCommand(version) {
  const chosen = engineVersion(version) || ENGINE_VERSIONS[0];
  const cfg = settingsForEngine();
  return [
    '# PBX_DIR is the host path of this console\'s data directory (…/pbx). It holds',
    '# the AMI account and the configuration the console writes, so keep it mounted.',
    'PBX_DIR=/data/pbx',
    'mkdir -p "$PBX_DIR"/lib "$PBX_DIR"/spool "$PBX_DIR"/log',
    `docker run -d --name ${ENGINE_CONTAINER} --restart unless-stopped \\`,
    `  -e PUID=1000 -e PGID=1000 \\`,
    `  -v "$PBX_DIR":/etc/asterisk \\`,
    `  -v "$PBX_DIR"/lib:/var/lib/asterisk \\`,
    `  -v "$PBX_DIR"/spool:/var/spool/asterisk \\`,
    `  -v "$PBX_DIR"/log:/var/log/asterisk \\`,
    `  -p ${cfg.sipPort}:${cfg.sipPort}/udp -p ${cfg.rtpStart}-${cfg.rtpEnd}:${cfg.rtpStart}-${cfg.rtpEnd}/udp \\`,
    `  -p 5038:5038 \\`,
    `  ${chosen.image}`
  ].join('\n');
}

/**
 * How to compile the release this line is on, for a host whose rolling registry
 * image still ships an older one. The image it produces is the one the
 * installer picks up on the next attempt.
 */
export function engineBuildCommand(version) {
  const chosen = engineVersion(version) || ENGINE_VERSIONS[0];
  return [
    `# Asterisk ${chosen.release}, compiled from the official release tarball.`,
    '# Takes a while (configure plus a full build); run it on the Docker host.',
    'git clone --depth 1 https://github.com/innotelinc/asterisk-console.git /tmp/asterisk-console',
    `docker build -t ${engineSourceImage(chosen)} \\`,
    `  --build-arg ASTERISK_VERSION=${chosen.release} \\`,
    '  /tmp/asterisk-console/asterisk',
    '',
    '# Then install again from this wizard: it uses the image it finds locally.'
  ].join('\n');
}

/** The same install as a compose service, for a host that runs compose. */
export function engineCompose(version) {
  const chosen = engineVersion(version) || ENGINE_VERSIONS[0];
  const cfg = settingsForEngine();
  return [
    '# Asterisk installed by Asterisk Console — pick the version you want, then:',
    '#   PBX_DIR=<host path of this console\'s pbx directory> docker compose -f asterisk-compose.yml up -d',
    'services:',
    '  asterisk:',
    `    image: ${chosen.image}`,
    `    container_name: ${ENGINE_CONTAINER}`,
    '    restart: unless-stopped',
    '    environment:',
    '      PUID: 1000',
    '      PGID: 1000',
    '    ports:',
    `      - "${cfg.sipPort}:${cfg.sipPort}/udp"`,
    `      - "${cfg.rtpStart}-${cfg.rtpEnd}:${cfg.rtpStart}-${cfg.rtpEnd}/udp"`,
    '      - "5038:5038"',
    '    volumes:',
    `      - \${PBX_DIR:-/data/pbx}:/etc/asterisk`,
    `      - \${PBX_DIR:-/data/pbx}/lib:/var/lib/asterisk`,
    `      - \${PBX_DIR:-/data/pbx}/spool:/var/spool/asterisk`,
    `      - \${PBX_DIR:-/data/pbx}/log:/var/log/asterisk`,
    ''
  ].join('\n');
}

/** Make sure the AMI account in manager.conf matches what the console stores. */
export function syncEngineAmiAccount() {
  const cfg = settingsForEngine();
  const files = ensureManagerSecret(cfg);
  setSetting('ami_user', cfg.amiUser);
  if (!getSetting('ami_secret', '')) setSetting('ami_secret', cfg.amiSecret);
  return files;
}
