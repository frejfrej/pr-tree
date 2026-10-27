# Copy a pull request's branch and its checkout command — plan

Spec: `docs/superpowers/specs/2026-10-27-copy-branch-design.md`.

## Task 1: Command and click

`public/copy-branch.js`, new: header comment; `checkoutCommand(branch)`
(bare when every character is in `[A-Za-z0-9._/+@=,%-]`, single-quoted
otherwise, `'` as `'\''`); `handleCopyClick(event, { clipboard, status,
setTimeout, clearTimeout })`, the defaults read `navigator.clipboard`,
`document.getElementById('copyStatus')` and the global timers at call
time. Success: class `copied`, icon `fa-check`, status "Copied <text>";
failure: class `copy-failed`, icon `fa-times`, title and status "Copy
failed: <reason>"; reset after 1.5 s (icon, title, class), a second click
restarting it; the timer kept per button in a WeakMap.

Tests first in `test/copy-branch.test.mjs`, on small fake elements (a
button with an `<i>` child, `closest`, `classList`, `title`) and a fake
clipboard and timer.

Expected: the new tests fail before the module exists, pass after;
`node --test test/copy-branch.test.mjs` green.

## Task 2: Render

`public/app-render.js`: the two buttons after the Draft badge, in a
`<span class="copy-buttons">`; `data-copy`, `title`, `aria-label`
escaped; the header comment mentions them.

Tests in `test/app-render.test.mjs`: present on every pull request with
their texts; a hostile branch name escaped in every attribute and quoted
in the command; none on root-branch headers nor orphaned issues.

Expected: the new tests fail before the render change, pass after;
`node --test test/app-render.test.mjs` green.

## Task 3: Keys

`public/tree-keyboard.js`: `openLink` becomes `clickIn`; `c` clicks
`.copy-checkout`, `b` `.copy-branch`, of the row in sight; the header
comment lists them.

Tests in `test/tree-keyboard.test.mjs` (the sample pull requests get the
two buttons).

Expected: the new test fails before the key change, passes after;
`node --test test/tree-keyboard.test.mjs` green.

## Task 4: Wiring and page

`public/app.js`: the pane listener becomes
`event => handleCopyClick(event) || handleTreeClick(event)`.
`public/index.html`: the `copyStatus` region (`role="status"`,
`.visually-hidden`) after the banner status spans. `public/styles.css`:
`.copy-buttons`, `.copy-button` (no border nor fill, `--text-muted`,
`--text-color` on row hover, `:focus-within`, `.selected`), `.copied` in
`--success-strong`, `.copy-failed` in `--error-strong`, `.visually-hidden`.

Tests: the region in `test/server.test.mjs`; styles.test.mjs runs over
the new rules.

Expected: `npm test` green.

## Task 5: Docs

README changelog 3.2.0 and the `c` / `b` keys in the feature paragraph;
PRD F2.8 (keys), a new F2.11 (copy buttons), 7.1 lists copy-branch.js;
CLAUDE.md "Where things are" lists copy-branch.js; package.json 3.2.0,
2026-10-27.

Expected: `npm test` green (server.test.mjs reads README.md and
package.json).

## Task 6: Check and commit

Fixture server: click both buttons, paste, `c` and `b` on a selected
row, the failure path (clipboard overridden in the console), both themes,
hover, focus, selected. Push, the pull request against master and a
comment on #127 for the fork case once the user chooses them.

Expected: every check as the spec says.
