# Security Policy

## Supported Versions

Feedkeeper is a young project without tagged releases yet — only the latest commit on `main` is supported. Always run the current `main`.

## Reporting a Vulnerability

Please **do not** open a public issue for security vulnerabilities.

Instead, use [GitHub's private vulnerability reporting](https://github.com/visualfusion/feedkeeper/security/advisories/new) for this repository, or reach out to the maintainer directly.

Include:

- A description of the vulnerability and its potential impact
- Steps to reproduce (a minimal example helps a lot)
- The affected version/commit

You should get an initial response within a few days. Once a fix is available, we'll coordinate disclosure and credit you in the fix, unless you'd prefer otherwise.

## Scope

Feedkeeper is self-hosted software. Reports about the maintainer's own instance at `rss.visualfusion.de` (e.g. account enumeration against that specific deployment) are welcome through the same channel, but most reports will concern the codebase itself and apply to every self-hosted instance.

Areas of particular interest:

- Authentication and session handling (`server/src/auth/`)
- The SSRF guard on feed fetching (`server/src/feeds/ssrfGuard.ts`)
- Per-user data isolation in the API and MCP tool handlers
- Personal access token generation and storage
