import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeAttention, countActiveFilters } from '../public/app-filter.js';

const author = { uuid: 'author-uuid', display_name: 'Author' };
const jane = { uuid: 'jane-uuid', display_name: 'Jane' };
const bob = { uuid: 'bob-uuid', display_name: 'Bob' };

function pullRequest(participants) {
    return { id: 1, author, participants };
}

const issueAssignedToJane = { key: 'PROJ-1', fields: { assignee: { displayName: 'Jane' } } };
const issueUnassigned = { key: 'PROJ-2', fields: { assignee: null } };

const noFilters = { linkedIssues: [], assignees: [], reviewers: [] };

test('reviewer attention when a selected reviewer has not approved an in-review PR', () => {
    const pr = pullRequest([{ user: author, approved: false }, { user: jane, approved: false }]);
    const attention = computeAttention(pr, { ...noFilters, statusInProgress: false, statusInReview: true, reviewers: ['Jane'] });
    assert.deepEqual(attention, { assignee: false, reviewer: true, any: true });
});

test('no reviewer attention once the selected reviewer approved', () => {
    const pr = pullRequest([{ user: author, approved: false }, { user: jane, approved: true }, { user: bob, approved: false }]);
    const attention = computeAttention(pr, { ...noFilters, statusInProgress: false, statusInReview: true, reviewers: ['Jane'] });
    assert.equal(attention.reviewer, false);
    assert.equal(attention.any, false);
});

test('reviewer attention matches any of several selected reviewers', () => {
    const pr = pullRequest([{ user: author, approved: false }, { user: jane, approved: true }, { user: bob, approved: false }]);
    const attention = computeAttention(pr, { ...noFilters, statusInProgress: false, statusInReview: true, reviewers: ['Jane', 'Bob'] });
    assert.equal(attention.reviewer, true);
});

test('the author never counts as a reviewer', () => {
    const pr = pullRequest([{ user: author, approved: false }]);
    const attention = computeAttention(pr, { ...noFilters, statusInProgress: false, statusInReview: true, reviewers: ['Author'] });
    assert.equal(attention.reviewer, false);
});

test('reviewer attention only applies to PRs in review', () => {
    const pr = pullRequest([{ user: author, approved: false }, { user: jane, approved: false }]);
    const attention = computeAttention(pr, { ...noFilters, statusInProgress: true, statusInReview: false, reviewers: ['Jane'] });
    assert.equal(attention.reviewer, false);
});

test('assignee attention when a selected assignee owns an issue of an in-progress PR', () => {
    const pr = pullRequest([{ user: author, approved: false }]);
    const attention = computeAttention(pr, {
        statusInProgress: true, statusInReview: false,
        linkedIssues: [issueUnassigned, issueAssignedToJane], assignees: ['Jane'], reviewers: []
    });
    assert.deepEqual(attention, { assignee: true, reviewer: false, any: true });
});

test('assignee attention only applies to PRs in progress', () => {
    const pr = pullRequest([{ user: author, approved: false }]);
    const attention = computeAttention(pr, {
        statusInProgress: false, statusInReview: true,
        linkedIssues: [issueAssignedToJane], assignees: ['Jane'], reviewers: []
    });
    assert.equal(attention.assignee, false);
});

test('no attention without assignee or reviewer filters', () => {
    const pr = pullRequest([{ user: author, approved: false }, { user: jane, approved: false }]);
    const attention = computeAttention(pr, { ...noFilters, statusInProgress: true, statusInReview: true, linkedIssues: [issueAssignedToJane] });
    assert.deepEqual(attention, { assignee: false, reviewer: false, any: false });
});

test('countActiveFilters counts filters, not selected values', () => {
    const defaults = { assignees: [], reviewers: [], sprints: [], fixVersions: [], sync: 'Show all', ready: false };
    assert.equal(countActiveFilters(defaults), 0);
    assert.equal(countActiveFilters({ ...defaults, reviewers: ['Jane', 'Bob'], ready: true }), 2);
    assert.equal(countActiveFilters({ ...defaults, sync: 'requested' }), 1);
    assert.equal(countActiveFilters({ assignees: ['A'], reviewers: ['J'], sprints: ['1'], fixVersions: ['2'], sync: 'OK', ready: true }), 6);
    assert.equal(countActiveFilters({ ...defaults, text: '   ' }), 0);
    assert.equal(countActiveFilters({ ...defaults, text: 'banner' }), 1);
    assert.equal(countActiveFilters({ ...defaults, epics: ['PROJ-100', 'PROJ-101'] }), 1);
    assert.equal(countActiveFilters({ ...defaults, stories: ['PROJ-200'] }), 1);
});

