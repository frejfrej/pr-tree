// A small element tree for the tests that walk the rendered tree (the filter
// pass, the tree keys): class, tag and `[hidden]` selectors, `:not(.class)`, `:scope`,
// `:focus-visible` (the focused element while the document's `keyboard` is
// true), the descendant and `>` combinators, selector lists; focus, click and
// scroll are recorded on the document; `rect` is what getBoundingClientRect returns. node --test loads it with the tests; it holds none.

function parseCompound(text) {
    if (text === ':scope') return { scope: true };
    if (text === ':focus-visible') return { focusVisible: true };
    const match = /^([a-z]+)?((?:\.[\w-]+)*)((?::not\(\.[\w-]+\))*)(\[hidden\])?$/.exec(text);
    if (!match) throw new Error(`fake-dom: unsupported selector ${text}`);
    return {
        tag: match[1] ?? null,
        classes: match[2].split('.').filter(Boolean),
        notClasses: [...match[3].matchAll(/:not\(\.([\w-]+)\)/g)].map(([, name]) => name),
        hidden: Boolean(match[4])
    };
}

// The compounds from the right, each with the combinator that links it to the one on its left
function parseSelector(selector) {
    const tokens = selector.trim().replace(/\s*>\s*/g, ' > ').split(/\s+/);
    const steps = [];
    let combinator = null;
    for (let index = tokens.length - 1; index >= 0; index--) {
        if (tokens[index] === '>') {
            combinator = '>';
            continue;
        }
        if (steps.length > 0) steps[steps.length - 1].combinator = combinator ?? ' ';
        steps.push({ compound: parseCompound(tokens[index]), combinator: null });
        combinator = null;
    }
    return steps;
}

function matchesCompound(element, { scope, focusVisible, tag, classes, notClasses, hidden }, scopeElement) {
    if (scope) return element === scopeElement;
    if (focusVisible) return element.ownerDocument?.activeElement === element && element.ownerDocument.keyboard;
    return (!tag || element.tag === tag) &&
        classes.every(name => element.classList.contains(name)) &&
        notClasses.every(name => !element.classList.contains(name)) &&
        (!hidden || element.hidden);
}

function matchesSteps(element, steps, scopeElement, index = 0) {
    if (!element || !matchesCompound(element, steps[index].compound, scopeElement)) return false;
    if (index === steps.length - 1) return true;
    if (steps[index].combinator === '>') return matchesSteps(element.parentElement, steps, scopeElement, index + 1);
    for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
        if (matchesSteps(ancestor, steps, scopeElement, index + 1)) return true;
    }
    return false;
}

function descendants(element) {
    return element.children.flatMap(child => [child, ...descendants(child)]);
}

/**
 * An element: `node({ tag, classes, dataset, hidden }, ...children)`. The
 * root passed to `fakeDocument` connects its tree.
 */
export function node({ tag = 'div', classes = [], dataset = {}, hidden = false } = {}, ...children) {
    const classSet = new Set(classes);
    const attributes = {};
    const element = {
        tag,
        children,
        parentElement: null,
        dataset: { ...dataset },
        style: { display: '' },
        rect: { top: 0, bottom: 0 },
        getBoundingClientRect() { return this.rect; },
        hidden,
        document: null,
        classList: {
            contains: name => classSet.has(name),
            add: name => classSet.add(name),
            toggle(name, force = !classSet.has(name)) { force ? classSet.add(name) : classSet.delete(name); }
        },
        getAttribute: name => attributes[name] ?? null,
        setAttribute(name, value) { attributes[name] = value; },
        get firstElementChild() { return children[0] ?? null; },
        get nextElementSibling() { return this.parentElement?.children[this.parentElement.children.indexOf(this) + 1] ?? null; },
        get previousElementSibling() { return this.parentElement?.children[this.parentElement.children.indexOf(this) - 1] ?? null; },
        get isConnected() {
            let top = this;
            while (top.parentElement) top = top.parentElement;
            return Boolean(top.document);
        },
        get ownerDocument() {
            let top = this;
            while (top.parentElement) top = top.parentElement;
            return top.document;
        },
        matches(selector, scopeElement = null) { return selector.split(',').some(part => matchesSteps(this, parseSelector(part), scopeElement)); },
        closest(selector) {
            for (let current = this; current; current = current.parentElement) {
                if (current.matches(selector)) return current;
            }
            return null;
        },
        querySelectorAll(selector) { return descendants(this).filter(candidate => candidate.matches(selector, this)); },
        querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; },
        contains(other) {
            for (let current = other; current; current = current.parentElement) {
                if (current === this) return true;
            }
            return false;
        },
        focus(options) {
            this.ownerDocument.activeElement = this;
            this.ownerDocument.events.push(['focus', this, options]);
        },
        scrollIntoView(options) { this.ownerDocument.events.push(['scroll', this, options]); },
        click() { this.ownerDocument.events.push(['click', this]); }
    };
    for (const child of children) child.parentElement = element;
    return element;
}

/** A document over `root`: querySelector(All), activeElement, `keyboard` (the focus modality), and `events`, the focus, scroll and click calls in order */
export function fakeDocument(root) {
    const document = {
        activeElement: null,
        keyboard: true,
        events: [],
        querySelectorAll: selector => [root, ...descendants(root)].filter(candidate => candidate.matches(selector)),
        querySelector: selector => document.querySelectorAll(selector)[0] ?? null
    };
    root.document = document;
    return document;
}
