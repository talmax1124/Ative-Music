const { createAudioPlayer, createAudioResource, AudioPlayerStatus, StreamType, demuxProbe } = require('@discordjs/voice');
const { createReadStream } = require('fs');
const { promises: fs } = require('fs');
const path = require('path');
const config = require('../config.js');
const SmartAutoPlay = require('./SmartAutoPlay.js');
const UserPreferences = require('./UserPreferences.js');

class MusicManager {
    constructor(guildId, channelId, sourceHandlers) {
        this.guildId = guildId;
        this.channelId = channelId;
        this.sourceHandlers = sourceHandlers;
        this.queue = [];
        this.currentTrack = null;
        this.currentTrackIndex = -1;
        this.isPlaying = false;
        this.isPaused = false;
        this.volume = config.settings.defaultVolume;
        this.loopMode = 'off'; // 'off', 'track', 'queue'
        this.connection = null;
        this.connectionHealthy = true; // Track connection health for EPIPE prevention
        this.player = createAudioPlayer();
        this.lastChannel = null;
        this.playHistory = [];
        this.smartAutoPlay = new SmartAutoPlay(sourceHandlers);
        this.userPreferences = new UserPreferences();
        this.autoPlayEnabled = true;
        this.continuousPlayback = false; // Disable by default - user controls progression
        this.userStoppedPlayback = false; // Track if user manually stopped
        this.isTransitioning = false; // Prevent multiple track transitions
        this.onTrackEnd = null;
        this.onTrackStart = null;
        this.onQueueUpdate = null;
        this.autoPlayTimeout = null;
        
        this.setupPlayerEvents();
        this.queueFile = path.join(__dirname, `../data/queue_${channelId}.json`);
        this.loadQueue();
    }

    setupPlayerEvents() {
        this.player.on(AudioPlayerStatus.Playing, () => {
            this.isPlaying = true;
            this.isPaused = false;
            this.trackStartTime = Date.now(); // Track when playback actually starts
            console.log(`🎵 Now playing: ${this.currentTrack?.title || 'Unknown'}`);
            
            // Reset error counters on successful playback
            this.consecutiveErrors = 0;
            if (this.trackErrors && this.currentTrack?.url) {
                this.trackErrors.delete(this.currentTrack.url);
            }
            
            // Emit track start event for UI updates
            if (this.onTrackStart) {
                this.onTrackStart(this.currentTrack);
            }
        });

        this.player.on(AudioPlayerStatus.Paused, () => {
            this.isPaused = true;
            console.log('⏸️ Player paused');
        });

        this.player.on(AudioPlayerStatus.Idle, (oldState, newState) => {
            // Only handle track end if we were actually playing
            if (oldState.status === AudioPlayerStatus.Playing) {
                this.isPlaying = false;
                this.isPaused = false;
                
                // Check if track ended too quickly (less than 5 seconds) - likely a stream error
                const playDuration = Date.now() - (this.trackStartTime || 0);
                if (playDuration < 5000 && this.trackStartTime) {
                    console.log(`❌ Track ended too quickly (${playDuration}ms) - likely stream error`);
                    this.handleStreamError();
                } else {
                    console.log('💤 Player idle - track finished naturally');
                    this.handleTrackEnd();
                }
            } else if (oldState.status === AudioPlayerStatus.Buffering) {
                // Stream failed during buffering - this is an error
                this.isPlaying = false;
                this.isPaused = false;
                console.log('❌ Stream failed during buffering - trying next track');
                this.handleStreamError();
            } else {
                console.log(`💤 Player idle from ${oldState.status} - ignoring`);
            }
        });

        this.player.on('error', (error) => {
            console.error('❌ Audio player error:', error);
            this.isPlaying = false;
            this.isPaused = false;
            this.handleStreamError();
        });

        this.player.on(AudioPlayerStatus.Buffering, () => {
            console.log('⏳ Buffering...');
        });
    }

