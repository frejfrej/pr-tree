/**
 * Which requests the server answers (#98). The dashboard serves private
 * pull-request and Jira data and spends the user's Atlassian quota, and it
 * listens on the loopback interface only unless PR_TREE_HOST says otherwise
 * (index.mjs). Two checks, first in the middleware chain:
 *
 * - The Host header must be one of the server's own names: the loopback
 *   names, plus the address PR_TREE_HOST binds (every address and the name
 *   of the machine for a wildcard), plus the names of PR_TREE_ALLOWED_HOSTS.
 *   A page of an attacker's domain that rebinds its DNS to 127.0.0.1 sends
 *   its own domain as Host, so it gets a 403 and reads nothing; binding to
 *   127.0.0.1 alone does not stop that.
 * - An /api request a browser marks as coming from another site
 *   (`Sec-Fetch-Site: cross-site` or `same-site`) gets a 403: a page of any
 *   site open in the browser can send requests to localhost without reading
 *   the answers (a `no-cors` fetch, an image), enough to start SYNC loads in a
 *   loop and spend the Bitbucket quota until a 429 pauses the dashboard. A
 *   request without the header (curl, a script) or typed in the address bar
 *   (`none`) passes. The other routes (the page, its files, README.md) are not
 *   checked, so a link to the dashboard from another site still opens it.
 *
 * It authenticates nobody: a process of the machine, or of the network when
 * PR_TREE_HOST opens it, can still call the API with an accepted Host header.
 */

export const loopbackHostnames = ['localhost', '127.0.0.1', '[::1]'];

const wildcardHosts = new Set(['0.0.0.0', '::', '[::]']);

// An IPv6 address is written in brackets in a Host header
const asHostname = name => (name.includes(':') && !name.startsWith('[') ? `[${name}]` : name).toLowerCase();

/**
 * The host name of a Host header, lower-cased, without the port; null when
 * the header is missing or malformed.
 * @param {string|undefined} hostHeader
 * @returns {string|null}
 */
export function hostnameOf(hostHeader) {
    if (!hostHeader) return null;
    const match = hostHeader.trim().toLowerCase().match(/^(\[[0-9a-f:.]+\]|[^:[\]\s/@]+)(?::\d*)?$/);
    return match ? match[1] : null;
}

/**
 * The host names the server answers to.
 * @param {object} options
 * @param {string} options.host the address the server listens on (PR_TREE_HOST)
 * @param {string[]} [options.extraHosts] the names of PR_TREE_ALLOWED_HOSTS
 * @param {Object<string, {address: string}[]>} [options.interfaces] os.networkInterfaces(), read for a wildcard host
 * @param {string} [options.machineName] os.hostname(), accepted for a wildcard host
 * @returns {Set<string>}
 */
export function allowedHostnames({ host, extraHosts = [], interfaces = {}, machineName }) {
    const names = new Set(loopbackHostnames);
    if (wildcardHosts.has(host)) {
        for (const { address } of Object.values(interfaces).flat()) names.add(asHostname(address));
        if (machineName) names.add(asHostname(machineName));
    } else {
        names.add(asHostname(host));
    }
    for (const name of extraHosts) names.add(asHostname(name));
    return names;
}

/**
 * The Express middleware of the two checks.
 * @param {object} options
 * @param {Set<string>} options.allowedHostnames
 * @param {(message: string) => void} options.log a refusal, logged once a minute at most per message
 * @param {() => number} [options.now]
 */
export function createRequestGuard({ allowedHostnames, log, now = Date.now }) {
    // A page sending requests in a loop would otherwise write a log line for each
    const lastLogged = new Map();
    const refuse = (res, message, body) => {
        const time = now();
        if (!(time - lastLogged.get(message) < 60000)) {
            lastLogged.set(message, time);
            log(message);
        }
        res.status(403).json(body);
    };

    return (req, res, next) => {
        const hostname = hostnameOf(req.headers.host);
        if (!hostname || !allowedHostnames.has(hostname)) {
            refuse(res, `Refused ${req.method} ${req.path}: Host ${JSON.stringify(req.headers.host ?? null)} is not a name of this server (PR_TREE_ALLOWED_HOSTS)`,
                { error: 'Unknown Host: open the dashboard at localhost, or add this name to PR_TREE_ALLOWED_HOSTS' });
            return;
        }
        const site = req.headers['sec-fetch-site'];
        // Express matches routes regardless of case
        if (/^\/api(?:\/|$)/i.test(req.path) && site && site !== 'same-origin' && site !== 'none') {
            refuse(res, `Refused ${req.method} ${req.path}: request from another site (Sec-Fetch-Site: ${JSON.stringify(site)})`,
                { error: 'Cross-site request refused' });
            return;
        }
        next();
    };
}
