# Project names looked up as own properties

**Date:** 2026-10-11
**Issue:** #105
**Target version:** 3.1.0 (the user holds the version at 3.1.0)
**Status:** Decided alone (the user asked for the fix without a brainstorm)

## 1. Goal

`config.projects[projectName]`, with a name from the URL, finds the
properties of `Object.prototype`: `constructor`, `__proto__`, `toString`,
`hasOwnProperty` passed the unknown-project check of both routes and of the
fixture source, and the build then failed on `projectConfig.repositories`
(a 500 and an error log line where the SYNC route answers 404).

## 2. Decisions

1. **`Object.hasOwn`** at the three lookups of a name from the URL:
   `projectConfigOf` in index.mjs (the project route's build and the SYNC
   route's 404 check) and `getProjectData` in fixtures/index.mjs. Not a
   null-prototype copy of the projects: `config.js` and `projects.js` stay as
   they are, and `Object.keys` (the project list) already ignored inherited
   names.
2. **The answers stay as documented** (PRD 7.5): an unknown project gets a
   500 from the project route and a 404 from the SYNC route. Turning the 500
   into a 404 is a change of its own.
3. **3.1.0**, with the other fixes of the release.

## 3. Verification

server.test.mjs: the four names get 404 from the SYNC route (a 500 before)
and 500 from the project route; fixtures.test.mjs: the fixture source
rejects them with "Project not found" (before: "projectConfig.repositories is
not iterable"). Both fail without the fix.
