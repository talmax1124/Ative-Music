# 🚀 Ative Music Bot - VPS Deployment Guide

## Pterodactyl Panel Deployment (RECOMMENDED)

### Step 1: Import the Egg
1. Download the `egg-nodejs-ative-music.json` file
2. In your Pterodactyl admin panel, go to **Nests** > **Import Egg**
3. Upload the JSON file and import it

### Step 2: Create the Server
1. Create a new server using the **Ative Music Bot** egg
2. Set the following required variables:
   - **DISCORD_TOKEN**: Your Discord bot token
   - **CLIENT_ID**: Your Discord application client ID
   - **SPOTIFY_CLIENT_ID**: (Optional) Spotify API client ID
   - **SPOTIFY_CLIENT_SECRET**: (Optional) Spotify API client secret

### Step 3: Configure Additional Settings
- **Git Repo**: Should default to `https://github.com/talmax1124/Ative-Music`
- **Branch**: `main`
- **Main File**: `start.js`
- **Node Environment**: `production`

### Step 4: Start and Validate
1. Start the server in Pterodactyl
2. Once running, connect via console or SSH and run: `npm run vps-check`
3. Fix any issues reported by the validation script

## Manual VPS Deployment

### Prerequisites
```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js 18+ 
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install system dependencies
sudo apt install -y git ffmpeg python3 python3-pip build-essential libtool

# Install yt-dlp (CRITICAL for music streaming)
pip3 install --upgrade yt-dlp
```

### Installation Steps
```bash
# Clone the repository
git clone https://github.com/talmax1124/Ative-Music.git
cd Ative-Music

# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Edit .env with your credentials
nano .env
```

### Required Environment Variables
```env
# REQUIRED
DISCORD_TOKEN=your_discord_bot_token
CLIENT_ID=your_discord_client_id

# RECOMMENDED (for better search results)
SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret

# PRODUCTION SETTINGS
NODE_ENV=production
PORT=3000
 
# WEB PORTAL (search + play from browser)
# Bind the web portal to your VPS public port
WEB_HOST=0.0.0.0
WEB_PORT=25567

# Optional: set public address for logs/links
# PUBLIC_HOST=199.244.48.46
# PUBLIC_PORT=25567

# Optional: protect APIs with a simple key
# WEB_API_TOKEN=change-me-strong-secret
```

### Validation and Startup
```bash
# Validate deployment
npm run vps-check

# Start the bot
npm start

# Or for production with process manager
pm2 start start.js --name "ative-music-bot"
```

## 🔧 Troubleshooting

### Common Issues and Fixes

**1. "Cannot find module" errors**
```bash
rm -rf node_modules package-lock.json
npm install
```

**2. "yt-dlp not found" or streaming failures**
```bash
# Install yt-dlp via pip
pip3 install --upgrade yt-dlp

# Or download binary directly
sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
sudo chmod +x /usr/local/bin/yt-dlp
```

**3. FFmpeg issues**
```bash
sudo apt install ffmpeg libavcodec-dev libavformat-dev
```

**4. Discord "Sign in to confirm you're not a bot" errors**
- This is resolved by the yt-dlp integration
- Make sure yt-dlp is properly installed and accessible
- The bot automatically falls back to working streaming methods

**5. Web portal not accessible externally (Pterodactyl/VPS)**
- Ensure firewall/panel exposes `WEB_PORT` (e.g., 25567)
- The app binds to `0.0.0.0` externally (WEB_HOST)
- Access via `http://<your-ip>:<WEB_PORT>`

## 📋 Post-Deployment Validation

Run the validation script to ensure everything works:
```bash
npm run vps-check
```

This script checks:
- ✅ Node.js version compatibility
- ✅ Required files and directories
- ✅ Environment configuration
- ✅ System dependencies (FFmpeg, yt-dlp)
- ✅ Node.js module installation
- ✅ Network configuration

## 🎵 Bot Features

Once deployed, your bot supports:

### Music Commands
- `/play <song>` - Play music from YouTube, Spotify, SoundCloud
- `/pause` - Pause current track
- `/resume` - Resume playback
- `/skip` - Skip to next track
- `/stop` - Stop music and clear queue
- `/queue` - View current queue
- `/autoplay` - Toggle smart auto-play

### Web Portal + Video Server
- Web portal (search + play): `http://<your-ip>:<WEB_PORT>` (e.g., `http://199.244.48.46:25567`)
- Video server (for screen share): `http://<your-ip>:3000` by default
- Both bind to `0.0.0.0` for external access on VPS

### Smart Features
- **Genre-based auto-play**: Automatically queues similar music
- **Panel management**: Interactive Discord controls
- **Mobile optimization**: Clear audio quality on mobile devices
- **Multi-source support**: YouTube, Spotify, SoundCloud integration

## 🔒 Security Notes

- Never share your Discord bot token
- Use environment variables for all sensitive data
- The `.env.example` file contains safe placeholder values
- Regular security updates are recommended

## 📞 Support

If you encounter issues:
1. Run `npm run vps-check` for diagnostics
2. Check the console logs for error messages
3. Ensure all environment variables are correctly set
4. Verify yt-dlp installation with `yt-dlp --version`

Your Ative Music Bot should now be ready for production deployment! 🎉
