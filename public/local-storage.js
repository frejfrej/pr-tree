/**
 * The page's preferences in localStorage (theme, sidebar, collapse state),
 * read and written without ever throwing: in a private window or with
 * blocked site data the storage is unavailable, and the preference is then
 * simply not remembered.
 */

export function readStorage(key) {
    try {
        return localStorage.getItem(key);
    } catch (error) {
        return null;
    }
}

export function writeStorage(key, value) {
    try {
        localStorage.setItem(key, value);
    } catch (error) {
        // Storage unavailable (private window, blocked site data) or full: the preference is not remembered
    }
}

export function removeStorage(key) {
    try {
        localStorage.removeItem(key);
    } catch (error) {
        // Storage unavailable: nothing was remembered
    }
}
