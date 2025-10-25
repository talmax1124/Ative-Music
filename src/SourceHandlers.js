const DiscordPlayerManager = require('./DiscordPlayerManager');
const DirectStreamManager = require('./DirectStreamManager');

/**
 * SourceHandlers using Discord Player with DirectStream fallback
 * Multi-tier approach: Discord Player -> DirectStream -> Engine fallback
 */
class SourceHandlers {
    constructor(client) {
        this.client = client;
        this.discordPlayer = null;
        this.directStream = null;
        this.audioProcessor = null; // Removed for streaming-only mode
        this.initializeManagers();
    }

    async initializeManagers() {
        // Initialize Discord Player
        if (!this.discordPlayer && this.client) {
            this.discordPlayer = new DiscordPlayerManager(this.client);
        }
        
        // Initialize DirectStream fallback
        if (!this.directStream) {
            this.directStream = new DirectStreamManager();
        }
    }

    async initializeDiscordPlayer() {
        return this.initializeManagers();
    }

    async search(query, limit = 10) {
        await this.initializeManagers();
        
        try {
            // Try Discord Player first (SoundCloud priority)
            const results = await this.discordPlayer.search(query, limit);
            if (results && results.length > 0) {
                return results;
            }
        } catch (discordPlayerError) {
            console.warn(`⚠️ Discord Player search failed: ${discordPlayerError.message}`);
        }
        
        try {
            // Fallback to DirectStream (play-dl)
            console.log(`🔄 Falling back to DirectStream search...`);
            return await this.directStream.search(query, limit);
        } catch (directStreamError) {
            console.error(`❌ DirectStream search failed: ${directStreamError.message}`);
            return [];
        }
    }

    async getStream(track, options = {}) {
        await this.initializeManagers();
        
        try {
            // Try Discord Player first
            return await this.discordPlayer.getStream(track, options);
        } catch (discordPlayerError) {
            console.warn(`⚠️ Discord Player stream failed: ${discordPlayerError.message}`);
            
            try {
                // Fallback to DirectStream
                console.log(`🔄 Falling back to DirectStream...`);
                return await this.directStream.getStream(track);
            } catch (directStreamError) {
                console.error(`❌ DirectStream failed: ${directStreamError.message}`);
                throw directStreamError;
            }
        }
    }

    async resolveForPlayback(track) {
        // In discord-player mode, just return the track as is
        return track;
    }

    async handleURL(url) {
        await this.initializeManagers();
        
        try {
            // Try Discord Player first
            const result = await this.discordPlayer.handleURL(url);
            if (result) {
                return result;
            }
        } catch (discordPlayerError) {
            console.warn(`⚠️ Discord Player URL handling failed: ${discordPlayerError.message}`);
        }
        
        try {
            // Fallback to DirectStream
            console.log(`🔄 Falling back to DirectStream URL handling...`);
            return await this.directStream.handleURL(url);
        } catch (directStreamError) {
            console.error(`❌ DirectStream URL handling failed: ${directStreamError.message}`);
            return null;
        }
    }

    async playTrack(voiceChannel, track, options = {}) {
        await this.initializeDiscordPlayer();
        return await this.discordPlayer.playTrack(voiceChannel, track, options);
    }

    getQueue(guildId) {
        if (this.discordPlayer) {
            return this.discordPlayer.getQueue(guildId);
        }
        return null;
    }

    getSystemStatus() {
        try {
            const discordPlayerStatus = this.discordPlayer ? this.discordPlayer.getSystemStatus() : { initialized: false };
            const directStreamStatus = this.directStream ? this.directStream.getStatus() : { initialized: false };
            
            return {
                discordPlayer: discordPlayerStatus,
                directStream: directStreamStatus,
                multiTier: true,
                totalSystems: 2
            };
        } catch (error) {
            console.error('❌ getSystemStatus error:', error.message);
            return {
                error: error.message,
                multiTier: true,
                totalSystems: 2
            };
        }
    }

    // Legacy methods that are no longer needed in streaming-only mode
    getSpotifyPlaylist() {
        console.log('⚠️ Spotify playlist support removed in streaming-only mode');
        return [];
    }

    getYouTubePlaylist() {
        console.log('⚠️ YouTube playlist support removed in streaming-only mode');
        return [];
    }

    searchYouTubePlaylist() {
        console.log('⚠️ YouTube playlist search removed in streaming-only mode');
        return [];
    }

    searchYouTubePlaylistByName() {
        console.log('⚠️ YouTube playlist search removed in streaming-only mode');
        return [];
    }

    clearStreamCache() {
        // No cache in streaming-only mode
    }

    async cleanup() {
        if (this.discordPlayer) {
            await this.discordPlayer.cleanup();
        }
        if (this.directStream) {
            this.directStream.cleanup();
        }
    }
}

module.exports = SourceHandlers;