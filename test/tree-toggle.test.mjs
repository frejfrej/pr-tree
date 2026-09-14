import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setRepositoryCollapsed, setRootBranchCollapsed, setPullRequestCollapsed } from '../public/tree-toggle.js';

// The surface of an element the helpers touch: classList, the attributes, one
// querySelector answering the selectors of the module, hidden, nextElementSibling
function element({ classes = [], children = {}, next = null } = {}) {
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
