# grok-bot-dots

Offline experimental Grok Bot / dot bridge model for developers exploring signed callback and inbox contracts. It is not a supported Grok Bot or dot integration and is not production-ready.

## Quick start

Requires Node.js 22 or later. There are no third-party package dependencies and no installation step.

```sh
node --test test/*.test.js
node scripts/mock-demo.js
```

The demo performs an in-process signed callback round trip using an ephemeral key. Its result includes `mock-routine-ok`, `grok_bot_contacted: false`, and an unconfigured dot ingress. It does not contact a live service. Package publishing remains disabled with `private: true`.

## Overview: what this prototype does

- Generates correlation IDs and keeps request hashes and lengths rather than instruction text in pending records.
- Models HMAC-SHA256 signed callbacks, timestamp tolerance, strict schemas, duplicate/conflicting event detection, bounded inbox/pending capacity, and hop limits.
- Exposes in-process `bridge_status`, `list_inbox`, and `read_inbox_event` tool handlers.
- Uses mock mode by default and refuses placeholder credentials and unsupported schemes.
- Applies destination/address validation and local deadlines to the experimental configured path.

## Trust boundary and limitations

There is no HTTP listener, stdio MCP server, built-in network client, live Grok Bot routine adapter, or dot wake integration. The callback envelope is a local experimental contract, not a verified Grok Bot callback specification. Real-service end-to-end integration has not been tested.

Injected `lookup`, `transport`, clock, and other callbacks are trusted executable code. They are not sandboxed. The `offline_mock: true`, `redirect: "error"`, `resolved_ips`, and `tls_servername` fields are advisory inputs to an injected callback. They do not enforce offline operation or prevent a callback from performing arbitrary networking.

DNS pinning, socket address binding, enforced TLS server-name validation, prevention of re-resolution, and network-level redirect enforcement are unimplemented. Address checking is not an end-to-end SSRF guarantee. Injection of a malicious or networked lookup can perform network activity even when no transport is invoked; network/contact flags may therefore not reflect lookup activity. After transport invocation, contact flags are `unknown`. Abort/deadline handling rejects late results but cannot guarantee cancellation of external side effects.

Inbox events and logs are in memory. This is not a durable queue, multi-user service, authorization boundary for hostile in-process callers, or delivery guarantee. Never use real credentials or personal data in the demonstration or tests.

## Configuration and layout

`config.example.json` contains intentionally unusable placeholders. Keep mock mode and `configured: false` for offline exploration. Do not place secrets in tracked files.

- `src/`: in-process bridge, callback verification, inbox, validation and tool handlers
- `test/`: offline unit and regression tests using synthetic data
- `scripts/mock-demo.js`: offline demonstration
- `SECURITY.md`: security boundaries and reporting
- `CONTRIBUTING.md`: development and review requirements
- `PREFLIGHT.md`: publication review record and remaining gates

## Validation status

The supplied repaired source passed 36 offline tests and the mock demo in independent review. Six additional independent regression probes were reported as passing; these probes are separate from the 36-test suite. These results do not establish live interoperability or production security. See `PREFLIGHT.md` for the publication candidate checks and their limits.

## Optional manual CI

`.github/workflows/offline-checks.yml` defines a manual-only `workflow_dispatch` check using Node.js 22, the offline tests, and the mock demo. It has no push, pull-request, scheduled, or workflow-completion trigger. Actions are pinned to reviewed official commit references, with read-only repository permissions and checkout credential persistence disabled. No project secrets, package install, upload, deployment, or live bridge calls are configured.

The workflow has not been run on GitHub: CI runtime is UNTESTED. Local validation passed all 36 tests and the mock demo; that does not establish a remote CI pass. A future manual run uses GitHub runner resources and may fetch checkout/runtime dependencies; it requires a separate maintainer decision and available quota. Do not trigger it merely by publishing this source.

## License

MIT; see `LICENSE`.
