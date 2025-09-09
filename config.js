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
        success: 0x00ff00,
        error: 0xff0000,
        info: 0x0099ff,
        warning: 0xffff00,
        music: 0x9f00ff
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