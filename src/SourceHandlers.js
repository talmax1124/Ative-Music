const ytdl = require('@distube/ytdl-core');
const yts = require('yt-search');
const YouTube = require('youtube-sr').default;
const SpotifyWebApi = require('spotify-web-api-node');
const fetch = require('node-fetch');
const config = require('../config.js');
const play = require('play-dl');
const { spawn } = require('child_process');
const { Readable, PassThrough } = require('stream');

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

        console.log('🎵 SourceHandlers initialized for YouTube and Spotify only');
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

            const video = await YouTube.getVideo(videoId);
            return {
                title: video.title,
                author: video.channel?.name || 'Unknown',
                duration: video.durationFormatted || '0:00',
                url: `https://www.youtube.com/watch?v=${videoId}`,
                thumbnail: video.thumbnail?.url,
                source: 'youtube',
                type: 'track',
                viewCount: video.views || 0,
                id: videoId
            };
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
                url: track.body.external_urls.spotify,
                thumbnail: track.body.album.images[0]?.url,
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
        const patterns = [
            /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/)([^&\n?#]+)/,
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
            // Search YouTube and Spotify only
            console.log(`🔍 Starting search for: ${query}`);
            const searches = await Promise.allSettled([
                this.searchSpotify(query, limit),
                this.searchYouTube(query, limit)
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
        
        return results.map(result => {
            let score = 0;
            const titleLower = result.title.toLowerCase();
            const authorLower = result.author.toLowerCase();
            
            // Exact title match
            if (titleLower === queryLower) score += 100;
            
            // Title contains query
            if (titleLower.includes(queryLower)) score += 50;
            
            // Author relevance
            if (authorLower.includes(queryLower)) score += 30;
            
            // Source preference (YouTube > Spotify)
            if (result.source === 'youtube') score += 20;
            else if (result.source === 'spotify') score += 15;
            
            // View count bonus for YouTube
            if (result.viewCount) {
                score += Math.min(result.viewCount / 1000000, 10); // Max 10 points for views
            }
            
            return { ...result, relevanceScore: score };
        }).sort((a, b) => b.relevanceScore - a.relevanceScore);
    }

    async searchYouTube(query, limit = 5) {
        try {
            // Try yt-search first (more reliable with current YouTube changes)
            console.log(`🔍 yt-search for: ${query}`);
            const ytsResults = await yts(query);
            
            if (ytsResults && ytsResults.videos && ytsResults.videos.length > 0) {
                console.log(`✅ yt-search found ${ytsResults.videos.length} results`);
                return ytsResults.videos.slice(0, limit).map(video => ({
                    title: video.title,
                    author: video.author?.name || 'Unknown',
                    duration: video.duration?.timestamp || '0:00',
                    url: video.url,
                    thumbnail: video.thumbnail,
                    source: 'youtube',
                    type: 'track',
                    viewCount: video.views || 0,
                    id: video.videoId
                }));
            }

            // Fallback to YouTube-SR if yt-search fails
            console.log('⚠️ yt-search failed, trying YouTube-SR fallback');
            try {
                const results = await YouTube.search(query, { limit, type: 'video' });
                
                if (results && results.length > 0) {
                    console.log(`✅ YouTube-SR found ${results.length} results`);
                    return results.map(video => ({
                        title: video.title,
                        author: video.channel?.name || 'Unknown',
                        duration: video.durationFormatted || '0:00',
                        url: `https://www.youtube.com/watch?v=${video.id}`,
                        thumbnail: video.thumbnail?.url,
                        source: 'youtube',
                        type: 'track',
                        viewCount: video.views || 0,
                        id: video.id
                    }));
                }
            } catch (srError) {
                console.log('⚠️ YouTube-SR also failed due to signature issues');
            }

            return [];
        } catch (error) {
            console.error('❌ YouTube search error:', error.message);
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
                    thumbnail: track.album.images[0]?.url,
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

    async getStream(track) {
        console.log(`🎵 Getting stream for: ${track.title} from ${track.source}`);
        
        if (track.source === 'spotify') {
            // For Spotify, we need to find a YouTube equivalent
            return await this.getSpotifyStream(track);
        } else if (track.source === 'youtube') {
            return await this.getYouTubeStream(track);
        } else {
            throw new Error(`Unsupported source: ${track.source}`);
        }
    }

    async getYouTubeStream(track) {
        try {
            console.log(`🎵 Getting YouTube stream for: ${track.title}`);
            
            // Try yt-dlp FIRST (most reliable for VPS)
            if (await this.isYtDlpAvailable()) {
                try {
                    console.log(`🔄 Using yt-dlp (primary) for: ${track.title}`);
                    return await this.getYtDlpStream(track);
                } catch (ytdlpError) {
                    console.log(`⚠️ yt-dlp failed: ${ytdlpError.message}`);
                }
            }
            
            // Fallback to play-dl
            try {
                console.log(`🔄 Trying play-dl fallback for: ${track.title}`);
                console.log(`🔗 Track URL: ${track.url}`);
                
                // Normalize YouTube URL to include www for play-dl compatibility
                let normalizedUrl = track.url;
                if (normalizedUrl.includes('youtube.com') && !normalizedUrl.includes('www.')) {
                    normalizedUrl = normalizedUrl.replace('youtube.com', 'www.youtube.com');
                    console.log(`🔧 Normalized URL: ${normalizedUrl}`);
                }
                
                // Validate YouTube URL for play-dl  
                const validationResult = await play.yt_validate(normalizedUrl);
                console.log(`🔍 play-dl validation result: ${validationResult}`);
                
                if (!validationResult) {
                    throw new Error(`Invalid YouTube URL for play-dl: ${normalizedUrl}`);
                }
                
                const streamResult = await play.stream(normalizedUrl, { quality: 2 });
                console.log(`✅ play-dl stream created successfully`);
                return streamResult.stream;
            } catch (playDlError) {
                console.log(`⚠️ play-dl failed: ${playDlError.message}`);
            }
            
            // Final fallback to ytdl-core (least likely to work)
            console.log(`🔄 Final fallback to ytdl-core for: ${track.title}`);
            console.log(`🔗 Using original URL: ${track.url}`);
            const stream = ytdl(track.url, {
                filter: 'audioonly',
                quality: 'lowestaudio',
                highWaterMark: 1 << 20,
                requestOptions: {
                    headers: {
                        'User-Agent': this.getRandomUserAgent()
                    }
                }
            });
            
            console.log(`✅ ytdl-core stream created successfully`);
            return stream;
        } catch (error) {
            console.error(`❌ YouTube stream error: ${error.message}`);
            throw new Error(`All streaming methods failed for: ${track.title}`);
        }
    }

    async getSpotifyStream(track) {
        try {
            console.log(`🎵 Finding YouTube equivalent for Spotify track: ${track.title}`);
            
            // Search for YouTube equivalent
            const searchQuery = `${track.title} ${track.author}`;
            const youtubeResults = await this.searchYouTube(searchQuery, 1);
            
            if (youtubeResults.length > 0) {
                console.log(`✅ Found YouTube equivalent: ${youtubeResults[0].title}`);
                return await this.getYouTubeStream(youtubeResults[0]);
            } else {
                throw new Error('No YouTube equivalent found for Spotify track');
            }
        } catch (error) {
            console.error(`❌ Spotify stream error: ${error.message}`);
            throw error;
        }
    }

    async getYtDlpStream(track) {
        return new Promise((resolve, reject) => {
            console.log(`🔄 Using yt-dlp for: ${track.title}`);
            
            const cookiesPath = process.env.COOKIES_PATH || './cookies.txt';
            const fs = require('fs');
            const hasCookies = fs.existsSync(cookiesPath);
            
            const ytdlpArgs = [
                '--format', '140/bestaudio[ext=m4a]/bestaudio',
                '--output', '-',
                '--no-warnings',
                '--no-playlist',
                '--no-check-certificates',
                '--prefer-free-formats',
            ];
            
            if (hasCookies) {
                ytdlpArgs.push('--cookies', cookiesPath);
                console.log(`🍪 Using cookies from: ${cookiesPath}`);
            }
            
            ytdlpArgs.push(track.url);
            
            const ytdlpPath = this.ytDlpPath || 'yt-dlp';
            console.log(`🔧 yt-dlp command: ${ytdlpPath} ${ytdlpArgs.join(' ')}`);
            
            const ytdlp = spawn(ytdlpPath, ytdlpArgs);

            const stream = new PassThrough();
            let resolved = false;
            let hasData = false;
            let errorBuffer = '';
            
            // Set a timeout to reject if no data comes within 15 seconds
            const timeout = setTimeout(() => {
                if (!resolved && !hasData) {
                    resolved = true;
                    ytdlp.kill();
                    reject(new Error(`yt-dlp timeout - no data received. Last error: ${errorBuffer}`));
                }
            }, 15000);
            
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
                
                // Log ALL stderr output for debugging
                console.error(`yt-dlp stderr: ${errorMsg.trim()}`);
                
                // If we see a format error and haven't resolved yet, reject immediately
                if (!resolved && errorMsg.includes('Requested format is not available')) {
                    resolved = true;
                    clearTimeout(timeout);
                    ytdlp.kill();
                    reject(new Error(`yt-dlp format error: ${errorMsg.trim()}`));
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
                        reject(new Error(`yt-dlp exited with code ${code}`));
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
}

module.exports = SourceHandlers;