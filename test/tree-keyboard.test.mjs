import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextRow, firstRowInView, parentRowOf, rootRowOf, rowKey, paintSelectedRow, handleTreeKey, captureFocusedRow, restoreFocusedRow } from '../public/tree-keyboard.js';
import { setPullRequestCollapsed, setRootBranchCollapsed } from '../public/tree-toggle.js';
import { node, fakeDocument } from './fake-dom.mjs';

function pullRequest(id, { root = false, issue = true } = {}) {
    return node({ classes: ['pull-request', ...(root ? ['pull-request-root'] : [])], dataset: { id } },
        node({ classes: ['pull-request-header'] }, node({ tag: 'button', classes: ['toggle-button'] }), node({ tag: 'a', classes: ['pull-request-link'] })),
        ...(issue ? [node({ classes: ['pull-request-issues'] }, node({ tag: 'a', classes: ['jira-issue-link'] }))] : []));
}

// repo-one/1 stacks 2, which stacks 3; repo-one/4 stacks nothing and links no issue; then one orphaned issue
function sampleTree() {
    const rows = {
        one: pullRequest('repo-one/1', { root: true }),
        two: pullRequest('repo-one/2'),
        three: pullRequest('repo-one/3'),
        four: pullRequest('repo-one/4', { root: true, issue: false }),
        orphan: node({ classes: ['orphaned-issue'], dataset: { issueKey: 'PROJ-9' } },
            node({ classes: ['pull-request-header'] }, node({ tag: 'a', classes: ['jira-issue-link'] })))
    };
    const rootBranch = node({ classes: ['root-branch'] }, node({ classes: ['root-branch-content'] },
        rows.one,
        node({ classes: ['children'] }, rows.two, node({ classes: ['children'] }, rows.three)),
        rows.four));
    const pane = node({ classes: ['pane'] },
        node({ classes: ['repository'] }, node({ classes: ['repository-content'] }, rootBranch)),
        node({ classes: ['repository', 'orphaned-issues'] }, node({ classes: ['repository-content'] }, rows.orphan)));
    const outside = node({ tag: 'button' });
    const body = node({ tag: 'body' }, pane, outside);
    const document = fakeDocument(body);
    const shown = [rows.one, rows.two, rows.three, rows.four, rows.orphan];
    // What app.js passes: the rows of the pass, the row selected, and the rows the keys select
    const selected = [];
    const context = (selectedRow = null) => ({ shownRows: shown, selectedRow, select: row => selected.push(row) });
    return { rows, shown, rootBranch, pane, outside, body, document, selected, context };
}

const key = (name, target) => ({ key: name, target });
const focused = document => document.events.filter(([kind]) => kind === 'focus').map(([, element]) => element);

test('nextRow steps over the rows not reachable, stays put at either end, and starts at the first reachable row without a current one', () => {
    const rows = ['a', 'b', 'c', 'd'];
    const all = () => true;
    assert.equal(nextRow(rows, 'b', 1, all), 'c');
    assert.equal(nextRow(rows, 'b', -1, all), 'a');
    assert.equal(nextRow(rows, 'b', 1, row => row !== 'c'), 'd');
    assert.equal(nextRow(rows, 'd', 1, all), null);
    assert.equal(nextRow(rows, 'a', -1, all), null);
    assert.equal(nextRow(rows, null, -1, row => row !== 'a'), 'b');
    assert.equal(nextRow(rows, 'gone', 1, all), 'a');
    assert.equal(nextRow([], null, 1, all), null);
});

test('firstRowInView: the first reachable row starting at or below the top of the view, the last reachable one when all start above', () => {
    const rows = [10, -40, 120, 300].map(top => ({ top, getBoundingClientRect: () => ({ top }) }));
    const all = () => true;
    assert.equal(firstRowInView(rows, all, 0), rows[0]);
    assert.equal(firstRowInView(rows, all, 100), rows[2]);
    assert.equal(firstRowInView(rows, row => row !== rows[2], 100), rows[3]);
    assert.equal(firstRowInView(rows, row => row !== rows[3], 400), rows[2]);
    assert.equal(firstRowInView([], all, 0), null);
});

