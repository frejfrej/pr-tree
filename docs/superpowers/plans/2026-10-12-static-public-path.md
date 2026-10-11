# public/ served from the dashboard's directory — plan

Spec: `docs/superpowers/specs/2026-10-12-static-public-path-design.md`.

1. **Test first** (`test/server.test.mjs`): the fixture server is started
   from a temporary directory holding a decoy `public/index.html`; a new test
   checks that `/` is the dashboard's page. Fails before the change.
2. **Code** (`index.mjs`, CRLF): `express.static(path.join(__dirname, 'public'))`.
3. **Docs**: README changelog line under 3.1.0.
4. `npm test`, `npm run test:coverage` (index.mjs still covered), commit,
   push, pull request against master closing #107.
5. **After the /code-review**: decoys of the private files in the temporary
   working directory, so the test of the files never served catches a mount
   on the working directory again (checked with `express.static('.')` and
   `express.static(__dirname)`); the directory is created in `before` and
   removed in the one `after` hook, after the server's exit.
