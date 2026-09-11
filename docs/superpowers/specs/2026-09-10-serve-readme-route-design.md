# Serve README.md through one route

**Date:** 2026-09-10
**Issue:** #40
**Target version:** 2.5.2
**Status:** Decided in an autonomous session, without a review round (the user asked for the brainstorm to be done alone); section 2 lists the decisions to revisit

## 1. Goal

The help modal fetches `README.md` from the server root. `index.mjs` serves it
through a second `express.static` mounted on the project directory, and that
middleware serves every non-dotfile of the checkout: `config.js` with the
Bitbucket and Jira credentials, the three logs, the sources, `CLAUDE.md`
(checked on a fixture server: HEAD `/config.js` answers 200 with the 798 bytes
of the file). The server listens on all interfaces, so anyone who can reach the
port can download the credentials. Replace the middleware with a route that
sends `README.md` and nothing else, and keep a test that proves it.

## 2. Decisions

1. **One route.** `app.get('/README.md', ...)` answers with
   `res.sendFile(path.join(__dirname, 'README.md'))`; the middleware
   `express.static(__dirname, { index: false, extensions: ['md'] })` is
   removed. Nothing else was fetched from the root: the frontend fetches
   `README.md` (`fetchAndRenderReadme` in `app-shell.js`) and the `/api/*`
   routes, and `public/` keeps its own static middleware.
2. **Regression test.** `test/server.test.mjs` starts the server in fixture
   mode on an ephemeral port and checks that `/README.md` answers 200 as
   markdown with the content of the file, that `/config.js`,
   `/config.js.default`, `/index.mjs`, `/cache.mjs`, `/package.json`,
   `/access.log`, `/CLAUDE.md` and `/fixtures/generate.mjs` answer 404, and
   that `/` and `/api/version` still answer. It is the first test that runs
   the server. The server opens its log streams in the project directory, so a
   test run appends a few lines to `access.log` and `performance.log` there,
   as any run of the server does; accepted rather than adding a log-directory
   option for the sake of a test.
3. **The actual port in the startup log.** `app.listen` returns the server;
   the startup line logs `server.address().port`, so `PORT=0` (the OS picks a
   free port) reports the port actually bound, and the test reads it from
   stdout. No other change to startup.
4. **Version 2.5.2:** a fix, no feature, no API change.
5. **Still bound to all interfaces.** Binding to `127.0.0.1` would be a
   behaviour change for a dashboard used from another machine on the LAN; it
   is left as a separate decision, noted in #40.

## 3. Out of scope

- Binding the server to `127.0.0.1`.
- Making `express.static('public')` independent of the working directory.
- Any change to the help modal or to the frontend.

## 4. Behaviour

- `GET /README.md`: 200, `Content-Type: text/markdown; charset=utf-8`, the
  file as on disk.
- `GET /config.js`, `/index.mjs`, `/package.json`, `/access.log`, `/CLAUDE.md`
  and any other file of the project directory: 404 (Express default).
- `GET /` (the app) and `/api/*`: unchanged.
- Startup log: `Server is running at http://localhost:<port actually bound>`.

## 5. Code structure

| File | Change |
|---|---|
| `index.mjs` (CRLF file) | the route replaces the root static middleware; the listen callback logs the actual port |
| `test/server.test.mjs` | new: starts the fixture server on port 0, checks the routes above |
| `README.md`, `CLAUDE.md`, `PRD.md`, `package.json` | changelog 2.5.2, what is served from the project directory, NFR-SEC5, version |

## 6. Verification

`npm test`: the new test fails before the fix (`config.js` served with 200)
and passes after; 76 tests. Manual, on a fixture server (`PORT=3101 node
index.mjs --fixtures`): `curl -sI localhost:3101/config.js` answers 404,
`curl -sI localhost:3101/README.md` answers 200 `text/markdown`, the help
modal of the page still shows the README.

## 7. Delivery

Branch `claude/serve-readme-route` from `master`, pull request to `master`,
closes #40. First of a stack: the branch of #41 starts from it.
