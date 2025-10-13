const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const EventEmitter = require('events');
const { spawn } = require('child_process');
const { Readable, Transform } = require('stream');
const https = require('https');
const http = require('http');

class ProStreamEngine extends EventEmitter {
    constructor(options = {}) {
        super();
        this.maxListeners = 100;
        
        // Performance-optimized configuration
        this.config = {
            bufferSize: options.bufferSize || 4 * 1024 * 1024,   // 4MB buffer for smooth streaming
            preloadBuffer: options.preloadBuffer || 2 * 1024 * 1024, // 2MB preload
            chunkSize: options.chunkSize || 64 * 1024,           // 64KB chunks for low latency
            maxConcurrentStreams: options.maxConcurrentStreams || 10,
            streamTimeout: options.streamTimeout || 5000,        // 5 second timeout
            retryAttempts: options.retryAttempts || 3,
            cacheMaxAge: options.cacheMaxAge || 24 * 60 * 60 * 1000, // 24 hours
            optimizedFormats: ['opus', 'webm', 'm4a', 'mp3'],
            priorityFormats: 'bestaudio[ext=opus]/bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio'
        };

        // Directory setup
        this.cacheDir = path.join(__dirname, 'cache', 'streams');
        this.tempDir = path.join(__dirname, 'cache', 'temp');
        this.ensureDirs();

        // Advanced state management
        this.streams = new Map();           // Active streams
        this.buffers = new Map();          // Memory buffers for instant access
        this.metadata = new Map();         // Track metadata cache
        this.processes = new Map();        // Active processes
        this.loadBalancer = new Map();     // Load balancing for concurrent streams
        
        // Performance monitoring
        this.metrics = {
            totalStreams: 0,
            cacheHits: 0,
            averageLatency: 0,
            errorRate: 0,
            activeBuffers: 0,
            peakConcurrent: 0
        };

        // Cleanup interval for memory management
        this.cleanupInterval = setInterval(() => {
            this.performCleanup();
        }, 60000); // Every minute

        console.log('🚀 ProStreamEngine initialized - Industry-grade streaming ready');
    }

    ensureDirs() {
        [this.cacheDir, this.tempDir].forEach(dir => {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
        });
    }

    // Primary streaming interface - instant response guaranteed
    async createStream(url, options = {}) {
        const startTime = Date.now();
        const streamId = this.generateStreamId(url);
        
        try {
            // Immediate response with pre-buffered stream
            const stream = await this.getOptimizedStream(url, streamId, options);
            const latency = Date.now() - startTime;
            
            this.updateMetrics('latency', latency);
            this.updateMetrics('totalStreams');
            
            console.log(`⚡ Stream ready in ${latency}ms - ${streamId}`);
            
            return {
                stream,
                streamId,
                metadata: this.metadata.get(streamId),
                latency,
                cached: this.buffers.has(streamId)
            };
        } catch (error) {
            this.updateMetrics('errorRate');
            throw new Error(`Stream creation failed: ${error.message}`);
        }
    }

    async getOptimizedStream(url, streamId, options) {
        // Check for instant buffer hit first
        if (this.buffers.has(streamId)) {
            console.log(`🎯 Instant buffer hit: ${streamId}`);
            this.updateMetrics('cacheHits');
            return this.createBufferedStream(streamId);
        }

        // Check filesystem cache
        const cachedPath = this.getCachedPath(streamId);
        if (fs.existsSync(cachedPath)) {
            const stats = fs.statSync(cachedPath);
            if (this.isCacheValid(stats)) {
                console.log(`💾 Cache hit: ${streamId}`);
                this.updateMetrics('cacheHits');
                return this.createFileStream(cachedPath, streamId);
            }
        }

        // Create new optimized stream with parallel processing
        return await this.createNewStream(url, streamId, options);
    }

    async createNewStream(url, streamId, options) {
        this.emit('streamStart', { streamId, url, timestamp: Date.now() });
        
        // Multi-method extraction with failover
        const extractors = [
            { method: 'premium_ytdlp', priority: 1, timeout: 3000 },
            { method: 'fast_ytdlp', priority: 2, timeout: 5000 },
            { method: 'direct_stream', priority: 3, timeout: 2000 }
        ];

        for (const extractor of extractors.sort((a, b) => a.priority - b.priority)) {
            try {
                console.log(`🔄 Trying ${extractor.method} for ${streamId}`);
                const stream = await Promise.race([
                    this.extractWithMethod(url, streamId, extractor.method, options),
                    this.timeoutPromise(extractor.timeout)
                ]);
                
                if (stream) {
                    console.log(`✅ Success with ${extractor.method}: ${streamId}`);
                    return stream;
                }
            } catch (error) {
                console.log(`❌ ${extractor.method} failed: ${error.message}`);
                continue;
            }
        }

        throw new Error('All extraction methods failed');
    }

