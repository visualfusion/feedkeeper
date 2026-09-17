# Deploying to Uberspace

This guide walks through running Feedkeeper on an [Uberspace](https://uberspace.de) 7 account, but the same steps apply to any Linux host where you have a shell account and can run a long-lived Node.js process (a VPS, another shared host with SSH access, etc.).

## 1. Pick a Node.js version

Feedkeeper needs Node.js 20 or newer.

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

- `PUBLIC_URL` — the domain you'll add in step 5, e.g. `https://rss.visualfusion.de`.
- `SESSION_SECRET` — generate one with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
- `TRUST_PROXY=true` — Uberspace terminates TLS in front of your app, so Express needs to trust its `X-Forwarded-*` headers.
- `ALLOW_SIGNUP=false` — keep this unless you deliberately want open registration.

## 4. Build and create the first admin account

```bash
npm run build
npm run setup
```

`npm run setup` asks for an email, display name, and password and creates the first admin account from the terminal. If you'd rather do this from the browser, skip it — the web UI shows the same onboarding screen the first time anyone opens the app.

## 5. Point a domain at it

```bash
uberspace web domain add rss.visualfusion.de
uberspace web backend set / --http --port 3000
```

Adjust the port if you changed `PORT` in `.env`.

## 6. Keep it running with supervisord

Uberspace runs long-lived processes through `supervisord`. Create `~/etc/services.d/feedkeeper.ini`:

```ini
[program:feedkeeper]
command=npm run start
directory=%(ENV_HOME)s/feedkeeper
autostart=true
autorestart=true
environment=NODE_ENV="production"
```

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

## Notes

- The SQLite database lives at the path set by `DATABASE_PATH` (`./data/feedkeeper.sqlite` by default). Back it up by copying that one file — no separate database server is involved.
- Feedkeeper polls subscribed feeds on its own schedule; there's no cron job to set up.
- If `npm install` fails to build the native SQLite binding, install build tools with `uberspace tools version use gcc` or check the current Uberspace manual for the native module build guide — most environments get a prebuilt binary and never hit this.
