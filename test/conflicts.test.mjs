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

test('parseUnifiedDiff: the "+" and "-" lines of each file are counted, for the check against the diffstat', () => {
    const counts = file => ({ linesAdded: file.linesAdded, linesRemoved: file.linesRemoved });
    // Several hunks, then another file; context lines and "no newline" markers do not count
    const several = parseUnifiedDiff('diff --git a/f.txt b/f.txt\nindex 1111111..2222222 100644\n--- a/f.txt\n+++ b/f.txt\n' +
        '@@ -1,2 +1,5 @@\n l1\n+A\n+B\n+C\n l2\n@@ -10,3 +13,2 @@\n l10\n-l11\n-l12\n+L12\n\\ No newline at end of file\n' + modify('g.txt', 3, 'X'));
    assert.deepEqual(counts(several.get('f.txt')), { linesAdded: 4, linesRemoved: 2 });
    assert.deepEqual(counts(several.get('g.txt')), { linesAdded: 1, linesRemoved: 1 });
    const added = parseUnifiedDiff('diff --git a/n.txt b/n.txt\nnew file mode 100644\nindex 0000000..2222222\n--- /dev/null\n+++ b/n.txt\n@@ -0,0 +1,2 @@\n+a\n+b\n');
    assert.deepEqual(counts(added.get('n.txt')), { linesAdded: 2, linesRemoved: 0 });
    const deleted = parseUnifiedDiff('diff --git a/d.txt b/d.txt\ndeleted file mode 100644\nindex 1111111..0000000\n--- a/d.txt\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-a\n-b\n');
    assert.deepEqual(counts(deleted.get('d.txt')), { linesAdded: 0, linesRemoved: 2 });
    const binary = parseUnifiedDiff('diff --git a/img.png b/img.png\nindex 1111111..2222222 100644\nBinary files a/img.png and b/img.png differ\n');
    assert.deepEqual(counts(binary.get('img.png')), { linesAdded: 0, linesRemoved: 0 });
});

test('parseUnifiedDiff: the paths come from the "diff --git" line (git appends a tab to "---"/"+++" paths with spaces)', () => {
    const files = parseUnifiedDiff('diff --git a/my file.txt b/my file.txt\nindex 4286f42..331bae0 100644\n--- a/my file.txt\t\n+++ b/my file.txt\t\n@@ -1 +1 @@\n-r\n+R\n');
    assert.deepEqual([...files.keys()], ['my file.txt']);
    assert.equal(files.get('my file.txt').oldPath, 'my file.txt');
    assert.equal(files.get('my file.txt').newPath, 'my file.txt');
});

test('parseUnifiedDiff: a path holding " b/" keeps its key, renamed or not', () => {
    const modified = parseUnifiedDiff('diff --git a/x b/y.txt b/x b/y.txt\nindex 1111111..2222222 100644\n--- a/x b/y.txt\t\n+++ b/x b/y.txt\t\n@@ -1 +1 @@\n-a\n+b\n');
    assert.deepEqual([...modified.keys()], ['x b/y.txt']);
    assert.equal(modified.get('x b/y.txt').newPath, 'x b/y.txt');
    // A renamed file: the paths of the "rename from" and "rename to" lines, read before the hunks
    const renamed = parseUnifiedDiff('diff --git a/x b/old.txt b/x b/new.txt\nsimilarity index 80%\nrename from x b/old.txt\nrename to x b/new.txt\nindex 1111111..2222222 100644\n--- a/x b/old.txt\t\n+++ b/x b/new.txt\t\n@@ -1 +1 @@\n-a\n+b\n');
    assert.deepEqual([...renamed.keys()], ['x b/old.txt']);
    assert.equal(renamed.get('x b/old.txt').newPath, 'x b/new.txt');
    assert.deepEqual(regions(renamed, 'x b/old.txt'), [{ start: 1, end: 2, lines: ['b'] }]);
});

