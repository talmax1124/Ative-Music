class SmartAutoPlay {
    constructor(sourceHandlers) {
        this.sourceHandlers = sourceHandlers;
        this.playHistory = [];
        this.currentTheme = null; // Track the current musical theme
        this.genres = {
            'reggaeton': ['reggaeton', 'perreo', 'dembow', 'urbano', 'latino', 'bad bunny', 'daddy yankee', 'j balvin', 'maluma', 'karol g', 'ozuna', 'anuel', 'farruko', 'nicky jam', 'wisin', 'yandel', 'plan b', 'arcangel', 'de la ghetto', 'zion', 'lennox', 'tito el bambino', 'hector el father', 'tempo', 'voltio', 'baby rasta', 'gringo', 'feid', 'rauw alejandro', 'sech', 'myke towers', 'jhay cortez', 'bryant myers', 'lenny tavarez', 'lunay', 'casper magico', 'nio garcia', 'darell', 'justin quiles', 'manuel turizo', 'rafa pabon', 'mau y ricky', 'reik', 'cnco', 'sebastian yatra', 'camilo', 'piso 21'],
            'pop': ['catchy', 'mainstream', 'radio', 'top 40', 'chart', 'hit', 'taylor swift', 'ariana grande', 'dua lipa', 'olivia rodrigo', 'billie eilish'],
            'rock': ['guitar', 'band', 'loud', 'electric', 'metal', 'alternative', 'foo fighters', 'imagine dragons', 'linkin park'],
            'hip hop': ['rap', 'beats', 'flow', 'trap', 'drill', 'freestyle', 'drake', 'kendrick lamar', 'j cole', 'travis scott', 'future', 'lil wayne', 'eminem', 'kanye west'],
            'electronic': ['edm', 'techno', 'house', 'dubstep', 'synth', 'dance', 'calvin harris', 'david guetta', 'skrillex', 'deadmau5'],
            'jazz': ['smooth', 'saxophone', 'improvisation', 'swing', 'blues', 'miles davis', 'john coltrane'],
            'classical': ['orchestra', 'symphony', 'piano', 'violin', 'instrumental', 'mozart', 'beethoven', 'bach'],
            'indie': ['independent', 'underground', 'alternative', 'experimental', 'arctic monkeys', 'vampire weekend'],
            'r&b': ['soul', 'vocals', 'rhythm', 'smooth', 'contemporary', 'weeknd', 'frank ocean', 'sza', 'daniel caesar'],
            'country': ['acoustic', 'guitar', 'storytelling', 'rural', 'folk', 'luke bryan', 'carrie underwood', 'keith urban'],
            'reggae': ['bob marley', 'jamaican', 'island', 'rastafari', 'ska', 'damian marley', 'ziggy marley'],
            'salsa': ['salsa', 'merengue', 'bachata', 'marc anthony', 'victor manuelle', 'gilberto santa rosa'],
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

    async getNextRecommendation(currentTrack, playHistory = [], userPreferences = {}) {
        console.log('🤖 Smart Auto-Play: Finding next recommendation...');
        
        if (!currentTrack) {
            console.log('⚠️ No current track provided, using fallback strategy');
            return await this.getFallbackTrack();
        }
        
        // Update current theme based on the track
        this.updateTheme(currentTrack);
        
        try {
            // Smart theme-based recommendation strategies with better variety
            const strategies = [
                { fn: () => this.getThemeBasedRecommendation(currentTrack), weight: 40 },
                { fn: () => this.getRelatedArtistTrack(currentTrack), weight: 25 },
                { fn: () => this.getSimilarGenreTrack(currentTrack), weight: 15 },
                { fn: () => this.getMoodMatchingTrack(currentTrack), weight: 10 },
                { fn: () => this.getTrendingTrack(), weight: 5 },
                { fn: () => this.getRandomPopularTrack(), weight: 5 }
            ];

            // Shuffle strategies to add variety
            const shuffledStrategies = [...strategies].sort(() => Math.random() - 0.5);

            for (const strategy of shuffledStrategies) {
                try {
                    console.log(`🎯 Trying recommendation strategy...`);
                    const recommendation = await strategy.fn();
                    
                    if (recommendation && !this.isRecentlyPlayed(recommendation, playHistory)) {
                        console.log(`✅ Found recommendation: ${recommendation.title} by ${recommendation.author}`);
                        return recommendation;
                    } else if (recommendation) {
                        console.log(`⚠️ Recommendation was recently played: ${recommendation.title}`);
                    }
                } catch (error) {
                    console.log(`⚠️ Strategy failed: ${error.message}, trying next...`);
                    continue;
                }
            }

            // Enhanced fallback - try to get something from a different genre
            console.log('🔄 All strategies exhausted, trying fallback with genre variety...');
            return await this.getFallbackTrack();

        } catch (error) {
            console.error('❌ Auto-play recommendation failed:', error);
            return await this.getFallbackTrack();
        }
    }

    async getRelatedArtistTrack(currentTrack) {
        if (!currentTrack) return null;

        const queries = [
            `${currentTrack.author} popular songs`,
            `${currentTrack.author} best hits`,
            `similar to ${currentTrack.author}`,
            `artists like ${currentTrack.author}`
        ];

        for (const query of queries) {
            try {
                const results = await this.sourceHandlers.search(query, 5);
                const filtered = results.filter(track => 
                    track.author.toLowerCase() !== currentTrack.author.toLowerCase() &&
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

    async getRandomPopularTrack() {
        const randomArtist = this.popularArtists[Math.floor(Math.random() * this.popularArtists.length)];
        const queries = [
            `${randomArtist} popular`,
            `${randomArtist} hits`,
            `best of ${randomArtist}`
        ];

        const query = queries[Math.floor(Math.random() * queries.length)];
        
        try {
            const results = await this.sourceHandlers.search(query, 5);
            return this.selectBestTrack(results);
        } catch (error) {
            return null;
        }
    }

    async getBackupPlaylistTrack() {
        const randomPlaylist = this.backupPlaylists[Math.floor(Math.random() * this.backupPlaylists.length)];
        
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

    async generateContinuousPlaylist(seedTrack, count = 50) {
        const playlist = [];
        let currentTrack = seedTrack;
        let attempts = 0;
        const maxAttempts = count * 3; // Prevent infinite loops

        console.log(`🎵 Generating continuous playlist with ${count} tracks...`);

        for (let i = 0; i < count && attempts < maxAttempts; i++) {
            attempts++;
            
            const recommendation = await this.getNextRecommendation(currentTrack, playlist);
            
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
        const text = `${track.title} ${track.author}`.toLowerCase();
        const genreScores = {};
        
        // Score each genre based on keyword matches
        for (const [genre, keywords] of Object.entries(this.genres)) {
            let score = 0;
            
            for (const keyword of keywords) {
                // Exact artist name match gets highest score
                if (track.author.toLowerCase() === keyword.toLowerCase()) {
                    score += 100;
                } 
                // Artist name contains keyword
                else if (track.author.toLowerCase().includes(keyword.toLowerCase())) {
                    score += 50;
                }
                // Title contains keyword
                else if (track.title.toLowerCase().includes(keyword.toLowerCase())) {
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
            
            console.log(`🎵 Genre detected: ${topGenre} (score: ${genreScores[topGenre]}) for "${track.author} - ${track.title}"`);
            return topGenre;
        }
        
        // Enhanced fallback logic
        if (track.author.toLowerCase().includes('lil') || text.includes('rap') || text.includes('hip hop')) {
            return 'hip hop';
        }
        if (text.includes('electronic') || text.includes('house') || text.includes('techno')) {
            return 'electronic';
        }
        if (text.includes('reggaeton') || text.includes('urbano') || text.includes('perreo')) {
            return 'reggaeton';
        }
        
        console.log(`🎵 Genre fallback: pop for "${track.author} - ${track.title}"`);
        return 'pop'; // Default fallback
    }

    detectMood(track) {
        const text = `${track.title} ${track.author}`.toLowerCase();
        
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
        
        // More specific search queries for better genre matching
        const searchQueries = [
            `${artist} similar artists`,  // Same artist style first
            `${genre} music 2024`,       // Recent tracks in same genre
            `best ${genre} songs`,       // Popular tracks in genre
            `${genre} playlist`,         // Genre playlists
            `${genre} ${mood}`          // Genre + mood combination
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
}

module.exports = SmartAutoPlay;