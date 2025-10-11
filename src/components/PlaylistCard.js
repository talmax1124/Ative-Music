/**
 * PlaylistCard Component - A reusable playlist card with Tailwind CSS
 */
class PlaylistCard extends BaseComponent {
  constructor(props) {
    super(props);
    
    // Default props
    this.props = {
      id: '',
      name: 'Untitled Playlist',
      tracks: [],
      description: '',
      icon: 'fa-music',
      onPlay: () => {},
      onQueue: () => {},
      onDelete: () => {},
      ...props
    };
  }

  render() {
    const { id, name, tracks, description, icon } = this.props;
    const trackCount = tracks?.length || 0;
    const trackText = trackCount === 1 ? 'track' : 'tracks';

    return `
      <div class="playlist-card group relative bg-surface-800 border border-surface-700 rounded-xl p-4 transition-all duration-300 hover:border-primary-500 hover:-translate-y-1 hover:shadow-xl" data-playlist-id="${id}">
        <!-- Icon Section -->
        <div class="flex items-center gap-4">
          <div class="playlist-icon flex-shrink-0 w-12 h-12 bg-gradient-to-br from-primary-500 to-primary-600 rounded-xl flex items-center justify-center text-white shadow-lg group-hover:shadow-primary-500/25 transition-all duration-300">
            <i class="fas ${icon} text-lg"></i>
          </div>
          
          <!-- Details Section -->
          <div class="flex-1 min-w-0">
            <h4 class="playlist-name font-semibold text-slate-100 text-base leading-tight truncate mb-1" title="${this.escapeHtml(name)}">
              ${this.escapeHtml(name)}
            </h4>
            <p class="playlist-track-count text-sm text-slate-400 truncate">
              ${trackCount} ${trackText}
            </p>
            ${description ? `
              <p class="playlist-description text-xs text-slate-500 truncate mt-1" title="${this.escapeHtml(description)}">
                ${this.escapeHtml(description)}
              </p>
            ` : ''}
          </div>
          
          <!-- Actions Section -->
          <div class="playlist-actions flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
            <button class="action-play btn-icon btn-secondary bg-surface-700 hover:bg-primary-600 hover:text-white border-surface-600 hover:border-primary-500 text-slate-300" 
                    title="Play playlist" 
                    aria-label="Play ${this.escapeHtml(name)}">
              <i class="fas fa-play text-sm"></i>
            </button>
            <button class="action-queue btn-icon btn-secondary bg-surface-700 hover:bg-green-600 hover:text-white border-surface-600 hover:border-green-500 text-slate-300" 
                    title="Add to queue" 
                    aria-label="Add ${this.escapeHtml(name)} to queue">
              <i class="fas fa-plus text-sm"></i>
            </button>
            <button class="action-delete btn-icon btn-danger bg-surface-700 hover:bg-red-600 border-surface-600 hover:border-red-500 text-slate-300" 
                    title="Delete playlist" 
                    aria-label="Delete ${this.escapeHtml(name)}">
              <i class="fas fa-trash text-sm"></i>
            </button>
          </div>
        </div>
        
        <!-- Loading State Overlay -->
        <div class="loading-overlay hidden absolute inset-0 bg-surface-800/80 rounded-xl flex items-center justify-center">
          <div class="flex items-center gap-2 text-slate-400">
            <i class="fas fa-spinner fa-spin"></i>
            <span class="text-sm">Loading...</span>
          </div>
        </div>
      </div>
    `;
  }

  // Event handlers
  get events() {
    return {
      'click .action-play': this.handlePlay,
      'click .action-queue': this.handleQueue,
      'click .action-delete': this.handleDelete,
    };
  }

  handlePlay(event) {
    event.preventDefault();
    event.stopPropagation();
    this.setLoading(true);
    this.props.onPlay(this.props.id);
  }

  handleQueue(event) {
    event.preventDefault();
    event.stopPropagation();
    this.setLoading(true);
    this.props.onQueue(this.props.id);
  }

  handleDelete(event) {
    event.preventDefault();
    event.stopPropagation();
    
    if (confirm(`Are you sure you want to delete "${this.props.name}"? This action cannot be undone.`)) {
      this.setLoading(true);
      this.props.onDelete(this.props.id, this.props.name);
    }
  }

  // Public methods
  setLoading(loading) {
    const overlay = this.getElement('.loading-overlay');
    const actions = this.getElement('.playlist-actions');
    
    if (overlay) {
      overlay.classList.toggle('hidden', !loading);
    }
    if (actions) {
      actions.style.pointerEvents = loading ? 'none' : 'auto';
    }
  }

  updateData(newData) {
    this.props = { ...this.props, ...newData };
    this.rerender();
  }

  // Helper methods
  getElement(selector) {
    const card = document.querySelector(`[data-playlist-id="${this.props.id}"]`);
    return card ? card.querySelector(selector) : null;
  }

  rerender() {
    const card = document.querySelector(`[data-playlist-id="${this.props.id}"]`);
    if (card) {
      const parent = card.parentNode;
      const newCard = document.createElement('div');
      newCard.innerHTML = this.render();
      parent.replaceChild(newCard.firstElementChild, card);
    }
  }
}

// Register component
if (typeof componentManager !== 'undefined') {
  componentManager.register('PlaylistCard', PlaylistCard);
}