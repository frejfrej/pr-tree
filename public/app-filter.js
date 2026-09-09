import { updateCounterDisplay } from './counter-utils.js';

/**
 * Filtering of the rendered pull-request tree.
 *
 * The data needed by the filters is indexed once per data load
 * (buildFilterIndex), and every filter pass is a single walk of the rendered
 * tree: each pull request is visited exactly once, its visibility and
 * attention are decided from the index, and the counters of its ancestors are
 * summed on the way back up. Nothing here searches arrays or the DOM per
 * pull request, so a pass costs the same on a flat list and on a deep stack.
 */

let filterIndex = null;

/** Builds the filter index for a data load and returns it. */
export function initializeFilter(apiResult) {
    filterIndex = buildFilterIndex(apiResult);
    return filterIndex;
}

/**
 * Counts the filters that are not at their default value.
 * A multi-select with several values counts once.
 */
export function countActiveFilters({ text = '', assignees, reviewers, sprints, fixVersions, epics = [], stories = [], sync, readyReviewer = false, readyAssignee = false }) {
    return [
        parseTextQuery(text).length > 0,
        assignees.length > 0,
        reviewers.length > 0,
        sprints.length > 0,
        fixVersions.length > 0,
        epics.length > 0,
        stories.length > 0,
        readyReviewer === true,
        readyAssignee === true,
        sync !== 'Show all'
    ].filter(Boolean).length;
}

// ------------------------------------------------------------- text filter

/**
 * Splits a text query into lower-cased terms. Pure.
 * @returns {string[]} no term for a blank query
 */
export function parseTextQuery(text) {
    return String(text || '').toLowerCase().split(/\s+/).filter(term => term !== '');
}

/** True when every term is a substring of the searchable text. Pure. */
export function matchesText(searchText, terms) {
    return terms.every(term => searchText.includes(term));
}

// ---------------------------------------------------------- Jira hierarchy
// Jira Cloud: epic (hierarchyLevel 1) > standard issue (0) > sub-task (-1).
// Every issue carries fields.issuetype and, when it has one, fields.parent with
// the parent's key and inline fields (summary, status, priority, issuetype).
// This is the only place that interprets these fields.

/**
 * Level of an issue in the Jira hierarchy: 'epic', 'standard' or 'subtask'.
 * Issues without a type (parents fetched with fix versions only by an older
 * server) count as standard. Pure.
 */
export function issueLevel(issue) {
    const type = issue.fields && issue.fields.issuetype;
    if (!type) return 'standard';
    if (type.hierarchyLevel > 0 || type.name === 'Epic') return 'epic';
    if (type.subtask === true || type.hierarchyLevel < 0) return 'subtask';
    return 'standard';
}

// Key and summary of an issue or of an inline parent, as listed in the filters
function issueReference(issue) {
    return { key: issue.key, summary: (issue.fields && issue.fields.summary) || '' };
}

/**
 * The epic above an issue: the issue itself when it is an epic, its parent when
 * the parent is an epic, or the epic of its parent story when the issue is a
 * sub-task (the story is looked up in issuesByKey, where the server puts the
 * parents it fetched). Pure.
 * @param {object} issue - a linked issue or an inline parent
 * @param {Map<string, object>} issuesByKey - the issues of jiraIssuesDetails by
 *   key (required: the sub-task branch reads it)
 * @returns {{ key: string, summary: string } | null}
 */
export function epicOf(issue, issuesByKey) {
    const level = issueLevel(issue);
    if (level === 'epic') return issueReference(issue);
    const parent = issue.fields && issue.fields.parent;
    if (!parent) return null;
    if (issueLevel(parent) === 'epic') return issueReference(parent);
    if (level === 'subtask') {
        const story = issuesByKey.get(parent.key);
        const grandParent = story && story.fields && story.fields.parent;
        if (grandParent && issueLevel(grandParent) === 'epic') return issueReference(grandParent);
    }
    return null;
}

