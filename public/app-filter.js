import { updateCounterDisplay } from './counter-utils.js';
import { multiSelectFilters } from './filter-registry.js';
import { statusClass, otherReviewers, syncKey, atlassianAgent, isDraft } from './pull-request-status.js';
import { pullRequestKey } from './pull-request-key.mjs';

// The multi-selects compared with the set of the index entry named like the
// filter; the participants have the Work select and their own rule
const issueFilters = multiSelectFilters.filter(filter => filter.key !== 'participants');

/**
 * Filtering of the rendered pull-request tree.
 *
 * The data needed by the filters is indexed once per data load
 * (buildFilterIndex), and every filter pass is a single walk of the rendered
 * tree: each pull request is visited exactly once, its visibility and
 * attention are decided from the index, and the counters of its ancestors are
 * summed on the way back up. Nothing here searches arrays or the DOM per
 * pull request, so a pass costs the same on a flat list and on a deep stack.
 * The SYNC statuses come from app-sync.js through app.js (filterBranches takes
 * them), the status band from the index: the pass reads nothing back from the
 * rendered tree.
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
export function countActiveFilters(filters) {
    const { text = '', participants = [], work = 'all', hideDrafts = false, sync } = filters;
    return [
        parseTextQuery(text).length > 0,
        ...multiSelectFilters.map(({ key }) => (filters[key] || []).length > 0),
        participants.length > 0 && work !== 'all',
        hideDrafts === true,
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
 * @param {Map<string, object>} issuesByKey - the issues of jiraIssuesDetails and
 *   the orphaned issues by key (required: the sub-task branch reads it)
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
 * @param {Iterable<{ key: string, summary: string }>} issues - records, e.g. the epics buildFilterIndex collected
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
 * Decides whether a pull request waits for the selected participants. Pure:
 * everything it needs is in the index entry and the arguments.
 *
 * - assignee: the PR is in progress and a linked issue is assigned to a selected participant
 * - reviewer: the PR is in review, is not a draft (its author wants no review
 *   yet), and a selected participant reviews it (never the author) and has not approved
 *
 * The title of a PR with attention is highlighted; with participants selected,
 * the Work filter keeps the PRs with reviewer attention ("Ready for
 * reviewers"), assignee attention ("Ready for assignees") or either ("Ready for
 * participants"); "All work", "All reviews" and "All issues" keep every PR of
 * the participants, whether it waits for them or not.
 * @param {{ assignees: Set<string>, pendingReviewers: Set<string>, statusInProgress: boolean, statusInReview: boolean, draft?: boolean }} entry - an entry of buildFilterIndex().pullRequestsByKey
 * @param {string[]} participants - the selected participants
 * @returns {{ assignee: boolean, reviewer: boolean, any: boolean }}
 */
export function computeAttention({ assignees, pendingReviewers, statusInProgress, statusInReview, draft }, participants) {
    const assignee = statusInProgress === true && participants.some(name => assignees.has(name));
    const reviewer = statusInReview === true && draft !== true && participants.some(name => pendingReviewers.has(name));
    return { assignee, reviewer, any: assignee || reviewer };
}

// ------------------------------------------------------------------- index

// The sprint options: sorted by name, valued by id
function sprintOptions(sprints) {
    return [...sprints]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(sprint => ({ value: String(sprint.id), label: sprint.name }));
}

// The fix version options of the given issues: unique by id, sorted by Jira
// project (the prefix of the issue key) then by name, labelled "Name (PROJECT)"
function fixVersionOptions(issues) {
    const versions = new Map();
    for (const issue of issues) {
        const project = issue.key.split('-')[0];
        for (const version of issue.fields.fixVersions || []) {
            if (!versions.has(version.id)) versions.set(version.id, { id: version.id, name: version.name, project });
        }
    }
    return [...versions.values()]
        .sort((a, b) => a.project.localeCompare(b.project) || a.name.localeCompare(b.name))
        .map(version => ({ value: String(version.id), label: `${version.name} (${version.project})` }));
}

/**
 * Indexes the API result for the filters: one entry per pull request with its
 * linked issues, the text the text filter searches and the sets the other
 * filters compare against; one entry per orphaned issue (in review, no pull
 * request) with the same sets; and, under the keys of the filter registry, the
 * option list of each multi-select in display order, the orphaned issues
 * included. Pure.
 * @returns {{ pullRequestsByKey: Map<string, object>, orphanedIssuesByKey: Map<string, object>, sprints: { value, label }[], fixVersions: { value, label }[], epics: { value, label }[], stories: { value, label }[], participants: { value, label }[] }}
 */
