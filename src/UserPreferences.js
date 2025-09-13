const fs = require('fs');
const path = require('path');

class UserPreferences {
    constructor() {
        this.dataDir = path.join(__dirname, '..', 'data');
        this.userDataFile = path.join(this.dataDir, 'user_preferences.json');
        this.ensureDataDirectory();
        this.preferences = this.loadPreferences();
    }

    ensureDataDirectory() {
        if (!fs.existsSync(this.dataDir)) {
            fs.mkdirSync(this.dataDir, { recursive: true });
        }
    }

    loadPreferences() {
        try {
            if (fs.existsSync(this.userDataFile)) {
                const data = fs.readFileSync(this.userDataFile, 'utf8');
                return JSON.parse(data);
            }
        } catch (error) {
            console.error('❌ Error loading user preferences:', error);
        }
        return {
            users: {},
            global: {
                popularGenres: {},
                popularArtists: {},
                timePatterns: {},
                skipPatterns: {}
            }
        };
    }

    savePreferences() {
        try {
            fs.writeFileSync(this.userDataFile, JSON.stringify(this.preferences, null, 2));
        } catch (error) {
            console.error('❌ Error saving user preferences:', error);
        }
    }

    // Track when a user plays a song
    trackPlay(userId, guildId, track, timestamp = Date.now()) {
        const userKey = `${userId}_${guildId}`;
        
        if (!this.preferences.users[userKey]) {
            this.preferences.users[userKey] = {
                playHistory: [],
                favoriteGenres: {},
                favoriteArtists: {},
                skipHistory: [],
                repeatHistory: [],
                timePatterns: {},
                energyPreference: 0.5, // 0 = calm, 1 = energetic
                moodPreference: 'balanced',
                lastActive: timestamp
            };
        }

        const user = this.preferences.users[userKey];
        
        // Add to play history (keep last 1000 tracks)
        user.playHistory.unshift({
            title: track.title,
            author: track.author,
            genre: this.detectGenre(track),
            timestamp: timestamp,
            duration: track.duration,
            source: track.source
        });
        user.playHistory = user.playHistory.slice(0, 1000);

        // Update favorite genres and artists
        const genre = this.detectGenre(track);
        user.favoriteGenres[genre] = (user.favoriteGenres[genre] || 0) + 1;
        user.favoriteArtists[track.author] = (user.favoriteArtists[track.author] || 0) + 1;

        // Update time patterns
        const hour = new Date(timestamp).getHours();
        const timeSlot = this.getTimeSlot(hour);
        if (!user.timePatterns[timeSlot]) {
            user.timePatterns[timeSlot] = { genres: {}, artists: {} };
        }
        user.timePatterns[timeSlot].genres[genre] = (user.timePatterns[timeSlot].genres[genre] || 0) + 1;
        user.timePatterns[timeSlot].artists[track.author] = (user.timePatterns[timeSlot].artists[track.author] || 0) + 1;

        // Update global statistics
        this.preferences.global.popularGenres[genre] = (this.preferences.global.popularGenres[genre] || 0) + 1;
        this.preferences.global.popularArtists[track.author] = (this.preferences.global.popularArtists[track.author] || 0) + 1;

        user.lastActive = timestamp;
        this.savePreferences();
    }

    // Track when a user skips a song
    trackSkip(userId, guildId, track, playDuration, timestamp = Date.now()) {
        const userKey = `${userId}_${guildId}`;
        const user = this.preferences.users[userKey];
        
        if (user) {
            user.skipHistory.unshift({
                title: track.title,
                author: track.author,
                genre: this.detectGenre(track),
                playDuration: playDuration,
                timestamp: timestamp,
                reason: this.determineSkipReason(playDuration, track.duration)
            });
            user.skipHistory = user.skipHistory.slice(0, 500);

            // Decrease preference for skipped genre/artist slightly
            const genre = this.detectGenre(track);
            if (user.favoriteGenres[genre]) {
                user.favoriteGenres[genre] = Math.max(0, user.favoriteGenres[genre] - 0.5);
            }
            if (user.favoriteArtists[track.author]) {
                user.favoriteArtists[track.author] = Math.max(0, user.favoriteArtists[track.author] - 0.5);
            }

            this.savePreferences();
        }
    }

