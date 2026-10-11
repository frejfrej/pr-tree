import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
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

test('lines are appended to the file, after what a previous run wrote; end() writes them all', async t => {
    const file = path.join(directory(t), 'access.log');
    writeFileSync(file, 'before\n');
    const log = createLogFile(file);
    for (let i = 0; i < 1000; i++) log.write(`line ${i}\n`);
    await log.end();
    const lines = read(file).trimEnd().split('\n');
    assert.equal(lines.length, 1001);
    assert.equal(lines[0], 'before');
    assert.equal(lines.at(-1), 'line 999');
});

test('a line that would take the file past maxBytes rotates it: .1 then .2, the oldest beyond keep dropped', async t => {
    const file = path.join(directory(t), 'access.log');
    // 10 bytes a line, 25 bytes a file: two lines per file
    const log = createLogFile(file, { maxBytes: 25, keep: 2 });
    for (let i = 0; i < 9; i++) log.write(`line ${i}...\n`.slice(0, 9) + '\n');
    await log.end();
    // Files of two lines from the newest: 8 | 6 7 | 4 5; 0 to 3 are gone
    assert.equal(read(file), 'line 8...\n');
    assert.equal(read(`${file}.1`), 'line 6...\nline 7...\n');
    assert.equal(read(`${file}.2`), 'line 4...\nline 5...\n');
    assert.equal(read(`${file}.3`), null);
});

test('the size of the file a previous run left counts: a restart rotates at the same size', async t => {
    const file = path.join(directory(t), 'access.log');
    writeFileSync(file, 'x'.repeat(20));
    const log = createLogFile(file, { maxBytes: 25 });
    log.write('ten bytes\n');
    await log.end();
    assert.equal(read(`${file}.1`), 'x'.repeat(20));
    assert.equal(read(file), 'ten bytes\n');
});

test('a line larger than maxBytes still goes to a file of its own', async t => {
    const file = path.join(directory(t), 'access.log');
    const log = createLogFile(file, { maxBytes: 5 });
    log.write('a long line\n');
    log.write('another long line\n');
    await log.end();
    assert.equal(read(`${file}.1`), 'a long line\n');
    assert.equal(read(file), 'another long line\n');
});

test('a file that cannot be written is reported once, its lines dropped without crashing; it is tried again a minute later', async t => {
    const dir = directory(t);
    const file = path.join(dir, 'error.log');
    mkdirSync(file); // a directory where the file should be: EISDIR when opened
    const errors = [];
    let time = 0;
    const log = createLogFile(file, { onError: message => errors.push(message), now: () => time });
    log.write('lost\n');
    log.write('lost too\n');
    log.write('and this\n');
    assert.equal(errors.length, 1);
    assert.match(errors[0], /error\.log: .*the console only, the file is tried again in a minute/);

    // The obstacle goes, a minute passes: the next line opens the file again
    rmSync(file, { recursive: true });
    time = 60000;
    log.write('back\n');
    await log.end();
    assert.equal(read(file), 'back\n');
    assert.equal(errors.length, 1);
});

test('nothing is written after end(), and end() twice is harmless', async t => {
    const file = path.join(directory(t), 'access.log');
    const log = createLogFile(file);
    log.write('kept\n');
    await log.end();
    log.write('after the end\n');
    await log.end();
    assert.equal(read(file), 'kept\n');
});

test('a failed rotation is reported and the file goes on growing', async t => {
    const file = path.join(directory(t), 'access.log');
    const errors = [];
    const fs = await import('node:fs');
    const failingFs = { ...fs.default, renameSync: () => { throw new Error('EBUSY: file in use'); } };
    const log = createLogFile(file, { maxBytes: 15, onError: message => errors.push(message), fs: failingFs });
    log.write('ten bytes\n');
    log.write('ten bytes\n');
    await log.end();
    assert.equal(read(file), 'ten bytes\nten bytes\n');
    assert.match(errors[0], /rotation failed \(EBUSY: file in use\), the file goes on growing/);
});
