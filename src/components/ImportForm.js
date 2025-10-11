/**
 * ImportForm Component - Playlist import form with Tailwind CSS
 */
class ImportForm extends BaseComponent {
  constructor(props) {
    super(props);
    
    this.props = {
      placeholder: 'Paste Spotify or YouTube playlist URL...',
      onImport: () => {},
      examples: [
        'Spotify: https://open.spotify.com/playlist/...',
        'YouTube: https://youtube.com/playlist?list=...',
        'YouTube Music: https://music.youtube.com/playlist?list=...'
      ],
      ...props
    };
    
    this.state = {
      url: '',
      loading: false,
      error: null
    };
  }

  render() {
    const { placeholder, examples } = this.props;
    const { loading, error } = this.state;

    return `
      <div class="import-form card bg-surface-800 border-surface-700">
        <div class="space-y-4">
          <!-- Header -->
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 bg-gradient-to-br from-primary-500 to-primary-600 rounded-lg flex items-center justify-center">
              <i class="fas fa-download text-white"></i>
            </div>
            <div>
              <h3 class="text-lg font-semibold text-slate-100">Import Playlist</h3>
              <p class="text-sm text-slate-400">Add playlists from Spotify or YouTube</p>
            </div>
          </div>

          <!-- URL Input -->
          <div class="space-y-2">
            <label for="playlist-url-input" class="block text-sm font-medium text-slate-300">
              Playlist URL
            </label>
            <div class="input-group relative">
              <div class="input-icon">
                <i class="fas fa-link text-slate-400"></i>
              </div>
              <input 
                type="text" 
                id="playlist-url-input"
                class="playlist-url-input input input-with-icon pr-32 ${error ? 'border-red-500 focus:ring-red-500' : ''}" 
                placeholder="${placeholder}"
                value="${this.state.url}"
                ${loading ? 'disabled' : ''}
              />
              <button 
                type="button" 
                class="import-btn absolute right-2 top-1/2 -translate-y-1/2 btn-primary btn-sm px-4 py-2 min-w-[100px] ${loading ? 'opacity-50 cursor-not-allowed' : ''}"
                ${loading ? 'disabled' : ''}
              >
                ${loading ? `
                  <i class="fas fa-spinner fa-spin mr-2"></i>
                  <span>Importing...</span>
                ` : `
                  <i class="fas fa-download mr-2"></i>
                  <span>Import</span>
                `}
              </button>
            </div>
            
            <!-- Error Message -->
            ${error ? `
              <div class="error-message flex items-center gap-2 text-red-400 text-sm bg-red-900/20 border border-red-800 rounded-lg px-3 py-2">
                <i class="fas fa-exclamation-triangle"></i>
                <span>${this.escapeHtml(error)}</span>
              </div>
            ` : ''}
          </div>

          <!-- Examples -->
          <div class="examples bg-surface-900/50 rounded-lg p-4 border border-surface-600">
            <h4 class="text-sm font-medium text-slate-300 mb-2 flex items-center gap-2">
              <i class="fas fa-info-circle text-primary-400"></i>
              Supported Formats
            </h4>
            <ul class="space-y-1">
              ${examples.map(example => `
                <li class="text-xs text-slate-500 font-mono">${this.escapeHtml(example)}</li>
              `).join('')}
            </ul>
          </div>

          <!-- Quick Actions -->
          <div class="quick-actions flex flex-wrap gap-2">
            <button type="button" class="clear-btn btn-secondary btn-sm">
              <i class="fas fa-times mr-1"></i>
              Clear
            </button>
            <button type="button" class="paste-btn btn-secondary btn-sm">
              <i class="fas fa-clipboard mr-1"></i>
              Paste
            </button>
          </div>
        </div>
      </div>
    `;
  }

  // Event handlers
  get events() {
    return {
      'click .import-btn': this.handleImport,
      'click .clear-btn': this.handleClear,
      'click .paste-btn': this.handlePaste,
      'input .playlist-url-input': this.handleInputChange,
      'keypress .playlist-url-input': this.handleKeyPress,
    };
  }

