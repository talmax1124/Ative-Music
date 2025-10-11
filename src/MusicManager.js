const { createAudioPlayer, createAudioResource, AudioPlayerStatus, StreamType, demuxProbe } = require('@discordjs/voice');
const { createReadStream } = require('fs');
const config = require('../config.js');
const SmartAutoPlay = require('./SmartAutoPlay.js');
const UserPreferences = require('./UserPreferences.js');
const firebaseService = require('./FirebaseService.js');

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
        this.continuousPlayback = true; // Enable by default for seamless playback
        this.userStoppedPlayback = false; // Track if user manually stopped
        this.isTransitioning = false; // Prevent multiple track transitions
        this.onTrackEnd = null;
        this.onTrackStart = null;
        this.onQueueUpdate = null;
        this.autoPlayTimeout = null;
        this.firebaseService = firebaseService;
        this.isSeeking = false;
        this.shuffleEnabled = false;
        this._stopReason = null; // Reason for forced stop (e.g., 'skip')
        this._prefetchTimer = null;
        this._prefetched = new Set(); // track url -> prefetched
        this._scheduledDeletes = new Map(); // url -> timeoutId
        this._lastSaveKey = null;
        this._lastSaveAt = 0;
        
        this.setupPlayerEvents();
        // Disabled auto-loading queue on startup for fresh sessions
        // this.loadQueue();
    }

    setupPlayerEvents() {
        this.player.on(AudioPlayerStatus.Playing, () => {
            this.isPlaying = true;
            this.isPaused = false;
            // Preserve seek position if a seek just occurred
            if (typeof this._pendingSeekMs === 'number') {
                this.trackStartTime = Date.now() - this._pendingSeekMs;
                delete this._pendingSeekMs;
            } else {
                this.trackStartTime = Date.now(); // Track when playback actually starts
            }
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
            // Ignore Idle event triggered by intentional skip or seek
            if (this._stopReason === 'skip' || this._stopReason === 'seek') {
                this._stopReason = null;
                console.log('⏭️ Idle due to skip/seek — ignoring track-end handler');
                return;
            }
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
            try {
                if (this.currentTrack && error && error.message) {
                    this.currentTrack.lastError = String(error.message);
                }
            } catch {}
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
        this.connectionHealthy = true; // Reset connection health when new connection is set
        
        // Enhanced connection state handling with EPIPE protection
        this.connection.on('stateChange', (oldState, newState) => {
            console.log(`🔗 Connection state changed: ${oldState.status} -> ${newState.status}`);
            
            // Handle connection drops that could cause EPIPE
            if (newState.status === 'disconnected' || newState.status === 'destroyed') {
                console.log('⚠️ Voice connection dropped - stopping current playback to prevent EPIPE');
                this.handleConnectionDrop();
            }
            
            // Restore connection health when connection is ready
            if (newState.status === 'ready') {
                console.log('✅ Connection restored to ready state');
                this.connectionHealthy = true;
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
        // Normalize duration fields for reliable progress rendering
        try {
            if (track && track.durationMS == null) {
                if (typeof track.duration === 'number') track.durationMS = track.duration;
                else track.durationMS = this.parseDuration(track.duration);
            }
        } catch {}

        // Prevent duplicates at insertion time
        if (this.isDuplicate(track)) {
            console.log(`🚫 Duplicate detected, not adding to queue: ${track.title} by ${track.author}`);
            return Object.assign({}, track, { skippedDuplicate: true });
        }
        
        // Check if queue was empty before adding
        const wasEmpty = this.queue.length === 0;
        
        if (position === -1) {
            this.queue.push(track);
        } else {
            this.queue.splice(position, 0, track);
        }
        
        console.log(`📝 Added to queue: ${track.title} (Position: ${this.queue.length})`);

        // Background resolution/prefetch for Spotify tracks near the front
        try {
            const idx = (position === -1) ? (this.queue.length - 1) : position;
            const distanceFromCurrent = (this.currentTrackIndex < 0) ? idx : (idx - this.currentTrackIndex);
            if (track.source === 'spotify' && distanceFromCurrent >= 0 && distanceFromCurrent <= Math.max(2, Number(config.settings.prefetchDepth || 2))) {
                setTimeout(async () => {
                    try {
                        const resolved = await this.sourceHandlers.resolveForPlayback(track);
                        if (resolved) {
                            track._prefetchResolved = resolved;
                            if (this.sourceHandlers?.audioProcessor) {
                                await this.sourceHandlers.audioProcessor.downloadAndConvert(resolved.url, resolved.title, { guildId: this.guildId, channelId: this.channelId, prefetch: true });
                            }
                        }
                    } catch (e) {
                        console.log('⚠️ Background resolve/prefetch failed:', e?.message || e);
                    }
                }, 0);
            }
        } catch (_) {}
        
        // Track user preference if user context is provided
        if (userContext && userContext.userId && userContext.guildId) {
            this.userPreferences.trackPlay(userContext.userId, userContext.guildId, track);
        }
        
        // Auto-start playback if queue was empty and nothing is currently playing
        if (wasEmpty && !this.isPlaying && this.connection) {
            console.log(`🎵 Queue was empty, auto-starting playback with: ${track.title}`);
            this.currentTrackIndex = 0;
            // Start playback asynchronously to avoid blocking the add operation
            setTimeout(async () => {
                try {
                    await this.play();
                } catch (error) {
                    console.error(`❌ Auto-play failed:`, error);
                }
            }, 100);
        }
        
        // Only queue more tracks if we're actually low and playing
        if (this.queue.length <= 2 && this.autoPlayEnabled && this.continuousPlayback && (this.isPlaying || this.currentTrack)) {
            console.log('🔄 Queue running low, adding recommendations...');
            setTimeout(() => {
                this.fillQueueWithRecommendations(5, userContext || {});
            }, 1000);
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

        if (this.isPlaying && !this.isPaused) {
            console.log('⚠️ Already playing - stopping current track first');
            this.player.stop(true);
            await new Promise(resolve => setTimeout(resolve, 200));
        }
        
        this.currentTrack = this.queue[this.currentTrackIndex];
        
        if (!this.currentTrack) {
            console.error('❌ No track found at index', this.currentTrackIndex);
            return false;
        }
        
        this.userStoppedPlayback = false;
        
        try {
            console.log(`🎵 Attempting to play: ${this.currentTrack.title}`);
            
            // Check connection health before attempting stream
            if (!this.connectionHealthy || !this.connection) {
                console.log('⚠️ Connection not healthy - aborting playback to prevent EPIPE');
                this.handleStreamError();
                return false;
            }
            
            const stream = await this.sourceHandlers.getStream(this.currentTrack, { meta: { guildId: this.guildId, channelId: this.channelId, current: true } });
            
            if (!stream) {
                console.error('❌ Failed to get stream for track - no stream returned');
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
                // Suppress noisy errors caused by intentional seek/skip restarts
                if (this.isSeeking || this._stopReason) {
                    console.log(`⚠️ Stream error during ${this.isSeeking ? 'seek' : this._stopReason}: ${error?.message || error}`);
                    return;
                }
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

            // Create resource with minimal buffering for fastest start
            let resource;
            try {
                resource = createAudioResource(stream, {
                    inputType: StreamType.Arbitrary,
                    inlineVolume: true,
                    silencePaddingFrames: 0,  // No silence padding for faster start
                    metadata: {
                        title: this.currentTrack?.title || 'Unknown',
                        author: this.currentTrack?.author || 'Unknown'
                    }
                });
                console.log('⚡ Fast audio resource created');
            } catch (probeError) {
                console.log('⚠️ Resource creation failed, retrying with probe:', probeError.message);
                const probe = await demuxProbe(stream);
                resource = createAudioResource(probe.stream, {
                    inputType: probe.type,
                    inlineVolume: true,
                    silencePaddingFrames: 0,  // No silence padding
                    metadata: {
                        title: this.currentTrack?.title || 'Unknown',
                        author: this.currentTrack?.author || 'Unknown'
                    }
                });
            }

            resource.volume?.setVolume(this.volume / 100);

            this.player.play(resource);
            // Schedule prefetch of the next track near the end of current
            this.schedulePrefetchNext();
            
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
            console.error('❌ Error playing track:', error.message);
            console.error('❌ Full error details:', error);
            
            // If all streaming methods failed, try to skip to next track
            if (error.message.includes('All streaming methods failed')) {
                console.log('❌ All streaming methods failed for this track, skipping...');
                this.handleStreamError();
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
            this.handleStreamError();
            return false;
        }
    }

    schedulePrefetchNext() {
        try {
            if (this._prefetchTimer) {
                clearTimeout(this._prefetchTimer);
                this._prefetchTimer = null;
            }
            const lead = Number(config.settings.prefetchLeadMs || 30000);
            const depth = Math.max(1, Math.min(5, Number(config.settings.prefetchDepth || 2)));
            const durationMs = Number(this.currentTrack?.durationMS || this.parseDuration(this.currentTrack?.duration || '0:00'));
            const elapsed = Math.max(0, Date.now() - (this.trackStartTime || Date.now()));
            const msUntilPrefetch = Math.max(0, durationMs - elapsed - lead);

            const prefetchTrack = async (t) => {
                if (!t || !t.url) return;
                if (this._prefetched.has(t.url)) return;
                try {
                    if (t.source === 'spotify') {
                        // Resolve and store for later
                        const resolved = await this.sourceHandlers.resolveForPlayback(t);
                        if (resolved) {
                            t._prefetchResolved = resolved;
                            // Warm MP3
                            if (this.sourceHandlers?.audioProcessor) {
                                await this.sourceHandlers.audioProcessor.downloadAndConvert(resolved.url, resolved.title, { guildId: this.guildId, channelId: this.channelId, prefetch: true });
                            }
                        }
                    } else if (t.source === 'youtube' && this.sourceHandlers?.audioProcessor) {
                        await this.sourceHandlers.audioProcessor.downloadAndConvert(t.url, t.title, { guildId: this.guildId, channelId: this.channelId, prefetch: true });
                    }
                    this._prefetched.add(t.url);
                    console.log(`✅ Prefetched: ${t.title}`);
                } catch (e) {
                    console.log(`⚠️ Prefetch failed for ${t?.title || 'Unknown'}: ${e?.message || e}`);
                }
            };

            const doPrefetch = async () => {
                const nextStart = this.currentTrackIndex + 1;
                const end = Math.min(this.queue.length, nextStart + depth);
                for (let i = nextStart; i < end; i++) {
                    await prefetchTrack(this.queue[i]);
                }
            };

            if (msUntilPrefetch <= 0) doPrefetch();
            else this._prefetchTimer = setTimeout(doPrefetch, msUntilPrefetch);
        } catch (_) { /* ignore */ }
    }

    // Jump to a specific index in the queue and start playing
    async jumpTo(index) {
        if (typeof index !== 'number' || index < 0 || index >= this.queue.length) return false;
        this.currentTrackIndex = index;
        try {
            this.player.stop(true);
        } catch {}
        await new Promise(r => setTimeout(r, 150));
        return this.play();
    }

    // Toggle shuffle: performs a one-time shuffle of the remaining queue
    toggleShuffle() {
        this.shuffleEnabled = !this.shuffleEnabled;
        if (this.shuffleEnabled) {
            this.shuffle();
        }
        return this.shuffleEnabled;
    }

    // Cycle repeat mode: off -> track -> queue -> off
    toggleRepeat() {
        const order = ['off', 'track', 'queue'];
        const next = order[(order.indexOf(this.loopMode) + 1) % order.length];
        this.setLoop(next);
        return this.loopMode;
    }

    // Seek to a position in seconds within the current track
    async seek(seconds) {
        if (!this.currentTrack || typeof seconds !== 'number' || seconds < 0) return false;
        if (this.isTransitioning || this.isSeeking) {
            console.log('⚠️ Seek ignored during transition');
            return false;
        }
        this.isSeeking = true;
        try {
            // Stop current playback cleanly (mark reason to suppress idle handler)
            this._stopReason = 'seek';
            this.player.stop(true);
        } catch {}

        try {
            // Request a new stream starting at the desired offset
            const stream = await this.sourceHandlers.getStream(this.currentTrack, { seekSeconds: seconds });
            if (!stream || !stream.readable || stream.destroyed) {
                console.error('❌ Seek stream invalid');
                return false;
            }

            // Recreate audio resource from the new stream; prefer fast path
            let resource;
            try {
                resource = createAudioResource(stream, {
                    inputType: StreamType.Arbitrary,
                    inlineVolume: true,
                    silencePaddingFrames: 3,
                    metadata: {
                        title: this.currentTrack?.title || 'Unknown',
                        author: this.currentTrack?.author || 'Unknown'
                    }
                });
            } catch (probeError) {
                console.log('⚠️ Seek resource failed, retry with probe:', probeError.message);
                const probe = await demuxProbe(stream);
                resource = createAudioResource(probe.stream, {
                    inputType: probe.type,
                    inlineVolume: true,
                    silencePaddingFrames: 3,
                    metadata: {
                        title: this.currentTrack?.title || 'Unknown',
                        author: this.currentTrack?.author || 'Unknown'
                    }
                });
            }

            resource.volume?.setVolume(this.volume / 100);
            // Adjust start time so progress reflects seek position
            this._pendingSeekMs = Math.floor(seconds * 1000);
            this.trackStartTime = Date.now() - this._pendingSeekMs;
            this.player.play(resource);
            // Clear the stop reason once new playback has begun
            this._stopReason = null;
            this.isPlaying = true;
            this.isPaused = false;
            return true;
        } catch (error) {
            console.error('❌ Seek failed:', error?.message || error);
            return false;
        } finally {
            this.isSeeking = false;
        }
    }

    async skip() {
        if (this.queue.length === 0) return false;

        console.log(`⏭️ Skip requested - advancing from index ${this.currentTrackIndex} to ${this.currentTrackIndex + 1}`);
        
        clearTimeout(this.autoPlayTimeout);
        this.isTransitioning = false;
        
        // Mark reason so Idle handler doesn't treat this as a natural end
        this._stopReason = 'skip';
        this.player.stop(true);

        if (this.loopMode === 'track') {
            console.log('🔁 Loop mode: track - replaying current track');
            setTimeout(() => this.play(), 300);
            return true;
        }

        // Remove the current track from queue when skipped
        if (this.currentTrackIndex >= 0 && this.currentTrackIndex < this.queue.length) {
            const skippedTrack = this.queue.splice(this.currentTrackIndex, 1)[0];
            console.log(`🗑️ Removed skipped track from queue: ${skippedTrack?.title || 'Unknown'}`);
            this.scheduleTrackCleanup(skippedTrack);
            this.saveQueue();
        }

        console.log(`📍 Skipped to track index ${this.currentTrackIndex} of ${this.queue.length} total tracks`);
        
        if (this.currentTrackIndex >= this.queue.length) {
            if (this.loopMode === 'queue') {
                console.log('🔁 Loop mode: queue - returning to beginning');
                this.currentTrackIndex = 0;
                setTimeout(() => this.play(), 300);
                return true;
            } else {
                console.log('⏹️ Reached end of queue - stopping playback');
                this.stop();
                return false;
            }
        }

        console.log(`🎵 Next track after skip: ${this.queue[this.currentTrackIndex]?.title || 'Unknown'}`);
        setTimeout(() => this.play(), 300);
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
            // capture current position for accurate resume/progress
            if (this.trackStartTime) {
                this._lastPositionAtPauseMs = Date.now() - this.trackStartTime;
            }
            this.player.pause();
            return true;
        }
        return false;
    }

    resume() {
        if (this.isPaused) {
            if (typeof this._lastPositionAtPauseMs === 'number') {
                this.trackStartTime = Date.now() - this._lastPositionAtPauseMs;
                delete this._lastPositionAtPauseMs;
            }
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
        if (this._prefetchTimer) {
            clearTimeout(this._prefetchTimer);
            this._prefetchTimer = null;
        }
        
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
        if (this._prefetchTimer) {
            clearTimeout(this._prefetchTimer);
            this._prefetchTimer = null;
        }
        
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

    getCurrentTrack() {
        return this.currentTrack;
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
            queueDuration: this.getTotalDuration(),
            currentPositionMs: this.getCurrentPositionMs()
        };
    }

    getCurrentPositionMs() {
        if (!this.currentTrack || !this.trackStartTime) return 0;
        if (this.isPaused) {
            // Approximate position at pause time
            return Math.max(0, (this._lastPositionAtPauseMs ?? (Date.now() - this.trackStartTime)));
        }
        const pos = Date.now() - this.trackStartTime;
        return pos > 0 ? pos : 0;
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
        if (this.isTransitioning) {
            console.log('⚠️ Track end ignored - already transitioning');
            return;
        }
        this.isTransitioning = true;
        clearTimeout(this.autoPlayTimeout);

        try {
            const finishedTrack = this.currentTrack;
            // Remove finished track from queue to keep it clean
            if (typeof this.currentTrackIndex === 'number' && this.currentTrackIndex >= 0 && this.currentTrackIndex < this.queue.length) {
                this.queue.splice(this.currentTrackIndex, 1);
                console.log(`🗑️ Removed finished track from queue: ${finishedTrack?.title || 'Unknown'}`);
                this.scheduleTrackCleanup(finishedTrack);
                // Persist updated queue
                this.saveQueue();
            }

            // Play next track if it exists at same index
            if (this.currentTrackIndex < this.queue.length) {
                console.log(`▶️ Advancing to next track: ${this.queue[this.currentTrackIndex]?.title || 'Unknown'}`);
                await this.play();
                return;
            }

            // Loop entire queue if enabled
            if (this.loopMode === 'queue' && this.queue.length > 0) {
                this.currentTrackIndex = 0;
                console.log('🔁 Loop mode: queue - restarting from beginning');
                await this.play();
                return;
            }

            // Try recommendation if enabled
            const endBehavior = (config.settings.endOfQueueBehavior || 'recommendations').toLowerCase();
            if (this.autoPlayEnabled && this.continuousPlayback && endBehavior === 'recommendations') {
                const lastTrack = this.currentTrack || this.playHistory[this.playHistory.length - 1] || null;
                console.log('🤖 Queue finished - attempting recommendation');
                await this.findAndPlayRecommendation(lastTrack);
                return;
            }

            // Otherwise stop cleanly
            console.log('⏹️ End of queue - stopping');
            this.stop(false);
        } catch (e) {
            console.error('❌ Error handling track end:', e);
        } finally {
            this.isTransitioning = false;
        }
    }

    scheduleTrackCleanup(track) {
        try {
            if (!track || !track.url) return;
            if (!config.settings.autoDeleteFinishedTrack) return;
            const delay = Number(config.settings.deleteDelayMs || 60000);
            const url = track.url;
            const existing = this._scheduledDeletes.get(url);
            if (existing) clearTimeout(existing);
            const timer = setTimeout(() => {
                try {
                    if (track.source === 'youtube') {
                        if (this.sourceHandlers?.audioProcessor) {
                            this.sourceHandlers.audioProcessor.deleteCachedByUrl(url);
                        }
                        // Also remove fallback cache if it exists
                        try {
                            const dc = this.sourceHandlers?.downloadCache;
                            const vid = dc?.extractVideoId ? dc.extractVideoId(url) : null;
                            if (dc && vid) {
                                const fp = dc.getCacheFilePath(vid);
                                const fs = require('fs');
                                if (fs.existsSync(fp)) {
                                    fs.unlinkSync(fp);
                                    console.log(`🗑️ Deleted fallback cache for video ${vid}`);
                                }
                            }
                        } catch (_) {}
                    }
                } catch (e) {
                    console.log(`⚠️ Cleanup failed: ${e?.message || e}`);
                } finally {
                    this._scheduledDeletes.delete(url);
                }
            }, delay);
            this._scheduledDeletes.set(url, timer);
        } catch (_) {}
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
        if (!track) return false;
        const key = this._trackKey(track);
        // Check queue
        const inQueue = this.queue.some(t => this._trackKey(t) === key || (t.id && track.id && t.id === track.id) || (t.url && track.url && t.url === track.url));
        if (inQueue) return true;
        // Check recent history (last 20 plays)
        const recentlyPlayed = this.playHistory.slice(-20).some(t => this._trackKey(t) === key || (t.url && track.url && t.url === track.url));
        return recentlyPlayed;
    }

    _normalize(str) {
        try {
            return String(str)
                .toLowerCase()
                .replace(/\([^\)]*\)|\[[^\]]*\]/g, '') // remove parentheses/brackets
                .replace(/official|mv|video|audio|lyrics|lyric|remastered|hd|4k/gi, '')
                .replace(/[^a-z0-9]+/gi, ' ')
                .trim()
                .replace(/\s+/g, ' ');
        } catch { return ''; }
    }

    _trackKey(track) {
        if (!track) return '';
        const t = this._normalize(track.title || '');
        const a = this._normalize(track.author || '');
        const id = track.id || track.videoId || '';
        const urlId = (track.url || '').replace(/^https?:\/\//, '');
        return `${t}::${a}::${id}::${urlId}`;
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
                // Check for duplicates before adding to queue
                if (!this.isDuplicate(recommendation)) {
                    await this.addToQueue(recommendation);
                } else {
                    console.log(`🚫 Skipping duplicate recommendation: ${recommendation.title} by ${recommendation.author}`);
                }
            }
            
            console.log(`✅ Added ${recommendations.length} tracks to queue`);
        } catch (error) {
            console.error('❌ Failed to fill queue:', error);
        }
    }

    setAutoPlay(enabled) {
        this.autoPlayEnabled = enabled;
        console.log(`🤖 Auto-play ${enabled ? 'enabled' : 'disabled'}`);
        
        if (enabled && this.connection) {
            if (this.queue.length === 0) {
                // Start auto-play immediately if queue is empty
                this.findAndPlayRecommendation();
            } else if (this.queue.length <= 2 && (this.isPlaying || this.currentTrack)) {
                // Fill queue with recommendations if we only have 1-2 songs
                console.log('🎵 Auto-play enabled - filling queue with recommendations...');
                setTimeout(() => {
                    this.fillQueueWithRecommendations(5, {});
                }, 1000);
            }
        }
        
        return enabled;
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
        clearTimeout(this.autoPlayTimeout);
        this.isTransitioning = false;
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
            // Sanitize queue data to remove undefined values
            const sanitizedQueue = this.queue.map(track => ({
                ...track,
                title: track.title || 'Unknown Title',
                author: track.author || 'Unknown Artist',
                duration: track.duration || '0:00',
                thumbnail: track.thumbnail || null, // Convert undefined to null for Firestore
                url: track.url || '',
                source: track.source || 'unknown',
                type: track.type || 'track'
            }));
            // Throttle redundant saves to reduce log spam
            const signature = JSON.stringify({
                q: sanitizedQueue.map(t => ({ u: t.url, s: t.source })),
                i: this.currentTrackIndex,
                l: this.loopMode,
                v: this.volume,
                a: this.autoPlayEnabled,
                c: this.continuousPlayback
            });
            const now = Date.now();
            const minInterval = Number(config.settings.queueSaveThrottleMs || 3000);
            if (signature === this._lastSaveKey && (now - this._lastSaveAt) < minInterval) {
                return; // skip redundant save
            }
            
            const queueData = {
                queue: sanitizedQueue,
                currentTrackIndex: this.currentTrackIndex,
                loopMode: this.loopMode,
                volume: this.volume,
                autoPlayEnabled: this.autoPlayEnabled,
                continuousPlayback: this.continuousPlayback
            };
            await this.firebaseService.saveQueue(this.guildId, this.channelId, queueData);
            console.log(`💾 Queue saved for channel ${this.channelId} (guild ${this.guildId})`);
            this._lastSaveKey = signature;
            this._lastSaveAt = now;
        } catch (error) {
            console.error('❌ Failed to save queue:', error);
        }
    }

    async loadQueue() {
        try {
            const queueData = await this.firebaseService.loadQueue(this.guildId);
            
            if (!queueData) {
                console.log(`🆕 Starting fresh queue for guild ${this.guildId}`);
                return;
            }
            
            const originalQueue = queueData.queue || [];
            
            this.queue = originalQueue.filter(track => track.source !== 'youtube');
            const removedCount = originalQueue.length - this.queue.length;
            
            if (removedCount > 0) {
                console.log(`🚨 Removed ${removedCount} broken YouTube tracks from queue`);
            }
            
            this.currentTrackIndex = -1;
            this.loopMode = queueData.loopMode || 'off';
            this.volume = queueData.volume || config.settings.defaultVolume;
            this.autoPlayEnabled = queueData.autoPlayEnabled !== undefined ? queueData.autoPlayEnabled : true;
            this.continuousPlayback = queueData.continuousPlayback !== undefined ? queueData.continuousPlayback : true;
            
            console.log(`🔧 Restored settings: autoPlay=${this.autoPlayEnabled}, continuous=${this.continuousPlayback}`);
            
            console.log(`💿 Restored queue for guild ${this.guildId}: ${this.queue.length} tracks (${removedCount} YouTube tracks removed)`);
            
            if (removedCount > 0) {
                this.saveQueue();
            }
        } catch (error) {
            console.log(`🆕 Starting fresh queue for guild ${this.guildId}`);
        }
    }

    async clearPersistedQueue() {
        try {
            await this.firebaseService.clearQueue(this.guildId);
            console.log(`🗑️ Cleared persisted queue for guild ${this.guildId}`);
        } catch (error) {
            console.error('❌ Failed to clear persisted queue:', error);
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
        if (this.isSeeking) {
            console.log('⚠️ Suppressing stream error during active seek');
            return;
        }
        
        if (this.isTransitioning) {
            console.log('⚠️ Stream error ignored - already transitioning');
            return;
        }
        
        this.isTransitioning = true;
        clearTimeout(this.autoPlayTimeout);
        
        const errorTimeout = setTimeout(() => {
            console.log('⚠️ Stream error recovery timeout - forcing reset');
            this.isTransitioning = false;
        }, 15000);
        
        try {
            // Track errors per track
            const trackId = this.currentTrack?.url || 'unknown';
            this.trackErrors = this.trackErrors || new Map();
            const trackErrorCount = (this.trackErrors.get(trackId) || 0) + 1;
            this.trackErrors.set(trackId, trackErrorCount);
            // Advance extractor fallback; let SourceHandlers manage yt-dlp format cycling
            if (this.currentTrack) {
                this.currentTrack._fallbackIndex = Number(this.currentTrack._fallbackIndex || 0) + 1;
            }
            
            // Global consecutive error count
            this.consecutiveErrors = (this.consecutiveErrors || 0) + 1;
            
            // If too many global errors, try to advance or fetch recommendation
            if (this.consecutiveErrors > 8) {
                console.log('🚨 Too many consecutive stream errors - attempting auto-recovery');
                if (this.currentTrackIndex + 1 < this.queue.length) {
                    console.log('🔄 Skipping to next track in queue due to errors');
                    this.currentTrackIndex++;
                    setTimeout(async () => {
                        try { await this.play(); } catch (e) { console.error('❌ Recovery play failed:', e); }
                        this.isTransitioning = false;
                        clearTimeout(errorTimeout);
                    }, 500);
                    return;
                } else if (this.autoPlayEnabled && this.continuousPlayback) {
                    console.log('🤖 Queue empty on error - trying recommendation');
                    const lastTrack = this.currentTrack || this.playHistory[this.playHistory.length - 1];
                    setTimeout(async () => {
                        try { await this.findAndPlayRecommendation(lastTrack); } catch (e) { console.error('❌ Recovery recommendation failed:', e); }
                        this.isTransitioning = false;
                        clearTimeout(errorTimeout);
                    }, 1000);
                    return;
                } else {
                    console.log('⏹️ No recovery path available - stopping');
                    this.stop();
                    this.isTransitioning = false;
                    return;
                }
            }
            
            // If this specific track has failed too many times, skip it
            if (trackErrorCount >= 5) {
                console.log(`🔄 Track "${this.currentTrack?.title}" failed ${trackErrorCount} times - skipping to next`);
                
                // Try next track if available
                if (this.currentTrackIndex + 1 < this.queue.length) {
                    console.log(`🔄 Moving to next track in queue: ${this.queue[this.currentTrackIndex + 1]?.title}`);
                    this.currentTrackIndex++;
                    console.log(`📍 Advanced to track index ${this.currentTrackIndex} after stream error`);
                    
                    setTimeout(async () => {
                        try {
                            if (!this.isPlaying && !this.userStoppedPlayback) {
                                await this.play();
                            }
                        } catch (error) {
                            console.error('❌ Error recovering from stream error:', error);
                        } finally {
                            this.isTransitioning = false;
                            clearTimeout(errorTimeout);
                        }
                    }, 2000);
                } else if (this.autoPlayEnabled && this.continuousPlayback) {
                    // No more tracks in queue, try to find recommendation
                    console.log('🤖 Queue empty after error - finding recommendation');
                    const lastTrack = this.currentTrack || this.playHistory[this.playHistory.length - 1];
                    
                    setTimeout(async () => {
                        try {
                            if (!this.isPlaying && !this.userStoppedPlayback) {
                                await this.findAndPlayRecommendation(lastTrack);
                            }
                        } catch (error) {
                            console.error('❌ Error finding recommendation after error:', error);
                        } finally {
                            this.isTransitioning = false;
                            clearTimeout(errorTimeout);
                        }
                    }, 2000);
                } else {
                    console.log('⏹️ No more tracks to try - clearing position');
                    this.clearCurrentPosition();
                    this.isTransitioning = false;
                    clearTimeout(errorTimeout);
                }
            } else {
                // Check if this is a DRM or persistent streaming error - skip immediately
                const currentTrack = this.getCurrentTrack();
                const shouldSkipImmediately = currentTrack && (
                    currentTrack.lastError?.includes('DRM protected') ||
                    (currentTrack.lastError?.includes('Status code: 403') && trackErrorCount >= 3) ||
                    trackErrorCount >= 4 // Skip after 4 failed attempts
                );
                
                if (shouldSkipImmediately) {
                    console.log(`⏭️ Skipping problematic track immediately: ${currentTrack.title}`);
                    setTimeout(async () => {
                        try {
                            await this.skip();
                        } catch (error) {
                            console.error('❌ Error skipping problematic track:', error);
                        } finally {
                            this.isTransitioning = false;
                            clearTimeout(errorTimeout);
                        }
                    }, 500);
                } else {
                    // Retry the current track with fallback methods
                    console.log(`🔄 Retrying current track (attempt ${trackErrorCount + 1}/3)`);
                    
                    setTimeout(async () => {
                        try {
                            if (!this.isPlaying && !this.userStoppedPlayback) {
                                if (this.sourceHandlers.clearStreamCache) {
                                    this.sourceHandlers.clearStreamCache(trackId);
                                }
                                // Leave yt-dlp format rotation to SourceHandlers
                                await this.play();
                            }
                        } catch (error) {
                            console.error('❌ Error retrying track:', error);
                        } finally {
                            this.isTransitioning = false;
                            clearTimeout(errorTimeout);
                        }
                    }, Math.min(1000 * trackErrorCount, 3000)); // Cap retry delay at 3 seconds
                }
            }
        } catch (error) {
            console.error('❌ Error in handleStreamError:', error);
            this.isTransitioning = false;
            clearTimeout(errorTimeout);
        }
    }
}

module.exports = MusicManager;
