const ytdl = require('@distube/ytdl-core');
const yts = require('yt-search');
const YouTube = require('youtube-sr').default;
const SpotifyWebApi = require('spotify-web-api-node');
const fetch = require('node-fetch');
const config = require('../config.js');
const play = require('play-dl');
const { spawn } = require('child_process');
const { Readable, PassThrough } = require('stream');
const fs = require('fs');
const path = require('path');
const DownloadCacheManager = require('./DownloadCacheManager');
const AudioProcessor = require('./AudioProcessor');

class SourceHandlers {
    constructor() {
        this.spotify = new SpotifyWebApi({
            clientId: config.spotify.clientId,
            clientSecret: config.spotify.clientSecret
        });
        
        // Multi-client rotation system for better success rates
        this.clientRotation = {
            currentIndex: 0,
            lastUsed: {},
            cooldowns: {},
            failureCounts: {}
        };
        
        // Initialize yt-dlp availability cache
        this.ytDlpAvailable = undefined;
        
        this.setupSpotify();
        this.setupPlayDl();
        
        // User agent rotation for anti-detection
        this.userAgents = [
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        ];

        // Initialize download cache manager
        this.downloadCache = new DownloadCacheManager();
        
        // Initialize robust audio processor for MP3 conversion
        this.audioProcessor = new AudioProcessor();
        
        // Initialize fallback robust system
        const RobustAudioProcessor = require('./RobustAudioProcessor');
        this.robustProcessor = new RobustAudioProcessor();
        
        // Stream cache for failed tracks
        this.streamCache = new Map();

        // Lightweight metadata cache (URL -> {data, ts})
        this.metaCache = new Map();
        this.metaCacheTTL = 5 * 60 * 1000; // 5 minutes
        
        // Session management for 403 mitigation
        this.sessionRotation = {
            currentSession: 0,
            lastUsed: Date.now(),
            cooldownTime: 60000, // 1 minute cooldown
            sessionErrors: new Map()
        };
        
        // Proxy configuration
        this.proxyConfig = this.setupProxyConfig();
        
        // Check yt-dlp availability on startup
        this.checkYtDlpAvailability();
        
        console.log('🎵 SourceHandlers initialized for YouTube and Spotify only');
    }

    async checkYtDlpAvailability() {
        try {
            const { spawn } = require('child_process');
            const ytdlp = spawn('yt-dlp', ['--version']);
            
            return new Promise((resolve) => {
                ytdlp.on('close', (code) => {
                    this.ytDlpAvailable = (code === 0);
                    if (this.ytDlpAvailable) {
                        console.log('✅ yt-dlp is available');
                    } else {
                        console.log('⚠️ yt-dlp not available');
                    }
                    resolve(this.ytDlpAvailable);
                });
                
                ytdlp.on('error', () => {
                    this.ytDlpAvailable = false;
                    console.log('⚠️ yt-dlp not available');
                    resolve(false);
                });
            });
        } catch (error) {
            this.ytDlpAvailable = false;
            return false;
        }
    }

    async isYtDlpAvailable() {
        if (this.ytDlpAvailable === undefined) {
            await this.checkYtDlpAvailability();
        }
        return this.ytDlpAvailable;
    }

    async getYouTubeMetadataWithYtDlp(url) {
        // Simple in-memory cache
        try {
            const cached = this.metaCache.get(url);
            if (cached && (Date.now() - cached.ts) < this.metaCacheTTL) {
                return cached.data;
            }
        } catch (_) {}
        return new Promise((resolve, reject) => {
            const { spawn } = require('child_process');
            const args = [
                '--no-config',
                '--dump-json',
                '--no-warnings',
                '--no-download',
                '--skip-download',
                '--socket-timeout', '10',
                '--retries', '2'
            ];

            // Try to use cookies if available
            try {
                const cookiesPath = process.env.COOKIES_PATH || './cookies.txt';
                const fs = require('fs');
                if (fs.existsSync(cookiesPath)) {
                    const txt = fs.readFileSync(cookiesPath, 'utf8');
                    if (txt && (txt.includes('Netscape HTTP Cookie File') || txt.includes('.youtube.com') || /^\.youtube\.com\t/m.test(txt))) {
                        args.push('--cookies', cookiesPath);
                        console.log('🍪 Using cookies for metadata fetch');
                    } else {
                        console.log('⚠️ Cookies file appears empty or invalid (metadata fetch)');
                    }
                }
            } catch (_) {}

            // Prefer a client less likely to be blocked for metadata
            args.push('--extractor-args', 'youtube:player_client=android');
            args.push('--user-agent', this.getRandomUserAgent());

            args.push(url);

            const ytdlp = spawn('yt-dlp', args);

            let output = '';
            let error = '';

            ytdlp.stdout.on('data', (data) => {
                output += data.toString();
            });

            ytdlp.stderr.on('data', (data) => {
                error += data.toString();
            });

            ytdlp.on('close', (code) => {
                if (code !== 0) {
                    reject(new Error(`yt-dlp failed with code ${code}: ${error}`));
                    return;
                }

                try {
                    const jsonData = JSON.parse(output);
                    const durationSeconds = jsonData.duration || 0;
                    const durationMS = durationSeconds * 1000;
                    
                    const data = {
                        title: jsonData.title || jsonData.fulltitle || 'Unknown Title',
                        author: jsonData.uploader || jsonData.channel || 'Unknown Artist',
                        duration: this.formatDuration(durationMS),
                        durationMS: durationMS,
                        url: jsonData.webpage_url || url,
                        thumbnail: jsonData.thumbnail || jsonData.thumbnails?.[0]?.url || null,
                        source: 'youtube',
                        type: 'track',
                        viewCount: jsonData.view_count || 0,
                        id: jsonData.id || this.extractYouTubeVideoId(url) || ''
                    };
                    try { this.metaCache.set(url, { data, ts: Date.now() }); } catch (_) {}
                    resolve(data);
                } catch (parseError) {
                    reject(new Error(`Failed to parse yt-dlp output: ${parseError.message}`));
                }
            });

            ytdlp.on('error', (err) => {
                reject(new Error(`Failed to spawn yt-dlp: ${err.message}`));
            });
        });
    }

    async searchWithYtDlp(query, limit = 5) {
        return new Promise((resolve, reject) => {
            const { spawn } = require('child_process');
            const ytdlp = spawn('yt-dlp', [
                '--no-config',
                '--flat-playlist',
                '--print', '%(title)s\n%(uploader)s\n%(duration)s\n%(webpage_url)s\n%(thumbnail)s',
                '--no-warnings',
                '--concurrent-fragments', '4',
                '--socket-timeout', '10',
                '--fragment-retries', '1',
                '--retries', '1',
                '--prefer-free-formats',
                `ytsearch${limit}:${query}`
            ]);

            let output = '';
            let error = '';

            ytdlp.stdout.on('data', (data) => {
                output += data.toString();
            });

            ytdlp.stderr.on('data', (data) => {
                error += data.toString();
            });

            ytdlp.on('close', (code) => {
                if (code !== 0) {
                    reject(new Error(`yt-dlp failed with code ${code}: ${error}`));
                    return;
                }

                try {
                    const results = [];
                    const lines = output.trim().split('\n').filter(line => line.trim());
                    
                    for (let i = 0; i < lines.length; i += 5) {
                        if (i + 3 < lines.length) {
                            const title = lines[i] || 'Unknown Title';
                            const uploader = lines[i + 1] || 'Unknown';
                            const duration = lines[i + 2] || '0:00';
                            const url = lines[i + 3] || '';
                            const thumbnail = lines[i + 4] || null;
                            
                            const durationSeconds = parseFloat(duration) || 0;
                            const durationMS = durationSeconds * 1000;
                            
                            results.push({
                                title,
                                author: uploader,
                                duration: this.formatDuration(durationMS),
                                durationMS: durationMS,
                                url,
                                thumbnail,
                                source: 'youtube',
                                type: 'track',
                                viewCount: 0,
                                id: this.extractYouTubeVideoId(url) || ''
                            });
                        }
                    }
                    
                    resolve(results);
                } catch (parseError) {
                    reject(new Error(`Failed to parse yt-dlp output: ${parseError.message}`));
                }
            });

            ytdlp.on('error', (err) => {
                reject(new Error(`Failed to spawn yt-dlp: ${err.message}`));
            });
        });
    }

    extractSpotifyPlaylistId(url) {
        const m = String(url).match(/spotify\.com\/playlist\/([a-zA-Z0-9]+)/);
        return m ? m[1] : null;
    }

    extractYouTubePlaylistId(url) {
        const u = new URL(url.startsWith('http') ? url : ('https://' + url));
        const list = u.searchParams.get('list');
        return list || null;
    }

