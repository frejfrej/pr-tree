/**
 * The page build: a hash of every file the page is made of (the public/
 * folder), computed once at start-up. Every /api answer carries it (index.mjs),
 * so a tab still running the modules of an earlier page sees that a reload
 * would load another one, instead of reading answers its code may no longer
 * understand (public/page-updated.js, #125). Not the package version: a page
 * can change without a version bump.
 *
 * It does not watch the folder: a file changed while the server runs changes
 * the build at the next start.
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

/** The header of the /api answers that carries the page build */
export const pageBuildHeader = 'X-Page-Build';

// The files under a directory, as relative paths with "/" separators, in
// path order; dot files and dot directories are skipped, as express.static does
function listFiles(directory, prefix = '') {
    const entries = readdirSync(directory, { withFileTypes: true })
        .filter(entry => !entry.name.startsWith('.'))
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return entries.flatMap(entry => {
        const relative = `${prefix}${entry.name}`;
        if (entry.isDirectory()) return listFiles(path.join(directory, entry.name), `${relative}/`);
        return entry.isFile() ? [relative] : [];
    });
}

/**
 * The build of the page served from a directory: 16 hexadecimal digits of a
 * SHA-256 of each file's relative path and contents.
 * @param {string} directory
 * @returns {string}
 */
export function pageBuildOf(directory) {
    const hash = createHash('sha256');
    for (const file of listFiles(directory)) {
        const contents = readFileSync(path.join(directory, file));
        hash.update(`${file}\0${contents.length}\0`);
        hash.update(contents);
    }
    return hash.digest('hex').slice(0, 16);
}
