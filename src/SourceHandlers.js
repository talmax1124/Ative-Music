const ytdl = require('@distube/ytdl-core');
const yts = require('yt-search');
const SpotifyWebApi = require('spotify-web-api-node');
const fetch = require('node-fetch');
const cheerio = require('cheerio');
const config = require('../config.js');
const play = require('play-dl');
const { spawn } = require('child_process');
const { Readable } = require('stream');

class SourceHandlers {
    constructor() {
        this.spotify = new SpotifyWebApi({
            clientId: config.spotify.clientId,
            clientSecret: config.spotify.clientSecret
        });
        
        this.setupSpotify();
    }

    async setupSpotify() {
        try {
            const data = await this.spotify.clientCredentialsGrant();
            this.spotify.setAccessToken(data.body.access_token);
            
            setInterval(async () => {
                try {
                    const data = await this.spotify.clientCredentialsGrant();
                    this.spotify.setAccessToken(data.body.access_token);
                } catch (error) {
                    console.error('❌ Error refreshing Spotify token:', error);
                }
            }, data.body.expires_in * 1000 - 60000);
            
            console.log('✅ Spotify API initialized'.green);
        } catch (error) {
            console.error('❌ Failed to initialize Spotify API:', error);
        }
    }

    async search(query, limit = 10) {
        const results = [];
        
        if (this.isURL(query)) {
            const track = await this.handleURL(query);
            if (track) results.push(track);
        } else {
            // Search both Spotify and YouTube
            const searches = await Promise.allSettled([
                this.searchSpotify(query, limit),
                this.searchYouTube(query, limit)
                // SoundCloud temporarily disabled due to API issues
            ]);

            for (const search of searches) {
                if (search.status === 'fulfilled' && search.value) {
                    results.push(...search.value);
                }
            }
        }

        return this.removeDuplicates(results).slice(0, limit);
    }

    async searchYouTube(query, limit = 5) {
        try {
            const searchResults = await yts(query);
            const videos = searchResults.videos.slice(0, limit);
            
            return videos.map(video => ({
                title: video.title,
                author: video.author.name,
                duration: video.duration.timestamp,
                url: video.url,
                thumbnail: video.thumbnail,
                source: 'youtube',
                type: 'video',
                viewCount: video.views,
                publishedAt: video.ago,
                description: video.description,
                id: video.videoId
            }));
        } catch (error) {
            console.error('❌ YouTube search error:', error);
            return [];
        }
    }

    async searchSpotify(query, limit = 5) {
        try {
            const searchResults = await this.spotify.searchTracks(query, { limit });
            
            return searchResults.body.tracks.items.map(track => ({
                title: track.name,
                author: track.artists.map(artist => artist.name).join(', '),
                duration: this.formatDuration(track.duration_ms),
                url: track.external_urls.spotify,
                thumbnail: track.album.images[0]?.url,
                source: 'spotify',
                type: 'track',
                albumName: track.album.name,
                popularity: track.popularity,
                previewUrl: track.preview_url,
                spotifyId: track.id,
                explicit: track.explicit
            }));
        } catch (error) {
            console.error('❌ Spotify search error:', error);
            return [];
        }
    }

    async searchSoundCloud(query, limit = 5) {
        try {
            // Use web scraping as fallback for SoundCloud
            const searchUrl = `https://soundcloud.com/search?q=${encodeURIComponent(query)}`;
            const response = await fetch(searchUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                }
            });
            
            if (!response.ok) {
                throw new Error(`SoundCloud search failed: ${response.status}`);
            }
            
