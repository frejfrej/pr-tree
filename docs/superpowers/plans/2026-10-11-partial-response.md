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
7. **After the /code-review**: only the filters a gap feeds keep the URL's
   values (`filtersKeptOverGaps`, app-url.js, tested), the others are
   cleaned as on complete data; the tooltip skips an unknown part (generic
   text when none is known); the indicator's text is written when shown so
   the status region announces it; the spec notes the rebuilds of a lasting
   failure. Turned down: Back/Forward then a filter change dropping the
   value (#61's accepted cost), the tooltip-only explanation and its wording
   (as the pause indicator), the `gaps` defaults and the predicate written
   three times (each gap is tested through `buildProjectData`).
