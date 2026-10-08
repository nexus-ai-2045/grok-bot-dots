# Contributing

Keep changes within the offline experimental scope. Use Node.js 22 or later, run `node --test test/*.test.js` and `node scripts/mock-demo.js`, and review the diff before submission. No dependency installation is needed.

Add synthetic tests for changed behavior. Never commit credentials, real messages, personal data, private endpoints, logs from real users, or local absolute paths. Do not add networking, listeners, session extraction, or live integration claims without a separate design and security review.

Document trust boundaries and limitations. A passing test or scanner is not publication approval. Changes to package metadata, licensing, external behavior, or publication scope require maintainer review. Contributions are provided under the repository's MIT license.
