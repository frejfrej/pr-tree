import { readFileSync, readdirSync, unlinkSync } from 'fs';
import * as fsPromises from 'fs/promises';
import path from 'path';

/**
 * The conflicts of pull requests by "repo/destHash..sourceHash", kept on disk
 * across server restarts: a result only depends on the two commits, so it
 * never changes, as long as the conflict rule does not: the file keys start
 * with the rule version ("2:repo/destHash..sourceHash"), added here, and
 * only the entries of the version given at open are visible. Entries computed
 * more than maxAgeDays ago are dropped when the file is written (merged pull
 * requests leave their hashes behind), and so are those of any other rule
 * version. Only successful results are meant to be stored; a failure is
 * retried by the caller at the next load. A save is durable: the new file
 * reaches the disk before it replaces the old one, so a power loss leaves
 * one or the other, never an empty file. The temporary files that a stopped
 * process left behind ("sync-cache.json.<pid>.tmp" of a pid no longer
 * running) are removed at open.
 */

export const syncCacheVersion = 1;
const dayMs = 24 * 60 * 60 * 1000;

/**
 * Opens (reads) the cache file. A missing file is an empty cache; an
 * unreadable one or another version is reported through onError and ignored.
 * @param {string} filePath - the JSON file
 * @param {object} options
 * @param {number} options.ruleVersion - the version of the conflict rule (conflictRuleVersion): the prefix of the keys, the other versions dropped at save
 * @param {number} [options.maxAgeDays=90] - entries older than this are dropped at save
 * @param {() => number} [options.now] - clock, for the tests
 * @param {(error: Error) => void} [options.onError] - called when the file cannot be used
 * @param {{ open: Function, rename: Function, unlink: Function }} [options.fileSystem] - the functions of fs/promises a save uses, for the tests (the read at open is the real file system's)
 */
export function openSyncCache(filePath, { ruleVersion, maxAgeDays = 90, now = () => Date.now(), onError = () => {}, fileSystem = fsPromises } = {}) {
    if (!Number.isInteger(ruleVersion)) throw new TypeError('openSyncCache needs the ruleVersion of its keys');
    const prefix = `${ruleVersion}:`;
    const entries = new Map(); // by file key, every version
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

    // The entries too old to matter (an unparsable date goes too) and those
    // of another rule version, never looked up
    function prune() {
        const oldest = now() - maxAgeDays * dayMs;
        for (const [key, entry] of entries) {
            if (!(Date.parse(entry.computedAt) >= oldest) || !key.startsWith(prefix)) entries.delete(key);
        }
    }

    removeTemporaryFilesOfStoppedProcesses(filePath);

    // A temporary file synced to the disk, then a rename: neither a crash nor
    // a power loss leaves a truncated or empty cache. The temporary file goes
    // when the write or the rename fails.
    async function write(content) {
        const temporary = temporaryFile(filePath, process.pid);
        try {
            const handle = await fileSystem.open(temporary, 'w');
            let closed = false;
            try {
                await handle.writeFile(content);
                await handle.sync();
                closed = true;
                await handle.close();
            } finally {
                // after a failed write or sync, its error is the one reported
                if (!closed) await handle.close().catch(() => {});
            }
            await fileSystem.rename(temporary, filePath);
        } catch (error) {
            dirty = true; // the next save writes the entries again
            await fileSystem.unlink(temporary).catch(() => {});
            throw error;
        }
        await syncDirectory();
        return true;
    }

    // The rename itself on the disk; best effort: Windows opens a directory
    // but cannot flush it, and some file systems refuse to sync one
    async function syncDirectory() {
        let handle;
        try {
            handle = await fileSystem.open(path.dirname(filePath), 'r');
            await handle.sync();
        } catch {
            // the file is in place already
        } finally {
            await handle?.close().catch(() => {});
        }
    }

    return {
        /** The number of results of the current rule version */
        get size() {
            let count = 0;
            for (const key of entries.keys()) if (key.startsWith(prefix)) count++;
            return count;
        },
        /** The stored result of "repo/destHash..sourceHash" without its timestamp, null when unknown */
        get(key) {
            const entry = entries.get(prefix + key);
            if (!entry) return null;
            const { computedAt, ...result } = entry;
            return result;
        },
        set(key, result) {
            entries.set(prefix + key, { ...result, computedAt: new Date(now()).toISOString() });
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

function temporaryFile(filePath, pid) {
    return `${filePath}.${pid}.tmp`;
}

// A process killed during a save (Ctrl+C, a crash) leaves its temporary file;
// a pid still running may be another instance saving in the same directory
function removeTemporaryFilesOfStoppedProcesses(filePath) {
    const directory = path.dirname(filePath);
    const prefix = `${path.basename(filePath)}.`;
    let names;
    try {
        names = readdirSync(directory);
    } catch {
        return;
    }
    for (const name of names) {
        if (!name.startsWith(prefix) || !name.endsWith('.tmp')) continue;
        const pid = name.slice(prefix.length, -'.tmp'.length);
        if (!/^[1-9]\d*$/.test(pid) || isRunning(Number(pid))) continue;
        try {
            unlinkSync(path.join(directory, name));
        } catch {
            // removed by another instance, or not ours to remove
        }
    }
}

function isRunning(pid) {
    try {
        process.kill(pid, 0); // signal 0: an existence check, nothing is sent
        return true;
    } catch (error) {
        return error.code === 'EPERM'; // running, under another user
    }
}