    async getSpotifyPlaylist(url) {
        const playlistId = this.extractSpotifyPlaylistId(url);
        if (!playlistId) throw new Error('Invalid Spotify playlist URL');

        // Try multiple markets to avoid regional 404s
        const marketPref = process.env.SPOTIFY_MARKET || 'US';
        const markets = [marketPref, 'GB', 'DE', 'ES', 'FR', 'CA'];

        let lastError = null;
        for (const market of markets) {
            try {
                // Metadata
                const playlistResp = await this.spotify.getPlaylist(playlistId, { market });
                const playlist = playlistResp.body;

                // Tracks
                const tracks = [];
                let offset = 0;
                const limit = 100;
                while (true) {
                    const page = await this.spotify.getPlaylistTracks(playlistId, { offset, limit, market });
                    const items = page?.body?.items || [];
                    for (const item of items) {
                        const t = item.track;
                        if (!t) continue;
                        tracks.push({
                            title: t.name,
                            author: (t.artists || []).map(a => a.name).join(', ') || 'Unknown',
                            duration: this.formatDuration(t.duration_ms),
                            durationMS: t.duration_ms || 0,
                            url: t.external_urls?.spotify || `https://open.spotify.com/track/${t.id}`,
                            thumbnail: t.album?.images?.[0]?.url || null,
                            source: 'spotify',
                            type: 'track',
                            id: t.id
                        });
                    }
                    offset += items.length;
                    if (!page.body.next || items.length === 0) break;
                }

                return {
                    name: playlist.name || 'Spotify Playlist',
                    description: playlist.description || '',
                    image: playlist.images?.[0]?.url || null,
                    source: 'spotify',
                    tracks
                };
            } catch (error) {
                lastError = error;
                const status = error?.body?.error?.status || error?.statusCode;
                const message = error?.body?.error?.message || error?.message;
                console.log(`⚠️ Spotify API failed for market ${market}: ${status} ${message}`);
                // Try next market on 404s and similar
                continue;
            }
        }

        console.error('❌ Spotify playlist fetch error (all markets):', lastError?.message || lastError);
        throw lastError || new Error('Spotify playlist fetch failed');
    }

    async getYouTubePlaylist(url) {
        try {
            const listId = this.extractYouTubePlaylistId(url);
            if (!listId) throw new Error('Invalid YouTube playlist URL');

            // youtube-sr playlist fetch
            const playlist = await YouTube.getPlaylist(`https://www.youtube.com/playlist?list=${listId}`);
            await playlist.fetch();

            const tracks = (playlist.videos || []).map(v => ({
                title: v.title || 'Unknown',
                author: v.channel?.name || 'Unknown',
                duration: v.durationFormatted || '0:00',
                url: `https://www.youtube.com/watch?v=${v.id}`,
                thumbnail: v.thumbnail?.url || null,
                source: 'youtube',
                type: 'track',
                id: v.id
            }));

            return {
                name: playlist.title || 'YouTube Playlist',
                description: playlist.description || '',
                image: playlist.thumbnail?.url || null,
                source: 'youtube',
                tracks
            };
        } catch (error) {
            console.error('❌ YouTube playlist fetch error:', error?.message || error);
            throw error;
        }
    }

    async searchYouTubePlaylistByName(query, trackLimit = 100) {
        try {
            const results = await YouTube.search(query, { limit: 1, type: 'playlist' });
            if (!results || results.length === 0) return null;
            const pl = results[0];
            const playlist = await YouTube.getPlaylist(`https://www.youtube.com/playlist?list=${pl.id}`);
            await playlist.fetch();
            const videos = (playlist.videos || []).slice(0, trackLimit);
            return {
                name: playlist.title || query,
                description: playlist.description || '',
                image: playlist.thumbnail?.url || null,
                source: 'youtube',
                tracks: videos.map(v => ({
                    title: v.title || 'Unknown',
                    author: v.channel?.name || 'Unknown',
                    duration: v.durationFormatted || '0:00',
                    url: `https://www.youtube.com/watch?v=${v.id}`,
                    thumbnail: v.thumbnail?.url || null,
                    source: 'youtube',
                    type: 'track',
                    id: v.id
                }))
            };
        } catch (error) {
            console.log('⚠️ YouTube playlist search by name failed:', error?.message || error);
            return null;
        }
    }
    
    clearStreamCache(trackId) {
        if (this.streamCache.has(trackId)) {
            this.streamCache.delete(trackId);
            console.log(`🗑️ Cleared stream cache for track: ${trackId}`);
        }
    }
    
    handleSessionRotation() {
        const now = Date.now();
        
        // Check if we need to rotate session due to cooldown
        if (now - this.sessionRotation.lastUsed > this.sessionRotation.cooldownTime) {
            this.sessionRotation.currentSession = (this.sessionRotation.currentSession + 1) % 4;
            this.sessionRotation.lastUsed = now;
            console.log(`🔄 Rotated to session ${this.sessionRotation.currentSession}`);
        }
        
        return this.sessionRotation.currentSession;
    }
    
