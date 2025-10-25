const UserPreferences = require('./UserPreferences');

class SmartAutoPlay {
    constructor(sourceHandlers) {
        this.sourceHandlers = sourceHandlers;
        this.playHistory = [];
        this.currentTheme = null; // Track the current musical theme
        this.userPreferences = new UserPreferences();
        this.audioFeatures = new Map(); // Cache for audio analysis
        this.genres = {
            'reggaeton': ['reggaeton', 'perreo', 'dembow', 'urbano', 'latino', 'bad bunny', 'daddy yankee', 'j balvin', 'maluma', 'karol g', 'ozuna', 'anuel', 'farruko', 'nicky jam', 'wisin', 'yandel', 'plan b', 'arcangel', 'de la ghetto', 'zion', 'lennox', 'tito el bambino', 'hector el father', 'tempo', 'voltio', 'baby rasta', 'gringo', 'feid', 'rauw alejandro', 'sech', 'myke towers', 'jhay cortez', 'bryant myers', 'lenny tavarez', 'lunay', 'casper magico', 'nio garcia', 'darell', 'justin quiles', 'manuel turizo', 'rafa pabon', 'mau y ricky', 'reik', 'cnco', 'sebastian yatra', 'camilo', 'piso 21'],
            'pop': ['catchy', 'mainstream', 'radio', 'top 40', 'chart', 'hit', 'taylor swift', 'ariana grande', 'dua lipa', 'olivia rodrigo', 'billie eilish'],
            'latin pop': ['latin pop', 'latino pop', 'musica latina', 'musica pop latina', 'musica en espanol', 'shakira', 'enrique iglesias', 'luis fonsi', 'carlos vives', 'reik', 'camila', 'manuel turizo', 'morat', 'sebastian yatra', 'joan sebastian', 'ricardo arjona', 'ricardo montaner'],
            'rock': ['guitar', 'band', 'loud', 'electric', 'metal', 'alternative', 'foo fighters', 'imagine dragons', 'linkin park'],
            'hip hop': ['rap', 'beats', 'flow', 'trap', 'drill', 'freestyle', 'drake', 'kendrick lamar', 'j cole', 'travis scott', 'future', 'lil wayne', 'eminem', 'kanye west'],
            'electronic': ['edm', 'techno', 'house', 'dubstep', 'synth', 'dance', 'calvin harris', 'david guetta', 'skrillex', 'deadmau5'],
            'jazz': ['smooth', 'saxophone', 'improvisation', 'swing', 'blues', 'miles davis', 'john coltrane'],
            'classical': ['orchestra', 'symphony', 'piano', 'violin', 'instrumental', 'mozart', 'beethoven', 'bach'],
            'indie': ['independent', 'underground', 'alternative', 'experimental', 'arctic monkeys', 'vampire weekend'],
            'r&b': ['soul', 'vocals', 'rhythm', 'smooth', 'contemporary', 'weeknd', 'frank ocean', 'sza', 'daniel caesar'],
            'country': ['acoustic', 'guitar', 'storytelling', 'rural', 'folk', 'luke bryan', 'carrie underwood', 'keith urban'],
            'reggae': ['bob marley', 'jamaican', 'island', 'rastafari', 'ska', 'damian marley', 'ziggy marley'],
            'salsa': ['salsa', 'merengue', 'bachata', 'marc anthony', 'victor manuelle', 'gilberto santa rosa', 'juan luis guerra', 'willie colon', 'ruben blades', 'hector lavoe', 'la india'],
            'bachata': ['bachata', 'juan luis guerra', 'romeo santos', 'aventura', 'prince royce', 'bachata 2024', 'bachatera', 'zacarias ferreira', 'monchy y alexandra'],
            'merengue': ['merengue', 'merengue tipico', 'merenguero', 'juan luis guerra', 'los hermanos rosario', 'tono rosario', 'eddy herrera', 'milly quezada'],
            'cumbia': ['cumbia', 'vallenato', 'champeta', 'carlos vives', 'grupo niche'],
            'banda': ['banda', 'mariachi', 'ranchera', 'vicente fernandez', 'alejandro fernandez'],
            'trap latino': ['trap', 'anuel aa', 'bad bunny trap', 'bryant myers', 'noriel', 'lary over']
        };
        this.moods = {
            'energetic': ['pump up', 'workout', 'party', 'upbeat', 'high energy'],
            'chill': ['relaxed', 'calm', 'ambient', 'peaceful', 'slow'],
            'romantic': ['love', 'romantic', 'slow dance', 'emotional', 'intimate'],
            'focus': ['study', 'concentration', 'instrumental', 'background'],
            'nostalgic': ['throwback', 'classic', 'retro', 'old school', 'vintage'],
            'sad': ['emotional', 'melancholy', 'heartbreak', 'crying', 'depression'],
            'happy': ['uplifting', 'positive', 'cheerful', 'feel good', 'smile']
        };
        this.popularArtists = [
            'Ed Sheeran', 'Taylor Swift', 'Drake', 'The Weeknd', 'Billie Eilish',
            'Post Malone', 'Ariana Grande', 'Dua Lipa', 'Harry Styles', 'Olivia Rodrigo',
            'Bad Bunny', 'Justin Bieber', 'BTS', 'Doja Cat', 'Lil Nas X'
        ];
    }

