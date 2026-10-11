# sync-cache.json written durably, no temporary file left behind

**Date:** 2026-10-11
**Issue:** #106 (found by the whole-codebase review of 2026-10-11)
**Target version:** 3.1.0 (held, no version bump)

Decided without a review round: the user asked for the implementation of
the issue, whose proposal this follows.

## 1. Problem

`write` in sync-cache.mjs writes `sync-cache.json.<pid>.tmp`, then renames it
over `sync-cache.json`: a crash never leaves a truncated cache. Two gaps:

1. No `fsync` before the rename: after a power loss, a filesystem can keep
   the rename and not the data (an empty or zero-filled `sync-cache.json`).
   The cache then opens empty (reported in error.log) and every result is
   computed again, with its Bitbucket requests, at the next SYNC loads.
2. The temporary file stays when the write or the rename fails: the files
   pile up in the project directory (git-ignored by `sync-cache.json*`).

## 2. Design

`write(content)`:

1. open the temporary file (`'w'`), write the content through the handle,
   `sync()` the handle, close it (in a `finally`: a failed write does not
   leak the descriptor);
2. rename it over `sync-cache.json`;
3. `fsync` the directory: open it (`'r'`), `sync()`, close, so the rename
   itself survives a power loss. Best effort: Windows cannot open a
   directory, some filesystems refuse a directory fsync (`EINVAL`), so any
   failure of this step is ignored; the file is already in place and the
   save resolves `true`.

On a failure of steps 1 or 2, the temporary file is unlinked (a failure of
the unlink, such as `ENOENT` when the open itself failed, is ignored), the
entries stay pending for the next save (`dirty`), and the error is rethrown
as before.

The file-system functions (`open`, `rename`, `unlink` of `fs/promises`) are
an option of `openSyncCache` (`fileSystem`), for the tests: the order write,
sync, close, rename, directory sync is checked against a fake; the clean-up
of the temporary file is checked on the real file system (a rename over a
non-empty directory fails).

A close that fails after a failed write or sync is ignored, so the error
reported (error.log: "sync-cache.json not written") is the first one; a close
that fails after the sync fails the save.

The cost: one fsync of the file and one of the directory per save, that is
per SYNC load that computed something. On macOS Node's fsync is
`F_FULLFSYNC`, which flushes the drive's cache too: tens of milliseconds or
more on a busy disk. `computeSyncStatuses` (sync-statuses.mjs) therefore no
longer awaits the save: the answer goes out at once, a failure is still
logged.

At open, the temporary files of processes no longer running
(`sync-cache.json.<pid>.tmp`, checked with `process.kill(pid, 0)`; `EPERM`
is a running process) are removed: a Ctrl+C or a crash during a save, now
longer with the fsync, leaves one, and the restarted server has another pid.
Those of a running pid are kept: a second instance in the same directory
may be saving.

## 3. Turned down

- **Re-read and merge the file before writing** (two instances in one
  directory, last writer wins): a second instance on a spare port is rare,
  the loser's results are only computed again, and a merge reads and parses
  the whole file on every save, with its own rules for the entries of
  another rule version. Left as the known behaviour.
