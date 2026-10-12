import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterUrlParams, filtersFromUrl, projectFromUrl, urlWithFilters, filtersKeptOverGaps, selectedFromUrl, urlWithSelection } from '../public/app-url.js';

const noFilters = { text: '', participants: [], work: 'all', hideDrafts: false, sprints: [], fixVersions: [], epics: [], stories: [], sync: 'Show all' };

test('filtersFromUrl reads every filter, repeated parameters included', () => {
    const filters = filtersFromUrl('?project=PROJ&q=banner&participant=John&participant=Jane&work=reviewers&drafts=hide&sprint=1&sprint=2&fixVersion=10&epic=PROJ-1&story=PROJ-2&sync=requested');
    assert.deepEqual(filters, {
        text: 'banner',
        participants: ['John', 'Jane'],
        work: 'reviewers',
        hideDrafts: true,
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

test('filtersFromUrl hides the drafts for drafts=hide only, and urlWithFilters writes it only when they are hidden', () => {
    assert.equal(filtersFromUrl('?drafts=hide').hideDrafts, true);
    assert.equal(filtersFromUrl('?drafts=show').hideDrafts, false);
    assert.equal(filtersFromUrl('?drafts=').hideDrafts, false);
    const base = new URL('http://localhost:3000/?drafts=hide');
    assert.equal(urlWithFilters(base, { project: 'P', filters: { ...noFilters, hideDrafts: true } }).search, '?project=P&drafts=hide');
    assert.equal(urlWithFilters(base, { project: 'P', filters: noFilters }).search, '?project=P');
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
    const filters = { text: 'a b', participants: ['J', 'B'], work: 'assignees', hideDrafts: true, sprints: ['1'], fixVersions: ['2'], epics: ['P-1'], stories: ['P-2'], sync: 'requested' };
    const url = urlWithFilters(new URL('http://localhost:3000/'), { project: 'P', filters });
    assert.deepEqual(filtersFromUrl(url.search), filters);
});

test('urlWithFilters writes the parameters in sidebar order, so a link of 2.10 reads the same', () => {
    const filters = { text: 't', participants: ['a', 'b'], work: 'reviewers', hideDrafts: true, sprints: ['1'], fixVersions: ['2'], epics: ['e'], stories: ['s'], sync: 'OK' };
    assert.equal(urlWithFilters(new URL('http://localhost:3000/'), { project: 'P', filters }).search,
        '?project=P&q=t&sprint=1&fixVersion=2&epic=e&story=s&participant=a&participant=b&work=reviewers&drafts=hide&sync=OK');
});

test('filterUrlParams covers every parameter urlWithFilters writes, plus the former people parameters', () => {
    const filters = { text: 't', participants: ['a'], work: 'reviewers', hideDrafts: true, sprints: ['1'], fixVersions: ['2'], epics: ['e'], stories: ['s'], sync: 'OK' };
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

test('filtersKeptOverGaps: the filters a gap feeds keep the values of the URL, the others are the state', () => {
    const fromUrl = filtersFromUrl('?sprint=5240&sprint=7&epic=OLD-1&story=S-1&fixVersion=2.0&participant=Ann&work=ready&q=text');
    const state = { ...fromUrl, sprints: ['7'], epics: [], stories: [], fixVersions: [], participants: [], work: 'all' };
    assert.deepEqual(filtersKeptOverGaps(state, fromUrl, ['sprints']), { ...state, sprints: ['5240', '7'] });
    assert.deepEqual(filtersKeptOverGaps(state, fromUrl, ['parents']), { ...state, epics: ['OLD-1'], stories: ['S-1'], fixVersions: ['2.0'] });
    assert.deepEqual(filtersKeptOverGaps(state, fromUrl, ['parents', 'sprints']), { ...state, sprints: ['5240', '7'], epics: ['OLD-1'], stories: ['S-1'], fixVersions: ['2.0'] });
    // Complete data, or a part it does not know: the state alone
    assert.deepEqual(filtersKeptOverGaps(state, fromUrl, []), state);
    assert.deepEqual(filtersKeptOverGaps(state, fromUrl, ['orphaned']), state);
    assert.deepEqual(filtersKeptOverGaps(state, fromUrl, undefined), state);
});

test('selectedFromUrl reads the row wanted, a pull-request key or an issue key; null without one', () => {
    assert.equal(selectedFromUrl('?project=P&selected=repo-one%2F45'), 'repo-one/45');
    assert.equal(selectedFromUrl('selected=PROJ-9'), 'PROJ-9');
    assert.equal(selectedFromUrl('?selected='), null);
    assert.equal(selectedFromUrl(''), null);
});

test('urlWithSelection sets or drops the row wanted and keeps every other parameter; the filter writes keep it', () => {
    const url = new URL('http://localhost:3000/?project=P&q=fix&selected=repo-one%2F1');
    const moved = urlWithSelection(url, 'repo-two/2');
    assert.equal(selectedFromUrl(moved.search), 'repo-two/2');
    assert.equal(moved.searchParams.get('q'), 'fix');
    assert.equal(url.searchParams.get('selected'), 'repo-one/1'); // left untouched
    assert.equal(urlWithSelection(url, null).searchParams.has('selected'), false);
    assert.equal(urlWithSelection(url, null).searchParams.get('project'), 'P');
    assert.ok(!filterUrlParams.includes('selected'));
    assert.equal(selectedFromUrl(urlWithFilters(url, { project: 'P', filters: noFilters }).search), 'repo-one/1');
});
