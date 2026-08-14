# Security Policy

## Supported Versions

This project is pre-1.0 (`0.x`). There is no long-term support branch yet —
security fixes land on `main` and the latest `0.x` release only.

| Version | Supported |
| ------- | --------- |
| 0.x     | ✅        |

## Reporting a Vulnerability

Please report suspected vulnerabilities privately via
[GitHub Security Advisories](../../security/advisories/new) on this
repository rather than opening a public issue. If that path is unavailable to
you, open an issue with minimal detail and ask a maintainer to follow up
through a private channel.

Include, where possible:

- A description of the issue and its impact
- Steps or a minimal reproduction
- Affected version/commit

We aim to acknowledge reports within 5 business days. This is a small,
independently maintained project without a dedicated security team, so
response times are best-effort.

## Runtime trust boundary

The current CLI only reads its installed package metadata and writes contract
or help output to stdout/stderr. It does not execute user-supplied commands,
access the network, read or write repository files, or handle credentials.
Future provider-specific observation must document any additional trust
boundary before it is introduced.
