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
            // Search Spotify, YouTube, and SoundCloud
            const searches = await Promise.allSettled([
                this.searchSpotify(query, limit),
                this.searchYouTube(query, limit),
                this.searchSoundCloud(query, limit)
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
            // Use SoundCloud's API-like endpoint (public)
            const searchUrl = `https://api-v2.soundcloud.com/search/tracks?q=${encodeURIComponent(query)}&limit=${limit}&client_id=LBCcHmRB8XSStWL6wKH2HPACspQlXeOt`;
            const response = await fetch(searchUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }
            });
            
            if (!response.ok) {
                console.log('🔍 SoundCloud API failed, using fallback search');
                return await this.searchSoundCloudFallback(query, limit);
            }
            
            const data = await response.json();
            
            if (!data.collection || data.collection.length === 0) {
                return [];
            }
            
            return data.collection.map(track => ({
                title: track.title,
                author: track.user?.username || 'Unknown Artist',
                duration: this.formatDuration(track.duration || 0),
                url: track.permalink_url,
                thumbnail: track.artwork_url?.replace('large', 't500x500') || track.user?.avatar_url,
                source: 'soundcloud',
                type: 'track',
                playbackCount: track.playback_count || 0,
                likesCount: track.favoritings_count || 0,
                description: track.description || '',
                id: track.id,
                streamable: track.streamable
            }));
            
        } catch (error) {
            console.error('❌ SoundCloud search error:', error);
            return await this.searchSoundCloudFallback(query, limit);
        }
    }

    async searchSoundCloudFallback(query, limit = 5) {
        try {
            // Fallback: Try different SoundCloud client IDs
            const clientIds = [
                'LBCcHmRB8XSStWL6wKH2HPACspQlXeOt',
                'iZIs9mchVcX5lhVRyQGGAYlNPVldzAoJ',
                'a3e059563d7fd3372b49b37f00a00bcf'
            ];
            
            for (const clientId of clientIds) {
                try {
                    const searchUrl = `https://api-v2.soundcloud.com/search/tracks?q=${encodeURIComponent(query)}&limit=${limit}&client_id=${clientId}`;
                    const response = await fetch(searchUrl);
                    
                    if (response.ok) {
                        const data = await response.json();
                        if (data.collection && data.collection.length > 0) {
                            console.log('✅ SoundCloud fallback successful');
                            return data.collection.slice(0, limit).map(track => ({
                                title: track.title,
                                author: track.user?.username || 'Unknown Artist',
                                duration: this.formatDuration(track.duration || 0),
                                url: track.permalink_url,
                                thumbnail: track.artwork_url,
                                source: 'soundcloud',
                                type: 'track',
                                id: track.id
                            }));
                        }
                    }
                } catch (err) {
                    continue;
                }
            }
            
            console.log('🔍 All SoundCloud methods failed, returning empty results');
            return [];
            
        } catch (error) {
            console.error('❌ SoundCloud fallback error:', error);
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
        } else if (url.includes('bandcamp.com')) {
            return await this.getBandcampTrack(url);
        } else if (url.includes('vimeo.com')) {
            return await this.getVimeoTrack(url);
        } else if (this.isDirectAudioURL(url)) {
            return await this.getDirectAudioTrack(url);
        } else if (this.isStreamPlaylist(url)) {
            return await this.getStreamPlaylistTrack(url);
        }
        
        return null;
    }

    isDirectAudioURL(url) {
        const audioExtensions = ['.mp3', '.flac', '.wav', '.m4a', '.aac', '.ogg', '.opus'];
        const lowerUrl = url.toLowerCase();
        return audioExtensions.some(ext => lowerUrl.includes(ext)) || 
               lowerUrl.includes('audio') || 
               url.match(/\.(mp3|flac|wav|m4a|aac|ogg|opus)(\?|$)/i);
    }

    isStreamPlaylist(url) {
        return url.toLowerCase().includes('.m3u') || 
               url.toLowerCase().includes('.pls') ||
               url.includes('stream') ||
               url.includes('radio');
    }

    async getDirectAudioTrack(url) {
        try {
            console.log(`🎵 Processing direct audio URL: ${url}`);
            
            // Try to get metadata from HTTP headers
            const response = await fetch(url, { method: 'HEAD' });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const contentType = response.headers.get('content-type');
            const contentLength = response.headers.get('content-length');
            const filename = url.split('/').pop().split('?')[0];
            
            if (!contentType?.includes('audio')) {
                console.log(`⚠️ Warning: Content-Type is ${contentType}, may not be audio`);
            }

            return {
                title: decodeURIComponent(filename) || 'Direct Audio Stream',
                author: 'Unknown Artist',
                duration: contentLength ? this.estimateDuration(parseInt(contentLength)) : '0:00',
                url: url,
                thumbnail: null,
                source: 'direct',
                type: 'audio',
                contentType: contentType,
                fileSize: contentLength ? parseInt(contentLength) : 0,
                filename: filename
            };
        } catch (error) {
            console.error('❌ Error processing direct audio URL:', error);
            return null;
        }
    }

    async getStreamPlaylistTrack(url) {
        try {
            console.log(`🎵 Processing stream playlist: ${url}`);
            
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const playlistContent = await response.text();
            
            // Parse M3U playlist
            if (url.includes('.m3u') || playlistContent.includes('#EXTM3U')) {
                const streamUrl = this.parseM3UPlaylist(playlistContent);
                if (streamUrl) {
                    return {
                        title: 'Internet Radio Stream',
                        author: 'Radio Station',
                        duration: 'Live',
                        url: streamUrl,
                        thumbnail: null,
                        source: 'radio',
                        type: 'stream',
                        isLive: true,
                        originalPlaylist: url
                    };
                }
            }
            
            // Parse PLS playlist
            if (url.includes('.pls') || playlistContent.includes('[playlist]')) {
                const streamUrl = this.parsePLSPlaylist(playlistContent);
                if (streamUrl) {
                    return {
                        title: 'Internet Radio Stream',
                        author: 'Radio Station',
                        duration: 'Live',
                        url: streamUrl,
                        thumbnail: null,
                        source: 'radio',
                        type: 'stream',
                        isLive: true,
                        originalPlaylist: url
                    };
                }
            }

            throw new Error('Unable to parse stream playlist');
        } catch (error) {
            console.error('❌ Error processing stream playlist:', error);
            return null;
        }
    }

    parseM3UPlaylist(content) {
        const lines = content.split('\n');
        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed && !trimmed.startsWith('#') && trimmed.startsWith('http')) {
                return trimmed;
            }
        }
        return null;
    }

    parsePLSPlaylist(content) {
        const lines = content.split('\n');
        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('File') && trimmed.includes('=http')) {
                return trimmed.split('=')[1];
            }
        }
        return null;
    }

    estimateDuration(fileSize) {
        // Rough estimate: average MP3 is ~1MB per minute at 128kbps
        const estimatedMinutes = Math.round(fileSize / (1024 * 1024));
        return estimatedMinutes > 0 ? `${estimatedMinutes}:00` : '0:30';
    }

    async getBandcampTrack(url) {
        try {
            console.log(`🎵 Processing Bandcamp URL: ${url}`);
            
            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }
            });
            
            if (!response.ok) {
                throw new Error(`Bandcamp fetch failed: ${response.status}`);
            }
            
            const html = await response.text();
            const $ = cheerio.load(html);
            
            // Extract track info from Bandcamp page
            const title = $('h2.trackTitle').text().trim() || 
                         $('meta[property="og:title"]').attr('content') || 'Unknown Track';
            const artist = $('.albumTitle .text').text().trim() || 
                          $('meta[property="og:site_name"]').attr('content') || 'Unknown Artist';
            const thumbnail = $('meta[property="og:image"]').attr('content');
            
            return {
                title: title,
                author: artist,
                duration: '0:00', // Bandcamp duration is hard to extract without API
                url: url,
                thumbnail: thumbnail,
                source: 'bandcamp',
                type: 'track',
                description: $('meta[property="og:description"]').attr('content') || ''
            };
        } catch (error) {
            console.error('❌ Error processing Bandcamp track:', error);
            return null;
        }
    }

    async getVimeoTrack(url) {
        try {
            console.log(`🎵 Processing Vimeo URL: ${url}`);
            
            const videoId = url.match(/vimeo\.com\/(\d+)/)?.[1];
            if (!videoId) {
                throw new Error('Invalid Vimeo URL');
            }
            
            const apiUrl = `https://vimeo.com/api/v2/video/${videoId}.json`;
            const response = await fetch(apiUrl);
            
            if (!response.ok) {
                throw new Error(`Vimeo API failed: ${response.status}`);
            }
            
            const data = await response.json();
            const video = data[0];
            
            return {
                title: video.title,
                author: video.user_name,
                duration: this.formatDuration(video.duration * 1000),
                url: video.url,
                thumbnail: video.thumbnail_large,
                source: 'vimeo',
                type: 'video',
                viewCount: video.stats_number_of_plays,
                description: video.description,
                id: videoId
            };
        } catch (error) {
            console.error('❌ Error processing Vimeo track:', error);
            return null;
        }
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
        
        // Use different methods based on source
        if (track.source === 'soundcloud') {
            return await this.getSoundCloudStream(track);
        } else if (track.source === 'spotify') {
            return await this.getSpotifyStreamWithAlternatives(track);
        } else if (track.source === 'youtube') {
            return await this.getYouTubeStreamWithAlternatives(track);
        } else if (track.source === 'direct') {
            return await this.getDirectAudioStream(track);
        } else if (track.source === 'radio') {
            return await this.getRadioStream(track);
        } else if (track.source === 'bandcamp') {
            return await this.getBandcampStream(track);
        } else if (track.source === 'vimeo') {
            return await this.getVimeoStream(track);
        }
        
        // Fallback to original methods
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

    async getYouTubeStreamWithAlternatives(track) {
        // Try Invidious instances first, then regular YouTube
        const methods = [
            () => this.getInvidiousStream(track),
            () => this.getStreamWithYtDlp(track),
            () => this.getStreamWithPlayDl(track),
            () => this.getStreamWithYtdlCore(track)
        ];
        
        for (const [index, method] of methods.entries()) {
            try {
                console.log(`🔄 Trying YouTube method ${index + 1}/4`);
                const stream = await method();
                if (stream) {
                    console.log(`✅ YouTube stream created with method ${index + 1}`);
                    return stream;
                }
            } catch (error) {
                console.log(`❌ YouTube method ${index + 1} failed: ${error.message}`);
                continue;
            }
        }
        
        throw new Error(`All YouTube methods failed for: ${track.title}`);
    }

    async getSpotifyStreamWithAlternatives(track) {
        // For Spotify tracks, try SoundCloud first, then YouTube alternatives
        console.log(`🎵 Finding alternatives for Spotify track: ${track.title}`);
        
        const alternatives = [
            () => this.findAndStreamSoundCloudAlternative(track),
            () => this.findAndStreamInvidiousAlternative(track),
            () => this.getSpotifyStream(track) // Original method as fallback
        ];
        
        for (const [index, method] of alternatives.entries()) {
            try {
                console.log(`🔄 Trying Spotify alternative ${index + 1}/3`);
                const stream = await method();
                if (stream) {
                    console.log(`✅ Spotify alternative stream created with method ${index + 1}`);
                    return stream;
                }
            } catch (error) {
                console.log(`❌ Spotify alternative ${index + 1} failed: ${error.message}`);
                continue;
            }
        }
        
        throw new Error(`All Spotify alternatives failed for: ${track.title}`);
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
            console.log(`🎵 Getting SoundCloud stream for: ${track.title}`);
            
            // Try to get direct SoundCloud stream
            const streamUrl = await this.getSoundCloudStreamUrl(track);
            if (streamUrl) {
                console.log('✅ Found direct SoundCloud stream');
                const response = await fetch(streamUrl);
                if (response.ok) {
                    return response.body;
                }
            }
            
            throw new Error('Direct SoundCloud streaming failed');
        } catch (error) {
            console.log('❌ Direct SoundCloud failed, trying YouTube fallback...');
            // Fallback to YouTube search
            const searchQuery = `${track.title} ${track.author}`;
            const youtubeResults = await this.searchYouTube(searchQuery, 1);
            
            if (youtubeResults.length > 0) {
                return await this.getYouTubeStreamWithAlternatives(youtubeResults[0]);
            }
            
            throw new Error('No alternatives found for SoundCloud track');
        }
    }

    async getSoundCloudStreamUrl(track) {
        try {
            // Extract track ID from SoundCloud URL
            const trackId = await this.getSoundCloudTrackId(track.url);
            if (!trackId) return null;

            // Try different client IDs for SoundCloud streaming
            const clientIds = [
                'LBCcHmRB8XSStWL6wKH2HPACspQlXeOt',
                'iZIs9mchVcX5lhVRyQGGAYlNPVldzAoJ',
                'a3e059563d7fd3372b49b37f00a00bcf'
            ];

            for (const clientId of clientIds) {
                try {
                    const streamUrl = `https://api-v2.soundcloud.com/tracks/${trackId}/stream?client_id=${clientId}`;
                    const response = await fetch(streamUrl, { method: 'HEAD' });
                    
                    if (response.ok) {
                        return streamUrl;
                    }
                } catch (err) {
                    continue;
                }
            }

            return null;
        } catch (error) {
            console.error('❌ Error getting SoundCloud stream URL:', error);
            return null;
        }
    }

    async getSoundCloudTrackId(url) {
        try {
            // If URL already contains track ID, extract it
            if (url.includes('/tracks/')) {
                const match = url.match(/\/tracks\/(\d+)/);
                return match ? match[1] : null;
            }

            // Otherwise, resolve the permalink URL to get track ID
            const clientIds = ['LBCcHmRB8XSStWL6wKH2HPACspQlXeOt'];
            
            for (const clientId of clientIds) {
                try {
                    const resolveUrl = `https://api-v2.soundcloud.com/resolve?url=${encodeURIComponent(url)}&client_id=${clientId}`;
                    const response = await fetch(resolveUrl);
                    
                    if (response.ok) {
                        const data = await response.json();
                        return data.id?.toString();
                    }
                } catch (err) {
                    continue;
                }
            }

            return null;
        } catch (error) {
            console.error('❌ Error getting SoundCloud track ID:', error);
            return null;
        }
    }

    async getInvidiousStream(track) {
        // List of working Invidious instances
        const invidiousInstances = [
            'https://invidious.fdn.fr',
            'https://invidious.privacydev.net',
            'https://inv.nadeko.net',
            'https://invidious.slipfox.xyz',
            'https://invidious.weblibre.org'
        ];

        const videoId = this.extractYouTubeVideoId(track.url);
        if (!videoId) {
            throw new Error('Invalid YouTube URL for Invidious');
        }

        for (const instance of invidiousInstances) {
            try {
                console.log(`🔄 Trying Invidious instance: ${instance}`);
                const apiUrl = `${instance}/api/v1/videos/${videoId}`;
                
                const response = await fetch(apiUrl, {
                    timeout: 5000,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    }
                });

                if (!response.ok) continue;

                const data = await response.json();
                const audioFormat = data.adaptiveFormats?.find(f => f.type?.includes('audio')) || 
                                  data.formatStreams?.find(f => f.type?.includes('audio'));

                if (audioFormat?.url) {
                    console.log(`✅ Found Invidious stream: ${instance}`);
                    const streamResponse = await fetch(audioFormat.url);
                    if (streamResponse.ok) {
                        return streamResponse.body;
                    }
                }
            } catch (error) {
                console.log(`❌ Invidious instance ${instance} failed: ${error.message}`);
                continue;
            }
        }

        throw new Error('All Invidious instances failed');
    }

    async findAndStreamSoundCloudAlternative(track) {
        console.log(`🎵 Searching SoundCloud for: ${track.title} by ${track.author}`);
        
        const soundCloudResults = await this.searchSoundCloud(`${track.title} ${track.author}`, 3);
        
        for (const scTrack of soundCloudResults) {
            if (this.isGoodMatch(track, scTrack)) {
                console.log(`✅ Found SoundCloud alternative: ${scTrack.title}`);
                return await this.getSoundCloudStream(scTrack);
            }
        }
        
        throw new Error('No SoundCloud alternative found');
    }

    async findAndStreamInvidiousAlternative(track) {
        console.log(`🎵 Searching YouTube for Invidious streaming: ${track.title} by ${track.author}`);
        
        const youtubeResults = await this.searchYouTube(`${track.title} ${track.author}`, 3);
        
        for (const ytTrack of youtubeResults) {
            if (this.isGoodMatch(track, ytTrack)) {
                console.log(`✅ Found YouTube alternative for Invidious: ${ytTrack.title}`);
                return await this.getInvidiousStream(ytTrack);
            }
        }
        
        throw new Error('No Invidious alternative found');
    }

    extractYouTubeVideoId(url) {
        const patterns = [
            /(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/,
            /youtube\.com\/embed\/([^&\n?#]+)/,
            /youtube\.com\/v\/([^&\n?#]+)/
        ];

        for (const pattern of patterns) {
            const match = url.match(pattern);
            if (match) return match[1];
        }

        return null;
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

    async getDirectAudioStream(track) {
        try {
            console.log(`🎵 Getting direct audio stream: ${track.title}`);
            
            const response = await fetch(track.url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Range': 'bytes=0-' // Support for range requests
                }
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            console.log(`✅ Direct audio stream created successfully`);
            return response.body;
        } catch (error) {
            console.error('❌ Error getting direct audio stream:', error);
            throw error;
        }
    }

    async getRadioStream(track) {
        try {
            console.log(`📻 Getting radio stream: ${track.title}`);
            
            const response = await fetch(track.url, {
                headers: {
                    'User-Agent': 'VLC/3.0.16 LibVLC/3.0.16',
                    'Icy-MetaData': '1' // Request ICY metadata for radio streams
                }
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            console.log(`✅ Radio stream created successfully`);
            return response.body;
        } catch (error) {
            console.error('❌ Error getting radio stream:', error);
            throw error;
        }
    }

    async getBandcampStream(track) {
        try {
            console.log(`🎵 Getting Bandcamp stream: ${track.title}`);
            
            // For Bandcamp, we need to extract the actual audio file URL
            const response = await fetch(track.url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }
            });
            
            if (!response.ok) {
                throw new Error(`Bandcamp page fetch failed: ${response.status}`);
            }
            
            const html = await response.text();
            
            // Extract audio file URL from Bandcamp page JavaScript
            const audioUrlMatch = html.match(/"file":{"mp3-128":"([^"]+)"/);
            if (audioUrlMatch) {
                const audioUrl = audioUrlMatch[1].replace(/\\\//g, '/');
                console.log(`✅ Found Bandcamp audio URL`);
                
                const audioResponse = await fetch(audioUrl);
                if (audioResponse.ok) {
                    return audioResponse.body;
                }
            }
            
            throw new Error('Could not extract Bandcamp audio URL');
        } catch (error) {
            console.error('❌ Error getting Bandcamp stream:', error);
            // Fallback to YouTube search
            console.log('🔄 Trying YouTube fallback for Bandcamp track...');
            const youtubeResults = await this.searchYouTube(`${track.title} ${track.author}`, 1);
            
            if (youtubeResults.length > 0) {
                return await this.getYouTubeStreamWithAlternatives(youtubeResults[0]);
            }
            
            throw error;
        }
    }

    async getVimeoStream(track) {
        try {
            console.log(`🎵 Getting Vimeo stream: ${track.title}`);
            
            const videoId = track.id || track.url.match(/vimeo\.com\/(\d+)/)?.[1];
            if (!videoId) {
                throw new Error('Invalid Vimeo video ID');
            }
            
            // Try to get video config with audio streams
            const configUrl = `https://player.vimeo.com/video/${videoId}/config`;
            const response = await fetch(configUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });
            
            if (!response.ok) {
                throw new Error(`Vimeo config failed: ${response.status}`);
            }
            
            const config = await response.json();
            const progressiveStreams = config.request?.files?.progressive;
            
            if (progressiveStreams && progressiveStreams.length > 0) {
                // Choose the lowest quality for audio-only purposes
                const stream = progressiveStreams.find(s => s.quality === 'medium') || 
                              progressiveStreams[progressiveStreams.length - 1];
                
                console.log(`✅ Found Vimeo stream URL`);
                const streamResponse = await fetch(stream.url);
                if (streamResponse.ok) {
                    return streamResponse.body;
                }
            }
            
            throw new Error('No suitable Vimeo streams found');
        } catch (error) {
            console.error('❌ Error getting Vimeo stream:', error);
            // Fallback to YouTube search
            console.log('🔄 Trying YouTube fallback for Vimeo track...');
            const youtubeResults = await this.searchYouTube(`${track.title} ${track.author}`, 1);
            
            if (youtubeResults.length > 0) {
                return await this.getYouTubeStreamWithAlternatives(youtubeResults[0]);
            }
            
            throw error;
        }
    }
}

module.exports = SourceHandlers;