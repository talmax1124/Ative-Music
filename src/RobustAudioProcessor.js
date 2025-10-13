const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const crypto = require('crypto');
const EventEmitter = require('events');
const https = require('https');
const http = require('http');

class RobustAudioProcessor extends EventEmitter {
    constructor() {
        super();
        this.cacheDir = path.join(__dirname, '..', 'cache', 'audio');
        this.tempDir = path.join(__dirname, '..', 'cache', 'temp');
        this.cookiesPath = process.env.COOKIES_PATH || path.join(__dirname, '..', 'cookies.txt');
        this.proxyUrl = process.env.PROXY_URL || null;
        
        // Check if cookies are available
        const hasCookies = fs.existsSync(this.cookiesPath);
        
        // Multiple extraction methods in order of preference
        // On VPS with cookies, yt-dlp-basic tends to work better
        this.extractors = hasCookies ? [
            { name: 'yt-dlp-basic', command: 'yt-dlp', priority: 1 },
            { name: 'yt-dlp-premium', command: 'yt-dlp', priority: 2 },
            { name: 'ytdl-core', command: null, priority: 3 },
            { name: 'direct-stream', command: null, priority: 4 }
        ] : [
            { name: 'yt-dlp-premium', command: 'yt-dlp', priority: 1 },
            { name: 'yt-dlp-basic', command: 'yt-dlp', priority: 2 },
            { name: 'ytdl-core', command: null, priority: 3 },
            { name: 'direct-stream', command: null, priority: 4 }
        ];
        
        // User agent rotation for different methods
        this.userAgents = [
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
            'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
            'Mozilla/5.0 (Android 13; Mobile; rv:110.0) Gecko/110.0 Firefox/110.0'
        ];
        
        // Track processing status
        this.processingTracks = new Map();
        this.activeProcesses = new Map();
        this.failureCache = new Map(); // Track what methods failed for URLs
        
        // Rate limiting and retry configuration
        this.retryConfig = {
            maxRetries: 3,
            baseDelay: 1000,
            maxDelay: 10000,
            backoffMultiplier: 2
        };
        
        this.ensureDirectories();
        this.initializeExtractors();
    }

    ensureDirectories() {
        [this.cacheDir, this.tempDir].forEach(dir => {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
                console.log(`📁 Created directory: ${dir}`);
            }
        });
        
