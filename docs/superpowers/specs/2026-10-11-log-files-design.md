# Log files: rotation, write errors, shutdown

**Date:** 2026-10-11
**Issue:** #104
**Target version:** 3.1.0 (the user holds the version at 3.1.0)
**Status:** Decided alone (the user asked for the fix without a brainstorm); the review round replaced the first design (section 4)

## 1. Goal

The three log streams of index.mjs had no `error` listener (an unwritable
file crashed the server), no rotation (access.log and performance.log grow
forever), and SIGTERM called `process.exit(0)` at once (the buffered lines
lost; SIGINT not handled at all).

## 2. Decisions

1. **One module, `log-file.mjs`**: `createLogFile(path, { maxBytes, keep,
   onError, now, fs })` returns `{ write }`. index.mjs's `log()` keeps
   calling `write`, so no call site changes.
2. **Each line appended at once** (`statSync` then `appendFileSync`): nothing
   is buffered, so nothing is lost when the process ends, whatever ends it,
   and no file stays open. The server writes a few short lines per request;
   the synchronous write costs the event loop nothing it would notice.
3. **No shutdown handler**: SIGTERM keeps its `process.exit(0)` (a normal
   exit, for the coverage run), Ctrl+C keeps its default. A JavaScript SIGINT
   handler would make Ctrl+C wait for a free event loop, and the server has
   blocked its loop before (2.7.0).
4. **Rotation by size**, 10 MB, three old files (`.1` newest to `.3`), by
   renames, judged on the size on disk: the file a previous run left counts,
   and so do the lines of another server writing the same file. By size
   rather than by day: the volume depends on the open tabs and projects, not
   on the date, and one bound caps the disk use (40 MB per log). No
   dependency, no compression. A failed rotation is reported once and not
   tried again until a restart: tried at every line, a failing rename would
   report every line and shift the old files away. The rotated files are
   git-ignored (`*.log.*`).
5. **Failures**: a write error is reported once on the console
   (`console.error`; error.log may be the file that fails), the lines are
   dropped (`log()` prints every line to the console anyway), the file is
   tried again at the first line a minute later, and a failure is reported
   again only after a line went through.
6. **What the access log records is unchanged.** The issue said static
   files were logged: they are not (`express.static` comes first and ends
   those requests; access.log holds no `/app.js` or `/vendor` line). It logs
   the API, README.md and the requests no file answers.

## 3. Verification

`test/log-file.test.mjs` on a temporary directory: a line on disk when
`write` returns, rotation and the files kept, the size on disk (a previous
run, another process), a line larger than the limit, an unwritable file (a
directory in its place) reported once, tried again a minute later, reported
again after a success, a failed rotation reported once without shifting the
old files again. `npm run test:coverage` still lists index.mjs.

## 4. Review round

The first design kept a write stream per file (opened synchronously),
rotated on a byte count, and ended the streams on SIGTERM and SIGINT before
exiting. The /code-review of #128 found: a failed rotation retried at every
line (each retry reporting, reopening, and shifting the old files); the
rotated files not git-ignored; a JavaScript SIGINT handler that a blocked
event loop makes deaf to Ctrl+C, exiting 0 instead of the signal's status;
a write error reported every minute (each reopening succeeded); the lines of
a stream ended by a rotation lost at an exit; a byte count blind to another
process and to the writes in flight; an unguarded `closeSync`; a SIGINT
server test writing to the project's logs and leaking its server on a
failure. Appending each line at once (decision 2) removes the buffers, the
open files and the shutdown handler; decisions 4 and 5 cover the rest; the
SIGINT server test went with the handler.
