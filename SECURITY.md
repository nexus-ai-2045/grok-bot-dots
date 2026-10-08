# Security

This is an offline experimental prototype with no supported production deployment or live integration. Only the current source snapshot is considered for review; no support or response-time commitment is made.

Treat injected callbacks as fully trusted executable code. `offline_mock` and transport request options are advisory. DNS pinning and enforced network redirect/TLS controls are not implemented. Injected lookup activity may not be reflected in contact flags. A timeout does not guarantee cancellation of side effects.

Do not use live credentials, session extraction, personal information, or untrusted callbacks. There is no HTTP listener, stdio MCP service, or dot wake capability. In-process access is not isolated from the host application.

For a vulnerability, use the repository's private vulnerability reporting feature if it is available. If it is unavailable, open only a minimal issue requesting a private reporting channel; do not include secrets, personal information, or exploitable details publicly. No private channel is claimed to exist before repository setup.
