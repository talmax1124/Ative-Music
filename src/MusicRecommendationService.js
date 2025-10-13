const axios = require('axios');
const AIRecommendationService = require('./AIRecommendationService');

class MusicRecommendationService {
    constructor(aiRecommendationService = null) {
        // Multiple API keys for redundancy
        this.lastFmApiKey = process.env.LASTFM_API_KEY;
        this.spotifyClientId = process.env.SPOTIFY_CLIENT_ID;
        this.spotifyClientSecret = process.env.SPOTIFY_CLIENT_SECRET;
        this.audioDbApiKey = process.env.AUDIODB_API_KEY || '1'; // Free tier
        
        // Cache for API responses
        this.cache = new Map();
        this.cacheTimeout = 3600000; // 1 hour
        
        // Spotify access token
        this.spotifyToken = null;
        this.spotifyTokenExpiry = null;
        
        // Rate limiting
        this.rateLimits = {
            lastfm: { requests: 0, resetTime: Date.now() + 60000 },
            spotify: { requests: 0, resetTime: Date.now() + 60000 },
            audiodb: { requests: 0, resetTime: Date.now() + 60000 }
        };

        // Shared AI recommendation service
        this.aiRecommendationService = aiRecommendationService || new AIRecommendationService();
    }

    async getSimilarTracks(trackName, artistName, limit = 10) {
        console.log(`🎵 Getting similar tracks for: ${artistName} - ${trackName}`);
        
        try {
            // Try multiple sources in parallel
            const results = await Promise.allSettled([
                this.getLastFmSimilarTracks(trackName, artistName, limit),
                this.getSpotifyRecommendations(trackName, artistName, limit),
                this.getAudioDbSimilarTracks(artistName, limit)
            ]);

            // Combine and deduplicate results
            const allTracks = [];
            results.forEach(result => {
                if (result.status === 'fulfilled' && result.value) {
                    allTracks.push(...result.value);
                }
            });

            if (this.aiRecommendationService?.enabled) {
                const aiTracks = await this.getAiSimilarTracks(trackName, artistName, limit);
                allTracks.push(...aiTracks);
            }

            return this.deduplicateAndScore(allTracks, trackName, artistName).slice(0, limit);
        } catch (error) {
            console.error('❌ Error getting similar tracks:', error);
            return [];
        }
    }

    async getAiSimilarTracks(trackName, artistName, limit = 10) {
        try {
            if (!this.aiRecommendationService?.enabled) return [];
            if (!trackName && !artistName) return [];

            const currentTrack = {
                title: trackName || '',
                author: artistName || ''
            };

            const aiRecommendations = await this.aiRecommendationService.getSmartRecommendations(
                currentTrack,
                []
            );

            if (!Array.isArray(aiRecommendations) || aiRecommendations.length === 0) {
                return [];
            }

            return aiRecommendations.slice(0, limit).map(rec => ({
                title: rec.title,
                artist: rec.artist,
                similarity: typeof rec.similarity === 'number' ? rec.similarity : 0.75,
                source: 'ai',
                reason: rec.reason,
                energy: rec.energy
            })).filter(track => track.title && track.artist);

        } catch (error) {
            console.log('⚠️ AI similar track recommendation error:', error.message);
            return [];
        }
    }

