const ytdl = require('@distube/ytdl-core');
const yts = require('yt-search');
const { PassThrough } = require('stream');

class YtdlCoreEngine {
    constructor() {
        this.name = 'ytdl-core';
        this.priority = 0; // Highest priority since it's proven to work
        this.initialized = true; // Always ready
        this.maxRetries = 3;
        this.timeout = 15000;
        
        this.cache = new Map();
        this.cacheTTL = 5 * 60 * 1000; // 5 minutes
        
        // ytdl-core options optimized for INSTANT streaming (no downloads)
        this.ytdlOptions = {
            quality: 'lowestaudio',
            filter: 'audioonly',
            highWaterMark: 32 * 1024, // Small 32KB buffer for instant start
            requestOptions: {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
                }
            },
            // Direct streaming options (no downloading/caching)
            begin: undefined, // Start immediately
            liveBuffer: 1000, // 1 second buffer for live streams
            dlChunkSize: 0, // Don't download chunks, pure stream
            range: undefined // Stream everything continuously
        };
    }

    async canHandle(url) {
        if (!url || typeof url !== 'string') return false;
        
        return url.includes('youtube.com/watch') || 
               url.includes('youtu.be/') ||
               url.includes('music.youtube.com/watch') ||
               url.includes('m.youtube.com/watch');
    }

    async search(query, limit = 10) {
        try {
            console.log(`🔍 [${this.name}] Searching YouTube: ${query}`);
            
            const searchResults = await yts(query);
            const videos = searchResults.videos.slice(0, Math.min(limit, 20));

            const formattedResults = videos
                .filter(video => video.duration && video.duration.seconds > 30) // Filter out very short videos
                .map(video => ({
                    title: video.title,
                    author: video.author?.name || 'Unknown',
                    url: video.url,
                    duration: video.duration?.timestamp || '0:00',
                    thumbnail: video.thumbnail,
                    source: 'youtube',
                    viewCount: video.views || 0,
                    publishedAt: video.ago
                }));

            console.log(`✅ [${this.name}] Found ${formattedResults.length} YouTube results`);
            return formattedResults;
        } catch (error) {
            console.error(`❌ [${this.name}] YouTube search failed: ${error.message}`);
            return [];
        }
    }

    formatDuration(seconds) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;
        
        if (hours > 0) {
            return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        }
        return `${minutes}:${secs.toString().padStart(2, '0')}`;
    }

    async getStream(url) {
        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                console.log(`🚀 [${this.name}] Streaming attempt ${attempt}: ${url}`);
                
                const stream = await Promise.race([
                    this.createYtdlStream(url),
                    new Promise((_, reject) => 
                        setTimeout(() => reject(new Error('Timeout')), this.timeout)
                    )
                ]);

                if (stream && stream.readable) {
                    console.log(`✅ [${this.name}] Stream created successfully`);
                    return stream;
                }

                throw new Error('Stream not readable');
            } catch (error) {
                console.warn(`⚠️ [${this.name}] Attempt ${attempt} failed: ${error.message}`);
                if (attempt === this.maxRetries) {
                    throw new Error(`ytdl-core streaming failed after ${this.maxRetries} attempts: ${error.message}`);
                }
                await this.sleep(1000 * attempt);
            }
        }
    }

    async createYtdlStream(url) {
        try {
            const cleanUrl = this.cleanYouTubeUrl(url);
            
            // Check if video is available
            const info = await ytdl.getInfo(cleanUrl);
            if (!info || !info.formats || info.formats.length === 0) {
                throw new Error('No formats available');
            }

            // Create optimized stream
            const stream = ytdl(cleanUrl, this.ytdlOptions);
            
            // Add error handling
            stream.on('error', (error) => {
                console.error(`❌ [${this.name}] Stream error: ${error.message}`);
            });

            return stream;
        } catch (error) {
            console.error(`❌ [${this.name}] ytdl stream creation failed: ${error.message}`);
            throw error;
        }
    }

    async getTrackInfo(url) {
        const cached = this.getFromCache(`info_${url}`);
        if (cached) return cached;

        try {
            const cleanUrl = this.cleanYouTubeUrl(url);
            console.log(`📋 [${this.name}] Getting track info: ${cleanUrl}`);
            
            const info = await Promise.race([
                ytdl.getBasicInfo(cleanUrl),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Info timeout')), 8000)
                )
            ]);

            const trackInfo = {
                title: info.videoDetails.title,
                author: info.videoDetails.author?.name || 'Unknown',
                duration: this.formatDuration(parseInt(info.videoDetails.lengthSeconds)),
                durationMS: parseInt(info.videoDetails.lengthSeconds) * 1000,
                url: info.videoDetails.video_url,
                thumbnail: info.videoDetails.thumbnails?.[0]?.url,
                source: 'youtube',
                engine: this.name,
                id: info.videoDetails.videoId,
                views: info.videoDetails.viewCount,
                description: info.videoDetails.description
            };

            this.setCache(`info_${url}`, trackInfo);
            return trackInfo;
        } catch (error) {
            console.error(`❌ [${this.name}] Track info failed: ${error.message}`);
            return this.createFallbackTrackInfo(url);
        }
    }

    createFallbackTrackInfo(url) {
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
            const urlObj = new URL(url);
            urlObj.searchParams.delete('list');
            urlObj.searchParams.delete('index');
            urlObj.searchParams.delete('t');
            
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
            supports: ['youtube', 'youtube-music'],
            requiresCookies: false,
            cacheSize: this.cache.size
        };
    }
}

module.exports = YtdlCoreEngine;