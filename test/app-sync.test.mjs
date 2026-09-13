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

test('conflictsTitle of a partial result ends with the reason the other files were not checked', () => {
    const reason = 'too many files to check (120)';
    assert.equal(conflictsTitle(['a'], reason), `Conflicts in:\na\nOther files not checked: ${reason}`);
    assert.equal(conflictsTitle(['a', 'b', 'c', 'd', 'e', 'f', 'g'], reason),
        `Conflicts in:\na\nb\nc\nd\ne\nand 2 more\nOther files not checked: ${reason}`);
    assert.equal(conflictsTitle([], reason), `Conflicts found\nOther files not checked: ${reason}`);
});

test('conflictsTitle without a reason has no "not checked" line', () => {
    assert.equal(conflictsTitle(['a', 'b'], undefined), 'Conflicts in:\na\nb');
    assert.equal(conflictsTitle(['a', 'b'], ''), 'Conflicts in:\na\nb');
    assert.equal(conflictsTitle(['a', 'b', 'c', 'd', 'e', 'f'], null), 'Conflicts in:\na\nb\nc\nd\ne\nand 1 more');
});
