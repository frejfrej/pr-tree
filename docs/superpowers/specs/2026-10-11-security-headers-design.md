# Content-Security-Policy and security headers

**Date:** 2026-10-11
**Issue:** #110
**Target version:** 3.1.0 (the user holds the version at 3.1.0)
**Status:** Decided alone (the user asked for the fix without a brainstorm)

## 1. Goal

The server sent no security header and announced Express. Two sources are
shown as HTML as they come (NFR-SEC7): Bitbucket's rendered pull-request
title and description in the popover, safe only as long as Bitbucket's
renderer is, and README.md in the help. A Content-Security-Policy keeps a
script that would get through from running, on the page that reads every
`/api` answer.

## 2. Decisions

1. **The policy** (`security-headers.mjs`): `default-src 'self'`,
   `script-src 'self'`, `style-src 'self'`, `font-src 'self'`,
   `img-src 'self' https: data:`, `connect-src 'self'`, `object-src 'none'`,
   `base-uri 'none'`, `form-action 'none'`, `frame-ancestors 'none'`. No CDN
   origin (the libraries are vendored since #122, as the issue's comment
   says). `img-src` keeps `https:` (Atlassian avatars and priority icons, any
   image of a description) and `data:` (the fixtures' avatars and icons, the
   stylesheet's chevrons). No `'unsafe-inline'`, no `'unsafe-eval'`.
2. **The theme bootstrap moves to `public/theme-bootstrap.js`**, a classic
   script in `<head>`: it still runs before the first paint, and the policy
   needs neither `'unsafe-inline'` nor a hash to keep up to date. The page had
   no other inline script, no inline handler and no `style=` attribute (styles
   are set through `element.style`, which the policy allows).
3. **Every answer carries the headers**, a 403 of the request guard included:
   the middleware comes before it. `X-Content-Type-Options: nosniff`,
   `Referrer-Policy: no-referrer` (the images of Atlassian and of any host a
   description names, and the links opened from the tree, no longer get the
   dashboard's address), `app.disable('x-powered-by')`.
4. **No sanitizer** for the popover (the issue's optional point): with the
   policy, a `<script>`, an `on…=` attribute or a `javascript:` link in that
   HTML does not run; an image from any host still loads on hover (a
   tracking pixel at worst), which `img-src https:` accepts on purpose for
   the avatars.
5. **3.1.0**, with the other fixes of the release.

## 3. Verification

server.test.mjs: the headers on the page, a script, README.md, an API answer,
a 404 and a 403 of the request guard, no `unsafe-inline` or `unsafe-eval`, no
`X-Powered-By`; the page has no inline script and no script or the page has
an `on…=` or `style=` attribute. Both fail on the previous files. Manual,
Chrome on the fixture server: no violation at load or while using the page
(tree, 370 images, popover, help with Marked, both themes, SYNC load); the
icon font loads; an `onload` attribute and a `javascript:` link injected
into the page do not run.