  handleImport(event) {
    event.preventDefault();
    
    const url = this.state.url.trim();
    if (!url) {
      this.setError('Please enter a playlist URL');
      return;
    }

    if (!this.isValidUrl(url)) {
      this.setError('Please enter a valid playlist URL');
      return;
    }

    this.setLoading(true);
    this.setError(null);
    
    this.props.onImport(url)
      .then(() => {
        this.setLoading(false);
        this.setState({ url: '' });
        this.updateInput();
      })
      .catch((error) => {
        this.setLoading(false);
        this.setError(error.message || 'Failed to import playlist');
      });
  }

  handleClear(event) {
    event.preventDefault();
    this.setState({ url: '', error: null });
    this.updateInput();
    this.focusInput();
  }

  handlePaste(event) {
    event.preventDefault();
    
    if (navigator.clipboard && navigator.clipboard.readText) {
      navigator.clipboard.readText()
        .then(text => {
          this.setState({ url: text.trim(), error: null });
          this.updateInput();
        })
        .catch(() => {
          this.setError('Unable to access clipboard');
        });
    } else {
      this.setError('Clipboard not supported in this browser');
    }
  }

  handleInputChange(event) {
    this.setState({ 
      url: event.target.value,
      error: null 
    });
  }

  handleKeyPress(event) {
    if (event.key === 'Enter') {
      event.preventDefault();
      this.handleImport(event);
    }
  }

  // State management
  setState(newState) {
    this.state = { ...this.state, ...newState };
  }

  setLoading(loading) {
    this.setState({ loading });
    this.updateLoadingState();
  }

  setError(error) {
    this.setState({ error });
    this.updateErrorState();
  }

  // DOM updates
  updateInput() {
    const input = this.getElement('.playlist-url-input');
    if (input) {
      input.value = this.state.url;
    }
  }

  updateLoadingState() {
    const button = this.getElement('.import-btn');
    const input = this.getElement('.playlist-url-input');
    
    if (button) {
      button.disabled = this.state.loading;
      button.innerHTML = this.state.loading ? `
        <i class="fas fa-spinner fa-spin mr-2"></i>
        <span>Importing...</span>
      ` : `
        <i class="fas fa-download mr-2"></i>
        <span>Import</span>
      `;
    }
    
    if (input) {
      input.disabled = this.state.loading;
    }
  }

  updateErrorState() {
    const container = this.getElement('.input-group');
    const input = this.getElement('.playlist-url-input');
    
    // Remove existing error message
    const existingError = this.getElement('.error-message');
    if (existingError) {
      existingError.remove();
    }
    
    if (this.state.error) {
      // Add error styles to input
      if (input) {
        input.classList.add('border-red-500', 'focus:ring-red-500');
        input.classList.remove('border-surface-600', 'focus:ring-primary-500');
      }
      
      // Add error message
      if (container) {
        const errorDiv = document.createElement('div');
        errorDiv.className = 'error-message flex items-center gap-2 text-red-400 text-sm bg-red-900/20 border border-red-800 rounded-lg px-3 py-2 mt-2';
        errorDiv.innerHTML = `
          <i class="fas fa-exclamation-triangle"></i>
          <span>${this.escapeHtml(this.state.error)}</span>
        `;
        container.parentNode.insertBefore(errorDiv, container.nextSibling);
      }
    } else {
      // Remove error styles
      if (input) {
        input.classList.remove('border-red-500', 'focus:ring-red-500');
        input.classList.add('border-surface-600', 'focus:ring-primary-500');
      }
    }
  }

  // Utility methods
  isValidUrl(url) {
    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname.toLowerCase();
      
      // Check for supported platforms
      const supportedDomains = [
        'spotify.com',
        'open.spotify.com',
        'youtube.com',
        'www.youtube.com',
        'm.youtube.com',
        'music.youtube.com',
        'youtu.be'
      ];
      
      return supportedDomains.some(domain => 
        hostname === domain || hostname.endsWith('.' + domain)
      );
    } catch {
      return false;
    }
  }

  focusInput() {
    const input = this.getElement('.playlist-url-input');
    if (input) {
      input.focus();
    }
  }

  getElement(selector) {
    const form = document.querySelector('.import-form');
    return form ? form.querySelector(selector) : null;
  }

  // Lifecycle methods
  mounted() {
    this.focusInput();
  }
}

// Register component
if (typeof componentManager !== 'undefined') {
  componentManager.register('ImportForm', ImportForm);
}