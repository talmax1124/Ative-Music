const ytdl = require('@distube/ytdl-core');
const yts = require('yt-search');
const YouTube = require('youtube-sr').default;
const SpotifyWebApi = require('spotify-web-api-node');
const fetch = require('node-fetch');
const config = require('../config.js');
const play = require('play-dl');
const { createReadStream } = require('fs');
const { createAudioResource, StreamType } = require('@discordjs/voice');
const RobustAudioProcessor = require('./RobustAudioProcessor');

class RobustSourceHandlers {
    constructor() {
        this.spotify = new SpotifyWebApi({
            clientId: config.spotify.clientId,
            clientSecret: config.spotify.clientSecret
        });
        
        // Initialize robust audio processor
        this.audioProcessor = new RobustAudioProcessor();
        
        // Track failed URLs to avoid repeated attempts
        this.failedUrls = new Map(); // url -> { count, lastAttempt }
        this.maxFailures = 3;
        this.failureCooldown = 300000; // 5 minutes
        
        // Stream cache for successful extractions
        this.streamCache = new Map();
        this.streamCacheTTL = 300000; // 5 minutes
        
        // Request rate limiting
        this.rateLimiter = {
            youtube: { requests: 0, resetTime: Date.now() + 60000, maxRequests: 100 },
            spotify: { requests: 0, resetTime: Date.now() + 60000, maxRequests: 200 }
        };
        
        this.setupSpotify();
        this.setupPlayDl();
        
        console.log('🎵 RobustSourceHandlers initialized');
    }

    async setupSpotify() {
        try {
            const data = await this.spotify.clientCredentialsGrant();
            this.spotify.setAccessToken(data.body['access_token']);
            console.log('✅ Spotify API initialized');
            
            // Refresh token periodically
            setInterval(async () => {
                try {
                    const data = await this.spotify.clientCredentialsGrant();
                    this.spotify.setAccessToken(data.body['access_token']);
                } catch (error) {
                    console.log('⚠️ Spotify token refresh failed:', error.message);
                }
            }, 3300000); // Refresh every 55 minutes
        } catch (error) {
            console.log('❌ Spotify initialization failed:', error.message);
        }
    }

    async setupPlayDl() {
        try {
            await play.setToken({
                spotify: {
                    client_id: config.spotify.clientId,
                    client_secret: config.spotify.clientSecret,
                    refresh_token: config.spotify.refreshToken,
                    market: 'US'
                }
            });
            console.log('✅ play-dl initialized');
        } catch (error) {
            console.log('⚠️ play-dl initialization failed:', error.message);
        }
    }

    // Main search function
    async search(query, limit = 10) {
        if (!query || typeof query !== 'string') {
            throw new Error('Invalid search query');
        }

        console.log(`🔍 Starting parallel search for: ${query}`);
        
        const results = await Promise.allSettled([
            this.searchSpotify(query, Math.ceil(limit / 2)),
            this.searchYouTube(query, Math.ceil(limit / 2))
        ]);

        const allResults = [];
        
        // Process Spotify results
        if (results[0].status === 'fulfilled') {
            console.log(`✅ Spotify found ${results[0].value.length} results`);
            allResults.push(...results[0].value);
        } else {
            console.log('❌ Spotify search failed:', results[0].reason?.message || 'Unknown error');
        }

        // Process YouTube results
        if (results[1].status === 'fulfilled') {
            console.log(`✅ YouTube found ${results[1].value.length} results`);
            allResults.push(...results[1].value);
        } else {
            console.log('❌ YouTube search failed:', results[1].reason?.message || 'Unknown error');
        }

        // Remove duplicates and limit results
        const uniqueResults = this.removeDuplicates(allResults);
        const finalResults = uniqueResults.slice(0, limit);
        
        console.log(`✅ Found ${finalResults.length} total results for: ${query}`);
        return finalResults;
    }

    async searchSpotify(query, limit = 10) {
        if (!this.checkRateLimit('spotify')) {
            throw new Error('Spotify rate limit exceeded');
        }

        try {
            const results = await this.spotify.searchTracks(query, { limit });
            this.rateLimiter.spotify.requests++;
            
            return results.body.tracks.items.map(track => ({
                title: track.name,
                artist: track.artists.map(a => a.name).join(', '),
                duration: Math.floor(track.duration_ms / 1000),
                url: `https://open.spotify.com/track/${track.id}`,
                thumbnail: track.album.images[0]?.url || null,
                platform: 'spotify',
                id: track.id
            }));
        } catch (error) {
            console.log('⚠️ Spotify search error:', error.message);
            throw error;
        }
    }

