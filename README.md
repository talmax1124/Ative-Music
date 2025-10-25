# 🎵 Ative Music - Advanced Discord Music Bot

A cutting-edge Discord music bot with mobile-responsive web interface, pure streaming architecture, and advanced search capabilities.

## ✨ Features

### 🎵 Core Features
- **Multi-source streaming** - YouTube, Spotify, SoundCloud
- **Advanced search** - Fuzzy matching and smart filters
- **Smart queue management** - Shuffle, repeat, drag-and-drop
- **Rich metadata** - Auto-enhanced with genres, moods, artwork
- **Web portal** - Full-featured web interface at port 25567

### 📱 Mobile Features
- **100% responsive design** - Works perfectly on all devices
- **Touch gestures** - Swipe, drag, long-press support
- **44px touch targets** - Optimized for mobile interaction
- **Safe area support** - iPhone notches and Android navigation

### ⚡ Performance
- **Pure streaming** - No downloads, zero disk usage
- **Memory optimized** - 50% less RAM usage (100-200MB)
- **Fast startup** - 5-8 seconds
- **VPS optimized** - Works great on limited resources

## 🚀 Quick Start

### Prerequisites
- Node.js 18.0.0 or higher
- Neon PostgreSQL database
- Discord bot token
- Spotify API credentials (optional)

### Installation

1. **Clone and install**
```bash
git clone https://github.com/yourusername/ative-music.git
cd ative-music
npm install
```

2. **Configure environment**
```bash
cp .env.example .env
# Edit .env with your credentials
```

3. **Verify and start**
```bash
node verify-setup.js
npm start
```

## 📱 Web Portal

Access at: `http://localhost:25567` (or your server IP)

## 🎮 Discord Commands

- `/play [query]` - Play a song
- `/search [query]` - Search with dropdown
- `/queue` - View queue
- `/skip` - Skip track
- `/pause` - Pause playback
- `/shuffle` - Toggle shuffle
- `/repeat` - Set repeat mode

## 📁 Clean Structure

```
ative-music/
├── index.js              # Main bot
├── src/
│   ├── Core Services
│   ├── Enhanced Features
│   └── engines/
└── docs/
```

---

**Made with ❤️ for Discord**
