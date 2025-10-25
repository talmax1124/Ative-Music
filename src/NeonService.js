const { neon } = require('@neondatabase/serverless');

class NeonService {
    constructor() {
        this.sql = null;
        this.initialized = false;
    }

    initialize() {
        if (this.initialized) {
            return;
        }

        try {
            if (!process.env.DATABASE_URL) {
                throw new Error('DATABASE_URL environment variable is required');
            }

            this.sql = neon(process.env.DATABASE_URL);
            this.initialized = true;
            console.log('✅ Neon database initialized successfully');
        } catch (error) {
            console.error('❌ Failed to initialize Neon database:', error.message);
            throw error;
        }
    }

    async createTables() {
        if (!this.initialized) this.initialize();

        try {
            // Panel mappings table
            await this.sql`
                CREATE TABLE IF NOT EXISTS panel_mappings (
                    id SERIAL PRIMARY KEY,
                    guild_id VARCHAR(20) NOT NULL,
                    voice_channel_id VARCHAR(20) NOT NULL,
                    text_channel_id VARCHAR(20) NOT NULL,
                    updated_at TIMESTAMP DEFAULT NOW(),
                    UNIQUE(guild_id, voice_channel_id)
                )
            `;

            // Queues table
            await this.sql`
                CREATE TABLE IF NOT EXISTS queues (
                    guild_id VARCHAR(20) PRIMARY KEY,
                    channel_id VARCHAR(20),
                    tracks JSONB,
                    current_track JSONB,
                    repeat_mode VARCHAR(10) DEFAULT 'off',
                    updated_at TIMESTAMP DEFAULT NOW()
                )
            `;

            // User preferences table
            await this.sql`
                CREATE TABLE IF NOT EXISTS user_preferences (
                    id SERIAL PRIMARY KEY,
                    user_id VARCHAR(20) NOT NULL,
                    guild_id VARCHAR(20) NOT NULL,
                    track_id VARCHAR(100) NOT NULL,
                    preference_data JSONB,
                    updated_at TIMESTAMP DEFAULT NOW(),
                    UNIQUE(user_id, guild_id, track_id)
                )
            `;

            // Playlists table
            await this.sql`
                CREATE TABLE IF NOT EXISTS playlists (
                    id SERIAL PRIMARY KEY,
                    user_id VARCHAR(20) NOT NULL,
                    guild_id VARCHAR(20) NOT NULL,
                    playlist_name VARCHAR(100) NOT NULL,
                    tracks JSONB,
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW(),
                    UNIQUE(user_id, guild_id, playlist_name)
                )
            `;

            // User playlists table (for web portal)
            await this.sql`
                CREATE TABLE IF NOT EXISTS user_playlists (
                    id VARCHAR(36) PRIMARY KEY,
                    created_by VARCHAR(20) NOT NULL,
                    name VARCHAR(100) NOT NULL,
                    description TEXT,
                    tracks JSONB,
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW()
                )
            `;

            // Listening history table
            await this.sql`
                CREATE TABLE IF NOT EXISTS listening_history (
                    id SERIAL PRIMARY KEY,
                    user_id VARCHAR(20) NOT NULL,
                    guild_id VARCHAR(20) NOT NULL,
                    track_data JSONB,
                    played_at TIMESTAMP DEFAULT NOW()
                )
            `;

            // Create index for listening history
            await this.sql`
                CREATE INDEX IF NOT EXISTS idx_listening_history_user_guild_time 
                ON listening_history(user_id, guild_id, played_at DESC)
            `;

            console.log('✅ Database tables created successfully');
        } catch (error) {
            console.error('❌ Failed to create database tables:', error.message);
            throw error;
        }
    }

    // Panel mapping persistence
    async savePanelMapping(guildId, voiceChannelId, textChannelId) {
        try {
            if (!this.initialized) this.initialize();
            
            await this.sql`
                INSERT INTO panel_mappings (guild_id, voice_channel_id, text_channel_id, updated_at)
                VALUES (${guildId}, ${voiceChannelId}, ${textChannelId}, NOW())
                ON CONFLICT (guild_id, voice_channel_id)
                DO UPDATE SET text_channel_id = ${textChannelId}, updated_at = NOW()
            `;
        } catch (error) {
            console.error('❌ Failed to save panel mapping:', error);
        }
    }

    async getPanelMapping(guildId, voiceChannelId) {
        try {
            if (!this.initialized) this.initialize();
            
            const result = await this.sql`
                SELECT * FROM panel_mappings 
                WHERE guild_id = ${guildId} AND voice_channel_id = ${voiceChannelId}
            `;
            return result[0] || null;
        } catch (error) {
            console.error('❌ Failed to load panel mapping:', error);
            return null;
        }
    }

