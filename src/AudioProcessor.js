const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const crypto = require('crypto');
const EventEmitter = require('events');

class AudioProcessor extends EventEmitter {
    constructor() {
        super();
        this.cacheDir = path.join(__dirname, '..', 'cache', 'audio');
        this.tempDir = path.join(__dirname, '..', 'cache', 'temp');
        this.ytDlpPath = process.env.YTDLP_PATH || 'yt-dlp';
        this.cookiesPath = path.join(__dirname, '..', 'cookies.txt');
        
        // Track processing status
        this.processingTracks = new Map();
        
        this.ensureDirectories();
    }

    ensureDirectories() {
        [this.cacheDir, this.tempDir].forEach(dir => {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
                console.log(`📁 Created directory: ${dir}`);
            }
        });
    }

    generateCacheKey(url) {
        return crypto.createHash('md5').update(url).digest('hex');
    }

    getCachedFile(url) {
        const cacheKey = this.generateCacheKey(url);
        const mp3Path = path.join(this.cacheDir, `${cacheKey}.mp3`);
        
        if (fs.existsSync(mp3Path)) {
            const stats = fs.statSync(mp3Path);
            const ageInHours = (Date.now() - stats.mtime.getTime()) / (1000 * 60 * 60);
            
            if (ageInHours < 24 && stats.size > 0) {
                console.log(`✅ Cache hit: ${cacheKey}.mp3`);
                return mp3Path;
            } else {
                console.log(`🗑️ Cache expired or empty: ${cacheKey}.mp3`);
                fs.unlinkSync(mp3Path);
            }
        }
        
        return null;
    }

    deleteCachedByUrl(url) {
        try {
            const cacheKey = this.generateCacheKey(url);
            const mp3Path = path.join(this.cacheDir, `${cacheKey}.mp3`);
            if (fs.existsSync(mp3Path)) {
                fs.unlinkSync(mp3Path);
                console.log(`🗑️ Deleted cached MP3 for url: ${url}`);
                return true;
            }
        } catch (e) {
            console.log(`⚠️ Failed to delete cached MP3: ${e.message}`);
        }
        return false;
    }

    async downloadAndConvert(url, title = 'Unknown', meta = {}) {
        const cachedFile = this.getCachedFile(url);
        if (cachedFile) {
            return { path: cachedFile, cached: true };
        }

        const cacheKey = this.generateCacheKey(url);
        const tempFile = path.join(this.tempDir, `${cacheKey}_temp`);
        const mp3Path = path.join(this.cacheDir, `${cacheKey}.mp3`);

        try {
            // Mark as processing
            this.processingTracks.set(cacheKey, { title, progress: 0, status: 'starting', meta });
            this.emit('progress', { cacheKey, title, progress: 0, status: 'Starting download...', ...meta });
            
            console.log(`⬇️ Downloading audio for: ${title}`);
            this.emit('progress', { cacheKey, title, progress: 10, status: 'Downloading audio...', ...meta });
            
            // Download audio-only format
            await this.downloadAudio(url, tempFile, cacheKey, title, meta);
            
            console.log(`🔄 Converting to MP3: ${title}`);
            this.emit('progress', { cacheKey, title, progress: 70, status: 'Converting to MP3...', ...meta });
            
            // Convert to MP3
            await this.convertToMp3(tempFile, mp3Path, cacheKey, title, meta);
            
            // Clean up temp file
            if (fs.existsSync(tempFile)) {
                fs.unlinkSync(tempFile);
            }
            
            console.log(`✅ Audio ready: ${cacheKey}.mp3`);
            this.emit('progress', { cacheKey, title, progress: 100, status: 'Ready to play!', ...meta });
            
            // Remove from processing map
            this.processingTracks.delete(cacheKey);
            
            return { path: mp3Path, cached: false };
            
        } catch (error) {
            // Clean up on error
            [tempFile, mp3Path].forEach(file => {
                if (fs.existsSync(file)) {
                    fs.unlinkSync(file);
                }
            });
            
            throw error;
        }
    }

    async downloadAudio(url, outputPath, cacheKey, title, meta = {}) {
        return new Promise((resolve, reject) => {
            const args = [
                // Audio-only format selection
                '--format', 'bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio/best',
                '--output', outputPath,
                '--no-playlist',
                '--no-warnings',
                '--prefer-insecure',
                '--no-check-certificates',
                '--geo-bypass',
                '--no-update',
                '--socket-timeout', '30',
                '--retries', '3',
                '--fragment-retries', '3',
                '--concurrent-fragments', '4',
                '--buffer-size', '16K',
                '--http-chunk-size', '1M'
            ];

            // Add cookies if available and valid
            if (fs.existsSync(this.cookiesPath)) {
                try {
                    const cookiesContent = fs.readFileSync(this.cookiesPath, 'utf8');
                    // Check for Netscape format header or actual cookie entries
                    if (cookiesContent.trim() && 
                        (cookiesContent.includes('Netscape HTTP Cookie File') || 
                         cookiesContent.includes('.youtube.com') ||
                         /^\.youtube\.com\t/m.test(cookiesContent))) {
                        args.push('--cookies', this.cookiesPath);
                        console.log('🍪 Using valid cookies for download');
                    } else {
                        console.log('⚠️ Cookies file appears empty or invalid, skipping');
                    }
                } catch (error) {
                    console.log('⚠️ Failed to read cookies file, continuing without cookies');
                }
            }

            // Add extractor args for better compatibility
            args.push('--extractor-args', 'youtube:player_client=tv_embedded');
            
            args.push(url);

            const ytdlp = spawn(this.ytDlpPath, args);
            let errorBuffer = '';
            let downloadProgress = 10;

            ytdlp.stderr.on('data', (data) => {
                errorBuffer += data.toString();
                const message = data.toString().trim();
                
                // Parse download progress from yt-dlp output
                if (message.includes('%')) {
                    const percentMatch = message.match(/(\d+(?:\.\d+)?)%/);
                    if (percentMatch) {
                        const percent = parseFloat(percentMatch[1]);
                        downloadProgress = 10 + (percent * 0.6); // 10-70% range for download
                        this.emit('progress', { 
                            cacheKey, 
                            title, 
                            progress: Math.floor(downloadProgress), 
                            status: `Downloading... ${percent.toFixed(1)}%`,
                            ...meta
                        });
                    }
                }
                
                if (message && !message.includes('Downloading') && !message.includes('%')) {
                    console.log(`yt-dlp: ${message}`);
                }
            });

            ytdlp.on('close', (code) => {
                if (code === 0 && fs.existsSync(outputPath)) {
                    console.log('✅ Audio downloaded successfully');
                    resolve();
                } else {
                    reject(new Error(`Download failed (code ${code}): ${errorBuffer}`));
                }
            });

            ytdlp.on('error', (error) => {
                reject(error);
            });
        });
    }

    async convertToMp3(inputPath, outputPath, cacheKey, title, meta = {}) {
        return new Promise((resolve, reject) => {
            const args = [
                '-i', inputPath,
                '-acodec', 'libmp3lame',
                '-b:a', '192k',
                '-ar', '44100',
                '-ac', '2',
                '-y', // Overwrite output
                outputPath
            ];

            const ffmpeg = spawn('ffmpeg', args);
            let errorBuffer = '';
            let conversionProgress = 70;

            ffmpeg.stderr.on('data', (data) => {
                errorBuffer += data.toString();
                const message = data.toString();
                
                // Parse FFmpeg progress
                if (message.includes('time=')) {
                    // Simple progress estimation for conversion (70-95%)
                    conversionProgress = Math.min(95, conversionProgress + 1);
                    this.emit('progress', { 
                        cacheKey, 
                        title, 
                        progress: conversionProgress, 
                        status: 'Converting to MP3...',
                        ...meta
                    });
                }
            });

            ffmpeg.on('close', (code) => {
                if (code === 0 && fs.existsSync(outputPath)) {
                    const stats = fs.statSync(outputPath);
                    console.log(`✅ Converted to MP3: ${(stats.size / 1024 / 1024).toFixed(2)}MB`);
                    this.emit('progress', { 
                        cacheKey, 
                        title, 
                        progress: 98, 
                        status: 'Finalizing...',
                        ...meta
                    });
                    resolve();
                } else {
                    reject(new Error(`FFmpeg conversion failed (code ${code}): ${errorBuffer}`));
                }
            });

            ffmpeg.on('error', (error) => {
                reject(error);
            });
        });
    }

    cleanCache(maxAgeHours = 24) {
        const now = Date.now();
        let cleaned = 0;
        let totalSize = 0;

        try {
            const files = fs.readdirSync(this.cacheDir);
            
            files.forEach(file => {
                const filePath = path.join(this.cacheDir, file);
                const stats = fs.statSync(filePath);
                
                // Only process files, skip directories
                if (stats.isFile()) {
                    const ageInHours = (now - stats.mtime.getTime()) / (1000 * 60 * 60);
                    
                    if (ageInHours > maxAgeHours) {
                        fs.unlinkSync(filePath);
                        cleaned++;
                        totalSize += stats.size;
                    }
                }
            });
            
            if (cleaned > 0) {
                console.log(`🧹 Cleaned ${cleaned} old cache files (${(totalSize / 1024 / 1024).toFixed(2)}MB)`);
            }
        } catch (error) {
            console.error('❌ Cache cleanup error:', error.message);
        }
    }

    getCacheStats() {
        try {
            const files = fs.readdirSync(this.cacheDir);
            let totalSize = 0;
            let fileCount = 0;
            
            files.forEach(file => {
                const stats = fs.statSync(path.join(this.cacheDir, file));
                totalSize += stats.size;
                fileCount++;
            });
            
            return {
                files: fileCount,
                sizeMB: (totalSize / 1024 / 1024).toFixed(2)
            };
        } catch (error) {
            return { files: 0, sizeMB: 0 };
        }
    }
}

module.exports = AudioProcessor;
