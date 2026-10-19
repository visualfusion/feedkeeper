# Reverse proxy setups

FeedKeeper serves the web app, REST API and the Streamable HTTP MCP endpoint from one HTTP server on port `3000`. A reverse proxy terminates HTTPS and forwards requests to that server. Set `PUBLIC_URL` and `TRUST_PROXY` to match the public origin and actual proxy chain. FeedKeeper's `/mcp` endpoint is stateless and accepts POST requests only (`GET /mcp` returns `405`), so special response-buffering settings are not normally required; optional examples below show how to disable buffering explicitly.

This guide gives a same-host Caddy and nginx setup, plus a Traefik/Docker Compose stack. The examples assume a dedicated hostname such as `feeds.example.org`; substitute your own hostname in every file.

## Before you begin

1. Create a DNS `A` record for the hostname pointing to your server. Add an `AAAA` record only if the server is reachable over IPv6 too.
2. Allow inbound TCP ports `80` and `443` in the host firewall/router. Caddy and the Traefik example use these ports to obtain and renew certificates automatically. nginx uses Certbot in the steps below.
3. Keep `ALLOW_SIGNUP=false` for a publicly reachable instance. Create user accounts from the administrator account instead.
4. Generate a long session secret and store it in your `.env` file:

   ```bash
   openssl rand -hex 32
   ```

   Use the generated value as `SESSION_SECRET`. Do not paste the example placeholder into a real deployment or commit the secret.

### Required FeedKeeper settings

For Caddy or nginx running on the **same host** as the FeedKeeper container, download the normal `compose.yaml` and change its port mapping from `3000:3000` to `127.0.0.1:3000:3000`. This keeps the app port off the LAN/WAN while allowing the local proxy to connect.

Set these values in `.env`, using your real hostname:

```dotenv
PUBLIC_URL=https://feeds.example.org
TRUST_PROXY=true
ALLOW_SIGNUP=false
SESSION_SECRET=<the 64-character value generated above>
```

`PUBLIC_URL` is the exact public origin, including `https://` and without a path or trailing slash. FeedKeeper uses it for CORS and secure session cookies. When it starts with `https://`, FeedKeeper also enables HSTS response headers, so browsers that receive the header will prefer HTTPS for that host. Restart the container after changing it:

```bash
docker compose up -d
curl -fsS http://127.0.0.1:3000/api/health
```

The health check should return `{"status":"ok"}`. Do not publish port 3000 on a public interface when the reverse proxy is meant to be the only entry point.

## Option A: Caddy

