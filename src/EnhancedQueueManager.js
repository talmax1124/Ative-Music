const neonService = require('./NeonService');

class EnhancedQueueManager {
    constructor(guildId, channelId) {
        this.guildId = guildId;
        this.channelId = channelId;
        this.queue = [];
        this.currentTrack = null;
        this.currentIndex = -1;
        this.history = [];
        this.shuffledIndices = [];
        this.originalQueue = [];
        
        // Queue modes
        this.repeatMode = 'off'; // 'off', 'track', 'queue'
        this.shuffleMode = false;
        this.autoplayMode = true;
        
        // Queue metadata
        this.totalDuration = 0;
        this.estimatedTimeToComplete = 0;
        this.queueCreatedAt = Date.now();
        this.lastModified = Date.now();
        
        // Event listeners
        this.onTrackChange = null;
        this.onQueueUpdate = null;
        this.onModeChange = null;
        
        // Advanced features
        this.smartShuffle = true; // Avoid playing similar tracks consecutively
        this.fadeTransitions = false;
        this.gaplessPlayback = true;
        this.maxQueueSize = 500;
        this.maxHistorySize = 100;
        
        // Load persisted queue
        this.loadFromDatabase();
    }
    
    // Add track to queue with advanced options
    async addTrack(track, options = {}) {
        const {
            position = 'end', // 'end', 'next', 'random', number
            priority = 0,
            requestedBy = null,
            addedAt = Date.now(),
            skipDuplicates = true
        } = options;
        
        // Validate track
        if (!track || !track.url) {
            throw new Error('Invalid track: URL is required');
        }
        
        // Check for duplicates
        if (skipDuplicates && this.findDuplicate(track)) {
            return {
                success: false,
                message: 'Track already in queue',
                position: this.findDuplicate(track).position
            };
        }
        
        // Check queue size limit
        if (this.queue.length >= this.maxQueueSize) {
            throw new Error(`Queue is full (max ${this.maxQueueSize} tracks)`);
        }
        
        // Enhance track with metadata
        const enhancedTrack = {
            ...track,
            id: track.id || this.generateTrackId(),
            requestedBy,
            addedAt,
            priority,
            playCount: 0,
            skipCount: 0,
            lastPlayed: null,
            position: this.queue.length
        };
        
        // Add to queue based on position
        let insertIndex;
        switch (position) {
            case 'next':
                insertIndex = Math.max(0, this.currentIndex + 1);
                break;
            case 'random':
                insertIndex = Math.floor(Math.random() * (this.queue.length + 1));
                break;
            case 'end':
            default:
                insertIndex = this.queue.length;
                break;
        }
        
        if (typeof position === 'number') {
            insertIndex = Math.max(0, Math.min(position, this.queue.length));
        }
        
        this.queue.splice(insertIndex, 0, enhancedTrack);
        this.updateQueuePositions();
        this.updateQueueMetadata();
        
        // Update shuffle indices if needed
        if (this.shuffleMode) {
            this.updateShuffleIndices();
        }
        
        await this.saveToDatabase();
        this.notifyQueueUpdate('track_added', { track: enhancedTrack, position: insertIndex });
        
        return {
            success: true,
            track: enhancedTrack,
            position: insertIndex + 1,
            queueLength: this.queue.length
        };
    }
    
    // Add multiple tracks efficiently
    async addTracks(tracks, options = {}) {
        const results = [];
        const { batchSize = 10 } = options;
        
        for (let i = 0; i < tracks.length; i += batchSize) {
            const batch = tracks.slice(i, i + batchSize);
            const batchResults = await Promise.allSettled(
                batch.map(track => this.addTrack(track, { ...options, skipNotification: true }))
            );
            
            batchResults.forEach((result, index) => {
                if (result.status === 'fulfilled') {
                    results.push(result.value);
                } else {
                    console.warn(`Failed to add track ${i + index}:`, result.reason);
                    results.push({ success: false, error: result.reason.message });
                }
            });
        }
        
        await this.saveToDatabase();
        this.notifyQueueUpdate('tracks_added', { count: results.filter(r => r.success).length });
        
        return results;
    }
    
    // Remove track from queue
    async removeTrack(trackId, options = {}) {
        const { updateCurrentIndex = true } = options;
        
        const index = this.queue.findIndex(track => track.id === trackId);
        if (index === -1) {
            return { success: false, message: 'Track not found in queue' };
        }
        
        const removedTrack = this.queue.splice(index, 1)[0];
        
        // Update current index if necessary
        if (updateCurrentIndex && index <= this.currentIndex) {
            this.currentIndex = Math.max(-1, this.currentIndex - 1);
        }
        
        this.updateQueuePositions();
        this.updateQueueMetadata();
        
        if (this.shuffleMode) {
            this.updateShuffleIndices();
        }
        
        await this.saveToDatabase();
        this.notifyQueueUpdate('track_removed', { track: removedTrack, position: index });
        
        return {
            success: true,
            track: removedTrack,
            newQueueLength: this.queue.length
        };
    }
    