    // Track when a user repeats a song
    trackRepeat(userId, guildId, track, timestamp = Date.now()) {
        const userKey = `${userId}_${guildId}`;
        const user = this.preferences.users[userKey];
        
        if (user) {
            user.repeatHistory.unshift({
                title: track.title,
                author: track.author,
                genre: this.detectGenre(track),
                timestamp: timestamp
            });
            user.repeatHistory = user.repeatHistory.slice(0, 100);

            // Increase preference for repeated genre/artist
            const genre = this.detectGenre(track);
            user.favoriteGenres[genre] = (user.favoriteGenres[genre] || 0) + 2;
            user.favoriteArtists[track.author] = (user.favoriteArtists[track.author] || 0) + 2;

            this.savePreferences();
        }
    }

    // Get user's top genres for current time
    getUserTopGenres(userId, guildId, limit = 5) {
        const userKey = `${userId}_${guildId}`;
        const user = this.preferences.users[userKey];
        
        if (!user) return [];

        const currentTimeSlot = this.getTimeSlot(new Date().getHours());
        
        // Combine overall preferences with time-specific preferences
        let genreScores = { ...user.favoriteGenres };
        
        if (user.timePatterns[currentTimeSlot]) {
            Object.entries(user.timePatterns[currentTimeSlot].genres).forEach(([genre, count]) => {
                genreScores[genre] = (genreScores[genre] || 0) + (count * 1.5); // Boost current time preferences
            });
        }

        return Object.entries(genreScores)
            .sort(([,a], [,b]) => b - a)
            .slice(0, limit)
            .map(([genre]) => genre);
    }

    // Get user's top artists for current time
    getUserTopArtists(userId, guildId, limit = 10) {
        const userKey = `${userId}_${guildId}`;
        const user = this.preferences.users[userKey];
        
        if (!user) return [];

        const currentTimeSlot = this.getTimeSlot(new Date().getHours());
        
        // Combine overall preferences with time-specific preferences
        let artistScores = { ...user.favoriteArtists };
        
        if (user.timePatterns[currentTimeSlot]) {
            Object.entries(user.timePatterns[currentTimeSlot].artists).forEach(([artist, count]) => {
                artistScores[artist] = (artistScores[artist] || 0) + (count * 1.5);
            });
        }

        return Object.entries(artistScores)
            .sort(([,a], [,b]) => b - a)
            .slice(0, limit)
            .map(([artist]) => artist);
    }

    // Get listening patterns for recommendations
    getListeningPatterns(userId, guildId) {
        const userKey = `${userId}_${guildId}`;
        const user = this.preferences.users[userKey];
        
        if (!user || user.playHistory.length < 5) {
            return this.getGlobalPatterns();
        }

        // Analyze recent listening behavior
        const recentTracks = user.playHistory.slice(0, 50);
        const patterns = {
            genreDistribution: {},
            averageTrackLength: 0,
            preferredSources: {},
            diversityScore: 0,
            energyLevel: user.energyPreference
        };

        recentTracks.forEach(track => {
            const genre = track.genre || 'unknown';
            patterns.genreDistribution[genre] = (patterns.genreDistribution[genre] || 0) + 1;
            patterns.preferredSources[track.source] = (patterns.preferredSources[track.source] || 0) + 1;
        });

        // Calculate diversity score (higher = more diverse tastes)
        const genres = Object.keys(patterns.genreDistribution).length;
        patterns.diversityScore = Math.min(genres / 10, 1);

        return patterns;
    }

    // Get similar users for collaborative filtering
    getSimilarUsers(userId, guildId, limit = 5) {
        const userKey = `${userId}_${guildId}`;
        const targetUser = this.preferences.users[userKey];
        
        if (!targetUser) return [];

        const similarities = [];
        
        Object.entries(this.preferences.users).forEach(([otherUserKey, otherUser]) => {
            if (otherUserKey === userKey) return;
            
            const similarity = this.calculateUserSimilarity(targetUser, otherUser);
            if (similarity > 0.3) { // Minimum similarity threshold
                similarities.push({ userKey: otherUserKey, similarity, user: otherUser });
            }
        });

        return similarities
            .sort((a, b) => b.similarity - a.similarity)
            .slice(0, limit);
    }

