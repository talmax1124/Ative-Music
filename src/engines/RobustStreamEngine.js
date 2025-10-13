const ytdl = require('@distube/ytdl-core');
const axios = require('axios');
const { PassThrough } = require('stream');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

class RobustStreamEngine {
    constructor() {
        this.name = 'robust-stream';
        this.priority = -2; // HIGHEST PRIORITY - bulletproof system
        this.initialized = true;
        this.maxRetries = 1; // Fast fail to next method
        this.timeout = 10000;
        
        // Multiple streaming strategies
        this.strategies = [
            'ytdl_direct',     // Direct ytdl streaming
            'ytdl_formats',    // ytdl with format selection
            'http_direct',     // Direct HTTP streaming
            'subprocess'       // yt-dlp subprocess as last resort
        ];
        
        this.cache = new Map();
        this.cacheTTL = 3 * 60 * 1000; // 3 minutes only
        
        // User agents pool
        this.userAgents = [
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        ];
    }

    async canHandle(url) {
        if (!url || typeof url !== 'string') return false;
        
        return url.includes('youtube.com/watch') || 
               url.includes('youtu.be/') ||
               url.includes('music.youtube.com');
    }

    async search(query, limit = 10) {
        return []; // Streaming only
    }

    async getStream(url) {
        const startTime = Date.now();
        console.log(`🛡️ [${this.name}] ROBUST STREAMING: ${url}`);
        
        const cleanUrl = this.cleanUrl(url);
        let lastError = null;
        
        // Try each strategy in order
        for (const strategy of this.strategies) {
            try {
                console.log(`🔄 [${this.name}] Trying strategy: ${strategy}`);
                const stream = await this.executeStrategy(strategy, cleanUrl);
                
                if (stream && stream.readable) {
                    // Test the stream for a moment to see if it actually works
                    const streamTest = await this.testStream(stream, strategy);
                    if (streamTest) {
                        const responseTime = Date.now() - startTime;
                        console.log(`✅ [${this.name}] SUCCESS with ${strategy} in ${responseTime}ms`);
                        return stream;
                    }
                }
            } catch (error) {
                lastError = error;
                console.warn(`⚠️ [${this.name}] ${strategy} failed: ${error.message}`);
                
                // Short pause between strategies to avoid rapid failures
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }
        
        throw new Error(`All streaming strategies failed. Last: ${lastError?.message}`);
    }

    async testStream(stream, strategy) {
        return new Promise((resolve) => {
            let hasError = false;
            let hasData = false;

            const cleanup = () => {
                clearTimeout(testTimeout);
                stream.removeAllListeners('data');
                stream.removeAllListeners('error');
            };

            const testTimeout = setTimeout(() => {
                cleanup();
                if (!hasData && !hasError) {
                    console.warn(`⚠️ [${this.name}] ${strategy} timeout - no data/errors`);
                    resolve(false);
                } else {
                    resolve(!hasError);
                }
            }, 1000); // Test for 1 second

            stream.once('data', () => {
                hasData = true;
                console.log(`🎵 [${this.name}] ${strategy} data flowing`);
                cleanup();
                resolve(true);
            });

            stream.once('error', (error) => {
                hasError = true;
                console.warn(`⚠️ [${this.name}] ${strategy} test error: ${error.message}`);
                cleanup();
                resolve(false);
            });
        });
    }

    async executeStrategy(strategy, url) {
        switch (strategy) {
            case 'ytdl_direct':
                return await this.ytdlDirectStream(url);
            case 'ytdl_formats':
                return await this.ytdlWithFormats(url);
            case 'http_direct':
                return await this.httpDirectStream(url);
            case 'subprocess':
                return await this.subprocessStream(url);
            default:
                throw new Error(`Unknown strategy: ${strategy}`);
        }
    }

    async ytdlDirectStream(url) {
        console.log(`🚀 [${this.name}] Direct ytdl streaming...`);
        
        // Ultra-minimal ytdl options for speed
        const stream = ytdl(url, {
            quality: 'lowestaudio',
            filter: 'audioonly',
            highWaterMark: 32 * 1024,
            requestOptions: {
                headers: {
                    'User-Agent': this.getRandomUserAgent()
                },
                timeout: 8000
            }
        });

        return this.wrapStream(stream, 'ytdl-direct');
    }

    async ytdlWithFormats(url) {
        console.log(`📋 [${this.name}] ytdl with format selection...`);
        
        // Get info first, then create optimized stream
        const info = await Promise.race([
            ytdl.getInfo(url),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Info timeout')), 8000))
        ]);

        // Find best audio format
        const audioFormats = info.formats.filter(f => 
            f.hasAudio && !f.hasVideo && f.container === 'webm'
        ).sort((a, b) => (a.audioBitrate || 0) - (b.audioBitrate || 0));

        if (audioFormats.length === 0) {
            throw new Error('No suitable audio formats found');
        }

        const format = audioFormats[0];
        console.log(`🎯 [${this.name}] Using format: ${format.itag} (${format.audioBitrate}kbps)`);

        const stream = ytdl(url, {
            format: format,
            requestOptions: {
                headers: {
                    'User-Agent': this.getRandomUserAgent()
                },
                timeout: 8000
            }
        });

        return this.wrapStream(stream, 'ytdl-formats');
    }

    async httpDirectStream(url) {
        console.log(`🌐 [${this.name}] HTTP direct streaming...`);
        
        // Get stream URL from ytdl info
        const info = await ytdl.getInfo(url);
        const audioFormats = info.formats.filter(f => f.hasAudio && !f.hasVideo);
        
        if (audioFormats.length === 0) {
            throw new Error('No audio formats available');
        }

        const format = audioFormats.sort((a, b) => (a.audioBitrate || 0) - (b.audioBitrate || 0))[0];
        const streamUrl = format.url;
        
        console.log(`🔗 [${this.name}] Direct HTTP to: ${streamUrl.substring(0, 100)}...`);

        const response = await axios({
            method: 'GET',
            url: streamUrl,
            responseType: 'stream',
            timeout: this.timeout,
            headers: {
                'User-Agent': this.getRandomUserAgent(),
                'Accept': 'audio/*,*/*',
                'Connection': 'keep-alive'
            },
            maxRedirects: 5
        });

        return this.wrapStream(response.data, 'http-direct');
    }

    async subprocessStream(url) {
        console.log(`⚡ [${this.name}] yt-dlp subprocess streaming...`);
        
        // Use yt-dlp to get best audio URL
        const ytDlpProcess = spawn('yt-dlp', [
            '--format', 'bestaudio[ext=webm]/bestaudio[ext=m4a]/bestaudio',
            '--get-url',
            '--no-playlist',
            url
        ], {
            stdio: ['ignore', 'pipe', 'ignore'],
            timeout: 8000
        });

        let streamUrl = '';
        ytDlpProcess.stdout.on('data', (data) => {
            streamUrl += data.toString();
        });

        await new Promise((resolve, reject) => {
            ytDlpProcess.on('close', (code) => {
                if (code === 0) resolve();
                else reject(new Error(`yt-dlp failed with code ${code}`));
            });
            
            setTimeout(() => {
                ytDlpProcess.kill();
                reject(new Error('yt-dlp timeout'));
            }, 8000);
        });

        streamUrl = streamUrl.trim();
        if (!streamUrl.startsWith('http')) {
            throw new Error('Invalid stream URL from yt-dlp');
        }

        console.log(`🎯 [${this.name}] yt-dlp URL: ${streamUrl.substring(0, 100)}...`);

        // Stream the URL directly
        const response = await axios({
            method: 'GET',
            url: streamUrl,
            responseType: 'stream',
            timeout: this.timeout,
            headers: {
                'User-Agent': this.getRandomUserAgent()
            }
        });

        return this.wrapStream(response.data, 'subprocess');
    }

    wrapStream(sourceStream, method) {
        const passThrough = new PassThrough({
            highWaterMark: 32 * 1024
        });

        let hasData = false;
        let errorCount = 0;

        sourceStream.on('data', (chunk) => {
            if (!hasData) {
                hasData = true;
                console.log(`🎵 [${this.name}] Audio flowing via ${method}`);
            }
            passThrough.write(chunk);
        });

        sourceStream.on('end', () => {
            console.log(`✅ [${this.name}] Stream ended via ${method}`);
            passThrough.end();
        });

        sourceStream.on('error', (error) => {
            errorCount++;
            console.warn(`⚠️ [${this.name}] ${method} error ${errorCount}: ${error.message}`);
            
            // For 403/404 errors, fail this method immediately but don't crash
            if (error.message.includes('403') || error.message.includes('404') || errorCount >= 2) {
                console.error(`❌ [${this.name}] ${method} failed - will try next strategy`);
                
                // Emit error on passThrough but don't crash the process
                passThrough.emit('error', new Error(`${method} failed: ${error.message}`));
            } else {
                console.log(`🔄 [${this.name}] ${method} continuing despite error`);
            }
        });

        // Timeout protection
        const timeout = setTimeout(() => {
            if (!hasData) {
                console.error(`❌ [${this.name}] ${method} timeout - no data received`);
                passThrough.destroy(new Error('Stream timeout'));
            }
        }, 15000);

        passThrough.on('close', () => clearTimeout(timeout));
        passThrough.on('end', () => clearTimeout(timeout));

        return passThrough;
    }

    async getTrackInfo(url) {
        try {
            const cleanUrl = this.cleanUrl(url);
            
            const info = await Promise.race([
                ytdl.getBasicInfo(cleanUrl),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Info timeout')), 5000)
                )
            ]);

            return {
                title: info.videoDetails.title,
                author: info.videoDetails.author?.name || 'Unknown',
                duration: this.formatDuration(parseInt(info.videoDetails.lengthSeconds)),
                durationMS: parseInt(info.videoDetails.lengthSeconds) * 1000,
                url: info.videoDetails.video_url,
                thumbnail: info.videoDetails.thumbnails?.[0]?.url,
                source: 'youtube',
                engine: this.name,
                id: info.videoDetails.videoId,
                views: info.videoDetails.viewCount
            };
        } catch (error) {
            console.warn(`⚠️ [${this.name}] Info failed, using fallback`);
            return this.createFallbackInfo(url);
        }
    }

    createFallbackInfo(url) {
        const videoId = this.extractVideoId(url);
        return {
            title: 'Unknown Title',
            author: 'Unknown Artist',
            duration: 'Unknown',
            durationMS: null,
            url: url,
            thumbnail: videoId ? `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg` : null,
            source: 'youtube',
            engine: this.name,
            id: videoId
        };
    }

    cleanUrl(url) {
        try {
            if (url.includes('youtu.be/')) {
                const id = url.split('/').pop().split('?')[0];
                return `https://www.youtube.com/watch?v=${id}`;
            }
            
            const urlObj = new URL(url);
            urlObj.searchParams.delete('list');
            urlObj.searchParams.delete('index');
            urlObj.searchParams.delete('t');
            return urlObj.toString();
        } catch {
            return url;
        }
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

    getRandomUserAgent() {
        return this.userAgents[Math.floor(Math.random() * this.userAgents.length)];
    }

    getStatus() {
        return {
            name: this.name,
            priority: this.priority,
            initialized: this.initialized,
            supports: ['youtube-robust-streaming'],
            requiresCookies: false,
            strategies: this.strategies.length,
            features: ['multi-strategy', 'error-recovery', 'timeout-protection']
        };
    }
}

module.exports = RobustStreamEngine;