// Optimized configuration for instant audio playback and performance
const optimizedConfig = {
    // Discord Player optimizations
    player: {
        ytdlOptions: {
            quality: 'highestaudio',
            highWaterMark: 1 << 26, // 64MB buffer for highest quality smooth playback
            requestOptions: {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            },
            filter: 'audioonly',
            dlChunkSize: 0, // Download full audio at once for reliability
            opusEncoded: false,
            // Prefer highest quality audio formats
            format: 'bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio/best'
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
        maxCacheSize: 100, // MB
        cacheTimeout: 3600000, // 1 hour
        
        // Search optimizations
        searchLimit: 1, // Only get first result for instant playback
        searchTimeout: 5000, // 5 second timeout for searches
        
        // Connection optimizations
        maxRetries: 2,
        retryDelay: 1000,
        
        // Memory management
        gcInterval: 300000, // 5 minutes
        maxQueueSize: 1000
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
            // yt-dlp specific options for better reliability
            rawOptions: [
                '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                '--extractor-args', 'youtube:player_client=ios,web'
            ]
        }
    }
};

module.exports = optimizedConfig;