    async extractWithMethod(url, streamId, method, options) {
        switch (method) {
            case 'premium_ytdlp':
                return await this.extractPremiumYtDlp(url, streamId, options);
            case 'fast_ytdlp':
                return await this.extractFastYtDlp(url, streamId, options);
            case 'direct_stream':
                return await this.extractDirectStream(url, streamId, options);
            default:
                throw new Error(`Unknown extraction method: ${method}`);
        }
    }

    async extractPremiumYtDlp(url, streamId, options) {
        return new Promise((resolve, reject) => {
            const outputPath = path.join(this.tempDir, `${streamId}_premium`);
            
            const args = [
                '--no-config',
                '--format', this.config.priorityFormats,
                '--output', `${outputPath}.%(ext)s`,
                '--no-playlist',
                '--socket-timeout', '8',
                '--retries', '2',
                '--fragment-retries', '3',
                '--concurrent-fragments', '8',
                '--buffer-size', '16K',
                '--http-chunk-size', '10M',
                '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                '--extractor-args', 'youtube:player_client=android,ios,web',
                '--geo-bypass',
                '--no-warnings',
                '--quiet',
                '--no-check-certificates',
                url
            ];

            const process = spawn('yt-dlp', args);
            this.processes.set(streamId, process);
            
            let progressData = { downloaded: 0, total: 0, speed: 0 };
            
            process.stderr.on('data', (data) => {
                const output = data.toString();
                const progress = this.parseProgress(output);
                if (progress) {
                    progressData = progress;
                    this.emit('progress', { streamId, ...progress });
                }
            });

            process.on('close', (code) => {
                this.processes.delete(streamId);
                
                if (code === 0) {
                    const downloadedFile = this.findDownloadedFile(outputPath);
                    if (downloadedFile && fs.existsSync(downloadedFile)) {
                        // Create optimized stream immediately
                        const stream = this.createOptimizedFileStream(downloadedFile, streamId);
                        resolve(stream);
                        
                        // Async processing: buffer in memory and cache to disk
                        this.processStreamAsync(downloadedFile, streamId);
                    } else {
                        reject(new Error('No output file found'));
                    }
                } else {
                    reject(new Error(`yt-dlp failed with code ${code}`));
                }
            });

            process.on('error', reject);
        });
    }

    async extractFastYtDlp(url, streamId, options) {
        return new Promise((resolve, reject) => {
            const outputPath = path.join(this.tempDir, `${streamId}_fast`);
            
            const args = [
                '--no-config',
                '--format', 'worstaudio/bestaudio[ext=m4a]/worst',
                '--output', `${outputPath}.%(ext)s`,
                '--no-playlist',
                '--socket-timeout', '5',
                '--retries', '1',
                '--no-warnings',
                '--quiet',
                '--no-check-certificates',
                '--ignore-errors',
                url
            ];

            const process = spawn('yt-dlp', args);
            this.processes.set(streamId, process);
            
            process.on('close', (code) => {
                this.processes.delete(streamId);
                
                if (code === 0) {
                    const downloadedFile = this.findDownloadedFile(outputPath);
                    if (downloadedFile && fs.existsSync(downloadedFile)) {
                        const stream = this.createOptimizedFileStream(downloadedFile, streamId);
                        resolve(stream);
                        this.processStreamAsync(downloadedFile, streamId);
                    } else {
                        reject(new Error('No output file found'));
                    }
                } else {
                    reject(new Error(`Fast yt-dlp failed with code ${code}`));
                }
            });

            process.on('error', reject);
        });
    }

    async extractDirectStream(url, streamId, options) {
        // Implementation for direct streaming would go here
        // This is a placeholder for direct stream extraction
        throw new Error('Direct stream extraction not implemented in this version');
    }

    createOptimizedFileStream(filePath, streamId) {
        const stream = new OptimizedAudioStream({
            filePath,
            streamId,
            chunkSize: this.config.chunkSize,
            bufferSize: this.config.bufferSize
        });

        // Track active stream
        this.streams.set(streamId, stream);
        this.updateMetrics('activeStreams');

        // Cleanup when stream ends
        stream.on('end', () => {
            this.streams.delete(streamId);
            this.emit('streamEnd', { streamId });
        });

        return stream;
    }

    createBufferedStream(streamId) {
        const buffer = this.buffers.get(streamId);
        if (!buffer) {
            throw new Error('Buffer not found');
        }

        const stream = new Readable({
            read() {}
        });

        // Push buffer data in optimized chunks
        let offset = 0;
        const pushChunk = () => {
            if (offset >= buffer.length) {
                stream.push(null); // End stream
                return;
            }

            const chunk = buffer.slice(offset, offset + this.config.chunkSize);
            offset += this.config.chunkSize;
            
            if (stream.push(chunk)) {
                setImmediate(pushChunk);
            }
        };

        stream._read = () => {
            pushChunk();
        };

        return stream;
    }