    // Calculate similarity between two users
    calculateUserSimilarity(user1, user2) {
        let genreSimilarity = 0;
        let artistSimilarity = 0;

        // Compare genre preferences
        const user1Genres = Object.keys(user1.favoriteGenres);
        const user2Genres = Object.keys(user2.favoriteGenres);
        const commonGenres = user1Genres.filter(genre => user2Genres.includes(genre));
        
        if (user1Genres.length > 0 && user2Genres.length > 0) {
            genreSimilarity = commonGenres.length / Math.max(user1Genres.length, user2Genres.length);
        }

        // Compare artist preferences
        const user1Artists = Object.keys(user1.favoriteArtists);
        const user2Artists = Object.keys(user2.favoriteArtists);
        const commonArtists = user1Artists.filter(artist => user2Artists.includes(artist));
        
        if (user1Artists.length > 0 && user2Artists.length > 0) {
            artistSimilarity = commonArtists.length / Math.max(user1Artists.length, user2Artists.length);
        }

        return (genreSimilarity * 0.6) + (artistSimilarity * 0.4);
    }

    // Get global patterns for new users
    getGlobalPatterns() {
        return {
            genreDistribution: this.preferences.global.popularGenres,
            preferredSources: { youtube: 10, spotify: 5 },
            diversityScore: 0.5,
            energyLevel: 0.5
        };
    }

    // Get anti-recommendations (things user dislikes)
    getAntiRecommendations(userId, guildId) {
        const userKey = `${userId}_${guildId}`;
        const user = this.preferences.users[userKey];
        
        if (!user) return { genres: [], artists: [] };

        // Find frequently skipped content
        const skipThreshold = 3;
        const skippedGenres = {};
        const skippedArtists = {};

        user.skipHistory.forEach(skip => {
            if (skip.reason === 'early_skip') { // Skipped within first 30 seconds
                skippedGenres[skip.genre] = (skippedGenres[skip.genre] || 0) + 1;
                skippedArtists[skip.author] = (skippedArtists[skip.author] || 0) + 1;
            }
        });

        return {
            genres: Object.entries(skippedGenres)
                .filter(([, count]) => count >= skipThreshold)
                .map(([genre]) => genre),
            artists: Object.entries(skippedArtists)
                .filter(([, count]) => count >= skipThreshold)
                .map(([artist]) => artist)
        };
    }

    // Helper methods
    detectGenre(track) {
        // Simple genre detection based on artist and title
        const text = `${track.title} ${track.author}`.toLowerCase();
        
        const genreKeywords = {
            'reggaeton': ['reggaeton', 'bad bunny', 'daddy yankee', 'j balvin', 'maluma'],
            'hip hop': ['rap', 'hip hop', 'drake', 'kendrick', 'eminem', 'kanye'],
            'pop': ['pop', 'taylor swift', 'ariana grande', 'dua lipa'],
            'rock': ['rock', 'metal', 'guitar', 'foo fighters'],
            'electronic': ['edm', 'electronic', 'house', 'techno'],
            'r&b': ['r&b', 'soul', 'weeknd', 'frank ocean'],
            'country': ['country', 'folk', 'acoustic'],
            'jazz': ['jazz', 'blues', 'saxophone'],
            'classical': ['classical', 'orchestra', 'symphony']
        };

        for (const [genre, keywords] of Object.entries(genreKeywords)) {
            if (keywords.some(keyword => text.includes(keyword))) {
                return genre;
            }
        }

        return 'pop'; // Default
    }

    getTimeSlot(hour) {
        if (hour >= 6 && hour < 12) return 'morning';
        if (hour >= 12 && hour < 17) return 'afternoon';
        if (hour >= 17 && hour < 22) return 'evening';
        return 'night';
    }

    determineSkipReason(playDuration, totalDuration) {
        const playPercentage = playDuration / totalDuration;
        
        if (playPercentage < 0.2) return 'early_skip';
        if (playPercentage < 0.5) return 'mid_skip';
        return 'late_skip';
    }

    // Get recommendations based on user preferences
    getPersonalizedRecommendationWeights(userId, guildId) {
        const topGenres = this.getUserTopGenres(userId, guildId);
        const topArtists = this.getUserTopArtists(userId, guildId);
        const patterns = this.getListeningPatterns(userId, guildId);
        const antiRecs = this.getAntiRecommendations(userId, guildId);

        return {
            preferredGenres: topGenres,
            preferredArtists: topArtists,
            patterns: patterns,
            avoid: antiRecs,
            similarUsers: this.getSimilarUsers(userId, guildId)
        };
    }
}

module.exports = UserPreferences;