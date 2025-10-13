const ytdl = require('@distube/ytdl-core');
const { spawn } = require('child_process');
const { PassThrough } = require('stream');
const fs = require('fs');
const path = require('path');

class OptimizedHybridEngine {
    constructor() {
        this.name = 'hybrid';
        this.priority = -3; // HIGHEST PRIORITY
        this.initialized = true;
        this.timeout = 3000; // Reduced from 5000ms - more aggressive
        
        // Performance optimizations
        this.cache = new Map(); // Simple cache for recent requests
        this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
        
        // Define strategies in order of preference
        this.strategies = [
            'ytdl_optimized',  // Optimized ytdl attempt
            'download_stream'  // Fast download + stream (fallback that works)
        ];
        
        this.tempDir = path.join(process.cwd(), 'temp_audio');
        if (!fs.existsSync(this.tempDir)) {
            fs.mkdirSync(this.tempDir, { recursive: true });
        }
        
        // Cleanup old temp files on startup
        this.cleanupTempFiles();
        
        console.log('⚡ OptimizedHybridEngine loaded - Target: <8000ms (vs 11755ms)');
    }

    async canHandle(url) {
        return url && (
            url.includes('youtube.com/watch') || 
            url.includes('youtu.be/') ||
            url.includes('music.youtube.com')
        );
    }

    async search(query, limit = 10) {
        return []; // Streaming only
    }

    async getStream(url) {
        const startTime = Date.now();
        console.log(`⚡ [${this.name}] OPTIMIZED HYBRID STREAMING: ${url}`);
        
        const cleanUrl = this.cleanUrl(url);
        const cacheKey = this.extractVideoId(cleanUrl);

        // Check cache first
        if (this.cache.has(cacheKey)) {
            const cached = this.cache.get(cacheKey);
            if (Date.now() - cached.timestamp < this.cacheTimeout) {
                console.log(`💾 [${this.name}] Cache hit for ${cacheKey}`);
                // For cached items, skip straight to download (we know it works)
                return await this.downloadAndStreamOptimized(cleanUrl);
            } else {
                this.cache.delete(cacheKey);
            }
        }

        // Strategy 1: Try optimized streaming (shorter timeout)
        try {
            console.log(`🚀 [${this.name}] Attempting optimized stream...`);
            const stream = await Promise.race([
                this.tryOptimizedStream(cleanUrl),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Quick stream timeout')), this.timeout)
                )
            ]);

            if (stream && await this.validateStreamFast(stream)) {
                const responseTime = Date.now() - startTime;
                console.log(`✅ [${this.name}] FAST STREAM SUCCESS in ${responseTime}ms`);
                this.cache.set(cacheKey, { timestamp: Date.now(), method: 'stream' });
                return stream;
            }
        } catch (error) {
            console.log(`⚠️ [${this.name}] Fast stream failed: ${error.message}`);
        }