    setConnection(connection) {
        this.connection = connection;
        this.connection.subscribe(this.player);
        this.lastChannel = connection.joinConfig.channelId;
        
        // Enhanced connection state handling with EPIPE protection
        this.connection.on('stateChange', (oldState, newState) => {
            console.log(`🔗 Connection state changed: ${oldState.status} -> ${newState.status}`);
            
            // Handle connection drops that could cause EPIPE
            if (newState.status === 'disconnected' || newState.status === 'destroyed') {
                console.log('⚠️ Voice connection dropped - stopping current playback to prevent EPIPE');
                this.handleConnectionDrop();
            }
        });
        
        // Handle connection errors including EPIPE
        this.connection.on('error', (error) => {
            console.error('🔗 Voice connection error:', error.message);
            if (error.code === 'EPIPE' || error.message.includes('EPIPE')) {
                console.log('🔧 EPIPE error detected - attempting connection recovery');
                this.handleEPIPEError();
            }
        });
    }

    async addToQueue(track, position = -1, userContext = null) {
        track.addedAt = new Date();
        track.id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        
        if (position === -1) {
            this.queue.push(track);
        } else {
            this.queue.splice(position, 0, track);
        }
        
        console.log(`📝 Added to queue: ${track.title} (Position: ${this.queue.length})`);
        
        // Track user preference if user context is provided
        if (userContext && userContext.userId && userContext.guildId) {
            this.userPreferences.trackPlay(userContext.userId, userContext.guildId, track);
        }
        
        // Auto-queue recommendations if only one song and auto-play is enabled
        if (this.queue.length === 1 && this.autoPlayEnabled) {
            console.log('🤖 Auto-queuing recommendations since only one song in queue...');
            // Small delay to ensure the current track is properly set
            setTimeout(() => {
                this.fillQueueWithRecommendations(3, userContext);
            }, 2000);
        }
        
        // Auto-save queue after changes
        this.saveQueue();
        
        // Emit queue update event
        if (this.onQueueUpdate) {
            this.onQueueUpdate(this.getQueueInfo());
        }
        
        return track;
    }

    async addPlaylist(tracks, smart = false) {
        if (smart) {
            const smartTracks = await this.smartSort(tracks);
            for (const track of smartTracks) {
                await this.addToQueue(track);
            }
        } else {
            for (const track of tracks) {
                await this.addToQueue(track);
            }
        }
    }

    async smartSort(tracks) {
        return tracks.sort((a, b) => {
            let scoreA = 0;
            let scoreB = 0;
            
            if (a.viewCount) scoreA += Math.log10(a.viewCount) * 0.3;
            if (b.viewCount) scoreB += Math.log10(b.viewCount) * 0.3;
            
            if (a.likes) scoreA += Math.log10(a.likes) * 0.2;
            if (b.likes) scoreB += Math.log10(b.likes) * 0.2;
            
            const currentYear = new Date().getFullYear();
            if (a.publishedAt) {
                const ageA = currentYear - new Date(a.publishedAt).getFullYear();
                scoreA += Math.max(0, 10 - ageA) * 0.1;
            }
            if (b.publishedAt) {
                const ageB = currentYear - new Date(b.publishedAt).getFullYear();
                scoreB += Math.max(0, 10 - ageB) * 0.1;
            }
            
            if (a.duration && b.duration) {
                const durationA = this.parseDuration(a.duration);
                const durationB = this.parseDuration(b.duration);
                
                if (durationA >= 120000 && durationA <= 300000) scoreA += 0.2;
                if (durationB >= 120000 && durationB <= 300000) scoreB += 0.2;
            }
            
            return scoreB - scoreA;
        });
    }

