# public/ served from the dashboard's directory, not the working directory

**Date:** 2026-10-12
**Issue:** #107 (found by the whole-codebase review of 2026-10-11)
**Target version:** 3.1.0 (held, no version bump)

Decided without a review round: the user asked for the implementation of
the issue, whose proposal this follows.

## 1. Problem

`express.static('public')` (index.mjs) resolves `public` against the working
directory, while package.json, the README route, the logs and
sync-cache.json are found through `__dirname`. Started from another
directory (`node ~/Sites/pr-tree/index.mjs`, launchd, pm2), the page is
blank (404 on `/`) while the API and the README work, or the `public/`
folder of the working directory is served instead. Spec 2026-09-10 (README
route) left it out of scope.

## 2. Design

`express.static(path.join(__dirname, 'public'))`. Nothing else of the server
depends on the working directory: `config.js` is imported relative to the
module, and the other files go through `__dirname`.

Test: server.test.mjs starts its one fixture server from a temporary
directory holding a `public/index.html` of its own, through the absolute
path of index.mjs, so every server test runs that way; a new test checks
that `/` is the dashboard's `public/index.html`. Before the fix it got the
decoy page, and the tests reading the page's scripts and controls failed.
The coverage of index.mjs (`npm run test:coverage`) is unchanged.

The test of the files never served ran from the project directory, so it
also caught a static middleware mounted on the working directory (the
mistake fixed in 2.5.2). To keep that, the temporary directory also holds
decoys of those files (`config.js`, `index.mjs`, `access.log`...): a mount
on the working directory serves the decoys, a mount on the project
directory the real files, and both fail the test (checked by adding each
mount in turn). The directory is created in the `before` hook and removed
by the one `after` hook, once the server has exited.

## 3. Turned down

- **A second server started from another directory for this test only**:
  a second process and start-up for one assertion, while running the one
  server from elsewhere checks every route that way.
