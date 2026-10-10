import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMultiSelect } from '../public/multi-select.js';

// The surface of the page the component touches: getElementById for its root,
// one click listener on the document, the focused element. The markup is not
// parsed: the root answers the selectors of the component with fake parts.
let fakeDocument;

function part() {
    const classes = new Set();
    const attributes = {};
    const listeners = {};
    let renders = 0;
    let html = '';
    const element = {
        classList: {
            add: name => classes.add(name),
            remove: name => classes.delete(name),
            contains: name => classes.has(name)
        },
        getAttribute: name => attributes[name] ?? null,
        setAttribute(name, value) { attributes[name] = String(value); },
        addEventListener(type, listener) { (listeners[type] ??= []).push(listener); },
        dispatch(type, event = {}) {
            for (const listener of listeners[type] ?? []) listener({ stopPropagation() {}, preventDefault() {}, target: element, ...event });
        },
        focus() { fakeDocument.activeElement = element; },
        querySelectorAll: () => [],
        get innerHTML() { return html; },
        set innerHTML(value) { html = value; renders++; },
        get renders() { return renders; },
        textContent: '',
        value: ''
    };
    return element;
}

function multiSelectRoot() {
    const root = part();
    const parts = Object.fromEntries(['trigger', 'dropdown', 'display', 'options', 'search-input', 'clear', 'select-all']
        .map(name => [`.multi-select-${name}`, part()]));
    root.querySelector = selector => parts[selector] ?? null;
    root.contains = target => target === root || Object.values(parts).includes(target);
    return { root, parts };
}

beforeEach(() => {
    const roots = {};
    const listeners = [];
    fakeDocument = {
        activeElement: null,
        roots,
        getElementById: id => roots[id]?.root ?? null,
        addEventListener: (type, listener) => listeners.push(listener),
        click: target => listeners.forEach(listener => listener({ target }))
    };
    globalThis.document = fakeDocument;
});

function open(id) {
    fakeDocument.roots[id] = multiSelectRoot();
    const instance = createMultiSelect(id);
    instance.setOptions([{ value: '1', label: 'One' }]);
    return { instance, ...fakeDocument.roots[id] };
}

test('Escape from the search box closes the dropdown and gives the focus back to the trigger', () => {
    const { root, parts } = open('sprintSelect');
    const trigger = parts['.multi-select-trigger'];
    const search = parts['.multi-select-search-input'];
    trigger.dispatch('click');
    assert.ok(root.classList.contains('open'));
    assert.equal(trigger.getAttribute('aria-expanded'), 'true');
    assert.equal(fakeDocument.activeElement, search);

    search.dispatch('keydown', { key: 'Escape' });
    assert.ok(!root.classList.contains('open'));
    assert.equal(trigger.getAttribute('aria-expanded'), 'false');
    assert.equal(fakeDocument.activeElement, trigger); // not lost on the hidden search box
});

test('a click on the page re-renders only the dropdown it closes, not the closed ones', () => {
    const sprint = open('sprintSelect');
    const epic = open('epicSelect');
    const sprintOptions = sprint.parts['.multi-select-options'];
    const epicOptions = epic.parts['.multi-select-options'];
    const before = [sprintOptions.renders, epicOptions.renders];

    fakeDocument.click({}); // both closed: nothing to reset
    assert.deepEqual([sprintOptions.renders, epicOptions.renders], before);

    sprint.parts['.multi-select-trigger'].dispatch('click');
    fakeDocument.click({});
    assert.ok(!sprint.root.classList.contains('open'));
    assert.deepEqual([sprintOptions.renders, epicOptions.renders], [before[0] + 1, before[1]]); // the search reset of the one closed
});
