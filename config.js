module.exports = {
    token: process.env.DISCORD_TOKEN || 'YOUR_BOT_TOKEN_HERE',
    clientId: process.env.CLIENT_ID || 'YOUR_CLIENT_ID_HERE',
    
    spotify: {
        clientId: process.env.SPOTIFY_CLIENT_ID || 'YOUR_SPOTIFY_CLIENT_ID',
        clientSecret: process.env.SPOTIFY_CLIENT_SECRET || 'YOUR_SPOTIFY_CLIENT_SECRET'
    },
    
    
    settings: {
        stayInChannel: true,
        defaultVolume: 50,
        maxQueueSize: 100,
        searchLimit: 10,
        videoQuality: 'highest',
        audioQuality: 'highestaudio',
        // Behavior when queue finishes: 'stop' or 'recommendations'
        endOfQueueBehavior: process.env.END_OF_QUEUE_BEHAVIOR || 'recommendations',
        // Prefetch next track this many ms before current ends
        prefetchLeadMs: Number(process.env.PREFETCH_LEAD_MS || 30000),
        // How many upcoming tracks to prefetch (1-3 recommended)
        prefetchDepth: Number(process.env.PREFETCH_DEPTH || 3),
        // Auto-delete finished track's cached files
        autoDeleteFinishedTrack: (process.env.AUTO_DELETE_FINISHED || 'true') === 'true',
        // Delay before deleting finished track files (ms)
        deleteDelayMs: Number(process.env.DELETE_DELAY_MS || 60000),
        // Throttle queue saves to reduce spam (ms)
        queueSaveThrottleMs: Number(process.env.QUEUE_SAVE_THROTTLE_MS || 3000)
    },
    
    colors: {
        // Modern gradient-inspired colors
        primary: 0x6366F1,      // Modern Indigo
        secondary: 0x8B5CF6,    // Modern Purple  
        success: 0x10B981,      // Modern Green
        error: 0xEF4444,        // Modern Red
        warning: 0xF59E0B,      // Modern Amber
        info: 0x3B82F6,         // Modern Blue
        
        // Music-specific modern colors
        music: 0xEC4899,        // Modern Pink
        playing: 0x14B8A6,      // Teal (modern playing)
        paused: 0xF59E0B,       // Amber (modern paused)
        stopped: 0x6B7280,      // Modern Gray
        queue: 0x8B5CF6,        // Purple for queue
        premium: 0xFBBF24       // Modern Gold
    },
    
    emojis: {
        play: '▶️',
        pause: '⏸️',
        stop: '⏹️',
        skip: '⏭️',
        previous: '⏮️',
        shuffle: '🔀',
        repeat: '🔁',
        volume: '🔊',
        search: '🔍',
        queue: '📜',
        loading: '⏳'
    }
};
