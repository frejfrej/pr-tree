import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { generateProjectData } from '../fixtures/generate.mjs';
import { renderRepositories, renderOrphanedIssues, findRootBranches, calculateTotalPullRequests, calculateDescendants } from '../public/app-render.js';

const projects = createRequire(import.meta.url)('../projects.js');

function count(html, needle) {
    return html.split(needle).length - 1;
}

const author = { account_id: 'author-id', uuid: 'author-uuid', display_name: 'Author', links: { avatar: { href: 'https://avatars/author.png' } } };
const jane = { account_id: 'jane-id', uuid: 'jane-uuid', display_name: 'Jane', links: { avatar: { href: 'https://avatars/jane.png' } } };

function pullRequest(id, { repo = 'repo-one', source, destination, participants = [], updated = '2026-09-01T10:00:00.000Z', ahead = 0, behind = null } = {}) {
    return {
        id,
        title: `PR ${id}`,
        created_on: '2026-08-30T09:00:00.000Z',
        updated_on: updated,
        commitsAhead: ahead,
        commitsBehind: behind,
        author,
        participants: [{ user: author, approved: false, state: null }, ...participants],
        source: {
            branch: { name: source },
            commit: { hash: `s${id}` },
            repository: { name: repo, links: { html: { href: `https://bitbucket.org/ws/${repo}` } } }
        },
        destination: { branch: { name: destination }, commit: { hash: `d${id}` } },
        links: { html: { href: `https://bitbucket.org/ws/${repo}/pull-requests/${id}` } },
        rendered: { title: { html: `<p>PR ${id}</p>` }, description: { html: '' } }
    };
}

// repo-one: main <- PR 1 <- PR 2 (stacked); repo-two: develop <- PR 3 (approved by Jane), PR 4 (more recent)
const stacked = pullRequest(1, { source: 'feat-a', destination: 'main', ahead: 2, behind: 3 });
const child = pullRequest(2, { source: 'feat-b', destination: 'feat-a' });
const approved = pullRequest(3, { repo: 'repo-two', source: 'feat-c1', destination: 'develop', participants: [{ user: jane, approved: true, state: 'approved' }], updated: '2026-09-02T10:00:00.000Z', behind: 100 });
const recent = pullRequest(4, { repo: 'repo-two', source: 'feat-c2', destination: 'develop', updated: '2026-09-03T10:00:00.000Z' });
const pullRequests = [stacked, child, approved, recent];
const byDestination = new Map([['main', [stacked]], ['feat-a', [child]], ['develop', [approved, recent]]]);
const jiraIssuesMap = { '1': ['PROJ-1'], '3': ['PROJ-2'] };
const jiraIssuesDetails = [
    { key: 'PROJ-1', fields: { summary: 'First', status: { name: 'In Progress' }, priority: { name: 'High', iconUrl: 'https://jira/high.svg' } } },
    { key: 'PROJ-2', fields: { summary: 'Second', status: { name: 'In Review' }, priority: null } }
];

function renderSample() {
    return renderRepositories(pullRequests, jiraIssuesMap, jiraIssuesDetails, byDestination, 'site');
}

