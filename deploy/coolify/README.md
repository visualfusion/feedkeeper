# FeedKeeper on Coolify

This directory contains the Coolify service template for deploying FeedKeeper.

## Deploying directly in your Coolify instance

1. In your Coolify dashboard, navigate to your project and environment.
2. Click **+ New** > **Resource** > **Docker Compose**.
3. Paste the contents of [`docker-compose.yml`](docker-compose.yml).
4. Coolify will automatically:
   - Route traffic through Traefik and configure SSL/TLS certificates.
   - Inject the public URL via `SERVICE_FQDN_FEEDKEEPER_3000`.
   - Generate a random 64-character session secret via `SERVICE_PASSWORD_64_FEEDKEEPER`.
   - Persist your database and cache in the `feedkeeper_data` volume.
5. Click **Deploy**.
6. Open your instance URL in the browser and create your first administrator account.

> [!TIP]
> After setting up your administrator account, you can set `ALLOW_SIGNUP=false` in the Coolify environment variables if you want to keep the instance private.

## Upstream Template Contribution (Coolify Service Catalog)

To submit FeedKeeper to the official Coolify One-Click Service Catalog:

1. Fork the [coollabsio/coolify](https://github.com/coollabsio/coolify) repository.
2. Copy `docker-compose.yml` to `templates/compose/feedkeeper.yaml`.
3. Copy `feedkeeper.svg` to `templates/compose/svgs/feedkeeper.svg`.
4. Open a Pull Request on GitHub.
