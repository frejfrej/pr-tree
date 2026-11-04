// A small element tree for the tests that walk the rendered tree (the filter
// pass, the tree keys, the popovers): class, tag, `[hidden]` and `[data-name="value"]`
// selectors, `:not(.class)`, `:scope`, `:focus-visible` (the focused element
// while the document's `keyboard` is true), the descendant and `>`
// combinators, selector lists; focus, click and scroll are recorded on the
// document; `rect` is what getBoundingClientRect returns. Elements are built
// by `node` or the document's createElement, moved by append, prepend and
// replaceChildren; `innerHTML` is kept as a string, never parsed; listeners
// run on `dispatch(type, event)`, never bubbling. node --test loads it with the tests; it holds none.

function parseCompound(text) {
    if (text === ':scope') return { scope: true };
    if (text === ':focus-visible') return { focusVisible: true };
    const match = /^([a-z]+)?((?:\.[\w-]+)*)((?::not\(\.[\w-]+\))*)(\[hidden\])?((?:\[data-[\w-]+="[^"]*"\])*)$/.exec(text);
    if (!match) throw new Error(`fake-dom: unsupported selector ${text}`);
    return {
        tag: match[1] ?? null,
        classes: match[2].split('.').filter(Boolean),
        notClasses: [...match[3].matchAll(/:not\(\.([\w-]+)\)/g)].map(([, name]) => name),
        hidden: Boolean(match[4]),
        // data-related-key="x" as ['relatedKey', 'x'], the dataset's name
        data: [...match[5].matchAll(/\[data-([\w-]+)="([^"]*)"\]/g)].map(([, name, value]) => [name.replace(/-(\w)/g, (_, letter) => letter.toUpperCase()), value])
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

function matchesCompound(element, { scope, focusVisible, tag, classes, notClasses, hidden, data }, scopeElement) {
    if (scope) return element === scopeElement;
    if (focusVisible) return element.ownerDocument?.activeElement === element && element.ownerDocument.keyboard;
    return (!tag || element.tag === tag) &&
        classes.every(name => element.classList.contains(name)) &&
        notClasses.every(name => !element.classList.contains(name)) &&
        (!hidden || element.hidden) &&
        data.every(([name, value]) => element.dataset[name] === value);
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
 * An element: `node({ tag, id, classes, dataset, hidden }, ...children)`. The
 * root passed to `fakeDocument` connects its tree.
 */
export function node({ tag = 'div', id = '', classes = [], dataset = {}, hidden = false } = {}, ...children) {
    const classSet = new Set(classes);
    const attributes = {};
    const listeners = {};
    // The elements `element` takes as children, each from its former parent
    const adopt = added => {
        for (const child of added) {
            child.parentElement?.children.splice(child.parentElement.children.indexOf(child), 1);
            child.parentElement = element;
        }
        return added;
    };
    const element = {
        tag,
        tagName: tag.toUpperCase(),
        id,
        children,
        parentElement: null,
        dataset: { ...dataset },
        style: { display: '' },
        rect: { top: 0, bottom: 0 },
        getBoundingClientRect() { return this.rect; },
        offsetWidth: 0,
        offsetHeight: 0,
        textContent: '',
        innerHTML: '',
        hidden,
        document: null,
        get className() { return [...classSet].join(' '); },
        set className(value) {
            classSet.clear();
            for (const name of value.split(/\s+/).filter(Boolean)) classSet.add(name);
        },
        classList: {
            contains: name => classSet.has(name),
            add: name => classSet.add(name),
            toggle(name, force = !classSet.has(name)) { force ? classSet.add(name) : classSet.delete(name); }
        },
        append(...added) { children.push(...adopt(added)); },
        appendChild(added) { children.push(...adopt([added])); return added; },
        prepend(...added) { children.unshift(...adopt(added)); },
        replaceChildren(...added) {
            for (const child of children.splice(0)) child.parentElement = null;
            children.push(...adopt(added));
        },
        addEventListener(type, listener) { (listeners[type] ??= []).push(listener); },
        dispatch(type, event = {}) { for (const listener of listeners[type] ?? []) listener({ target: element, ...event }); },
        getAttribute: name => attributes[name] ?? null,
        setAttribute(name, value) { attributes[name] = value; },
        removeAttribute(name) { delete attributes[name]; },
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

/** A document over `root`: querySelector(All), getElementById, createElement, listeners run by `dispatch`, activeElement, `keyboard` (the focus modality), and `events`, the focus, scroll and click calls in order */
export function fakeDocument(root) {
    const listeners = {};
    const document = {
        activeElement: null,
        body: root,
        documentElement: null,
        keyboard: true,
        events: [],
        querySelectorAll: selector => [root, ...descendants(root)].filter(candidate => candidate.matches(selector)),
        querySelector: selector => document.querySelectorAll(selector)[0] ?? null,
        getElementById: id => [root, ...descendants(root)].find(candidate => candidate.id === id) ?? null,
        createElement: tag => node({ tag }),
        addEventListener(type, listener) { (listeners[type] ??= []).push(listener); },
        dispatch(type, event) { for (const listener of listeners[type] ?? []) listener(event); }
    };
    root.document = document;
    return document;
}