test('parentRowOf and rootRowOf climb the stack; a root and an orphaned issue have no parent, an orphaned issue no root', () => {
    const { rows } = sampleTree();
    assert.equal(parentRowOf(rows.three), rows.two);
    assert.equal(parentRowOf(rows.two), rows.one);
    assert.equal(parentRowOf(rows.one), null);
    assert.equal(parentRowOf(rows.orphan), null);
    assert.equal(rootRowOf(rows.three), rows.one);
    assert.equal(rootRowOf(rows.one), rows.one);
    assert.equal(rootRowOf(rows.orphan), null);
});

test('rowKey: the pull-request key of a pull request, the issue key of an orphaned issue', () => {
    const { rows } = sampleTree();
    assert.equal(rowKey(rows.two), 'repo-one/2');
    assert.equal(rowKey(rows.orphan), 'PROJ-9');
});

test('paintSelectedRow selects the row wanted when the pass shows it, the first row otherwise, and clears the previous one', () => {
    const { rows, shown } = sampleTree();
    assert.equal(paintSelectedRow(shown, 'repo-one/3', null), rows.three);
    assert.ok(rows.three.classList.contains('selected'));
    assert.equal(rows.three.getAttribute('aria-current'), 'true');
    assert.equal(paintSelectedRow(shown, 'PROJ-9', rows.three), rows.orphan);
    assert.ok(!rows.three.classList.contains('selected'));
    assert.equal(rows.three.getAttribute('aria-current'), null);
    // Gone, or hidden by a filter (not in the pass), or nothing wanted: the first row
    assert.equal(paintSelectedRow(shown, 'repo-one/404', rows.orphan), rows.one);
    assert.equal(paintSelectedRow(shown.slice(1), 'repo-one/1', rows.one), rows.two);
    assert.equal(paintSelectedRow(shown, null, rows.two), rows.one);
    assert.equal(paintSelectedRow([], 'repo-one/1', rows.one), null);
    assert.ok(!rows.one.classList.contains('selected'));
});

