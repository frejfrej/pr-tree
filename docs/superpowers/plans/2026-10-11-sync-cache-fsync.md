# sync-cache.json written durably — plan

Spec: `docs/superpowers/specs/2026-10-11-sync-cache-fsync-design.md`.

1. **Tests first** (`test/sync-cache.test.mjs`), failing before the change:
   - a fake `fileSystem` records the calls of a save: open of the temporary
     file, write, sync, close, rename, open of the directory, sync, close;
   - a failing directory sync (and a directory that cannot be opened) still
     resolves `true`;
   - a failing handle sync closes the handle, unlinks the temporary file,
     rejects, and the next save writes the entries;
   - on the real file system, a rename that fails (the cache path is a
     non-empty directory) leaves no `.tmp` file.
2. **Code** (`sync-cache.mjs`): `fileSystem` option, `write` as in the spec.
3. **Docs**: README changelog line under 3.1.0, PRD.md F6.3.
4. `npm test`, commit, push, pull request against master closing #106.
5. **After the /code-review**: a close failing after a failed write or sync
   no longer replaces its error; the SYNC load no longer awaits the save
   (macOS `F_FULLFSYNC` twice per save); the temporary files of stopped
   processes are removed at open; the fake records the content written;
   comments corrected (Windows opens a directory, it cannot flush it; the
   `fileSystem` option covers the save only). Not changed: a failed write
   followed by a queued successful one leaves the cache dirty (one extra
   write at the next save, older than this change); the directory-sync
   failure stays silent (best effort, nothing to act on).
