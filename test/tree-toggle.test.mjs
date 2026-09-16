import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setRepositoryCollapsed, setRootBranchCollapsed, setPullRequestCollapsed, handleTreeClick } from '../public/tree-toggle.js';

// The surface of an element the helpers touch: classList, the attributes, one
// querySelector and one closest answering the selectors of the module, hidden,
// nextElementSibling
function element({ classes = [], children = {}, next = null, closest = {} } = {}) {
    const classSet = new Set(classes);
    const attributes = {};
    return {
        classList: {
            contains: name => classSet.has(name),
            toggle(name, force) { force ? classSet.add(name) : classSet.delete(name); }
        },
        getAttribute: name => attributes[name] ?? null,
        setAttribute(name, value) { attributes[name] = value; },
        querySelector: selector => children[selector] ?? null,
        closest: selector => closest[selector] ?? null,
        hidden: false,
        nextElementSibling: next
    };
}

test('setRepositoryCollapsed and setRootBranchCollapsed toggle the class and the aria-expanded of their own button', () => {
    const repoButton = element();
    const repository = element({ children: { ':scope > .repository-header > .toggle-button': repoButton } });
    setRepositoryCollapsed(repository, true);
    assert.ok(repository.classList.contains('collapsed'));
    assert.equal(repoButton.getAttribute('aria-expanded'), 'false');
    setRepositoryCollapsed(repository, false);
    assert.ok(!repository.classList.contains('collapsed'));
    assert.equal(repoButton.getAttribute('aria-expanded'), 'true');

    const branchButton = element();
    const rootBranch = element({ children: { ':scope > .root-branch-header > .toggle-button': branchButton } });
    setRootBranchCollapsed(rootBranch, true);
    assert.ok(rootBranch.classList.contains('collapsed'));
    assert.equal(branchButton.getAttribute('aria-expanded'), 'false');

    // A block without a button (none is rendered for it) is still collapsed
    const bare = element();
    setRepositoryCollapsed(bare, true);
    assert.ok(bare.classList.contains('collapsed'));
});

test('setPullRequestCollapsed hides the children, shows the child counter and flips aria-expanded; a leaf is left alone', () => {
    const button = element();
    const counter = element();
    const children = element({ classes: ['children'] });
    const pullRequest = element({ classes: ['pull-request'], next: children, children: { '.pull-request-header > .toggle-button': button, '.child-counter': counter } });
    setPullRequestCollapsed(pullRequest, true);
    assert.ok(pullRequest.classList.contains('collapsed'));
    assert.equal(children.hidden, true);
    assert.ok(counter.classList.contains('visible'));
    assert.equal(button.getAttribute('aria-expanded'), 'false');
    setPullRequestCollapsed(pullRequest, false);
    assert.equal(children.hidden, false);
    assert.ok(!counter.classList.contains('visible')); // not a root: the counter shows only while collapsed
    assert.equal(button.getAttribute('aria-expanded'), 'true');

    const root = element({ classes: ['pull-request', 'pull-request-root'], next: children, children: { '.child-counter': counter } });
    setPullRequestCollapsed(root, false);
    assert.ok(counter.classList.contains('visible')); // a root keeps its counter

    const leaf = element({ classes: ['pull-request'], next: element({ classes: ['pull-request'] }) });
    setPullRequestCollapsed(leaf, true);
    assert.ok(!leaf.classList.contains('collapsed'));
});

test('handleTreeClick toggles the block the click lands on, and nothing inside a link', () => {
    const repository = element({ classes: ['repository'] });
    const repositoryHeader = element({ closest: { '.repository': repository } });
    const repositoryButton = element({ closest: { '.repository-header': repositoryHeader, '.repository': repository } });
    // A click on the header, and one on its button (what a keyboard activation dispatches): one toggle each
    handleTreeClick({ target: element({ closest: { '.repository-header': repositoryHeader } }) });
    assert.ok(repository.classList.contains('collapsed'));
    handleTreeClick({ target: repositoryButton });
    assert.ok(!repository.classList.contains('collapsed'));

    const rootBranch = element({ classes: ['root-branch'] });
    const rootBranchHeader = element({ closest: { '.root-branch': rootBranch } });
    handleTreeClick({ target: element({ closest: { '.root-branch-header': rootBranchHeader } }) });
    assert.ok(rootBranch.classList.contains('collapsed'));
    // The root-branch link, inside the header: the link does its job, the branch stays
    handleTreeClick({ target: element({ closest: { 'a': element(), '.root-branch-header': rootBranchHeader } }) });
    assert.ok(rootBranch.classList.contains('collapsed'));

    const children = element({ classes: ['children'] });
    const pullRequest = element({ classes: ['pull-request'], next: children });
    const pullRequestButton = element();
    pullRequestButton.closest = selector => ({ '.pull-request-header .toggle-button': pullRequestButton, '.pull-request': pullRequest })[selector] ?? null; // the button is its own match
    handleTreeClick({ target: pullRequestButton });
    assert.ok(pullRequest.classList.contains('collapsed'));
    assert.equal(children.hidden, true);

    // A click on the content of a pull request toggles nothing
    handleTreeClick({ target: element() });
    assert.ok(pullRequest.classList.contains('collapsed'));
});