// The opening tag of every pull request, by id: { '1': 'pull-request status-in-progress pull-request-root', ... }
function pullRequestClasses(html) {
    return Object.fromEntries(Array.from(html.matchAll(/<div class="(pull-request [^"]*)" data-id="(\d+)">/g), match => [match[2], match[1]]));
}

test('findRootBranches keeps the destination branches that are no pull request source', () => {
    assert.deepEqual(findRootBranches(pullRequests), ['main', 'develop']);
});

test('calculateTotalPullRequests and calculateDescendants count the whole stack', () => {
    assert.equal(calculateTotalPullRequests([stacked], byDestination), 2);
    assert.equal(calculateTotalPullRequests([approved, recent], byDestination), 2);
    assert.equal(calculateDescendants(stacked, byDestination), 1);
    assert.equal(calculateDescendants(child, byDestination), 0);

    // A chain of five pull requests: the root has four descendants
    const chain = Array.from({ length: 5 }, (_, i) => pullRequest(10 + i, { source: `step-${i + 1}`, destination: i === 0 ? 'main' : `step-${i}` }));
    const chainByDestination = new Map(chain.map(pr => [pr.destination.branch.name, [pr]]));
    assert.equal(calculateDescendants(chain[0], chainByDestination), 4);
    assert.equal(calculateTotalPullRequests([chain[0]], chainByDestination), 5);
});

test('renderRepositories renders one block per repository with its root branches and counters', () => {
    const html = renderSample();
    assert.equal(count(html, '<div class="repository">'), 2);
    assert.ok(html.includes('<h2 class="repository-name">repo-one</h2>'));
    assert.ok(html.includes('<h2 class="repository-name">repo-two</h2>'));
    assert.equal(count(html, 'class="root-branch"'), 2);
    assert.ok(html.includes('href="https://bitbucket.org/ws/repo-one/branch/main"'));
    assert.ok(html.includes('href="https://bitbucket.org/ws/repo-two/branch/develop"'));
    // Root branch counters include the descendants: main has 1 + 1, develop 2
    assert.equal(count(html, 'title="2 total pull requests (including all descendants)"'), 2);
    assert.equal(count(html, 'class="pull-request '), 4);
    // The no-match message is rendered hidden after the repositories; the filter pass shows it
    assert.equal(count(html, '<div class="state-message tree-no-match" hidden>'), 1);
});

test('renderRepositories renders nothing, not even the no-match message, without pull requests', () => {
    assert.equal(renderRepositories([], {}, [], new Map(), 'site'), '');
});

test('renderRepositories nests a stacked pull request under its parent, most recent siblings first', () => {
    const html = renderSample();
    assert.equal(count(html, '<div class="children">'), 1);
    assert.ok(html.indexOf('<div class="children">') < html.indexOf('data-id="2"'));
    assert.ok(html.indexOf('data-id="1"') < html.indexOf('<div class="children">'));
    // Under develop, PR 4 (updated later) comes before PR 3
    assert.ok(html.indexOf('data-id="4"') < html.indexOf('data-id="3"'));
    // The parent gets a toggle button and a visible child counter; the child, neither
    assert.ok(html.includes('title="1 descendant pull request"'));
    assert.equal(count(html, 'onclick="toggleChildren(this)"'), 1);
    assert.equal(count(html, 'class="child-counter visible"'), 3);
});

test('renderRepositories derives the status class from the linked issues and the reviews', () => {
    const classes = pullRequestClasses(renderSample());
    assert.equal(classes['1'], 'pull-request status-in-progress pull-request-root');
    assert.equal(classes['2'], 'pull-request ');
    assert.equal(classes['3'], 'pull-request status-in-review-all-approved pull-request-root');
    assert.equal(classes['4'], 'pull-request  pull-request-root');
});

test('renderRepositories renders the issues, participants, commit badges and alerts of a pull request', () => {
    const html = renderSample();
    assert.ok(html.includes('data-issue-key="PROJ-1"'));
    assert.ok(html.includes('PROJ-1 (In Progress)'));
    assert.ok(html.includes('href="https://site.atlassian.net/browse/PROJ-2"'));
    assert.equal(count(html, 'class="jira-priority-icon"'), 1);
    assert.ok(html.includes('data-author="Jane" data-review-status="approved"'));
    assert.equal(count(html, 'data-review-status="author"'), 4);
    assert.ok(html.includes('</i>+2'));
    assert.ok(html.includes('</i>-3'));
    assert.ok(html.includes('</i>at least -100'));
    assert.ok(html.includes('Pull request has no other participants'));
});

test('renderRepositories writes what the popovers and the SYNC badges read back', () => {
    const html = renderSample();
    assert.ok(html.includes(`data-rendered-title="${encodeURIComponent('<p>PR 1</p>')}"`));
    assert.ok(html.includes(`data-rendered-description="${encodeURIComponent('No description provided.')}"`));
    assert.ok(html.includes('data-repo-name="repo-one"'));
    assert.ok(html.includes('data-spec="d1..s1"'));
});

test('renderRepositories renders every pull request of the fixture projects once, deep stack included', () => {
    for (const [name, config] of Object.entries(projects)) {
        const data = generateProjectData(name, config);
        const byDest = new Map(Object.entries(data.pullRequestsByDestination));
        const html = renderRepositories(data.pullRequests, data.jiraIssuesMap, data.jiraIssuesDetails, byDest, data.jiraSiteName);
        assert.equal(count(html, 'class="pull-request '), data.pullRequests.length, name);
        assert.equal(count(html, '<div class="repository">'), new Set(data.pullRequests.map(pr => pr.source.repository.name)).size, name);
        assert.equal(count(html, '<div class="children">'), data.pullRequests.filter(pr => byDest.has(pr.source.branch.name)).length, name);
        assert.equal(count(html, 'tree-no-match'), 1, name);
    }
});

test('renderOrphanedIssues renders nothing without issues and one block per issue otherwise', () => {
    assert.equal(renderOrphanedIssues([]), '');
    assert.equal(renderOrphanedIssues(undefined), '');
    const html = renderOrphanedIssues([
        { key: 'PROJ-9', jiraSiteName: 'site', fields: { summary: 'Nine', status: { name: 'In Review' }, priority: { name: 'Low', iconUrl: 'https://jira/low.svg' } } },
        { key: 'PROJ-10', jiraSiteName: 'site', fields: { summary: 'Ten', status: { name: 'In Review' }, priority: null } }
    ]);
    assert.ok(html.includes('JIRA Issues In Review without Pull Requests (2)'));
    assert.equal(count(html, '<div class="orphaned-issue">'), 2);
    assert.equal(count(html, 'class="orphaned-issue-priority"'), 1);
    assert.ok(html.includes('href="https://site.atlassian.net/browse/PROJ-10"'));
    assert.equal(count(html, 'Status: In Review'), 2);
});
