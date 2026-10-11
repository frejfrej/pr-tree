# Accessibility (#109) — plan

Spec: `docs/superpowers/specs/2026-10-12-accessibility-design.md`.

1. **Tests first**, failing before the change:
   - `test/multi-select.test.mjs`: Escape from a checkbox and from Clear all
     closes and focuses the trigger; a focusout to outside closes, one
     inside or without a relatedTarget does not; ArrowDown/ArrowUp walk the
     search box and the checkboxes, stopping at the ends; ArrowDown opens a
     closed trigger;
   - `test/server.test.mjs`: the multi-select markup (aria-controls, the
     dropdown's role and name); every button and link of index.html has a
     name and its icons are hidden; the help is a `<dialog>`;
   - `test/app-shell.test.mjs`: `themeToStore`;
   - `test/styles.test.mjs`: the banner's focus outline at 3:1, no
     `outline: none` left on a focusable control, no `--focus-ring`.
2. **Code**: multi-select.js (CRLF), app-shell.js, index.html, styles.css.
3. **Manual check** in the browser, both themes (fixture server): Tab
   through the banner and the sidebar, the help dialog (focus in, Tab
   trapped, Escape, focus back), a multi-select (arrows, Escape from a
   checkbox, Tab out then `/`), the theme toggle back to the system.
4. **Docs**: README changelog under 3.1.0, PRD (NFR line).
5. `npm test`, commit, push, pull request against master closing #109.

Done as planned. The manual check of step 3 ran in headless Chrome driven
over the DevTools protocol (`Input.dispatchKeyEvent` sends trusted keys:
Tab, Escape and the dialog behave as with a keyboard; the Chrome
extension's key presses never reach the page), in both themes, with
screenshots of the focus rings and the dialog.