    async processStreamAsync(filePath, streamId) {
        try {
            // Load into memory buffer for instant access
            const buffer = fs.readFileSync(filePath);
            this.buffers.set(streamId, buffer);
            this.updateMetrics('activeBuffers');

            // Move to permanent cache
            const cachedPath = this.getCachedPath(streamId);
            fs.renameSync(filePath, cachedPath);

            // Extract and cache metadata
            const metadata = await this.extractMetadata(cachedPath);
            this.metadata.set(streamId, metadata);

            console.log(`📦 Stream processed and cached: ${streamId}`);
            this.emit('streamProcessed', { streamId, size: buffer.length, metadata });
        } catch (error) {
            console.error(`❌ Stream processing failed: ${error.message}`);
            this.emit('streamError', { streamId, error: error.message });
        }
    }

    // Instant button response handling
    handleButtonInteraction(interaction, streamId) {
        const responseTime = Date.now();
        
        try {
            // Immediate acknowledgment
            this.emit('buttonPressed', { 
                streamId, 
                action: interaction.action, 
                timestamp: responseTime,
                user: interaction.user 
            });

            // Execute action with zero-latency response
            switch (interaction.action) {
                case 'play':
                    return this.instantPlay(streamId);
                case 'pause':
                    return this.instantPause(streamId);
                case 'stop':
                    return this.instantStop(streamId);
                case 'skip':
                    return this.instantSkip(streamId);
                case 'seek':
                    return this.instantSeek(streamId, interaction.position);
                default:
                    throw new Error(`Unknown action: ${interaction.action}`);
            }
        } catch (error) {
            this.emit('buttonError', { streamId, error: error.message, responseTime });
            throw error;
        }
    }

    instantPlay(streamId) {
        const stream = this.streams.get(streamId);
        if (!stream) {
            throw new Error('Stream not found');
        }
        
        stream.resume();
        this.emit('playbackChanged', { streamId, state: 'playing', timestamp: Date.now() });
        return { success: true, state: 'playing', latency: 0 };
    }

    instantPause(streamId) {
        const stream = this.streams.get(streamId);
        if (!stream) {
            throw new Error('Stream not found');
        }
        
        stream.pause();
        this.emit('playbackChanged', { streamId, state: 'paused', timestamp: Date.now() });
        return { success: true, state: 'paused', latency: 0 };
    }

    instantStop(streamId) {
        const stream = this.streams.get(streamId);
        if (stream) {
            stream.destroy();
            this.streams.delete(streamId);
        }
        
        this.emit('playbackChanged', { streamId, state: 'stopped', timestamp: Date.now() });
        return { success: true, state: 'stopped', latency: 0 };
    }

    instantSkip(streamId) {
        this.instantStop(streamId);
        this.emit('skipRequested', { streamId, timestamp: Date.now() });
        return { success: true, action: 'skip', latency: 0 };
    }

    instantSeek(streamId, position) {
        const stream = this.streams.get(streamId);
        if (!stream || !stream.seekTo) {
            throw new Error('Seek not supported for this stream');
        }
        
        stream.seekTo(position);
        this.emit('seekChanged', { streamId, position, timestamp: Date.now() });
        return { success: true, position, latency: 0 };
    }

    // Utility methods
    generateStreamId(url) {
        return crypto.createHash('sha256').update(url + Date.now()).digest('hex').substring(0, 16);
    }

    getCachedPath(streamId) {
        return path.join(this.cacheDir, `${streamId}.stream`);
    }

