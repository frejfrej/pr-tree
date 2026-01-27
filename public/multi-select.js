/**
 * Multi-Select Component
 * A reusable multi-select dropdown component with checkbox-based selection.
 */

const instances = new Map();

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
        if (this.searchInput) {
            this.searchInput.addEventListener('input', (e) => {
                this.searchText = e.target.value.toLowerCase();
                this.renderOptions();
            });

            this.searchInput.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    this.close();
                }
            });
        }

        // Clear all button
        if (this.clearBtn) {
            this.clearBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.clearAll();
            });
        }

        // Select all button
        if (this.selectAllBtn) {
            this.selectAllBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.selectAll();
            });
        }

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
        if (this.element.classList.contains('disabled')) {
            return;
        }

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
        if (this.searchInput) {
            this.searchInput.focus();
        }
    }

    close() {
        this.element.classList.remove('open');
        if (this.searchInput) {
            this.searchInput.value = '';
            this.searchText = '';
            this.renderOptions();
        }
    }

    setOptions(options) {
        // options should be array of { value: string, label: string }
        this.options = options;
        this.renderOptions();
        this.updateDisplay();
    }

    getOptions() {
        return this.options;
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
        if (!this.optionsContainer) return;

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
                    <input type="checkbox" value="${this.escapeHtml(opt.value)}" ${isChecked ? 'checked' : ''}>
                    <span class="multi-select-option-label">${this.escapeHtml(opt.label)}</span>
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
        if (!this.display) return;

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

    setDisabled(disabled) {
        if (disabled) {
            this.element.classList.add('disabled');
            this.close();
        } else {
            this.element.classList.remove('disabled');
        }
    }

    notifyChange() {
        if (this.onChange) {
            this.onChange(this.getSelectedValues());
        }
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
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
