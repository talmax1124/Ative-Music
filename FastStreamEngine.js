const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { createReadStream, existsSync, statSync } = require('fs');

class FastStreamEngine {
    constructor() {
        this.cacheDir = path.join(__dirname, 'cache', 'fast_streams');
        this.tempDir = path.join(__dirname, 'cache', 'temp');
        this.ensureDirs();
        
        this.stats = {
            totalRequests: 0,
            cacheHits: 0,
            averageLatency: 0,
            errors: 0
        };
        
        console.log('⚡ FastStreamEngine initialized - Optimized for your system');
    }
    
    ensureDirs() {
        [this.cacheDir, this.tempDir].forEach(dir => {
            if (!existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
        });
    }
    
    generateCacheKey(url) {
        return crypto.createHash('md5').update(url).digest('hex');
    }
    
    getCachedPath(url) {
        const cacheKey = this.generateCacheKey(url);
        return path.join(this.cacheDir, `${cacheKey}.mp3`);
    }
    
    isCacheValid(filePath) {
        if (!existsSync(filePath)) return false;
        
        const stats = statSync(filePath);
        const ageInHours = (Date.now() - stats.mtime.getTime()) / (1000 * 60 * 60);
        
        return ageInHours < 24 && stats.size > 1000; // At least 1KB and less than 24 hours old
    }
    
    async createStream(url, title = 'Unknown') {
        const startTime = Date.now();
        this.stats.totalRequests++;
        
        try {
            console.log(`⚡ FastStream: ${title}`);
            
            // Check cache first
            const cachedPath = this.getCachedPath(url);
            if (this.isCacheValid(cachedPath)) {
                console.log(`💾 Cache hit: ${title}`);
                this.stats.cacheHits++;
                const latency = Date.now() - startTime;
                return {
                    stream: createReadStream(cachedPath),
                    cached: true,
                    latency: latency,
                    path: cachedPath
                };
            }
            
            // Download with optimized settings
            const outputPath = await this.downloadAudio(url, title);
            
            const latency = Date.now() - startTime;
            this.stats.averageLatency = (this.stats.averageLatency + latency) / 2;
            
            console.log(`⚡ FastStream SUCCESS: ${latency}ms - ${title}`);
            
            return {
                stream: createReadStream(outputPath),
                cached: false,
                latency: latency,
                path: outputPath
            };
            
        } catch (error) {
            this.stats.errors++;
            const latency = Date.now() - startTime;
            console.error(`❌ FastStream failed in ${latency}ms: ${error.message}`);
            throw error;
        }
    }
    
    async downloadAudio(url, title) {
        const cacheKey = this.generateCacheKey(url);
        const cachedPath = this.getCachedPath(url);
        const tempPath = path.join(this.tempDir, `${cacheKey}_temp`);
        
        return new Promise((resolve, reject) => {
            // Optimized yt-dlp args for your VPS setup
            const args = [
                '--no-config',
                '--format', 'worstaudio[ext=m4a]/bestaudio[ext=m4a]/worstaudio', // Prefer m4a for compatibility
                '--output', `${tempPath}.%(ext)s`,
                '--no-playlist',
                '--no-warnings',
                '--quiet',
                '--socket-timeout', '15',  // Longer timeout
                '--retries', '3',
                '--no-check-certificates',
                '--geo-bypass',
                '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                url
            ];
            
            const ytdlp = spawn('yt-dlp', args);
            let errorBuffer = '';
            
            ytdlp.stderr.on('data', (data) => {
                errorBuffer += data.toString();
            });
            
            ytdlp.on('close', async (code) => {
                if (code === 0) {
                    try {
                        // Find the downloaded file
                        const downloadedFile = this.findDownloadedFile(tempPath);
                        
                        if (downloadedFile && existsSync(downloadedFile)) {
                            // Convert to MP3 for consistency
                            await this.convertToMp3(downloadedFile, cachedPath);
                            
                            // Clean up temp file
                            try { fs.unlinkSync(downloadedFile); } catch (_) {}
                            
                            resolve(cachedPath);
                        } else {
                            reject(new Error('Downloaded file not found'));
                        }
                    } catch (conversionError) {
                        reject(conversionError);
                    }
                } else {
                    reject(new Error(`yt-dlp failed (${code}): ${errorBuffer.slice(-200)}`)); // Last 200 chars of error
                }
            });
            
            ytdlp.on('error', (error) => {
                reject(new Error(`yt-dlp spawn error: ${error.message}`));
            });
        });
    }
    
    findDownloadedFile(basePath) {
        const dir = path.dirname(basePath);
        const base = path.basename(basePath) + '.';
        
        try {
            const files = fs.readdirSync(dir);
            const candidates = files
                .filter(f => f.startsWith(base) && !f.endsWith('.part'))
                .map(f => path.join(dir, f));
                
            if (candidates.length > 0) {
                candidates.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
                return candidates[0];
            }
        } catch (_) {}
        
        return null;
    }
    
    async convertToMp3(inputPath, outputPath) {
        return new Promise((resolve, reject) => {
            const ffmpeg = spawn('ffmpeg', [
                '-i', inputPath,
                '-acodec', 'libmp3lame',
                '-b:a', '128k',  // Lower bitrate for VPS
                '-ar', '44100',
                '-ac', '2',
                '-y',
                outputPath
            ]);
            
            let errorBuffer = '';
            
            ffmpeg.stderr.on('data', (data) => {
                errorBuffer += data.toString();
            });
            
            ffmpeg.on('close', (code) => {
                if (code === 0 && existsSync(outputPath)) {
                    const stats = statSync(outputPath);
                    if (stats.size > 1000) { // At least 1KB
                        resolve();
                    } else {
                        reject(new Error('Output file too small'));
                    }
                } else {
                    reject(new Error(`FFmpeg failed (${code}): ${errorBuffer.slice(-200)}`));
                }
            });
            
            ffmpeg.on('error', reject);
        });
    }
    
    getStats() {
        return {
            totalRequests: this.stats.totalRequests,
            cacheHits: this.stats.cacheHits,
            cacheHitRate: this.stats.totalRequests > 0 
                ? ((this.stats.cacheHits / this.stats.totalRequests) * 100).toFixed(1) + '%'
                : '0%',
            averageLatency: Math.round(this.stats.averageLatency),
            errorRate: this.stats.totalRequests > 0 
                ? ((this.stats.errors / this.stats.totalRequests) * 100).toFixed(1) + '%'
                : '0%'
        };
    }
    
    cleanCache(maxAgeHours = 24) {
        try {
            const files = fs.readdirSync(this.cacheDir);
            let cleaned = 0;
            
            files.forEach(file => {
                const filePath = path.join(this.cacheDir, file);
                const stats = statSync(filePath);
                const ageInHours = (Date.now() - stats.mtime.getTime()) / (1000 * 60 * 60);
                
                if (ageInHours > maxAgeHours) {
                    fs.unlinkSync(filePath);
                    cleaned++;
                }
            });
            
            if (cleaned > 0) {
                console.log(`🧹 FastStream: Cleaned ${cleaned} old cache files`);
            }
        } catch (error) {
            console.error('FastStream cache cleanup error:', error.message);
        }
    }
    
    async shutdown() {
        console.log('🛑 FastStreamEngine shutting down...');
        this.cleanCache();
    }
}

module.exports = FastStreamEngine;