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
// the search box of the dropdown by that label alone ("Sprint").
export function multiSelectMarkup(elementId) {
    return `
    <div class="multi-select-trigger" tabindex="0" role="button" aria-expanded="false"
         aria-labelledby="${elementId}Label ${elementId}Display">
        <span class="multi-select-display" id="${elementId}Display">Show all</span>
        <i class="fas fa-chevron-down multi-select-arrow" aria-hidden="true"></i>
    </div>
    <div class="multi-select-dropdown">
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
            } else if (e.key === 'Escape') {
                this.close();
            }
        });

        // Search functionality
        this.searchInput.addEventListener('input', (e) => {
            this.searchText = e.target.value.toLowerCase();
            this.renderOptions();
        });

        // Escape from the search box closes the dropdown and gives the focus back
        // to the trigger: the hidden box would otherwise drop it to the page
        this.searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.close();
                this.trigger.focus();
            }
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

        // Prevent dropdown clicks from closing
        this.dropdown.addEventListener('click', (e) => {
            e.stopPropagation();
        });
    }

    toggle() {
        if (this.element.classList.contains('open')) {
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
        if (!this.element.classList.contains('open')) return;
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
        const filteredOptions = this.options.filter(opt =>
            opt.label.toLowerCase().includes(this.searchText)
        );

        if (filteredOptions.length === 0) {
            this.optionsContainer.innerHTML = '<div class="multi-select-no-results">No results found</div>';
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
