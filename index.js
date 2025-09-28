// Disable ytdl debug HTML files for performance
process.env.YTDL_NO_UPDATE = 'true';
process.env.DEBUG = '';

// Suppress YouTube signature decipher warnings (non-critical, other extractors handle streaming)
const originalConsoleWarn = console.warn;
const originalConsoleLog = console.log;

console.warn = function(...args) {
    const message = args.join(' ');
    if (message.includes('YOUTUBEJS') || 
        message.includes('signature decipher') ||
        message.includes('Failed to extract signature')) {
        return;
    }
    originalConsoleWarn.apply(console, args);
};

console.log = function(...args) {
    const message = args.join(' ');
    if (message.includes('[YOUTUBEJS][Player]') && 
        (message.includes('signature decipher') || message.includes('Failed to extract'))) {
        return;
    }
    originalConsoleLog.apply(console, args);
};

// Suppress YtDlpExtractor error messages on stderr
const originalConsoleError = console.error;
console.error = function(...args) {
    // Check first argument for YtDlpExtractor without serializing
    const firstArg = args[0];
    
    // Only suppress very specific extractor initialization errors
    if (firstArg && typeof firstArg === 'object' && firstArg.constructor?.name === 'YtDlpExtractor') {
        return;
    }
    if (firstArg && typeof firstArg === 'string' && 
        firstArg.includes('❌ Extractor error') && 
        args[1]?.constructor?.name === 'YtDlpExtractor') {
        return;
    }
    
    // Allow all other errors through
    originalConsoleError.apply(console, args);
};

// Polyfill File constructor for Discord.js compatibility in serverless environments
if (typeof globalThis.File === 'undefined') {
    const fs = require('fs');
    globalThis.File = class File {
        constructor(fileBits, fileName, options = {}) {
            this.name = fileName;
            this.size = fileBits.length || 0;
            this.type = options.type || '';
            this.lastModified = options.lastModified || Date.now();
            this._bits = fileBits;
        }
        
        arrayBuffer() {
            return Promise.resolve(this._bits.buffer || this._bits);
        }
        
        text() {
            return Promise.resolve(this._bits.toString());
        }
        
        stream() {
            return new ReadableStream({
                start(controller) {
                    controller.enqueue(this._bits);
                    controller.close();
                }
            });
        }
    };
}

const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder, REST, Routes, StringSelectMenuBuilder } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus, entersState, demuxProbe, getVoiceConnection } = require('@discordjs/voice');
const config = require('./config.js');
const MusicManager = require('./src/MusicManager.js');
const SourceHandlers = require('./src/SourceHandlers.js');
const StayConnectedManager = require('./src/StayConnectedManager.js');
const VideoHandler = require('./src/VideoHandler.js');
const LocalVideoServer = require('./src/LocalVideoServer.js');
const ErrorHandler = require('./src/ErrorHandler.js');
const PlaylistManager = require('./src/PlaylistManager.js');
const LyricsHandler = require('./src/LyricsHandler.js');
const DiscordPlayerManager = require('./src/DiscordPlayerManager.js');

