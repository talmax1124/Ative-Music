// Optimized configuration for instant audio playback and performance
const optimizedConfig = {
    // Discord Player optimizations
    player: {
        ytdlOptions: {
            quality: 'highestaudio',
            highWaterMark: 1 << 27, // 128MB buffer for ultra-fast downloads
            requestOptions: {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'Connection': 'keep-alive'
                },
                // Optimize connection settings for speed
                timeout: 30000,
                maxSockets: 10,
                keepAlive: true
            },
            filter: 'audioonly',
            dlChunkSize: 0, // Download full audio at once for maximum speed
            opusEncoded: false,
            // Prefer fastest downloadable formats while maintaining quality
            format: 'bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio/best',
            // Add parallel download options
            concurrent: 4, // Download 4 segments concurrently
            retries: 3,
            // Use fastest available options
            preferFreeFormats: true
        },
        skipFFmpeg: false,
        useLegacyFFmpeg: false,
        connectionTimeout: 15000,
        leaveOnEnd: false,
        leaveOnStop: false,
        leaveOnEmpty: true,
        leaveOnEmptyCooldown: 30000,
        bufferingTimeout: 3000, // Increased for higher quality buffering
        smoothVolume: true,
        disableFiltering: false, // Enable filtering for better audio quality
        disableAutoplayNextTrack: false,
        // Audio quality settings
        ffmpeg: {
            args: [
                '-analyzeduration', '0',
                '-loglevel', '0',
                '-ar', '48000', // 48kHz sample rate
                '-ac', '2', // Stereo
                '-b:a', '256k', // 256kbps bitrate for high quality
                '-f', 's16le'
            ]
        }
    },

    // Audio resource optimizations
    audioResource: {
        inputType: 'opus',
        inlineVolume: true,
        metadata: {
            title: 'Unknown',
            artist: 'Unknown'
        }
    },

    // Voice connection optimizations
    voiceConnection: {
        debug: false,
        selfDeaf: true,
        selfMute: false
    },

    // Performance optimizations
    performance: {
        // Preload next track for gapless playback
        preloadNext: true,
        
        // Cache frequently played tracks
        enableCache: true,
        maxCacheSize: 200, // Increased to 200MB for more caching
        cacheTimeout: 7200000, // 2 hours for longer cache retention
        
        // Search optimizations
        searchLimit: 1, // Only get first result for instant playback
        searchTimeout: 3000, // Reduced to 3 seconds for faster response
        
        // Connection optimizations
        maxRetries: 3, // Increased retries for reliability
        retryDelay: 500, // Faster retry delay
        
        // Memory management
        gcInterval: 300000, // 5 minutes
        maxQueueSize: 1000,
        
        // Download optimizations
        downloadConcurrency: 4, // Download multiple tracks simultaneously
        downloadTimeout: 45000, // 45 second timeout for downloads
        streamBuffer: 2048, // 2KB stream buffer for responsive playback
        enableFastStart: true // Enable fast start for immediate playback
    },

    // UI optimizations
    ui: {
        // Instant feedback for button clicks
        showLoadingStates: true,
        enableProgressBar: true,
        updateInterval: 5000, // Update UI every 5 seconds
        
        // Button interaction timeouts
        buttonTimeout: 3000,
        deferTimeout: 2000,
        
        // Error handling
        maxRetryAttempts: 3,
        errorCooldown: 5000
    },

    // Source priority for fastest playback (YouTube and Spotify only)
    sourcePriority: [
        'youtube', // Primary source - fastest with yt-dlp
        'spotify', // Secondary - excellent metadata and quality
        'youtubedl' // Fallback with yt-dlp for DRM protection
    ],

    // Extractors configuration for discord-player (YouTube and Spotify only)
    extractors: [
        '@discord-player/extractor',
        'discord-player-youtube',
        'discord-player-ytdlp',
        'discord-player-youtubei'
    ],

    // Extractor-specific configurations
    extractorConfigs: {
        youtube: {
            // Use iOS client for better reliability
            useIOS: true,
            cookie: process.env.YOUTUBE_COOKIE || undefined
        },
        youtubei: {
            // YouTube internal API configuration
            clientName: 'WEB',
            clientVersion: '2.0.0'
        },
        ytdlp: {
            // yt-dlp specific options for maximum download speed
            rawOptions: [
                '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                '--extractor-args', 'youtube:player_client=ios,web',
                '--concurrent-fragments', '8', // Download 8 fragments simultaneously
                '--fragment-retries', '3',
                '--retries', '3',
                '--socket-timeout', '30',
                '--file-access-retries', '3',
                '--http-chunk-size', '10M', // 10MB chunks for faster streaming
                '--throttled-rate', '100K', // Minimum rate to avoid throttling
                '--buffer-size', '64K', // Larger buffer for network efficiency
                '--no-part', // Don't use .part files for faster access
                '--no-mtime', // Don't set file modification time for speed
                '--prefer-free-formats', // Prefer formats that download faster
                '--format', 'bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio/best'
            ]
        }
    }
};

module.exports = optimizedConfig;