    async getNextRecommendation(currentTrack, playHistory = [], userContext = {}) {
        console.log('🧠 Smart Auto-Play: Finding next recommendation with AI analysis...');
        
        const { userId, guildId } = userContext || {};
        
        if (!currentTrack) {
            console.log('⚠️ No current track provided, using personalized fallback strategy');
            return await this.getPersonalizedFallback(userId, guildId);
        }
        
        // Get list of recently played artists to promote diversity
        const recentArtists = playHistory.slice(-8).map(track => track.author?.toLowerCase()).filter(Boolean);
        
        // Update current theme based on the track
        this.updateTheme(currentTrack);
        
        // Get user's personalized weights and preferences
        const personalWeights = userId && guildId 
            ? this.userPreferences.getPersonalizedRecommendationWeights(userId, guildId)
            : null;
        
        try {
            // AI-powered recommendation strategies with personalization
            let strategies;
            
            if (personalWeights) {
                strategies = this.getPersonalizedStrategies(currentTrack, personalWeights, recentArtists);
            } else {
                strategies = this.getDefaultStrategies(currentTrack, recentArtists);
            }

            // Intelligent strategy selection based on user patterns
            const weightedStrategies = this.selectOptimalStrategies(strategies, personalWeights);

            for (const strategy of weightedStrategies) {
                try {
                    console.log(`🎯 Trying ${strategy.name} strategy (weight: ${strategy.weight})...`);
                    const recommendation = await strategy.fn();
                    
                    if (recommendation && this.validateRecommendation(recommendation, playHistory, personalWeights, recentArtists)) {
                        console.log(`✅ Found AI recommendation: ${recommendation.title} by ${recommendation.author}`);
                        
                        // Track the recommendation for learning
                        if (userId && guildId) {
                            this.userPreferences.trackPlay(userId, guildId, recommendation);
                        }
                        
                        return recommendation;
                    } else if (recommendation) {
                        console.log(`⚠️ Recommendation filtered out: ${recommendation.title} by ${recommendation.author}`);
                    }
                } catch (error) {
                    console.log(`⚠️ Strategy failed: ${error.message}, trying next...`);
                    continue;
                }
            }

            // Enhanced personalized fallback
            console.log('🔄 All strategies exhausted, trying personalized fallback...');
            return await this.getPersonalizedFallback(userId, guildId);

        } catch (error) {
            console.error('❌ Auto-play recommendation failed:', error);
            return await this.getPersonalizedFallback(userId, guildId);
        }
    }

    async getRelatedArtistTrack(currentTrack, avoidArtists = []) {
        if (!currentTrack) return null;

        // Add current artist to avoid list
        const artistsToAvoid = [...avoidArtists, currentTrack.author.toLowerCase()];

        const queries = [
            `similar to ${currentTrack.author}`,
            `artists like ${currentTrack.author}`,
            `${this.detectGenre(currentTrack)} artists similar ${currentTrack.author}`,
            `music like ${currentTrack.author} different artists`
        ];

        for (const query of queries) {
            try {
                const results = await this.sourceHandlers.search(query, 8);
                const filtered = results.filter(track => 
                    !artistsToAvoid.includes(track.author.toLowerCase()) &&
                    track.title.toLowerCase() !== currentTrack.title.toLowerCase()
                );
                
                if (filtered.length > 0) {
                    return this.selectBestTrack(filtered);
                }
            } catch (error) {
                continue;
            }
        }

        return null;
    }

    async getGenreBasedRecommendation(currentTrack, specificGenre = null) {
        const genreKeys = Object.keys(this.genres);
        const randomGenre = specificGenre || genreKeys[Math.floor(Math.random() * genreKeys.length)];
        const queries = [
            `${randomGenre} music 2024`,
            `best ${randomGenre} songs`,
            `${randomGenre} hits`,
            `popular ${randomGenre}`
        ];

        const query = queries[Math.floor(Math.random() * queries.length)];
        
        try {
            const results = await this.sourceHandlers.search(query, 8);
            return this.selectBestTrack(results);
        } catch (error) {
            return null;
        }
    }

    async getTrendingTrack() {
        const trendingQueries = [
            'viral songs 2024',
            'trending music now',
            'top charts this week',
            'popular songs today',
            'music trending on tiktok'
        ];

        const query = trendingQueries[Math.floor(Math.random() * trendingQueries.length)];
        
        try {
            const results = await this.sourceHandlers.search(query, 10);
            return this.selectBestTrack(results);
        } catch (error) {
            return null;
        }
    }

    async getMoodBasedRecommendation() {
        const currentHour = new Date().getHours();
        let mood;

        if (currentHour >= 6 && currentHour < 12) {
            mood = 'energetic'; // Morning
        } else if (currentHour >= 12 && currentHour < 17) {
            mood = 'upbeat'; // Afternoon
        } else if (currentHour >= 17 && currentHour < 22) {
            mood = 'chill'; // Evening
        } else {
            mood = 'relaxing'; // Night
        }

        const query = `${mood} music playlist`;
        
        try {
            const results = await this.sourceHandlers.search(query, 8);
            return this.selectBestTrack(results);
        } catch (error) {
            return null;
        }
    }

