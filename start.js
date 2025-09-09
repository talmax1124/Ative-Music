#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const colors = require('colors');

console.log('🎵 Starting Ative Music Bot...'.rainbow);
console.log('=============================='.cyan);

// Check if .env file exists
if (!fs.existsSync('.env')) {
    console.log('❌ No .env file found!'.red);
    console.log('🔧 Please run: node setup.js'.yellow);
    console.log('📖 Or copy .env.example to .env and fill in your credentials'.dim);
    process.exit(1);
}

// Check if required directories exist
const requiredDirs = ['data', 'cache', 'src'];
for (const dir of requiredDirs) {
    if (!fs.existsSync(dir)) {
        console.log(`📁 Creating directory: ${dir}`.cyan);
        fs.mkdirSync(dir, { recursive: true });
    }
}

// Load environment variables
require('dotenv').config();

// Check if Discord token is provided
if (!process.env.DISCORD_TOKEN || process.env.DISCORD_TOKEN === 'YOUR_BOT_TOKEN_HERE') {
    console.log('❌ Discord token not configured!'.red);
    console.log('🔧 Please run: node setup.js'.yellow);
    console.log('📖 Or edit your .env file with your Discord bot token'.dim);
    process.exit(1);
}

// Start the bot
console.log('🚀 Launching bot...'.green);

try {
    require('./index.js');
} catch (error) {
    console.error('❌ Failed to start bot:'.red, error.message);
    console.log('\n🔧 Troubleshooting:'.yellow);
    console.log('1. Make sure all dependencies are installed: npm install'.white);
    console.log('2. Check your .env configuration'.white);
    console.log('3. Ensure FFmpeg is installed on your system'.white);
    console.log('4. Check the README.md for detailed setup instructions'.white);
    process.exit(1);
}