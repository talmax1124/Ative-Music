const { getLyrics, getSong } = require('genius-lyrics');
const fetch = require('node-fetch');

class LyricsHandler {
    constructor() {
        this.geniusApiKey = process.env.GENIUS_ACCESS_TOKEN || '';
        this.cache = new Map();
        this.maxCacheSize = 100;
        this.cacheExpiration = 24 * 60 * 60 * 1000; // 24 hours
    }

    async searchByLyrics(lyricsFragment, limit = 5) {
        console.log(`🔍 Searching songs by lyrics: "${lyricsFragment}"`);
        
        try {
            if (!this.geniusApiKey) {
                throw new Error('Genius API key not configured');
            }

            const searchUrl = `https://api.genius.com/search?q=${encodeURIComponent(lyricsFragment)}`;
            const response = await fetch(searchUrl, {
                headers: {
                    'Authorization': `Bearer ${this.geniusApiKey}`,
                    'User-Agent': 'Ative Music Bot'
                }
            });

            if (!response.ok) {
                throw new Error(`Genius API error: ${response.status}`);
            }

            const data = await response.json();
            const songs = data.response.hits.slice(0, limit).map(hit => ({
                title: hit.result.title,
                artist: hit.result.primary_artist.name,
                url: hit.result.url,
                thumbnail: hit.result.song_art_image_url,
                id: hit.result.id,
                fullTitle: hit.result.full_title
            }));

            console.log(`✅ Found ${songs.length} songs matching lyrics`);
            return songs;

        } catch (error) {
            console.error('❌ Lyrics search error:', error.message);
            
            // Fallback: try a simple web search approach
            return await this.fallbackLyricsSearch(lyricsFragment, limit);
        }
    }

    async getLyricsForSong(songTitle, artistName = '') {
        console.log(`🎵 Getting lyrics for: "${songTitle}" by "${artistName}"`);
        
        const cacheKey = `${songTitle}-${artistName}`.toLowerCase();
        
        // Check cache first
        const cached = this.cache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < this.cacheExpiration) {
            console.log('📋 Retrieved lyrics from cache');
            return cached.data;
        }

        try {
            // Try genius-lyrics package first
            const searchQuery = artistName ? `${songTitle} ${artistName}` : songTitle;
            const song = await getSong(searchQuery);
            
            if (song) {
                const lyrics = await getLyrics(song.url);
                if (lyrics && lyrics.trim()) {
                    const result = {
                        title: song.title,
                        artist: song.artist,
                        lyrics: lyrics,
                        url: song.url,
                        thumbnail: song.image,
                        source: 'genius'
                    };
                    
                    this.cacheResult(cacheKey, result);
                    console.log('✅ Retrieved lyrics from Genius');
                    return result;
                }
            }
        } catch (error) {
            console.log('⚠️ Genius package failed, trying API approach');
        }