    async waitForCooldown(trackUrl) {
        const errors = this.sessionRotation.sessionErrors.get(trackUrl) || 0;
        if (errors > 0) {
            const waitTime = Math.min(errors * 500, 2000); // Reduced wait times
            console.log(`⏱️ Waiting ${waitTime}ms before retry due to previous errors`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
    }
    
    async findAlternativeYouTubeVideo(originalTrack) {
        try {
            // Try different search variations
            const searchQueries = [
                `${originalTrack.title} ${originalTrack.author}`,
                `${originalTrack.title} official`,
                `${originalTrack.title} audio`,
                `${originalTrack.title} lyrics`,
                originalTrack.title
            ];
            
            for (const query of searchQueries) {
                const results = await this.searchYouTube(query, 3);
                // Find a different video than the original
                const alternative = results.find(r => 
                    r.url !== originalTrack.url && 
                    !this.sessionRotation.sessionErrors.has(r.url)
                );
                
                if (alternative) {
                    return alternative;
                }
            }
            
            return null;
        } catch (error) {
            console.log(`⚠️ Failed to find alternative: ${error.message}`);
            return null;
        }
    }
    
    getRandomUserAgent() {
        return this.userAgents[Math.floor(Math.random() * this.userAgents.length)];
    }

    async setupSpotify() {
        try {
            const data = await this.spotify.clientCredentialsGrant();
            this.spotify.setAccessToken(data.body['access_token']);
            console.log('✅ Spotify API initialized');
            
            // Refresh token every 55 minutes
            setInterval(async () => {
                try {
                    const data = await this.spotify.clientCredentialsGrant();
                    this.spotify.setAccessToken(data.body['access_token']);
                    console.log('🔄 Spotify token refreshed');
                } catch (error) {
                    console.error('❌ Failed to refresh Spotify token:', error.message);
                }
            }, 55 * 60 * 1000);
        } catch (error) {
            console.error('❌ Failed to setup Spotify:', error.message);
        }
    }

    async setupPlayDl() {
        try {
            // play-dl doesn't need authentication for basic YouTube streaming
            console.log('✅ play-dl ready for streaming');
        } catch (error) {
            console.log('⚠️ play-dl setup failed:', error.message);
        }
    }

    setupProxyConfig() {
        const proxyConfig = {
            enabled: false,
            url: null,
            list: [],
            rotation: false,
            currentIndex: 0
        };

        // Check for proxy URL
        if (process.env.PROXY_URL && process.env.PROXY_URL.trim()) {
            proxyConfig.enabled = true;
            proxyConfig.url = process.env.PROXY_URL.trim();
            console.log('🌐 Single proxy configured');
        }

        // Check for proxy list (comma-separated)
        if (process.env.PROXY_LIST && process.env.PROXY_LIST.trim()) {
            const proxies = process.env.PROXY_LIST.split(',')
                .map(p => p.trim())
                .filter(p => p.length > 0);
            
            if (proxies.length > 0) {
                proxyConfig.enabled = true;
                proxyConfig.list = proxies;
                proxyConfig.rotation = String(process.env.PROXY_ROTATION || 'false').toLowerCase() === 'true';
                console.log(`🌐 Proxy list configured: ${proxies.length} proxies, rotation: ${proxyConfig.rotation}`);
            }
        }

        if (!proxyConfig.enabled) {
            console.log('🌐 No proxy configuration found');
        }

        return proxyConfig;
    }

    getNextProxy() {
        if (!this.proxyConfig.enabled) return null;

        // Single proxy mode
        if (this.proxyConfig.url) {
            return this.proxyConfig.url;
        }

        // Proxy list mode
        if (this.proxyConfig.list.length > 0) {
            if (this.proxyConfig.rotation) {
                const proxy = this.proxyConfig.list[this.proxyConfig.currentIndex];
                this.proxyConfig.currentIndex = (this.proxyConfig.currentIndex + 1) % this.proxyConfig.list.length;
                console.log(`🔄 Rotating to proxy ${this.proxyConfig.currentIndex}: ${proxy.split('@')[1] || proxy}`);
                return proxy;
            } else {
                // Use first proxy if rotation is disabled
                return this.proxyConfig.list[0];
            }
        }

        return null;
    }

    createProxyAgent(proxyUrl) {
        try {
            const url = new URL(proxyUrl);
            
            if (url.protocol === 'http:' || url.protocol === 'https:') {
                // HTTP/HTTPS proxy support
                const { HttpsProxyAgent } = require('https-proxy-agent');
                return new HttpsProxyAgent(proxyUrl);
            } else if (url.protocol === 'socks5:' || url.protocol === 'socks4:') {
                // SOCKS proxy support
                const { SocksProxyAgent } = require('socks-proxy-agent');
                return new SocksProxyAgent(proxyUrl);
            } else {
                console.log(`⚠️ Unsupported proxy protocol: ${url.protocol}`);
                return null;
            }
        } catch (error) {
            console.log(`⚠️ Error creating proxy agent: ${error.message}`);
            return null;
        }
    }

    isURL(str) {
        try {
            new URL(str);
            return true;
        } catch {
            // Check common URL patterns without protocol
            const urlPattern = /^(https?:\/\/)?([\da-z\.-]+)\.([a-z\.]{2,6})([\/\w \.-]*)*\/?$/i;
            const youtubePattern = /^(youtube\.com|youtu\.be|music\.youtube\.com)/i;
            const spotifyPattern = /^(spotify\.com|open\.spotify\.com)/i;
            
            return urlPattern.test(str) || youtubePattern.test(str) || spotifyPattern.test(str);
        }
    }

    async handleURL(url) {
        try {
            const urlObj = new URL(url.startsWith('http') ? url : 'https://' + url);
            const hostname = urlObj.hostname.toLowerCase();
            
            if (hostname.includes('youtube.com') || hostname.includes('youtu.be') || hostname.includes('music.youtube.com')) {
                return await this.handleYouTubeURL(url);
            } else if (hostname.includes('spotify.com')) {
                return await this.handleSpotifyURL(url);
            } else {
                console.log(`⚠️ Unsupported URL platform: ${hostname}. Only YouTube and Spotify are supported.`);
                return null;
            }
        } catch (error) {
            console.error(`❌ Error handling URL ${url}:`, error.message);
            return null;
        }
    }

    async handleYouTubeURL(url) {
        try {
            const videoId = this.extractYouTubeVideoId(url);
            if (!videoId) {
                throw new Error('Invalid YouTube URL');
            }

            const fullUrl = `https://www.youtube.com/watch?v=${videoId}`;
            
            // Try yt-dlp first as it's most reliable against bot detection
            if (await this.isYtDlpAvailable()) {
                try {
                    const metadata = await this.getYouTubeMetadataWithYtDlp(fullUrl);
                    if (metadata) {
                        console.log('✅ yt-dlp successfully fetched metadata');
                        return metadata;
                    }
                } catch (ytdlpError) {
                    console.log(`⚠️ yt-dlp metadata fetch failed: ${ytdlpError?.message || ytdlpError}`);
                }
            }

            // Fallback to YouTube-SR
            try {
                const video = await YouTube.getVideo(fullUrl);
                if (video && video.title) {
                    return {
                        title: video.title || videoId,
                        author: video.channel?.name || 'Unknown',
                        duration: video.durationFormatted || '0:00',
                        durationMS: (video.duration && typeof video.duration === 'number') ? video.duration * 1000 : 0,
                        url: fullUrl,
                        thumbnail: video.thumbnail?.url || null,
                        source: 'youtube',
                        type: 'track',
                        viewCount: video.views || 0,
                        id: videoId
                    };
                }
            } catch (metaErr) {
                console.log(`⚠️ YouTube-SR failed: ${metaErr?.message || metaErr}`);
            }

            // Final fallback: use ytdl-core to retrieve metadata before giving up
            try {
                const info = await ytdl.getInfo(fullUrl, {
                    requestOptions: {
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                            'Accept-Language': 'en-US,en;q=0.9'
                        }
                    }
                });

                const details = info?.videoDetails || {};
                const seconds = Number(details.lengthSeconds || 0);
                const duration = seconds > 0
                    ? (seconds >= 3600
                        ? `${Math.floor(seconds / 3600)}:${String(Math.floor((seconds % 3600) / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
                        : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`)
                    : '0:00';

                // Pick the highest resolution thumbnail available
                let thumb = null;
                try {
                    const thumbs = details?.thumbnails || [];
                    if (Array.isArray(thumbs) && thumbs.length > 0) {
                        thumb = thumbs.reduce((a, b) => (a?.width || 0) > (b?.width || 0) ? a : b)?.url || thumbs[0]?.url || null;
                    }
                } catch {}

                return {
                    title: details.title || videoId,
                    author: details.author?.name || details.ownerChannelName || 'YouTube',
                    duration,
                    durationMS: seconds * 1000,
                    url: fullUrl,
                    thumbnail: thumb,
                    source: 'youtube',
                    type: 'track',
                    viewCount: Number(details.viewCount || 0),
                    id: videoId
                };
            } catch (ytdlErr) {
                console.log(`⚠️ YouTube metadata fetch failed (youtube-sr: Cannot read properties of null (reading 'title'); ytdl-core: ${ytdlErr?.message || ytdlErr}). Falling back to minimal info.`);
                return {
                    title: videoId,
                    author: 'YouTube',
                    duration: '0:00',
                    durationMS: 0,
                    url: fullUrl,
                    thumbnail: null,
                    source: 'youtube',
                    type: 'track',
                    viewCount: 0,
                    id: videoId
                };
            }
        } catch (error) {
            console.error(`❌ Error handling YouTube URL:`, error.message);
            return null;
        }
    }

    async handleSpotifyURL(url) {
        try {
            const trackId = this.extractSpotifyTrackId(url);
            if (!trackId) {
                throw new Error('Invalid Spotify URL');
            }

            const track = await this.spotify.getTrack(trackId);
            return {
                title: track.body.name,
                author: track.body.artists.map(artist => artist.name).join(', '),
                duration: this.formatDuration(track.body.duration_ms),
                durationMS: track.body.duration_ms || 0,
                url: track.body.external_urls.spotify,
                thumbnail: track.body.album.images[0]?.url || null,
                source: 'spotify',
                type: 'track',
                id: trackId
            };
        } catch (error) {
            console.error(`❌ Error handling Spotify URL:`, error.message);
            return null;
        }
    }

    extractYouTubeVideoId(url) {
        try {
            const u = new URL(url.startsWith('http') ? url : ('https://' + url));
            url = u.toString();
        } catch (_) {}

        const patterns = [
            /(?:youtube\.com\/watch\?v=|music\.youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/)([a-zA-Z0-9_-]{11})/,
            /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
            /^([a-zA-Z0-9_-]{11})$/
        ];
        
        for (const pattern of patterns) {
            const match = url.match(pattern);
            if (match) return match[1];
        }
        return null;
    }

    extractSpotifyTrackId(url) {
        const match = url.match(/spotify\.com\/track\/([a-zA-Z0-9]+)/);
        return match ? match[1] : null;
    }

    async search(query, limit = 8) {
        const results = [];
        
        if (this.isURL(query)) {
            const track = await this.handleURL(query);
            if (track) results.push(track);
        } else {
            // Search YouTube and Spotify in parallel for speed
            console.log(`🔍 Starting parallel search for: ${query}`);
            const safeLimit = Math.max(1, Number.isFinite(limit) ? Math.floor(limit) : 1);
            const spotifyLimit = Math.max(1, Math.floor(safeLimit / 2));
            const youtubeLimit = Math.max(1, Math.ceil(safeLimit / 2));

            const searches = await Promise.allSettled([
                this.searchSpotify(query, spotifyLimit),
                this.searchYouTube(query, youtubeLimit)
            ]);

            for (const search of searches) {
                if (search.status === 'fulfilled' && search.value) {
                    results.push(...search.value);
                } else if (search.status === 'rejected') {
                    console.error('❌ Search failed:', search.reason.message);
                }
            }
        }

        if (results.length === 0) {
            console.log(`❌ No results found for: ${query}`);
            return [];
        }

        // Sort by relevance and source preference
        const sortedResults = this.sortByRelevance(results, query);
        console.log(`✅ Found ${sortedResults.length} total results for: ${query}`);
        
        return sortedResults.slice(0, limit);
    }

    sortByRelevance(results, query) {
        const queryLower = query.toLowerCase();
        const queryWords = queryLower.split(/\s+/).filter(word => word.length > 2);
        
        return results.map(result => {
            let score = 0;
            const titleLower = result.title.toLowerCase();
            const authorLower = result.author.toLowerCase();
            const channelHints = authorLower;
            
            // Exact title match
            if (titleLower === queryLower) score += 100;
            
            // Title starts with query
            if (titleLower.startsWith(queryLower)) score += 80;
            
            // Title contains full query
            if (titleLower.includes(queryLower)) score += 50;
            
            // Word-by-word matching for better fuzzy search
            let wordMatches = 0;
            for (const word of queryWords) {
                if (titleLower.includes(word)) {
                    wordMatches++;
                    score += 15;
                }
                if (authorLower.includes(word)) {
                    wordMatches++;
                    score += 10;
                }
            }
            
            // Bonus for matching most words
            if (wordMatches >= queryWords.length * 0.8) score += 25;
            
            // Author exact match
            if (authorLower === queryLower) score += 60;
            
            // Author contains query
            if (authorLower.includes(queryLower)) score += 30;
            
            // Duration preference (2-8 minutes)
            if (result.durationMS) {
                const minutes = result.durationMS / 60000;
                if (minutes >= 2 && minutes <= 8) score += 5;
            }
            
            // Source preference (YouTube > Spotify)
            if (result.source === 'youtube') score += 20;
            else if (result.source === 'spotify') score += 15;
            
            // View count bonus for YouTube (scaled logarithmically)
            if (result.viewCount && result.viewCount > 1000) {
                score += Math.min(Math.log10(result.viewCount) * 2, 15); // Max 15 points for views
            }
            
            // Penalize very long titles (likely to be low quality)
            if (result.title.length > 100) score -= 5;

            // Deprioritize noisy variants unless explicitly requested
            const negativeHints = ['nightcore', 'sped up', '8d', 'slowed', 'reverb', 'remix', 'cover', 'live'];
            for (const hint of negativeHints) {
                if (titleLower.includes(hint) && !queryLower.includes(hint)) score -= 15;
            }

            // Prefer official/Topic-like channels
            if (/official|vevo|topic/.test(channelHints)) score += 8;
            
            return { ...result, relevanceScore: score };
        }).sort((a, b) => b.relevanceScore - a.relevanceScore);
    }

    async searchYouTube(query, limit = 5) {
        if (!query || typeof query !== 'string') {
            console.error('❌ Invalid YouTube search query:', query);
            return [];
        }

        try {
            console.log(`🔍 yt-search for: ${query}`);
            
            try {
                const ytsResults = await yts(query);
                
                if (ytsResults && ytsResults.videos && Array.isArray(ytsResults.videos) && ytsResults.videos.length > 0) {
                    console.log(`✅ yt-search found ${ytsResults.videos.length} results`);
                    return ytsResults.videos.slice(0, limit).map(video => {
                        const durationSeconds = video.duration?.seconds || 0;
                        const durationMS = durationSeconds * 1000;
                        return {
                            title: video.title || 'Unknown Title',
                            author: video.author?.name || video.author || 'Unknown',
                            duration: video.duration?.timestamp || video.timestamp || '0:00',
                            durationMS: durationMS,
                            url: video.url,
                            thumbnail: video.thumbnail || null,
                            source: 'youtube',
                            type: 'track',
                            viewCount: video.views || 0,
                            id: video.videoId
                        };
                    });
                } else {
                    console.log('⚠️ yt-search returned no results');
                }
            } catch (ytsError) {
                console.log(`⚠️ yt-search failed: ${ytsError?.message || 'Unknown error'}`);
            }

            console.log('🔄 Trying YouTube-SR fallback');
            try {
                const results = await YouTube.search(query, { limit, type: 'video' });
                
                if (results && Array.isArray(results) && results.length > 0) {
                    console.log(`✅ YouTube-SR found ${results.length} results`);
                    return results.map(video => {
                        const durationSeconds = video.duration || 0;
                        const durationMS = durationSeconds * 1000;
                        return {
                            title: video.title || 'Unknown Title',
                            author: video.channel?.name || 'Unknown',
                            duration: video.durationFormatted || '0:00',
                            durationMS: durationMS,
                            url: `https://www.youtube.com/watch?v=${video.id}`,
                            thumbnail: video.thumbnail?.url || null,
                            source: 'youtube',
                            type: 'track',
                            viewCount: video.views || 0,
                            id: video.id
                        };
                    });
                } else {
                    console.log('⚠️ YouTube-SR returned no results');
                }
            } catch (srError) {
                const errorMsg = srError?.message || 'Unknown error';
                if (errorMsg.includes('Cannot read properties of null') && errorMsg.includes('title')) {
                    console.log('⚠️ YouTube-SR failed: Bot detection - Cannot read properties of null (reading \'title\')');
                } else {
                    console.log(`⚠️ YouTube-SR failed: ${errorMsg}`);
                }
            }

            console.log('🔄 Trying yt-dlp search fallback');
            try {
                const dlResults = await this.searchWithYtDlp(query, limit);
                if (dlResults && dlResults.length > 0) {
                    console.log(`✅ yt-dlp search found ${dlResults.length} results`);
                    return dlResults;
                }
            } catch (e) {
                console.log(`⚠️ yt-dlp search failed: ${e?.message || e}`);
            }

            console.log('❌ All YouTube search methods failed (likely due to bot detection).');
            return [];
        } catch (error) {
            console.error('❌ YouTube search error:', error?.message || String(error) || 'Unknown error');
            return [];
        }
    }

    async searchSpotify(query, limit = 5) {
        try {
            console.log(`🔍 Spotify search for: ${query}`);
            
            const results = await this.spotify.searchTracks(query, { limit });
            
            if (results.body.tracks.items.length > 0) {
                console.log(`✅ Spotify found ${results.body.tracks.items.length} results`);
                return results.body.tracks.items.map(track => ({
                    title: track.name,
                    author: track.artists.map(artist => artist.name).join(', '),
                    duration: this.formatDuration(track.duration_ms),
                    url: track.external_urls.spotify,
                    thumbnail: track.album.images[0]?.url || null,
                    source: 'spotify',
                    type: 'track',
                    id: track.id,
                    popularity: track.popularity
                }));
            }

            return [];
        } catch (error) {
            console.error('❌ Spotify search error:', error.message);
            return [];
        }
    }

    formatDuration(ms) {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        
        if (hours > 0) {
            return `${hours}:${(minutes % 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
        }
        return `${minutes}:${(seconds % 60).toString().padStart(2, '0')}`;
    }

    async getStream(track, options = {}) {
        console.log(`🎵 Getting stream for: ${track.title} from ${track.source}`);
        
        await this.prepareTrackForPlayback(track);
        
        // Enhanced multi-source acquisition with intelligent fallbacks
        const maxAttempts = 3;
        const sources = this.determineBestSources(track);
        
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            for (const source of sources) {
                try {
                    console.log(`🔄 Attempt ${attempt}/${maxAttempts} - Trying ${source} for: ${track.title}`);
                    
                    let stream;
                    if (source === 'spotify') {
                        stream = await this.getSpotifyStream(track, options);
                    } else if (source === 'youtube') {
                        stream = await this.getYouTubeStream(track, options);
                    } else if (source === 'youtube-alternate') {
                        stream = await this.getYouTubeAlternateSearch(track, options);
                    } else if (source === 'soundcloud') {
                        stream = await this.getSoundCloudStream(track, options);
                    } else if (source === 'generic') {
                        stream = await this.getGenericAudioStream(track, options);
                    }
                    
                    if (stream && stream.readable) {
                        console.log(`✅ Successfully got stream from ${source} for: ${track.title}`);
                        track._lastSuccessfulSource = source;
                        return stream;
                    }
                } catch (error) {
                    console.log(`❌ ${source} failed (attempt ${attempt}): ${error.message}`);
                    // Continue to next source/attempt
                }
            }
        }
        
        throw new Error(`All streaming methods failed for ${track.title} after ${maxAttempts} attempts across multiple sources`);
    }

    determineBestSources(track) {
        const sources = [];
        
        // Primary source first
        if (track.source === 'youtube') {
            sources.push('youtube');
        } else if (track.source === 'spotify') {
            sources.push('spotify');
        }
        
        // Add fallback sources based on track metadata
        if (track.source !== 'youtube') {
            sources.push('youtube', 'youtube-alternate');
        }
        
        // Additional fallback sources
        sources.push('soundcloud', 'generic');
        
        // Remove duplicates while preserving order
        return [...new Set(sources)];
    }

    isLikelyPlayableUrl(url) {
        if (typeof url !== 'string') return false;
        const trimmed = url.trim();
        if (!/^https?:\/\//i.test(trimmed)) return false;
        return /(youtube\.com|youtu\.be|music\.youtube\.com|open\.spotify\.com|soundcloud\.com)/i.test(trimmed);
    }

    buildSearchQueryForTrack(track) {
        if (!track) return '';
        const pieces = [];
        if (track.title) pieces.push(track.title);
        if (track.author) pieces.push(track.author);
        if (track.album) pieces.push(track.album);
        const base = pieces.join(' ').trim();
        const url = typeof track.url === 'string' ? track.url.trim() : '';
        if (url && !this.isLikelyPlayableUrl(url)) {
            if (!base) return url;
            const lowerBase = base.toLowerCase();
            const lowerUrl = url.toLowerCase();
            if (lowerUrl.includes(lowerBase)) {
                return url;
            }
            return `${base} ${url}`.trim();
        }
        return base;
    }

    computeTokenOverlap(a, b) {
        if (!a || !b) return 0;
        const tokensA = new Set(a.split(/\s+/).filter(Boolean));
        const tokensB = new Set(b.split(/\s+/).filter(Boolean));
        if (tokensA.size === 0 || tokensB.size === 0) return 0;
        let matches = 0;
        for (const token of tokensA) {
            if (tokensB.has(token)) matches++;
        }
        return matches / Math.max(tokensA.size, tokensB.size);
    }

    selectBestSearchMatch(results, target) {
        if (!Array.isArray(results) || results.length === 0) return null;
        const title = (target?.title || '').toLowerCase();
        const artist = (target?.author || '').toLowerCase();
        const durationMS = Number(target?.durationMS || 0);
        
        let best = null;
        let bestScore = -Infinity;
        
        for (const candidate of results) {
            let score = 0;
            const candTitle = (candidate.title || '').toLowerCase();
            const candAuthor = (candidate.author || '').toLowerCase();
            
            if (title) {
                if (candTitle === title) score += 2.0;
                else if (candTitle.includes(title)) score += 1.2;
                else score += this.computeTokenOverlap(candTitle, title) * 1.0;
            }
            
            if (artist) {
                if (candAuthor === artist) score += 1.0;
                else if (candAuthor.includes(artist)) score += 0.7;
                else score += this.computeTokenOverlap(candAuthor, artist) * 0.5;
            }
            
            if (durationMS > 0 && candidate.durationMS) {
                const delta = Math.abs(durationMS - candidate.durationMS);
                const tolerance = Math.max(6000, durationMS * 0.08);
                if (delta <= tolerance) score += 0.5;
            }
            
            if ((candidate.viewCount || 0) > 1000000) score += 0.2;
            if (/official|lyrics|audio/i.test(candidate.title || '')) score += 0.1;
            if (/live|cover|remix|tiktok|challenge/i.test(candidate.title || '')) score -= 0.3;
            
            if (score > bestScore) {
                bestScore = score;
                best = candidate;
            }
        }
        
        return best || results[0];
    }

    async prepareTrackForPlayback(track) {
        try {
            if (!track || this.isLikelyPlayableUrl(track.url) || track._searchResolved) {
                return track;
            }
            
            const query = this.buildSearchQueryForTrack(track);
            if (!query) return track;
            
            const results = await this.searchYouTube(query, 6);
            if (!results || results.length === 0) {
                return track;
            }
            
            const bestMatch = this.selectBestSearchMatch(results, track);
            if (bestMatch) {
                if (track.url && !track._originalUrl) {
                    track._originalUrl = track.url;
                }
                track.url = bestMatch.url;
                track.source = bestMatch.source || 'youtube';
                track.thumbnail = track.thumbnail || bestMatch.thumbnail;
                track.duration = track.duration || bestMatch.duration;
                track.durationMS = track.durationMS || bestMatch.durationMS;
                track.author = track.author || bestMatch.author;
                track.title = track.title || bestMatch.title;
                track._searchResolved = true;
            }
            
            return track;
        } catch (error) {
            console.log(`⚠️ prepareTrackForPlayback failed: ${error?.message || error}`);
            return track;
        }
    }

    async getYouTubeStream(track, options = {}) {
        console.log(`🎵 Getting YouTube stream for: ${track.title}`);
        
        // FIRST: Check if MP3 file already exists in cache (instant playback)
        const crypto = require('crypto');
        const cacheKey = crypto.createHash('md5').update(track.url).digest('hex');
        const mp3Path = path.join(__dirname, '..', 'cache', 'audio', `${cacheKey}.mp3`);
        
        if (fs.existsSync(mp3Path)) {
            // Validate cached file before using
            const stats = fs.statSync(mp3Path);
            if (stats.size === 0) {
                console.log(`🗑️ Deleting corrupted empty cache file: ${cacheKey}.mp3`);
                fs.unlinkSync(mp3Path);
            } else {
                console.log(`⚡ INSTANT PLAYBACK - Using cached MP3: ${track.title} (${(stats.size / 1024 / 1024).toFixed(2)}MB)`);
                
                // Emit instant ready progress
                if (this.audioProcessor) {
                    this.audioProcessor.emit('progress', {
                        cacheKey,
                        title: track.title,
                        progress: 100,
                        status: 'Ready! (cached)',
                        url: track.url,
                        guildId: track.guildId,
                        channelId: track.channelId,
                        cached: true
                    });
                }
                
                const stream = fs.createReadStream(mp3Path);
                
                // Handle seek if requested
                if (options.seekSeconds && options.seekSeconds > 0) {
                    console.log(`⏩ Seeking to ${options.seekSeconds} seconds in MP3 file`);
                    return this.createSeekableMP3Stream(mp3Path, options.seekSeconds);
                }
                
                return stream;
            }
        }
        
        // SECOND: Try direct streaming with play-dl only
        try {
            console.log(`⚡ Attempting play-dl streaming: ${track.title}`);
            
            const videoId = this.extractYouTubeVideoId(track.url);
            if (videoId && videoId.length === 11) {
                const cleanUrl = `https://www.youtube.com/watch?v=${videoId}`;
                
                const play = require('play-dl');
                
                // Skip validation and try direct streaming
                const streamResult = await play.stream(cleanUrl, {
                    quality: 2,
                    discordPlayerCompatibility: true
                });
                console.log('🎉 play-dl instant stream created!');
                return streamResult.stream;
            }
            throw new Error('Invalid video ID');
            
        } catch (streamError) {
            // Silently fall through to download method
            console.log(`🔄 play-dl not available, using download method`);
        }
        
        // THIRD: Download & convert as final fallback (only if play-dl fails)
        try {
            console.log(`📥 Downloading & converting: ${track.title}`);
            
            // Emit initial progress for frontend
            if (this.audioProcessor) {
                this.audioProcessor.emit('progress', {
                    cacheKey: crypto.createHash('md5').update(track.url).digest('hex'),
                    title: track.title,
                    progress: 0,
                    status: 'Starting download...',
                    url: track.url,
                    ...((options && options.meta) ? options.meta : {})
                });
            }
            
            const meta = (options && options.meta) ? options.meta : {};
            const result = await this.audioProcessor.downloadAndConvert(track.url, track.title, meta);
            
            console.log(`✅ Downloaded and converted to MP3: ${track.title}`);
            return fs.createReadStream(result.path);
            
        } catch (error) {
            console.error(`❌ Primary download failed: ${error.message}`);
            
            // FOURTH: Try robust processor as final fallback
            try {
                console.log(`🔄 Trying robust processor as fallback for: ${track.title}`);
                
                // Ensure we have a valid URL for the robust processor
                let urlToUse = track.url;
                if (!urlToUse || urlToUse === 'false' || typeof urlToUse !== 'string') {
                    // If no valid URL, try to construct one from video ID
                    const videoId = this.extractYouTubeVideoId(track.title) || track.id || track.videoId;
                    if (videoId) {
                        urlToUse = `https://www.youtube.com/watch?v=${videoId}`;
                    } else {
                        throw new Error('No valid URL available for robust processor');
                    }
                }
                
                const meta = (options && options.meta) ? options.meta : {};
                const result = await this.robustProcessor.downloadAndConvert(urlToUse, track.title, meta);
                
                if (result && result.path && fs.existsSync(result.path)) {
                    console.log(`✅ Robust processor succeeded: ${track.title}`);
                    return fs.createReadStream(result.path);
                }
                
                throw new Error('Robust processor failed to create valid file');
                
            } catch (robustError) {
                console.error(`❌ All methods failed including robust processor: ${robustError.message}`);
                throw new Error(`All streaming methods failed. Primary: ${error.message}, Robust: ${robustError.message}`);
            }
        }
    }

