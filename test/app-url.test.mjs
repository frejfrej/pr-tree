import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterUrlParams, filtersFromUrl, projectFromUrl, urlWithFilters } from '../public/app-url.js';

const noFilters = { text: '', participants: [], work: 'all', sprints: [], fixVersions: [], epics: [], stories: [], sync: 'Show all' };

test('filtersFromUrl reads every filter, repeated parameters included', () => {
    const filters = filtersFromUrl('?project=PROJ&q=banner&participant=John&participant=Jane&work=reviewers&sprint=1&sprint=2&fixVersion=10&epic=PROJ-1&story=PROJ-2&sync=requested');
    assert.deepEqual(filters, {
        text: 'banner',
        participants: ['John', 'Jane'],
        work: 'reviewers',
        sprints: ['1', '2'],
        fixVersions: ['10'],
        epics: ['PROJ-1'],
        stories: ['PROJ-2'],
        sync: 'requested'
    });
});

test('filtersFromUrl defaults every filter without parameters', () => {
    assert.deepEqual(filtersFromUrl(''), noFilters);
    assert.deepEqual(filtersFromUrl('?project=PROJ&foo=1'), noFilters);
});

test('filtersFromUrl reads the work values it knows and defaults the others to all', () => {
    assert.equal(filtersFromUrl('?work=reviews').work, 'reviews');
    assert.equal(filtersFromUrl('?work=issues').work, 'issues');
    assert.equal(filtersFromUrl('?work=ready').work, 'ready');
    assert.equal(filtersFromUrl('?work=assignees').work, 'assignees');
    assert.equal(filtersFromUrl('?work=reviewers').work, 'reviewers');
    assert.equal(filtersFromUrl('?work=all').work, 'all');
    assert.equal(filtersFromUrl('?work=true').work, 'all');
    assert.equal(filtersFromUrl('?work=').work, 'all');
    assert.equal(filtersFromUrl('?work=assignees&work=reviewers').work, 'assignees'); // the first of repeated parameters, like project
});

test('filtersFromUrl ignores the people parameters of links written before 2.8.0', () => {
    assert.deepEqual(filtersFromUrl('?assignee=John&reviewer=Jane&readyReviewer=true&readyAssignee=true&ready=true'), noFilters);
});

test('projectFromUrl reads the project when it is one of the offered ones', () => {
    assert.equal(projectFromUrl('?project=PROJ&q=banner', ['OTHER', 'PROJ']), 'PROJ');
    assert.equal(projectFromUrl('project=PROJ', ['PROJ']), 'PROJ');
});

test('projectFromUrl is null for a project not offered, an empty name or no parameter', () => {
    assert.equal(projectFromUrl('?project=GONE', ['PROJ']), null);
    assert.equal(projectFromUrl('?project=proj', ['PROJ']), null);
    assert.equal(projectFromUrl('?project=', ['PROJ', '']), null);
    assert.equal(projectFromUrl('?q=banner', ['PROJ']), null);
    assert.equal(projectFromUrl('', []), null);
});

test('projectFromUrl reads the first of repeated project parameters', () => {
    assert.equal(projectFromUrl('?project=A&project=B', ['A', 'B']), 'A');
});

test('the project survives a round trip through the URL', () => {
    const url = urlWithFilters(new URL('http://localhost:3000/'), { project: 'PROJ', filters: noFilters });
    assert.equal(projectFromUrl(url.search, ['PROJ']), 'PROJ');
    assert.equal(projectFromUrl(urlWithFilters(url, { project: null, filters: noFilters }).search, ['PROJ']), null);
});

test('urlWithFilters writes the project and the active filters only, and keeps the other parameters', () => {
    const url = urlWithFilters(new URL('http://localhost:3000/?foo=1&participant=Old&work=assignees&sync=OK'), {
        project: 'PROJ',
        filters: { ...noFilters, text: '  banner ', participants: ['John'], work: 'reviewers' }
    });
    assert.equal(url.search, '?foo=1&project=PROJ&q=banner&participant=John&work=reviewers');
});

test('urlWithFilters removes the people parameters of links written before 2.8.0', () => {
    const url = urlWithFilters(new URL('http://localhost:3000/?project=PROJ&assignee=John&reviewer=Jane&readyReviewer=true&readyAssignee=true&ready=true&foo=1'), { project: 'PROJ', filters: noFilters });
    assert.equal(url.search, '?project=PROJ&foo=1');
});

test('urlWithFilters writes the work value only with participants selected, and never its default', () => {
    const url = urlWithFilters(new URL('http://localhost:3000/'), { project: 'PROJ', filters: { ...noFilters, work: 'reviewers' } });
    assert.equal(url.search, '?project=PROJ');
    const ready = urlWithFilters(new URL('http://localhost:3000/'), { project: 'PROJ', filters: { ...noFilters, participants: ['John'], work: 'ready' } });
    assert.equal(ready.search, '?project=PROJ&participant=John&work=ready');
    const all = urlWithFilters(new URL('http://localhost:3000/'), { project: 'PROJ', filters: { ...noFilters, participants: ['John'], work: 'all' } });
    assert.equal(all.search, '?project=PROJ&participant=John');
});

test('urlWithFilters without a project drops the project parameter', () => {
    const url = urlWithFilters(new URL('http://localhost:3000/?project=PROJ&q=x'), { project: null, filters: noFilters });
    assert.equal(url.search, '');
});

test('urlWithFilters leaves the URL it is given untouched', () => {
    const original = new URL('http://localhost:3000/?project=PROJ');
    urlWithFilters(original, { project: 'OTHER', filters: noFilters });
    assert.equal(original.search, '?project=PROJ');
});

test('the filters survive a round trip through the URL', () => {
    const filters = { text: 'a b', participants: ['J', 'B'], work: 'assignees', sprints: ['1'], fixVersions: ['2'], epics: ['P-1'], stories: ['P-2'], sync: 'requested' };
    const url = urlWithFilters(new URL('http://localhost:3000/'), { project: 'P', filters });
    assert.deepEqual(filtersFromUrl(url.search), filters);
});

test('filterUrlParams covers every parameter urlWithFilters writes, plus the former people parameters', () => {
    const filters = { text: 't', participants: ['a'], work: 'reviewers', sprints: ['1'], fixVersions: ['2'], epics: ['e'], stories: ['s'], sync: 'OK' };
    const written = [...urlWithFilters(new URL('http://localhost:3000/'), { project: 'P', filters }).searchParams.keys()].filter(key => key !== 'project');
    assert.deepEqual(new Set([...written, 'assignee', 'reviewer', 'readyReviewer', 'readyAssignee', 'ready']), new Set(filterUrlParams));
});

test('values with spaces and special characters survive the round trip', () => {
    const filters = { ...noFilters, text: 'a&b+c%d é=f', participants: ['Jean-Luc Picard'], epics: ['PROJ-1'] };
    const url = urlWithFilters(new URL('http://localhost:3000/'), { project: 'A & B', filters });
    assert.deepEqual(filtersFromUrl(url.search), filters);
    assert.equal(projectFromUrl(url.search, ['A & B']), 'A & B');
    assert.equal(urlWithFilters(url, { project: '', filters: noFilters }).search, '');
});
