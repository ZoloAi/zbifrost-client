/**
 * L4_Orchestration/rendering/facade.js
 * 
 * Rendering Facade
 * 
 * Thin delegation layer that ensures orchestrator is loaded and routes
 * rendering requests. Extracted from bifrost_client.js to reduce facade bloat.
 * 
 * All methods are simple delegations to ZDisplayOrchestrator.
 * 
 * Extracted from bifrost_client.js (Phase 5.1)
 */

export class RenderingFacade {
  constructor(client) {
    this.client = client;
  }

  /**
   * Render a complete block of YAML data
   * @param {Object} blockData - Block data to render
   */
  async renderBlock(blockData) {
    await this.client._ensureZDisplayOrchestrator();
    return this.client.zDisplayOrchestrator.renderBlock(blockData);
  }

  /**
   * Progressive chunk rendering (Terminal First philosophy)
   * Appends chunks from backend as they arrive, stops at failed gates
   * @param {Object} message - Chunk message from backend
   */
  async renderChunkProgressive(message) {
    // Clear navigation timeout when first chunk arrives
    if (this.client._navigationTimeout) {
      clearTimeout(this.client._navigationTimeout);
      this.client._navigationTimeout = null;
    }
    
    await this.client._ensureZDisplayOrchestrator();
    return this.client.zDisplayOrchestrator.renderChunkProgressive(message);
  }

  /**
   * Recursively render YAML items (handles nested structures like implicit wizards)
   * @param {Object} data - YAML data to render
   * @param {HTMLElement} parentElement - Parent element to render into
   */
  async renderItems(data, parentElement) {
    await this.client._ensureZDisplayOrchestrator();
    return this.client.zDisplayOrchestrator.renderItems(data, parentElement);
  }

  /**
   * Create container wrapper for a zKey with zTheme responsive classes
   * Supports _zClass metadata for customization
   * @param {string} zKey - The key name
   * @param {Object} metadata - Metadata object (_zClass, _zStyle, _zHTML, zId)
   */
  async createContainer(zKey, metadata) {
    await this.client._ensureZDisplayOrchestrator();
    return this.client.zDisplayOrchestrator.createContainer(zKey, metadata);
  }

  /**
   * Render navbar HTML (returns DOM element, doesn't inject into DOM)
   * @param {Array} items - Navbar items (e.g., ['zVaF', 'zAbout', '^zLogin'])
   * @returns {Promise<HTMLElement>} Navbar DOM element
   */
  async renderMetaNavBarHTML(items) {
    await this.client._ensureZDisplayOrchestrator();
    return this.client.zDisplayOrchestrator.renderMetaNavBarHTML(items);
  }

  /**
   * Render navigation bar from metadata (~zNavBar* in content)
   * @param {Array} items - Navbar items
   * @param {HTMLElement} parentElement - Parent element to render into
   */
  async renderNavBar(items, parentElement) {
    await this.client._ensureZDisplayOrchestrator();
    return this.client.zDisplayOrchestrator.renderNavBar(items, parentElement);
  }

  /**
   * Render a single zDisplay event as DOM element
   * @param {Object} eventData - zDisplay event data
   * @returns {Promise<HTMLElement>} Rendered element
   */
  async renderZDisplayEvent(eventData) {
    await this.client._ensureZDisplayOrchestrator();
    return this.client.zDisplayOrchestrator.renderZDisplayEvent(eventData);
  }
}