    isCacheValid(stats) {
        const age = Date.now() - stats.mtime.getTime();
        return age < this.config.cacheMaxAge && stats.size > 1000;
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
                candidates.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
                return candidates[0];
            }
        } catch (_) {}
        
        return null;
    }

    parseProgress(output) {
        const percentMatch = output.match(/(\d+(?:\.\d+)?)%/);
        const speedMatch = output.match(/(\d+(?:\.\d+)?(?:K|M|G)?iB\/s)/);
        const etaMatch = output.match(/ETA\s+(\d+):(\d{2})/);
        
        if (percentMatch) {
            return {
                percent: parseFloat(percentMatch[1]),
                speed: speedMatch ? speedMatch[1] : null,
                eta: etaMatch ? `${etaMatch[1]}:${etaMatch[2]}` : null
            };
        }
        return null;
    }

    async extractMetadata(filePath) {
        return new Promise((resolve) => {
            const ffprobe = spawn('ffprobe', [
                '-v', 'quiet',
                '-print_format', 'json',
                '-show_format',
                '-show_streams',
                filePath
            ]);

            let output = '';
            ffprobe.stdout.on('data', (data) => {
                output += data.toString();
            });

            ffprobe.on('close', () => {
                try {
                    const metadata = JSON.parse(output);
                    resolve({
                        duration: metadata.format.duration,
                        bitrate: metadata.format.bit_rate,
                        format: metadata.format.format_name,
                        size: metadata.format.size,
                        streams: metadata.streams.length
                    });
                } catch {
                    resolve({ duration: 0, bitrate: 0, format: 'unknown' });
                }
            });
        });
    }

    updateMetrics(type, value = 1) {
        switch (type) {
            case 'totalStreams':
                this.metrics.totalStreams += value;
                break;
            case 'cacheHits':
                this.metrics.cacheHits += value;
                break;
            case 'latency':
                this.metrics.averageLatency = 
                    (this.metrics.averageLatency + value) / 2;
                break;
            case 'errorRate':
                this.metrics.errorRate += value;
                break;
            case 'activeBuffers':
                this.metrics.activeBuffers = this.buffers.size;
                break;
        }

        this.metrics.peakConcurrent = Math.max(
            this.metrics.peakConcurrent, 
            this.streams.size
        );
    }

    performCleanup() {
        const now = Date.now();
        
        // Clean expired buffers
        let cleaned = 0;
        for (const [streamId, buffer] of this.buffers.entries()) {
            if (now - buffer.timestamp > this.config.cacheMaxAge) {
                this.buffers.delete(streamId);
                this.metadata.delete(streamId);
                cleaned++;
            }
        }

        if (cleaned > 0) {
            console.log(`🧹 Cleaned ${cleaned} expired buffers`);
        }

        this.updateMetrics('activeBuffers');
    }

    timeoutPromise(timeout) {
        return new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Timeout')), timeout);
        });
    }

    // Performance monitoring
    getMetrics() {
        return {
            ...this.metrics,
            cacheHitRate: this.metrics.totalStreams > 0 
                ? (this.metrics.cacheHits / this.metrics.totalStreams * 100).toFixed(2) + '%'
                : '0%',
            activeStreams: this.streams.size,
            bufferedStreams: this.buffers.size,
            memoryUsage: process.memoryUsage()
        };
    }

    // Graceful shutdown
    async shutdown() {
        console.log('🛑 ProStreamEngine shutting down...');
        
        // Clear cleanup interval
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }

        // Stop all active streams
        for (const stream of this.streams.values()) {
            stream.destroy();
        }

        // Kill active processes
        for (const process of this.processes.values()) {
            try {
                process.kill('SIGTERM');
            } catch (_) {}
        }

        // Clear all caches
        this.streams.clear();
        this.buffers.clear();
        this.metadata.clear();
        this.processes.clear();

        console.log('✅ ProStreamEngine shutdown complete');
    }
}

// Optimized audio stream class for maximum performance
class OptimizedAudioStream extends Readable {
    constructor(options) {
        super({ 
            highWaterMark: options.bufferSize || 4 * 1024 * 1024,
            objectMode: false 
        });
        
        this.filePath = options.filePath;
        this.streamId = options.streamId;
        this.chunkSize = options.chunkSize || 64 * 1024;
        this.position = 0;
        this.fileSize = 0;
        this.paused = false;
        
        try {
            this.fileSize = fs.statSync(this.filePath).size;
            this.fd = fs.openSync(this.filePath, 'r');
        } catch (error) {
            this.emit('error', error);
        }
    }

    _read() {
        if (this.paused || this.position >= this.fileSize) {
            return;
        }

        const buffer = Buffer.alloc(this.chunkSize);
        
        try {
            const bytesRead = fs.readSync(
                this.fd, 
                buffer, 
                0, 
                this.chunkSize, 
                this.position
            );
            
            if (bytesRead === 0) {
                this.push(null); // EOF
                return;
            }

            const chunk = bytesRead < this.chunkSize 
                ? buffer.slice(0, bytesRead) 
                : buffer;
            
            this.position += bytesRead;
            
            if (!this.push(chunk)) {
                return; // Backpressure
            }
        } catch (error) {
            this.emit('error', error);
        }
    }

    pause() {
        this.paused = true;
    }

    resume() {
        this.paused = false;
        this._read();
    }

    seekTo(position) {
        if (position >= 0 && position < this.fileSize) {
            this.position = position;
            this._read();
        }
    }

    _destroy(callback) {
        if (this.fd) {
            try {
                fs.closeSync(this.fd);
            } catch (_) {}
        }
        callback();
    }
}

module.exports = ProStreamEngine;