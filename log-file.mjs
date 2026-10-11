/**
 * One log file of the server (access.log, error.log, performance.log, #104):
 * appended to, rotated by size, and never able to crash the server.
 *
 * - Rotation: when a line would take the file past `maxBytes`, the file
 *   becomes `<name>.1`, `<name>.1` becomes `<name>.2` and so on, the oldest
 *   beyond `keep` is overwritten; the size is read at startup, so a restart
 *   goes on with the same file. The lines a closing stream still holds are
 *   written to the renamed file (an open file follows its rename; where the
 *   system refuses to rename an open file, the rotation is reported and the
 *   file goes on growing).
 * - Errors: a file that cannot be opened or written (permissions, a full disk)
 *   is reported once through `onError` and the lines are dropped (the server
 *   also prints every line to the console); the file is tried again a minute
 *   later.
 * - `end()` writes what is buffered and closes the file: the server calls it
 *   before exiting.
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
 * @returns {{ write: (text: string) => void, end: () => Promise<void> }}
 */
export function createLogFile(filePath, { maxBytes = 10 * 1024 * 1024, keep = 3, onError = () => {}, now = Date.now, fs = nodeFs } = {}) {
    let stream = null;
    let size = 0;
    let failedAt = null;

    const fail = error => {
        if (failedAt === null) onError(`${filePath}: ${error.message} - its lines go to the console only, the file is tried again in a minute`);
        failedAt = now();
        stream = null;
    };

    const open = () => {
        let fd;
        try {
            // Opened at once, not by the stream later: a rotation then renames the file this
            // stream writes to, and the lines it still buffers follow the file
            fd = fs.openSync(filePath, 'a');
            size = fs.fstatSync(fd).size;
        } catch (error) {
            if (fd !== undefined) fs.closeSync(fd);
            fail(error);
            return;
        }
        const opened = fs.createWriteStream(null, { fd });
        // The error of a write arrives here, later; without a listener it would crash the server
        opened.on('error', error => { if (stream === opened) fail(error); });
        stream = opened;
        failedAt = null;
    };

    const rotate = () => {
        stream.end();
        stream = null;
        try {
            for (let index = keep - 1; index >= 1; index--) {
                if (fs.existsSync(`${filePath}.${index}`)) fs.renameSync(`${filePath}.${index}`, `${filePath}.${index + 1}`);
            }
            fs.renameSync(filePath, `${filePath}.1`);
        } catch (error) {
            onError(`${filePath}: rotation failed (${error.message}), the file goes on growing`);
        }
        open();
    };

    open();

    return {
        write(text) {
            if (!stream) {
                if (now() - failedAt < 60000) return;
                open();
                if (!stream) return;
            }
            const bytes = Buffer.byteLength(text);
            if (size > 0 && size + bytes > maxBytes) {
                rotate();
                if (!stream) return;
            }
            stream.write(text);
            size += bytes;
        },
        end() {
            const closing = stream;
            stream = null;
            failedAt = Number.POSITIVE_INFINITY;
            if (!closing) return Promise.resolve();
            return new Promise(resolve => {
                closing.once('error', resolve);
                closing.end(resolve);
            });
        }
    };
}
