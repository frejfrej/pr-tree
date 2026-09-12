import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { parseUnifiedDiff, conflictingFiles, decideFromDiffstat } from '../conflicts.mjs';

// The post-image hash of the "index" line, derived from the hunk lines: different contents get different hashes
const hashOf = hunkText => createHash('sha1').update(hunkText).digest('hex').slice(0, 7);

// A one-file, one-hunk patch as git prints it; `body` holds the hunk lines with their leading space, - or +
function patch(file, header, body) {
    return `diff --git a/${file} b/${file}\nindex 1111111..${hashOf(body.join('\n'))} 100644\n--- a/${file}\n+++ b/${file}\n@@ ${header} @@\n${body.join('\n')}\n`;
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
// A file with line `n` replaced by `text` for each [n, text] of `changes`, in order: one hunk per line, without context
function modifyLines(file, changes) {
    const hunks = changes.map(([n, text]) => `@@ -${n} +${n} @@\n-l${n}\n+${text}\n`).join('');
    return `diff --git a/${file} b/${file}\nindex 1111111..${hashOf(hunks)} 100644\n--- a/${file}\n+++ b/${file}\n${hunks}`;
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

test('parseUnifiedDiff: a count missing from a hunk header means one line', () => {
    assert.deepEqual(regions(parseUnifiedDiff(patch('f.txt', '-3 +3', ['-l3', '+X'])), 'f.txt'), [{ start: 3, end: 4, lines: ['X'] }]);
    assert.deepEqual(regions(parseUnifiedDiff(patch('f.txt', '-3,0 +4', ['+X'])), 'f.txt'), [{ start: 4, end: 4, lines: ['X'] }]);
});

test('parseUnifiedDiff: added, deleted, binary and renamed files', () => {
    const added = parseUnifiedDiff('diff --git a/n.txt b/n.txt\nnew file mode 100644\nindex 0000000..2222222\n--- /dev/null\n+++ b/n.txt\n@@ -0,0 +1,2 @@\n+a\n+b\n');
    assert.equal(added.get('n.txt').added, true);
    assert.equal(added.get('n.txt').newHash, '2222222');
    assert.deepEqual(regions(added, 'n.txt'), [{ start: 1, end: 1, lines: ['a', 'b'] }]);

    const deleted = parseUnifiedDiff('diff --git a/d.txt b/d.txt\ndeleted file mode 100644\nindex 1111111..0000000\n--- a/d.txt\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-a\n-b\n');
    assert.equal(deleted.get('d.txt').deleted, true);
    assert.equal(deleted.get('d.txt').newHash, '0000000');
    assert.deepEqual(regions(deleted, 'd.txt'), [{ start: 1, end: 3, lines: [] }]);

    const binary = parseUnifiedDiff('diff --git a/img.png b/img.png\nindex 1111111..2222222 100644\nBinary files a/img.png and b/img.png differ\n');
    assert.equal(binary.get('img.png').binary, true);
    assert.equal(binary.get('img.png').newHash, '2222222');
    assert.deepEqual(regions(binary, 'img.png'), []);

    const renamed = parseUnifiedDiff('diff --git a/old.txt b/new.txt\nsimilarity index 100%\nrename from old.txt\nrename to new.txt\n');
    assert.deepEqual([...renamed.keys()], ['old.txt']);
    assert.equal(renamed.get('old.txt').newPath, 'new.txt');
    assert.equal(renamed.get('old.txt').newHash, null); // no "index" line for a 100% rename
    assert.deepEqual(regions(renamed, 'old.txt'), []);
});

test('parseUnifiedDiff: the paths come from the "diff --git" line (git appends a tab to "---"/"+++" paths with spaces)', () => {
    const files = parseUnifiedDiff('diff --git a/my file.txt b/my file.txt\nindex 4286f42..331bae0 100644\n--- a/my file.txt\t\n+++ b/my file.txt\t\n@@ -1 +1 @@\n-r\n+R\n');
    assert.deepEqual([...files.keys()], ['my file.txt']);
    assert.equal(files.get('my file.txt').oldPath, 'my file.txt');
    assert.equal(files.get('my file.txt').newPath, 'my file.txt');
});

test('parseUnifiedDiff: several files, several hunks, an empty context line, "no newline" markers', () => {
    // The first hunk of b.txt has an empty context line (its leading space stripped): it still counts as a base line
    const text = patch('a.txt', '-1,6 +1,6', [' l1', ' l2', '-l3', '+A3', ' l4', ' l5', ' l6']) +
        'diff --git a/b.txt b/b.txt\nindex 1111111..2222222 100644\n--- a/b.txt\n+++ b/b.txt\n@@ -1,4 +1,4 @@\n-x\n+y\n z\n\n w\n\\ No newline at end of file\n@@ -11,2 +11,2 @@\n p\n-q\n+Q\n\\ No newline at end of file\n';
    const files = parseUnifiedDiff(text);
    assert.deepEqual([...files.keys()], ['a.txt', 'b.txt']);
    assert.deepEqual(regions(files, 'a.txt'), [{ start: 3, end: 4, lines: ['A3'] }]);
    // "Q" ends the side without a newline: it is not the line "Q" with its newline
    assert.deepEqual(regions(files, 'b.txt'), [{ start: 1, end: 2, lines: ['y'] }, { start: 12, end: 13, lines: ['Q\n'] }]);
});

test('parseUnifiedDiff: content lines keep their CR, the other lines are read without it', () => {
    assert.deepEqual(regions(parseUnifiedDiff(modify('f.txt', 3, 'X\r')), 'f.txt'), [{ start: 3, end: 4, lines: ['X\r'] }]);
    // A CRLF-delimited patch
    const files = parseUnifiedDiff('diff --git a/f.txt b/f.txt\r\nindex 1111111..2222222 100644\r\n--- a/f.txt\r\n+++ b/f.txt\r\n@@ -1,2 +1,2 @@\r\n a\r\n-b\r\n+c\r\n');
    assert.deepEqual([...files.keys()], ['f.txt']);
    assert.equal(files.get('f.txt').newHash, '2222222');
    assert.deepEqual(regions(files, 'f.txt'), [{ start: 2, end: 3, lines: ['c\r'] }]);
});

test('parseUnifiedDiff: a truncated or malformed patch throws, naming the file', () => {
    // A hunk shorter than announced, cut by the end of the text; one line short too (the final newline is no empty context line)
    const cut = { message: 'patch of f.txt: cut inside a hunk' };
    assert.throws(() => parseUnifiedDiff(patch('f.txt', '-1,6 +1,6', [' l1', ' l2'])), cut);
    assert.throws(() => parseUnifiedDiff(patch('f.txt', '-1,3 +1,3', [' l1', ' l2'])), cut);
    // A line inside a hunk that is none of context, -, + or \
    assert.throws(() => parseUnifiedDiff(patch('f.txt', '-1,3 +1,3', [' l1', 'l2', ' l3'])), { message: 'patch of f.txt: unexpected line in a hunk' });
    // A hunk longer than announced, inside the hunk and after it
    const longer = { message: 'patch of f.txt: hunk longer than announced' };
    assert.throws(() => parseUnifiedDiff(patch('f.txt', '-1,2 +1,3', [' l1', '-l2', '-l3', '+X'])), longer);
    assert.throws(() => parseUnifiedDiff(patch('f.txt', '-1,2 +1,2', [' l1', '-l2', '+X', ' l3'])), longer);
    // A file header without a hunk, at the end of the text and before the next file
    const header = 'diff --git a/f.txt b/f.txt\nindex 1111111..2222222 100644\n--- a/f.txt\n+++ b/f.txt\n';
    const noHunk = { message: 'patch of f.txt: file header without a hunk' };
    assert.throws(() => parseUnifiedDiff(header), noHunk);
    assert.throws(() => parseUnifiedDiff(header + modify('g.txt', 3, 'X')), noHunk);
    // A type change: git lists the path twice, a deletion then an addition
    const typeChange = 'diff --git a/f b/f\ndeleted file mode 100644\nindex 422c2b7..0000000\n--- a/f\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-a\n-b\n' +
        'diff --git a/f b/f\nnew file mode 120000\nindex 0000000..1de5659\n--- /dev/null\n+++ b/f\n@@ -0,0 +1 @@\n+target\n\\ No newline at end of file\n';
    assert.throws(() => parseUnifiedDiff(typeChange), { message: 'patch of f: file listed twice' });
});

test('parseUnifiedDiff: text without a "diff --git" line yields no file', () => {
    assert.equal(parseUnifiedDiff('--- a/f.txt\n+++ b/f.txt\n@@ -1 +1 @@\n-a\n+b\n').size, 0);
    assert.equal(parseUnifiedDiff('<html><body>Something went wrong</body></html>\n').size, 0);
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

    const binary = hash => parseUnifiedDiff(`diff --git a/img.png b/img.png\nindex 1111111..${hash} 100644\nBinary files a/img.png and b/img.png differ\n`);
    assert.deepEqual(conflictingFiles(binary('2222222'), binary('3333333')), ['img.png']); // changed into different content
});

test('conflictingFiles: several regions per side are compared in one pass', () => {
    const a = parseUnifiedDiff(modifyLines('f.txt', [[1, 'A1'], [5, 'X5'], [9, 'A9']]));
    assert.deepEqual(regions(a, 'f.txt'), [
        { start: 1, end: 2, lines: ['A1'] },
        { start: 5, end: 6, lines: ['X5'] },
        { start: 9, end: 10, lines: ['A9'] }
    ]);
    const interleaved = parseUnifiedDiff(modifyLines('f.txt', [[3, 'B3'], [7, 'B7'], [11, 'B11']]));
    assert.deepEqual(conflictingFiles(a, interleaved), []);
    assert.deepEqual(conflictingFiles(interleaved, a), []);
    // The same change among different ones
    assert.deepEqual(conflictingFiles(a, parseUnifiedDiff(modifyLines('f.txt', [[3, 'B3'], [5, 'X5'], [7, 'B7']]))), []);
    // One overlapping pair among several, one touching pair among several
    assert.deepEqual(conflictingFiles(a, parseUnifiedDiff(modifyLines('f.txt', [[3, 'B3'], [7, 'B7'], [9, 'B9'], [13, 'B13']]))), ['f.txt']);
    assert.deepEqual(conflictingFiles(parseUnifiedDiff(modifyLines('f.txt', [[3, 'B3'], [7, 'B7'], [10, 'B10'], [13, 'B13']])), a), ['f.txt']);
});

test('conflictingFiles: line endings are part of the lines', () => {
    // A CR at the end of the line on one side only
    assert.deepEqual(conflictingFiles(parseUnifiedDiff(modify('f.txt', 3, 'X\r')), parseUnifiedDiff(modify('f.txt', 3, 'X'))), ['f.txt']);
    // The same last line, with and without its final newline
    const withoutNewline = parseUnifiedDiff(patch('f.txt', '-1,6 +1,6', [' l1', ' l2', ' l3', ' l4', ' l5', '-l6', '+X6', '\\ No newline at end of file']));
    assert.deepEqual(regions(withoutNewline, 'f.txt'), [{ start: 6, end: 7, lines: ['X6\n'] }]);
    assert.deepEqual(conflictingFiles(parseUnifiedDiff(modify('f.txt', 6, 'X6')), withoutNewline), ['f.txt']);
    // After a "-" line the marker is about the base: the line of the side keeps its newline
    assert.deepEqual(regions(parseUnifiedDiff(patch('f.txt', '-6 +6', ['-l6', '\\ No newline at end of file', '+X6'])), 'f.txt'), [{ start: 6, end: 7, lines: ['X6'] }]);
    // Added on both sides, one without the final newline
    const added = (hash, end) => parseUnifiedDiff(`diff --git a/n.txt b/n.txt\nnew file mode 100644\nindex 0000000..${hash}\n--- /dev/null\n+++ b/n.txt\n@@ -0,0 +1,2 @@\n+a\n+b\n${end}`);
    assert.deepEqual(conflictingFiles(added('422c2b7', ''), added('0a207c0', '\\ No newline at end of file\n')), ['n.txt']);
});

test('conflictingFiles: the same resulting content on both sides merges cleanly, text or binary', () => {
    // "a b a" becomes "a" through two different hunks: the regions overlap, the post-image blobs are the same
    const removeFirst = 'diff --git a/f.txt b/f.txt\nindex 1111111..7898192 100644\n--- a/f.txt\n+++ b/f.txt\n@@ -1,3 +1 @@\n-a\n-b\n a\n';
    const removeLast = 'diff --git a/f.txt b/f.txt\nindex 1111111..7898192 100644\n--- a/f.txt\n+++ b/f.txt\n@@ -1,3 +1 @@\n a\n-b\n-a\n';
    assert.deepEqual(conflictingFiles(parseUnifiedDiff(removeFirst), parseUnifiedDiff(removeLast)), []);
    const withoutIndex = text => parseUnifiedDiff(text.replace(/^index .*\n/m, ''));
    assert.deepEqual(conflictingFiles(withoutIndex(removeFirst), withoutIndex(removeLast)), ['f.txt']);
    // A binary file changed, or added, the same way on both sides
    const binaryChanged = parseUnifiedDiff('diff --git a/img.bin b/img.bin\nindex 1a41d47..49ca21b 100644\nBinary files a/img.bin and b/img.bin differ\n');
    assert.deepEqual(conflictingFiles(binaryChanged, binaryChanged), []);
    const binaryAdded = parseUnifiedDiff('diff --git a/img.bin b/img.bin\nnew file mode 100644\nindex 0000000..667820d\nBinary files /dev/null and b/img.bin differ\n');
    assert.deepEqual(conflictingFiles(binaryAdded, binaryAdded), []);
});

test('conflictingFiles: a binary file changed on both sides without an "index" line conflicts', () => {
    const binary = parseUnifiedDiff('diff --git a/img.png b/img.png\nBinary files a/img.png and b/img.png differ\n');
    assert.equal(binary.get('img.png').newHash, null);
    assert.deepEqual(conflictingFiles(binary, binary), ['img.png']);
});

test('conflictingFiles: a file added empty on both sides, or on one side only, merges cleanly', () => {
    const empty = parseUnifiedDiff('diff --git a/new.txt b/new.txt\nnew file mode 100644\nindex 0000000..e69de29\n');
    const content = parseUnifiedDiff('diff --git a/new.txt b/new.txt\nnew file mode 100644\nindex 0000000..d95f3ad\n--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1 @@\n+content\n');
    assert.deepEqual(regions(empty, 'new.txt'), []);
    assert.deepEqual(conflictingFiles(empty, empty), []);
    assert.deepEqual(conflictingFiles(empty, content), []);
    assert.deepEqual(conflictingFiles(content, empty), []);
});

test('conflictingFiles: an empty file deleted ("deleted file mode" without "---"/"+++") and changed on the other side conflicts', () => {
    const deleted = parseUnifiedDiff('diff --git a/e.txt b/e.txt\ndeleted file mode 100644\nindex e69de29..0000000\n');
    assert.equal(deleted.get('e.txt').deleted, true);
    const filled = parseUnifiedDiff('diff --git a/e.txt b/e.txt\nindex e69de29..b6ed15e 100644\n--- a/e.txt\n+++ b/e.txt\n@@ -0,0 +1 @@\n+now\n');
    assert.deepEqual(conflictingFiles(deleted, filled), ['e.txt']);
    assert.deepEqual(conflictingFiles(deleted, deleted), []);
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

test('decideFromDiffstat: a file renamed to different paths on both sides conflicts, to the same path it is checked', () => {
    const renamedTo = sidePath => new Map([['old.txt', { status: 'renamed', sidePath }]]);
    assert.deepEqual(decideFromDiffstat(renamedTo('a-name.txt'), renamedTo('b-name.txt')), { conflicting: ['old.txt'], toCheck: [] });
    assert.deepEqual(decideFromDiffstat(renamedTo('new.txt'), renamedTo('new.txt')), { conflicting: [], toCheck: ['old.txt'] });
});
