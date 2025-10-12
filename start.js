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

// Create cookies file from environment variable if provided (for Railway)
if (process.env.YOUTUBE_COOKIES && process.env.YOUTUBE_COOKIES.trim() !== '') {
    const cookiesPath = process.env.COOKIES_PATH || './cookies.txt';
    
    // Check if valid cookies already exist
    let hasValidCookies = false;
    try {
        if (fs.existsSync(cookiesPath)) {
            const existingCookies = fs.readFileSync(cookiesPath, 'utf8');
            if (existingCookies && existingCookies.trim() && 
                (existingCookies.includes('Netscape HTTP Cookie File') || 
                 existingCookies.includes('.youtube.com') ||
                 /^\.youtube\.com\t/m.test(existingCookies))) {
                hasValidCookies = true;
                console.log('🍪 Valid cookies already exist, skipping environment override');
            }
        }
    } catch (error) {
        console.log('⚠️ Failed to check existing cookies:', error.message);
    }
    
    // Only overwrite if no valid cookies exist
    if (!hasValidCookies) {
        try {
            const decodedCookies = Buffer.from(process.env.YOUTUBE_COOKIES, 'base64').toString('utf-8');
            // Only write if the decoded content looks valid
            if (decodedCookies && decodedCookies.length > 10) {
                fs.writeFileSync(cookiesPath, decodedCookies);
                console.log('🍪 YouTube cookies loaded from environment');
            } else {
                console.log('⚠️ YOUTUBE_COOKIES environment variable is set but appears empty or invalid');
            }
        } catch (error) {
            console.log('⚠️ Failed to decode YOUTUBE_COOKIES from environment:', error.message);
        }
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

(async () => {
    // Preload libsodium-wrappers so new Discord voice encryption modes work
    try {
        const sodium = require('libsodium-wrappers');
        await sodium.ready;
        global.sodium = sodium;
        console.log('🔐 libsodium-wrappers ready');
    } catch (e) {
        console.log('⚠️ Failed to preload libsodium-wrappers; voice may not connect:', e?.message || e);
    }

    require('./index.js');
})().catch((error) => {
    console.error('❌ Failed to start bot:', error.message || error);
    console.log('\n🔧 Troubleshooting:');
    console.log('1. Make sure all dependencies are installed: npm install');
    console.log('2. Check your .env configuration');
    console.log('3. Ensure FFmpeg is installed on your system');
    console.log('4. Check the README.md for detailed setup instructions');
    process.exit(1);
});
