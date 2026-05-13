/**
 * 
 * Table Renderer - Data Tables with Pagination
 * 
 *
 * Renders zTable events from zCLI backend (AdvancedData subsystem).
 * Supports semantic HTML tables with zTheme styling, pagination metadata,
 * and both array and object row formats.
 *
 * @module rendering/table_renderer
 * @layer 3
 * @pattern Strategy (single event type)
 *
 * Philosophy:
 * - "Terminal first" - tables are fundamental data display primitives
 * - Pure rendering (no client-side pagination/sorting - that's backend's job)
 * - Semantic HTML (table/thead/tbody/tr/th/td tags)
 * - Backend sends already-paginated data (we just render it)
 * - Uses Layer 2 utilities exclusively (no inline logic)
 *
 * Dependencies:
 * - Layer 0: bifrost_constants.js
 * - Layer 2: dom_utils.js
 *
 * Exports:
 * - TableRenderer: Class for rendering zTable events
 *
 * Example:
 * ```javascript
 * import { TableRenderer } from './table_renderer.js';
 *
 * const renderer = new TableRenderer(logger);
 * renderer.render({
 *   title: 'Users',
 *   columns: ['id', 'name', 'email'],
 *   rows: [
 *     [1, 'Alice', 'alice@example.com'],
 *     [2, 'Bob', 'bob@example.com']
 *   ]
 * }, 'zVaF');
 * ```
 */

// ─────────────────────────────────────────────────────────────────
// Imports
// ─────────────────────────────────────────────────────────────────

// Layer 2: Utilities
import { TYPOGRAPHY } from '../../../L1_Foundation/constants/bifrost_constants.js';
import { createElement, setAttributes } from '../../../zSys/dom/dom_utils.js';
import { withErrorBoundary } from '../../../zSys/validation/error_boundary.js';

// Layer 0: Primitives
import {
  createTable,
  createThead,
  createTbody,
  createTr,
  createTh,
  createTd
} from '../primitives/table_primitives.js';
import { createDiv, createSpan } from '../primitives/generic_containers.js';
import { createButton } from '../primitives/interactive_primitives.js';
import { createInput } from '../primitives/form_primitives.js';
import { getBackgroundClass, getTextColorClass } from '../../../zSys/theme/color_utils.js';
import { getPaddingClass, getMarginClass, getGapClass } from '../../../zSys/theme/spacing_utils.js';
import { TextRenderer } from '../outputs/text_renderer.js';

// 
// Table Renderer Class
// 

/**
 * TableRenderer - Renders data tables with pagination metadata
 *
 * Handles the 'zTable' zDisplay event from AdvancedData subsystem.
 * Creates semantic HTML tables (table/thead/tbody) with zTheme styling.
 *
 * Backend sends already-paginated data, so this renderer just displays it.
 * No client-side pagination/sorting logic (that's backend's responsibility).
 */
export class TableRenderer {
  /**
   * Create a TableRenderer instance
   * @param {Object} logger - Logger instance for debugging
   */
  constructor(logger) {
    this.logger = logger || console;
    this.logger.debug('[TableRenderer] Initialized');

    // Initialize TextRenderer for markdown parsing in cells (DRY - reuse zMD logic)
    this.textRenderer = new TextRenderer(this.logger);

    // Wrap render method with error boundary
    const originalRender = this.render.bind(this);
    this.render = withErrorBoundary(originalRender, {
      component: 'TableRenderer',
      logger: this.logger
    });
  }