// ------------------------------------------------------------------ index and evaluation

import { buildFilterIndex, evaluatePullRequest } from '../public/app-filter.js';

const sampleApiResult = {
    pullRequests: [
        {
            id: 10, title: 'fix(PROJ-1): restore the banner', source: { branch: { name: 'JD_260901_PROJ-1_Banner' } },
            author, participants: [{ user: author, approved: false }, { user: jane, approved: false }, { user: bob, approved: true }]
        },
        {
            id: 11, title: 'chore: bump dependencies', source: { branch: { name: 'chore/bump-deps' } },
            author, participants: [{ user: author, approved: false }]
        }
    ],
    jiraIssuesMap: { 10: ['PROJ-1', 'PROJ-2', 'PROJ-404'], 11: [] },
    jiraIssuesDetails: [
        { key: 'PROJ-1', fields: { assignee: { displayName: 'Jane' }, fixVersions: [{ id: 100, name: '1.0' }] } },
        { key: 'PROJ-2', fields: { assignee: null, fixVersions: [] } }
    ],
    sprintIssues: { 5240: ['PROJ-2', 'PROJ-9'], 5241: ['PROJ-9'] }
};

const rendered = { statusInProgress: false, statusInReview: true, hasSyncLabel: false };
const noFilter = { assignees: [], reviewers: [], sprints: [], fixVersions: [], sync: 'Show all', ready: false };

test('buildFilterIndex links issues, assignees, reviewers, sprints and fix versions per pull request', () => {
    const { pullRequestsById } = buildFilterIndex(sampleApiResult);
    const entry = pullRequestsById.get(10);
    assert.deepEqual(entry.linkedIssues.map(issue => issue.key), ['PROJ-1', 'PROJ-2']); // PROJ-404 is unknown
    assert.deepEqual([...entry.assignees], ['Jane']);
    assert.deepEqual([...entry.reviewers], ['Jane', 'Bob']); // the author is not a reviewer
    assert.deepEqual([...entry.sprints], ['5240']);
    assert.deepEqual([...entry.fixVersions], ['100']);
    const bare = pullRequestsById.get(11);
    assert.equal(bare.linkedIssues.length, 0);
    assert.equal(bare.reviewers.size, 0);
});

test('buildFilterIndex tolerates an empty result', () => {
    assert.equal(buildFilterIndex({}).pullRequestsById.size, 0);
});

test('evaluatePullRequest shows everything without filters', () => {
    const { pullRequestsById } = buildFilterIndex(sampleApiResult);
    assert.equal(evaluatePullRequest(pullRequestsById.get(10), noFilter, rendered).visible, true);
    assert.equal(evaluatePullRequest(pullRequestsById.get(11), noFilter, rendered).visible, true);
});

test('evaluatePullRequest matches any selected value of each filter, and every filter must match', () => {
    const { pullRequestsById } = buildFilterIndex(sampleApiResult);
    const entry = pullRequestsById.get(10);
    const evaluate = filters => evaluatePullRequest(entry, { ...noFilter, ...filters }, rendered).visible;
    assert.equal(evaluate({ assignees: ['Bob', 'Jane'] }), true);
    assert.equal(evaluate({ assignees: ['Bob'] }), false);
    assert.equal(evaluate({ reviewers: ['Bob'] }), true);
    assert.equal(evaluate({ reviewers: ['Author'] }), false);
    assert.equal(evaluate({ sprints: ['5240'] }), true);
    assert.equal(evaluate({ sprints: [5240] }), true); // ids may come as numbers
    assert.equal(evaluate({ sprints: ['5241'] }), false);
    assert.equal(evaluate({ fixVersions: ['100'] }), true);
    assert.equal(evaluate({ fixVersions: ['200'] }), false);
    assert.equal(evaluate({ assignees: ['Jane'], reviewers: ['Bob'], sprints: ['5240'], fixVersions: ['100'] }), true);
    assert.equal(evaluate({ assignees: ['Jane'], sprints: ['5241'] }), false);
});