    async saveQueue(guildId, channelId, queueData) {
        try {
            if (!this.initialized) this.initialize();
            
            await this.sql`
                INSERT INTO queues (guild_id, channel_id, tracks, current_track, repeat_mode, updated_at)
                VALUES (${guildId}, ${channelId}, ${JSON.stringify(queueData.tracks || [])}, 
                        ${JSON.stringify(queueData.currentTrack || null)}, 
                        ${queueData.repeatMode || 'off'}, NOW())
                ON CONFLICT (guild_id)
                DO UPDATE SET 
                    channel_id = ${channelId},
                    tracks = ${JSON.stringify(queueData.tracks || [])},
                    current_track = ${JSON.stringify(queueData.currentTrack || null)},
                    repeat_mode = ${queueData.repeatMode || 'off'},
                    updated_at = NOW()
            `;
        } catch (error) {
            console.error('❌ Failed to save queue to database:', error);
            throw error;
        }
    }

    async loadQueue(guildId) {
        try {
            if (!this.initialized) this.initialize();
            
            const result = await this.sql`
                SELECT * FROM queues WHERE guild_id = ${guildId}
            `;
            
            if (result.length === 0) {
                return null;
            }
            
            const queue = result[0];
            return {
                channelId: queue.channel_id,
                tracks: queue.tracks || [],
                currentTrack: queue.current_track,
                repeatMode: queue.repeat_mode,
                updatedAt: queue.updated_at
            };
        } catch (error) {
            console.error('❌ Failed to load queue from database:', error);
            throw error;
        }
    }

    async clearQueue(guildId) {
        try {
            if (!this.initialized) this.initialize();
            
            await this.sql`DELETE FROM queues WHERE guild_id = ${guildId}`;
        } catch (error) {
            console.error('❌ Failed to clear queue from database:', error);
            throw error;
        }
    }

    async saveUserPreference(userId, guildId, trackId, preferenceData) {
        try {
            if (!this.initialized) this.initialize();
            
            await this.sql`
                INSERT INTO user_preferences (user_id, guild_id, track_id, preference_data, updated_at)
                VALUES (${userId}, ${guildId}, ${trackId}, ${JSON.stringify(preferenceData)}, NOW())
                ON CONFLICT (user_id, guild_id, track_id)
                DO UPDATE SET preference_data = ${JSON.stringify(preferenceData)}, updated_at = NOW()
            `;
        } catch (error) {
            console.error('❌ Failed to save user preference to database:', error);
            throw error;
        }
    }

    async getUserPreferences(userId, guildId) {
        try {
            if (!this.initialized) this.initialize();
            
            const result = await this.sql`
                SELECT * FROM user_preferences 
                WHERE user_id = ${userId} AND guild_id = ${guildId}
            `;
            
            const preferences = {};
            result.forEach(row => {
                preferences[row.track_id] = {
                    userId: row.user_id,
                    guildId: row.guild_id,
                    trackId: row.track_id,
                    ...row.preference_data,
                    updatedAt: row.updated_at
                };
            });
            return preferences;
        } catch (error) {
            console.error('❌ Failed to load user preferences from database:', error);
            throw error;
        }
    }

    async savePlaylist(userId, guildId, playlistName, tracks) {
        try {
            if (!this.initialized) this.initialize();
            
            await this.sql`
                INSERT INTO playlists (user_id, guild_id, playlist_name, tracks, created_at, updated_at)
                VALUES (${userId}, ${guildId}, ${playlistName}, ${JSON.stringify(tracks)}, NOW(), NOW())
                ON CONFLICT (user_id, guild_id, playlist_name)
                DO UPDATE SET tracks = ${JSON.stringify(tracks)}, updated_at = NOW()
            `;
        } catch (error) {
            console.error('❌ Failed to save playlist to database:', error);
            throw error;
        }
    }

    async loadPlaylist(userId, guildId, playlistName) {
        try {
            if (!this.initialized) this.initialize();
            
            const result = await this.sql`
                SELECT * FROM playlists 
                WHERE user_id = ${userId} AND guild_id = ${guildId} AND playlist_name = ${playlistName}
            `;
            
            if (result.length === 0) {
                return null;
            }
            
            const playlist = result[0];
            return {
                userId: playlist.user_id,
                guildId: playlist.guild_id,
                playlistName: playlist.playlist_name,
                tracks: playlist.tracks,
                createdAt: playlist.created_at,
                updatedAt: playlist.updated_at
            };
        } catch (error) {
            console.error('❌ Failed to load playlist from database:', error);
            throw error;
        }
    }