    async getRandomPopularTrack(avoidArtists = []) {
        // Filter out recently played artists
        const availableArtists = this.popularArtists.filter(artist => 
            !avoidArtists.includes(artist.toLowerCase())
        );
        
        if (availableArtists.length === 0) {
            // If all popular artists are recently played, use any popular artist
            availableArtists.push(...this.popularArtists);
        }
        
        const randomArtist = availableArtists[Math.floor(Math.random() * availableArtists.length)];
        const queries = [
            `${randomArtist} popular`,
            `${randomArtist} hits`,
            `best of ${randomArtist}`
        ];

        const query = queries[Math.floor(Math.random() * queries.length)];
        
        try {
            const results = await this.sourceHandlers.search(query, 5);
            const filtered = results.filter(track => 
                !avoidArtists.includes(track.author?.toLowerCase())
            );
            return this.selectBestTrack(filtered.length > 0 ? filtered : results);
        } catch (error) {
            return null;
        }
    }

    async getBackupPlaylistTrack() {
        const backupPlaylists = [
            'popular music 2024',
            'trending songs',
            'top hits',
            'viral music',
            'chart toppers'
        ];
        
        const randomPlaylist = backupPlaylists[Math.floor(Math.random() * backupPlaylists.length)];
        
        try {
            const results = await this.sourceHandlers.search(randomPlaylist, 10);
            return this.selectBestTrack(results);
        } catch (error) {
            return null;
        }
    }

    async getFallbackTrack() {
        const fallbackQueries = [
            'popular music',
            'top songs',
            'hit songs',
            'good music',
            'classic hits'
        ];

        for (const query of fallbackQueries) {
            try {
                const results = await this.sourceHandlers.search(query, 5);
                if (results.length > 0) {
                    return results[0]; // Just return the first result
                }
            } catch (error) {
                continue;
            }
        }

        // Ultimate fallback
        return {
            title: 'Never Gonna Give You Up',
            author: 'Rick Astley',
            url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
            duration: '3:33',
            source: 'youtube',
            thumbnail: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg'
        };
    }

    selectBestTrack(tracks) {
        if (!tracks || tracks.length === 0) return null;

        // Score tracks based on various factors
        const scoredTracks = tracks.map(track => {
            let score = 0;

            // Prefer tracks with higher view counts (YouTube)
            if (track.viewCount && track.viewCount > 1000000) {
                score += Math.log10(track.viewCount) * 0.3;
            }

            // Prefer tracks with moderate duration (2-6 minutes)
            const duration = this.parseDuration(track.duration);
            if (duration >= 120000 && duration <= 360000) {
                score += 0.4;
            }

            // Prefer newer tracks
            if (track.publishedAt) {
                const ageYears = (Date.now() - new Date(track.publishedAt).getTime()) / (1000 * 60 * 60 * 24 * 365);
                if (ageYears < 2) {
                    score += 0.3;
                }
            }

            // Prefer tracks from popular sources
            if (track.source === 'youtube') score += 0.2;
            if (track.source === 'spotify') score += 0.1;

            // Add some randomness
            score += Math.random() * 0.2;

            return { ...track, score };
        });

        // Sort by score and return the best one
        scoredTracks.sort((a, b) => b.score - a.score);
        return scoredTracks[0];
    }

    isRecentlyPlayed(track, playHistory) {
        if (!track || !playHistory) return false;
        
        // Check last 15 tracks to prevent immediate repeats but allow some variety
        const recentTracks = playHistory.slice(-15);
        return recentTracks.some(historyTrack => {
            if (!historyTrack) return false;
            
            // Exact match check
            const titleMatch = historyTrack.title?.toLowerCase() === track.title?.toLowerCase();
            const authorMatch = historyTrack.author?.toLowerCase() === track.author?.toLowerCase();
            
            return titleMatch && authorMatch;
        });
    }

    parseDuration(duration) {
        if (typeof duration === 'number') return duration;
        if (!duration) return 0;

        const parts = duration.split(':').reverse();
        let seconds = 0;
        let multiplier = 1;

        for (const part of parts) {
            seconds += parseInt(part) * multiplier;
            multiplier *= 60;
        }

        return seconds * 1000; // Return in milliseconds
    }

    async generateContinuousPlaylist(seedTrack, count = 50, userContext = {}) {
        const playlist = [];
        let currentTrack = seedTrack;
        let attempts = 0;
        const maxAttempts = count * 3; // Prevent infinite loops

        console.log(`🎵 Generating continuous playlist with ${count} tracks...`);

        for (let i = 0; i < count && attempts < maxAttempts; i++) {
            attempts++;
            
            const recommendation = await this.getNextRecommendation(currentTrack, playlist, userContext);
            
            if (recommendation && !this.isDuplicateInPlaylist(recommendation, playlist)) {
                playlist.push(recommendation);
                currentTrack = recommendation;
                
                // Add variety every 10 tracks by switching to a different genre
                if (i % 10 === 9) {
                    const randomGenreKeys = Object.keys(this.genres);
                    const randomGenre = randomGenreKeys[Math.floor(Math.random() * randomGenreKeys.length)];
                    console.log(`🎨 Switching to ${randomGenre} genre for variety...`);
                    
                    const genreTrack = await this.getGenreBasedRecommendation(null, randomGenre);
                    if (genreTrack && !this.isDuplicateInPlaylist(genreTrack, playlist)) {
                        currentTrack = genreTrack;
                    }
                }
                
                // Reset attempts on successful addition
                attempts = Math.max(0, attempts - 1);
            } else {
                console.log(`⚠️ Failed to find unique recommendation (attempt ${attempts})`);
                
                // If we can't find recommendations, try switching to a completely different approach
                if (attempts % 10 === 0) {
                    currentTrack = await this.getTrendingTrack();
                }
            }

            // Small delay to avoid rate limiting
            if (i % 3 === 2) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }

        console.log(`✅ Generated playlist with ${playlist.length} tracks (${attempts} attempts)`);
        return playlist;
    }
    
