# Telno on 192.168.1.53

The deployment of `innotelinc/telno` branch **`archive/local-main-2026-10-29`**
(pinned at `368a013`) on the `i3` host — the version chosen for review and
integration, not `main`. Review notes and the smoke-suite results are in the
Cantus cutover plan (§8).

Two files do the work: `docker-compose.53.yml` and `.env` (from `env.example`).
The image builds Asterisk 22 from source, so the first build is the slow part.

## What runs, and on which port

Host networking, so these are the process's own listeners on .53 — they cannot
be remapped, and only one process on the host may own each one.

| Port | Protocol | What | Who may reach it |
| --- | --- | --- | --- |
| 8080 | tcp | console, API, public directory | reverse proxy only (TLS in front) |
| 8089 | tcp | browser softphone SIP over WSS | LAN; relayed same-origin by default |
| 5038 | tcp | AMI (Asterisk manager) | **restrict to 127.0.0.1 / the proxy** |
| 5060 | udp | SIP for handsets and the trunk | LAN + the carrier's IP range |
| 10000-10100 | udp | RTP media | LAN + the carrier's IP range |

AMI is the one to firewall: on host networking it listens on every interface,
and it is the interface that can command the switch.

## Before the first start

- Docker Engine + Compose v2 on .53; about 5 GB of disk for the build (Asterisk
  is compiled, not pulled) and 43 GB free is what the host has.
- The checkout at `/opt/telno`, on the pinned branch:

  ```bash
  git clone --branch archive/local-main-2026-10-29 https://github.com/innotelinc/telno.git /opt/telno
  cd /opt/telno && git checkout 368a013
  ```

- The two deployment files beside each other, outside the checkout so a
  `git pull` never touches them:

  ```bash
  mkdir -p /opt/telno-deploy && cd /opt/telno-deploy
  cp <this repo>/deploy/telno/docker-compose.53.yml .
  cp <this repo>/deploy/telno/env.example .env
  $EDITOR .env
  ```

- Nothing else on .53 may hold 5060/udp, 5038/tcp, 8089 or 10000-10100/udp.
  In particular do **not** install the Asterisk Console's engine on .53 while
  Telno runs there: two switches cannot share 5060 or AMI.

## Phase 1 — build and run beside the old app

The old `telno-terminals` container keeps 8080, so the new platform starts on
8081 with its own hostname. In `.env`: `TELNO_PORT=8081`,
`PUBLIC_URL=https://telno-new.innotel.site`.

```bash
cd /opt/telno-deploy
docker compose -f docker-compose.53.yml build        # 30-60 min, compiles Asterisk
docker compose -f docker-compose.53.yml up -d
curl -fsS http://127.0.0.1:8081/api/healthz
```

Point `telno-new.innotel.site` at `http://192.168.1.53:8081` in the proxy, then
sign in and take the generated owner password off the volume:

```bash
docker compose -f docker-compose.53.yml exec telno cat /data/first-run-password.txt
```

The password is written there and never to the log; setting your own password
on first sign-in deletes the file.

Check, in this order: sign-in; an extension registers as
`sip:<extension>@192.168.1.53`; a browser softphone call has audio both ways; a
desk phone fetches its config by MAC and registers; a fax in and out with
`FAX_T38=false`; a call record appears.

## Phase 2 — cutover

```bash
docker ps --format '{{.Names}}\t{{.Image}}' | grep -i telno   # find the old container
docker stop <old-telno-terminals-container>                    # stopped, never removed

cd /opt/telno-deploy
# .env: TELNO_PORT=8080, PUBLIC_URL=https://telno.innotel.site
docker compose -f docker-compose.53.yml up -d
curl -fsS http://127.0.0.1:8080/api/healthz
```

Then point `telno.innotel.site` at `http://192.168.1.53:8080` in place of the
old app, and keep the old container stopped for a week.

## Rollback

Any time before the volumes are deleted:

```bash
cd /opt/telno-deploy
docker compose -f docker-compose.53.yml down      # container gone, volumes kept
docker start <old-telno-terminals-container>      # old app back on its own port
```

Then point the proxy back at the old app. `down -v` would delete the database,
recordings, spool and generated secrets — never use it during a rollback.

The `telno-data`, `telno-asterisk` and `telno-spool` volumes hold everything
that matters: keep them for 30 days after a rollback, and keep one backup
(`/data/backups`, daily, seven kept) off the host.

## Known edges

- **uid 999.** The image runs unprivileged. A volume written by an older,
  root-running image needs one `chown`; the entrypoint prints the exact
  command instead of failing obscurely.
- **TLS.** Session cookies are secure, so a production boot refuses an `http`
  public URL on a real hostname. Terminate TLS in the proxy; do not set
  `ALLOW_INSECURE_PUBLIC_URL` to work around it.
- **Cantus** stays off (`CANTUS_ENABLED=false`) until a gateway exists on the
  LAN. Turning it on without `CANTUS_SIP_EDGE` leaves SIP-only handsets with
  nowhere to register.
- **Fax** is a call on the switch. T.38 stays off for VoIP.ms, which answers
  the renegotiation with 488.
- **First build is long and online.** It downloads the Asterisk tarball and
  compiles it; a blocked or rate-limited registry is handled with the
  `NODE_IMAGE` / `SWITCH_IMAGE` build args, and `ASTERISK_VERSION` pins the
  tarball.
