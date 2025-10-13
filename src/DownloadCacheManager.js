const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

class DownloadCacheManager {
    constructor() {
        this.cacheDir = path.join(__dirname, '../cache');
        this.maxCacheSize = 1024 * 1024 * 1024; // 1GB cache
        this.maxFileAge = 1000 * 60 * 60; // 1 hour
        this.pendingDownloads = new Map();
        
        // Ensure cache directory exists
        if (!fs.existsSync(this.cacheDir)) {
            fs.mkdirSync(this.cacheDir, { recursive: true });
        }
        
        // Clean cache on startup
        this.cleanupCache();
        
        // Schedule periodic cleanup
        setInterval(() => this.cleanupCache(), 1000 * 60 * 15); // Every 15 minutes
    }
    
    getCacheFilePath(videoId) {
        return path.join(this.cacheDir, `${videoId}.m4a`);
    }
    
    isFileCached(videoId) {
        const filepath = this.getCacheFilePath(videoId);
        if (fs.existsSync(filepath)) {
            const stats = fs.statSync(filepath);
            // Check if file is not too old
            if (Date.now() - stats.mtime.getTime() < this.maxFileAge) {
                return true;
            } else {
                // Remove old file
                try {
                    fs.unlinkSync(filepath);
                } catch (e) {
                    console.log(`⚠️ Failed to remove old cache file: ${e.message}`);
                }
            }
        }
        return false;
    }
    
    async downloadAndCache(videoId, videoUrl, title) {
        console.log(`⬇️ Downloading and caching: ${title}`);
        
        // Check if already downloading
        if (this.pendingDownloads.has(videoId)) {
            console.log(`⏳ Download already in progress for: ${title}`);
            return await this.pendingDownloads.get(videoId);
        }
        
        const filepath = this.getCacheFilePath(videoId);
        
        const downloadPromise = new Promise((resolve, reject) => {
            const ytdlpArgs = [
                '--no-config',
                '--format', 'bestaudio[ext=m4a]/bestaudio/best',
                '--output', filepath,
                '--no-warnings',
                '--no-playlist',
                '--no-check-certificates',
                '--prefer-insecure',
                '--force-ipv4',
                '--no-update',
                '--socket-timeout', '15',
                '--retries', '3',
                '--fragment-retries', '3',
                '--sleep-interval', '0',
                '--max-sleep-interval', '0',
                '--ignore-errors',
                '--no-abort-on-error',
                '--no-progress',
                '--embed-metadata',
                '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                videoUrl
            ];
            
            console.log(`🔧 yt-dlp download: ${videoUrl}`);
            const ytdlp = spawn('yt-dlp', ytdlpArgs);
            
            let errorOutput = '';
            
            ytdlp.stderr.on('data', (data) => {
                errorOutput += data.toString();
            });
            
            ytdlp.on('close', (code) => {
                if (code === 0 && fs.existsSync(filepath)) {
                    console.log(`✅ Downloaded and cached: ${title}`);
                    resolve(filepath);
                } else {
                    console.log(`❌ Download failed for: ${title} (code: ${code})`);
                    console.log(`Error: ${errorOutput}`);
                    reject(new Error(`Download failed with code ${code}`));
                }
            });
            
            ytdlp.on('error', (error) => {
                console.log(`❌ Download spawn error: ${error.message}`);
                reject(error);
            });
        });
        
        this.pendingDownloads.set(videoId, downloadPromise);
        
        try {
            const result = await downloadPromise;
            this.pendingDownloads.delete(videoId);
            return result;
        } catch (error) {
            this.pendingDownloads.delete(videoId);
            throw error;
        }
    }
    
    createReadStream(videoId) {
        const filepath = this.getCacheFilePath(videoId);
        if (!fs.existsSync(filepath)) {
            throw new Error(`Cached file not found: ${videoId}`);
        }
        
        console.log(`📂 Streaming from cache: ${videoId}`);
        return fs.createReadStream(filepath);
    }
    
    cleanupCache() {
        try {
            const files = fs.readdirSync(this.cacheDir);
            let totalSize = 0;
            const fileStats = [];
            
            for (const file of files) {
                const filepath = path.join(this.cacheDir, file);
                try {
                    const stats = fs.statSync(filepath);
                    
                    // Only process files, skip directories
                    if (stats.isFile()) {
                        totalSize += stats.size;
                        fileStats.push({
                            filepath,
                            size: stats.size,
                            age: Date.now() - stats.mtime.getTime()
                        });
                    }
                } catch (e) {
                    // File might have been deleted
                }
            }
            
            // Remove files older than maxFileAge
            const oldFiles = fileStats.filter(f => f.age > this.maxFileAge);
            for (const file of oldFiles) {
                try {
                    fs.unlinkSync(file.filepath);
                    totalSize -= file.size;
                    console.log(`🗑️ Removed old cache file: ${path.basename(file.filepath)}`);
                } catch (e) {
                    console.log(`⚠️ Failed to remove old file: ${e.message}`);
                }
            }
            
            // If still over size limit, remove oldest files
            if (totalSize > this.maxCacheSize) {
                const remainingFiles = fileStats
                    .filter(f => f.age <= this.maxFileAge)
                    .sort((a, b) => b.age - a.age); // Oldest first
                
                for (const file of remainingFiles) {
                    if (totalSize <= this.maxCacheSize * 0.8) break; // Leave some headroom
                    
                    try {
                        fs.unlinkSync(file.filepath);
                        totalSize -= file.size;
                        console.log(`🗑️ Removed cache file for space: ${path.basename(file.filepath)}`);
                    } catch (e) {
                        console.log(`⚠️ Failed to remove file: ${e.message}`);
                    }
                }
            }
            
            console.log(`🧹 Cache cleanup: ${Math.round(totalSize / 1024 / 1024)}MB used`);
        } catch (error) {
            console.log(`⚠️ Cache cleanup error: ${error.message}`);
        }
    }
    
    extractVideoId(url) {
        const patterns = [
            /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
            /^([a-zA-Z0-9_-]{11})$/ // Direct video ID
        ];
        
        for (const pattern of patterns) {
            const match = url.match(pattern);
            if (match) return match[1];
        }
        
        return null;
    }
}

module.exports = DownloadCacheManager;
