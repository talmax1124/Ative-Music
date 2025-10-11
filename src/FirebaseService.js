const admin = require('firebase-admin');

class FirebaseService {
    constructor() {
        this.db = null;
        this.initialized = false;
    }

    initialize() {
        if (this.initialized) {
            return;
        }

        try {
            const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT 
                ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
                : require('../firebase-service-account.json');

            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount),
                databaseURL: process.env.FIREBASE_DATABASE_URL
            });

            this.db = admin.firestore();
            try {
                this.db.settings({ ignoreUndefinedProperties: true });
            } catch (e) {
                // Older SDKs may not support settings here; ignore if so
            }
            this.initialized = true;
            console.log('✅ Firebase initialized successfully');
        } catch (error) {
            console.error('❌ Failed to initialize Firebase:', error.message);
            throw error;
        }
    }

    // Panel mapping persistence
    async savePanelMapping(guildId, voiceChannelId, textChannelId) {
        try {
            await this.db.collection('panelMappings').doc(`${guildId}_${voiceChannelId}`).set({
                guildId,
                voiceChannelId,
                textChannelId,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
        } catch (error) {
            console.error('❌ Failed to save panel mapping:', error);
        }
    }

    async getPanelMapping(guildId, voiceChannelId) {
        try {
            const doc = await this.db.collection('panelMappings').doc(`${guildId}_${voiceChannelId}`).get();
            if (!doc.exists) return null;
            return doc.data();
        } catch (error) {
            console.error('❌ Failed to load panel mapping:', error);
            return null;
        }
    }

    async saveQueue(guildId, channelId, queueData) {
        try {
            await this.db.collection('queues').doc(guildId).set({
                channelId,
                ...queueData,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
        } catch (error) {
            console.error('❌ Failed to save queue to Firebase:', error);
            throw error;
        }
    }

    async loadQueue(guildId) {
        try {
            const doc = await this.db.collection('queues').doc(guildId).get();
            if (!doc.exists) {
                return null;
            }
            return doc.data();
        } catch (error) {
            console.error('❌ Failed to load queue from Firebase:', error);
            throw error;
        }
    }

    async clearQueue(guildId) {
        try {
            await this.db.collection('queues').doc(guildId).delete();
        } catch (error) {
            console.error('❌ Failed to clear queue from Firebase:', error);
            throw error;
        }
    }

    async saveUserPreference(userId, guildId, trackId, preferenceData) {
        try {
            const key = `${userId}_${guildId}_${trackId}`;
            await this.db.collection('userPreferences').doc(key).set({
                userId,
                guildId,
                trackId,
                ...preferenceData,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
        } catch (error) {
            console.error('❌ Failed to save user preference to Firebase:', error);
            throw error;
        }
    }

    async getUserPreferences(userId, guildId) {
        try {
            const snapshot = await this.db.collection('userPreferences')
                .where('userId', '==', userId)
                .where('guildId', '==', guildId)
                .get();
            
            const preferences = {};
            snapshot.forEach(doc => {
                const data = doc.data();
                preferences[data.trackId] = data;
            });
            return preferences;
        } catch (error) {
            console.error('❌ Failed to load user preferences from Firebase:', error);
            throw error;
        }
    }

    async savePlaylist(userId, guildId, playlistName, tracks) {
        try {
            const key = `${userId}_${guildId}_${playlistName}`;
            await this.db.collection('playlists').doc(key).set({
                userId,
                guildId,
                playlistName,
                tracks,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
        } catch (error) {
            console.error('❌ Failed to save playlist to Firebase:', error);
            throw error;
        }
    }

    async loadPlaylist(userId, guildId, playlistName) {
        try {
            const key = `${userId}_${guildId}_${playlistName}`;
            const doc = await this.db.collection('playlists').doc(key).get();
            if (!doc.exists) {
                return null;
            }
            return doc.data();
        } catch (error) {
            console.error('❌ Failed to load playlist from Firebase:', error);
            throw error;
        }
    }

    async getUserPlaylists(userId, guildId) {
        try {
            const snapshot = await this.db.collection('playlists')
                .where('userId', '==', userId)
                .where('guildId', '==', guildId)
                .get();
            
            const playlists = [];
            snapshot.forEach(doc => {
                playlists.push(doc.data());
            });
            return playlists;
        } catch (error) {
            console.error('❌ Failed to load user playlists from Firebase:', error);
            throw error;
        }
    }

    async deletePlaylist(userId, guildId, playlistName) {
        try {
            const key = `${userId}_${guildId}_${playlistName}`;
            await this.db.collection('playlists').doc(key).delete();
        } catch (error) {
            console.error('❌ Failed to delete playlist from Firebase:', error);
            throw error;
        }
    }

    async saveListeningHistory(userId, guildId, trackData) {
        try {
            await this.db.collection('listeningHistory').add({
                userId,
                guildId,
                ...trackData,
                playedAt: admin.firestore.FieldValue.serverTimestamp()
            });
        } catch (error) {
            console.error('❌ Failed to save listening history to Firebase:', error);
        }
    }

    async getListeningHistory(userId, guildId, limit = 50) {
        try {
            const snapshot = await this.db.collection('listeningHistory')
                .where('userId', '==', userId)
                .where('guildId', '==', guildId)
                .orderBy('playedAt', 'desc')
                .limit(limit)
                .get();
            
            const history = [];
            snapshot.forEach(doc => {
                history.push(doc.data());
            });
            return history;
        } catch (error) {
            console.error('❌ Failed to load listening history from Firebase:', error);
            return [];
        }
    }

    // User playlist management
    async getUserPlaylists(userId) {
        try {
            if (!this.initialized) this.initialize();
            
            const snapshot = await this.db.collection('userPlaylists')
                .where('createdBy', '==', userId)
                .get();
            
            const playlists = [];
            snapshot.forEach(doc => {
                playlists.push({ id: doc.id, ...doc.data() });
            });
            // Sort by createdAt in descending order (client-side)
            return playlists.sort((a, b) => {
                let aTime = 0;
                let bTime = 0;
                
                // Handle different timestamp formats
                if (a.createdAt) {
                    if (typeof a.createdAt.toMillis === 'function') {
                        aTime = a.createdAt.toMillis();
                    } else if (typeof a.createdAt === 'number') {
                        aTime = a.createdAt;
                    } else if (a.createdAt instanceof Date) {
                        aTime = a.createdAt.getTime();
                    }
                }
                
                if (b.createdAt) {
                    if (typeof b.createdAt.toMillis === 'function') {
                        bTime = b.createdAt.toMillis();
                    } else if (typeof b.createdAt === 'number') {
                        bTime = b.createdAt;
                    } else if (b.createdAt instanceof Date) {
                        bTime = b.createdAt.getTime();
                    }
                }
                
                return bTime - aTime;
            });
        } catch (error) {
            console.error('❌ Failed to get user playlists from Firebase:', error);
            return [];
        }
    }

    async saveUserPlaylist(userId, playlist) {
        try {
            if (!this.initialized) this.initialize();
            
            await this.db.collection('userPlaylists').doc(playlist.id).set({
                ...playlist,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
            console.log(`✅ User playlist saved: ${playlist.name}`);
        } catch (error) {
            console.error('❌ Failed to save user playlist to Firebase:', error);
            throw error;
        }
    }

    async updateUserPlaylist(userId, playlist) {
        try {
            if (!this.initialized) this.initialize();
            
            await this.db.collection('userPlaylists').doc(playlist.id).update({
                ...playlist,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
            console.log(`✅ User playlist updated: ${playlist.name}`);
        } catch (error) {
            console.error('❌ Failed to update user playlist in Firebase:', error);
            throw error;
        }
    }

    async deleteUserPlaylist(userId, playlistId) {
        try {
            if (!this.initialized) this.initialize();
            
            await this.db.collection('userPlaylists').doc(playlistId).delete();
            console.log(`✅ User playlist deleted: ${playlistId}`);
        } catch (error) {
            console.error('❌ Failed to delete user playlist from Firebase:', error);
            throw error;
        }
    }
}

module.exports = new FirebaseService();
