/**
 * SuggestionsSection Component - Shows recommended songs
 */
class SuggestionsSection extends BaseComponent {
  constructor(props) {
    super(props);
    
    this.props = {
      suggestions: [],
      onPlaySong: () => {},
      onQueueSong: () => {},
      onAddToPlaylist: () => {},
      loading: false,
      ...props
    };
  }

  render() {
    const { suggestions, loading } = this.props;

    return `
      <div class="suggestions-section bg-surface-800 rounded-xl border border-surface-700 p-6">
        <!-- Header -->
        <div class="flex items-center justify-between mb-6">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 bg-gradient-to-br from-purple-500 to-pink-600 rounded-lg flex items-center justify-center">
              <i class="fas fa-sparkles text-white"></i>
            </div>
            <div>
              <h3 class="text-lg font-semibold text-slate-100">Discover New Music</h3>
              <p class="text-sm text-slate-400">Handpicked recommendations for you</p>
            </div>
          </div>
          <button class="refresh-suggestions-btn text-slate-400 hover:text-slate-200 transition-colors p-2 rounded-lg hover:bg-surface-700" title="Refresh suggestions">
            <i class="fas fa-refresh ${loading ? 'fa-spin' : ''}"></i>
          </button>
        </div>

        <!-- Suggestions grid -->
        ${loading ? this.renderLoading() : this.renderSuggestions(suggestions)}
      </div>
    `;
  }

