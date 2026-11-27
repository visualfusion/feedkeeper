# Security Policy

## Supported Versions

Only the latest release receives security fixes. Please update to the newest version from the [releases page](https://github.com/visualfusion/feedkeeper/releases) (or the `latest` Docker image) before reporting, and mention the version you tested.

## Reporting a Vulnerability

Please **do not** open a public issue for security vulnerabilities.

Instead, use [GitHub's private vulnerability reporting](https://github.com/visualfusion/feedkeeper/security/advisories/new) for this repository, or reach out to the maintainer directly.

Include:

- A description of the vulnerability and its potential impact
- Steps to reproduce (a minimal example helps a lot)
- The affected version/commit

You should get an initial response within a few days. Once a fix is available, we'll coordinate disclosure and credit you in the fix, unless you'd prefer otherwise.

## Scope

FeedKeeper is self-hosted software. Most reports concern the codebase itself and apply to every self-hosted installation.

Areas of particular interest:

- Authentication and session handling (`server/src/auth/`)
- The SSRF guard on feed fetching (`server/src/feeds/ssrfGuard.ts`)
- Per-user data isolation in the API and MCP tool handlers
- Personal access token generation and storage
