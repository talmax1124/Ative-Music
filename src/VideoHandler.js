const { createWriteStream } = require('fs');
const { promises: fs } = require('fs');
const path = require('path');
const ytdl = require('@distube/ytdl-core');

class VideoHandler {
    constructor() {
        this.videoCache = new Map();
        this.cacheDir = path.join(__dirname, '../cache/videos');
        this.ensureCacheDir();
    }

    async ensureCacheDir() {
        try {
            await fs.mkdir(this.cacheDir, { recursive: true });
        } catch (error) {
            console.error('Error creating cache directory:', error);
        }
    }

    async getVideoStream(track, quality = 'highest') {
        if (track.source !== 'youtube') {
            throw new Error('Video streaming only supported for YouTube tracks');
        }

        try {
            const info = await ytdl.getInfo(track.url, {
                requestOptions: {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                        'Accept-Language': 'en-US,en;q=0.9',
                    }
                }
            });
            const formats = ytdl.filterFormats(info.formats, 'videoandaudio');
            
            if (formats.length === 0) {
                throw new Error('No video+audio formats available');
            }

            let selectedFormat;
            switch (quality) {
                case 'highest':
                    selectedFormat = formats.reduce((prev, curr) => 
                        parseInt(prev.height || 0) > parseInt(curr.height || 0) ? prev : curr
                    );
                    break;
                case 'medium':
                    selectedFormat = formats.find(f => f.height === '720') || 
                                   formats.find(f => f.height === '480') || 
                                   formats[Math.floor(formats.length / 2)];
                    break;
                case 'lowest':
                    selectedFormat = formats.reduce((prev, curr) => 
                        parseInt(prev.height || 1080) < parseInt(curr.height || 1080) ? prev : curr
                    );
                    break;
                default:
                    selectedFormat = formats[0];
            }

            return {
                stream: ytdl(track.url, { 
                    format: selectedFormat,
                    requestOptions: {
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                            'Accept-Language': 'en-US,en;q=0.9',
                        }
                    }
                }),
                format: selectedFormat,
                info: {
                    title: info.videoDetails.title,
                    duration: info.videoDetails.lengthSeconds,
                    resolution: `${selectedFormat.width}x${selectedFormat.height}`,
                    fps: selectedFormat.fps,
                    container: selectedFormat.container
                }
            };

        } catch (error) {
            console.error('Error getting video stream:', error);
            throw error;
        }
    }

    async cacheVideo(track, quality = 'medium') {
        const cacheKey = `${track.id}_${quality}`;
        const cachePath = path.join(this.cacheDir, `${cacheKey}.mp4`);

        try {
            await fs.access(cachePath);
            return cachePath;
        } catch {
            // File doesn't exist, need to cache
        }

        try {
            const videoStream = await this.getVideoStream(track, quality);
            const writeStream = createWriteStream(cachePath);
            
            return new Promise((resolve, reject) => {
                let downloadedBytes = 0;
                const startTime = Date.now();
                
                videoStream.stream.on('data', (chunk) => {
                    downloadedBytes += chunk.length;
                    const elapsed = Date.now() - startTime;
                    const speed = downloadedBytes / elapsed * 1000; // bytes per second
                    
                    // Log progress every 5 seconds
                    if (elapsed % 5000 < 100) {
                        console.log(`📥 Downloading: ${this.formatBytes(downloadedBytes)} at ${this.formatBytes(speed)}/s`);
                    }
                });
                
                videoStream.stream.pipe(writeStream);
                
                writeStream.on('finish', () => {
                    this.videoCache.set(cacheKey, {
                        path: cachePath,
                        timestamp: Date.now(),
                        info: videoStream.info,
                        size: downloadedBytes
                    });
                    console.log(`✅ Video cached: ${this.formatBytes(downloadedBytes)} in ${Date.now() - startTime}ms`);
                    resolve(cachePath);
                });
                
                writeStream.on('error', reject);
                videoStream.stream.on('error', reject);
            });

        } catch (error) {
            console.error('Error caching video:', error);
            throw error;
        }
    }

    formatBytes(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    async sendVideoFile(filePath, maxSize = 25 * 1024 * 1024) { // 25MB Discord limit
        try {
            const stats = await fs.stat(filePath);
            
            if (stats.size > maxSize) {
                return {
                    canSend: false,
                    reason: 'File too large for Discord (>25MB)',
                    size: this.formatBytes(stats.size),
                    maxSize: this.formatBytes(maxSize)
                };
            }
            
            return {
                canSend: true,
                filePath: filePath,
                size: this.formatBytes(stats.size)
            };
            
        } catch (error) {
            return {
                canSend: false,
                reason: 'File not found or inaccessible',
                error: error.message
            };
        }
    }

    async getVideoInfo(track) {
        if (track.source !== 'youtube') {
            return { hasVideo: false };
        }

        try {
            const info = await ytdl.getInfo(track.url);
            const videoFormats = ytdl.filterFormats(info.formats, 'videoandaudio');
            
            if (videoFormats.length === 0) {
                return { hasVideo: false };
            }

            const qualities = videoFormats.map(format => ({
                quality: format.qualityLabel || `${format.height}p`,
                resolution: `${format.width}x${format.height}`,
                fps: format.fps,
                size: format.contentLength
            }));

            return {
                hasVideo: true,
                duration: info.videoDetails.lengthSeconds,
                qualities: qualities,
                thumbnail: info.videoDetails.thumbnails[info.videoDetails.thumbnails.length - 1]?.url
            };

        } catch (error) {
            console.error('Error getting video info:', error);
            return { hasVideo: false };
        }
    }

    async cleanCache(maxAge = 24 * 60 * 60 * 1000) {
        try {
            const files = await fs.readdir(this.cacheDir);
            const now = Date.now();
            
            for (const file of files) {
                const filePath = path.join(this.cacheDir, file);
                const stats = await fs.stat(filePath);
                
                if (now - stats.mtime.getTime() > maxAge) {
                    await fs.unlink(filePath);
                    console.log(`🗑️ Cleaned cached video: ${file}`);
                }
            }
        } catch (error) {
            console.error('Error cleaning video cache:', error);
        }
    }

    getCachedVideo(trackId, quality = 'medium') {
        const cacheKey = `${trackId}_${quality}`;
        return this.videoCache.get(cacheKey);
    }

    async startScreenShare(channel, videoPath) {
        // This would integrate with Discord's screen share functionality
        // Currently Discord.js doesn't directly support screen sharing via API
        // This is a placeholder for future implementation
        
        console.log(`📺 Screen share requested for ${videoPath} in channel ${channel.name}`);
        
        return {
            success: false,
            message: 'Screen sharing via bot is not currently supported by Discord API. Please use the desktop app to share your screen manually.'
        };
    }

    getScreenShareInstructions() {
        return {
            title: '📺 Screen Share Instructions',
            description: 'To watch music videos together:',
            steps: [
                '1. Join the voice channel',
                '2. Click the screen share button in Discord',
                '3. Share your browser window',
                '4. Navigate to the video URL that will be provided',
                '5. Everyone in the channel can watch together!'
            ]
        };
    }
}

module.exports = VideoHandler;