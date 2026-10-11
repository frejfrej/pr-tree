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
    const checkboxes = [part(), part()];
    checkboxes.forEach((checkbox, index) => { checkbox.value = String(index + 1); });
    parts['.multi-select-options'].querySelectorAll = () => checkboxes;
    parts['.multi-select-options'].contains = target => checkboxes.includes(target);
    root.querySelector = selector => parts[selector] ?? null;
    root.contains = target => target === root || Object.values(parts).includes(target) || checkboxes.includes(target);
    return { root, parts, checkboxes };
}

beforeEach(() => {
    const roots = {};
    const listeners = { click: [], keydown: [] };
    fakeDocument = {
        activeElement: null,
        body: { tagName: 'BODY' },
        roots,
        getElementById: id => roots[id]?.root ?? null,
        addEventListener: (type, listener) => listeners[type].push(listener),
        click: target => listeners.click.forEach(listener => listener({ target })),
        keydown: (key, target) => listeners.keydown.forEach(listener => listener({ key, target }))
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

    root.dispatch('keydown', { key: 'Escape', target: search }); // bubbled up from the search box
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

test('the options are escaped: a Jira sprint, epic or story name is text, never markup (#111)', () => {
    const { instance, parts } = open('sprintFilter');
    instance.setOptions([{ value: 'a"b', label: '<img src=x onerror=alert(1)> & co' }]);
    const html = parts['.multi-select-options'].innerHTML;
    assert.ok(html.includes('value="a&quot;b"'));
    assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt; &amp; co'));
    assert.ok(!html.includes('<img'));
});

test('Escape from a checkbox or a button of an open dropdown closes it and focuses the trigger', () => {
    const { root, parts, checkboxes } = open('sprintSelect');
    const trigger = parts['.multi-select-trigger'];
    for (const target of [checkboxes[1], parts['.multi-select-clear'], parts['.multi-select-select-all']]) {
        trigger.dispatch('click');
        target.focus();
        root.dispatch('keydown', { key: 'Escape', target });
        assert.ok(!root.classList.contains('open'));
        assert.equal(trigger.getAttribute('aria-expanded'), 'false');
        assert.equal(fakeDocument.activeElement, trigger);
    }
});

test('the focus leaving for outside the component closes it; inside, or to nowhere, it stays open', () => {
    const { root, parts, checkboxes } = open('sprintSelect');
    parts['.multi-select-trigger'].dispatch('click');
    root.dispatch('focusout', { target: parts['.multi-select-search-input'], relatedTarget: checkboxes[0] });
    assert.ok(root.classList.contains('open'), 'to a checkbox of its own');
    root.dispatch('focusout', { target: checkboxes[0], relatedTarget: null });
    assert.ok(root.classList.contains('open'), 'to nowhere: the window lost the focus, or a click took none');
    root.dispatch('focusout', { target: checkboxes[0], relatedTarget: part() });
    assert.ok(!root.classList.contains('open'), 'to the tree');
});

test('ArrowDown and ArrowUp walk the search box and the checkboxes, and stop at both ends', () => {
    const { root, parts, checkboxes } = open('sprintSelect');
    const search = parts['.multi-select-search-input'];
    parts['.multi-select-trigger'].dispatch('click');
    const press = key => root.dispatch('keydown', { key, target: fakeDocument.activeElement });
    assert.equal(fakeDocument.activeElement, search);
    press('ArrowDown');
    assert.equal(fakeDocument.activeElement, checkboxes[0]);
    press('ArrowDown');
    assert.equal(fakeDocument.activeElement, checkboxes[1]);
    press('ArrowDown');
    assert.equal(fakeDocument.activeElement, checkboxes[1], 'the last one');
    press('ArrowUp');
    press('ArrowUp');
    assert.equal(fakeDocument.activeElement, search);
    press('ArrowUp');
    assert.equal(fakeDocument.activeElement, search, 'the first one');
});

test('ArrowDown on a closed trigger opens the dropdown in the search box; arrows in a closed one do nothing', () => {
    const { root, parts } = open('sprintSelect');
    const trigger = parts['.multi-select-trigger'];
    trigger.focus();
    root.dispatch('keydown', { key: 'ArrowUp', target: trigger });
    assert.ok(!root.classList.contains('open'));
    assert.equal(fakeDocument.activeElement, trigger);
    root.dispatch('keydown', { key: 'ArrowDown', target: trigger });
    assert.ok(root.classList.contains('open'));
    assert.equal(fakeDocument.activeElement, parts['.multi-select-search-input']);
});

test('ArrowUp from Clear all or Select all goes to the last checkbox; ArrowDown there and ArrowUp from the trigger go nowhere', () => {
    const { root, parts, checkboxes } = open('sprintSelect');
    const trigger = parts['.multi-select-trigger'];
    trigger.dispatch('click');
    for (const button of [parts['.multi-select-clear'], parts['.multi-select-select-all']]) {
        button.focus();
        root.dispatch('keydown', { key: 'ArrowDown', target: button });
        assert.equal(fakeDocument.activeElement, button);
        root.dispatch('keydown', { key: 'ArrowUp', target: button });
        assert.equal(fakeDocument.activeElement, checkboxes[1]);
    }
    trigger.focus();
    root.dispatch('keydown', { key: 'ArrowUp', target: trigger });
    assert.equal(fakeDocument.activeElement, trigger);
});

test('a re-render of the options keeps the focus on the same checkbox, or the search box when its option is gone', () => {
    const { instance, parts, checkboxes } = open('sprintSelect');
    parts['.multi-select-trigger'].dispatch('click');
    instance.setOptions([{ value: '1', label: 'One' }, { value: '2', label: 'Two' }]);
    checkboxes[1].focus();
    instance.setOptions([{ value: '1', label: 'One' }, { value: '2', label: 'Two' }]); // the periodic refresh
    assert.equal(fakeDocument.activeElement, checkboxes[1], 'the checkbox of the same value');
    parts['.multi-select-options'].querySelectorAll = () => [checkboxes[0]]; // the option of the focused one is gone
    instance.setOptions([{ value: '1', label: 'One' }]);
    assert.equal(fakeDocument.activeElement, parts['.multi-select-search-input']);
});

test('Escape with the focus on the page body closes an open dropdown (Safari does not focus a clicked checkbox)', () => {
    const { root, parts } = open('sprintSelect');
    parts['.multi-select-trigger'].dispatch('click');
    fakeDocument.activeElement = fakeDocument.body;
    fakeDocument.keydown('Escape', fakeDocument.body);
    assert.ok(!root.classList.contains('open'));
    assert.equal(fakeDocument.activeElement, parts['.multi-select-trigger']);
    fakeDocument.keydown('Escape', fakeDocument.body); // closed: nothing to do
    assert.ok(!root.classList.contains('open'));
});
