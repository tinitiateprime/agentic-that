# AgenticThat Companion 2.1.8

- Publishes local media larger than 50 MB without relaying the file through Playwright's remote connection.
- Uses Chromium's local CDP file assignment for Instagram, Facebook, X, LinkedIn, and YouTube upload controls and native file choosers.
- Keeps the website's 2 GB upload limit while validating that the downloaded Companion media is a real local file before attachment.
- Packaged-runtime verification prevents releases from omitting the large-media upload implementation.

Validation: TypeScript, publishing regression tests, production website build, and a real remote-CDP Chromium attachment of a 64 MB local video.

All desktop targets use the same implementation: Windows x64, macOS universal (Intel and Apple silicon), Linux x64 and arm64.
