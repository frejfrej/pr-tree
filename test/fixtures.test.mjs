import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'module';
import { generateProjectData, generateSyncStatuses, repositoryVolumes } from '../fixtures/generate.mjs';
import { parseFixtureOptions, fixtureConfig, createFixtureSource } from '../fixtures/index.mjs';

const projects = createRequire(import.meta.url)('../projects.js');

function countByRepository(data) {
    const counts = {};
    for (const pullRequest of data.pullRequests) {
        const name = pullRequest.source.repository.name;
        counts[name] = (counts[name] || 0) + 1;
    }
    return counts;
}

test('SECOLLAB has the real-world volumes: 112 pull requests over 4 repositories, 7 sprints, 13 orphaned issues', () => {
    const data = generateProjectData('SECOLLAB', projects.SECOLLAB);
    assert.equal(data.pullRequests.length, 112);
    assert.deepEqual(countByRepository(data), { 'products.secollab': 100, 'products.secollab.client': 2, 'products.web.oslc': 10 });
    assert.equal(data.sprints.length, 7);
    assert.equal(data.sprintIssues['5240'].length, 100);
    assert.equal(data.sprintIssues['5307'].length, 0);
    assert.equal(data.orphanedIssues.length, 13);
    assert.ok(data.jiraIssuesDetails.length >= 100);
});

test('OSLC has the real-world volumes: 24 pull requests over 3 repositories, no orphaned issue', () => {
    const data = generateProjectData('OSLC', projects.OSLC);
    assert.equal(data.pullRequests.length, 24);
    assert.deepEqual(countByRepository(data), { 'products.web.oslc': 10, 'products.web.common': 5, 'products.oslc': 9 });
    assert.equal(data.orphanedIssues.length, 0);
});

test('generation is deterministic: same dataHash on every call', () => {
    const first = generateProjectData('SECOLLAB', projects.SECOLLAB);
    const second = generateProjectData('SECOLLAB', projects.SECOLLAB);
    assert.equal(first.dataHash, second.dataHash);
});

test('a repository shared by two projects yields the same pull requests in both', () => {
    const secollab = generateProjectData('SECOLLAB', projects.SECOLLAB);
    const oslc = generateProjectData('OSLC', projects.OSLC);
    const ids = data => data.pullRequests.filter(pr => pr.source.repository.name === 'products.web.oslc').map(pr => pr.id);
    assert.deepEqual(ids(secollab), ids(oslc));
});

test('every pull request is in the response shape the frontend reads', () => {
    const data = generateProjectData('SECOLLAB', projects.SECOLLAB);
    for (const pr of data.pullRequests) {
        assert.equal(typeof pr.id, 'number');
        assert.ok(pr.source.branch.name && pr.destination.branch.name);
        assert.ok(pr.source.commit.hash && pr.destination.commit.hash);
        assert.ok(pr.source.repository.links.html.href.startsWith('https://bitbucket.org/'));
        assert.ok(pr.author.uuid && pr.author.account_id && pr.author.links.avatar.href);
        assert.ok(pr.participants.length >= 1);
        assert.equal(typeof pr.rendered.title.html, 'string');
        assert.equal(typeof pr.rendered.description.html, 'string');
        assert.ok(Array.isArray(data.jiraIssuesMap[pr.id]));
    }
    for (const issue of data.jiraIssuesDetails) {
        assert.match(issue.key, /^(SECOLLAB|PRDOSLC|WEBCMN)-\d+$/);
        assert.ok(Array.isArray(issue.fields.fixVersions));
    }
    const keys = data.jiraIssuesDetails.map(issue => issue.key);
    assert.equal(new Set(keys).size, keys.length, 'issue keys are unique');
});

function deepestStack(data) {
    const byDestination = data.pullRequestsByDestination;
    const depth = pr => {
        const children = byDestination[pr.source.branch.name];
        return children ? 1 + Math.max(...children.map(depth)) : 1;
    };
    const roots = data.pullRequests.filter(pr => !data.pullRequests.some(other => other.source.branch.name === pr.destination.branch.name));
    return Math.max(...roots.map(depth));
}

test('SECOLLAB carries the real 24-deep stack of pull requests under feat/ai_investigations', () => {
    const data = generateProjectData('SECOLLAB', projects.SECOLLAB);
    assert.equal(deepestStack(data), 24);
    assert.equal(data.pullRequestsByDestination['feat/ai_investigations'].length, 1);
    const chainRepo = data.pullRequests.filter(pr => pr.source.branch.name === 'ai-mcp-tool-layer');
    assert.equal(chainRepo[0].source.repository.name, 'products.secollab');
});

