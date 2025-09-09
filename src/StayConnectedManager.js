const { joinVoiceChannel, VoiceConnectionStatus, entersState } = require('@discordjs/voice');
const config = require('../config.js');

class StayConnectedManager {
    constructor(client) {
        this.client = client;
        this.connections = new Map();
        this.reconnectAttempts = new Map();
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 10000; // 10 seconds
        
        this.setupEventHandlers();
    }

    setupEventHandlers() {
        this.client.on('clientReady', () => {
            if (config.settings.stayInChannel) {
                this.initializeConnections();
            }
        });

        this.client.on('voiceStateUpdate', (oldState, newState) => {
            this.handleVoiceStateUpdate(oldState, newState);
        });
    }

    async initializeConnections() {
        const savedChannels = this.loadSavedChannels();
        
        for (const [guildId, channelId] of savedChannels) {
            try {
                const guild = this.client.guilds.cache.get(guildId);
                if (!guild) continue;

                const channel = guild.channels.cache.get(channelId);
                if (!channel || channel.type !== 2) continue; // 2 = GUILD_VOICE

                await this.connectToChannel(channel);
                console.log(`🔄 Reconnected to ${channel.name} in ${guild.name}`);
                
            } catch (error) {
                console.error(`❌ Failed to reconnect to channel in guild ${guildId}:`, error);
            }
        }
    }

    async connectToChannel(channel, force = false) {
        const guildId = channel.guild.id;
        
        if (this.connections.has(guildId) && !force) {
            return this.connections.get(guildId);
        }

        try {
            const connection = joinVoiceChannel({
                channelId: channel.id,
                guildId: guildId,
                adapterCreator: channel.guild.voiceAdapterCreator,
                selfDeaf: false,
                selfMute: false
            });

            connection.on(VoiceConnectionStatus.Disconnected, async () => {
                try {
                    await Promise.race([
                        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
                        entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
                    ]);
                } catch (error) {
                    console.log(`🔌 Connection lost for ${channel.name}, attempting reconnect...`);
                    connection.destroy();
                    this.connections.delete(guildId);
                    await this.attemptReconnect(channel);
                }
            });

            connection.on(VoiceConnectionStatus.Destroyed, () => {
                this.connections.delete(guildId);
                this.reconnectAttempts.delete(guildId);
            });

            await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
            this.connections.set(guildId, connection);
            this.reconnectAttempts.delete(guildId);
            
            this.saveChannel(guildId, channel.id);
            
            return connection;

        } catch (error) {
            console.error(`❌ Failed to connect to ${channel.name}:`, error);
            throw error;
        }
    }

    async attemptReconnect(channel, attempt = 1) {
        const guildId = channel.guild.id;
        
        if (attempt > this.maxReconnectAttempts) {
            console.error(`❌ Max reconnection attempts reached for ${channel.name}`);
            this.reconnectAttempts.delete(guildId);
            return;
        }

        this.reconnectAttempts.set(guildId, attempt);
        
        console.log(`🔄 Reconnection attempt ${attempt}/${this.maxReconnectAttempts} for ${channel.name}...`);
        
        setTimeout(async () => {
            try {
                // Check if channel still exists and bot has permissions
                const freshChannel = this.client.channels.cache.get(channel.id);
                if (!freshChannel) {
                    console.log(`❌ Channel ${channel.name} no longer exists`);
                    this.removeChannel(guildId);
                    return;
                }

                const permissions = freshChannel.permissionsFor(this.client.user);
                if (!permissions.has(['CONNECT', 'SPEAK'])) {
                    console.log(`❌ Missing permissions for ${channel.name}`);
                    return;
                }

                await this.connectToChannel(freshChannel, true);
                console.log(`✅ Successfully reconnected to ${freshChannel.name}`);
                
            } catch (error) {
                console.error(`❌ Reconnection attempt ${attempt} failed:`, error);
                await this.attemptReconnect(channel, attempt + 1);
            }
        }, this.reconnectDelay * attempt);
    }

