const { Player, GuildQueue, Track } = require('discord-player');
const fs = require('fs');
const path = require('path');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const config = require('../config.js');
const optimizedConfig = require('./OptimizedConfig.js');

class DiscordPlayerManager {
    constructor(client) {
        this.client = client;
        this.player = new Player(client, {
            ...optimizedConfig.player,
            volume: config.settings.defaultVolume,
        });

        // Store per-guild Now Playing messages for in-place UI updates
        this.nowPlayingMessages = new Map();

        // Initialize extractors for multiple sources
        this.initializeExtractors();

        this.setupPlayerEvents();
        this.setupErrorHandlers();
        this.setupPerformanceOptimizations();
        this.setupStreamHooks();

        // Per-guild autoplay state (defaults to enabled)
        this.autoplayState = new Map();
        this.autoplayPrefsPath = path.join(process.cwd(), 'data', 'guild_prefs.json');
        this.loadAutoplayState();
    }

    async initializeExtractors() {
        try {
            // Set yt-dlp path for YtDlpExtractor
            process.env.YTDL_BINARY_PATH = '/opt/homebrew/bin/yt-dlp';
            
            // Use require instead of dynamic import to avoid module resolution issues
            const extractors = [];
            
            // Try to load main extractor
            try {
                const { DefaultExtractors } = require('@discord-player/extractor');
                extractors.push(DefaultExtractors);
                console.log('✅ Default extractors loaded');
            } catch (err) {
                console.log('⚠️ Default extractors not available');
            }
            
            // Skip problematic extractors that cause stream issues
            // YoutubeiExtractor has streaming issues - streams end immediately
            // Using DefaultExtractors which is more reliable
            console.log('✅ Using stable DefaultExtractors for YouTube playback');
            
            // Try to load TTS plugin (discord-player-tts)
            try {
                const { TTSExtractor } = require('discord-player-tts');
                if (TTSExtractor) {
                    await this.player.extractors.register(TTSExtractor, { language: 'en', slow: false });
                    console.log('✅ discord-player-tts registered');
                } else {
                    console.log('ℹ️ discord-player-tts: TTSExtractor export not found');
                }
            } catch (e) {
                console.log('ℹ️ TTS plugin not found or failed to load:', e?.message || e);
            }

            // Load available extractors
            if (extractors.length > 0) {
                await this.player.extractors.loadMulti(extractors);
                console.log(`🔌 Loaded ${extractors.length} extractors successfully`);
            } else {
                // Use built-in functionality
                console.log('🎵 No external extractors available, using built-in search');
                this.useBuiltInSearch = true;
            }
            
        } catch (error) {
            console.warn('⚠️ Extractor loading failed:', error.message);
            console.log('🎵 Falling back to built-in search functionality');
            this.useBuiltInSearch = true;
        }
    }

    async tts(interaction, text, opts = {}) {
        try {
            const safeRespond = async (payload) => {
                try {
                    if (interaction.deferred || interaction.replied) {
                        return await interaction.editReply(payload);
                    }
                    return await interaction.reply(payload);
                } catch (e) {
                    try {
                        return await interaction.channel?.send(payload);
                    } catch (_) {
                        return null;
                    }
                }
            };
            if (!interaction.deferred && !interaction.replied) {
                try { await interaction.deferReply(); } catch (_) { /* ignore */ }
            }

            const voiceChannel = interaction.member.voice?.channel;
            if (!voiceChannel) {
                return await interaction.editReply({
                    content: '❌ You must be in a voice channel to use TTS!',
                    ephemeral: true
                });
            }

            const voice = opts.voice || 'en';
            try {
                const { TTSExtractor } = require('discord-player-tts');
                if (TTSExtractor?.instance) {
                    TTSExtractor.instance.options.language = voice;
                }
            } catch (_) { /* ignore if not available */ }

            // Ensure a queue exists and is connected
            const queue = this.player.nodes.create(interaction.guild, {
                metadata: {
                    voiceChannel,
                    textChannel: interaction.channel,
                    requestedBy: interaction.user
                },
                selfDeaf: true,
                volume: config.settings.defaultVolume,
                leaveOnEnd: false,
                leaveOnStop: false,
                leaveOnEmpty: true,
                leaveOnEmptyCooldown: 30000
            });
            if (!queue.connection) {
                await queue.connect(voiceChannel);
            }

            // Create TTS track via extractor and play immediately (interrupt), then resume current track
            const sr = await this.player.search(`tts:${text}`, { requestedBy: interaction.user });
            if (!sr?.hasTracks?.() || !sr.tracks?.length) {
                await safeRespond({ content: '❌ TTS is unavailable or failed to generate audio.' });
                return false;
            }
            const ttsTrack = sr.tracks[0];

            if (queue.node.isPlaying() || queue.node.isPaused()) {
                const current = queue.currentTrack;
                await queue.node.play(ttsTrack, { queue: false });
                if (current) queue.node.insert(current, 0);
            } else {
                queue.addTrack(ttsTrack);
                await queue.node.play();
            }

            await safeRespond({ content: `🔈 Speaking: "${text}" (${voice})` });

            return true;
        } catch (error) {
            console.error('❌ TTS error:', error);
            try {
                await interaction.editReply({ content: `❌ TTS failed: ${error.message}` });
            } catch (_) {
                try { await interaction.reply({ content: `❌ TTS failed: ${error.message}`, ephemeral: true }); } catch (__) {
                    try { await interaction.channel?.send({ content: `❌ TTS failed: ${error.message}` }); } catch (___) {}
                }
            }
            return false;
        }
    }