    async getLastFmSimilarTracks(trackName, artistName, limit = 10) {
        if (!this.lastFmApiKey) return [];
        if (!this.checkRateLimit('lastfm')) return [];

        const cacheKey = `lastfm_similar_${artistName}_${trackName}`;
        const cached = this.getFromCache(cacheKey);
        if (cached) return cached;

        try {
            // Get similar tracks
            const trackResponse = await axios.get('http://ws.audioscrobbler.com/2.0/', {
                params: {
                    method: 'track.getsimilar',
                    artist: artistName,
                    track: trackName,
                    api_key: this.lastFmApiKey,
                    format: 'json',
                    limit: limit
                },
                timeout: 5000
            });

            this.rateLimits.lastfm.requests++;

            let tracks = [];
            if (trackResponse.data.similartracks?.track) {
                tracks = Array.isArray(trackResponse.data.similartracks.track) 
                    ? trackResponse.data.similartracks.track 
                    : [trackResponse.data.similartracks.track];
            }

            // Get similar artists as fallback
            if (tracks.length < 3) {
                const artistResponse = await axios.get('http://ws.audioscrobbler.com/2.0/', {
                    params: {
                        method: 'artist.getsimilar',
                        artist: artistName,
                        api_key: this.lastFmApiKey,
                        format: 'json',
                        limit: 5
                    },
                    timeout: 5000
                });

                if (artistResponse.data.similarartists?.artist) {
                    const similarArtists = Array.isArray(artistResponse.data.similarartists.artist)
                        ? artistResponse.data.similarartists.artist
                        : [artistResponse.data.similarartists.artist];
                    
                    // Get top tracks for similar artists
                    for (const artist of similarArtists.slice(0, 3)) {
                        try {
                            const topTracksResponse = await axios.get('http://ws.audioscrobbler.com/2.0/', {
                                params: {
                                    method: 'artist.gettoptracks',
                                    artist: artist.name,
                                    api_key: this.lastFmApiKey,
                                    format: 'json',
                                    limit: 3
                                },
                                timeout: 5000
                            });

                            if (topTracksResponse.data.toptracks?.track) {
                                const topTracks = Array.isArray(topTracksResponse.data.toptracks.track)
                                    ? topTracksResponse.data.toptracks.track
                                    : [topTracksResponse.data.toptracks.track];
                                tracks.push(...topTracks);
                            }
                        } catch (error) {
                            continue;
                        }
                    }
                }
            }

            const formattedTracks = tracks.map(track => ({
                title: track.name,
                artist: track.artist?.name || track.artist,
                similarity: parseFloat(track.match || 0),
                source: 'lastfm',
                url: track.url
            })).filter(track => track.title && track.artist);

            this.setCache(cacheKey, formattedTracks);
            return formattedTracks;

        } catch (error) {
            console.error('❌ Last.fm API error:', error.message);
            return [];
        }
    }

