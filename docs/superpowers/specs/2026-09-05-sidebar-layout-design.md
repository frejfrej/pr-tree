# Sidebar layout, banner and theme redesign

**Date:** 2026-09-05
**Target version:** 2.2.0
**Status:** Draft for review

## 1. Goal

Turn the single centered page into an application shell: a small fixed banner
with the app name, a left sidebar that holds the filters, and a main pane that
scrolls independently and shows the pull-request tree. Along the way, unify the
app name, retire the large footer, make the filters easier to read and clear,
add a dark theme, and fix a hidden coupling in the "Ready for reviewer" filter.

The pull-request card design (borders, avatars, badges, Jira list) stays as it
is, apart from colours coming from tokens and the new font stack.

## 2. Requirements (from the request)

1. A small top banner with the name of the app.
2. The browser tab title includes the currently selected project.
3. Filters live in a sidebar on the left, one below the other.
4. The main pane shows the pull-request tree.
5. The sidebar does not move when the main pane is scrolled.
6. The sidebar can be hidden.

Agreed additions: one app name, project selector and refresh status in the
banner, footer retired, active-filter badge and "Clear filters", remembered
sidebar state, overlay drawer on narrow viewports, sticky repository and branch
headers, "Ready for reviewer" fix, CSS cleanup with colour tokens, system font
stack, dark theme with toggle, keyboard shortcut for the sidebar, collapse all /
expand all, attention count in the tab title, version bump and documentation.

## 3. Out of scope

- Any change to the server, the API responses or the URL parameters.
- Redesign of the pull-request cards, the orphaned-issues block or the help
  content.
- Replacing inline `onclick` handlers in the rendered tree with delegation.
- Retry logic for failed data fetches (the pane only shows an error state).

## 4. Layout

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ☰  ⎇ Bitbucket Pull-Requests Tree  [ PROJECT ▾ ]   ⟳ Last refreshed …  ☾ ? ⌂ v2.2.0 │  banner, 48px, fixed
├──────────────────┬───────────────────────────────────────────────────────┤
│ Filters   Clear  │ [Collapse all] [Expand all]                           │
│                  │ repo-one                                        [12]  │  sticky
│ Sprint           │   develop                                        [8]  │  sticky under repo
│ [ Show all    ▾] │     PR title ……………………  PROJ-12 (In Review)             │
│ Fix version      │       child PR ………                                    │
│ [ Show all    ▾] │   release/1.2                                    [4]  │
│ Assignee         │                                                       │
│ [ Show all    ▾] │                (only this pane scrolls)               │
│ Reviewer         │                                                       │
│ [ Show all    ▾] │                                                       │
│ ☐ Ready for rev. │                                                       │
│ ──────────────── │                                                       │
│ SYNC          ⓘ  │                                                       │
│ [ not loaded  ▾] │                                                       │
│ [ ⟳ Load ]       │                                                       │
└──────────────────┴───────────────────────────────────────────────────────┘
```

### 4.1 App shell

- `body` is a CSS grid filling the viewport (`height: 100dvh`, `overflow:
  hidden`): row 1 is the banner, row 2 holds the sidebar (auto width) and the
  main pane (`1fr`).
- The main pane is the only element that scrolls with the tree
  (`overflow-y: auto`). The sidebar scrolls on its own if its content is taller
  than the viewport.
- The help modal is a sibling of the three regions, not nested in the main
  pane.
- Landmarks: `<header>` for the banner, `<aside>` for the sidebar, `<main>` for
  the pane. The banner's app name is the page `<h1>`; repository names become
  `<h2>`, root-branch names `<h3>`, the orphaned-issues title `<h2>`.

### 4.2 Banner

Left to right, vertically centred, 48px tall:

1. Sidebar toggle button (bars icon), with a small badge showing the number of
   active filters when it is greater than zero. `aria-expanded` and
   `aria-controls` point at the sidebar. Tooltip: "Toggle filters (F)".
2. Brand: the favicon SVG at 24px and the text "Bitbucket Pull-Requests Tree".
3. Project selector (native `<select>`, `aria-label="Project"`), styled to sit
   on the banner background.
4. Flexible spacer.
5. Refresh status: the spinning icon while a check is running, then "Last
   refreshed: …" in a muted colour. Below 900px the text is hidden and moves to
   the icon's tooltip.
6. Theme toggle button (moon icon in light theme, sun icon in dark theme).
7. Help button (question-circle icon) that opens the existing help modal.
8. GitHub link (github icon) to https://github.com/frejfrej/pr-tree.
9. Version text "v2.2.0"; its tooltip carries the release date, author and
   licence lines that used to be in the footer.

Below 900px the brand text is hidden; the logo stays.

The footer element and its styles are removed.

### 4.3 Sidebar

- Width 280px, surface background, right border, own vertical scrollbar.
- Header row: "Filters" title and a "Clear filters" text button, visible only
  when at least one filter is active.
- Filter blocks, stacked, each with a small label above a full-width control:
  Sprint, Fix version, Assignee, Reviewer, then the "Ready for reviewer"
  checkbox row directly under Reviewer (it depends on it), a divider, then
  SYNC: label with the info icon, the status select, and the Load button and
  warning icon on the row below the select.
- Info icons keep their current tooltips (filters that are reset on reload).
- Multi-select dropdowns stay inside the sidebar; if one extends below the
  sidebar's bottom edge, the sidebar scrolls to reveal it. No repositioning
  logic is added.

### 4.4 Main pane

- Page background colour; padding 24px; content fills the width (no maximum
  width).
- A toolbar row above the tree with two text buttons, "Collapse all" and
  "Expand all", shown only while a project is loaded.
- Repository headers are sticky at the top of the pane; root-branch headers are
  sticky just under their repository header. Both headers get fixed heights
  (48px and 40px) and single-line ellipsised names so the sticky offsets are
  known.
- The tree, orphaned issues and the state messages render inside
  `#pull-requests` and `#loading` as today, so the rendering code keeps its
  element ids.