export function buildFilterIndex({ pullRequests = [], jiraIssuesMap = {}, jiraIssuesDetails = [], sprints = [], sprintIssues = {}, orphanedIssues = [] }) {
    // The parents are looked up among the details (where the server puts the
    // parents it fetched) and among the orphaned issues (a parent that is an
    // orphaned issue itself is not fetched again); a key in both lists, which
    // the server never produces, is the orphaned issue's
    const issuesByKey = new Map([...jiraIssuesDetails, ...orphanedIssues].map(issue => [issue.key, issue]));

    const sprintsByIssueKey = new Map();
    for (const [sprintId, issueKeys] of Object.entries(sprintIssues)) {
        for (const issueKey of issueKeys) {
            if (!sprintsByIssueKey.has(issueKey)) {
                sprintsByIssueKey.set(issueKey, new Set());
            }
            sprintsByIssueKey.get(issueKey).add(String(sprintId));
        }
    }

    const pullRequestsByKey = new Map();
    const epics = new Map();
    const stories = new Map();
    const participants = new Set();
    for (const pullRequest of pullRequests) {
        // "repository/id": ids are numbered per repository (#99), the render writes the key as the data-id
        const indexKey = pullRequestKey(pullRequest);
        const issueKeys = jiraIssuesMap[indexKey] || [];
        const linkedIssues = issueKeys.map(key => issuesByKey.get(key)).filter(issue => issue);
        const pullRequestEpics = linkedIssues.map(issue => epicOf(issue, issuesByKey)).filter(epic => epic);
        for (const epic of pullRequestEpics) {
            epics.set(epic.key, epic);
        }
        const pullRequestStories = linkedIssues.map(issue => storyOf(issue)).filter(story => story);
        for (const story of pullRequestStories) {
            stories.set(story.key, story);
        }
        // The reviewers the tree shows: every participant but the author and Rovo Dev
        const reviewers = otherReviewers(pullRequest);
        // The band the tree paints (pull-request-status.js): what the attention rule reads
        // (the render looks the linked issues up among the details only; a
        // linked issue is never an orphaned one, so both see the same list)
        const band = statusClass(pullRequest, linkedIssues);
        const entry = {
            pullRequest,
            linkedIssues,
            statusInProgress: band === 'status-in-progress',
            statusInReview: band === 'status-in-review',
            // A draft waits for no reviewer (computeAttention) and "Hide drafts" hides it
            draft: isDraft(pullRequest),
            // The key of this pull request in a SYNC statuses response, the one
            // the render writes on its badge (pull-request-status.js)
            syncKey: syncKey(pullRequest),
            // What the text filter searches: title, source branch and issue keys
            searchText: [pullRequest.title, pullRequest.source?.branch?.name, ...issueKeys]
                .filter(Boolean).join(' ').toLowerCase(),
            // The people of the pull request, by display name: the assignees of the
            // linked issues, the reviewers, and the reviewers who have not approved
            // (what the attention of computeAttention reads)
            assignees: new Set(linkedIssues
                .filter(issue => issue.fields.assignee && issue.fields.assignee.displayName)
                .map(issue => issue.fields.assignee.displayName)),
            reviewers: new Set(reviewers.map(participant => participant.user.display_name).filter(Boolean)),
            pendingReviewers: new Set(reviewers
                .filter(participant => !participant.approved)
                .map(participant => participant.user.display_name)
                .filter(Boolean)),
            sprints: new Set(issueKeys.flatMap(key => [...(sprintsByIssueKey.get(key) || [])])),
            fixVersions: new Set(linkedIssues
                .flatMap(issue => issue.fields.fixVersions || [])
                .map(version => String(version.id))),
            epics: new Set(pullRequestEpics.map(epic => epic.key)),
            stories: new Set(pullRequestStories.map(story => story.key))
        };
        for (const name of entry.assignees) participants.add(name);
        for (const name of entry.reviewers) participants.add(name);
        pullRequestsByKey.set(indexKey, entry);
    }

    // The orphaned issues: the issue itself is what the text filter searches
    // and what the sets are built from; its assignee is its only person
    const orphanedIssuesByKey = new Map();
    for (const issue of orphanedIssues) {
        const epic = epicOf(issue, issuesByKey);
        if (epic) epics.set(epic.key, epic);
        const story = storyOf(issue);
        if (story) stories.set(story.key, story);
        const assignee = issue.fields.assignee && issue.fields.assignee.displayName;
        if (assignee) participants.add(assignee);
        orphanedIssuesByKey.set(issue.key, {
            issue,
            searchText: [issue.key, issue.fields.summary].filter(Boolean).join(' ').toLowerCase(),
            assignees: new Set(assignee ? [assignee] : []),
            sprints: new Set(sprintsByIssueKey.get(issue.key) || []),
            fixVersions: new Set((issue.fields.fixVersions || []).map(version => String(version.id))),
            epics: new Set(epic ? [epic.key] : []),
            stories: new Set(story ? [story.key] : [])
        });
    }
    participants.delete(atlassianAgent);

    return {
        pullRequestsByKey,
        orphanedIssuesByKey,
        // The option lists of the multi-selects, under the registry keys, in display order
        sprints: sprintOptions(sprints),
        fixVersions: fixVersionOptions([...jiraIssuesDetails, ...orphanedIssues]),
        epics: issueOptions(epics.values()),
        stories: issueOptions(stories.values()),
        participants: [...participants].sort((a, b) => a.localeCompare(b)).map(name => ({ value: name, label: name }))
    };
}