        // Strategy 2: Optimized download+stream
        console.log(`🔄 [${this.name}] Switching to OPTIMIZED download method...`);
        try {
            const stream = await this.downloadAndStreamOptimized(cleanUrl);
            const responseTime = Date.now() - startTime;
            console.log(`✅ [${this.name}] OPTIMIZED DOWNLOAD SUCCESS in ${responseTime}ms`);
            
            // Cache successful download method
            this.cache.set(cacheKey, { timestamp: Date.now(), method: 'download' });
            return stream;
        } catch (error) {
            console.error(`❌ [${this.name}] All optimized methods failed: ${error.message}`);
            throw error;
        }
    }

    async tryOptimizedStream(url) {
        // Optimized ytdl settings - avoid the decipher issues
        const stream = ytdl(url, {
            quality: 'lowestaudio',
            filter: 'audioonly',
            highWaterMark: 16 * 1024, // Reduced buffer
            requestOptions: { 
                timeout: this.timeout,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                }
            },
            // Skip signature parsing to avoid decipher warnings
            player: false,
            // Use android client which is more reliable
            player_client: 'android'
        });

        const passThrough = new PassThrough({ 
            highWaterMark: 16 * 1024,
            objectMode: false 
        });
        
        stream.pipe(passThrough);

        // Handle stream errors gracefully
        stream.on('error', (err) => {
            console.log(`⚠️ [${this.name}] Stream error (expected): ${err.message.slice(0, 50)}`);
            passThrough.destroy();
        });

        return passThrough;
    }

    async downloadAndStreamOptimized(url) {
        console.log(`⬇️ [${this.name}] OPTIMIZED download using yt-dlp...`);
        
        const videoId = this.extractVideoId(url);
        const outputPath = path.join(this.tempDir, `${videoId}_${Date.now()}.%(ext)s`);

        return new Promise((resolve, reject) => {
            // Optimized yt-dlp settings for your VPS
            const args = [
                '--format', 'worstaudio[ext=m4a]/bestaudio[ext=m4a]/worstaudio', // Prefer m4a, lower quality for speed
                '--output', outputPath,
                '--no-playlist',
                '--no-warnings',
                '--quiet',
                '--socket-timeout', '10',     // Shorter socket timeout
                '--retries', '2',             // Fewer retries
                '--fragment-retries', '1',    // Fewer fragment retries  
                '--concurrent-fragments', '4', // Fewer concurrent fragments for VPS
                '--buffer-size', '8K',        // Smaller buffer
                '--http-chunk-size', '5M',    // Smaller chunks
                '--no-check-certificate',
                '--geo-bypass',
                '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                url
            ];

            // Add cookies if they exist
            const cookiesPath = path.join(process.cwd(), 'cookies.txt');
            if (fs.existsSync(cookiesPath)) {
                args.splice(-1, 0, '--cookies', cookiesPath);
            }

            const ytDlpProcess = spawn('yt-dlp', args, {
                stdio: ['ignore', 'pipe', 'pipe']
            });

            let progressShown = false;
            let downloadPath = null;

            ytDlpProcess.stderr.on('data', (data) => {
                const output = data.toString();
                
                // Show progress less frequently
                const progress = output.match(/(\d+\.?\d*)%/);
                if (progress && !progressShown) {
                    console.log(`📥 [${this.name}] Downloading: ${progress[1]}%`);
                    progressShown = true;
                }
            });

            ytDlpProcess.on('close', (code) => {
                if (code === 0) {
                    // Find the actual downloaded file (yt-dlp adds extension)
                    try {
                        const dir = path.dirname(outputPath);
                        const baseName = path.basename(outputPath, '.%(ext)s');
                        const files = fs.readdirSync(dir).filter(f => f.startsWith(baseName + '_'));
                        
                        if (files.length > 0) {
                            downloadPath = path.join(dir, files[0]);
                            const size = (fs.statSync(downloadPath).size / 1024 / 1024).toFixed(2);
                            console.log(`✅ [${this.name}] Download complete: ${size}MB`);
                            
                            // Create optimized stream from downloaded file
                            const stream = this.createOptimizedFileStream(downloadPath);
                            resolve(stream);
                        } else {
                            reject(new Error('Downloaded file not found'));
                        }
                    } catch (error) {
                        reject(new Error(`File access error: ${error.message}`));
                    }
                } else {
                    reject(new Error(`yt-dlp failed with code ${code}`));
                }
            });

            ytDlpProcess.on('error', (error) => {
                reject(new Error(`yt-dlp spawn error: ${error.message}`));
            });

            // Longer timeout to prevent failures
            setTimeout(() => {
                ytDlpProcess.kill('SIGKILL');
                reject(new Error('Download timeout (45s)'));
            }, 45000); // Increased to 45s for reliability
        });
    }

    createOptimizedFileStream(filePath) {
        const stream = fs.createReadStream(filePath, {
            highWaterMark: 32 * 1024 // 32KB chunks for smooth streaming
        });
        
        // Enhanced cleanup
        const cleanup = () => {
            setTimeout(() => {
                fs.unlink(filePath, (err) => {
                    if (err && err.code !== 'ENOENT') {
                        console.warn(`⚠️ [${this.name}] Failed to delete temp file: ${err.message}`);
                    }
                });
            }, 1000); // Delay cleanup by 1 second
        };

        stream.on('end', cleanup);
        stream.on('close', cleanup);
        stream.on('error', (err) => {
            console.error(`❌ [${this.name}] Stream error: ${err.message}`);
            cleanup();
        });

        return stream;
    }

    async validateStreamFast(stream) {
        // Faster validation with shorter timeout
        return new Promise((resolve) => {
            let hasData = false;
            let hasError = false;

            const timeout = setTimeout(() => {
                stream.removeAllListeners();
                resolve(hasData && !hasError);
            }, 1000); // Reduced from 2000ms

            stream.once('data', () => {
                hasData = true;
                clearTimeout(timeout);
                stream.removeAllListeners();
                resolve(true);
            });

            stream.once('error', () => {
                hasError = true;
                clearTimeout(timeout);
                stream.removeAllListeners();
                resolve(false);
            });
        });
    }

    cleanupTempFiles() {
        try {
            if (!fs.existsSync(this.tempDir)) return;
            
            const files = fs.readdirSync(this.tempDir);
            let cleaned = 0;
            
            files.forEach(file => {
                const filePath = path.join(this.tempDir, file);
                const stats = fs.statSync(filePath);
                const ageMinutes = (Date.now() - stats.mtime.getTime()) / (1000 * 60);
                
                if (ageMinutes > 10) { // Clean files older than 10 minutes
                    fs.unlinkSync(filePath);
                    cleaned++;
                }
            });
            
            if (cleaned > 0) {
                console.log(`🧹 [${this.name}] Cleaned ${cleaned} old temp files`);
            }
        } catch (error) {
            console.warn(`⚠️ [${this.name}] Cleanup warning: ${error.message}`);
        }
    }

    async getTrackInfo(url) {
        try {
            const cleanUrl = this.cleanUrl(url);
            
            // Faster info retrieval with shorter timeout
            const info = await Promise.race([
                ytdl.getBasicInfo(cleanUrl, {
                    requestOptions: { timeout: 2000 } // Reduced timeout
                }),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Info timeout')), 2000)
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
                id: info.videoDetails.videoId
            };
        } catch (error) {
            return this.createFallbackInfo(url);
        }
    }

    createFallbackInfo(url) {
        const videoId = this.extractVideoId(url);
        return {
            title: 'YouTube Video',
            author: 'Unknown',
            duration: 'Unknown',
            url: url,
            source: 'youtube',
            engine: this.name,
            id: videoId
        };
    }

    getStatus() {
        return {
            name: this.name,
            priority: this.priority,
            supports: ['youtube-hybrid-streaming'],
            initialized: this.initialized,
            cacheSize: this.cache.size,
            optimizations: [
                'Reduced timeouts (3s vs 5s)',
                'Simple caching system',
                'Optimized yt-dlp settings for VPS',
                'Better temp file management',
                'Faster stream validation'
            ]
        };
    }

    // Utility methods (keep existing implementations)
    cleanUrl(url) {
        if (url.includes('youtu.be/')) {
            const videoId = url.split('youtu.be/')[1].split(/[?&]/)[0];
            return `https://www.youtube.com/watch?v=${videoId}`;
        }
        // Fix the URL parsing issue - preserve the full URL with query params
        if (url.includes('youtube.com/watch?v=')) {
            return url.split('#')[0]; // Only remove fragment, keep query params
        }
        return url;
    }

    extractVideoId(url) {
        const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/);
        return match ? match[1] : 'unknown';
    }

    formatDuration(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    supports = ['youtube-hybrid-streaming'];
}

module.exports = OptimizedHybridEngine;