# live-panel renderer

- Source: https://github.com/ythx-101/live-panel-skill
- Commit: 439c9addce7e7ac2b4e384aa847a351926c8f945 (archive commit metadata)
- Retrieved: 2026-10-25
- Upstream file: assets/template.html
- SHA-256: a046fdfeda4309ce3feb42dc71560847ef7b96f447e1218488523c1b96d246d0
- License: MIT; see LICENSE and /licenses/live-panel.txt.

The renderer is vendored unchanged. build.py embeds original FedAgent Studio diagrams,
a restrictive Content Security Policy and the separate playback controller. No example
layouts, third-party illustrations, fonts or view libraries are copied into the output.
Generated diagrams contain no model credentials, user data, fake metrics or task APIs.