Caddy obtains and renews HTTPS certificates automatically when the hostname resolves to this server and ports 80/443 are reachable. Install Caddy using the [official instructions](https://caddyserver.com/docs/install), then put this in `/etc/caddy/Caddyfile`:

```caddyfile
feeds.example.org {
    @mcp path /mcp /mcp/*
    handle @mcp {
        reverse_proxy 127.0.0.1:3000 {
            flush_interval -1
        }
    }
    handle {
        reverse_proxy 127.0.0.1:3000
    }
}
```

The path is preserved: MCP clients connect to `https://feeds.example.org/mcp`, not to the origin's port. The `flush_interval -1` setting is optional: FeedKeeper's current MCP endpoint uses stateless POST requests, so it is not required for a long-lived event stream. Keep it only if testing your own proxy/client setup gives you a reason to force immediate flushes.

Validate and reload:

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
curl -fsS https://feeds.example.org/api/health
```

## Option B: nginx

The example below assumes nginx and Certbot are installed. On Debian/Ubuntu-style nginx layouts, create `/etc/nginx/sites-available/feeds` with this temporary HTTP-only server before requesting the certificate:

```nginx
server {
    listen 80;
    server_name feeds.example.org;
    location / { return 404; }
}
```

Enable the temporary site, validate it, and let Certbot add the TLS certificate:

```bash
sudo ln -s /etc/nginx/sites-available/feeds /etc/nginx/sites-enabled/feeds
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d feeds.example.org
```

After Certbot has issued the certificate, replace the temporary site with the final configuration below. Keep only one HTTP server block for this hostname; the final block performs the HTTPS redirect. On other distributions, put the equivalent temporary block in the active nginx configuration rather than using `sites-available`/`sites-enabled`. The certificate paths shown are the standard Let's Encrypt paths.

```nginx
server {
    listen 80;
    server_name feeds.example.org;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    http2 on;
    server_name feeds.example.org;
    client_max_body_size 5m;

    ssl_certificate /etc/letsencrypt/live/feeds.example.org/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/feeds.example.org/privkey.pem;

    location ^~ /mcp {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection "";

        proxy_buffering off;
        proxy_cache off;
    }

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

`client_max_body_size 5m` lets nginx accept OPML XML imports up to FeedKeeper's 5 MB request-body limit instead of nginx's smaller default. `proxy_buffering off` and `proxy_cache off` are optional for the current stateless POST-only MCP endpoint; they are included as explicit proxy settings, not because FeedKeeper requires a long-lived stream. The example keeps nginx's default upstream read timeout; raise it only if your deployment has a tested need for a longer idle interval.

Validate and reload after editing the enabled site:

```bash
sudo nginx -t
sudo systemctl reload nginx
curl -fsS https://feeds.example.org/api/health
```

The `http2 on` form is supported by current nginx releases and avoids the older `listen ... http2` syntax.

## Option C: Traefik with Docker Compose

This is a self-contained example. FeedKeeper is reachable only on a private Docker network; only Traefik publishes ports 80 and 443. The example pins Traefik to `v3.7.14`. Create a directory with these two files, plus a `letsencrypt` directory:

```bash
mkdir -p feedkeeper-proxy/letsencrypt
cd feedkeeper-proxy
touch letsencrypt/acme.json
chmod 600 letsencrypt/acme.json
```

Create `.env`:

```dotenv
DOMAIN=feeds.example.org
PUBLIC_URL=https://feeds.example.org
ACME_EMAIL=you@example.org
SESSION_SECRET=<the 64-character value generated by openssl rand -hex 32>
ALLOW_SIGNUP=false
```

Save this as `compose.yaml`. There is intentionally no `ports` entry for FeedKeeper, so clients cannot bypass the TLS proxy through a published app port.

```yaml
services:
  traefik:
    image: traefik:v3.7.14
    restart: unless-stopped
    command:
      - --providers.docker=true
      - --providers.docker.exposedbydefault=false
      - --providers.docker.network=feedkeeper-proxy
      - --entrypoints.web.address=:80
      - --entrypoints.websecure.address=:443
      - --certificatesresolvers.le.acme.email=${ACME_EMAIL:?Set ACME_EMAIL in .env}
      - --certificatesresolvers.le.acme.storage=/letsencrypt/acme.json
      - --certificatesresolvers.le.acme.httpchallenge=true
      - --certificatesresolvers.le.acme.httpchallenge.entrypoint=web
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - ./letsencrypt:/letsencrypt
    networks:
      - proxy

  feedkeeper:
    image: ghcr.io/visualfusion/feedkeeper:latest
    restart: unless-stopped
    stop_grace_period: 45s
    environment:
      PORT: "3000"
      PUBLIC_URL: ${PUBLIC_URL:?Set PUBLIC_URL in .env}
      DATABASE_PATH: /app/data/feedkeeper.sqlite
      SESSION_SECRET: ${SESSION_SECRET:?Set SESSION_SECRET in .env}
      ALLOW_SIGNUP: ${ALLOW_SIGNUP:-false}
      TRUST_PROXY: "true"
    volumes:
      - feedkeeper_data:/app/data
    networks:
      - proxy
    labels:
      - "traefik.enable=true"
      - "traefik.docker.network=feedkeeper-proxy"
      - "traefik.http.routers.feedkeeper.rule=Host(`${DOMAIN:?Set DOMAIN in .env}`)"
      - "traefik.http.routers.feedkeeper.entrypoints=websecure"
      - "traefik.http.routers.feedkeeper.tls=true"
      - "traefik.http.routers.feedkeeper.tls.certresolver=le"
      - "traefik.http.routers.feedkeeper.service=feedkeeper"
      - "traefik.http.services.feedkeeper.loadbalancer.server.port=3000"
      - "traefik.http.routers.feedkeeper-http.rule=Host(`${DOMAIN:?Set DOMAIN in .env}`)"
      - "traefik.http.routers.feedkeeper-http.entrypoints=web"
      - "traefik.http.routers.feedkeeper-http.middlewares=feedkeeper-https-redirect"
      - "traefik.http.routers.feedkeeper-http.service=feedkeeper"
      - "traefik.http.middlewares.feedkeeper-https-redirect.redirectscheme.scheme=https"

networks:
  proxy:
    name: feedkeeper-proxy

volumes:
  feedkeeper_data:
```

Start the stack after DNS points to the server and ports 80/443 are open:

```bash
docker compose config
docker compose up -d
docker compose logs -f traefik feedkeeper
curl -fsS https://feeds.example.org/api/health
```

The example does not add a buffering middleware because FeedKeeper's current `/mcp` endpoint is stateless and POST-only; no special streaming middleware is required. The Traefik configuration mounts the Docker socket read-only so the Docker provider can discover containers, but a read-only mount does not make access to the Docker API harmless. For stricter host isolation, consider a restricted Docker socket proxy or another provider that does not need direct socket access.

## TRUST_PROXY and CLIENT_IP_HEADER

`TRUST_PROXY` controls which forwarded client-address headers FeedKeeper trusts. It affects rate limits and the client address used by the server.

- With exactly one reverse proxy directly in front of FeedKeeper (the three basic examples above), set `TRUST_PROXY=true`. This means one trusted hop, not an arbitrary number of proxies.
- If requests pass through several proxies, such as Cloudflare and then nginx/Traefik, do not rely on a hop count or trust every address. Set `TRUST_PROXY` to a comma-separated allowlist of the actual proxy IP addresses/CIDR ranges (including the reverse proxy's address as seen by FeedKeeper and the CDN ranges that appear in the forwarded chain). Keep the origin firewall restricted so the proxy chain cannot be bypassed.
- Leave `CLIENT_IP_HEADER` unset when the last proxy preserves the `X-Forwarded-For` chain. It is only needed when a proxy in front of FeedKeeper replaces `X-Forwarded-For` with its own CDN-edge address, as happens with some hosting proxies. In that case, set `CLIENT_IP_HEADER` to a trusted header such as `CF-Connecting-IP` and use the explicit address/CIDR form of `TRUST_PROXY`; FeedKeeper ignores this header with `TRUST_PROXY=true` or a numeric hop count. Use the CDN provider's current published IP ranges, not a copied list from an old blog post.

For Cloudflare in front of same-host nginx, the shown `$proxy_add_x_forwarded_for` directive preserves the existing forwarded chain. Configure the proxy allowlist without `CLIENT_IP_HEADER`:

```dotenv
TRUST_PROXY=loopback,<CLOUDFLARE_CIDR_1>,<CLOUDFLARE_CIDR_2>
```

Only if an upstream hosting proxy overwrites `X-Forwarded-For` with the Cloudflare edge IP should you also set `CLIENT_IP_HEADER=CF-Connecting-IP`. Replace the placeholders with the current Cloudflare IPv4/IPv6 ranges needed for your network. Keep the origin reachable only through Cloudflare and the trusted reverse proxy. See [Cloudflare's header documentation](https://developers.cloudflare.com/fundamentals/reference/http-headers/) and [Cloudflare IP ranges](https://www.cloudflare.com/ips/).

## Verify MCP connectivity

Configure your MCP client with OAuth or a FeedKeeper token that has MCP capability, connect to `https://feeds.example.org/mcp`, complete initialization, and run `tools/list`. The `/api/health` endpoint checks HTTP health only; it does not verify MCP authentication or request handling.

References: [Caddy reverse_proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy), [nginx proxy module](https://nginx.org/en/docs/http/ngx_http_proxy_module.html), [Traefik Docker provider](https://doc.traefik.io/traefik/reference/routing-configuration/other-providers/docker/), and [Traefik buffering middleware](https://doc.traefik.io/traefik/reference/routing-configuration/http/middlewares/buffering/).
