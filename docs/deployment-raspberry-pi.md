# Running FeedKeeper on a Raspberry Pi

FeedKeeper is one Node process and one SQLite file, which suits a Raspberry Pi. The prebuilt Docker image exists for `arm64`, so you need a **64-bit** Raspberry Pi OS. This guide uses Docker; without it, see [Running FeedKeeper with Node.js](deployment-npm.md).

## 1. Prepare the Pi

1. Write **Raspberry Pi OS Lite (64-bit)** to the card or drive with Raspberry Pi Imager. In the Imager's settings, set a hostname and enable SSH.
2. Log in and check the architecture:

   ```bash
   uname -m
   # aarch64  -> fine
   # armv7l   -> this is a 32-bit system: install the 64-bit OS instead
   ```

## 2. Install Docker

Follow Docker's instructions for Debian: <https://docs.docker.com/engine/install/debian/>. Afterwards, allow your user to run Docker without `sudo`, then log out and back in:

```bash
sudo usermod -aG docker "$USER"
```

## 3. Start FeedKeeper

```bash
mkdir feedkeeper && cd feedkeeper
curl -fsSLO https://raw.githubusercontent.com/visualfusion/feedkeeper/main/compose.yaml
echo "SESSION_SECRET=$(openssl rand -hex 32)" > .env
echo "PUBLIC_URL=http://raspberrypi.local:3000" >> .env
docker compose up -d
```

Replace `raspberrypi.local` with your hostname, or with the address of the Pi in your network. Open that address in a browser and create the first account.

## 4. HTTPS and a domain

For access from outside your home network, put a reverse proxy with HTTPS in front. The full [reverse proxy guide](reverse-proxy.md) covers Caddy, nginx, Traefik/Docker Compose, forwarded client IPs, and MCP client configuration. The small Caddy setup below is a minimal single-proxy option.

With [Caddy](https://caddyserver.com), the whole configuration is:

```text
feeds.example.org {
    reverse_proxy localhost:3000
}
```

Then change `.env` to

```text
PUBLIC_URL=https://feeds.example.org
TRUST_PROXY=true
```

and run `docker compose up -d` again. Keep `ALLOW_SIGNUP=false` on an instance that can be reached from the internet. When the same-host proxy is in place, also change the port mapping in `compose.yaml` from `3000:3000` to `127.0.0.1:3000:3000` and recreate the container. That prevents clients on the LAN/WAN from bypassing HTTPS through port 3000.

## 5. Storage and backups

SQLite writes often. A good USB SSD, or at least a card meant for continuous writing, lasts much longer than a cheap one. Keep the data off the card if you can:

```yaml
# in compose.yaml, instead of the named volume
    volumes:
      - /mnt/ssd/feedkeeper:/app/data
```

Create the folder first. The container runs as the user with ID 1000, so that user needs to be able to write to it: `sudo chown 1000:1000 /mnt/ssd/feedkeeper`.

Back up regularly and copy the backup **off the Pi**, together with the value of `SESSION_SECRET` from your `.env`: it also protects the two-factor keys in the database (see [Account security](account-security.md)):

```bash
docker compose exec feedkeeper node server/dist/feedkeeper.js backup /app/data/feedkeeper-backup.sqlite
docker compose cp feedkeeper:/app/data/feedkeeper-backup.sqlite ./feedkeeper-backup.sqlite
```

Restoring is described in [Back up and restore](../README.md#back-up-and-restore).

## 6. Update

```bash
docker compose pull
docker compose up -d
```