/**
 * The story an issue belongs to: the issue itself when it is a standard issue,
 * its parent when it is a sub-task (the inline parent carries the key and the
 * summary), nothing for an epic. Pure.
 * @returns {{ key: string, summary: string } | null}
 */
export function storyOf(issue) {
    const level = issueLevel(issue);
    if (level === 'standard') return issueReference(issue);
    if (level === 'subtask' && issue.fields.parent) return issueReference(issue.fields.parent);
    return null;
}

// ---------------------------------------------------- issue filter options

/**
 * Options of an issue multi-select: "KEY Summary", valued by key, sorted by
 * Jira project then issue number descending (newest first). Pure.
 * @param {Iterable<{ key: string, summary: string }>} issues - records, e.g. index.epics.values()
 * @returns {{ value: string, label: string }[]}
 */
export function issueOptions(issues) {
    return [...issues]
        .sort((a, b) => compareIssueKeys(a.key, b.key))
        .map(issue => ({ value: issue.key, label: `${issue.key} ${issue.summary}`.trim() }));
}

// Jira project alphabetically, then issue number descending
function compareIssueKeys(a, b) {
    const [projectA, numberA] = splitIssueKey(a);
    const [projectB, numberB] = splitIssueKey(b);
    return projectA.localeCompare(projectB) || numberB - numberA;
}

function splitIssueKey(key) {
    const dash = key.lastIndexOf('-');
    return [key.slice(0, dash), Number(key.slice(dash + 1))];
}

// --------------------------------------------------------------- attention

/**
 * Decides whether a pull request needs the attention of the people selected
 * in the assignee and reviewer filters. Pure: everything it needs is passed in.
 *
 * - assignee: the PR is in progress and a linked issue is assigned to a selected assignee
 * - reviewer: the PR is in review and a selected reviewer (never the author) has not approved
 *
 * The title of a PR with attention is highlighted; the "Ready for reviewer"
 * filter keeps the PRs with reviewer attention.
 */
export function computeAttention(pullRequestData, { statusInProgress, statusInReview, linkedIssues, assignees, reviewers }) {
    const assignee = assignees.length > 0 && statusInProgress &&
        linkedIssues.some(issue => issue.fields.assignee && assignees.includes(issue.fields.assignee.displayName));
    const reviewer = reviewers.length > 0 && statusInReview &&
        pullRequestData.participants.some(participant =>
            participant.user.uuid !== pullRequestData.author.uuid &&
            reviewers.includes(participant.user.display_name) &&
            !participant.approved
        );
    return { assignee, reviewer, any: assignee || reviewer };
}

// ------------------------------------------------------------------- index

/**
 * Indexes the API result for the filters: one entry per pull request with its
 * linked issues, the text the text filter searches and the sets the other
 * filters compare against. Pure.
 * @returns {{ pullRequestsById: Map<number, object>, epics: Map<string, { key, summary }>, stories: Map<string, { key, summary }> }}
 */
