# A tab left open across a server upgrade asks for a reload — plan

Spec: `docs/superpowers/specs/2026-10-12-page-build-design.md`.

1. **Server** (`page-build.mjs`, test `test/page-build.test.mjs`): `pageBuildOf(directory)`,
   16 hexadecimal digits of a SHA-256 of the files of `public/` (dot files skipped).
2. **Wiring** (`index.mjs`, CRLF): the build computed once, an `/api` middleware after the
   request guard sets `X-Page-Build`; `test/server.test.mjs` checks every `/api` route, a 404
   included, and that the page files carry no header.
3. **Page** (`public/page-updated.js`, test `test/page-updated.test.mjs`): `nextPageBuild`
   (pure), `checkPageBuild`, `pageIsStale`, the banner button (`index.html`, `styles.css`,
   text visually hidden below 900px), its click reloads.
4. **Callers**: `loadProjects` takes the first build; `fetchData` and the SYNC load answer
   `{ stale }` (no fetch once stale); `takeAnswer` stops the checks, keeps the tree, or shows
   the main-pane message; the SYNC load button is disabled.
5. **Docs**: README (feature and changelog under 3.1.0), PRD F5.8 and 7.5, CLAUDE.md
   (where things are, pitfall 9).
6. `npm test`; manual check on the fixture server (port 3101): tab open, a temporary file in
   `public/`, restart, check, project switch, SYNC load, reload button; commit, push, pull
   request closing #125.
