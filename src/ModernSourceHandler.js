const ModernStreamingEngine = require('./ModernStreamingEngine');
const ModernMusicDiscovery = require('./ModernMusicDiscovery');
const { PassThrough } = require('stream');

class ModernSourceHandler {
    constructor() {
        this.streamingEngine = new ModernStreamingEngine();
        this.musicDiscovery = new ModernMusicDiscovery();
        this.retryAttempts = 3;
        this.retryDelay = 2000;
    }

    async handleURL(url) {
        try {
            console.log(`🔗 Modern URL handling: ${url}`);
            
            // Support various URL formats
            if (this.isSpotifyUrl(url)) {
                return await this.handleSpotifyUrl(url);
            } else if (this.isYouTubeUrl(url) || this.isSoundCloudUrl(url)) {
                return await this.streamingEngine.getTrackInfo(url);
            }

            // If it's not a recognized URL, treat as search query
            const results = await this.search(url, 1);
            return results[0] || null;
        } catch (error) {
            console.error(`❌ Modern URL handling failed: ${error.message}`);
            return null;
        }
    }

    async search(query, limit = 10) {
        try {
            console.log(`🔍 Modern search: ${query} (limit: ${limit})`);
            
            // Use the multi-source discovery system
            const results = await this.musicDiscovery.searchMultipleSources(query, limit);
            
            if (results.length === 0) {
                // Fallback to streaming engine direct search
                const fallbackResults = await this.streamingEngine.searchTrack(query);
                return fallbackResults.slice(0, limit);
            }
            
            return results.slice(0, limit);
        } catch (error) {
            console.error(`❌ Modern search failed: ${error.message}`);
            return [];
        }
    }

    async getStream(track, options = {}) {
        let lastError;

        for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
            try {
                console.log(`🎵 Modern streaming attempt ${attempt}/${this.retryAttempts}: ${track.title || track.url}`);

                // If track doesn't have a URL, search for it
                if (!track.url || !this.isValidUrl(track.url)) {
                    const searchQuery = `${track.author || ''} ${track.title || track.url || ''}`.trim();
                    const searchResults = await this.search(searchQuery, 1);
                    
                    if (searchResults.length > 0) {
                        track = { ...track, ...searchResults[0] };
                    } else {
                        throw new Error('No playable URL found for track');
                    }
                }

                // Get the stream using our modern engine
                const stream = await this.streamingEngine.getStream(track.url, {
                    quality: 2, // Use integer for quality (2 = lowest)
                    retryOnError: true,
                    ...options
                });

                if (stream && stream.readable) {
                    console.log(`✅ Modern streaming successful: ${track.title}`);
                    
                    // Add metadata to stream
                    stream.track = track;
                    stream.source = 'modern';
                    
                    return stream;
                }

                throw new Error('Stream not readable');
            } catch (error) {
                lastError = error;
                console.log(`⚠️ Modern streaming attempt ${attempt} failed: ${error.message}`);
                
                if (attempt < this.retryAttempts) {
                    console.log(`🔄 Retrying in ${this.retryDelay}ms...`);
                    await this.sleep(this.retryDelay);
                }
            }
        }

        throw new Error(`Modern streaming failed after ${this.retryAttempts} attempts. Last error: ${lastError?.message}`);
    }

    async getRecommendations(track, limit = 10) {
        try {
            console.log(`🤖 Getting modern recommendations for: ${track.title} by ${track.author}`);
            
            // Use our modern discovery system
            const recommendations = await this.musicDiscovery.discoverSimilarTracks(
                track.author || 'Unknown',
                track.title || 'Unknown',
                limit
            );

            console.log(`✅ Found ${recommendations.length} modern recommendations`);
            return recommendations;
        } catch (error) {
            console.error(`❌ Modern recommendations failed: ${error.message}`);
            return [];
        }
    }

    async getTrendingMusic(limit = 20) {
        return await this.musicDiscovery.getTrendingTracks(limit);
    }

    // Helper methods
    isSpotifyUrl(url) {
        return url.includes('spotify.com/track/') || url.includes('open.spotify.com/track/');
    }

    isYouTubeUrl(url) {
        return url.includes('youtube.com/watch') || url.includes('youtu.be/') || url.includes('music.youtube.com');
    }

    isSoundCloudUrl(url) {
        return url.includes('soundcloud.com/');
    }

    isValidUrl(url) {
        try {
            new URL(url);
            return true;
        } catch {
            return false;
        }
    }

    async handleSpotifyUrl(spotifyUrl) {
        try {
            // Extract track info from Spotify URL (without API)
            const trackId = this.extractSpotifyTrackId(spotifyUrl);
            if (!trackId) throw new Error('Invalid Spotify URL');

            // Search for the track on available platforms
            // Note: This is a simplified version - you could enhance this
            // by scraping Spotify's open graph data or using unofficial APIs
            console.log(`🔍 Searching for Spotify track: ${trackId}`);
            
            // For now, return a basic track object that will be resolved via search
            return {
                title: `Spotify Track ${trackId}`,
                author: 'Unknown Artist',
                source: 'spotify',
                url: spotifyUrl,
                needsResolution: true
            };
        } catch (error) {
            console.error('❌ Spotify URL handling failed:', error.message);
            return null;
        }
    }

    extractSpotifyTrackId(url) {
        const match = url.match(/track\/([a-zA-Z0-9]+)/);
        return match ? match[1] : null;
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Status methods
    getEngineStatus() {
        return {
            streaming: this.streamingEngine.initialized,
            discovery: true,
            cacheSize: this.streamingEngine.cache.size + this.musicDiscovery.cache.size
        };
    }

    clearCaches() {
        this.streamingEngine.clearCache();
        this.musicDiscovery.cache.clear();
        console.log('🧹 Modern caches cleared');
    }
}

module.exports = ModernSourceHandler;