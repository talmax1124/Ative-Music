const play = require('play-dl');
const { PassThrough } = require('stream');
const axios = require('axios');

class ModernStreamingEngine {
    constructor() {
        this.initialized = false;
        this.cache = new Map();
        this.cacheTTL = 5 * 60 * 1000; // 5 minutes
        
        // Multiple user agents to avoid 429 errors
        this.userAgents = [
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        ];
        
        this.initialize();
    }

    async initialize() {
        try {
            // Set user agent rotation to avoid 429 errors
            await play.setToken({ 
                useragent: this.userAgents 
            });
            
            this.initialized = true;
            console.log('🚀 Modern Streaming Engine initialized (NO COOKIES REQUIRED)');
        } catch (error) {
            console.error('⚠️ Modern Streaming Engine setup warning:', error.message);
            this.initialized = true; // Continue anyway
        }
    }

    async searchTrack(query) {
        try {
            console.log(`🔍 Modern search: ${query}`);
            
            // Use play-dl's search functionality
            const results = await play.search(query, {
                limit: 10,
                source: { youtube: 'video', soundcloud: 'tracks' }
            });

            return results.map(track => {
                if (track.type === 'video') {
                    // YouTube result
                    return {
                        title: track.title,
                        author: track.channel?.name || 'Unknown',
                        duration: this.formatDuration(track.durationInSec * 1000),
                        durationMS: track.durationInSec * 1000,
                        url: track.url,
                        thumbnail: track.thumbnails?.[0]?.url,
                        source: 'youtube',
                        id: track.id,
                        views: track.views
                    };
                } else if (track.type === 'track') {
                    // SoundCloud result
                    return {
                        title: track.title,
                        author: track.user?.name || 'Unknown',
                        duration: this.formatDuration(track.durationInSec * 1000),
                        durationMS: track.durationInSec * 1000,
                        url: track.url,
                        thumbnail: track.thumbnail,
                        source: 'soundcloud',
                        id: track.id,
                        plays: track.playCount
                    };
                }
                return null;
            }).filter(Boolean);
        } catch (error) {
            console.error('❌ Modern search failed:', error.message);
            return [];
        }
    }

    async getStream(url, options = {}) {
        try {
            console.log(`🎵 Modern streaming: ${url}`);
            
            // Check cache first
            const cached = this.getFromCache(url);
            if (cached) {
                console.log('💾 Using cached stream info');
                return await this.createStream(cached.streamUrl);
            }

            // Get stream info using play-dl (no cookies needed!)
            const stream = await play.stream(url, { 
                discordPlayerCompatibility: true,
                quality: 2 // Use integer for quality (2 = lowest)
            });

            if (stream && stream.stream) {
                // Cache the stream info
                this.setCache(url, { streamUrl: stream.url });
                console.log('✅ Modern stream created successfully');
                return stream.stream;
            }

            throw new Error('No stream available');
        } catch (error) {
            console.error(`❌ Modern streaming failed: ${error.message}`);
            throw error;
        }
    }

    async createStream(streamUrl) {
        // Create a pass-through stream for reliability
        const stream = new PassThrough();
        
        try {
            const response = await axios({
                method: 'GET',
                url: streamUrl,
                responseType: 'stream',
                timeout: 10000,
                headers: {
                    'User-Agent': this.getRandomUserAgent(),
                    'Accept': 'audio/*',
                    'Connection': 'keep-alive'
                }
            });

            response.data.pipe(stream);
            
            response.data.on('error', (error) => {
                console.error('❌ Stream response error:', error.message);
                stream.destroy(error);
            });

        } catch (error) {
            stream.destroy(error);
        }

        return stream;
    }

    async getTrackInfo(url) {
        try {
            const info = await play.video_basic_info(url);
            
            return {
                title: info.video_details.title,
                author: info.video_details.channel?.name || 'Unknown',
                duration: this.formatDuration(info.video_details.durationInSec * 1000),
                durationMS: info.video_details.durationInSec * 1000,
                url: info.video_details.url,
                thumbnail: info.video_details.thumbnails?.[0]?.url,
                source: 'youtube',
                id: info.video_details.id,
                views: info.video_details.views
            };
        } catch (error) {
            console.error('❌ Failed to get track info:', error.message);
            return null;
        }
    }

    getRandomUserAgent() {
        return this.userAgents[Math.floor(Math.random() * this.userAgents.length)];
    }

    formatDuration(ms) {
        const seconds = Math.floor((ms / 1000) % 60);
        const minutes = Math.floor((ms / (1000 * 60)) % 60);
        const hours = Math.floor(ms / (1000 * 60 * 60));
        
        if (hours > 0) {
            return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        }
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }

    setCache(key, data) {
        this.cache.set(key, {
            data,
            timestamp: Date.now()
        });
    }

    getFromCache(key) {
        const cached = this.cache.get(key);
        if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
            return cached.data;
        }
        if (cached) {
            this.cache.delete(key);
        }
        return null;
    }

    clearCache() {
        this.cache.clear();
    }
}

module.exports = ModernStreamingEngine;