  /**
   * Render a zTable event
   *
   * @param {Object} data - Table event data
   * @param {string} data.title - Table title (optional)
   * @param {Array<string>} data.columns - Column names
   * @param {Array<Array|Object>} data.rows - Table rows (arrays or objects)
   * @param {number} [data.limit] - Pagination limit (metadata only, rows already sliced)
   * @param {number} [data.offset=0] - Pagination offset (metadata only)
   * @param {boolean} [data.show_header=true] - Whether to show column headers
   * @param {number} [data.indent=0] - Indentation level
   * @param {string} [data.class] - Custom CSS class (optional)
   * @param {string} zone - Target DOM element ID
   * @returns {HTMLElement|null} Created table container or null if failed
   *
   * @example
   * // Array rows
   * renderer.render({
   *   title: 'Users',
   *   columns: ['id', 'name'],
   *   rows: [[1, 'Alice'], [2, 'Bob']]
   * }, 'zVaF');
   *
   * @example
   * // Object rows (typical from SQL queries)
   * renderer.render({
   *   title: 'Users (showing 1-10 of 127)',
   *   columns: ['id', 'username', 'email'],
   *   rows: [
   *     {id: 1, username: 'alice', email: 'alice@example.com'},
   *     {id: 2, username: 'bob', email: 'bob@example.com'}
   *   ],
   *   limit: 10,
   *   offset: 0
   * }, 'zVaF');
   */
  render(data, zone) {
    const {
      title,
      caption,
      columns = [],
      rows: allRows = [],  // Backend sends ALL rows (we slice them)
      limit,
      offset = 0,
      show_header = true,
      zPages = false,       // Enable navigation controls (First/Prev/Next/Last)
      indent = 0,
      class: classAttr,
      _zClass,           // Support both 'class' and '_zClass' from .zolo files
      _zColumn,          // Column-level classes: { colName: 'class1 class2' }
      _zRows,            // Row-pattern classes: { odd, even, first, last }
      _tableInstanceId,  // Unique DOM target ID for in-place navigation replacement
    } = data;
    
    // Use _zClass if provided, fallback to class attribute
    const customClass = _zClass || classAttr;

    // Get target container (optional for orchestrator pattern)
    let container = null;
    if (zone) {
      container = document.getElementById(zone);
      if (!container) {
        this.logger.error(`[TableRenderer] [ERROR] Zone not found: ${zone}`);
        // Continue anyway - return element for orchestrator to append
      }
    }

    // Validate columns
    if (columns.length === 0) {
      this.logger.warn('[TableRenderer] [WARN] No columns provided');
      // Still render empty table (semantic HTML)
    }

    // 
    // CLIENT-SIDE PAGINATION: Slice rows based on limit/offset
    // 
    let rows = allRows;
    let hasMore = false;
    let moreCount = 0;

    if (limit !== null && limit !== undefined && limit > 0) {
      // Slice rows: from offset to offset+limit
      rows = allRows.slice(offset, offset + limit);
      hasMore = (offset + limit) < allRows.length;
      moreCount = allRows.length - (offset + limit);
    }

    // Create outer container for title + table + footer
    const wrapper = createElement('div', ['zTable-container']);

    // Mark interactive tables with a unique instance ID so navigation re-renders replace in-place.
    // _tableInstanceId is preferred (survives navigation round-trips); generate one on first render.
    const instanceId = _tableInstanceId || `${title || 'table'}_${Math.random().toString(36).substr(2, 9)}`;
    if (zPages && limit && limit > 0) {
      wrapper.setAttribute('data-table-id', instanceId);
      wrapper.setAttribute('data-interactive', 'true');
    }

    // Apply indent to wrapper (if specified)
    const wrapperAttributes = {};
    if (indent > 0) {
      wrapperAttributes.style = `margin-left: ${indent}rem;`;
    }
    if (Object.keys(wrapperAttributes).length > 0) {
      setAttributes(wrapper, wrapperAttributes);
    }

    // Render title with pagination info (if provided)
    if (title) {
      const titleElement = this._renderTitle(title, rows.length, allRows.length, limit, offset);
      wrapper.appendChild(titleElement);
    }

    // Create responsive table wrapper (zTheme class)
    const tableWrapper = createElement('div', ['zTable-responsive']);

    // Build table classes - NO automatic zTable injection (2026-01-28)
    // User must explicitly declare _zClass: zTable if they want zTheme styling
    // This keeps the table as pure semantic HTML by default
    const tableClasses = [];
    if (customClass) {
      tableClasses.push(customClass);
    }

    // Create table element (using Layer 0 primitive)
    const table = createTable({ class: tableClasses.length > 0 ? tableClasses.join(' ') : undefined });

    // Render caption (if provided) - must come before thead per HTML spec
    if (caption) {
      const captionElement = document.createElement('caption');
      captionElement.className = 'zMuted';
      captionElement.style.padding = '0.5rem';
      captionElement.style.textAlign = 'left';
      captionElement.textContent = caption;
      table.appendChild(captionElement);
    }

    // Render table head (if show_header is true)
    if (show_header && columns.length > 0) {
      const thead = this._renderTableHead(columns, _zColumn);
      table.appendChild(thead);
    }

    // Render table body
    if (rows.length > 0) {
      const tbody = this._renderTableBody(columns, rows, _zColumn, _zRows, offset, allRows.length);
      table.appendChild(tbody);
    } else {
      // Empty table body (semantic HTML)
      const tbody = createTbody();
      table.appendChild(tbody);
      this.logger.warn('[TableRenderer] [WARN] No rows to display');
    }

    // Append table to wrapper
    tableWrapper.appendChild(table);
    wrapper.appendChild(tableWrapper);

    // 
    // PAGINATION FOOTER: Interactive navigation OR simple "... N more rows"
    // 
    if (zPages && limit && limit > 0) {
      // Interactive mode: Render navigation buttons (First/Prev/Next/Last/Jump)
      this._renderNavigationControls(wrapper, {
        title,
        _tableInstanceId: instanceId,
        columns,
        rows: allRows,
        limit,
        offset,
        totalRows: allRows.length,
        zPages: true,
        _zClass,
        _zColumn,
        _zRows,
      });
    } else if (hasMore && moreCount > 0) {
      // Simple truncation: Show "... N more rows" footer
      const footer = this._renderMoreRowsFooter(moreCount);
      wrapper.appendChild(footer);
    }

    // Append wrapper to container (if zone was provided - legacy behavior)
    // If no zone, just return element (orchestrator pattern)
    if (container) {
      container.appendChild(wrapper);
    }

    // Log success
    const paginationInfo = limit ? ` (showing ${rows.length} of ${allRows.length} total)` : '';
    this.logger.log(`[TableRenderer] Rendered table (${columns.length} cols, ${rows.length} rows${paginationInfo}, indent: ${indent})`);

    return wrapper;
  }

