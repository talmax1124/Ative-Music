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
        // Allow overriding cookies path via env var, fallback to repo cookies.txt
        this.cookiesPath = process.env.COOKIES_PATH || path.join(__dirname, '..', 'cookies.txt');
        
        // Track processing status and processes for cancellation
        this.processingTracks = new Map(); // cacheKey -> { title, progress, status, meta }
        this.activeProcesses = new Map();   // cacheKey -> { ytdlp?, ffmpeg?, tempFile, mp3Path, meta }
        
        this.ensureDirectories();
    }

    ensureDirectories() {
        [this.cacheDir, this.tempDir].forEach(dir => {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
                console.log(`📁 Created directory: ${dir}`);
            }
        });
        
        // Clean up any stuck .part files
        try {
            const partFiles = fs.readdirSync(this.tempDir).filter(f => f.endsWith('.part'));
            partFiles.forEach(file => {
                try {
                    fs.unlinkSync(path.join(this.tempDir, file));
                    console.log(`🧹 Cleaned up stuck file: ${file}`);
                } catch (_) {}
            });
        } catch (_) {}
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
            this.activeProcesses.set(cacheKey, { tempFile, mp3Path, meta });
            this.emit('progress', { cacheKey, title, progress: 0, status: 'Starting download...', url, ...meta });
            
            console.log(`⬇️ Downloading audio for: ${title}`);
            this.emit('progress', { cacheKey, title, progress: 10, status: 'Downloading audio...', url, ...meta });
            
            // Download audio-only format and capture actual downloaded path
            let downloadedPath;
            try {
                downloadedPath = await this.downloadAudio(url, tempFile, cacheKey, title, meta);
            } catch (error) {
                // If primary download fails, try with more basic settings
                if (error.message.includes('Format unavailable') || error.message.includes('Requested format is not available')) {
                    console.log('🔄 Primary download failed, trying fallback method...');
                    this.emit('progress', { cacheKey, title, progress: 15, status: 'Retrying with fallback method...', url, ...meta });
                    downloadedPath = await this.downloadAudioFallback(url, tempFile, cacheKey, title, meta);
                } else {
                    throw error;
                }
            }
            
            console.log(`🔄 Converting to MP3: ${title}`);
            this.emit('progress', { cacheKey, title, progress: 70, status: 'Converting to MP3...', url, ...meta });
            
            // Convert to MP3
            await this.convertToMp3(downloadedPath, mp3Path, cacheKey, title, url, meta);
            
            // Clean up temp file
            if (fs.existsSync(downloadedPath)) {
                fs.unlinkSync(downloadedPath);
            }
            
            console.log(`✅ Audio ready: ${cacheKey}.mp3`);
            this.emit('progress', { cacheKey, title, progress: 100, status: 'Ready to play!', url, ...meta });
            
            // Remove from processing map
            this.processingTracks.delete(cacheKey);
            this.activeProcesses.delete(cacheKey);
            
            return { path: mp3Path, cached: false };
            
        } catch (error) {
            // Clean up on error
            [tempFile, mp3Path].forEach(file => {
                if (fs.existsSync(file)) {
                    fs.unlinkSync(file);
                }
            });
            this.processingTracks.delete(cacheKey);
            this.activeProcesses.delete(cacheKey);
            
            throw error;
        }
    }

    async downloadAudio(url, outputPath, cacheKey, title, meta = {}) {
        return new Promise((resolve, reject) => {
            const args = [
                '--no-config',
                // Optimize for VPS: prefer lower quality for faster download
                '--format', 'worstaudio/bestaudio[ext=m4a]/bestaudio',
                // Include extension placeholder so we can locate the real file
                '--output', `${outputPath}.%(ext)s`,
                '--no-playlist',
                '--no-warnings',
                '--prefer-insecure',
                '--no-check-certificates',
                '--geo-bypass',
                '--no-update',
                '--no-part',  // Prevent .part file issues
                '--no-continue',
                '--force-overwrites',
                '--socket-timeout', '8',
                '--retries', '2',
                '--fragment-retries', '2',
                '--concurrent-fragments', '8',
                '--buffer-size', '16K',
                '--http-chunk-size', '10M'
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
            // Use multiple client fallbacks: android is reliable, ios as backup, web as last resort
            args.push('--extractor-args', 'youtube:player_client=android,ios,web');
            // Add additional YouTube-specific options for better compatibility
            args.push('--no-check-certificate');
            args.push('--ignore-errors');  // Continue on errors when possible
            // Randomize UA slightly
            args.push('--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
            
            args.push(url);

            const ytdlp = spawn(this.ytDlpPath, args);
            // track process for potential cancellation
            try {
                const ap = this.activeProcesses.get(cacheKey) || {};
                ap.ytdlp = ytdlp;
                this.activeProcesses.set(cacheKey, ap);
            } catch {}
            let errorBuffer = '';
            let downloadProgress = 10;
            let lastProgressAt = Date.now();
            let lastProgressPct = 10;

            ytdlp.stderr.on('data', (data) => {
                errorBuffer += data.toString();
                const message = data.toString().trim();
                
                // Parse download progress from yt-dlp output
                if (message.includes('%')) {
                    const percentMatch = message.match(/(\d+(?:\.\d+)?)%/);
                    if (percentMatch) {
                        const percent = parseFloat(percentMatch[1]);
                        downloadProgress = 10 + (percent * 0.6); // 10-70% range for download
                        // Try to parse ETA if present, else estimate from rate of change
                        let etaSeconds = null;
                        const etaMatch = message.match(/ETA\s+(\d+):(\d{2})(?::(\d{2}))?/i);
                        if (etaMatch) {
                            const h = parseInt(etaMatch[1] || '0', 10);
                            const m = parseInt(etaMatch[2] || '0', 10);
                            const s = parseInt(etaMatch[3] || '0', 10);
                            etaSeconds = (h * 3600) + (m * 60) + s;
                        } else {
                            // Estimate based on delta progress over time
                            const now = Date.now();
                            const dt = (now - lastProgressAt) / 1000;
                            const dp = Math.max(0.0001, (downloadProgress - lastProgressPct));
                            const rate = dp / dt; // percent per second (scaled 0-100)
                            const remaining = Math.max(0, 70 - downloadProgress); // remaining percent in 10-70 band
                            if (rate > 0 && isFinite(rate)) {
                                etaSeconds = Math.round(remaining / rate);
                            }
                            lastProgressAt = now;
                            lastProgressPct = downloadProgress;
                        }
                        this.emit('progress', { 
                            cacheKey, 
                            title, 
                            progress: Math.floor(downloadProgress), 
                            status: `Downloading... ${percent.toFixed(1)}%`,
                            etaSeconds,
                            url,
                            ...meta
                        });
                    }
                }
                
                if (message && !message.includes('Downloading') && !message.includes('%')) {
                    console.log(`yt-dlp: ${message}`);
                }
            });

            ytdlp.on('close', (code) => {
                if (code === 0) {
                    // Determine actual downloaded file path (with extension)
                    try {
                        let finalPath = null;
                        // Direct match (in case yt-dlp saved without extension)
                        if (fs.existsSync(outputPath)) {
                            finalPath = outputPath;
                        } else {
                            const dir = path.dirname(outputPath);
                            const base = path.basename(outputPath) + '.';
                            const candidates = (fs.readdirSync(dir) || [])
                                .filter(f => f.startsWith(base) && !f.endsWith('.part'))
                                .map(f => path.join(dir, f));
                            if (candidates.length > 0) {
                                // Pick the newest candidate
                                candidates.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
                                finalPath = candidates[0];
                            }
                        }

                        if (finalPath && fs.existsSync(finalPath)) {
                            console.log('✅ Audio downloaded successfully');
                            // Update active process tempFile reference to real path
                            try {
                                const ap = this.activeProcesses.get(cacheKey) || {};
                                ap.tempFile = finalPath;
                                this.activeProcesses.set(cacheKey, ap);
                            } catch {}
                            return resolve(finalPath);
                        }
                    } catch (e) {
                        // Fall through to error below
                    }
                }
                
                // Enhanced error messages for common format issues
                let errorMsg = errorBuffer;
                if (errorBuffer.includes('Requested format is not available')) {
                    errorMsg = `Format unavailable - trying fallback extraction methods. Original error: ${errorBuffer}`;
                    console.log('⚠️ Primary format failed, this is normal - will retry with alternative methods');
                } else if (errorBuffer.includes('Sign in to confirm')) {
                    errorMsg = `YouTube sign-in required - using fallback extraction. Original error: ${errorBuffer}`;
                } else if (errorBuffer.includes('Video unavailable')) {
                    errorMsg = `Video unavailable or region restricted: ${errorBuffer}`;
                }
                
                reject(new Error(`Download failed (code ${code}): ${errorMsg}`));
            });

            ytdlp.on('error', (error) => {
                reject(error);
            });
        });
    }

    async downloadAudioFallback(url, outputPath, cacheKey, title, meta = {}) {
        return new Promise((resolve, reject) => {
            // Use very basic settings that should work with almost any video
            const args = [
                '--no-config',
                '--format', 'worst',  // Most basic format that should always be available
                '--output', `${outputPath}_fallback.%(ext)s`,
                '--no-playlist',
                '--no-warnings',
                '--ignore-errors',
                '--no-check-certificates',
                '--socket-timeout', '30',
                '--retries', '5',
                '--no-part'  // Prevent .part file issues
            ];

            // Don't use cookies for fallback to avoid auth issues
            console.log('🔄 Using basic fallback method without advanced options');
            
            args.push(url);

            const ytdlp = spawn(this.ytDlpPath, args);
            // track process for potential cancellation
            try {
                const ap = this.activeProcesses.get(cacheKey) || {};
                ap.ytdlp = ytdlp;
                this.activeProcesses.set(cacheKey, ap);
            } catch {}
            let errorBuffer = '';

            ytdlp.stderr.on('data', (data) => {
                errorBuffer += data.toString();
                const message = data.toString().trim();
                if (message && !message.includes('Downloading') && !message.includes('%')) {
                    console.log(`yt-dlp fallback: ${message}`);
                }
            });

            ytdlp.on('close', (code) => {
                if (code === 0) {
                    // Find the downloaded file
                    try {
                        const dir = path.dirname(outputPath);
                        const base = path.basename(outputPath) + '_fallback.';
                        const candidates = (fs.readdirSync(dir) || [])
                            .filter(f => f.startsWith(base) && !f.endsWith('.part'))
                            .map(f => path.join(dir, f));
                        
                        if (candidates.length > 0) {
                            candidates.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
                            const finalPath = candidates[0];
                            console.log('✅ Fallback download successful');
                            // Update active process tempFile reference
                            try {
                                const ap = this.activeProcesses.get(cacheKey) || {};
                                ap.tempFile = finalPath;
                                this.activeProcesses.set(cacheKey, ap);
                            } catch {}
                            return resolve(finalPath);
                        }
                    } catch (e) {
                        // Fall through to error
                    }
                }
                reject(new Error(`Fallback download failed (code ${code}): ${errorBuffer}`));
            });

            ytdlp.on('error', (error) => {
                reject(error);
            });
        });
    }

    async convertToMp3(inputPath, outputPath, cacheKey, title, url, meta = {}) {
        return new Promise((resolve, reject) => {
            const args = [
                '-i', inputPath,
                '-acodec', 'libmp3lame',
                '-b:a', '160k',  // Slightly lower bitrate for faster encoding
                '-ar', '44100',
                '-ac', '2',
                '-threads', '0',  // Use all available cores
                '-y', // Overwrite output
                outputPath
            ];

            const ffmpeg = spawn('ffmpeg', args);
            // track process for potential cancellation
            try {
                const ap = [...this.activeProcesses.entries()].find(([, v]) => v?.tempFile === inputPath)?.[1];
                if (ap) {
                    ap.ffmpeg = ffmpeg;
                }
            } catch {}
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
                    if (stats.size > 0) {
                        console.log(`✅ Converted to MP3: ${(stats.size / 1024 / 1024).toFixed(2)}MB`);
                        this.emit('progress', { 
                            cacheKey, 
                            title, 
                            progress: 98, 
                            status: 'Finalizing...',
                            url,
                            ...meta
                        });
                        resolve();
                        return;
                    }
                }
                // Only show error if conversion actually failed
                const errorMsg = code !== 0 ? `Exit code ${code}` : 'Output file empty or missing';
                reject(new Error(`FFmpeg conversion failed: ${errorMsg}`));
            });

            ffmpeg.on('error', (error) => {
                reject(error);
            });
        });
    }

    // Cancel any active yt-dlp/ffmpeg processes matching guild/channel context
    cancelByContext(guildId, channelId) {
        try {
            let cancelled = 0;
            for (const [cacheKey, procInfo] of this.activeProcesses.entries()) {
                const meta = (this.processingTracks.get(cacheKey) || procInfo || {}).meta || {};
                if (!guildId || !channelId || (meta.guildId === guildId && meta.channelId === channelId)) {
                    try { procInfo.ytdlp && procInfo.ytdlp.kill('SIGKILL'); } catch {}
                    try { procInfo.ffmpeg && procInfo.ffmpeg.kill('SIGKILL'); } catch {}
                    // attempt to clean temp if any
                    try { procInfo.tempFile && fs.existsSync(procInfo.tempFile) && fs.unlinkSync(procInfo.tempFile); } catch {}
                    this.processingTracks.delete(cacheKey);
                    this.activeProcesses.delete(cacheKey);
                    cancelled++;
                }
            }
            if (cancelled > 0) {
                console.log(`🛑 Cancelled ${cancelled} active download/conversion task(s)`);
            }
        } catch (e) {
            console.log('⚠️ Failed to cancel active processes:', e?.message || e);
        }
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
