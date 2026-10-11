# Accessibility: help dialog, multi-select keys and names, icon buttons, focus ring, theme

**Date:** 2026-10-12
**Issue:** #109 (found by the whole-codebase review of 2026-10-11)
**Target version:** 3.1.0 (held, no version bump)

Decided without a review round: the user asked for the implementation of
the issue; where the issue offers a choice, the one taken and the one
turned down are below.

## 1. Help dialog

`#helpModal` becomes a `<dialog>` opened with `showModal()`: the browser
moves the focus into it (the close button, its first control), makes the
page behind inert (Tab stays in the dialog, a screen reader does not read
the page), and closes it on Escape. On close, the focus goes back to the
element focused before the opening (`#helpButton`), restored by the page
itself as well as by the browser, which not every version does.

The dialog covers the viewport and paints the backdrop colour itself
(`::backdrop` transparent): a custom property is not inherited by
`::backdrop` in every supported browser. A click on that area (the dialog
element itself, outside `.modal-content`) closes it, as before. A closed
dialog is `display: none` by the browser's own style; the layout is set on
`.modal[open]` only.

The shell's Escape handling leaves an open help to the dialog.

Turned down: a hand-written focus trap on the old `<div>` (more code for
what the browser does).

## 2. Multi-select: Escape, focus leaving, arrow keys, names

- **Escape anywhere in an open component** (trigger, search box, a
  checkbox, Clear all, Select all) closes it and focuses the trigger: one
  `keydown` listener on the component instead of the trigger's and the
  search box's.
- **The focus leaving the component closes it**: a `focusout` whose
  `relatedTarget` is outside the component. A `focusout` without a
  `relatedTarget` (a click on a part of the page that takes no focus, the
  window losing the focus, a focused element removed) does not close it: the
  click on the page closes it already, and the window coming back gives
  the focus back inside.
- **The shell's shortcuts** (`F`, `/`, Escape, Ctrl+F) stay out of the way
  only for a key pressed inside an open multi-select, no longer for any
  key while one is open somewhere.
- **ArrowDown and ArrowUp** move the focus through the search box and the
  checkboxes shown, in order, stopping at both ends; ArrowDown on a closed
  trigger opens the component (the focus goes to the search box).
- **Names**: the trigger gets `aria-controls` (the dropdown's id,
  `<id>Dropdown`); the dropdown `role="group"` named by the filter's label.
  No `aria-haspopup`: its values announce a menu, a listbox, a tree, a grid
  or a dialog, and the dropdown is none of them (a search box and
  checkboxes); `aria-expanded` already says it opens.

Turned down: a listbox with `aria-activedescendant` (a rewrite of the
component for the same keys).

## 3. Icon buttons

Every button or link showing only an icon gets an `aria-label`: the
sidebar toggle ("Toggle filters", "Toggle filters, 3 active" while filters
are active, written by `updateActiveFilterBadge`, so the badge's number is
no longer the button's whole name), the theme toggle (its label follows
the theme, like its tooltip), the help button, the GitHub link. The icons
inside buttons and links get `aria-hidden="true"`. server.test.mjs checks
that every button and link of index.html has a name, and that every icon
inside one is hidden.

## 4. Focus ring

The inputs, the selects and the multi-select trigger and search box no
longer replace the 2px `:focus-visible` outline of the primary colour
(`outline: none` and the 25% `--focus-ring` shadow, about 1.5:1 against
white, are gone; the token goes from both themes). They keep their primary
border on focus.

The banner is painted in the primary colour in the light theme, so the
outline of its controls (sidebar toggle, project, theme, help, GitHub) was
invisible there: `.app-header :focus-visible` takes `--header-text`
(test/styles.test.mjs checks it reaches 3:1 against `--header-bg` in both
themes).

## 5. Theme follows the system again

A click on the theme toggle that picks the system's theme removes the
stored preference instead of writing it: the page follows the system again
(the live `prefers-color-scheme` listener and theme-bootstrap.js already
do when nothing is stored). A click that picks the other theme stores it,
as before. `themeToStore(theme, systemTheme)` (app-shell.js) decides it,
tested in app-shell.test.mjs.

Turned down: a third "system" state of the toggle (a three-way button or
a menu for one preference; two clicks at most get back to the system now).

## 6. After the /code-review

- **The focus nowhere**: Safari does not focus a clicked checkbox, so the
  focus can be on the page body with a dropdown open. The shell steps aside
  for a key pressed in an open multi-select **or** on the body while one is
  open (as before #109 in that case), and the component closes on an Escape
  reaching the document from the body.
- **A re-render of the options** (the periodic refresh calls `setOptions`)
  replaced the focused checkbox and dropped the focus to the body: the
  checkbox of the same value is focused again, or the search box when its
  option is gone.
- **Arrows from outside the list**: from the trigger (above the list)
  ArrowDown goes to the search box, ArrowUp nowhere; from Clear all and
  Select all (below) ArrowUp goes to the last checkbox, ArrowDown nowhere.
  One `keydown` listener handles ArrowDown on the closed trigger too.
- **Backdrop click**: closes only when the pointer was also pressed on the
  backdrop; a text selection dragged out of the help onto it keeps it open.
- **Focus restore**: the page focuses the element of before only when the
  browser did not (the focus is on the body), so a mouse close does not
  paint a keyboard ring on the help button.
- **Icons of the tree** (app-render.js): the decorative ones are hidden
  (filter, external link, commit badges, alerts next to their text, the
  assignee icon next to the named avatar); the review-status icon of a
  participant is named instead (`role="img"`, "approved", "requested
  changes", "not reviewed yet", "author"). app-render.test.mjs checks every
  icon of the fixture trees.
- styles.test.mjs also catches `outline: 0px`, `transparent` and the
  `outline-style`, `-width` and `-color` forms; one `MediaQueryList` for
  the system theme.