            // For now, return empty array as SoundCloud scraping is complex
            // Users can still paste SoundCloud URLs directly
            console.log('🔍 SoundCloud search attempted, please use direct URLs for now');
            return [];
            
        } catch (error) {
            console.error('❌ SoundCloud search error:', error);
            return [];
        }
    }


    async handleURL(url) {
        if (ytdl.validateURL(url)) {
            return await this.getYouTubeTrack(url);
        } else if (url.includes('spotify.com')) {
            return await this.getSpotifyTrack(url);
        } else if (url.includes('soundcloud.com')) {
            return await this.getSoundCloudTrack(url);
        }
        
        return null;
    }

    async getYouTubeTrack(url) {
        try {
            const info = await ytdl.getInfo(url);
            const details = info.videoDetails;
            
            return {
                title: details.title,
                author: details.author.name,
                duration: this.formatDuration(parseInt(details.lengthSeconds) * 1000),
                url: details.video_url,
                thumbnail: details.thumbnails[details.thumbnails.length - 1].url,
                source: 'youtube',
                type: 'video',
                viewCount: parseInt(details.viewCount),
                description: details.description,
                id: details.videoId,
                isLive: details.isLiveContent
            };
        } catch (error) {
            console.error('❌ Error getting YouTube track:', error);
            return null;
        }
    }

    async getSpotifyTrack(url) {
        try {
            const trackId = this.extractSpotifyId(url);
            if (!trackId) return null;

            const track = await this.spotify.getTrack(trackId);
            const trackData = track.body;

            return {
                title: trackData.name,
                author: trackData.artists.map(artist => artist.name).join(', '),
                duration: this.formatDuration(trackData.duration_ms),
                url: trackData.external_urls.spotify,
                thumbnail: trackData.album.images[0]?.url,
                source: 'spotify',
                type: 'track',
                albumName: trackData.album.name,
                popularity: trackData.popularity,
                previewUrl: trackData.preview_url,
                spotifyId: trackData.id,
                explicit: trackData.explicit
            };
        } catch (error) {
            console.error('❌ Error getting Spotify track:', error);
            return null;
        }
    }

    async getSoundCloudTrack(url) {
        try {
            // For SoundCloud URLs, extract info via web scraping
            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                }
            });
            
            if (!response.ok) {
                throw new Error(`SoundCloud fetch failed: ${response.status}`);
            }
            
            const html = await response.text();
            const $ = cheerio.load(html);
            
            // Extract basic info from meta tags
            const title = $('meta[property="og:title"]').attr('content') || 'Unknown Track';
            const author = $('meta[property="og:description"]').attr('content')?.split(' by ')[1]?.split('.')[0] || 'Unknown Artist';
            const thumbnail = $('meta[property="og:image"]').attr('content');
            
            return {
                title: title,
                author: author,
                duration: '0:00', // Cannot easily extract duration without API
                url: url,
                thumbnail: thumbnail,
                source: 'soundcloud',
                type: 'track',
                playbackCount: 0,
                likesCount: 0,
                description: '',
                id: url.split('/').pop()
            };
        } catch (error) {
            console.error('❌ Error getting SoundCloud track:', error);
            return null;
        }
    }


    async getStream(track) {
        console.log(`🎵 Getting stream for: ${track.title} from ${track.source}`);
        
        // Try different streaming methods in order of reliability
        const streamingMethods = [
            () => this.getStreamWithYtDlp(track),
            () => this.getStreamWithPlayDl(track),
            () => this.getStreamWithYtdlCore(track)
        ];
        
        for (const [index, method] of streamingMethods.entries()) {
            try {
                console.log(`🔄 Trying streaming method ${index + 1}/3`);
                const stream = await method();
                if (stream) {
                    console.log(`✅ Stream created successfully with method ${index + 1}`);
                    return stream;
                }
            } catch (error) {
                console.log(`❌ Method ${index + 1} failed: ${error.message}`);
                continue;
            }
        }
        
        throw new Error(`All streaming methods failed for: ${track.title}`);
    }
    
    async getStreamWithYtDlp(track) {
        console.log(`⚡ Trying yt-dlp for: ${track.title}`);
        
        // First, get the URL if we need to convert from Spotify
        let youtubeUrl = track.url;
        if (track.source === 'spotify') {
            const searchQuery = `${track.title} ${track.author} audio`;
            const searchResults = await this.searchYouTube(searchQuery, 1);
            if (searchResults.length === 0) {
                throw new Error('No YouTube equivalent found for Spotify track');
            }
            youtubeUrl = searchResults[0].url;
            console.log(`🔄 Converted Spotify to YouTube: ${youtubeUrl}`);
        }
        
        return new Promise((resolve, reject) => {
            // Use yt-dlp to get the direct audio stream URL
            const ytDlp = spawn('yt-dlp', [
                '--format', 'bestaudio/best',
                '--no-playlist',
                '--quiet',
                '--get-url',
                youtubeUrl
            ]);
            
            let audioUrl = '';
            
            ytDlp.stdout.on('data', (data) => {
                audioUrl += data.toString();
            });
            
            ytDlp.on('close', (code) => {
                if (code === 0 && audioUrl.trim()) {
                    const directUrl = audioUrl.trim();
                    console.log(`✅ yt-dlp found direct audio URL: ${directUrl.substring(0, 60)}...`);
                    
                    // Create a stream from the direct URL
                    fetch(directUrl).then(response => {
                        if (response.ok) {
                            console.log(`✅ Direct stream created successfully`);
                            resolve(response.body);
                        } else {
                            reject(new Error(`Direct stream failed: ${response.status}`));
                        }
                    }).catch(reject);
                } else {
                    reject(new Error(`yt-dlp failed with code: ${code}`));
                }
            });
            
            ytDlp.on('error', reject);
        });
    }
    
    async getStreamWithPlayDl(track) {
        console.log(`⚡ Trying play-dl for: ${track.title}`);
        
        let youtubeUrl = track.url;
        if (track.source === 'spotify') {
            const searchQuery = `${track.title} ${track.author} audio`;
            const results = await play.search(searchQuery, { limit: 1, source: { youtube: "video" } });
            if (!results || results.length === 0) {
                throw new Error('No YouTube results found');
            }
            youtubeUrl = results[0].url;
            console.log(`🔄 play-dl found: ${results[0].title}`);
        }
        
        const stream = await play.stream(youtubeUrl);
        return stream.stream;
    }
    
    async getStreamWithYtdlCore(track) {
        console.log(`⚡ Trying ytdl-core for: ${track.title}`);
        
        let youtubeUrl = track.url;
        if (track.source === 'spotify') {
            const searchQuery = `${track.title} ${track.author} audio`;
            const searchResults = await this.searchYouTube(searchQuery, 1);
            if (searchResults.length === 0) {
                throw new Error('No YouTube equivalent found');
            }
            youtubeUrl = searchResults[0].url;
        }
        
        const stream = ytdl(youtubeUrl, { 
            filter: 'audioonly',
            quality: 'lowestaudio',
            requestOptions: {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }
            }
        });
        
        return stream;
    }

    async getYouTubeStreamFast(track) {
        console.log(`⚡ Fast streaming: ${track.title}`);
        
        // Use multiple user agents and request options to bypass 403 errors
        const userAgents = [
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0'
        ];
        
        const randomUA = userAgents[Math.floor(Math.random() * userAgents.length)];
        
        const streamConfig = { 
            filter: 'audioonly',
            quality: 'lowestaudio',
            highWaterMark: 1 << 25,
            requestOptions: {
                headers: {
                    'User-Agent': randomUA,
                    'Accept': '*/*',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Accept-Encoding': 'identity', // Disable compression to avoid parsing issues
                    'Cache-Control': 'no-cache',
                    'Pragma': 'no-cache',
                    'Connection': 'keep-alive'
                },
                timeout: 5000 // 5 second timeout for fast fails
            }
        };
        
        // Try ytdl-core first, then fallback to play-dl
        try {
            console.log(`🚀 Creating fast stream with enhanced config (ytdl-core)`);
            const stream = ytdl(track.url, streamConfig);
            console.log(`✅ Fast stream created successfully with ytdl-core`);
            return stream;
        } catch (ytdlError) {
            console.log(`❌ ytdl-core failed, trying play-dl: ${ytdlError.message}`);
            
            try {
                console.log(`🔄 Attempting play-dl stream`);
                const info = await play.video_info(track.url);
                const stream = await play.stream(track.url, { quality: 'lowest' });
                console.log(`✅ Fast stream created successfully with play-dl`);
                return stream.stream;
            } catch (playError) {
                console.log(`❌ Both streaming methods failed: ${playError.message}`);
                throw playError;
            }
        }
    }

    async getYouTubeStream(track) {
        try {
            // First, validate the URL and get info (disable HTML debug files)
            let info;
            try {
                info = await ytdl.getInfo(track.url, {
                    requestOptions: {
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                            'Accept-Language': 'en-US,en;q=0.9',
                            'Accept-Encoding': 'gzip, deflate, br',
                            'DNT': '1',
                            'Connection': 'keep-alive',
                            'Upgrade-Insecure-Requests': '1',
                            'Sec-Fetch-Dest': 'document',
                            'Sec-Fetch-Mode': 'navigate',
                            'Sec-Fetch-Site': 'none'
                        }
                    }
                });
            } catch (infoError) {
                console.log(`❌ Failed to get info for ${track.url} - skipping track`);
                throw infoError;
            }

            // Fast, optimized streaming configs only
            const streamConfigs = [
                { 
                    filter: 'audioonly',
                    quality: 'lowestaudio',
                    highWaterMark: 1 << 25  // 32MB buffer
                }
            ];
            
            for (const config of streamConfigs) {
                try {
                    console.log(`🎵 Trying config: ${JSON.stringify(config)} for ${track.title}`);
                    
                    const streamOptions = {
                        ...config,
                        requestOptions: {
                            headers: {
                                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                            }
                        }
                    };
                    
                    console.log(`✅ Successfully created stream with config: ${JSON.stringify(config)}`);
                    return ytdl(track.url, streamOptions);
                    
                } catch (configError) {
                    console.log(`⚠️ Config ${JSON.stringify(config)} failed: ${configError.message}`);
                    continue;
                }
            }
            
            throw new Error('All stream configurations failed');
            
        } catch (error) {
            console.error('❌ Error getting YouTube stream:', error.message);
            
            // Try emergency fallback with different video
            if (error.message.includes('302') || error.message.includes('redirect')) {
                console.log('🔄 Trying emergency search fallback...');
                try {
                    const fallbackResults = await this.searchYouTube(`${track.title} ${track.author} official audio`, 3);
                    for (const fallbackTrack of fallbackResults) {
                        if (fallbackTrack.url !== track.url) {
                            console.log(`🔄 Trying fallback: ${fallbackTrack.title}`);
                            return await this.getYouTubeStream(fallbackTrack);
                        }
                    }
                } catch (fallbackError) {
                    console.log('⚠️ Fallback search also failed');
                }
            }
            
            throw error;
        }
    }

    async getSpotifyStreamFast(track) {
        console.log(`⚡ Alternative Spotify streaming: ${track.title} by ${track.author}`);
        
        // Since ALL YouTube methods are blocked, try alternative approaches
        const alternatives = [
            () => this.tryDirectAudioStream(track),
            () => this.tryWebScrapingStream(track),
            () => this.tryAlternativeApiStream(track)
        ];
        
        for (const [index, method] of alternatives.entries()) {
            try {
                console.log(`🔄 Trying alternative method ${index + 1}/3`);
                const stream = await method();
                if (stream) {
                    console.log(`✅ Alternative stream created successfully with method ${index + 1}`);
                    return stream;
                }
            } catch (error) {
                console.log(`❌ Alternative method ${index + 1} failed: ${error.message}`);
                continue;
            }
        }
        
        // Last resort: Generate a text-to-speech message
        console.log(`🚨 All streaming methods failed, generating TTS notification`);
        return this.generateNotificationStream(track);
    }
    
    async tryDirectAudioStream(track) {
        // Try to find direct audio files from various sources
        const audioSources = [
            `https://audio.jukehost.co.uk/${encodeURIComponent(track.title + ' ' + track.author)}.mp3`,
            `https://files.freemusicarchive.org/storage-freemusicarchive-org/music/${encodeURIComponent(track.author)}/${encodeURIComponent(track.title)}.mp3`,
        ];
        
        for (const audioUrl of audioSources) {
            try {
                console.log(`🔍 Trying direct audio: ${audioUrl}`);
                const response = await fetch(audioUrl, { method: 'HEAD' });
                if (response.ok && response.headers.get('content-type')?.includes('audio')) {
                    console.log(`✅ Found direct audio file`);
                    return fetch(audioUrl).then(res => res.body);
                }
            } catch (error) {
                continue;
            }
        }
        
        throw new Error('No direct audio files found');
    }
    
    async tryWebScrapingStream(track) {
        // Try to scrape audio from various music sites
        const searchQuery = `${track.title} ${track.author} site:soundcloud.com OR site:bandcamp.com`;
        console.log(`🕷️ Web scraping search: ${searchQuery}`);
        
        // This would require implementing specific scrapers for each site
        // For now, throw an error to move to next method
        throw new Error('Web scraping not implemented yet');
    }
    
    async tryAlternativeApiStream(track) {
        // Try alternative music APIs that might have direct streaming
        console.log(`🔌 Trying alternative APIs for: ${track.title}`);
        
        // This would integrate with services like:
        // - Last.fm (for preview URLs)
        // - Deezer (for preview streams) 
        // - Apple Music (for preview streams)
        // For now, throw an error
        throw new Error('Alternative APIs not implemented yet');
    }
    
    generateNotificationStream(track) {
        console.log(`📢 Generating notification for: ${track.title}`);
        
        // Create a simple audio notification instead of failing
        // This is a placeholder - we could generate TTS or a simple tone
        const { Readable } = require('stream');
        
        const notificationStream = new Readable({
            read() {
                // Generate silence or a simple tone
                const buffer = Buffer.alloc(4096, 0);
                this.push(buffer);
                
                // End after a short duration
                setTimeout(() => this.push(null), 1000);
            }
        });
        
        return notificationStream;
    }

    async getSpotifyStream(track) {
        try {
            const searchQuery = `${track.title} ${track.author}`;
            const youtubeResults = await this.searchYouTube(searchQuery, 1);
            
            if (youtubeResults.length > 0) {
                return await this.getYouTubeStream(youtubeResults[0]);
            }
            
            throw new Error('No YouTube equivalent found for Spotify track');
        } catch (error) {
            console.error('❌ Error getting Spotify stream:', error);
            throw error;
        }
    }

    async getSoundCloudStream(track) {
        try {
            // SoundCloud streaming requires complex audio extraction
            // For now, fallback to YouTube search
            console.log('🔍 SoundCloud streaming via YouTube fallback...');
            const searchQuery = `${track.title} ${track.author}`;
            const youtubeResults = await this.searchYouTube(searchQuery, 1);
            
            if (youtubeResults.length > 0) {
                return await this.getYouTubeStream(youtubeResults[0]);
            }
            
            throw new Error('No YouTube equivalent found for SoundCloud track');
        } catch (error) {
            console.error('❌ Error getting SoundCloud stream:', error);
            throw error;
        }
    }


    async getPlaylist(url) {
        if (url.includes('youtube.com/playlist') || url.includes('youtu.be/playlist')) {
            return await this.getYouTubePlaylist(url);
        } else if (url.includes('spotify.com/playlist')) {
            return await this.getSpotifyPlaylist(url);
        } else if (url.includes('soundcloud.com/') && url.includes('/sets/')) {
            return await this.getSoundCloudPlaylist(url);
        }
        
        return [];
    }

    async getYouTubePlaylist(url) {
        try {
            const playlistId = this.extractYouTubePlaylistId(url);
            if (!playlistId) return [];

            const playlist = await yts({ listId: playlistId });
            
            return playlist.videos.map(video => ({
                title: video.title,
                author: video.author.name,
                duration: video.duration.timestamp,
                url: video.url,
                thumbnail: video.thumbnail,
                source: 'youtube',
                type: 'video',
                id: video.videoId
            }));
        } catch (error) {
            console.error('❌ Error getting YouTube playlist:', error);
            return [];
        }
    }

    async getSpotifyPlaylist(url) {
        try {
            const playlistId = this.extractSpotifyId(url);
            if (!playlistId) return [];

            const playlist = await this.spotify.getPlaylist(playlistId);
            
            return playlist.body.tracks.items.map(item => ({
                title: item.track.name,
                author: item.track.artists.map(artist => artist.name).join(', '),
                duration: this.formatDuration(item.track.duration_ms),
                url: item.track.external_urls.spotify,
                thumbnail: item.track.album.images[0]?.url,
                source: 'spotify',
                type: 'track',
                spotifyId: item.track.id
            }));
        } catch (error) {
            console.error('❌ Error getting Spotify playlist:', error);
            return [];
        }
    }

    isURL(string) {
        try {
            new URL(string);
            return true;
        } catch {
            return false;
        }
    }

    extractSpotifyId(url) {
        const match = url.match(/spotify\.com\/(track|playlist|album)\/([a-zA-Z0-9]+)/);
        return match ? match[2] : null;
    }


    extractYouTubePlaylistId(url) {
        const match = url.match(/[?&]list=([^&]+)/);
        return match ? match[1] : null;
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

    removeDuplicates(tracks) {
        const seen = new Set();
        return tracks.filter(track => {
            const key = `${track.title.toLowerCase()}-${track.author.toLowerCase()}`;
            if (seen.has(key)) {
                return false;
            }
            seen.add(key);
            return true;
        });
    }

    async getVideoInfo(track) {
        if (track.source === 'youtube') {
            try {
                const info = await ytdl.getInfo(track.url);
                const formats = info.formats.filter(format => 
                    format.hasVideo && format.hasAudio && format.container === 'mp4'
                );
                
                if (formats.length > 0) {
                    return {
                        hasVideo: true,
                        videoUrl: formats[0].url,
                        quality: formats[0].qualityLabel
                    };
                }
            } catch (error) {
                console.error('❌ Error getting video info:', error);
            }
        }
        
        return { hasVideo: false };
    }

    // Fallback strategies for when primary source fails
    async tryYouTubeFallback(track) {
        if (track.source === 'youtube') return null; // Don't fallback to same source
        
        try {
            console.log(`🔄 YouTube fallback: searching for "${track.title} ${track.author}"`);
            const results = await this.searchYouTube(`${track.title} ${track.author}`, 3);
            
            // Look for best match
            for (const result of results) {
                if (this.isGoodMatch(track, result)) {
                    console.log(`✅ Found YouTube fallback: ${result.title}`);
                    return result;
                }
            }
            
            // Return first result if no perfect match
            return results[0] || null;
        } catch (error) {
            console.log(`❌ YouTube fallback failed: ${error.message}`);
            return null;
        }
    }

    async trySpotifyFallback(track) {
        if (track.source === 'spotify') return null; // Don't fallback to same source
        
        try {
            console.log(`🔄 Spotify fallback: searching for "${track.title} ${track.author}"`);
            const results = await this.searchSpotify(`${track.title} ${track.author}`, 3);
            
            for (const result of results) {
                if (this.isGoodMatch(track, result)) {
                    console.log(`✅ Found Spotify fallback: ${result.title}`);
                    // Convert Spotify to YouTube for streaming
                    return await this.tryYouTubeFallback(result);
                }
            }
            
            return results[0] ? await this.tryYouTubeFallback(results[0]) : null;
        } catch (error) {
            console.log(`❌ Spotify fallback failed: ${error.message}`);
            return null;
        }
    }

    async trySoundCloudFallback(track) {
        if (track.source === 'soundcloud') return null; // Don't fallback to same source
        
        // SoundCloud search is currently limited, so try YouTube with SoundCloud-style queries
        try {
            console.log(`🔄 SoundCloud fallback: trying alternative search`);
            const queries = [
                `${track.title} ${track.author} soundcloud`,
                `${track.title} remix`,
                `${track.author} - ${track.title}`
            ];
            
            for (const query of queries) {
                const results = await this.searchYouTube(query, 2);
                if (results.length > 0) {
                    console.log(`✅ Found SoundCloud-style fallback: ${results[0].title}`);
                    return results[0];
                }
            }
            
            return null;
        } catch (error) {
            console.log(`❌ SoundCloud fallback failed: ${error.message}`);
            return null;
        }
    }

    // Emergency download from online sources as last resort
    async tryEmergencyDownload(track) {
        console.log(`🆘 Emergency download for: ${track.title}`);
        
        try {
            // Try different online audio sources
            const emergencySources = [
                `https://www.youtube.com/results?search_query=${encodeURIComponent(track.title + ' ' + track.author)}`,
                `https://open.spotify.com/search/${encodeURIComponent(track.title + ' ' + track.author)}`
            ];
            
            // This would need implementation with web scraping or APIs
            // For now, return null as this is a complex feature
            console.log(`⚠️ Emergency download not implemented yet`);
            return null;
            
        } catch (error) {
            console.log(`❌ Emergency download failed: ${error.message}`);
            return null;
        }
    }

    isGoodMatch(original, candidate) {
        if (!original || !candidate) return false;
        
        const originalTitle = original.title.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
        const candidateTitle = candidate.title.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
        const originalArtist = original.author.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
        const candidateArtist = candidate.author.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
        
        // Split titles into words for better matching
        const originalWords = originalTitle.split(' ').filter(w => w.length > 2);
        const candidateWords = candidateTitle.split(' ').filter(w => w.length > 2);
        const originalArtistWords = originalArtist.split(' ').filter(w => w.length > 1);
        const candidateArtistWords = candidateArtist.split(' ').filter(w => w.length > 1);
        
        // Check if main keywords from title are present
        let titleWordMatches = 0;
        for (const word of originalWords) {
            if (candidateWords.some(cw => cw.includes(word) || word.includes(cw))) {
                titleWordMatches++;
            }
        }
        const titleMatch = titleWordMatches >= Math.min(2, originalWords.length * 0.6);
        
        // Check if artist matches (more lenient)
        let artistWordMatches = 0;
        for (const word of originalArtistWords) {
            if (candidateArtistWords.some(cw => cw.includes(word) || word.includes(cw))) {
                artistWordMatches++;
            }
        }
        const artistMatch = artistWordMatches >= Math.min(1, originalArtistWords.length * 0.5) ||
                           this.levenshteinDistance(originalArtist, candidateArtist) <= 2;
        
        const isMatch = titleMatch && artistMatch;
        if (isMatch) {
            console.log(`✅ Good match found: "${original.title}" → "${candidate.title}"`);
        }
        
        return isMatch;
    }

    levenshteinDistance(str1, str2) {
        const matrix = Array(str2.length + 1).fill().map(() => Array(str1.length + 1).fill(0));
        
        for (let i = 0; i <= str1.length; i++) matrix[0][i] = i;
        for (let j = 0; j <= str2.length; j++) matrix[j][0] = j;
        
        for (let j = 1; j <= str2.length; j++) {
            for (let i = 1; i <= str1.length; i++) {
                const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
                matrix[j][i] = Math.min(
                    matrix[j - 1][i] + 1,
                    matrix[j][i - 1] + 1,
                    matrix[j - 1][i - 1] + cost
                );
            }
        }
        
        return matrix[str2.length][str1.length];
    }
}

module.exports = SourceHandlers;