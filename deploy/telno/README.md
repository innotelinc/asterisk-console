# Telno on 192.168.1.53

The deployment of `innotelinc/telno` branch **`archive/local-main-2026-10-29`**
(pinned at `368a013`) on the `i3` host — the version chosen for review and
integration, not `main`. Review notes and smoke results are in the Cantus
cutover plan (§8).

Three files, all in this directory:

| File | Purpose |
| --- | --- |
| `env.53` | the `.env` for this host — copy it, do not edit it in the repo |
| `docker-compose.53.yml` | cutover: host networking, canonical ports |
| `docker-compose.53-preview.yml` | optional dry run beside the old app, 8081 only |

The image compiles Asterisk 22 from source with its own pjproject, so the first
build is the slow part (30–60 minutes, needs ~5 GB of disk).

## The port plan, and why 5060 decides it

The switch's ports are **generated configuration, not settings**:
`src/telephony/provision.js` writes `bind=0.0.0.0:5060` for the SIP transport,
`rtpstart=10000` / `rtpend=10100`, AMI on `5038`, ARI on `8088`, WSS on `8089`.
No environment variable moves any of them. With host networking those become the
host's own sockets, which is what lets the carrier's existing NAT forwards and
the reverse proxy keep working unchanged — and also means only **one** switch may
run on .53 at a time.

Cutover (`docker-compose.53.yml`, after the old container is stopped):

| Port | Proto | What | Notes |
| --- | --- | --- | --- |
| 8080 | tcp | console, API, public directory | reverse proxy only (TLS in front) |
| 8088 | tcp | Asterisk ARI | container-local by design; firewall it |
| 8089 | tcp | browser softphone SIP over WSS | LAN, relayed same-origin by default |
| 5038 | tcp | AMI | **firewall: 127.0.0.1 / the proxy only** |
| 5060 | udp | SIP for handsets and the trunk | LAN + the carrier |
| 10000–10100 | udp | RTP media | LAN + the carrier |

Preview (`docker-compose.53-preview.yml`, while the old app still runs):

| Port | Proto | What |
| --- | --- | --- |
| 8081 | tcp | the console only |

Everything else the switch binds stays inside that container's own network
namespace, so it cannot collide with the old `telno-terminals` container on 5060
or on the RTP range. That is the trade: the preview proves sign-in, database,
console, directory and API; handset registration, carrier calls, audio and fax
are only provable at cutover, because they need 5060 and 10000–10100.

## 1. Preflight (on .53)

- Docker Engine + Compose v2.
- These host ports free: 8080, 8081 (preview), 8088, 8089, 5038/tcp,
  5060/udp, 10000–10100/udp. Check before touching anything:

  ```bash
  ss -lntup | grep -E ':(8080|8081|8088|8089|5038)\b|:(5060|1000[0-9]|10100)\b'
  docker ps --format '{{.Names}}\t{{.Image}}\t{{.Ports}}' | grep -i telno
  ```

- NAT forwards for 5060/udp and 10000–10100/udp already point at .53 from the old
  app; leave them alone.
- The reverse proxy has a host for `telno.innotel.site` (and, for a preview,
  `telno-new.innotel.site`).

## 2. Checkout and files

```bash
git clone --branch archive/local-main-2026-10-29 https://github.com/innotelinc/telno.git /opt/telno
cd /opt/telno && git checkout 368a013

mkdir -p /opt/telno-deploy && cd /opt/telno-deploy
cp <this repo>/deploy/telno/docker-compose.53.yml .
cp <this repo>/deploy/telno/docker-compose.53-preview.yml .
cp <this repo>/deploy/telno/env.53 .env
chmod 600 .env
```

The compose files stay outside the checkout so a `git pull` never touches them.

`env.53` is already the .53 answer: `PUBLIC_URL=https://telno.innotel.site`,
`TELNO_PORT=8080`, `ASTERISK_EXTERNAL_ADDRESS=192.168.1.53`, **Cantus off**
(`CANTUS_ENABLED=false`, no host, no SIP edge — there is no gateway on this LAN
and Cantus puts fax out of scope), and **T.38 off** (`FAX_T38=false`) because
VoIP.ms answers a T.38 renegotiation with 488 and there is no mid-call fallback.
No secret is in it: session/AMI keys generate on the volume, and VoIP.ms, Stripe
and LLM keys belong in Settings → Vault.

## 3. Build (once, for both files)

```bash
cd /opt/telno-deploy
docker compose -f docker-compose.53.yml build
```

## 4. Optional: dry run beside the old app

```bash
docker compose -f docker-compose.53-preview.yml up -d
curl -fsS http://127.0.0.1:8081/api/healthz
docker compose -f docker-compose.53-preview.yml exec telno cat /data/first-run-password.txt
```

Point `telno-new.innotel.site` at `http://192.168.1.53:8081`, sign in, and walk
the console. When done:

```bash
docker compose -f docker-compose.53-preview.yml down -v
```

`-v` is safe **here only** — these are the preview volumes, not the cutover ones.

## 5. Cutover

Stop the old app without removing it, so rollback is a `docker start`:

```bash
docker ps --format '{{.Names}}\t{{.Image}}' | grep -i telno
docker stop <old-telno-terminals-container>

cd /opt/telno-deploy
docker compose -f docker-compose.53.yml up -d
docker compose -f docker-compose.53.yml ps
curl -fsS http://127.0.0.1:8080/api/healthz
```

Then point `telno.innotel.site` at `http://192.168.1.53:8080` in the proxy and
take the generated owner password:

```bash
docker compose -f docker-compose.53.yml exec telno cat /data/first-run-password.txt
```

Verify, in this order:

1. sign in, then set your own password (that deletes the generated file);
2. an extension registers as `sip:<extension>@192.168.1.53` (5060/udp);
3. a browser softphone call has audio both ways (8089 + RTP);
4. a desk phone fetches its config by MAC and registers;
5. a fax in and out with `FAX_T38=false`;
6. a call record appears in the console.

## 6. Rollback

Any time before the volumes are deleted:

```bash
cd /opt/telno-deploy
docker compose -f docker-compose.53.yml down      # container gone, volumes kept
docker start <old-telno-terminals-container>      # old app back on 8080/5060
```

Point the proxy back at the old app. **Never** `down -v` here: it deletes the
database, recordings, spool and the generated secrets.

Keep `telno-data`, `telno-asterisk` and `telno-spool` for 30 days after a
rollback, and copy one archive out of `/data/backups` (daily, seven kept) to a
machine that is not .53.

## Known edges

- **uid 999.** The image runs unprivileged. A volume written by an older,
  root-running image needs one `chown`; the entrypoint prints the exact command
  instead of failing obscurely.
- **TLS.** Session cookies are secure, so a production boot refuses an `http`
  public URL on a real hostname. Terminate TLS in the proxy; do not set
  `ALLOW_INSECURE_PUBLIC_URL`.
- **AMI is exposed** on host networking (`bindaddr = 0.0.0.0:5038`). Firewall it
  to 127.0.0.1 and the proxy — it is the interface that can command the switch.
- **Cantus** stays off until a gateway exists on the LAN. Enabling it without
  `CANTUS_SIP_EDGE` leaves SIP-only handsets with nowhere to register.
- **Fax** is a call on the switch. T.38 stays off for VoIP.ms; a fax behind an
  analog adaptor on Cantus would need its own SIP path.
- **First build is long and online.** It downloads the Asterisk tarball and
  compiles it; a blocked registry is handled with the `NODE_IMAGE` /
  `SWITCH_IMAGE` build args, and `ASTERISK_VERSION` pins the tarball.
