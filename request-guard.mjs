import net from 'node:net';

/**
 * Which requests the server answers (#98). The dashboard serves private
 * pull-request and Jira data and spends the user's Atlassian quota, and it
 * listens on the loopback interface only unless PR_TREE_HOST says otherwise
 * (index.mjs). Two checks, first in the middleware chain:
 *
 * - The Host header must be one of the server's own names: the loopback
 *   names, plus the address PR_TREE_HOST binds (for a wildcard, the
 *   addresses of the machine, read again when a name is not known, and its
 *   name), plus the names of PR_TREE_ALLOWED_HOSTS.
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

/**
 * A host name or address as a Host header carries it: lower-cased, without a
 * trailing dot, an IPv6 address compressed and in brackets; null when
 * malformed. A zone identifier (`fe80::1%en0`) is malformed: browsers send none.
 * @param {string} name
 * @returns {string|null}
 */
export function canonicalHostname(name) {
    const lower = name.trim().toLowerCase().replace(/\.$/, '');
    const bracketed = lower.startsWith('[') && lower.endsWith(']');
    const bare = bracketed ? lower.slice(1, -1) : lower;
    if (net.isIPv6(bare) && !bare.includes('%')) return new URL(`http://[${bare}]`).hostname;
    return !bracketed && /^[^:[\]\s/@%]+$/.test(lower) ? lower : null;
}

/**
 * The host name of a Host header without the port, canonical; null when the
 * header is missing or malformed.
 * @param {string|undefined} hostHeader
 * @returns {string|null}
 */
export function hostnameOf(hostHeader) {
    const match = hostHeader?.trim().match(/^(\[[^\]]*\]|[^:[\]]+)(?::\d*)?$/);
    return match ? canonicalHostname(match[1]) : null;
}

/** Whether a listen address binds every interface: 0.0.0.0, or :: however written. */
export const isWildcardHost = host => ['0.0.0.0', '[::]'].includes(canonicalHostname(host));

// fe80::/10: a browser cannot reach one without a zone identifier
const linkLocal = hostname => /^\[fe[89ab]/.test(hostname);

const interfaceHostnames = interfaces => Object.values(interfaces).flat()
    .map(({ address }) => canonicalHostname(address))
    .filter(hostname => hostname && !linkLocal(hostname));

// Mac.local, Mac and Mac.corp.example are names of the same machine
function machineHostnames(machineName) {
    const name = canonicalHostname(machineName);
    if (!name || net.isIP(name)) return [];
    const label = name.split('.')[0];
    return [name, label, `${label}.local`];
}

/**
 * The host names the server answers to.
 * @param {object} options
 * @param {string} options.host the address the server listens on (PR_TREE_HOST)
 * @param {string[]} [options.extraHosts] the names of PR_TREE_ALLOWED_HOSTS
 * @param {() => Object<string, {address: string}[]>} [options.networkInterfaces] os.networkInterfaces, read for a wildcard host
 * @param {string} [options.machineName] os.hostname(), accepted for a wildcard host
 * @returns {{ names: Set<string>, isAllowed: (hostname: string) => boolean }} the names known at startup;
 *   isAllowed reads the interfaces again for a name not among them, so an address the machine
 *   gets later (Wi-Fi, VPN) is accepted without a restart
 */
export function hostnameMatcher({ host, extraHosts = [], networkInterfaces = () => ({}), machineName = '' }) {
    const wildcard = isWildcardHost(host);
    const names = new Set([
        ...loopbackHostnames,
        ...(wildcard ? [...interfaceHostnames(networkInterfaces()), ...machineHostnames(machineName)] : [canonicalHostname(host)]),
        ...extraHosts.map(canonicalHostname)
    ].filter(Boolean));
    const isAllowed = hostname => names.has(hostname) || (wildcard && interfaceHostnames(networkInterfaces()).includes(hostname));
    return { names, isAllowed };
}

/**
 * The Express middleware of the two checks.
 * @param {object} options
 * @param {(hostname: string) => boolean} options.isAllowedHostname
 * @param {(message: string) => void} options.log a refusal, logged once a minute at most per kind (Host, other site)
 * @param {() => number} [options.now]
 */
export function createRequestGuard({ isAllowedHostname, log, now = Date.now }) {
    // A page sending requests in a loop, each to another path or name, would otherwise write a line for each
    const lastLogged = new Map();
    const refuse = (res, kind, message, body) => {
        const time = now();
        if (!(time - lastLogged.get(kind) < 60000)) {
            lastLogged.set(kind, time);
            log(`${message} (further refusals of this kind are not logged for a minute)`);
        }
        res.status(403).json(body);
    };

    return (req, res, next) => {
        const hostname = hostnameOf(req.headers.host);
        if (!hostname || !isAllowedHostname(hostname)) {
            refuse(res, 'host', `Refused ${req.method} ${req.path}: Host ${JSON.stringify(req.headers.host ?? null)} is not a name of this server (PR_TREE_ALLOWED_HOSTS)`,
                { error: 'Unknown Host: add this name to PR_TREE_ALLOWED_HOSTS (README, "Network access")' });
            return;
        }
        const site = req.headers['sec-fetch-site'];
        // Express matches routes regardless of case
        if (/^\/api(?:\/|$)/i.test(req.path) && site && site !== 'same-origin' && site !== 'none') {
            refuse(res, 'site', `Refused ${req.method} ${req.path}: request from another site (Sec-Fetch-Site: ${JSON.stringify(site)})`,
                { error: 'Cross-site request refused' });
            return;
        }
        next();
    };
}
