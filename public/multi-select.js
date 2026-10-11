/**
 * Multi-Select Component
 * A reusable multi-select dropdown component with checkbox-based selection.
 * The markup of the dropdown is generated: the page only declares an empty
 * element with the class and the id.
 */

import { escapeHtml } from './escape-html.js';

const instances = new Map();

// The trigger and the dropdown of every multi-select; the element in index.html
// is an empty <div class="multi-select" id="..."> and gets this markup at
// construction (styles.css reserves its height until then). The trigger is
// named by the visible label of the filter, the element with the id
// `<id>Label` in index.html, then by the current selection ("Sprint, Show all");
// the search box and the dropdown (a group of checkboxes) by that label alone
// ("Sprint"). No aria-haspopup: its values announce a menu, a listbox, a tree,
// a grid or a dialog, and the dropdown is none of them.
export function multiSelectMarkup(elementId) {
    return `
    <div class="multi-select-trigger" tabindex="0" role="button" aria-expanded="false"
         aria-controls="${elementId}Dropdown" aria-labelledby="${elementId}Label ${elementId}Display">
        <span class="multi-select-display" id="${elementId}Display">Show all</span>
        <i class="fas fa-chevron-down multi-select-arrow" aria-hidden="true"></i>
    </div>
    <div class="multi-select-dropdown" id="${elementId}Dropdown" role="group" aria-labelledby="${elementId}Label">
        <div class="multi-select-search">
            <input type="text" placeholder="Search..." class="multi-select-search-input" aria-labelledby="${elementId}Label">
        </div>
        <div class="multi-select-options"></div>
        <div class="multi-select-actions">
            <button type="button" class="multi-select-clear">Clear all</button>
            <button type="button" class="multi-select-select-all">Select all</button>
        </div>
    </div>`;
}

export class MultiSelect {
    constructor(elementId, options = {}) {
        this.elementId = elementId;
        this.element = document.getElementById(elementId);
        if (!this.element) {
            throw new Error(`Element with id "${elementId}" not found`);
        }

        this.options = [];
        this.selectedValues = [];
        this.onChange = options.onChange || null;
        this.searchText = '';

        this.element.innerHTML = multiSelectMarkup(elementId);
        this.trigger = this.element.querySelector('.multi-select-trigger');
        this.dropdown = this.element.querySelector('.multi-select-dropdown');
        this.display = this.element.querySelector('.multi-select-display');
        this.optionsContainer = this.element.querySelector('.multi-select-options');
        this.searchInput = this.element.querySelector('.multi-select-search-input');
        this.clearBtn = this.element.querySelector('.multi-select-clear');
        this.selectAllBtn = this.element.querySelector('.multi-select-select-all');

        this.init();
    }

