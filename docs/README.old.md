# 🎵 Ative Music Bot

A powerful Discord music bot with multi-source support, advanced queue management, and 24/7 voice channel presence. Features music from YouTube, Spotify, Apple Music, SoundCloud, and more!

## ✨ Features

### 🎼 Multi-Source Music Support
- **YouTube** - Direct playback and search
- **Spotify** - Track and playlist support (plays via YouTube)
- **Apple Music** - Track search and playback
- **SoundCloud** - Direct streaming support
- **URL Support** - Play from direct links

### 🎮 Interactive Controls
- **Button Controls** - Play, pause, skip, shuffle, stop
- **Search Menu** - Interactive search results with source selection
- **Volume Control** - Adjustable audio levels
- **Loop Modes** - Track, queue, or off

### 🧠 Smart Features
- **Smart Queue** - Intelligent track sorting by popularity and recency
- **24/7 Presence** - Stays connected to voice channels
- **Auto-pause** - Pauses when no users in channel
- **Queue Management** - Add, remove, shuffle, and reorder tracks

### 📺 Video Support
- **Music Videos** - Play YouTube videos with visual content
- **Screen Share Ready** - Instructions for watching together
- **Quality Selection** - Multiple video quality options

## 🚀 Installation

### Prerequisites
- Node.js 16.9.0 or higher
- FFmpeg installed on your system
- Discord Bot Token
- Spotify API credentials (optional but recommended)

### Setup Steps

1. **Clone or download the bot files**
   ```bash
   cd "Ative Music"
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment variables**
   ```bash
   cp .env.example .env
   ```
   
   Edit `.env` with your credentials:
   ```env
   DISCORD_TOKEN=your_bot_token_here
   CLIENT_ID=your_client_id_here
   SPOTIFY_CLIENT_ID=your_spotify_client_id
   SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
   ```

4. **Start the bot**
   ```bash
   npm start
   ```

## 🔧 Configuration

### Bot Settings
Edit `config.js` to customize:
- Volume levels
- Queue limits
- Audio quality
- 24/7 behavior
- Colors and emojis

### API Keys Setup

#### Discord Bot
1. Go to https://discord.com/developers/applications
2. Create a new application
3. Go to "Bot" section and create a bot
4. Copy the token to your `.env` file
5. Invite bot with proper permissions

#### Spotify API (Optional)
1. Go to https://developer.spotify.com/dashboard
2. Create a new app
3. Copy Client ID and Client Secret to `.env`

#### Apple Music API (Optional)
1. Sign up for Apple Developer Program
2. Create Music Kit credentials
3. Add credentials to `.env`

## 🎵 Commands

### Basic Commands
- `/play <song/url>` - Play music from various sources
- `/search <query>` - Search for music across platforms
- `/queue` - View current queue
- `/skip` - Skip current track
- `/pause` - Pause playback
- `/resume` - Resume playback
- `/stop` - Stop and clear queue

### Advanced Commands
- `/volume <0-100>` - Set volume level
- `/shuffle` - Shuffle queue
- `/loop <off/track/queue>` - Set loop mode
- `/nowplaying` - Show current track info
- `/join` - Join your voice channel
- `/leave` - Leave voice channel

### Interactive Features
- **Button Controls** - Use buttons on music messages
- **Search Menus** - Select from search results
- **Auto-reconnect** - Bot rejoins channels on restart

## 🎯 Usage Examples

### Playing Music
```
/play Never Gonna Give You Up
/play https://youtu.be/dQw4w9WgXcQ
/play spotify:track:4iV5W9uYEdYUVa79Axb7Rh
```

### Managing Queue
```
/queue - View current queue
/shuffle - Randomize queue order
/skip - Skip to next track
/loop queue - Loop entire queue
```

### Search and Select
```
/search imagine dragons - Shows interactive search results
Select from dropdown menu to add to queue
```

## 🛠️ Advanced Features

### 24/7 Mode
- Bot stays in voice channels even when inactive
- Auto-pauses when no users present
- Remembers channels between restarts
- Configurable in `config.js`

### Smart Queuing
- Sorts tracks by popularity and recency
- Considers view count, likes, and publish date
- Prioritizes optimal song lengths (2-5 minutes)
- Improves listening experience

### Video Support
- Detects music videos on YouTube
- Provides screen share instructions
- Caches video information
- Quality selection options

### Error Handling
- Automatic retry for failed tracks
- Fallback to alternative sources
- Connection recovery
- Graceful error messages

## 📁 File Structure
```
Ative Music/
├── index.js                 # Main bot file
├── config.js               # Configuration
├── package.json            # Dependencies
├── .env.example           # Environment template
├── src/
│   ├── MusicManager.js    # Queue and playback logic
│   ├── SourceHandlers.js  # Multi-source support
│   ├── VideoHandler.js    # Video functionality
│   └── StayConnectedManager.js # 24/7 features
├── data/                  # Persistent data storage
└── cache/                # Temporary file cache
```

## 🔍 Troubleshooting

### Common Issues

**Bot doesn't respond to commands**
- Check bot permissions in Discord
- Verify token in `.env` file
- Ensure bot is in the server

**No audio playback**
- Install FFmpeg on your system
- Check voice channel permissions
- Verify audio dependencies

**Spotify tracks won't play**
- Add Spotify API credentials
- Check credential validity
- Fallback uses YouTube search

**Bot disconnects frequently**
- Check internet connection stability
- Verify voice channel permissions
- Enable 24/7 mode in config

### Performance Tips
- Use SSD storage for cache
- Ensure stable internet connection
- Monitor memory usage with large queues
- Clean cache regularly

## 🎨 Customization

### Changing Colors
Edit `config.js` colors section:
```javascript
colors: {
    success: 0x00ff00,
    error: 0xff0000,
    info: 0x0099ff,
    warning: 0xffff00,
    music: 0x9f00ff
}
```

### Custom Emojis
Replace default emojis in `config.js`:
```javascript
emojis: {
    play: '▶️',
    pause: '⏸️',
    skip: '⏭️',
    // ... customize as needed
}
```

## 📊 System Requirements

### Minimum
- 1 GB RAM
- 10 GB storage
- Node.js 16.9+
- Stable internet connection

### Recommended
- 2 GB RAM
- 20 GB SSD storage
- Node.js 18+
- High-speed internet

## 🤝 Support

For issues or questions:
1. Check this README first
2. Verify your configuration
3. Test with simple commands
4. Check console logs for errors

## 📝 License

This project is for educational and personal use. Ensure compliance with:
- Discord Terms of Service
- YouTube Terms of Service
- Spotify Developer Terms
- Apple Developer Terms
- Relevant copyright laws

## 🎵 Enjoy Your Music!

Ative Music Bot brings the best music experience to your Discord server with powerful features, multiple sources, and intelligent management. Rock on! 🤘