test('evaluatePullRequest SYNC filter follows the rendered badge', () => {
    const { pullRequestsById } = buildFilterIndex(sampleApiResult);
    const entry = pullRequestsById.get(10);
    assert.equal(evaluatePullRequest(entry, { ...noFilter, sync: 'requested' }, { ...rendered, hasSyncLabel: true }).visible, true);
    assert.equal(evaluatePullRequest(entry, { ...noFilter, sync: 'requested' }, { ...rendered, hasSyncLabel: false }).visible, false);
    assert.equal(evaluatePullRequest(entry, { ...noFilter, sync: 'OK' }, { ...rendered, hasSyncLabel: false }).visible, true);
    assert.equal(evaluatePullRequest(entry, { ...noFilter, sync: 'OK' }, { ...rendered, hasSyncLabel: true }).visible, false);
});

test('evaluatePullRequest ready filter keeps pull requests with reviewer attention only', () => {
    const { pullRequestsById } = buildFilterIndex(sampleApiResult);
    const entry = pullRequestsById.get(10);
    const jane = evaluatePullRequest(entry, { ...noFilter, reviewers: ['Jane'], ready: true }, rendered);
    assert.equal(jane.visible, true);
    assert.equal(jane.attention.reviewer, true);
    const bobApproved = evaluatePullRequest(entry, { ...noFilter, reviewers: ['Bob'], ready: true }, rendered);
    assert.equal(bobApproved.visible, false);
    assert.equal(bobApproved.attention.any, false);
});

// ------------------------------------------------------------------ text filter

import { parseTextQuery, matchesText } from '../public/app-filter.js';

test('parseTextQuery lower-cases, trims and splits on whitespace', () => {
    assert.deepEqual(parseTextQuery('  Fix  PROJ-12\tbanner '), ['fix', 'proj-12', 'banner']);
    assert.deepEqual(parseTextQuery(''), []);
    assert.deepEqual(parseTextQuery('   '), []);
    assert.deepEqual(parseTextQuery(undefined), []);
});

test('matchesText requires every term as a substring', () => {
    const searchText = 'fix(proj-12): restore banner feature/proj-12-banner proj-12';
    assert.equal(matchesText(searchText, []), true);
    assert.equal(matchesText(searchText, ['banner']), true);
    assert.equal(matchesText(searchText, ['proj-12', 'restore']), true);
    assert.equal(matchesText(searchText, ['banner', 'footer']), false);
    assert.equal(matchesText(searchText, ['ann']), true); // substring, not whole word
    assert.equal(matchesText('', ['x']), false);
});

test('buildFilterIndex searches the title, the source branch and the issue keys only', () => {
    const { pullRequestsById } = buildFilterIndex(sampleApiResult);
    assert.equal(pullRequestsById.get(10).searchText, 'fix(proj-1): restore the banner jd_260901_proj-1_banner proj-1 proj-2 proj-404');
    assert.equal(pullRequestsById.get(11).searchText, 'chore: bump dependencies chore/bump-deps');
    const bare = buildFilterIndex({
        pullRequests: [{ id: 12, title: 'Hotfix', author, participants: [] }],
        jiraIssuesMap: {}, jiraIssuesDetails: [], sprintIssues: {}
    });
    assert.equal(bare.pullRequestsById.get(12).searchText, 'hotfix'); // no source branch
});

test('evaluatePullRequest text filter is case-insensitive and needs every word', () => {
    const { pullRequestsById } = buildFilterIndex(sampleApiResult);
    const evaluate = text => evaluatePullRequest(pullRequestsById.get(10), { ...noFilter, text }, rendered).visible;
    assert.equal(evaluate(''), true);
    assert.equal(evaluate('BANNER'), true);
    assert.equal(evaluate('proj-404'), true); // a key of jiraIssuesMap without details (the keys are searched even when the title changes)
    assert.equal(evaluate('jd_260901'), true); // the source branch
    assert.equal(evaluate('restore banner'), true);
    assert.equal(evaluate('banner footer'), false);
    assert.equal(evaluate('Author'), false); // people are not searched
});

