const axios = require('axios');

class AdvancedSearchService {
    constructor() {
        this.searchEngines = {
            youtube: {
                name: 'YouTube',
                priority: 1,
                enabled: true
            },
            spotify: {
                name: 'Spotify',
                priority: 2,
                enabled: !!process.env.SPOTIFY_CLIENT_ID
            },
            soundcloud: {
                name: 'SoundCloud',
                priority: 3,
                enabled: true
            }
        };
        
        this.searchHistory = new Map();
        this.searchCache = new Map();
        this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
        
        // Search filters
        this.filters = {
            duration: {
                short: { min: 0, max: 4 * 60 }, // 0-4 minutes
                medium: { min: 4 * 60, max: 10 * 60 }, // 4-10 minutes
                long: { min: 10 * 60, max: Infinity } // 10+ minutes
            },
            quality: ['low', 'medium', 'high', 'highest'],
            source: ['youtube', 'spotify', 'soundcloud', 'all']
        };
        
        this.initSpotifyAuth();
    }
    
    async initSpotifyAuth() {
        if (!process.env.SPOTIFY_CLIENT_ID || !process.env.SPOTIFY_CLIENT_SECRET) {
            return;
        }
        
        try {
            const response = await axios.post('https://accounts.spotify.com/api/token', 
                'grant_type=client_credentials', {
                headers: {
                    'Authorization': `Basic ${Buffer.from(`${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`).toString('base64')}`,
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            });
            
            this.spotifyToken = response.data.access_token;
            this.spotifyTokenExpiry = Date.now() + (response.data.expires_in * 1000);
            console.log('✅ Spotify API authenticated for enhanced search');
        } catch (error) {
            console.warn('⚠️ Spotify API authentication failed:', error.message);
        }
    }
    
    // Fuzzy string matching
    fuzzyMatch(needle, haystack, threshold = 0.6) {
        if (!needle || !haystack) return 0;
        
        needle = needle.toLowerCase().trim();
        haystack = haystack.toLowerCase().trim();
        
        if (needle === haystack) return 1;
        
        const matrix = [];
        const needleLen = needle.length;
        const haystackLen = haystack.length;
        
        if (needleLen === 0) return haystackLen === 0 ? 1 : 0;
        if (haystackLen === 0) return 0;
        
        for (let i = 0; i <= haystackLen; i++) {
            matrix[i] = [i];
        }
        
        for (let j = 0; j <= needleLen; j++) {
            matrix[0][j] = j;
        }
        
        for (let i = 1; i <= haystackLen; i++) {
            for (let j = 1; j <= needleLen; j++) {
                if (haystack.charAt(i - 1) === needle.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + 1,
                        matrix[i][j - 1] + 1,
                        matrix[i - 1][j] + 1
                    );
                }
            }
        }
        
        const distance = matrix[haystackLen][needleLen];
        const similarity = 1 - (distance / Math.max(needleLen, haystackLen));
        
        return similarity >= threshold ? similarity : 0;
    }
    
    // Extract search terms and apply smart matching
    parseSearchQuery(query) {
        const parsed = {
            original: query,
            terms: [],
            artist: null,
            title: null,
            filters: {
                duration: null,
                source: 'all',
                quality: 'high'
            }
        };
        
        // Extract quoted strings first
        const quotedMatches = query.match(/"([^"]+)"/g);
        if (quotedMatches) {
            quotedMatches.forEach(match => {
                const clean = match.replace(/"/g, '');
                parsed.terms.push(clean);
                query = query.replace(match, '');
            });
        }
        
        // Extract artist:title format
        const artistTitleMatch = query.match(/(.+?)\s*[-:]\s*(.+)/);
        if (artistTitleMatch) {
            parsed.artist = artistTitleMatch[1].trim();
            parsed.title = artistTitleMatch[2].trim();
        }
        
        // Extract filters
        const filterMatches = query.match(/(\w+):(\w+)/g);
        if (filterMatches) {
            filterMatches.forEach(match => {
                const [key, value] = match.split(':');
                if (parsed.filters.hasOwnProperty(key)) {
                    parsed.filters[key] = value;
                    query = query.replace(match, '');
                }
            });
        }
        
        // Add remaining terms
        const remainingTerms = query.split(/\s+/).filter(term => term.length > 0);
        parsed.terms.push(...remainingTerms);
        
        return parsed;
    }
    
    // Smart search with multiple engines
    async search(query, options = {}) {
        const {
            limit = 10,
            source = 'all',
            includeMetadata = true,
            fuzzyThreshold = 0.6
        } = options;
        
        const cacheKey = `${query}:${JSON.stringify(options)}`;
        
        // Check cache first
        if (this.searchCache.has(cacheKey)) {
            const cached = this.searchCache.get(cacheKey);
            if (Date.now() - cached.timestamp < this.cacheTimeout) {
                console.log(`🎯 Using cached search results for: ${query}`);
                return cached.results;
            }
        }
        
        const parsedQuery = this.parseSearchQuery(query);
        console.log(`🔍 Advanced search: ${query}`, parsedQuery);
        
        const results = [];
        const searchPromises = [];
        
        // YouTube search
        if (source === 'all' || source === 'youtube') {
            searchPromises.push(this.searchYouTube(parsedQuery, limit));
        }
        
        // Spotify search
        if ((source === 'all' || source === 'spotify') && this.spotifyToken) {
            searchPromises.push(this.searchSpotify(parsedQuery, limit));
        }
        
        // SoundCloud search
        if (source === 'all' || source === 'soundcloud') {
            searchPromises.push(this.searchSoundCloud(parsedQuery, limit));
        }
        
        try {
            const searchResults = await Promise.allSettled(searchPromises);
            
            searchResults.forEach(result => {
                if (result.status === 'fulfilled' && result.value) {
                    results.push(...result.value);
                }
            });
            
            // Apply fuzzy matching and scoring
            const scoredResults = this.scoreAndRankResults(results, parsedQuery, fuzzyThreshold);
            
            // Apply filters
            const filteredResults = this.applyFilters(scoredResults, parsedQuery.filters);
            
            // Enhance with metadata if requested
            const finalResults = includeMetadata ? 
                await this.enhanceWithMetadata(filteredResults.slice(0, limit)) : 
                filteredResults.slice(0, limit);
            
            // Cache results
            this.searchCache.set(cacheKey, {
                results: finalResults,
                timestamp: Date.now()
            });
            
            // Update search history
            this.updateSearchHistory(query, finalResults.length);
            
            return finalResults;
            
        } catch (error) {
            console.error('❌ Advanced search failed:', error);
            return [];
        }
    }
    
    async searchYouTube(parsedQuery, limit) {
        try {
            const ytsr = require('youtube-sr').default;
            const searchTerm = parsedQuery.artist && parsedQuery.title ? 
                `${parsedQuery.artist} ${parsedQuery.title}` : 
                parsedQuery.terms.join(' ');
                
            const results = await ytsr.search(searchTerm, { 
                limit: limit * 2, // Get more for better filtering
                type: 'video'
            });
            
            return results.map(video => ({
                id: video.id,
                title: video.title,
                artist: video.channel?.name || 'Unknown',
                duration: video.duration,
                url: video.url,
                thumbnail: video.thumbnail?.url,
                source: 'youtube',
                views: video.views,
                uploadDate: video.uploadedAt
            }));
        } catch (error) {
            console.warn('⚠️ YouTube search failed:', error.message);
            return [];
        }
    }
    
    async searchSpotify(parsedQuery, limit) {
        try {
            if (!this.spotifyToken || Date.now() >= this.spotifyTokenExpiry) {
                await this.initSpotifyAuth();
            }
            
            const searchTerm = parsedQuery.artist && parsedQuery.title ? 
                `artist:${parsedQuery.artist} track:${parsedQuery.title}` : 
                parsedQuery.terms.join(' ');
            
            const response = await axios.get('https://api.spotify.com/v1/search', {
                params: {
                    q: searchTerm,
                    type: 'track',
                    limit: limit * 2
                },
                headers: {
                    'Authorization': `Bearer ${this.spotifyToken}`
                }
            });
            
            return response.data.tracks.items.map(track => ({
                id: track.id,
                title: track.name,
                artist: track.artists.map(a => a.name).join(', '),
                duration: Math.floor(track.duration_ms / 1000),
                url: track.external_urls.spotify,
                thumbnail: track.album.images[0]?.url,
                source: 'spotify',
                album: track.album.name,
                releaseDate: track.album.release_date,
                popularity: track.popularity
            }));
        } catch (error) {
            console.warn('⚠️ Spotify search failed:', error.message);
            return [];
        }
    }
    
    async searchSoundCloud(parsedQuery, limit) {
        try {
            // SoundCloud search implementation would go here
            // For now, return empty array as SoundCloud API requires special access
            return [];
        } catch (error) {
            console.warn('⚠️ SoundCloud search failed:', error.message);
            return [];
        }
    }
    
    scoreAndRankResults(results, parsedQuery, threshold) {
        return results.map(result => {
            let score = 0;
            
            // Title matching
            if (parsedQuery.title) {
                score += this.fuzzyMatch(parsedQuery.title, result.title) * 0.4;
            }
            
            // Artist matching
            if (parsedQuery.artist) {
                score += this.fuzzyMatch(parsedQuery.artist, result.artist) * 0.3;
            }
            
            // General term matching
            parsedQuery.terms.forEach(term => {
                const titleMatch = this.fuzzyMatch(term, result.title) * 0.2;
                const artistMatch = this.fuzzyMatch(term, result.artist) * 0.1;
                score += Math.max(titleMatch, artistMatch);
            });
            
            // Source preference
            if (result.source === 'youtube') score += 0.1;
            if (result.source === 'spotify') score += 0.05;
            
            // Popularity bonus
            if (result.views) score += Math.min(result.views / 10000000, 0.1);
            if (result.popularity) score += result.popularity / 1000;
            
            return { ...result, score };
        })
        .filter(result => result.score >= threshold)
        .sort((a, b) => b.score - a.score);
    }
    
    applyFilters(results, filters) {
        return results.filter(result => {
            // Duration filter
            if (filters.duration && this.filters.duration[filters.duration]) {
                const range = this.filters.duration[filters.duration];
                if (result.duration < range.min || result.duration > range.max) {
                    return false;
                }
            }
            
            // Source filter
            if (filters.source && filters.source !== 'all') {
                if (result.source !== filters.source) {
                    return false;
                }
            }
            
            return true;
        });
    }
    
    async enhanceWithMetadata(results) {
        // Add genre, mood, and other metadata using Last.fm or other APIs
        for (const result of results) {
            try {
                if (process.env.LASTFM_API_KEY) {
                    const metadata = await this.getLastFmMetadata(result.artist, result.title);
                    Object.assign(result, metadata);
                }
            } catch (error) {
                // Metadata enhancement is optional
            }
        }
        return results;
    }
    
    async getLastFmMetadata(artist, title) {
        try {
            const response = await axios.get('http://ws.audioscrobbler.com/2.0/', {
                params: {
                    method: 'track.getInfo',
                    artist: artist,
                    track: title,
                    api_key: process.env.LASTFM_API_KEY,
                    format: 'json'
                }
            });
            
            const track = response.data.track;
            return {
                tags: track.toptags?.tag?.map(t => t.name) || [],
                playcount: parseInt(track.playcount) || 0,
                listeners: parseInt(track.listeners) || 0,
                summary: track.wiki?.summary || null
            };
        } catch (error) {
            return {};
        }
    }
    
    updateSearchHistory(query, resultCount) {
        this.searchHistory.set(query, {
            count: (this.searchHistory.get(query)?.count || 0) + 1,
            lastUsed: Date.now(),
            resultCount
        });
        
        // Keep only last 100 searches
        if (this.searchHistory.size > 100) {
            const oldest = Array.from(this.searchHistory.entries())
                .sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0];
            this.searchHistory.delete(oldest[0]);
        }
    }
    
