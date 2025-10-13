const play = require('play-dl');
const { PassThrough } = require('stream');

class PlayDLEngine {
    constructor() {
        this.name = 'play-dl';
        this.priority = 1; // Highest priority (no cookies needed)
        this.initialized = false;
        this.maxRetries = 2;
        this.timeout = 15000; // 15 seconds for VPS
        
        this.userAgents = [
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36'
        ];
        
        this.initialize();
    }

    async initialize() {
        try {
            // Configure play-dl with user agent rotation
            await play.setToken({ 
                useragent: this.userAgents 
            });
            
            this.initialized = true;
            console.log('✅ play-dl engine initialized');
            return true;
        } catch (error) {
            console.warn('⚠️ play-dl engine warning:', error.message);
            this.initialized = true; // Continue anyway
            return true;
        }
    }

    async canHandle(url) {
        if (!this.initialized) return false;
        
        // play-dl supports YouTube, SoundCloud, Spotify (for search), Deezer
        return url.includes('youtube.com') || 
               url.includes('youtu.be') ||
               url.includes('soundcloud.com') ||
               url.includes('music.youtube.com');
    }

    async search(query, limit = 10) {
        if (!this.initialized) return [];

        try {
            console.log(`🔍 [${this.name}] Searching: ${query}`);
            
            const results = await play.search(query, {
                limit: Math.min(limit, 20),
                source: { youtube: 'video', soundcloud: 'tracks' }
            });

            return results.map(this.formatTrack.bind(this)).filter(Boolean);
        } catch (error) {
            console.error(`❌ [${this.name}] Search failed: ${error.message}`);
            return [];
        }
    }

    async getStream(url) {
        if (!this.initialized) throw new Error('Engine not initialized');

        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                console.log(`🎵 [${this.name}] Streaming attempt ${attempt}: ${url}`);
                
                const stream = await Promise.race([
                    play.stream(url, { 
                        discordPlayerCompatibility: true,
                        quality: 2 // Use integer for quality (2 = lowest)
                    }),
                    new Promise((_, reject) => 
                        setTimeout(() => reject(new Error('Timeout')), this.timeout)
                    )
                ]);

                if (stream && stream.stream) {
                    console.log(`✅ [${this.name}] Stream created successfully`);
                    return stream.stream;
                }

                throw new Error('Invalid stream response');
            } catch (error) {
                console.warn(`⚠️ [${this.name}] Attempt ${attempt} failed: ${error.message}`);
                if (attempt === this.maxRetries) {
                    throw new Error(`play-dl failed after ${this.maxRetries} attempts: ${error.message}`);
                }
                await this.sleep(1000 * attempt); // Progressive delay
            }
        }
    }

    async getTrackInfo(url) {
        if (!this.initialized) return null;

        try {
            const info = await Promise.race([
                play.video_basic_info(url),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Timeout')), 10000)
                )
            ]);

            return this.formatTrackInfo(info);
        } catch (error) {
            console.error(`❌ [${this.name}] Track info failed: ${error.message}`);
            return null;
        }
    }

    formatTrack(track) {
        if (track.type === 'video') {
            // YouTube result
            return {
                title: track.title,
                author: track.channel?.name || 'Unknown',
                duration: this.formatDuration(track.durationInSec),
                durationMS: track.durationInSec * 1000,
                url: track.url,
                thumbnail: track.thumbnails?.[0]?.url,
                source: 'youtube',
                engine: this.name,
                id: track.id
            };
        } else if (track.type === 'track') {
            // SoundCloud result
            return {
                title: track.title,
                author: track.user?.name || 'Unknown',
                duration: this.formatDuration(track.durationInSec),
                durationMS: track.durationInSec * 1000,
                url: track.url,
                thumbnail: track.thumbnail,
                source: 'soundcloud',
                engine: this.name,
                id: track.id
            };
        }
        return null;
    }

    formatTrackInfo(info) {
        const details = info.video_details;
        return {
            title: details.title,
            author: details.channel?.name || 'Unknown',
            duration: this.formatDuration(details.durationInSec),
            durationMS: details.durationInSec * 1000,
            url: details.url,
            thumbnail: details.thumbnails?.[0]?.url,
            source: 'youtube',
            engine: this.name,
            id: details.id,
            views: details.views
        };
    }

    formatDuration(seconds) {
        if (!seconds || seconds === 0) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    getStatus() {
        return {
            name: this.name,
            priority: this.priority,
            initialized: this.initialized,
            supports: ['youtube', 'soundcloud', 'search'],
            requiresCookies: false
        };
    }
}

module.exports = PlayDLEngine;