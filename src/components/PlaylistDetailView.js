/**
 * PlaylistDetailView Component - Shows detailed view of a playlist with songs
 */
class PlaylistDetailView extends BaseComponent {
  constructor(props) {
    super(props);
    
    this.props = {
      playlist: null,
      onBack: () => {},
      onPlaySong: () => {},
      onQueueSong: () => {},
      onRemoveSong: () => {},
      onPlayAll: () => {},
      onShuffleAll: () => {},
      ...props
    };
    
    this.state = {
      loading: false,
      playingIndex: -1
    };
  }

  render() {
    const { playlist } = this.props;
    
    if (!playlist) {
      return `
        <div class="flex items-center justify-center h-64">
          <div class="text-center">
            <i class="fas fa-music text-4xl text-slate-500 mb-4"></i>
            <p class="text-slate-400">No playlist selected</p>
          </div>
        </div>
      `;
    }

    const tracks = playlist.tracks || [];
    const trackCount = tracks.length;

    return `
      <div class="playlist-detail-view bg-surface-800 rounded-xl border border-surface-700 overflow-hidden">
        <!-- Header -->
        <div class="relative">
          <!-- Background gradient -->
          <div class="absolute inset-0 bg-gradient-to-br from-blue-600/20 to-purple-600/20"></div>
          
          <div class="relative p-6">
            <!-- Back button -->
            <button class="back-btn mb-4 flex items-center gap-2 text-slate-400 hover:text-slate-200 transition-colors">
              <i class="fas fa-arrow-left"></i>
              <span>Back to playlists</span>
            </button>
            
            <!-- Playlist info -->
            <div class="flex items-end gap-6">
              <div class="w-48 h-48 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl flex items-center justify-center shadow-2xl flex-shrink-0">
                <i class="fas fa-music text-6xl text-white/90"></i>
              </div>
              
              <div class="flex-1 pb-4">
                <p class="text-sm font-medium text-slate-400 uppercase tracking-wide mb-2">Playlist</p>
                <h1 class="text-4xl font-bold text-white mb-4" title="${this.escapeHtml(playlist.name)}">
                  ${this.escapeHtml(playlist.name)}
                </h1>
                ${playlist.description ? `
                  <p class="text-slate-300 mb-4 max-w-2xl">
                    ${this.escapeHtml(playlist.description)}
                  </p>
                ` : ''}
                <div class="flex items-center gap-4 text-sm text-slate-400">
                  <span>${trackCount} song${trackCount !== 1 ? 's' : ''}</span>
                  ${trackCount > 0 ? `<span>•</span><span>${this.getTotalDuration(tracks)}</span>` : ''}
                </div>
              </div>
            </div>
            
            <!-- Action buttons -->
            ${trackCount > 0 ? `
              <div class="flex items-center gap-3 mt-6">
                <button class="play-all-btn btn-primary btn-lg bg-green-600 hover:bg-green-700 focus:ring-green-500">
                  <i class="fas fa-play mr-2"></i>
                  Play all
                </button>
                <button class="shuffle-all-btn btn-secondary btn-lg">
                  <i class="fas fa-random mr-2"></i>
                  Shuffle
                </button>
              </div>
            ` : ''}
          </div>
        </div>
        
        <!-- Songs list -->
        <div class="songs-container">
          ${trackCount > 0 ? this.renderSongsList(tracks) : this.renderEmptyState()}
        </div>
      </div>
    `;
  }

  renderSongsList(tracks) {
    return `
      <div class="p-6 pt-0">
        <!-- List header -->
        <div class="grid grid-cols-12 gap-4 px-4 py-2 text-xs font-medium text-slate-500 uppercase tracking-wide border-b border-surface-600 mb-4">
          <div class="col-span-1">#</div>
          <div class="col-span-5">Title</div>
          <div class="col-span-3">Artist</div>
          <div class="col-span-2">Duration</div>
          <div class="col-span-1"></div>
        </div>
        
        <!-- Songs -->
        <div class="space-y-1">
          ${tracks.map((track, index) => this.renderSongItem(track, index)).join('')}
        </div>
      </div>
    `;
  }