    async getYouTubeStreamFallback(track, options = {}) {
        console.log(`⚡ INSTANT STREAMING for: ${track.title}`);
        
        const videoId = this.downloadCache.extractVideoId(track.url);
        if (!videoId) {
            throw new Error('Could not extract video ID from URL');
        }
        
        // Check if file is already cached (fastest option)
        if (this.downloadCache.isFileCached(videoId)) {
            console.log(`📂 Using cached file for instant playback`);
            return this.downloadCache.createReadStream(videoId);
        }
        
        // Try play-dl with proper URL formatting and validation
        try {
            console.log('⚡ Attempting play-dl with enhanced validation...');
            
            // Extract video ID and create clean URL
            const videoId = this.extractYouTubeVideoId(track.url);
            if (!videoId || videoId.length !== 11) {
                throw new Error(`Invalid video ID extracted: ${videoId}`);
            }
            
            const cleanUrl = `https://www.youtube.com/watch?v=${videoId}`;
            console.log(`🔗 Using clean URL: ${cleanUrl}`);
            
            // Emit progress for streaming start
            if (this.audioProcessor) {
                this.audioProcessor.emit('progress', {
                    cacheKey: videoId,
                    title: track.title,
                    progress: 0,
                    status: 'Connecting to stream...',
                    url: track.url,
                    guildId: track.guildId,
                    channelId: track.channelId
                });
            }
            
            // Skip validation and try direct streaming
            const play = require('play-dl');
            
            // Emit progress for stream preparation
            if (this.audioProcessor) {
                this.audioProcessor.emit('progress', {
                    cacheKey: videoId,
                    title: track.title,
                    progress: 50,
                    status: 'Preparing stream...',
                    url: track.url,
                    guildId: track.guildId,
                    channelId: track.channelId
                });
            }
            
            const streamResult = await play.stream(cleanUrl, {
                quality: 2,
                discordPlayerCompatibility: true,
                ...(typeof options.seekSeconds === 'number' && options.seekSeconds > 0 ? { seek: Math.floor(options.seekSeconds) } : {})
            });
            
            // Emit progress for stream ready
            if (this.audioProcessor) {
                this.audioProcessor.emit('progress', {
                    cacheKey: videoId,
                    title: track.title,
                    progress: 100,
                    status: 'Stream ready!',
                    url: track.url,
                    guildId: track.guildId,
                    channelId: track.channelId
                });
            }
            
            console.log('🎉 play-dl stream created successfully!');
            return streamResult.stream;
            
        } catch (playDlError) {
            console.log(`⚠️ play-dl failed: ${playDlError.message}`);
        }
        
        // If play-dl fails, try using the cached MP3 file that was created in background
        const crypto = require('crypto');
        const cacheKey = crypto.createHash('md5').update(track.url).digest('hex');
        const mp3Path = path.join(__dirname, '..', 'cache', 'audio', `${cacheKey}.mp3`);
        
        if (fs.existsSync(mp3Path)) {
            console.log('📂 Using pre-downloaded MP3 file for instant playback!');
            return fs.createReadStream(mp3Path);
        }
        
        // Final fallback - wait for download to complete and use file
        console.log('⏳ Waiting for MP3 download to complete...');
        let attempts = 0;
        while (attempts < 30) { // Wait up to 30 seconds
            await new Promise(resolve => setTimeout(resolve, 1000));
            if (fs.existsSync(mp3Path)) {
                console.log('✅ MP3 file ready - using for playback');
                return fs.createReadStream(mp3Path);
            }
            attempts++;
        }
        
        throw new Error('All streaming methods failed and no cached file available');
    }

