# Status borders at 3:1 — plan

Spec: `docs/superpowers/specs/2026-10-11-status-borders-design.md` (#81).

1. **Test first** (`test/styles.test.mjs`): every `.status-*` rule's
   `border-color: var(--token)` reaches 3:1 against `--surface-color` and
   `--background-color` in both themes; at least the four bands are found.
   Run `npm test`: fails on `--warning-color` and `--success-color` in light.
2. **Tokens** (`public/styles.css`): `--warning-border: #B38600` and
   `--success-border: #22A06B` in `:root` with a comment (3:1 against the
   surface and the page background, for the status borders);
   `var(--warning-color)` and `var(--success-color)` in
   `:root[data-theme="dark"]`. Point `.status-in-progress` and
   `.status-in-review-all-approved` at them. Update the comment of the strong
   tokens ("those stay for borders"). `npm test` passes.
3. **Docs**: a line in the 2.12.0 changelog of README.md; the PRD colour line
   (section 8.2) says the status borders reach 3:1.
4. **Browser**: fixture server, SECOLLAB, both themes; read the computed
   `border-color` of an in-progress and an all-approved card.
5. **After the /code-review**: the green border is `var(--success-strong)`
   (the amber and the 3:1 green had the same lightness), the check is
   against the surface only (no card sits on the page background), compound
   `.status-*` selectors are checked, the `.warnings` border takes
   `--error-strong`, CLAUDE.md pitfall 15 names the border tokens.
6. Commit `fix: status borders at 3:1 in the light theme (#81)`, push, pull
   request against master.
