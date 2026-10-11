# Project names looked up as own properties

**Date:** 2026-10-11
**Issue:** #105
**Target version:** 3.1.0 (the user holds the version at 3.1.0)
**Status:** Decided alone (the user asked for the fix without a brainstorm); decisions 1 and 2 changed by the review round (section 4)

## 1. Goal

`config.projects[projectName]`, with a name from the URL, finds the
properties of `Object.prototype`: `constructor`, `__proto__`, `toString`,
`hasOwnProperty` passed the unknown-project check of both routes and of the
fixture source, and the build then failed on `projectConfig.repositories`
(a 500 and an error log line where the SYNC route answers 404).

## 2. Decisions

1. **The projects in an object without a prototype**, made once in
   index.mjs where the configuration is loaded (config.js or the fixtures):
   every `config.projects[name]` then finds configured projects only, the
   lookups of today and those to come (section 4; the first version guarded
   each lookup with `Object.hasOwn`). `config.js` and `projects.js` stay as
   they are.
2. **A 404 from the project route too** (the user's choice after the review
   round): the route checks the project before building, like the SYNC
   route, so a mistyped or stale link writes no error.log line; the page
   shows "Could not load" for a 404 as for a 500. PRD 7.5 updated.
3. **3.1.0**, with the other fixes of the release.

## 3. Verification

server.test.mjs: an unknown project and the four names get 404 from both
routes (the SYNC route answered 500 for the names before); it fails without
the line of index.mjs
(fixture mode goes through it as the real mode does).

## 4. Review round

The /code-review of #129 led to: the projects normalised once in index.mjs
instead of `Object.hasOwn` at each lookup (a future lookup could not bring
#105 back, and the rule is no longer written in index.mjs and in the
fixture source). The fixture source keeps its plain lookup: index.mjs hands
it the normalised configuration, and only tests call it directly; its
`Object.hasOwn` and the fixture test of the inherited names are gone, so the
server test is the one that exercises the line.

Asked of the user and taken: a 404 instead of a 500 from the project route
for an unknown project (decision 2).
