import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseUnifiedDiff, conflictingFiles, decideFromDiffstat } from '../conflicts.mjs';

// A one-file, one-hunk patch as git prints it; `body` holds the hunk lines with their leading space, - or +
function patch(file, header, body) {
    return `diff --git a/${file} b/${file}\nindex 1111111..2222222 100644\n--- a/${file}\n+++ b/${file}\n@@ ${header} @@\n${body.join('\n')}\n`;
}
const base = [' l1', ' l2', ' l3', ' l4', ' l5', ' l6'];
// The six-line file with line `n` replaced by `text` (1-based)
function modify(file, n, text) {
    return patch(file, '-1,6 +1,6', base.map((line, i) => (i === n - 1 ? [`-${line.slice(1)}`, `+${text}`] : [line])).flat());
}
// The six-line file with `text` inserted after line `n`
function insertAfter(file, n, text) {
    return patch(file, '-1,6 +1,7', base.flatMap((line, i) => (i === n - 1 ? [line, `+${text}`] : [line])));
}
const regions = (files, path) => files.get(path).regions;

test('parseUnifiedDiff reads change regions in base coordinates: a modification and an insertion', () => {
    const files = parseUnifiedDiff(patch('f.txt', '-1,6 +1,7', [' l1', ' l2', '-l3', '+L3', ' l4', ' l5', '+X', ' l6']));
    assert.deepEqual([...files.keys()], ['f.txt']);
    const file = files.get('f.txt');
    assert.equal(file.oldPath, 'f.txt');
    assert.equal(file.newPath, 'f.txt');
    assert.deepEqual({ added: file.added, deleted: file.deleted, binary: file.binary }, { added: false, deleted: false, binary: false });
    assert.deepEqual(file.regions, [
        { start: 3, end: 4, lines: ['L3'] },
        { start: 6, end: 6, lines: ['X'] }
    ]);
});

test('parseUnifiedDiff: an insertion-only hunk sits before the line that follows it', () => {
    const files = parseUnifiedDiff(patch('f.txt', '-5,0 +6,2', ['+a', '+b']));
    assert.deepEqual(regions(files, 'f.txt'), [{ start: 6, end: 6, lines: ['a', 'b'] }]);
});

test('parseUnifiedDiff: added, deleted, binary and renamed files', () => {
    const added = parseUnifiedDiff('diff --git a/n.txt b/n.txt\nnew file mode 100644\nindex 0000000..2222222\n--- /dev/null\n+++ b/n.txt\n@@ -0,0 +1,2 @@\n+a\n+b\n');
    assert.equal(added.get('n.txt').added, true);
    assert.deepEqual(regions(added, 'n.txt'), [{ start: 1, end: 1, lines: ['a', 'b'] }]);

    const deleted = parseUnifiedDiff('diff --git a/d.txt b/d.txt\ndeleted file mode 100644\nindex 1111111..0000000\n--- a/d.txt\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-a\n-b\n');
    assert.equal(deleted.get('d.txt').deleted, true);
    assert.deepEqual(regions(deleted, 'd.txt'), [{ start: 1, end: 3, lines: [] }]);

    const binary = parseUnifiedDiff('diff --git a/img.png b/img.png\nindex 1111111..2222222 100644\nBinary files a/img.png and b/img.png differ\n');
    assert.equal(binary.get('img.png').binary, true);
    assert.deepEqual(regions(binary, 'img.png'), []);

    const renamed = parseUnifiedDiff('diff --git a/old.txt b/new.txt\nsimilarity index 100%\nrename from old.txt\nrename to new.txt\n');
    assert.deepEqual([...renamed.keys()], ['old.txt']);
    assert.equal(renamed.get('old.txt').newPath, 'new.txt');
    assert.deepEqual(regions(renamed, 'old.txt'), []);
});

test('parseUnifiedDiff: several files, several hunks, an empty context line, CRLF line endings, "no newline" markers', () => {
    // The first hunk of b.txt has an empty context line (its leading space stripped): it still counts as a base line
    const text = patch('a.txt', '-1,6 +1,6', [' l1', ' l2', '-l3', '+A3', ' l4', ' l5', ' l6']) +
        'diff --git a/b.txt b/b.txt\nindex 1111111..2222222 100644\n--- a/b.txt\n+++ b/b.txt\n@@ -1,4 +1,4 @@\n-x\n+y\n z\n\n w\n\\ No newline at end of file\n@@ -11,2 +11,2 @@\n p\n-q\n+Q\n\\ No newline at end of file\n';
    const files = parseUnifiedDiff(text.replace(/\n/g, '\r\n'));
    assert.deepEqual([...files.keys()], ['a.txt', 'b.txt']);
    assert.deepEqual(regions(files, 'a.txt'), [{ start: 3, end: 4, lines: ['A3'] }]);
    assert.deepEqual(regions(files, 'b.txt'), [{ start: 1, end: 2, lines: ['y'] }, { start: 12, end: 13, lines: ['Q'] }]);
});

