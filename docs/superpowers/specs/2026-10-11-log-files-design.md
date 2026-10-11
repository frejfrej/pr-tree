# Log files: rotation, write errors, shutdown

**Date:** 2026-10-11
**Issue:** #104
**Target version:** 3.1.0 (the user holds the version at 3.1.0)
**Status:** Decided alone (the user asked for the fix without a brainstorm)

## 1. Goal

The three log streams of index.mjs had no `error` listener (an unwritable
file crashed the server), no rotation (access.log and performance.log grow
forever), and SIGTERM called `process.exit(0)` at once (the buffered lines
lost; SIGINT not handled at all).

## 2. Decisions

1. **One module, `log-file.mjs`**: `createLogFile(path, { maxBytes, keep,
   onError, now, fs })` returns `{ write, end }`. index.mjs's `log()` keeps
   calling `write`, so no call site changes.
2. **Rotation by size**, 10 MB, three old files (`.1` newest to `.3`), by
   renames; the size of the file left by a previous run counts. By size
   rather than by day: the volume depends on the open tabs and projects, not
   on the date, and one size bound caps the disk use (40 MB per log). No
   dependency, no compression.
3. **The file is opened synchronously** (`openSync`, then a stream on the
   descriptor): a stream opens its file later, so a rotation right after an
   opening made the old stream write into the new file (seen in the tests).
   With the descriptor held, the lines a closing stream buffers follow the
   renamed file. Where the system refuses to rename an open file (Windows),
   the rotation is reported and the file keeps growing.
4. **Failures**: an opening or a write error is reported once on the console
   (`console.error`; error.log may be the file that fails), the lines are
   dropped (`log()` prints every line to the console anyway), and the file is
   tried again at the first line a minute later.
5. **Shutdown on SIGTERM and SIGINT**: a "Shutting down on <signal> (pid N)"
   line, `close()` on both listeners (no new connection), `end()` on the
   three files, then `process.exit(0)`, still a normal exit for the coverage
   run. A second signal, or files that take more than 2 seconds, exit at
   once. Requests in flight are not waited for: a SYNC load can take minutes.
6. **What the access log records is unchanged.** The issue said static
   files were logged: they are not (`express.static` comes first and ends
   those requests; access.log holds no `/app.js` or `/vendor` line). It logs
   the API, README.md and the requests no file answers.

## 3. Verification

`test/log-file.test.mjs` on a temporary directory: appending after a
previous run, rotation and the files kept, the size left by a previous run,
a line larger than the limit, an unwritable file (a directory in its place)
reported once and tried again a minute later, nothing after `end()`, a failed
rename. `test/server.test.mjs`: SIGINT exits with code 0 and the shutdown line
is in access.log (fails on the previous index.mjs, which died by the signal).
`npm run test:coverage` still lists index.mjs (SIGTERM exits normally).
