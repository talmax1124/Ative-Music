const AdvancedSearchService = require('./AdvancedSearchService');
const EnhancedQueueManager = require('./EnhancedQueueManager');
const EnhancedMetadataService = require('./EnhancedMetadataService');
const StreamOnlyEngineManager = require('./StreamOnlyEngineManager');

class IntegratedEnhancedServices {
    constructor(guildId, channelId) {
        this.guildId = guildId;
        this.channelId = channelId;
        
        // Initialize all enhanced services
        this.searchService = new AdvancedSearchService();
        this.queueManager = new EnhancedQueueManager(guildId, channelId);
        this.metadataService = new EnhancedMetadataService();
        this.engineManager = new StreamOnlyEngineManager();
        
        // Enhanced state management
        this.state = {
            isPlaying: false,
            isPaused: false,
            currentTrack: null,
            volume: 50,
            searchHistory: [],
            userPreferences: {
                autoEnhanceMetadata: true,
                smartShuffle: true,
                crossfade: false,
                autoplay: true
            }
        };
        
        // Event listeners
        this.setupEventListeners();
        
        console.log('🚀 Integrated Enhanced Services initialized');
    }
    
    setupEventListeners() {
        // Queue events
        this.queueManager.onTrackChange = (track) => {
            this.handleTrackChange(track);
        };
        
        this.queueManager.onQueueUpdate = (action, data) => {
            this.handleQueueUpdate(action, data);
        };
        
        this.queueManager.onModeChange = (mode, value) => {
            this.handleModeChange(mode, value);
        };
    }
    
    // Enhanced search with metadata
    async search(query, options = {}) {
        try {
            console.log(`🔍 Enhanced search: "${query}"`);
            
            // Use advanced search service
            const results = await this.searchService.search(query, {
                limit: options.limit || 10,
                source: options.source || 'all',
                includeMetadata: options.enhanceMetadata !== false,
                fuzzyThreshold: options.fuzzyThreshold || 0.6
            });
            
            // Enhance results with metadata if requested
            if (options.enhanceMetadata !== false && results.length > 0) {
                console.log('🔍 Enhancing search results with metadata...');
                const enhanced = await this.metadataService.enhanceTracks(results, {
                    batchSize: 3,
                    delayBetweenBatches: 500
                });
                return enhanced;
            }
            
            return results;
        } catch (error) {
            console.error('❌ Enhanced search failed:', error);
            return [];
        }
    }
    
    // Smart add to queue with metadata enhancement
    async addToQueue(track, options = {}) {
        try {
            // Enhance track metadata if enabled
            let enhancedTrack = track;
            if (this.state.userPreferences.autoEnhanceMetadata) {
                console.log('🔍 Auto-enhancing track metadata...');
                enhancedTrack = await this.metadataService.enhanceTrack(track);
            }
            
            // Add to queue using enhanced queue manager
            const result = await this.queueManager.addTrack(enhancedTrack, {
                position: options.position || 'end',
                requestedBy: options.requestedBy,
                skipDuplicates: options.skipDuplicates !== false
            });
            
            if (result.success) {
                console.log(`✅ Added to queue: ${enhancedTrack.title} (position ${result.position})`);
                
                // Auto-start playing if queue was empty
                if (!this.state.isPlaying && result.position === 1) {
                    await this.play();
                }
            }
            
            return result;
        } catch (error) {
            console.error('❌ Failed to add to queue:', error);
            return { success: false, error: error.message };
        }
    }
    
    // Enhanced play with streaming
    async play(trackId = null) {
        try {
            let track;
            
            if (trackId) {
                // Play specific track
                const success = this.queueManager.setCurrentTrack(trackId);
                if (!success) {
                    throw new Error('Track not found in queue');
                }
                track = this.queueManager.currentTrack;
            } else {
                // Play current or next track
                track = this.queueManager.currentTrack || this.queueManager.getNextTrack();
                if (!track) {
                    throw new Error('No track to play');
                }
                this.queueManager.setCurrentTrack(track.id);
            }
            
            console.log(`🎵 Playing: ${track.title} by ${track.artist}`);
            
            // Get stream using enhanced engine manager
            const stream = await this.engineManager.getStream(track);
            if (!stream) {
                throw new Error('Failed to get audio stream');
            }
            
            this.state.isPlaying = true;
            this.state.isPaused = false;
            this.state.currentTrack = track;
            
            // Update listening history
            await this.updateListeningHistory(track);
            
            return {
                success: true,
                track,
                stream
            };
            
        } catch (error) {
            console.error('❌ Failed to play track:', error);
            return { success: false, error: error.message };
        }
    }
    
    // Enhanced queue management
    async getQueue() {
        const queue = this.queueManager.queue;
        const stats = this.queueManager.getQueueStats();
        
        return {
            tracks: queue,
            currentTrack: this.queueManager.currentTrack,
            currentIndex: this.queueManager.currentIndex,
            stats,
            modes: {
                repeat: this.queueManager.repeatMode,
                shuffle: this.queueManager.shuffleMode,
                autoplay: this.queueManager.autoplayMode
            }
        };
    }
    
    async moveTrack(trackId, newPosition) {
        return await this.queueManager.moveTrack(trackId, newPosition);
    }
    
    async removeTrack(trackId) {
        return await this.queueManager.removeTrack(trackId);
    }
    
    async clearQueue() {
        this.state.isPlaying = false;
        this.state.currentTrack = null;
        return await this.queueManager.clearQueue();
    }
    
