const fs = require('fs');
const path = require('path');
const readline = require('readline');
const colors = require('colors');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

console.log('🎵 Welcome to Ative Music Bot Setup!'.rainbow);
console.log('====================================='.cyan);
console.log('');

async function askQuestion(question) {
    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            resolve(answer);
        });
    });
}

async function setup() {
    console.log('This setup will help you configure your bot with the necessary credentials.\n'.yellow);
    
    // Check if .env already exists
    if (fs.existsSync('.env')) {
        const overwrite = await askQuestion('❓ .env file already exists. Overwrite? (y/N): ');
        if (overwrite.toLowerCase() !== 'y' && overwrite.toLowerCase() !== 'yes') {
            console.log('✅ Setup cancelled. Your existing .env file is preserved.'.green);
            rl.close();
            return;
        }
    }

    console.log('🔑 Discord Bot Configuration'.blue);
    console.log('---------------------------');
    
    const discordToken = await askQuestion('Enter your Discord Bot Token: ');
    if (!discordToken.trim()) {
        console.log('❌ Discord token is required!'.red);
        rl.close();
        return;
    }

    const clientId = await askQuestion('Enter your Discord Client ID: ');
    if (!clientId.trim()) {
        console.log('❌ Client ID is required!'.red);
        rl.close();
        return;
    }

    console.log('\n🎵 Spotify API Configuration (Optional but recommended)'.green);
    console.log('--------------------------------------------------------');
    console.log('💡 Get credentials at: https://developer.spotify.com/dashboard'.dim);
    
    const spotifyClientId = await askQuestion('Enter Spotify Client ID (optional): ');
    let spotifyClientSecret = '';
    
    if (spotifyClientId.trim()) {
        spotifyClientSecret = await askQuestion('Enter Spotify Client Secret: ');
    }

    console.log('\n🍎 Apple Music API Configuration (Optional)'.magenta);
    console.log('-------------------------------------------');
    console.log('💡 Requires Apple Developer Program membership'.dim);
    
    const appleMusicKeyId = await askQuestion('Enter Apple Music Key ID (optional): ');
    let appleMusicTeamId = '';
    let appleMusicPrivateKey = '';
    
    if (appleMusicKeyId.trim()) {
        appleMusicTeamId = await askQuestion('Enter Apple Music Team ID: ');
        appleMusicPrivateKey = await askQuestion('Enter Apple Music Private Key (path or content): ');
    }

    // Create .env file
    const envContent = `# Discord Bot Configuration
DISCORD_TOKEN=${discordToken}
CLIENT_ID=${clientId}

# Spotify API Configuration
SPOTIFY_CLIENT_ID=${spotifyClientId}
SPOTIFY_CLIENT_SECRET=${spotifyClientSecret}

# Apple Music API Configuration
APPLE_MUSIC_KEY_ID=${appleMusicKeyId}
APPLE_MUSIC_TEAM_ID=${appleMusicTeamId}
APPLE_MUSIC_PRIVATE_KEY=${appleMusicPrivateKey}

# Bot Settings
NODE_ENV=production
`;

    fs.writeFileSync('.env', envContent);

    // Create necessary directories
    const directories = ['data', 'cache', 'cache/videos'];
    directories.forEach(dir => {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    });

    console.log('\n✅ Setup completed successfully!'.green);
    console.log('📁 Created .env file with your configuration'.green);
    console.log('📁 Created necessary directories'.green);
    
    console.log('\n🚀 Next Steps:'.yellow);
    console.log('1. Install dependencies: npm install'.white);
    console.log('2. Start the bot: npm start'.white);
    console.log('3. Invite bot to your server with proper permissions'.white);
    
    console.log('\n🔧 Required Bot Permissions:'.cyan);
    console.log('- Read Messages'.white);
    console.log('- Send Messages'.white);
    console.log('- Connect to Voice Channels'.white);
    console.log('- Speak in Voice Channels'.white);
    console.log('- Use Slash Commands'.white);
    
    console.log('\n📖 For more help, check README.md'.dim);
    
    rl.close();
}

// Error handling
process.on('uncaughtException', (error) => {
    console.error('❌ Setup error:', error.message);
    rl.close();
});

process.on('SIGINT', () => {
    console.log('\n\n👋 Setup cancelled by user'.yellow);
    rl.close();
});

setup();