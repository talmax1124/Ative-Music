const { createAudioResource, StreamType } = require('@discordjs/voice');
const play = require('play-dl');

/**
 * DirectStreamManager - Inspired by Lavaplayer's direct streaming approach
 * Simple, efficient streaming without Discord Player complexity
 */
class DirectStreamManager {
    constructor() {
        this.name = 'DirectStreamManager';
        this.initialized = false;
        this.activeStreams = new Map();
        this.maxConcurrentStreams = 3;
        
        this.initializePlayDl();
    }

    async initializePlayDl() {
        try {
            console.log('🚀 Initializing play-dl for direct streaming...');
            
            // Initialize play-dl (no explicit FFmpeg path setting needed)
            this.initialized = true;
            console.log('✅ DirectStreamManager initialized successfully');
        } catch (error) {
            console.error('❌ Failed to initialize DirectStreamManager:', error.message);
            this.initialized = false;
        }
    }

    async search(query, limit = 5) {
        if (!this.initialized) {
            await this.initializePlayDl();
        }

        try {
            console.log(`🔍 [DirectStream] Searching: ${query}`);
            
            // Try multiple sources in order of reliability
            const sources = [
                { type: 'so_search', name: 'SoundCloud' },
                { type: 'sp_search', name: 'Spotify' },
                { type: 'yt_search', name: 'YouTube' }
            ];

            for (const source of sources) {
                try {
                    console.log(`🎯 Trying ${source.name} search...`);
                    
                    let results;
                    if (source.type === 'so_search') {
                        results = await play.search(query, { source: { soundcloud: 'tracks' }, limit });
                    } else if (source.type === 'sp_search') {
                        results = await play.search(query, { source: { spotify: 'tracks' }, limit });
                    } else {
                        results = await play.search(query, { source: { youtube: 'video' }, limit });
                    }

                    if (results && results.length > 0) {
                        const formattedResults = results.map(track => ({
                            title: track.title,
                            author: track.artists ? track.artists[0]?.name : track.channel?.name || 'Unknown',
                            url: track.url,
                            duration: track.durationInMs ? this.formatDuration(track.durationInMs / 1000) : 'Unknown',
                            thumbnail: track.thumbnails?.[0]?.url || track.thumbnail,
                            source: source.name.toLowerCase(),
                            durationMS: track.durationInMs || 0,
                            id: track.id
                        }));

                        console.log(`✅ [DirectStream] Found ${formattedResults.length} results from ${source.name}`);
                        return formattedResults;
                    }
                } catch (sourceError) {
                    console.warn(`⚠️ ${source.name} search failed: ${sourceError.message}`);
                    continue;
                }
            }

            console.log(`⚠️ [DirectStream] No results found for: ${query}`);
            return [];

        } catch (error) {
            console.error(`❌ [DirectStream] Search failed: ${error.message}`);
            return [];
        }
    }

    async getStream(track) {
        if (!this.initialized) {
            await this.initializePlayDl();
        }

        // Check concurrent stream limit
        if (this.activeStreams.size >= this.maxConcurrentStreams) {
            throw new Error(`Max concurrent streams reached (${this.maxConcurrentStreams})`);
        }

        try {
            const streamId = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            console.log(`🚀 [DirectStream] Creating stream for: ${track.title}`);

            let audioStream;
            
            // Handle different sources
            if (track.source === 'soundcloud' || track.url.includes('soundcloud.com')) {
                audioStream = await play.stream(track.url, { quality: 2 }); // High quality
            } else if (track.source === 'spotify' || track.url.includes('spotify.com')) {
                // Spotify requires special handling - search YouTube equivalent
                const ytSearch = await play.search(`${track.author} ${track.title}`, { source: { youtube: 'video' }, limit: 1 });
                if (ytSearch.length > 0) {
                    audioStream = await play.stream(ytSearch[0].url, { quality: 2 });
                } else {
                    throw new Error('No YouTube equivalent found for Spotify track');
                }
            } else {
                // YouTube or direct URL
                audioStream = await play.stream(track.url, { quality: 2 });
            }

            if (!audioStream || !audioStream.stream) {
                throw new Error('Failed to create audio stream');
            }

            // Track active stream
            this.activeStreams.set(streamId, {
                track,
                startTime: Date.now()
            });

            // Auto-cleanup after 10 minutes
            setTimeout(() => {
                this.activeStreams.delete(streamId);
            }, 600000);

            // Create Discord audio resource with optimal settings
            const resource = createAudioResource(audioStream.stream, {
                inputType: audioStream.type || StreamType.Arbitrary,
                inlineVolume: true
            });

            console.log(`✅ [DirectStream] Stream created successfully for ${track.title}`);
            return resource;

        } catch (error) {
            console.error(`❌ [DirectStream] Stream creation failed: ${error.message}`);
            throw error;
        }
    }

    async handleURL(url) {
        try {
            console.log(`🔍 [DirectStream] Analyzing URL: ${url}`);
            
            // Validate URL with play-dl
            const isValid = await play.validate(url);
            if (!isValid) {
                return null;
            }

            // Get track info
            let trackInfo;
            if (url.includes('soundcloud.com')) {
                trackInfo = await play.soundcloud(url);
            } else if (url.includes('spotify.com')) {
                trackInfo = await play.spotify(url);
            } else {
                trackInfo = await play.video_basic_info(url);
            }

            if (!trackInfo) {
                return null;
            }

            return {
                title: trackInfo.video_details?.title || trackInfo.name || 'Unknown',
                author: trackInfo.video_details?.channel?.name || trackInfo.artists?.[0]?.name || 'Unknown',
                url: url,
                duration: trackInfo.video_details?.durationInSec ? 
                    this.formatDuration(trackInfo.video_details.durationInSec) : 'Unknown',
                thumbnail: trackInfo.video_details?.thumbnails?.[0]?.url || trackInfo.thumbnail,
                source: url.includes('soundcloud.com') ? 'soundcloud' : 
                       url.includes('spotify.com') ? 'spotify' : 'youtube'
            };

        } catch (error) {
            console.error(`❌ [DirectStream] URL handling failed: ${error.message}`);
            return null;
        }
    }

    formatDuration(seconds) {
        if (!seconds || seconds === 0) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    getStatus() {
        return {
            name: this.name,
            initialized: this.initialized,
            activeStreams: this.activeStreams.size,
            maxConcurrentStreams: this.maxConcurrentStreams,
            supports: ['soundcloud', 'spotify', 'youtube', 'direct-urls']
        };
    }

    cleanup() {
        console.log('🛑 Cleaning up DirectStreamManager...');
        this.activeStreams.clear();
        console.log('✅ DirectStreamManager cleanup completed');
    }
}

module.exports = DirectStreamManager;