test('conflictingFiles: overlapping or touching changes conflict, separated ones do not', () => {
    const a = parseUnifiedDiff(modify('f.txt', 3, 'A3'));
    assert.deepEqual(conflictingFiles(a, parseUnifiedDiff(modify('f.txt', 3, 'B3'))), ['f.txt']); // same line
    assert.deepEqual(conflictingFiles(a, parseUnifiedDiff(modify('f.txt', 4, 'B4'))), ['f.txt']); // adjacent line
    assert.deepEqual(conflictingFiles(a, parseUnifiedDiff(modify('f.txt', 2, 'B2'))), ['f.txt']); // adjacent line, other side
    assert.deepEqual(conflictingFiles(a, parseUnifiedDiff(modify('f.txt', 5, 'B5'))), []); // one unchanged line between
});

test('conflictingFiles: an insertion conflicts with a change of the lines around it', () => {
    const insertion = parseUnifiedDiff(insertAfter('f.txt', 3, 'X'));
    assert.deepEqual(conflictingFiles(insertion, parseUnifiedDiff(modify('f.txt', 4, 'B4'))), ['f.txt']); // the line after
    assert.deepEqual(conflictingFiles(insertion, parseUnifiedDiff(modify('f.txt', 3, 'B3'))), ['f.txt']); // the line before
    assert.deepEqual(conflictingFiles(insertion, parseUnifiedDiff(modify('f.txt', 6, 'B6'))), []);
    assert.deepEqual(conflictingFiles(insertion, parseUnifiedDiff(insertAfter('f.txt', 3, 'Y'))), ['f.txt']); // same place, different text
    assert.deepEqual(conflictingFiles(insertion, parseUnifiedDiff(insertAfter('f.txt', 3, 'X'))), []); // same insertion on both sides
});

test('conflictingFiles: the same change on both sides merges cleanly', () => {
    const a = parseUnifiedDiff(modify('f.txt', 3, 'X3'));
    const b = parseUnifiedDiff(modify('f.txt', 3, 'X3'));
    assert.deepEqual(conflictingFiles(a, b), []);
});

test('conflictingFiles: added on both sides, deleted on one side, binaries', () => {
    const addedA = 'diff --git a/n.txt b/n.txt\nnew file mode 100644\n--- /dev/null\n+++ b/n.txt\n@@ -0,0 +1,2 @@\n+a\n+b\n';
    const addedSame = parseUnifiedDiff(addedA);
    const addedOther = parseUnifiedDiff(addedA.replace('+b\n', '+c\n'));
    assert.deepEqual(conflictingFiles(parseUnifiedDiff(addedA), addedSame), []);
    assert.deepEqual(conflictingFiles(parseUnifiedDiff(addedA), addedOther), ['n.txt']);

    const deleted = parseUnifiedDiff('diff --git a/f.txt b/f.txt\ndeleted file mode 100644\n--- a/f.txt\n+++ /dev/null\n@@ -1,6 +0,0 @@\n-l1\n-l2\n-l3\n-l4\n-l5\n-l6\n');
    assert.deepEqual(conflictingFiles(deleted, parseUnifiedDiff(modify('f.txt', 5, 'B5'))), ['f.txt']); // modify/delete
    assert.deepEqual(conflictingFiles(deleted, deleted), []); // deleted on both sides

    const binary = parseUnifiedDiff('diff --git a/img.png b/img.png\nindex 1111111..2222222 100644\nBinary files a/img.png and b/img.png differ\n');
    assert.deepEqual(conflictingFiles(binary, binary), ['img.png']);
});

test('conflictingFiles: only the files present on both sides count, sorted', () => {
    const a = parseUnifiedDiff(modify('b.txt', 3, 'A') + modify('a.txt', 3, 'A') + modify('only-a.txt', 3, 'A'));
    const b = parseUnifiedDiff(modify('a.txt', 3, 'B') + modify('b.txt', 3, 'B') + modify('only-b.txt', 3, 'B'));
    assert.deepEqual(conflictingFiles(a, b), ['a.txt', 'b.txt']);
});

test('decideFromDiffstat: deletions are decided without a patch, the rest is checked', () => {
    const source = new Map([
        ['gone-both.txt', { status: 'removed', sidePath: 'gone-both.txt' }],
        ['gone-here.txt', { status: 'removed', sidePath: 'gone-here.txt' }],
        ['kept.txt', { status: 'modified', sidePath: 'kept.txt' }],
        ['moved.txt', { status: 'renamed', sidePath: 'moved-here.txt' }],
        ['only-source.txt', { status: 'modified', sidePath: 'only-source.txt' }]
    ]);
    const dest = new Map([
        ['gone-both.txt', { status: 'removed', sidePath: 'gone-both.txt' }],
        ['gone-here.txt', { status: 'modified', sidePath: 'gone-here.txt' }],
        ['kept.txt', { status: 'modified', sidePath: 'kept.txt' }],
        ['moved.txt', { status: 'modified', sidePath: 'moved.txt' }],
        ['only-dest.txt', { status: 'added', sidePath: 'only-dest.txt' }]
    ]);
    assert.deepEqual(decideFromDiffstat(source, dest), { conflicting: ['gone-here.txt'], toCheck: ['kept.txt', 'moved.txt'] });
    assert.deepEqual(decideFromDiffstat(new Map(), dest), { conflicting: [], toCheck: [] });
});
