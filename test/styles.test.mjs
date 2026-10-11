import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const css = readFileSync(path.resolve(import.meta.dirname, '../public/styles.css'), 'utf8').replace(/\r\n/g, '\n');

const tokenBlock = opening => {
    const start = css.indexOf(`${opening} {`);
    assert.notEqual(start, -1, opening);
    const body = css.slice(start, css.indexOf('\n}', start));
    return Object.fromEntries([...body.matchAll(/^\s*(--[\w-]+):\s*([^;]+);/gm)].map(([, name, value]) => [name, value.trim()]));
};

const light = tokenBlock(':root');
const themes = { light, dark: { ...light, ...tokenBlock(':root[data-theme="dark"]') } };

const resolve = (tokens, name) => {
    const value = tokens[name];
    assert.ok(value, `${name} is defined`);
    const reference = value.match(/^var\((--[\w-]+)\)$/);
    return reference ? resolve(tokens, reference[1]) : value;
};

const luminance = hex => {
    assert.match(hex, /^#[0-9A-Fa-f]{6}$/, 'the contrast test reads #RRGGBB colours only');
    const [r, g, b] = hex.slice(1).match(/../g).map(pair => parseInt(pair, 16) / 255)
        .map(channel => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrast = (first, second) => {
    const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a);
    return (lighter + 0.05) / (darker + 0.05);
};

const strongTokens = ['--success-strong', '--error-strong', '--attention-strong', '--warning-strong', '--neutral-strong'];
const accentFills = [...strongTokens, '--primary-color'];

const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map(([, selectors, body]) => ({ selectors: selectors.replace(/\/\*[\s\S]*?\*\//g, '').split(',').map(selector => selector.trim()), body }));

// Against the surface of the cards and the sidebar, where the strong tokens are used today: --background-color
// and --surface-muted are darker (warning is 4.25:1 on --background-color), so a use there needs its own check
test('every strong token and the primary colour reach 4.5:1 on the surface and under --on-accent-text, in both themes', () => {
    for (const [theme, tokens] of Object.entries(themes)) {
        for (const name of accentFills) {
            const colour = resolve(tokens, name);
            for (const against of ['--surface-color', '--on-accent-text']) {
                const ratio = contrast(colour, resolve(tokens, against));
                assert.ok(ratio >= 4.5, `${theme}: ${name} ${colour} against ${against} is ${ratio.toFixed(2)}:1`);
            }
        }
    }
});

test('the ring of the active-filter count reaches 3:1 against the banner, in both themes', () => {
    assert.match(rules.find(rule => rule.selectors.includes('.header-badge')).body, /box-shadow:[^;]*var\(--header-text\)/);
    for (const [theme, tokens] of Object.entries(themes)) {
        const ratio = contrast(resolve(tokens, '--header-text'), resolve(tokens, '--header-bg'));
        assert.ok(ratio >= 3, `${theme}: --header-text against --header-bg is ${ratio.toFixed(2)}:1`);
    }
});

test('the pause indicator of the banner reaches 4.5:1 against the banner, in both themes', () => {
    assert.match(rules.find(rule => rule.selectors.includes('.atlassian-pause')).body, /(^|[\s;])color:\s*var\(--header-warning\)/);
    for (const [theme, tokens] of Object.entries(themes)) {
        const ratio = contrast(resolve(tokens, '--header-warning'), resolve(tokens, '--header-bg'));
        assert.ok(ratio >= 4.5, `${theme}: --header-warning against --header-bg is ${ratio.toFixed(2)}:1`);
    }
});

test('every surface under --on-accent-text text is filled with a strong token or the primary colour', () => {
    const onAccent = new Set(rules.filter(rule => /(^|[\s;])color:\s*var\(--on-accent-text\)/.test(rule.body)).flatMap(rule => rule.selectors));
    assert.ok(onAccent.has('.header-badge'));
    for (const rule of rules.filter(rule => rule.selectors.some(selector => onAccent.has(selector)))) {
        const fill = rule.body.match(/background-color:\s*var\((--[\w-]+)\)/);
        if (fill) {
            assert.ok(accentFills.includes(fill[1]), `${rule.selectors.join(', ')} is filled with ${fill[1]}`);
        }
    }
});

const bands = rules.flatMap(rule => rule.selectors.filter(selector => /\.status-[\w-]+/.test(selector))
    .map(selector => ({ selector, border: rule.body.match(/border-color:\s*var\((--[\w-]+)\)/)?.[1] })));

// Every card, stacked or not, sits on the surface of .repository-content: its border has the surface on both sides
test('every status border reaches 3:1 against the surface, in both themes', () => {
    assert.ok(bands.length >= 4, `${bands.length} status bands found`);
    for (const { selector, border } of bands) {
        assert.ok(border, `${selector} sets its border-color from a token`);
        for (const [theme, tokens] of Object.entries(themes)) {
            const colour = resolve(tokens, border);
            const ratio = contrast(colour, resolve(tokens, '--surface-color'));
            assert.ok(ratio >= 3, `${theme}: ${selector} ${border} ${colour} against --surface-color is ${ratio.toFixed(2)}:1`);
        }
    }
});

// Amber and green, blue and purple look alike to a red-green colour-blind eye; lightness keeps those bands
// apart (amber and green are 1.30:1 apart in dark). Blue and green keep their hues for that eye and are not
// checked (1.05:1 in light): a tritan eye or a greyscale print does not tell them apart
test('the bands a red-green colour-blind eye confuses differ in lightness, in both themes', () => {
    const border = selector => {
        const band = bands.find(band => band.selector === selector);
        assert.ok(band, `${selector} is a status band of styles.css`);
        return band.border;
    };
    const pairs = [['.status-in-progress', '.status-in-review-all-approved'], ['.status-in-review', '.status-resolved']];
    for (const [theme, tokens] of Object.entries(themes)) {
        for (const [first, second] of pairs) {
            const ratio = contrast(resolve(tokens, border(first)), resolve(tokens, border(second)));
            assert.ok(ratio >= 1.25, `${theme}: ${first} against ${second} is ${ratio.toFixed(2)}:1`);
        }
    }
});

test('the border of the warnings box reaches 3:1 against its fill and the surface, in both themes', () => {
    const body = rules.find(rule => rule.selectors.includes('.warnings')).body;
    const border = body.match(/border:[^;]*var\((--[\w-]+)\)/)[1];
    const fill = body.match(/background-color:\s*var\((--[\w-]+)\)/)[1];
    for (const [theme, tokens] of Object.entries(themes)) {
        for (const against of [fill, '--surface-color']) {
            const ratio = contrast(resolve(tokens, border), resolve(tokens, against));
            assert.ok(ratio >= 3, `${theme}: ${border} against ${against} is ${ratio.toFixed(2)}:1`);
        }
    }
});

test('the plain status colours colour no text or icon', () => {
    for (const rule of rules) {
        const plain = rule.body.match(/(^|[\s;])color:\s*var\(--(success|error|warning|attention)-color\)/);
        assert.equal(plain, null, `${rule.selectors.join(', ')} uses --${plain?.[2]}-color`);
    }
});

test('no control drops the focus outline, and the outline on the banner reaches 3:1 against it, in both themes (#109)', () => {
    assert.doesNotMatch(css, /outline:\s*(?:none|0)\b/, 'the 2px :focus-visible outline stays on every control');
    assert.ok(!('--focus-ring' in light), 'the faint focus ring is gone');
    const banner = rules.find(rule => rule.selectors.includes('.app-header :focus-visible'));
    assert.ok(banner, 'the banner, painted in the primary colour in the light theme, has an outline of its own');
    assert.match(banner.body, /outline-color:\s*var\(--header-text\)/);
    for (const [name, tokens] of Object.entries(themes)) {
        const ratio = contrast(resolve(tokens, '--header-text'), resolve(tokens, '--header-bg'));
        assert.ok(ratio >= 3, `${name}: ${ratio.toFixed(2)}`);
    }
});
