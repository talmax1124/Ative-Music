/**
 * Component Library - Main entry point for all UI components
 * 
 * This file loads and registers all components for use throughout the application.
 * Components use Tailwind CSS for styling and provide a consistent, maintainable UI.
 */

// Load component manager and base classes
// Note: In a real-world scenario, you'd use proper ES6 modules or a bundler
// For now, components are loaded via script tags in the HTML

/**
 * Component Registry
 * All available components for the music application
 */
const COMPONENT_REGISTRY = {
  // Layout Components
  'Header': {
    description: 'Main application header with navigation',
    props: ['user', 'connectionStatus'],
    example: 'componentManager.render("Header", container, { user: userData })'
  },

  // Music Components
  'PlaylistCard': {
    description: 'Individual playlist card with actions',
    props: ['id', 'name', 'tracks', 'description', 'onPlay', 'onQueue', 'onDelete'],
    example: 'componentManager.render("PlaylistCard", container, { id: "123", name: "My Playlist" })'
  },

  'ImportForm': {
    description: 'Playlist import form for external URLs',
    props: ['onImport', 'placeholder', 'examples'],
    example: 'componentManager.render("ImportForm", container, { onImport: handleImport })'
  },

  // UI Components (Future)
  'Button': {
    description: 'Reusable button component',
    props: ['variant', 'size', 'disabled', 'onClick'],
    example: 'componentManager.render("Button", container, { variant: "primary" })'
  },

  'Modal': {
    description: 'Modal dialog component',
    props: ['title', 'isOpen', 'onClose'],
    example: 'componentManager.render("Modal", container, { title: "Confirm Action" })'
  },

  'Notification': {
    description: 'Toast notification component',
    props: ['type', 'message', 'duration'],
    example: 'componentManager.render("Notification", container, { type: "success" })'
  }
};

/**
 * Component Usage Examples
 */
