// Disable ytdl debug HTML files for performance
process.env.YTDL_NO_UPDATE = 'true';
process.env.DEBUG = '';

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

class AtiveMusicBot {
    constructor() {
        this.client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildVoiceStates
            ]
        });

        this.musicManagers = new Map();
        this.sourceHandlers = new SourceHandlers();
        this.stayConnectedManager = new StayConnectedManager(this.client);
        this.videoHandler = new VideoHandler();
        this.localVideoServer = new LocalVideoServer(3000);
        this.errorHandler = new ErrorHandler();
        this.playlistManager = new PlaylistManager();
        this.searchCache = new Map();
        this.musicPanels = new Map(); // Track music control panels by guild ID
        
        this.setupEventListeners();
        this.registerCommands();
    }

    setupEventListeners() {
        this.client.once('clientReady', async () => {
            console.log(`🎵 ${this.client.user.tag} is online!`);
            console.log(`🎶 Serving music in ${this.client.guilds.cache.size} servers`);
            
            // Clean up any debug HTML files on startup
            this.cleanupDebugFiles();
            
            this.client.user.setActivity('🎵 Ative Music | /play', { type: 'LISTENING' });
            
            // Start local video server
            try {
                const serverUrl = await this.localVideoServer.start();
                console.log(`📺 Video server started: ${serverUrl}`.magenta);
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
                await this.handleButtonInteraction(interaction);
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

    getMusicManager(guildId) {
        if (!this.musicManagers.has(guildId)) {
            const musicManager = new MusicManager(guildId, this.sourceHandlers);
            
            // Set up event callbacks for panel management
            musicManager.onTrackStart = (track) => {
                this.handleTrackStart(guildId, track);
            };
            
            musicManager.onTrackEnd = (track) => {
                this.handleTrackEnd(guildId, track);
            };
            
            this.musicManagers.set(guildId, musicManager);
        }
        return this.musicManagers.get(guildId);
    }

    async handleTrackStart(guildId, track) {
        console.log(`🎵 Track started in guild ${guildId}: ${track.title}`);
        
        // Find the appropriate channel to send the panel
        const guild = this.client.guilds.cache.get(guildId);
        if (!guild) return;
        
        // Try to find the last channel where music was used, or use a general channel
        const panelInfo = this.musicPanels.get(guildId);
        let channel = null;
        
        if (panelInfo) {
            channel = guild.channels.cache.get(panelInfo.channelId);
        }
        
        if (!channel) {
            // Find a general/music channel or use the first text channel
            channel = guild.channels.cache.find(ch => 
                ch.name.includes('music') || 
                ch.name.includes('bot') || 
                ch.name.includes('general')
            ) || guild.channels.cache.find(ch => ch.type === 0); // 0 = GUILD_TEXT
        }
        
        if (channel) {
            await this.sendNewMusicPanel(channel, track, true, false);
        }
    }

    async handleTrackEnd(guildId, track) {
        console.log(`🎵 Track ended in guild ${guildId}: ${track.title}`);
        // The panel will be replaced when the next track starts
        // or can be manually controlled by users via buttons
    }

    updatePanelReference(guildId, track) {
        const panelInfo = this.musicPanels.get(guildId);
        if (panelInfo) {
            panelInfo.track = track;
            this.musicPanels.set(guildId, panelInfo);
        }
    }

    async handleSlashCommand(interaction) {
        const musicManager = this.getMusicManager(interaction.guildId);
        
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
                await this.handleSkipCommand(interaction, musicManager);
                break;
            case 'stop':
                await this.handleStopCommand(interaction, musicManager);
                break;
            case 'pause':
                await this.handlePauseCommand(interaction, musicManager);
                break;
            case 'resume':
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
        }
    }

    async handlePlayCommand(interaction, musicManager) {
        const query = interaction.options.getString('query');
        const member = interaction.member;
        
        if (!member.voice.channel) {
            return await interaction.reply({
                embeds: [this.createErrorEmbed('You need to be in a voice channel to play music!')],
                ephemeral: true
            });
        }

        await interaction.deferReply();

        try {
            const connection = await this.connectToVoiceChannel(member.voice.channel, interaction.guildId);
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

            await musicManager.addToQueue(selectedTrack);

            // Store channel info for panel management  
            const panelInfo = this.musicPanels.get(interaction.guildId);
            if (!panelInfo || panelInfo.channelId !== interaction.channelId) {
                // Update or set the channel for future panels, keeping existing message if available
                this.musicPanels.set(interaction.guildId, {
                    message: panelInfo?.message || null,
                    channelId: interaction.channelId,
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
            return connection;
        } catch (error) {
            connection.destroy();
            throw error;
        }
    }

    createMusicEmbed(title, description, color, thumbnail = null) {
        const embed = new EmbedBuilder()
            .setTitle(title)
            .setDescription(description)
            .setColor(color)
            .setTimestamp();
            
        if (thumbnail) {
            embed.setThumbnail(thumbnail);
        }
        
        return embed;
    }

    createErrorEmbed(message) {
        return new EmbedBuilder()
            .setTitle('❌ Error')
            .setDescription(message)
            .setColor(config.colors.error)
            .setTimestamp();
    }

    createMusicControls(isPlaying = true, isPaused = false) {
        const row1 = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('music_previous')
                    .setLabel('Previous')
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId(isPaused ? 'music_resume' : 'music_pause')
                    .setLabel(isPaused ? 'Resume' : 'Pause')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId('music_stop')
                    .setLabel('Stop')
                    .setStyle(ButtonStyle.Danger),
                new ButtonBuilder()
                    .setCustomId('music_skip')
                    .setLabel('Skip')
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId('music_shuffle')
                    .setLabel('Shuffle')
                    .setStyle(ButtonStyle.Success)
            );
            
        const row2 = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('music_repeat')
                    .setLabel('Repeat')
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId('music_volume_down')
                    .setLabel('Vol -')
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId('music_volume_up')
                    .setLabel('Vol +')
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId('music_queue')
                    .setLabel('Queue')
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId('music_clear_queue')
                    .setLabel('Clear Queue')
                    .setStyle(ButtonStyle.Danger)
            );
            
        return [row1, row2];
    }

    async updateMusicPanel(guildId, track, isPlaying = true, isPaused = false) {
        const panelInfo = this.musicPanels.get(guildId);
        if (!panelInfo) return;

        const embed = this.createMusicEmbed(
            '🎵 Now Playing',
            `**${track.title}**\nBy: ${track.author}\nDuration: ${track.duration}\nSource: ${track.source.toUpperCase()}`,
            config.colors.success,
            track.thumbnail
        );

        try {
            await panelInfo.message.edit({
                embeds: [embed],
                components: this.createMusicControls(isPlaying, isPaused)
            });
        } catch (error) {
            console.log('❌ Failed to update music panel:', error.message);
            // Remove invalid panel reference
            this.musicPanels.delete(guildId);
        }
    }

    async deletePreviousPanel(guildId) {
        const panelInfo = this.musicPanels.get(guildId);
        if (panelInfo && panelInfo.message) {
            try {
                await panelInfo.message.delete();
                console.log('🗑️ Deleted previous music panel');
            } catch (error) {
                console.log('⚠️ Could not delete previous panel:', error.message);
            }
        }
        // Always clean up the panel reference, even if deletion failed
        this.musicPanels.delete(guildId);
    }

    async sendNewMusicPanel(channel, track, isPlaying = true, isPaused = false) {
        const guildId = channel.guild.id;
        
        // Delete previous panel first
        await this.deletePreviousPanel(guildId);

        const embed = this.createMusicEmbed(
            '🎵 Now Playing',
            `**${track.title}**\nBy: ${track.author}\nDuration: ${track.duration}\nSource: ${track.source.toUpperCase()}`,
            config.colors.success,
            track.thumbnail
        );

        try {
            const message = await channel.send({
                embeds: [embed],
                components: this.createMusicControls(isPlaying, isPaused)
            });

            // Store new panel reference
            this.musicPanels.set(guildId, {
                message: message,
                channelId: channel.id,
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
            const musicManager = this.getMusicManager(interaction.guildId);
            
            // Check if interaction is still valid (not expired)
            if (interaction.deferred || interaction.replied) {
                console.log('⚠️ Interaction already handled, skipping...');
                return;
            }
            
            switch (interaction.customId) {
            case 'music_pause':
                if (musicManager.pause()) {
                    const track = musicManager.currentTrack;
                    const queueInfo = musicManager.getQueueInfo();
                    const embed = this.createMusicEmbed(
                        '⏸️ Paused', 
                        track ? `**${track.title}** by ${track.author}` : 'Unknown track',
                        config.colors.warning, 
                        track?.thumbnail
                    );
                    
                    // Add current queue info
                    embed.addFields([
                        { name: 'Queue Position', value: `${queueInfo.currentIndex + 1} of ${queueInfo.queue.length}`, inline: true },
                        { name: 'Volume', value: `${musicManager.volume}%`, inline: true },
                        { name: 'Loop', value: String(musicManager.loopMode || 'off'), inline: true }
                    ]);
                    
                    try {
                        await interaction.update({ embeds: [embed], components: this.createMusicControls(false, true) });
                        
                        // Update the stored panel reference with the new state
                        this.updatePanelReference(interaction.guildId, track);
                    } catch (updateError) {
                        await interaction.reply({ embeds: [embed], components: this.createMusicControls(false, true), ephemeral: true });
                    }
                } else {
                    await interaction.reply({ content: '❌ Nothing to pause!', ephemeral: true });
                }
                break;
                
            case 'music_resume':
                if (musicManager.resume()) {
                    const track = musicManager.currentTrack;
                    const queueInfo = musicManager.getQueueInfo();
                    const embed = this.createMusicEmbed(
                        '▶️ Now Playing', 
                        track ? `**${track.title}** by ${track.author}` : 'Unknown track',
                        config.colors.success, 
                        track?.thumbnail
                    );
                    
                    // Add current queue info
                    embed.addFields([
                        { name: 'Queue Position', value: `${queueInfo.currentIndex + 1} of ${queueInfo.queue.length}`, inline: true },
                        { name: 'Volume', value: `${musicManager.volume}%`, inline: true },
                        { name: 'Loop', value: String(musicManager.loopMode || 'off'), inline: true }
                    ]);
                    
                    try {
                        await interaction.update({ embeds: [embed], components: this.createMusicControls(true, false) });
                        
                        // Update the stored panel reference with the new state
                        this.updatePanelReference(interaction.guildId, track);
                    } catch (updateError) {
                        await interaction.reply({ embeds: [embed], components: this.createMusicControls(true, false), ephemeral: true });
                    }
                } else {
                    await interaction.reply({ content: '❌ Nothing to resume!', ephemeral: true });
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
                            { name: 'Duration', value: nextTrack.duration || 'Unknown', inline: true },
                            { name: 'Source', value: nextTrack.source?.toUpperCase() || 'Unknown', inline: true }
                        ]);
                        
                        try {
                            await interaction.update({ embeds: [embed], components: this.createMusicControls(true, false) });
                            
                            // Update the stored panel reference with the new track
                            this.updatePanelReference(interaction.guildId, nextTrack);
                        } catch (updateError) {
                            await interaction.reply({ embeds: [embed], components: this.createMusicControls(true, false), ephemeral: true });
                        }
                    } else {
                        const embed = this.createMusicEmbed('Skipped', 'Queue finished', config.colors.info);
                        try {
                            await interaction.update({ embeds: [embed], components: this.createMusicControls(false, false) });
                        } catch (updateError) {
                            await interaction.reply({ embeds: [embed], components: this.createMusicControls(false, false), ephemeral: true });
                        }
                    }
                } else {
                    await interaction.reply({ content: '❌ Nothing to skip!', ephemeral: true });
                }
                break;
                
            case 'music_stop':
                musicManager.stop(true); // User initiated
                musicManager.clearQueue(true); // User initiated
                const embed = this.createMusicEmbed('Stopped', 'Music stopped and queue cleared', config.colors.warning);
                
                // Use reply instead of update to avoid timeout issues
                try {
                    await interaction.reply({ embeds: [embed], components: this.createMusicControls(false, false), ephemeral: true });
                } catch (replyError) {
                    console.log('⚠️ Could not send stop confirmation (interaction expired)');
                }
                break;
                
            case 'music_shuffle':
                if (musicManager.shuffle()) {
                    await interaction.reply({ content: `🔀 Queue shuffled (${musicManager.queue.length} tracks)`, ephemeral: true });
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
                        { name: 'Duration', value: track.duration || 'Unknown', inline: true },
                        { name: 'Source', value: track.source?.toUpperCase() || 'Unknown', inline: true }
                    ]);
                    
                    try {
                        await interaction.update({ embeds: [embed], components: this.createMusicControls(true, false) });
                        
                        // Update the stored panel reference with the new track
                        const panelInfo = this.musicPanels.get(interaction.guildId);
                        if (panelInfo) {
                            panelInfo.track = track;
                            this.musicPanels.set(interaction.guildId, panelInfo);
                        }
                    } catch (updateError) {
                        await interaction.reply({ embeds: [embed], components: this.createMusicControls(true, false), ephemeral: true });
                    }
                } else {
                    await interaction.reply({ content: '❌ No previous track available!', ephemeral: true });
                }
                break;
                
            case 'music_volume_up':
                const newVolumeUp = Math.min(100, musicManager.volume + 10);
                musicManager.setVolume(newVolumeUp);
                await interaction.reply({ content: `🔊 Volume: ${newVolumeUp}%`, ephemeral: true });
                break;
                
            case 'music_volume_down':
                const newVolumeDown = Math.max(0, musicManager.volume - 10);
                musicManager.setVolume(newVolumeDown);
                await interaction.reply({ content: `🔉 Volume: ${newVolumeDown}%`, ephemeral: true });
                break;
                
            case 'music_repeat':
                const modes = ['off', 'track', 'queue'];
                const currentIndex = modes.indexOf(musicManager.loopMode);
                const nextMode = modes[(currentIndex + 1) % modes.length];
                musicManager.setLoop(nextMode);
                const modeEmojis = { off: '➡️', track: '🔂', queue: '🔁' };
                await interaction.reply({ content: `${modeEmojis[nextMode]} Loop: ${nextMode}`, ephemeral: true });
                break;
                
            case 'music_queue':
                await this.handleQueueCommand(interaction, musicManager);
                break;
                
            case 'music_clear_queue':
                musicManager.clearQueue(true); // User initiated
                musicManager.stop(true); // User initiated
                await interaction.reply({ content: 'Queue cleared and playback stopped!', ephemeral: true });
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
                await interaction.reply({ content: 'Unknown button action!', ephemeral: true });
                break;
        }
        
        } catch (error) {
            console.error('❌ Button interaction error:', error);
            
            // Handle expired interactions gracefully
            if (error.code === 10062 || error.message.includes('Unknown interaction')) {
                console.log('⚠️ Interaction expired - this is normal for longer operations');
                return;
            }
            
            try {
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({ 
                        content: 'An error occurred while processing your request. Please try again.', 
                        ephemeral: true 
                    });
                }
            } catch (replyError) {
                console.error('❌ Failed to send error reply:', replyError);
            }
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
            await musicManager.addToQueue(track);

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
            .setColor(config.colors.info)
            .setTimestamp();

        const description = results.slice(0, 10).map((track, index) => 
            `**${index + 1}.** ${track.title}\n` +
            `👤 ${track.author} | ⏱️ ${track.duration} | 🎵 ${track.source.toUpperCase()}`
        ).join('\n\n');

        embed.setDescription(description);
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

    async handleQueueCommand(interaction, musicManager) {
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
                value: `**${queueInfo.currentTrack.title}** by ${queueInfo.currentTrack.author}\nDuration: ${queueInfo.currentTrack.duration}`,
                inline: false
            }]);
        }

        // Split queue into multiple fields to avoid character limits
        for (let i = 0; i < maxTracksToShow; i += tracksPerField) {
            const trackGroup = queueInfo.queue.slice(i, Math.min(i + tracksPerField, maxTracksToShow));
            const fieldValue = trackGroup.map((track, index) => {
                const trackNumber = i + index + 1;
                const isCurrent = (i + index) === queueInfo.currentIndex;
                const prefix = isCurrent ? 'Playing' : `${trackNumber}`;
                return `${prefix}. **${track.title}**\n   by ${track.author} (${track.duration})`;
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

        await interaction.reply({ 
            embeds: [embed],
            components: this.createMusicControls()
        });
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
        
        // Delete the current music panel since playback stopped
        await this.deletePreviousPanel(interaction.guildId);

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
        
        if (!member.voice.channel) {
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
        if (!musicManager.connection) {
            return await interaction.reply({
                embeds: [this.createErrorEmbed('Not connected to a voice channel!')],
                ephemeral: true
            });
        }

        musicManager.stop();
        musicManager.clearQueue();
        musicManager.connection.destroy();
        musicManager.connection = null;

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
                    { name: '⏱️ Duration', value: track.duration, inline: true },
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
                    musicManager.fillQueueWithRecommendations(20);
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
                
                await musicManager.fillQueueWithRecommendations(fillCount);
                
                const fillEmbed = this.createMusicEmbed(
                    '🎵 Queue Filled',
                    `Added ${fillCount} smart recommendations to the queue!\n🧠 Based on your music history and preferences`,
                    config.colors.success
                );
                
                await interaction.editReply({ embeds: [fillEmbed] });
                break;
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

    handleVoiceStateUpdate(oldState, newState) {
        const musicManager = this.musicManagers.get(oldState.guild.id);
        if (!musicManager) return;

        if (oldState.channelId && !newState.channelId && newState.member.user.bot) {
            musicManager.handleDisconnect();
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
                    musicManager.pause();
                }
            }, 30000);
        }
    }

    async reconnectToChannels() {
        for (const [guildId, musicManager] of this.musicManagers) {
            if (musicManager.lastChannel) {
                try {
                    const channel = this.client.channels.cache.get(musicManager.lastChannel);
                    if (channel) {
                        const connection = await this.connectToVoiceChannel(channel, guildId);
                        musicManager.setConnection(connection);
                    }
                } catch (error) {
                    console.error(`Failed to reconnect to channel in guild ${guildId}:`, error);
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
            await musicManager.addToQueue(track);
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
                    
                    await interaction.respond(
                        suggestions.map(title => ({ 
                            name: title, 
                            value: title 
                        })).slice(0, 25)
                    );
                    return;
                }
                
                // Get search suggestions based on input
                const suggestions = await this.getSearchSuggestions(focusedValue);
                
                await interaction.respond(
                    suggestions.map(track => ({
                        name: `${track.title} - ${track.author}`.substring(0, 100),
                        value: (track.searchQuery || `${track.title} ${track.author}`).substring(0, 100)
                    })).slice(0, 25)
                );
                
            } catch (error) {
                console.error('Autocomplete error:', error);
                await interaction.respond([]);
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