test('↓ and ↑ (j and k) select, focus and scroll to the next and previous rows, from the focused row, else from the selected one', () => {
    const { rows, outside, body, document, selected, context } = sampleTree();
    assert.equal(handleTreeKey(key('ArrowDown', rows.one.querySelector('.pull-request-link')), context()), true);
    assert.deepEqual(document.events, [['focus', rows.two, { preventScroll: true }], ['scroll', rows.two, { block: 'nearest' }]]);
    handleTreeKey(key('j', rows.two), context());
    handleTreeKey(key('ArrowUp', rows.three), context());
    handleTreeKey(key('k', rows.two), context());
    // The focus on the page itself (after a click outside the rows): from the selected row
    handleTreeKey(key('ArrowDown', body), context(rows.three));
    assert.deepEqual(focused(document), [rows.two, rows.three, rows.two, rows.one, rows.four]);
    assert.deepEqual(selected, [rows.two, rows.three, rows.two, rows.one, rows.four]);
    // On a control of the sidebar the arrows are its own (ArrowDown opens a filter list); the letters are not
    document.events.length = 0;
    for (const arrow of ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight']) assert.equal(handleTreeKey(key(arrow, outside), context(rows.three)), false);
    assert.deepEqual(document.events, []);
    assert.equal(handleTreeKey(key('j', outside), context(rows.three)), true);
    assert.deepEqual(focused(document), [rows.four]);
    // At either end: nothing moves, the key is still taken
    document.events.length = 0;
    assert.equal(handleTreeKey(key('ArrowUp', rows.one), context()), true);
    assert.equal(handleTreeKey(key('ArrowDown', rows.orphan), context()), true);
    assert.deepEqual(document.events, []);
});

test('↓ or ↑ without a row to start from start at the first row in view; without a row shown they scroll the page', () => {
    const { rows, outside, body, document, context } = sampleTree();
    [rows.one, rows.two, rows.three, rows.four, rows.orphan].forEach((row, index) => { row.rect = { top: index * 100 - 150, bottom: index * 100 - 50 }; });
    handleTreeKey(key('ArrowDown', body), { ...context(), viewTop: () => 40 });
    handleTreeKey(key('k', outside), { ...context(), viewTop: () => 140 });
    assert.deepEqual(focused(document), [rows.three, rows.four]);
    // A message replaced the tree (its rows are gone, all at once), or no row is shown
    document.events.length = 0;
    assert.equal(handleTreeKey(key('ArrowDown', body), { shownRows: [pullRequest('detached'), pullRequest('detached too')] }), false);
    assert.equal(handleTreeKey(key('ArrowUp', body), { shownRows: [] }), false);
    assert.deepEqual(document.events, []);
});

test('↓ skips what a collapse hides, from a selected row folded away too', () => {
    const { rows, rootBranch, body, document, context } = sampleTree();
    setPullRequestCollapsed(rows.two, true);
    handleTreeKey(key('ArrowDown', rows.two), context());
    assert.deepEqual(focused(document), [rows.four]);
    // "Collapse all" folded the selected row away: its place in the list says where to go on
    setRootBranchCollapsed(rootBranch, true);
    handleTreeKey(key('ArrowDown', body), context(rows.two));
    assert.deepEqual(focused(document), [rows.four, rows.orphan]);
});

test('→ unfolds the row\'s stack, then selects its first stacked pull request shown; nothing on a row without a stack', () => {
    const { rows, shown, body, document, selected, context } = sampleTree();
    setPullRequestCollapsed(rows.one, true);
    assert.equal(handleTreeKey(key('ArrowRight', body), context(rows.one)), true);
    assert.ok(!rows.one.classList.contains('collapsed'));
    assert.deepEqual(focused(document), []);
    assert.equal(handleTreeKey(key('ArrowRight', rows.one), context()), true);
    assert.deepEqual(focused(document), [rows.two]);
    assert.deepEqual(selected, [rows.two]);
    // The stacked pull requests all filtered out: the next row of the pass is outside the stack, nothing moves
    assert.equal(handleTreeKey(key('ArrowRight', rows.two), { ...context(), shownRows: shown.filter(row => row !== rows.three) }), true);
    assert.deepEqual(focused(document), [rows.two]);
    assert.equal(handleTreeKey(key('ArrowRight', rows.three), context()), false);
    assert.equal(handleTreeKey(key('ArrowRight', rows.orphan), context()), false);
    assert.equal(handleTreeKey(key('ArrowRight', body), context()), false);
});

test('← folds the row\'s stack, then selects its parent; on a row with nothing stacked, the parent; nothing on a root folded or an orphaned issue', () => {
    const { rows, outside, body, document, selected, context } = sampleTree();
    assert.equal(handleTreeKey(key('ArrowLeft', rows.two), context()), true);
    assert.ok(rows.two.classList.contains('collapsed'));
    assert.deepEqual(focused(document), []);
    assert.equal(handleTreeKey(key('ArrowLeft', rows.two), context()), true);
    assert.deepEqual(focused(document), [rows.one]);
    assert.equal(handleTreeKey(key('ArrowLeft', body), context(rows.three)), true);
    assert.deepEqual(focused(document), [rows.one, rows.two]);
    assert.deepEqual(selected, [rows.one, rows.two]);
    setPullRequestCollapsed(rows.one, true);
    assert.equal(handleTreeKey(key('ArrowLeft', rows.one), context()), false);
    assert.equal(handleTreeKey(key('ArrowLeft', rows.four), context()), false);
    assert.equal(handleTreeKey(key('ArrowLeft', rows.orphan), context()), false);
    assert.equal(handleTreeKey(key('ArrowLeft', body), context()), false);
});

test('Enter and Space on the row itself, showing the focus ring, fold or unfold its stacked pull requests, once for a held key', () => {
    const { rows, context } = sampleTree();
    rows.one.focus();
    assert.equal(handleTreeKey(key('Enter', rows.one), context()), true);
    assert.ok(rows.one.classList.contains('collapsed'));
    assert.equal(rows.one.nextElementSibling.hidden, true);
    assert.equal(handleTreeKey(key(' ', rows.one), context()), true);
    assert.ok(!rows.one.classList.contains('collapsed'));
    assert.equal(handleTreeKey({ key: 'Enter', target: rows.one, repeat: true }, context()), true);
    assert.ok(!rows.one.classList.contains('collapsed'));
});

test('Enter and Space keep their own meaning on a link or a button of a row, on a row focused by a click, on a row with nothing to fold, elsewhere, and with Shift', () => {
    const { rows, outside, body, document, context } = sampleTree();
    const link = rows.one.querySelector('.pull-request-link');
    link.focus();
    assert.equal(handleTreeKey(key('Enter', link), context()), false);
    assert.equal(handleTreeKey(key(' ', rows.one.querySelector('.toggle-button')), context()), false);
    // A click focuses the row without the focus ring: Space scrolls the page
    document.keyboard = false;
    rows.one.focus();
    assert.equal(handleTreeKey(key(' ', rows.one), context()), false);
    document.keyboard = true;
    assert.equal(handleTreeKey({ key: ' ', target: rows.one, shiftKey: true }, context()), false);
    assert.equal(handleTreeKey({ key: 'Enter', target: rows.one, shiftKey: true }, context()), false);
    assert.equal(handleTreeKey({ key: 'ArrowDown', target: rows.one, shiftKey: true }, context()), false);
    assert.ok(!rows.one.classList.contains('collapsed'));
    // The selected row is not the target: Space scrolls the page
    assert.equal(handleTreeKey(key(' ', outside), context(rows.one)), false);
    rows.four.focus();
    assert.equal(handleTreeKey(key(' ', rows.four), context()), false);
    rows.orphan.focus();
    assert.equal(handleTreeKey(key('Enter', rows.orphan), context()), false);
});

test('x selects the root pull request of the stack and folds it; nothing for an orphaned issue or without a row', () => {
    const { rows, outside, body, document, selected, context } = sampleTree();
    assert.equal(handleTreeKey(key('x', rows.three.querySelector('.pull-request-link')), context()), true);
    assert.deepEqual(focused(document), [rows.one]);
    assert.deepEqual(selected, [rows.one]);
    assert.ok(rows.one.classList.contains('collapsed'));
    assert.equal(rows.one.nextElementSibling.hidden, true);
    // A root without stacked pull requests is only selected
    assert.equal(handleTreeKey(key('x', outside), context(rows.four)), true);
    assert.ok(!rows.four.classList.contains('collapsed'));
    assert.equal(handleTreeKey(key('x', rows.orphan), context()), false);
    assert.equal(handleTreeKey(key('x', outside), context()), false);
});

test('o clicks the row\'s own link (the issue of an orphaned issue), i its first Jira issue, of the focused or the selected row; nothing without one', () => {
    const { rows, outside, body, document, context } = sampleTree();
    const clicked = () => document.events.filter(([kind]) => kind === 'click').map(([, element]) => element);
    assert.equal(handleTreeKey(key('o', rows.one), context()), true);
    assert.equal(handleTreeKey(key('i', rows.one.querySelector('.toggle-button')), context()), true);
    assert.equal(handleTreeKey(key('o', outside), context(rows.orphan)), true);
    assert.equal(handleTreeKey(key('i', rows.orphan), context()), true);
    assert.deepEqual(clicked(), [
        rows.one.querySelector('.pull-request-link'),
        rows.one.querySelector('.jira-issue-link'),
        rows.orphan.querySelector('.jira-issue-link'),
        rows.orphan.querySelector('.jira-issue-link')
    ]);
    assert.equal(handleTreeKey(key('i', rows.four), context()), false);
    assert.equal(handleTreeKey(key('o', outside), context()), false);
    assert.equal(handleTreeKey(key('o', outside), context(pullRequest('detached'))), false);
    assert.equal(handleTreeKey(key('q', rows.one), context()), false);
    assert.equal(clicked().length, 4);
});

test('the row or the control of a row holding the focus is focused again, without scrolling, among the rows of the next pass, when it is still in sight', () => {
    const before = sampleTree();
    const linkFocus = captureFocusedRow(before.pane, before.rows.two.querySelector('.pull-request-link'));
    const rowFocus = captureFocusedRow(before.pane, before.rows.orphan);
    assert.deepEqual(linkFocus, { key: 'repo-one/2', control: 1 }); // after the toggle button
    assert.deepEqual(rowFocus, { key: 'PROJ-9', control: -1 });
    assert.equal(captureFocusedRow(before.pane, before.outside), null);
    assert.equal(captureFocusedRow(before.pane, before.pane), null);
    assert.equal(captureFocusedRow(before.pane, null), null);

    const after = sampleTree();
    restoreFocusedRow(linkFocus, after.shown);
    restoreFocusedRow(rowFocus, after.shown);
    assert.deepEqual(after.document.events, [['focus', after.rows.two.querySelector('.pull-request-link'), { preventScroll: true }], ['focus', after.rows.orphan, { preventScroll: true }]]);
    // Gone, collapsed away, or nothing captured: the focus stays where the browser put it
    after.document.events.length = 0;
    restoreFocusedRow({ key: 'repo-one/404', control: -1 }, after.shown);
    restoreFocusedRow(null, after.shown);
    setPullRequestCollapsed(after.rows.one, true);
    restoreFocusedRow(linkFocus, after.shown);
    assert.deepEqual(after.document.events, []);
});