    init() {
        // Toggle dropdown on trigger click
        this.trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggle();
        });

        // Keyboard support for trigger
        this.trigger.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                this.toggle();
            }
        });

        // ArrowDown on the closed trigger opens it, like a select. In an open
        // dropdown, from any of its controls: Escape closes it and gives the focus
        // back to the trigger (a hidden control would drop it to the page); the
        // arrows walk the search box and the checkboxes
        this.element.addEventListener('keydown', (e) => {
            if (!this.isOpen()) {
                if (e.key === 'ArrowDown' && e.target === this.trigger) {
                    e.preventDefault();
                    this.open();
                }
                return;
            }
            if (e.key === 'Escape') {
                e.preventDefault();
                this.close();
                this.trigger.focus();
            } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                this.moveFocus(e.target, e.key === 'ArrowDown' ? 1 : -1);
            }
        });

        // The focus leaving for another control of the page (Tab out) closes it.
        // Without a relatedTarget (a click on a part of the page that takes no
        // focus, the window losing the focus), the click handler below decides
        this.element.addEventListener('focusout', (e) => {
            if (this.isOpen() && e.relatedTarget && !this.element.contains(e.relatedTarget)) {
                this.close();
            }
        });

        // Search functionality
        this.searchInput.addEventListener('input', (e) => {
            this.searchText = e.target.value.toLowerCase();
            this.renderOptions();
        });

        // Clear all button
        this.clearBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.clearAll();
        });

        // Select all button
        this.selectAllBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.selectAll();
        });

        // Close on outside click
        document.addEventListener('click', (e) => {
            if (!this.element.contains(e.target)) {
                this.close();
            }
        });

        // Escape with the focus nowhere still closes it: Safari does not focus a
        // clicked checkbox, the focus is then on the page body (app-shell.js
        // leaves that Escape to an open multi-select)
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isOpen() && (e.target === document.body || e.target === document.documentElement)) {
                this.close();
                this.trigger.focus();
            }
        });

        // Prevent dropdown clicks from closing
        this.dropdown.addEventListener('click', (e) => {
            e.stopPropagation();
        });
    }

    isOpen() {
        return this.element.classList.contains('open');
    }

    // The search box, then the checkboxes shown, in order; stops at both ends.
    // The trigger is above them, Clear all and Select all below
    moveFocus(from, step) {
        const controls = [this.searchInput, ...this.optionsContainer.querySelectorAll('input[type="checkbox"]')];
        let index = controls.indexOf(from);
        if (index === -1) index = from === this.trigger ? -1 : controls.length;
        const next = index + step;
        if (next >= 0 && next < controls.length) controls[next].focus();
    }

    toggle() {
        if (this.isOpen()) {
            this.close();
        } else {
            this.open();
        }
    }

    open() {
        // Close other open multi-selects
        instances.forEach((instance, id) => {
            if (id !== this.elementId) {
                instance.close();
            }
        });

        this.element.classList.add('open');
        this.trigger.setAttribute('aria-expanded', 'true');
        this.searchInput.focus();
    }

    close() {
        // Every click on the page closes every instance: a closed one has
        // nothing to reset, and re-rendering its options would rebind them all
        if (!this.isOpen()) return;
        this.element.classList.remove('open');
        this.trigger.setAttribute('aria-expanded', 'false');
        this.searchInput.value = '';
        this.searchText = '';
        this.renderOptions();
    }

    setOptions(options) {
        // options should be array of { value: string, label: string }
        this.options = options;
        this.renderOptions();
        this.updateDisplay();
    }

    setSelectedValues(values) {
        this.selectedValues = values.filter(v =>
            this.options.some(opt => opt.value === v)
        );
        this.renderOptions();
        this.updateDisplay();
    }

    getSelectedValues() {
        return [...this.selectedValues];
    }

    renderOptions() {
        // A re-render (the periodic refresh sets the options again) replaces the
        // checkboxes: the focused one is focused again, or the search box when
        // its option is gone, so the focus is not dropped to the page
        const focusedValue = this.optionsContainer.contains(document.activeElement) ? document.activeElement.value : null;
        const filteredOptions = this.options.filter(opt =>
            opt.label.toLowerCase().includes(this.searchText)
        );

        if (filteredOptions.length === 0) {
            this.optionsContainer.innerHTML = '<div class="multi-select-no-results">No results found</div>';
            if (focusedValue !== null) this.searchInput.focus();
            return;
        }

        this.optionsContainer.innerHTML = filteredOptions.map(opt => {
            const isChecked = this.selectedValues.includes(opt.value);
            return `
                <label class="multi-select-option">
                    <input type="checkbox" value="${escapeHtml(opt.value)}" ${isChecked ? 'checked' : ''}>
                    <span class="multi-select-option-label" title="${escapeHtml(opt.label)}">${escapeHtml(opt.label)}</span>
                </label>
            `;
        }).join('');

        // Add change listeners to checkboxes
        this.optionsContainer.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
            checkbox.addEventListener('change', (e) => {
                const value = e.target.value;
                if (e.target.checked) {
                    if (!this.selectedValues.includes(value)) {
                        this.selectedValues.push(value);
                    }
                } else {
                    this.selectedValues = this.selectedValues.filter(v => v !== value);
                }
                this.updateDisplay();
                this.notifyChange();
            });
        });

        if (focusedValue !== null) {
            const checkboxes = [...this.optionsContainer.querySelectorAll('input[type="checkbox"]')];
            (checkboxes.find(checkbox => checkbox.value === focusedValue) ?? this.searchInput).focus();
        }
    }

    updateDisplay() {
        if (this.selectedValues.length === 0) {
            this.display.textContent = 'Show all';
            this.display.classList.remove('has-selection');
        } else if (this.selectedValues.length === 1) {
            const selectedOption = this.options.find(opt => opt.value === this.selectedValues[0]);
            this.display.textContent = selectedOption ? selectedOption.label : this.selectedValues[0];
            this.display.classList.add('has-selection');
        } else {
            this.display.textContent = `${this.selectedValues.length} selected`;
            this.display.classList.add('has-selection');
        }
    }

    clearAll(notify = true) {
        this.selectedValues = [];
        this.renderOptions();
        this.updateDisplay();
        if (notify) {
            this.notifyChange();
        }
    }

    selectAll() {
        // Select all visible (filtered) options
        const filteredOptions = this.options.filter(opt =>
            opt.label.toLowerCase().includes(this.searchText)
        );

        filteredOptions.forEach(opt => {
            if (!this.selectedValues.includes(opt.value)) {
                this.selectedValues.push(opt.value);
            }
        });

        this.renderOptions();
        this.updateDisplay();
        this.notifyChange();
    }

    notifyChange() {
        if (this.onChange) {
            this.onChange(this.getSelectedValues());
        }
    }
}

export function createMultiSelect(elementId, options = {}) {
    const instance = new MultiSelect(elementId, options);
    instances.set(elementId, instance);
    return instance;
}

export function getMultiSelect(elementId) {
    return instances.get(elementId) || null;
}