// ------------------------------------------------------------------ epic filter

import { issueLevel, epicOf, issueOptions } from '../public/app-filter.js';

const epicType = { name: 'Epic', subtask: false, hierarchyLevel: 1 };
const storyType = { name: 'Story', subtask: false, hierarchyLevel: 0 };
const bugType = { name: 'Bug', subtask: false, hierarchyLevel: 0 };
const subtaskType = { name: 'Sub-task', subtask: true, hierarchyLevel: -1 };

// Jira returns the parent with a few inline fields (summary, status, priority, issuetype)
const inlineEpicAi = { id: '1', key: 'PROJ-100', fields: { summary: 'Assistive AI', status: {}, priority: {}, issuetype: epicType } };
const inlineStoryChat = { id: '2', key: 'PROJ-200', fields: { summary: 'Chat panel', status: {}, priority: {}, issuetype: storyType } };

const epicAi = { key: 'PROJ-100', fields: { summary: 'Assistive AI', issuetype: epicType } };
const epicUx = { key: 'PROJ-101', fields: { summary: 'UX', issuetype: epicType } };
const storyInEpic = { key: 'PROJ-200', fields: { summary: 'Chat panel', issuetype: storyType, parent: inlineEpicAi } };
const storyInUx = { key: 'PROJ-203', fields: { summary: 'Toolbar', issuetype: storyType, parent: { id: '3', key: 'PROJ-101', fields: { summary: 'UX', status: {}, priority: {}, issuetype: epicType } } } };
const bugWithoutEpic = { key: 'PROJ-201', fields: { summary: 'Crash on save', issuetype: bugType } };
const subtaskOfStory = { key: 'PROJ-300', fields: { summary: 'Chat panel: API', issuetype: subtaskType, parent: inlineStoryChat } };
const subtaskOfUnknown = { key: 'PROJ-301', fields: { summary: 'Orphan work', issuetype: subtaskType, parent: { key: 'PROJ-999', fields: { summary: 'Unknown story', issuetype: storyType } } } };
const parentOnlyStory = { key: 'PROJ-202', fields: { fixVersions: [] } }; // fetched with fix versions only (older server)

test('issueLevel classifies epics, standard issues and sub-tasks, and defaults to standard', () => {
    assert.equal(issueLevel(epicAi), 'epic');
    assert.equal(issueLevel({ key: 'X-1', fields: { issuetype: { name: 'Epic' } } }), 'epic'); // no hierarchyLevel
    assert.equal(issueLevel(storyInEpic), 'standard');
    assert.equal(issueLevel(bugWithoutEpic), 'standard');
    assert.equal(issueLevel(subtaskOfStory), 'subtask');
    assert.equal(issueLevel({ key: 'X-2', fields: { issuetype: { name: 'Sub-task', subtask: true } } }), 'subtask');
    assert.equal(issueLevel(parentOnlyStory), 'standard');
});

test('epicOf resolves the epic itself, a direct epic parent and the epic of a sub-task parent', () => {
    const issuesByKey = new Map([epicAi, storyInEpic, bugWithoutEpic, subtaskOfStory, subtaskOfUnknown].map(issue => [issue.key, issue]));
    assert.deepEqual(epicOf(epicAi, issuesByKey), { key: 'PROJ-100', summary: 'Assistive AI' });
    assert.deepEqual(epicOf(storyInEpic, issuesByKey), { key: 'PROJ-100', summary: 'Assistive AI' });
    assert.deepEqual(epicOf(subtaskOfStory, issuesByKey), { key: 'PROJ-100', summary: 'Assistive AI' });
    assert.equal(epicOf(bugWithoutEpic, issuesByKey), null);
    assert.equal(epicOf(subtaskOfUnknown, issuesByKey), null); // the parent is not in the details
    assert.equal(epicOf(parentOnlyStory, issuesByKey), null);
    // A sub-task whose direct parent is an epic needs no lookup
    assert.deepEqual(epicOf({ key: 'PROJ-304', fields: { summary: 'Odd', issuetype: subtaskType, parent: inlineEpicAi } }, new Map()), { key: 'PROJ-100', summary: 'Assistive AI' });
});

