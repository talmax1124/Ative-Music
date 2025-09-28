const firebaseService = require('./FirebaseService.js');

class PlaylistManager {
    constructor() {
        this.firebaseService = firebaseService;
    }

    async createPlaylist(userId, guildId, name, description = '', isPublic = false) {
        try {
            const playlistId = `${userId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const playlist = {
                id: playlistId,
                name: name.trim(),
                description: description.trim(),
                owner: userId,
                guildId,
                tracks: [],
                isPublic,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                playCount: 0,
                duration: 0
            };

            await this.firebaseService.savePlaylist(userId, guildId, playlistId, playlist.tracks);
            
            console.log(`📝 Created playlist: ${name} for user ${userId}`);
            return playlist;
        } catch (error) {
            console.error('Error creating playlist:', error);
            throw error;
        }
    }

    async getUserPlaylists(userId, guildId) {
        try {
            return await this.firebaseService.getUserPlaylists(userId, guildId);
        } catch (error) {
            console.error('Error getting user playlists:', error);
            return [];
        }
    }

    async getPlaylist(userId, guildId, playlistName) {
        try {
            return await this.firebaseService.loadPlaylist(userId, guildId, playlistName);
        } catch (error) {
            return null;
        }
    }

    async addTrackToPlaylist(playlistName, track, userId, guildId) {
        try {
            const playlist = await this.getPlaylist(userId, guildId, playlistName);
            if (!playlist) {
                throw new Error('Playlist not found');
            }

            if (playlist.owner !== userId) {
                throw new Error('Permission denied: Not playlist owner');
            }

            const existingTrack = playlist.tracks.find(t => 
                t.url === track.url || (t.title === track.title && t.author === track.author)
            );

            if (existingTrack) {
                throw new Error('Track already exists in playlist');
            }

            const trackWithMeta = {
                ...track,
                addedAt: new Date().toISOString(),
                addedBy: userId
            };

            playlist.tracks.push(trackWithMeta);
            playlist.updatedAt = new Date().toISOString();
            playlist.duration = this.calculatePlaylistDuration(playlist.tracks);

            await this.firebaseService.savePlaylist(userId, guildId, playlistName, playlist.tracks);
            console.log(`➕ Added track to playlist: ${track.title} -> ${playlistName}`);
            return playlist;
        } catch (error) {
            console.error('Error adding track to playlist:', error);
            throw error;
        }
    }

    async removeTrackFromPlaylist(playlistName, trackIndex, userId, guildId) {
        try {
            const playlist = await this.getPlaylist(userId, guildId, playlistName);
            if (!playlist) {
                throw new Error('Playlist not found');
            }

            if (playlist.owner !== userId) {
                throw new Error('Permission denied: Not playlist owner');
            }

            if (trackIndex < 0 || trackIndex >= playlist.tracks.length) {
                throw new Error('Invalid track index');
            }

            const removedTrack = playlist.tracks.splice(trackIndex, 1)[0];
            playlist.updatedAt = new Date().toISOString();
            playlist.duration = this.calculatePlaylistDuration(playlist.tracks);

            await this.firebaseService.savePlaylist(userId, guildId, playlistName, playlist.tracks);
            console.log(`➖ Removed track from playlist: ${removedTrack.title} <- ${playlistName}`);
            return playlist;
        } catch (error) {
            console.error('Error removing track from playlist:', error);
            throw error;
        }
    }

    async deletePlaylist(playlistName, userId, guildId) {
        try {
            const playlist = await this.getPlaylist(userId, guildId, playlistName);
            if (!playlist) {
                throw new Error('Playlist not found');
            }

            if (playlist.owner !== userId) {
                throw new Error('Permission denied: Not playlist owner');
            }

            await this.firebaseService.deletePlaylist(userId, guildId, playlistName);
            
            console.log(`🗑️ Deleted playlist: ${playlistName}`);
            return true;
        } catch (error) {
            console.error('Error deleting playlist:', error);
            throw error;
        }
    }

    async updatePlaylist(playlistName, updates, userId, guildId) {
        try {
            const playlist = await this.getPlaylist(userId, guildId, playlistName);
            if (!playlist) {
                throw new Error('Playlist not found');
            }

            if (playlist.owner !== userId) {
                throw new Error('Permission denied: Not playlist owner');
            }

            if (updates.name) playlist.name = updates.name.trim();
            if (updates.description !== undefined) playlist.description = updates.description.trim();
            if (updates.isPublic !== undefined) playlist.isPublic = updates.isPublic;
            
            playlist.updatedAt = new Date().toISOString();

            await this.firebaseService.savePlaylist(userId, guildId, playlistName, playlist.tracks);
            console.log(`📝 Updated playlist: ${playlistName}`);
            return playlist;
        } catch (error) {
            console.error('Error updating playlist:', error);
            throw error;
        }
    }

    calculatePlaylistDuration(tracks) {
        return tracks.reduce((total, track) => {
            const duration = this.parseDuration(track.duration);
            return total + duration;
        }, 0);
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

    formatDuration(ms) {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);

        if (hours > 0) {
            return `${hours}:${(minutes % 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
        }
        return `${minutes}:${(seconds % 60).toString().padStart(2, '0')}`;
    }

    async importPlaylistFromUrl(userId, guildId, url, name = null, sourceHandlers) {
        try {
            console.log(`📥 Importing playlist from URL: ${url}`);
            
            let tracks = [];
            let playlistName = name;
            
            if (url.includes('spotify.com/playlist')) {
                const spotifyTracks = await sourceHandlers.getSpotifyPlaylist(url);
                tracks = spotifyTracks;
                playlistName = playlistName || 'Imported Spotify Playlist';
            } else if (url.includes('youtube.com') && url.includes('list=')) {
                const youtubeTracks = await sourceHandlers.getYouTubePlaylist(url);
                tracks = youtubeTracks;
                playlistName = playlistName || 'Imported YouTube Playlist';
            } else {
                throw new Error('Unsupported playlist URL format');
            }

            if (tracks.length === 0) {
                throw new Error('No tracks found in playlist');
            }

            const playlist = await this.createPlaylist(
                userId,
                guildId, 
                playlistName, 
                `Imported from ${new URL(url).hostname}`, 
                false
            );

            for (const track of tracks) {
                try {
                    await this.addTrackToPlaylist(playlistName, track, userId, guildId);
                } catch (trackError) {
                    console.log(`⚠️ Skipped track: ${track.title} - ${trackError.message}`);
                }
            }

            const finalPlaylist = await this.getPlaylist(userId, guildId, playlistName);
            console.log(`✅ Imported playlist: ${finalPlaylist.tracks.length} tracks`);
            
            return finalPlaylist;
        } catch (error) {
            console.error('Error importing playlist:', error);
            throw error;
        }
    }

    async getPublicPlaylists(guildId, limit = 20) {
        try {
            const allPlaylists = await this.firebaseService.getUserPlaylists('*', guildId);
            const publicPlaylists = allPlaylists
                .filter(p => p.isPublic)
                .map(playlist => ({
                    ...playlist,
                    tracks: undefined,
                    trackCount: playlist.tracks ? playlist.tracks.length : 0
                }))
                .sort((a, b) => (b.playCount || 0) - (a.playCount || 0))
                .slice(0, limit);
            
            return publicPlaylists;
        } catch (error) {
            console.error('Error getting public playlists:', error);
            return [];
        }
    }

    async incrementPlayCount(playlistName, userId, guildId) {
        try {
            const playlist = await this.getPlaylist(userId, guildId, playlistName);
            if (playlist) {
                playlist.playCount = (playlist.playCount || 0) + 1;
                playlist.lastPlayed = new Date().toISOString();
                await this.firebaseService.savePlaylist(userId, guildId, playlistName, playlist.tracks);
            }
        } catch (error) {
            console.error('Error incrementing play count:', error);
        }
    }
}

module.exports = PlaylistManager;