export function buildFilterIndex({ pullRequests = [], jiraIssuesMap = {}, jiraIssuesDetails = [], sprintIssues = {} }) {
    const issuesByKey = new Map(jiraIssuesDetails.map(issue => [issue.key, issue]));

    const sprintsByIssueKey = new Map();
    for (const [sprintId, issueKeys] of Object.entries(sprintIssues)) {
        for (const issueKey of issueKeys) {
            if (!sprintsByIssueKey.has(issueKey)) {
                sprintsByIssueKey.set(issueKey, new Set());
            }
            sprintsByIssueKey.get(issueKey).add(String(sprintId));
        }
    }

    const pullRequestsById = new Map();
    const epics = new Map();
    const stories = new Map();
    for (const pullRequest of pullRequests) {
        const issueKeys = jiraIssuesMap[pullRequest.id] || [];
        const linkedIssues = issueKeys.map(key => issuesByKey.get(key)).filter(issue => issue);
        const pullRequestEpics = linkedIssues.map(issue => epicOf(issue, issuesByKey)).filter(epic => epic);
        for (const epic of pullRequestEpics) {
            epics.set(epic.key, epic);
        }
        const pullRequestStories = linkedIssues.map(issue => storyOf(issue)).filter(story => story);
        for (const story of pullRequestStories) {
            stories.set(story.key, story);
        }
        const entry = {
            pullRequest,
            linkedIssues,
            // What the text filter searches: title, source branch and issue keys
            searchText: [pullRequest.title, pullRequest.source?.branch?.name, ...issueKeys]
                .filter(Boolean).join(' ').toLowerCase(),
            assignees: new Set(linkedIssues
                .filter(issue => issue.fields.assignee && issue.fields.assignee.displayName)
                .map(issue => issue.fields.assignee.displayName)),
            reviewers: new Set(pullRequest.participants
                .filter(participant => participant.user.uuid !== pullRequest.author.uuid)
                .map(participant => participant.user.display_name)),
            sprints: new Set(issueKeys.flatMap(key => [...(sprintsByIssueKey.get(key) || [])])),
            fixVersions: new Set(linkedIssues
                .flatMap(issue => issue.fields.fixVersions || [])
                .map(version => String(version.id))),
            epics: new Set(pullRequestEpics.map(epic => epic.key)),
            stories: new Set(pullRequestStories.map(story => story.key))
        };
        pullRequestsById.set(pullRequest.id, entry);
    }

    return { pullRequestsById, epics, stories };
}

// -------------------------------------------------------------- evaluation

/**
 * Applies the filters to one indexed pull request. Pure.
 * @param {object} entry - an entry of buildFilterIndex().pullRequestsById
 * @param {object} filters - { text, assignees, reviewers, sprints, fixVersions, epics, stories, sync, readyReviewer, readyAssignee }
 * @param {object} rendered - what the tree shows for this pull request:
 *   statusInProgress, statusInReview (from the Jira statuses) and hasSyncLabel
 * @returns {{ visible: boolean, attention: { assignee, reviewer, any } }}
 */
export function evaluatePullRequest(entry, { text = '', assignees, reviewers, sprints, fixVersions, epics = [], stories = [], sync, readyReviewer = false, readyAssignee = false }, { statusInProgress, statusInReview, hasSyncLabel }) {
    const attention = computeAttention(entry.pullRequest, {
        statusInProgress,
        statusInReview,
        linkedIssues: entry.linkedIssues,
        assignees,
        reviewers
    });

    const textMatch = matchesText(entry.searchText, parseTextQuery(text));
    // Empty selection = show all; otherwise match ANY selected value
    const assigneeMatch = assignees.length === 0 || assignees.some(name => entry.assignees.has(name));
    const reviewerMatch = reviewers.length === 0 || reviewers.some(name => entry.reviewers.has(name));
    const sprintMatch = sprints.length === 0 || sprints.some(sprintId => entry.sprints.has(String(sprintId)));
    const fixVersionMatch = fixVersions.length === 0 || fixVersions.some(versionId => entry.fixVersions.has(String(versionId)));
    const epicMatch = epics.length === 0 || epics.some(key => entry.epics.has(key));
    const storyMatch = stories.length === 0 || stories.some(key => entry.stories.has(key));
    const syncMatch = sync === 'Show all' ||
        (sync === 'requested' && hasSyncLabel) ||
        (sync === 'OK' && !hasSyncLabel);
    // Ready filters: with one or both checked, keep the pull requests that need the
    // attention of the selected reviewers or assignees. A pull request is never in
    // review and in progress at once, so the two boxes combine as OR
    const readyMatch = (!readyReviewer && !readyAssignee) ||
        (readyReviewer && attention.reviewer) ||
        (readyAssignee && attention.assignee);

    return {
        visible: textMatch && assigneeMatch && reviewerMatch && sprintMatch && fixVersionMatch && epicMatch && storyMatch && syncMatch && readyMatch,
        attention
    };
}

// ---------------------------------------------------------------- tree pass

/**
 * Applies the filters to the rendered tree and refreshes the counters.
 * @param {object} filters - { text, assignees, reviewers, sprints, fixVersions, epics, stories, sync, readyReviewer, readyAssignee }
 * @returns {number} how many pull requests are left shown and need attention
 */