test('epicOf needs the parent of the parent story, which the server now fetches for parent-only stories', () => {
    const parentOnlyWithEpic = { key: 'PROJ-202', fields: { summary: 'Search page', issuetype: storyType, fixVersions: [], parent: inlineEpicAi } };
    const subtask = { key: 'PROJ-302', fields: { summary: 'Search page: index', issuetype: subtaskType, parent: { key: 'PROJ-202', fields: { summary: 'Search page', issuetype: storyType } } } };
    assert.deepEqual(epicOf(subtask, new Map([[parentOnlyWithEpic.key, parentOnlyWithEpic]])), { key: 'PROJ-100', summary: 'Assistive AI' });
    assert.equal(epicOf(subtask, new Map([[parentOnlyStory.key, parentOnlyStory]])), null); // older server: no parent on the story
});

const hierarchyApiResult = {
    pullRequests: [
        { id: 20, title: 'PROJ-200 chat panel', source: { branch: { name: 'feature/PROJ-200' } }, author, participants: [] },
        { id: 21, title: 'PROJ-300 chat panel api', source: { branch: { name: 'feature/PROJ-300' } }, author, participants: [] },
        { id: 22, title: 'PROJ-201 crash on save', source: { branch: { name: 'bugfix/PROJ-201' } }, author, participants: [] },
        { id: 23, title: 'PROJ-100 epic branch', source: { branch: { name: 'feature/PROJ-100' } }, author, participants: [] },
        { id: 24, title: 'PROJ-200 PROJ-203 both', source: { branch: { name: 'feature/both' } }, author, participants: [] }
    ],
    jiraIssuesMap: { 20: ['PROJ-200'], 21: ['PROJ-300'], 22: ['PROJ-201'], 23: ['PROJ-100'], 24: ['PROJ-200', 'PROJ-203'] },
    jiraIssuesDetails: [epicAi, epicUx, storyInEpic, storyInUx, bugWithoutEpic, subtaskOfStory],
    sprintIssues: {}
};

test('buildFilterIndex collects the epics of every pull request and the list of epics', () => {
    const { pullRequestsById, epics } = buildFilterIndex(hierarchyApiResult);
    assert.deepEqual([...pullRequestsById.get(20).epics], ['PROJ-100']);
    assert.deepEqual([...pullRequestsById.get(21).epics], ['PROJ-100']); // through the parent story
    assert.deepEqual([...pullRequestsById.get(22).epics], []);
    assert.deepEqual([...pullRequestsById.get(23).epics], ['PROJ-100']); // linked to the epic itself
    assert.deepEqual([...pullRequestsById.get(24).epics], ['PROJ-100', 'PROJ-101']); // two issues under two epics
    assert.deepEqual([...epics.values()], [{ key: 'PROJ-100', summary: 'Assistive AI' }, { key: 'PROJ-101', summary: 'UX' }]);
    assert.equal(buildFilterIndex({}).epics.size, 0);
});

test('evaluatePullRequest epic filter matches any selected epic', () => {
    const { pullRequestsById } = buildFilterIndex(hierarchyApiResult);
    const evaluate = (id, epics) => evaluatePullRequest(pullRequestsById.get(id), { ...noFilter, epics }, rendered).visible;
    assert.equal(evaluate(20, ['PROJ-100']), true);
    assert.equal(evaluate(21, ['PROJ-100']), true);
    assert.equal(evaluate(22, ['PROJ-100']), false);
    assert.equal(evaluate(22, []), true);
    assert.equal(evaluate(20, ['PROJ-999', 'PROJ-100']), true);
    assert.equal(evaluate(20, ['PROJ-999']), false);
});

test('issueOptions labels "KEY Summary" and sorts by project then newest issue first', () => {
    const options = issueOptions([
        { key: 'PROJ-9', summary: 'Nine' }, { key: 'ALPHA-100', summary: 'Hundred' },
        { key: 'PROJ-10', summary: 'Ten' }, { key: 'ALPHA-2', summary: 'Two' }
    ]);
    assert.deepEqual(options, [
        { value: 'ALPHA-100', label: 'ALPHA-100 Hundred' }, { value: 'ALPHA-2', label: 'ALPHA-2 Two' },
        { value: 'PROJ-10', label: 'PROJ-10 Ten' }, { value: 'PROJ-9', label: 'PROJ-9 Nine' }
    ]);
    assert.deepEqual(issueOptions(new Map([['X-1', { key: 'X-1', summary: 'One' }]]).values()), [{ value: 'X-1', label: 'X-1 One' }]);
    assert.deepEqual(issueOptions([{ key: 'X-2', summary: '' }]), [{ value: 'X-2', label: 'X-2' }]); // parent fetched without a summary by an older server
});