    async getUserPlaylists(userId, guildId) {
        try {
            if (!this.initialized) this.initialize();
            
            const result = await this.sql`
                SELECT * FROM playlists 
                WHERE user_id = ${userId} AND guild_id = ${guildId}
                ORDER BY created_at DESC
            `;
            
            return result.map(playlist => ({
                userId: playlist.user_id,
                guildId: playlist.guild_id,
                playlistName: playlist.playlist_name,
                tracks: playlist.tracks,
                createdAt: playlist.created_at,
                updatedAt: playlist.updated_at
            }));
        } catch (error) {
            console.error('❌ Failed to load user playlists from database:', error);
            throw error;
        }
    }

    async deletePlaylist(userId, guildId, playlistName) {
        try {
            if (!this.initialized) this.initialize();
            
            await this.sql`
                DELETE FROM playlists 
                WHERE user_id = ${userId} AND guild_id = ${guildId} AND playlist_name = ${playlistName}
            `;
        } catch (error) {
            console.error('❌ Failed to delete playlist from database:', error);
            throw error;
        }
    }

    async saveListeningHistory(userId, guildId, trackData) {
        try {
            if (!this.initialized) this.initialize();
            
            await this.sql`
                INSERT INTO listening_history (user_id, guild_id, track_data, played_at)
                VALUES (${userId}, ${guildId}, ${JSON.stringify(trackData)}, NOW())
            `;
        } catch (error) {
            console.error('❌ Failed to save listening history to database:', error);
        }
    }

    async getListeningHistory(userId, guildId, limit = 50) {
        try {
            if (!this.initialized) this.initialize();
            
            const result = await this.sql`
                SELECT * FROM listening_history 
                WHERE user_id = ${userId} AND guild_id = ${guildId}
                ORDER BY played_at DESC
                LIMIT ${limit}
            `;
            
            return result.map(row => ({
                userId: row.user_id,
                guildId: row.guild_id,
                ...row.track_data,
                playedAt: row.played_at
            }));
        } catch (error) {
            console.error('❌ Failed to load listening history from database:', error);
            return [];
        }
    }

    // User playlist management (for web portal)
    async getUserPlaylists(userId) {
        try {
            if (!this.initialized) this.initialize();
            
            const result = await this.sql`
                SELECT * FROM user_playlists 
                WHERE created_by = ${userId}
                ORDER BY created_at DESC
            `;
            
            return result.map(playlist => ({
                id: playlist.id,
                createdBy: playlist.created_by,
                name: playlist.name,
                description: playlist.description,
                tracks: playlist.tracks,
                createdAt: playlist.created_at,
                updatedAt: playlist.updated_at
            }));
        } catch (error) {
            console.error('❌ Failed to get user playlists from database:', error);
            return [];
        }
    }

    async saveUserPlaylist(userId, playlist) {
        try {
            if (!this.initialized) this.initialize();
            
            await this.sql`
                INSERT INTO user_playlists (id, created_by, name, description, tracks, created_at, updated_at)
                VALUES (${playlist.id}, ${userId}, ${playlist.name}, ${playlist.description || ''},
                        ${JSON.stringify(playlist.tracks || [])}, NOW(), NOW())
                ON CONFLICT (id)
                DO UPDATE SET 
                    name = ${playlist.name},
                    description = ${playlist.description || ''},
                    tracks = ${JSON.stringify(playlist.tracks || [])},
                    updated_at = NOW()
            `;
            console.log(`✅ User playlist saved: ${playlist.name}`);
        } catch (error) {
            console.error('❌ Failed to save user playlist to database:', error);
            throw error;
        }
    }

    async updateUserPlaylist(userId, playlist) {
        try {
            if (!this.initialized) this.initialize();
            
            await this.sql`
                UPDATE user_playlists 
                SET name = ${playlist.name},
                    description = ${playlist.description || ''},
                    tracks = ${JSON.stringify(playlist.tracks || [])},
                    updated_at = NOW()
                WHERE id = ${playlist.id} AND created_by = ${userId}
            `;
            console.log(`✅ User playlist updated: ${playlist.name}`);
        } catch (error) {
            console.error('❌ Failed to update user playlist in database:', error);
            throw error;
        }
    }

    async deleteUserPlaylist(userId, playlistId) {
        try {
            if (!this.initialized) this.initialize();
            
            await this.sql`
                DELETE FROM user_playlists 
                WHERE id = ${playlistId} AND created_by = ${userId}
            `;
            console.log(`✅ User playlist deleted: ${playlistId}`);
        } catch (error) {
            console.error('❌ Failed to delete user playlist from database:', error);
            throw error;
        }
    }
}

module.exports = new NeonService();