    // Move track to new position
    async moveTrack(trackId, newPosition) {
        const currentIndex = this.queue.findIndex(track => track.id === trackId);
        if (currentIndex === -1) {
            return { success: false, message: 'Track not found' };
        }
        
        newPosition = Math.max(0, Math.min(newPosition, this.queue.length - 1));
        
        const [track] = this.queue.splice(currentIndex, 1);
        this.queue.splice(newPosition, 0, track);
        
        // Update current index if necessary
        if (currentIndex === this.currentIndex) {
            this.currentIndex = newPosition;
        } else if (currentIndex < this.currentIndex && newPosition >= this.currentIndex) {
            this.currentIndex--;
        } else if (currentIndex > this.currentIndex && newPosition <= this.currentIndex) {
            this.currentIndex++;
        }
        
        this.updateQueuePositions();
        
        if (this.shuffleMode) {
            this.updateShuffleIndices();
        }
        
        await this.saveToDatabase();
        this.notifyQueueUpdate('track_moved', { track, from: currentIndex, to: newPosition });
        
        return { success: true, track, newPosition };
    }
    
    // Smart shuffle implementation
    toggleShuffle() {
        this.shuffleMode = !this.shuffleMode;
        
        if (this.shuffleMode) {
            this.originalQueue = [...this.queue];
            this.createSmartShuffleIndices();
        } else {
            // Restore original order but keep current track position
            if (this.currentTrack) {
                const currentTrackId = this.currentTrack.id;
                this.queue = [...this.originalQueue];
                this.currentIndex = this.queue.findIndex(track => track.id === currentTrackId);
            } else {
                this.queue = [...this.originalQueue];
                this.currentIndex = -1;
            }
            this.shuffledIndices = [];
        }
        
        this.updateQueuePositions();
        this.saveToDatabase();
        this.notifyModeChange('shuffle', this.shuffleMode);
        
        return this.shuffleMode;
    }
    
    // Create smart shuffle that avoids similar tracks
    createSmartShuffleIndices() {
        if (!this.smartShuffle || this.queue.length <= 2) {
            this.shuffledIndices = this.shuffleArray([...Array(this.queue.length).keys()]);
            return;
        }
        
        const indices = [...Array(this.queue.length).keys()];
        const shuffled = [];
        const used = new Set();
        
        // Start with current track if exists
        if (this.currentIndex >= 0) {
            shuffled.push(this.currentIndex);
            used.add(this.currentIndex);
        }
        
        while (shuffled.length < indices.length) {
            const remaining = indices.filter(i => !used.has(i));
            if (remaining.length === 0) break;
            
            let nextIndex;
            if (shuffled.length === 0) {
                nextIndex = remaining[Math.floor(Math.random() * remaining.length)];
            } else {
                // Try to avoid similar tracks
                const lastTrack = this.queue[shuffled[shuffled.length - 1]];
                const candidates = remaining.filter(i => {
                    const track = this.queue[i];
                    return !this.areTracksSimilar(lastTrack, track);
                });
                
                if (candidates.length > 0) {
                    nextIndex = candidates[Math.floor(Math.random() * candidates.length)];
                } else {
                    nextIndex = remaining[Math.floor(Math.random() * remaining.length)];
                }
            }
            
            shuffled.push(nextIndex);
            used.add(nextIndex);
        }
        
        this.shuffledIndices = shuffled;
    }
    
    // Check if tracks are similar (same artist, similar title)
    areTracksSimilar(track1, track2) {
        if (!track1 || !track2) return false;
        
        // Same artist
        if (track1.artist && track2.artist && 
            track1.artist.toLowerCase() === track2.artist.toLowerCase()) {
            return true;
        }
        
        // Similar titles (basic check)
        if (track1.title && track2.title) {
            const title1 = track1.title.toLowerCase().replace(/[^\w\s]/g, '');
            const title2 = track2.title.toLowerCase().replace(/[^\w\s]/g, '');
            const similarity = this.calculateStringSimilarity(title1, title2);
            if (similarity > 0.8) return true;
        }
        
        return false;
    }
    
