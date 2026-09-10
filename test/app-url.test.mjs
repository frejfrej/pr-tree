import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterUrlParams, filtersFromUrl, urlWithFilters } from '../public/app-url.js';

const noFilters = { text: '', assignees: [], reviewers: [], sprints: [], fixVersions: [], epics: [], stories: [], sync: 'Show all', readyReviewer: false, readyAssignee: false };

test('filtersFromUrl reads every filter, repeated parameters included', () => {
    const filters = filtersFromUrl('?project=PROJ&q=banner&assignee=John&assignee=Jane&reviewer=Bob&sprint=1&sprint=2&fixVersion=10&epic=PROJ-1&story=PROJ-2&sync=requested&readyReviewer=true&readyAssignee=true');
    assert.deepEqual(filters, {
        text: 'banner',
        assignees: ['John', 'Jane'],
        reviewers: ['Bob'],
        sprints: ['1', '2'],
        fixVersions: ['10'],
        epics: ['PROJ-1'],
        stories: ['PROJ-2'],
        sync: 'requested',
        readyReviewer: true,
        readyAssignee: true
    });
});

test('filtersFromUrl defaults every filter without parameters', () => {
    assert.deepEqual(filtersFromUrl(''), noFilters);
    assert.deepEqual(filtersFromUrl('?project=PROJ&foo=1'), noFilters);
});

test('filtersFromUrl reads the former ready parameter as readyReviewer', () => {
    assert.equal(filtersFromUrl('?ready=true').readyReviewer, true);
    assert.equal(filtersFromUrl('?ready=true').readyAssignee, false);
    assert.equal(filtersFromUrl('?readyReviewer=false').readyReviewer, false);
});

test('urlWithFilters writes the project and the active filters only, and keeps the other parameters', () => {
    const url = urlWithFilters(new URL('http://localhost:3000/?foo=1&assignee=Old&ready=true&sync=OK'), {
        project: 'PROJ',
        filters: { ...noFilters, text: '  banner ', assignees: ['John'], readyReviewer: true }
    });
    assert.equal(url.search, '?foo=1&project=PROJ&q=banner&assignee=John&readyReviewer=true');
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
    const filters = { text: 'a b', assignees: ['J'], reviewers: ['B', 'C'], sprints: ['1'], fixVersions: ['2'], epics: ['P-1'], stories: ['P-2'], sync: 'requested', readyReviewer: true, readyAssignee: true };
    const url = urlWithFilters(new URL('http://localhost:3000/'), { project: 'P', filters });
    assert.deepEqual(filtersFromUrl(url.search), filters);
});

test('filterUrlParams covers every parameter urlWithFilters writes, plus the former ready', () => {
    const filters = { text: 't', assignees: ['a'], reviewers: ['r'], sprints: ['1'], fixVersions: ['2'], epics: ['e'], stories: ['s'], sync: 'OK', readyReviewer: true, readyAssignee: true };
    const written = [...urlWithFilters(new URL('http://localhost:3000/'), { project: 'P', filters }).searchParams.keys()].filter(key => key !== 'project');
    assert.deepEqual(new Set([...written, 'ready']), new Set(filterUrlParams));
});

test('values with spaces and special characters survive the round trip', () => {
    const filters = { ...noFilters, text: 'a&b+c%d é=f', assignees: ['Jean-Luc Picard'], epics: ['PROJ-1'] };
    const url = urlWithFilters(new URL('http://localhost:3000/'), { project: 'P', filters });
    assert.deepEqual(filtersFromUrl(url.search), filters);
    assert.equal(urlWithFilters(url, { project: '', filters: noFilters }).search, '');
});
