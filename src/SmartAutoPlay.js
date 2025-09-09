class SmartAutoPlay {
    constructor(sourceHandlers) {
        this.sourceHandlers = sourceHandlers;
        this.playHistory = [];
        this.genres = ['pop', 'rock', 'hip hop', 'electronic', 'jazz', 'classical', 'indie', 'alternative', 'r&b', 'country'];
        this.moods = ['energetic', 'chill', 'upbeat', 'relaxing', 'focus', 'party', 'workout', 'study'];
        this.popularArtists = [
            'Ed Sheeran', 'Taylor Swift', 'Drake', 'The Weeknd', 'Billie Eilish',
            'Post Malone', 'Ariana Grande', 'Dua Lipa', 'Harry Styles', 'Olivia Rodrigo',
            'Bad Bunny', 'Justin Bieber', 'BTS', 'Doja Cat', 'Lil Nas X'
        ];
        this.backupPlaylists = [
            'top hits 2024', 'chill vibes', 'focus music', 'workout playlist',
            'indie rock', 'electronic chill', 'pop hits', 'lo-fi study'
        ];
    }

    async getNextRecommendation(currentTrack, playHistory = [], userPreferences = {}) {
        console.log('🤖 Smart Auto-Play: Finding next recommendation...');
        
        try {
            // Try different recommendation strategies
            const strategies = [
                () => this.getRelatedArtistTrack(currentTrack),
                () => this.getGenreBasedRecommendation(currentTrack),
                () => this.getTrendingTrack(),
                () => this.getMoodBasedRecommendation(),
                () => this.getRandomPopularTrack(),
                () => this.getBackupPlaylistTrack()
            ];

            for (const strategy of strategies) {
                try {
                    const recommendation = await strategy();
                    if (recommendation && !this.isRecentlyPlayed(recommendation, playHistory)) {
                        console.log(`✅ Found recommendation: ${recommendation.title} by ${recommendation.author}`);
                        return recommendation;
                    }
                } catch (error) {
                    console.log(`⚠️ Strategy failed, trying next...`);
                    continue;
                }
            }

            // Fallback to a guaranteed track
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

    async getGenreBasedRecommendation(currentTrack) {
        const randomGenre = this.genres[Math.floor(Math.random() * this.genres.length)];
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
        const recentTracks = playHistory.slice(-20); // Check last 20 tracks
        return recentTracks.some(historyTrack => 
            historyTrack.title.toLowerCase() === track.title.toLowerCase() &&
            historyTrack.author.toLowerCase() === track.author.toLowerCase()
        );
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

        console.log(`🎵 Generating continuous playlist with ${count} tracks...`);

        for (let i = 0; i < count; i++) {
            const recommendation = await this.getNextRecommendation(currentTrack, playlist);
            if (recommendation) {
                playlist.push(recommendation);
                currentTrack = recommendation;
                
                // Add some variety every 10 tracks
                if (i % 10 === 9) {
                    currentTrack = null; // Force genre/mood change
                }
            }

            // Small delay to avoid rate limiting
            if (i % 5 === 4) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }

        console.log(`✅ Generated playlist with ${playlist.length} tracks`);
        return playlist;
    }
}

module.exports = SmartAutoPlay;