test('parseUnifiedDiff: paths git quotes are decoded, renamed or not', () => {
    const accented = parseUnifiedDiff('diff --git "a/caf\\303\\251.txt" "b/caf\\303\\251.txt"\nindex 4ae8ef0..765140b 100644\n--- "a/caf\\303\\251.txt"\n+++ "b/caf\\303\\251.txt"\n@@ -1 +1 @@\n-u\n+U\n');
    assert.deepEqual([...accented.keys()], ['café.txt']);
    assert.equal(accented.get('café.txt').newPath, 'café.txt');
    assert.deepEqual(regions(accented, 'café.txt'), [{ start: 1, end: 2, lines: ['U'] }]);
    // A space and double quotes: quoted, with the tab git appends to "---"/"+++" paths with spaces
    const quote = parseUnifiedDiff('diff --git "a/my \\"quoted\\" file.txt" "b/my \\"quoted\\" file.txt"\nindex 7898192..6178079 100644\n--- "a/my \\"quoted\\" file.txt"\t\n+++ "b/my \\"quoted\\" file.txt"\t\n@@ -1 +1 @@\n-a\n+b\n');
    assert.deepEqual([...quote.keys()], ['my "quoted" file.txt']);
    // A backslash, a tab and a newline
    const escaped = parseUnifiedDiff('diff --git "a/x\\\\y\\tz\\nw.txt" "b/x\\\\y\\tz\\nw.txt"\nnew file mode 100644\nindex 0000000..7898192\n--- /dev/null\n+++ "b/x\\\\y\\tz\\nw.txt"\n@@ -0,0 +1 @@\n+a\n');
    assert.deepEqual([...escaped.keys()], ['x\\y\tz\nw.txt']);
    // Renamed between a quoted and a plain path, both ways
    const paths = files => [...files.entries()].map(([key, file]) => [key, file.newPath]);
    assert.deepEqual(paths(parseUnifiedDiff('diff --git "a/caf\\303\\2512.txt" b/plain.txt\nsimilarity index 100%\nrename from "caf\\303\\2512.txt"\nrename to plain.txt\n')), [['café2.txt', 'plain.txt']]);
    assert.deepEqual(paths(parseUnifiedDiff('diff --git a/plain2.txt "b/na\\303\\257ve.txt"\nsimilarity index 100%\nrename from plain2.txt\nrename to "na\\303\\257ve.txt"\n')), [['plain2.txt', 'naïve.txt']]);
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
    // A lone CR in a hunk: a context line of a CRLF file whose leading space was stripped
    assert.deepEqual(regions(parseUnifiedDiff(patch('f.txt', '-1,3 +1,3', [' a\r', '\r', '-b\r', '+B\r'])), 'f.txt'), [{ start: 3, end: 4, lines: ['B\r'] }]);
});

test('parseUnifiedDiff: an empty line may follow a hunk, before the next hunk or file', () => {
    const files = parseUnifiedDiff(modify('f.txt', 3, 'X') + '\n' + modify('g.txt', 4, 'Y') + '\n');
    assert.deepEqual([...files.keys()], ['f.txt', 'g.txt']);
    assert.deepEqual(regions(files, 'g.txt'), [{ start: 4, end: 5, lines: ['Y'] }]);
    const hunks = parseUnifiedDiff('diff --git a/h.txt b/h.txt\nindex 1111111..2222222 100644\n--- a/h.txt\n+++ b/h.txt\n@@ -1 +1 @@\n-a\n+b\n\n@@ -3 +3 @@\n-c\n+d\n');
    assert.deepEqual(regions(hunks, 'h.txt'), [{ start: 1, end: 2, lines: ['b'] }, { start: 3, end: 4, lines: ['d'] }]);
});

