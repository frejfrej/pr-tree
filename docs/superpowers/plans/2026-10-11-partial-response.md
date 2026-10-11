# A project response built after a tolerated Jira failure — plan

Spec: `docs/superpowers/specs/2026-10-11-partial-response-design.md`.

1. **Tests first**: project-data (each tolerated failure in `incomplete`,
   `[]` on a clean build, the hash), cache (30-second TTL with gaps),
   project-assembly and fixtures (the shape), app-shell (indicator). They
   fail before the change.
2. **Server**: `assembleProjectData` takes `incomplete` (default `[]`) into
   the data and the hash; the fetchers record their gap in the `Set` the
   build threads to them; `getCachedProjectData` picks the TTL.
3. **Page**: the indicator in index.html and styles.css (banner warning
   colour, text hidden below 900px), `showPartialDataIndicator` in
   app-shell.js; app.js skips the URL replace of a load and of
   Back/Forward over partial data, shows the indicator at each render and
   hides it on a project switch.
4. **Docs**: README changelog under 2.12.0, PRD F5 criterion and section
   7.5, the spec.
5. `npm test`; manual check in the fixture server with `window.fetch`
   overridden, both themes, below 900px.
6. Commit, push, pull request against master closing #91.