        // Clean up any stuck temporary files
        this.cleanupTempFiles();
    }

    cleanupTempFiles() {
        try {
            const tempFiles = fs.readdirSync(this.tempDir);
            tempFiles.forEach(file => {
                if (file.endsWith('.part') || file.endsWith('.tmp')) {
                    try {
                        fs.unlinkSync(path.join(this.tempDir, file));
                        console.log(`🧹 Cleaned up temp file: ${file}`);
                    } catch (_) {}
                }
            });
        } catch (_) {}
    }

    async initializeExtractors() {
        // Check which extractors are available
        for (const extractor of this.extractors) {
            if (extractor.command) {
                try {
                    await this.testCommand(extractor.command);
                    extractor.available = true;
                    console.log(`✅ ${extractor.name} available`);
                } catch {
                    extractor.available = false;
                    console.log(`❌ ${extractor.name} not available`);
                }
            } else {
                extractor.available = true; // Built-in methods
            }
        }
    }

    testCommand(command) {
        return new Promise((resolve, reject) => {
            const proc = spawn(command, ['--version']);
            proc.on('close', (code) => {
                code === 0 ? resolve() : reject(new Error(`Command failed with code ${code}`));
            });
            proc.on('error', (error) => reject(error));
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
            
            if (ageInHours < 24 && stats.size > 1000) { // At least 1KB
                console.log(`✅ Cache hit: ${cacheKey}.mp3`);
                return mp3Path;
            } else {
                console.log(`🗑️ Cache expired: ${cacheKey}.mp3`);
                try { fs.unlinkSync(mp3Path); } catch (_) {}
            }
        }
        
        return null;
    }

    async downloadAndConvert(url, title = 'Unknown', meta = {}) {
        const cachedFile = this.getCachedFile(url);
        if (cachedFile) {
            return { path: cachedFile, cached: true };
        }

        const cacheKey = this.generateCacheKey(url);
        const mp3Path = path.join(this.cacheDir, `${cacheKey}.mp3`);

        // Mark as processing
        this.processingTracks.set(cacheKey, { title, progress: 0, status: 'starting', meta });
        this.emit('progress', { cacheKey, title, progress: 0, status: 'Starting download...', url, ...meta });

        // Try each extractor method in order
        const availableExtractors = this.extractors
            .filter(e => e.available)
            .sort((a, b) => a.priority - b.priority);

        let lastError = null;

        for (const extractor of availableExtractors) {
            try {
                console.log(`🔄 Trying ${extractor.name} for: ${title}`);
                this.emit('progress', { 
                    cacheKey, title, progress: 10, 
                    status: `Trying ${extractor.name}...`, url, ...meta 
                });

                const tempFile = await this.extractWithMethod(url, extractor, cacheKey, title, meta);
                
                if (tempFile && fs.existsSync(tempFile)) {
                    const stats = fs.statSync(tempFile);
                    if (stats.size > 1000) { // At least 1KB
                        console.log(`✅ Successfully extracted with ${extractor.name}: ${(stats.size / 1024 / 1024).toFixed(2)}MB`);
                        
                        // Convert to MP3
                        await this.convertToMp3(tempFile, mp3Path, cacheKey, title, url, meta);
                        
                        // Clean up temp file
                        try { fs.unlinkSync(tempFile); } catch (_) {}
                        
                        // Remove from processing
                        this.processingTracks.delete(cacheKey);
                        this.activeProcesses.delete(cacheKey);
                        
                        this.emit('progress', { 
                            cacheKey, title, progress: 100, 
                            status: 'Ready to play!', url, ...meta 
                        });
                        
                        return { path: mp3Path, cached: false, method: extractor.name };
                    } else {
                        throw new Error('Downloaded file is too small (likely empty)');
                    }
                } else {
                    throw new Error('No file downloaded or file not found');
                }
            } catch (error) {
                console.log(`❌ ${extractor.name} failed: ${error.message}`);
                lastError = error;
                
                // Add to failure cache
                const failures = this.failureCache.get(url) || [];
                failures.push({ method: extractor.name, error: error.message, timestamp: Date.now() });
                this.failureCache.set(url, failures);
                
                // Wait before trying next method
                await this.delay(1000);
            }
        }

        // All methods failed
        this.processingTracks.delete(cacheKey);
        this.activeProcesses.delete(cacheKey);
        
        throw new Error(`All extraction methods failed. Last error: ${lastError?.message || 'Unknown error'}`);
    }

    async extractWithMethod(url, extractor, cacheKey, title, meta) {
        const tempFile = path.join(this.tempDir, `${cacheKey}_${extractor.name}`);
        
        switch (extractor.name) {
            case 'yt-dlp-premium':
                return await this.extractWithYtDlpPremium(url, tempFile, cacheKey, title, meta);
            case 'yt-dlp-basic':
                return await this.extractWithYtDlpBasic(url, tempFile, cacheKey, title, meta);
            case 'ytdl-core':
                return await this.extractWithYtdlCore(url, tempFile, cacheKey, title, meta);
            case 'direct-stream':
                return await this.extractWithDirectStream(url, tempFile, cacheKey, title, meta);
            default:
                throw new Error(`Unknown extractor: ${extractor.name}`);
        }
    }

    async extractWithYtDlpPremium(url, outputPath, cacheKey, title, meta) {
        return new Promise((resolve, reject) => {
            const args = [
                '--no-config',
                '--format', 'bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio/best[height<=720]',
                '--output', `${outputPath}.%(ext)s`,
                '--no-playlist',
                '--write-thumbnail', 'false',
                '--no-warnings',
                '--socket-timeout', '15',
                '--retries', '5',
                '--fragment-retries', '5',
                '--user-agent', this.getRandomUserAgent(),
                '--referer', 'https://www.youtube.com/',
                '--add-header', 'Accept-Language:en-US,en;q=0.9',
                '--extractor-args', 'youtube:player_client=android,ios,web',
                '--geo-bypass',
                '--no-check-certificates'
            ];

            // Add cookies if available
            if (fs.existsSync(this.cookiesPath)) {
                try {
                    const cookiesContent = fs.readFileSync(this.cookiesPath, 'utf8');
                    if (cookiesContent.trim() && 
                        (cookiesContent.includes('Netscape HTTP Cookie File') || 
                         cookiesContent.includes('.youtube.com') ||
                         /^\.youtube\.com\t/m.test(cookiesContent))) {
                        args.push('--cookies', this.cookiesPath);
                        console.log('🍪 Using cookies for yt-dlp-premium');
                    }
                } catch (e) {
                    console.log('⚠️ Could not read cookies file');
                }
            }

            // Add proxy if configured
            if (this.proxyUrl) {
                args.push('--proxy', this.proxyUrl);
                console.log('🌐 Using proxy for yt-dlp-premium');
            }

            args.push(url);

            const proc = spawn('yt-dlp', args);
            let errorBuffer = '';

            proc.stderr.on('data', (data) => {
                errorBuffer += data.toString();
                this.parseProgressFromYtDlp(data.toString(), cacheKey, title, meta, 'premium');
            });

            proc.on('close', (code) => {
                if (code === 0) {
                    const finalPath = this.findDownloadedFile(outputPath);
                    resolve(finalPath);
                } else {
                    reject(new Error(`yt-dlp premium failed (${code}): ${errorBuffer}`));
                }
            });

            proc.on('error', reject);

            // Track process for cancellation
            const procInfo = this.activeProcesses.get(cacheKey) || {};
            procInfo.ytdlp = proc;
            this.activeProcesses.set(cacheKey, procInfo);
        });
    }

    async extractWithYtDlpBasic(url, outputPath, cacheKey, title, meta) {
        return new Promise((resolve, reject) => {
            const args = [
                '--no-config',
                '--format', 'worst/best',
                '--output', `${outputPath}.%(ext)s`,
                '--no-playlist',
                '--no-warnings',
                '--socket-timeout', '30',
                '--retries', '3',
                '--user-agent', this.getRandomUserAgent(),
                '--ignore-errors'
            ];

            // Add cookies if available
            if (fs.existsSync(this.cookiesPath)) {
                try {
                    const cookiesContent = fs.readFileSync(this.cookiesPath, 'utf8');
                    if (cookiesContent.trim() && 
                        (cookiesContent.includes('Netscape HTTP Cookie File') || 
                         cookiesContent.includes('.youtube.com') ||
                         /^\.youtube\.com\t/m.test(cookiesContent))) {
                        args.push('--cookies', this.cookiesPath);
                        console.log('🍪 Using cookies for yt-dlp-basic');
                    }
                } catch (e) {
                    console.log('⚠️ Could not read cookies file');
                }
            }

            // Add proxy if configured
            if (this.proxyUrl) {
                args.push('--proxy', this.proxyUrl);
                console.log('🌐 Using proxy for yt-dlp-basic');
            }

            args.push(url);

            const proc = spawn('yt-dlp', args);
            let errorBuffer = '';

            proc.stderr.on('data', (data) => {
                errorBuffer += data.toString();
                this.parseProgressFromYtDlp(data.toString(), cacheKey, title, meta, 'basic');
            });

            proc.on('close', (code) => {
                if (code === 0) {
                    const finalPath = this.findDownloadedFile(outputPath);
                    resolve(finalPath);
                } else {
                    reject(new Error(`yt-dlp basic failed (${code}): ${errorBuffer}`));
                }
            });

            proc.on('error', reject);
        });
    }

    async extractWithYtdlCore(url, outputPath, cacheKey, title, meta) {
        // This would use @distube/ytdl-core as a fallback
        // Implementation simplified for now
        throw new Error('ytdl-core extraction not implemented yet');
    }

    async extractWithDirectStream(url, outputPath, cacheKey, title, meta) {
        // Last resort: try to get any stream directly
        throw new Error('Direct stream extraction not implemented yet');
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
                // Return the newest file
                candidates.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
                return candidates[0];
            }
        } catch (_) {}
        
        return null;
    }

    parseProgressFromYtDlp(output, cacheKey, title, meta, method) {
        if (output.includes('%')) {
            const percentMatch = output.match(/(\d+(?:\.\d+)?)%/);
            if (percentMatch) {
                const percent = parseFloat(percentMatch[1]);
                const progress = Math.min(90, 10 + (percent * 0.8)); // 10-90% range
                
                this.emit('progress', {
                    cacheKey, title, progress: Math.floor(progress),
                    status: `Downloading (${method})... ${percent.toFixed(1)}%`,
                    ...meta
                });
            }
        }
    }

    async convertToMp3(inputPath, outputPath, cacheKey, title, url, meta) {
        return new Promise((resolve, reject) => {
            const args = [
                '-i', inputPath,
                '-acodec', 'libmp3lame',
                '-b:a', '128k',
                '-ar', '44100',
                '-ac', '2',
                '-threads', '0',
                '-y',
                outputPath
            ];

            this.emit('progress', {
                cacheKey, title, progress: 90,
                status: 'Converting to MP3...', url, ...meta
            });

            const proc = spawn('ffmpeg', args);
            let errorBuffer = '';

            proc.stderr.on('data', (data) => {
                errorBuffer += data.toString();
            });

            proc.on('close', (code) => {
                if (code === 0 && fs.existsSync(outputPath)) {
                    const stats = fs.statSync(outputPath);
                    if (stats.size > 1000) { // At least 1KB
                        console.log(`✅ Converted to MP3: ${(stats.size / 1024 / 1024).toFixed(2)}MB`);
                        resolve();
                        return;
                    }
                }
                reject(new Error(`FFmpeg failed (${code}): ${errorBuffer}`));
            });

            proc.on('error', reject);
        });
    }

    getRandomUserAgent() {
        return this.userAgents[Math.floor(Math.random() * this.userAgents.length)];
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Cancel active processes
    cancelByContext(guildId, channelId) {
        let cancelled = 0;
        for (const [cacheKey, procInfo] of this.activeProcesses.entries()) {
            const meta = (this.processingTracks.get(cacheKey) || {}).meta || {};
            if (!guildId || !channelId || (meta.guildId === guildId && meta.channelId === channelId)) {
                try {
                    if (procInfo.ytdlp) procInfo.ytdlp.kill('SIGKILL');
                    if (procInfo.ffmpeg) procInfo.ffmpeg.kill('SIGKILL');
                } catch (_) {}
                
                this.processingTracks.delete(cacheKey);
                this.activeProcesses.delete(cacheKey);
                cancelled++;
            }
        }
        if (cancelled > 0) {
            console.log(`🛑 Cancelled ${cancelled} active processes`);
        }
    }

    // Get processing status
    getProcessingStatus() {
        return Array.from(this.processingTracks.entries()).map(([key, info]) => ({
            cacheKey: key,
            ...info
        }));
    }

    // Clean cache
    cleanCache(maxAgeHours = 24) {
        const now = Date.now();
        let cleaned = 0;
        let totalSize = 0;

        try {
            const files = fs.readdirSync(this.cacheDir);
            
            files.forEach(file => {
                const filePath = path.join(this.cacheDir, file);
                const stats = fs.statSync(filePath);
                
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
}

module.exports = RobustAudioProcessor;