  /**
   * Render table title with optional pagination info
   * @private
   * @param {string} title - Table title
   * @param {number} displayedRowCount - Number of rows actually displayed (after pagination)
   * @param {number} totalRowCount - Total number of rows (before pagination)
   * @param {number} limit - Pagination limit
   * @param {number} offset - Pagination offset
   * @returns {HTMLElement} Title element (h4)
   */
  _renderTitle(title, displayedRowCount, totalRowCount, limit, offset) {
    const titleElement = createElement('h4');

    // Show pagination range in title if limited
    if (limit !== null && limit !== undefined && limit > 0 && totalRowCount > 0) {
      const showingStart = offset + 1;
      const showingEnd = Math.min(offset + displayedRowCount, totalRowCount);
      const decodedTitle = this._decodeUnicodeEscapes(title);
      titleElement.textContent = `${decodedTitle} (showing ${showingStart}-${showingEnd} of ${totalRowCount})`;
    } else {
      titleElement.textContent = this._decodeUnicodeEscapes(title);
    }

    // Apply zTheme styling
    setAttributes(titleElement, {
      class: 'zMb-3 zText-dark',
      style: `font-weight: ${TYPOGRAPHY.FONT_WEIGHTS.MEDIUM};`
    });

    return titleElement;
  }

  /**
   * Render table head (column headers)
   * @private
   * @param {Array<string>} columns - Column names
   * @returns {HTMLElement} thead element
   */
  _renderTableHead(columns, _zColumn) {
    const thead = createThead();
    const headerRow = createTr();

    columns.forEach(column => {
      const th = createTh();
      // Decode Unicode escapes in column names
      th.textContent = this._decodeUnicodeEscapes(column); // XSS safe
      const colClass = _zColumn?.[column];
      if (colClass) th.className = colClass;
      headerRow.appendChild(th);
    });

    thead.appendChild(headerRow);
    return thead;
  }

