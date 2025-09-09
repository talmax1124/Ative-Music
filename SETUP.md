# 🚀 Quick Setup Guide

## 1. Run the Setup Wizard
```bash
npm run setup
```

## 2. Get Your Discord Bot Token

### Create Discord Application:
1. Go to https://discord.com/developers/applications
2. Click "New Application" and name it "Ative Music"
3. Go to "Bot" section → "Add Bot"
4. Copy the "Token" (keep it secret!)
5. Copy the "Application ID" from General Information

### Bot Permissions:
Enable these in the Bot section:
- ✅ Send Messages
- ✅ Use Slash Commands
- ✅ Connect (Voice)
- ✅ Speak (Voice)
- ✅ Read Message History

### Invite URL:
```
https://discord.com/api/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=3148800&scope=bot%20applications.commands
```
Replace `YOUR_CLIENT_ID` with your actual Client ID.

## 3. Optional: Spotify API (Recommended)

### Get Spotify Credentials:
1. Go to https://developer.spotify.com/dashboard
2. Click "Create an App"
3. Fill in app details (any name/description)
4. Copy "Client ID" and "Client Secret"

## 4. Start the Bot
```bash
npm start
```

## 5. Test Commands
In Discord:
- `/play never gonna give you up`
- `/search imagine dragons`
- `/queue`
- `/help`

## 🎵 You're Ready to Rock!

The bot will now:
- ✅ Play music from YouTube, Spotify, Apple Music
- ✅ Stay in voice channels 24/7
- ✅ Provide interactive music controls
- ✅ Support smart queuing and search
- ✅ Handle video content and screen sharing

## 🛠️ Troubleshooting

**Bot not responding?**
- Check bot permissions in Discord server
- Verify token in .env file
- Make sure bot is online (green dot)

**No audio?**
- Install FFmpeg: `brew install ffmpeg` (macOS)
- Check voice channel permissions
- Try a different audio source

**Commands not appearing?**
- Wait a few minutes for Discord to register commands
- Try leaving and rejoining the server
- Check bot has "Use Slash Commands" permission