    async searchYouTube(query, limit = 10) {
        if (!this.checkRateLimit('youtube')) {
            throw new Error('YouTube rate limit exceeded');
        }

        try {
            // Use multiple search methods for better results
            const searchMethods = [
                () => this.searchYouTubeWithYtSearch(query, limit),
                () => this.searchYouTubeWithYoutubeSr(query, limit)
            ];

            for (const method of searchMethods) {
                try {
                    const results = await method();
                    this.rateLimiter.youtube.requests++;
                    return results;
                } catch (error) {
                    console.log('⚠️ YouTube search method failed, trying next...');
                }
            }
            
            throw new Error('All YouTube search methods failed');
        } catch (error) {
            console.log('⚠️ YouTube search error:', error.message);
            throw error;
        }
    }

    async searchYouTubeWithYtSearch(query, limit) {
        const results = await yts(query);
        return results.videos.slice(0, limit).map(video => ({
            title: video.title,
            artist: video.author.name,
            duration: video.duration.seconds,
            url: video.url,
            thumbnail: video.thumbnail,
            platform: 'youtube',
            id: video.videoId
        }));
    }

    async searchYouTubeWithYoutubeSr(query, limit) {
        const results = await YouTube.search(query, { limit, type: 'video' });
        return results.map(video => ({
            title: video.title,
            artist: video.channel?.name || 'Unknown',
            duration: video.duration / 1000,
            url: video.url,
            thumbnail: video.thumbnail?.url,
            platform: 'youtube',
            id: video.id
        }));
    }

    // Get audio stream for playback
    async getAudioStream(url, title = 'Unknown') {
        console.log(`🎵 Getting stream for: ${title}`);
        
        // Check if URL is in failed URLs cache
        if (this.isUrlFailed(url)) {
            throw new Error('URL previously failed multiple times, skipping');
        }

        // Check stream cache first
        const cachedStream = this.streamCache.get(url);
        if (cachedStream && Date.now() - cachedStream.timestamp < this.streamCacheTTL) {
            console.log(`💾 Using cached stream for: ${title}`);
            return cachedStream.resource;
        }

        // Try different streaming methods in order
        const streamMethods = [
            () => this.getStreamWithPlayDl(url, title),
            () => this.getStreamWithDownload(url, title),
            () => this.getStreamWithRobustProcessor(url, title)
        ];

        let lastError = null;

        for (const method of streamMethods) {
            try {
                const resource = await method();
                if (resource) {
                    console.log(`✅ Successfully got stream for: ${title}`);
                    
                    // Cache the successful resource
                    this.streamCache.set(url, { 
                        resource, 
                        timestamp: Date.now() 
                    });
                    
                    // Reset failure count
                    this.failedUrls.delete(url);
                    
                    return resource;
                }
            } catch (error) {
                console.log(`❌ Stream method failed: ${error.message}`);
                lastError = error;
            }
        }

        // Mark URL as failed
        this.markUrlAsFailed(url);
        throw new Error(`All streaming methods failed. Last error: ${lastError?.message || 'Unknown error'}`);
    }

    async getStreamWithPlayDl(url, title) {
        console.log(`⚡ Attempting play-dl streaming: ${title}`);
        
        try {
            // Check if play-dl can handle this URL
            const valid = await play.validate(url);
            if (!valid) {
                throw new Error('play-dl cannot handle this URL');
            }

            const stream = await play.stream(url);
            return createAudioResource(stream.stream, {
                inputType: stream.type,
                metadata: { title, url }
            });
        } catch (error) {
            throw new Error(`play-dl failed: ${error.message}`);
        }
    }

    async getStreamWithDownload(url, title) {
        console.log(`📥 Downloading & converting: ${title}`);
        
        try {
            const result = await this.audioProcessor.downloadAndConvert(url, title, {
                guildId: 'streaming',
                channelId: 'streaming'
            });

            if (result.path && require('fs').existsSync(result.path)) {
                const stream = createReadStream(result.path);
                return createAudioResource(stream, {
                    inputType: StreamType.Arbitrary,
                    metadata: { title, url, filePath: result.path }
                });
            } else {
                throw new Error('Download completed but file not found');
            }
        } catch (error) {
            throw new Error(`Download method failed: ${error.message}`);
        }
    }

