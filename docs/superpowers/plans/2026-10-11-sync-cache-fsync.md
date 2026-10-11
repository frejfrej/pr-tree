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
