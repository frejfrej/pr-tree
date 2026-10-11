/**
 * The security headers of every answer (#110). The page is the place that
 * reads every /api answer, and two of its sources are shown as HTML as they
 * come: Bitbucket's rendered pull-request title and description (the
 * popover) and README.md (the help). The Content-Security-Policy keeps a
 * script injected there from running:
 *
 * - script-src, style-src, font-src 'self': the page loads its scripts,
 *   stylesheets and fonts from itself (the libraries are vendored, the theme
 *   bootstrap is a file); no inline script, no `style=` attribute in markup
 *   (styles set through element.style are not affected), no eval
 * - img-src 'self' https: data: avatars and priority icons come from
 *   Atlassian, a pull-request description may show an image from any host,
 *   the fixtures and the stylesheet use data: URLs
 * - connect-src 'self': the page fetches its own API only
 * - object-src, base-uri, form-action 'none', frame-ancestors 'none': no
 *   plugin, no <base>, no form, no framing of the dashboard
 *
 * With the policy, an `onerror` attribute, a <script> or a javascript: link
 * in the popover's HTML does not run. Nothing is sanitized (NFR-SEC7).
 */

export const contentSecurityPolicy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "font-src 'self'",
    "img-src 'self' https: data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'"
].join('; ');

/** Express middleware: the policy, no MIME sniffing, no Referer sent to Atlassian or to an image host */
export function securityHeaders(req, res, next) {
    res.set({
        'Content-Security-Policy': contentSecurityPolicy,
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer'
    });
    next();
}