    setupPerformanceOptimizations() {
        // Cache management
        this.cache = new Map();
        this.cacheTimeout = optimizedConfig.performance.cacheTimeout;
        
        // Periodic cleanup to prevent memory leaks
        setInterval(() => {
            this.cleanupCache();
            if (global.gc) {
                global.gc(); // Force garbage collection if available
            }
        }, optimizedConfig.performance.gcInterval);

        // Preload optimization
        this.preloadEnabled = optimizedConfig.performance.preloadNext;
        this.preloadQueue = new Map();
    }

    cleanupCache() {
        const now = Date.now();
        for (const [key, entry] of this.cache.entries()) {
            if (now - entry.timestamp > this.cacheTimeout) {
                this.cache.delete(key);
            }
        }
        console.log(`🧹 Cache cleanup: ${this.cache.size} items remaining`);
    }

    setupPlayerEvents() {
        this.player.events.on('playerStart', (queue, track) => {
            console.log(`🎵 Now playing: ${track.title} by ${track.author}`);
            this.updateNowPlayingPanel(queue, track);
        });

        this.player.events.on('audioTrackAdd', (queue, track) => {
            console.log(`➕ Added to queue: ${track.title}`);
        });

        this.player.events.on('playerError', (queue, error) => {
            if (error?.name === 'AbortError' || error?.code === 'ABORT_ERR') return;
            console.error(`❌ Player error:`, error);
        });

        this.player.events.on('error', (queue, error) => {
            if (error?.name === 'AbortError' || error?.code === 'ABORT_ERR') return;
            console.error(`❌ General error:`, error);
        });
        
        this.player.events.on('playerSkip', (queue, track) => {
            console.log(`⏭️ Skipped: ${track.title}`);
        });
        
        this.player.events.on('audioTracksAdd', (queue, tracks) => {
            console.log(`➕ Added ${tracks.length} tracks to queue`);
        });

        this.player.events.on('disconnect', (queue) => {
            console.log('🔌 Bot disconnected from voice channel');
        });

        this.player.events.on('emptyQueue', async (queue) => {
            console.log('📭 Queue is empty');

            // Try to continue with autoplay first
            let continued = false;
            try {
                continued = await this.autoplayFromHistory(queue);
            } catch (e) {
                console.log('⚠️ Autoplay from history failed:', e?.message || e);
            }

            // If we did not continue, clean up the message
            if (!continued) {
                try {
                    const guildId = queue.guild?.id || queue.metadata?.textChannel?.guild?.id;
                    const msg = guildId ? this.nowPlayingMessages.get(guildId) : null;
                    if (msg && msg.delete) {
                        msg.delete().catch(() => {});
                    }
                    if (guildId) this.nowPlayingMessages.delete(guildId);
                } catch (_) {}

                // Explicitly clear any remaining state/history once all songs are played
                try {
                    if (queue.tracks?.clear) queue.tracks.clear();
                    if (queue.history?.clear) queue.history.clear();
                    // Keep the connection if stayInChannel is true; otherwise, delete the queue
                    if (!config.settings.stayInChannel && queue.delete) {
                        queue.delete();
                    }
                } catch (_) {}
            }
        });

        this.player.events.on('emptyChannel', (queue) => {
            console.log('👥 Voice channel is empty, leaving...');
        });
        
        // Debug events - disabled for cleaner output
        // Uncomment below to enable debug logging
        // this.player.events.on('debug', (queue, message) => {
        //     console.log(`🐛 Debug: ${message}`);
        // });
    }

    setupErrorHandlers() {
        // Add error event listeners to prevent unhandled events warnings
        this.player.events.on('error', (queue, error) => {
            if (error?.name === 'AbortError' || error?.code === 'ABORT_ERR') return;
            console.error('❌ Player events error:', error);
        });

        this.player.on('error', (error) => {
            if (error?.name === 'AbortError' || error?.code === 'ABORT_ERR') return;
            console.error('❌ Player error:', error);
        });

        this.player.extractors.on('error', (extractor, error) => {
            // Filter out common non-critical errors
            if (error.message?.includes('signature decipher') || 
                error.message?.includes('Failed to extract signature') ||
                error.message?.includes('yt-dlp binary not found')) {
                return;
            }
            console.error('❌ Extractor error:', error.message || error);
        });

        // Handle process-level unhandled events for this player
        process.on('unhandledRejection', (reason, promise) => {
            if (reason && reason.toString().includes('discord-player')) {
                console.error('❌ Discord Player unhandled rejection:', reason);
            }
        });

        console.log('🛡️ Error handlers set up for Discord Player');
    }

