import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readStorage, writeStorage, removeStorage } from '../public/local-storage.js';

function withLocalStorage(t, storage) {
    const previous = globalThis.localStorage;
    t.after(() => { globalThis.localStorage = previous; });
    globalThis.localStorage = storage;
}

test('readStorage, writeStorage and removeStorage go to localStorage', t => {
    const map = new Map();
    withLocalStorage(t, { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, String(value)), removeItem: key => map.delete(key) });
    assert.equal(readStorage('prTree.theme'), null);
    writeStorage('prTree.theme', 'dark');
    assert.equal(readStorage('prTree.theme'), 'dark');
    removeStorage('prTree.theme');
    assert.equal(readStorage('prTree.theme'), null);
});

test('a storage that throws (private window, blocked site data, quota) reads as nothing and fails nothing', t => {
    const blocked = () => { throw new Error('SecurityError'); };
    withLocalStorage(t, { getItem: blocked, setItem: blocked, removeItem: blocked });
    assert.equal(readStorage('prTree.theme'), null);
    assert.doesNotThrow(() => writeStorage('prTree.theme', 'dark'));
    assert.doesNotThrow(() => removeStorage('prTree.theme'));
});

test('no localStorage at all (node, a sandboxed frame): the same', t => {
    withLocalStorage(t, undefined);
    delete globalThis.localStorage;
    assert.equal(readStorage('prTree.theme'), null);
    assert.doesNotThrow(() => writeStorage('prTree.theme', 'dark'));
    assert.doesNotThrow(() => removeStorage('prTree.theme'));
});
