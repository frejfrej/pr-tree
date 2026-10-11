import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { multiSelectFilters, defaultFilters } from '../public/filter-registry.js';

test('the registry lists the five multi-selects in sidebar order, with unique keys, elements and URL parameters', () => {
    assert.deepEqual(multiSelectFilters.map(filter => filter.key), ['sprints', 'fixVersions', 'epics', 'stories', 'participants']);
    for (const property of ['key', 'elementId', 'urlParam']) {
        const values = multiSelectFilters.map(filter => filter[property]);
        assert.equal(new Set(values).size, values.length, `${property} values are unique`);
    }
});

test('every element of the registry is a multi-select of index.html', () => {
    const html = readFileSync(path.resolve(import.meta.dirname, '../public/index.html'), 'utf8');
    for (const { elementId } of multiSelectFilters) {
        assert.ok(html.includes(`class="multi-select" id="${elementId}"`), elementId);
    }
});

test('defaultFilters has the four scalar defaults and an empty, fresh selection per multi-select', () => {
    const filters = defaultFilters();
    assert.deepEqual(filters, { text: '', work: 'all', hideDrafts: false, sync: 'Show all', sprints: [], fixVersions: [], epics: [], stories: [], participants: [] });
    assert.notEqual(defaultFilters().sprints, filters.sprints); // a new array each call
});
