/**
 * Keyboard navigation of the tree and its selected row (#118). One row is
 * selected whenever a row is shown (class `selected`, `aria-current`): the
 * keys act on the row holding the focus, or holding the focused link or
 * button, else on the selected row (app.js keeps the two the same row).
 * `↓` / `j` and `↑` / `k` select the next or the previous row shown; `→`
 * unfolds the row's stack, or selects its first stacked pull request when
 * unfolded; `←` folds it, or selects the parent when folded or with nothing
 * stacked shown; a selected row folded out of sight takes only `↓` / `↑`; `o` opens the row's own link (the
 * pull request in Bitbucket, an orphaned issue in Jira), `i` its first Jira
 * issue; `x` selects the root pull request of the stack and folds it. Enter
 * and Space on the row itself fold or unfold its stack, only while it shows
 * the focus ring: a click focuses a row too (it is focusable), and Space
 * must still scroll the page after it.
 *
 * The rows are the root-branch headers (`.root-branch-header`, folding
 * their branch, `o` opening the branch), the `.pull-request` rows under each,
 * then the `.orphaned-issue` rows. A header and a pull request are built
 * alike: the container of what they fold follows them (`.root-branch-content`,
 * `.children`), so the stack, the parent and the first child are found the
 * same way for both. The
 * rows displayed come from the last filter pass (filterBranches), never from
 * the styles; what a collapse hides is read when a key is pressed
 * (isCollapsedAway, tree-toggle.js), since collapsing runs no filter pass.
 * The rows are focusable (tabindex="-1", app-render.js) but outside the Tab
 * order. app-shell.js calls handleTreeKey after its own guards (typing, Ctrl,
 * Alt or Meta, the help, an open multi-select, the open drawer), so nothing
 * here checks them; Shift is left alone here (Shift+Space scrolls up). The
 * arrows act only from a row or from the page itself (the focus on no
 * control) after a click in the tree's pane: on a control of the sidebar
 * they are its own (ArrowDown opens a filter list), and after a click in the
 * sidebar or the banner they scroll it.
 * Which row is wanted, and the URL, belong to app.js: a selection by a key
 * goes through the `select` it passes.
 *
 * Nothing here touches the DOM at import time, so it can be unit-tested with
 * node:test.
 */

import { isCollapsedAway, setPullRequestCollapsed, setRootBranchCollapsed } from './tree-toggle.js';

const rowSelector = '.root-branch-header, .pull-request, .orphaned-issue';

const isBranchHeader = row => row.classList.contains('root-branch-header');

// Whether the row's branch or stack is folded, and folding it: a header folds its root branch
function isFolded(row) {
    return (isBranchHeader(row) ? row.parentElement : row).classList.contains('collapsed');
}

function setFolded(row, folded) {
    if (isBranchHeader(row)) {
        setRootBranchCollapsed(row.parentElement, folded);
    } else {
        setPullRequestCollapsed(row, folded);
    }
}

/** The row an element is in (the row itself, or a link or a button of it); null elsewhere */
export function rowOf(target) {
    return typeof target?.closest === 'function' ? target.closest(rowSelector) : null;
}

/**
 * The key of a row, as the `selected` URL parameter carries it: the
 * pull-request key of the render's data-id (`repository/id`), the issue key
 * of an orphaned issue, the root-branch key of a header (`repository:branch`)
 * (pull-request-key.mjs). A Jira key holds neither `/` nor `:`, git forbids
 * `:` in a branch name: the three never meet.
 */
export function rowKey(row) {
    return row.dataset.id ?? row.dataset.issueKey ?? row.parentElement?.dataset.rootBranchKey;
}

/**
 * Selects, among the rows of a filter pass, the row of `wantedKey`, or when
 * none is (no key, a row gone or filtered out) the first pull request the
 * filters keep (not one shown only for a pull request stacked on it), in
 * sight before one folded away, the first row without one; clears
 * `previous`. A wanted row folded away gives way to the row in sight that
 * folds it (rowInSightOf): a fold stored before a reload (#142) keeps the
 * row out of sight, its folded parent shows where it is. A row folded away
 * with no row in sight above it (a collapsed repository) stays selected.
 * @returns {Element | null} the row selected; null without a row shown
 */
export function paintSelectedRow(shownRows, wantedKey, previous) {
    const isPullRequest = candidate => candidate.classList.contains('pull-request');
    const isKept = candidate => isPullRequest(candidate) && !candidate.classList.contains('filtered');
    const wanted = wantedKey && shownRows.find(candidate => rowKey(candidate) === wantedKey);
    const row = (wanted && (rowInSightOf(wanted) ?? wanted)) ||
        shownRows.find(candidate => isKept(candidate) && !isCollapsedAway(candidate)) ||
        shownRows.find(isKept) ||
        shownRows.find(isPullRequest) || shownRows[0] || null;
    return markSelectedRow(row, previous);
}

