/**
 * Component Manager - Handles component registration, rendering, and state management
 */
class ComponentManager {
  constructor() {
    this.components = new Map();
    this.instances = new Map();
    this.eventListeners = new Map();
  }

  /**
   * Register a component class
   * @param {string} name - Component name
   * @param {class} ComponentClass - Component class
   */
  register(name, ComponentClass) {
    this.components.set(name, ComponentClass);
  }

  /**
   * Create and render a component
   * @param {string} name - Component name
   * @param {HTMLElement} container - Container element
   * @param {Object} props - Component props
   * @returns {Object} Component instance
   */
  render(name, container, props = {}) {
    const ComponentClass = this.components.get(name);
    if (!ComponentClass) {
      throw new Error(`Component "${name}" not found`);
    }

    const instance = new ComponentClass(props);
    const instanceId = this.generateId();
    
    this.instances.set(instanceId, instance);
    
    // Render component
    const html = instance.render();
    container.innerHTML = html;
    
    // Apply Tailwind classes if needed
    this.applyTailwindClasses(container, instance.classes || {});
    
    // Setup event listeners
    this.setupEventListeners(container, instance, instanceId);
    
    // Call mounted lifecycle
    if (instance.mounted) {
      instance.mounted();
    }
    
    return { instance, instanceId };
  }

  /**
   * Update component with new props
   * @param {string} instanceId - Instance ID
   * @param {Object} newProps - New props
   */
  update(instanceId, newProps) {
    const instance = this.instances.get(instanceId);
    if (instance) {
      instance.props = { ...instance.props, ...newProps };
      if (instance.updated) {
        instance.updated();
      }
    }
  }

  /**
   * Destroy component instance
   * @param {string} instanceId - Instance ID
   */
  destroy(instanceId) {
    const instance = this.instances.get(instanceId);
    if (instance) {
      // Call beforeDestroy lifecycle
      if (instance.beforeDestroy) {
        instance.beforeDestroy();
      }
      
      // Remove event listeners
      this.removeEventListeners(instanceId);
      
      // Remove instance
      this.instances.delete(instanceId);
    }
  }

  /**
   * Apply Tailwind classes to elements
   * @private
   */
  applyTailwindClasses(container, classes) {
    Object.entries(classes).forEach(([selector, classNames]) => {
      const elements = selector === 'root' 
        ? [container] 
        : container.querySelectorAll(selector);
      
      elements.forEach(el => {
        if (el) {
          el.className = classNames;
        }
      });
    });
  }

  /**
   * Setup event listeners for component
   * @private
   */
  setupEventListeners(container, instance, instanceId) {
    if (!instance.events) return;
    
    const listeners = [];
    
    Object.entries(instance.events).forEach(([eventSelector, handler]) => {
      const [event, selector] = eventSelector.split(' ');
      const elements = selector === 'root' 
        ? [container] 
        : container.querySelectorAll(selector);
      
      elements.forEach(element => {
        const boundHandler = handler.bind(instance);
        element.addEventListener(event, boundHandler);
        listeners.push({ element, event, handler: boundHandler });
      });
    });
    
    this.eventListeners.set(instanceId, listeners);
  }

  /**
   * Remove event listeners for component
   * @private
   */
  removeEventListeners(instanceId) {
    const listeners = this.eventListeners.get(instanceId);
    if (listeners) {
      listeners.forEach(({ element, event, handler }) => {
        element.removeEventListener(event, handler);
      });
      this.eventListeners.delete(instanceId);
    }
  }

  /**
   * Generate unique ID
   * @private
   */
  generateId() {
    return 'comp_' + Math.random().toString(36).substr(2, 9);
  }
}

/**
 * Base Component class
 */
class BaseComponent {
  constructor(props = {}) {
    this.props = props;
  }

  /**
   * Render method - must be implemented by subclasses
   * @returns {string} HTML string
   */
  render() {
    throw new Error('render() method must be implemented');
  }

  /**
   * Lifecycle method - called after component is mounted
   */
  mounted() {}

  /**
   * Lifecycle method - called when component props are updated
   */
  updated() {}

  /**
   * Lifecycle method - called before component is destroyed
   */
  beforeDestroy() {}

  /**
   * Helper method to create HTML with proper escaping
   * @param {string} tag - HTML tag
   * @param {Object} attrs - Attributes
   * @param {string} content - Content
   * @returns {string} HTML string
   */
  html(tag, attrs = {}, content = '') {
    const attrString = Object.entries(attrs)
      .map(([key, value]) => `${key}="${this.escapeHtml(value)}"`)
      .join(' ');
    
    return `<${tag} ${attrString}>${content}</${tag}>`;
  }

  /**
   * Escape HTML to prevent XSS
   * @param {string} text - Text to escape
   * @returns {string} Escaped text
   */
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// Global component manager instance
const componentManager = new ComponentManager();

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ComponentManager, BaseComponent, componentManager };
} else {
  window.ComponentManager = ComponentManager;
  window.BaseComponent = BaseComponent;
  window.componentManager = componentManager;
}