    async play() {
        if (this.queue.length === 0) {
            console.log('📭 Queue is empty');
            return false;
        }

        if (this.currentTrackIndex === -1) {
            this.currentTrackIndex = 0;
        }

        this.currentTrack = this.queue[this.currentTrackIndex];
        
        // Validate current track exists
        if (!this.currentTrack) {
            console.error('❌ No track found at index', this.currentTrackIndex);
            return false;
        }
        
        // Reset user stopped flag when starting playback
        this.userStoppedPlayback = false;
        
        try {
            console.log(`🎵 Attempting to play: ${this.currentTrack.title}`);
            
            // Check connection health before attempting stream
            if (!this.connectionHealthy || !this.connection) {
                console.log('⚠️ Connection not healthy - aborting playback to prevent EPIPE');
                this.handleStreamError();
                return false;
            }
            
            const stream = await this.sourceHandlers.getStream(this.currentTrack);
            
            if (!stream) {
                console.error('❌ Failed to get stream for track');
                // Handle as stream error, not skip
                this.handleStreamError();
                return false;
            }

            // Validate stream before creating audio resource
            if (!stream.readable || stream.destroyed) {
                console.error('❌ Stream is not readable or already destroyed');
                this.handleStreamError();
                return false;
            }

            // Enhanced stream error handlers including EPIPE protection
            stream.on('error', (error) => {
                console.error('❌ Stream error:', error.message);
                if (error.code === 'EPIPE' || error.message.includes('EPIPE')) {
                    console.log('🔧 Stream EPIPE error - connection issue detected');
                    this.handleEPIPEError();
                } else {
                    this.handleStreamError();
                }
            });
            
            // Monitor stream health to prevent EPIPE
            stream.on('close', () => {
                console.log('📡 Stream closed');
            });
            
            stream.on('end', () => {
                console.log('📡 Stream ended normally');
            });

            // Probe the stream for format detection
            let resource;
            try {
                const probe = await demuxProbe(stream);
                resource = createAudioResource(probe.stream, {
                    inputType: probe.type,
                    inlineVolume: true,
                    silencePaddingFrames: 5, // Add padding for audio stability
                    metadata: {
                        title: this.currentTrack?.title || 'Unknown',
                        author: this.currentTrack?.author || 'Unknown'
                    }
                });
            } catch (probeError) {
                console.log('⚠️ Audio probing failed, using fallback:', probeError.message);
                // Fallback to arbitrary input type
                resource = createAudioResource(stream, {
                    inputType: StreamType.Arbitrary,
                    inlineVolume: true,
                    silencePaddingFrames: 5,
                    metadata: {
                        title: this.currentTrack?.title || 'Unknown',
                        author: this.currentTrack?.author || 'Unknown'
                    }
                });
            }

            resource.volume?.setVolume(this.volume / 100);

            this.player.play(resource);
            
            this.playHistory.push({
                ...this.currentTrack,
                playedAt: new Date()
            });
            
            if (this.playHistory.length > 50) {
                this.playHistory = this.playHistory.slice(-50);
            }
            
            // Reset consecutive errors on successful play
            this.consecutiveErrors = 0;

            return true;

        } catch (error) {
            console.error('❌ Error playing track:', error);
            
            // If all streaming methods failed, try to skip to next track
            if (error.message.includes('All streaming methods failed')) {
                console.log('❌ All streaming methods failed for this track, skipping...');
                await this.skip();
                return false;
            }
            
            // If it's a persistent 403 error across multiple tracks, clear queue
            if (error.message.includes('403') && this.consecutiveErrors > 3) {
                console.log('🚨 Multiple 403 errors detected - clearing queue');
                this.clearQueue();
                this.stop();
                this.consecutiveErrors = 0;
                return false;
            }
            
            // Track consecutive errors
            this.consecutiveErrors = (this.consecutiveErrors || 0) + 1;
            
            // Don't call skip to avoid infinite loops
            this.handleTrackEnd();
            return false;
        }
    }

    async skip() {
        if (this.queue.length === 0) return false;

        if (this.loopMode === 'track') {
            await this.play();
            return true;
        }

        this.currentTrackIndex++;
        
        if (this.currentTrackIndex >= this.queue.length) {
            if (this.loopMode === 'queue') {
                this.currentTrackIndex = 0;
                await this.play();
                return true;
            } else {
                this.stop();
                return false;
            }
        }

        await this.play();
        return true;
    }

    async previous() {
        if (this.playHistory.length === 0) return false;

        this.currentTrackIndex = Math.max(0, this.currentTrackIndex - 1);
        await this.play();
        return true;
    }

    pause() {
        if (this.isPlaying && !this.isPaused) {
            this.player.pause();
            return true;
        }
        return false;
    }

    resume() {
        if (this.isPaused) {
            this.player.unpause();
            return true;
        }
        return false;
    }

    stop(userInitiated = false) {
        this.player.stop();
        this.isPlaying = false;
        this.isPaused = false;
        this.currentTrack = null;
        this.currentTrackIndex = -1;
        
        // Disable auto-play if user manually stopped
        if (userInitiated) {
            this.autoPlayEnabled = false;
            console.log('⏹️ Playback stopped by user - auto-play disabled');
        } else {
            console.log('⏹️ Playback stopped');
        }
    }