### 4.5 Responsive behaviour

Breakpoint: 900px viewport width.

- At or above 900px the sidebar is part of the grid, and the stored preference
  decides whether it is shown.
- Below 900px the sidebar becomes an overlay drawer over the main pane, under
  the banner, with a backdrop. It always starts closed. The toggle button opens
  it; clicking the backdrop, pressing Escape or choosing a project closes it.
  The stored preference is neither read nor written in this mode.
- Crossing the breakpoint while the page is open re-applies the rule for the
  new mode.

## 5. Behaviour

### 5.1 Sidebar toggle and persistence

- `body.sidebar-hidden` removes the sidebar from the grid (no animation).
- The state is stored in `localStorage` under `prTree.sidebarHidden` as
  `"true"` or `"false"`, written only in the wide layout. Reading and writing
  are wrapped in try/catch; without storage the sidebar starts open.
- Keyboard: the `F` key, without modifiers, toggles the sidebar. The shortcut
  is ignored while the focus is in an input, select, textarea or editable
  element, and while a multi-select dropdown is open.
- `Escape` closes an open multi-select (existing), otherwise the help modal if
  open, otherwise the drawer in the narrow layout.

### 5.2 Tab title

`document.title` is rebuilt whenever the project changes or filters are
applied:

- no project: `Bitbucket Pull-Requests Tree`
- project: `PROJECT · Bitbucket Pull-Requests Tree`
- with attention count `n > 0`: `(n) PROJECT · Bitbucket Pull-Requests Tree`

The attention count is the number of pull requests that are currently shown
(not hidden, not greyed out as filtered) and flagged as needing attention (see
section 6). It is zero whenever no assignee or reviewer filter is active.

### 5.3 Active filters, badge and clear

A filter is active when: Sprint, Fix version, Assignee or Reviewer has at least
one value; "Ready for reviewer" is checked; SYNC is not "Show all". The active
count is the number of active filters (a reviewer filter with three names
counts once).

- The badge on the sidebar toggle shows the count and is hidden at zero.
- "Clear filters" in the sidebar header is shown when the count is positive.
  Clicking it clears the four multi-selects without firing their callbacks,
  unchecks "Ready for reviewer", sets SYNC to "Show all", then runs the normal
  filter-change path once (re-filter, counters, URL, badge, title). It does not
  change the project or discard loaded SYNC statuses.

Both are refreshed by a single `applyFilters()` helper in `app.js` that every
call site of `filterBranches` goes through (filter change, render, SYNC load,
clear).

### 5.4 Collapse all and expand all

- "Collapse all" collapses every repository, every root branch and every pull
  request that has children. "Expand all" expands all of them.
