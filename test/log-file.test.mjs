import { test } from 'node:test';
import assert from 'node:assert/strict';
import nodeFs, { mkdtempSync, readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createLogFile } from '../log-file.mjs';

// A fresh directory per test, removed after it
function directory(t) {
    const dir = mkdtempSync(path.join(tmpdir(), 'pr-tree-log-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    return dir;
}
const read = file => (existsSync(file) ? readFileSync(file, 'utf8') : null);

test('each line is on disk when write returns, after what a previous run wrote: nothing to lose when the process ends', t => {
    const file = path.join(directory(t), 'access.log');
    writeFileSync(file, 'before\n');
    const log = createLogFile(file);
    log.write('first\n');
    assert.equal(read(file), 'before\nfirst\n');
    for (let i = 0; i < 1000; i++) log.write(`line ${i}\n`);
    const lines = read(file).trimEnd().split('\n');
    assert.equal(lines.length, 1002);
    assert.equal(lines.at(-1), 'line 999');
});

test('a line that would take the file past maxBytes rotates it: .1 then .2, the oldest beyond keep dropped', t => {
    const file = path.join(directory(t), 'access.log');
    // 10 bytes a line, 25 bytes a file: two lines per file
    const log = createLogFile(file, { maxBytes: 25, keep: 2 });
    for (let i = 0; i < 9; i++) log.write(`line ${i}...\n`);
    // Files of two lines from the newest: 8 | 6 7 | 4 5; 0 to 3 are gone
    assert.equal(read(file), 'line 8...\n');
    assert.equal(read(`${file}.1`), 'line 6...\nline 7...\n');
    assert.equal(read(`${file}.2`), 'line 4...\nline 5...\n');
    assert.equal(read(`${file}.3`), null);
});

test('the size on disk counts: the file a previous run left, and the lines another process appends', t => {
    const file = path.join(directory(t), 'access.log');
    writeFileSync(file, 'x'.repeat(20));
    const log = createLogFile(file, { maxBytes: 25 });
    log.write('ten bytes\n');
    assert.equal(read(`${file}.1`), 'x'.repeat(20));
    assert.equal(read(file), 'ten bytes\n');
    // Another server appends to the same file: this one sees it
    nodeFs.appendFileSync(file, 'other!!!\n');
    log.write('ten bytes\n');
    assert.equal(read(`${file}.1`), 'ten bytes\nother!!!\n');
});

test('a line larger than maxBytes still goes to a file of its own', t => {
    const file = path.join(directory(t), 'access.log');
    const log = createLogFile(file, { maxBytes: 5 });
    log.write('a long line\n');
    log.write('another long line\n');
    assert.equal(read(`${file}.1`), 'a long line\n');
    assert.equal(read(file), 'another long line\n');
});

test('a file that cannot be written is reported once, its lines dropped without throwing; it is tried again a minute later', t => {
    const file = path.join(directory(t), 'error.log');
    mkdirSync(file); // a directory where the file should be: EISDIR
    const errors = [];
    let time = 0;
    const log = createLogFile(file, { onError: message => errors.push(message), now: () => time });
    log.write('lost\n');
    time = 59999;
    log.write('lost too\n');
    assert.equal(errors.length, 1);
    assert.match(errors[0], /error\.log: .*the console only, the file is tried again in a minute/);

    // Still failing a minute later: not reported again
    time = 60000;
    log.write('lost again\n');
    assert.equal(errors.length, 1);

    // The obstacle goes: the next try writes
    rmSync(file, { recursive: true });
    time = 120000;
    log.write('back\n');
    assert.equal(read(file), 'back\n');

    // A new failure after a line went through is reported again
    rmSync(file);
    mkdirSync(file);
    log.write('lost once more\n');
    assert.equal(errors.length, 2);
});

test('a failed rotation is reported once, not tried again, and the old files are not shifted away line after line', t => {
    const dir = directory(t);
    const file = path.join(dir, 'access.log');
    writeFileSync(`${file}.1`, 'the newest old file\n');
    const errors = [];
    // The shift of the old files works, the rename of the file itself fails (a file the system will not rename)
    const failingFs = { ...nodeFs, renameSync: (from, to) => { if (from === file) throw new Error('EBUSY: file in use'); nodeFs.renameSync(from, to); } };
    const log = createLogFile(file, { maxBytes: 15, keep: 3, onError: message => errors.push(message), fs: failingFs });
    for (let i = 0; i < 5; i++) log.write('ten bytes\n');
    assert.equal(read(file), 'ten bytes\n'.repeat(5));
    assert.equal(errors.length, 1);
    assert.match(errors[0], /rotation failed \(EBUSY: file in use\), the file goes on growing until the server restarts/);
    // One shift at most: .1 moved to .2 once, never on to .3 and beyond
    assert.equal(read(`${file}.2`), 'the newest old file\n');
    assert.equal(read(`${file}.3`), null);
});
