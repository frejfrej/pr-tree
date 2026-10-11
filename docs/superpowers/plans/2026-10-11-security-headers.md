# Content-Security-Policy and security headers — plan

Spec: `docs/superpowers/specs/2026-10-11-security-headers-design.md`.

1. `public/theme-bootstrap.js` from the inline script of index.html.
2. `security-headers.mjs`; index.mjs (CRLF): `x-powered-by` off, the
   middleware before the request guard.
3. server.test.mjs: the headers on every kind of answer; nothing the policy
   would block in the page and the scripts; checked failing on the previous
   files.
4. Chrome on the fixture server: no violation, both themes, popover, help,
   SYNC load.
5. README (under 3.1.0), PRD NFR-SEC8 and 14.2, CLAUDE.md (module list,
   pitfall 14); pull request closing #110.