  renderSongItem(track, index) {
    const isPlaying = this.state.playingIndex === index;
    
    return `
      <div class="song-item group grid grid-cols-12 gap-4 px-4 py-3 rounded-lg hover:bg-surface-700/50 transition-all duration-200" data-index="${index}">
        <!-- Track number / Play indicator -->
        <div class="col-span-1 flex items-center">
          ${isPlaying ? `
            <div class="w-4 h-4 flex items-center justify-center">
              <div class="w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>
            </div>
          ` : `
            <span class="text-slate-500 group-hover:hidden text-sm">${index + 1}</span>
            <button class="song-play-btn hidden group-hover:block w-8 h-8 bg-white rounded-full flex items-center justify-center hover:scale-105 transition-transform">
              <i class="fas fa-play text-black text-xs ml-0.5"></i>
            </button>
          `}
        </div>
        
        <!-- Title and thumbnail -->
        <div class="col-span-5 flex items-center gap-3 min-w-0">
          <div class="w-10 h-10 bg-surface-600 rounded-md flex-shrink-0 overflow-hidden">
            ${track.thumbnail ? `
              <img src="${track.thumbnail}" alt="" class="w-full h-full object-cover">
            ` : `
              <div class="w-full h-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
                <i class="fas fa-music text-white text-xs"></i>
              </div>
            `}
          </div>
          <div class="min-w-0">
            <p class="font-medium text-white truncate" title="${this.escapeHtml(track.title || track.name)}">
              ${this.escapeHtml(track.title || track.name)}
            </p>
            ${track.url ? `
              <p class="text-xs text-slate-500 truncate">${this.getSourceName(track.url)}</p>
            ` : ''}
          </div>
        </div>
        
        <!-- Artist -->
        <div class="col-span-3 flex items-center min-w-0">
          <span class="text-slate-300 truncate" title="${this.escapeHtml(track.artist || track.author || 'Unknown Artist')}">
            ${this.escapeHtml(track.artist || track.author || 'Unknown Artist')}
          </span>
        </div>
        
        <!-- Duration -->
        <div class="col-span-2 flex items-center">
          <span class="text-slate-400 text-sm">
            ${this.formatDuration(track.duration)}
          </span>
        </div>
        
        <!-- Actions -->
        <div class="col-span-1 flex items-center justify-end">
          <div class="song-actions opacity-0 group-hover:opacity-100 flex items-center gap-1 transition-opacity">
            <button class="song-queue-btn w-8 h-8 rounded-full hover:bg-surface-600 flex items-center justify-center text-slate-400 hover:text-white transition-colors" title="Add to queue">
              <i class="fas fa-plus text-xs"></i>
            </button>
            <button class="song-remove-btn w-8 h-8 rounded-full hover:bg-red-600/20 flex items-center justify-center text-slate-400 hover:text-red-400 transition-colors" title="Remove from playlist">
              <i class="fas fa-times text-xs"></i>
            </button>
          </div>
        </div>
      </div>
    `;
  }

  renderEmptyState() {
    return `
      <div class="p-12 text-center">
        <div class="w-20 h-20 bg-surface-700 rounded-full flex items-center justify-center mx-auto mb-4">
          <i class="fas fa-music text-2xl text-slate-500"></i>
        </div>
        <h3 class="text-lg font-medium text-slate-300 mb-2">No songs in this playlist</h3>
        <p class="text-slate-500 mb-6">Add some songs to get started!</p>
        <button class="add-songs-btn btn-primary">
          <i class="fas fa-plus mr-2"></i>
          Add Songs
        </button>
      </div>
    `;
  }

  // Event handlers
  get events() {
    return {
      'click .back-btn': this.handleBack,
      'click .play-all-btn': this.handlePlayAll,
      'click .shuffle-all-btn': this.handleShuffleAll,
      'click .song-play-btn': this.handlePlaySong,
      'click .song-queue-btn': this.handleQueueSong,
      'click .song-remove-btn': this.handleRemoveSong,
      'dblclick .song-item': this.handlePlaySong,
    };
  }