  /**
   * Render table body (data rows)
   * @private
   * @param {Array<string>} columns - Column names (for object row mapping)
   * @param {Array<Array|Object>} rows - Table rows
   * @returns {HTMLElement} tbody element
   */
  _renderTableBody(columns, rows, _zColumn, _zRows, offset = 0, totalRows = null) {
    const tbody = createTbody();
    const cellTracker = [];
    const datasetLastIndex = totalRows !== null ? totalRows - 1 : null;

    rows.forEach((row, rowIndex) => {
      const tr = createTr();

      // Apply _zRows pattern classes to <tr>
      // first/last are dataset-absolute (not page-relative), odd/even use absolute index for
      // consistent alternation across page boundaries.
      if (_zRows) {
        const trClasses = [];
        const absoluteIndex = offset + rowIndex;
        const isFirst = absoluteIndex === 0;
        const isLast  = datasetLastIndex !== null ? absoluteIndex === datasetLastIndex : false;
        if (_zRows.first && isFirst) trClasses.push(_zRows.first);
        if (_zRows.last  && isLast)  trClasses.push(_zRows.last);
        if (!isFirst && !isLast) {
          if (_zRows.odd  && absoluteIndex % 2 === 0) trClasses.push(_zRows.odd);
          if (_zRows.even && absoluteIndex % 2 === 1) trClasses.push(_zRows.even);
        }
        if (trClasses.length > 0) tr.className = trClasses.join(' ');
      }

      // Handle both array and object rows (zData sends objects from SQL queries)
      if (Array.isArray(row)) {
        // Array row: [val1, val2, val3]
        row.forEach((value, colIndex) => {
          const colClass = _zColumn?.[columns[colIndex]] || null;
          const cellContent = this._formatCellValue(value);
          
          if (cellContent === '^^' && rowIndex > 0 && cellTracker[rowIndex - 1]?.[colIndex]) {
            const prevCell = cellTracker[rowIndex - 1][colIndex];
            const currentRowspan = parseInt(prevCell.getAttribute('rowspan') || '1');
            prevCell.setAttribute('rowspan', currentRowspan + 1);
            cellTracker[rowIndex] = cellTracker[rowIndex] || [];
            cellTracker[rowIndex][colIndex] = prevCell;
          } else {
            const td = createTd();
            if (colClass) td.className = colClass;
            td.innerHTML = this._parseCellMarkdown(cellContent);
            tr.appendChild(td);
            cellTracker[rowIndex] = cellTracker[rowIndex] || [];
            cellTracker[rowIndex][colIndex] = td;
          }
        });
      } else {
        // Object row: {col1: val1, col2: val2, ...}
        // Supports cell descriptor: {col: {val: value, _zClass: 'className'}}
        columns.forEach((column, colIndex) => {
          const raw = row[column];

          // Cell descriptor: { val: ..., _zClass: '...' } — object rows only
          const isCellDescriptor = raw !== null
            && typeof raw === 'object'
            && !Array.isArray(raw)
            && 'val' in raw;

          const cellValue = isCellDescriptor ? raw.val : raw;
          const cellClass = isCellDescriptor ? (raw._zClass || null) : null;

          // Cell overrides column — more specific wins entirely
          const colClass = _zColumn?.[column] || null;
          const combinedClass = cellClass || colClass || null;

          const cellContent = this._formatCellValue(cellValue);
          
          if (cellContent === '^^' && rowIndex > 0 && cellTracker[rowIndex - 1]?.[colIndex]) {
            const prevCell = cellTracker[rowIndex - 1][colIndex];
            const currentRowspan = parseInt(prevCell.getAttribute('rowspan') || '1');
            prevCell.setAttribute('rowspan', currentRowspan + 1);
            cellTracker[rowIndex] = cellTracker[rowIndex] || [];
            cellTracker[rowIndex][colIndex] = prevCell;
          } else {
            const td = createTd();
            if (combinedClass) td.className = combinedClass;
            td.innerHTML = this._parseCellMarkdown(cellContent);
            tr.appendChild(td);
            cellTracker[rowIndex] = cellTracker[rowIndex] || [];
            cellTracker[rowIndex][colIndex] = td;
          }
        });
      }

      tbody.appendChild(tr);
    });

    return tbody;
  }