    // Get next track considering shuffle and repeat modes
    getNextTrack() {
        if (!this.queue.length) return null;
        
        if (this.repeatMode === 'track' && this.currentTrack) {
            return this.currentTrack;
        }
        
        let nextIndex;
        
        if (this.shuffleMode && this.shuffledIndices.length > 0) {
            const currentShuffleIndex = this.shuffledIndices.indexOf(this.currentIndex);
            if (currentShuffleIndex < this.shuffledIndices.length - 1) {
                nextIndex = this.shuffledIndices[currentShuffleIndex + 1];
            } else if (this.repeatMode === 'queue') {
                this.createSmartShuffleIndices(); // Re-shuffle for repeat
                nextIndex = this.shuffledIndices[0];
            } else {
                return null; // End of shuffled queue
            }
        } else {
            if (this.currentIndex < this.queue.length - 1) {
                nextIndex = this.currentIndex + 1;
            } else if (this.repeatMode === 'queue') {
                nextIndex = 0;
            } else {
                return null; // End of queue
            }
        }
        
        return this.queue[nextIndex] || null;
    }
    
    // Get previous track
    getPreviousTrack() {
        if (!this.queue.length) return null;
        
        if (this.history.length > 0) {
            return this.history[this.history.length - 1];
        }
        
        let prevIndex;
        
        if (this.shuffleMode && this.shuffledIndices.length > 0) {
            const currentShuffleIndex = this.shuffledIndices.indexOf(this.currentIndex);
            if (currentShuffleIndex > 0) {
                prevIndex = this.shuffledIndices[currentShuffleIndex - 1];
            } else {
                return null;
            }
        } else {
            if (this.currentIndex > 0) {
                prevIndex = this.currentIndex - 1;
            } else {
                return null;
            }
        }
        
        return this.queue[prevIndex] || null;
    }
    
    // Set current track and update history
    setCurrentTrack(trackId) {
        const index = this.queue.findIndex(track => track.id === trackId);
        if (index === -1) return false;
        
        // Add previous track to history
        if (this.currentTrack) {
            this.addToHistory(this.currentTrack);
        }
        
        this.currentIndex = index;
        this.currentTrack = this.queue[index];
        this.currentTrack.playCount = (this.currentTrack.playCount || 0) + 1;
        this.currentTrack.lastPlayed = Date.now();
        
        this.saveToDatabase();
        this.notifyTrackChange(this.currentTrack);
        
        return true;
    }
    
    // Clear entire queue
    async clearQueue() {
        const clearedCount = this.queue.length;
        this.queue = [];
        this.currentTrack = null;
        this.currentIndex = -1;
        this.shuffledIndices = [];
        this.updateQueueMetadata();
        
        await this.saveToDatabase();
        this.notifyQueueUpdate('queue_cleared', { count: clearedCount });
        
        return { success: true, clearedCount };
    }
    
    // Get queue statistics
    getQueueStats() {
        return {
            length: this.queue.length,
            currentPosition: this.currentIndex + 1,
            totalDuration: this.totalDuration,
            averageTrackDuration: this.queue.length ? this.totalDuration / this.queue.length : 0,
            estimatedTimeToComplete: this.estimatedTimeToComplete,
            queueAge: Date.now() - this.queueCreatedAt,
            lastModified: this.lastModified,
            modes: {
                repeat: this.repeatMode,
                shuffle: this.shuffleMode,
                autoplay: this.autoplayMode
            },
            uniqueArtists: [...new Set(this.queue.map(t => t.artist).filter(Boolean))].length,
            duplicates: this.findAllDuplicates().length
        };
    }
    
    // Search within queue
    searchQueue(query) {
        const results = this.queue.filter(track => {
            const searchableText = `${track.title} ${track.artist} ${track.album || ''}`.toLowerCase();
            return searchableText.includes(query.toLowerCase());
        });
        
        return results.map(track => ({
            ...track,
            queuePosition: this.queue.indexOf(track) + 1
        }));
    }
    
    // Export queue as playlist
    exportQueue(format = 'json') {
        const exportData = {
            metadata: {
                name: `Queue Export ${new Date().toISOString()}`,
                created: new Date().toISOString(),
                guildId: this.guildId,
                channelId: this.channelId,
                trackCount: this.queue.length,
                totalDuration: this.totalDuration
            },
            tracks: this.queue.map(track => ({
                title: track.title,
                artist: track.artist,
                url: track.url,
                duration: track.duration,
                addedAt: track.addedAt,
                requestedBy: track.requestedBy
            }))
        };
        
        switch (format) {
            case 'json':
                return JSON.stringify(exportData, null, 2);
            case 'm3u':
                return this.exportToM3U(exportData);
            default:
                return exportData;
        }
    }
    
