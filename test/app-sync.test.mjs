import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conflictsTitle } from '../public/app-sync.js';

test('conflictsTitle falls back to "Conflicts found" without a usable file list', () => {
    assert.equal(conflictsTitle(undefined), 'Conflicts found');
    assert.equal(conflictsTitle(null), 'Conflicts found');
    assert.equal(conflictsTitle([]), 'Conflicts found');
    assert.equal(conflictsTitle('file.js'), 'Conflicts found');
    assert.equal(conflictsTitle({ length: 3 }), 'Conflicts found');
});

test('conflictsTitle lists the files one per line, capped at five, in the given order', () => {
    assert.equal(conflictsTitle(['a']), 'Conflicts in:\na');
    assert.equal(conflictsTitle(['a', 'b', 'c', 'd', 'e']), 'Conflicts in:\na\nb\nc\nd\ne');
    assert.equal(conflictsTitle(['a', 'b', 'c', 'd', 'e', 'f']), 'Conflicts in:\na\nb\nc\nd\ne\nand 1 more');
    assert.equal(conflictsTitle(['a', 'b', 'c', 'd', 'e', 'f', 'g']), 'Conflicts in:\na\nb\nc\nd\ne\nand 2 more');
});