  /**
   * Render "... N more rows" footer (shown when table is truncated)
   * @private
   * @param {number} moreCount - Number of additional rows not displayed
   * @returns {HTMLElement} Footer element (p)
   */
  _renderMoreRowsFooter(moreCount) {
    const footer = createElement('p', ['zText-info', 'zMt-2', 'zMs-3']);
    footer.style.fontStyle = 'italic';
    footer.style.fontSize = '0.875rem';
    footer.textContent = `... ${moreCount} more rows`;

    return footer;
  }

  /**
   * Render interactive navigation controls for paginated tables
   * Creates First/Previous/Next/Last buttons + Jump to page input
   * Buttons send 'table_navigate' events back to server (Terminal first!)
   *
   *  STYLIZED COMPOSITION: Using Layer 0 primitives + Layer 2 utilities
   *
   * @private
   * @param {HTMLElement} container - Container to append controls to
   * @param {Object} tableState - Table state (limit, offset, totalRows, etc.)
   */
  _renderNavigationControls(container, tableState) {
    const { limit, offset, totalRows } = tableState;

    // Calculate pagination metadata
    const totalPages = Math.ceil(totalRows / limit);
    const currentPage = Math.floor(offset / limit) + 1;
    const canGoPrev = currentPage > 1;
    const canGoNext = currentPage < totalPages;

    // 
    // MODERN 2-ROW PAGINATION NAVIGATION (Primitives + Utilities)
    // Row 1: Page Info (centered, full width)
    // Row 2: Navigation Buttons (flexed, centered)
    // 

    // Full-width wrapper (primitive + utilities)
    const navWrapper = createDiv();
    navWrapper.classList.add(
      getMarginClass('top', 3),
      getPaddingClass('all', 3),
      getBackgroundClass('white'),
      'zBorder',
      'zRounded',
      'zShadow-sm'
    );

    // ROW 1: Page Info Container (centered with proper zTheme classes)
    const pageInfoRow = createDiv();
    pageInfoRow.classList.add(
      'zD-flex',
      'zFlex-center',           // Correct zTheme centering class
      'zFlex-items-center',     // Vertical alignment
      getMarginClass('bottom', 3)
    );

    // Page info text (primitive + utilities)
    const pageInfo = createSpan();
    pageInfo.classList.add(getTextColorClass('muted'));
    pageInfo.style.fontSize = '0.875rem';
    pageInfo.style.fontWeight = TYPOGRAPHY.FONT_WEIGHTS.MEDIUM;
    pageInfo.innerHTML = `<span class="zText-dark">Page ${currentPage}</span> of <span class="zText-dark">${totalPages}</span> <span class="zText-muted">(${totalRows} total rows)</span>`;

    pageInfoRow.appendChild(pageInfo);
    navWrapper.appendChild(pageInfoRow);

    // ROW 2: Navigation Controls Container (centered with proper zTheme classes)
    const navControlsRow = createDiv();
    navControlsRow.classList.add(
      'zD-flex',
      'zFlex-center',           // Correct zTheme centering class
      'zFlex-items-center',     // Vertical alignment
      'zFlex-wrap',             // Wrap on small screens
      getGapClass(3)
    );

    // 
    // NAVIGATION BUTTONS (primitives + utilities)
    // 
    const buttonGroup = createDiv();
    buttonGroup.classList.add('zBtn-group', 'zBtn-group-sm');

    // Helper to create navigation button (using primitives!)
    const createNavButton = (label, command, enabled) => {
      const btn = createButton('button');
      btn.classList.add('zBtn', 'zBtn-sm');

      if (enabled) {
        btn.classList.add('zBtn-outline-primary');
        btn.onclick = () => {
          this.logger.log(`[TableRenderer]  Navigation: ${command}`);
          this._handleTableNavigation(command, tableState);
        };
      } else {
        btn.classList.add('zBtn-outline-secondary');
        btn.disabled = true;
      }

      btn.innerHTML = label; // Support icons
      return btn;
    };

    // Navigation buttons (First/Previous/Next/Last) - Using Bootstrap Icons
    buttonGroup.appendChild(createNavButton('<i class="bi bi-skip-start-fill"></i> First', 'f', canGoPrev));
    buttonGroup.appendChild(createNavButton('<i class="bi bi-chevron-left"></i> Prev', 'p', canGoPrev));
    buttonGroup.appendChild(createNavButton('Next <i class="bi bi-chevron-right"></i>', 'n', canGoNext));
    buttonGroup.appendChild(createNavButton('Last <i class="bi bi-skip-end-fill"></i>', 'l', canGoNext));

    navControlsRow.appendChild(buttonGroup);

    // 
    // JUMP TO PAGE (primitives + utilities)
    // 
    const jumpContainer = createDiv();
    jumpContainer.classList.add(
      'zD-flex',
      'zAlign-items-center',
      getGapClass(2)
    );

    const jumpLabel = createSpan();
    jumpLabel.classList.add(getTextColorClass('muted'));
    jumpLabel.textContent = 'Jump to:';
    jumpContainer.appendChild(jumpLabel);

    const jumpInput = createInput('number');
    jumpInput.classList.add('zInput', 'zInput-sm');
    jumpInput.setAttribute('min', '1');
    jumpInput.setAttribute('max', totalPages.toString());
    jumpInput.setAttribute('placeholder', '#');
    jumpInput.style.width = '60px';
    jumpInput.style.textAlign = 'center';

    const jumpBtn = createButton('button');
    jumpBtn.classList.add('zBtn', 'zBtn-sm', 'zBtn-primary');
    jumpBtn.textContent = 'Go';
    jumpBtn.onclick = () => {
      const pageNum = parseInt(jumpInput.value);
      if (pageNum >= 1 && pageNum <= totalPages) {
        this.logger.log(`[TableRenderer]  Jumping to page: ${pageNum}`);
        this._handleTableNavigation(pageNum.toString(), tableState);
        jumpInput.value = '';
      } else {
        this.logger.warn(`[TableRenderer] [WARN] Invalid page number: ${pageNum} (must be 1-${totalPages})`);
      }
    };

    // Enter key on jump input
    jumpInput.onkeypress = (e) => {
      if (e.key === 'Enter') {
        jumpBtn.click();
      }
    };

    jumpContainer.appendChild(jumpInput);
    jumpContainer.appendChild(jumpBtn);
    navControlsRow.appendChild(jumpContainer);

    // Append row 2 to wrapper
    navWrapper.appendChild(navControlsRow);

    // Append complete navigation to container
    container.appendChild(navWrapper);
  }

