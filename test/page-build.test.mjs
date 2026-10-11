import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, renameSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pageBuildOf } from '../page-build.mjs';

function pageDirectory(t) {
    const directory = mkdtempSync(path.join(tmpdir(), 'pr-tree-page-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    writeFileSync(path.join(directory, 'index.html'), '<p>page</p>');
    mkdirSync(path.join(directory, 'vendor'));
    writeFileSync(path.join(directory, 'vendor', 'lib.js'), 'export {};');
    return directory;
}

test('the build is 16 hexadecimal digits, the same for the same files', t => {
    const directory = pageDirectory(t);
    const build = pageBuildOf(directory);
    assert.match(build, /^[0-9a-f]{16}$/);
    assert.equal(pageBuildOf(directory), build);
});

test('the build changes with a file\'s contents, its name, and a new file in a subdirectory', t => {
    const directory = pageDirectory(t);
    const builds = [pageBuildOf(directory)];

    writeFileSync(path.join(directory, 'index.html'), '<p>page 2</p>');
    builds.push(pageBuildOf(directory));

    renameSync(path.join(directory, 'vendor', 'lib.js'), path.join(directory, 'vendor', 'lib2.js'));
    builds.push(pageBuildOf(directory));

    mkdirSync(path.join(directory, 'vendor', 'fonts'));
    writeFileSync(path.join(directory, 'vendor', 'fonts', 'a.woff2'), Buffer.from([0, 1, 2]));
    builds.push(pageBuildOf(directory));

    assert.equal(new Set(builds).size, builds.length, builds.join(', '));
});

test('dot files are not part of the page: express.static does not serve them', t => {
    const directory = pageDirectory(t);
    const build = pageBuildOf(directory);
    writeFileSync(path.join(directory, '.DS_Store'), 'finder');
    mkdirSync(path.join(directory, '.cache'));
    writeFileSync(path.join(directory, '.cache', 'x'), 'x');
    assert.equal(pageBuildOf(directory), build);
});

test('symbolic links are followed, as express.static serves their targets', t => {
    const directory = pageDirectory(t);
    const outside = mkdtempSync(path.join(tmpdir(), 'pr-tree-linked-'));
    t.after(() => rmSync(outside, { recursive: true, force: true }));
    writeFileSync(path.join(outside, 'linked.js'), 'export const a = 1;');
    mkdirSync(path.join(outside, 'library'));
    writeFileSync(path.join(outside, 'library', 'index.js'), 'export {};');

    const builds = [pageBuildOf(directory)];
    symlinkSync(path.join(outside, 'linked.js'), path.join(directory, 'linked.js'));
    builds.push(pageBuildOf(directory));
    symlinkSync(path.join(outside, 'library'), path.join(directory, 'library'));
    builds.push(pageBuildOf(directory));
    // A change of a target changes the build
    writeFileSync(path.join(outside, 'library', 'index.js'), 'export const b = 2;');
    builds.push(pageBuildOf(directory));
    assert.equal(new Set(builds).size, builds.length, builds.join(', '));
});

test('a broken link and a link back to a folder being listed are skipped', t => {
    const directory = pageDirectory(t);
    const build = pageBuildOf(directory);
    symlinkSync(path.join(directory, 'missing.js'), path.join(directory, 'broken.js'));
    symlinkSync(directory, path.join(directory, 'vendor', 'loop'));
    assert.equal(pageBuildOf(directory), build);
});