  renderLoading() {
    return `
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        ${Array(5).fill(0).map(() => `
          <div class="suggestion-card-skeleton">
            <div class="bg-surface-700 rounded-lg p-4 animate-pulse">
              <div class="w-full h-32 bg-surface-600 rounded-lg mb-3"></div>
              <div class="h-4 bg-surface-600 rounded mb-2"></div>
              <div class="h-3 bg-surface-600 rounded w-3/4"></div>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  renderSuggestions(suggestions) {
    if (!suggestions || suggestions.length === 0) {
      return this.renderEmptyState();
    }

    return `
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        ${suggestions.slice(0, 5).map((song, index) => this.renderSuggestionCard(song, index)).join('')}
      </div>
    `;
  }

  renderSuggestionCard(song, index) {
    return `
      <div class="suggestion-card group bg-surface-700/50 rounded-lg p-4 hover:bg-surface-700 transition-all duration-300 hover:scale-105 cursor-pointer" data-index="${index}">
        <!-- Thumbnail -->
        <div class="relative mb-3">
          <div class="w-full h-32 bg-gradient-to-br from-purple-500 to-pink-600 rounded-lg overflow-hidden">
            ${song.thumbnail ? `
              <img src="${song.thumbnail}" alt="${this.escapeHtml(song.title)}" class="w-full h-full object-cover">
            ` : `
              <div class="w-full h-full flex items-center justify-center">
                <i class="fas fa-music text-2xl text-white/80"></i>
              </div>
            `}
          </div>
          
          <!-- Play overlay -->
          <div class="absolute inset-0 bg-black/60 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center">
            <button class="play-suggestion-btn w-12 h-12 bg-white rounded-full flex items-center justify-center hover:scale-110 transition-transform">
              <i class="fas fa-play text-black ml-1"></i>
            </button>
          </div>
        </div>
        
        <!-- Song info -->
        <div class="min-w-0">
          <h4 class="font-medium text-white text-sm leading-tight truncate mb-1" title="${this.escapeHtml(song.title)}">
            ${this.escapeHtml(song.title)}
          </h4>
          <p class="text-xs text-slate-400 truncate" title="${this.escapeHtml(song.artist)}">
            ${this.escapeHtml(song.artist)}
          </p>
          <div class="flex items-center justify-between mt-2">
            <span class="text-xs text-slate-500">${this.formatDuration(song.duration)}</span>
            <div class="suggestion-actions opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
              <button class="queue-suggestion-btn w-6 h-6 rounded-full hover:bg-surface-600 flex items-center justify-center text-slate-400 hover:text-white transition-colors" title="Add to queue">
                <i class="fas fa-plus text-xs"></i>
              </button>
              <button class="playlist-suggestion-btn w-6 h-6 rounded-full hover:bg-surface-600 flex items-center justify-center text-slate-400 hover:text-white transition-colors" title="Add to playlist">
                <i class="fas fa-heart text-xs"></i>
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  renderEmptyState() {
    return `
      <div class="text-center py-12">
        <div class="w-16 h-16 bg-surface-700 rounded-full flex items-center justify-center mx-auto mb-4">
          <i class="fas fa-sparkles text-2xl text-slate-500"></i>
        </div>
        <h4 class="text-lg font-medium text-slate-300 mb-2">No suggestions available</h4>
        <p class="text-slate-500 mb-4">We're working on finding great music for you!</p>
        <button class="refresh-suggestions-btn btn-primary">
          <i class="fas fa-refresh mr-2"></i>
          Try Again
        </button>
      </div>
    `;
  }

  // Event handlers
  get events() {
    return {
      'click .refresh-suggestions-btn': this.handleRefresh,
      'click .play-suggestion-btn': this.handlePlaySong,
      'click .queue-suggestion-btn': this.handleQueueSong,
      'click .playlist-suggestion-btn': this.handleAddToPlaylist,
      'click .suggestion-card': this.handleCardClick,
    };
  }

  handleRefresh(event) {
    event.preventDefault();
    this.props.onRefresh && this.props.onRefresh();
  }

  handlePlaySong(event) {
    event.preventDefault();
    event.stopPropagation();
    const card = event.target.closest('.suggestion-card');
    if (card) {
      const index = parseInt(card.dataset.index);
      const song = this.props.suggestions[index];
      this.props.onPlaySong(song);
    }
  }

  handleQueueSong(event) {
    event.preventDefault();
    event.stopPropagation();
    const card = event.target.closest('.suggestion-card');
    if (card) {
      const index = parseInt(card.dataset.index);
      const song = this.props.suggestions[index];
      this.props.onQueueSong(song);
    }
  }

  handleAddToPlaylist(event) {
    event.preventDefault();
    event.stopPropagation();
    const card = event.target.closest('.suggestion-card');
    if (card) {
      const index = parseInt(card.dataset.index);
      const song = this.props.suggestions[index];
      this.props.onAddToPlaylist(song);
    }
  }

  handleCardClick(event) {
    // Only handle if not clicking on action buttons
    if (!event.target.closest('.suggestion-actions') && !event.target.closest('.play-suggestion-btn')) {
      const card = event.target.closest('.suggestion-card');
      if (card) {
        const index = parseInt(card.dataset.index);
        const song = this.props.suggestions[index];
        this.props.onPlaySong(song);
      }
    }
  }

  // Utility methods
  formatDuration(duration) {
    if (!duration) return '--:--';
    
    const seconds = this.parseDuration(duration);
    if (!seconds) return '--:--';
    
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  parseDuration(duration) {
    if (typeof duration === 'number') return duration;
    if (typeof duration === 'string') {
      const parts = duration.split(':').map(Number);
      if (parts.length === 2) {
        return parts[0] * 60 + parts[1];
      } else if (parts.length === 3) {
        return parts[0] * 3600 + parts[1] * 60 + parts[2];
      }
    }
    return 0;
  }

  // Public methods
  updateSuggestions(newSuggestions) {
    this.props.suggestions = newSuggestions;
    this.rerender();
  }

  setLoading(loading) {
    this.props.loading = loading;
    this.rerender();
  }

  rerender() {
    const container = document.querySelector('.suggestions-section');
    if (container && container.parentNode) {
      const newElement = document.createElement('div');
      newElement.innerHTML = this.render();
      container.parentNode.replaceChild(newElement.firstElementChild, container);
    }
  }
}

// Register component
if (typeof componentManager !== 'undefined') {
  componentManager.register('SuggestionsSection', SuggestionsSection);
}