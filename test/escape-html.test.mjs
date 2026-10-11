import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml } from '../public/escape-html.js';
import { escapeHtml as renderEscape } from '../public/app-render.js';

test('escapeHtml escapes the five characters that end an attribute or start a tag; null and undefined give an empty string', () => {
    assert.equal(escapeHtml(`<script>alert("x")</script> & 'y'`), '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;y&#39;');
    assert.equal(escapeHtml('&amp;'), '&amp;amp;'); // escaped again: the text is text
    assert.equal(escapeHtml(null), '');
    assert.equal(escapeHtml(undefined), '');
    assert.equal(escapeHtml(42), '42');
});

test('the tree uses the one escape, the filter options too (multi-select.test.mjs) (#111)', () => {
    assert.equal(renderEscape, escapeHtml);
});