    getSearchSuggestions(partial) {
        const suggestions = [];
        
        // Add from search history
        for (const [query, data] of this.searchHistory.entries()) {
            if (query.toLowerCase().includes(partial.toLowerCase())) {
                suggestions.push({
                    text: query,
                    type: 'history',
                    count: data.count
                });
            }
        }
        
        // Add smart suggestions
        const smartSuggestions = this.generateSmartSuggestions(partial);
        suggestions.push(...smartSuggestions);
        
        return suggestions
            .sort((a, b) => (b.count || 0) - (a.count || 0))
            .slice(0, 8);
    }
    
    generateSmartSuggestions(partial) {
        const suggestions = [];
        
        // Common music search patterns
        const patterns = [
            `${partial} remix`,
            `${partial} acoustic`,
            `${partial} live`,
            `${partial} cover`,
            `${partial} instrumental`
        ];
        
        patterns.forEach(pattern => {
            suggestions.push({
                text: pattern,
                type: 'suggestion'
            });
        });
        
        return suggestions;
    }
    
    clearCache() {
        this.searchCache.clear();
        console.log('🧹 Search cache cleared');
    }
    
    getStats() {
        return {
            cacheSize: this.searchCache.size,
            historySize: this.searchHistory.size,
            enabledEngines: Object.entries(this.searchEngines)
                .filter(([_, engine]) => engine.enabled)
                .map(([name, engine]) => ({ name, ...engine }))
        };
    }
}

module.exports = AdvancedSearchService;