    async getSpotifyToken() {
        if (!this.spotifyClientId || !this.spotifyClientSecret) return null;
        
        if (this.spotifyToken && this.spotifyTokenExpiry > Date.now()) {
            return this.spotifyToken;
        }

        try {
            const response = await axios.post('https://accounts.spotify.com/api/token', 
                'grant_type=client_credentials',
                {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'Authorization': 'Basic ' + Buffer.from(this.spotifyClientId + ':' + this.spotifyClientSecret).toString('base64')
                    },
                    timeout: 5000
                }
            );

            this.spotifyToken = response.data.access_token;
            this.spotifyTokenExpiry = Date.now() + (response.data.expires_in * 1000) - 60000; // 1 min buffer
            return this.spotifyToken;

        } catch (error) {
            console.error('❌ Spotify token error:', error.message);
            return null;
        }
    }

    async getSpotifyRecommendations(trackName, artistName, limit = 10) {
        if (!this.checkRateLimit('spotify')) return [];

        const token = await this.getSpotifyToken();
        if (!token) return [];

        const cacheKey = `spotify_recs_${artistName}_${trackName}`;
        const cached = this.getFromCache(cacheKey);
        if (cached) return cached;

        try {
            // Search for the track to get its ID and audio features
            const searchResponse = await axios.get('https://api.spotify.com/v1/search', {
                headers: { 'Authorization': `Bearer ${token}` },
                params: {
                    q: `track:${trackName} artist:${artistName}`,
                    type: 'track',
                    limit: 1
                },
                timeout: 5000
            });

            this.rateLimits.spotify.requests++;

            if (!searchResponse.data.tracks.items.length) {
                return [];
            }

            const track = searchResponse.data.tracks.items[0];
            const trackId = track.id;

            // Get audio features for the track
            const featuresResponse = await axios.get(`https://api.spotify.com/v1/audio-features/${trackId}`, {
                headers: { 'Authorization': `Bearer ${token}` },
                timeout: 5000
            });

            const features = featuresResponse.data;

            // Get recommendations based on audio features
            const recommendationsResponse = await axios.get('https://api.spotify.com/v1/recommendations', {
                headers: { 'Authorization': `Bearer ${token}` },
                params: {
                    seed_tracks: trackId,
                    limit: limit,
                    target_energy: features.energy,
                    target_valence: features.valence,
                    target_danceability: features.danceability,
                    target_tempo: features.tempo
                },
                timeout: 5000
            });

            const recommendations = recommendationsResponse.data.tracks.map(track => ({
                title: track.name,
                artist: track.artists[0].name,
                similarity: 0.8, // Spotify doesn't provide similarity scores
                source: 'spotify',
                url: track.external_urls.spotify,
                audioFeatures: {
                    energy: features.energy,
                    valence: features.valence,
                    danceability: features.danceability,
                    tempo: features.tempo
                }
            }));

            this.setCache(cacheKey, recommendations);
            return recommendations;

        } catch (error) {
            console.error('❌ Spotify API error:', error.message);
            return [];
        }
    }

    async getAudioDbSimilarTracks(artistName, limit = 10) {
        if (!this.checkRateLimit('audiodb')) return [];

        const cacheKey = `audiodb_similar_${artistName}`;
        const cached = this.getFromCache(cacheKey);
        if (cached) return cached;

        try {
            // Get artist info and similar artists
            const response = await axios.get(`https://www.theaudiodb.com/api/v1/json/${this.audioDbApiKey}/search.php`, {
                params: { s: artistName },
                timeout: 5000
            });

            this.rateLimits.audiodb.requests++;

            if (!response.data.artists || !response.data.artists.length) {
                return [];
            }

            const artist = response.data.artists[0];
            const similarArtists = [];

            // Extract similar artists from the bio/description
            if (artist.strBiographyEN) {
                const bio = artist.strBiographyEN.toLowerCase();
                const commonWords = ['similar', 'like', 'influenced', 'compared', 'reminiscent'];
                // This is a simplified approach - in reality you'd use NLP
                // For now, we'll return the artist's own top tracks
            }

            // Get top tracks for the artist
            const tracksResponse = await axios.get(`https://www.theaudiodb.com/api/v1/json/${this.audioDbApiKey}/track.php`, {
                params: { m: artist.idArtist },
                timeout: 5000
            });

            let tracks = [];
            if (tracksResponse.data.track) {
                tracks = tracksResponse.data.track.slice(0, limit).map(track => ({
                    title: track.strTrack,
                    artist: track.strArtist,
                    similarity: 0.7,
                    source: 'audiodb',
                    url: track.strMusicVid || track.strTrackThumb
                }));
            }

            this.setCache(cacheKey, tracks);
            return tracks;

        } catch (error) {
            console.error('❌ AudioDB API error:', error.message);
            return [];
        }
    }

    async getGenreBasedRecommendations(genre, limit = 10) {
        if (!genre) {
            console.log('⚠️ Genre-based recommendation request missing genre context');
            return [];
        }

        console.log(`🎭 Getting genre-based recommendations for: ${genre}`);
        
        const cacheKey = `genre_recs_${genre}`;
        const cached = this.getFromCache(cacheKey);
        if (cached) return cached;

        try {
            const results = await Promise.allSettled([
                this.getLastFmTopTracksByGenre(genre, limit),
                this.getSpotifyGenreRecommendations(genre, limit)
            ]);

            const allTracks = [];
            results.forEach(result => {
                if (result.status === 'fulfilled' && result.value) {
                    allTracks.push(...result.value);
                }
            });

            if (this.aiRecommendationService?.enabled) {
                const aiTracks = await this.getAiGenreRecommendations(genre, limit);
                allTracks.push(...aiTracks);
            }

            const recommendations = this.deduplicateAndScore(allTracks, null, null).slice(0, limit);
            this.setCache(cacheKey, recommendations);
            return recommendations;

        } catch (error) {
            console.error('❌ Error getting genre recommendations:', error);
            return [];
        }
    }

    async getAiGenreRecommendations(genre, limit = 10) {
        try {
            if (!this.aiRecommendationService?.enabled) return [];
            if (!genre) return [];

            const aiRecommendations = await this.aiRecommendationService.getGenreRecommendations(genre, 'medium');
            if (!Array.isArray(aiRecommendations) || aiRecommendations.length === 0) {
                return [];
            }

            return aiRecommendations.slice(0, limit).map(rec => ({
                title: rec.title,
                artist: rec.artist,
                similarity: 0.7,
                source: 'ai_genre',
                reason: rec.reason,
                genre
            })).filter(track => track.title && track.artist);
        } catch (error) {
            console.log('⚠️ AI genre recommendation error:', error.message);
            return [];
        }
    }

    async getLastFmTopTracksByGenre(genre, limit = 10) {
        if (!this.lastFmApiKey || !this.checkRateLimit('lastfm')) return [];

        try {
            const response = await axios.get('http://ws.audioscrobbler.com/2.0/', {
                params: {
                    method: 'tag.gettoptracks',
                    tag: genre,
                    api_key: this.lastFmApiKey,
                    format: 'json',
                    limit: limit
                },
                timeout: 5000
            });

            this.rateLimits.lastfm.requests++;

            if (!response.data.tracks?.track) return [];

            const tracks = Array.isArray(response.data.tracks.track) 
                ? response.data.tracks.track 
                : [response.data.tracks.track];

            return tracks.map(track => ({
                title: track.name,
                artist: track.artist?.name || track.artist,
                similarity: parseFloat(track['@attr']?.rank || 0) / 100,
                source: 'lastfm_genre',
                url: track.url,
                playcount: parseInt(track.playcount) || 0
            }));

        } catch (error) {
            console.error('❌ Last.fm genre error:', error.message);
            return [];
        }
    }

    async getSpotifyGenreRecommendations(genre, limit = 10) {
        if (!this.checkRateLimit('spotify')) return [];

        const token = await this.getSpotifyToken();
        if (!token) return [];

        try {
            // Map genres to Spotify's available genres
            const spotifyGenre = this.mapToSpotifyGenre(genre);
            if (!spotifyGenre) return [];

            const response = await axios.get('https://api.spotify.com/v1/recommendations', {
                headers: { 'Authorization': `Bearer ${token}` },
                params: {
                    seed_genres: spotifyGenre,
                    limit: limit,
                    market: 'US'
                },
                timeout: 5000
            });

            this.rateLimits.spotify.requests++;

            return response.data.tracks.map(track => ({
                title: track.name,
                artist: track.artists[0].name,
                similarity: 0.8,
                source: 'spotify_genre',
                url: track.external_urls.spotify,
                popularity: track.popularity
            }));

        } catch (error) {
            console.error('❌ Spotify genre error:', error.message);
            return [];
        }
    }

    mapToSpotifyGenre(genre) {
        if (!genre || typeof genre !== 'string') {
            return null;
        }

        const genreMap = {
            'reggaeton': 'reggaeton',
            'pop': 'pop',
            'rock': 'rock',
            'hip hop': 'hip-hop',
            'electronic': 'electronic',
            'jazz': 'jazz',
            'classical': 'classical',
            'indie': 'indie',
            'r&b': 'r-n-b',
            'country': 'country',
            'reggae': 'reggae',
            'salsa': 'salsa',
            'cumbia': 'latin',
            'banda': 'latin',
            'trap latino': 'latin'
        };
        
        return genreMap[genre.toLowerCase()] || null;
    }

    deduplicateAndScore(tracks, originalTrack, originalArtist) {
        const seen = new Set();
        const unique = [];

        for (const track of tracks) {
            if (!track.title || !track.artist) continue;
            
            const key = `${track.title.toLowerCase()}_${track.artist.toLowerCase()}`;
            
            // Skip if duplicate
            if (seen.has(key)) continue;
            
            // Skip if same as original
            if (originalTrack && originalArtist) {
                if (track.title.toLowerCase() === originalTrack.toLowerCase() && 
                    track.artist.toLowerCase() === originalArtist.toLowerCase()) {
                    continue;
                }
            }

            seen.add(key);
            
            // Calculate composite score
            let score = track.similarity || 0.5;
            
            // Boost based on source reliability
            if (track.source === 'spotify') score += 0.1;
            if (track.source === 'lastfm') score += 0.15;
            
            // Boost based on popularity metrics
            if (track.playcount && track.playcount > 1000000) score += 0.1;
            if (track.popularity && track.popularity > 70) score += 0.1;
            
            track.compositeScore = Math.min(score, 1.0);
            unique.push(track);
        }

        // Sort by composite score
        return unique.sort((a, b) => (b.compositeScore || 0) - (a.compositeScore || 0));
    }

    checkRateLimit(service) {
        const limit = this.rateLimits[service];
        const now = Date.now();
        
        // Reset counter if time window passed
        if (now > limit.resetTime) {
            limit.requests = 0;
            limit.resetTime = now + 60000; // Reset every minute
        }
        
        // Check if under limit (conservative limits)
        const maxRequests = {
            lastfm: 4, // Last.fm allows 5/sec, we use 4/min
            spotify: 30, // Spotify is more generous
            audiodb: 10 // AudioDB is free tier
        };
        
        if (limit.requests >= maxRequests[service]) {
            console.log(`⏰ Rate limit reached for ${service}, skipping...`);
            return false;
        }
        
        return true;
    }

    getFromCache(key) {
        const cached = this.cache.get(key);
        if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
            return cached.data;
        }
        this.cache.delete(key);
        return null;
    }

    setCache(key, data) {
        this.cache.set(key, {
            data,
            timestamp: Date.now()
        });
        
        // Clean old cache entries occasionally
        if (this.cache.size > 1000) {
            this.cleanCache();
        }
    }

    cleanCache() {
        const now = Date.now();
        for (const [key, value] of this.cache.entries()) {
            if (now - value.timestamp > this.cacheTimeout) {
                this.cache.delete(key);
            }
        }
    }

    // Enhanced recommendation engine
    async getAdvancedRecommendations(currentTrack, userPreferences, playHistory = [], limit = 10) {
        console.log(`🧠 Getting advanced recommendations for: ${currentTrack.artist} - ${currentTrack.title}`);
        
        try {
            // Get multiple recommendation types
            const [similar, genre, collaborative] = await Promise.allSettled([
                this.getSimilarTracks(currentTrack.title, currentTrack.artist, 15),
                this.getGenreBasedRecommendations(userPreferences.topGenres?.[0] || 'pop', 10),
                this.getCollaborativeRecommendations(userPreferences, 10)
            ]);

            // Combine all recommendations
            const allRecommendations = [];
            
            if (similar.status === 'fulfilled' && similar.value) {
                allRecommendations.push(...similar.value.map(track => ({ ...track, type: 'similar' })));
            }
            
            if (genre.status === 'fulfilled' && genre.value) {
                allRecommendations.push(...genre.value.map(track => ({ ...track, type: 'genre' })));
            }
            
            if (collaborative.status === 'fulfilled' && collaborative.value) {
                allRecommendations.push(...collaborative.value.map(track => ({ ...track, type: 'collaborative' })));
            }

            // Apply user preference weights
            const weightedRecommendations = this.applyUserWeights(allRecommendations, userPreferences);
            
            // Filter out recently played
            const filtered = this.filterPlayHistory(weightedRecommendations, playHistory);
            
            return filtered.slice(0, limit);

        } catch (error) {
            console.error('❌ Advanced recommendations error:', error);
            return [];
        }
    }

    async getCollaborativeRecommendations(userPreferences, limit = 10) {
        // This would typically connect to a collaborative filtering system
        // For now, we'll use the user's top artists to find similar tracks
        if (!userPreferences.topArtists || !userPreferences.topArtists.length) {
            return [];
        }

        const recommendations = [];
        
        for (const artist of userPreferences.topArtists.slice(0, 3)) {
            try {
                const artistTracks = await this.getLastFmSimilarTracks('', artist, 3);
                recommendations.push(...artistTracks);
            } catch (error) {
                continue;
            }
        }

        return recommendations.slice(0, limit);
    }

    applyUserWeights(recommendations, userPreferences) {
        return recommendations.map(track => {
            let weight = track.compositeScore || 0.5;
            
            // Boost preferred genres
            if (userPreferences.topGenres && userPreferences.topGenres.includes(track.genre)) {
                weight += 0.2;
            }
            
            // Boost preferred artists
            if (userPreferences.topArtists && userPreferences.topArtists.includes(track.artist)) {
                weight += 0.3;
            }
            
            // Penalize avoided content
            if (userPreferences.avoidedGenres && userPreferences.avoidedGenres.includes(track.genre)) {
                weight -= 0.4;
            }
            
            if (userPreferences.avoidedArtists && userPreferences.avoidedArtists.includes(track.artist)) {
                weight -= 0.5;
            }
            
            track.userWeight = Math.max(0, Math.min(1, weight));
            return track;
        }).sort((a, b) => (b.userWeight || 0) - (a.userWeight || 0));
    }

    filterPlayHistory(recommendations, playHistory) {
        const recentTracks = new Set();
        playHistory.slice(-20).forEach(track => {
            if (track.title && track.artist) {
                recentTracks.add(`${track.title.toLowerCase()}_${track.artist.toLowerCase()}`);
            }
        });

        return recommendations.filter(track => {
            const key = `${track.title.toLowerCase()}_${track.artist.toLowerCase()}`;
            return !recentTracks.has(key);
        });
    }
}

module.exports = MusicRecommendationService;
