const axios = require('axios');

class EnhancedMetadataService {
    constructor() {
        this.cache = new Map();
        this.cacheTimeout = 24 * 60 * 60 * 1000; // 24 hours
        this.rateLimits = new Map();
        
        // API configurations
        this.apis = {
            lastfm: {
                enabled: !!process.env.LASTFM_API_KEY,
                baseUrl: 'http://ws.audioscrobbler.com/2.0/',
                rateLimit: 5, // requests per second
                features: ['tags', 'similar', 'info', 'topTracks']
            },
            spotify: {
                enabled: !!process.env.SPOTIFY_CLIENT_ID,
                baseUrl: 'https://api.spotify.com/v1/',
                rateLimit: 10,
                features: ['audio-features', 'recommendations', 'albums']
            },
            musicbrainz: {
                enabled: true,
                baseUrl: 'https://musicbrainz.org/ws/2/',
                rateLimit: 1,
                features: ['recordings', 'artists', 'releases']
            },
            genius: {
                enabled: false, // Requires special access
                baseUrl: 'https://api.genius.com/',
                rateLimit: 1,
                features: ['lyrics', 'annotations']
            }
        };
        
        this.spotifyToken = null;
        this.spotifyTokenExpiry = 0;
        
        this.initializeSpotify();
    }
    
