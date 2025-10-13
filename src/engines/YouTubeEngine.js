const play = require('play-dl');
const axios = require('axios');
const { PassThrough } = require('stream');

class YouTubeEngine {
    constructor() {
        this.name = 'youtube';
        this.priority = 1; // Highest priority for YouTube URLs
        this.initialized = false;
        this.maxRetries = 3;
        this.timeout = 15000; // 15 seconds for VPS
        
        this.userAgents = [
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        ];
        
        this.cache = new Map();
        this.cacheTTL = 8 * 60 * 1000; // 8 minutes (YouTube URLs expire)
        this.infoCacheTTL = 30 * 60 * 1000; // 30 minutes for track info
        
        this.initialize();
    }

    async initialize() {
        try {
            // Configure play-dl with optimized settings for YouTube
            await play.setToken({ 
                useragent: this.userAgents,
                cookie: undefined // Explicitly no cookies
            });
            
            this.initialized = true;
            console.log('🎥 YouTube engine initialized (cookie-free)');
            return true;
        } catch (error) {
            console.warn('⚠️ YouTube engine warning:', error.message);
            this.initialized = true; // Continue anyway
            return true;
        }
    }

    async canHandle(url) {
        if (!this.initialized) return false;
        
        return url.includes('youtube.com/watch') || 
               url.includes('youtu.be/') ||
               url.includes('music.youtube.com/watch') ||
               url.includes('m.youtube.com/watch');
    }