    async getSpotifyStream(track, options = {}) {
        try {
            console.log(`🎵 Finding YouTube equivalent for Spotify track: ${track.title}`);
            
            // If we have a pre-resolved equivalent, use it
            if (track._prefetchResolved && track._prefetchResolved.source === 'youtube') {
                console.log(`✅ Using pre-resolved YouTube equivalent: ${track._prefetchResolved.title}`);
                return await this.getYouTubeStream(track._prefetchResolved, options);
            }

            // Otherwise, resolve now
            const resolved = await this.resolveForPlayback(track);
            if (resolved) {
                console.log(`✅ Resolved YouTube equivalent: ${resolved.title}`);
                return await this.getYouTubeStream(resolved, options);
            } else {
                throw new Error('No YouTube equivalent found for Spotify track');
            }
        } catch (error) {
            console.error(`❌ Spotify stream error: ${error.message}`);
            throw error;
        }
    }

    async resolveForPlayback(track) {
        try {
            if (!track) return null;
            if (track.source === 'youtube') return track;
            // Resolve Spotify (and others in future) to a YouTube track object
            let query = `${track.title || ''} ${track.author || ''}`.trim();
            let targetDuration = Number(track.durationMS || 0);
            // Try to enrich with exact Spotify metadata for better matching
            try {
                if (track.source === 'spotify' && track.id) {
                    const t = await this.spotify.getTrack(track.id);
                    const name = t?.body?.name || track.title;
                    const artists = (t?.body?.artists || []).map(a => a.name).join(' ');
                    const isrc = t?.body?.external_ids?.isrc;
                    query = `${name} ${artists} audio`;
                    targetDuration = Number(t?.body?.duration_ms || targetDuration);
                    if (isrc) {
                        // Include ISRC in query (often helps find Topic uploads)
                        query += ` ${isrc}`;
                    }
                }
            } catch (_) {}

            const results = await this.searchYouTube(query, 6);
            if (!results || results.length === 0) return null;

            // Prefer duration-closest match (within 8% tolerance), then highest relevance
            let best = null;
            let bestDelta = Infinity;
            for (const r of results) {
                if (targetDuration > 0 && r.durationMS) {
                    const delta = Math.abs(r.durationMS - targetDuration);
                    const tolerance = Math.max(8000, targetDuration * 0.08);
                    if (delta <= tolerance && delta < bestDelta) {
                        best = r; bestDelta = delta;
                    }
                }
            }
            return best || results[0] || null;
        } catch (e) {
            console.log(`⚠️ resolveForPlayback failed: ${e?.message || e}`);
            return null;
        }
    }