class AtiveMusicBot {
    constructor() {
        this.client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildVoiceStates
            ]
        });

        this.musicManagers = new Map(); // Now maps channelId -> MusicManager
        this.sourceHandlers = new SourceHandlers();
        this.stayConnectedManager = new StayConnectedManager(this.client, this);
        this.videoHandler = new VideoHandler();
        this.localVideoServer = new LocalVideoServer(3000);
        this.errorHandler = new ErrorHandler();
        this.playlistManager = new PlaylistManager();
        this.lyricsHandler = new LyricsHandler();
        this.discordPlayer = new DiscordPlayerManager(this.client);
        this.client.bot = this; // Make bot instance available to Discord Player
        global.ativeBot = this; // Global reference for fallback
        this.searchCache = new Map();
        this.musicPanels = new Map(); // Track music control panels by channelId
        this.guildChannels = new Map(); // Track active channels per guild (guildId -> Set<channelId>)
        this.musicTextChannels = new Map(); // Track which text channel music commands came from (voiceChannelId -> textChannelId)
        
        this.setupEventListeners();
        this.registerCommands();

        // Enable legacy UI panels for built-in MusicManager (has live progress tracking)
        this.disableLegacyUI = false;
        // Start panel updater for live progress tracking
        this.startPanelProgressUpdater();
    }

    setupEventListeners() {
        this.client.once('clientReady', async () => {
            console.log(`🎵 ${this.client.user.tag} is online!`);
            console.log(`🎶 Serving music in ${this.client.guilds.cache.size} servers`);
            
            // Clean up any debug HTML files on startup
            this.cleanupDebugFiles();
            
            this.client.user.setActivity('🎵 Ative Music | /play', { type: 2 }); // 2 = ActivityType.Listening
            
            // Start local video server
            try {
                const serverUrl = await this.localVideoServer.start();
                console.log(`📺 Video server started: ${serverUrl}`);
            } catch (error) {
                console.error('❌ Failed to start video server:', error);
            }
            
            if (config.settings.stayInChannel) {
                this.reconnectToChannels();
            }
        });

        this.client.on('interactionCreate', async (interaction) => {
            if (interaction.isChatInputCommand()) {
                await this.handleSlashCommand(interaction);
            } else if (interaction.isButton()) {
                // Check if it's a Discord Player button
                if (interaction.customId.startsWith('dp_')) {
                    await this.discordPlayer.handleButtonInteraction(interaction);
                } else {
                    await this.handleButtonInteraction(interaction);
                }
            } else if (interaction.isStringSelectMenu()) {
                await this.handleSelectMenu(interaction);
            } else if (interaction.isAutocomplete()) {
                await this.handleAutocomplete(interaction);
            }
        });

        this.client.on('voiceStateUpdate', (oldState, newState) => {
            this.handleVoiceStateUpdate(oldState, newState);
        });

        // Add prefix command support (aliases)
        this.client.on('messageCreate', async (message) => {
            if (message.author.bot || !message.guild) return;
            await this.handlePrefixCommand(message);
        });
    }

    getMusicManager(guildId, channelId) {
        // Use channelId as the primary key for music managers
        if (!this.musicManagers.has(channelId)) {
            const musicManager = new MusicManager(guildId, channelId, this.sourceHandlers);
            
            // Set up event callbacks for panel management
            musicManager.onTrackStart = (track) => {
                this.handleTrackStart(guildId, channelId, track);
            };
            
            musicManager.onTrackEnd = (track) => {
                this.handleTrackEnd(guildId, channelId, track);
            };
            
            musicManager.onQueueEmpty = () => {
                this.handleQueueEmpty(guildId, channelId);
            };
            
            musicManager.onQueueUpdate = (queueInfo) => {
                this.handleQueueUpdate(guildId, channelId, queueInfo);
            };
            
            this.musicManagers.set(channelId, musicManager);
            // Track active channels per guild (support multiple channels)
            if (!this.guildChannels.has(guildId)) {
                this.guildChannels.set(guildId, new Set());
            }
            this.guildChannels.get(guildId).add(channelId);
        }
        return this.musicManagers.get(channelId);
    }

    async handleTrackStart(guildId, channelId, track) {
        const trackTitle = track?.title || 'Unknown';
        console.log(`🎵 Track started in channel ${channelId} (guild ${guildId}): ${trackTitle}`);
        
        if (!track || !track.title) {
            console.log('🎵 Now playing: Unknown');
            return;
        }
        
        // Find the appropriate text channel to send the panel
        const guild = this.client.guilds.cache.get(guildId);
        if (!guild) return;
        
        // Try to find the text channel where music commands were issued from
        let textChannel = null;
        
        // First try to get the stored text channel for this voice channel
        const storedTextChannelId = this.musicTextChannels.get(channelId);
        if (storedTextChannelId) {
            textChannel = guild.channels.cache.get(storedTextChannelId);
        }
        
        // If not found, try the last panel location
        if (!textChannel) {
            const panelInfo = this.musicPanels.get(channelId);
            if (panelInfo) {
                textChannel = guild.channels.cache.get(panelInfo.textChannelId);
            }
        }
        
        // Last resort: find a general/music channel or use the first text channel
        if (!textChannel) {
            textChannel = guild.channels.cache.find(ch => 
                ch.name.includes('music') || 
                ch.name.includes('bot') || 
                ch.name.includes('general')
            ) || guild.channels.cache.find(ch => ch.type === 0); // 0 = GUILD_TEXT
        }
        
        if (textChannel) {
            const musicManager = this.getMusicManager(guildId, channelId);
            await this.sendNewMusicPanel(textChannel, track, channelId, musicManager);
        }
    }

    async handleTrackEnd(guildId, channelId, track) {
        const trackTitle = track?.title || 'Unknown';
        console.log(`🎵 Track ended in channel ${channelId} (guild ${guildId}): ${trackTitle}`);
        // The panel will be replaced when the next track starts
        // or can be manually controlled by users via buttons
    }

    async handleQueueEmpty(guildId, channelId) {
        const panelInfo = this.musicPanels.get(channelId);
        if (panelInfo && panelInfo.message) {
            try {
                const embed = this.createMusicEmbed(
                    '🎵 Queue Empty',
                    'Use `/play` to queue your next song!',
                    config.colors.info
                );
                
                await panelInfo.message.edit({ 
                    embeds: [embed], 
                    components: [] // Remove controls when queue is empty
                });
            } catch (error) {
                console.log('❌ Failed to update empty queue panel:', error.message);
            }
        }
    }

    updatePanelReference(channelId, track) {
        const panelInfo = this.musicPanels.get(channelId);
        if (panelInfo) {
            panelInfo.track = track;
            this.musicPanels.set(channelId, panelInfo);
        }
    }

    async handleSlashCommand(interaction) {
        const member = interaction.member;
        const voiceChannel = member?.voice?.channel;
        const voiceChannelId = voiceChannel?.id;
        
        let musicManager = voiceChannelId ? this.getMusicManager(interaction.guildId, voiceChannelId) : null;
        
        // Check if user switched channels and there's an existing session to transfer
        if (voiceChannelId) {
            const activeChannels = this.guildChannels.get(interaction.guildId);
            if (activeChannels && activeChannels.size > 0) {
                const botCurrentChannel = activeChannels.values().next().value;
                if (botCurrentChannel !== voiceChannelId) {
                    // User switched channels - check if there's an existing session to transfer
                    const existingMusicManager = this.musicManagers.get(botCurrentChannel);
                    if (existingMusicManager && (existingMusicManager.queue.length > 0 || existingMusicManager.isPlaying)) {
                        console.log(`🔄 Command: User switched channels: bot in ${botCurrentChannel}, user in ${voiceChannelId}`);
                        try {
                            const connection = await this.connectToVoiceChannel(voiceChannel, interaction.guildId);
                            
                            // Transfer the existing music manager to new channel
                            this.musicManagers.delete(botCurrentChannel);
                            this.musicManagers.set(voiceChannelId, existingMusicManager);
                            existingMusicManager.channelId = voiceChannelId;
                            existingMusicManager.setConnection(connection);
                            
                            // Update guild channels tracking
                            this.cleanupChannel(botCurrentChannel, interaction.guildId);
                            if (!this.guildChannels.has(interaction.guildId)) {
                                this.guildChannels.set(interaction.guildId, new Set());
                            }
                            this.guildChannels.get(interaction.guildId).add(voiceChannelId);
                            
                            musicManager = existingMusicManager;
                            console.log(`🎵 Moved music session to ${voiceChannel.name} via command`);
                        } catch (error) {
                            console.error(`❌ Failed to move to new channel: ${error.message}`);
                        }
                    }
                }
            }
        }
        
        switch (interaction.commandName) {
            case 'play':
                await this.handlePlayCommand(interaction, musicManager);
                break;
            case 'search':
                await this.handleSearchCommand(interaction, musicManager);
                break;
            case 'queue':
                await this.handleQueueCommand(interaction, musicManager);
                break;
            case 'skip':
                if (!musicManager) {
                    return await interaction.reply({ 
                        embeds: [this.createErrorEmbed('You need to be in a voice channel to use this command!')], 
                        ephemeral: true 
                    });
                }
                await this.handleSkipCommand(interaction, musicManager);
                break;
            case 'stop':
                if (!musicManager) {
                    return await interaction.reply({ 
                        embeds: [this.createErrorEmbed('You need to be in a voice channel to use this command!')], 
                        ephemeral: true 
                    });
                }
                await this.handleStopCommand(interaction, musicManager);
                break;
            case 'pause':
                if (!musicManager) {
                    return await interaction.reply({ 
                        embeds: [this.createErrorEmbed('You need to be in a voice channel to use this command!')], 
                        ephemeral: true 
                    });
                }
                await this.handlePauseCommand(interaction, musicManager);
                break;
            case 'resume':
                if (!musicManager) {
                    return await interaction.reply({ 
                        embeds: [this.createErrorEmbed('You need to be in a voice channel to use this command!')], 
                        ephemeral: true 
                    });
                }
                await this.handleResumeCommand(interaction, musicManager);
                break;
            case 'volume':
                await this.handleVolumeCommand(interaction, musicManager);
                break;
            case 'shuffle':
                await this.handleShuffleCommand(interaction, musicManager);
                break;
            case 'loop':
                await this.handleLoopCommand(interaction, musicManager);
                break;
            case 'nowplaying':
                await this.handleNowPlayingCommand(interaction, musicManager);
                break;
            case 'join':
                await this.handleJoinCommand(interaction, musicManager);
                break;
            case 'leave':
                await this.handleLeaveCommand(interaction, musicManager);
                break;
            case 'help':
                await this.handleHelpCommand(interaction);
                break;
            case 'playlist':
                await this.handlePlaylistCommand(interaction, musicManager);
                break;
            case 'video':
                await this.handleVideoCommand(interaction, musicManager);
                break;
            case 'autoplay':
                await this.handleAutoPlayCommand(interaction, musicManager);
                break;
            case 'clear':
                await this.handleClearCommand(interaction, musicManager, voiceChannelId);
                break;
            case 'lyrics':
                await this.handleLyricsCommand(interaction, musicManager);
                break;
            case 'tts':
                await this.handleTTSCommand(interaction);
                break;
        }
    }

    async handlePlayCommand(interaction, musicManager) {
        const query = interaction.options.getString('query');
        const fastMode = interaction.options.getBoolean('fast') ?? true; // Default to Discord Player (YouTube + Spotify only)
        const member = interaction.member;
        const voiceChannel = member.voice.channel;
        
        if (!voiceChannel) {
            return await interaction.reply({
                embeds: [this.createErrorEmbed('You need to be in a voice channel to play music!')],
                ephemeral: true
            });
        }

        // Use Discord Player for faster, more reliable playback
        if (fastMode) {
            console.log(`🚀 Fast mode: Using Discord Player for "${query}"`);
            return await this.discordPlayer.play(interaction, query);
        }

        await interaction.deferReply();

        // Track which text channel this music command came from
        this.musicTextChannels.set(voiceChannel.id, interaction.channelId);

        try {
            const connection = await this.connectToVoiceChannel(voiceChannel, interaction.guildId);
            musicManager.setConnection(connection);

            // Use optimized search limit for speed
            const searchResults = await this.sourceHandlers.search(query, 8);
            
            if (searchResults.length === 0) {
                return await interaction.editReply({
                    embeds: [this.createErrorEmbed('No results found for your search! Try different keywords or check spelling.')]
                });
            }

            // Select the best track (prioritize YouTube since yt-dlp works directly with it)
            const selectedTrack = searchResults.find(track => track.source === 'youtube') || 
                                 searchResults.find(track => track.source === 'spotify') || 
                                 searchResults[0];
            console.log(`✅ Selected track: ${selectedTrack.title} from ${selectedTrack.source}`);

            await musicManager.addToQueue(selectedTrack, -1, { 
                userId: interaction.user.id, 
                guildId: interaction.guild.id 
            });

            // Store channel info for panel management using voice channel as key
            const panelInfo = this.musicPanels.get(voiceChannel.id);
            if (!panelInfo || panelInfo.textChannelId !== interaction.channelId) {
                // Update or set the channel for future panels, keeping existing message if available
                this.musicPanels.set(voiceChannel.id, {
                    message: panelInfo?.message || null,
                    textChannelId: interaction.channelId,
                    guildId: interaction.guildId,
                    track: panelInfo?.track || null
                });
            }

            const embed = this.createMusicEmbed(
                '🎵 Added to Queue',
                `**${selectedTrack.title}**\nBy: ${selectedTrack.author}\nDuration: ${selectedTrack.duration}\nSource: ${selectedTrack.source.toUpperCase()}\nPosition in queue: ${musicManager.queue.length}`,
                config.colors.success,
                selectedTrack.thumbnail
            );

            await interaction.editReply({ 
                embeds: [embed],
                components: this.createMusicControls()
            });

            if (!musicManager.isPlaying) {
                await musicManager.play();
            }

        } catch (error) {
            const errorType = ErrorHandler.detectErrorType(error);
            await this.errorHandler.handleError(interaction, errorType, error, {
                guildId: interaction.guildId,
                userId: interaction.user.id,
                track: { title: query, author: 'Unknown' }
            });
        }
    }

    async handleSearchCommand(interaction, musicManager) {
        const query = interaction.options.getString('query');
        await interaction.deferReply();

        try {
            const results = await this.sourceHandlers.search(query, config.settings.searchLimit);
            
            if (results.length === 0) {
                return await interaction.editReply({
                    embeds: [this.createErrorEmbed('No results found!')]
                });
            }

            const embed = this.createSearchEmbed(results);
            const selectMenu = this.createSearchSelectMenu(results, interaction.user.id);

            await interaction.editReply({
                embeds: [embed],
                components: [selectMenu]
            });

        } catch (error) {
            console.error('Search error:', error);
            await interaction.editReply({
                embeds: [this.createErrorEmbed('Search failed. Please try again.')]
            });
        }
    }

    async connectToVoiceChannel(channel, guildId) {
        const connection = joinVoiceChannel({
            channelId: channel.id,
            guildId: guildId,
            adapterCreator: channel.guild.voiceAdapterCreator,
            selfDeaf: false,
            selfMute: false
        });

        try {
            await entersState(connection, VoiceConnectionStatus.Ready, 30000);
            
            // Update guild channel mapping for session management
            if (!this.guildChannels.has(guildId)) {
                this.guildChannels.set(guildId, new Set());
            }
            this.guildChannels.get(guildId).add(channel.id);
            
            console.log(`🔗 Connected to voice channel: ${channel.name} (${channel.id}) in guild: ${guildId}`);
            return connection;
        } catch (error) {
            console.error(`❌ Failed to connect to voice channel: ${error.message}`);
            connection.destroy();
            throw error;
        }
    }

    createMusicEmbed(title, description, color, thumbnail = null, fields = null) {
        const embed = new EmbedBuilder()
            .setTitle(title)
            .setDescription(description)
            .setColor(color)
            .setTimestamp()
            .setFooter({ 
                text: `Ative Music Bot • High Quality Audio`, 
                iconURL: 'https://cdn.discordapp.com/emojis/741605543046807626.png' 
            });
            
        if (thumbnail) {
            embed.setThumbnail(thumbnail);
        }

        if (fields && Array.isArray(fields)) {
            embed.addFields(fields);
        }
        
        return embed;
    }

    createNowPlayingEmbed(track, musicManager) {
        const queueInfo = musicManager.getQueueInfo();
        const isPlaying = musicManager.isPlaying && !musicManager.isPaused;
        const status = musicManager.isPaused ? 'PAUSED' : isPlaying ? 'PLAYING' : 'STOPPED';
        const statusEmoji = musicManager.isPaused ? '⏸️' : isPlaying ? '▶️' : '⏹️';
        
        const progressBar = this.createProgressBar(track, musicManager);
        
        const embed = new EmbedBuilder()
            .setColor(isPlaying ? config.colors.playing : musicManager.isPaused ? config.colors.paused : config.colors.stopped)
            .setTitle(`${statusEmoji} ${status}`)
            .setDescription(`## ${track.title}\n**${track.author}**\n\n${progressBar}`)
            .setThumbnail(track.thumbnail || null)
            .setTimestamp()
            .setFooter({ 
                text: `Ative Music Bot • Queue: ${queueInfo.currentIndex + 1}/${queueInfo.queue.length}`, 
                iconURL: 'https://cdn.discordapp.com/emojis/741605543046807626.png' 
            });

        // Enhanced field layout
        const fields = [
            { 
                name: '⏱️ Duration', 
                value: `\`${track.duration || 'Unknown'}\``, 
                inline: true 
            },
            { 
                name: '📻 Source', 
                value: `\`${track.source?.toUpperCase() || 'Unknown'}\``, 
                inline: true 
            },
            { 
                name: '🔊 Volume', 
                value: `\`${musicManager.volume}%\``, 
                inline: true 
            },
            { 
                name: '🔁 Loop', 
                value: `\`${musicManager.loopMode === 'off' ? 'Disabled' : musicManager.loopMode === 'track' ? 'Track' : 'Queue'}\``, 
                inline: true 
            },
            { 
                name: '🎵 Queue', 
                value: `\`${queueInfo.queue.length} tracks\``, 
                inline: true 
            },
            { 
                name: '🤖 Auto-Play', 
                value: `\`${musicManager.autoPlayEnabled ? 'Enabled' : 'Disabled'}\``, 
                inline: true 
            }
        ];

        embed.addFields(fields);

        return embed;
    }

    createProgressBar(track, musicManager, segments = 16) {
        const durationMs = this.getTrackDurationMs(track, musicManager) || 0;
        let elapsedMs = 0;
        if (musicManager && musicManager.isPlaying && !musicManager.isPaused && musicManager.trackStartTime) {
            elapsedMs = Date.now() - musicManager.trackStartTime;
        } else if (musicManager && musicManager.isPaused && musicManager.trackStartTime) {
            // Approximate elapsed at pause time; if we previously updated the panel, it will be close enough
            elapsedMs = Math.max(0, (this._panelLastElapsed?.get(musicManager.channelId) || (Date.now() - musicManager.trackStartTime)));
        }
        elapsedMs = Math.max(0, Math.min(durationMs || 0, elapsedMs));

        const ratio = durationMs > 0 ? elapsedMs / durationMs : 0;
        let filled = Math.floor(ratio * segments);
        if (filled >= segments) filled = segments - 1;
        const empty = Math.max(0, segments - filled - 1);
        const bar = '▰'.repeat(filled) + '🔘' + '▱'.repeat(empty);
        const elapsedStr = this.formatMs(elapsedMs);
        const totalStr = this.formatMs(durationMs);
        
        // Track last elapsed for paused state approximation
        if (!this._panelLastElapsed) this._panelLastElapsed = new Map();
        this._panelLastElapsed.set(musicManager.channelId, elapsedMs);

        return `\`${elapsedStr}\` ${bar} \`${totalStr}\``;
    }

    getTrackDurationMs(track, musicManager) {
        if (!track) return 0;
        if (track.durationMS) return track.durationMS;
        if (typeof track.duration === 'number') return track.duration;
        if (typeof track.duration === 'string') {
            try {
                if (musicManager?.parseDuration) {
                    return musicManager.parseDuration(track.duration);
                }
                // Fallback parse mm:ss or hh:mm:ss
                const parts = track.duration.split(':').map(n => parseInt(n, 10));
                if (parts.length === 3) {
                    return ((parts[0]*3600) + (parts[1]*60) + parts[2]) * 1000;
                } else if (parts.length === 2) {
                    return ((parts[0]*60) + parts[1]) * 1000;
                }
            } catch (_) { }
        }
        return 0;
    }

    formatMs(ms) {
        if (!ms || ms < 0) return '0:00';
        const s = Math.floor(ms/1000);
        const sec = s % 60;
        const min = Math.floor((s/60) % 60);
        const hr = Math.floor(s/3600);
        if (hr > 0) return `${hr}:${min.toString().padStart(2,'0')}:${sec.toString().padStart(2,'0')}`;
        return `${min}:${sec.toString().padStart(2,'0')}`;
    }

    startPanelProgressUpdater() {
        setInterval(async () => {
            try {
                for (const [channelId, panelInfo] of this.musicPanels.entries()) {
                    const musicManager = this.musicManagers.get(channelId);
                    if (!musicManager || !musicManager.currentTrack) continue;
                    // Only update when playing or paused on a track
                    if (!musicManager.isPlaying && !musicManager.isPaused) continue;

                    const embed = this.createNowPlayingEmbed(musicManager.currentTrack, musicManager);
                    try {
                        await panelInfo.message.edit({ embeds: [embed] });
                    } catch (e) {
                        // If message was deleted or can't be edited, drop the panel
                        if (e?.code === 10008 || /Unknown Message/i.test(e?.message || '')) {
                            this.musicPanels.delete(channelId);
                        }
                    }
                }
            } catch (_) {
                // ignore updater errors
            }
        }, 2000);
    }

    createErrorEmbed(message) {
        return new EmbedBuilder()
            .setTitle('❌ Error')
            .setDescription(message)
            .setColor(config.colors.error)
            .setTimestamp();
    }

    createMusicControls(isPlaying = true, isPaused = false, loopMode = 'off', isShuffled = false) {
        // Primary controls row - most commonly used
        const row1 = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('music_previous')
                    .setEmoji('⏮️')
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId(isPaused ? 'music_resume' : 'music_pause')
                    .setEmoji(isPaused ? '▶️' : '⏸️')
                    .setStyle(isPaused ? ButtonStyle.Success : ButtonStyle.Secondary)
                    .setLabel(isPaused ? 'Play' : 'Pause'),
                new ButtonBuilder()
                    .setCustomId('music_skip')
                    .setEmoji('⏭️')
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId('music_stop')
                    .setEmoji('⏹️')
                    .setStyle(ButtonStyle.Danger),
                new ButtonBuilder()
                    .setCustomId('music_shuffle')
                    .setEmoji('🔀')
                    .setStyle(isShuffled ? ButtonStyle.Success : ButtonStyle.Secondary)
            );
        
        // Secondary controls row - additional features
        const row2 = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('music_repeat')
                    .setEmoji(loopMode === 'track' ? '🔂' : '🔁')
                    .setLabel(loopMode === 'off' ? 'Loop' : loopMode === 'track' ? 'Track' : 'Queue')
                    .setStyle(loopMode !== 'off' ? ButtonStyle.Success : ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId('music_volume_down')
                    .setEmoji('🔉')
                    .setLabel('Vol -')
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId('music_volume_up')
                    .setEmoji('🔊')
                    .setLabel('Vol +')
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId('music_queue')
                    .setEmoji('📋')
                    .setLabel('Queue')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId('music_clear_queue')
                    .setEmoji('🗑️')
                    .setLabel('Clear')
                    .setStyle(ButtonStyle.Danger)
            );
            
        return [row1, row2];
    }

    createQueueEmbed(musicManager, page = 0) {
        const queueInfo = musicManager.getQueueInfo();
        const itemsPerPage = 10;
        const startIndex = page * itemsPerPage;
        const endIndex = Math.min(startIndex + itemsPerPage, queueInfo.queue.length);
        const totalPages = Math.ceil(queueInfo.queue.length / itemsPerPage);
        
        const embed = new EmbedBuilder()
            .setTitle('📋 Music Queue')
            .setColor(config.colors.queue)
            .setTimestamp()
            .setFooter({ 
                text: `Ative Music Bot • Page ${page + 1}/${totalPages || 1}`, 
                iconURL: 'https://cdn.discordapp.com/emojis/741605543046807626.png' 
            });

        if (queueInfo.queue.length === 0) {
            embed.setDescription('🎵 **Queue is empty**\nUse `/play` to add some music!');
            return embed;
        }

        let description = '';
        
        // Current track
        if (queueInfo.currentTrack && queueInfo.currentIndex >= 0) {
            const current = queueInfo.currentTrack;
            description += `**🎵 Now Playing:**\n\`${current.title}\` by **${current.author}** \`(${current.duration})\`\n\n`;
        }

        // Queue tracks for this page
        description += `**📋 Up Next:**\n`;
        
        for (let i = startIndex; i < endIndex; i++) {
            const track = queueInfo.queue[i];
            const position = i + 1;
            const isNext = i === queueInfo.currentIndex + 1;
            const prefix = isNext ? '▶️' : `\`${position}.\``;
            
            description += `${prefix} **${track.title}** by ${track.author} \`(${track.duration})\`\n`;
        }

        // Add queue stats
        const fields = [
            { 
                name: '📊 Queue Stats', 
                value: `**Tracks:** ${queueInfo.queue.length}\n**Duration:** ${queueInfo.totalDuration || 'Unknown'}\n**Loop:** ${musicManager.loopMode === 'off' ? 'Disabled' : musicManager.loopMode}`, 
                inline: true 
            },
            { 
                name: '🎛️ Settings', 
                value: `**Volume:** ${musicManager.volume}%\n**Auto-play:** ${musicManager.autoPlayEnabled ? 'On' : 'Off'}\n**Shuffle:** ${musicManager.isShuffled ? 'On' : 'Off'}`, 
                inline: true 
            }
        ];

        if (totalPages > 1) {
            fields.push({
                name: '📄 Navigation',
                value: `Page ${page + 1} of ${totalPages}\nUse the buttons below to navigate`,
                inline: true
            });
        }

        embed.setDescription(description);
        embed.addFields(fields);

        return embed;
    }

    async updateMusicPanel(channelId, track, musicManager) {
        const panelInfo = this.musicPanels.get(channelId);
        if (!panelInfo) return;

        const embed = this.createNowPlayingEmbed(track, musicManager);
        const controls = this.createMusicControls(
            musicManager.isPlaying && !musicManager.isPaused, 
            musicManager.isPaused,
            musicManager.loopMode,
            musicManager.isShuffled
        );

        try {
            await panelInfo.message.edit({
                embeds: [embed],
                components: controls
            });
            
            // Update stored panel reference
            panelInfo.track = track;
        } catch (error) {
            console.log('❌ Failed to update music panel:', error.message);
            // Remove invalid panel reference
            this.musicPanels.delete(channelId);
        }
    }

    async deletePreviousPanel(channelId) {
        const panelInfo = this.musicPanels.get(channelId);
        if (panelInfo && panelInfo.message) {
            try {
                await panelInfo.message.delete();
                console.log('🗑️ Deleted previous music panel');
            } catch (error) {
                console.log('⚠️ Could not delete previous panel:', error.message);
            }
        }
        // Always clean up the panel reference, even if deletion failed
        this.musicPanels.delete(channelId);
    }

    async sendNewMusicPanel(channel, track, voiceChannelId, musicManager) {
        const guildId = channel.guild.id;
        
        // Delete previous panel first
        await this.deletePreviousPanel(voiceChannelId);

        const embed = this.createNowPlayingEmbed(track, musicManager);
        const controls = this.createMusicControls(
            musicManager.isPlaying && !musicManager.isPaused, 
            musicManager.isPaused,
            musicManager.loopMode,
            musicManager.isShuffled
        );

        try {
            const message = await channel.send({
                embeds: [embed],
                components: controls
            });

            // Store new panel reference using voice channel ID for proper tracking
            this.musicPanels.set(voiceChannelId, {
                message: message,
                textChannelId: channel.id, // Store the text channel where panel was sent
                guildId: guildId,
                track: track
            });

            return message;
        } catch (error) {
            console.error('❌ Failed to send music panel:', error);
            return null;
        }
    }

    createAdvancedControls() {
        return new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('music_shuffle')
                    .setEmoji('🔀')
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId('music_volume_down')
                    .setEmoji('🔉')
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId('music_repeat')
                    .setEmoji('🔁')
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId('music_volume_up')
                    .setEmoji('🔊')
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId('music_queue')
                    .setEmoji('📜')
                    .setStyle(ButtonStyle.Secondary)
            );
    }

    async handleButtonInteraction(interaction) {
        try {
            // Check if interaction is still valid (not expired)
            if (interaction.deferred || interaction.replied) {
                console.log('⚠️ Interaction already handled, skipping...');
                return;
            }

            // Check if interaction is expired (15 minutes = 900000ms)
            const interactionAge = Date.now() - interaction.createdTimestamp;
            if (interactionAge > 900000) {
                console.log('⚠️ Interaction expired, skipping...');
                return;
            }
            
            // Find which voice channel to use - prefer user's current channel
            let currentChannelId = interaction.member.voice?.channel?.id;
            let existingMusicManager = null;
            
            // Check if user is in a voice channel
            if (!currentChannelId) {
                // User is not in a voice channel, try to find existing active session
                const activeChannels = this.guildChannels.get(interaction.guildId);
                if (activeChannels && activeChannels.size > 0) {
                    currentChannelId = activeChannels.values().next().value;
                } else {
                    return await safeReply({
                        content: 'You must be in a voice channel to use music controls!',
                        ephemeral: true
                    });
                }
            } else {
                // User is in a voice channel - check if bot needs to switch
                const activeChannels = this.guildChannels.get(interaction.guildId);
                if (activeChannels && activeChannels.size > 0) {
                    const botCurrentChannel = activeChannels.values().next().value;
                    if (botCurrentChannel !== currentChannelId) {
                        // User switched channels - get existing music manager and transfer
                        existingMusicManager = this.musicManagers.get(botCurrentChannel);
                        console.log(`🔄 User switched channels: bot in ${botCurrentChannel}, user in ${currentChannelId}`);
                        
                        // Transfer the session to the new channel
                        if (existingMusicManager && (existingMusicManager.queue.length > 0 || existingMusicManager.isPlaying)) {
                            try {
                                const voiceChannel = interaction.member.voice.channel;
                                const connection = await this.connectToVoiceChannel(voiceChannel, interaction.guildId);
                                
                                // Transfer the existing music manager to new channel
                                this.musicManagers.delete(botCurrentChannel);
                                this.musicManagers.set(currentChannelId, existingMusicManager);
                                existingMusicManager.channelId = currentChannelId;
                                existingMusicManager.setConnection(connection);
                                
                                // Update guild channels tracking
                                this.cleanupChannel(botCurrentChannel, interaction.guildId);
                                if (!this.guildChannels.has(interaction.guildId)) {
                                    this.guildChannels.set(interaction.guildId, new Set());
                                }
                                this.guildChannels.get(interaction.guildId).add(currentChannelId);
                                
                                console.log(`🎵 Moved music session to ${voiceChannel.name}`);
                            } catch (error) {
                                console.error(`❌ Failed to move to new channel: ${error.message}`);
                            }
                        }
                    }
                }
            }
            
            const musicManager = this.getMusicManager(interaction.guildId, currentChannelId);
            const userId = interaction.user.id;
            const username = interaction.user.username;
            
            // Log user action
            console.log(`👤 @${username} (${userId}) clicked button: ${interaction.customId}`);
            
            // Defer the interaction immediately to prevent timeouts
            if (!interaction.deferred && !interaction.replied) {
                try {
                    // Use a shorter timeout and defer immediately
                    const deferPromise = interaction.deferReply({ flags: 64 }); // 64 = ephemeral flag
                    const timeoutPromise = new Promise((_, reject) => 
                        setTimeout(() => reject(new Error('Defer timeout')), 2000)
                    );
                    
                    await Promise.race([deferPromise, timeoutPromise]);
                    console.log(`✅ Successfully deferred interaction: ${interaction.customId}`);
                } catch (deferError) {
                    if (deferError.code !== 'InteractionAlreadyReplied' && deferError.code !== 10062) {
                        console.error(`⚠️ Could not defer interaction: ${deferError.message}`);
                        // If deferring fails, try to reply directly
                        try {
                            await interaction.reply({ 
                                content: '⏳ Processing your request...', 
                                flags: 64
                            });
                        } catch (replyError) {
                            console.error(`❌ Failed to respond to interaction: ${replyError.message}`);
                            return; // Give up on this interaction
                        }
                    }
                }
            }
            
            // Helper function to safely respond to interaction
            const safeReply = async (options, useUpdate = false) => {
                try {
                    // Add timeout to prevent hanging
                    const replyPromise = (async () => {
                        if (interaction.deferred && !interaction.replied) {
                            return await interaction.editReply(options);
                        } else if (!interaction.replied && !interaction.deferred) {
                            return await interaction.reply({...options, flags: options.ephemeral ? 64 : 0});
                        } else {
                            // Fallback: send as followUp if possible
                            return await interaction.followUp({...options, flags: 64});
                        }
                    })();
                    
                    const timeoutPromise = new Promise((_, reject) => 
                        setTimeout(() => reject(new Error('Reply timeout')), 3000)
                    );
                    
                    await Promise.race([replyPromise, timeoutPromise]);
                    console.log(`✅ Successfully replied to interaction: ${interaction.customId}`);
                } catch (error) {
                    if (error.code !== 'InteractionAlreadyReplied' && 
                        error.code !== 10062 && 
                        error.code !== 'Unknown interaction') {
                        console.error(`⚠️ Could not respond to interaction: ${error.message}`);
                        
                        // Last resort: try a simple followUp
                        try {
                            if (!error.message.includes('timeout')) {
                                await interaction.followUp({
                                    content: typeof options.content === 'string' ? options.content : '✅ Action completed',
                                    ephemeral: true
                                });
                            }
                        } catch (lastResortError) {
                            console.error(`❌ Final attempt failed: ${lastResortError.message}`);
                        }
                    }
                }
            };
            
            switch (interaction.customId) {
            case 'music_pause':
                if (musicManager.pause()) {
                    const track = musicManager.currentTrack;
                    const embed = this.createNowPlayingEmbed(track, musicManager);
                    const controls = this.createMusicControls(false, true, musicManager.loopMode, musicManager.isShuffled);
                    
                    try {
                        await interaction.editReply({ embeds: [embed], components: controls });
                        
                        // Update the stored panel reference with the new state
                        this.updatePanelReference(currentChannelId, track);
                    } catch (updateError) {
                        await interaction.followUp({ embeds: [embed], components: controls, ephemeral: true });
                    }
                } else {
                    await safeReply({ content: '❌ Nothing to pause!', ephemeral: true });
                }
                break;
                
            case 'music_resume':
                if (musicManager.resume()) {
                    const track = musicManager.currentTrack;
                    const embed = this.createNowPlayingEmbed(track, musicManager);
                    const controls = this.createMusicControls(true, false, musicManager.loopMode, musicManager.isShuffled);
                    
                    try {
                        await interaction.editReply({ embeds: [embed], components: controls });
                        
                        // Update the stored panel reference with the new state
                        this.updatePanelReference(currentChannelId, track);
                    } catch (updateError) {
                        await interaction.followUp({ embeds: [embed], components: controls, ephemeral: true });
                    }
                } else {
                    await safeReply({ content: '❌ Nothing to resume!', ephemeral: true });
                }
                break;
                
            case 'music_skip':
                if (await musicManager.skip()) {
                    const nextTrack = musicManager.currentTrack;
                    const queueInfo = musicManager.getQueueInfo();
                    
                    if (nextTrack) {
                        const embed = this.createMusicEmbed(
                            'Skipped - Now Playing', 
                            `**${nextTrack.title}** by ${nextTrack.author}`,
                            config.colors.info, 
                            nextTrack.thumbnail
                        );
                        
                        embed.addFields([
                            { name: 'Queue Position', value: `${queueInfo.currentIndex + 1} of ${queueInfo.queue.length}`, inline: true },
                            { name: 'Duration', value: String(nextTrack.duration) || 'Unknown', inline: true },
                            { name: 'Source', value: nextTrack.source?.toUpperCase() || 'Unknown', inline: true }
                        ]);
                        
                        try {
                            await interaction.editReply({ embeds: [embed], components: this.createMusicControls(true, false) });
                            
                            // Update the stored panel reference with the new track
                            this.updatePanelReference(currentChannelId, nextTrack);
                            // Update queue state across all components
                            await this.updateQueueState(interaction.guildId, currentChannelId, musicManager);
                        } catch (updateError) {
                            await interaction.followUp({ embeds: [embed], components: this.createMusicControls(true, false), ephemeral: true });
                        }
                    } else {
                        const embed = this.createMusicEmbed('Skipped', 'Queue finished', config.colors.info);
                        try {
                            await interaction.editReply({ embeds: [embed], components: this.createMusicControls(false, false) });
                        } catch (updateError) {
                            await interaction.followUp({ embeds: [embed], components: this.createMusicControls(false, false), ephemeral: true });
                        }
                    }
                } else {
                    await safeReply({ content: '❌ Nothing to skip!', ephemeral: true });
                }
                break;
                
            case 'music_stop':
                musicManager.stop(true); // User initiated
                musicManager.clearQueue(true); // User initiated
                const embed = this.createMusicEmbed('Stopped', 'Music stopped and queue cleared', config.colors.warning);
                await safeReply({ embeds: [embed], components: this.createMusicControls(false, false), ephemeral: true });
                break;
                
            case 'music_shuffle':
                if (musicManager.shuffle()) {
                    await interaction.followUp({ content: `🔀 Queue shuffled (${musicManager.queue.length} tracks)`, ephemeral: true });
                } else {
                    await interaction.reply({ content: '❌ Need at least 2 tracks to shuffle!', ephemeral: true });
                }
                break;
                
            case 'music_previous':
                if (await musicManager.previous()) {
                    const track = musicManager.currentTrack;
                    const queueInfo = musicManager.getQueueInfo();
                    const embed = this.createMusicEmbed(
                        'Previous - Now Playing', 
                        `**${track.title}** by ${track.author}`, 
                        config.colors.info, 
                        track.thumbnail
                    );
                    
                    embed.addFields([
                        { name: 'Queue Position', value: `${queueInfo.currentIndex + 1} of ${queueInfo.queue.length}`, inline: true },
                        { name: 'Duration', value: String(track.duration) || 'Unknown', inline: true },
                        { name: 'Source', value: track.source?.toUpperCase() || 'Unknown', inline: true }
                    ]);
                    
                    try {
                        await interaction.editReply({ embeds: [embed], components: this.createMusicControls(true, false) });
                        
                        // Update the stored panel reference with the new track
                        this.updatePanelReference(currentChannelId, track);
                        // Update queue state across all components
                        await this.updateQueueState(interaction.guildId, currentChannelId, musicManager);
                    } catch (updateError) {
                        await interaction.followUp({ embeds: [embed], components: this.createMusicControls(true, false), ephemeral: true });
                    }
                } else {
                    await safeReply({ content: '❌ No previous track available!', ephemeral: true });
                }
                break;
                
            case 'music_volume_up':
                const newVolumeUp = Math.min(100, musicManager.volume + 10);
                musicManager.setVolume(newVolumeUp);
                console.log(`🔊 Volume set to ${newVolumeUp}%`);
                await safeReply({ content: `🔊 Volume: ${newVolumeUp}%`, ephemeral: true });
                break;
                
            case 'music_volume_down':
                const newVolumeDown = Math.max(0, musicManager.volume - 10);
                musicManager.setVolume(newVolumeDown);
                console.log(`🔉 Volume set to ${newVolumeDown}%`);
                await safeReply({ content: `🔉 Volume: ${newVolumeDown}%`, ephemeral: true });
                break;
                
            case 'music_repeat':
                const modes = ['off', 'track', 'queue'];
                const currentIndex = modes.indexOf(musicManager.loopMode);
                const nextMode = modes[(currentIndex + 1) % modes.length];
                musicManager.setLoop(nextMode);
                const modeEmojis = { off: '➡️', track: '🔂', queue: '🔁' };
                await safeReply({ content: `${modeEmojis[nextMode]} Loop: ${nextMode}`, ephemeral: true });
                break;
                
            case 'music_queue':
                const queueEmbed = this.createQueueEmbed(musicManager, 0);
                try {
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ embeds: [queueEmbed], ephemeral: true });
                    } else {
                        await interaction.followUp({ embeds: [queueEmbed], ephemeral: true });
                    }
                } catch (error) {
                    console.error('❌ Error showing queue:', error);
                    try {
                        if (!interaction.replied && !interaction.deferred) {
                            await interaction.reply({ content: '❌ Failed to display queue', ephemeral: true });
                        } else {
                            await interaction.followUp({ content: '❌ Failed to display queue', ephemeral: true });
                        }
                    } catch (replyError) {
                        console.error('❌ Failed to send queue error response:', replyError);
                    }
                }
                break;
                
            case 'music_clear_queue':
                musicManager.clearQueue(true); // User initiated
                musicManager.stop(true); // User initiated
                console.log('🗑️ Queue cleared by user - auto-play disabled');
                console.log('⏹️ Playbook stopped by user - auto-play disabled');
                await safeReply({ content: 'Queue cleared and playback stopped!', ephemeral: true });
                
                // Update queue state across all components
                const activeChannels = this.guildChannels.get(interaction.guildId);
                if (activeChannels && activeChannels.size > 0) {
                    // Update all active channels in this guild
                    for (const channelId of activeChannels) {
                        const manager = this.musicManagers.get(channelId);
                        if (manager) {
                            await this.updateQueueState(interaction.guildId, channelId, manager);
                        }
                    }
                }
                break;
                
            case 'music_video':
                await this.handleVideoCommand(interaction, musicManager);
                break;
                
            case 'music_nowplaying':
                await this.handleNowPlayingCommand(interaction, musicManager);
                break;
                
            case 'help_quickstart':
                await this.handleQuickStartHelp(interaction);
                break;
                
            case 'help_video':
                await this.handleVideoHelp(interaction);
                break;
                
            case 'help_sources':
                await this.handleSourcesHelp(interaction);
                break;
                
            case 'help_autoplay':
                await this.handleAutoPlayHelp(interaction);
                break;
                
            case 'video_share_instructions':
                await this.handleShareInstructions(interaction);
                break;
                
            case 'video_cache':
                await this.handleVideoCacheCommand(interaction, musicManager);
                break;
                
            case 'video_local_player':
                await this.handleLocalPlayerCommand(interaction, musicManager);
                break;
                
            default:
                // Handle lyrics buttons
                if (interaction.customId.startsWith('lyrics_play_')) {
                    await this.handleLyricsPlayButton(interaction, musicManager);
                } else {
                    await interaction.reply({ content: 'Unknown button action!', ephemeral: true });
                }
                break;
        }
        
        } catch (error) {
            console.error('❌ Button interaction error:', error);
            
            // Handle specific Discord.js errors
            if (error.code === 10062 || error.message.includes('Unknown interaction')) {
                console.log('⚠️ Interaction expired - this is normal for longer operations');
                return;
            }
            
            if (error.code === 'InteractionAlreadyReplied') {
                console.log('⚠️ Interaction already replied to - skipping error reply');
                return;
            }
            
            try {
                // Only try to reply if we haven't already replied or deferred
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({ 
                        content: 'An error occurred while processing your request. Please try again.', 
                        ephemeral: true 
                    });
                } else if (interaction.deferred && !interaction.replied) {
                    await interaction.editReply({ 
                        content: 'An error occurred while processing your request. Please try again.' 
                    });
                }
            } catch (replyError) {
                console.error('❌ Failed to send error reply:', replyError);
            }
        }
    }

    async handleLyricsPlayButton(interaction, musicManager) {
        try {
            await interaction.deferReply({ ephemeral: true });
            
            // Parse the button ID to extract song and artist information
            const customIdParts = interaction.customId.split('_');
            
            if (customIdParts.length < 3) {
                throw new Error('Invalid button format');
            }
            
            let songTitle = '';
            let artistName = '';
            
            if (customIdParts[0] === 'lyrics' && customIdParts[1] === 'play') {
                if (customIdParts[2] === 'song') {
                    // Format: lyrics_play_song_{title}_{artist}
                    if (customIdParts.length >= 5) {
                        songTitle = customIdParts[3];
                        artistName = customIdParts[4];
                    }
                } else {
                    // Format: lyrics_play_{index}_{title}_{artist}
                    if (customIdParts.length >= 5) {
                        songTitle = customIdParts[3];
                        artistName = customIdParts[4];
                    }
                }
            }
            
            if (!songTitle) {
                throw new Error('Could not extract song information from button');
            }
            
            // Create a search query for the song
            const searchQuery = artistName ? `${songTitle} ${artistName}` : songTitle;
            console.log(`🎵 Playing song from lyrics: "${searchQuery}"`);
            
            // Check if user is in a voice channel
            const member = interaction.member;
            const voiceChannel = member.voice.channel;
            
            if (!voiceChannel) {
                return await interaction.editReply({
                    content: 'You need to be in a voice channel to play music!'
                });
            }
            
            // Connect to voice channel if needed
            const connection = await this.connectToVoiceChannel(voiceChannel, interaction.guildId);
            musicManager.setConnection(connection);
            
            // Search for and play the song
            const searchResults = await this.sourceHandlers.search(searchQuery, 3);
            
            if (searchResults.length === 0) {
                return await interaction.editReply({
                    content: `Could not find "${searchQuery}" to play. Try searching manually with \`/play ${searchQuery}\``
                });
            }
            
            // Use the best match
            const track = searchResults[0];
            
            // Add to queue
            const addResult = musicManager.addTrackToQueue(track, {
                requestedBy: interaction.user.username,
                requestedById: interaction.user.id,
                addedAt: Date.now()
            });
            
            if (addResult.success) {
                // Start playing if not already playing
                if (!musicManager.isPlaying) {
                    await musicManager.play();
                }
                
                const positionText = addResult.position === 1 ? 'Now playing' : `Added to queue (position ${addResult.position})`;
                
                await interaction.editReply({
                    content: `🎵 **${positionText}:** ${track.title} by ${track.author}\nRequested from lyrics search`
                });
                
                // Update queue state
                await this.updateQueueState(interaction.guildId, voiceChannel.id, musicManager);
                
            } else {
                await interaction.editReply({
                    content: `Failed to add song to queue: ${addResult.reason}`
                });
            }
            
        } catch (error) {
            console.error('❌ Lyrics play button error:', error);
            await interaction.editReply({
                content: `Error playing song: ${error.message}`
            });
        }
    }

    async handleSelectMenu(interaction) {
        const musicManager = this.getMusicManager(interaction.guildId);
        const member = interaction.member;

        if (!member.voice.channel) {
            return await interaction.reply({
                embeds: [this.createErrorEmbed('You need to be in a voice channel!')],
                ephemeral: true
            });
        }

        const trackIndex = parseInt(interaction.values[0]);
        const cachedResults = this.searchCache.get(interaction.user.id);
        
        if (!cachedResults || !cachedResults[trackIndex]) {
            return await interaction.reply({
                embeds: [this.createErrorEmbed('Search results expired. Please search again.')],
                ephemeral: true
            });
        }

        await interaction.deferReply();

        try {
            const connection = await this.connectToVoiceChannel(member.voice.channel, interaction.guildId);
            musicManager.setConnection(connection);

            const track = cachedResults[trackIndex];
            await musicManager.addToQueue(track, -1, { 
                userId: interaction.user.id, 
                guildId: interaction.guild.id 
            });

            const embed = this.createMusicEmbed(
                '🎵 Added to Queue',
                `**${track.title}**\nBy: ${track.author}\nDuration: ${track.duration}\nPosition in queue: ${musicManager.queue.length}`,
                config.colors.success,
                track.thumbnail
            );

            await interaction.editReply({ 
                embeds: [embed],
                components: this.createMusicControls()
            });

            if (!musicManager.isPlaying) {
                await musicManager.play();
            }

        } catch (error) {
            console.error('Error in select menu:', error);
            await interaction.editReply({
                embeds: [this.createErrorEmbed('An error occurred while adding the track.')]
            });
        }
    }

    createSearchEmbed(results) {
        const embed = new EmbedBuilder()
            .setTitle('🔍 Search Results')
            .setDescription('Select a track from the dropdown menu below to add it to the queue.')
            .setColor(config.colors.info)
            .setTimestamp()
            .setFooter({ 
                text: `Ative Music Bot • Found ${results.length} results`, 
                iconURL: 'https://cdn.discordapp.com/emojis/741605543046807626.png' 
            });

        // Create a more compact, modern display
        const tracksDisplay = results.slice(0, 8).map((track, index) => {
            const emoji = this.getSourceEmoji(track.source);
            return `\`${(index + 1).toString().padStart(2, '0')}.\` ${emoji} **${track.title}**\n` +
                   `      by ${track.author} • \`${track.duration}\``;
        }).join('\n');

        embed.addFields([
            {
                name: '🎵 Top Results',
                value: tracksDisplay,
                inline: false
            }
        ]);

        return embed;
    }

    createSearchSelectMenu(results, userId) {
        if (!this.searchCache) {
            this.searchCache = new Map();
        }

        this.searchCache.set(userId, results);

        const options = results.slice(0, 10).map((track, index) => ({
            label: track.title.length > 25 ? track.title.substring(0, 25) + '...' : track.title,
            description: `${track.author} - ${track.duration}`,
            value: index.toString(),
            emoji: this.getSourceEmoji(track.source)
        }));

        return new ActionRowBuilder()
            .addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('search_select')
                    .setPlaceholder('Select a track to play')
                    .addOptions(options)
            );
    }

    getSourceEmoji(source) {
        switch (source) {
            case 'youtube': return '📺';
            case 'spotify': return '🎵';
            case 'soundcloud': return '☁️';
            default: return '🎶';
        }
    }

    async handleQueueCommand(interaction, musicManager, channelId = null) {
        // Use the channelId parameter if provided, otherwise try to find it
        if (!channelId) {
            const member = interaction.member;
            if (!member?.voice?.channel) {
                return await interaction.reply({
                    embeds: [this.createErrorEmbed('You need to be in a voice channel to view the queue!')],
                    ephemeral: true
                });
            }
            channelId = member.voice.channel.id;
            musicManager = this.getMusicManager(interaction.guildId, channelId);
        }
        
        const queueInfo = musicManager.getQueueInfo();
        
        if (queueInfo.queue.length === 0) {
            return await interaction.reply({
                embeds: [this.createErrorEmbed('The queue is empty!')],
                ephemeral: true
            });
        }

        const embed = new EmbedBuilder()
            .setTitle('Music Queue')
            .setColor(config.colors.music)
            .setTimestamp();

        // Show up to 25 tracks (Discord embed field limit is around 1024 chars per field)
        const tracksPerField = 8;
        const totalTracks = queueInfo.queue.length;
        const maxTracksToShow = Math.min(25, totalTracks);
        
        // Current track info
        if (queueInfo.currentTrack) {
            embed.addFields([{
                name: 'Now Playing',
                value: `**${queueInfo.currentTrack.title}** by ${queueInfo.currentTrack.author}\nDuration: ${queueInfo.currentTrack.duration}\nID: \`${queueInfo.currentTrack.id}\``,
                inline: false
            }]);
        }

        // Split queue into multiple fields to avoid character limits
        for (let i = 0; i < maxTracksToShow; i += tracksPerField) {
            const trackGroup = queueInfo.queue.slice(i, Math.min(i + tracksPerField, maxTracksToShow));
            const fieldValue = trackGroup.map((track, index) => {
                const trackNumber = i + index + 1;
                const isCurrent = (i + index) === queueInfo.currentIndex;
                const prefix = isCurrent ? '▶️ Playing' : `${trackNumber}`;
                return `${prefix}. **${track.title}**\n   by ${track.author} (${track.duration})\n   ID: \`${track.id}\``;
            }).join('\n\n');
            
            const fieldTitle = i === 0 ? 'Queue' : `Queue (cont.)`;
            embed.addFields([{
                name: fieldTitle,
                value: fieldValue,
                inline: false
            }]);
        }
        
        if (totalTracks > maxTracksToShow) {
            embed.addFields([{
                name: 'Additional Tracks',
                value: `... and ${totalTracks - maxTracksToShow} more tracks`,
                inline: false
            }]);
        }

        embed.addFields([
            { name: 'Volume', value: `${queueInfo.volume}%`, inline: true },
            { name: 'Loop Mode', value: queueInfo.loopMode, inline: true },
            { name: 'Total Duration', value: musicManager.formatDuration(queueInfo.queueDuration), inline: true }
        ]);
        
        embed.setFooter({ text: 'Use /clear [id] to remove a specific track from the queue' });

        // Safe reply handling for both slash commands and button interactions
        try {
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ 
                    embeds: [embed],
                    components: this.createMusicControls(),
                    ephemeral: true
                });
            } else if (interaction.deferred && !interaction.replied) {
                await interaction.editReply({ 
                    embeds: [embed],
                    components: this.createMusicControls()
                });
            } else {
                await interaction.followUp({ 
                    embeds: [embed],
                    components: this.createMusicControls(),
                    ephemeral: true
                });
            }
        } catch (error) {
            if (error.code !== 'InteractionAlreadyReplied') {
                console.error(`❌ Error responding to queue command: ${error.message}`);
            }
        }
    }

    async handleSkipCommand(interaction, musicManager) {
        if (!musicManager.isPlaying) {
            return await interaction.reply({
                embeds: [this.createErrorEmbed('Nothing is currently playing!')],
                ephemeral: true
            });
        }

        await musicManager.skip();
        
        const embed = this.createMusicEmbed(
            '⏭️ Track Skipped',
            musicManager.currentTrack ? 
                `Now playing: **${musicManager.currentTrack.title}**` : 
                'Queue is empty',
            config.colors.info
        );

        await interaction.reply({ embeds: [embed] });
    }

    async handleStopCommand(interaction, musicManager) {
        if (!musicManager.isPlaying) {
            return await interaction.reply({
                embeds: [this.createErrorEmbed('Nothing is currently playing!')],
                ephemeral: true
            });
        }

        musicManager.stop(true); // User initiated - disable auto-play
        musicManager.clearQueue(true); // User initiated - disable auto-play
        musicManager.setAutoPlay(false); // Explicitly disable auto-play
        musicManager.setContinuousPlayback(false); // Disable continuous playback
        
        // Delete music panels for all active channels since playback stopped
        const activeChannels = this.guildChannels.get(interaction.guildId);
        if (activeChannels && activeChannels.size > 0) {
            for (const channelId of activeChannels) {
                await this.deletePreviousPanel(channelId);
            }
        }

        const embed = this.createMusicEmbed(
            '⏹️ Playback Stopped',
            'Music stopped and queue cleared. Auto-play disabled.',
            config.colors.warning
        );

        await interaction.reply({ embeds: [embed] });
    }

    async handlePauseCommand(interaction, musicManager) {
        if (!musicManager.isPlaying || musicManager.isPaused) {
            return await interaction.reply({
                embeds: [this.createErrorEmbed('Nothing is currently playing or already paused!')],
                ephemeral: true
            });
        }

        musicManager.pause();

        const embed = this.createMusicEmbed(
            '⏸️ Paused',
            `**${musicManager.currentTrack.title}** has been paused.`,
            config.colors.warning
        );

        await interaction.reply({ embeds: [embed] });
    }

    async handleResumeCommand(interaction, musicManager) {
        if (!musicManager.isPaused) {
            return await interaction.reply({
                embeds: [this.createErrorEmbed('Music is not paused!')],
                ephemeral: true
            });
        }

        musicManager.resume();

        const embed = this.createMusicEmbed(
            '▶️ Resumed',
            `**${musicManager.currentTrack.title}** has been resumed.`,
            config.colors.success
        );

        await interaction.reply({ embeds: [embed] });
    }

    async handleVolumeCommand(interaction, musicManager) {
        const volume = interaction.options.getInteger('level');
        
        if (volume < 0 || volume > 100) {
            return await interaction.reply({
                embeds: [this.createErrorEmbed('Volume must be between 0 and 100!')],
                ephemeral: true
            });
        }

        musicManager.setVolume(volume);

        const embed = this.createMusicEmbed(
            '🔊 Volume Changed',
            `Volume set to ${volume}%`,
            config.colors.info
        );

        await interaction.reply({ embeds: [embed] });
    }

    async handleShuffleCommand(interaction, musicManager) {
        if (musicManager.queue.length < 2) {
            return await interaction.reply({
                embeds: [this.createErrorEmbed('Need at least 2 tracks in queue to shuffle!')],
                ephemeral: true
            });
        }

        musicManager.shuffle();

        const embed = this.createMusicEmbed(
            '🔀 Queue Shuffled',
            `${musicManager.queue.length} tracks have been shuffled.`,
            config.colors.success
        );

        await interaction.reply({ embeds: [embed] });
    }

    async handleLoopCommand(interaction, musicManager) {
        const mode = interaction.options.getString('mode') || 'off';
        musicManager.setLoop(mode);

        const embed = this.createMusicEmbed(
            '🔁 Loop Mode Changed',
            `Loop mode set to: **${mode}**`,
            config.colors.info
        );

        await interaction.reply({ embeds: [embed] });
    }

    async handleNowPlayingCommand(interaction, musicManager) {
        if (!musicManager.currentTrack) {
            return await interaction.reply({
                embeds: [this.createErrorEmbed('Nothing is currently playing!')],
                ephemeral: true
            });
        }

        const track = musicManager.currentTrack;
        const queueInfo = musicManager.getQueueInfo();
        
        const embed = this.createMusicEmbed(
            'Now Playing',
            `**${track.title}**\nBy: ${track.author}\nDuration: ${track.duration}\nSource: ${track.source ? track.source.toUpperCase() : 'UNKNOWN'}`,
            config.colors.music,
            track.thumbnail
        );

        embed.addFields([
            { name: 'Volume', value: `${musicManager.volume}%`, inline: true },
            { name: 'Loop Mode', value: musicManager.loopMode, inline: true },
            { name: 'Status', value: musicManager.isPaused ? 'Paused' : 'Playing', inline: true },
            { name: 'Queue Position', value: `${queueInfo.currentIndex + 1} of ${queueInfo.queue.length}`, inline: true },
            { name: 'Tracks Remaining', value: `${queueInfo.queue.length - queueInfo.currentIndex - 1}`, inline: true },
            { name: 'Total Queue Time', value: musicManager.formatDuration(queueInfo.queueDuration), inline: true }
        ]);

        await interaction.reply({ 
            embeds: [embed],
            components: this.createMusicControls(musicManager.isPlaying, musicManager.isPaused)
        });
    }

    async handleJoinCommand(interaction, musicManager) {
        const member = interaction.member;
        
        if (!member) {
            return await interaction.reply({
                embeds: [this.createErrorEmbed('This command can only be used in a server!')],
                ephemeral: true
            });
        }
        
        if (!member.voice?.channel) {
            return await interaction.reply({
                embeds: [this.createErrorEmbed('You need to be in a voice channel!')],
                ephemeral: true
            });
        }

        try {
            const connection = await this.connectToVoiceChannel(member.voice.channel, interaction.guildId);
            musicManager.setConnection(connection);

            const embed = this.createMusicEmbed(
                '🎵 Joined Voice Channel',
                `Connected to **${member.voice.channel.name}**`,
                config.colors.success
            );

            await interaction.reply({ embeds: [embed] });

        } catch (error) {
            console.error('Join error:', error);
            await interaction.reply({
                embeds: [this.createErrorEmbed('Failed to join voice channel!')]
            });
        }
    }

    async handleLeaveCommand(interaction, musicManager) {
        // Check for existing voice connection in guild, even if musicManager doesn't have it
        const existingConnection = getVoiceConnection(interaction.guildId);
        
        if (!musicManager.connection && !existingConnection) {
            return await interaction.reply({
                embeds: [this.createErrorEmbed('Not connected to a voice channel!')],
                ephemeral: true
            });
        }

        musicManager.stop();
        musicManager.clearQueue();
        
        // Disconnect from musicManager connection if exists
        if (musicManager.connection) {
            musicManager.connection.destroy();
            musicManager.connection = null;
        }
        
        // Also disconnect any existing guild connection (handles crash recovery)
        if (existingConnection && existingConnection.state.status !== 'destroyed') {
            console.log('🔧 Force disconnecting existing voice connection after crash recovery');
            try {
                existingConnection.destroy();
            } catch (error) {
                console.log('⚠️ Connection already destroyed:', error.message);
            }
        }
        
        // Clean up session management data for all channels in this guild
        const activeChannels = this.guildChannels.get(interaction.guildId);
        if (activeChannels && activeChannels.size > 0) {
            for (const channelId of activeChannels) {
                this.musicManagers.delete(channelId);
                this.musicTextChannels.delete(channelId);
                this.musicPanels.delete(channelId);
            }
            this.guildChannels.delete(interaction.guildId);
            console.log(`🧹 Cleaned up session data for guild ${interaction.guildId}, ${activeChannels.size} channels`);
        }

        const embed = this.createMusicEmbed(
            '👋 Left Voice Channel',
            'Disconnected and cleared queue.',
            config.colors.warning
        );

        await interaction.reply({ embeds: [embed] });
    }

    async handleVideoCommand(interaction, musicManager) {
        if (!musicManager.currentTrack) {
            return await interaction.reply({
                embeds: [this.createErrorEmbed('No track is currently playing!')],
                ephemeral: true
            });
        }

        const track = musicManager.currentTrack;
        
        if (track.source !== 'youtube') {
            return await interaction.reply({
                embeds: [this.createErrorEmbed('Video features only available for YouTube tracks!')],
                ephemeral: true
            });
        }

        await interaction.deferReply();

        try {
            const videoInfo = await this.videoHandler.getVideoInfo(track);
            
            if (!videoInfo.hasVideo) {
                return await interaction.editReply({
                    embeds: [this.createErrorEmbed('This track doesn\'t have a music video available.')]
                });
            }

            const embed = new EmbedBuilder()
                .setTitle('📺 Music Video Available!')
                .setDescription(`**${track.title}**\nBy: ${track.author}`)
                .setColor(config.colors.success)
                .setThumbnail(track.thumbnail)
                .addFields([
                    { name: '🎬 Video URL', value: `[Watch on YouTube](${track.url})`, inline: true },
                    { name: '⏱️ Duration', value: String(track.duration), inline: true },
                    { name: '📊 Quality', value: videoInfo.qualities?.[0]?.quality || 'HD', inline: true }
                ])
                .setFooter({ text: '💡 Use screen share to watch together!' });

            const videoButtons = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setLabel('Open Video')
                        .setURL(track.url)
                        .setStyle(ButtonStyle.Link)
                        .setEmoji('🎬'),
                    new ButtonBuilder()
                        .setCustomId('video_share_instructions')
                        .setLabel('Screen Share Guide')
                        .setStyle(ButtonStyle.Secondary)
                        .setEmoji('📺'),
                    new ButtonBuilder()
                        .setCustomId('video_cache')
                        .setLabel('Cache & Send Video')
                        .setStyle(ButtonStyle.Success)
                        .setEmoji('💾'),
                    new ButtonBuilder()
                        .setCustomId('video_local_player')
                        .setLabel('Local Player')
                        .setStyle(ButtonStyle.Primary)
                        .setEmoji('🖥️')
                );

            await interaction.editReply({ 
                embeds: [embed], 
                components: [videoButtons] 
            });

        } catch (error) {
            console.error('Video command error:', error);
            await interaction.editReply({
                embeds: [this.createErrorEmbed('Failed to get video information.')]
            });
        }
    }

    async handleHelpCommand(interaction) {
        const serverUrl = this.localVideoServer.getServerUrl();
        
        const helpEmbed = new EmbedBuilder()
            .setTitle('🎵 Ative Music Bot - Complete Guide')
            .setDescription('🚀 **Professional Music & Video Bot with AI-Powered 24/7 Auto-Play!**')
            .setColor(config.colors.music)
            .setThumbnail(this.client.user.displayAvatarURL())
            .addFields([
                {
                    name: '🎵 **Core Music Commands**',
                    value: '`/play <song/url>` - Play from YouTube, Spotify, SoundCloud\n' +
                           '`/search <query>` - Smart search across all platforms\n' +
                           '`/lyrics <song>` - Get lyrics or search by lyrics\n' +
                           '`/queue` - Beautiful queue display with controls\n' +
                           '`/nowplaying` - Detailed current track info\n' +
                           '`/skip` • `/pause` • `/resume` • `/stop`',
                    inline: false
                },
                {
                    name: '🤖 **AI Auto-Play System** ⭐',
                    value: '`/autoplay enable` - **🔥 Activate 24/7 smart music!**\n' +
                           '`/autoplay disable` - Turn off auto-play\n' +
                           '`/autoplay status` - Check AI status & settings\n' +
                           '`/autoplay fill count:20` - Add AI recommendations\n' +
                           '✨ **Never-ending music with smart AI discovery!**',
                    inline: false
                },
                {
                    name: '📺 **Advanced Video Features** 🎬',
                    value: '`/video` - Complete video management\n' +
                           '**💾 Cache & Send** - Download video files to you\n' +
                           '**🖥️ Local Player** - Professional video player\n' +
                           '**📺 Screen Share** - Perfect for group watching\n' +
                           `**🌐 Video Server:** [${serverUrl}](${serverUrl})`,
                    inline: false
                },
                {
                    name: '🎮 **Smart Button Controls**',
                    value: '⏮️ Previous • ▶️/⏸️ Play/Pause • ⏹️ Stop • ⏭️ Skip • 📺 Video\n' +
                           '🔉 Volume Down • 🔁 Loop • 📜 Queue • 🔊 Volume Up\n' +
                           '🔀 Shuffle • 🤖 Auto-recommendations\n' +
                           '**✨ Buttons update dynamically based on playback state!**',
                    inline: false
                },
                {
                    name: '🔄 **Advanced Queue System**',
                    value: '`/shuffle` - Smart randomization\n' +
                           '`/loop off/track/queue` - Multiple loop modes\n' +
                           '`/volume <0-100>` - Precise volume control\n' +
                           '**🧠 AI Queue Filling** - Auto-adds similar music\n' +
                           '**🎯 Smart Sorting** - Quality-based organization',
                    inline: false
                },
                {
                    name: '🌟 **Premium Features**',
                    value: '**🏠 24/7 Presence** - Never leaves voice channels\n' +
                           '**🤖 Smart AI** - Learns your music taste\n' +
                           '**📱 Multi-Platform** - YouTube, Spotify, SoundCloud\n' +
                           '**🎬 Video Integration** - Local player & file sending\n' +
                           '**⚡ Professional UI** - Beautiful embeds & buttons\n' +
                           '**🧠 Mood Detection** - Time-aware recommendations',
                    inline: false
                }
            ])
            .setFooter({ 
                text: '🚀 Pro Tip: Enable auto-play for endless AI-curated music! • Built with advanced AI',
                iconURL: this.client.user.displayAvatarURL()
            })
            .setTimestamp();

        const helpButtons = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setLabel('🚀 Quick Start')
                    .setCustomId('help_quickstart')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setLabel('🤖 Auto-Play Guide')
                    .setCustomId('help_autoplay')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setLabel('📺 Video Features')
                    .setCustomId('help_video')
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setLabel('🎵 Music Sources')
                    .setCustomId('help_sources')
                    .setStyle(ButtonStyle.Secondary)
            );

        await interaction.reply({ 
            embeds: [helpEmbed], 
            components: [helpButtons]
        });
    }

    async handleQuickStartHelp(interaction) {
        const embed = new EmbedBuilder()
            .setTitle('🚀 Quick Start Guide')
            .setDescription('Get started with Ative Music in seconds!')
            .setColor(config.colors.info)
            .addFields([
                {
                    name: '1️⃣ **Join a Voice Channel**',
                    value: 'Join any voice channel, then use `/join` or just start playing music!',
                    inline: false
                },
                {
                    name: '2️⃣ **Play Your First Song**',
                    value: '`/play never gonna give you up`\n`/play https://www.youtube.com/watch?v=...`\n`/play https://open.spotify.com/track/...`',
                    inline: false
                },
                {
                    name: '3️⃣ **Use Button Controls**',
                    value: 'Click the buttons below music messages for instant control!',
                    inline: false
                },
                {
                    name: '4️⃣ **Try Interactive Search**',
                    value: '`/search imagine dragons` - Pick exact songs from the dropdown!',
                    inline: false
                }
            ])
            .setFooter({ text: '💡 That\'s it! You\'re ready to rock! 🎸' });

        await interaction.reply({ embeds: [embed], ephemeral: true });
    }

    async handleVideoHelp(interaction) {
        const embed = new EmbedBuilder()
            .setTitle('📺 Video Feature Guide')
            .setDescription('Watch music videos together with your friends!')
            .setColor(config.colors.success)
            .addFields([
                {
                    name: '🎬 **How to Use Videos**',
                    value: '1. Play a YouTube track with `/play`\n2. Click the **📺 Video** button\n3. Click **Open Video** to watch\n4. Use **Screen Share Guide** for group watching',
                    inline: false
                },
                {
                    name: '📱 **Screen Sharing Steps**',
                    value: '1. Click the screen share button in Discord\n2. Share your browser window\n3. Open the video URL provided\n4. Everyone can watch together!',
                    inline: false
                },
                {
                    name: '💡 **Pro Tips**',
                    value: '• Works best with music videos from YouTube\n• Use full screen for better viewing\n• Sync playback with voice commands',
                    inline: false
                }
            ]);

        await interaction.reply({ embeds: [embed], ephemeral: true });
    }

    async handleSourcesHelp(interaction) {
        const embed = new EmbedBuilder()
            .setTitle('🎵 Music Sources Guide')
            .setDescription('Ative Music supports multiple platforms!')
            .setColor(config.colors.music)
            .addFields([
                {
                    name: '📺 **YouTube**',
                    value: '• Direct streaming and search\n• Music videos available\n• Best audio quality\n• Instant playback',
                    inline: true
                },
                {
                    name: '🎵 **Spotify**',
                    value: '• Track and playlist support\n• Plays via YouTube\n• Extensive music library\n• Artist recommendations',
                    inline: true
                },
                {
                    name: '☁️ **SoundCloud**',
                    value: '• Independent artists\n• Unique tracks\n• Direct URL support\n• Fallback streaming',
                    inline: true
                },
                {
                    name: '🔍 **Smart Search**',
                    value: 'Searches all platforms simultaneously and removes duplicates for the best results!',
                    inline: false
                }
            ]);

        await interaction.reply({ embeds: [embed], ephemeral: true });
    }

    async handleAutoPlayHelp(interaction) {
        const embed = new EmbedBuilder()
            .setTitle('🤖 AI Auto-Play System Guide')
            .setDescription('**🚀 Revolutionary 24/7 Smart Music Discovery!**')
            .setColor(config.colors.success)
            .addFields([
                {
                    name: '⚡ **Getting Started**',
                    value: '`/autoplay enable` - Activate smart AI music\n`/autoplay disable` - Turn off auto-play\n`/autoplay status` - Check current settings',
                    inline: false
                },
                {
                    name: '🧠 **How It Works**',
                    value: '• **Smart Analysis** - AI learns from your music history\n• **Genre Matching** - Finds similar artists and styles\n• **Mood Detection** - Adapts to time of day\n• **Trending Integration** - Includes popular current tracks\n• **Quality Filtering** - Only adds high-quality tracks',
                    inline: false
                },
                {
                    name: '🎯 **Advanced Features**',
                    value: '`/autoplay fill count:20` - Add AI recommendations to queue\n**🔄 Continuous Playback** - Never-ending music\n**🎲 Variety Control** - Switches genres every 10 tracks\n**📊 Smart Scoring** - Ranks tracks by engagement metrics',
                    inline: false
                },
                {
                    name: '🌟 **Premium Benefits**',
                    value: '• **24/7 Operation** - Keeps channels alive with music\n• **Zero Interruption** - Seamless track transitions\n• **Personalized Discovery** - Learns your preferences\n• **Multi-Source Integration** - Uses all platforms intelligently',
                    inline: false
                },
                {
                    name: '🎵 **Recommendation Strategies**',
                    value: '1. **Related Artists** - Similar musicians and collaborations\n2. **Genre Exploration** - Expands within preferred styles\n3. **Trending Discovery** - Current viral and popular tracks\n4. **Mood-Based** - Time-appropriate energy levels\n5. **Popular Classics** - Proven hits from top artists',
                    inline: false
                }
            ])
            .setFooter({ text: '🤖 AI-powered music that never stops!' });

        await interaction.reply({ embeds: [embed], ephemeral: true });
    }

    async handleShareInstructions(interaction) {
        const instructions = this.videoHandler.getScreenShareInstructions();
        const embed = new EmbedBuilder()
            .setTitle(instructions.title)
            .setDescription(instructions.description)
            .setColor(config.colors.info)
            .addFields([
                {
                    name: '📋 **Step-by-Step Guide**',
                    value: instructions.steps.join('\n'),
                    inline: false
                },
                {
                    name: '💡 **Tips for Best Experience**',
                    value: '• Use full screen mode\n• Ensure good internet connection\n• Coordinate start time in voice chat\n• Use Discord\'s video quality settings',
                    inline: false
                }
            ])
            .setFooter({ text: '🎬 Perfect for music video watch parties!' });

        await interaction.reply({ embeds: [embed], ephemeral: true });
    }

    async handleVideoCacheCommand(interaction, musicManager) {
        if (!musicManager.currentTrack || musicManager.currentTrack.source !== 'youtube') {
            return await interaction.reply({ 
                content: '❌ Can only cache YouTube videos!', 
                ephemeral: true 
            });
        }

        const track = musicManager.currentTrack;
        
        await interaction.reply({ 
            content: '💾 Caching video... This may take a moment!', 
            ephemeral: true 
        });

        try {
            const cachedPath = await this.videoHandler.cacheVideo(track, 'lowest'); // Use lowest quality for Discord file size limits
            const sendResult = await this.videoHandler.sendVideoFile(cachedPath);
            
            if (sendResult.canSend) {
                const { AttachmentBuilder } = require('discord.js');
                const attachment = new AttachmentBuilder(sendResult.filePath, { 
                    name: `${track.title.replace(/[^a-zA-Z0-9]/g, '_')}.mp4` 
                });
                
                await interaction.followUp({ 
                    content: `📺 **${track.title}** (${sendResult.size})\n💡 You can download and play this video locally!`,
                    files: [attachment],
                    ephemeral: true 
                });
                
                console.log(`✅ Video sent to user: ${sendResult.size}`);
            } else {
                await interaction.followUp({ 
                    content: `❌ Cannot send video: ${sendResult.reason}\n📊 Size: ${sendResult.size}\n🔗 Use Local Player instead!`,
                    ephemeral: true 
                });
            }
        } catch (error) {
            console.error('Video cache error:', error);
            await interaction.followUp({ 
                content: '❌ Failed to cache video. Try the Local Player option instead!', 
                ephemeral: true 
            });
        }
    }

    async handleLocalPlayerCommand(interaction, musicManager) {
        if (!musicManager.currentTrack || musicManager.currentTrack.source !== 'youtube') {
            return await interaction.reply({ 
                content: '❌ Local player only supports YouTube videos!', 
                ephemeral: true 
            });
        }

        const track = musicManager.currentTrack;
        const serverUrl = this.localVideoServer.getServerUrl();
        const videoUrl = `${serverUrl}/play/${track.id}`;
        
        const embed = new EmbedBuilder()
            .setTitle('🖥️ Local Video Player')
            .setDescription(`**${track.title}**\nBy: ${track.author}`)
            .setColor(config.colors.success)
            .setThumbnail(track.thumbnail)
            .addFields([
                { name: '🌐 Local Player URL', value: `[Open Video Player](${videoUrl})`, inline: false },
                { name: '📺 Screen Share Steps', value: '1. Click the URL above\n2. In Discord, click screen share\n3. Share your browser window\n4. Use fullscreen for best experience', inline: false },
                { name: '💡 Pro Tip', value: 'The video will be cached automatically for smooth playback!', inline: false }
            ])
            .setFooter({ text: 'Perfect for Discord watch parties! 🍿' });

        const localButtons = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setLabel('Open Local Player')
                    .setURL(videoUrl)
                    .setStyle(ButtonStyle.Link)
                    .setEmoji('🖥️'),
                new ButtonBuilder()
                    .setLabel('Video Server Home')
                    .setURL(serverUrl)
                    .setStyle(ButtonStyle.Link)
                    .setEmoji('🏠')
            );

        await interaction.reply({ 
            embeds: [embed], 
            components: [localButtons],
            ephemeral: true 
        });
        
        // Pre-caching disabled for performance - caching will happen on-demand only
        console.log(`🎬 Video ready for local player (on-demand caching): ${track.title}`);
    }

    async handleAutoPlayCommand(interaction, musicManager) {
        const action = interaction.options.getString('action');
        
        switch (action) {
            case 'enable':
                musicManager.setAutoPlay(true);
                musicManager.setContinuousPlayback(true);
                
                const enableEmbed = this.createMusicEmbed(
                    '🤖 Auto-Play Enabled',
                    '✅ Smart auto-play is now active!\n🎵 Bot will continue playing music 24/7\n🧠 AI will find similar tracks when queue is empty',
                    config.colors.success
                );
                
                await interaction.reply({ embeds: [enableEmbed] });
                
                // Start filling queue immediately
                setTimeout(() => {
                    musicManager.fillQueueWithRecommendations(20, { 
                        userId: interaction.user.id, 
                        guildId: interaction.guild.id 
                    });
                }, 2000);
                break;
                
            case 'disable':
                musicManager.setAutoPlay(false);
                musicManager.setContinuousPlayback(false);
                
                const disableEmbed = this.createMusicEmbed(
                    '🤖 Auto-Play Disabled',
                    '❌ Smart auto-play is now inactive\n⏹️ Music will stop when queue is empty',
                    config.colors.warning
                );
                
                await interaction.reply({ embeds: [disableEmbed] });
                break;
                
            case 'status':
                const statusEmbed = new EmbedBuilder()
                    .setTitle('🤖 Auto-Play Status')
                    .setColor(config.colors.info)
                    .addFields([
                        { 
                            name: '🎵 Auto-Play', 
                            value: musicManager.autoPlayEnabled ? '✅ Enabled' : '❌ Disabled', 
                            inline: true 
                        },
                        { 
                            name: '🔄 Continuous Playback', 
                            value: musicManager.continuousPlayback ? '✅ Enabled' : '❌ Disabled', 
                            inline: true 
                        },
                        { 
                            name: '📊 Queue Length', 
                            value: `${musicManager.queue.length} tracks`, 
                            inline: true 
                        },
                        {
                            name: '🧠 How It Works',
                            value: '• AI analyzes your current music\n• Finds similar artists and genres\n• Considers time of day and mood\n• Never repeats recent tracks\n• Keeps music playing 24/7',
                            inline: false
                        }
                    ])
                    .setTimestamp();
                
                await interaction.reply({ embeds: [statusEmbed] });
                break;
                
            case 'fill':
                const fillCount = interaction.options.getInteger('count') || 10;
                
                await interaction.deferReply();
                
                await musicManager.fillQueueWithRecommendations(fillCount, { 
                    userId: interaction.user.id, 
                    guildId: interaction.guild.id 
                });
                
                const fillEmbed = this.createMusicEmbed(
                    '🎵 Queue Filled',
                    `Added ${fillCount} smart recommendations to the queue!\n🧠 Based on your music history and preferences`,
                    config.colors.success
                );
                
                await interaction.editReply({ embeds: [fillEmbed] });
                break;
        }
    }
    
    async handleClearCommand(interaction, musicManager, channelId) {
        const trackId = interaction.options.getString('id');
        
        if (musicManager.queue.length === 0) {
            return await interaction.reply({
                embeds: [this.createErrorEmbed('The queue is empty!')],
                ephemeral: true
            });
        }
        
        const result = musicManager.clearTrackFromQueue(trackId);
        
        if (!result.success) {
            return await interaction.reply({
                embeds: [this.createErrorEmbed(`Could not remove track: ${result.reason}`)],
                ephemeral: true
            });
        }
        
        const embed = this.createMusicEmbed(
            '🗑️ Track Removed from Queue',
            `**${result.track.title}**\nBy: ${result.track.author}\nRemoved from position ${result.position}\n\nQueue now has ${result.newQueueLength} tracks`,
            config.colors.warning
        );
        
        await interaction.reply({ 
            embeds: [embed],
            components: result.newQueueLength > 0 ? this.createMusicControls() : []
        });
        
        // Update any existing music panels
        await this.updateQueueState(interaction.guildId, channelId, musicManager);
    }

    async handleLyricsCommand(interaction, musicManager) {
        const query = interaction.options.getString('query');
        const searchType = interaction.options.getString('type') || 'song';

        await interaction.deferReply();

        try {
            if (searchType === 'lyrics') {
                // Search songs by lyrics fragment
                console.log(`🔍 Searching songs by lyrics: "${query}"`);
                const songs = await this.lyricsHandler.searchByLyrics(query, 5);

                if (songs.length === 0) {
                    return await interaction.editReply({
                        embeds: [this.createErrorEmbed('No songs found matching those lyrics!')]
                    });
                }

                // Create embed with search results
                const embed = new EmbedBuilder()
                    .setTitle('🎵 Songs Found by Lyrics')
                    .setDescription(`Found **${songs.length}** songs matching: "${query}"`)
                    .setColor(config.colors.music);

                songs.forEach((song, index) => {
                    embed.addFields({
                        name: `${index + 1}. ${song.title}`,
                        value: `**Artist:** ${song.artist}\n**Play:** \`/play ${song.title} ${song.artist}\``,
                        inline: false
                    });
                });

                // Create action row with buttons to play these songs
                const buttons = [];
                songs.slice(0, 3).forEach((song, index) => {
                    buttons.push(
                        new ButtonBuilder()
                            .setCustomId(`lyrics_play_${index}_${song.title.replace(/[^a-zA-Z0-9]/g, '').substring(0, 20)}_${song.artist.replace(/[^a-zA-Z0-9]/g, '').substring(0, 20)}`)
                            .setLabel(`Play Song ${index + 1}`)
                            .setStyle(ButtonStyle.Primary)
                            .setEmoji('🎵')
                    );
                });

                const actionRow = new ActionRowBuilder().addComponents(...buttons);

                await interaction.editReply({
                    embeds: [embed],
                    components: buttons.length > 0 ? [actionRow] : []
                });

            } else {
                // Get lyrics for a specific song
                console.log(`🎵 Getting lyrics for: "${query}"`);
                
                // Try to get lyrics for current playing song if no query and music is playing
                let songTitle = query;
                let artistName = '';
                
                if (!query && musicManager && musicManager.currentTrack) {
                    songTitle = musicManager.currentTrack.title;
                    artistName = musicManager.currentTrack.author;
                    console.log(`🎵 Using currently playing track: "${songTitle}" by "${artistName}"`);
                } else {
                    // Parse query for title and artist
                    const parts = query.split(' by ');
                    if (parts.length === 2) {
                        songTitle = parts[0].trim();
                        artistName = parts[1].trim();
                    } else {
                        // Try to split by common patterns
                        const dashSplit = query.split(' - ');
                        if (dashSplit.length === 2) {
                            artistName = dashSplit[0].trim();
                            songTitle = dashSplit[1].trim();
                        }
                    }
                }

                const lyricsResult = await this.lyricsHandler.getLyricsForSong(songTitle, artistName);

                if (!lyricsResult) {
                    return await interaction.editReply({
                        embeds: [this.createErrorEmbed(`Could not find lyrics for "${songTitle}"${artistName ? ` by ${artistName}` : ''}. Try being more specific or use \`/lyrics type:lyrics\` to search by lyrics fragment.`)]
                    });
                }

                // Format lyrics for Discord (max 4000 characters)
                const formattedLyrics = this.lyricsHandler.formatLyricsForDiscord(lyricsResult.lyrics);
                
                const embed = new EmbedBuilder()
                    .setTitle(`🎤 ${lyricsResult.title}`)
                    .setDescription(`**Artist:** ${lyricsResult.artist}\n\n${formattedLyrics}`)
                    .setColor(config.colors.music)
                    .setThumbnail(lyricsResult.thumbnail)
                    .setFooter({ text: `Source: ${lyricsResult.source} • ${lyricsResult.url}` });

                // Add play button if user wants to play this song
                const playButton = new ButtonBuilder()
                    .setCustomId(`lyrics_play_song_${lyricsResult.title.replace(/[^a-zA-Z0-9]/g, '').substring(0, 30)}_${lyricsResult.artist.replace(/[^a-zA-Z0-9]/g, '').substring(0, 30)}`)
                    .setLabel('Play This Song')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('🎵');

                const actionRow = new ActionRowBuilder().addComponents(playButton);

                await interaction.editReply({
                    embeds: [embed],
                    components: [actionRow]
                });
            }

        } catch (error) {
            console.error('❌ Lyrics command error:', error);
            await interaction.editReply({
                embeds: [this.createErrorEmbed(`Error getting lyrics: ${error.message}`)]
            });
        }
    }

    async registerCommands() {
        const commands = [
            new SlashCommandBuilder()
                .setName('play')
                .setDescription('Play music from various sources')
                .addStringOption(option =>
                    option.setName('query')
                        .setDescription('Song name, URL, or search query')
                        .setRequired(true)
                        .setAutocomplete(true)
                )
                .addBooleanOption(option =>
                    option.setName('fast')
                        .setDescription('Use fast mode with Discord Player (YouTube + Spotify only, default: true)')
                        .setRequired(false)
                ),
            new SlashCommandBuilder()
                .setName('clear')
                .setDescription('Remove a specific track from the queue')
                .addStringOption(option =>
                    option.setName('id')
                        .setDescription('Track ID to remove from queue')
                        .setRequired(true)
                        .setAutocomplete(true)
                ),
            new SlashCommandBuilder()
                .setName('search')
                .setDescription('Search for music')
                .addStringOption(option =>
                    option.setName('query')
                        .setDescription('Search query')
                        .setRequired(true)
                        .setAutocomplete(true)
                ),
            new SlashCommandBuilder()
                .setName('queue')
                .setDescription('Show the current music queue'),
            new SlashCommandBuilder()
                .setName('skip')
                .setDescription('Skip the current track'),
            new SlashCommandBuilder()
                .setName('stop')
                .setDescription('Stop the music and clear queue'),
            new SlashCommandBuilder()
                .setName('pause')
                .setDescription('Pause the current track'),
            new SlashCommandBuilder()
                .setName('resume')
                .setDescription('Resume the current track'),
            new SlashCommandBuilder()
                .setName('volume')
                .setDescription('Set the volume')
                .addIntegerOption(option =>
                    option.setName('level')
                        .setDescription('Volume level (0-100)')
                        .setRequired(true)
                ),
            new SlashCommandBuilder()
                .setName('shuffle')
                .setDescription('Shuffle the queue'),
            new SlashCommandBuilder()
                .setName('loop')
                .setDescription('Toggle loop mode')
                .addStringOption(option =>
                    option.setName('mode')
                        .setDescription('Loop mode')
                        .addChoices(
                            { name: 'Off', value: 'off' },
                            { name: 'Track', value: 'track' },
                            { name: 'Queue', value: 'queue' }
                        )
                ),
            new SlashCommandBuilder()
                .setName('nowplaying')
                .setDescription('Show the currently playing track'),
            new SlashCommandBuilder()
                .setName('join')
                .setDescription('Join your voice channel'),
            new SlashCommandBuilder()
                .setName('leave')
                .setDescription('Leave the voice channel'),
            new SlashCommandBuilder()
                .setName('help')
                .setDescription('Show all available commands and features'),
            new SlashCommandBuilder()
                .setName('playlist')
                .setDescription('Manage your playlists')
                .addSubcommand(subcommand =>
                    subcommand
                        .setName('create')
                        .setDescription('Create a new playlist')
                        .addStringOption(option =>
                            option.setName('name')
                                .setDescription('Playlist name')
                                .setRequired(true))
                        .addStringOption(option =>
                            option.setName('description')
                                .setDescription('Playlist description')
                                .setRequired(false))
                        .addBooleanOption(option =>
                            option.setName('public')
                                .setDescription('Make playlist public')
                                .setRequired(false)))
                .addSubcommand(subcommand =>
                    subcommand
                        .setName('list')
                        .setDescription('Show your playlists'))
                .addSubcommand(subcommand =>
                    subcommand
                        .setName('play')
                        .setDescription('Play a playlist')
                        .addStringOption(option =>
                            option.setName('name')
                                .setDescription('Playlist name or ID')
                                .setRequired(true)
                                .setAutocomplete(true)))
                .addSubcommand(subcommand =>
                    subcommand
                        .setName('add')
                        .setDescription('Add current track to playlist')
                        .addStringOption(option =>
                            option.setName('playlist')
                                .setDescription('Playlist name')
                                .setRequired(true)
                                .setAutocomplete(true)))
                .addSubcommand(subcommand =>
                    subcommand
                        .setName('remove')
                        .setDescription('Remove track from playlist')
                        .addStringOption(option =>
                            option.setName('playlist')
                                .setDescription('Playlist name')
                                .setRequired(true)
                                .setAutocomplete(true))
                        .addIntegerOption(option =>
                            option.setName('track')
                                .setDescription('Track number to remove')
                                .setRequired(true)))
                .addSubcommand(subcommand =>
                    subcommand
                        .setName('delete')
                        .setDescription('Delete a playlist')
                        .addStringOption(option =>
                            option.setName('name')
                                .setDescription('Playlist name')
                                .setRequired(true)
                                .setAutocomplete(true)))
                .addSubcommand(subcommand =>
                    subcommand
                        .setName('import')
                        .setDescription('Import playlist from URL')
                        .addStringOption(option =>
                            option.setName('url')
                                .setDescription('Spotify or YouTube playlist URL')
                                .setRequired(true))
                        .addStringOption(option =>
                            option.setName('name')
                                .setDescription('Custom playlist name')
                                .setRequired(false))),
            new SlashCommandBuilder()
                .setName('video')
                .setDescription('Get video information for the current track'),
            new SlashCommandBuilder()
                .setName('autoplay')
                .setDescription('Control smart auto-play and continuous music')
                .addStringOption(option =>
                    option.setName('action')
                        .setDescription('Auto-play action')
                        .setRequired(true)
                        .addChoices(
                            { name: 'Enable 24/7 Auto-Play', value: 'enable' },
                            { name: 'Disable Auto-Play', value: 'disable' },
                            { name: 'Check Status', value: 'status' },
                            { name: 'Fill Queue with Recommendations', value: 'fill' }
                        )
                )
                .addIntegerOption(option =>
                    option.setName('count')
                        .setDescription('Number of recommendations to add (for fill action)')
                        .setMinValue(1)
                        .setMaxValue(50)
                ),
            new SlashCommandBuilder()
                .setName('lyrics')
                .setDescription('Get lyrics for a song or search songs by lyrics')
                .addStringOption(option =>
                    option.setName('query')
                        .setDescription('Song name/artist or lyrics fragment to search')
                        .setRequired(true)
                        .setAutocomplete(true)
                )
                .addStringOption(option =>
                    option.setName('type')
                        .setDescription('Search type')
                        .setRequired(false)
                        .addChoices(
                            { name: 'Get lyrics for song', value: 'song' },
                            { name: 'Search by lyrics', value: 'lyrics' }
                        )
                ),
            new SlashCommandBuilder()
                .setName('tts')
                .setDescription('Speak text in your voice channel (requires discord-player-tts)')
                .addStringOption(option =>
                    option.setName('text')
                        .setDescription('What to say')
                        .setRequired(true)
                )
                .addStringOption(option =>
                    option.setName('voice')
                        .setDescription('Voice/language code (e.g., en, en-US, es, fr)')
                        .setRequired(false)
                )
        ].map(command => command.toJSON());

        const rest = new REST({ version: '10' }).setToken(config.token);

        try {
            console.log('🔄 Refreshing slash commands...');
            await rest.put(Routes.applicationCommands(config.clientId), { body: commands });
            console.log('✅ Slash commands registered successfully!');
        } catch (error) {
            console.error('❌ Error registering commands:', error);
        }
    }

    async handleTTSCommand(interaction) {
        const member = interaction.member;
        const voiceChannel = member?.voice?.channel;
        if (!voiceChannel) {
            return await interaction.reply({
                embeds: [this.createErrorEmbed('You need to be in a voice channel to use TTS!')],
                ephemeral: true
            });
        }

        const text = interaction.options.getString('text', true);
        const voice = interaction.options.getString('voice') || 'en';

        try {
            await this.discordPlayer.tts(interaction, text, { voice });
        } catch (e) {
            console.error('TTS command error:', e);
            try {
                await interaction.editReply({ content: '❌ TTS failed. Ensure discord-player-tts is installed.' });
            } catch (_) {}
        }
    }

    handleVoiceStateUpdate(oldState, newState) {
        // Handle bot leaving/joining channels
        if (newState.member.user.bot && newState.member.user.id === this.client.user.id) {
            const guildId = newState.guild.id;
            
            // Bot left a channel
            if (oldState.channelId && !newState.channelId) {
                console.log(`🔌 Bot left voice channel ${oldState.channelId}`);
                this.cleanupChannel(oldState.channelId, guildId);
                return;
            }
            
            // Bot joined a new channel
            if (!oldState.channelId && newState.channelId) {
                console.log(`🔌 Bot joined voice channel ${newState.channelId}`);
                if (!this.guildChannels.has(guildId)) {
                    this.guildChannels.set(guildId, new Set());
                }
                this.guildChannels.get(guildId).add(newState.channelId);
                return;
            }
            
            // Bot switched channels
            if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
                console.log(`🔄 Bot switched from channel ${oldState.channelId} to ${newState.channelId}`);
                this.cleanupChannel(oldState.channelId, guildId);
                if (!this.guildChannels.has(guildId)) {
                    this.guildChannels.set(guildId, new Set());
                }
                this.guildChannels.get(guildId).add(newState.channelId);
                return;
            }
        }
        
        // Handle regular user voice state changes for existing music managers
        const activeChannels = this.guildChannels.get(oldState.guild.id);
        if (activeChannels) {
            for (const channelId of activeChannels) {
                const musicManager = this.musicManagers.get(channelId);
                if (musicManager && oldState.channelId && !newState.channelId && newState.member.user.bot) {
                    musicManager.handleDisconnect();
                }
            }
        }

        if (!config.settings.stayInChannel) return;

        const voiceChannel = oldState.channel || newState.channel;
        if (!voiceChannel) return;

        const connection = getVoiceConnection(oldState.guild.id);
        if (!connection) return;

        const botMember = oldState.guild.members.cache.get(this.client.user.id);
        if (!botMember.voice.channelId) return;

        const membersInChannel = voiceChannel.members.filter(member => !member.user.bot);
        
        if (membersInChannel.size === 0 && config.settings.stayInChannel) {
            setTimeout(() => {
                const updatedChannel = this.client.channels.cache.get(voiceChannel.id);
                const updatedMembers = updatedChannel?.members.filter(member => !member.user.bot);
                
                if (!updatedMembers || updatedMembers.size === 0) {
                    const musicManager = this.musicManagers.get(voiceChannel.id);
                    if (musicManager) {
                        musicManager.pause();
                    }
                }
            }, 30000);
        }
    }

    async reconnectToChannels() {
        for (const [channelId, musicManager] of this.musicManagers) {
            if (musicManager.lastChannel) {
                try {
                    const channel = this.client.channels.cache.get(musicManager.lastChannel);
                    if (channel) {
                        const connection = await this.connectToVoiceChannel(channel, musicManager.guildId);
                        musicManager.setConnection(connection);
                        if (!this.guildChannels.has(musicManager.guildId)) {
                            this.guildChannels.set(musicManager.guildId, new Set());
                        }
                        this.guildChannels.get(musicManager.guildId).add(channelId);
                    }
                } catch (error) {
                    console.error(`Failed to reconnect to channel ${channelId}:`, error);
                }
            }
        }
    }

    async handlePlaylistCommand(interaction, musicManager) {
        const subcommand = interaction.options.getSubcommand();
        
        try {
            switch (subcommand) {
                case 'create':
                    await this.handlePlaylistCreate(interaction);
                    break;
                case 'list':
                    await this.handlePlaylistList(interaction);
                    break;
                case 'play':
                    await this.handlePlaylistPlay(interaction, musicManager);
                    break;
                case 'add':
                    await this.handlePlaylistAdd(interaction, musicManager);
                    break;
                case 'remove':
                    await this.handlePlaylistRemove(interaction);
                    break;
                case 'delete':
                    await this.handlePlaylistDelete(interaction);
                    break;
                case 'import':
                    await this.handlePlaylistImport(interaction);
                    break;
                default:
                    await interaction.reply({ content: '❌ Unknown playlist command!', ephemeral: true });
            }
        } catch (error) {
            const errorType = ErrorHandler.detectErrorType(error);
            await this.errorHandler.handleError(interaction, errorType, error, {
                guildId: interaction.guildId,
                userId: interaction.user.id
            });
        }
    }

    async handlePlaylistCreate(interaction) {
        const name = interaction.options.getString('name');
        const description = interaction.options.getString('description') || '';
        const isPublic = interaction.options.getBoolean('public') || false;
        
        await interaction.deferReply();
        
        const playlist = await this.playlistManager.createPlaylist(
            interaction.user.id, 
            name, 
            description, 
            isPublic
        );
        
        const embed = this.createMusicEmbed(
            '📝 Playlist Created',
            `**${playlist.name}**\n${playlist.description}\n\nVisibility: ${isPublic ? 'Public' : 'Private'}\nTracks: 0`,
            config.colors.success
        );
        
        await interaction.editReply({ embeds: [embed] });
    }

    async handlePlaylistList(interaction) {
        await interaction.deferReply();
        
        const playlists = await this.playlistManager.getUserPlaylists(interaction.user.id);
        
        if (playlists.length === 0) {
            const embed = this.createErrorEmbed('No playlists found! Use `/playlist create` to make your first playlist.');
            return await interaction.editReply({ embeds: [embed] });
        }
        
        const embed = new EmbedBuilder()
            .setTitle('📋 Your Playlists')
            .setColor(config.colors.info)
            .setTimestamp();
        
        const playlistList = playlists.map((p, index) => 
            `**${index + 1}.** ${p.name}\n` +
            `   📊 ${p.tracks.length} tracks • ${this.playlistManager.formatDuration(p.duration)}\n` +
            `   ${p.isPublic ? '🌐 Public' : '🔒 Private'} • Updated ${new Date(p.updatedAt).toLocaleDateString()}`
        ).join('\n\n');
        
        embed.setDescription(playlistList.length > 2000 ? playlistList.substring(0, 2000) + '...' : playlistList);
        embed.setFooter({ text: `Total: ${playlists.length} playlists` });
        
        await interaction.editReply({ embeds: [embed] });
    }

    async handlePlaylistPlay(interaction, musicManager) {
        const playlistName = interaction.options.getString('name');
        await interaction.deferReply();
        
        const playlists = await this.playlistManager.getUserPlaylists(interaction.user.id);
        const playlist = playlists.find(p => 
            p.name.toLowerCase().includes(playlistName.toLowerCase()) || 
            p.id === playlistName
        );
        
        if (!playlist) {
            const embed = this.createErrorEmbed('Playlist not found!');
            return await interaction.editReply({ embeds: [embed] });
        }
        
        if (playlist.tracks.length === 0) {
            const embed = this.createErrorEmbed('Playlist is empty!');
            return await interaction.editReply({ embeds: [embed] });
        }
        
        // Connect to voice if needed
        const member = interaction.member;
        if (!member.voice.channel) {
            const embed = this.createErrorEmbed('You need to be in a voice channel!');
            return await interaction.editReply({ embeds: [embed] });
        }
        
        const connection = await this.connectToVoiceChannel(member.voice.channel, interaction.guildId);
        musicManager.setConnection(connection);
        
        // Add all tracks to queue
        for (const track of playlist.tracks) {
            await musicManager.addToQueue(track, -1, { 
                userId: interaction.user.id, 
                guildId: interaction.guild.id 
            });
        }
        
        // Increment play count
        await this.playlistManager.incrementPlayCount(playlist.id);
        
        const embed = this.createMusicEmbed(
            '📋 Playlist Added to Queue',
            `**${playlist.name}**\nAdded ${playlist.tracks.length} tracks to queue\nTotal duration: ${this.playlistManager.formatDuration(playlist.duration)}`,
            config.colors.success
        );
        
        await interaction.editReply({ 
            embeds: [embed],
            components: [this.createMusicControls()]
        });
        
        if (!musicManager.isPlaying) {
            await musicManager.play();
        }
    }

    async handlePlaylistAdd(interaction, musicManager) {
        const playlistName = interaction.options.getString('playlist');
        
        if (!musicManager.currentTrack) {
            const embed = this.createErrorEmbed('No track is currently playing!');
            return await interaction.reply({ embeds: [embed], ephemeral: true });
        }
        
        await interaction.deferReply();
        
        const playlists = await this.playlistManager.getUserPlaylists(interaction.user.id);
        const playlist = playlists.find(p => 
            p.name.toLowerCase().includes(playlistName.toLowerCase())
        );
        
        if (!playlist) {
            const embed = this.createErrorEmbed('Playlist not found!');
            return await interaction.editReply({ embeds: [embed] });
        }
        
        await this.playlistManager.addTrackToPlaylist(
            playlist.id, 
            musicManager.currentTrack, 
            interaction.user.id
        );
        
        const embed = this.createMusicEmbed(
            '➕ Track Added to Playlist',
            `**${musicManager.currentTrack.title}**\nby ${musicManager.currentTrack.author}\n\nAdded to: **${playlist.name}**`,
            config.colors.success
        );
        
        await interaction.editReply({ embeds: [embed] });
    }

    async handlePlaylistRemove(interaction) {
        const playlistName = interaction.options.getString('playlist');
        const trackIndex = interaction.options.getInteger('track') - 1; // Convert to 0-based
        
        await interaction.deferReply();
        
        const playlists = await this.playlistManager.getUserPlaylists(interaction.user.id);
        const playlist = playlists.find(p => 
            p.name.toLowerCase().includes(playlistName.toLowerCase())
        );
        
        if (!playlist) {
            const embed = this.createErrorEmbed('Playlist not found!');
            return await interaction.editReply({ embeds: [embed] });
        }
        
        const updatedPlaylist = await this.playlistManager.removeTrackFromPlaylist(
            playlist.id,
            trackIndex,
            interaction.user.id
        );
        
        const embed = this.createMusicEmbed(
            '➖ Track Removed',
            `Track #${trackIndex + 1} removed from **${updatedPlaylist.name}**\nRemaining tracks: ${updatedPlaylist.tracks.length}`,
            config.colors.warning
        );
        
        await interaction.editReply({ embeds: [embed] });
    }

    async handlePlaylistDelete(interaction) {
        const playlistName = interaction.options.getString('name');
        
        await interaction.deferReply();
        
        const playlists = await this.playlistManager.getUserPlaylists(interaction.user.id);
        const playlist = playlists.find(p => 
            p.name.toLowerCase().includes(playlistName.toLowerCase())
        );
        
        if (!playlist) {
            const embed = this.createErrorEmbed('Playlist not found!');
            return await interaction.editReply({ embeds: [embed] });
        }
        
        await this.playlistManager.deletePlaylist(playlist.id, interaction.user.id);
        
        const embed = this.createMusicEmbed(
            '🗑️ Playlist Deleted',
            `**${playlist.name}** has been permanently deleted.`,
            config.colors.warning
        );
        
        await interaction.editReply({ embeds: [embed] });
    }

    async handlePlaylistImport(interaction) {
        const url = interaction.options.getString('url');
        const customName = interaction.options.getString('name');
        
        await interaction.deferReply();
        
        const playlist = await this.playlistManager.importPlaylistFromUrl(
            interaction.user.id,
            url,
            customName,
            this.sourceHandlers
        );
        
        const embed = this.createMusicEmbed(
            '📥 Playlist Imported',
            `**${playlist.name}**\n${playlist.description}\n\nImported ${playlist.tracks.length} tracks\nDuration: ${this.playlistManager.formatDuration(playlist.duration)}`,
            config.colors.success
        );
        
        await interaction.editReply({ embeds: [embed] });
    }

    async handleAutocomplete(interaction) {
        const { commandName, options } = interaction;
        
        // Check if interaction is still valid
        if (interaction.replied || interaction.deferred) {
            console.log('⚠️ Autocomplete interaction already acknowledged, skipping...');
            return;
        }
        
        if (commandName === 'play' || commandName === 'search') {
            try {
                const focusedValue = options.getFocused();
                
                if (focusedValue.length < 2) {
                    // Show popular/trending suggestions for short queries
                    const suggestions = [
                        'Drake - God\'s Plan',
                        'Ed Sheeran - Shape of You',
                        'The Weeknd - Blinding Lights',
                        'Post Malone - Circles',
                        'Billie Eilish - bad guy'
                    ];
                    
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.respond(
                            suggestions.map(title => ({ 
                                name: title, 
                                value: title 
                            })).slice(0, 25)
                        );
                    }
                    return;
                }
                
                // Get search suggestions based on input
                const suggestions = await this.getSearchSuggestions(focusedValue);
                
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.respond(
                        suggestions.map(track => ({
                            name: `${track.title} - ${track.author}`.substring(0, 100),
                            value: (track.searchQuery || `${track.title} ${track.author}`).substring(0, 100)
                        })).slice(0, 25)
                    );
                }
                
            } catch (error) {
                // Silently handle expired autocomplete interactions
                if (error.code !== 10062) {
                    console.error('Autocomplete error:', error.message);
                }
            }
        } else if (commandName === 'clear') {
            try {
                const member = interaction.member;
                const voiceChannelId = member?.voice?.channel?.id;
                
                if (!voiceChannelId) {
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.respond([]);
                    }
                    return;
                }
                
                const musicManager = this.getMusicManager(interaction.guildId, voiceChannelId);
                const focusedValue = options.getFocused();
                
                if (musicManager.queue.length === 0) {
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.respond([]);
                    }
                    return;
                }
                
                // Filter tracks based on the focused value and show track info with IDs
                const matches = musicManager.queue.filter(track => 
                    track.title.toLowerCase().includes(focusedValue.toLowerCase()) ||
                    track.author.toLowerCase().includes(focusedValue.toLowerCase()) ||
                    track.id.includes(focusedValue)
                ).slice(0, 25);
                
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.respond(
                        matches.map(track => ({
                            name: `${track.title} - ${track.author}`.substring(0, 100),
                            value: track.id
                        }))
                    );
                }
                
            } catch (error) {
                console.error('Clear autocomplete error:', error);
                try {
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.respond([]);
                    }
                } catch (respondError) {
                    console.error('Failed to send clear error response:', respondError);
                }
            }
        }
    }

    async getSearchSuggestions(query) {
        try {
            // Quick search to get suggestions
            const results = await this.sourceHandlers.search(query, 10);
            
            return results.map(track => ({
                title: track.title,
                author: track.author,
                searchQuery: `${track.title} ${track.author}`,
                source: track.source
            }));
            
        } catch (error) {
            // Fallback to cached suggestions or popular tracks
            return [
                { title: query, author: 'Search for this', searchQuery: query, source: 'search' }
            ];
        }
    }

    cleanupDebugFiles() {
        try {
            const fs = require('fs');
            const path = require('path');
            const projectRoot = __dirname;
            
            // Remove any HTML debug files created by ytdl
            const files = fs.readdirSync(projectRoot);
            let cleanedCount = 0;
            files.forEach(file => {
                if (file.match(/^\d+-watch\.html$/)) {
                    fs.unlinkSync(path.join(projectRoot, file));
                    cleanedCount++;
                }
            });
            
            if (cleanedCount > 0) {
                console.log(`🗑️ Cleaned ${cleanedCount} debug HTML files`);
            }
            
            // Set up periodic cleanup every 5 minutes
            setInterval(() => {
                try {
                    const currentFiles = fs.readdirSync(projectRoot);
                    let periodicCleaned = 0;
                    currentFiles.forEach(file => {
                        if (file.match(/^\d+-watch\.html$/)) {
                            fs.unlinkSync(path.join(projectRoot, file));
                            periodicCleaned++;
                        }
                    });
                    if (periodicCleaned > 0) {
                        console.log(`🗑️ Periodic cleanup: removed ${periodicCleaned} HTML files`);
                    }
                } catch (e) {
                    // Ignore cleanup errors
                }
            }, 5 * 60 * 1000); // Every 5 minutes
            
        } catch (error) {
            // Silently ignore cleanup errors
        }
    }
    
    cleanupChannel(channelId, guildId) {
        console.log(`🧹 Cleaning up channel ${channelId} (guild ${guildId})`);
        
        // Clean up music manager for this channel
        const musicManager = this.musicManagers.get(channelId);
        if (musicManager) {
            musicManager.stop();
            musicManager.clearQueue();
            this.musicManagers.delete(channelId);
        }
        
        // Clean up music panel for this channel
        this.musicPanels.delete(channelId);
        
        // Clean up text channel mapping
        this.musicTextChannels.delete(channelId);
        
        // Update guild channel tracking
        const activeChannels = this.guildChannels.get(guildId);
        if (activeChannels) {
            activeChannels.delete(channelId);
            // If no more active channels, remove the guild entry
            if (activeChannels.size === 0) {
                this.guildChannels.delete(guildId);
            }
        }
        
        console.log(`✅ Channel cleanup completed for ${channelId}`);
    }
    
    async updateQueueState(guildId, channelId, musicManager) {
        // Update any existing music panels with new queue state
        const panelInfo = this.musicPanels.get(channelId);
        if (panelInfo && panelInfo.message) {
            try {
                const queueInfo = musicManager.getQueueInfo();
                const currentTrack = musicManager.currentTrack;
                
                if (currentTrack) {
                    const embed = this.createMusicEmbed(
                        '🎵 Now Playing',
                        `**${currentTrack.title}**\nBy: ${currentTrack.author}\nDuration: ${currentTrack.duration}\nSource: ${currentTrack.source.toUpperCase()}`,
                        config.colors.success,
                        currentTrack.thumbnail
                    );
                    
                    embed.addFields([
                        { name: 'Queue Position', value: `${queueInfo.currentIndex + 1} of ${queueInfo.queue.length}`, inline: true },
                        { name: 'Volume', value: `${musicManager.volume}%`, inline: true },
                        { name: 'Loop', value: String(musicManager.loopMode || 'off'), inline: true }
                    ]);
                    
                    await panelInfo.message.edit({
                        embeds: [embed],
                        components: this.createMusicControls(musicManager.isPlaying, musicManager.isPaused)
                    });
                } else if (queueInfo.queue.length === 0) {
                    const embed = this.createMusicEmbed(
                        '🎵 Queue Empty',
                        'Use `/play` to queue your next song!',
                        config.colors.info
                    );
                    
                    await panelInfo.message.edit({ 
                        embeds: [embed], 
                        components: [] 
                    });
                }
            } catch (error) {
                console.log('❌ Failed to update queue state in panel:', error.message);
            }
        }
    }
    
    async handleQueueUpdate(guildId, channelId, queueInfo) {
        // Update any existing music panels with new queue information
        await this.updateQueueState(guildId, channelId, this.getMusicManager(guildId, channelId));
    }

    async start() {
        try {
            await this.client.login(config.token);
        } catch (error) {
            console.error('❌ Failed to start bot:', error);
            process.exit(1);
        }
    }
}

const bot = new AtiveMusicBot();
bot.start();

process.on('unhandledRejection', (error) => {
    console.error('Unhandled promise rejection:', error);
});

process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down bot...');
    bot.client.destroy();
    process.exit(0);
});