    clearQueue(userInitiated = false) {
        this.queue = [];
        this.currentTrackIndex = -1;
        
        // Disable auto-play if user manually cleared
        if (userInitiated) {
            this.autoPlayEnabled = false;
            console.log('🗑️ Queue cleared by user - auto-play disabled');
        } else {
            console.log('🗑️ Queue cleared');
        }
        
        // Save cleared queue and clear persisted file
        this.clearPersistedQueue();
        
        // Emit queue update event
        if (this.onQueueUpdate) {
            this.onQueueUpdate(this.getQueueInfo());
        }
    }

    shuffle() {
        if (this.queue.length < 2) return false;

        const currentTrack = this.queue[this.currentTrackIndex];
        const remainingQueue = this.queue.slice(this.currentTrackIndex + 1);
        
        for (let i = remainingQueue.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [remainingQueue[i], remainingQueue[j]] = [remainingQueue[j], remainingQueue[i]];
        }

        this.queue = [
            ...this.queue.slice(0, this.currentTrackIndex + 1),
            ...remainingQueue
        ];

        console.log('🔀 Queue shuffled');
        
        // Emit queue update event
        if (this.onQueueUpdate) {
            this.onQueueUpdate(this.getQueueInfo());
        }
        
        return true;
    }

    setVolume(volume) {
        this.volume = Math.max(0, Math.min(100, volume));
        if (this.player.state.resource?.volume) {
            // Use smooth volume transition to prevent audio artifacts
            const targetVolume = this.volume / 100;
            const currentVolume = this.player.state.resource.volume.volume;
            
            // Gradual volume change to prevent audio popping
            const volumeStep = (targetVolume - currentVolume) / 10;
            let step = 0;
            
            const volumeInterval = setInterval(() => {
                step++;
                const newVolume = currentVolume + (volumeStep * step);
                
                if (step >= 10 || Math.abs(newVolume - targetVolume) < 0.01) {
                    if (this.player.state.resource?.volume) {
                        this.player.state.resource.volume.setVolume(targetVolume);
                    }
                    clearInterval(volumeInterval);
                } else if (this.player.state.resource?.volume) {
                    this.player.state.resource.volume.setVolume(newVolume);
                }
            }, 20);
        }
        console.log(`🔊 Volume set to ${this.volume}%`);
    }

    setLoop(mode) {
        const validModes = ['off', 'track', 'queue'];
        if (validModes.includes(mode)) {
            this.loopMode = mode;
            console.log(`🔁 Loop mode set to: ${mode}`);
            return true;
        }
        return false;
    }

    removeFromQueue(index) {
        if (index < 0 || index >= this.queue.length) return false;

        if (index === this.currentTrackIndex) {
            this.skip();
        } else if (index < this.currentTrackIndex) {
            this.currentTrackIndex--;
        }

        const removed = this.queue.splice(index, 1)[0];
        console.log(`🗑️ Removed from queue: ${removed.title}`);
        
        // Emit queue update event
        if (this.onQueueUpdate) {
            this.onQueueUpdate(this.getQueueInfo());
        }
        
        return removed;
    }

    moveInQueue(from, to) {
        if (from < 0 || from >= this.queue.length || to < 0 || to >= this.queue.length) {
            return false;
        }

        const track = this.queue.splice(from, 1)[0];
        this.queue.splice(to, 0, track);

        if (from === this.currentTrackIndex) {
            this.currentTrackIndex = to;
        } else if (from < this.currentTrackIndex && to >= this.currentTrackIndex) {
            this.currentTrackIndex--;
        } else if (from > this.currentTrackIndex && to <= this.currentTrackIndex) {
            this.currentTrackIndex++;
        }

        return true;
    }

    getQueueInfo() {
        return {
            queue: this.queue,
            currentTrack: this.currentTrack,
            currentIndex: this.currentTrackIndex,
            isPlaying: this.isPlaying,
            isPaused: this.isPaused,
            volume: this.volume,
            loopMode: this.loopMode,
            queueLength: this.queue.length,
            queueDuration: this.getTotalDuration()
        };
    }