    async play(interaction, query, options = {}) {
        const startTime = Date.now();
        try {
            // Immediate defer for responsiveness
            if (!interaction.deferred && !interaction.replied) {
                await interaction.deferReply();
            }

            const voiceChannel = interaction.member.voice?.channel;
            if (!voiceChannel) {
                return await interaction.editReply({
                    content: '❌ You must be in a voice channel to play music!',
                    ephemeral: true
                });
            }

            // Store text channel for panel posting (get bot reference from client)
            const bot = this.client.bot || global.ativeBot;
            if (bot && bot.musicTextChannels) {
                bot.musicTextChannels.set(voiceChannel.id, interaction.channelId);
                console.log(`📝 Stored text channel ${interaction.channelId} for voice channel ${voiceChannel.id}`);
            }

            // Show immediate loading state
            await interaction.editReply({
                content: '🚀 **Fast Mode Activated** - Searching for instant playback...',
                ephemeral: false
            });

            // Check cache first for instant playback
            const cacheKey = query.toLowerCase().trim();
            if (this.cache.has(cacheKey) && optimizedConfig.performance.enableCache) {
                console.log(`⚡ Cache hit for: ${query}`);
                const cachedResult = this.cache.get(cacheKey);
                return await this.playFromCache(interaction, cachedResult, voiceChannel);
            }

            // Try YouTube and Spotify only (as requested)
            const searchEngines = ['youtube', 'spotify', 'youtubedl'];
            let searchResult = null;
            
            for (const engine of searchEngines) {
                try {
                    console.log(`🔍 Discord Player trying engine: ${engine} for "${query}"`);
                    
                    const searchOptions = {
                        requestedBy: interaction.user,
                        searchEngine: engine
                    };

                    const searchPromise = this.player.search(query, searchOptions);
                    const timeoutPromise = new Promise((_, reject) => 
                        setTimeout(() => reject(new Error('Search timeout')), 3000) // Shorter timeout per engine
                    );

                    searchResult = await Promise.race([searchPromise, timeoutPromise]);
                    
                    console.log(`🔍 Engine ${engine} result: ${searchResult.hasTracks() ? `${searchResult.tracks.length} tracks found` : 'No tracks found'}`);
                    
                    if (searchResult.hasTracks()) {
                        console.log(`✅ Success with engine: ${engine}`);
                        break; // Found results, stop trying other engines
                    }
                } catch (engineError) {
                    console.log(`❌ Engine ${engine} failed: ${engineError.message}`);
                    continue; // Try next engine
                }
            }

            if (!searchResult || !searchResult.hasTracks()) {
                console.log(`❌ Discord Player found no tracks for: "${query}"`);
                
                // Try our built-in search first
                console.log(`🔄 Trying built-in search for: "${query}"`);
                return await this.useBuiltInSourceHandlers(interaction, query, voiceChannel);
            }

            const queue = this.player.nodes.create(interaction.guild, {
                metadata: {
                    voiceChannel: voiceChannel,
                    textChannel: interaction.channel,
                    requestedBy: interaction.user
                },
                selfDeaf: true,
                volume: config.settings.defaultVolume,
                leaveOnEnd: false,
                leaveOnStop: false,
                leaveOnEmpty: true,
                leaveOnEmptyCooldown: 30000,
            });

            try {
                if (!queue.connection) {
                    await queue.connect(voiceChannel);
                }
            } catch (error) {
                console.error('❌ Could not connect to voice channel:', error);
                this.player.nodes.delete(interaction.guild.id);
                return await interaction.editReply({
                    content: '❌ Could not connect to voice channel!',
                    ephemeral: true
                });
            }

            const wasEmpty = queue.isEmpty();
            
            if (searchResult.playlist) {
                queue.addTrack(searchResult.tracks);
                await interaction.editReply({
                    embeds: [this.createPlaylistEmbed(searchResult.playlist, searchResult.tracks.length)],
                    components: this.createAdvancedControls(queue)
                });
            } else {
                queue.addTrack(searchResult.tracks[0]);
                await interaction.editReply({
                    embeds: [this.createTrackAddedEmbed(searchResult.tracks[0])],
                    components: this.createAdvancedControls(queue)
                });
            }

            if (wasEmpty) {
                await queue.node.play();
                // Seed autoplay recommendations behind the first track
                if (!searchResult.playlist) {
                    this.seedAutoplay(queue, searchResult.tracks[0]).catch(() => {});
                }
            }

            // Cache successful searches for faster future playback
            if (optimizedConfig.performance.enableCache && !searchResult.playlist) {
                this.cache.set(cacheKey, {
                    track: searchResult.tracks[0],
                    timestamp: Date.now()
                });
            }

            const elapsedTime = Date.now() - startTime;
            console.log(`⚡ Fast mode playback completed in ${elapsedTime}ms`);

            return true;
        } catch (error) {
            console.error('❌ Discord Player error:', error);
            
            // If it's a search timeout or Discord Player specific error, try built-in search
            if (error.message.includes('timeout') || error.message.includes('Search') || error.message.includes('track')) {
                console.log(`🔄 Trying built-in search for: "${query}"`);
                return await this.useBuiltInSourceHandlers(interaction, query, voiceChannel);
            }
            
            await interaction.editReply({
                content: `❌ An error occurred: ${error.message}`,
                ephemeral: true
            });
            return false;
        }
    }

    async useBuiltInSourceHandlers(interaction, query, voiceChannel) {
        const startTime = Date.now();
        try {
            console.log(`🔍 Using built-in SourceHandlers for: "${query}"`);
            
            // Store text channel for panel posting
            const bot = this.client.bot || global.ativeBot;
            if (bot && bot.musicTextChannels) {
                bot.musicTextChannels.set(voiceChannel.id, interaction.channelId);
                console.log(`📝 Stored text channel ${interaction.channelId} for voice channel ${voiceChannel.id} (built-in)`);
            }
            
            await interaction.editReply({
                content: '🔄 Using advanced search system...',
                ephemeral: false
            });

            // Get the main bot instance's source handlers
            if (!bot || !bot.sourceHandlers) {
                throw new Error('SourceHandlers not available');
            }

            // Search using our clean SourceHandlers (YouTube + Spotify only)
            const searchResults = await bot.sourceHandlers.search(query, 1);
            
            if (searchResults.length === 0) {
                await interaction.editReply({
                    content: '❌ No tracks found in YouTube or Spotify!',
                    ephemeral: true
                });
                return false;
            }

            const track = searchResults[0];
            console.log(`✅ Found via built-in search: ${track.title} from ${track.source}`);

            // Skip Discord Player completely and use original system
            console.log(`🔄 Bypassing Discord Player - using original MusicManager system`);
            const result = await this.fallbackToOriginalSystem(interaction, track, voiceChannel);
            
            const elapsedTime = Date.now() - startTime;
            console.log(`⚡ Built-in search completed in ${elapsedTime}ms`);
            
            return result;
        } catch (error) {
            console.error('❌ Built-in search error:', error);
            
            // Final fallback to original system
            console.log(`🔄 Final fallback to original system for: "${query}"`);
            return this.fallbackToOriginalSystem(interaction, query);
        }
    }

