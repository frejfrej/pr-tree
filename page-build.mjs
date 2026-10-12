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
import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';

export { pageBuildHeader } from './public/page-build-header.mjs';

// The files under a directory, as relative paths with "/" separators, in
// path order; dot files and dot directories are skipped, as express.static
// does. Symbolic links are followed, as express.static serves their targets;
// a broken one is skipped (it serves nothing), and a link back to a folder
// being listed is not entered again.
function listFiles(directory, prefix = '', visited = new Set()) {
    visited = new Set([...visited, realpathSync(directory)]);
    const names = readdirSync(directory).filter(name => !name.startsWith('.')).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    return names.flatMap(name => {
        const entryPath = path.join(directory, name);
        let stats;
        try {
            stats = statSync(entryPath);
        } catch (error) {
            return [];
        }
        const relative = `${prefix}${name}`;
        if (stats.isDirectory()) return visited.has(realpathSync(entryPath)) ? [] : listFiles(entryPath, `${relative}/`, visited);
        return stats.isFile() ? [relative] : [];
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
