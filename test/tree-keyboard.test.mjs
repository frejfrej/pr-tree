import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextRow, firstShownChild, isPageTarget, parentRowOf, rootRowOf, rowKey, paintSelectedRow, markSelectedRow, rowInSightOf, handleTreeKey, captureFocusedRow, restoreFocusedRow } from '../public/tree-keyboard.js';
import { setPullRequestCollapsed, setRootBranchCollapsed } from '../public/tree-toggle.js';
import { node, fakeDocument } from './fake-dom.mjs';

function pullRequest(id, { root = false, issue = true } = {}) {
    return node({ classes: ['pull-request', ...(root ? ['pull-request-root'] : [])], dataset: { id } },
        node({ classes: ['pull-request-header'] }, node({ tag: 'button', classes: ['toggle-button'] }), node({ tag: 'a', classes: ['pull-request-link'] })),
        ...(issue ? [node({ classes: ['pull-request-issues'] }, node({ tag: 'a', classes: ['jira-issue-link'] }))] : []),
        node({ classes: ['participants'] },
            node({ tag: 'span', classes: ['branch-actions'] }, node({ tag: 'button', classes: ['copy-button', 'copy-branch'] }), node({ tag: 'button', classes: ['copy-button', 'copy-switch'] }))));
}

// The header of branch main; repo-one/1 stacks 2, which stacks 3; repo-one/4 stacks nothing and links no issue; then one orphaned issue
function sampleTree() {
    const rows = {
        branch: node({ classes: ['root-branch-header'] },
            node({ tag: 'button', classes: ['toggle-button'] }), node({ tag: 'h3' }, node({ tag: 'a', classes: ['root-branch-link'] }))),
        one: pullRequest('repo-one/1', { root: true }),
        two: pullRequest('repo-one/2'),
        three: pullRequest('repo-one/3'),
        four: pullRequest('repo-one/4', { root: true, issue: false }),
        orphan: node({ classes: ['orphaned-issue'], dataset: { issueKey: 'PROJ-9' } },
            node({ classes: ['pull-request-header'] }, node({ tag: 'a', classes: ['jira-issue-link'] })))
    };
    const rootBranch = node({ classes: ['root-branch'], dataset: { rootBranchKey: 'repo-one:main' } }, rows.branch, node({ classes: ['root-branch-content'] },
        rows.one,
        node({ classes: ['children'] }, rows.two, node({ classes: ['children'] }, rows.three)),
        rows.four));
    const pane = node({ classes: ['pane'] },
        node({ classes: ['repository'] }, node({ classes: ['repository-content'] }, rootBranch)),
        node({ classes: ['repository', 'orphaned-issues'] }, node({ classes: ['repository-content'] }, rows.orphan)));
    const outside = node({ tag: 'button' });
    const body = node({ tag: 'body' }, pane, outside);
    const document = fakeDocument(body);
    const shown = [rows.branch, rows.one, rows.two, rows.three, rows.four, rows.orphan];
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

test('firstShownChild: the first stacked pull request the pass shows, folded away or not; none when the filters hide them all', () => {
    const { rows, shown } = sampleTree();
    assert.equal(firstShownChild(rows.one, shown), rows.two);
    assert.equal(firstShownChild(rows.branch, shown), rows.one);
    setPullRequestCollapsed(rows.one, true);
    assert.equal(firstShownChild(rows.one, shown), rows.two);
    assert.equal(firstShownChild(rows.two, shown.filter(row => row !== rows.three)), null);
    assert.equal(firstShownChild(rows.three, shown), null);
    assert.equal(firstShownChild(rows.orphan, shown), null);
});

test('isPageTarget: the page itself, not an element of it', () => {
    const { rows, body, outside } = sampleTree();
    assert.equal(isPageTarget(body), true);
    assert.equal(isPageTarget(outside), false);
    assert.equal(isPageTarget(rows.one), false);
    assert.equal(isPageTarget(null), false);
});

test('parentRowOf and rootRowOf climb the stack, to the branch header for a root; a header and an orphaned issue have no parent nor root', () => {
    const { rows } = sampleTree();
    assert.equal(parentRowOf(rows.three), rows.two);
    assert.equal(parentRowOf(rows.two), rows.one);
    assert.equal(parentRowOf(rows.one), rows.branch);
    assert.equal(parentRowOf(rows.branch), null);
    assert.equal(parentRowOf(rows.orphan), null);
    assert.equal(rootRowOf(rows.branch), null);
    assert.equal(rootRowOf(rows.three), rows.one);
    assert.equal(rootRowOf(rows.one), rows.one);
    assert.equal(rootRowOf(rows.orphan), null);
});

test('rowKey: the pull-request key of a pull request, the issue key of an orphaned issue, the root-branch key of a header', () => {
    const { rows } = sampleTree();
    assert.equal(rowKey(rows.two), 'repo-one/2');
    assert.equal(rowKey(rows.orphan), 'PROJ-9');
    assert.equal(rowKey(rows.branch), 'repo-one:main');
});

test('paintSelectedRow: a wanted row folded away gives way to the row in sight that folds it, and the first pull request is one in sight (#142)', () => {
    const { rows, shown, rootBranch } = sampleTree();
    const repository = rootBranch.parentElement.parentElement;
    assert.equal(rowInSightOf(rows.three), rows.three);
    setPullRequestCollapsed(rows.two, true);
    assert.equal(paintSelectedRow(shown, 'repo-one/3', null), rows.two);
    setPullRequestCollapsed(rows.one, true);
    assert.equal(paintSelectedRow(shown, 'repo-one/3', rows.two), rows.one);
    assert.ok(!rows.two.classList.contains('selected'));
    setRootBranchCollapsed(rootBranch, true);
    assert.equal(paintSelectedRow(shown, 'repo-one/3', rows.one), rows.branch);
    // A collapsed repository hides the header too: no row in sight, the wanted row stays selected
    repository.classList.add('collapsed');
    assert.equal(rowInSightOf(rows.three), null);
    assert.equal(paintSelectedRow(shown, 'repo-one/3', rows.branch), rows.three);
    repository.classList.toggle('collapsed', false);
    setRootBranchCollapsed(rootBranch, false);
    // Nothing wanted: the first pull request the filters keep that is in sight, before one folded away
    rows.one.classList.add('filtered');
    assert.equal(paintSelectedRow(shown, null, rows.three), rows.four);
    setPullRequestCollapsed(rows.one, false);
    assert.equal(paintSelectedRow(shown, null, rows.four), rows.two);
});

test('paintSelectedRow selects the row wanted when the pass shows it, the first pull request otherwise, and clears the previous one', () => {
    const { rows, shown } = sampleTree();
    assert.equal(paintSelectedRow(shown, 'repo-one/3', null), rows.three);
    assert.ok(rows.three.classList.contains('selected'));
    assert.equal(rows.three.getAttribute('aria-current'), 'true');
    assert.equal(paintSelectedRow(shown, 'PROJ-9', rows.three), rows.orphan);
    assert.ok(!rows.three.classList.contains('selected'));
    assert.equal(rows.three.getAttribute('aria-current'), null);
    // Gone, or hidden by a filter (not in the pass), or nothing wanted: the first row
    assert.equal(paintSelectedRow(shown, 'repo-one/404', rows.orphan), rows.one);
    assert.equal(paintSelectedRow(shown.filter(row => row !== rows.one), 'repo-one/1', rows.one), rows.two);
    assert.equal(paintSelectedRow(shown, 'repo-one:main', rows.two), rows.branch);
    assert.equal(paintSelectedRow([rows.orphan], null, rows.branch), rows.orphan); // no pull request: the first row
    // A pull request shown only for one stacked on it is not the one the filters kept
    rows.one.classList.add('filtered');
    assert.equal(paintSelectedRow(shown, null, rows.orphan), rows.two);
    rows.two.classList.add('filtered');
    rows.three.classList.add('filtered');
    rows.four.classList.add('filtered');
    assert.equal(paintSelectedRow(shown, null, rows.two), rows.one);
    // A row marked directly, as a click or a key selects it
    assert.equal(markSelectedRow(rows.four, rows.one), rows.four);
    assert.ok(rows.four.classList.contains('selected') && !rows.one.classList.contains('selected'));
    assert.equal(markSelectedRow(null, rows.four), null);
    assert.ok(!rows.four.classList.contains('selected'));
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
    // After a click in the sidebar or the banner, the arrows from the page scroll there
    document.events.length = 0;
    assert.equal(handleTreeKey(key('ArrowDown', body), { ...context(rows.three), arrowsFromPage: false }), false);
    assert.equal(handleTreeKey(key('ArrowDown', rows.three), { ...context(), arrowsFromPage: false }), true); // from a row they still move
    assert.deepEqual(focused(document), [rows.four]);
    // On a control of the sidebar the arrows are its own (ArrowDown opens a filter list); the letters are not
    document.events.length = 0;
    for (const arrow of ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight']) assert.equal(handleTreeKey(key(arrow, outside), context(rows.three)), false);
    assert.deepEqual(document.events, []);
    assert.equal(handleTreeKey(key('j', outside), context(rows.three)), true);
    assert.deepEqual(focused(document), [rows.four]);
    // ↑ from the first pull request of a branch: its header. At either end: nothing moves, the key is still taken
    handleTreeKey(key('ArrowUp', rows.one), context());
    assert.deepEqual(focused(document), [rows.four, rows.branch]);
    document.events.length = 0;
    assert.equal(handleTreeKey(key('ArrowUp', rows.branch), context()), true);
    assert.equal(handleTreeKey(key('ArrowDown', rows.orphan), context()), true);
    assert.deepEqual(document.events, []);
});

test('↓ or ↑ without a row to start from select the first row in sight; without a row shown they scroll the page', () => {
    const { rows, rootBranch, body, document, context } = sampleTree();
    handleTreeKey(key('ArrowDown', body), context());
    setRootBranchCollapsed(rootBranch, true);
    rootBranch.parentElement.parentElement.classList.add('collapsed'); // the repository: its header goes too
    handleTreeKey(key('k', body), context());
    assert.deepEqual(focused(document), [rows.branch, rows.orphan]);
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
    assert.equal(handleTreeKey(key('ArrowRight', rows.three), context()), false);
    // Nothing of the stack shown: nothing to unfold
    setPullRequestCollapsed(rows.two, true);
    assert.equal(handleTreeKey(key('ArrowRight', rows.two), { ...context(), shownRows: shown.filter(row => row !== rows.three) }), false);
    assert.ok(rows.two.classList.contains('collapsed'));
    assert.equal(handleTreeKey(key('ArrowRight', rows.orphan), context()), false);
    assert.equal(handleTreeKey(key('ArrowRight', body), context()), false);
});

test('← folds the row\'s stack, then selects its parent; on a row with nothing stacked, the parent; a root goes to its branch header; nothing on an orphaned issue', () => {
    const { rows, outside, body, document, selected, context } = sampleTree();
    assert.equal(handleTreeKey(key('ArrowLeft', rows.two), context()), true);
    assert.ok(rows.two.classList.contains('collapsed'));
    assert.deepEqual(focused(document), []);
    assert.equal(handleTreeKey(key('ArrowLeft', rows.two), context()), true);
    assert.deepEqual(focused(document), [rows.one]);
    setPullRequestCollapsed(rows.two, false);
    assert.equal(handleTreeKey(key('ArrowLeft', body), context(rows.three)), true);
    assert.deepEqual(focused(document), [rows.one, rows.two]);
    assert.deepEqual(selected, [rows.one, rows.two]);
    // Nothing of its stack shown: ← goes to the parent at once
    assert.equal(handleTreeKey(key('ArrowLeft', rows.two), { ...context(), shownRows: [rows.one, rows.two, rows.four, rows.orphan] }), true);
    assert.ok(!rows.two.classList.contains('collapsed'));
    assert.deepEqual(focused(document), [rows.one, rows.two, rows.one]);
    setPullRequestCollapsed(rows.one, true);
    assert.equal(handleTreeKey(key('ArrowLeft', rows.one), context()), true);
    assert.equal(focused(document).at(-1), rows.branch);
    assert.equal(handleTreeKey(key('ArrowLeft', rows.four), context()), true);
    assert.equal(focused(document).at(-1), rows.branch);
    assert.equal(handleTreeKey(key('ArrowLeft', rows.orphan), context()), false);
    assert.equal(handleTreeKey(key('ArrowLeft', body), context()), false);
});

test('a root-branch header: → unfolds the branch then selects its first pull request, ← folds it, o opens the branch, Enter and Space fold it; x and i do nothing', () => {
    const { rows, rootBranch, body, document, selected, context } = sampleTree();
    assert.equal(handleTreeKey(key('ArrowLeft', body), context(rows.branch)), true);
    assert.ok(rootBranch.classList.contains('collapsed'));
    // The header stays in sight with its branch folded; ← again has nowhere to go
    assert.equal(handleTreeKey(key('ArrowLeft', body), context(rows.branch)), false);
    assert.equal(handleTreeKey(key('ArrowDown', body), context(rows.branch)), true);
    assert.deepEqual(focused(document), [rows.orphan]); // the branch's pull requests are folded away
    assert.equal(handleTreeKey(key('ArrowRight', body), context(rows.branch)), true);
    assert.ok(!rootBranch.classList.contains('collapsed'));
    assert.equal(handleTreeKey(key('ArrowRight', body), context(rows.branch)), true);
    assert.deepEqual(selected, [rows.orphan, rows.one]);
    assert.equal(handleTreeKey(key('o', body), context(rows.branch)), true);
    assert.deepEqual(document.events.filter(([kind]) => kind === 'click').map(([, element]) => element), [rows.branch.querySelector('.root-branch-link')]);
    assert.equal(handleTreeKey(key('i', body), context(rows.branch)), false);
    assert.equal(handleTreeKey(key('x', body), context(rows.branch)), false);
    rows.branch.focus();
    assert.equal(handleTreeKey(key('Enter', rows.branch), context()), true);
    assert.ok(rootBranch.classList.contains('collapsed'));
    assert.equal(handleTreeKey(key(' ', rows.branch), context()), true);
    assert.ok(!rootBranch.classList.contains('collapsed'));
});

test('a selected row folded out of sight takes ↓ and ↑ only', () => {
    const { rows, body, document, context } = sampleTree();
    setPullRequestCollapsed(rows.one, true);
    for (const name of ['ArrowRight', 'ArrowLeft', 'o', 'i', 'x']) assert.equal(handleTreeKey(key(name, body), context(rows.two)), false, name);
    assert.ok(!rows.two.classList.contains('collapsed'));
    assert.deepEqual(document.events, []);
    assert.equal(handleTreeKey(key('ArrowDown', body), context(rows.two)), true);
    assert.deepEqual(focused(document), [rows.four]);
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

test('c clicks the git switch copy button of the focused or the selected pull request, b its branch name copy button; nothing on a header, an orphaned issue, a row folded away or without a row', () => {
    const { rows, outside, document, context } = sampleTree();
    const clicked = () => document.events.filter(([kind]) => kind === 'click').map(([, element]) => element);
    assert.equal(handleTreeKey(key('c', rows.two), context()), true);
    assert.equal(handleTreeKey(key('b', outside), context(rows.three)), true);
    assert.equal(handleTreeKey(key('b', rows.one.querySelector('.pull-request-link')), context()), true);
    assert.deepEqual(clicked(), [
        rows.two.querySelector('.copy-switch'),
        rows.three.querySelector('.copy-branch'),
        rows.one.querySelector('.copy-branch')
    ]);
    for (const [name, target, selectedRow] of [['c', rows.branch, null], ['b', rows.branch, null], ['c', rows.orphan, null], ['b', outside, rows.orphan], ['c', outside, null]]) {
        assert.equal(handleTreeKey(key(name, target), context(selectedRow)), false, `${name} on ${target === outside ? 'the page' : 'a row'}`);
    }
    setPullRequestCollapsed(rows.one, true);
    assert.equal(handleTreeKey(key('c', outside), context(rows.two)), false);
    assert.equal(clicked().length, 3);
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
