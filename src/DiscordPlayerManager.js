const { Player } = require('discord-player');
const { GuildQueuePlayerNode } = require('discord-player');

class DiscordPlayerManager {
    constructor(client) {
        this.client = client;
        this.player = new Player(client);
        this.initialized = false;
        this.youtubeEnabled = false;
        
        // Track ongoing streams to manage concurrency
        this.activeStreams = new Set();
        this.maxConcurrentStreams = 4;
        
        this.initializePlayer();
    }

    async initializePlayer() {
        try {
            console.log('🚀 Initializing Discord Player with all extractors...');
            
            // Load all available extractors using the new API
            const { DefaultExtractors } = require('@discord-player/extractor');
            await this.player.extractors.loadMulti(DefaultExtractors);
            console.log('✅ Default extractors loaded');
            
            // Add working YouTube extractor with conservative configuration
            try {
                const { YoutubeiExtractor } = require('discord-player-youtubei');
                await this.player.extractors.register(YoutubeiExtractor, {
                    streamOptions: { 
                        useClient: "ANDROID",  // More stable than WEB
                        quality: "lowestaudio" // Lower quality for better reliability
                    }
                });
                console.log('✅ YouTubei extractor registered with conservative settings');
                this.youtubeEnabled = true;
            } catch (youtubeError) {
                console.warn('⚠️ Failed to register YouTubei extractor:', youtubeError.message);
                console.log('🔄 YouTube support disabled - will rely on other sources');
                this.youtubeEnabled = false;
            }
            
            // Configure player options for faster streaming
            this.player.options.ytdlOptions = {
                quality: 'lowestaudio', // Changed from 'highestaudio' for speed
                filter: 'audioonly', // Ensure audio-only streaming
                highWaterMark: 1 << 20, // Reduced from 1 << 25 for faster start
                requestOptions: {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
                    }
                },
                begin: 0 // Start immediately
            };

            // Setup error handling
            this.setupEventHandlers();
            
            // Enable debug logging for troubleshooting
            this.player.on('debug', (message) => {
                if (message.includes('YouTube') || message.includes('search') || message.includes('failed')) {
                    console.log(`🔍 [Discord Player Debug] ${message}`);
                }
            });
            
            this.initialized = true;
            console.log('✅ Discord Player initialized successfully');
            
            // Wait a moment for extractors to fully register
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Log available extractors
            try {
                const extractorStore = this.player.extractors;
                if (extractorStore && extractorStore.cache && extractorStore.cache.size > 0) {
                    const extractors = Array.from(extractorStore.cache.keys());
                    console.log('🔧 Available extractors:', extractors);
                } else if (extractorStore && extractorStore.store && extractorStore.store.size > 0) {
                    const extractors = Array.from(extractorStore.store.keys());
                    console.log('🔧 Available extractors:', extractors);
                } else {
                    console.log('🔧 Available extractors: No extractors found in cache');
                }
            } catch (error) {
                console.log('🔧 Available extractors: Unable to read cache -', error.message);
            }
            
        } catch (error) {
            console.error('❌ Failed to initialize Discord Player:', error);
            throw error;
        }
    }

    setupEventHandlers() {
        this.player.events.on('playerStart', (queue, track) => {
            console.log(`🎵 Started playing: ${track.title} by ${track.author}`);
        });

        this.player.events.on('playerError', (queue, error) => {
            console.error('❌ Discord Player error:', error.message || error);
            // Handle Opus encoding errors gracefully
            if (error.message && error.message.includes('Cannot convert')) {
                console.log('🔧 Opus encoding error detected - attempting recovery');
                if (queue && queue.node) {
                    queue.node.skip();
                }
            }
        });

        this.player.events.on('error', (queue, error) => {
            console.error('❌ Discord Player queue error:', error.message || error);
            
            // Handle specific error types
            if (error.message) {
                // Prevent crashes from encoding errors
                if (error.message.includes('opusscript') || error.message.includes('Cannot convert')) {
                    console.log('🔧 Audio encoding error - skipping track');
                    if (queue && queue.node) {
                        queue.node.skip();
                    }
                }
                // Handle abort errors
                else if (error.message.includes('AbortError') || error.message.includes('operation was aborted')) {
                    console.log('🔧 AbortError detected - attempting queue recovery');
                    setTimeout(() => {
                        if (queue && !queue.deleted && queue.node) {
                            console.log('🔄 Retrying after abort...');
                            queue.node.skip();
                        }
                    }, 2000);
                }
                // Handle network/connection errors
                else if (error.message.includes('ECONNRESET') || error.message.includes('timeout')) {
                    console.log('🔧 Network error detected - retrying connection');
                    if (queue && queue.node) {
                        queue.node.skip();
                    }
                }
            }
        });

        this.player.events.on('playerFinish', (queue, track) => {
            console.log(`✅ Finished playing: ${track.title}`);
        });

        this.player.events.on('disconnect', (queue) => {
            console.log('🔌 Discord Player disconnected from voice channel');
        });

        this.player.events.on('emptyQueue', (queue) => {
            console.log('📭 Queue is empty');
        });
    }

    // Search method compatible with existing SourceHandlers interface
    async search(query, limit = 10) {
        if (!this.initialized) {
            console.warn('⚠️ Discord Player not initialized, attempting to initialize...');
            await this.initializePlayer();
        }

        try {
            console.log(`🔍 [Discord Player] Searching: ${query}`);
            
            // Try multiple search strategies - prioritize reliable sources for actual playback
            let searchStrategies = [
                { engine: 'soundcloud', options: { limit: limit } }, // Most reliable for streaming
                { engine: 'spotify', options: {} },
                { engine: null, options: {} } // Let discord-player auto-detect
            ];
            
            // Add YouTube strategies as fallback if enabled (due to abort issues)
            if (this.youtubeEnabled) {
                searchStrategies.push(
                    { engine: 'youtube', options: {} },
                    { engine: 'youtubeSearch', options: {} }
                );
            }
            
            for (const { engine, options } of searchStrategies) {
                try {
                    const searchOptions = engine ? { searchEngine: engine, ...options } : options;
                    console.log(`🎯 Trying ${engine || 'auto-detect'} for: ${query}`);
                    
                    const searchResult = await this.player.search(query, searchOptions);

                    if (searchResult && searchResult.tracks && searchResult.tracks.length > 0) {
                        // Format results to match our existing interface
                        const formattedResults = searchResult.tracks.slice(0, limit).map(track => ({
                            title: track.title,
                            author: track.author,
                            url: track.url,
                            duration: track.duration,
                            thumbnail: track.thumbnail,
                            source: track.source || engine || 'unknown',
                            viewCount: track.views || 0,
                            publishedAt: track.publishedAt || track.uploadedAt
                        }));

                        console.log(`✅ [Discord Player] Found ${formattedResults.length} results from ${engine || 'auto-detect'}`);
                        return formattedResults;
                    } else {
                        console.log(`⚠️ No results from ${engine || 'auto-detect'}`);
                    }
                } catch (engineError) {
                    console.warn(`❌ ${engine || 'auto-detect'} search failed: ${engineError.message}`);
                    continue;
                }
            }

            console.log(`⚠️ [Discord Player] No results found from any source for: ${query}`);
            return [];

        } catch (error) {
            console.error(`❌ [Discord Player] Search failed: ${error.message}`);
            return [];
        }
    }

    // Get stream method compatible with existing interface
    async getStream(track, options = {}) {
        if (!this.initialized) {
            await this.initializePlayer();
        }

        try {
            // Check concurrent stream limit
            if (this.activeStreams.size >= this.maxConcurrentStreams) {
                console.warn(`⚠️ Max concurrent streams reached (${this.maxConcurrentStreams})`);
                throw new Error('Max concurrent streams reached');
            }

            const streamId = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            this.activeStreams.add(streamId);

            console.log(`🚀 [Discord Player] Creating stream for: ${track.title || track.url}`);

            // For discord-player, we don't create streams directly
            // Instead, we return a compatible object that the MusicManager can use
            const compatibleTrack = {
                title: track.title,
                author: track.author,
                url: track.url,
                duration: track.duration,
                thumbnail: track.thumbnail,
                source: 'discord-player',
                discordPlayerTrack: track // Store original track for discord-player
            };

            // Clean up stream tracking after timeout
            setTimeout(() => {
                this.activeStreams.delete(streamId);
            }, 30000);

            return compatibleTrack;

        } catch (error) {
            console.error(`❌ [Discord Player] Stream creation failed: ${error.message}`);
            throw error;
        }
    }

    // Play method that works with existing MusicManager
    async playTrack(voiceChannel, track, options = {}) {
        if (!this.initialized) {
            await this.initializePlayer();
        }

        if (!voiceChannel) {
            throw new Error('Voice channel is required for playback');
        }

        if (!voiceChannel.guild) {
            throw new Error('Voice channel must be part of a guild');
        }

        try {
            // Create or get existing queue
            let queue = this.player.nodes.get(voiceChannel.guild.id);
            
            if (!queue) {
                queue = this.player.nodes.create(voiceChannel.guild, {
                    metadata: {
                        voiceChannel: voiceChannel,
                        textChannel: options.textChannel
                    },
                    selfDeaf: true,
                    volume: options.volume || 50,
                    leaveOnEmpty: true,
                    leaveOnEmptyCooldown: 300000, // 5 minutes
                    leaveOnEnd: false,
                    // Optimizations for faster streaming
                    bufferingTimeout: 2000, // Reduce from default 3000ms
                    connectionTimeout: 15000, // Faster connection establishment
                    disableHistory: true, // Reduce memory usage
                    pauseOnEmpty: false // Don't pause when queue empties temporarily
                });
            }

            // Connect to voice channel if not connected
            if (!queue.connection) {
                await queue.connect(voiceChannel);
            }

            // If track is a search result, search for it
            let trackToPlay = track;
            if (typeof track === 'string' || (!track.discordPlayerTrack && track.url)) {
                const searchQuery = track.title ? `${track.author} ${track.title}` : track.url || track;
                const searchResult = await this.player.search(searchQuery);
                
                if (searchResult.tracks.length > 0) {
                    trackToPlay = searchResult.tracks[0];
                } else {
                    throw new Error('No playable track found');
                }
            } else if (track.discordPlayerTrack) {
                trackToPlay = track.discordPlayerTrack;
            }

            // Add track to queue and play
            queue.addTrack(trackToPlay);
            
            if (!queue.isPlaying()) {
                await queue.node.play();
            }

            return {
                success: true,
                track: trackToPlay,
                queue: queue
            };

        } catch (error) {
            console.error(`❌ [Discord Player] Play failed: ${error.message}`);
            throw error;
        }
    }

    // Get queue for a guild
    getQueue(guildId) {
        return this.player.nodes.get(guildId);
    }

    // Handle URL method compatible with existing interface
    async handleURL(url) {
        try {
            const searchResult = await this.player.search(url);
            
            if (searchResult.tracks.length > 0) {
                const track = searchResult.tracks[0];
                return {
                    title: track.title,
                    author: track.author,
                    url: track.url,
                    duration: track.duration,
                    thumbnail: track.thumbnail,
                    source: 'discord-player'
                };
            }
            
            return null;
        } catch (error) {
            console.error(`❌ [Discord Player] URL handling failed: ${error.message}`);
            return null;
        }
    }

    // Get system status for monitoring
    getSystemStatus() {
        const queues = this.player.nodes.cache;
        const activeQueues = queues.filter(queue => queue.isPlaying()).size;
        
        return {
            initialized: this.initialized,
            activeQueues: activeQueues,
            totalQueues: queues.size,
            activeStreams: this.activeStreams.size,
            maxConcurrentStreams: this.maxConcurrentStreams,
            extractors: this.player.extractors.cache.size
        };
    }

    // Cleanup method
    async cleanup() {
        console.log('🛑 Cleaning up Discord Player...');
        
        try {
            // Stop all queues
            for (const queue of this.player.nodes.cache.values()) {
                if (queue.connection) {
                    queue.delete();
                }
            }
            
            // Clear active streams
            this.activeStreams.clear();
            
            console.log('✅ Discord Player cleanup completed');
        } catch (error) {
            console.error('❌ Discord Player cleanup failed:', error);
        }
    }
}

module.exports = DiscordPlayerManager;