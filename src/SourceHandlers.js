const ytdl = require('@distube/ytdl-core');
const yts = require('yt-search');
const YouTube = require('youtube-sr').default;
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
            
            console.log('✅ Spotify API initialized');
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

        // Rank results by relevance and source preference
        const rankedResults = this.rankSearchResults(results, query);
        return this.removeDuplicates(rankedResults).slice(0, limit);
    }

    async searchYouTube(query, limit = 5) {
        try {
            // Try YouTube-SR first for better bot detection avoidance
            console.log(`🔍 YouTube-SR search for: ${query}`);
            const youtubeResults = await YouTube.search(query, { 
                limit: limit,
                type: 'video',
                safeSearch: false
            });
            
            if (youtubeResults && youtubeResults.length > 0) {
                console.log(`✅ YouTube-SR found ${youtubeResults.length} results`);
                return youtubeResults.map(video => ({
                    title: video.title,
                    author: video.channel?.name || 'Unknown',
                    duration: video.duration || '0:00',
                    url: video.url,
                    thumbnail: video.thumbnail?.displayThumbnailURL(),
                    source: 'youtube',
                    type: 'video',
                    viewCount: video.views || 0,
                    publishedAt: video.uploadedAt || 'Unknown',
                    description: video.description || '',
                    id: video.id
                }));
            }
        } catch (youtubeError) {
            console.log(`⚠️ YouTube-SR failed: ${youtubeError.message}, trying yt-search fallback`);
        }
        
        try {
            // Fallback to yt-search
            console.log(`🔍 yt-search fallback for: ${query}`);
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
            console.error('❌ All YouTube search methods failed:', error);
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
            // Try web scraping approach first (more reliable)
            console.log(`🔍 SoundCloud web search for: ${query}`);
            const searchUrl = `https://soundcloud.com/search/sounds?q=${encodeURIComponent(query)}`;
            const response = await fetch(searchUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }
            });
            
            if (!response.ok) {
                console.log('🔍 SoundCloud web search failed, using API fallback');
                return await this.searchSoundCloudFallback(query, limit);
            }
            
            const html = await response.text();
            const $ = cheerio.load(html);
            
            // Extract track info from SoundCloud search results
            const tracks = [];
            $('article').each((index, element) => {
                if (tracks.length >= limit) return false;
                
                const $track = $(element);
                const titleEl = $track.find('a[title]').first();
                const title = titleEl.attr('title') || $track.find('h2').text().trim();
                const url = titleEl.attr('href');
                
                if (title && url) {
                    tracks.push({
                        title: title,
                        author: 'SoundCloud Artist', // Hard to extract without more parsing
                        duration: '0:00', // Would need additional API call
                        url: url.startsWith('/') ? `https://soundcloud.com${url}` : url,
                        thumbnail: $track.find('img').attr('src'),
                        source: 'soundcloud',
                        type: 'track',
                        id: url.split('/').pop()
                    });
                }
            });
            
            if (tracks.length > 0) {
                console.log(`✅ Found ${tracks.length} SoundCloud tracks via web scraping`);
                return tracks;
            }
            
            // If web scraping fails, try API fallback
            return await this.searchSoundCloudFallback(query, limit);
            
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
        
        // Use source-specific streaming first
        if (track.source === 'soundcloud') {
            return await this.getSoundCloudStream(track);
        } else if (track.source === 'spotify') {
            return await this.getStreamWithIntelligentFallback(track);
        } else if (track.source === 'youtube') {
            return await this.getStreamWithIntelligentFallback(track);
        } else if (track.source === 'direct') {
            return await this.getDirectAudioStream(track);
        } else if (track.source === 'radio') {
            return await this.getRadioStream(track);
        } else if (track.source === 'bandcamp') {
            return await this.getBandcampStream(track);
        } else if (track.source === 'vimeo') {
            return await this.getVimeoStream(track);
        }
        
        // Advanced multi-client fallback system with intelligent rotation
        return await this.getStreamWithIntelligentFallback(track);
    }

    async getStreamWithIntelligentFallback(track) {
        console.log(`🔄 Using intelligent fallback system for: ${track.title}`);
        
        // Check if yt-dlp is available first
        const hasYtDlp = await this.checkYtDlpAvailable();
        
        // Define streaming methods with multiple options to avoid HLS issues
        const streamingMethods = hasYtDlp ? [
            // Try play-dl first as it may handle HLS better
            {
                name: 'play-dl-enhanced',
                priority: 1,
                method: () => this.getStreamWithPlayDl(track),
                cooldown: 2000,
                maxFailures: 3
            },
            // yt-dlp as secondary with improved format selection
            {
                name: 'yt-dlp-direct',
                priority: 2,
                method: () => this.getStreamWithYtDlp(track),
                cooldown: 1000,
                maxFailures: 3
            },
            // ytdl-core as final fallback
            {
                name: 'ytdl-core-innertube',
                priority: 3,
                method: () => this.getStreamWithYtdlCore(track),
                cooldown: 3000,
                maxFailures: 2
            }
        ] : [
            // Fallback methods when yt-dlp is not available
            {
                name: 'play-dl-enhanced',
                priority: 1,
                method: () => this.getStreamWithPlayDl(track),
                cooldown: 3000,
                maxFailures: 2
            },
            {
                name: 'ytdl-core-innertube',
                priority: 2,
                method: () => this.getStreamWithYtdlCore(track),
                cooldown: 5000,
                maxFailures: 2
            }
        ];
        
        // Sort by priority and filter out methods on cooldown or with too many failures
        const availableMethods = streamingMethods
            .filter(method => this.isMethodAvailable(method))
            .sort((a, b) => a.priority - b.priority);
        
        if (availableMethods.length === 0) {
            console.log('⚠️ All streaming methods are on cooldown or failed too many times');
            // Reset failure counts if all methods are exhausted
            this.resetFailureCounts();
            return await this.getStreamWithIntelligentFallback(track);
        }
        
        for (const [index, methodConfig] of availableMethods.entries()) {
            try {
                console.log(`🔄 Trying method: ${methodConfig.name} (${index + 1}/${availableMethods.length})`);
                console.log(`🔗 Track URL: ${track.url}`);
                console.log(`🎵 Track details: ${track.title} by ${track.author} from ${track.source}`);
                const startTime = Date.now();
                
                const stream = await Promise.race([
                    methodConfig.method(),
                    new Promise((_, reject) => 
                        setTimeout(() => reject(new Error('Method timeout after 30 seconds')), 30000)
                    )
                ]);
                
                if (stream) {
                    const duration = Date.now() - startTime;
                    console.log(`✅ Stream created successfully with ${methodConfig.name} in ${duration}ms`);
                    this.recordMethodSuccess(methodConfig.name);
                    return stream;
                }
            } catch (error) {
                const errorDetails = {
                    method: methodConfig.name,
                    error: error.message,
                    stack: error.stack?.split('\n')[0],
                    trackUrl: track.url,
                    trackTitle: track.title
                };
                console.log(`❌ Method ${methodConfig.name} failed:`, JSON.stringify(errorDetails, null, 2));
                this.recordMethodFailure(methodConfig.name);
                continue;
            }
        }
        
        // Emergency fallback: Try alternative YouTube videos with different search terms
        console.log(`🚨 All methods failed, trying emergency fallback for: ${track.title}`);
        try {
            const emergencyTrack = await this.findAlternativeYouTubeVideo(track);
            if (emergencyTrack) {
                console.log(`🔄 Emergency fallback found: ${emergencyTrack.title}`);
                // Try the most reliable method only for emergency fallback
                return await this.getStreamWithYtdlCore(emergencyTrack);
            }
        } catch (emergencyError) {
            console.log(`❌ Emergency fallback also failed: ${emergencyError.message}`);
        }
        
        // Final desperate attempt: Try to create a minimal working stream
        console.log(`🔧 Final attempt: Creating minimal audio stream for debugging`);
        try {
            return await this.createMinimalAudioStream(track);
        } catch (finalError) {
            console.log(`❌ Final minimal stream attempt failed: ${finalError.message}`);
        }
        
        throw new Error(`All intelligent fallback methods failed for: ${track.title}`);
    }

    async getStreamWithYouTubeSR(track) {
        console.log(`🔍 Using YouTube-SR for enhanced search and streaming`);
        
        let youtubeUrl = track.url;
        if (track.source === 'spotify' || !ytdl.validateURL(track.url)) {
            // Use YouTube-SR for better search results
            const searchQuery = `${track.title} ${track.author}`;
            try {
                const results = await YouTube.search(searchQuery, { 
                    limit: 3,
                    type: 'video',
                    safeSearch: false
                });
                
                if (results && results.length > 0) {
                    youtubeUrl = results[0].url;
                    console.log(`✅ YouTube-SR found: ${results[0].title}`);
                } else {
                    throw new Error('No YouTube-SR results found');
                }
            } catch (searchError) {
                console.log(`❌ YouTube-SR search failed: ${searchError.message}`);
                throw searchError;
            }
        }
        
        // Use ytdl-core with the found URL
        return await this.getStreamWithYtdlCore({ ...track, url: youtubeUrl });
    }

    async getInvidiousStreamFallback(track) {
        console.log(`🔄 Trying Invidious as last resort for: ${track.title}`);
        
        let youtubeUrl = track.url;
        if (track.source === 'spotify' || !ytdl.validateURL(track.url)) {
            const searchQuery = `${track.title} ${track.author}`;
            const searchResults = await this.searchYouTube(searchQuery, 1);
            if (searchResults.length === 0) {
                throw new Error('No YouTube equivalent found for Invidious');
            }
            youtubeUrl = searchResults[0].url;
        }
        
        return await this.getInvidiousStream({ ...track, url: youtubeUrl });
    }

    isMethodAvailable(method) {
        const now = Date.now();
        const lastUsed = this.clientRotation.lastUsed[method.name] || 0;
        const cooldownExpired = now - lastUsed > method.cooldown;
        const failureCount = this.clientRotation.failureCounts[method.name] || 0;
        const belowFailureLimit = failureCount < method.maxFailures;
        
        return cooldownExpired && belowFailureLimit;
    }

    recordMethodSuccess(methodName) {
        this.clientRotation.lastUsed[methodName] = Date.now();
        this.clientRotation.failureCounts[methodName] = 0; // Reset failure count on success
    }

    recordMethodFailure(methodName) {
        this.clientRotation.failureCounts[methodName] = 
            (this.clientRotation.failureCounts[methodName] || 0) + 1;
        this.clientRotation.lastUsed[methodName] = Date.now();
    }

    resetFailureCounts() {
        console.log('🔄 Resetting all method failure counts');
        this.clientRotation.failureCounts = {};
        this.clientRotation.lastUsed = {};
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
        // For Spotify tracks, try multiple alternatives in order of success rate
        console.log(`🎵 Finding alternatives for Spotify track: ${track.title}`);
        
        const alternatives = [
            () => this.findAndStreamSoundCloudAlternative(track),
            () => this.findAndStreamDirectAudioAlternative(track),
            () => this.findAndStreamInvidiousAlternative(track),
            () => this.findAndStreamBandcampAlternative(track),
            () => this.getSpotifyStream(track) // Original method as last fallback
        ];
        
        for (const [index, method] of alternatives.entries()) {
            try {
                console.log(`🔄 Trying Spotify alternative ${index + 1}/${alternatives.length}`);
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
        
        // Last resort: try to provide a notification instead of failing completely
        console.log(`🔔 All streaming failed, providing user notification`);
        return this.generateFailureNotification(track);
    }
    
    async getStreamWithYtDlp(track) {
        console.log(`⚡ Trying yt-dlp for: ${track.title}`);
        
        // First, get the URL if we need to convert from Spotify
        let youtubeUrl = track.url;
        if (track.source === 'spotify' || !ytdl.validateURL(track.url)) {
            const searchQuery = `${track.title} ${track.author} audio`;
            try {
                const searchResults = await this.searchYouTube(searchQuery, 3);
                if (searchResults.length === 0) {
                    throw new Error('No YouTube equivalent found for Spotify track');
                }
                
                // Try multiple search results if first one fails
                for (const result of searchResults) {
                    try {
                        youtubeUrl = result.url;
                        console.log(`🔄 Trying yt-dlp with: ${result.title}`);
                        break;
                    } catch (err) {
                        continue;
                    }
                }
            } catch (searchError) {
                throw new Error(`Search failed: ${searchError.message}`);
            }
        }
        
        // Store track reference for fallback methods
        this.tempTrackRef = track;
        
        // First, get format info to avoid HLS streams
        return new Promise((resolve, reject) => {
            // Step 1: Get format information to identify best direct stream (avoid HLS completely)
            const formatArgs = [
                '--format', 'bestaudio[protocol!=m3u8][protocol!=hls][ext=m4a]/bestaudio[protocol!=m3u8][protocol!=hls][ext=webm]/bestaudio[protocol!=m3u8][protocol!=hls]/best[protocol!=m3u8][protocol!=hls][height<=480]',
                '--no-playlist',
                '--no-warnings',
                '--quiet',
                '--dump-json',
                '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                youtubeUrl
            ];
            
            console.log(`🔄 yt-dlp format check: yt-dlp ${formatArgs.join(' ')}`);
            const formatCheck = spawn('yt-dlp', formatArgs);
            
            let formatOutput = '';
            let formatError = '';
            
            formatCheck.stdout.on('data', (data) => {
                formatOutput += data.toString();
            });
            
            formatCheck.stderr.on('data', (data) => {
                formatError += data.toString();
            });
            
            formatCheck.on('close', async (code) => {
                if (code === 0 && formatOutput.trim()) {
                    try {
                        const formatInfo = JSON.parse(formatOutput.trim());
                        
                        // Check if we have a direct URL (not HLS)
                        if (formatInfo.url && !formatInfo.url.includes('m3u8') && !formatInfo.url.includes('hls_playlist') && !formatInfo.url.includes('manifest') && !formatInfo.protocol?.includes('m3u8') && !formatInfo.protocol?.includes('hls')) {
                            console.log(`✅ yt-dlp found direct audio URL (${formatInfo.ext || 'unknown'}): ${formatInfo.url.substring(0, 80)}...`);
                            
                            try {
                                // Enhanced HTTP request with timeout and headers
                                const response = await fetch(formatInfo.url, {
                                    method: 'GET',
                                    headers: {
                                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                                        'Accept': 'audio/*,*/*;q=0.8',
                                        'Accept-Encoding': 'identity',
                                        'Range': 'bytes=0-'  // Request range to help with streaming
                                    },
                                    timeout: 15000  // 15 second timeout
                                });
                                
                                if (!response.ok) {
                                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                                }
                                
                                // Check content type
                                const contentType = response.headers.get('content-type');
                                if (contentType && contentType.includes('mpegurl')) {
                                    throw new Error('Received HLS playlist instead of direct stream');
                                }
                                
                                // Add error handling to the stream
                                const stream = response.body;
                                if (!stream) {
                                    throw new Error('No response body received');
                                }
                                
                                // Create a buffered passthrough stream for stability
                                const { PassThrough } = require('stream');
                                const bufferedStream = new PassThrough({
                                    highWaterMark: 1024 * 1024, // 1MB buffer
                                });
                                
                                // Add error handling to both streams
                                stream.on('error', (streamError) => {
                                    console.error('❌ HTTP stream error:', streamError.message);
                                    bufferedStream.destroy(streamError);
                                });
                                
                                bufferedStream.on('error', (streamError) => {
                                    console.error('❌ Buffered stream error:', streamError.message);
                                });
                                
                                // Pipe the response through the buffer
                                stream.pipe(bufferedStream);
                                
                                // Wait for initial buffering before resolving
                                let bufferedBytes = 0;
                                const minBufferSize = 64 * 1024; // Wait for 64KB minimum
                                
                                bufferedStream.on('data', (chunk) => {
                                    bufferedBytes += chunk.length;
                                });
                                
                                // Wait for sufficient buffering or timeout
                                const bufferTimeout = setTimeout(() => {
                                    console.log(`⚠️ Stream buffer timeout, proceeding with ${bufferedBytes} bytes buffered`);
                                    resolve(bufferedStream);
                                }, 3000);
                                
                                bufferedStream.on('readable', () => {
                                    if (bufferedBytes >= minBufferSize) {
                                        clearTimeout(bufferTimeout);
                                        console.log(`✅ yt-dlp stream buffered (${bufferedBytes} bytes) and ready`);
                                        resolve(bufferedStream);
                                    }
                                });
                            } catch (fetchError) {
                                console.log(`❌ Failed to fetch yt-dlp stream: ${fetchError.message}`);
                                reject(new Error(`Stream fetch failed: ${fetchError.message}`));
                            }
                        } else {
                            // Fallback: No direct URL found, try getting URL separately
                            console.log('⚠️ No direct URL in format info, trying fallback method');
                            this.getYtDlpUrlFallback(youtubeUrl, resolve, reject);
                        }
                    } catch (parseError) {
                        console.log('⚠️ Failed to parse format info, trying fallback method');
                        this.getYtDlpUrlFallback(youtubeUrl, resolve, reject);
                    }
                } else {
                    console.log('⚠️ Format check failed, trying fallback method');
                    this.getYtDlpUrlFallback(youtubeUrl, resolve, reject);
                }
            });
            
            formatCheck.on('error', (error) => {
                console.log(`❌ yt-dlp format check spawn error: ${error.message}`);
                this.getYtDlpUrlFallback(youtubeUrl, resolve, reject);
            });
            
            // Add timeout for yt-dlp format check
            setTimeout(() => {
                formatCheck.kill('SIGTERM');
                console.log('⚠️ Format check timeout, trying fallback method');
                this.getYtDlpUrlFallback(youtubeUrl, resolve, reject);
            }, 20000);
        });
    }
    
    // Fallback method for yt-dlp URL extraction
    getYtDlpUrlFallback(youtubeUrl, resolve, reject) {
        const ytDlpArgs = [
            '--format', 'bestaudio[protocol!=m3u8][protocol!=hls]/best[protocol!=m3u8][protocol!=hls][height<=480]',
            '--audio-quality', '0',
            '--no-playlist',
            '--no-warnings', 
            '--quiet',
            '--get-url',
            '--prefer-ffmpeg',
            '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            '--add-header', 'Accept:*/*',
            '--add-header', 'Accept-Language:en-US,en;q=0.9',
            '--add-header', 'Accept-Encoding:gzip, deflate, br',
            youtubeUrl
        ];
        
        console.log(`🔄 yt-dlp fallback: yt-dlp ${ytDlpArgs.join(' ')}`);
        const ytDlp = spawn('yt-dlp', ytDlpArgs);
        
        let audioUrl = '';
        let errorOutput = '';
        
        ytDlp.stdout.on('data', (data) => {
            audioUrl += data.toString();
        });
        
        ytDlp.stderr.on('data', (data) => {
            errorOutput += data.toString();
        });
        
        ytDlp.on('close', async (code) => {
            if (code === 0 && audioUrl.trim()) {
                const directUrl = audioUrl.trim().split('\n')[0];
                
                // Check if URL is HLS manifest before proceeding
                if (directUrl.includes('m3u8') || directUrl.includes('hls_playlist') || directUrl.includes('manifest')) {
                    console.log(`❌ yt-dlp fallback returned HLS manifest, rejecting: ${directUrl.substring(0, 80)}...`);
                    // Try alternative method
                    this.getStreamWithPlayDl({...this.tempTrackRef}).then(resolve).catch(() => {
                        reject(new Error('All streaming methods failed - only HLS available'));
                    });
                    return;
                }
                
                console.log(`✅ yt-dlp fallback found direct URL: ${directUrl.substring(0, 80)}...`);
                
                try {
                    const response = await fetch(directUrl, {
                        method: 'GET',
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                            'Accept': 'audio/*,*/*;q=0.8',
                            'Accept-Encoding': 'identity'
                        },
                        timeout: 15000
                    });
                    
                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                    }
                    
                    // Check response content type
                    const contentType = response.headers.get('content-type');
                    if (contentType && contentType.includes('mpegurl')) {
                        throw new Error('Response is HLS manifest, not direct audio');
                    }
                    
                    console.log(`✅ yt-dlp fallback stream created successfully`);
                    resolve(response.body);
                } catch (fetchError) {
                    console.log(`❌ Failed to fetch fallback stream: ${fetchError.message}`);
                    // Try alternative method
                    this.getStreamWithPlayDl({...this.tempTrackRef}).then(resolve).catch(() => {
                        reject(new Error(`Fallback stream fetch failed: ${fetchError.message}`));
                    });
                }
            } else {
                const errorMsg = errorOutput || `yt-dlp fallback failed with code: ${code}`;
                console.log(`❌ yt-dlp fallback error: ${errorMsg}`);
                // Try alternative method
                this.getStreamWithPlayDl({...this.tempTrackRef}).then(resolve).catch(() => {
                    reject(new Error(errorMsg));
                });
            }
        });
        
        ytDlp.on('error', (error) => {
            console.log(`❌ yt-dlp fallback spawn error: ${error.message}`);
            reject(new Error(`yt-dlp fallback process error: ${error.message}`));
        });
        
        setTimeout(() => {
            ytDlp.kill('SIGTERM');
            reject(new Error('yt-dlp fallback timeout after 30 seconds'));
        }, 30000);
    }
    
    async getStreamWithPlayDl(track) {
        console.log(`⚡ Trying play-dl with enhanced configuration for: ${track.title}`);
        
        // Configure play-dl with multiple tokens and better user agents
        try {
            await play.setToken({
                soundcloud: {
                    client_id: 'LBCcHmRB8XSStWL6wKH2HPACspQlXeOt'
                },
                youtube: {
                    cookie: process.env.YOUTUBE_COOKIE || ''
                }
            });
        } catch (error) {
            console.log('⚠️ Could not set play-dl tokens, continuing without them');
        }
        
        let youtubeUrl = track.url;
        if (track.source === 'spotify') {
            const searchQuery = `${track.title} ${track.author} audio`;
            
            // Try multiple search approaches with different YouTube client configurations
            const searchConfigs = [
                { limit: 3, source: { youtube: "video" }, unscramble: false },
                { limit: 3, source: { youtube: "video" }, unscramble: true, quality: 'low' },
                { limit: 2, source: { soundcloud: "tracks" } }
            ];
            
            for (const config of searchConfigs) {
                try {
                    console.log(`🔍 play-dl search with config: ${JSON.stringify(config)}`);
                    const results = await play.search(searchQuery, config);
                    
                    if (results && results.length > 0) {
                        // Try multiple results if available
                        for (const result of results) {
                            try {
                                youtubeUrl = result.url;
                                console.log(`🔄 play-dl trying: ${result.title}`);
                                break;
                            } catch (err) {
                                continue;
                            }
                        }
                        break;
                    }
                } catch (searchError) {
                    console.log(`⚠️ Search config failed: ${searchError.message}`);
                    continue;
                }
            }
        }
        
        // Enhanced streaming options with multiple quality fallbacks
        const streamConfigs = [
            {
                quality: 0, // Lowest quality for maximum compatibility
                discordPlayerCompatibility: true,
                seek: 0,
                htmldata: false,
                format: 'mp3'
            },
            {
                quality: 1,
                discordPlayerCompatibility: true,
                seek: 0,
                htmldata: false
            },
            {
                quality: 2,
                discordPlayerCompatibility: true,
                seek: 0
            }
        ];
        
        // Validate URL for play-dl compatibility
        if (!youtubeUrl || !ytdl.validateURL(youtubeUrl)) {
            throw new Error(`Invalid YouTube URL for play-dl: ${youtubeUrl}`);
        }

        // Check if play-dl can validate this URL
        try {
            const isValid = await play.validate(youtubeUrl);
            if (!isValid) {
                throw new Error(`play-dl cannot validate URL: ${youtubeUrl}`);
            }
        } catch (validateError) {
            console.log(`⚠️ play-dl URL validation failed: ${validateError.message}`);
            throw new Error(`URL validation failed: ${validateError.message}`);
        }

        for (const [index, streamOptions] of streamConfigs.entries()) {
            try {
                console.log(`🔄 play-dl stream attempt ${index + 1}/3 with options: ${JSON.stringify(streamOptions)}`);
                const stream = await play.stream(youtubeUrl, streamOptions);
                console.log(`✅ play-dl stream created successfully with config ${index + 1}`);
                return stream.stream;
            } catch (streamError) {
                console.log(`❌ play-dl config ${index + 1} failed: ${streamError.message}`);
                if (index === streamConfigs.length - 1) {
                    throw streamError;
                }
                continue;
            }
        }
    }
    
    async getStreamWithYtdlCore(track) {
        console.log(`⚡ Trying ytdl-core with simplified approach for: ${track.title}`);
        
        let youtubeUrl = track.url;
        if (track.source === 'spotify') {
            const searchQuery = `${track.title} ${track.author} audio`;
            const searchResults = await this.searchYouTube(searchQuery, 1);
            if (searchResults.length === 0) {
                throw new Error('No YouTube equivalent found');
            }
            youtubeUrl = searchResults[0].url;
        }
        
        // Simplified approach with basic options
        const basicOptions = {
            filter: 'audioonly',
            quality: 'lowestaudio',
            requestOptions: {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            }
        };
        
        try {
            console.log(`🔄 ytdl-core basic attempt for: ${youtubeUrl}`);
            const stream = ytdl(youtubeUrl, basicOptions);
            
            // Wait for stream to be ready and validate it
            return new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    stream.destroy();
                    reject(new Error('ytdl-core stream timeout'));
                }, 15000);
                
                stream.on('info', (info) => {
                    clearTimeout(timeout);
                    console.log(`✅ ytdl-core found stream: ${info.videoDetails.title}`);
                    resolve(stream);
                });
                
                stream.on('error', (error) => {
                    clearTimeout(timeout);
                    console.log(`❌ ytdl-core error: ${error.message}`);
                    reject(error);
                });
            });
        } catch (error) {
            console.log(`❌ ytdl-core failed: ${error.message}`);
            throw error;
        }
    }

    // Additional methods for other streaming sources can be added here
    async getSoundCloudStream(track) {
        // SoundCloud streaming implementation
        throw new Error('SoundCloud streaming not implemented');
    }

    async getDirectAudioStream(track) {
        // Direct audio streaming implementation
        throw new Error('Direct audio streaming not implemented');
    }

    async getRadioStream(track) {
        // Radio streaming implementation
        throw new Error('Radio streaming not implemented');
    }

    async getBandcampStream(track) {
        // Bandcamp streaming implementation
        throw new Error('Bandcamp streaming not implemented');
    }

    async getVimeoStream(track) {
        // Vimeo streaming implementation
        throw new Error('Vimeo streaming not implemented');
    }

    async findAlternativeYouTubeVideo(originalTrack) {
        console.log(`🔍 Finding alternative YouTube video for: ${originalTrack.title}`);
        
        // Try different search strategies
        const searchStrategies = [
            `${originalTrack.title} ${originalTrack.author} official audio`,
            `${originalTrack.title} ${originalTrack.author} lyrics`,
            `${originalTrack.title} ${originalTrack.author} music video`,
            `${originalTrack.title} audio only`,
            `${originalTrack.title} cover`,
            `${originalTrack.author} ${originalTrack.title.split(' ')[0]}` // First word of title
        ];
        
        for (const searchQuery of searchStrategies) {
            try {
                console.log(`🔍 Emergency search: ${searchQuery}`);
                const results = await this.searchYouTube(searchQuery, 3);
                
                for (const result of results) {
                    // Skip the original URL to avoid infinite loops
                    if (result.url !== originalTrack.url) {
                        console.log(`✅ Found alternative: ${result.title}`);
                        return {
                            ...result,
                            source: 'youtube'
                        };
                    }
                }
            } catch (searchError) {
                console.log(`⚠️ Emergency search failed for "${searchQuery}": ${searchError.message}`);
                continue;
            }
        }
        
        return null;
    }

    async createMinimalAudioStream(track) {
        console.log(`🔧 Creating minimal placeholder stream for: ${track.title}`);
        
        const { Readable } = require('stream');
        
        // Create a simple audio stream that plays silence for 30 seconds
        // This prevents the bot from completely failing and gives feedback to the user
        const placeholderStream = new Readable({
            read() {
                // Generate 16-bit stereo PCM silence (44.1kHz sample rate)
                const sampleRate = 44100;
                const channels = 2;
                const bytesPerSample = 2;
                const samplesPerBuffer = 1024;
                
                const bufferSize = samplesPerBuffer * channels * bytesPerSample;
                const silenceBuffer = Buffer.alloc(bufferSize, 0);
                
                this.push(silenceBuffer);
                
                // End stream after 30 seconds worth of data
                if (!this.endTimer) {
                    this.endTimer = setTimeout(() => {
                        this.push(null);
                    }, 30000);
                }
            }
        });
        
        console.log(`✅ Created minimal placeholder stream (30s silence) for: ${track.title}`);
        return placeholderStream;
    }

    // Utility methods for method availability checking
    isMethodAvailable(method) {
        const now = Date.now();
        const failureCount = this.clientRotation.failureCounts[method.name] || 0;
        const lastUsed = this.clientRotation.lastUsed[method.name] || 0;
        const cooldownExpired = now - lastUsed > (method.cooldown || 0);
        
        return failureCount < (method.maxFailures || 3) && cooldownExpired;
    }

    recordMethodSuccess(methodName) {
        this.clientRotation.failureCounts[methodName] = 0;
        this.clientRotation.lastUsed[methodName] = Date.now();
    }

    recordMethodFailure(methodName) {
        this.clientRotation.failureCounts[methodName] = (this.clientRotation.failureCounts[methodName] || 0) + 1;
        this.clientRotation.lastUsed[methodName] = Date.now();
    }

    resetFailureCounts() {
        this.clientRotation.failureCounts = {};
    }

    async checkYtDlpAvailable() {
        if (this.ytDlpAvailable !== undefined) {
            return this.ytDlpAvailable;
        }

        try {
            if (process.env.RAILWAY_ENVIRONMENT || process.env.NIXPACKS_NIX_CONF) {
                console.log('✅ Railway environment detected - yt-dlp is available via Nix');
                this.ytDlpAvailable = true;
                return true;
            }

            const { spawn } = require('child_process');
            const ytdlp = spawn('yt-dlp', ['--version']);
            
            return new Promise((resolve) => {
                ytdlp.on('close', (code) => {
                    const available = code === 0;
                    this.ytDlpAvailable = available;
                    console.log(available ? '✅ yt-dlp is available' : '❌ yt-dlp is not available');
                    resolve(available);
                });
                
                ytdlp.on('error', () => {
                    this.ytDlpAvailable = false;
                    console.log('❌ yt-dlp is not available');
                    resolve(false);
                });
                
                setTimeout(() => {
                    ytdlp.kill();
                    this.ytDlpAvailable = false;
                    resolve(false);
                }, 3000);
            });
        } catch (error) {
            this.ytDlpAvailable = false;
            return false;
        }
    }
}

module.exports = SourceHandlers;