export function filterBranches(filters) {
    const pass = {
        filters,
        index: filterIndex || buildFilterIndex({}),
        // The SYNC filter relies on the rendered badges: collect them once
        pullRequestsWithSyncLabel: new Set(
            Array.from(document.querySelectorAll('.pull-request .conflicts-count'))
                .map(badge => badge.closest('.pull-request'))
                .filter(pullRequest => pullRequest)
                .map(pullRequest => pullRequest.dataset.id)
        ),
        shownAttention: 0
    };

    for (const repository of document.querySelectorAll('.repository')) {
        let repositoryTotal = 0;
        let repositoryVisible = 0;
        for (const rootBranch of repository.querySelectorAll('.root-branch')) {
            const content = rootBranch.querySelector('.root-branch-content');
            const counts = content ? filterChildren(content, pass) : { total: 0, visible: 0 };
            repositoryTotal += counts.total;
            repositoryVisible += counts.visible;

            // Hide branch if no visible pull requests
            setDisplay(rootBranch, counts.visible > 0 ? '' : 'none');
            const counter = rootBranch.querySelector('.branch-pr-counter');
            if (counter) updateCounterDisplay(counter, counts.visible, counts.total);
        }
        const counter = repository.querySelector('.repo-pr-counter');
        if (counter) updateCounterDisplay(counter, repositoryVisible, repositoryTotal);
    }

    return pass.shownAttention;
}

// Filters the pull requests that are direct children of a container (a root
// branch content or a .children element), recursing into their own children.
// Returns the counts of the whole subtree.
function filterChildren(container, pass) {
    let total = 0;
    let visible = 0;
    for (let child = container.firstElementChild; child; child = child.nextElementSibling) {
        if (!child.classList.contains('pull-request')) {
            continue;
        }
        const counts = filterPullRequest(child, pass);
        total += counts.total;
        visible += counts.visible;
    }
    return { total, visible };
}

function filterPullRequest(pullRequestElement, pass) {
    // Children first, so the visibility of a filtered-out parent can depend on them
    const childrenContainer = pullRequestElement.nextElementSibling;
    const hasChildren = childrenContainer && childrenContainer.classList.contains('children');
    const children = hasChildren ? filterChildren(childrenContainer, pass) : { total: 0, visible: 0 };

    const entry = pass.index.pullRequestsById.get(Number(pullRequestElement.dataset.id));
    let isVisible = false;
    if (entry) {
        // Attention is computed from data before visibility, so the ready filters never
        // depend on what a previous pass rendered
        const { visible, attention } = evaluatePullRequest(entry, pass.filters, {
            statusInProgress: pullRequestElement.classList.contains('status-in-progress'),
            statusInReview: pullRequestElement.classList.contains('status-in-review'),
            hasSyncLabel: pass.pullRequestsWithSyncLabel.has(pullRequestElement.dataset.id)
        });
        isVisible = visible;
        pullRequestElement.classList.toggle('needs-attention', attention.any);
        if (visible && attention.any) {
            pass.shownAttention++;
        }
    }

    // Update visibility state: a filtered-out pull request stays displayed
    // while one of its descendants is visible
    pullRequestElement.classList.toggle('filtered', !isVisible);
    setDisplay(pullRequestElement, (!isVisible && children.visible === 0) ? 'none' : '');

    // The child counter is refreshed only while it is shown (root pull
    // requests permanently, others while collapsed), like before
    if (hasChildren) {
        const childCounter = pullRequestElement.querySelector('.child-counter');
        if (childCounter && childCounter.classList.contains('visible')) {
            updateCounterDisplay(childCounter, children.visible, children.total);
        }
    }

    return { total: children.total + 1, visible: children.visible + (isVisible ? 1 : 0) };
}

// Only touches the style when it changes, to keep style invalidation minimal
function setDisplay(element, value) {
    if (element.style.display !== value) {
        element.style.display = value;
    }
}