    getTotalDuration() {
        return this.queue.reduce((total, track) => {
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

    async handleTrackEnd() {
        console.log('🎵 Track ended, determining next action...');
        
        // Prevent multiple simultaneous track end handling
        if (this.isTransitioning) {
            console.log('⚠️ Track end ignored - already transitioning');
            return;
        }
        
        this.isTransitioning = true;
        clearTimeout(this.autoPlayTimeout);
        
        // Store current track before clearing for recommendation purposes
        const lastTrack = this.currentTrack;
        
        // Emit track end event for UI updates
        if (this.onTrackEnd) {
            this.onTrackEnd(lastTrack);
        }
        
        // Determine next action based on queue state and settings
        const hasNextInQueue = this.currentTrackIndex + 1 < this.queue.length;
        
        if (hasNextInQueue && this.continuousPlayback) {
            // Advance to next track in queue
            console.log('🔄 Auto-advancing to next track in queue...');
            this.currentTrackIndex++;
            this.autoPlayTimeout = setTimeout(async () => {
                if (!this.isPlaying && !this.userStoppedPlayback) {
                    await this.play();
                }
                this.isTransitioning = false;
            }, 1000);
        } else if (!hasNextInQueue && this.autoPlayEnabled && this.continuousPlayback) {
            // Queue is empty, try to find recommendations
            console.log('🤖 Queue empty, finding smart recommendation...');
            this.clearCurrentPosition();
            this.autoPlayTimeout = setTimeout(async () => {
                if (!this.isPlaying && !this.userStoppedPlayback) {
                    await this.findAndPlayRecommendation(lastTrack);
                }
                this.isTransitioning = false;
            }, 1500);
        } else {
            // Stop playback - either continuous playback disabled or auto-play disabled
            console.log('⏸️ Track ended - stopping playback (continuous/auto-play disabled)');
            this.clearCurrentPosition();
            
            // Notify panel to show "Use /play" message when queue is empty
            if (this.queue.length === 0 && this.onQueueEmpty) {
                this.onQueueEmpty();
            }
            this.isTransitioning = false;
        }
    }

    async findAndPlayRecommendation(lastTrack = null, userContext = {}) {
        try {
            // Use the last track or fall back to the most recent from play history
            const seedTrack = lastTrack || this.playHistory[this.playHistory.length - 1] || null;
            
            if (!seedTrack) {
                console.log('❌ No seed track available for recommendations');
                return false;
            }
            
            const recommendation = await this.smartAutoPlay.getNextRecommendation(
                seedTrack, 
                this.playHistory,
                userContext
            );
            
            if (recommendation && !this.isDuplicate(recommendation)) {
                console.log(`🎵 Auto-playing: ${recommendation.title} by ${recommendation.author}`);
                await this.addToQueue(recommendation);
                // Set the current track index to the new recommendation (last item in queue)
                this.currentTrackIndex = this.queue.length - 1;
                await this.play();
                return true;
            } else {
                console.log('❌ No valid recommendation found or duplicate detected');
                return false;
            }
        } catch (error) {
            console.error('❌ Auto-play recommendation failed:', error);
            return false;
        }
    }
    
    isDuplicate(track) {
        // Check if track is already in queue
        const inQueue = this.queue.some(queueTrack => 
            queueTrack.title.toLowerCase() === track.title.toLowerCase() &&
            queueTrack.author.toLowerCase() === track.author.toLowerCase()
        );
        
        // Check if track was played recently
        const recentlyPlayed = this.playHistory.slice(-10).some(historyTrack => 
            historyTrack.title.toLowerCase() === track.title.toLowerCase() &&
            historyTrack.author.toLowerCase() === track.author.toLowerCase()
        );
        
        return inQueue || recentlyPlayed;
    }

    async fillQueueWithRecommendations(count = 10, userContext = {}) {
        if (this.queue.length >= count) return;

        console.log(`🎵 Filling queue with ${count} smart recommendations...`);
        
        try {
            const recommendations = await this.smartAutoPlay.generateContinuousPlaylist(
                this.currentTrack || this.playHistory[this.playHistory.length - 1],
                count - this.queue.length,
                userContext
            );
            
            for (const recommendation of recommendations) {
                await this.addToQueue(recommendation);
            }
            
            console.log(`✅ Added ${recommendations.length} tracks to queue`);
        } catch (error) {
            console.error('❌ Failed to fill queue:', error);
        }
    }

    setAutoPlay(enabled) {
        this.autoPlayEnabled = enabled;
        console.log(`🤖 Auto-play ${enabled ? 'enabled' : 'disabled'}`);
        
        if (enabled && this.queue.length === 0 && this.connection) {
            // Start auto-play immediately if queue is empty
            this.findAndPlayRecommendation();
        }
    }

    setContinuousPlayback(enabled) {
        this.continuousPlayback = enabled;
        console.log(`🔄 Continuous playback ${enabled ? 'enabled' : 'disabled'}`);
        
        if (enabled) {
            this.fillQueueWithRecommendations();
        }
    }

    handleDisconnect() {
        this.stop();
        this.connection = null;
        console.log('🔌 Disconnected from voice channel');
    }
    
    clearCurrentPosition() {
        // Clear any pending timeouts
        clearTimeout(this.autoPlayTimeout);
        this.autoPlayTimeout = null;
        
        // Only clear if not currently playing
        if (!this.isPlaying) {
            this.currentTrack = null;
            this.currentTrackIndex = -1;
        }
        
        this.isPaused = false;
        this.isTransitioning = false;
        this.userStoppedPlayback = false; // Reset user stop flag
        console.log('✅ Queue position cleared');
        
        // Save queue state after clearing position
        this.saveQueue();
    }
    
    clearTrackFromQueue(trackId) {
        const trackIndex = this.queue.findIndex(track => track.id === trackId);
        
        if (trackIndex === -1) {
            return { success: false, reason: 'Track not found in queue' };
        }
        
        const track = this.queue[trackIndex];
        
        // If removing the currently playing track, stop and clear position
        if (trackIndex === this.currentTrackIndex) {
            this.stop();
            this.clearCurrentPosition();
            this.queue.splice(trackIndex, 1);
            console.log(`🗑️ Removed currently playing track: ${track.title}`);
        } else {
            // Adjust current index if removing track before current position
            if (trackIndex < this.currentTrackIndex) {
                this.currentTrackIndex--;
            }
            this.queue.splice(trackIndex, 1);
            console.log(`🗑️ Removed track from queue: ${track.title}`);
        }
        
        // Save queue state after removal
        this.saveQueue();
        
        // Emit queue update event
        if (this.onQueueUpdate) {
            this.onQueueUpdate(this.getQueueInfo());
        }
        
        return { 
            success: true, 
            track: track, 
            position: trackIndex + 1,
            newQueueLength: this.queue.length 
        };
    }

    getRecommendations(count = 5) {
        if (!this.currentTrack) return [];

        const recommendations = [];
        
        return recommendations.slice(0, count);
    }

    // Queue Persistence Methods
    async saveQueue() {
        try {
            await fs.mkdir(path.dirname(this.queueFile), { recursive: true });
            const queueData = {
                queue: this.queue,
                currentTrackIndex: this.currentTrackIndex,
                loopMode: this.loopMode,
                volume: this.volume,
                autoPlayEnabled: this.autoPlayEnabled,
                continuousPlayback: this.continuousPlayback,
                savedAt: new Date().toISOString()
            };
            await fs.writeFile(this.queueFile, JSON.stringify(queueData, null, 2));
            console.log(`💾 Queue saved for channel ${this.channelId} (guild ${this.guildId})`);
        } catch (error) {
            console.error('❌ Failed to save queue:', error);
        }
    }

    async loadQueue() {
        try {
            const data = await fs.readFile(this.queueFile, 'utf8');
            const queueData = JSON.parse(data);
            
            const originalQueue = queueData.queue || [];
            
            // Filter out YouTube tracks since they're currently broken
            this.queue = originalQueue.filter(track => track.source !== 'youtube');
            const removedCount = originalQueue.length - this.queue.length;
            
            if (removedCount > 0) {
                console.log(`🚨 Removed ${removedCount} broken YouTube tracks from queue`);
            }
            
            this.currentTrackIndex = -1; // Reset to start from beginning
            this.loopMode = queueData.loopMode || 'off';
            this.volume = queueData.volume || config.settings.defaultVolume;
            this.autoPlayEnabled = queueData.autoPlayEnabled !== undefined ? queueData.autoPlayEnabled : true;
            this.continuousPlayback = queueData.continuousPlayback !== undefined ? queueData.continuousPlayback : true;
            
            console.log(`💿 Restored queue for guild ${this.guildId}: ${this.queue.length} tracks (${removedCount} YouTube tracks removed)`);
            
            // Save the cleaned queue
            if (removedCount > 0) {
                this.saveQueue();
            }
        } catch (error) {
            // File doesn't exist or is corrupted - start fresh
            console.log(`🆕 Starting fresh queue for guild ${this.guildId}`);
        }
    }

    async clearPersistedQueue() {
        try {
            await fs.unlink(this.queueFile);
            console.log(`🗑️ Cleared persisted queue for guild ${this.guildId}`);
        } catch (error) {
            // File might not exist - ignore
        }
    }
    
    async handleEPIPEError() {
        console.log('🔧 Handling EPIPE error - connection pipe broken');
        
        // Stop current audio to prevent further EPIPE errors
        if (this.player && this.player.state.status !== 'Idle') {
            this.player.stop(true);
        }
        
        // Mark connection as potentially broken
        this.connectionHealthy = false;
        
        // Wait before attempting recovery
        setTimeout(() => {
            console.log('🔧 Attempting EPIPE recovery by restarting current track');
            this.connectionHealthy = true;
            if (this.currentTrack && !this.userStoppedPlayback) {
                this.play();
            }
        }, 2000);
    }
    
    handleConnectionDrop() {
        console.log('📡 Handling voice connection drop');
        
        // Stop playback cleanly
        if (this.player && this.player.state.status !== 'Idle') {
            this.player.stop(true);
        }
        
        this.connectionHealthy = false;
        this.isTransitioning = false;
    }
    
    async handleStreamError() {
        console.log('❌ Handling stream error - trying to recover');
        
        // Prevent multiple simultaneous error handling
        if (this.isTransitioning) {
            console.log('⚠️ Stream error ignored - already transitioning');
            return;
        }
        
        this.isTransitioning = true;
        
        try {
            // Track errors per track
            const trackId = this.currentTrack?.url || 'unknown';
            this.trackErrors = this.trackErrors || new Map();
            const trackErrorCount = (this.trackErrors.get(trackId) || 0) + 1;
            this.trackErrors.set(trackId, trackErrorCount);
            
            // Global consecutive error count
            this.consecutiveErrors = (this.consecutiveErrors || 0) + 1;
            
            // If too many global errors, stop completely
            if (this.consecutiveErrors > 5) {
                console.log('🚨 Too many consecutive stream errors - stopping playback');
                this.stop();
                this.isTransitioning = false;
                return;
            }
            
            // If this specific track has failed too many times, skip it
            if (trackErrorCount >= 3) {
                console.log(`🔄 Track "${this.currentTrack?.title}" failed ${trackErrorCount} times - skipping to next`);
                
                // Try next track if available
                if (this.currentTrackIndex + 1 < this.queue.length) {
                    console.log('🔄 Moving to next track in queue');
                    this.currentTrackIndex++;
                    
                    setTimeout(async () => {
                        if (!this.isPlaying && !this.userStoppedPlayback) {
                            await this.play();
                        }
                        this.isTransitioning = false;
                    }, 2000);
                } else if (this.autoPlayEnabled && this.continuousPlayback) {
                    // No more tracks in queue, try to find recommendation
                    console.log('🤖 Queue empty after error - finding recommendation');
                    const lastTrack = this.currentTrack || this.playHistory[this.playHistory.length - 1];
                    
                    setTimeout(async () => {
                        if (!this.isPlaying && !this.userStoppedPlayback) {
                            await this.findAndPlayRecommendation(lastTrack);
                        }
                        this.isTransitioning = false;
                    }, 2000);
                } else {
                    console.log('⏹️ No more tracks to try - clearing position');
                    this.clearCurrentPosition();
                    this.isTransitioning = false;
                }
            } else {
                // Retry the current track with fallback methods
                console.log(`🔄 Retrying current track (attempt ${trackErrorCount + 1}/3)`);
                
                setTimeout(async () => {
                    if (!this.isPlaying && !this.userStoppedPlayback) {
                        // Force sourceHandlers to use different methods by clearing cache
                        if (this.sourceHandlers.clearStreamCache) {
                            this.sourceHandlers.clearStreamCache(trackId);
                        }
                        await this.play();
                    }
                    this.isTransitioning = false;
                }, 1000 * trackErrorCount); // Exponential backoff
            }
        } catch (error) {
            console.error('❌ Error in handleStreamError:', error);
            this.isTransitioning = false;
        }
    }
}

module.exports = MusicManager;