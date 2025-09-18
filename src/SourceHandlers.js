const ytdl = require('@distube/ytdl-core');
const yts = require('yt-search');
const YouTube = require('youtube-sr').default;
const SpotifyWebApi = require('spotify-web-api-node');
const fetch = require('node-fetch');
const cheerio = require('cheerio');
const config = require('../config.js');
const play = require('play-dl');
const { spawn } = require('child_process');
const { Readable, PassThrough } = require('stream');
const https = require('https');
const http = require('http');

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
        
        // User agent rotation for anti-detection
        this.userAgents = [
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        ];
    }
    
    getRandomUserAgent() {
        return this.userAgents[Math.floor(Math.random() * this.userAgents.length)];
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

    isURL(str) {
        try {
            // Check if it's a valid URL
            new URL(str);
            return true;
        } catch {
            // Check common URL patterns without protocol
            const urlPattern = /^(https?:\/\/)?([\da-z\.-]+)\.([a-z\.]{2,6})([\/\w \.-]*)*\/?$/i;
            const youtubePattern = /^(youtube\.com|youtu\.be|music\.youtube\.com)/i;
            const spotifyPattern = /^(spotify\.com|open\.spotify\.com)/i;
            const soundcloudPattern = /^(soundcloud\.com)/i;
            
            return urlPattern.test(str) || youtubePattern.test(str) || spotifyPattern.test(str) || soundcloudPattern.test(str);
        }
    }

    async handleURL(url) {
        try {
            console.log(`🔗 Processing URL: ${url}`);
            
            // Normalize URL
            if (!url.startsWith('http://') && !url.startsWith('https://')) {
                url = 'https://' + url;
            }
            
            const urlObj = new URL(url);
            const hostname = urlObj.hostname.toLowerCase();
            
            if (hostname.includes('youtube.com') || hostname.includes('youtu.be') || hostname.includes('music.youtube.com')) {
                return await this.handleYouTubeURL(url);
            } else if (hostname.includes('spotify.com')) {
                return await this.handleSpotifyURL(url);
            } else if (hostname.includes('soundcloud.com')) {
                return await this.handleSoundCloudURL(url);
            } else {
                console.log(`⚠️ Unsupported URL platform: ${hostname}`);
                return null;
            }
        } catch (error) {
            console.error(`❌ Error handling URL ${url}:`, error.message);
            return null;
        }
    }

    async handleYouTubeURL(url) {
        try {
            // Extract video ID from various YouTube URL formats
            const videoId = this.extractYouTubeVideoId(url);
            if (!videoId) {
                throw new Error('Could not extract video ID from YouTube URL');
            }
            
            // Use YouTube-SR to get video info
            const video = await YouTube.getVideo(`https://www.youtube.com/watch?v=${videoId}`);
            
            return {
                title: video.title,
                author: video.channel?.name || 'Unknown',
                duration: video.duration || '0:00',
                url: video.url,
                thumbnail: video.thumbnail?.displayThumbnailURL(),
                source: 'youtube',
                type: 'video'
            };
        } catch (error) {
            console.error(`❌ Error handling YouTube URL:`, error.message);
            return null;
        }
    }

    async handleSpotifyURL(url) {
        try {
            // Extract Spotify track ID
            const trackMatch = url.match(/track\/([a-zA-Z0-9]+)/);
            if (!trackMatch) {
                throw new Error('Could not extract track ID from Spotify URL');
            }
            
            const trackId = trackMatch[1];
            const track = await this.spotify.getTrack(trackId);
            
            return {
                title: track.body.name,
                author: track.body.artists.map(artist => artist.name).join(', '),
                duration: this.formatDuration(track.body.duration_ms),
                url: track.body.external_urls.spotify,
                thumbnail: track.body.album.images[0]?.url,
                source: 'spotify',
                type: 'track'
            };
        } catch (error) {
            console.error(`❌ Error handling Spotify URL:`, error.message);
            return null;
        }
    }

    async handleSoundCloudURL(url) {
        try {
            // Basic SoundCloud URL handling
            return {
                title: 'SoundCloud Track',
                author: 'Unknown',
                duration: '0:00',
                url: url,
                thumbnail: null,
                source: 'soundcloud',
                type: 'track'
            };
        } catch (error) {
            console.error(`❌ Error handling SoundCloud URL:`, error.message);
            return null;
        }
    }

    extractYouTubeVideoId(url) {
        const patterns = [
            /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,
            /youtube\.com\/v\/([^&\n?#]+)/,
            /youtube\.com\/watch\?.*v=([^&\n?#]+)/
        ];
        
        for (const pattern of patterns) {
            const match = url.match(pattern);
            if (match) {
                return match[1];
            }
        }
        
        return null;
    }

    formatDuration(durationMs) {
        const minutes = Math.floor(durationMs / 60000);
        const seconds = Math.floor((durationMs % 60000) / 1000);
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }

    async search(query, limit = 10) {
        const results = [];
        
        if (this.isURL(query)) {
            const track = await this.handleURL(query);
            if (track) results.push(track);
        } else {
            // Search Spotify, YouTube, and SoundCloud with network error handling
            console.log(`🔍 Starting search for: ${query}`);
            const searches = await Promise.allSettled([
                this.searchSpotify(query, limit),
                this.searchYouTube(query, limit),
                this.searchSoundCloud(query, limit)
            ]);

            let hasNetworkErrors = false;
            for (const search of searches) {
                if (search.status === 'fulfilled' && search.value) {
                    results.push(...search.value);
                } else if (search.status === 'rejected') {
                    const error = search.reason;
                    if (error.code === 'ENOTFOUND' || error.code === 'ECONNRESET' || 
                        error.message.includes('network') || error.message.includes('timeout')) {
                        hasNetworkErrors = true;
                    }
                    console.log(`⚠️ Search method failed: ${error.message}`);
                }
            }
            
            // If we have network errors and no results, throw a specific network error
            if (hasNetworkErrors && results.length === 0) {
                throw new Error('NETWORK_ERROR: Unable to connect to music services. This is usually temporary - please try again in a moment.');
            }
        }

        // Rank results by relevance and source preference
        const rankedResults = this.rankSearchResults(results, query);
        return this.removeDuplicates(rankedResults).slice(0, limit);
    }

    rankSearchResults(results, query) {
        const queryLower = query.toLowerCase();
        
        return results.map(result => {
            let score = 0;
            const titleLower = result.title.toLowerCase();
            const authorLower = result.author.toLowerCase();
            
            // Exact title match
            if (titleLower === queryLower) score += 100;
            else if (titleLower.includes(queryLower)) score += 50;
            
            // Author relevance
            if (authorLower.includes(queryLower)) score += 30;
            
            // Source preference (YouTube > Spotify > SoundCloud)
            if (result.source === 'youtube') score += 20;
            else if (result.source === 'spotify') score += 15;
            else if (result.source === 'soundcloud') score += 10;
            
            // View count bonus for YouTube
            if (result.viewCount) {
                score += Math.min(result.viewCount / 1000000, 10); // Max 10 points for views
            }
            
            return { ...result, relevanceScore: score };
        }).sort((a, b) => b.relevanceScore - a.relevanceScore);
    }

    removeDuplicates(results) {
        const seen = new Set();
        return results.filter(result => {
            const key = `${result.title.toLowerCase()}-${result.author.toLowerCase()}`;
            if (seen.has(key)) {
                return false;
            }
            seen.add(key);
            return true;
        });
    }

    async searchYouTube(query, limit = 5) {
        try {
            // Try YouTube-SR first with timeout and retry logic
            console.log(`🔍 YouTube-SR search for: ${query}`);
            
            const searchPromise = YouTube.search(query, { 
                limit: limit,
                type: 'video',
                safeSearch: false
            });
            
            // Add timeout to prevent hanging
            const youtubeResults = await Promise.race([
                searchPromise,
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('YouTube search timeout after 10 seconds')), 10000)
                )
            ]);
            
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
            if (error.message.includes('timeout') || error.code === 'ETIMEDOUT') {
                console.log(`⏱️ YouTube search timed out for: ${query} - this is usually temporary`);
            } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNRESET' || error.message.includes('network')) {
                console.log(`🌐 Network connectivity issue during YouTube search: ${error.message}`);
            } else if (error.message.includes('429') || error.message.includes('rate limit')) {
                console.log(`🚫 YouTube rate limit hit - searches may be temporarily restricted`);
            } else {
                console.error('❌ All YouTube search methods failed:', error.message);
            }
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
        
        // Define streaming methods prioritizing anti-403 methods
        const streamingMethods = hasYtDlp ? [
            // Anti-403 yt-dlp method with proxy-like behavior
            {
                name: 'yt-dlp-anti-403',
                priority: 1,
                method: () => this.getStreamWithAnti403(track),
                cooldown: 1000,
                maxFailures: 3
            },
            // HLS stream handler as backup method
            {
                name: 'hls-stream',
                priority: 2,
                method: () => this.getStreamWithHLS(track),
                cooldown: 2000,
                maxFailures: 3
            },
            // Robust fallback using direct yt-dlp streaming
            {
                name: 'robust-fallback',
                priority: 3,
                method: () => this.getStreamWithRobustFallback(track),
                cooldown: 1500,
                maxFailures: 3
            },
            // Multiple format attempt
            {
                name: 'multi-format',
                priority: 4,
                method: () => this.getStreamWithMultiFormat(track),
                cooldown: 1000,
                maxFailures: 2
            },
            // Spotify enhanced search (better for Spotify tracks)
            {
                name: 'spotify-enhanced',
                priority: 5,
                method: () => this.getStreamWithSpotifyFallback(track),
                cooldown: 1000,
                maxFailures: 2
            },
            // ytdl-core with enhanced configuration
            {
                name: 'ytdl-core-enhanced',
                priority: 6,
                method: () => this.getStreamWithYtdlCore(track),
                cooldown: 3000,
                maxFailures: 2
            }
        ] : [
            // Fallback methods when yt-dlp is not available
            {
                name: 'spotify-enhanced',
                priority: 1,
                method: () => this.getStreamWithSpotifyFallback(track),
                cooldown: 1000,
                maxFailures: 2
            },
            {
                name: 'ytdl-core-enhanced',
                priority: 2,
                method: () => this.getStreamWithYtdlCore(track),
                cooldown: 2000,
                maxFailures: 2
            },
            {
                name: 'play-dl-legacy',
                priority: 3,
                method: () => this.getStreamWithPlayDl(track),
                cooldown: 3000,
                maxFailures: 1
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
                
                console.log(`✅ yt-dlp fallback found URL: ${directUrl.substring(0, 80)}...`);
                
                // Handle HLS manifests properly instead of rejecting them
                if (directUrl.includes('m3u8') || directUrl.includes('hls_playlist') || directUrl.includes('manifest')) {
                    console.log(`🔄 yt-dlp returned HLS manifest - using HLS handler`);
                    try {
                        const hlsStream = await this.createHLSStream(directUrl);
                        resolve(hlsStream);
                        return;
                    } catch (hlsError) {
                        console.log(`❌ HLS handling failed: ${hlsError.message}`);
                        reject(hlsError);
                        return;
                    }
                }
                
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
    
    async getStreamWithRobustFallback(track) {
        console.log(`⚡ Trying robust fallback streaming for: ${track.title}`);
        
        let youtubeUrl = track.url;
        if (track.source === 'spotify') {
            const searchQuery = `${track.title} ${track.author} audio`;
            const searchResults = await this.searchYouTube(searchQuery, 1);
            if (searchResults.length === 0) {
                throw new Error('No YouTube equivalent found');
            }
            youtubeUrl = searchResults[0].url;
        }
        
        // Direct yt-dlp streaming with anti-403 options
        return new Promise((resolve, reject) => {
            const ytDlpArgs = [
                '--format', 'bestaudio[ext=m4a]/bestaudio[acodec=aac]/bestaudio/best',
                '--output', '-',
                '--quiet',
                '--no-warnings',
                '--no-playlist',
                '--user-agent', this.getRandomUserAgent(),
                '--referer', 'https://www.youtube.com/',
                '--add-header', 'Accept:*/*',
                '--add-header', 'Accept-Language:en-US,en;q=0.9',
                youtubeUrl
            ];
            
            console.log(`🔄 Robust fallback: yt-dlp ${ytDlpArgs.join(' ')}`);
            const ytDlp = spawn('yt-dlp', ytDlpArgs);
            
            // Create a PassThrough stream for the audio data
            const audioStream = new PassThrough();
            
            let hasData = false;
            let dataReceived = 0;
            
            ytDlp.stdout.on('data', (chunk) => {
                dataReceived += chunk.length;
                if (!hasData) {
                    hasData = true;
                    console.log('✅ Robust fallback streaming data received');
                    resolve(audioStream);
                }
                audioStream.write(chunk);
            });
            
            ytDlp.stdout.on('end', () => {
                console.log(`📡 Robust fallback stream ended after ${dataReceived} bytes`);
                audioStream.end();
            });
            
            ytDlp.stderr.on('data', (data) => {
                const error = data.toString();
                // Only log errors, don't reject on warnings
                if (error.includes('ERROR') || error.includes('403')) {
                    console.log(`❌ Robust fallback error: ${error.substring(0, 150)}...`);
                    if (!hasData) {
                        reject(new Error(`Robust fallback failed: ${error}`));
                    }
                } else if (error.includes('WARNING')) {
                    console.log(`⚠️ Robust fallback warning: ${error.substring(0, 100)}...`);
                }
            });
            
            ytDlp.on('close', (code) => {
                if (!hasData && code !== 0) {
                    console.log(`❌ Robust fallback closed without data, code: ${code}`);
                    reject(new Error(`Robust fallback failed with code: ${code}`));
                } else if (code === 0 && hasData) {
                    console.log(`✅ Robust fallback completed successfully`);
                }
            });
            
            ytDlp.on('error', (error) => {
                console.log(`❌ Robust fallback spawn error: ${error.message}`);
                reject(new Error(`Robust fallback process error: ${error.message}`));
            });
            
            // Add timeout
            setTimeout(() => {
                if (!hasData) {
                    ytDlp.kill();
                    reject(new Error('Robust fallback timeout after 20 seconds'));
                }
            }, 20000);
        });
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
        
        // Basic URL validation for play-dl
        if (!youtubeUrl || typeof youtubeUrl !== 'string') {
            throw new Error(`Invalid URL provided to play-dl: ${youtubeUrl}`);
        }

        // Skip play-dl validation as it's too restrictive - let play.stream handle the validation

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
        console.log(`⚡ Trying ytdl-core with enhanced configuration for: ${track.title}`);
        
        let youtubeUrl = track.url;
        if (track.source === 'spotify') {
            const searchQuery = `${track.title} ${track.author} audio`;
            const searchResults = await this.searchYouTube(searchQuery, 1);
            if (searchResults.length === 0) {
                throw new Error('No YouTube equivalent found');
            }
            youtubeUrl = searchResults[0].url;
        }
        
        // Multiple configuration attempts with aggressive anti-detection
        const configOptions = [
            // Primary: Randomized modern Chrome with full headers
            {
                filter: 'audioonly',
                quality: 'lowestaudio',
                requestOptions: {
                    headers: {
                        'User-Agent': this.getRandomUserAgent(),
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
                        'Accept-Language': 'en-US,en;q=0.9',
                        'Accept-Encoding': 'gzip, deflate, br',
                        'DNT': '1',
                        'Connection': 'keep-alive',
                        'Upgrade-Insecure-Requests': '1',
                        'Sec-Fetch-Dest': 'document',
                        'Sec-Fetch-Mode': 'navigate',
                        'Sec-Fetch-Site': 'none',
                        'Sec-Fetch-User': '?1',
                        'Cache-Control': 'max-age=0',
                        'sec-ch-ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
                        'sec-ch-ua-mobile': '?0',
                        'sec-ch-ua-platform': '"Windows"'
                    }
                }
            },
            // Fallback: Different Chrome version
            {
                filter: 'audioonly',
                quality: 'lowestaudio',  
                requestOptions: {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
                        'Accept': '*/*',
                        'Accept-Language': 'en-US,en;q=0.8',
                        'Referer': 'https://www.youtube.com/',
                        'Origin': 'https://www.youtube.com'
                    }
                }
            },
            // Mobile fallback
            {
                filter: 'audioonly',
                quality: 'lowestaudio',  
                requestOptions: {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
                    }
                }
            },
            // Final fallback: Basic configuration
            {
                filter: 'audioonly',
                quality: 'lowestaudio'
            }
        ];
        
        for (let i = 0; i < configOptions.length; i++) {
            try {
                console.log(`🔄 ytdl-core attempt ${i + 1}/${configOptions.length} for: ${youtubeUrl}`);
                
                // Add random delay to avoid detection (500-2000ms)
                const delay = 500 + Math.random() * 1500;
                await new Promise(resolve => setTimeout(resolve, delay));
                
                const stream = ytdl(youtubeUrl, configOptions[i]);
                
                // Wait for stream to be ready with shorter timeout
                const result = await new Promise((resolve, reject) => {
                    const timeout = setTimeout(() => {
                        stream.destroy();
                        reject(new Error(`ytdl-core timeout on attempt ${i + 1}`));
                    }, 10000);
                    
                    stream.on('info', (info) => {
                        clearTimeout(timeout);
                        console.log(`✅ ytdl-core success on attempt ${i + 1}: ${info.videoDetails.title}`);
                        resolve(stream);
                    });
                    
                    stream.on('error', (error) => {
                        clearTimeout(timeout);
                        reject(error);
                    });
                });
                
                return result;
                
            } catch (error) {
                console.log(`❌ ytdl-core attempt ${i + 1} failed: ${error.message}`);
                
                // Special handling for 403 errors
                if (error.message.includes('403') || error.message.includes('Forbidden') || error.message.includes('Status code: 403')) {
                    console.log('🔄 Got 403 error, trying alternative video sources');
                    
                    // Try to find alternative videos for the same track
                    try {
                        const alternativeTrack = await this.findAlternativeYouTubeVideo(track);
                        if (alternativeTrack && alternativeTrack.url !== track.url) {
                            console.log(`🔄 Attempting with alternative video: ${alternativeTrack.title}`);
                            return await this.getStreamWithYtdlCore(alternativeTrack);
                        }
                    } catch (altError) {
                        console.log(`⚠️ Alternative video search failed: ${altError.message}`);
                    }
                }
                
                if (i === configOptions.length - 1) {
                    // All attempts failed, try HLS fallback
                    console.log('🔄 All ytdl-core attempts failed, trying HLS fallback');
                    return await this.getStreamWithHLS(track);
                }
                // Wait before next attempt with exponential backoff
                const waitTime = 1000 * (i + 1);
                await new Promise(resolve => setTimeout(resolve, waitTime));
            }
        }
    }

    async getStreamWithHLS(track) {
        console.log(`⚡ Trying HLS stream handler for: ${track.title}`);
        
        let youtubeUrl = track.url;
        if (track.source === 'spotify') {
            const searchQuery = `${track.title} ${track.author} audio`;
            const searchResults = await this.searchYouTube(searchQuery, 1);
            if (searchResults.length === 0) {
                throw new Error('No YouTube equivalent found');
            }
            youtubeUrl = searchResults[0].url;
        }
        
        // Use yt-dlp to get HLS manifest and convert it to a streamable format
        return new Promise((resolve, reject) => {
            const ytDlpArgs = [
                '--format', 'bestaudio[ext=m4a]/bestaudio/best',
                '--get-url',
                '--no-playlist',
                '--quiet',
                '--user-agent', this.getRandomUserAgent(),
                '--referer', 'https://www.youtube.com/',
                '--add-header', 'Accept:*/*',
                '--add-header', 'Accept-Language:en-US,en;q=0.9',
                youtubeUrl
            ];
            
            console.log(`🔄 HLS handler: yt-dlp ${ytDlpArgs.join(' ')}`);
            const ytDlp = spawn('yt-dlp', ytDlpArgs);
            
            let directUrl = '';
            let errorOutput = '';
            
            ytDlp.stdout.on('data', (data) => {
                directUrl += data.toString();
            });
            
            ytDlp.stderr.on('data', (data) => {
                errorOutput += data.toString();
            });
            
            ytDlp.on('close', async (code) => {
                if (code === 0 && directUrl.trim()) {
                    const url = directUrl.trim();
                    console.log(`✅ HLS handler got direct URL: ${url.substring(0, 80)}...`);
                    
                    try {
                        // Create a streaming pipeline for HLS content
                        const hlsStream = await this.createHLSStream(url);
                        resolve(hlsStream);
                    } catch (streamError) {
                        console.log(`❌ HLS stream creation failed: ${streamError.message}`);
                        reject(streamError);
                    }
                } else {
                    const errorMsg = errorOutput || `HLS handler failed with code: ${code}`;
                    console.log(`❌ HLS handler error: ${errorMsg}`);
                    reject(new Error(errorMsg));
                }
            });
            
            ytDlp.on('error', (error) => {
                console.log(`❌ HLS handler spawn error: ${error.message}`);
                reject(new Error(`HLS handler process error: ${error.message}`));
            });
            
            // Add timeout
            setTimeout(() => {
                ytDlp.kill();
                reject(new Error('HLS handler timeout after 30 seconds'));
            }, 30000);
        });
    }
    
    async createHLSStream(url) {
        console.log(`🔄 Creating HLS stream from: ${url.substring(0, 80)}...`);
        
        // Check if this is an HLS manifest URL
        if (url.includes('manifest') || url.includes('m3u8')) {
            console.log('🔄 Detected HLS manifest - using yt-dlp direct streaming instead');
            
            // For HLS manifests, use yt-dlp to handle the streaming directly
            return new Promise((resolve, reject) => {
                const ytDlpArgs = [
                    '--format', 'bestaudio',
                    '--output', '-',
                    '--quiet',
                    '--no-warnings',
                    '--user-agent', this.getRandomUserAgent(),
                    '--referer', 'https://www.youtube.com/',
                    url // Use the manifest URL directly
                ];
                
                console.log(`🔄 HLS direct streaming: yt-dlp ${ytDlpArgs.slice(0, 4).join(' ')} [manifest-url]`);
                const ytDlp = spawn('yt-dlp', ytDlpArgs);
                
                // Create PassThrough stream for the audio data
                const audioStream = new PassThrough();
                
                let hasData = false;
                let dataReceived = 0;
                
                ytDlp.stdout.on('data', (chunk) => {
                    dataReceived += chunk.length;
                    if (!hasData) {
                        hasData = true;
                        console.log('✅ HLS stream data flowing');
                        resolve(audioStream);
                    }
                    audioStream.write(chunk);
                });
                
                ytDlp.stdout.on('end', () => {
                    console.log(`📡 HLS stream ended after ${dataReceived} bytes`);
                    audioStream.end();
                });
                
                ytDlp.stderr.on('data', (data) => {
                    const error = data.toString();
                    if (!hasData && (error.includes('ERROR') || error.includes('403'))) {
                        console.log(`❌ HLS stream error: ${error.substring(0, 100)}...`);
                        reject(new Error(`HLS streaming failed: ${error}`));
                    }
                });
                
                ytDlp.on('close', (code) => {
                    if (!hasData && code !== 0) {
                        console.log(`❌ HLS stream closed without data, code: ${code}`);
                        reject(new Error(`HLS streaming failed with code: ${code}`));
                    }
                });
                
                ytDlp.on('error', (error) => {
                    console.log(`❌ HLS stream spawn error: ${error.message}`);
                    reject(new Error(`HLS process error: ${error.message}`));
                });
                
                // Longer timeout for HLS streams
                setTimeout(() => {
                    if (!hasData) {
                        ytDlp.kill();
                        reject(new Error('HLS stream timeout after 30 seconds'));
                    }
                }, 30000);
            });
        }
        
        // For direct URLs, use the original fetch approach with anti-403 measures
        const requestConfigs = [
            {
                headers: {
                    'User-Agent': this.getRandomUserAgent(),
                    'Accept': '*/*',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Accept-Encoding': 'identity',
                    'Range': 'bytes=0-',
                    'Referer': 'https://www.youtube.com/',
                    'Origin': 'https://www.youtube.com'
                }
            },
            {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
                    'Accept': 'audio/*,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.8'
                }
            }
        ];
        
        for (let i = 0; i < requestConfigs.length; i++) {
            try {
                console.log(`🔄 Direct stream attempt ${i + 1}/${requestConfigs.length}`);
                
                const response = await fetch(url, {
                    ...requestConfigs[i],
                    timeout: 15000
                });
                
                if (response.status === 403) {
                    console.log(`❌ Direct stream attempt ${i + 1} got 403`);
                    continue;
                }
                
                if (!response.ok) {
                    throw new Error(`Direct stream fetch failed: ${response.status}`);
                }
                
                console.log(`✅ Direct stream response received: ${response.status}`);
                
                const passThrough = new PassThrough();
                response.body.pipe(passThrough);
                
                response.body.on('error', (error) => {
                    console.error('❌ Direct stream body error:', error.message);
                    passThrough.destroy(error);
                });
                
                return passThrough;
                
            } catch (error) {
                console.log(`❌ Direct stream attempt ${i + 1} failed: ${error.message}`);
                if (i === requestConfigs.length - 1) {
                    throw error;
                }
            }
        }
    }

    async getStreamWithSpotifyFallback(track) {
        console.log(`⚡ Trying Spotify enhanced fallback for: ${track.title}`);
        
        // For Spotify tracks, use enhanced search techniques
        if (track.source === 'spotify') {
            console.log('🎵 Spotify track detected - using enhanced YouTube search');
            
            try {
                // Try multiple search strategies for better matches
                const searchStrategies = [
                    // Strategy 1: Exact title + artist
                    `"${track.title}" "${track.author}"`,
                    // Strategy 2: Title + artist + audio
                    `${track.title} ${track.author} audio`,
                    // Strategy 3: Title + artist + official
                    `${track.title} ${track.author} official`,
                    // Strategy 4: Title + artist + lyrics
                    `${track.title} ${track.author} lyrics`,
                    // Strategy 5: Just title + artist (basic)
                    `${track.title} ${track.author}`
                ];
                
                for (const [index, searchQuery] of searchStrategies.entries()) {
                    try {
                        console.log(`🔍 Spotify strategy ${index + 1}: "${searchQuery}"`);
                        
                        const searchResults = await this.searchYouTube(searchQuery, 3);
                        if (searchResults.length === 0) {
                            continue;
                        }
                        
                        // Filter and rank results based on title similarity and duration
                        const bestMatch = this.findBestSpotifyMatch(track, searchResults);
                        if (bestMatch) {
                            console.log(`✅ Found good Spotify match: ${bestMatch.title}`);
                            
                            // Try to stream the best match
                            const enhancedTrack = {
                                ...track,
                                url: bestMatch.url,
                                youtubeTitle: bestMatch.title,
                                source: 'youtube' // Convert to YouTube source for streaming
                            };
                            
                            return await this.getStreamWithYtdlCore(enhancedTrack);
                        }
                        
                    } catch (searchError) {
                        console.log(`❌ Spotify search strategy ${index + 1} failed: ${searchError.message}`);
                        continue;
                    }
                }
                
                // If all enhanced search fails, fall back to basic search
                console.log('🔄 Enhanced search failed, trying basic YouTube search');
                const basicResults = await this.searchYouTube(`${track.title} ${track.author}`, 1);
                if (basicResults.length > 0) {
                    const basicTrack = {
                        ...track,
                        url: basicResults[0].url,
                        source: 'youtube'
                    };
                    return await this.getStreamWithYtdlCore(basicTrack);
                }
                
            } catch (error) {
                console.log(`❌ Spotify fallback error: ${error.message}`);
                throw error;
            }
        }
        
        // For non-Spotify tracks, just use regular streaming
        return await this.getStreamWithYtdlCore(track);
    }
    
    findBestSpotifyMatch(originalTrack, searchResults) {
        console.log(`🎯 Finding best match for: "${originalTrack.title}" by "${originalTrack.author}"`);
        
        let bestMatch = null;
        let highestScore = 0;
        
        for (const result of searchResults) {
            let score = 0;
            
            // Title similarity (most important)
            const titleSimilarity = this.checkTitleSimilarity(originalTrack.title, result.title);
            score += titleSimilarity * 40;
            
            // Author similarity
            if (originalTrack.author && result.author) {
                const authorSimilarity = this.checkTitleSimilarity(originalTrack.author, result.author);
                score += authorSimilarity * 30;
            }
            
            // Duration similarity (if available)
            if (originalTrack.duration && result.duration) {
                const originalDuration = this.parseDuration(originalTrack.duration);
                const resultDuration = this.parseDuration(result.duration);
                
                if (originalDuration && resultDuration) {
                    const durationDiff = Math.abs(originalDuration - resultDuration);
                    const durationSimilarity = Math.max(0, 1 - (durationDiff / Math.max(originalDuration, resultDuration)));
                    score += durationSimilarity * 20;
                }
            }
            
            // Prefer official/verified sources
            if (result.title.toLowerCase().includes('official')) {
                score += 5;
            }
            
            // Prefer higher quality indicators
            if (result.title.toLowerCase().includes('hd') || result.title.toLowerCase().includes('hq')) {
                score += 3;
            }
            
            // Avoid remixes, covers, live versions for original tracks
            const avoidTerms = ['remix', 'cover', 'live', 'karaoke', 'instrumental'];
            const hasAvoidTerm = avoidTerms.some(term => 
                result.title.toLowerCase().includes(term) && 
                !originalTrack.title.toLowerCase().includes(term)
            );
            if (hasAvoidTerm) {
                score -= 15;
            }
            
            console.log(`📊 "${result.title}": Score ${score.toFixed(2)}`);
            
            if (score > highestScore && score > 30) { // Minimum threshold
                highestScore = score;
                bestMatch = result;
            }
        }
        
        if (bestMatch) {
            console.log(`🎯 Best match selected: "${bestMatch.title}" (Score: ${highestScore.toFixed(2)})`);
        } else {
            console.log('❌ No suitable match found above threshold');
        }
        
        return bestMatch;
    }

    async getSpotifyStream(track) {
        console.log(`⚡ Trying Spotify direct stream for: ${track.title}`);
        
        // Note: Spotify Web API only provides 30-second previews due to licensing
        // This method serves as a fallback that tries to get better YouTube matches
        
        if (track.previewUrl) {
            console.log('🎵 Spotify preview URL available - streaming 30s preview');
            
            try {
                const response = await fetch(track.previewUrl, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    },
                    timeout: 10000
                });
                
                if (!response.ok) {
                    throw new Error(`Preview fetch failed: ${response.status}`);
                }
                
                console.log('✅ Spotify preview stream created (30s)');
                
                // Create a PassThrough stream for the preview
                const passThrough = new PassThrough();
                response.body.pipe(passThrough);
                
                return passThrough;
                
            } catch (error) {
                console.log(`❌ Spotify preview failed: ${error.message}`);
                // Fall through to enhanced search
            }
        }
        
        // If no preview or preview failed, use enhanced search
        console.log('🔄 No preview available, using enhanced YouTube search');
        return await this.getStreamWithSpotifyFallback(track);
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
        
        // Try different search strategies with better filtering
        const searchStrategies = [
            `${originalTrack.title} ${originalTrack.author} audio`,
            `${originalTrack.title} ${originalTrack.author} song`,
            `${originalTrack.title} ${originalTrack.author} official`,
            `"${originalTrack.title}" ${originalTrack.author}`, // Exact title match
            `${originalTrack.author} - ${originalTrack.title}`, // Artist - Song format
        ];
        
        for (const searchQuery of searchStrategies) {
            try {
                console.log(`🔍 Emergency search: ${searchQuery}`);
                const results = await this.searchYouTube(searchQuery, 3);
                
                for (const result of results) {
                    // Skip the original URL to avoid infinite loops
                    if (result.url !== originalTrack.url) {
                        // Basic relevance check to avoid completely unrelated videos
                        const titleSimilarity = this.checkTitleSimilarity(originalTrack.title, result.title);
                        const authorSimilarity = this.checkAuthorSimilarity(originalTrack.author, result.author);
                        
                        if (titleSimilarity > 0.3 || authorSimilarity > 0.5) {
                            console.log(`✅ Found relevant alternative: ${result.title} by ${result.author} (title: ${titleSimilarity.toFixed(2)}, author: ${authorSimilarity.toFixed(2)})`);
                            return {
                                ...result,
                                source: 'youtube'
                            };
                        } else {
                            console.log(`⚠️ Skipping unrelated result: ${result.title} by ${result.author}`);
                        }
                    }
                }
            } catch (searchError) {
                console.log(`⚠️ Emergency search failed for "${searchQuery}": ${searchError.message}`);
                continue;
            }
        }
        
        return null;
    }

    checkTitleSimilarity(originalTitle, resultTitle) {
        if (!originalTitle || !resultTitle) return 0;
        
        const orig = originalTitle.toLowerCase().replace(/[^\w\s]/g, '');
        const result = resultTitle.toLowerCase().replace(/[^\w\s]/g, '');
        
        // Check for common words
        const origWords = orig.split(/\s+/).filter(w => w.length > 2);
        const resultWords = result.split(/\s+/).filter(w => w.length > 2);
        
        if (origWords.length === 0) return 0;
        
        let matches = 0;
        for (const word of origWords) {
            if (resultWords.some(rw => rw.includes(word) || word.includes(rw))) {
                matches++;
            }
        }
        
        return matches / origWords.length;
    }

    checkAuthorSimilarity(originalAuthor, resultAuthor) {
        if (!originalAuthor || !resultAuthor) return 0;
        
        const orig = originalAuthor.toLowerCase().replace(/[^\w\s]/g, '');
        const result = resultAuthor.toLowerCase().replace(/[^\w\s]/g, '');
        
        if (orig === result) return 1.0;
        if (result.includes(orig) || orig.includes(result)) return 0.8;
        
        // Check for common words in artist names
        const origWords = orig.split(/\s+/).filter(w => w.length > 1);
        const resultWords = result.split(/\s+/).filter(w => w.length > 1);
        
        if (origWords.length === 0) return 0;
        
        let matches = 0;
        for (const word of origWords) {
            if (resultWords.includes(word)) {
                matches++;
            }
        }
        
        return matches / origWords.length;
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

    async getStreamWithAnti403(track) {
        console.log(`⚡ Trying anti-403 method for: ${track.title}`);
        
        let youtubeUrl = track.url;
        if (track.source === 'spotify') {
            const searchQuery = `${track.title} ${track.author} audio`;
            const searchResults = await this.searchYouTube(searchQuery, 1);
            if (searchResults.length === 0) {
                throw new Error('No YouTube equivalent found');
            }
            youtubeUrl = searchResults[0].url;
        }
        
        // Use yt-dlp with aggressive anti-detection measures
        return new Promise((resolve, reject) => {
            const ytDlpArgs = [
                '--format', 'bestaudio[ext=m4a]/bestaudio[acodec!=opus]/bestaudio',
                '--output', '-',
                '--quiet',
                '--no-warnings',
                '--no-playlist',
                '--extract-flat', 'false',
                '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                '--referer', 'https://www.youtube.com/',
                '--add-header', 'Accept:*/*',
                '--add-header', 'Accept-Language:en-US,en;q=0.9',
                '--add-header', 'Accept-Encoding:gzip, deflate, br',
                '--add-header', 'Connection:keep-alive',
                '--add-header', 'Upgrade-Insecure-Requests:1',
                '--add-header', 'Sec-Fetch-Dest:document',
                '--add-header', 'Sec-Fetch-Mode:navigate',
                '--add-header', 'Sec-Fetch-Site:none',
                '--add-header', 'Cache-Control:max-age=0',
                '--socket-timeout', '30',
                '--retries', '3',
                youtubeUrl
            ];
            
            console.log(`🔄 Anti-403: Starting yt-dlp with enhanced headers`);
            const ytDlp = spawn('yt-dlp', ytDlpArgs);
            
            // Create a PassThrough stream for the audio data
            const audioStream = new PassThrough({
                highWaterMark: 1024 * 1024 // 1MB buffer
            });
            
            let hasData = false;
            let dataReceived = 0;
            let errorOutput = '';
            
            ytDlp.stdout.on('data', (chunk) => {
                dataReceived += chunk.length;
                if (!hasData) {
                    hasData = true;
                    console.log('✅ Anti-403 streaming data received');
                    resolve(audioStream);
                }
                audioStream.write(chunk);
            });
            
            ytDlp.stdout.on('end', () => {
                console.log(`📡 Anti-403 stream ended after ${dataReceived} bytes`);
                audioStream.end();
            });
            
            ytDlp.stderr.on('data', (data) => {
                errorOutput += data.toString();
                const error = data.toString();
                if (error.includes('ERROR') || error.includes('403') || error.includes('Forbidden')) {
                    console.log(`❌ Anti-403 error: ${error.substring(0, 150)}...`);
                    if (!hasData) {
                        reject(new Error(`Anti-403 failed: ${error}`));
                    }
                }
            });
            
            ytDlp.on('close', (code) => {
                if (!hasData && code !== 0) {
                    console.log(`❌ Anti-403 closed without data, code: ${code}`);
                    reject(new Error(`Anti-403 failed with code: ${code}, error: ${errorOutput}`));
                } else if (code === 0 && hasData) {
                    console.log(`✅ Anti-403 completed successfully`);
                }
            });
            
            ytDlp.on('error', (error) => {
                console.log(`❌ Anti-403 spawn error: ${error.message}`);
                reject(new Error(`Anti-403 process error: ${error.message}`));
            });
            
            // Add timeout
            setTimeout(() => {
                if (!hasData) {
                    ytDlp.kill('SIGKILL');
                    reject(new Error('Anti-403 timeout after 25 seconds'));
                }
            }, 25000);
        });
    }

    async getStreamWithMultiFormat(track) {
        console.log(`⚡ Trying multi-format method for: ${track.title}`);
        
        let youtubeUrl = track.url;
        if (track.source === 'spotify') {
            const searchQuery = `${track.title} ${track.author} audio`;
            const searchResults = await this.searchYouTube(searchQuery, 1);
            if (searchResults.length === 0) {
                throw new Error('No YouTube equivalent found');
            }
            youtubeUrl = searchResults[0].url;
        }
        
        // Try multiple format priorities to avoid 403 errors
        const formatStrategies = [
            'bestaudio[protocol!=m3u8][protocol!=hls]/best[protocol!=m3u8][protocol!=hls]',
            'bestaudio[ext=m4a][protocol!=m3u8]/bestaudio[ext=webm][protocol!=m3u8]/bestaudio[protocol!=m3u8]',
            'worst[protocol!=m3u8][protocol!=hls]/worstaudio[protocol!=m3u8][protocol!=hls]',
            'bestaudio/best'
        ];
        
        for (const [index, formatString] of formatStrategies.entries()) {
            try {
                console.log(`🔄 Multi-format attempt ${index + 1}/${formatStrategies.length}: ${formatString}`);
                
                const stream = await new Promise((resolve, reject) => {
                    const ytDlpArgs = [
                        '--format', formatString,
                        '--output', '-',
                        '--quiet',
                        '--no-warnings',
                        '--no-playlist',
                        '--user-agent', this.getRandomUserAgent(),
                        '--referer', 'https://www.youtube.com/',
                        '--socket-timeout', '20',
                        '--retries', '2',
                        youtubeUrl
                    ];
                    
                    const ytDlp = spawn('yt-dlp', ytDlpArgs);
                    const audioStream = new PassThrough();
                    
                    let hasData = false;
                    let errorOutput = '';
                    
                    ytDlp.stdout.on('data', (chunk) => {
                        if (!hasData) {
                            hasData = true;
                            console.log(`✅ Multi-format ${index + 1} streaming`);
                            resolve(audioStream);
                        }
                        audioStream.write(chunk);
                    });
                    
                    ytDlp.stdout.on('end', () => {
                        audioStream.end();
                    });
                    
                    ytDlp.stderr.on('data', (data) => {
                        errorOutput += data.toString();
                        if (!hasData && data.toString().includes('ERROR')) {
                            reject(new Error(`Multi-format ${index + 1} error: ${data.toString()}`));
                        }
                    });
                    
                    ytDlp.on('close', (code) => {
                        if (!hasData && code !== 0) {
                            reject(new Error(`Multi-format ${index + 1} failed: ${errorOutput}`));
                        }
                    });
                    
                    ytDlp.on('error', (error) => {
                        reject(new Error(`Multi-format ${index + 1} spawn error: ${error.message}`));
                    });
                    
                    setTimeout(() => {
                        if (!hasData) {
                            ytDlp.kill();
                            reject(new Error(`Multi-format ${index + 1} timeout`));
                        }
                    }, 15000);
                });
                
                return stream;
                
            } catch (error) {
                console.log(`❌ Multi-format attempt ${index + 1} failed: ${error.message}`);
                if (index === formatStrategies.length - 1) {
                    throw error;
                }
                // Wait before next attempt
                await new Promise(resolve => setTimeout(resolve, 1000));
                continue;
            }
        }
    }
}

module.exports = SourceHandlers;