- The three per-level toggles and the collapse-all/expand-all actions share one
  set of helpers (`setRepositoryCollapsed`, `setRootBranchCollapsed`,
  `setPullRequestCollapsed`) so the collapsed class, the children container and
  the child counter are always changed together.
- Repository headers render both chevron icons like the other levels, and the
  repository toggle stops swapping icon classes in JavaScript. This also fixes
  the icon vanishing after an automatic refresh restores a collapsed
  repository.
- `captureToggleStates` and `restoreToggleStates` keep working unchanged in
  behaviour; their selectors move to class names (`.repository-name`,
  `.root-branch-name`) instead of heading tags.

### 5.5 Theme

- Two themes, light and dark, selected by `data-theme="light|dark"` on `<html>`.
- A small inline script in `<head>` sets the attribute before the stylesheet
  applies, from `localStorage` key `prTree.theme` when it holds `light` or
  `dark`, otherwise from `prefers-color-scheme`. This avoids a flash of the
  wrong theme.
- While no preference is stored, a change of the OS setting switches the theme
  live. The toggle button stores the opposite of the current theme; the stored
  value then wins over the OS setting.
- `color-scheme` is set to match, so native selects, scrollbars and the modal
  backdrop follow the theme.
- Jira priority icons and avatars are images and are shown unchanged in both
  themes.

### 5.6 Hover popovers

- The popover element becomes `position: fixed` and is placed from the link's
  `getBoundingClientRect()` without adding the window scroll offset.
- It is clamped so it never extends past the right edge of the viewport.
- Scrolling the main pane hides an open popover.

### 5.7 Empty, loading and error states

Rendered centred in the main pane with an icon and one line of text:

- no project selected: "Select a project to display its pull requests"
- loading: spinner and "Loading PROJECT…"
- fetch failure: "Could not load PROJECT. The next automatic check will retry."
  `renderEverything` returns after showing this when the fetch yields no data.
  While there is no current data, the periodic check calls `renderEverything`
  directly instead of comparing data hashes, so the tree appears as soon as a
  fetch succeeds.

## 6. "Needs attention" and the Ready for reviewer filter

Today the filter decides readiness by reading the computed colour of the title
link and comparing it with the orange hex value. That breaks silently with any
colour change. Replace it with a pure function in `app-filter.js`:

```
assigneeAttention(pr) = assignee filter active
                        AND pr has class status-in-progress
                        AND a linked Jira issue is assigned to a selected assignee
reviewerAttention(pr) = reviewer filter active
                        AND pr has class status-in-review
                        AND a selected reviewer is a participant (not the author)
                            who has not approved
needsAttention(pr)    = assigneeAttention(pr) OR reviewerAttention(pr)
```

- During filtering, every pull request gets or loses the class
  `needs-attention` from `needsAttention`, computed before its visibility.
  CSS colours the title link of `.pull-request.needs-attention` with
  `--attention-color`; the inline `style.color` assignment goes away.
- The "Ready for reviewer" filter matches when `reviewerAttention(pr)` is true.
  This is the same set of pull requests as before (in review, highlighted for
  the selected reviewer), now independent of rendering order and colours.
- `filterBranches` returns the attention count, defined as the number of pull
  requests that end the pass shown and with `needs-attention`.

## 7. Visual design

### 7.1 Font

`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue",
Arial, sans-serif`; code in the help modal uses the system monospace stack.

### 7.2 Colour tokens

All colours in `styles.css` come from custom properties on `:root`; no
hard-coded greys or whites remain in rules. `--secondary-color` is renamed
`--attention-color`.

| Token | Light | Dark |
|---|---|---|
| `--primary-color` | #0052CC | #579DFF |
| `--attention-color` | #FF5630 | #FF7452 |
| `--background-color` (page, main pane) | #F4F5F7 | #161A1D |
| `--surface-color` (cards, sidebar, dropdowns, modal) | #FFFFFF | #1D2125 |
| `--surface-muted` (hover rows, disabled controls, filtered cards, code) | #EBECF0 | #22272B |
| `--text-color` | #172B4D | #B6C2CF |
| `--text-muted` | #6B778C | #8C9BAB |
| `--border-color` | #DFE1E6 | #38414A |
| `--success-color` | #36B37E | #4BCE97 |
| `--warning-color` | #FFAB00 | #F5CD47 |
| `--error-color` | #FF5630 | #F87168 |
| `--in-review-color` | #0065FF | #579DFF |
| `--danger-bg` (warnings box, orphaned header) | #FFEBE6 | #42221F |
| `--danger-text` | #BF2600 | #FD9891 |
| `--header-bg` | #0052CC | #1D2125 |
| `--header-text` | #FFFFFF | #B6C2CF |
| `--header-muted` | rgba(255,255,255,.75) | #8C9BAB |
| `--repo-header-text` (on `--primary-color`) | #FFFFFF | #1D2125 |
| `--shadow-color` | rgba(9,30,66,.15) | rgba(0,0,0,.5) |
| `--focus-ring` | rgba(0,82,204,.25) | rgba(87,157,255,.35) |

