import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextRow, firstRowInView, rootRowOf, handleTreeKey, captureFocusedRow, restoreFocusedRow } from '../public/tree-keyboard.js';
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
    const outside = node({ tag: 'input' });
    const document = fakeDocument(node({ classes: ['body'] }, pane, outside));
    return { rows, shown: [rows.one, rows.two, rows.three, rows.four, rows.orphan], rootBranch, pane, outside, document };
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

test('j or k without a focused row start at the first row in view, not at the top of the tree', () => {
    const { rows, shown, outside, document } = sampleTree();
    [rows.one, rows.two, rows.three, rows.four, rows.orphan].forEach((row, index) => { row.rect = { top: index * 100 - 150, bottom: index * 100 - 50 }; });
    handleTreeKey(key('j', outside), shown, { viewTop: () => 40 });
    handleTreeKey(key('k', outside), shown, { viewTop: () => 140 });
    assert.deepEqual(focused(document), [rows.three, rows.four]);
});

test('rootRowOf climbs the stack to its root pull request; an orphaned issue has none', () => {
    const { rows } = sampleTree();
    assert.equal(rootRowOf(rows.three), rows.one);
    assert.equal(rootRowOf(rows.two), rows.one);
    assert.equal(rootRowOf(rows.one), rows.one);
    assert.equal(rootRowOf(rows.orphan), null);
});

test('j and k focus the next and previous rows shown, from the row holding the focus or a link inside it, and scroll them into view', () => {
    const { rows, shown, outside, document } = sampleTree();
    assert.equal(handleTreeKey(key('j', outside), shown), true);
    assert.deepEqual(document.events, [['focus', rows.one, { preventScroll: true }], ['scroll', rows.one, { block: 'nearest' }]]);
    handleTreeKey(key('j', rows.one.querySelector('.pull-request-link')), shown);
    handleTreeKey(key('j', rows.two), shown);
    handleTreeKey(key('k', rows.three), shown);
    assert.deepEqual(focused(document), [rows.one, rows.two, rows.three, rows.two]);
    // At either end: nothing moves, the key is still taken
    document.events.length = 0;
    assert.equal(handleTreeKey(key('k', rows.one), shown), true);
    assert.equal(handleTreeKey(key('j', rows.orphan), shown), true);
    assert.deepEqual(document.events, []);
});

test('j and k skip what a collapse hides, from a row hidden by "Collapse all" too, and the rows no longer in the page', () => {
    const { rows, shown, rootBranch, document } = sampleTree();
    setPullRequestCollapsed(rows.two, true);
    handleTreeKey(key('j', rows.two), shown);
    assert.deepEqual(focused(document), [rows.four]);
    // The focused row collapsed away with its branch: its place in the list says where to go on
    setRootBranchCollapsed(rootBranch, true);
    handleTreeKey(key('j', rows.two), shown);
    assert.deepEqual(focused(document), [rows.four, rows.orphan]);
    // A message replaced the tree: the rows of the last pass are gone, all at once
    document.events.length = 0;
    assert.equal(handleTreeKey(key('j', node()), [pullRequest('detached'), pullRequest('detached too')]), true);
    assert.deepEqual(document.events, []);
});

test('Enter and Space on the row itself, showing the focus ring, fold or unfold its stacked pull requests, once for a held key', () => {
    const { rows, shown } = sampleTree();
    rows.one.focus();
    assert.equal(handleTreeKey(key('Enter', rows.one), shown), true);
    assert.ok(rows.one.classList.contains('collapsed'));
    assert.equal(rows.one.nextElementSibling.hidden, true);
    assert.equal(handleTreeKey(key(' ', rows.one), shown), true);
    assert.ok(!rows.one.classList.contains('collapsed'));
    assert.equal(handleTreeKey({ key: 'Enter', target: rows.one, repeat: true }, shown), true);
    assert.ok(!rows.one.classList.contains('collapsed'));
});

test('Enter and Space keep their own meaning on a link or a button of a row, on a row focused by a click, on a row with nothing to fold, and with Shift', () => {
    const { rows, shown, document } = sampleTree();
    const link = rows.one.querySelector('.pull-request-link');
    link.focus();
    assert.equal(handleTreeKey(key('Enter', link), shown), false);
    assert.equal(handleTreeKey(key(' ', rows.one.querySelector('.toggle-button')), shown), false);
    // A click focuses the row without the focus ring: Space scrolls the page
    document.keyboard = false;
    rows.one.focus();
    assert.equal(handleTreeKey(key(' ', rows.one), shown), false);
    document.keyboard = true;
    assert.equal(handleTreeKey({ key: ' ', target: rows.one, shiftKey: true }, shown), false);
    assert.equal(handleTreeKey({ key: 'Enter', target: rows.one, shiftKey: true }, shown), false);
    assert.ok(!rows.one.classList.contains('collapsed'));
    rows.four.focus();
    assert.equal(handleTreeKey(key(' ', rows.four), shown), false);
    rows.orphan.focus();
    assert.equal(handleTreeKey(key('Enter', rows.orphan), shown), false);
    assert.equal(handleTreeKey(key('Enter', node()), shown), false);
});

test('x focuses the root pull request of the stack and folds it; nothing for an orphaned issue or without a row', () => {
    const { rows, shown, outside, document } = sampleTree();
    assert.equal(handleTreeKey(key('x', rows.three.querySelector('.pull-request-link')), shown), true);
    assert.deepEqual(focused(document), [rows.one]);
    assert.ok(rows.one.classList.contains('collapsed'));
    assert.equal(rows.one.nextElementSibling.hidden, true);
    // A root without stacked pull requests is only focused
    assert.equal(handleTreeKey(key('x', rows.four), shown), true);
    assert.ok(!rows.four.classList.contains('collapsed'));
    assert.equal(handleTreeKey(key('x', rows.orphan), shown), false);
    assert.equal(handleTreeKey(key('x', outside), shown), false);
});

test('o clicks the row\'s own link (the issue of an orphaned issue), i its first Jira issue; nothing without one', () => {
    const { rows, shown, outside, document } = sampleTree();
    const clicked = () => document.events.filter(([kind]) => kind === 'click').map(([, element]) => element);
    assert.equal(handleTreeKey(key('o', rows.one), shown), true);
    assert.equal(handleTreeKey(key('i', rows.one.querySelector('.toggle-button')), shown), true);
    assert.equal(handleTreeKey(key('o', rows.orphan), shown), true);
    assert.equal(handleTreeKey(key('i', rows.orphan), shown), true);
    assert.deepEqual(clicked(), [
        rows.one.querySelector('.pull-request-link'),
        rows.one.querySelector('.jira-issue-link'),
        rows.orphan.querySelector('.jira-issue-link'),
        rows.orphan.querySelector('.jira-issue-link')
    ]);
    assert.equal(handleTreeKey(key('i', rows.four), shown), false);
    assert.equal(handleTreeKey(key('o', outside), shown), false);
    assert.equal(handleTreeKey(key('q', rows.one), shown), false);
    assert.equal(clicked().length, 4);
});

test('the row or the control of a row holding the focus is focused again, without scrolling, among the rows of the next pass, when it is still in sight', () => {
    const before = sampleTree();
    const linkFocus = captureFocusedRow(before.pane, before.rows.two.querySelector('.pull-request-link'));
    const rowFocus = captureFocusedRow(before.pane, before.rows.orphan);
    assert.deepEqual(linkFocus, { key: 'repo-one/2', control: 1 }); // after the toggle button
    assert.deepEqual(rowFocus, { key: 'issue:PROJ-9', control: -1 });
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
