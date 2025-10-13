const ProStreamEngine = require('./ProStreamEngine');

// Initialize the engine with optimized settings
const streamEngine = new ProStreamEngine({
    bufferSize: 8 * 1024 * 1024,    // 8MB buffer for ultra-smooth streaming
    chunkSize: 128 * 1024,          // 128KB chunks for minimal latency
    maxConcurrentStreams: 15,       // Handle multiple streams simultaneously
    streamTimeout: 3000,            // 3-second timeout for instant response
    retryAttempts: 2                // Quick failover
});

// Example usage with Discord.js or similar framework
async function demonstrateUsage() {
    console.log('🚀 ProStreamEngine Demo - Industry-Grade Audio Streaming');
    
    try {
        // Example YouTube URL
        const videoUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
        
        // Create instant stream - guaranteed fast response
        console.log('⚡ Creating stream...');
        const startTime = Date.now();
        
        const result = await streamEngine.createStream(videoUrl, {
            priority: 'speed',  // Optimize for speed over quality
            preload: true      // Preload into memory buffer
        });
        
        const latency = Date.now() - startTime;
        console.log(`🎯 Stream ready in ${latency}ms!`);
        console.log(`📊 Stream ID: ${result.streamId}`);
        console.log(`💾 From cache: ${result.cached ? 'YES' : 'NO'}`);
        
        // Demonstrate instant button responses
        console.log('\n🎮 Testing instant button responses...');
        
        // Simulate button interactions with zero-latency response
        const playResponse = streamEngine.handleButtonInteraction({
            action: 'play',
            user: 'testUser',
            timestamp: Date.now()
        }, result.streamId);
        
        console.log(`▶️ Play response: ${JSON.stringify(playResponse)}`);
        
        // Pause instantly
        const pauseResponse = streamEngine.handleButtonInteraction({
            action: 'pause',
            user: 'testUser',
            timestamp: Date.now()
        }, result.streamId);
        
        console.log(`⏸️ Pause response: ${JSON.stringify(pauseResponse)}`);
        
        // Resume instantly
        const resumeResponse = streamEngine.handleButtonInteraction({
            action: 'play',
            user: 'testUser',
            timestamp: Date.now()
        }, result.streamId);
        
        console.log(`▶️ Resume response: ${JSON.stringify(resumeResponse)}`);
        
        // Skip instantly
        const skipResponse = streamEngine.handleButtonInteraction({
            action: 'skip',
            user: 'testUser',
            timestamp: Date.now()
        }, result.streamId);
        
        console.log(`⏭️ Skip response: ${JSON.stringify(skipResponse)}`);
        
        // Performance metrics
        console.log('\n📈 Performance Metrics:');
        const metrics = streamEngine.getMetrics();
        console.log(JSON.stringify(metrics, null, 2));
        
        // Stream the audio (example with Discord.js voice)
        console.log('\n🎵 Stream usage example:');
        console.log('// In Discord.js bot:');
        console.log('// const connection = joinVoiceChannel({...});');
        console.log('// const player = createAudioPlayer();');
        console.log('// const resource = createAudioResource(result.stream, {');
        console.log('//     inputType: StreamType.Arbitrary,');
        console.log('//     inlineVolume: true');
        console.log('// });');
        console.log('// player.play(resource);');
        console.log('// connection.subscribe(player);');
        
    } catch (error) {
        console.error('❌ Demo failed:', error.message);
    }
}

// Event listeners for monitoring
streamEngine.on('streamStart', (data) => {
    console.log(`🎬 Stream started: ${data.streamId}`);
});

streamEngine.on('progress', (data) => {
    if (data.percent && data.percent % 10 === 0) { // Log every 10%
        console.log(`📥 Download progress: ${data.percent}% - ${data.speed || 'N/A'}`);
    }
});

streamEngine.on('streamProcessed', (data) => {
    console.log(`✅ Stream processed: ${data.streamId} (${(data.size / 1024 / 1024).toFixed(2)}MB)`);
});

streamEngine.on('buttonPressed', (data) => {
    console.log(`🎮 Button pressed: ${data.action} by ${data.user}`);
});