/**
 * The row in sight for `row`: the row itself when no collapse hides it,
 * else the nearest row above it that folds it (its folded pull request, the
 * header of its folded branch); null when none is in sight (a collapsed
 * repository, or the orphaned-issues block, hides the rows and their headers).
 */
export function rowInSightOf(row) {
    let current = row;
    while (current && isCollapsedAway(current)) current = parentRowOf(current);
    return current;
}

/** Marks `row` selected (none when null) and clears `previous`; returns `row` */
export function markSelectedRow(row, previous) {
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

// The container of what a row folds: a pull request's stack, a header's branch
function foldedContainerOf(row) {
    const container = row.nextElementSibling;
    return container?.classList.contains('children') || container?.classList.contains('root-branch-content') ? container : null;
}

/**
 * The first pull request a row folds (its stack, or a header's branch) that
 * the pass shows, folded away or not; null when the row folds none or the
 * filters hide them all. The pass lists the rows in document order: the row
 * after it, if it is in that container.
 */
export function firstShownChild(row, shownRows) {
    const container = foldedContainerOf(row);
    if (!container) return null;
    const next = shownRows[shownRows.indexOf(row) + 1];
    return next && container.contains(next) ? next : null;
}

/** The focus on no control: the page itself */
export function isPageTarget(target) {
    const document = target?.ownerDocument;
    return Boolean(document) && (target === document.body || target === document.documentElement);
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
 * The row a row is under: the pull request it is stacked on, the header of
 * its branch for a root pull request; null for a header and an orphaned
 * issue. A row lives in the container that follows its parent.
 */
export function parentRowOf(row) {
    const container = row.parentElement;
    return container?.classList.contains('children') || container?.classList.contains('root-branch-content')
        ? container.previousElementSibling
        : null;
}

/** The root pull request of the stack a row is in, the row itself for a root; null for a header and an orphaned issue */
export function rootRowOf(row) {
    if (!row.classList.contains('pull-request')) return null;
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

/**
 * Handles a tree key.
 * @param {KeyboardEvent} event
 * @param {object} context
 * @param {Element[]} context.shownRows - the rows of the last filter pass
 * @param {Element | null} [context.selectedRow] - the row selected (paintSelectedRow)
 * @param {(row: Element) => void} [context.select] - selects a row the keys move to
 * @param {boolean} [context.arrowsFromPage] - whether the arrows act with the focus on the page
 *   itself: not after a click in the sidebar or the banner, where they scroll
 * @returns {boolean} whether the key was taken (the caller then prevents its default)
 */
export function handleTreeKey(event, { shownRows, selectedRow = null, select = () => {}, arrowsFromPage = true }) {
    if (event.shiftKey) return false;
    const focusedRow = rowOf(event.target);
    if (arrowKeys.includes(event.key) && !focusedRow && !(arrowsFromPage && isPageTarget(event.target))) return false;
    const row = focusedRow ?? (selectedRow?.isConnected ? selectedRow : null);
    // What the keys but ↓ / ↑ act on: a row in sight
    const rowInSight = row && isReachable(row) ? row : null;
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
            // From the row's place in the pass, folded away or not; the first row without one
            moveTo(nextRow(shownRows, row, event.key === 'ArrowDown' || event.key === 'j' ? 1 : -1, isReachable));
            return true;
        }
        case 'ArrowRight': {
            const child = rowInSight && firstShownChild(rowInSight, shownRows);
            if (!child) return false;
            if (isFolded(rowInSight)) {
                setFolded(rowInSight, false);
            } else {
                moveTo(child);
            }
            return true;
        }
        case 'ArrowLeft': {
            if (!rowInSight) return false;
            if (firstShownChild(rowInSight, shownRows) && !isFolded(rowInSight)) {
                setFolded(rowInSight, true);
                return true;
            }
            const parent = parentRowOf(rowInSight);
            if (!parent) return false;
            moveTo(parent);
            return true;
        }
        case 'o':
            return openLink(rowInSight, '.pull-request-header > a, .root-branch-link');
        case 'i':
            return openLink(rowInSight, '.jira-issue-link');
        case 'x': {
            const root = rowInSight && rootRowOf(rowInSight);
            if (!root) return false;
            moveTo(root);
            setPullRequestCollapsed(root, true);
            return true;
        }
        case 'Enter':
        case ' ':
            // On a link or a button inside the row, on a row focused by a click, or with nothing to fold, the key keeps its own meaning
            if (!focusedRow || event.target !== focusedRow || !focusedRow.matches(':focus-visible') || !firstShownChild(focusedRow, shownRows)) return false;
            // A held key folds once
            if (!event.repeat) setFolded(focusedRow, !isFolded(focusedRow));
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