Sizes as tokens: `--header-height: 48px`, `--sidebar-width: 280px`,
`--repo-header-height: 48px`, `--branch-header-height: 40px`.

In the dark theme the banner has a bottom border in `--border-color`, since
its background matches the sidebar.

### 7.3 Stylesheet cleanup

`styles.css` is rewritten in sections: tokens, base, app shell (banner,
sidebar, main pane, responsive), controls (select, buttons, checkbox,
multi-select), tree (repository, branch, pull request, badges), orphaned
issues, popovers, modal and help content, state messages. Removed: the
duplicate `spin` and `versionPulse` keyframes, the duplicate popover and
`.container` rules, the two footer media queries, the `.help-button` rules and
all footer rules. Inline `style` attributes in `index.html` and in the rendered
tree (info icons, root-branch link) move to classes.

## 8. Code structure

| File | Change |
|---|---|
| `public/index.html` | New shell markup; theme bootstrap script in `<head>`; footer removed; title "Bitbucket Pull-Requests Tree". |
| `public/styles.css` | Rewritten per section 7. |
| `public/app-shell.js` (new) | Sidebar toggle, persistence, drawer, keyboard shortcuts, theme, active-filter badge, document title, toolbar buttons. Exports `initializeAppShell({ onClearFilters })`, `updateActiveFilterBadge(count)`, `updateDocumentTitle({ project, attentionCount })`, `setToolbarVisible(visible)`. |
| `public/tree-toggle.js` (new) | Collapse helpers, the three toggles, `collapseAll`, `expandAll`, `captureToggleStates`, `restoreToggleStates`, moved out of `app.js`. |
| `public/app.js` | Imports the two new modules; `applyFilters()` helper; `clearAllFilters()`; state messages; version into the banner; popover changes; repository header renders both chevrons and class-named headings. |
| `public/app-filter.js` | `needsAttention` logic, `needs-attention` class, ready filter, attention count returned by `filterBranches`. |
| `package.json` | version 2.2.0, releaseDate 2026-09-05. |
| `README.md` | Features and changelog for 2.2.0. |
| `CLAUDE.md` | Version, structure table with the new modules, frontend state and pitfalls. |
| `PRD.md` | Section 8.1 layout diagram and 8.3 responsive behaviour updated. |

`counter-utils.js`, `multi-select.js`, `index.mjs` and `cache.mjs` are
untouched.

## 9. Verification

No automated tests exist; verification is manual in a browser against the
running server (`node index.mjs`, http://localhost:3000), in light and dark
theme:

1. Banner shows logo, name, project selector, refresh status, theme, help,
   GitHub and version; help modal opens from the banner and closes with the
   button, backdrop or Escape.
2. Selecting a project updates the tab title; clearing it restores the plain
   name.
3. Filters are stacked in the sidebar; every multi-select still opens,
   searches, selects, clears; SYNC load still works and the warning icon
   still appears on failure or rate limit.
4. Scrolling a long tree leaves the banner and sidebar in place; repository and
   branch headers stick at the top of the pane.
5. Toggle button, `F` key and reload: sidebar state is remembered; the badge
   shows the active-filter count; "Clear filters" resets everything and the
   URL loses its filter parameters.
6. Reviewer filter plus "Ready for reviewer": the same pull requests are
   highlighted and kept as before the change; the tab title shows the count.
7. Collapse all / expand all act on every level; per-level toggles still work;
   a collapsed repository survives an automatic refresh with the correct
   chevron.
8. Hover popovers on PR titles and Jira keys appear next to the link after
   scrolling, and disappear on scroll.
9. Window narrower than 900px: sidebar becomes a drawer, backdrop closes it,
   brand text and refresh text hide.
10. Theme toggle switches immediately, survives reload, and the OS setting is
    followed until a choice is stored.