    async getStreamWithRobustProcessor(url, title) {
        console.log(`🔧 Using robust processor for: ${title}`);
        
        // This would be an additional fallback method
        // For now, just throw to indicate it's not implemented
        throw new Error('Robust processor streaming not implemented yet');
    }

    // Get metadata for a URL
    async getMetadata(url) {
        try {
            // Try multiple metadata extraction methods
            const methods = [
                () => this.getMetadataWithYtdl(url),
                () => this.getMetadataWithYoutubeSr(url),
                () => this.getMetadataWithPlayDl(url)
            ];

            for (const method of methods) {
                try {
                    return await method();
                } catch (error) {
                    console.log(`⚠️ Metadata method failed: ${error.message}`);
                }
            }

            // Fallback to basic info
            return {
                title: 'Unknown Track',
                artist: 'Unknown Artist',
                duration: 0,
                thumbnail: null
            };
        } catch (error) {
            console.log(`⚠️ All metadata methods failed: ${error.message}`);
            return null;
        }
    }

    async getMetadataWithYtdl(url) {
        const info = await ytdl.getBasicInfo(url);
        return {
            title: info.videoDetails.title,
            artist: info.videoDetails.author.name,
            duration: parseInt(info.videoDetails.lengthSeconds),
            thumbnail: info.videoDetails.thumbnails?.[0]?.url
        };
    }

    async getMetadataWithYoutubeSr(url) {
        const video = await YouTube.getVideo(url);
        return {
            title: video.title,
            artist: video.channel?.name || 'Unknown',
            duration: video.duration / 1000,
            thumbnail: video.thumbnail?.url
        };
    }

    async getMetadataWithPlayDl(url) {
        const info = await play.video_info(url);
        return {
            title: info.video_details.title,
            artist: info.video_details.channel?.name || 'Unknown',
            duration: info.video_details.durationInSec,
            thumbnail: info.video_details.thumbnails?.[0]?.url
        };
    }

    // Utility functions
    removeDuplicates(results) {
        const seen = new Set();
        return results.filter(result => {
            const key = `${result.title}-${result.artist}`.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    checkRateLimit(service) {
        const limiter = this.rateLimiter[service];
        if (Date.now() > limiter.resetTime) {
            limiter.requests = 0;
            limiter.resetTime = Date.now() + 60000;
        }
        return limiter.requests < limiter.maxRequests;
    }

    isUrlFailed(url) {
        const failure = this.failedUrls.get(url);
        if (!failure) return false;
        
        if (failure.count >= this.maxFailures) {
            if (Date.now() - failure.lastAttempt < this.failureCooldown) {
                return true;
            } else {
                // Cooldown expired, reset
                this.failedUrls.delete(url);
                return false;
            }
        }
        return false;
    }

    markUrlAsFailed(url) {
        const failure = this.failedUrls.get(url) || { count: 0, lastAttempt: 0 };
        failure.count++;
        failure.lastAttempt = Date.now();
        this.failedUrls.set(url, failure);
        
        console.log(`⚠️ Marked URL as failed (${failure.count}/${this.maxFailures}): ${url}`);
    }

    // Clean up caches periodically
    cleanupCaches() {
        const now = Date.now();
        
        // Clean stream cache
        for (const [url, cache] of this.streamCache.entries()) {
            if (now - cache.timestamp > this.streamCacheTTL) {
                this.streamCache.delete(url);
            }
        }
        
        // Clean failed URLs cache
        for (const [url, failure] of this.failedUrls.entries()) {
            if (now - failure.lastAttempt > this.failureCooldown * 2) {
                this.failedUrls.delete(url);
            }
        }
        
        console.log('🧹 Cleaned up source handler caches');
    }

    // Start periodic cleanup
    startCleanupTimer() {
        setInterval(() => {
            this.cleanupCaches();
            this.audioProcessor.cleanCache();
        }, 300000); // Every 5 minutes
    }
}

module.exports = RobustSourceHandlers;