/**
 * Collapse and expand helpers for the pull-request tree.
 *
 * Repositories, root branches and pull requests with children can be
 * collapsed. Every code path that changes a collapsed state goes through the
 * set*Collapsed helpers, so the collapsed class, the children container and
 * the child counter always change together. The chevrons are pure CSS, driven
 * by the "collapsed" class.
 */

export function setRepositoryCollapsed(repository, collapsed) {
    repository.classList.toggle('collapsed', collapsed);
}

export function setRootBranchCollapsed(rootBranch, collapsed) {
    rootBranch.classList.toggle('collapsed', collapsed);
}

export function setPullRequestCollapsed(pullRequest, collapsed) {
    const children = pullRequest.nextElementSibling;
    if (!children || !children.classList.contains('children')) {
        return;
    }
    pullRequest.classList.toggle('collapsed', collapsed);
    children.hidden = collapsed;
    // The child counter is shown on root pull requests permanently, and on
    // other pull requests only while they are collapsed. counter-utils only
    // refreshes counters carrying the "visible" class.
    const childCounter = pullRequest.querySelector('.child-counter');
    if (childCounter) {
        const isRoot = pullRequest.classList.contains('pull-request-root');
        childCounter.classList.toggle('visible', collapsed || isRoot);
    }
}

export function toggleRepository(button) {
    const repository = button.closest('.repository');
    setRepositoryCollapsed(repository, !repository.classList.contains('collapsed'));
}

export function toggleRootBranch(button) {
    const rootBranch = button.closest('.root-branch');
    setRootBranchCollapsed(rootBranch, !rootBranch.classList.contains('collapsed'));
}

export function toggleChildren(button) {
    const pullRequest = button.closest('.pull-request');
    setPullRequestCollapsed(pullRequest, !pullRequest.classList.contains('collapsed'));
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
 * and pull request id, so a re-render can put the tree back as the user left it.
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

    states.pullRequests.filter(state => state.collapsed).forEach(state => {
        const pullRequest = document.querySelector(`.pull-request[data-id="${state.id}"]`);
        if (pullRequest) setPullRequestCollapsed(pullRequest, true);
    });
}
