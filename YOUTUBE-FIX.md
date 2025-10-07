# YouTube Playback Fix Guide

## Current Issue
YouTube playback is failing with HTTP 403 Forbidden errors. This is a common issue that occurs when YouTube requires authentication or detects bot-like behavior.

## Solutions

### Solution 1: Use Browser Cookies (Recommended)

1. **Install a cookie export extension in your browser:**
   - Chrome/Edge: "Get cookies.txt LOCALLY" or "cookies.txt"
   - Firefox: "cookies.txt"

2. **Log in to YouTube in your browser**

3. **Export cookies:**
   - Click the extension icon while on youtube.com
   - Select "Export as Netscape format"
   - Save the file as `cookies.txt` in the bot directory

4. **Verify the cookies file:**
   ```bash
   # Check if the file is in correct format
   head -1 cookies.txt
   # Should show: # Netscape HTTP Cookie File
   ```

5. **Restart the bot:**
   ```bash
   npm start
   ```

### Solution 2: Use Browser Cookies Directly (macOS/Windows)

The bot has been updated to automatically try using Chrome browser cookies if no cookies.txt file is found. Just make sure you're logged into YouTube in Chrome.

### Solution 3: Update yt-dlp

```bash
# Update yt-dlp to the latest version
yt-dlp -U
# or with homebrew
brew upgrade yt-dlp
```

### Solution 4: Use Alternative Clients

The bot now tries multiple YouTube clients in this order:
1. Android client (most reliable)
2. iOS client
3. Web client
4. TV embedded client

This happens automatically, but you may see multiple attempts in the logs.

### Solution 5: Use Proxy (Advanced)

If you're being rate-limited, you can configure a proxy:

1. Create or edit `.env` file:
   ```
   PROXY_URL=http://your-proxy:port
   # or with auth
   PROXY_URL=http://user:pass@your-proxy:port
   ```

2. Restart the bot

## Verification

After applying fixes, test with:
1. Try playing a YouTube URL from the web portal
2. Check logs for successful stream messages
3. If still failing, check which error messages appear

## Common Error Messages and Solutions

- **"Requested format is not available"**: The bot will automatically try different formats
- **"HTTP Error 403: Forbidden"**: Usually means cookies are needed
- **"Please sign in"**: Definitely needs cookies from a logged-in session
- **"Video unavailable"**: The video might be region-locked or private

## Emergency Fallback

If yt-dlp continues to fail, the bot will automatically fall back to play-dl library, though this may be less reliable for some videos.