test('the chain depth option shortens the deepest stack', () => {
    const data = generateProjectData('SECOLLAB', projects.SECOLLAB, { chainDepth: 8 });
    assert.equal(deepestStack(data), 8);
    assert.equal(data.pullRequests.length, 112);
});

test('SECollab branches follow the INITIALS_YYMMDD_KEY_Slug convention most of the time', () => {
    const data = generateProjectData('SECOLLAB', projects.SECOLLAB);
    const secollab = data.pullRequests.filter(pr => pr.source.repository.name === 'products.secollab');
    const conventional = secollab.filter(pr => /^[A-Z]{2,4}_\d{6}_[A-Z]+-\d+_/.test(pr.source.branch.name));
    assert.ok(conventional.length > secollab.length / 2, `${conventional.length} of ${secollab.length}`);
});

test('the scale factor multiplies the volumes', () => {
    const data = generateProjectData('SECOLLAB', projects.SECOLLAB, { scale: 3 });
    assert.equal(data.pullRequests.length, Object.values(repositoryVolumes).slice(0, 3).reduce((a, b) => a + b, 0) * 3 + 30);
    assert.equal(data.sprintIssues['5240'].length, 300);
    assert.equal(data.orphanedIssues.length, 39);
});

test('sync statuses cover every pull request with a conflicts or error flag', () => {
    const data = generateProjectData('SECOLLAB', projects.SECOLLAB);
    const sync = generateSyncStatuses(data);
    assert.equal(Object.keys(sync.statuses).length, data.pullRequests.length);
    assert.equal(sync.rateLimited, false);
    for (const status of Object.values(sync.statuses)) {
        assert.ok(status.error === true || typeof status.conflicts === 'boolean');
    }
});

test('fixture options come from the command line or the environment', () => {
    assert.deepEqual(parseFixtureOptions(['node', 'index.mjs'], {}), { enabled: false, scale: 1, chainDepth: 24 });
    assert.deepEqual(parseFixtureOptions(['node', 'index.mjs', '--fixtures'], {}), { enabled: true, scale: 1, chainDepth: 24 });
    assert.deepEqual(parseFixtureOptions(['node', 'index.mjs', '--fixtures', '--fixture-scale=2.5', '--fixture-chain-depth=8'], {}), { enabled: true, scale: 2.5, chainDepth: 8 });
    assert.deepEqual(parseFixtureOptions([], { PR_TREE_FIXTURES: '1', PR_TREE_FIXTURE_SCALE: '4', PR_TREE_FIXTURE_CHAIN_DEPTH: '12' }), { enabled: true, scale: 4, chainDepth: 12 });
    assert.deepEqual(parseFixtureOptions(['--fixtures', '--fixture-scale=abc'], {}), { enabled: true, scale: 1, chainDepth: 24 });
});

test('the fixture source serves both configured projects and refreshes lastRefreshTime', async () => {
    const source = createFixtureSource(fixtureConfig());
    const first = await source.buildProjectData('SECOLLAB');
    const second = await source.buildProjectData('SECOLLAB');
    assert.equal(first.dataHash, second.dataHash);
    assert.ok(second.lastRefreshTime >= first.lastRefreshTime);
    assert.equal((await source.buildProjectData('OSLC')).pullRequests.length, 24);
    await assert.rejects(source.buildProjectData('NOPE'), /Project not found/);
    assert.equal(Object.keys((await source.buildSyncStatuses('OSLC')).statuses).length, 24);
});

import { buildFilterIndex, evaluatePullRequest } from '../public/app-filter.js';

test('the filter index built on the SECOLLAB fixture links every pull request', () => {
    const data = generateProjectData('SECOLLAB', projects.SECOLLAB);
    const { pullRequestsById } = buildFilterIndex(data);
    assert.equal(pullRequestsById.size, data.pullRequests.length);
    const withIssues = [...pullRequestsById.values()].filter(entry => entry.linkedIssues.length > 0);
    assert.ok(withIssues.length > data.pullRequests.length * 0.8);
    const inSprint = [...pullRequestsById.values()].filter(entry => entry.sprints.size > 0);
    assert.ok(inSprint.length > 10, `${inSprint.length} pull requests in a sprint`);
    const noFilter = { assignees: [], reviewers: [], sprints: [], fixVersions: [], sync: 'Show all', ready: false };
    const rendered = { statusInProgress: false, statusInReview: false, hasSyncLabel: false };
    for (const entry of pullRequestsById.values()) {
        assert.equal(evaluatePullRequest(entry, noFilter, rendered).visible, true);
    }
});
