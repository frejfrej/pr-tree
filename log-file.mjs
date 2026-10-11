/**
 * One log file of the server (access.log, error.log, performance.log, #104):
 * appended to, rotated by size, and never able to crash the server.
 *
 * - Each line is appended at once (`appendFileSync`): nothing is buffered, so
 *   no line is lost when the process ends, by a signal or a crash, and no
 *   file stays open. A line is a few dozen bytes and the server writes a few
 *   lines per request, so the synchronous write costs the event loop nothing
 *   it would notice.
 * - Rotation: when a line would take the file past `maxBytes` (its size on
 *   disk, so two servers writing one file count each other's lines), the file
 *   becomes `<name>.1`, `<name>.1` becomes `<name>.2` and so on, the oldest
 *   beyond `keep` is overwritten. A rotation that fails is reported once and
 *   not tried again: the file goes on growing.
 * - Errors: a file that cannot be written (permissions, a full disk) is
 *   reported once through `onError` and its lines are dropped (the server
 *   prints every line to the console too); the file is tried again a minute
 *   later, and a failure is reported again only after a line went through.
 *
 * It does not timestamp or format lines (index.mjs does), nor compress the
 * rotated files.
 */
import nodeFs from 'node:fs';

/**
 * @param {string} filePath
 * @param {object} [options]
 * @param {number} [options.maxBytes] the size a file does not grow past (a single larger line still goes to an empty file)
 * @param {number} [options.keep] rotated files kept, at least 1
 * @param {(message: string) => void} [options.onError]
 * @param {() => number} [options.now]
 * @param {typeof nodeFs} [options.fs]
 * @returns {{ write: (text: string) => void }}
 */
export function createLogFile(filePath, { maxBytes = 10 * 1024 * 1024, keep = 3, onError = () => {}, now = Date.now, fs = nodeFs } = {}) {
    let failedAt = null;
    let reported = false;
    let rotating = true;

    const sizeOnDisk = () => {
        try {
            return fs.statSync(filePath).size;
        } catch (error) {
            if (error.code === 'ENOENT') return 0;
            throw error;
        }
    };

    const rotate = () => {
        try {
            for (let index = keep - 1; index >= 1; index--) {
                if (fs.existsSync(`${filePath}.${index}`)) fs.renameSync(`${filePath}.${index}`, `${filePath}.${index + 1}`);
            }
            fs.renameSync(filePath, `${filePath}.1`);
        } catch (error) {
            // Tried again at every line, a failing rename would report each line and shift the old files away
            rotating = false;
            onError(`${filePath}: rotation failed (${error.message}), the file goes on growing until the server restarts`);
        }
    };

    return {
        write(text) {
            if (failedAt !== null && now() - failedAt < 60000) return;
            try {
                const size = sizeOnDisk();
                if (rotating && size > 0 && size + Buffer.byteLength(text) > maxBytes) rotate();
                fs.appendFileSync(filePath, text);
                failedAt = null;
                reported = false;
            } catch (error) {
                failedAt = now();
                if (!reported) onError(`${filePath}: ${error.message} - its lines go to the console only, the file is tried again in a minute`);
                reported = true;
            }
        }
    };
}
