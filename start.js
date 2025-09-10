#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

console.log('🎵 Starting Ative Music Bot...');
console.log('==============================');

// Load environment variables (Railway uses environment variables directly)
require('dotenv').config();

// Check if .env file exists (not required for Railway deployment)
if (!fs.existsSync('.env') && !process.env.RAILWAY_ENVIRONMENT) {
    console.log('❌ No .env file found!');
    console.log('🔧 Please run: node setup.js');
    console.log('📖 Or copy .env.example to .env and fill in your credentials');
    process.exit(1);
}

// Check if required directories exist
const requiredDirs = ['data', 'cache', 'src'];
for (const dir of requiredDirs) {
    if (!fs.existsSync(dir)) {
        console.log(`📁 Creating directory: ${dir}`);
        fs.mkdirSync(dir, { recursive: true });
    }
}

// Check if Discord token is provided
if (!process.env.DISCORD_TOKEN || process.env.DISCORD_TOKEN === 'YOUR_BOT_TOKEN_HERE') {
    console.log('❌ Discord token not configured!');
    console.log('🔧 Please run: node setup.js');
    console.log('📖 Or edit your .env file with your Discord bot token');
    process.exit(1);
}

// Start the bot
console.log('🚀 Launching bot...');

try {
    require('./index.js');
} catch (error) {
    console.error('❌ Failed to start bot:', error.message);
    console.log('\n🔧 Troubleshooting:');
    console.log('1. Make sure all dependencies are installed: npm install');
    console.log('2. Check your .env configuration');
    console.log('3. Ensure FFmpeg is installed on your system');
    console.log('4. Check the README.md for detailed setup instructions');
    process.exit(1);
}