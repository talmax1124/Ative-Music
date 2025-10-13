const ytdl = require('@distube/ytdl-core');
const { spawn } = require('child_process');
const { PassThrough } = require('stream');
const fs = require('fs');
const path = require('path');

class HybridEngine {
    constructor() {
        this.name = 'hybrid';
        this.priority = -3; // HIGHEST PRIORITY
        this.initialized = true;
        this.timeout = 5000; // Fast timeout for streaming attempts
        
        // Define strategies in order of preference (streaming first, then download)
        this.strategies = [
            'ytdl_quick',      // Quick ytdl attempt
            'download_stream'  // Fast download + stream (fallback that works)
        ];
        
        this.tempDir = path.join(process.cwd(), 'temp_audio');
        if (!fs.existsSync(this.tempDir)) {
            fs.mkdirSync(this.tempDir, { recursive: true });
        }
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
        console.log(`⚡ [${this.name}] HYBRID STREAMING: ${url}`);
        
        const cleanUrl = this.cleanUrl(url);

        // Skip the problematic ytdl-core streaming attempt and go straight to yt-dlp
        console.log(`🚀 [${this.name}] Using PROVEN yt-dlp download method (skipping problematic ytdl-core)...`);
        try {
            const stream = await this.downloadAndStream(cleanUrl);
            const responseTime = Date.now() - startTime;
            console.log(`✅ [${this.name}] DOWNLOAD STREAM SUCCESS in ${responseTime}ms`);
            return stream;
        } catch (error) {
            console.error(`❌ [${this.name}] All methods failed: ${error.message}`);
            throw error;
        }
    }

    async tryQuickStream(url) {
        // Minimal ytdl attempt
        const stream = ytdl(url, {
            quality: 'lowestaudio',
            filter: 'audioonly',
            highWaterMark: 32 * 1024,
            requestOptions: { timeout: this.timeout }
        });

        const passThrough = new PassThrough();
        stream.pipe(passThrough);

        // If this fails quickly, we'll catch it in the timeout
        return passThrough;
    }

    async downloadAndStream(url) {
        console.log(`⬇️ [${this.name}] Fast download using yt-dlp...`);
        
        const videoId = this.extractVideoId(url);
        const outputPath = path.join(this.tempDir, `${videoId}_${Date.now()}.m4a`);

        return new Promise((resolve, reject) => {
            // Optimized yt-dlp command for speed
            const cookiesPath = path.join(process.cwd(), 'cookies.txt');
            const args = [
                '--format', 'worstaudio[ext=m4a]/bestaudio[ext=m4a]/worstaudio', // Prefer worstaudio for speed
                '--output', outputPath,
                '--no-playlist',
                '--no-warnings',
                '--quiet',
                '--socket-timeout', '10',
                '--retries', '2',
                '--no-check-certificate',
                '--geo-bypass',
                '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                url
            ];
            
            // Add cookies only if they exist
            if (fs.existsSync(cookiesPath)) {
                args.splice(-1, 0, '--cookies', cookiesPath);
                console.log(`🍪 [${this.name}] Using cookies for authentication`);
            }
            
            const ytDlpProcess = spawn('yt-dlp', args, {
                stdio: ['ignore', 'pipe', 'pipe']
            });

            let output = '';
            let errorOutput = '';

            ytDlpProcess.stdout.on('data', (data) => {
                output += data.toString();
            });

            ytDlpProcess.stderr.on('data', (data) => {
                errorOutput += data.toString();
                // Show progress if available
                const progress = data.toString().match(/(\d+\.?\d*)%/);
                if (progress) {
                    console.log(`📥 [${this.name}] Downloading: ${progress[1]}%`);
                }
            });

            ytDlpProcess.on('close', (code) => {
                if (code === 0 && fs.existsSync(outputPath)) {
                    console.log(`✅ [${this.name}] Download complete: ${(fs.statSync(outputPath).size / 1024 / 1024).toFixed(2)}MB`);
                    
                    // Create stream from downloaded file
                    const stream = fs.createReadStream(outputPath);
                    
                    // Clean up file after streaming
                    stream.on('end', () => {
                        fs.unlink(outputPath, (err) => {
                            if (err) console.warn(`⚠️ Failed to delete temp file: ${err.message}`);
                        });
                    });
                    
                    stream.on('error', (err) => {
                        fs.unlink(outputPath, () => {}); // Clean up on error
                    });

                    resolve(stream);
                } else {
                    console.error(`❌ [${this.name}] yt-dlp failed with code ${code}`);
                    if (errorOutput) console.error(`   Error: ${errorOutput}`);
                    reject(new Error(`yt-dlp download failed: code ${code}`));
                }
            });

            // Optimized timeout for faster downloads
            setTimeout(() => {
                ytDlpProcess.kill('SIGKILL');
                reject(new Error('Download timeout'));
            }, 20000); // 20 second timeout for optimized download
        });
    }

    async validateStream(stream) {
        return new Promise((resolve) => {
            let hasData = false;
            let hasError = false;

            const timeout = setTimeout(() => {
                stream.removeAllListeners();
                resolve(hasData && !hasError);
            }, 2000);

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

    async getTrackInfo(url) {
        try {
            const cleanUrl = this.cleanUrl(url);
            
            const info = await Promise.race([
                ytdl.getBasicInfo(cleanUrl),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Info timeout')), 3000)
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

    cleanUrl(url) {
        try {
            if (url.includes('youtu.be/')) {
                const id = url.split('/').pop().split('?')[0];
                return `https://www.youtube.com/watch?v=${id}`;
            }
            return url.split('&list=')[0].split('&index=')[0];
        } catch {
            return url;
        }
    }

    extractVideoId(url) {
        const match = url.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
        return match ? match[1] : Date.now().toString();
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
            supports: ['youtube-hybrid-streaming'],
            requiresCookies: false, // Engine handles this internally
            features: ['instant-stream-attempt', 'proven-download-fallback', 'automatic-cleanup']
        };
    }
}

module.exports = HybridEngine;