  /**
   * Handle table navigation (send command to server)
   * In "Terminal first" philosophy, navigation updates happen server-side
   * @private
   * @param {string} command - Navigation command (first/prev/next/last/jump:N)
   * @param {Object} tableState - Table state
   */
  _handleTableNavigation(command, tableState) {
    this.logger.log(`[TableRenderer] Navigation: ${command}`);
    if (this.client && this.client.connection) {
      // Fire-and-forget via raw WebSocket — no _requestId, no timeout
      this.client.connection.send(JSON.stringify({
        event: 'table_navigate',
        data: { command, ...tableState }
      }));
    } else {
      this.logger.warn('[TableRenderer] No client reference — cannot send table_navigate');
    }
  }

  /**
   * Format cell value for display
   * Handles null, undefined, objects, arrays, dates, numbers, strings
   * @private
   * @param {*} value - Cell value
   * @returns {string} Formatted value
   */
  _formatCellValue(value) {
    // Handle null/undefined
    if (value === null || value === undefined) {
      return '—'; // Em dash for empty values
    }

    // Handle dates (ISO strings or Date objects)
    if (value instanceof Date) {
      return value.toLocaleDateString();
    }

    // Handle date-like strings (ISO 8601 format)
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
      try {
        const date = new Date(value);
        if (!isNaN(date.getTime())) {
          return date.toLocaleDateString();
        }
      } catch (e) {
        // Fall through to default string handling
      }
    }

