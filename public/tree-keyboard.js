/**
 * Keyboard navigation of the tree (#118): `j` / `k` focus the next or the
 * previous row shown (from the first row in view when no row has the focus),
 * `o` opens the focused row's own link (the pull request in Bitbucket, an
 * orphaned issue in Jira), `i` its first Jira issue, Enter or Space on the row
 * itself fold or unfold its stacked pull requests, `x` goes back to the root
 * pull request of the stack and folds it. Enter and Space act only on a row
 * showing the focus ring: a click focuses a row too (it is focusable), and
 * Space must still scroll the page after it.
 *
 * The rows are the `.pull-request` rows, then the `.orphaned-issue` rows. The
 * rows displayed come from the last filter pass (filterBranches), never from
 * the styles; what a collapse hides is read when a key is pressed
 * (isCollapsedAway, tree-toggle.js), since collapsing runs no filter pass.
 * The rows are focusable (tabindex="-1", app-render.js) but outside the Tab
 * order. app-shell.js calls handleTreeKey after its own guards (typing, Ctrl,
 * Alt or Meta, the help, an open multi-select, the open drawer), so nothing
 * here checks them; Shift is left alone here (Shift+Space scrolls up).
 *
 * Nothing here touches the DOM at import time, so it can be unit-tested with
 * node:test.
 */

import { isCollapsedAway, setPullRequestCollapsed } from './tree-toggle.js';

const rowSelector = '.pull-request, .orphaned-issue';

// The row a key acts on: the one holding the focus, or the focused link or button; null elsewhere
function rowOf(target) {
    return typeof target?.closest === 'function' ? target.closest(rowSelector) : null;
}

// The same key as the render's data-id (pull-request-key.mjs) for a pull request; an orphaned issue by its issue key
function rowKey(row) {
    return row.dataset.id ?? `issue:${row.dataset.issueKey}`;
}

// The links and buttons of a row, in document order: a row holds no other row (stacked pull requests are its siblings)
const rowControls = row => [...row.querySelectorAll('a, button')];

// Whether the row has stacked pull requests to fold, as setPullRequestCollapsed finds them
function hasStack(row) {
    return Boolean(row.nextElementSibling?.classList.contains('children'));
}

/**
 * The first row `isReachable` accepts whose top is at or below `viewTop` (a
 * viewport coordinate); the last reachable one when every row starts above it.
 */
export function firstRowInView(rows, isReachable, viewTop) {
    return rows.find(row => isReachable(row) && row.getBoundingClientRect().top >= viewTop) ??
        rows.findLast(isReachable) ?? null;
}

/**
 * The row `step` (1 or -1) away from `current` in `rows` that `isReachable`
 * accepts; the first reachable row when `current` is null or not in `rows`;
 * null past either end.
 */
export function nextRow(rows, current, step, isReachable) {
    const start = current ? rows.indexOf(current) : -1;
    if (start === -1) return rows.find(isReachable) ?? null;
    for (let index = start + step; index >= 0 && index < rows.length; index += step) {
        if (isReachable(rows[index])) return rows[index];
    }
    return null;
}

/**
 * The root pull request of the stack a row is in, the row itself for a root;
 * null for an orphaned issue. A stacked pull request lives in the `.children`
 * container that follows its parent.
 */
export function rootRowOf(row) {
    let current = row;
    while (!current.classList.contains('pull-request-root')) {
        const container = current.parentElement;
        if (!container || !container.classList.contains('children')) return null;
        current = container.previousElementSibling;
    }
    return current;
}

// Below the sticky headers: the rows' scroll-margin-top (styles.css) keeps them clear
function focusRow(row) {
    row.focus({ preventScroll: true });
    row.scrollIntoView({ block: 'nearest' });
}

// A click on the link, like the mouse's: it opens in a new tab, and handleTreeClick leaves links alone
function openLink(row, selector) {
    const link = row?.querySelector(selector);
    if (!link) return false;
    link.click();
    return true;
}

/**
 * Handles a tree key. `shownRows` are the rows of the last filter pass;
 * `viewTop` gives the top of the tree's scroll area (a viewport coordinate).
 * @returns {boolean} whether the key was taken (the caller then prevents its default)
 */
export function handleTreeKey(event, shownRows, { viewTop = () => 0 } = {}) {
    if (event.shiftKey) return false;
    const row = rowOf(event.target);
    switch (event.key) {
        case 'j':
        case 'k': {
            // A message replaced the tree since the last pass: its rows are gone, all at once
            if (!shownRows[0]?.isConnected) return true;
            const isReachable = candidate => !isCollapsedAway(candidate);
            // No row has the focus (a hidden row loses it): start where the reader is
            const next = row && shownRows.includes(row)
                ? nextRow(shownRows, row, event.key === 'j' ? 1 : -1, isReachable)
                : firstRowInView(shownRows, isReachable, viewTop());
            if (next) focusRow(next);
            return true;
        }
        case 'o':
            return openLink(row, '.pull-request-header > a');
        case 'i':
            return openLink(row, '.jira-issue-link');
        case 'x': {
            const root = row && rootRowOf(row);
            if (!root) return false;
            focusRow(root);
            setPullRequestCollapsed(root, true);
            return true;
        }
        case 'Enter':
        case ' ':
            // On a link or a button inside the row, on a row focused by a click, or with nothing to fold, the key keeps its own meaning
            if (!row || event.target !== row || !row.matches(':focus-visible') || !hasStack(row)) return false;
            // A held key folds once
            if (!event.repeat) setPullRequestCollapsed(row, !row.classList.contains('collapsed'));
            return true;
        default:
            return false;
    }
}

/**
 * Where the focus is in the tree, for restoreFocusedRow: the key of the row
 * and which of its links and buttons holds the focus (-1: the row itself);
 * null when the focus is outside `pane` or on no row (a header toggle).
 */
export function captureFocusedRow(pane, activeElement) {
    if (!activeElement || !pane.contains(activeElement)) return null;
    const row = rowOf(activeElement);
    return row ? { key: rowKey(row), control: rowControls(row).indexOf(activeElement) } : null;
}

/** Focuses again, without scrolling, the same row, or the same control of it, among the rows of the pass that followed a re-render, if it is in sight */
export function restoreFocusedRow(focused, shownRows) {
    if (!focused) return;
    const row = shownRows.find(candidate => rowKey(candidate) === focused.key);
    if (!row || isCollapsedAway(row)) return;
    const control = focused.control >= 0 ? rowControls(row)[focused.control] : null;
    (control ?? row).focus({ preventScroll: true });
}
