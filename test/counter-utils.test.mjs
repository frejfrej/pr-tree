import { test } from 'node:test';
import assert from 'node:assert/strict';
import { updateCounterDisplay } from '../public/counter-utils.js';

// The attribute surface updateCounterDisplay uses, and a count of the writes
function fakeCounter() {
    const attributes = {};
    return {
        textContent: '',
        writes: 0,
        getAttribute(name) { return name in attributes ? attributes[name] : null; },
        setAttribute(name, value) { attributes[name] = value; this.writes += 1; }
    };
}

test('updateCounterDisplay shows the total alone when nothing is filtered, and n/total otherwise', () => {
    const counter = fakeCounter();
    updateCounterDisplay(counter, 13, 13);
    assert.equal(counter.textContent, '13');
    assert.equal(counter.getAttribute('title'), '13 pull requests');
    updateCounterDisplay(counter, 4, 13);
    assert.equal(counter.textContent, '4/13');
    assert.equal(counter.getAttribute('title'), '4 filtered pull requests out of 13 total');
});

test('updateCounterDisplay pluralises the filtered form from the visible count', () => {
    const counter = fakeCounter();
    updateCounterDisplay(counter, 1, 13, 'issue');
    assert.equal(counter.getAttribute('title'), '1 filtered issue out of 13 total');
    updateCounterDisplay(counter, 0, 1, 'issue');
    assert.equal(counter.getAttribute('title'), '0 filtered issues out of 1 total');
    updateCounterDisplay(counter, 1, 1, 'issue');
    assert.equal(counter.textContent, '1');
    assert.equal(counter.getAttribute('title'), '1 issue');
});

test('updateCounterDisplay writes the attribute only when it changes', () => {
    const counter = fakeCounter();
    updateCounterDisplay(counter, 2, 5);
    updateCounterDisplay(counter, 2, 5);
    assert.equal(counter.writes, 1);
});
