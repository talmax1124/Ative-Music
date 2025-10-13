const axios = require('axios');
const { PassThrough } = require('stream');

class DirectHTTPEngine {
    constructor() {
        this.name = 'direct-http';
        this.priority = 3; // Lower priority (fallback)
        this.initialized = true; // Always ready
        this.maxRetries = 3;
        this.timeout = 20000; // 20 seconds
        
        this.userAgents = [
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36'
        ];
    }

    async canHandle(url) {
        // Can handle direct audio URLs and some streaming URLs
        if (typeof url !== 'string') return false;
        
        const audioExtensions = ['.mp3', '.m4a', '.wav', '.ogg', '.aac', '.flac'];
        const streamingDomains = ['cdn.', 'stream.', 'audio.', 'media.'];
        
        return audioExtensions.some(ext => url.includes(ext)) ||
               streamingDomains.some(domain => url.includes(domain)) ||
               url.includes('googlevideo.com') ||
               url.includes('cloudfront.net');
    }

    async search(query, limit = 10) {
        // This engine doesn't perform searches, only direct streaming
        return [];
    }

    async getStream(url) {
        if (!url || typeof url !== 'string') {
            throw new Error('Invalid URL provided');
        }

        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                console.log(`🌐 [${this.name}] Direct streaming attempt ${attempt}: ${url}`);
                
                const stream = await this.createDirectStream(url);
                
                if (stream && stream.readable) {
                    console.log(`✅ [${this.name}] Direct stream created successfully`);
                    return stream;
                }
                
                throw new Error('Stream not readable');
            } catch (error) {
                console.warn(`⚠️ [${this.name}] Attempt ${attempt} failed: ${error.message}`);
                if (attempt === this.maxRetries) {
                    throw new Error(`Direct HTTP streaming failed after ${this.maxRetries} attempts: ${error.message}`);
                }
                await this.sleep(1000 * attempt);
            }
        }
    }

    async createDirectStream(url) {
        const stream = new PassThrough();
        
        try {
            console.log(`🔗 [${this.name}] Fetching direct stream: ${url}`);
            
            const response = await axios({
                method: 'GET',
                url: url,
                responseType: 'stream',
                timeout: this.timeout,
                headers: {
                    'User-Agent': this.getRandomUserAgent(),
                    'Accept': 'audio/*,*/*',
                    'Accept-Encoding': 'identity',
                    'Connection': 'keep-alive',
                    'Range': 'bytes=0-' // Support partial content
                },
                maxRedirects: 5
            });

            // Check if it's actually audio content
            const contentType = response.headers['content-type'] || '';
            if (!contentType.startsWith('audio/') && !contentType.includes('octet-stream')) {
                console.warn(`⚠️ [${this.name}] Unexpected content type: ${contentType}`);
            }

            response.data.pipe(stream);
            
            response.data.on('error', (error) => {
                console.error(`❌ [${this.name}] Stream error:`, error.message);
                stream.destroy(error);
            });

            response.data.on('end', () => {
                console.log(`✅ [${this.name}] Stream ended successfully`);
            });

        } catch (error) {
            console.error(`❌ [${this.name}] Direct stream creation failed:`, error.message);
            stream.destroy(error);
        }

        return stream;
    }

    async getTrackInfo(url) {
        try {
            // For direct HTTP streams, we can only get basic info
            const response = await axios.head(url, {
                timeout: 5000,
                headers: {
                    'User-Agent': this.getRandomUserAgent()
                }
            });

            const contentLength = response.headers['content-length'];
            const contentType = response.headers['content-type'];
            
            // Extract filename from URL if possible
            const urlParts = url.split('/');
            const filename = urlParts[urlParts.length - 1] || 'Unknown Track';
            const title = filename.replace(/\.[^/.]+$/, ''); // Remove extension

            return {
                title: title,
                author: 'Unknown Artist',
                duration: this.estimateDuration(contentLength),
                durationMS: null,
                url: url,
                thumbnail: null,
                source: 'direct-http',
                engine: this.name,
                contentType: contentType,
                size: contentLength
            };
        } catch (error) {
            console.error(`❌ [${this.name}] Failed to get track info:`, error.message);
            return null;
        }
    }

    estimateDuration(contentLength) {
        if (!contentLength) return 'Unknown';
        
        // Rough estimate: assume 128kbps MP3 (16KB/s)
        const estimatedSeconds = Math.floor(parseInt(contentLength) / 16000);
        return this.formatDuration(estimatedSeconds);
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

    getStatus() {
        return {
            name: this.name,
            priority: this.priority,
            initialized: this.initialized,
            supports: ['direct-urls', 'cdn-streams', 'audio-files'],
            requiresCookies: false
        };
    }
}

module.exports = DirectHTTPEngine;