# A resolved band apart from the in-review band — plan

Spec: `docs/superpowers/specs/2026-10-11-resolved-band-design.md`.

1. **Test first** (`test/styles.test.mjs`): the band-gap test checks the pairs
   in progress / all approved and in review / resolved at 1.25:1 in both
   themes; it fails on the dark theme (1.00:1).
2. **Token** (`public/styles.css`): `--resolved-color` #5E4DB2 in `:root`
   with a comment, #8270DB in `:root[data-theme="dark"]`;
   `.status-resolved` takes it. `npm test` passes.
3. **Docs**: a 2.12.0 changelog line in README.md, the PRD line of
   section 8.2.
4. **Browser**: fixture server, SECOLLAB, one card of each band side by side
   in both themes.
5. **After the /code-review**: light purple #5243AA, no band for a pull
   request without a linked issue (`statusClass` and its test), the README
   line says darker in both themes, the PRD colour list has purple, the
   test names a missing band instead of throwing.
6. Commit, push, pull request against master.
