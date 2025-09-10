# 🚂 Railway Deployment Guide - Ative Music Bot

## Why Railway?
Railway is **perfect** for Discord music bots because it:
- ✅ Properly installs system dependencies (FFmpeg, yt-dlp)
- ✅ Handles Node.js applications natively
- ✅ Auto-deploys from GitHub pushes
- ✅ Provides persistent runtime environment
- ✅ Better logging and debugging
- ✅ Free tier available ($5/month for hobby projects)

## 🚀 Step-by-Step Deployment

### 1. Create Railway Account
1. Go to [railway.app](https://railway.app)
2. Sign up with GitHub (recommended)
3. Verify your account

### 2. Deploy Your Bot
1. **Click "New Project"**
2. **Select "Deploy from GitHub repo"**
3. **Choose your `Ative-Music` repository**
4. Railway will automatically detect it's a Node.js project

### 3. Configure Environment Variables
In your Railway dashboard, go to **Variables** and add:

**Required Variables:**
```env
DISCORD_TOKEN=your_discord_bot_token_here
CLIENT_ID=your_discord_client_id_here
```

**Optional but Recommended:**
```env
SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
NODE_ENV=production
PORT=3000
```

**Apple Music (Optional):**
```env
APPLE_MUSIC_KEY_ID=your_apple_music_key_id
APPLE_MUSIC_TEAM_ID=your_apple_music_team_id
APPLE_MUSIC_PRIVATE_KEY=your_apple_music_private_key
```

### 4. Deploy Settings
Railway will automatically:
- ✅ Install Node.js 18+
- ✅ Install FFmpeg
- ✅ Install yt-dlp via pip
- ✅ Install npm dependencies
- ✅ Start your bot with `npm start`

### 5. Custom Domain (Optional)
1. Go to **Settings** → **Domains**
2. Click **Generate Domain** for a free railway.app subdomain
3. Or connect your custom domain

## 🔧 Configuration Files

Your repository now includes:

### `nixpacks.toml`
```toml
[phases.setup]
nixPkgs = ["nodejs-18_x", "python3", "python3Packages.pip", "ffmpeg", "pkg-config"]

[phases.install]
cmds = [
    "npm ci --only=production --ignore-scripts",
    "pip3 install --upgrade yt-dlp"
]

[start]
cmd = "node start.js"
```

### `railway.json`
```json
{
  "build": {
    "builder": "NIXPACKS",
    "buildCommand": "npm install && npm run build --if-present"
  },
  "deploy": {
    "startCommand": "npm start",
    "healthcheckPath": "/",
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10
  }
}
```

### `Procfile`
```
web: node start.js
```

## 📋 Expected Deployment Process

When you deploy, you'll see:
```
==> Building
✅ Installing system dependencies (Node.js, FFmpeg, Python)
✅ Installing yt-dlp
✅ Installing npm dependencies
✅ Build completed

==> Deploying
✅ Starting application
✅ Bot connecting to Discord
✅ yt-dlp available - using optimized streaming
✅ Spotify API initialized
✅ Slash commands registered
✅ Music streaming working perfectly!
```

## 🎵 Features Working on Railway

Once deployed, your bot will have:
- ✅ **Reliable music streaming** (yt-dlp works properly)
- ✅ **Multiple music sources** (YouTube, Spotify, SoundCloud)
- ✅ **Video streaming portal** (accessible via your Railway domain)
- ✅ **Smart auto-play** with genre detection
- ✅ **Interactive Discord controls**
- ✅ **Mobile-optimized audio quality**
- ✅ **Auto-restart on crashes**
- ✅ **Real-time logs and monitoring**

## 🔧 Monitoring & Debugging

### View Logs
1. Go to your Railway dashboard
2. Click on **Deployments**
3. Click **View Logs** to see real-time output

### Check Metrics
1. **Memory usage**
2. **CPU usage** 
3. **Network traffic**
4. **Deployment history**

### Restart Service
If needed, click **Restart** in the Railway dashboard

## 🚨 Troubleshooting

### Bot Not Starting?
1. Check **Variables** are set correctly
2. Check **Logs** for error messages
3. Verify Discord token is valid

### Music Not Playing?
1. Check logs for yt-dlp installation
2. Verify bot has voice permissions in Discord
3. Check if specific tracks are blocked in your region

### Web Portal Not Accessible?
1. Make sure **PORT** environment variable is set to 3000
2. Check if your Railway domain is working
3. The video player will be at: `https://your-app.railway.app`

## 💰 Pricing

**Railway Pricing:**
- **Hobby Plan**: $5/month (recommended)
- **Free Plan**: Limited hours but good for testing
- **Pro Plan**: $20/month for heavy usage

## 🔄 Auto-Deployment

Once connected to GitHub:
1. **Push to main branch** → Automatic deployment
2. **Zero downtime** deployments
3. **Rollback capability** if issues occur

## 🎉 Success!

Your Ative Music Bot should now be:
- ✅ **Running reliably** on Railway
- ✅ **Streaming music** without YouTube bot detection issues
- ✅ **Auto-updating** from GitHub
- ✅ **Accessible** via web portal for video streaming
- ✅ **Ready for production** use!

**Your bot will work much better on Railway than Pterodactyl!** 🚀🎵