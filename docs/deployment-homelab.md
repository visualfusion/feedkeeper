# FeedKeeper on Coolify, Unraid, CasaOS and Portainer

Ready-made templates for common self-hosting and home-lab platforms live in [`deploy/`](../deploy). They use the same image as the [Docker Compose quick start](../README.md#quick-start), `ghcr.io/visualfusion/feedkeeper`, for `amd64` and `arm64`.

They need **FeedKeeper 0.23.0 or newer**. From that version on, the image creates its own session secret on the first start when none is given, so a template does not have to ask you for one. The secret lives in the data volume as `session-secret`; keep it with your backups, because it also protects the two-factor keys (see [Account security](account-security.md)).

## Coolify

1. In your Coolify project, click **+ New** > **Resource** > **Docker Compose**.
2. Paste the contents of [`deploy/coolify/docker-compose.yml`](../deploy/coolify/docker-compose.yml).
3. Assign a custom domain (or use the generated `sslip.io` domain).
4. Click **Deploy**.

Coolify provisions the Traefik reverse proxy, generates a 64-character session secret (`SERVICE_PASSWORD_64_FEEDKEEPER`), and binds persistent data to a named volume. Complete the setup by registering your administrator account in the web interface.

## Unraid

1. Copy [`deploy/unraid/feedkeeper.xml`](../deploy/unraid/feedkeeper.xml) to `/boot/config/plugins/dockerMan/templates-user/` on the server.
2. In the **Docker** tab choose **Add Container**, pick **FeedKeeper** from the template list and check the settings.
3. Set **Public URL** to the address you open FeedKeeper at, for example `http://192.168.1.10:3000`.

The template starts the container with `--user 99:100`, the user and group Unraid gives to appdata folders, so the data folder needs no extra permissions. The first account is created in the browser.

## CasaOS

1. Open **App Store**, then **Custom Install**, and import [`deploy/casaos/docker-compose.yml`](../deploy/casaos/docker-compose.yml) (paste its content or upload the file).
2. Set `PUBLIC_URL` to the address you open FeedKeeper at, then install.

Data is kept in a Docker volume, so it works without any folder permissions.

## Portainer

1. In **Settings**, then **App Templates**, set the URL to
   `https://raw.githubusercontent.com/visualfusion/feedkeeper/main/deploy/portainer/templates.json`.
2. Under **App Templates** choose **FeedKeeper**, enter a session secret (`openssl rand -hex 32` generates one) and the public URL, and deploy.

The template deploys the repository's [`compose.yaml`](../compose.yaml) as a stack.

## Updating and backups

Pull the new image the way your platform does it (Unraid: check for updates; CasaOS and Portainer: re-pull and recreate). Back up the data volume or folder. For a consistent database backup while FeedKeeper runs, use the command from [Back up and restore](../README.md#back-up-and-restore) in the container's console.

If something differs on your platform, please open an issue with the platform and version.
