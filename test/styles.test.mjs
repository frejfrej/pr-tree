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

test('the plain status colours colour no text or icon but the 32px state-message icon', () => {
    for (const rule of rules) {
        const plain = rule.body.match(/(^|[\s;])color:\s*var\(--(success|error|warning|attention)-color\)/);
        if (plain) {
            assert.deepEqual(rule.selectors, ['.state-message.error i'], `${rule.selectors.join(', ')} uses --${plain[2]}-color`);
        }
    }
});