test('parseUnifiedDiff: hunks that overlap, touch or come out of order throw (git leaves an unchanged line between two hunks)', () => {
    const hunks = (...texts) => `diff --git a/f.txt b/f.txt\nindex 1111111..2222222 100644\n--- a/f.txt\n+++ b/f.txt\n${texts.join('')}`;
    const order = { message: 'patch of f.txt: overlapping or unordered hunks' };
    assert.throws(() => parseUnifiedDiff(hunks('@@ -10 +10 @@\n-l10\n+X\n', '@@ -3 +3 @@\n-l3\n+Y\n')), order);
    assert.throws(() => parseUnifiedDiff(hunks('@@ -3,2 +3,2 @@\n-l3\n+Y\n l4\n', '@@ -4 +4 @@\n-l4\n+Z\n')), order);
    assert.throws(() => parseUnifiedDiff(hunks('@@ -3 +3 @@\n-l3\n+Y\n', '@@ -4 +4 @@\n-l4\n+Z\n')), order);
    assert.throws(() => parseUnifiedDiff(hunks('@@ -3,0 +4 @@\n+X\n', '@@ -4 +5 @@\n-l4\n+Y\n')), order);
    // One unchanged line between two hunks
    assert.deepEqual(regions(parseUnifiedDiff(hunks('@@ -3 +3 @@\n-l3\n+Y\n', '@@ -5 +5 @@\n-l5\n+Z\n')), 'f.txt'), [
        { start: 3, end: 4, lines: ['Y'] },
        { start: 5, end: 6, lines: ['Z'] }
    ]);
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
    // A context line once the base count is spent, a "+" line once the side count is spent
    assert.throws(() => parseUnifiedDiff(patch('f.txt', '-1 +1,2', ['-a', '+b', ' c'])), longer);
    assert.throws(() => parseUnifiedDiff(patch('f.txt', '-1,2 +1', ['-a', '+b', '+c', '-d'])), longer);
    // A hunk header that does not parse
    assert.throws(() => parseUnifiedDiff(patch('f.txt', '-1,x +1', ['-a', '+b'])), { message: 'patch of f.txt: unreadable hunk header' });
    // A file header without a hunk, at the end of the text and before the next file
    const header = 'diff --git a/f.txt b/f.txt\nindex 1111111..2222222 100644\n--- a/f.txt\n+++ b/f.txt\n';
    const noHunk = { message: 'patch of f.txt: file header without a hunk' };
    assert.throws(() => parseUnifiedDiff(header), noHunk);
    assert.throws(() => parseUnifiedDiff(header + modify('g.txt', 3, 'X')), noHunk);
    // A type change: git lists the path twice, a deletion then an addition
    const typeChange = 'diff --git a/f b/f\ndeleted file mode 100644\nindex 422c2b7..0000000\n--- a/f\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-a\n-b\n' +
        'diff --git a/f b/f\nnew file mode 120000\nindex 0000000..1de5659\n--- /dev/null\n+++ b/f\n@@ -0,0 +1 @@\n+target\n\\ No newline at end of file\n';
    assert.throws(() => parseUnifiedDiff(typeChange), { message: 'patch of f: listed twice (a change of file type?)' });
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
    // Line 3 replaced by X on one side, lines 3 and 4 by X on the other: the same start and lines, another change
    assert.deepEqual(conflictingFiles(parseUnifiedDiff(patch('f.txt', '-3 +3', ['-l3', '+X'])), parseUnifiedDiff(patch('f.txt', '-3,2 +3', ['-l3', '-l4', '+X']))), ['f.txt']);
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
    // Without the "index" lines the regions decide, not the post-image hashes
    const withoutIndex = text => parseUnifiedDiff(text.replace(/^index .*\n/m, ''));
    assert.deepEqual(conflictingFiles(withoutIndex(modify('f.txt', 3, 'X3')), withoutIndex(modify('f.txt', 3, 'X3'))), []);
    assert.deepEqual(conflictingFiles(withoutIndex(insertAfter('f.txt', 3, 'X')), withoutIndex(insertAfter('f.txt', 3, 'X'))), []);
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

test('conflictingFiles: a binary file conflicts only when both sides change its content', () => {
    // A text file made binary on one side, edited on the other
    const madeBinary = parseUnifiedDiff('diff --git a/f.txt b/f.txt\nindex 1111111..2222222 100644\nBinary files a/f.txt and b/f.txt differ\n');
    assert.deepEqual(conflictingFiles(madeBinary, parseUnifiedDiff(modify('f.txt', 5, 'B5'))), ['f.txt']);
    // A binary file only renamed, or only given another mode, on one side and modified on the other
    const modified = parseUnifiedDiff('diff --git a/img.bin b/img.bin\nindex 1a41d47..49ca21b 100644\nBinary files a/img.bin and b/img.bin differ\n');
    const renamedOnly = parseUnifiedDiff('diff --git a/img.bin b/assets/img.bin\nsimilarity index 100%\nrename from img.bin\nrename to assets/img.bin\n');
    const modeOnly = parseUnifiedDiff('diff --git a/img.bin b/img.bin\nold mode 100644\nnew mode 100755\n');
    assert.deepEqual(conflictingFiles(renamedOnly, modified), []);
    assert.deepEqual(conflictingFiles(modified, modeOnly), []);
    // An empty file added on one side, a binary file on the other: both add content, whatever the order
    const addedEmpty = parseUnifiedDiff('diff --git a/e b/e\nnew file mode 100644\nindex 0000000..e69de29\n');
    const addedBinary = parseUnifiedDiff('diff --git a/e b/e\nnew file mode 100644\nindex 0000000..667820d\nBinary files /dev/null and b/e differ\n');
    assert.deepEqual(conflictingFiles(addedEmpty, addedBinary), ['e']);
    assert.deepEqual(conflictingFiles(addedBinary, addedEmpty), ['e']);
});

test('conflictingFiles: a file added on both sides with different modes conflicts', () => {
    const added = (mode, hash, rest) => parseUnifiedDiff(`diff --git a/f b/f\nnew file mode ${mode}\nindex 0000000..${hash}\n${rest}`);
    const echo = '--- /dev/null\n+++ b/f\n@@ -0,0 +1 @@\n+echo\n';
    assert.equal(added('100755', 'fa11a6a', echo).get('f').newMode, '100755');
    // The same content, executable on one side only
    assert.deepEqual(conflictingFiles(added('100644', 'fa11a6a', echo), added('100755', 'fa11a6a', echo)), ['f']);
    // An empty file, executable on one side only; an empty file against a symlink
    assert.deepEqual(conflictingFiles(added('100644', 'e69de29', ''), added('100755', 'e69de29', '')), ['f']);
    assert.deepEqual(conflictingFiles(added('100644', 'e69de29', ''), added('120000', '1de5659', '--- /dev/null\n+++ b/f\n@@ -0,0 +1 @@\n+target\n\\ No newline at end of file\n')), ['f']);
    // The same addition with the same mode merges cleanly
    assert.deepEqual(conflictingFiles(added('100755', 'fa11a6a', echo), added('100755', 'fa11a6a', echo)), []);
});

test('conflictingFiles: a file added empty on both sides, or on one side only, merges cleanly', () => {
    const empty = parseUnifiedDiff('diff --git a/new.txt b/new.txt\nnew file mode 100644\nindex 0000000..e69de29\n');
    const content = parseUnifiedDiff('diff --git a/new.txt b/new.txt\nnew file mode 100644\nindex 0000000..d95f3ad\n--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1 @@\n+content\n');
    assert.equal(empty.get('new.txt').added, true); // "new file mode" without "---"/"+++" lines
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

test('decideFromDiffstat: two different files that end at the same path on the two sides conflict, under that path', () => {
    const renamed = new Map([['f.txt', { status: 'renamed', sidePath: 'g.txt' }]]);
    const added = new Map([['g.txt', { status: 'added', sidePath: 'g.txt' }]]);
    const otherRenamed = new Map([['h.txt', { status: 'renamed', sidePath: 'g.txt' }]]);
    // rename/add, either way round
    assert.deepEqual(decideFromDiffstat(renamed, added), { conflicting: ['g.txt'], toCheck: [] });
    assert.deepEqual(decideFromDiffstat(added, renamed), { conflicting: ['g.txt'], toCheck: [] });
    // rename/rename onto one path
    assert.deepEqual(decideFromDiffstat(renamed, otherRenamed), { conflicting: ['g.txt'], toCheck: [] });
    // The same rename on both sides, the same path added on both sides: the patches decide, as before
    assert.deepEqual(decideFromDiffstat(renamed, renamed), { conflicting: [], toCheck: ['f.txt'] });
    assert.deepEqual(decideFromDiffstat(added, added), { conflicting: [], toCheck: ['g.txt'] });
    // A path already decided under its base path is reported once
    const removedAndReplaced = new Map([['x.txt', { status: 'removed', sidePath: 'x.txt' }], ['f.txt', { status: 'renamed', sidePath: 'x.txt' }]]);
    const modified = new Map([['x.txt', { status: 'modified', sidePath: 'x.txt' }]]);
    assert.deepEqual(decideFromDiffstat(removedAndReplaced, modified), { conflicting: ['x.txt'], toCheck: [] });
    // A removed file is found nowhere: it does not meet a file renamed to its path on the other side
    assert.deepEqual(decideFromDiffstat(new Map([['g.txt', { status: 'removed', sidePath: 'g.txt' }]]), renamed), { conflicting: [], toCheck: [] });
});

test('decideFromDiffstat: a path where one side puts a file and the other puts files below it conflicts, under that path (file/directory)', () => {
    const diffstat = entries => new Map(entries.map(([basePath, status, sidePath = basePath]) => [basePath, { status, sidePath }]));
    const conflictAt = path => ({ conflicting: [path], toCheck: [] });
    assert.deepEqual(decideFromDiffstat(diffstat([['docs/x', 'added']]), diffstat([['docs', 'added']])), conflictAt('docs'));
    assert.deepEqual(decideFromDiffstat(diffstat([['f', 'renamed', 'docs']]), diffstat([['docs/x', 'added']])), conflictAt('docs'));
    assert.deepEqual(decideFromDiffstat(diffstat([['lib', 'added']]), diffstat([['lib/x', 'added']])), conflictAt('lib')); // lib a symlink
    assert.deepEqual(decideFromDiffstat(diffstat([['deep/b/c/x', 'added']]), diffstat([['deep/b', 'added']])), conflictAt('deep/b'));
    assert.deepEqual(decideFromDiffstat(diffstat([['docs/x', 'added'], ['docs/y', 'added']]), diffstat([['docs', 'added']])), conflictAt('docs'));
    // A directory added under an unrelated name, under a name that only starts the same, the same directory on both sides
    const clean = { conflicting: [], toCheck: [] };
    assert.deepEqual(decideFromDiffstat(diffstat([['docs/x', 'added']]), diffstat([['guide', 'added']])), clean);
    assert.deepEqual(decideFromDiffstat(diffstat([['docs/x', 'added']]), diffstat([['doc', 'added']])), clean);
    assert.deepEqual(decideFromDiffstat(diffstat([['docs/x', 'added']]), diffstat([['docs/y', 'added']])), clean);
    // f renamed away before f/x was added, f modified on the other side: git merges cleanly
    assert.deepEqual(decideFromDiffstat(diffstat([['f', 'renamed', 'g'], ['f/x', 'added']]), diffstat([['f', 'modified']])), { conflicting: [], toCheck: ['f'] });
});