    async initializeSpotify() {
        if (!this.apis.spotify.enabled) return;
        
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
            console.log('✅ Spotify API initialized for metadata enhancement');
        } catch (error) {
            console.warn('⚠️ Spotify API initialization failed:', error.message);
            this.apis.spotify.enabled = false;
        }
    }
    
    // Main method to enhance track with metadata
    async enhanceTrack(track) {
        const cacheKey = this.generateCacheKey(track);
        
        // Check cache first
        if (this.cache.has(cacheKey)) {
            const cached = this.cache.get(cacheKey);
            if (Date.now() - cached.timestamp < this.cacheTimeout) {
                return { ...track, ...cached.metadata };
            }
        }
        
        console.log(`🔍 Enhancing metadata for: ${track.artist} - ${track.title}`);
        
        const metadata = {
            enhanced: true,
            enhancedAt: Date.now(),
            sources: []
        };
        
        // Fetch from multiple sources in parallel
        const promises = [];
        
        if (this.apis.lastfm.enabled) {
            promises.push(this.getLastFmData(track).catch(err => ({ source: 'lastfm', error: err.message })));
        }
        
        if (this.apis.spotify.enabled) {
            promises.push(this.getSpotifyData(track).catch(err => ({ source: 'spotify', error: err.message })));
        }
        
        if (this.apis.musicbrainz.enabled) {
            promises.push(this.getMusicBrainzData(track).catch(err => ({ source: 'musicbrainz', error: err.message })));
        }
        
        try {
            const results = await Promise.allSettled(promises);
            
            results.forEach(result => {
                if (result.status === 'fulfilled' && result.value && !result.value.error) {
                    Object.assign(metadata, result.value);
                    metadata.sources.push(result.value.source);
                }
            });
            
            // Post-process and clean up metadata
            const processedMetadata = this.processMetadata(metadata);
            
            // Cache the results
            this.cache.set(cacheKey, {
                metadata: processedMetadata,
                timestamp: Date.now()
            });
            
            return { ...track, ...processedMetadata };
            
        } catch (error) {
            console.error('❌ Metadata enhancement failed:', error);
            return track;
        }
    }
    
    // Last.fm API integration
    async getLastFmData(track) {
        if (!this.canMakeRequest('lastfm')) {
            throw new Error('Rate limit exceeded');
        }
        
        const params = {
            method: 'track.getInfo',
            artist: track.artist,
            track: track.title,
            api_key: process.env.LASTFM_API_KEY,
            format: 'json',
            autocorrect: 1
        };
        
        const response = await axios.get(this.apis.lastfm.baseUrl, { params });
        this.updateRateLimit('lastfm');
        
        if (response.data.error) {
            throw new Error(response.data.message);
        }
        
        const trackData = response.data.track;
        if (!trackData) {
            throw new Error('Track not found');
        }
        
        return {
            source: 'lastfm',
            lastfm: {
                playcount: parseInt(trackData.playcount) || 0,
                listeners: parseInt(trackData.listeners) || 0,
                tags: trackData.toptags?.tag?.map(tag => ({
                    name: tag.name,
                    count: parseInt(tag.count) || 0
                })) || [],
                summary: trackData.wiki?.summary || null,
                content: trackData.wiki?.content || null,
                url: trackData.url,
                mbid: trackData.mbid || null
            },
            genres: trackData.toptags?.tag?.slice(0, 5)?.map(tag => tag.name) || [],
            popularity: this.normalizePopularity(parseInt(trackData.playcount) || 0, 'lastfm'),
            description: trackData.wiki?.summary || null
        };
    }
    
    // Spotify API integration
    async getSpotifyData(track) {
        if (!this.canMakeRequest('spotify')) {
            throw new Error('Rate limit exceeded');
        }
        
        if (!this.spotifyToken || Date.now() >= this.spotifyTokenExpiry) {
            await this.initializeSpotify();
        }
        
        // Search for track
        const searchResponse = await axios.get(`${this.apis.spotify.baseUrl}search`, {
            params: {
                q: `track:"${track.title}" artist:"${track.artist}"`,
                type: 'track',
                limit: 1
            },
            headers: {
                'Authorization': `Bearer ${this.spotifyToken}`
            }
        });
        
        this.updateRateLimit('spotify');
        
        const tracks = searchResponse.data.tracks.items;
        if (!tracks.length) {
            throw new Error('Track not found on Spotify');
        }
        
        const spotifyTrack = tracks[0];
        
        // Get audio features
        let audioFeatures = null;
        try {
            const featuresResponse = await axios.get(`${this.apis.spotify.baseUrl}audio-features/${spotifyTrack.id}`, {
                headers: {
                    'Authorization': `Bearer ${this.spotifyToken}`
                }
            });
            audioFeatures = featuresResponse.data;
        } catch (error) {
            console.warn('Could not fetch audio features:', error.message);
        }
        
        return {
            source: 'spotify',
            spotify: {
                id: spotifyTrack.id,
                popularity: spotifyTrack.popularity,
                explicit: spotifyTrack.explicit,
                preview_url: spotifyTrack.preview_url,
                external_urls: spotifyTrack.external_urls,
                album: {
                    name: spotifyTrack.album.name,
                    id: spotifyTrack.album.id,
                    release_date: spotifyTrack.album.release_date,
                    images: spotifyTrack.album.images,
                    genres: spotifyTrack.album.genres || []
                },
                artists: spotifyTrack.artists.map(artist => ({
                    id: artist.id,
                    name: artist.name,
                    external_urls: artist.external_urls
                })),
                audio_features: audioFeatures
            },
            album: spotifyTrack.album.name,
            releaseDate: spotifyTrack.album.release_date,
            popularity: this.normalizePopularity(spotifyTrack.popularity, 'spotify'),
            isExplicit: spotifyTrack.explicit,
            previewUrl: spotifyTrack.preview_url,
            images: spotifyTrack.album.images,
            audioFeatures: audioFeatures ? {
                danceability: audioFeatures.danceability,
                energy: audioFeatures.energy,
                key: audioFeatures.key,
                loudness: audioFeatures.loudness,
                mode: audioFeatures.mode,
                speechiness: audioFeatures.speechiness,
                acousticness: audioFeatures.acousticness,
                instrumentalness: audioFeatures.instrumentalness,
                liveness: audioFeatures.liveness,
                valence: audioFeatures.valence,
                tempo: audioFeatures.tempo,
                timeSignature: audioFeatures.time_signature
            } : null
        };
    }
    
    // MusicBrainz API integration
    async getMusicBrainzData(track) {
        if (!this.canMakeRequest('musicbrainz')) {
            throw new Error('Rate limit exceeded');
        }
        
        const query = `recording:"${track.title}" AND artist:"${track.artist}"`;
        const response = await axios.get(`${this.apis.musicbrainz.baseUrl}recording`, {
            params: {
                query: query,
                fmt: 'json',
                limit: 1
            },
            headers: {
                'User-Agent': process.env.MUSICBRAINZ_USER_AGENT || 'AtiveMusic/1.0.0'
            }
        });
        
        this.updateRateLimit('musicbrainz');
        
        const recordings = response.data.recordings;
        if (!recordings.length) {
            throw new Error('Recording not found in MusicBrainz');
        }
        
        const recording = recordings[0];
        
        return {
            source: 'musicbrainz',
            musicbrainz: {
                id: recording.id,
                title: recording.title,
                length: recording.length,
                disambiguation: recording.disambiguation,
                artist_credit: recording['artist-credit'],
                releases: recording.releases?.map(release => ({
                    id: release.id,
                    title: release.title,
                    date: release.date,
                    country: release.country,
                    status: release.status
                })) || [],
                tags: recording.tags?.map(tag => ({
                    name: tag.name,
                    count: tag.count
                })) || [],
                genres: recording.genres?.map(genre => genre.name) || []
            },
            mbid: recording.id,
            alternativeTitles: [recording.title],
            releases: recording.releases?.map(release => release.title) || []
        };
    }
    
    // Process and clean metadata
    processMetadata(metadata) {
        const processed = { ...metadata };
        
        // Merge genres from different sources
        const allGenres = [];
        if (metadata.genres) allGenres.push(...metadata.genres);
        if (metadata.spotify?.album?.genres) allGenres.push(...metadata.spotify.album.genres);
        if (metadata.musicbrainz?.genres) allGenres.push(...metadata.musicbrainz.genres);
        if (metadata.lastfm?.tags) allGenres.push(...metadata.lastfm.tags.slice(0, 5).map(tag => tag.name));
        
        processed.genres = [...new Set(allGenres)].slice(0, 10);
        
        // Calculate mood from audio features
        if (metadata.audioFeatures) {
            processed.mood = this.calculateMood(metadata.audioFeatures);
        }
        
        // Determine best image
        if (metadata.images && metadata.images.length > 0) {
            processed.thumbnail = metadata.images.find(img => img.width >= 300)?.url || metadata.images[0]?.url;
            processed.artwork = metadata.images.find(img => img.width >= 600)?.url || processed.thumbnail;
        }
        
        // Calculate overall confidence score
        processed.confidence = this.calculateConfidenceScore(metadata);
        
        // Add recommendations data if available
        if (metadata.audioFeatures) {
            processed.recommendationSeeds = this.generateRecommendationSeeds(metadata);
        }
        
        return processed;
    }
    
    // Calculate mood from audio features
    calculateMood(features) {
        const moods = [];
        
        if (features.valence > 0.7) moods.push('happy');
        else if (features.valence < 0.3) moods.push('sad');
        
        if (features.energy > 0.8) moods.push('energetic');
        else if (features.energy < 0.3) moods.push('calm');
        
        if (features.danceability > 0.7) moods.push('danceable');
        
        if (features.acousticness > 0.7) moods.push('acoustic');
        
        if (features.instrumentalness > 0.5) moods.push('instrumental');
        
        if (features.liveness > 0.8) moods.push('live');
        
        return moods.length > 0 ? moods : ['neutral'];
    }
    
    // Generate recommendation seeds
    generateRecommendationSeeds(metadata) {
        const seeds = {
            genres: metadata.genres?.slice(0, 2) || [],
            audioFeatures: {}
        };
        
        if (metadata.audioFeatures) {
            const features = metadata.audioFeatures;
            seeds.audioFeatures = {
                target_danceability: Math.round(features.danceability * 100) / 100,
                target_energy: Math.round(features.energy * 100) / 100,
                target_valence: Math.round(features.valence * 100) / 100,
                target_tempo: Math.round(features.tempo)
            };
        }
        
        return seeds;
    }
    
    // Calculate confidence score based on available data
    calculateConfidenceScore(metadata) {
        let score = 0;
        let maxScore = 0;
        
        const weights = {
            spotify: 30,
            lastfm: 25,
            musicbrainz: 20,
            audioFeatures: 15,
            genres: 10
        };
        
        Object.keys(weights).forEach(source => {
            maxScore += weights[source];
            if (metadata[source] || (source === 'genres' && metadata.genres?.length > 0)) {
                score += weights[source];
            }
        });
        
        return Math.round((score / maxScore) * 100);
    }
    
    // Rate limiting helpers
    canMakeRequest(service) {
        const now = Date.now();
        const limit = this.apis[service].rateLimit;
        
        if (!this.rateLimits.has(service)) {
            this.rateLimits.set(service, []);
        }
        
        const requests = this.rateLimits.get(service);
        const recentRequests = requests.filter(time => now - time < 1000);
        
        return recentRequests.length < limit;
    }
    
    updateRateLimit(service) {
        const now = Date.now();
        if (!this.rateLimits.has(service)) {
            this.rateLimits.set(service, []);
        }
        
        const requests = this.rateLimits.get(service);
        requests.push(now);
        
        // Keep only last second of requests
        this.rateLimits.set(service, requests.filter(time => now - time < 1000));
    }
    
    normalizePopularity(value, source) {
        switch (source) {
            case 'spotify':
                return value; // Already 0-100
            case 'lastfm':
                // Normalize Last.fm playcount to 0-100 scale
                return Math.min(100, Math.log10(value + 1) * 20);
            default:
                return value;
        }
    }
    
    generateCacheKey(track) {
        const normalized = {
            title: this.normalizeString(track.title),
            artist: this.normalizeString(track.artist)
        };
        return `${normalized.artist}:${normalized.title}`;
    }
    
    normalizeString(str) {
        if (!str) return '';
        return str.toLowerCase()
            .replace(/[^\w\s]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    }
    
    // Batch enhance multiple tracks
    async enhanceTracks(tracks, options = {}) {
        const { batchSize = 5, delayBetweenBatches = 1000 } = options;
        const enhanced = [];
        
        for (let i = 0; i < tracks.length; i += batchSize) {
            const batch = tracks.slice(i, i + batchSize);
            console.log(`🔍 Enhancing metadata batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(tracks.length / batchSize)}`);
            
            const batchPromises = batch.map(track => 
                this.enhanceTrack(track).catch(error => {
                    console.warn(`Failed to enhance ${track.title}:`, error.message);
                    return track; // Return original track on error
                })
            );
            
            const batchResults = await Promise.all(batchPromises);
            enhanced.push(...batchResults);
            
            // Delay between batches to respect rate limits
            if (i + batchSize < tracks.length) {
                await new Promise(resolve => setTimeout(resolve, delayBetweenBatches));
            }
        }
        
        return enhanced;
    }
    
    // Get similar tracks based on metadata
    async getSimilarTracks(track, limit = 10) {
        const enhanced = await this.enhanceTrack(track);
        const similar = [];
        
        // Try Last.fm similar tracks
        if (this.apis.lastfm.enabled) {
            try {
                const params = {
                    method: 'track.getSimilar',
                    artist: track.artist,
                    track: track.title,
                    api_key: process.env.LASTFM_API_KEY,
                    format: 'json',
                    limit: limit
                };
                
                const response = await axios.get(this.apis.lastfm.baseUrl, { params });
                
                if (response.data.similartracks?.track) {
                    const tracks = Array.isArray(response.data.similartracks.track) 
                        ? response.data.similartracks.track 
                        : [response.data.similartracks.track];
                    
                    tracks.forEach(similarTrack => {
                        similar.push({
                            title: similarTrack.name,
                            artist: similarTrack.artist?.name || similarTrack.artist,
                            similarity: parseFloat(similarTrack.match) || 0,
                            url: similarTrack.url,
                            source: 'lastfm'
                        });
                    });
                }
            } catch (error) {
                console.warn('Failed to get Last.fm similar tracks:', error.message);
            }
        }
        
        return similar.slice(0, limit);
    }
    
    // Clear cache
    clearCache() {
        this.cache.clear();
        console.log('🧹 Metadata cache cleared');
    }
    
    // Get cache statistics
    getCacheStats() {
        return {
            size: this.cache.size,
            apis: Object.entries(this.apis).map(([name, config]) => ({
                name,
                enabled: config.enabled,
                features: config.features
            })),
            rateLimits: Object.fromEntries(this.rateLimits.entries())
        };
    }
}

module.exports = EnhancedMetadataService;