    async fallbackToOriginalSystem(interaction, trackOrQuery, voiceChannel = null) {
        try {
            // Get the main bot instance and source handlers
            const bot = this.client.bot || global.ativeBot;
            if (!bot || !bot.sourceHandlers) {
                throw new Error('Original system not available');
            }

            let track;
            
            // Check if we already have a track object or need to search
            if (typeof trackOrQuery === 'object' && trackOrQuery.title) {
                track = trackOrQuery;
                console.log(`🔄 Using original system with found track: "${track.title}"`);
            } else {
                const query = trackOrQuery;
                console.log(`🔄 Using original system to search for: "${query}"`);
                
                await interaction.editReply({
                    content: '🔄 Trying original system...',
                    ephemeral: false
                });

                // Use the original source handlers directly
                const searchResults = await bot.sourceHandlers.search(query, 1);
                
                if (searchResults.length === 0) {
                    await interaction.editReply({
                        content: '❌ No tracks found in any system!',
                        ephemeral: true
                    });
                    return false;
                }

                track = searchResults[0];
                console.log(`✅ Original system found: ${track.title} from ${track.source}`);
            }

            // Get the music manager and play directly
            const voiceChannel = interaction.member.voice?.channel;
            const musicManager = bot.getMusicManager(interaction.guildId, voiceChannel?.id);
            
            // Connect to voice channel
            const connection = await bot.connectToVoiceChannel(voiceChannel, interaction.guildId);
            musicManager.setConnection(connection);

            // Add track to queue
            await musicManager.addToQueue(track);
            
            // Start playing if nothing is currently playing
            if (!musicManager.isPlaying) {
                // Set the current track index to the newly added track (last in queue) if not set
                if (musicManager.currentTrackIndex === -1) {
                    musicManager.currentTrackIndex = musicManager.queue.length - 1;
                }
                console.log(`🎵 Starting playback with newly added track: ${track.title} (position ${musicManager.currentTrackIndex + 1})`);
                
                // Try to play with retry logic for streaming failures
                let playSuccess = false;
                let attempts = 0;
                const maxAttempts = 3;
                
                while (!playSuccess && attempts < maxAttempts && musicManager.queue.length > 0) {
                    attempts++;
                    console.log(`🔄 Playback attempt ${attempts}/${maxAttempts} for: ${musicManager.queue[musicManager.currentTrackIndex]?.title}`);
                    
                    try {
                        playSuccess = await musicManager.play();
                        if (playSuccess) {
                            console.log(`✅ Playback started successfully on attempt ${attempts}`);
                            break;
                        }
                    } catch (error) {
                        console.log(`❌ Playback attempt ${attempts} failed: ${error.message}`);
                    }
                    
                    // If playback failed, advance to next track if available
                    if (!playSuccess && musicManager.currentTrackIndex + 1 < musicManager.queue.length) {
                        console.log(`🔄 Advancing to next track due to playback failure`);
                        musicManager.currentTrackIndex++;
                    } else if (!playSuccess) {
                        console.log(`❌ No more tracks available to try`);
                        break;
                    }
                    
                    // Small delay between attempts
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
                
                if (!playSuccess) {
                    console.log(`❌ Failed to start playback after ${attempts} attempts`);
                }
            } else {
                console.log(`🎵 Track added to queue. Currently playing: ${musicManager.isPlaying}, Queue position: ${musicManager.currentTrackIndex + 1}/${musicManager.queue.length}`);
            }

            // Send proper Now Playing panel with live progress tracking
            await interaction.editReply({
                content: '✅ Now playing!',
                ephemeral: false
            });

            // Send the live-updating music panel in the proper text channel for this voice channel
            const textChannel = bot.getTextChannelForVoice(voiceChannel.id, voiceChannel.guild);
            if (textChannel) {
                await bot.sendNewMusicPanel(textChannel, track, voiceChannel.id, musicManager);
            } else {
                console.log('⚠️ No text channel found for music panel, skipping panel creation');
            }

            return true;
        } catch (fallbackError) {
            console.error('❌ Fallback error:', fallbackError);
            await interaction.editReply({
                content: '❌ All systems failed. Please try a different search term.',
                ephemeral: true
            });
            return false;
        }
    }

    async playFromCache(interaction, cachedResult, voiceChannel) {
        try {
            const queue = this.player.nodes.create(interaction.guild, {
                metadata: {
                    voiceChannel: voiceChannel,
                    textChannel: interaction.channel,
                    requestedBy: interaction.user
                },
                selfDeaf: true,
                volume: config.settings.defaultVolume,
                leaveOnEnd: false,
                leaveOnStop: false,
                leaveOnEmpty: true,
                leaveOnEmptyCooldown: 30000,
            });

            if (!queue.connection) {
                await queue.connect(voiceChannel);
            }

            const wasEmpty = queue.isEmpty();
            queue.addTrack(cachedResult.track);

            await interaction.editReply({
                content: '⚡ **Instant Playback** - Playing from cache!',
                embeds: [this.createTrackAddedEmbed(cachedResult.track)],
                components: this.createAdvancedControls(queue)
            });

            if (wasEmpty) {
                await queue.node.play();
                // Seed autoplay recommendations behind the first track
                this.seedAutoplay(queue, cachedResult.track).catch(() => {});
            }

            console.log(`⚡ Cache playback completed instantly`);
            return true;
        } catch (error) {
            console.error('❌ Cache playback error:', error);
            // Fall through to regular search if cache fails
            return false;
        }
    }

    createTrackAddedEmbed(track) {
        return new EmbedBuilder()
            .setColor(config.colors.success)
            .setTitle('🎵 Added to Queue')
            .setDescription(`**${track.title}**\nby ${track.author}`)
            .addFields([
                { name: 'Duration', value: track.duration, inline: true },
                { name: 'Source', value: this.getSourceName(track.source), inline: true },
                { name: 'Requested by', value: track.requestedBy.toString(), inline: true }
            ])
            .setThumbnail(track.thumbnail)
            .setTimestamp();
    }

    createPlaylistEmbed(playlist, trackCount) {
        return new EmbedBuilder()
            .setColor(config.colors.success)
            .setTitle('📀 Playlist Added')
            .setDescription(`**${playlist.title}**\n${trackCount} tracks added to queue`)
            .addFields([
                { name: 'Source', value: this.getSourceName(playlist.source), inline: true },
                { name: 'Tracks', value: trackCount.toString(), inline: true }
            ])
            .setThumbnail(playlist.thumbnail)
            .setTimestamp();
    }

    createNowPlayingEmbed(track, queue) {
        const currentTime = queue?.node?.streamTime || 0;
        const duration = track.durationMS || 0;
        const elapsed = this.formatTime(currentTime);
        const remaining = this.formatTime(duration - currentTime);
        const totalDuration = this.formatTime(duration);
        const progressBar = this.getProgressBar(queue, 16);
        const percentage = duration > 0 ? Math.round((currentTime / duration) * 100) : 0;
        const upNext = queue?.tracks?.data?.[0];
        
        const guildId = queue?.guild?.id || queue?.metadata?.textChannel?.guild?.id;
        const autoplayOn = this.isAutoplayEnabled(guildId);

        const embed = new EmbedBuilder()
            .setColor(config.colors.playing)
            .setAuthor({ 
                name: 'Now Playing', 
                iconURL: 'https://cdn.discordapp.com/emojis/758423098885275748.gif'
            })
            .setTitle(track.title)
            .setDescription(
                `**${track.author}**\n\n` +
                `\`${elapsed}\` ${progressBar} \`${totalDuration}\`\n` +
                `\`\`\`${percentage}% complete • ${remaining} remaining\`\`\`` +
                (upNext ? `\n\n**Up Next:** ${upNext.title} — ${upNext.author}` : '')
            )
            .addFields([
                { 
                    name: '🎛️ Controls', 
                    value: `Volume: **${queue.node.volume}%** • Loop: **${this.getLoopModeText(queue.repeatMode)}** • Autoplay: **${autoplayOn ? 'On' : 'Off'}**`,
                    inline: false 
                },
                { 
                    name: '📊 Queue Info', 
                    value: `**${queue.tracks.data.length}** ${queue.tracks.data.length === 1 ? 'song' : 'songs'} in queue`,
                    inline: true 
                },
                { 
                    name: '🎵 Source', 
                    value: this.getSourceName(track.source),
                    inline: true 
                }
            ])
            .setFooter({ 
                text: `Requested by ${track.requestedBy.username}`,
                iconURL: track.requestedBy.displayAvatarURL?.() 
            })
            .setTimestamp();

        // Only set URL if valid http/https URL
        if (this.isValidHttpUrl(track.url)) {
            embed.setURL(track.url);
        }
        if (this.isValidHttpUrl(track.thumbnail)) {
            embed.setThumbnail(track.thumbnail);
        }

        return embed;
    }

    createAdvancedControls(queue) {
        const isPlaying = queue?.node?.isPlaying() || false;
        const isPaused = queue?.node?.isPaused() || false;
        const volume = queue?.node?.volume || config.settings.defaultVolume;
        const repeatMode = queue?.repeatMode || 0;
        const guildId = queue?.guild?.id || queue?.metadata?.textChannel?.guild?.id;
        const autoplayOn = this.isAutoplayEnabled(guildId);

        // Main control row
        const row1 = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('dp_previous')
                    .setEmoji('⏮️')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(!queue?.history?.previousTrack),
                new ButtonBuilder()
                    .setCustomId(isPaused ? 'dp_resume' : 'dp_pause')
                    .setEmoji(isPaused ? '▶️' : '⏸️')
                    .setLabel(isPaused ? 'Resume' : 'Pause')
                    .setStyle(isPaused ? ButtonStyle.Success : ButtonStyle.Secondary)
                    .setDisabled(!isPlaying && !isPaused),
                new ButtonBuilder()
                    .setCustomId('dp_skip')
                    .setEmoji('⏭️')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(!queue?.tracks?.data?.length),
                new ButtonBuilder()
                    .setCustomId('dp_stop')
                    .setEmoji('⏹️')
                    .setStyle(ButtonStyle.Danger)
                    .setDisabled(!isPlaying && !isPaused),
                new ButtonBuilder()
                    .setCustomId('dp_shuffle')
                    .setEmoji('🔀')
                    .setStyle(queue?.tracks?.data?.length > 0 ? ButtonStyle.Success : ButtonStyle.Secondary)
                    .setDisabled(!queue?.tracks?.data?.length)
            );

        // Secondary control row  
        const row2 = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('dp_repeat')
                    .setEmoji(repeatMode === 2 ? '🔂' : '🔁')
                    .setLabel(repeatMode === 0 ? 'No Loop' : repeatMode === 1 ? 'Queue' : 'Track')
                    .setStyle(repeatMode !== 0 ? ButtonStyle.Success : ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId('dp_volume_down')
                    .setEmoji('🔉')
                    .setLabel(`Vol: ${volume}%`)
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(volume <= 0),
                new ButtonBuilder()
                    .setCustomId('dp_volume_up')
                    .setEmoji('🔊')
                    .setLabel(`Vol: ${volume}%`)
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(volume >= 100),
                new ButtonBuilder()
                    .setCustomId('dp_queue')
                    .setEmoji('📋')
                    .setLabel(`Queue (${queue?.tracks?.data?.length || 0})`)
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId('dp_clear')
                    .setEmoji('🗑️')
                    .setLabel('Clear Queue')
                    .setStyle(ButtonStyle.Danger)
                    .setDisabled(!queue?.tracks?.data?.length)
            );

        // Tertiary row for Autoplay toggle (keeps rows under 5 buttons each)
        const row3 = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('dp_autoplay')
                    .setEmoji('✨')
                    .setLabel(`Autoplay: ${autoplayOn ? 'On' : 'Off'}`)
                    .setStyle(autoplayOn ? ButtonStyle.Success : ButtonStyle.Secondary)
            );