// -------------------------------------------------------------- evaluation

// The filters an indexed pull request and an indexed orphaned issue share:
// the text, and any selected value of each multi-select but the participants
// (an empty selection matches everything)
function matchesIssueFilters(entry, filters) {
    if (!matchesText(entry.searchText, parseTextQuery(filters.text || ''))) return false;
    return issueFilters.every(({ key }) => {
        const selected = filters[key] || [];
        return selected.length === 0 || selected.some(value => entry[key].has(String(value)));
    });
}

/**
 * Applies the filters to one indexed pull request. Pure.
 * @param {object} entry - an entry of buildFilterIndex().pullRequestsByKey
 * @param {object} filters - { text, participants, work, hideDrafts, sprints, fixVersions, epics, stories, sync };
 *   work is 'all', 'reviews', 'issues', 'ready', 'reviewers' or 'assignees' and only matters with participants selected
 * @param {object} [syncStatus] - the SYNC status of the pull request from the last load
 *   ({ conflicts, files?, reason? } or { error, reason }); undefined while none is loaded or known
 * @returns {{ visible: boolean, attention: { assignee, reviewer, any } }}
 */
export function evaluatePullRequest(entry, filters, syncStatus) {
    const { participants = [], work = 'all', hideDrafts = false, sync } = filters;
    const attention = computeAttention(entry, participants);

    // Participants: without a selection, everybody's pull requests; with one, every
    // pull request a selected participant reviews ("All reviews"), has a linked
    // issue assigned to ("All issues") or either ("All work"), or only those
    // waiting for one of them as a reviewer, as an assignee, or either ("Ready
    // for participants")
    const reviews = () => participants.some(name => entry.reviewers.has(name));
    const issues = () => participants.some(name => entry.assignees.has(name));
    const participantMatch = participants.length === 0 ||
        (work === 'reviewers' ? attention.reviewer :
            work === 'assignees' ? attention.assignee :
                work === 'ready' ? attention.any :
                    work === 'reviews' ? reviews() :
                        work === 'issues' ? issues() :
                            reviews() || issues());
    // What the badges show: SYNC for a result with conflicts, OK for one without,
    // neither ("unchecked") for no result or a failure
    const checked = Boolean(syncStatus) && !syncStatus.error;
    const syncMatch = sync === 'Show all' ||
        (sync === 'requested' && checked && Boolean(syncStatus.conflicts)) ||
        (sync === 'OK' && checked && !syncStatus.conflicts) ||
        (sync === 'unchecked' && !checked);

    return {
        visible: matchesIssueFilters(entry, filters) && participantMatch && !(hideDrafts && entry.draft) && syncMatch,
        attention
    };
}

// The Work values that keep only what the participants review: nothing in
// the orphaned issues section is reviewed, so they hide it; any other value
// keeps an issue assigned to a selected participant, like "All work" does
// for pull requests
const reviewWorkValues = ['reviews', 'reviewers'];