    isDuplicateInPlaylist(track, playlist) {
        if (!track || !playlist) return false;
        
        return playlist.some(playlistTrack => 
            playlistTrack.title?.toLowerCase() === track.title?.toLowerCase() &&
            playlistTrack.author?.toLowerCase() === track.author?.toLowerCase()
        );
    }

    updateTheme(track) {
        if (!track) return;
        
        const detectedGenre = this.detectGenre(track);
        const detectedMood = this.detectMood(track);
        
        this.currentTheme = {
            genre: detectedGenre,
            mood: detectedMood,
            artist: track.author,
            lastTrack: track.title,
            updatedAt: new Date()
        };
        
        console.log(`🎨 Theme updated: ${detectedGenre} | ${detectedMood} | ${track.author}`);
    }

    detectGenre(track) {
        if (!track) {
            return 'pop';
        }

        const title = (track.title || '').toLowerCase();
        const author = (track.author || '').toLowerCase();
        const text = `${title} ${author}`;
        const genreScores = {};
        
        // Score each genre based on keyword matches
        for (const [genre, keywords] of Object.entries(this.genres)) {
            let score = 0;
            
            for (const keyword of keywords) {
                // Exact artist name match gets highest score
                if (author === keyword.toLowerCase()) {
                    score += 100;
                } 
                // Artist name contains keyword
                else if (author.includes(keyword.toLowerCase())) {
                    score += 50;
                }
                // Title contains keyword
                else if (title.includes(keyword.toLowerCase())) {
                    score += 25;
                }
                // General text match
                else if (text.includes(keyword.toLowerCase())) {
                    score += 10;
                }
            }
            
            if (score > 0) {
                genreScores[genre] = score;
            }
        }
        
        // Return genre with highest score
        if (Object.keys(genreScores).length > 0) {
            const topGenre = Object.entries(genreScores)
                .sort(([,a], [,b]) => b - a)[0][0];
            
            console.log(`🎵 Genre detected: ${topGenre} (score: ${genreScores[topGenre]}) for "${track.author || 'Unknown Artist'} - ${track.title || 'Unknown Title'}"`);
            return topGenre;
        }
        
        // Enhanced fallback logic
        if (author.includes('lil') || text.includes('rap') || text.includes('hip hop')) {
            return 'hip hop';
        }
        if (text.includes('electronic') || text.includes('house') || text.includes('techno')) {
            return 'electronic';
        }
        if (text.includes('reggaeton') || text.includes('urbano') || text.includes('perreo')) {
            return 'reggaeton';
        }
        if (text.includes('bachata') || text.includes('juan luis guerra') || text.includes('romeo santos')) {
            return 'bachata';
        }
        if (text.includes('merengue') || text.includes('los hermanos rosario') || text.includes('eddy herrera')) {
            return 'merengue';
        }
        if (text.includes('musica latina') || text.includes('latin pop') || text.includes('musica en espanol') || text.includes('spanish')) {
            return 'latin pop';
        }
        
        console.log(`🎵 Genre fallback: pop for "${track.author || 'Unknown Artist'} - ${track.title || 'Unknown Title'}"`);
        return 'pop'; // Default fallback
    }

    detectMood(track) {
        if (!track) {
            return 'relaxed';
        }

        const text = `${track.title || ''} ${track.author || ''}`.toLowerCase();
        
        for (const [mood, keywords] of Object.entries(this.moods)) {
            const matches = keywords.filter(keyword => text.includes(keyword)).length;
            if (matches > 0) {
                return mood;
            }
        }
        
        // Time-based mood detection
        const hour = new Date().getHours();
        if (hour >= 6 && hour < 12) return 'energetic'; // Morning
        if (hour >= 12 && hour < 17) return 'focus'; // Afternoon
        if (hour >= 17 && hour < 22) return 'chill'; // Evening
        return 'relaxed'; // Night
    }

