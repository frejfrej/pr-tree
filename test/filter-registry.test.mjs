import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { multiSelectFilters, singleValueFilters, defaultFilters, singleValueFilterActive, applyFilterRequirements, readSingleValueControls, writeSingleValueControls } from '../public/filter-registry.js';

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

// The opening tag of the element of that id in index.html
const openingTag = id => html.match(new RegExp(`<(select|input)\\b[^>]*\\bid="${id}"[^>]*>`))?.[0] ?? '';

test('every single-value filter is a select or a checkbox of index.html, read through the matching property', () => {
    for (const { elementId, property } of singleValueFilters) {
        const tag = openingTag(elementId);
        assert.ok(property === 'checked' ? /^<input\b[^>]*\btype="checkbox"/.test(tag) : tag.startsWith('<select'), `${elementId}: ${tag}`);
    }
});

test('the Work values read from the URL are the options of the Work select', () => {
    const select = html.match(/<select\b[^>]*\bid="workSelect"[^>]*>([\s\S]*?)<\/select>/)[1];
    const options = [...select.matchAll(/<option value="([^"]*)"/g)].map(match => match[1]);
    const [work] = singleValueFilters;
    assert.deepEqual(options.filter(value => work.fromUrl(value) === value), options.filter(value => value !== work.defaultValue));
    assert.ok(options.includes(work.defaultValue));
});

test('defaultFilters holds the text, the default of every single-value filter and a selection per multi-select, nothing else', () => {
    const keys = ['text', ...singleValueFilters.map(filter => filter.key), ...multiSelectFilters.map(filter => filter.key)];
    assert.deepEqual(Object.keys(defaultFilters()).sort(), keys.sort());
    for (const { key, defaultValue } of singleValueFilters) assert.equal(defaultFilters()[key], defaultValue);
});

test('a single-value filter reads its default from a missing or empty URL parameter, and a value written to the URL back', () => {
    const written = { work: 'ready', hideDrafts: true, sync: 'requested' };
    for (const { key, fromUrl, toUrl = value => value } of singleValueFilters) {
        assert.equal(fromUrl(null), undefined, key);
        assert.equal(fromUrl(''), undefined, key);
        // Through the URL, as the browser does: the parameter is a string
        const param = new URLSearchParams({ [key]: toUrl(written[key]) }).get(key);
        assert.equal(fromUrl(param), written[key], key);
    }
    const [work, hideDrafts] = singleValueFilters;
    assert.equal(work.fromUrl('true'), undefined); // a value the select does not offer
    assert.equal(hideDrafts.fromUrl('show'), undefined);
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

test('applyFilterRequirements: without participants Work is back to its default and its select disabled; with some, the select shows the state', () => {
    const workSelect = { value: 'ready', disabled: false };
    const getElement = id => (id === 'workSelect' ? workSelect : null);
    const without = { ...defaultFilters(), work: 'ready' };
    applyFilterRequirements(without, getElement);
    assert.equal(without.work, 'all');
    assert.deepEqual(workSelect, { value: 'all', disabled: true });
    const withParticipant = { ...defaultFilters(), work: 'reviewers', participants: ['Ann'] };
    applyFilterRequirements(withParticipant, getElement);
    assert.equal(withParticipant.work, 'reviewers');
    assert.deepEqual(workSelect, { value: 'reviewers', disabled: false });
    applyFilterRequirements({ ...defaultFilters(), hideDrafts: true, sync: 'OK' }, () => null); // no control, no throw
});
