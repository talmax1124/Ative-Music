const axios = require('axios');

class AIRecommendationService {
    constructor() {
        this.openaiApiKey = process.env.OPENAI_API_KEY;
        this.enabled = Boolean(this.openaiApiKey);
        this.baseURL = 'https://api.openai.com/v1/chat/completions';
        
        // Cache for recommendations to avoid redundant API calls
        this.cache = new Map();
        this.cacheTimeout = 30 * 60 * 1000; // 30 minutes
        this.maxRetries = 2;
        this.retryDelay = 1500; // milliseconds
        
        if (!this.enabled) {
            console.log('⚠️ OpenAI API key not provided - AI recommendations disabled');
        } else {
            console.log('🤖 AI-powered recommendations enabled');
        }
    }

    async getSmartRecommendations(currentTrack, playHistory = [], userContext = {}) {
        if (!this.enabled) {
            return null;
        }

        try {
            const cacheKey = this.generateCacheKey(currentTrack, playHistory);
            const cached = this.cache.get(cacheKey);
            
            if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
                console.log('🤖 Using cached AI recommendations');
                return cached.recommendations;
            }

            console.log('🤖 Getting AI-powered recommendations...');
            
            const prompt = this.buildRecommendationPrompt(currentTrack, playHistory, userContext);
            const recommendations = await this.queryOpenAI(prompt);
            
            if (recommendations && recommendations.length > 0) {
                this.cache.set(cacheKey, {
                    recommendations,
                    timestamp: Date.now()
                });
                
                console.log(`🤖 AI generated ${recommendations.length} smart recommendations`);
                return recommendations;
            }
            
            return null;
        } catch (error) {
            console.error('❌ AI recommendation error:', error.message);
            return null;
        }
    }

    buildRecommendationPrompt(currentTrack, playHistory, userContext) {
        const recentTracks = playHistory.slice(-5).map(track => 
            `"${track.title}" by ${track.author}`
        ).join(', ');

        const currentSong = `"${currentTrack.title}" by ${currentTrack.author}`;
        
        // Analyze listening patterns
        const genres = this.extractGenresFromHistory(playHistory);
        const artists = this.extractArtistsFromHistory(playHistory);
        const timeContext = this.getTimeContext();
        
        return `You are a professional music curator with deep knowledge of all genres, artists, and music trends. 

CURRENT CONTEXT:
- Currently playing: ${currentSong}
- Recent listening history: ${recentTracks || 'None'}
- Time: ${timeContext}
- Detected genres: ${genres.join(', ') || 'Unknown'}
- Frequent artists: ${artists.slice(0, 3).join(', ') || 'None'}

TASK: Recommend 8-10 songs that would naturally follow "${currentSong}" in a playlist.

REQUIREMENTS:
1. Songs should have good musical flow and continuity
2. Consider tempo, mood, and energy levels
3. Include both similar and complementary tracks
4. Mix familiar and discovery tracks (70% similar style, 30% exploration)
5. Avoid repeating artists from recent history unless they're a perfect fit
6. Consider the time of day and listening context
7. Ensure recommendations are real, popular songs that exist

RESPONSE FORMAT (JSON only):
{
  "recommendations": [
    {
      "title": "Song Title",
      "artist": "Artist Name",
      "reason": "Brief explanation for the recommendation",
      "similarity": 0.8,
      "energy": "medium"
    }
  ]
}

Focus on creating a cohesive musical journey that feels natural and engaging.`;
    }

    async queryOpenAI(prompt, attempt = 1) {
        try {
            const response = await axios.post(this.baseURL, {
                model: 'gpt-4o-mini', // Use the faster, cheaper model for music recommendations
                messages: [
                    {
                        role: 'system',
                        content: 'You are a world-class music curator and AI DJ. Respond only with valid JSON.'
                    },
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                temperature: 0.7,
                max_tokens: 1500,
                response_format: { type: 'json_object' }
            }, {
                headers: {
                    'Authorization': `Bearer ${this.openaiApiKey}`,
                    'Content-Type': 'application/json'
                },
                timeout: 20000
            });

            const result = response.data?.choices?.[0]?.message?.content;
            if (!result) {
                throw new Error('OpenAI response missing content');
            }

            let parsed;
            try {
                parsed = JSON.parse(result);
            } catch (parseError) {
                console.error('❌ OpenAI response parse error:', parseError.message);
                throw parseError;
            }
            
            const recommendations = Array.isArray(parsed.recommendations) ? parsed.recommendations : [];
            return recommendations;
        } catch (error) {
            if (this.shouldRetry(error) && attempt <= this.maxRetries) {
                const delay = this.retryDelay * attempt;
                const nextAttempt = attempt + 1;
                console.log(`🔁 OpenAI request retry ${nextAttempt}/${this.maxRetries + 1} in ${delay}ms`);
                await new Promise(resolve => setTimeout(resolve, delay));
                return this.queryOpenAI(prompt, nextAttempt);
            }

            if (error.response) {
                console.error('❌ OpenAI API error:', error.response.status, error.response.data);
            } else {
                console.error('❌ OpenAI request error:', error.message);
            }
            throw error;
        }
    }

    shouldRetry(error) {
        if (!error) return false;
        if (error.code === 'ECONNABORTED') return true;
        const status = error.response?.status;
        return [408, 425, 429, 500, 502, 503, 504].includes(status);
    }

    extractGenresFromHistory(playHistory) {
        const genres = new Set();
        
        playHistory.forEach(track => {
            const title = track.title?.toLowerCase() || '';
            const author = track.author?.toLowerCase() || '';
            
            // Simple genre detection based on keywords
            if (title.includes('reggaeton') || author.includes('bad bunny') || author.includes('j balvin')) {
                genres.add('reggaeton');
            }
            if (title.includes('pop') || author.includes('taylor swift') || author.includes('ariana grande')) {
                genres.add('pop');
            }
            if (title.includes('rock') || author.includes('imagine dragons') || author.includes('foo fighters')) {
                genres.add('rock');
            }
            if (title.includes('hip hop') || title.includes('rap') || author.includes('drake')) {
                genres.add('hip-hop');
            }
            if (title.includes('electronic') || title.includes('edm') || author.includes('calvin harris')) {
                genres.add('electronic');
            }
            if (title.includes('jazz') || author.includes('miles davis')) {
                genres.add('jazz');
            }
            if (title.includes('classical') || author.includes('mozart')) {
                genres.add('classical');
            }
        });
        
        return Array.from(genres);
    }

    extractArtistsFromHistory(playHistory) {
        const artistCounts = new Map();
        
        playHistory.forEach(track => {
            const artist = track.author;
            if (artist) {
                artistCounts.set(artist, (artistCounts.get(artist) || 0) + 1);
            }
        });
        
        return Array.from(artistCounts.entries())
            .sort((a, b) => b[1] - a[1])
            .map(([artist]) => artist);
    }

    getTimeContext() {
        const hour = new Date().getHours();
        
        if (hour >= 5 && hour < 12) return 'Morning';
        if (hour >= 12 && hour < 17) return 'Afternoon';
        if (hour >= 17 && hour < 22) return 'Evening';
        return 'Night';
    }

    generateCacheKey(currentTrack, playHistory) {
        const trackKey = `${currentTrack.title}-${currentTrack.author}`;
        const historyKey = playHistory.slice(-3)
            .map(t => `${t.title}-${t.author}`)
            .join('|');
        
        return `${trackKey}::${historyKey}`;
    }

    async getGenreRecommendations(genre, currentMood = 'medium') {
        if (!this.enabled) {
            return null;
        }

        const prompt = `Recommend 5-8 popular ${genre} songs that match a ${currentMood} energy level. 

Respond with JSON format:
{
  "recommendations": [
    {
      "title": "Song Title",
      "artist": "Artist Name",
      "reason": "Why this fits the ${genre} genre and ${currentMood} mood"
    }
  ]
}`;

        try {
            return await this.queryOpenAI(prompt);
        } catch (error) {
            console.error('❌ Genre recommendation error:', error.message);
            return null;
        }
    }

    async getSimilarArtistRecommendations(artistName, avoidSongs = []) {
        if (!this.enabled) {
            return null;
        }

        const avoidList = avoidSongs.length > 0 
            ? `Avoid these songs: ${avoidSongs.join(', ')}`
            : '';

        const prompt = `Recommend 5-8 songs by artists similar to "${artistName}". Include both well-known and lesser-known artists that have a similar style or sound. ${avoidList}

Respond with JSON format:
{
  "recommendations": [
    {
      "title": "Song Title",
      "artist": "Artist Name",
      "reason": "Why this artist is similar to ${artistName}"
    }
  ]
}`;

        try {
            return await this.queryOpenAI(prompt);
        } catch (error) {
            console.error('❌ Similar artist recommendation error:', error.message);
            return null;
        }
    }

    // Cleanup cache periodically
    cleanupCache() {
        const now = Date.now();
        for (const [key, value] of this.cache.entries()) {
            if (now - value.timestamp > this.cacheTimeout) {
                this.cache.delete(key);
            }
        }
    }
}

module.exports = AIRecommendationService;