        try {
            // Fallback: try direct API search
            if (!this.geniusApiKey) {
                throw new Error('Genius API key not configured');
            }

            const searchQuery = artistName ? `${songTitle} ${artistName}` : songTitle;
            const searchUrl = `https://api.genius.com/search?q=${encodeURIComponent(searchQuery)}`;
            
            const response = await fetch(searchUrl, {
                headers: {
                    'Authorization': `Bearer ${this.geniusApiKey}`,
                    'User-Agent': 'Ative Music Bot'
                }
            });

            if (!response.ok) {
                throw new Error(`Genius API error: ${response.status}`);
            }

            const data = await response.json();
            
            if (data.response.hits.length > 0) {
                const bestMatch = this.findBestLyricsMatch(songTitle, artistName, data.response.hits);
                if (bestMatch) {
                    const lyricsUrl = bestMatch.result.url;
                    const lyrics = await this.scrapeLyricsFromGenius(lyricsUrl);
                    
                    if (lyrics) {
                        const result = {
                            title: bestMatch.result.title,
                            artist: bestMatch.result.primary_artist.name,
                            lyrics: lyrics,
                            url: lyricsUrl,
                            thumbnail: bestMatch.result.song_art_image_url,
                            source: 'genius'
                        };
                        
                        this.cacheResult(cacheKey, result);
                        console.log('✅ Retrieved lyrics via API scraping');
                        return result;
                    }
                }
            }

            throw new Error('No lyrics found');

        } catch (error) {
            console.error('❌ Lyrics retrieval error:', error.message);
            return null;
        }
    }

    findBestLyricsMatch(songTitle, artistName, hits) {
        const titleLower = songTitle.toLowerCase();
        const artistLower = artistName.toLowerCase();
        
        // Find exact matches first
        for (const hit of hits) {
            const resultTitle = hit.result.title.toLowerCase();
            const resultArtist = hit.result.primary_artist.name.toLowerCase();
            
            if (resultTitle === titleLower && (!artistName || resultArtist === artistLower)) {
                return hit;
            }
        }
        
        // Find close matches
        for (const hit of hits) {
            const resultTitle = hit.result.title.toLowerCase();
            const resultArtist = hit.result.primary_artist.name.toLowerCase();
            
            const titleMatch = resultTitle.includes(titleLower) || titleLower.includes(resultTitle);
            const artistMatch = !artistName || resultArtist.includes(artistLower) || artistLower.includes(resultArtist);
            
            if (titleMatch && artistMatch) {
                return hit;
            }
        }
        
        // Return first result as fallback
        return hits[0] || null;
    }

    async scrapeLyricsFromGenius(url) {
        try {
            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            const html = await response.text();
            
            // Extract lyrics from Genius page HTML
            const lyricsRegex = /<div[^>]*data-lyrics-container[^>]*>(.*?)<\/div>/gis;
            let lyrics = '';
            let match;
            
            while ((match = lyricsRegex.exec(html)) !== null) {
                lyrics += match[1];
            }
            
            if (!lyrics) {
                // Try alternative method
                const altRegex = /<div[^>]*class="[^"]*lyrics[^"]*"[^>]*>(.*?)<\/div>/gis;
                while ((match = altRegex.exec(html)) !== null) {
                    lyrics += match[1];
                }
            }
            
            if (lyrics) {
                // Clean up HTML tags and decode entities
                lyrics = lyrics
                    .replace(/<br\s*\/?>/gi, '\n')
                    .replace(/<\/div>\s*<div[^>]*>/gi, '\n')
                    .replace(/<[^>]*>/g, '')
                    .replace(/&amp;/g, '&')
                    .replace(/&lt;/g, '<')
                    .replace(/&gt;/g, '>')
                    .replace(/&quot;/g, '"')
                    .replace(/&#x27;/g, "'")
                    .replace(/\s+/g, ' ')
                    .trim();
                
                return lyrics;
            }
            
            return null;
            
        } catch (error) {
            console.error('❌ Lyrics scraping error:', error.message);
            return null;
        }
    }

    async fallbackLyricsSearch(lyricsFragment, limit = 5) {
        console.log('🔄 Using fallback lyrics search');
        
        try {
            // Simple approach: search for songs with lyrics fragment in title/artist
            // This is a basic fallback - in production you might want to use other APIs
            const searchTerms = lyricsFragment.split(' ').slice(0, 3).join(' '); // Take first 3 words
            
            return [{
                title: `Search: "${searchTerms}"`,
                artist: 'Various Artists',
                url: `https://genius.com/search?q=${encodeURIComponent(lyricsFragment)}`,
                thumbnail: null,
                id: 'fallback',
                fullTitle: `Lyrics search for: ${lyricsFragment}`
            }];
            
        } catch (error) {
            console.error('❌ Fallback search error:', error.message);
            return [];
        }
    }

    cacheResult(key, data) {
        // Implement simple LRU cache
        if (this.cache.size >= this.maxCacheSize) {
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
        }
        
        this.cache.set(key, {
            data: data,
            timestamp: Date.now()
        });
    }

    formatLyricsForDiscord(lyrics, maxLength = 4000) {
        if (!lyrics || lyrics.length <= maxLength) {
            return lyrics;
        }
        
        // Try to split at a line break near the limit
        const truncatePoint = lyrics.lastIndexOf('\n', maxLength - 100);
        if (truncatePoint > maxLength / 2) {
            return lyrics.substring(0, truncatePoint) + '\n\n... (lyrics truncated)';
        }
        
        // Fallback: hard truncate
        return lyrics.substring(0, maxLength - 20) + '... (truncated)';
    }
}

module.exports = LyricsHandler;