    // Handle numbers
    if (typeof value === 'number') {
      // Format large numbers with commas
      if (Math.abs(value) >= 1000) {
        return value.toLocaleString();
      }
      return value.toString();
    }

    // Handle booleans
    if (typeof value === 'boolean') {
      return value ? '[ok]' : '';
    }

    // Handle objects/arrays (JSON stringify with truncation)
    if (typeof value === 'object') {
      const json = JSON.stringify(value);
      if (json.length > 50) {
        return `${json.substring(0, 47)  }...`;
      }
      return json;
    }

    // Handle strings (decode Unicode escapes)
    const str = String(value);
    
    // Decode Unicode escapes (\UXXXX or U+XXXX format)
    const decoded = this._decodeUnicodeEscapes(str);
    
    // No truncation - let CSS handle overflow with text wrapping or ellipsis
    // This ensures markdown links and formatted text aren't broken mid-parse
    return decoded;
  }

  /**
   * Decode Unicode escape sequences to actual characters
   * Supports: \uXXXX (standard) and \UXXXXXXXX (extended) formats
   * 
   * Note: Basic escape sequences (\n, \t, etc.) are handled by JSON.parse()
   * automatically when receiving data from backend. We only need to decode
   * custom Unicode formats that JSON doesn't handle.
   * 
   * @param {string} text - Text containing Unicode escapes
   * @returns {string} - Decoded text
   * @private
   */
  _decodeUnicodeEscapes(text) {
    if (!text || typeof text !== 'string') return text;
    
    // Replace \uXXXX format (standard 4-digit Unicode escape)
    text = text.replace(/\\u([0-9A-Fa-f]{4})/g, (match, hexCode) => {
      return String.fromCodePoint(parseInt(hexCode, 16));
    });
    
    // Replace \UXXXXXXXX format (extended 4-8 digit for supplementary characters & emojis)
    text = text.replace(/\\U([0-9A-Fa-f]{4,8})/g, (match, hexCode) => {
      return String.fromCodePoint(parseInt(hexCode, 16));
    });
    
    return text;
  }

  /**
   * Parse markdown and HTML in table cells
   * Reuses TextRenderer._parseMarkdown() logic (DRY - same as zMD)
   * 
   * Supports:
   * - `code` -> <code>code</code>
   * - **bold** -> <strong>bold</strong>
   * - *italic* -> <em>italic</em>
   * - HTML tags pass through (e.g., <h1>text</h1>)
   * 
   * @param {string} text - Cell content with potential markdown or HTML
   * @returns {string} - HTML string with markdown parsed and HTML preserved
   * @private
   */
  _parseCellMarkdown(text) {
    if (!text || typeof text !== 'string') return text;
    
    // Reuse TextRenderer's markdown parser (DRY principle)
    // This handles: `code`, **bold**, *italic*, [links](url), etc.
    return this.textRenderer._parseMarkdown(text);
  }
}

// 
// Default Export
// 
export default TableRenderer;

