/**
 * Collapse and expand helpers for the pull-request tree.
 *
 * Repositories, root branches and pull requests with children can be
 * collapsed. Every code path that changes a collapsed state goes through the
 * set*Collapsed helpers, so the collapsed class, the children container, the
 * child counter and the aria-expanded of the toggle button always change
 * together. The chevrons are pure CSS, driven by the "collapsed" class.
 * app.js installs handleTreeClick on the tree pane; the rendered tree carries
 * no inline handler.
 */

// The toggle button of a block announces whether the block is open
function setExpanded(button, collapsed) {
    if (button) {
        button.setAttribute('aria-expanded', String(!collapsed));
    }
}

export function setRepositoryCollapsed(repository, collapsed) {
    repository.classList.toggle('collapsed', collapsed);
    setExpanded(repository.querySelector(':scope > .repository-header > .toggle-button'), collapsed);
}

export function setRootBranchCollapsed(rootBranch, collapsed) {
    rootBranch.classList.toggle('collapsed', collapsed);
    setExpanded(rootBranch.querySelector(':scope > .root-branch-header > .toggle-button'), collapsed);
}

export function setPullRequestCollapsed(pullRequest, collapsed) {
    const children = pullRequest.nextElementSibling;
    if (!children || !children.classList.contains('children')) {
        return;
    }
    pullRequest.classList.toggle('collapsed', collapsed);
    children.hidden = collapsed;
    // The header is nested a few levels down; the stacked pull requests are
    // in the sibling .children container, never inside this element
    setExpanded(pullRequest.querySelector('.pull-request-header > .toggle-button'), collapsed);
    // The child counter is shown on root pull requests permanently, and on
    // other pull requests only while they are collapsed. counter-utils only
    // refreshes counters carrying the "visible" class.
    const childCounter = pullRequest.querySelector('.child-counter');
    if (childCounter) {
        const isRoot = pullRequest.classList.contains('pull-request-root');
        childCounter.classList.toggle('visible', collapsed || isRoot);
    }
}

// The three toggles: what handleTreeClick calls for the block a click lands on
function toggleRepository(button) {
    const repository = button.closest('.repository');
    setRepositoryCollapsed(repository, !repository.classList.contains('collapsed'));
}

function toggleRootBranch(button) {
    const rootBranch = button.closest('.root-branch');
    setRootBranchCollapsed(rootBranch, !rootBranch.classList.contains('collapsed'));
}

function toggleChildren(button) {
    const pullRequest = button.closest('.pull-request');
    setPullRequestCollapsed(pullRequest, !pullRequest.classList.contains('collapsed'));
}

/**
 * The click handler of the tree pane, installed once by app.js on the
 * container in place of an inline handler per header. A click inside a link
 * (the root-branch link) toggles nothing; the toggle button of a pull
 * request toggles its stacked pull requests; anywhere else on a root-branch
 * or a repository header toggles the branch or the repository, the button
 * inside the header included (a keyboard activation dispatches a click on
 * it, which lands here once).
 */
export function handleTreeClick(event) {
    const target = event.target;
    if (target.closest('a')) return;
    const pullRequestButton = target.closest('.pull-request-header .toggle-button');
    if (pullRequestButton) {
        toggleChildren(pullRequestButton);
        return;
    }
    const rootBranchHeader = target.closest('.root-branch-header');
    if (rootBranchHeader) {
        toggleRootBranch(rootBranchHeader);
        return;
    }
    const repositoryHeader = target.closest('.repository-header');
    if (repositoryHeader) toggleRepository(repositoryHeader);
}

function setAllCollapsed(collapsed) {
    document.querySelectorAll('.repository').forEach(repository => setRepositoryCollapsed(repository, collapsed));
    document.querySelectorAll('.root-branch').forEach(rootBranch => setRootBranchCollapsed(rootBranch, collapsed));
    document.querySelectorAll('.pull-request').forEach(pullRequest => setPullRequestCollapsed(pullRequest, collapsed));
}

export function collapseAll() {
    setAllCollapsed(true);
}

export function expandAll() {
    setAllCollapsed(false);
}

/**
 * Snapshot of what is collapsed, keyed by repository name, root branch name
 * and pull request key (repository/id, #99), so a re-render can put the tree
 * back as the user left it.
 */
export function captureToggleStates() {
    const states = { repositories: [], rootBranches: [], pullRequests: [] };

    document.querySelectorAll('.repository').forEach(repository => {
        const name = repository.querySelector('.repository-name');
        if (name) {
            states.repositories.push({
                name: name.textContent.trim(),
                collapsed: repository.classList.contains('collapsed')
            });
        }
    });

    document.querySelectorAll('.root-branch').forEach(rootBranch => {
        const link = rootBranch.querySelector('.root-branch-name a');
        if (link) {
            // The first text node is the branch name; the external-link icon follows it
            states.rootBranches.push({
                name: link.childNodes[0].textContent.trim(),
                collapsed: rootBranch.classList.contains('collapsed')
            });
        }
    });

    document.querySelectorAll('.pull-request').forEach(pullRequest => {
        const children = pullRequest.nextElementSibling;
        if (children && children.classList.contains('children')) {
            states.pullRequests.push({
                id: pullRequest.dataset.id,
                collapsed: pullRequest.classList.contains('collapsed')
            });
        }
    });

    return states;
}

export function restoreToggleStates(states) {
    if (!states) return;

    states.repositories.filter(state => state.collapsed).forEach(state => {
        const repository = Array.from(document.querySelectorAll('.repository')).find(candidate => {
            const name = candidate.querySelector('.repository-name');
            return name && name.textContent.trim() === state.name;
        });
        if (repository) setRepositoryCollapsed(repository, true);
    });

    states.rootBranches.filter(state => state.collapsed).forEach(state => {
        const rootBranch = Array.from(document.querySelectorAll('.root-branch')).find(candidate => {
            const link = candidate.querySelector('.root-branch-name a');
            return link && link.childNodes[0].textContent.trim() === state.name;
        });
        if (rootBranch) setRootBranchCollapsed(rootBranch, true);
    });

    // By key, "repository/id" (#99): one lookup instead of a selector per pull request
    const pullRequestsByKey = new Map([...document.querySelectorAll('.pull-request')].map(pullRequest => [pullRequest.dataset.id, pullRequest]));
    states.pullRequests.filter(state => state.collapsed).forEach(state => {
        const pullRequest = pullRequestsByKey.get(state.id);
        if (pullRequest) setPullRequestCollapsed(pullRequest, true);
    });
}
