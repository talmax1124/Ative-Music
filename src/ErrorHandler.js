class ErrorHandler {
    constructor() {
        this.errorTypes = {
            VOICE_CONNECTION: 'voice_connection',
            STREAM_ERROR: 'stream_error',
            PERMISSION_ERROR: 'permission_error',
            RATE_LIMIT: 'rate_limit',
            INVALID_URL: 'invalid_url',
            NOT_FOUND: 'not_found',
            NETWORK_ERROR: 'network_error',
            QUOTA_EXCEEDED: 'quota_exceeded'
        };

        this.userFriendlyMessages = {
            voice_connection: {
                title: '🔌 Voice Connection Failed',
                message: 'Unable to connect to voice channel. Please check permissions and try again.',
                suggestions: [
                    'Make sure I have permission to join and speak in the voice channel',
                    'Try disconnecting and reconnecting to the voice channel',
                    'Check if the voice channel is full'
                ]
            },
            stream_error: {
                title: '🎵 Playback Error',
                message: 'Failed to stream this track. Trying alternative sources...',
                suggestions: [
                    'The track may be unavailable in your region',
                    'Try searching for a different version',
                    'Check if the original link is still valid'
                ]
            },
            permission_error: {
                title: '🚫 Permission Denied',
                message: 'I don\'t have the required permissions to perform this action.',
                suggestions: [
                    'Make sure I have "Connect" and "Speak" permissions for voice channels',
                    'Check that I can "Send Messages" and "Use Slash Commands"',
                    'Contact a server administrator for permission setup'
                ]
            },
            rate_limit: {
                title: '⏳ Rate Limited',
                message: 'Too many requests! Please wait a moment before trying again.',
                suggestions: [
                    'Wait 30-60 seconds before trying again',
                    'Avoid spamming commands',
                    'The bot will resume normal operation shortly'
                ]
            },
            invalid_url: {
                title: '🔗 Invalid URL',
                message: 'The provided URL is not valid or supported.',
                suggestions: [
                    'Make sure the URL is from YouTube, Spotify, or SoundCloud',
                    'Try copying the URL again from your browser',
                    'Use the search function instead of direct URLs'
                ]
            },
            not_found: {
                title: '🔍 Not Found',
                message: 'No results found for your search query.',
                suggestions: [
                    'Try different keywords or artist names',
                    'Check spelling and try again',
                    'Try using more specific search terms'
                ]
            },
            network_error: {
                title: '🌐 Network Error',
                message: 'Network connection issue. Please try again in a moment.',
                suggestions: [
                    'This is usually temporary - try again in a few seconds',
                    'Check if the music service is experiencing issues',
                    'Try a different source or search term'
                ]
            },
            quota_exceeded: {
                title: '📊 Service Limit Reached',
                message: 'Daily limit reached for this service. Switching to alternatives...',
                suggestions: [
                    'The bot will automatically try other sources',
                    'Limits reset daily',
                    'Try YouTube or Spotify links directly'
                ]
            }
        };
    }

    createErrorEmbed(errorType, originalError = null, additionalInfo = {}) {
        const config = require('../config.js');
        const { EmbedBuilder } = require('discord.js');
        
        const errorInfo = this.userFriendlyMessages[errorType] || this.userFriendlyMessages.network_error;
        
        const embed = new EmbedBuilder()
            .setTitle(errorInfo.title)
            .setDescription(errorInfo.message)
            .setColor(config.colors.error)
            .setTimestamp();

        // Add suggestions field
        if (errorInfo.suggestions && errorInfo.suggestions.length > 0) {
            embed.addFields([{
                name: '💡 Suggestions',
                value: errorInfo.suggestions.map(s => `• ${s}`).join('\n'),
                inline: false
            }]);
        }

        // Add additional info if provided
        if (additionalInfo.track) {
            embed.addFields([{
                name: '🎵 Track Info',
                value: `**${additionalInfo.track.title}**\nBy: ${additionalInfo.track.author}`,
                inline: false
            }]);
        }

        // Add retry information
        embed.addFields([{
            name: '🔄 Next Steps',
            value: this.getRetryMessage(errorType),
            inline: false
        }]);

        // Log detailed error for debugging
        if (originalError) {
            console.error(`[${errorType.toUpperCase()}] ${originalError.message}`, {
                stack: originalError.stack,
                additionalInfo
            });
        }

        return embed;
    }

    getRetryMessage(errorType) {
        const retryMessages = {
            voice_connection: 'I\'ll automatically retry connecting. Use `/join` to reconnect manually.',
            stream_error: 'I\'ll try alternative sources automatically. Use `/skip` if issues persist.',
            permission_error: 'Contact your server admin to fix permissions.',
            rate_limit: 'Please wait 30-60 seconds before trying again.',
            invalid_url: 'Try using the `/search` command instead.',
            not_found: 'Try different search terms or browse trending music.',
            network_error: 'Retrying automatically... Use `/play` again if needed.',
            quota_exceeded: 'I\'ll automatically switch to available sources.'
        };

        return retryMessages[errorType] || 'Try using `/help` for more assistance.';
    }

    async handleError(interaction, errorType, originalError = null, additionalInfo = {}) {
        const embed = this.createErrorEmbed(errorType, originalError, additionalInfo);
        
        try {
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({ embeds: [embed], components: [] });
            } else {
                await interaction.reply({ embeds: [embed], ephemeral: true });
            }
        } catch (discordError) {
            console.error('Failed to send error message:', discordError);
            // Fallback to console log
            console.error(`User Error [${errorType}]:`, originalError?.message || 'Unknown error');
        }

        // Track error metrics (for future analytics)
        this.logError(errorType, originalError, additionalInfo);
    }

    logError(errorType, originalError, additionalInfo) {
        const logEntry = {
            timestamp: new Date().toISOString(),
            type: errorType,
            message: originalError?.message || 'No message',
            guild: additionalInfo.guildId || 'unknown',
            user: additionalInfo.userId || 'unknown',
            track: additionalInfo.track?.title || 'unknown'
        };

        // Simple file logging (could be enhanced with proper logging service)
        const fs = require('fs').promises;
        const path = require('path');
        
        fs.appendFile(
            path.join(__dirname, '../logs/errors.log'),
            JSON.stringify(logEntry) + '\n'
        ).catch(() => {}); // Silent fail for logging
    }

    // Quick error type detection helpers
    static detectErrorType(error) {
        if (!error || !error.message) return 'network_error';
        
        const message = error.message.toLowerCase();
        
        if (message.includes('permission') || message.includes('forbidden')) {
            return 'permission_error';
        }
        if (message.includes('rate limit') || message.includes('too many requests')) {
            return 'rate_limit';
        }
        if (message.includes('not found') || message.includes('404')) {
            return 'not_found';
        }
        if (message.includes('invalid url') || message.includes('malformed')) {
            return 'invalid_url';
        }
        if (message.includes('quota') || message.includes('limit exceeded')) {
            return 'quota_exceeded';
        }
        if (message.includes('connection') || message.includes('voice')) {
            return 'voice_connection';
        }
        if (message.includes('stream') || message.includes('playback')) {
            return 'stream_error';
        }
        
        return 'network_error'; // Default
    }
}

module.exports = ErrorHandler;