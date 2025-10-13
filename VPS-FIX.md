# VPS YouTube Playback Fix Guide

YouTube often blocks VPS/cloud servers with "Sign in to confirm you're not a bot" errors. Here are 3 solutions:

## Solution 1: YouTube Cookies (Recommended)

### Extract cookies from your logged-in browser:

**On your LOCAL machine (not VPS):**

```bash
# For Chrome:
yt-dlp --cookies-from-browser chrome --cookies cookies.txt --skip-download https://www.youtube.com/watch?v=dQw4w9WgXcQ

# For Firefox:
yt-dlp --cookies-from-browser firefox --cookies cookies.txt --skip-download https://www.youtube.com/watch?v=dQw4w9WgXcQ

# For Edge:
yt-dlp --cookies-from-browser edge --cookies cookies.txt --skip-download https://www.youtube.com/watch?v=dQw4w9WgXcQ
```

### Upload to VPS:

1. Upload the `cookies.txt` file to your VPS at `/home/container/cookies.txt`
2. Update your `.env` file:
   ```env
   COOKIES_PATH=/home/container/cookies.txt
   ```
3. Restart the bot

## Solution 2: Proxy Server

Use a residential proxy to bypass geo-blocks:

### Free proxies (may be unreliable):
```env
PROXY_URL=http://proxy.toolip.gr:8080
```

### Premium proxies (more reliable):
```env
# HTTP proxy
PROXY_URL=http://username:password@proxy-server:port

# SOCKS5 proxy
PROXY_URL=socks5://username:password@proxy-server:port
```

### Recommended proxy providers:
- Bright Data (formerly Luminati)
- SmartProxy
- IPRoyal
- Proxy-Cheap

## Solution 3: Proxy List Rotation

Enable automatic proxy rotation in `.env`:

```env
PROXY_LIST=http://proxy1.com:8080,http://proxy2.com:8080,socks5://proxy3.com:1080
PROXY_ROTATION=true
```

## Testing Your Fix

Run the extract-cookies.sh script on your VPS:
```bash
chmod +x extract-cookies.sh
./extract-cookies.sh
```

## Important Notes

- Cookies expire after a few weeks - refresh them regularly
- Use a Google account that has YouTube history for better results
- Some VPS IPs are permanently banned - proxies may be required
- Consider using a residential VPS or home server for best results

## Alternative: Use Spotify Only

If YouTube continues to have issues, you can use Spotify exclusively:
1. Ensure Spotify credentials are in `.env`
2. Use Spotify URLs when adding songs
3. The bot will still try to find YouTube equivalents but will handle failures gracefully