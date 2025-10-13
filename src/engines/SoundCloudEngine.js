const play = require('play-dl');
const axios = require('axios');
const { PassThrough } = require('stream');

class SoundCloudEngine {
    constructor() {
        this.name = 'soundcloud';
        this.priority = 2; // High priority for SoundCloud URLs
        this.initialized = false;
        this.maxRetries = 3;
        this.timeout = 15000;
        
        this.userAgents = [
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36'
        ];
        
        this.cache = new Map();
        this.cacheTTL = 10 * 60 * 1000; // 10 minutes
        
        this.initialize();
    }

    async initialize() {
        try {
            await play.setToken({ 
                useragent: this.userAgents 
            });
            
            this.initialized = true;
            console.log('🎵 SoundCloud engine initialized');
            return true;
        } catch (error) {
            console.warn('⚠️ SoundCloud engine warning:', error.message);
            this.initialized = true; // Continue anyway
            return true;
        }
    }

    async canHandle(url) {
        if (!this.initialized) return false;
        
        return url.includes('soundcloud.com/') && !url.includes('/sets/');
    }

    async search(query, limit = 10) {
        if (!this.initialized) return [];

        const cacheKey = `sc_search_${query}_${limit}`;
        const cached = this.getFromCache(cacheKey);
        if (cached) return cached;

        try {
            console.log(`🔍 [${this.name}] Searching SoundCloud: ${query}`);
            
            const results = await play.search(query, {
                limit: Math.min(limit, 20),
                source: { soundcloud: 'tracks' }
            });

            const formattedResults = results
                .filter(track => track.type === 'track')
                .map(this.formatTrack.bind(this))
                .filter(Boolean);

            this.setCache(cacheKey, formattedResults);
            return formattedResults;
        } catch (error) {
            console.error(`❌ [${this.name}] Search failed: ${error.message}`);
            return [];
        }
    }

    async getStream(url) {
        if (!this.initialized) throw new Error('SoundCloud engine not initialized');

        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                console.log(`🎵 [${this.name}] Streaming attempt ${attempt}: ${url}`);
                
                const stream = await Promise.race([
                    this.createSoundCloudStream(url),
                    new Promise((_, reject) => 
                        setTimeout(() => reject(new Error('Timeout')), this.timeout)
                    )
                ]);

                if (stream && stream.readable) {
                    console.log(`✅ [${this.name}] Stream created successfully`);
                    return stream;
                }

                throw new Error('Invalid stream response');
            } catch (error) {
                console.warn(`⚠️ [${this.name}] Attempt ${attempt} failed: ${error.message}`);
                if (attempt === this.maxRetries) {
                    throw new Error(`SoundCloud streaming failed after ${this.maxRetries} attempts: ${error.message}`);
                }
                await this.sleep(1500 * attempt);
            }
        }
    }

    async createSoundCloudStream(url) {
        try {
            // Use play-dl for SoundCloud streaming
            const stream = await play.stream(url, { 
                discordPlayerCompatibility: true,
                quality: 2 // Use integer for quality (2 = lowest)
            });

            if (stream && stream.stream) {
                return stream.stream;
            }

            // Fallback: try to get track info and stream URL
            const trackInfo = await this.getSoundCloudTrackInfo(url);
            if (trackInfo && trackInfo.streamUrl) {
                return await this.createDirectStream(trackInfo.streamUrl);
            }

            throw new Error('No stream available');
        } catch (error) {
            console.error(`❌ [${this.name}] Stream creation failed:`, error.message);
            throw error;
        }
    }

    async createDirectStream(streamUrl) {
        const stream = new PassThrough();
        
        try {
            const response = await axios({
                method: 'GET',
                url: streamUrl,
                responseType: 'stream',
                timeout: this.timeout,
                headers: {
                    'User-Agent': this.getRandomUserAgent(),
                    'Accept': 'audio/*',
                    'Connection': 'keep-alive'
                }
            });

            response.data.pipe(stream);
            
            response.data.on('error', (error) => {
                console.error('❌ SoundCloud stream error:', error.message);
                stream.destroy(error);
            });

        } catch (error) {
            stream.destroy(error);
        }

        return stream;
    }

    async getTrackInfo(url) {
        if (!this.initialized) return null;

        const cached = this.getFromCache(`info_${url}`);
        if (cached) return cached;

        try {
            const info = await this.getSoundCloudTrackInfo(url);
            if (info) {
                this.setCache(`info_${url}`, info);
                return info;
            }
            return null;
        } catch (error) {
            console.error(`❌ [${this.name}] Track info failed: ${error.message}`);
            return null;
        }
    }

    async getSoundCloudTrackInfo(url) {
        try {
            // Try to use play-dl's info method
            const info = await play.soundcloud(url);
            
            return {
                title: info.name,
                author: info.user?.name || 'Unknown Artist',
                duration: this.formatDuration(info.durationInSec),
                durationMS: info.durationInSec * 1000,
                url: info.url,
                thumbnail: info.thumbnail,
                source: 'soundcloud',
                engine: this.name,
                id: info.id,
                plays: info.playCount,
                description: info.description,
                genre: info.genre
            };
        } catch (error) {
            console.error('❌ Failed to get SoundCloud track info:', error.message);
            
            // Fallback: basic info from URL
            const trackName = url.split('/').pop() || 'Unknown Track';
            return {
                title: trackName.replace(/-/g, ' '),
                author: 'Unknown Artist',
                duration: 'Unknown',
                durationMS: null,
                url: url,
                thumbnail: null,
                source: 'soundcloud',
                engine: this.name
            };
        }
    }

    formatTrack(track) {
        if (track.type !== 'track') return null;
        
        return {
            title: track.title,
            author: track.user?.name || 'Unknown',
            duration: this.formatDuration(track.durationInSec),
            durationMS: track.durationInSec * 1000,
            url: track.url,
            thumbnail: track.thumbnail,
            source: 'soundcloud',
            engine: this.name,
            id: track.id,
            plays: track.playCount,
            description: track.description,
            genre: track.genre
        };
    }

    formatDuration(seconds) {
        if (!seconds || seconds === 0) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    getRandomUserAgent() {
        return this.userAgents[Math.floor(Math.random() * this.userAgents.length)];
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
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

    getStatus() {
        return {
            name: this.name,
            priority: this.priority,
            initialized: this.initialized,
            supports: ['soundcloud', 'search'],
            requiresCookies: false,
            cacheSize: this.cache.size
        };
    }
}

module.exports = SoundCloudEngine;