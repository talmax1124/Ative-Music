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
        audioQuality: 'highestaudio'
    },
    
    colors: {
        success: 0x57F287,      // Discord Green
        error: 0xED4245,        // Discord Red
        info: 0x5865F2,         // Discord Blurple
        warning: 0xFEE75C,      // Discord Yellow
        music: 0xEB459E,        // Discord Pink/Music
        playing: 0x57F287,      // Green for playing
        paused: 0xFEE75C,       // Yellow for paused
        stopped: 0x747F8D,      // Gray for stopped
        queue: 0x5865F2,        // Blurple for queue
        premium: 0xF1C40F       // Gold for premium features
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