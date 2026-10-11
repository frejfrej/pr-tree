# Loopback bind, Host check, cross-site API requests refused — plan

Spec: `docs/superpowers/specs/2026-10-11-host-check-design.md`.

1. **Module** `request-guard.mjs`: `hostnameOf`, `allowedHostnames`,
   `createRequestGuard`; tests in `test/request-guard.test.mjs`.
2. **Server** (`index.mjs`, CRLF): `PR_TREE_HOST` (default 127.0.0.1) and
   `PR_TREE_ALLOWED_HOSTS` read once; the guard before `express.static`;
   `app.listen(port, host)`; a startup line with the address and the names.
3. **Server tests** (`test/server.test.mjs`): the spawned server gets empty
   `PR_TREE_*` host variables; raw `node:http` requests for the Host header
   (fetch cannot set it); the cross-site cases; the loopback-only bind.
   Checked failing on the previous `index.mjs`.
4. **Manual**: the opt-in with curl, the page and a cross-site fetch in Chrome.
5. **Docs**: README "Network access" and changelog 3.1.0, PRD NFR-SEC6 and
   section 7.5, CLAUDE.md (module list, pitfall 1), version 3.1.0.
6. `npm test`, commit, push, pull request against master closing #98.
