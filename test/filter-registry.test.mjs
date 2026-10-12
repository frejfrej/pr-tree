import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { multiSelectFilters, singleValueFilters, defaultFilters, singleValueFilterActive, readSingleValueControls, writeSingleValueControls } from '../public/filter-registry.js';

const html = readFileSync(path.resolve(import.meta.dirname, '../public/index.html'), 'utf8');

test('the registry lists the five multi-selects and the three single-value filters in sidebar order, with unique keys, elements and URL parameters', () => {
    assert.deepEqual(multiSelectFilters.map(filter => filter.key), ['sprints', 'fixVersions', 'epics', 'stories', 'participants']);
    assert.deepEqual(singleValueFilters.map(filter => filter.key), ['work', 'hideDrafts', 'sync']);
    for (const property of ['key', 'elementId', 'urlParam']) {
        const values = [...multiSelectFilters, ...singleValueFilters].map(filter => filter[property]);
        assert.equal(new Set(values).size, values.length, `${property} values are unique`);
    }
    assert.ok(!['text', 'q', 'project', 'selected'].some(name => singleValueFilters.some(({ key, urlParam }) => key === name || urlParam === name)));
});

test('every element of the registry is a multi-select of index.html', () => {
    for (const { elementId } of multiSelectFilters) {
        assert.ok(html.includes(`class="multi-select" id="${elementId}"`), elementId);
    }
});

test('defaultFilters has the four scalar defaults and an empty, fresh selection per multi-select', () => {
    const filters = defaultFilters();
    assert.deepEqual(filters, { text: '', work: 'all', hideDrafts: false, sync: 'Show all', sprints: [], fixVersions: [], epics: [], stories: [], participants: [] });
    assert.notEqual(defaultFilters().sprints, filters.sprints); // a new array each call
});

test('every single-value filter is a select or a checkbox of index.html, read through the matching property', () => {
    for (const { elementId, property } of singleValueFilters) {
        const tag = property === 'checked' ? `<input type="checkbox" id="${elementId}"` : `<select id="${elementId}"`;
        assert.ok(html.includes(tag), elementId);
    }
});

test('defaultFilters holds the text, the default of every single-value filter and a selection per multi-select, nothing else', () => {
    const keys = ['text', ...singleValueFilters.map(filter => filter.key), ...multiSelectFilters.map(filter => filter.key)];
    assert.deepEqual(Object.keys(defaultFilters()).sort(), keys.sort());
    for (const { key, defaultValue } of singleValueFilters) assert.equal(defaultFilters()[key], defaultValue);
});

test('a single-value filter reads its default from a missing or empty URL parameter, and a value written to the URL back', () => {
    const written = { work: 'ready', hideDrafts: true, sync: 'requested' };
    for (const { key, defaultValue, fromUrl, toUrl = value => value } of singleValueFilters) {
        assert.equal(fromUrl(null), defaultValue, key);
        assert.equal(fromUrl(''), defaultValue, key);
        assert.equal(fromUrl(toUrl(written[key])), written[key], key);
    }
    const [work, hideDrafts] = singleValueFilters;
    assert.equal(work.fromUrl('true'), 'all'); // a value the select does not offer
    assert.equal(hideDrafts.fromUrl('show'), false);
});

test('singleValueFilterActive: away from the default, and with a selection of the multi-select it requires', () => {
    const [work, hideDrafts, sync] = singleValueFilters;
    const defaults = defaultFilters();
    for (const filter of singleValueFilters) assert.equal(singleValueFilterActive(filter, defaults), false, filter.key);
    assert.equal(singleValueFilterActive(work, { ...defaults, work: 'ready' }), false); // no participant
    assert.equal(singleValueFilterActive(work, { ...defaults, work: 'ready', participants: ['Ann'] }), true);
    assert.equal(singleValueFilterActive(work, { ...defaults, participants: ['Ann'] }), false);
    assert.equal(singleValueFilterActive(hideDrafts, { ...defaults, hideDrafts: true }), true);
    assert.equal(singleValueFilterActive(sync, { ...defaults, sync: 'OK' }), true);
    assert.equal(singleValueFilterActive(sync, {}), false); // a missing key is at its default
});

test('the single-value controls: written values read back, defaultFilters resets them, a missing control reads as its default', () => {
    const elements = { workSelect: { value: 'all' }, hideDraftsCheckbox: { checked: false }, syncSelect: { value: 'Show all' } };
    const getElement = id => elements[id] ?? null;
    const values = { ...defaultFilters(), work: 'reviewers', hideDrafts: true, sync: 'unchecked' };
    writeSingleValueControls(values, getElement);
    assert.deepEqual(elements, { workSelect: { value: 'reviewers' }, hideDraftsCheckbox: { checked: true }, syncSelect: { value: 'unchecked' } });
    const read = defaultFilters();
    readSingleValueControls(read, getElement);
    assert.deepEqual(read, values);

    writeSingleValueControls(defaultFilters(), getElement);
    assert.deepEqual(elements, { workSelect: { value: 'all' }, hideDraftsCheckbox: { checked: false }, syncSelect: { value: 'Show all' } });

    const none = { ...values };
    readSingleValueControls(none, () => null);
    assert.deepEqual(none, defaultFilters());
    writeSingleValueControls(values, () => null); // nothing to write, no throw
});