const USAGE_EXAMPLES = {
  // Playlist Management
  renderPlaylistCards: \`
    // Render multiple playlist cards
    userPlaylists.forEach(playlist => {
      const { instance } = componentManager.render('PlaylistCard', container, {
        id: playlist.id,
        name: playlist.name,
        tracks: playlist.tracks,
        description: playlist.description,
        onPlay: (id) => playUserPlaylist(id),
        onQueue: (id) => queueUserPlaylist(id),
        onDelete: (id, name) => deleteUserPlaylist(id, name)
      });
    });
  \`,

  renderImportForm: \`
    // Render import form
    const { instance } = componentManager.render('ImportForm', container, {
      onImport: async (url) => {
        try {
          await importPlaylist(url);
          showNotification('Playlist imported successfully!', 'success');
        } catch (error) {
          showNotification('Failed to import playlist', 'error');
        }
      }
    });
  \`,

  // Dynamic updates
  updatePlaylistCard: \`
    // Update playlist data
    playlistCardInstance.updateData({
      name: 'Updated Playlist Name',
      tracks: newTracks
    });
  \`,

  handleLoading: \`
    // Show loading state
    playlistCardInstance.setLoading(true);
    
    // Hide loading after operation
    setTimeout(() => {
      playlistCardInstance.setLoading(false);
    }, 2000);
  \`
};

/**
 * Utility Functions for Component Management
 */
const ComponentUtils = {
  /**
   * Render playlist cards for a list of playlists
   * @param {HTMLElement} container - Container element
   * @param {Array} playlists - Array of playlist objects
   * @param {Object} handlers - Event handlers { onPlay, onQueue, onDelete }
   * @returns {Array} Array of component instances
   */
  renderPlaylistCards(container, playlists, handlers) {
    const instances = [];
    
    playlists.forEach(playlist => {
      const { instance, instanceId } = componentManager.render('PlaylistCard', container, {
        id: playlist.id,
        name: playlist.name,
        tracks: playlist.tracks,
        description: playlist.description,
        ...handlers
      });
      
      instances.push({ instance, instanceId, playlistId: playlist.id });
    });
    
    return instances;
  },

  /**
   * Update a specific playlist card
   * @param {Array} instances - Array of component instances
   * @param {string} playlistId - ID of playlist to update
   * @param {Object} newData - New playlist data
   */
  updatePlaylistCard(instances, playlistId, newData) {
    const target = instances.find(inst => inst.playlistId === playlistId);
    if (target) {
      target.instance.updateData(newData);
    }
  },

  /**
   * Remove a playlist card
   * @param {Array} instances - Array of component instances
   * @param {string} playlistId - ID of playlist to remove
   */
  removePlaylistCard(instances, playlistId) {
    const index = instances.findIndex(inst => inst.playlistId === playlistId);
    if (index !== -1) {
      const { instanceId } = instances[index];
      componentManager.destroy(instanceId);
      instances.splice(index, 1);
    }
  },

  /**
   * Clear all playlist cards
   * @param {Array} instances - Array of component instances
   */
  clearPlaylistCards(instances) {
    instances.forEach(({ instanceId }) => {
      componentManager.destroy(instanceId);
    });
    instances.length = 0;
  }
};

/**
 * Theme Utilities for Tailwind CSS
 */
const ThemeUtils = {
  // Color variants for different component states
  colors: {
    primary: 'blue',
    success: 'green', 
    warning: 'yellow',
    danger: 'red',
    surface: 'slate'
  },

  /**
   * Get Tailwind classes for button variants
   * @param {string} variant - Button variant (primary, secondary, danger)
   * @param {string} size - Button size (sm, md, lg)
   * @returns {string} Tailwind CSS classes
   */
  getButtonClasses(variant = 'primary', size = 'md') {
    const baseClasses = 'inline-flex items-center justify-center font-medium rounded-lg transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-surface-900';
    
    const variantClasses = {
      primary: 'bg-blue-600 hover:bg-blue-700 text-white focus:ring-blue-500',
      secondary: 'bg-surface-700 hover:bg-surface-600 text-slate-200 border border-surface-600 focus:ring-surface-500',
      danger: 'bg-red-600 hover:bg-red-700 text-white focus:ring-red-500'
    };
    
    const sizeClasses = {
      sm: 'px-3 py-1.5 text-sm',
      md: 'px-4 py-2',
      lg: 'px-6 py-3 text-lg'
    };
    
    return \`\${baseClasses} \${variantClasses[variant]} \${sizeClasses[size]}\`;
  },

  /**
   * Get Tailwind classes for input components
   * @param {boolean} hasError - Whether input has error state
   * @returns {string} Tailwind CSS classes
   */
  getInputClasses(hasError = false) {
    const baseClasses = 'w-full px-4 py-3 bg-surface-800 border rounded-lg text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 transition-all duration-200';
    const errorClasses = hasError 
      ? 'border-red-500 focus:ring-red-500 focus:border-transparent'
      : 'border-surface-600 focus:ring-blue-500 focus:border-transparent';
    
    return \`\${baseClasses} \${errorClasses}\`;
  }
};

/**
 * Animation utilities for enhanced UX
 */
const AnimationUtils = {
  /**
   * Animate element entrance
   * @param {HTMLElement} element - Element to animate
   * @param {string} animation - Animation type (fadeIn, slideUp, scaleIn)
   */
  animateIn(element, animation = 'fadeIn') {
    const animations = {
      fadeIn: 'animate-fade-in',
      slideUp: 'animate-slide-up', 
      scaleIn: 'animate-scale-in'
    };
    
    element.classList.add(animations[animation]);
  },

  /**
   * Animate element exit
   * @param {HTMLElement} element - Element to animate
   * @param {Function} callback - Callback after animation
   */
  animateOut(element, callback) {
    element.classList.add('transition-all', 'duration-300', 'opacity-0', 'scale-95');
    
    setTimeout(() => {
      if (callback) callback();
    }, 300);
  }
};

// Export utilities for global use
if (typeof window !== 'undefined') {
  window.ComponentUtils = ComponentUtils;
  window.ThemeUtils = ThemeUtils;
  window.AnimationUtils = AnimationUtils;
  window.COMPONENT_REGISTRY = COMPONENT_REGISTRY;
  window.USAGE_EXAMPLES = USAGE_EXAMPLES;
}

// Console helper for development
if (typeof console !== 'undefined') {
  console.log('🎵 Ative Music Component Library Loaded');
  console.log('📚 Available components:', Object.keys(COMPONENT_REGISTRY));
  console.log('🛠️ Use USAGE_EXAMPLES for implementation help');
  console.log('🎨 Use ThemeUtils for consistent styling');
}