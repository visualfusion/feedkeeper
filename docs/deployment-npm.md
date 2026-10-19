# Running FeedKeeper with Node.js

FeedKeeper is published on npm as `feedkeeper`. This is the shortest way to run it without Docker and without cloning the repository. For a server that stays up, [Docker Compose](../README.md#quick-start) or the [Uberspace guide](deployment-uberspace.md) is the better fit.

## Requirements

- Node.js 22.22.2 or newer in the 22.x line, 24.15 or newer in the 24.x line, or 26 and later.
- A platform for which the database module `better-sqlite3` ships a prebuilt binary. Otherwise npm compiles it, which needs Python and a C++ toolchain.

## Try it

```bash
npx feedkeeper
```

Open <http://localhost:3000> and create the first account in the browser. Press Ctrl+C to stop.

Everything lives in one folder, `~/.feedkeeper` by default: the SQLite database, the archive of saved articles, the image cache and a session secret that is generated on the first start (readable only by you). Keep that folder with your backups. The secret also protects the two-factor keys in the database: if it is lost, people who use an authenticator app have to sign in with a recovery code and set it up again (see [Account security](account-security.md)).

## Options

```text
feedkeeper [--port <number>] [--public-url <url>] [--data-dir <folder>]
feedkeeper backup <file>
feedkeeper restore <file> --force
feedkeeper --version | --help
```

| Option | Meaning |
|---|---|
| `--port` | Port to listen on. Default 3000, or `PORT`. |
| `--public-url` | The address people open FeedKeeper at. Defaults to `http://localhost:<port>`. Set it for a real domain, together with `TRUST_PROXY=true` behind a reverse proxy. |
| `--data-dir` | Where the database, archive and session secret are kept. Defaults to the folder of `DATABASE_PATH`, otherwise `~/.feedkeeper`. |

All other settings are the environment variables of [`.env.example`](../.env.example). A `.env` file in the folder you start from is read; real environment variables win over it, and the options above win over both.

## Keep it running

Install it once and let your service manager start it. With systemd, a unit such as this is a starting point:

```ini
# /etc/systemd/system/feedkeeper.service
[Unit]
Description=FeedKeeper
After=network-online.target
Wants=network-online.target

[Service]
DynamicUser=yes
StateDirectory=feedkeeper
Environment=PUBLIC_URL=https://feeds.example.org
Environment=TRUST_PROXY=true
ExecStart=/usr/bin/env feedkeeper --data-dir /var/lib/feedkeeper
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```bash
sudo npm install --global feedkeeper
sudo systemctl enable --now feedkeeper
```

Put a reverse proxy with HTTPS in front of it for anything reachable from the internet.

## Update

```bash
sudo npm install --global feedkeeper@latest
sudo systemctl restart feedkeeper
```

The changelog lists releases that need a configuration change. Database migrations run on start.

## Back up and restore

```bash
feedkeeper backup ~/feedkeeper-backup.sqlite
# stop FeedKeeper first:
feedkeeper restore ~/feedkeeper-backup.sqlite --force
```

Backup and restore use the same data folder as the server; pass `--data-dir` if you started it with one. See [Back up and restore](../README.md#back-up-and-restore) for what a backup contains.