streamEngine.on('playbackChanged', (data) => {
    console.log(`🎵 Playback state: ${data.state} for ${data.streamId}`);
});

streamEngine.on('streamError', (data) => {
    console.error(`❌ Stream error: ${data.streamId} - ${data.error}`);
});

// Discord.js Integration Example
function createDiscordBot() {
    console.log('\n🤖 Discord.js Integration Example:');
    
    // This would be your actual Discord.js setup
    const exampleCode = `
const { Client, GatewayIntentBits } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, StreamType } = require('@discordjs/voice');
const ProStreamEngine = require('./ProStreamEngine');

const client = new Client({ 
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] 
});

const streamEngine = new ProStreamEngine({
    bufferSize: 8 * 1024 * 1024,  // 8MB for smooth playback
    chunkSize: 128 * 1024         // 128KB chunks for low latency
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;
    
    const streamId = interaction.customId.split('_')[1]; // Extract stream ID
    
    try {
        // INSTANT response - no delays, no "This interaction failed"
        const response = streamEngine.handleButtonInteraction({
            action: interaction.customId.split('_')[0], // play, pause, skip, etc.
            user: interaction.user.id,
            timestamp: Date.now()
        }, streamId);
        
        await interaction.reply({
            content: \`✅ \${response.action || interaction.customId} executed instantly!\`,
            ephemeral: true
        });
        
    } catch (error) {
        await interaction.reply({
            content: \`❌ Action failed: \${error.message}\`,
            ephemeral: true
        });
    }
});

async function playMusic(interaction, url) {
    // Create connection
    const connection = joinVoiceChannel({
        channelId: interaction.member.voice.channelId,
        guildId: interaction.guildId,
        adapterCreator: interaction.guild.voiceAdapterCreator
    });
    
    // Create stream with ProStreamEngine - GUARANTEED fast response
    const result = await streamEngine.createStream(url);
    
    // Create audio resource and play
    const player = createAudioPlayer();
    const resource = createAudioResource(result.stream, {
        inputType: StreamType.Arbitrary,
        inlineVolume: true
    });
    
    player.play(resource);
    connection.subscribe(player);
    
    // Return button controls with stream ID
    return {
        streamId: result.streamId,
        latency: result.latency,
        cached: result.cached
    };
}
`;
    
    console.log(exampleCode);
}

// Performance testing function
async function performanceTest() {
    console.log('\n⚡ Performance Test - Creating 5 concurrent streams...');
    
    const urls = [
        'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        'https://www.youtube.com/watch?v=L_jWHffIx5E',
        'https://www.youtube.com/watch?v=fJ9rUzIMcZQ',
        'https://www.youtube.com/watch?v=ZbZSe6N_BXs',
        'https://www.youtube.com/watch?v=hT_nvWreIhg'
    ];
    
    const startTime = Date.now();
    
    try {
        const promises = urls.map(url => streamEngine.createStream(url));
        const results = await Promise.allSettled(promises);
        
        const totalTime = Date.now() - startTime;
        const successful = results.filter(r => r.status === 'fulfilled').length;
        
        console.log(`✅ Performance Test Results:`);
        console.log(`   Total time: ${totalTime}ms`);
        console.log(`   Successful streams: ${successful}/${urls.length}`);
        console.log(`   Average per stream: ${(totalTime / successful).toFixed(2)}ms`);
        
        const metrics = streamEngine.getMetrics();
        console.log(`   Cache hit rate: ${metrics.cacheHitRate}`);
        console.log(`   Peak concurrent: ${metrics.peakConcurrent}`);
        
    } catch (error) {
        console.error('❌ Performance test failed:', error.message);
    }
}

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\\n🛑 Shutting down gracefully...');
    await streamEngine.shutdown();
    process.exit(0);
});

// Run the demo
if (require.main === module) {
    demonstrateUsage()
        .then(() => createDiscordBot())
        .then(() => performanceTest())
        .catch(console.error);
}

module.exports = { streamEngine, demonstrateUsage, createDiscordBot, performanceTest };