  handleBack(event) {
    event.preventDefault();
    this.props.onBack();
  }

  handlePlayAll(event) {
    event.preventDefault();
    this.props.onPlayAll(this.props.playlist);
  }

  handleShuffleAll(event) {
    event.preventDefault();
    this.props.onShuffleAll(this.props.playlist);
  }

  handlePlaySong(event) {
    event.preventDefault();
    const songItem = event.target.closest('.song-item');
    if (songItem) {
      const index = parseInt(songItem.dataset.index);
      const track = this.props.playlist.tracks[index];
      this.setState({ playingIndex: index });
      this.props.onPlaySong(track, index);
    }
  }

  handleQueueSong(event) {
    event.preventDefault();
    event.stopPropagation();
    const songItem = event.target.closest('.song-item');
    if (songItem) {
      const index = parseInt(songItem.dataset.index);
      const track = this.props.playlist.tracks[index];
      this.props.onQueueSong(track);
    }
  }

  handleRemoveSong(event) {
    event.preventDefault();
    event.stopPropagation();
    const songItem = event.target.closest('.song-item');
    if (songItem) {
      const index = parseInt(songItem.dataset.index);
      const track = this.props.playlist.tracks[index];
      
      if (confirm(`Remove "${track.title || track.name}" from this playlist?`)) {
        this.props.onRemoveSong(track, index);
      }
    }
  }

  // Utility methods
  getTotalDuration(tracks) {
    const totalSeconds = tracks.reduce((sum, track) => {
      return sum + (this.parseDuration(track.duration) || 0);
    }, 0);
    
    if (totalSeconds < 3600) {
      return `${Math.floor(totalSeconds / 60)} min`;
    } else {
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      return `${hours}h ${minutes}m`;
    }
  }

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
      // Try to parse formats like "3:45" or "1:23:45"
      const parts = duration.split(':').map(Number);
      if (parts.length === 2) {
        return parts[0] * 60 + parts[1];
      } else if (parts.length === 3) {
        return parts[0] * 3600 + parts[1] * 60 + parts[2];
      }
    }
    return 0;
  }

  getSourceName(url) {
    if (!url) return '';
    
    try {
      const hostname = new URL(url).hostname.toLowerCase();
      if (hostname.includes('youtube')) return 'YouTube';
      if (hostname.includes('spotify')) return 'Spotify';
      if (hostname.includes('soundcloud')) return 'SoundCloud';
      if (hostname.includes('apple')) return 'Apple Music';
      return 'External';
    } catch {
      return '';
    }
  }

  // State management
  setState(newState) {
    this.state = { ...this.state, ...newState };
    this.updateUI();
  }

  updateUI() {
    // Update playing indicator
    const currentlyPlaying = this.getElement('.song-item [data-playing="true"]');
    if (currentlyPlaying) {
      currentlyPlaying.removeAttribute('data-playing');
    }
    
    if (this.state.playingIndex >= 0) {
      const playingItem = this.getElement(`[data-index="${this.state.playingIndex}"]`);
      if (playingItem) {
        playingItem.setAttribute('data-playing', 'true');
      }
    }
  }

  getElement(selector) {
    const container = document.querySelector('.playlist-detail-view');
    return container ? container.querySelector(selector) : null;
  }

  // Public methods
  updatePlaylist(newPlaylist) {
    this.props.playlist = newPlaylist;
    this.rerender();
  }

  setPlayingTrack(index) {
    this.setState({ playingIndex: index });
  }

  rerender() {
    const container = document.querySelector('.playlist-detail-view');
    if (container && container.parentNode) {
      const newElement = document.createElement('div');
      newElement.innerHTML = this.render();
      container.parentNode.replaceChild(newElement.firstElementChild, container);
    }
  }
}

// Register component
if (typeof componentManager !== 'undefined') {
  componentManager.register('PlaylistDetailView', PlaylistDetailView);
}