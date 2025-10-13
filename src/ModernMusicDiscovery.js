const axios = require('axios');
const play = require('play-dl');

class ModernMusicDiscovery {
    constructor() {
        this.cache = new Map();
        this.cacheTTL = 10 * 60 * 1000; // 10 minutes
        
        // Alternative music discovery APIs (no auth required)
        this.apis = {
            lastfm: {
                baseUrl: 'http://ws.audioscrobbler.com/2.0/',
                key: process.env.LASTFM_API_KEY
            },
            musicbrainz: {
                baseUrl: 'https://musicbrainz.org/ws/2/',
                userAgent: 'AtiveMusicBot/1.0 (contact@yoursite.com)'
            }
        };
    }

    async discoverSimilarTracks(artist, track, limit = 10) {
        const cacheKey = `similar_${artist}_${track}`;
        const cached = this.getFromCache(cacheKey);
        if (cached) return cached;

        const recommendations = [];

        // Method 1: Last.fm similar tracks
        const lastfmTracks = await this.getLastFmSimilar(artist, track, limit);
        recommendations.push(...lastfmTracks);

        // Method 2: YouTube Music-style search
        const ytStyleTracks = await this.getYouTubeStyleRecommendations(artist, track, limit);
        recommendations.push(...ytStyleTracks);

        // Method 3: Genre-based discovery
        const genreTracks = await this.getGenreBasedRecommendations(artist, limit);
        recommendations.push(...genreTracks);

        // Deduplicate and limit
        const unique = this.deduplicateTracks(recommendations);
        const result = unique.slice(0, limit);

        this.setCache(cacheKey, result);
        return result;
    }

    async getLastFmSimilar(artist, track, limit = 10) {
        if (!this.apis.lastfm.key) return [];

        try {
            console.log('🎵 Getting Last.fm recommendations...');
            const response = await axios.get(this.apis.lastfm.baseUrl, {
                params: {
                    method: 'track.getsimilar',
                    artist: artist,
                    track: track,
                    api_key: this.apis.lastfm.key,
                    format: 'json',
                    limit: limit
                },
                timeout: 5000
            });

            if (response.data.similartracks?.track) {
                return response.data.similartracks.track.map(track => ({
                    title: track.name,
                    author: track.artist.name,
                    source: 'lastfm',
                    match: parseFloat(track.match) || 0.5
                }));
            }
        } catch (error) {
            console.log('⚠️ Last.fm similar tracks failed:', error.message);
        }

        return [];
    }

    async getYouTubeStyleRecommendations(artist, track, limit = 10) {
        try {
            console.log('🎵 Getting YouTube-style recommendations...');
            
            // Create various search queries based on the original
            const queries = [
                `${artist} similar songs`,
                `${artist} type music`,
                `songs like ${track}`,
                `${artist} radio`,
                `${artist} playlist`
            ];

            const recommendations = [];
            
            for (const query of queries.slice(0, 2)) { // Limit to 2 queries for speed
                try {
                    const results = await play.search(query, {
                        limit: 3,
                        source: { youtube: 'video' }
                    });

                    for (const result of results) {
                        if (result.type === 'video' && result.durationInSec < 600) { // Under 10 min
                            recommendations.push({
                                title: result.title,
                                author: result.channel?.name || 'Unknown',
                                url: result.url,
                                source: 'youtube_discovery',
                                duration: this.formatDuration(result.durationInSec * 1000),
                                thumbnail: result.thumbnails?.[0]?.url
                            });
                        }
                    }
                } catch (err) {
                    console.log(`⚠️ Query failed: ${query}`);
                }
            }

            return recommendations;
        } catch (error) {
            console.log('⚠️ YouTube-style recommendations failed:', error.message);
            return [];
        }
    }

    async getGenreBasedRecommendations(artist, limit = 10) {
        try {
            console.log('🎭 Getting genre-based recommendations...');
            
            // Try to get artist's top tracks
            if (this.apis.lastfm.key) {
                const response = await axios.get(this.apis.lastfm.baseUrl, {
                    params: {
                        method: 'artist.gettoptracks',
                        artist: artist,
                        api_key: this.apis.lastfm.key,
                        format: 'json',
                        limit: limit
                    },
                    timeout: 5000
                });

                if (response.data.toptracks?.track) {
                    return response.data.toptracks.track.map(track => ({
                        title: track.name,
                        author: track.artist.name,
                        source: 'lastfm_toptracks',
                        listeners: parseInt(track.listeners) || 0
                    }));
                }
            }
        } catch (error) {
            console.log('⚠️ Genre-based recommendations failed:', error.message);
        }

        return [];
    }

    async searchMultipleSources(query, limit = 10) {
        console.log(`🔍 Multi-source search: ${query}`);
        
        const results = [];

        // Search YouTube and SoundCloud simultaneously
        try {
            const playResults = await play.search(query, {
                limit: limit * 2,
                source: { youtube: 'video', soundcloud: 'tracks' }
            });

            for (const result of playResults) {
                if (result.type === 'video') {
                    // YouTube
                    results.push({
                        title: result.title,
                        author: result.channel?.name || 'Unknown',
                        url: result.url,
                        source: 'youtube',
                        duration: this.formatDuration(result.durationInSec * 1000),
                        thumbnail: result.thumbnails?.[0]?.url,
                        views: result.views
                    });
                } else if (result.type === 'track') {
                    // SoundCloud
                    results.push({
                        title: result.title,
                        author: result.user?.name || 'Unknown',
                        url: result.url,
                        source: 'soundcloud',
                        duration: this.formatDuration(result.durationInSec * 1000),
                        thumbnail: result.thumbnail,
                        plays: result.playCount
                    });
                }
            }
        } catch (error) {
            console.error('❌ Multi-source search failed:', error.message);
        }

        return this.deduplicateTracks(results).slice(0, limit);
    }

    async getTrendingTracks(limit = 20) {
        console.log('🔥 Getting trending tracks...');
        
        const trending = [];
        
        // Get trending from multiple generic searches
        const trendingQueries = [
            'trending songs 2024',
            'top hits 2024',
            'viral music',
            'popular songs now',
            'chart toppers'
        ];

        for (const query of trendingQueries.slice(0, 2)) { // Limit for speed
            try {
                const results = await play.search(query, {
                    limit: 4,
                    source: { youtube: 'video' }
                });

                for (const result of results) {
                    if (result.type === 'video') {
                        trending.push({
                            title: result.title,
                            author: result.channel?.name || 'Unknown',
                            url: result.url,
                            source: 'youtube_trending',
                            duration: this.formatDuration(result.durationInSec * 1000),
                            thumbnail: result.thumbnails?.[0]?.url,
                            views: result.views
                        });
                    }
                }
            } catch (error) {
                console.log(`⚠️ Trending query failed: ${query}`);
            }
        }

        return this.deduplicateTracks(trending).slice(0, limit);
    }

    deduplicateTracks(tracks) {
        const seen = new Set();
        return tracks.filter(track => {
            const key = `${track.title.toLowerCase()}_${track.author.toLowerCase()}`;
            if (seen.has(key)) {
                return false;
            }
            seen.add(key);
            return true;
        });
    }

    formatDuration(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    setCache(key, data) {
        this.cache.set(key, {
            data,
            timestamp: Date.now()
        });
    }

    getFromCache(key) {
        const cached = this.cache.get(key);
        if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
            return cached.data;
        }
        if (cached) {
            this.cache.delete(key);
        }
        return null;
    }
}

module.exports = ModernMusicDiscovery;