    async getThemeBasedRecommendation(currentTrack) {
        if (!this.currentTheme) return null;
        
        const { genre, mood, artist } = this.currentTheme;
        
        // More specific search queries for better genre matching - focus on actual songs
        const searchQueries = [
            `${artist} songs`,           // Same artist's other songs
            `${artist} music`,           // Same artist's music
            `${genre} songs`,            // Songs in same genre
            `${genre} music`,            // Music in same genre
            `popular ${genre} artists`,  // Popular artists in genre
            `${genre} artists songs`     // Songs by genre artists
        ];
        
        for (const query of searchQueries) {
            try {
                console.log(`🎯 Theme search: ${query}`);
                const results = await this.sourceHandlers.search(query, 8);
                
                if (results.length > 0) {
                    // Strict genre filtering - only exact matches
                    const exactGenreMatches = results.filter(track => {
                        const detectedGenre = this.detectGenre(track);
                        return detectedGenre === genre;
                    });
                    
                    if (exactGenreMatches.length > 0) {
                        console.log(`✅ Found ${exactGenreMatches.length} exact ${genre} matches`);
                        return exactGenreMatches[Math.floor(Math.random() * exactGenreMatches.length)];
                    }
                    
                    // If no exact genre matches, try mood matching within the same genre family
                    const moodMatches = results.filter(track => {
                        const detectedMood = this.detectMood(track);
                        const detectedGenre = this.detectGenre(track);
                        return detectedMood === mood && this.isRelatedGenre(detectedGenre, genre);
                    });
                    
                    if (moodMatches.length > 0) {
                        console.log(`✅ Found ${moodMatches.length} mood matches in related genres`);
                        return moodMatches[Math.floor(Math.random() * moodMatches.length)];
                    }
                }
            } catch (error) {
                console.log(`❌ Theme search failed for: ${query}`);
                continue;
            }
        }
        
        console.log(`⚠️ No theme-based recommendations found for ${genre}`);
        return null;
    }

    isRelatedGenre(detectedGenre, targetGenre) {
        const genreFamilies = {
            'reggaeton': ['reggaeton', 'trap latino', 'salsa', 'cumbia'],
            'hip hop': ['hip hop', 'trap latino', 'r&b'],
            'electronic': ['electronic', 'pop'],
            'rock': ['rock', 'indie', 'alternative'],
            'pop': ['pop', 'r&b', 'electronic'],
            'reggae': ['reggae'],  // Keep reggae separate from reggaeton
            'jazz': ['jazz', 'r&b'],
            'country': ['country', 'folk'],
            'classical': ['classical']
        };
        
        const targetFamily = genreFamilies[targetGenre] || [targetGenre];
        return targetFamily.includes(detectedGenre);
    }

    // New personalized recommendation methods

    getPersonalizedStrategies(currentTrack, personalWeights, recentArtists = []) {
        const { preferredGenres, preferredArtists, patterns, similarUsers } = personalWeights;
        
        // Use current track's genre as fallback if no user preferences
        const currentGenre = currentTrack ? this.detectGenre(currentTrack) : null;
        const genresToUse = (preferredGenres && preferredGenres.length > 0) ? preferredGenres : (currentGenre ? [currentGenre] : ['reggaeton']);
        
        return [
            { name: 'ai-smart', fn: () => this.getAISmartRecommendation(currentTrack, recentArtists), weight: 50 },
            { 
                name: 'api-similar-tracks', 
                fn: () => this.getApiSimilarTracks(currentTrack, recentArtists), 
                weight: 35 
            },
            { 
                name: 'api-genre-recommendations', 
                fn: () => this.getApiGenreRecommendations(genresToUse, recentArtists), 
                weight: 25 
            },
            { 
                name: 'user-preferred-artist', 
                fn: () => this.getUserPreferredArtistTrack(preferredArtists), 
                weight: 20 
            },
            { 
                name: 'collaborative-filtering', 
                fn: () => this.getCollaborativeRecommendation(similarUsers), 
                weight: 15 
            },
            { 
                name: 'theme-based', 
                fn: () => this.getThemeBasedRecommendation(currentTrack), 
                weight: 10 
            },
            { 
                name: 'pattern-matching', 
                fn: () => this.getPatternBasedRecommendation(patterns), 
                weight: 8 
            }
        ];
    }

    getDefaultStrategies(currentTrack, recentArtists = []) {
        return [
            { name: 'ai-smart', fn: () => this.getAISmartRecommendation(currentTrack, recentArtists), weight: 60 },
            { name: 'api-similar-tracks', fn: () => this.getApiSimilarTracks(currentTrack), weight: 25 },
            { name: 'api-genre-recommendations', fn: () => this.getApiGenreRecommendations(currentTrack, recentArtists), weight: 20 },
            { name: 'theme-based', fn: () => this.getThemeBasedRecommendation(currentTrack, recentArtists), weight: 15 },
            { name: 'related-artist', fn: () => this.getRelatedArtistTrack(currentTrack, recentArtists), weight: 10 },
            { name: 'similar-genre', fn: () => this.getSimilarGenreTrack(currentTrack, recentArtists), weight: 8 },
            { name: 'mood-matching', fn: () => this.getMoodMatchingTrack(currentTrack, recentArtists), weight: 5 },
            { name: 'trending', fn: () => this.getTrendingTrack(), weight: 5 },
            { name: 'random-popular', fn: () => this.getRandomPopularTrack(recentArtists), weight: 5 }
        ];
    }

    selectOptimalStrategies(strategies, personalWeights) {
        // Adjust weights based on user patterns and context
        if (personalWeights && personalWeights.patterns.diversityScore > 0.7) {
            // User likes variety - increase exploration strategies
            strategies.forEach(strategy => {
                if (['trending', 'random-popular'].includes(strategy.name)) {
                    strategy.weight *= 1.5;
                }
            });
        }

        // Normalize weights and sort by adjusted weight
        const totalWeight = strategies.reduce((sum, s) => sum + s.weight, 0);
        return strategies
            .map(s => ({ ...s, normalizedWeight: s.weight / totalWeight }))
            .sort((a, b) => b.weight - a.weight);
    }