    async search(query, limit = 10) {
        if (!this.initialized) return [];

        const cacheKey = `yt_search_${query}_${limit}`;
        const cached = this.getFromCache(cacheKey);
        if (cached) return cached;

        try {
            console.log(`🔍 [${this.name}] Searching YouTube: ${query}`);
            
            const results = await Promise.race([
                play.search(query, {
                    limit: Math.min(limit, 20),
                    source: { youtube: 'video' }
                }),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Search timeout')), 10000)
                )
            ]);

            const formattedResults = results
                .filter(video => video.type === 'video' && video.durationInSec < 1800) // Under 30 minutes
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
        if (!this.initialized) throw new Error('YouTube engine not initialized');

        // Clean and validate YouTube URL
        const cleanUrl = this.cleanYouTubeUrl(url);
        if (!cleanUrl) {
            throw new Error('Invalid YouTube URL');
        }

        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                console.log(`🎥 [${this.name}] Streaming attempt ${attempt}: ${cleanUrl}`);
                
                const stream = await Promise.race([
                    this.createYouTubeStream(cleanUrl),
                    new Promise((_, reject) => 
                        setTimeout(() => reject(new Error('Streaming timeout')), this.timeout)
                    )
                ]);

                if (stream && stream.readable) {
                    console.log(`✅ [${this.name}] Stream created successfully`);
                    
                    // Add metadata to stream
                    const trackInfo = await this.getTrackInfo(cleanUrl);
                    if (trackInfo) {
                        stream.trackInfo = trackInfo;
                    }
                    
                    return stream;
                }

                throw new Error('Stream not readable');
            } catch (error) {
                console.warn(`⚠️ [${this.name}] Attempt ${attempt} failed: ${error.message}`);
                if (attempt === this.maxRetries) {
                    throw new Error(`YouTube streaming failed after ${this.maxRetries} attempts: ${error.message}`);
                }
                
                // Progressive backoff
                await this.sleep(2000 * attempt);
                
                // Clear cache on retry to get fresh stream URLs
                this.clearStreamCache(cleanUrl);
            }
        }
    }

    async createYouTubeStream(url) {
        try {
            // Check cache for stream info
            const cacheKey = `stream_${url}`;
            const cached = this.getFromCache(cacheKey);
            
            let streamInfo;
            if (cached) {
                console.log('💾 Using cached YouTube stream info');
                streamInfo = cached;
            } else {
                // Get fresh stream info from play-dl
                streamInfo = await play.stream(url, { 
                    discordPlayerCompatibility: true,
                    quality: 2 // Use integer for quality (2 = lowest)
                });
                
                if (streamInfo && streamInfo.url) {
                    this.setCache(cacheKey, {
                        url: streamInfo.url,
                        type: streamInfo.type
                    });
                }
            }

            if (streamInfo && streamInfo.stream) {
                return streamInfo.stream;
            }

            if (streamInfo && streamInfo.url) {
                return await this.createDirectStream(streamInfo.url);
            }

            throw new Error('No stream URL available');
        } catch (error) {
            console.error(`❌ [${this.name}] YouTube stream creation failed:`, error.message);
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
                    'Accept': 'audio/webm,audio/ogg,audio/*,*/*',
                    'Accept-Encoding': 'identity',
                    'Connection': 'keep-alive',
                    'Range': 'bytes=0-'
                },
                maxRedirects: 3
            });

            response.data.pipe(stream);
            
            response.data.on('error', (error) => {
                console.error('❌ YouTube direct stream error:', error.message);
                stream.destroy(error);
            });

            response.data.on('end', () => {
                console.log(`✅ [${this.name}] Stream completed successfully`);
            });

        } catch (error) {
            console.error(`❌ [${this.name}] Direct stream failed:`, error.message);
            stream.destroy(error);
        }

        return stream;
    }

    async getTrackInfo(url) {
        if (!this.initialized) return null;

        const cleanUrl = this.cleanYouTubeUrl(url);
        if (!cleanUrl) return null;

        const cacheKey = `info_${cleanUrl}`;
        const cached = this.getFromCache(cacheKey, this.infoCacheTTL);
        if (cached) return cached;

        try {
            console.log(`📋 [${this.name}] Getting track info: ${cleanUrl}`);
            
            const info = await Promise.race([
                play.video_basic_info(cleanUrl),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Info timeout')), 8000)
                )
            ]);

            const trackInfo = this.formatTrackInfo(info);
            this.setCache(cacheKey, trackInfo, this.infoCacheTTL);
            return trackInfo;
        } catch (error) {
            console.error(`❌ [${this.name}] Track info failed: ${error.message}`);
            return this.createFallbackTrackInfo(cleanUrl);
        }
    }

    formatTrack(video) {
        if (video.type !== 'video') return null;
        
        return {
            title: video.title,
            author: video.channel?.name || 'Unknown',
            duration: this.formatDuration(video.durationInSec),
            durationMS: video.durationInSec * 1000,
            url: video.url,
            thumbnail: video.thumbnails?.[0]?.url,
            source: 'youtube',
            engine: this.name,
            id: video.id,
            views: video.views,
            uploadedAt: video.uploadedAt
        };
    }

    formatTrackInfo(info) {
        const details = info.video_details;
        return {
            title: details.title,
            author: details.channel?.name || 'Unknown',
            duration: this.formatDuration(details.durationInSec),
            durationMS: details.durationInSec * 1000,
            url: details.url,
            thumbnail: details.thumbnails?.[0]?.url,
            source: 'youtube',
            engine: this.name,
            id: details.id,
            views: details.views,
            description: details.description,
            uploadedAt: details.uploadedAt
        };
    }

    createFallbackTrackInfo(url) {
        // Extract video ID and create basic info
        const videoId = this.extractVideoId(url);
        return {
            title: `YouTube Video ${videoId}`,
            author: 'Unknown',
            duration: 'Unknown',
            durationMS: null,
            url: url,
            thumbnail: videoId ? `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg` : null,
            source: 'youtube',
            engine: this.name,
            id: videoId
        };
    }

    cleanYouTubeUrl(url) {
        try {
            // Remove playlist parameters and clean URL
            const urlObj = new URL(url);
            urlObj.searchParams.delete('list');
            urlObj.searchParams.delete('index');
            urlObj.searchParams.delete('t');
            
            // Convert youtu.be to youtube.com format
            if (urlObj.hostname === 'youtu.be') {
                return `https://www.youtube.com/watch?v=${urlObj.pathname.slice(1)}`;
            }
            
            return urlObj.toString();
        } catch (error) {
            console.error('❌ Failed to clean YouTube URL:', error.message);
            return url;
        }
    }

    extractVideoId(url) {
        const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
        return match ? match[1] : null;
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

    setCache(key, data, ttl = this.cacheTTL) {
        this.cache.set(key, {
            data,
            timestamp: Date.now(),
            ttl
        });
    }

    getFromCache(key, customTTL = null) {
        const cached = this.cache.get(key);
        if (cached) {
            const ttl = customTTL || cached.ttl || this.cacheTTL;
            if (Date.now() - cached.timestamp < ttl) {
                return cached.data;
            }
            this.cache.delete(key);
        }
        return null;
    }

    clearStreamCache(url) {
        const cacheKey = `stream_${url}`;
        this.cache.delete(cacheKey);
    }

    clearCache() {
        this.cache.clear();
    }

    getStatus() {
        return {
            name: this.name,
            priority: this.priority,
            initialized: this.initialized,
            supports: ['youtube', 'youtube-music', 'search'],
            requiresCookies: false,
            cacheSize: this.cache.size
        };
    }
}

module.exports = YouTubeEngine;