        return [row1, row2, row3];
    }

    async handleButtonInteraction(interaction) {
        try {
            if (!interaction.deferred && !interaction.replied) {
                await interaction.deferReply({ flags: 64 }); // 64 = ephemeral flag
            }

            const queue = this.player.nodes.get(interaction.guild.id);
            
            if (!queue) {
                return await interaction.editReply({
                    content: '❌ No music is currently playing!',
                    ephemeral: true
                });
            }

            const voiceChannel = interaction.member.voice?.channel;
            if (!voiceChannel) {
                return await interaction.editReply({
                    content: '❌ You must be in a voice channel to use music controls!',
                    ephemeral: true
                });
            }

            if (voiceChannel.id !== queue.metadata.voiceChannel.id) {
                return await interaction.editReply({
                    content: '❌ You must be in the same voice channel as the bot!',
                    ephemeral: true
                });
            }

            let response = '';
            let updatePanel = false;

            switch (interaction.customId) {
                case 'dp_pause':
                    queue.node.pause();
                    response = '⏸️ Music paused';
                    updatePanel = true;
                    break;

                case 'dp_resume':
                    queue.node.resume();
                    response = '▶️ Music resumed';
                    updatePanel = true;
                    break;

                case 'dp_skip':
                    if (queue.tracks.data.length === 0) {
                        response = '❌ No more tracks in queue';
                    } else {
                        queue.node.skip();
                        response = '⏭️ Skipped to next track';
                        updatePanel = true;
                    }
                    break;

                case 'dp_previous':
                    if (!queue.history.previousTrack) {
                        response = '❌ No previous track available';
                    } else {
                        await queue.history.back();
                        response = '⏮️ Playing previous track';
                        updatePanel = true;
                    }
                    break;

                case 'dp_stop':
                    queue.delete();
                    response = '⏹️ Music stopped and queue cleared';
                    try {
                        const guildId = interaction.guild?.id;
                        const msg = guildId ? this.nowPlayingMessages.get(guildId) : null;
                        if (msg && msg.delete) {
                            msg.delete().catch(() => {});
                        }
                        if (guildId) this.nowPlayingMessages.delete(guildId);
                    } catch (_) {}
                    break;

                case 'dp_shuffle':
                    if (queue.tracks.data.length === 0) {
                        response = '❌ No tracks to shuffle';
                    } else {
                        queue.tracks.shuffle();
                        response = '🔀 Queue shuffled';
                        updatePanel = true;
                    }
                    break;

                case 'dp_repeat':
                    const modes = ['No Loop', 'Queue Loop', 'Track Loop'];
                    const currentMode = queue.repeatMode;
                    const nextMode = (currentMode + 1) % 3;
                    queue.setRepeatMode(nextMode);
                    response = `🔁 Loop mode: ${modes[nextMode]}`;
                    updatePanel = true;
                    break;

                case 'dp_volume_down':
                    const newVolumeDown = Math.max(0, queue.node.volume - 10);
                    queue.node.setVolume(newVolumeDown);
                    response = `🔉 Volume: ${newVolumeDown}%`;
                    updatePanel = true;
                    break;

                case 'dp_volume_up':
                    const newVolumeUp = Math.min(100, queue.node.volume + 10);
                    queue.node.setVolume(newVolumeUp);
                    response = `🔊 Volume: ${newVolumeUp}%`;
                    updatePanel = true;
                    break;

                case 'dp_queue':
                    return await this.showQueue(interaction, queue);

                case 'dp_clear':
                    queue.tracks.clear();
                    response = '🗑️ Queue cleared';
                    updatePanel = true;
                    break;

                case 'dp_autoplay':
                    {
                        const gid = interaction.guild?.id;
                        const current = this.isAutoplayEnabled(gid);
                        this.setAutoplayEnabled(gid, !current);
                        response = `✨ Autoplay: ${!current ? 'Enabled' : 'Disabled'}`;
                        updatePanel = true;
                    }
                    break;

                default:
                    response = '❌ Unknown command';
            }

            await interaction.editReply({
                content: response,
                ephemeral: true
            });

            if (updatePanel) {
                this.updateNowPlayingPanel(queue);
            }

        } catch (error) {
            console.error('❌ Button interaction error:', error);
            await interaction.editReply({
                content: `❌ An error occurred: ${error.message}`,
                ephemeral: true
            });
        }
    }

    async showQueue(interaction, queue) {
        const tracks = queue.tracks.data;
        const currentTrack = queue.currentTrack;

        if (!currentTrack && tracks.length === 0) {
            return await interaction.editReply({
                content: '📭 The queue is empty!',
                ephemeral: true
            });
        }

        let description = '';
        
        if (currentTrack) {
            description += `**🎵 Currently Playing:**\n${currentTrack.title} - ${currentTrack.author}\n\n`;
        }

        if (tracks.length > 0) {
            description += '**📋 Up Next:**\n';
            tracks.slice(0, 10).forEach((track, index) => {
                description += `${index + 1}. ${track.title} - ${track.author}\n`;
            });

            if (tracks.length > 10) {
                description += `\n*...and ${tracks.length - 10} more tracks*`;
            }
        }

        const queueEmbed = new EmbedBuilder()
            .setColor(config.colors.queue)
            .setTitle('📋 Music Queue')
            .setDescription(description)
            .addFields([
                { name: 'Total Tracks', value: tracks.length.toString(), inline: true },
                { name: 'Total Duration', value: this.calculateTotalDuration(tracks), inline: true },
                { name: 'Loop Mode', value: this.getLoopModeText(queue.repeatMode), inline: true }
            ])
            .setTimestamp();

        await interaction.editReply({
            embeds: [queueEmbed],
            ephemeral: true
        });
    }

    async updateNowPlayingPanel(queue, track = null) {
        try {
            const currentTrack = track || queue.currentTrack;
            if (!currentTrack) return;

            const embed = this.createNowPlayingEmbed(currentTrack, queue);
            const components = this.createAdvancedControls(queue);

            // Update the original message in the text channel
            const textChannel = queue.metadata.textChannel;
            if (textChannel && textChannel.send) {
                const guildId = textChannel.guild?.id || queue.guild?.id;
                const existingMessage = guildId ? this.nowPlayingMessages.get(guildId) : null;

                if (existingMessage && existingMessage.edit) {
                    try {
                        await existingMessage.edit({ embeds: [embed], components });
                        return;
                    } catch (_) {
                        // If editing fails (message deleted or missing perms), send a new one
                    }
                }

                const sent = await textChannel.send({ embeds: [embed], components });
                if (guildId) this.nowPlayingMessages.set(guildId, sent);
            }
        } catch (error) {
            console.error('❌ Error updating now playing panel:', error);
        }
    }

    getProgressBar(queue, segments = 16) {
        // Modern segmented bar using ▰ (filled), 🔘 (cursor), and ▱ (empty)
        if (!queue || !queue.currentTrack?.durationMS) {
            return '▱'.repeat(segments);
        }

        const current = Math.max(0, queue.node?.streamTime || 0);
        const total = Math.max(1, queue.currentTrack.durationMS);
        const ratio = Math.max(0, Math.min(1, current / total));
        let filled = Math.floor(ratio * segments);
        if (filled >= segments) filled = segments - 1; // reserve space for cursor
        const empty = Math.max(0, segments - filled - 1);
        return '▰'.repeat(filled) + '🔘' + '▱'.repeat(empty);
    }

    getLoopModeText(mode) {
        switch (mode) {
            case 0: return 'Off';
            case 1: return 'Queue';
            case 2: return 'Track';
            default: return 'Off';
        }
    }

    getSourceName(source) {
        const sources = {
            'youtube': '🔴 YouTube',
            'spotify': '🟢 Spotify',
            'soundcloud': '🟠 SoundCloud',
            'apple_music': '⚫ Apple Music',
            'arbitrary': '🔗 Direct Link'
        };
        return sources[source] || '🎵 Unknown';
    }

    isValidHttpUrl(value) {
        if (!value || typeof value !== 'string') return false;
        try {
            const u = new URL(value);
            return u.protocol === 'http:' || u.protocol === 'https:';
        } catch (_) {
            return false;
        }
    }

    calculateTotalDuration(tracks) {
        const totalMs = tracks.reduce((acc, track) => acc + track.durationMS, 0);
        const hours = Math.floor(totalMs / 3600000);
        const minutes = Math.floor((totalMs % 3600000) / 60000);
        
        if (hours > 0) {
            return `${hours}h ${minutes}m`;
        }
        return `${minutes}m`;
    }

    setupStreamHooks() {
        // Add stream hooks to ensure proper audio playback
        this.player.events.on('audioPlayerError', (error) => {
            console.error('❌ Audio player error:', error);
        });
        
        // Set up real-time UI updates
        this.setupRealTimeUpdates();
    }
    
    setupRealTimeUpdates() {
        // Update now-playing embeds every 2 seconds for smoother progress
        setInterval(() => {
            this.player.nodes.cache.forEach((queue) => {
                if (queue.currentTrack && queue.node.isPlaying()) {
                    this.updateNowPlayingPanel(queue).catch(() => {});
                }
            });
        }, 2000); // Update every 2 seconds
    }
    
    formatTime(ms) {
        if (!ms || ms < 0) return '0:00';
        const seconds = Math.floor((ms / 1000) % 60);
        const minutes = Math.floor((ms / (1000 * 60)) % 60);
        const hours = Math.floor(ms / (1000 * 60 * 60));
        
        if (hours > 0) {
            return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        }
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }

    getQueue(guildId) {
        return this.player.nodes.get(guildId);
    }

    async search(query, options = {}) {
        return await this.player.search(query, options);
    }

    // ====== Autoplay & Recommendations ======
    async seedAutoplay(queue, track) {
        try {
            const guildId = queue?.guild?.id || queue?.metadata?.textChannel?.guild?.id;
            if (!this.isAutoplayEnabled(guildId) || !queue || !track) return;
            if (track?.raw?.type === 'tts' || track?.author === 'google-tts-api' || (typeof track?.url === 'string' && track.url.startsWith('tts:'))) return;
            // Only seed if queue has just the current track or very few upcoming
            const upcoming = queue.tracks?.data?.length || 0;
            if (upcoming > 2) return;

            const recs = await this.getRecommendationsFromTrack(track, 5);
            if (recs.length) {
                // Avoid duplicates against current queue
                const existingUrls = new Set([
                    ...(queue.tracks?.data || []).map(t => t.url),
                    queue.currentTrack?.url
                ].filter(Boolean));
                const deduped = recs.filter(t => !existingUrls.has(t.url));
                if (deduped.length) {
                    queue.addTrack(deduped);
                    console.log(`✨ Autoplay seeded ${deduped.length} related track(s)`);
                    this.updateNowPlayingPanel(queue).catch(() => {});
                }
            }
        } catch (e) {
            console.log('⚠️ seedAutoplay error:', e?.message || e);
        }
    }

    async autoplayFromHistory(queue) {
        try {
            const guildId = queue?.guild?.id || queue?.metadata?.textChannel?.guild?.id;
            if (!this.isAutoplayEnabled(guildId) || !queue || queue.deleted) return false;
            if (queue.repeatMode && queue.repeatMode !== 0) return false; // don't autoplay when looping
            if (queue.tracks?.data?.length && queue.tracks.data.length > 0) return false; // there are upcoming tracks
            const base = queue.history?.previousTrack || queue.currentTrack;
            if (!base) return false;
            // Do not autoplay after TTS items
            if (base?.raw?.type === 'tts' || base?.author === 'google-tts-api' || (typeof base?.url === 'string' && base.url.startsWith('tts:'))) {
                return false;
            }
            const recs = await this.getRecommendationsFromTrack(base, 5);
            if (!recs.length) return false;

            queue.addTrack(recs);
            console.log('▶️ Autoplay continuing with recommended tracks');
            if (!queue.node.isPlaying() && !queue.node.isPaused()) {
                await queue.node.play();
            }
            this.updateNowPlayingPanel(queue).catch(() => {});
            return true;
        } catch (e) {
            console.log('⚠️ autoplayFromHistory error:', e?.message || e);
            return false;
        }
    }

    isAutoplayEnabled(guildId) {
        if (!guildId) return true;
        return this.autoplayState.get(guildId) ?? true;
    }

    setAutoplayEnabled(guildId, enabled) {
        if (!guildId) return;
        this.autoplayState.set(guildId, !!enabled);
        this.saveAutoplayState();
    }

    loadAutoplayState() {
        try {
            // Ensure data directory exists
            const dataDir = path.dirname(this.autoplayPrefsPath);
            if (!fs.existsSync(dataDir)) {
                fs.mkdirSync(dataDir, { recursive: true });
            }

            if (fs.existsSync(this.autoplayPrefsPath)) {
                const raw = fs.readFileSync(this.autoplayPrefsPath, 'utf8');
                const obj = JSON.parse(raw || '{}');
                Object.entries(obj).forEach(([gid, prefs]) => {
                    if (prefs && typeof prefs.autoplay === 'boolean') {
                        this.autoplayState.set(gid, prefs.autoplay);
                    }
                });
                console.log(`🔧 Loaded autoplay prefs for ${this.autoplayState.size} guild(s)`);
            }
        } catch (e) {
            console.log('⚠️ Failed to load autoplay prefs:', e?.message || e);
        }
    }

    saveAutoplayState() {
        try {
            const snapshot = {};
            for (const [gid, autoplay] of this.autoplayState.entries()) {
                snapshot[gid] = { autoplay };
            }
            fs.writeFileSync(this.autoplayPrefsPath, JSON.stringify(snapshot, null, 2));
        } catch (e) {
            console.log('⚠️ Failed to save autoplay prefs:', e?.message || e);
        }
    }

    async getRecommendationsFromTrack(track, limit = 5) {
        try {
            const queries = [
                `${track.author} ${track.title}`,
                `${track.title}`,
                `${track.author} official audio`,
                `${track.author} mix`
            ];
            const results = [];
            const urls = new Set();

            for (const q of queries) {
                try {
                    const sr = await this.player.search(q, { searchEngine: 'youtube', requestedBy: track.requestedBy });
                    if (sr?.hasTracks?.()) {
                        for (const t of sr.tracks) {
                            if (t.url && !urls.has(t.url)) {
                                urls.add(t.url);
                                results.push(t);
                                if (results.length >= limit * 2) break; // gather a pool, later slice
                            }
                        }
                    }
                } catch (_) { /* ignore individual query errors */ }
                if (results.length >= limit * 2) break;
            }

            // Filter out the same track and prioritize by author match
            const filtered = results
                .filter(t => t.url !== track.url)
                .sort((a, b) => {
                    const am = (a.author || '').toLowerCase().includes((track.author || '').toLowerCase()) ? 1 : 0;
                    const bm = (b.author || '').toLowerCase().includes((track.author || '').toLowerCase()) ? 1 : 0;
                    return bm - am; // prefer same-author
                })
                .slice(0, limit);

            return filtered;
        } catch (e) {
            console.log('⚠️ getRecommendationsFromTrack error:', e?.message || e);
            return [];
        }
    }
}

module.exports = DiscordPlayerManager;