    // Playback controls
    async next() {
        const nextTrack = this.queueManager.getNextTrack();
        if (nextTrack) {
            return await this.play(nextTrack.id);
        }
        return { success: false, message: 'No next track' };
    }
    
    async previous() {
        const prevTrack = this.queueManager.getPreviousTrack();
        if (prevTrack) {
            return await this.play(prevTrack.id);
        }
        return { success: false, message: 'No previous track' };
    }
    
    pause() {
        this.state.isPaused = true;
        console.log('⏸️ Playback paused');
        return { success: true };
    }
    
    resume() {
        this.state.isPaused = false;
        console.log('▶️ Playback resumed');
        return { success: true };
    }
    
    stop() {
        this.state.isPlaying = false;
        this.state.isPaused = false;
        this.state.currentTrack = null;
        console.log('⏹️ Playback stopped');
        return { success: true };
    }
    
    // Mode controls
    toggleShuffle() {
        const shuffleMode = this.queueManager.toggleShuffle();
        console.log(`🔀 Shuffle: ${shuffleMode ? 'ON' : 'OFF'}`);
        return { success: true, shuffleMode };
    }
    
    setRepeatMode(mode) {
        if (!['off', 'track', 'queue'].includes(mode)) {
            return { success: false, message: 'Invalid repeat mode' };
        }
        
        this.queueManager.repeatMode = mode;
        console.log(`🔁 Repeat: ${mode.toUpperCase()}`);
        return { success: true, repeatMode: mode };
    }
    
    // Enhanced recommendations
    async getRecommendations(limit = 10) {
        try {
            const currentTrack = this.state.currentTrack;
            if (!currentTrack) {
                return { success: false, message: 'No current track for recommendations' };
            }
            
            // Get similar tracks using metadata service
            const similar = await this.metadataService.getSimilarTracks(currentTrack, limit);
            
            // Search for each similar track to get playable results
            const recommendations = [];
            for (const similarTrack of similar.slice(0, limit)) {
                try {
                    const searchResults = await this.search(
                        `${similarTrack.artist} ${similarTrack.title}`,
                        { limit: 1, enhanceMetadata: false }
                    );
                    
                    if (searchResults.length > 0) {
                        recommendations.push({
                            ...searchResults[0],
                            similarity: similarTrack.similarity,
                            reason: 'Similar to current track'
                        });
                    }
                } catch (error) {
                    console.warn(`Failed to search for recommendation: ${similarTrack.title}`);
                }
            }
            
            return {
                success: true,
                recommendations,
                basedOn: currentTrack
            };
            
        } catch (error) {
            console.error('❌ Failed to get recommendations:', error);
            return { success: false, error: error.message };
        }
    }
    
    // Search suggestions
    getSearchSuggestions(partial) {
        return this.searchService.getSearchSuggestions(partial);
    }
    
    // Statistics and analytics
    getStats() {
        return {
            queue: this.queueManager.getQueueStats(),
            search: this.searchService.getStats(),
            metadata: this.metadataService.getCacheStats(),
            engine: this.engineManager.getStats(),
            playback: {
                isPlaying: this.state.isPlaying,
                isPaused: this.state.isPaused,
                currentTrack: this.state.currentTrack,
                volume: this.state.volume
            }
        };
    }
    
    // Event handlers
    handleTrackChange(track) {
        this.state.currentTrack = track;
        console.log(`🎵 Track changed: ${track.title}`);
        
        // Trigger any additional track change logic
        this.onTrackChange?.(track);
    }
    
    handleQueueUpdate(action, data) {
        console.log(`📝 Queue update: ${action}`, data);
        
        // Trigger any additional queue update logic
        this.onQueueUpdate?.(action, data);
    }
    
    handleModeChange(mode, value) {
        console.log(`🎛️ Mode change: ${mode} = ${value}`);
        
        // Trigger any additional mode change logic
        this.onModeChange?.(mode, value);
    }
    
    // Listening history
    async updateListeningHistory(track) {
        try {
            // This would typically be called by the actual bot instance
            // For now, just log the play
            console.log(`📊 Played: ${track.title} by ${track.artist}`);
        } catch (error) {
            console.warn('Failed to update listening history:', error);
        }
    }
    
    // User preferences
    updateUserPreferences(preferences) {
        Object.assign(this.state.userPreferences, preferences);
        console.log('⚙️ User preferences updated:', preferences);
        return { success: true, preferences: this.state.userPreferences };
    }
    
    getUserPreferences() {
        return this.state.userPreferences;
    }
    
    // Export/Import
    async exportQueue(format = 'json') {
        return this.queueManager.exportQueue(format);
    }
    
    async importPlaylist(url) {
        try {
            // This would integrate with the playlist import functionality
            console.log(`📥 Importing playlist: ${url}`);
            return { success: true, message: 'Playlist import started' };
        } catch (error) {
            console.error('❌ Failed to import playlist:', error);
            return { success: false, error: error.message };
        }
    }
    
    // Search within queue
    searchQueue(query) {
        return this.queueManager.searchQueue(query);
    }
    
    // Health check
    async healthCheck() {
        const engineHealth = await this.engineManager.healthCheck();
        
        return {
            status: 'healthy',
            services: {
                search: 'healthy',
                queue: 'healthy',
                metadata: 'healthy',
                engines: engineHealth
            },
            stats: this.getStats()
        };
    }
    
    // Cleanup
    async cleanup() {
        console.log('🧹 Cleaning up enhanced services...');
        
        this.searchService.clearCache();
        this.metadataService.clearCache();
        this.engineManager.cleanup();
        
        await this.queueManager.saveToDatabase();
    }
}

module.exports = IntegratedEnhancedServices;