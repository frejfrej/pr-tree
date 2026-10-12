/**
 * Keyboard navigation of the tree and its selected row (#118). One row is
 * selected whenever a row is shown (class `selected`, `aria-current`): the
 * keys act on the row holding the focus, or holding the focused link or
 * button, else on the selected row. `↓` / `j` and `↑` / `k` select the next
 * or the previous row shown (from the first row in view when there is no
 * row to start from); `→` unfolds the row's stack, or selects its first
 * stacked pull request when unfolded; `←` folds it, or selects the parent
 * when folded or with nothing stacked; `o` opens the row's own link (the
 * pull request in Bitbucket, an orphaned issue in Jira), `i` its first Jira
 * issue; `x` selects the root pull request of the stack and folds it. Enter
 * and Space on the row itself fold or unfold its stack, only while it shows
 * the focus ring: a click focuses a row too (it is focusable), and Space
 * must still scroll the page after it.
 *
 * The rows are the `.pull-request` rows, then the `.orphaned-issue` rows. The
 * rows displayed come from the last filter pass (filterBranches), never from
 * the styles; what a collapse hides is read when a key is pressed
 * (isCollapsedAway, tree-toggle.js), since collapsing runs no filter pass.
 * The rows are focusable (tabindex="-1", app-render.js) but outside the Tab
 * order. app-shell.js calls handleTreeKey after its own guards (typing, Ctrl,
 * Alt or Meta, the help, an open multi-select, the open drawer), so nothing
 * here checks them; Shift is left alone here (Shift+Space scrolls up). The
 * arrows act only from a row or from the page itself (the focus on no
 * control): on a control of the sidebar they are its own (ArrowDown opens a
 * filter list).
 * Which row is wanted, and the URL, belong to app.js: a selection by a key
 * goes through the `select` it passes.
 *
 * Nothing here touches the DOM at import time, so it can be unit-tested with
 * node:test.
 */

import { isCollapsedAway, setPullRequestCollapsed } from './tree-toggle.js';

const rowSelector = '.pull-request, .orphaned-issue';

/** The row an element is in (the row itself, or a link or a button of it); null elsewhere */
export function rowOf(target) {
    return typeof target?.closest === 'function' ? target.closest(rowSelector) : null;
}

/**
 * The key of a row, as the `selected` URL parameter carries it: the
 * pull-request key of the render's data-id (pull-request-key.mjs), the issue
 * key of an orphaned issue (a Jira key holds no `/`, a pull-request key does)
 */
export function rowKey(row) {
    return row.dataset.id ?? row.dataset.issueKey;
}

/**
 * Selects, among the rows of a filter pass, the row of `wantedKey`, or the
 * first row when none is (no key, a row gone or filtered out), and clears
 * `previous`. A row folded away stays selected.
 * @returns {Element | null} the row selected; null without a row shown
 */
export function paintSelectedRow(shownRows, wantedKey, previous) {
    const row = (wantedKey && shownRows.find(candidate => rowKey(candidate) === wantedKey)) || shownRows[0] || null;
    if (previous && previous !== row) {
        previous.classList.toggle('selected', false);
        previous.removeAttribute('aria-current');
    }
    if (row) {
        row.classList.toggle('selected', true);
        row.setAttribute('aria-current', 'true');
    }
    return row;
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
 * The pull request a row is stacked on; null for a root pull request and an
 * orphaned issue. A stacked pull request lives in the `.children` container
 * that follows its parent.
 */
export function parentRowOf(row) {
    const container = row.parentElement;
    return container?.classList.contains('children') ? container.previousElementSibling : null;
}

/** The root pull request of the stack a row is in, the row itself for a root; null for an orphaned issue */
export function rootRowOf(row) {
    let current = row;
    while (current && !current.classList.contains('pull-request-root')) current = parentRowOf(current);
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

const isReachable = row => !isCollapsedAway(row);

const arrowKeys = ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'];

// The focus on no control: the page itself
function isPageTarget(target) {
    return target?.tagName === 'BODY' || target?.tagName === 'HTML';
}

/**
 * Handles a tree key.
 * @param {KeyboardEvent} event
 * @param {object} context
 * @param {Element[]} context.shownRows - the rows of the last filter pass
 * @param {Element | null} [context.selectedRow] - the row selected (paintSelectedRow)
 * @param {(row: Element) => void} [context.select] - selects a row the keys move to
 * @param {() => number} [context.viewTop] - the top of the tree's scroll area (a viewport coordinate)
 * @returns {boolean} whether the key was taken (the caller then prevents its default)
 */
export function handleTreeKey(event, { shownRows, selectedRow = null, select = () => {}, viewTop = () => 0 }) {
    if (event.shiftKey) return false;
    const focusedRow = rowOf(event.target);
    if (arrowKeys.includes(event.key) && !focusedRow && !isPageTarget(event.target)) return false;
    const row = focusedRow ?? (selectedRow?.isConnected ? selectedRow : null);
    const moveTo = next => {
        if (!next) return;
        select(next);
        focusRow(next);
    };
    switch (event.key) {
        case 'ArrowDown':
        case 'ArrowUp':
        case 'j':
        case 'k': {
            // No row shown, or a message replaced the tree since the last pass (its rows are gone, all at once)
            if (!shownRows[0]?.isConnected) return false;
            const step = event.key === 'ArrowDown' || event.key === 'j' ? 1 : -1;
            // No row to start from: start where the reader is
            moveTo(row && shownRows.includes(row)
                ? nextRow(shownRows, row, step, isReachable)
                : firstRowInView(shownRows, isReachable, viewTop()));
            return true;
        }
        case 'ArrowRight': {
            if (!row || !hasStack(row)) return false;
            if (row.classList.contains('collapsed')) {
                setPullRequestCollapsed(row, false);
            } else {
                // The first stacked pull request shown: the next row of the pass, if it is in the stack
                const next = shownRows[shownRows.indexOf(row) + 1];
                if (next && row.nextElementSibling.contains(next)) moveTo(next);
            }
            return true;
        }
        case 'ArrowLeft': {
            if (!row) return false;
            if (hasStack(row) && !row.classList.contains('collapsed')) {
                setPullRequestCollapsed(row, true);
                return true;
            }
            const parent = parentRowOf(row);
            if (!parent) return false;
            moveTo(parent);
            return true;
        }
        case 'o':
            return openLink(row, '.pull-request-header > a');
        case 'i':
            return openLink(row, '.jira-issue-link');
        case 'x': {
            const root = row && rootRowOf(row);
            if (!root) return false;
            moveTo(root);
            setPullRequestCollapsed(root, true);
            return true;
        }
        case 'Enter':
        case ' ':
            // On a link or a button inside the row, on a row focused by a click, or with nothing to fold, the key keeps its own meaning
            if (!focusedRow || event.target !== focusedRow || !focusedRow.matches(':focus-visible') || !hasStack(focusedRow)) return false;
            // A held key folds once
            if (!event.repeat) setPullRequestCollapsed(focusedRow, !focusedRow.classList.contains('collapsed'));
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