    handleVoiceStateUpdate(oldState, newState) {
        if (!config.settings.stayInChannel) return;
        
        const botMember = oldState.guild.members.cache.get(this.client.user.id);
        if (!botMember?.voice?.channelId) return;

        const voiceChannel = botMember.voice.channel;
        if (!voiceChannel) return;

        // Check if bot was moved to a different channel
        if (oldState.member?.id === this.client.user.id && 
            oldState.channelId && 
            newState.channelId && 
            oldState.channelId !== newState.channelId) {
            
            console.log(`🎵 Moved to ${newState.channel.name}`);
            this.saveChannel(newState.guild.id, newState.channelId);
        }

        // Auto-pause when alone
        setTimeout(() => {
            const currentChannel = this.client.channels.cache.get(voiceChannel.id);
            if (!currentChannel) return;

            const humanMembers = currentChannel.members.filter(member => !member.user.bot);
            
            if (humanMembers.size === 0) {
                console.log(`😴 No users in ${voiceChannel.name}, pausing playback...`);
                this.pauseInGuild(oldState.guild.id);
            } else if (humanMembers.size > 0 && this.isPausedDueToEmpty(oldState.guild.id)) {
                console.log(`😊 Users returned to ${voiceChannel.name}, resuming playback...`);
                this.resumeInGuild(oldState.guild.id);
            }
        }, 5000); // 5 second delay to avoid rapid state changes
    }

    pauseInGuild(guildId) {
        const musicManager = this.client.musicManagers?.get(guildId);
        if (musicManager && musicManager.isPlaying && !musicManager.isPaused) {
            musicManager.pause();
            musicManager._pausedDueToEmpty = true;
        }
    }

    resumeInGuild(guildId) {
        const musicManager = this.client.musicManagers?.get(guildId);
        if (musicManager && musicManager._pausedDueToEmpty) {
            musicManager.resume();
            musicManager._pausedDueToEmpty = false;
        }
    }

    isPausedDueToEmpty(guildId) {
        const musicManager = this.client.musicManagers?.get(guildId);
        return musicManager?._pausedDueToEmpty || false;
    }

    disconnect(guildId) {
        const connection = this.connections.get(guildId);
        if (connection) {
            connection.destroy();
        }
        this.removeChannel(guildId);
    }

    getConnection(guildId) {
        return this.connections.get(guildId);
    }

    isConnected(guildId) {
        return this.connections.has(guildId);
    }

    saveChannel(guildId, channelId) {
        try {
            const fs = require('fs');
            const path = require('path');
            const filePath = path.join(__dirname, '../data/channels.json');
            
            // Ensure data directory exists
            const dataDir = path.dirname(filePath);
            if (!fs.existsSync(dataDir)) {
                fs.mkdirSync(dataDir, { recursive: true });
            }

            let channels = {};
            if (fs.existsSync(filePath)) {
                channels = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            }
            
            channels[guildId] = channelId;
            fs.writeFileSync(filePath, JSON.stringify(channels, null, 2));
            
        } catch (error) {
            console.error('Error saving channel:', error);
        }
    }

    removeChannel(guildId) {
        try {
            const fs = require('fs');
            const path = require('path');
            const filePath = path.join(__dirname, '../data/channels.json');
            
            if (fs.existsSync(filePath)) {
                const channels = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                delete channels[guildId];
                fs.writeFileSync(filePath, JSON.stringify(channels, null, 2));
            }
            
        } catch (error) {
            console.error('Error removing channel:', error);
        }
    }

    loadSavedChannels() {
        try {
            const fs = require('fs');
            const path = require('path');
            const filePath = path.join(__dirname, '../data/channels.json');
            
            if (fs.existsSync(filePath)) {
                const channels = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                return Object.entries(channels);
            }
        } catch (error) {
            console.error('Error loading saved channels:', error);
        }
        
        return [];
    }

    getStatus() {
        const connections = Array.from(this.connections.entries()).map(([guildId, connection]) => {
            const guild = this.client.guilds.cache.get(guildId);
            const channel = guild?.channels.cache.get(connection.joinConfig.channelId);
            
            return {
                guild: guild?.name || 'Unknown',
                channel: channel?.name || 'Unknown',
                status: connection.state.status,
                ping: connection.ping
            };
        });

        return {
            totalConnections: this.connections.size,
            connections: connections,
            stayInChannel: config.settings.stayInChannel
        };
    }
}

module.exports = StayConnectedManager;