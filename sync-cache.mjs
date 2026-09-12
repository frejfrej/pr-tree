import { readFileSync } from 'fs';
import { rename, writeFile } from 'fs/promises';

/**
 * The conflicts of pull requests by "repo/destHash..sourceHash", kept on disk
 * across server restarts: a result only depends on the two commits, so it
 * never changes. Entries computed more than maxAgeDays ago are dropped when
 * the file is written (merged pull requests leave their hashes behind). Only
 * successful results are meant to be stored; a failure is retried by the
 * caller at the next load.
 */

export const syncCacheVersion = 1;
const dayMs = 24 * 60 * 60 * 1000;

/**
 * Opens (reads) the cache file. A missing file is an empty cache; an
 * unreadable one or another version is reported through onError and ignored.
 * @param {string} filePath - the JSON file
 * @param {object} [options]
 * @param {number} [options.maxAgeDays=90] - entries older than this are dropped at save
 * @param {() => number} [options.now] - clock, for the tests
 * @param {(error: Error) => void} [options.onError] - called when the file cannot be used
 */
export function openSyncCache(filePath, { maxAgeDays = 90, now = () => Date.now(), onError = () => {} } = {}) {
    const entries = new Map();
    let dirty = false;
    let saving = Promise.resolve(false);

    try {
        const stored = JSON.parse(readFileSync(filePath, 'utf8'));
        if (stored && stored.version === syncCacheVersion && stored.entries && typeof stored.entries === 'object') {
            for (const [key, entry] of Object.entries(stored.entries)) {
                if (entry && typeof entry === 'object' && !Array.isArray(entry)) entries.set(key, entry);
            }
        } else {
            onError(new Error(`unexpected content in ${filePath}`));
        }
    } catch (error) {
        if (error.code !== 'ENOENT') onError(error);
    }

    function prune() {
        const oldest = now() - maxAgeDays * dayMs;
        for (const [key, entry] of entries) {
            if (!(Date.parse(entry.computedAt) >= oldest)) entries.delete(key); // an unparsable date goes too
        }
    }

    // A temporary file then a rename: a crash never leaves a truncated cache
    async function write(content) {
        const temporary = `${filePath}.${process.pid}.tmp`;
        try {
            await writeFile(temporary, content);
            await rename(temporary, filePath);
            return true;
        } catch (error) {
            dirty = true; // the next save writes the entries again
            throw error;
        }
    }

    return {
        get size() {
            return entries.size;
        },
        /** The stored result without its timestamp, null when unknown */
        get(key) {
            const entry = entries.get(key);
            if (!entry) return null;
            const { computedAt, ...result } = entry;
            return result;
        },
        set(key, result) {
            entries.set(key, { ...result, computedAt: new Date(now()).toISOString() });
            dirty = true;
        },
        /**
         * Writes the entries as they are now when something changed, after the
         * writes already queued (one at a time: they share the temporary file);
         * resolves to whether it wrote. Rejects when the write fails; the
         * entries then stay pending for the next save.
         */
        async save() {
            if (!dirty) return saving.then(() => false, () => false);
            prune();
            const content = JSON.stringify({ version: syncCacheVersion, entries: Object.fromEntries(entries) });
            dirty = false;
            saving = saving.then(() => write(content), () => write(content));
            return saving;
        }
    };
}
