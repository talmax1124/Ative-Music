const ytdl = require('@distube/ytdl-core');
const { PassThrough } = require('stream');
const { createAudioResource } = require('@discordjs/voice');

class FastStreamEngine {
    constructor() {
        this.name = 'fast-stream';
        this.priority = -1; // HIGHEST PRIORITY - try this first always
        this.initialized = true;
        this.maxRetries = 2; // Fewer retries for speed
        this.timeout = 8000; // Shorter timeout for instant response
        
        // Ultra-fast streaming options - NO downloads, NO caching, PURE streaming
        this.streamOptions = {
            quality: 'lowestaudio',
            filter: 'audioonly',
            highWaterMark: 16 * 1024, // Tiny 16KB buffer for instant start
            requestOptions: {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            }
        };
    }

    async canHandle(url) {
        if (!url || typeof url !== 'string') return false;
        
        return url.includes('youtube.com/watch') || 
               url.includes('youtu.be/') ||
               url.includes('music.youtube.com');
    }

    async search(query, limit = 10) {
        // This is a streaming-only engine, no search
        return [];
    }

    async getStream(url) {
        const startTime = Date.now();
        
        try {
            console.log(`⚡ [${this.name}] INSTANT STREAM: ${url}`);
            
            // Get stream URL super fast - no full info fetch
            const stream = await Promise.race([
                this.createInstantStream(url),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Fast timeout')), this.timeout)
                )
            ]);

            const responseTime = Date.now() - startTime;
            
            if (stream && stream.readable) {
                console.log(`🚀 [${this.name}] INSTANT SUCCESS in ${responseTime}ms - NO DOWNLOADS`);
                return stream;
            }

            throw new Error('Stream not available');
        } catch (error) {
            const responseTime = Date.now() - startTime;
            console.warn(`⚠️ [${this.name}] Fast stream failed in ${responseTime}ms: ${error.message}`);
            throw error;
        }
    }

    async createInstantStream(url) {
        // Clean URL quickly
        const cleanUrl = this.quickCleanUrl(url);
        
        // Try multiple approaches for instant streaming
        console.log(`🔥 [${this.name}] Creating instant stream (no downloads)...`);
        
        // Approach 1: Direct stream with aggressive options
        try {
            const directStream = ytdl(cleanUrl, {
                quality: 'lowestaudio',
                filter: 'audioonly',
                highWaterMark: 16 * 1024,
                requestOptions: {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                        'Accept': '*/*',
                        'Accept-Language': 'en-US,en;q=0.9',
                        'Accept-Encoding': 'identity',
                        'Connection': 'keep-alive'
                    },
                    timeout: 5000
                }
            });

            // Create passthrough for reliability
            const passThrough = new PassThrough({
                highWaterMark: 16 * 1024
            });
            
            let streamStarted = false;
            let errorCount = 0;
            
            directStream.on('data', (chunk) => {
                if (!streamStarted) {
                    streamStarted = true;
                    console.log(`🎵 [${this.name}] Audio data flowing - stream active!`);
                }
                passThrough.write(chunk);
            });
            
            directStream.on('end', () => {
                passThrough.end();
            });
            
            directStream.on('error', (error) => {
                errorCount++;
                console.warn(`⚠️ [${this.name}] Stream warning ${errorCount}: ${error.message}`);
                
                // If too many errors, fail the stream
                if (errorCount > 3 || error.message.includes('403')) {
                    console.error(`❌ [${this.name}] Too many errors, failing stream`);
                    passThrough.destroy(error);
                } else {
                    // For minor errors, continue
                    console.log(`🔄 [${this.name}] Continuing despite error...`);
                }
            });

            directStream.on('info', (info, format) => {
                console.log(`✅ [${this.name}] Stream info received - quality: ${format?.quality || 'unknown'}`);
            });

            return passThrough;
        } catch (error) {
            console.error(`❌ [${this.name}] Instant stream failed: ${error.message}`);
            throw error;
        }
    }

    async getTrackInfo(url) {
        const startTime = Date.now();
        
        try {
            const cleanUrl = this.quickCleanUrl(url);
            
            // Get ONLY basic info for speed
            const basicInfo = await Promise.race([
                ytdl.getBasicInfo(cleanUrl),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Info timeout')), 3000) // Very short timeout
                )
            ]);

            const responseTime = Date.now() - startTime;
            console.log(`📋 [${this.name}] Info fetched in ${responseTime}ms`);

            return {
                title: basicInfo.videoDetails.title,
                author: basicInfo.videoDetails.author?.name || 'Unknown',
                duration: this.formatDuration(parseInt(basicInfo.videoDetails.lengthSeconds)),
                durationMS: parseInt(basicInfo.videoDetails.lengthSeconds) * 1000,
                url: basicInfo.videoDetails.video_url,
                thumbnail: basicInfo.videoDetails.thumbnails?.[0]?.url,
                source: 'youtube',
                engine: this.name,
                id: basicInfo.videoDetails.videoId
            };
        } catch (error) {
            console.warn(`⚠️ [${this.name}] Info fetch failed, using fallback`);
            return this.createQuickFallback(url);
        }
    }

    createQuickFallback(url) {
        const videoId = this.extractVideoId(url);
        return {
            title: `YouTube Video`,
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

    quickCleanUrl(url) {
        // Super fast URL cleaning - no complex parsing
        if (url.includes('youtu.be/')) {
            const id = url.split('/').pop().split('?')[0];
            return `https://www.youtube.com/watch?v=${id}`;
        }
        
        // Remove common parameters quickly
        return url.split('&list=')[0].split('&index=')[0].split('&t=')[0];
    }

    extractVideoId(url) {
        const match = url.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
        return match ? match[1] : null;
    }

    formatDuration(seconds) {
        if (!seconds) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    getStatus() {
        return {
            name: this.name,
            priority: this.priority,
            initialized: this.initialized,
            supports: ['youtube-instant-streaming'],
            requiresCookies: false,
            features: ['no-downloads', 'instant-start', 'pure-streaming']
        };
    }
}

module.exports = FastStreamEngine;