    // Helper methods
    generateTrackId() {
        return `track_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    
    updateQueuePositions() {
        this.queue.forEach((track, index) => {
            track.position = index;
        });
        this.lastModified = Date.now();
    }
    
    updateQueueMetadata() {
        this.totalDuration = this.queue.reduce((total, track) => total + (track.duration || 0), 0);
        this.estimatedTimeToComplete = this.queue
            .slice(this.currentIndex + 1)
            .reduce((total, track) => total + (track.duration || 0), 0);
    }
    
    updateShuffleIndices() {
        if (this.shuffleMode) {
            this.createSmartShuffleIndices();
        }
    }
    
    findDuplicate(track) {
        return this.queue.find(existing => 
            existing.url === track.url || 
            (existing.title === track.title && existing.artist === track.artist)
        );
    }
    
    findAllDuplicates() {
        const seen = new Set();
        return this.queue.filter(track => {
            const key = `${track.title}|${track.artist}`;
            if (seen.has(key)) {
                return true;
            }
            seen.add(key);
            return false;
        });
    }
    
    addToHistory(track) {
        this.history.push({
            ...track,
            playedAt: Date.now()
        });
        
        if (this.history.length > this.maxHistorySize) {
            this.history = this.history.slice(-this.maxHistorySize);
        }
    }
    
    shuffleArray(array) {
        const shuffled = [...array];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled;
    }
    
    calculateStringSimilarity(str1, str2) {
        const longer = str1.length > str2.length ? str1 : str2;
        const shorter = str1.length > str2.length ? str2 : str1;
        
        if (longer.length === 0) return 1.0;
        
        const editDistance = this.calculateEditDistance(longer, shorter);
        return (longer.length - editDistance) / longer.length;
    }
    
    calculateEditDistance(str1, str2) {
        const matrix = Array(str2.length + 1).fill(null).map(() => Array(str1.length + 1).fill(null));
        
        for (let i = 0; i <= str1.length; i++) matrix[0][i] = i;
        for (let j = 0; j <= str2.length; j++) matrix[j][0] = j;
        
        for (let j = 1; j <= str2.length; j++) {
            for (let i = 1; i <= str1.length; i++) {
                if (str1[i - 1] === str2[j - 1]) {
                    matrix[j][i] = matrix[j - 1][i - 1];
                } else {
                    matrix[j][i] = Math.min(
                        matrix[j - 1][i - 1] + 1,
                        matrix[j][i - 1] + 1,
                        matrix[j - 1][i] + 1
                    );
                }
            }
        }
        
        return matrix[str2.length][str1.length];
    }
    
    exportToM3U(exportData) {
        let m3u = '#EXTM3U\n';
        exportData.tracks.forEach(track => {
            m3u += `#EXTINF:${track.duration || -1},${track.artist} - ${track.title}\n`;
            m3u += `${track.url}\n`;
        });
        return m3u;
    }
    
    // Event notification methods
    notifyTrackChange(track) {
        if (this.onTrackChange) {
            this.onTrackChange(track);
        }
    }
    
    notifyQueueUpdate(action, data) {
        if (this.onQueueUpdate) {
            this.onQueueUpdate(action, data);
        }
    }
    
    notifyModeChange(mode, value) {
        if (this.onModeChange) {
            this.onModeChange(mode, value);
        }
    }
    
    // Database persistence
    async saveToDatabase() {
        try {
            const queueData = {
                tracks: this.queue,
                currentTrack: this.currentTrack,
                currentIndex: this.currentIndex,
                repeatMode: this.repeatMode,
                shuffleMode: this.shuffleMode,
                autoplayMode: this.autoplayMode,
                history: this.history.slice(-10), // Save only recent history
                metadata: {
                    totalDuration: this.totalDuration,
                    queueCreatedAt: this.queueCreatedAt,
                    lastModified: this.lastModified
                }
            };
            
            await neonService.saveQueue(this.guildId, this.channelId, queueData);
        } catch (error) {
            console.error('❌ Failed to save queue to database:', error);
        }
    }
    
    async loadFromDatabase() {
        try {
            const queueData = await neonService.loadQueue(this.guildId);
            if (queueData) {
                this.queue = queueData.tracks || [];
                this.currentTrack = queueData.currentTrack;
                this.currentIndex = queueData.currentIndex || -1;
                this.repeatMode = queueData.repeatMode || 'off';
                this.shuffleMode = queueData.shuffleMode || false;
                this.autoplayMode = queueData.autoplayMode !== false;
                this.history = queueData.history || [];
                
                if (queueData.metadata) {
                    this.totalDuration = queueData.metadata.totalDuration || 0;
                    this.queueCreatedAt = queueData.metadata.queueCreatedAt || Date.now();
                    this.lastModified = queueData.metadata.lastModified || Date.now();
                }
                
                this.updateQueueMetadata();
                console.log(`✅ Loaded queue with ${this.queue.length} tracks`);
            }
        } catch (error) {
            console.error('❌ Failed to load queue from database:', error);
        }
    }
}

module.exports = EnhancedQueueManager;