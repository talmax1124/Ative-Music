# 🔧 Discord Bot Setup Guide

## ❌ Error: "Used disallowed intents"

This means your bot needs proper permissions in the Discord Developer Portal.

## 🚀 Quick Fix:

### 1. **Go to Discord Developer Portal**
Visit: https://discord.com/developers/applications

### 2. **Select Your Bot Application**
Click on your "Ative Music" application (or whatever you named it)

### 3. **Go to Bot Section**
Click "Bot" in the left sidebar

### 4. **Enable Required Intents**
Scroll down to **"Privileged Gateway Intents"** and enable:
- ✅ **PRESENCE INTENT** (Optional - for user status)
- ✅ **SERVER MEMBERS INTENT** (Optional - for member count)
- ✅ **MESSAGE CONTENT INTENT** (Required for some features)

**Note:** The bot has been updated to work with minimal intents, but enabling these provides better functionality.

### 5. **Bot Permissions**
In the same Bot section, make sure these are enabled:
- ✅ **Public Bot** (checked)
- ✅ **Requires OAuth2 Code Grant** (unchecked)

### 6. **OAuth2 Setup**
Go to "OAuth2" → "URL Generator":

**Scopes:**
- ✅ `bot`
- ✅ `applications.commands`

**Bot Permissions:**
- ✅ Send Messages
- ✅ Use Slash Commands  
- ✅ Connect (Voice)
- ✅ Speak (Voice)
- ✅ Use Voice Activity

### 7. **Invite Your Bot**
Copy the generated URL and use it to invite your bot to your server.

## 🎵 **Try Starting Again:**
```bash
npm start
```

Your bot should now connect successfully! 🎉

## 🔍 **If Still Having Issues:**

1. **Double-check your token** in `.env` file
2. **Make sure the bot is invited** to your Discord server
3. **Verify bot permissions** in your server settings
4. **Try regenerating the token** if it's old

## 📞 **Bot Invite URL Template:**
```
https://discord.com/api/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=3148800&scope=bot%20applications.commands
```
Replace `YOUR_CLIENT_ID` with your actual Client ID from the General Information tab.