    async getUserPreferredGenreTrack(preferredGenres) {
        if (!preferredGenres || preferredGenres.length === 0) return null;
        
        const genre = preferredGenres[Math.floor(Math.random() * Math.min(3, preferredGenres.length))];
        const queries = [
            `${genre} songs`,
            `${genre} music`,
            `popular ${genre} artists songs`
        ];

        for (const query of queries) {
            try {
                const results = await this.sourceHandlers.search(query, 8);
                const filtered = results.filter(track => this.detectGenre(track) === genre);
                if (filtered.length > 0) {
                    return this.selectBestTrack(filtered);
                }
            } catch (error) {
                continue;
            }
        }
        return null;
    }

    async getUserPreferredArtistTrack(preferredArtists) {
        if (!preferredArtists || preferredArtists.length === 0) return null;
        
        const artist = preferredArtists[Math.floor(Math.random() * Math.min(5, preferredArtists.length))];
        const queries = [
            `${artist} latest songs`,
            `${artist} popular tracks`,
            `similar to ${artist}`
        ];

        for (const query of queries) {
            try {
                const results = await this.sourceHandlers.search(query, 5);
                if (results.length > 0) {
                    return this.selectBestTrack(results);
                }
            } catch (error) {
                continue;
            }
        }
        return null;
    }

    async getCollaborativeRecommendation(similarUsers) {
        if (!similarUsers || similarUsers.length === 0) return null;
        
        // Get tracks that similar users liked but current user hasn't heard
        const recommendations = [];
        
        similarUsers.forEach(({ user, similarity }) => {
            const topArtists = Object.entries(user.favoriteArtists)
                .sort(([,a], [,b]) => b - a)
                .slice(0, 5)
                .map(([artist]) => artist);
            
            recommendations.push(...topArtists.map(artist => ({ artist, similarity })));
        });

        // Pick a random artist weighted by similarity
        if (recommendations.length > 0) {
            const selected = recommendations[Math.floor(Math.random() * recommendations.length)];
            try {
                const results = await this.sourceHandlers.search(`${selected.artist} popular`, 5);
                return results.length > 0 ? this.selectBestTrack(results) : null;
            } catch (error) {
                return null;
            }
        }
        
        return null;
    }

    async getPatternBasedRecommendation(patterns) {
        if (!patterns) return null;
        
        // Use listening patterns to find similar music
        const topGenres = Object.entries(patterns.genreDistribution)
            .sort(([,a], [,b]) => b - a)
            .slice(0, 3)
            .map(([genre]) => genre);

        if (topGenres.length === 0) return null;

        const genre = topGenres[Math.floor(Math.random() * topGenres.length)];
        const timeSlot = this.getTimeSlot(new Date().getHours());
        
        const queries = [
            `${genre} ${timeSlot} playlist`,
            `${genre} music for ${timeSlot}`,
            `best ${genre} ${timeSlot}`
        ];

        for (const query of queries) {
            try {
                const results = await this.sourceHandlers.search(query, 6);
                if (results.length > 0) {
                    return this.selectBestTrack(results);
                }
            } catch (error) {
                continue;
            }
        }
        
        return null;
    }

    // API-powered recommendation methods
    async getApiSimilarTracks(currentTrack, recentArtists = []) {
        if (!currentTrack || !currentTrack.title || !currentTrack.author) return null;

        try {
            console.log(`🔍 Getting similar tracks for: ${currentTrack.author} - ${currentTrack.title}`);
            
            // Use genre-based similarity since recommendation service was removed
            const genre = this.detectGenre(currentTrack);
            const similarQueries = [
                `similar to ${currentTrack.author}`,
                `${genre} like ${currentTrack.author}`,
                `artists similar to ${currentTrack.author}`,
                `${genre} music ${currentTrack.author} style`
            ];

            for (const query of similarQueries) {
                try {
                    const searchResults = await this.sourceHandlers.search(query, 8);
                    
                    if (searchResults && searchResults.length > 0) {
                        // Filter out recent artists and current track
                        const filtered = searchResults.filter(track => 
                            !recentArtists.includes(track.author?.toLowerCase()) && 
                            track.author?.toLowerCase() !== currentTrack.author?.toLowerCase() &&
                            this.isMusicContent(track)
                        );
                        
                        if (filtered.length > 0) {
                            const bestMatch = this.selectBestTrack(filtered);
                            if (bestMatch) {
                                console.log(`✅ Found similar track: ${bestMatch.title} by ${bestMatch.author}`);
                                return bestMatch;
                            }
                        }
                    }
                } catch (error) {
                    console.log(`⚠️ Failed to search for: ${query}`);
                    continue;
                }
            }

            console.log('⚠️ No similar tracks could be found');
            return null;

        } catch (error) {
            console.error('❌ Similar tracks error:', error);
            return null;
        }
    }

