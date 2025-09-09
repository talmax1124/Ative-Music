const { promises: fs } = require('fs');
const path = require('path');

class PlaylistManager {
    constructor() {
        this.playlistsDir = path.join(__dirname, '../data/playlists');
        this.userPlaylistsDir = path.join(__dirname, '../data/user_playlists');
        this.ensureDirectories();
    }

    async ensureDirectories() {
        try {
            await fs.mkdir(this.playlistsDir, { recursive: true });
            await fs.mkdir(this.userPlaylistsDir, { recursive: true });
        } catch (error) {
            console.error('Failed to create playlist directories:', error);
        }
    }

    // Create a new playlist
    async createPlaylist(userId, name, description = '', isPublic = false) {
        try {
            const playlistId = `${userId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const playlist = {
                id: playlistId,
                name: name.trim(),
                description: description.trim(),
                owner: userId,
                tracks: [],
                isPublic,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                playCount: 0,
                duration: 0
            };

            const filePath = path.join(this.userPlaylistsDir, `${playlistId}.json`);
            await fs.writeFile(filePath, JSON.stringify(playlist, null, 2));
            
            console.log(`📝 Created playlist: ${name} for user ${userId}`);
            return playlist;
        } catch (error) {
            console.error('Error creating playlist:', error);
            throw error;
        }
    }

    // Get user's playlists
    async getUserPlaylists(userId) {
        try {
            const files = await fs.readdir(this.userPlaylistsDir);
            const userPlaylists = [];

            for (const file of files) {
                if (file.startsWith(`${userId}_`) && file.endsWith('.json')) {
                    try {
                        const data = await fs.readFile(path.join(this.userPlaylistsDir, file), 'utf8');
                        const playlist = JSON.parse(data);
                        userPlaylists.push(playlist);
                    } catch (parseError) {
                        console.error(`Error parsing playlist file ${file}:`, parseError);
                    }
                }
            }

            // Sort by most recently updated
            return userPlaylists.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
        } catch (error) {
            console.error('Error getting user playlists:', error);
            return [];
        }
    }

    // Get a specific playlist
    async getPlaylist(playlistId) {
        try {
            const filePath = path.join(this.userPlaylistsDir, `${playlistId}.json`);
            const data = await fs.readFile(filePath, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            return null;
        }
    }

    // Add track to playlist
    async addTrackToPlaylist(playlistId, track, userId) {
        try {
            const playlist = await this.getPlaylist(playlistId);
            if (!playlist) {
                throw new Error('Playlist not found');
            }

            // Check ownership
            if (playlist.owner !== userId) {
                throw new Error('Permission denied: Not playlist owner');
            }

            // Check for duplicates
            const existingTrack = playlist.tracks.find(t => 
                t.url === track.url || (t.title === track.title && t.author === track.author)
            );

            if (existingTrack) {
                throw new Error('Track already exists in playlist');
            }

            // Add track with metadata
            const trackWithMeta = {
                ...track,
                addedAt: new Date().toISOString(),
                addedBy: userId
            };

            playlist.tracks.push(trackWithMeta);
            playlist.updatedAt = new Date().toISOString();
            playlist.duration = this.calculatePlaylistDuration(playlist.tracks);

            await this.savePlaylist(playlist);
            console.log(`➕ Added track to playlist: ${track.title} -> ${playlist.name}`);
            return playlist;
        } catch (error) {
            console.error('Error adding track to playlist:', error);
            throw error;
        }
    }

    // Remove track from playlist
    async removeTrackFromPlaylist(playlistId, trackIndex, userId) {
        try {
            const playlist = await this.getPlaylist(playlistId);
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

            await this.savePlaylist(playlist);
            console.log(`➖ Removed track from playlist: ${removedTrack.title} <- ${playlist.name}`);
            return playlist;
        } catch (error) {
            console.error('Error removing track from playlist:', error);
            throw error;
        }
    }

    // Delete playlist
    async deletePlaylist(playlistId, userId) {
        try {
            const playlist = await this.getPlaylist(playlistId);
            if (!playlist) {
                throw new Error('Playlist not found');
            }

            if (playlist.owner !== userId) {
                throw new Error('Permission denied: Not playlist owner');
            }

            const filePath = path.join(this.userPlaylistsDir, `${playlistId}.json`);
            await fs.unlink(filePath);
            
            console.log(`🗑️ Deleted playlist: ${playlist.name}`);
            return true;
        } catch (error) {
            console.error('Error deleting playlist:', error);
            throw error;
        }
    }

    // Update playlist info
    async updatePlaylist(playlistId, updates, userId) {
        try {
            const playlist = await this.getPlaylist(playlistId);
            if (!playlist) {
                throw new Error('Playlist not found');
            }

            if (playlist.owner !== userId) {
                throw new Error('Permission denied: Not playlist owner');
            }

            // Update allowed fields
            if (updates.name) playlist.name = updates.name.trim();
            if (updates.description !== undefined) playlist.description = updates.description.trim();
            if (updates.isPublic !== undefined) playlist.isPublic = updates.isPublic;
            
            playlist.updatedAt = new Date().toISOString();

            await this.savePlaylist(playlist);
            console.log(`📝 Updated playlist: ${playlist.name}`);
            return playlist;
        } catch (error) {
            console.error('Error updating playlist:', error);
            throw error;
        }
    }

    // Save playlist to file
    async savePlaylist(playlist) {
        const filePath = path.join(this.userPlaylistsDir, `${playlist.id}.json`);
        await fs.writeFile(filePath, JSON.stringify(playlist, null, 2));
    }

    // Calculate total playlist duration
    calculatePlaylistDuration(tracks) {
        return tracks.reduce((total, track) => {
            const duration = this.parseDuration(track.duration);
            return total + duration;
        }, 0);
    }

    // Parse duration to milliseconds
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

    // Format duration from milliseconds
    formatDuration(ms) {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);

        if (hours > 0) {
            return `${hours}:${(minutes % 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
        }
        return `${minutes}:${(seconds % 60).toString().padStart(2, '0')}`;
    }

    // Import playlist from URL (Spotify, YouTube, etc.)
    async importPlaylistFromUrl(userId, url, name = null, sourceHandlers) {
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

            // Create the playlist
            const playlist = await this.createPlaylist(
                userId, 
                playlistName, 
                `Imported from ${new URL(url).hostname}`, 
                false
            );

            // Add all tracks
            for (const track of tracks) {
                try {
                    await this.addTrackToPlaylist(playlist.id, track, userId);
                } catch (trackError) {
                    console.log(`⚠️ Skipped track: ${track.title} - ${trackError.message}`);
                }
            }

            const finalPlaylist = await this.getPlaylist(playlist.id);
            console.log(`✅ Imported playlist: ${finalPlaylist.tracks.length} tracks`);
            
            return finalPlaylist;
        } catch (error) {
            console.error('Error importing playlist:', error);
            throw error;
        }
    }

    // Get public playlists for browsing
    async getPublicPlaylists(limit = 20) {
        try {
            const files = await fs.readdir(this.userPlaylistsDir);
            const publicPlaylists = [];

            for (const file of files) {
                if (file.endsWith('.json')) {
                    try {
                        const data = await fs.readFile(path.join(this.userPlaylistsDir, file), 'utf8');
                        const playlist = JSON.parse(data);
                        if (playlist.isPublic) {
                            // Remove tracks for browsing (just metadata)
                            publicPlaylists.push({
                                ...playlist,
                                tracks: undefined,
                                trackCount: playlist.tracks.length
                            });
                        }
                    } catch (parseError) {
                        console.error(`Error parsing playlist file ${file}:`, parseError);
                    }
                }
            }

            // Sort by play count and recent activity
            return publicPlaylists
                .sort((a, b) => (b.playCount || 0) - (a.playCount || 0))
                .slice(0, limit);
        } catch (error) {
            console.error('Error getting public playlists:', error);
            return [];
        }
    }

    // Increment play count
    async incrementPlayCount(playlistId) {
        try {
            const playlist = await this.getPlaylist(playlistId);
            if (playlist) {
                playlist.playCount = (playlist.playCount || 0) + 1;
                playlist.lastPlayed = new Date().toISOString();
                await this.savePlaylist(playlist);
            }
        } catch (error) {
            console.error('Error incrementing play count:', error);
        }
    }
}

module.exports = PlaylistManager;