    async getYtDlpStream(track, formatIndex = 0) {
        // Handle session rotation and cooldowns
        this.handleSessionRotation();
        await this.waitForCooldown(track.url);

        // Use streaming-optimized formats for fastest start - prioritize 18 (360p mp4) as it's most reliable
        const formats = ['18', 'worst[height<=360]/worst', 'bestaudio', '140', '139', 'worstaudio'];
        // Android client first - often bypasses restrictions
        const clients = ['android', 'web'];

        // Try format/client combinations with fast failure detection
        for (let i = 0; i < formats.length; i++) {
            const fmt = formats[(formatIndex + i) % formats.length];
            for (let c = 0; c < clients.length; c++) {
                const client = clients[c];
                try {
                    const stream = await this.spawnYtDlp(track, fmt, client);
                    try { track._lastFormat = fmt; track._lastExtractor = 'ytdlp'; track._lastClient = client; } catch {}
                    console.log(`✅ Stream success with format ${fmt} and client ${client}`);
                    return stream;
                } catch (err) {
                    const msg = String(err?.message || err);
                    console.log(`⚠️ yt-dlp failed (fmt=${fmt}, client=${client}): ${msg.substring(0, 100)}...`);
                    
                    // Fast failure for auth issues
                    if (/Please sign in|cookies/i.test(msg)) {
                        throw err;
                    }
                    
                    // Skip remaining clients for this format if it's definitely not available
                    if (/Requested format is not available|No video formats found/i.test(msg)) {
                        console.log(`🚫 Skipping remaining clients for format ${fmt} - not available`);
                        break;
                    }
                    
                    // For 403 errors, try next client immediately
                    if (/403|Forbidden/i.test(msg) && c === 0) {
                        console.log(`🔄 Got 403 with ${client}, trying next client quickly`);
                        continue;
                    }
                }
            }
        }

        // As a last attempt, try an alternative video for the same track
        if (!track._altTried) {
            try {
                const alt = await this.findAlternativeYouTubeVideo(track);
                if (alt) {
                    console.log(`🔁 Trying alternative YouTube video: ${alt.title}`);
                    alt._altTried = true;
                    return await this.getYtDlpStream(alt, 0);
                }
            } catch (e) {
                console.log(`⚠️ Alternative lookup failed: ${e?.message || e}`);
            }
        }

        throw new Error('yt-dlp: all audio formats and clients failed');
    }