/**
 * Applies the filters to one indexed orphaned issue. Pure. The issue is in
 * review with no pull request: it waits for its assignee, so with
 * participants selected it is kept when assigned to one of them, under every
 * Work value but the review ones ("All reviews", "Ready for reviewers": nothing
 * here is reviewed); the SYNC and Hide drafts filters do not apply.
 * @param {object} entry - an entry of buildFilterIndex().orphanedIssuesByKey
 * @param {object} filters - { text, participants, work, hideDrafts, sprints, fixVersions, epics, stories, sync }
 * @returns {{ visible: boolean, attention: boolean }} attention: assigned to a selected participant
 */
export function evaluateOrphanedIssue(entry, filters) {
    const { participants = [], work = 'all' } = filters;
    const attention = participants.some(name => entry.assignees.has(name));
    const participantMatch = participants.length === 0 ||
        (attention && !reviewWorkValues.includes(work));
    return {
        visible: matchesIssueFilters(entry, filters) && participantMatch,
        attention
    };
}

// ---------------------------------------------------------------- tree pass

/**
 * Applies the filters to the rendered tree and refreshes the counters. A root
 * branch or a repository left without a visible pull request is hidden; while
 * every repository is hidden, the "nothing matches" message is shown instead.
 * The orphaned issues section, rendered as a repository block, is walked
 * apart: its rows are evaluated by issue key, its counter refreshed, and it
 * is hidden while no row is left; the attention of its visible rows is
 * counted. Everything a decision needs comes from the index and the loaded
 * SYNC statuses, nothing from what the tree shows.
 * @param {object} filters - { text, participants, work, hideDrafts, sprints, fixVersions, epics, stories, sync }
 * @param {Record<string, object> | null} [syncStatuses] - the statuses of the last SYNC load by "repo/destHash..sourceHash", null while none is loaded
 * @returns {number} how many pull requests and orphaned issues are left shown and need attention
 */
export function filterBranches(filters, syncStatuses = null) {
    const pass = {
        filters,
        syncStatuses,
        index: filterIndex || buildFilterIndex({}),
        shownAttention: 0
    };

    let shownRepositories = 0;
    for (const repository of document.querySelectorAll('.repository:not(.orphaned-issues)')) {
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

        // Hide the repository too when no pull request is left, like its branches
        setDisplay(repository, repositoryVisible > 0 ? '' : 'none');
        if (repositoryVisible > 0) shownRepositories++;
    }

    // renderRepositories renders the message hidden; it takes the place of the
    // tree while every repository is hidden
    const noMatch = document.querySelector('.tree-no-match');
    if (noMatch) noMatch.hidden = shownRepositories > 0;

    filterOrphanedIssues(pass);

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

    const entry = pass.index.pullRequestsByKey.get(pullRequestElement.dataset.id);
    let isVisible = false;
    if (entry) {
        // Attention and the SYNC match come from the index and the loaded statuses,
        // never from what a previous pass painted
        const syncStatus = pass.syncStatuses ? pass.syncStatuses[entry.syncKey] : undefined;
        const { visible, attention } = evaluatePullRequest(entry, pass.filters, syncStatus);
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

// The orphaned issues section: one row per issue in review without a pull
// request, evaluated by its key (a row the index does not know is hidden),
// highlighted when it waits for a selected participant; the section's
// counter is refreshed and the section hidden while no row is visible
function filterOrphanedIssues(pass) {
    const section = document.querySelector('.orphaned-issues');
    if (!section) return;
    let total = 0;
    let visible = 0;
    for (const row of section.querySelectorAll('.orphaned-issue')) {
        const entry = pass.index.orphanedIssuesByKey.get(row.dataset.issueKey);
        const { visible: isVisible, attention } = entry
            ? evaluateOrphanedIssue(entry, pass.filters)
            : { visible: false, attention: false };
        row.classList.toggle('needs-attention', attention);
        setDisplay(row, isVisible ? '' : 'none');
        total++;
        if (isVisible) {
            visible++;
            if (attention) pass.shownAttention++;
        }
    }
    const counter = section.querySelector('.repo-pr-counter');
    if (counter) updateCounterDisplay(counter, visible, total, 'issue');
    setDisplay(section, visible > 0 ? '' : 'none');
}

// Only touches the style when it changes, to keep style invalidation minimal
function setDisplay(element, value) {
    if (element.style.display !== value) {
        element.style.display = value;
    }
}
