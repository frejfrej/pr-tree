# Run the tests with a coverage report

**Date:** 2026-09-13
**Issue:** none (asked in the session: "add some test coverage execution")
**Target version:** 2.7.0 (unreleased, the version of PR #47)
**Status:** Decided in an autonomous session, without a review round; section 2 lists the decisions to revisit

## 1. Goal

`npm test` says whether the 124 tests pass, not what they exercise. Add one
command that runs the same tests and prints, per module of the project, the
lines, branches and functions the tests reached, so that a gap (issue #48, the
server's SYNC computation, is one) is read from a table instead of guessed.

## 2. Decisions

1. **Node's own coverage, no dependency.** `npm run test:coverage` is the
   `test` script plus `--experimental-test-coverage`: the table is printed by
   the test reporter after the tests. `c8` (a dev dependency, HTML reports)
   was rejected: the tests have no dependency, and a table in the terminal is
   what the question asked for.
2. **The reported files are listed explicitly.** `--test-coverage-include`
   patterns `*.mjs`, `projects.js`, `public/*.js` and `fixtures/*.mjs`, the
   project's own modules. Without them the table also lists whatever
   `NODE_OPTIONS` preloads (the terminal of the workstation this was written
   on injects a `--require` script from a temporary directory, which came
   out as a `../../../../private/var/...` entry), and `--test-coverage-exclude` cannot say
   "outside the project": Node matches the globs with minimatch, whose `**`
   does not cross `..`. The test files stay out (Node's default exclusion
   still applies when only include patterns are given), `node_modules` too.
   A new source directory needs a pattern in the script. The include option
   exists since Node 22.5 (the server itself needs 20.11); noted in the
   documentation, `engines` is not raised for a development script.
3. **The server is in the table.** `test/server.test.mjs` spawns `index.mjs`
   in fixture mode and stops it with `server.kill()`, a SIGTERM; a process
   killed by a signal writes no V8 coverage, so `index.mjs`, the largest
   file, was simply absent from the table, with nothing to show it. The
   server now handles SIGTERM by exiting normally (`process.exit(0)`), which
   writes the coverage, and the test's `after` hook waits for the exit so the
   file is on disk before the run ends. Behaviour change: a SIGTERM ends the
   server with exit code 0 instead of 143; Ctrl-C (SIGINT) is unchanged, and
   nothing waits for requests in flight (a SYNC load can take fifteen
   seconds, a stop must not). On Windows `kill()` terminates the process
   without a signal, so the server is absent there; accepted.
4. **No threshold.** The DOM modules (`app-shell.js`, `app-sync.js`,
   `tree-toggle.js`, `counter-utils.js`) are low by design, only their pure
   helpers are tested without a DOM, so a global threshold would either fail
   every run or say nothing. A file no test loads (`public/app.js`,
   `public/multi-select.js`) is absent from the table, not at 0%: the "all
   files" line overstates, and the documentation says so.
5. **`npm test` is unchanged.** The table is long; it is printed on request.

## 3. Out of scope

- An lcov or HTML report (`--test-reporter=lcov` exists when one is wanted).
- Coverage thresholds, a CI job, new tests for the gaps the table shows.

## 4. Behaviour

- `npm run test:coverage`: the same tests as `npm test`, then a table with
  one line per module of the project loaded by a test (`cache.mjs`,
  `conflicts.mjs`, `index.mjs`, `sync-cache.mjs`, `projects.js`, the two
  fixture modules, the `public/` modules a test imports), with the uncovered
  line numbers.
- `npm test`: unchanged, 124 tests.
- The server: a SIGTERM ends it with exit code 0.

## 5. Code structure

| File | Change |
|---|---|
| `package.json` | the `test:coverage` script |
| `index.mjs` (CRLF file) | a SIGTERM handler that exits normally, after the listen block |
| `test/server.test.mjs` | the `after` hook waits for the server's exit (`once(server, 'exit')`), and returns at once when the server already exited |
| `README.md`, `CLAUDE.md` | changelog 2.7.0; testing sections and the `index.mjs` description |

## 6. Verification

`npm test`: 124 tests, `ℹ fail 0`. `npm run test:coverage`: the same, then the
table lists `index.mjs` with the lines of the fixture-mode routes covered and
nothing from outside the project; `grep -c $'\r' index.mjs` equals
`wc -l < index.mjs`. A SIGTERM to a fixture server (`PORT=0 node index.mjs
--fixtures`, then `kill -TERM` its pid once it has logged its port) gives
exit code 0.

## 7. Delivery

Branch `claude/test-coverage` from `claude/conflicts-from-patches` (it edits
`test/server.test.mjs`, `README.md` and `CLAUDE.md` where PR #47 did, so it
stacks on #47: retarget it to `master` before #47's branch is deleted). Not
pushed by the session that wrote it.