    spawnYtDlp(track, fmt, client = 'web') {
        return new Promise((resolve, reject) => {
            console.log(`🔄 Using yt-dlp for: ${track.title}`);
            
            // Emit progress for streaming start
            if (this.audioProcessor) {
                this.audioProcessor.emit('progress', {
                    cacheKey: track.url,
                    title: track.title,
                    progress: 0,
                    status: 'Preparing stream...',
                    url: track.url,
                    isStreaming: true
                });
            }

            const cookiesPath = process.env.COOKIES_PATH || './cookies.txt';
            const fs = require('fs');

            let hasCookies = false;
            if (fs.existsSync(cookiesPath)) {
                try {
                    const cookiesContent = fs.readFileSync(cookiesPath, 'utf8');
                    // Check for Netscape format header or actual cookie entries
                    if (cookiesContent && cookiesContent.trim() && 
                        (cookiesContent.includes('Netscape HTTP Cookie File') || 
                         cookiesContent.includes('.youtube.com') ||
                         /^\.youtube\.com\t/m.test(cookiesContent))) {
                        hasCookies = true;
                        const cookieLines = cookiesContent.split('\n').filter(l => l && !l.startsWith('#'));
                        console.log(`🍪 Found valid cookies file with ${cookieLines.length} cookie entries`);
                    } else {
                        console.log('⚠️ Cookies file appears empty or invalid');
                        // Try to restore from backup
                        const backupPath = path.join(__dirname, '..', 'backup-cookies.txt');
                        if (fs.existsSync(backupPath)) {
                            try {
                                const backupContent = fs.readFileSync(backupPath, 'utf8');
                                if (backupContent && backupContent.includes('.youtube.com')) {
                                    fs.writeFileSync(cookiesPath, backupContent);
                                    console.log('🔄 Restored cookies from backup');
                                    hasCookies = true;
                                }
                            } catch (restoreErr) {
                                console.log('⚠️ Failed to restore cookies from backup');
                            }
                        }
                    }
                } catch (error) {
                    console.log('⚠️ Failed to read cookies file, continuing without cookies');
                }
            }

            const ytdlpArgs = [
                '--no-config',
                '--format', fmt,
                '--output', '-',
                '--no-warnings',
                '--no-playlist',
                '--no-check-certificates',
                '--prefer-insecure',
                '--force-ipv4',
                '--concurrent-fragments', '4',  // Reduced for stability
                '--no-part',
                '--geo-bypass',
                '--geo-bypass-country', 'US',
                '--no-update',
                '--socket-timeout', '15',  // Increased for stability
                '--retries', '3',  // More retries for reliability
                '--fragment-retries', '3',
                '--retry-sleep', '1',  // Small delay between retries
                '--sleep-interval', '0',
                '--max-sleep-interval', '2',
                '--ignore-errors',
                '--no-abort-on-error',
                '--no-progress',
                '--extractor-retries', '2',
                '--buffer-size', '32K',  // Larger buffer for better streaming
                '--http-chunk-size', '512K'  // Smaller chunks for faster start
            ];

            if (hasCookies) {
                // Use a temporary copy to prevent corruption of original cookies
                const tempCookiesPath = path.join(__dirname, '..', `temp-cookies-${Date.now()}.txt`);
                try {
                    const originalContent = fs.readFileSync(cookiesPath, 'utf8');
                    fs.writeFileSync(tempCookiesPath, originalContent);
                    ytdlpArgs.push('--cookies', tempCookiesPath);
                    console.log(`🍪 Using temp cookies copy: ${tempCookiesPath}`);
                    
                    // Clean up temp file after a delay
                    setTimeout(() => {
                        try {
                            if (fs.existsSync(tempCookiesPath)) {
                                fs.unlinkSync(tempCookiesPath);
                            }
                        } catch (_) {}
                    }, 30000); // Clean up after 30 seconds
                } catch (copyErr) {
                    console.log('⚠️ Failed to create temp cookies, using original');
                    ytdlpArgs.push('--cookies', cookiesPath);
                }
            }

            const proxy = this.getNextProxy();
            if (proxy) {
                ytdlpArgs.push('--proxy', proxy);
                console.log(`🌐 Using proxy: ${proxy.split('@')[1] || proxy.split('://')[1] || proxy}`);
            }

            try {
                const ua = this.getRandomUserAgent();
                ytdlpArgs.push('--user-agent', ua);
                const clientArg = `youtube:player_client=${client}`;
                ytdlpArgs.push('--extractor-args', clientArg);
                console.log(`🔄 Using player client: ${clientArg}`);
            } catch {}

            ytdlpArgs.push(track.url);

            const ytdlpPath = this.ytDlpPath || 'yt-dlp';
            console.log(`🔧 yt-dlp command: ${ytdlpPath} ${ytdlpArgs.join(' ')}`);

            const ytdlp = spawn(ytdlpPath, ytdlpArgs);

            const stream = new PassThrough();
            let resolved = false;
            let hasData = false;
            let errorBuffer = '';

            const timeout = setTimeout(() => {
                if (!resolved && !hasData) {
                    resolved = true;
                    ytdlp.kill();
                    reject(new Error(`yt-dlp timeout - no data received. Last error: ${errorBuffer}`));
                }
            }, 3000);  // Ultra-fast timeout for immediate fallback to other methods

            ytdlp.stdout.on('data', (chunk) => {
                hasData = true;
                if (!resolved) {
                    resolved = true;
                    clearTimeout(timeout);
                    console.log(`✅ yt-dlp stream started successfully`);
                    
                    // Emit progress for stream ready
                    if (this.audioProcessor) {
                        this.audioProcessor.emit('progress', {
                            cacheKey: track.url,
                            title: track.title,
                            progress: 100,
                            status: 'Streaming...',
                            url: track.url,
                            isStreaming: true
                        });
                    }
                    
                    resolve(stream);
                }
            });

            ytdlp.stdout.pipe(stream);

            ytdlp.stderr.on('data', (data) => {
                const errorMsg = data.toString();
                errorBuffer += errorMsg;
                console.error(`yt-dlp stderr: ${errorMsg.trim()}`);
                
                // Parse stderr for progress indicators
                if (this.audioProcessor && !resolved) {
                    if (/Extracting URL:/i.test(errorMsg)) {
                        this.audioProcessor.emit('progress', {
                            cacheKey: track.url,
                            title: track.title,
                            progress: 20,
                            status: 'Extracting URL...',
                            url: track.url,
                            isStreaming: true
                        });
                    } else if (/Downloading webpage/i.test(errorMsg)) {
                        this.audioProcessor.emit('progress', {
                            cacheKey: track.url,
                            title: track.title,
                            progress: 40,
                            status: 'Fetching metadata...',
                            url: track.url,
                            isStreaming: true
                        });
                    } else if (/Downloading.*format/i.test(errorMsg)) {
                        this.audioProcessor.emit('progress', {
                            cacheKey: track.url,
                            title: track.title,
                            progress: 60,
                            status: 'Starting stream...',
                            url: track.url,
                            isStreaming: true
                        });
                    } else if (/\[download\] Destination: -/i.test(errorMsg)) {
                        this.audioProcessor.emit('progress', {
                            cacheKey: track.url,
                            title: track.title,
                            progress: 80,
                            status: 'Buffering...',
                            url: track.url,
                            isStreaming: true
                        });
                    }
                }

                if (!resolved && (/Requested format is not available/i.test(errorMsg) ||
                                  /No video formats found/i.test(errorMsg) ||
                                  /Unable to extract/i.test(errorMsg))) {
                    resolved = true;
                    clearTimeout(timeout);
                    ytdlp.kill();
                    reject(new Error(`yt-dlp format error: ${errorMsg.trim()}`));
                }
                if (!resolved && /Please sign in|cookies/i.test(errorMsg)) {
                    resolved = true;
                    clearTimeout(timeout);
                    ytdlp.kill();
                    reject(new Error(errorMsg.trim()));
                }
            });

            ytdlp.on('error', (error) => {
                if (!resolved) {
                    resolved = true;
                    clearTimeout(timeout);
                    console.error(`yt-dlp spawn error: ${error.message}`);
                    reject(error);
                }
            });

            ytdlp.on('close', (code) => {
                if (!resolved) {
                    resolved = true;
                    clearTimeout(timeout);
                    if (code !== 0) {
                        const currentErrors = this.sessionRotation.sessionErrors.get(track.url) || 0;
                        this.sessionRotation.sessionErrors.set(track.url, currentErrors + 1);
                        reject(new Error(`yt-dlp exited with code ${code}. ${errorBuffer.trim()}`));
                    } else {
                        reject(new Error('yt-dlp closed without providing data'));
                    }
                }
            });
        });
    }

    async isYtDlpAvailable() {
        if (this.ytDlpAvailable !== undefined) {
            return this.ytDlpAvailable;
        }

        // Try multiple possible yt-dlp locations
        const ytdlpPaths = [
            '/home/container/yt-dlp', // Pterodactyl container location
            'yt-dlp',
            '/usr/local/bin/yt-dlp',
            '/usr/bin/yt-dlp',
            process.env.YTDL_BINARY_PATH
        ].filter(Boolean);

        for (const ytdlpPath of ytdlpPaths) {
            try {
                await new Promise((resolve, reject) => {
                    const ytdlp = spawn(ytdlpPath, ['--version']);
                    let versionOutput = '';
                    
                    ytdlp.stdout.on('data', (data) => {
                        versionOutput += data.toString();
                    });
                    
                    ytdlp.on('close', (code) => {
                        if (code === 0) {
                            console.log(`✅ yt-dlp found at: ${ytdlpPath} (version: ${versionOutput.trim()})`);
                            resolve();
                        } else {
                            reject(new Error(`yt-dlp not available at ${ytdlpPath}`));
                        }
                    });
                    ytdlp.on('error', (error) => {
                        reject(new Error(`yt-dlp error at ${ytdlpPath}: ${error.message}`));
                    });
                });
                
                this.ytDlpAvailable = true;
                this.ytDlpPath = ytdlpPath;
                return true;
            } catch (error) {
                // Try next path
                continue;
            }
        }
        
        this.ytDlpAvailable = false;
        console.log('⚠️ yt-dlp not available in any location, using fallback methods');
        console.log(`Searched paths: ${ytdlpPaths.join(', ')}`);
        return false;
    }

    extractVideoId(url) {
        if (!url) return null;
        
        // YouTube URL patterns
        const patterns = [
            /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
            /youtube\.com\/v\/([a-zA-Z0-9_-]{11})/,
            /youtube\.com\/watch.*?v=([a-zA-Z0-9_-]{11})/
        ];
        
        for (const pattern of patterns) {
            const match = url.match(pattern);
            if (match && match[1]) {
                return match[1];
            }
        }
        
        return null;
    }

