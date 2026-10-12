/**
 * Keyboard navigation of the tree (#118): `j` / `k` focus the next or the
 * previous row shown, `o` opens the focused row's own link (the pull request
 * in Bitbucket, an orphaned issue in Jira), `i` its first Jira issue, Enter
 * or Space on the row itself fold or unfold its stacked pull requests, `x`
 * goes back to the root pull request of the stack and folds it.
 *
 * The rows are the `.pull-request` rows, then the `.orphaned-issue` rows. The
 * rows displayed come from the last filter pass (filterBranches), never from
 * the styles; what a collapse hides is read when a key is pressed
 * (isCollapsedAway, tree-toggle.js), since collapsing runs no filter pass.
 * The rows are focusable (tabindex="-1", app-render.js) but outside the Tab
 * order. app-shell.js calls handleTreeKey after its own guards (typing, a
 * modifier, the help, an open multi-select), so nothing here checks them.
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
 * Handles a tree key. `shownRows` are the rows of the last filter pass.
 * @returns {boolean} whether the key was taken (the caller then prevents its default)
 */
export function handleTreeKey(event, shownRows) {
    const row = rowOf(event.target);
    switch (event.key) {
        case 'j':
        case 'k': {
            // A message replaced the tree since the last pass: its rows are gone
            const rows = shownRows.filter(candidate => candidate.isConnected);
            const next = nextRow(rows, row, event.key === 'j' ? 1 : -1, candidate => !isCollapsedAway(candidate));
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
            // On a link or a button inside the row, the key keeps its own meaning
            if (!row || event.target !== row) return false;
            setPullRequestCollapsed(row, !row.classList.contains('collapsed'));
            return true;
        default:
            return false;
    }
}

/** The key of the row holding the focus, or holding the focused element, inside `pane`; null when the focus is elsewhere */
export function captureFocusedRow(pane, activeElement) {
    if (!activeElement || !pane.contains(activeElement)) return null;
    const row = rowOf(activeElement);
    return row ? rowKey(row) : null;
}

/** Focuses again, without scrolling, the row of that key among the rows of the pass that followed a re-render, if it is in sight */
export function restoreFocusedRow(key, shownRows) {
    if (!key) return;
    const row = shownRows.find(candidate => rowKey(candidate) === key);
    if (row && !isCollapsedAway(row)) row.focus({ preventScroll: true });
}
