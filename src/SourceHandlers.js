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
        
        // Initialize audio processor for MP3 conversion
        this.audioProcessor = new AudioProcessor();
        
        // Stream cache for failed tracks
        this.streamCache = new Map();
        
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
        return new Promise((resolve, reject) => {
            const { spawn } = require('child_process');
            const ytdlp = spawn('yt-dlp', [
                '--print', '%(title)s\n%(uploader)s\n%(duration)s\n%(webpage_url)s\n%(thumbnail)s\n%(view_count)s',
                '--no-warnings',
                '--concurrent-fragments', '8',
                '--socket-timeout', '15',
                '--fragment-retries', '2',
                '--retries', '2',
                '--http-chunk-size', '5M',
                '--buffer-size', '32K',
                '--prefer-free-formats',
                url
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
                    const lines = output.trim().split('\n');
                    if (lines.length >= 4) {
                        const title = lines[0] || 'Unknown Title';
                        const uploader = lines[1] || 'Unknown';
                        const duration = lines[2] || '0:00';
                        const webpage_url = lines[3] || url;
                        const thumbnail = lines[4] || null;
                        const viewCount = parseInt(lines[5]) || 0;
                        
                        const durationSeconds = parseFloat(duration) || 0;
                        const durationMS = durationSeconds * 1000;
                        
                        resolve({
                            title,
                            author: uploader,
                            duration: this.formatDuration(durationMS),
                            durationMS: durationMS,
                            url: webpage_url,
                            thumbnail,
                            source: 'youtube',
                            type: 'track',
                            viewCount,
                            id: this.extractYouTubeVideoId(url) || ''
                        });
                    } else {
                        reject(new Error('Insufficient metadata from yt-dlp'));
                    }
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
            const searches = await Promise.allSettled([
                this.searchSpotify(query, Math.floor(limit / 2)),
                this.searchYouTube(query, Math.ceil(limit / 2))
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

            console.log('❌ All YouTube search methods failed (likely due to bot detection). Consider using yt-dlp.');
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
        
        if (track.source === 'spotify') {
            // For Spotify, we need to find a YouTube equivalent
            return await this.getSpotifyStream(track, options);
        } else if (track.source === 'youtube') {
            return await this.getYouTubeStream(track, options);
        } else {
            throw new Error(`Unsupported source: ${track.source}`);
        }
    }

    async getYouTubeStream(track, options = {}) {
        try {
            console.log(`🎵 Getting YouTube stream for: ${track.title}`);
            
            // Use the new AudioProcessor to download and convert
            const meta = (options && options.meta) ? options.meta : {};
            const result = await this.audioProcessor.downloadAndConvert(track.url, track.title, meta);
            
            if (result.cached) {
                console.log(`📂 Using cached MP3: ${track.title}`);
            } else {
                console.log(`✅ Downloaded and converted to MP3: ${track.title}`);
            }
            
            // Create read stream from MP3 file
            const stream = fs.createReadStream(result.path);
            
            // Handle seek if requested
            if (options.seekSeconds && options.seekSeconds > 0) {
                console.log(`⏩ Seeking to ${options.seekSeconds} seconds in MP3 file`);
                return this.createSeekableMP3Stream(result.path, options.seekSeconds);
            }
            
            return stream;
            
        } catch (error) {
            console.error(`❌ YouTube stream error: ${error.message}`);
            
            // Fallback to old streaming method if AudioProcessor fails
            console.log(`🔄 Falling back to direct streaming for: ${track.title}`);
            return await this.getYouTubeStreamFallback(track, options);
        }
    }

    async getYouTubeStreamFallback(track, options = {}) {
        try {
            console.log(`🔄 Using fallback streaming for: ${track.title}`);
            
            const videoId = this.downloadCache.extractVideoId(track.url);
            if (!videoId) {
                throw new Error('Could not extract video ID from URL');
            }
            
            // Check if file is already cached in old system
            if (this.downloadCache.isFileCached(videoId)) {
                console.log(`📂 Streaming from old cache: ${track.title}`);
                return this.downloadCache.createReadStream(videoId);
            }
            
            // Try direct streaming methods with enhanced fallbacks
            const extractors = ['playdl', 'ytdlp', 'ytdlcore'];
            for (let i = 0; i < extractors.length; i++) {
                const which = extractors[i];
                try {
                    if (which === 'playdl') {
                        console.log('🔄 Attempting play-dl stream...');
                        
                        // Validate URL before attempting play-dl
                        if (!track.url || typeof track.url !== 'string' || !track.url.includes('youtube.com/watch')) {
                            throw new Error(`Invalid YouTube URL for play-dl: ${track.url}`);
                        }
                        
                        const streamResult = await play.stream(track.url, {
                            quality: 2,
                            discordPlayerCompatibility: true,
                            ...(typeof options.seekSeconds === 'number' && options.seekSeconds > 0 ? { seek: Math.floor(options.seekSeconds) } : {})
                        });
                        console.log('✅ play-dl fallback stream created');
                        return streamResult.stream;
                    }
                    if (which === 'ytdlp') {
                        if (await this.isYtDlpAvailable()) {
                            console.log(`🔄 Using yt-dlp fallback`);
                            const stream = await this.getYtDlpStream(track, 0);
                            if (stream) return stream;
                        }
                    }
                    if (which === 'ytdlcore') {
                        console.log('🔄 Attempting ytdl-core stream as last resort...');
                        const stream = ytdl(track.url, {
                            filter: 'audioonly',
                            quality: 'lowestaudio',
                            highWaterMark: 1 << 25,
                            requestOptions: {
                                headers: {
                                    'User-Agent': this.getRandomUserAgent(),
                                }
                            }
                        });
                        console.log('✅ ytdl-core fallback stream created');
                        return stream;
                    }
                } catch (err) {
                    console.log(`⚠️ Fallback ${which} failed: ${err?.message || err}`);
                }
            }
            
            throw new Error(`All fallback streaming methods failed for: ${track.title}`);
        } catch (error) {
            console.error(`❌ Fallback stream error: ${error.message}`);
            throw error;
        }
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
            const q = `${track.title || ''} ${track.author || ''}`.trim();
            const res = await this.searchYouTube(q, 1);
            return res && res[0] ? res[0] : null;
        } catch (e) {
            console.log(`⚠️ resolveForPlayback failed: ${e?.message || e}`);
            return null;
        }
    }

    async getYtDlpStream(track, formatIndex = 0) {
        // Handle session rotation and cooldowns
        this.handleSessionRotation();
        await this.waitForCooldown(track.url);

        // Use formats that don't require authentication first
        const formats = ['worst[height>=360]/worst', 'worst', '18', 'bestaudio', 'best', '140'];
        // Start with android client - often works without auth
        const clients = ['android', 'web', 'ios', 'tv_embedded'];

        // Try format/client combinations
        for (let i = 0; i < formats.length; i++) {
            const fmt = formats[(formatIndex + i) % formats.length];
            for (let c = 0; c < clients.length; c++) {
                const client = clients[c];
                try {
                    const stream = await this.spawnYtDlp(track, fmt, client);
                    try { track._lastFormat = fmt; track._lastExtractor = 'ytdlp'; track._lastClient = client; } catch {}
                    return stream;
                } catch (err) {
                    const msg = String(err?.message || err);
                    console.log(`⚠️ yt-dlp failed (fmt=${fmt}, client=${client}): ${msg}`);
                    if (/Please sign in|cookies/i.test(msg)) {
                        // Cookies required; bubble up so caller can prompt
                        throw err;
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

            const cookiesPath = process.env.COOKIES_PATH || './cookies.txt';
            const fs = require('fs');

            let hasCookies = false;
            if (fs.existsSync(cookiesPath)) {
                try {
                    const cookiesContent = fs.readFileSync(cookiesPath, 'utf8');
                    // Check for Netscape format header or actual cookie entries
                    if (cookiesContent.includes('Netscape HTTP Cookie File') || 
                        cookiesContent.includes('.youtube.com') ||
                        /^\.youtube\.com\t/m.test(cookiesContent)) {
                        hasCookies = true;
                        console.log(`🍪 Found valid cookies file with ${cookiesContent.split('\n').filter(l => l && !l.startsWith('#')).length} cookie entries`);
                    } else {
                        console.log('⚠️ Cookies file appears empty or invalid');
                    }
                } catch (error) {
                    console.log('⚠️ Failed to read cookies file, continuing without cookies');
                }
            }

            const ytdlpArgs = [
                '--format', fmt,
                '--output', '-',
                '--no-warnings',
                '--no-playlist',
                '--no-check-certificates',
                '--prefer-insecure',
                '--force-ipv4',
                '--hls-prefer-ffmpeg',
                '--hls-use-mpegts',
                '--concurrent-fragments', '8',  // More fragments for faster download
                '--no-part',
                '--geo-bypass',
                '--geo-bypass-country', 'US',
                '--no-update',
                '--socket-timeout', '10',  // Faster timeout
                '--retries', '2',  // Fewer retries for speed
                '--fragment-retries', '2',
                '--retry-sleep', '0',  // No sleep between retries
                '--sleep-interval', '0',  // No rate limiting delay
                '--max-sleep-interval', '0',  // No maximum sleep
                '--ignore-errors',
                '--no-abort-on-error',
                '--no-progress',
                '--extractor-retries', '1',  // Single extractor retry
                '--buffer-size', '16K',  // Smaller buffer for faster start
                '--http-chunk-size', '1M'  // Optimized chunk size
            ];

            if (hasCookies) {
                ytdlpArgs.push('--cookies', cookiesPath);
                console.log(`🍪 Using cookies from: ${cookiesPath}`);
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
            }, 10000);  // Reduced timeout for faster failure detection

            ytdlp.stdout.on('data', (chunk) => {
                hasData = true;
                if (!resolved) {
                    resolved = true;
                    clearTimeout(timeout);
                    console.log(`✅ yt-dlp stream started successfully`);
                    resolve(stream);
                }
            });

            ytdlp.stdout.pipe(stream);

            ytdlp.stderr.on('data', (data) => {
                const errorMsg = data.toString();
                errorBuffer += errorMsg;
                console.error(`yt-dlp stderr: ${errorMsg.trim()}`);

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
}

module.exports = SourceHandlers;
