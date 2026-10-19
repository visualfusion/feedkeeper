# FeedKeeper on Unraid, CasaOS and Portainer

Ready-made templates for common home-lab interfaces live in [`deploy/`](../deploy). They use the same image as the [Docker Compose quick start](../README.md#quick-start), `ghcr.io/visualfusion/feedkeeper`, for `amd64` and `arm64`.

They need **FeedKeeper 0.23.0 or newer**. From that version on, the image creates its own session secret on the first start when none is given, so a template does not have to ask you for one. The secret lives in the data volume as `session-secret`; keep it with your backups, because it also protects the two-factor keys (see [Account security](account-security.md)).

These are templates you add yourself; FeedKeeper is not listed in the official app stores of these platforms.

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