// ----------------------------------------------------------------- story filter

import { storyOf } from '../public/app-filter.js';

test('storyOf is the issue itself, the parent of a sub-task, and nothing for an epic', () => {
    assert.deepEqual(storyOf(storyInEpic), { key: 'PROJ-200', summary: 'Chat panel' });
    assert.deepEqual(storyOf(bugWithoutEpic), { key: 'PROJ-201', summary: 'Crash on save' });
    assert.deepEqual(storyOf(subtaskOfStory), { key: 'PROJ-200', summary: 'Chat panel' });
    assert.deepEqual(storyOf(subtaskOfUnknown), { key: 'PROJ-999', summary: 'Unknown story' }); // the inline parent is enough
    assert.equal(storyOf(epicAi), null);
    assert.equal(storyOf({ key: 'PROJ-303', fields: { issuetype: subtaskType } }), null); // sub-task without parent
});

test('buildFilterIndex collects the stories of every pull request and the list of stories', () => {
    const { pullRequestsById, stories } = buildFilterIndex(hierarchyApiResult);
    assert.deepEqual([...pullRequestsById.get(20).stories], ['PROJ-200']);
    assert.deepEqual([...pullRequestsById.get(21).stories], ['PROJ-200']); // the parent of the sub-task
    assert.deepEqual([...pullRequestsById.get(22).stories], ['PROJ-201']);
    assert.deepEqual([...pullRequestsById.get(23).stories], []); // an epic is not a story
    assert.deepEqual([...pullRequestsById.get(24).stories], ['PROJ-200', 'PROJ-203']); // two issues, two stories
    assert.deepEqual([...stories.keys()], ['PROJ-200', 'PROJ-201', 'PROJ-203']);
    assert.equal(buildFilterIndex({}).stories.size, 0);
});

test('evaluatePullRequest story filter matches any selected story', () => {
    const { pullRequestsById } = buildFilterIndex(hierarchyApiResult);
    const evaluate = (id, stories) => evaluatePullRequest(pullRequestsById.get(id), { ...noFilter, stories }, rendered).visible;
    assert.equal(evaluate(20, ['PROJ-200']), true);
    assert.equal(evaluate(21, ['PROJ-200']), true);
    assert.equal(evaluate(22, ['PROJ-200']), false);
    assert.equal(evaluate(22, ['PROJ-200', 'PROJ-201']), true);
    assert.equal(evaluate(23, ['PROJ-200']), false);
    assert.equal(evaluate(23, []), true);
});

test('epic and story filters combine as AND, and a story linked together with its own sub-task counts once', () => {
    const { pullRequestsById } = buildFilterIndex(hierarchyApiResult);
    const evaluate = (id, filters) => evaluatePullRequest(pullRequestsById.get(id), { ...noFilter, ...filters }, rendered).visible;
    assert.equal(evaluate(21, { epics: ['PROJ-100'], stories: ['PROJ-200'] }), true);
    assert.equal(evaluate(21, { epics: ['PROJ-100'], stories: ['PROJ-201'] }), false);
    assert.equal(evaluate(22, { epics: ['PROJ-100'], stories: ['PROJ-201'] }), false); // the story matches, the epic does not
    const both = buildFilterIndex({
        ...hierarchyApiResult,
        pullRequests: [{ id: 30, title: 'PROJ-200 PROJ-300 both', source: { branch: { name: 'feature/both' } }, author, participants: [] }],
        jiraIssuesMap: { 30: ['PROJ-200', 'PROJ-300'] }
    });
    assert.deepEqual([...both.pullRequestsById.get(30).stories], ['PROJ-200']);
    assert.equal(countActiveFilters({ assignees: [], reviewers: [], sprints: [], fixVersions: [], sync: 'Show all', ready: false, epics: ['PROJ-100'], stories: ['PROJ-200'] }), 2);
});