    createSeekableMP3Stream(filePath, seekSeconds) {
        return new Promise((resolve, reject) => {
            console.log(`🎯 Creating seekable stream starting at ${seekSeconds}s using FFmpeg`);
            
            const ffmpegArgs = [
                '-ss', seekSeconds.toString(), // Seek to position before input (faster)
                '-i', filePath,
                '-acodec', 'copy', // Copy audio without re-encoding
                '-f', 'mp3', // Output format
                '-avoid_negative_ts', 'make_zero',
                'pipe:1' // Output to stdout
            ];

            const ffmpeg = spawn('ffmpeg', ffmpegArgs);
            let resolved = false;
            let hasData = false;
            let errorBuffer = '';

            const stream = new PassThrough();
            
            const timeout = setTimeout(() => {
                if (!resolved && !hasData) {
                    resolved = true;
                    ffmpeg.kill();
                    reject(new Error(`FFmpeg seek timeout - no data received. Error: ${errorBuffer}`));
                }
            }, 5000);

            ffmpeg.stdout.on('data', (chunk) => {
                hasData = true;
                if (!resolved) {
                    resolved = true;
                    clearTimeout(timeout);
                    console.log(`✅ FFmpeg seek stream started successfully`);
                    resolve(stream);
                }
            });

            ffmpeg.stdout.pipe(stream);

            ffmpeg.stderr.on('data', (data) => {
                errorBuffer += data.toString();
                // FFmpeg outputs progress info to stderr, so don't log all of it
                const msg = data.toString().trim();
                if (msg.includes('error') || msg.includes('failed')) {
                    console.error(`FFmpeg seek error: ${msg}`);
                }
            });

            ffmpeg.on('error', (error) => {
                if (!resolved) {
                    resolved = true;
                    clearTimeout(timeout);
                    console.error(`FFmpeg seek spawn error: ${error.message}`);
                    reject(error);
                }
            });

            ffmpeg.on('close', (code) => {
                if (!resolved) {
                    resolved = true;
                    clearTimeout(timeout);
                    if (code !== 0) {
                        reject(new Error(`FFmpeg seek failed with code ${code}. Error: ${errorBuffer.trim()}`));
                    } else if (!hasData) {
                        reject(new Error('FFmpeg seek closed without providing data'));
                    }
                }
            });
        });
    }

    // Enhanced fallback methods for multi-source audio acquisition

    async getYouTubeAlternateSearch(track, options = {}) {
        console.log(`🔍 Trying YouTube alternate search for: ${track.title}`);
        
        try {
            // Generate alternative search queries
            const alternateQueries = this.generateAlternateQueries(track);
            
            for (const query of alternateQueries) {
                console.log(`🔄 Trying alternate query: ${query}`);
                const results = await this.searchYouTube(query, 3);
                
                if (results && results.length > 0) {
                    const altTrack = results[0];
                    console.log(`✅ Found alternate: ${altTrack.title}`);
                    return await this.getYouTubeStream(altTrack, options);
                }
            }
            
            throw new Error('No alternate YouTube results found');
        } catch (error) {
            console.log(`❌ YouTube alternate search failed: ${error.message}`);
            throw error;
        }
    }

    generateAlternateQueries(track) {
        const queries = [];
        const title = track.title || '';
        const author = track.author || '';
        
        // Remove common problematic terms
        const cleanTitle = title
            .replace(/\(.*?official.*?\)/gi, '')
            .replace(/\[.*?official.*?\]/gi, '')
            .replace(/\(.*?video.*?\)/gi, '')
            .replace(/\[.*?video.*?\]/gi, '')
            .replace(/\(.*?audio.*?\)/gi, '')
            .replace(/\[.*?audio.*?\]/gi, '')
            .trim();

        const cleanAuthor = author
            .replace(/official/gi, '')
            .replace(/music/gi, '')
            .trim();

        // Generate search variations
        queries.push(`${cleanTitle} ${cleanAuthor}`);
        queries.push(`${cleanTitle} ${cleanAuthor} audio`);
        queries.push(`${cleanTitle} ${cleanAuthor} official`);
        queries.push(`${cleanTitle} ${cleanAuthor} music`);
        queries.push(`${cleanTitle} ${cleanAuthor} lyrics`);
        queries.push(`${cleanTitle} ${cleanAuthor} cover`);
        queries.push(`${cleanTitle} karaoke`);
        queries.push(`${cleanTitle} instrumental`);
        
        // Try without author if needed
        if (cleanAuthor) {
            queries.push(cleanTitle);
            queries.push(`${cleanTitle} audio`);
        }

        return queries.filter(q => q.trim().length > 0);
    }

    async getSoundCloudStream(track, options = {}) {
        console.log(`🔍 Trying SoundCloud for: ${track.title}`);
        
        try {
            // Use yt-dlp to search and download from SoundCloud
            const query = `${track.title} ${track.author}`.trim();
            const searchUrl = `ytsearch5:${query} site:soundcloud.com`;
            
            console.log(`🔄 Searching SoundCloud with: ${query}`);
            
            return new Promise((resolve, reject) => {
                const ytdlp = spawn('yt-dlp', [
                    '--no-config',
                    '--extract-flat',
                    '--get-url',
                    '--get-title',
                    '--format', 'bestaudio',
                    searchUrl
                ], {
                    stdio: ['ignore', 'pipe', 'pipe']
                });

                let output = '';
                let hasData = false;

                ytdlp.stdout.on('data', (data) => {
                    output += data.toString();
                    hasData = true;
                });

                ytdlp.on('close', async (code) => {
                    if (code === 0 && hasData) {
                        const lines = output.trim().split('\n');
                        if (lines.length >= 2) {
                            const audioUrl = lines[lines.length - 1]; // Last line is usually the URL
                            console.log(`✅ Found SoundCloud audio URL`);
                            
                            // Download and convert the audio
                            try {
                                const result = await this.audioProcessor.downloadAndConvert(audioUrl, track.title, {
                                    source: 'soundcloud'
                                });
                                
                                if (result && result.mp3Path && fs.existsSync(result.mp3Path)) {
                                    resolve(fs.createReadStream(result.mp3Path));
                                } else {
                                    reject(new Error('SoundCloud conversion failed'));
                                }
                            } catch (convError) {
                                reject(new Error(`SoundCloud conversion error: ${convError.message}`));
                            }
                        } else {
                            reject(new Error('No SoundCloud results found'));
                        }
                    } else {
                        reject(new Error('SoundCloud search failed'));
                    }
                });

                ytdlp.on('error', (err) => {
                    reject(new Error(`SoundCloud search spawn error: ${err.message}`));
                });
            });
            
        } catch (error) {
            console.log(`❌ SoundCloud stream failed: ${error.message}`);
            throw error;
        }
    }

    async getGenericAudioStream(track, options = {}) {
        console.log(`🔍 Trying generic audio sources for: ${track.title}`);
        
        try {
            // Use yt-dlp to search across multiple platforms
            const query = `${track.title} ${track.author}`.trim();
            
            // Try various search patterns across multiple platforms
            const searchPatterns = [
                `ytsearch3:${query}`,
                `ytsearch3:${query} audio`,
                `ytsearch3:${query} music`,
                `scsearch3:${query}`, // SoundCloud
                `bcsearch3:${query}`, // Bandcamp
            ];

            for (const pattern of searchPatterns) {
                try {
                    console.log(`🔄 Trying generic search: ${pattern}`);
                    
                    const result = await this.downloadFromGenericSource(pattern, track);
                    if (result) {
                        console.log(`✅ Successfully found audio from generic source`);
                        return result;
                    }
                } catch (error) {
                    console.log(`❌ Generic source ${pattern} failed: ${error.message}`);
                    // Continue to next pattern
                }
            }
            
            throw new Error('All generic audio sources failed');
            
        } catch (error) {
            console.log(`❌ Generic audio stream failed: ${error.message}`);
            throw error;
        }
    }

    async downloadFromGenericSource(searchPattern, track) {
        return new Promise((resolve, reject) => {
            const ytdlp = spawn('yt-dlp', [
                '--no-config',
                '--extract-flat',
                '--get-url',
                '--format', 'bestaudio/best',
                '--audio-format', 'mp3',
                '--audio-quality', '0',
                searchPattern
            ], {
                stdio: ['ignore', 'pipe', 'pipe']
            });

            let output = '';
            let hasData = false;

            ytdlp.stdout.on('data', (data) => {
                output += data.toString();
                hasData = true;
            });

            ytdlp.on('close', async (code) => {
                if (code === 0 && hasData) {
                    const lines = output.trim().split('\n');
                    if (lines.length > 0) {
                        const audioUrl = lines[0]; // First valid URL
                        console.log(`✅ Found generic audio URL`);
                        
                        try {
                            // Download and convert
                            const result = await this.audioProcessor.downloadAndConvert(audioUrl, track.title, {
                                source: 'generic'
                            });
                            
                            if (result && result.mp3Path && fs.existsSync(result.mp3Path)) {
                                resolve(fs.createReadStream(result.mp3Path));
                            } else {
                                reject(new Error('Generic source conversion failed'));
                            }
                        } catch (convError) {
                            reject(new Error(`Generic source conversion error: ${convError.message}`));
                        }
                    } else {
                        reject(new Error('No generic source results found'));
                    }
                } else {
                    reject(new Error('Generic source search failed'));
                }
            });

            ytdlp.on('error', (err) => {
                reject(new Error(`Generic source spawn error: ${err.message}`));
            });
        });
    }
}

module.exports = SourceHandlers;