    async getApiGenreRecommendations(preferredGenres, recentArtists = []) {
        let genres = [];

        if (Array.isArray(preferredGenres)) {
            genres = preferredGenres.filter(Boolean);
        } else if (typeof preferredGenres === 'string') {
            genres = [preferredGenres];
        } else if (preferredGenres && typeof preferredGenres === 'object') {
            const detected = this.detectGenre(preferredGenres);
            if (detected) {
                genres = [detected];
            }
        }

        if (genres.length === 0) {
            console.log('⚠️ No valid genres available for genre recommendations');
            return null;
        }

        try {
            const genre = genres[Math.floor(Math.random() * Math.min(3, genres.length))];
            console.log(`🎭 Getting genre recommendations for: ${genre}`);
            
            // Use our genre-based search since recommendation service was removed
            return await this.getGenreBasedRecommendation(null, genre);

        } catch (error) {
            console.error('❌ Genre recommendations error:', error);
            return null;
        }
    }

    findBestMatch(searchResults, targetTitle, targetArtist) {
        if (!searchResults || searchResults.length === 0) return null;

        // Calculate similarity scores for each result
        const scoredResults = searchResults.map(result => {
            let score = 0;

            // Title similarity (most important)
            if (result.title && targetTitle) {
                const titleSimilarity = this.calculateStringSimilarity(
                    result.title.toLowerCase(), 
                    targetTitle.toLowerCase()
                );
                score += titleSimilarity * 0.7;
            }

            // Artist similarity
            if (result.author && targetArtist) {
                const artistSimilarity = this.calculateStringSimilarity(
                    result.author.toLowerCase(), 
                    targetArtist.toLowerCase()
                );
                score += artistSimilarity * 0.3;
            }

            return { ...result, matchScore: score };
        });

        // Sort by match score and return the best match if it's good enough
        scoredResults.sort((a, b) => b.matchScore - a.matchScore);
        const bestMatch = scoredResults[0];

        // Only return if similarity is above threshold
        if (bestMatch && bestMatch.matchScore > 0.6) {
            return bestMatch;
        }

        // If no good match, return the first result (might still be related)
        return searchResults[0];
    }

    calculateStringSimilarity(str1, str2) {
        if (!str1 || !str2) return 0;
        
        // Simple similarity calculation using common words and character overlap
        const words1 = str1.split(/\s+/).filter(w => w.length > 2);
        const words2 = str2.split(/\s+/).filter(w => w.length > 2);
        
        let commonWords = 0;
        words1.forEach(word => {
            if (words2.some(w => w.includes(word) || word.includes(w))) {
                commonWords++;
            }
        });

        const wordSimilarity = commonWords / Math.max(words1.length, words2.length, 1);
        
        // Also check for character overlap
        const longer = str1.length > str2.length ? str1 : str2;
        const shorter = str1.length > str2.length ? str2 : str1;
        const charOverlap = shorter.split('').filter(char => longer.includes(char)).length / longer.length;
        
        return (wordSimilarity * 0.7 + charOverlap * 0.3);
    }

    async getPersonalizedFallback(userId, guildId) {
        if (userId && guildId) {
            const topGenres = this.userPreferences.getUserTopGenres(userId, guildId, 3);
            if (topGenres.length > 0) {
                return await this.getUserPreferredGenreTrack(topGenres);
            }
        }

        if (this.currentTheme?.genre) {
            const themeTrack = await this.getGenreBasedRecommendation(null, this.currentTheme.genre);
            if (themeTrack) {
                return themeTrack;
            }
        }
        
        return await this.getFallbackTrack();
    }

    validateRecommendation(track, playHistory, personalWeights, recentArtists = []) {
        // Filter out non-music content
        if (!this.isMusicContent(track)) {
            console.log(`🚫 Filtered out non-music content: ${track.title}`);
            return false;
        }

        const lastTrack = playHistory?.length ? playHistory[playHistory.length - 1] : null;

        if (lastTrack && lastTrack.title && lastTrack.author && track.title && track.author) {
            const lastTitle = String(lastTrack.title).trim().toLowerCase();
            const lastAuthor = String(lastTrack.author).trim().toLowerCase();
            const nextTitle = String(track.title).trim().toLowerCase();
            const nextAuthor = String(track.author).trim().toLowerCase();

            if (lastTitle === nextTitle && lastAuthor === nextAuthor) {
                console.log(`🚫 Avoiding immediate repeat: ${track.author} - ${track.title}`);
                return false;
            }
        }

        // Check if recently played
        if (this.isRecentlyPlayed(track, playHistory)) {
            console.log(`🚫 Avoiding recently played: ${track.title}`);
            return false;
        }

        // Check if artist was played recently (promote diversity)
        if (recentArtists.includes(track.author?.toLowerCase())) {
            const candidateArtist = track.author?.toLowerCase();
            const lastArtist = lastTrack?.author?.toLowerCase() || null;
            if (!candidateArtist) {
                console.log(`🚫 Avoiding recent artist for diversity: ${track.author}`);
                return false;
            }
            if (lastArtist === candidateArtist) {
                const recentSameArtistCount = playHistory.slice(-4).filter(t => t?.author?.toLowerCase() === candidateArtist).length;
                if (recentSameArtistCount >= 3) {
                    console.log(`🚫 Avoiding recent artist for diversity: ${track.author}`);
                    return false;
                }
            } else if (playHistory.length > 0) {
                console.log(`🚫 Avoiding recent artist for diversity: ${track.author}`);
                return false;
            }
        }

        // Check against user's anti-recommendations
        if (personalWeights && personalWeights.avoid) {
            const trackGenre = this.detectGenre(track);
            if (personalWeights.avoid.genres.includes(trackGenre)) {
                console.log(`🚫 Avoiding genre: ${trackGenre}`);
                return false;
            }
            if (personalWeights.avoid.artists.includes(track.author)) {
                console.log(`🚫 Avoiding artist: ${track.author}`);
                return false;
            }
        }

        return true;
    }

