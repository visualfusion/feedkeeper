# Deploying to Uberspace

This guide walks through running Feedkeeper on an [Uberspace](https://uberspace.de) 7 account, but the same steps apply to any Linux host where you have a shell account and can run a long-lived Node.js process (a VPS, another shared host with SSH access, etc.).

## 1. Pick a Node.js version

FeedKeeper needs Node.js 22.22.2+ (22.x), 24.15+ (24.x), or 26+.

```bash
uberspace tools version list node
uberspace tools version use node 22
```

## 2. Get the code

```bash
cd ~
git clone https://github.com/visualfusion/feedkeeper.git
cd feedkeeper
npm install
```

## 3. Configure

```bash
cp .env.example .env
```

Edit `.env`:

- `PUBLIC_URL` — the domain you'll add in step 5, e.g. `https://rss.example.com`.
- `SESSION_SECRET` — generate one with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
- `TRUST_PROXY=true` — Uberspace terminates TLS in front of your app, so Express needs to trust its `X-Forwarded-*` headers. If a CDN such as Cloudflare proxies the domain as well, `true` would treat the CDN's edge address as the client, and all visitors behind one edge would share rate limits. List the trusted proxies instead: Uberspace's web server connects from a unique local IPv6 address, so use `uniquelocal` followed by the CDN's published ranges, e.g. `TRUST_PROXY=uniquelocal,173.245.48.0/20,…` with every range from <https://www.cloudflare.com/ips/>. Uberspace's web server replaces `X-Forwarded-For` with the address of the Cloudflare edge, so also set `CLIENT_IP_HEADER=CF-Connecting-IP`; the app accepts that header only from the listed proxies.
- `ALLOW_SIGNUP=false` — keep this unless you deliberately want open registration.

## 4. Build and create the first admin account

```bash
npm run build
npm run setup
```

`npm run setup` asks for an email, display name, and password and creates the first admin account from the terminal. If you'd rather do this from the browser, skip it — the web UI shows the same onboarding screen the first time anyone opens the app.

## 5. Point a domain at it

```bash
uberspace web domain add rss.example.com
uberspace web backend set / --http --port 3000
```

Adjust the port if you changed `PORT` in `.env`.

## 6. Keep it running with supervisord

Uberspace runs long-lived processes through `supervisord`. Create `~/etc/services.d/feedkeeper.ini`:

```ini
[program:feedkeeper]
command=node dist/server.js
directory=%(ENV_HOME)s/feedkeeper/server
autostart=true
autorestart=true
environment=NODE_ENV="production"
stopwaitsecs=45
```

Run Node directly so supervisord waits for the actual server to finish its graceful shutdown. The working directory matches `npm run start` in the server workspace, preserving the location of relative database and archive paths. Keep at least 45 seconds shutdown grace; unfinished feed and notification work resumes on restart. See the [polling operations guide](feed-polling.md).

Then load it:

```bash
supervisorctl reread
supervisorctl update
supervisorctl status feedkeeper
```

## 7. Updating

```bash
cd ~/feedkeeper
git pull
npm install
npm run build
supervisorctl restart feedkeeper
```

## Backup and restore

### Hosts using a systemd user service

If the host uses a systemd user service instead of supervisord, replace the restart command with:

```bash
systemctl --user restart feedkeeper.service
systemctl --user is-active feedkeeper.service
journalctl --user -u feedkeeper.service --no-pager -n 30
```

Build before restarting and check `/api/health` and `/api/v1/meta` afterwards. The native meta endpoint reports the running version and feature flags. A brief 502 while the process starts can be retried; continued failures require checking the service log.

### Testing an unpublished update

An unpublished source tree can be deployed through SSH without pushing to GitHub. Keep `.env`, the live database, article archive and installed dependencies outside the uploaded file list. Build and test in a separate directory first, then transfer the source and built server files and restart the service. Preserve the previous code and a verified database/archive backup until the test is accepted. A preview version such as `0.11.0-dev.1` identifies the test through `/meta`; release notes stay under Unreleased, with no tag or GitHub release created.

For the shared-edition upgrade, migration `0023_server_editions.sql` runs at startup. See [design/editions.md](design/editions.md) for the preference-adoption sequence and compatibility changes. Transferring server files does not upload settings that still live on a native device. The app performs that initial transfer through the API.

### Creating and restoring a backup

Create a verified backup while the service is running:

```bash
cd ~/feedkeeper
npm run db:backup -- ~/feedkeeper-backup.sqlite
```

Store a copy outside the server. To restore it, stop the service first, then run:

```bash
supervisorctl stop feedkeeper
npm run db:restore -- ~/feedkeeper-backup.sqlite --force
supervisorctl start feedkeeper
```

If you use a different process manager, substitute its stop and start commands. Restore replaces the configured database.

## Notes

- The SQLite database lives at the path set by `DATABASE_PATH` (`./data/feedkeeper.sqlite` by default). Use the backup command above while the service is running; SQLite uses WAL mode, so copying only the main file may miss recent changes.
- Feedkeeper polls subscribed feeds on its own schedule; there's no cron job to set up.
- If `npm install` fails to build the native SQLite binding, install build tools with `uberspace tools version use gcc` or check the current Uberspace manual for the native module build guide — most environments get a prebuilt binary and never hit this.