    isMusicContent(track) {
        if (!track || !track.title) return false;
        
        const title = track.title.toLowerCase();
        const author = track.author?.toLowerCase() || '';
        
        // Filter out non-music content patterns
        const nonMusicPatterns = [
            'overrated or underrated',
            'celebrities last words',
            'the art i make vs',
            'ai vs artists',
            'does youtube know',
            'is taxi music worth',
            'the style of jack kirby',
            'strip panel naked',
            'similar artists',
            'opportunity or threat',
            'fyp', 'fypp', 'viralvideo', 'viralshorts',
            'trend', 'tiktok songs with lyrics',
            'playlist hits',
            'reaction', 'reacts to',
            'vs original song',
            'duet',
            'challenge',
            'dance if you know',
            'guess the song',
            'sped up',
            'slowed',
            'mashup',
            'lyrics video',
            'shorts',

            'interview', 'talking about',
            'behind the scenes', 'making of',
            'tutorial', 'how to',
            'review', 'breakdown',
            'explained', 'analysis',
            // Generic playlists that aren't specific songs
            'top hits 2024 playlist',
            'best songs 2024 updated weekly',
            'trending music 2024',
            'playlist',
            'mix',
            'compilation',
            'collection',
            '~ trending',
            'updated weekly',
            'weekly hits'
        ];
        
        // Check if title contains non-music patterns
        for (const pattern of nonMusicPatterns) {
            if (title.includes(pattern)) {
                return false;
            }
        }
        
        // Ensure it has proper duration (music tracks should be 30s-20min)
        if (track.duration) {
            const duration = this.parseDuration(track.duration);
            if (duration < 30000 || duration > 1200000) { // 30s to 20min
                return false;
            }
        }
        
        return true;
    }

    parseDuration(duration) {
        if (typeof duration === 'number') return duration;
        if (!duration) return 0;

        const parts = duration.split(':').reverse();
        let seconds = 0;
        let multiplier = 1;

        for (const part of parts) {
            seconds += parseInt(part) * multiplier;
            multiplier *= 60;
        }

        return seconds * 1000;
    }

    getTimeSlot(hour) {
        if (hour >= 6 && hour < 12) return 'morning';
        if (hour >= 12 && hour < 17) return 'afternoon';
        if (hour >= 17 && hour < 22) return 'evening';
        return 'night';
    }

    // Enhanced genre detection using the UserPreferences method
    detectGenre(track) {
        return this.userPreferences.detectGenre(track);
    }

    async getSimilarGenreTrack(currentTrack) {
        const genre = this.detectGenre(currentTrack);
        const searchQuery = `${genre} music similar artists`;
        
        try {
            const results = await this.sourceHandlers.search(searchQuery, 3);
            return results.length > 0 ? results[Math.floor(Math.random() * results.length)] : null;
        } catch (error) {
            return null;
        }
    }

    async getMoodMatchingTrack(currentTrack) {
        const mood = this.detectMood(currentTrack);
        const searchQuery = `${mood} playlist music`;
        
        try {
            const results = await this.sourceHandlers.search(searchQuery, 3);
            return results.length > 0 ? results[Math.floor(Math.random() * results.length)] : null;
        } catch (error) {
            return null;
        }
    }

    async getAISmartRecommendation(currentTrack, playHistory = []) {
        try {
            console.log('🤖 Getting smart recommendation...');
            
            // Use intelligent heuristics since AI service was removed
            const genre = this.detectGenre(currentTrack);
            const mood = this.detectMood(currentTrack);
            const timeContext = this.getTimeContext();
            
            // Build smart search query based on context
            const smartQueries = [
                `${genre} ${mood} music`,
                `${timeContext.toLowerCase()} ${genre} playlist`,
                `popular ${genre} artists`,
                `${mood} ${genre} songs`
            ];
            
            for (const query of smartQueries) {
                try {
                    const results = await this.sourceHandlers.search(query, 5);
                    
                    if (results && results.length > 0) {
                        // Filter by genre and mood matching
                        const filtered = results.filter(track => {
                            const trackGenre = this.detectGenre(track);
                            const trackMood = this.detectMood(track);
                            return (trackGenre === genre || this.isRelatedGenre(trackGenre, genre)) &&
                                   this.isMusicContent(track);
                        });
                        
                        if (filtered.length > 0) {
                            const recommendation = this.selectBestTrack(filtered);
                            console.log(`🤖 Smart recommended: "${recommendation.title}" by ${recommendation.author}`);
                            return recommendation;
                        }
                    }
                } catch (error) {
                    continue;
                }
            }
            
            console.log('🤖 No smart recommendations found');
            return null;

        } catch (error) {
            console.error('❌ Error getting smart recommendation:', error.message);
            return null;
        }
    }

    getTimeContext() {
        const hour = new Date().getHours();
        
        if (hour >= 5 && hour < 12) return 'Morning';
        if (hour >= 12 && hour < 17) return 'Afternoon';
        if (hour >= 17 && hour < 22) return 'Evening';
        return 'Night';
    }
}

module.exports = SmartAutoPlay;
