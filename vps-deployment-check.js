#!/usr/bin/env node

// VPS Deployment Validation Script
// Run this after deployment to ensure everything works

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🔍 VPS Deployment Validation Check');
console.log('=====================================');

let hasErrors = false;

function checkResult(name, result, fix = null) {
    if (result) {
        console.log(`✅ ${name}: OK`);
    } else {
        console.log(`❌ ${name}: FAIL`);
        hasErrors = true;
        if (fix) {
            console.log(`   Fix: ${fix}`);
        }
    }
}

async function runCheck() {
    // 1. Check Node.js version
    console.log('\n📦 Node.js Environment:');
    try {
        const nodeVersion = process.version;
        checkResult(`Node.js version ${nodeVersion}`, nodeVersion >= 'v16.0.0');
    } catch (error) {
        checkResult('Node.js', false, 'Install Node.js 16+');
    }

    // 2. Check required files
    console.log('\n📁 Required Files:');
    checkResult('package.json', fs.existsSync('package.json'));
    checkResult('start.js', fs.existsSync('start.js'));
    checkResult('index.js', fs.existsSync('index.js'));
    checkResult('config.js', fs.existsSync('config.js'));
    checkResult('.env file', fs.existsSync('.env'), 'Create .env with your bot credentials');

    // 3. Check required directories
    console.log('\n📂 Required Directories:');
    checkResult('src directory', fs.existsSync('src'));
    checkResult('data directory', fs.existsSync('data'));
    checkResult('cache directory', fs.existsSync('cache'));

    // 4. Check critical source files
    console.log('\n🔧 Core Components:');
    checkResult('SourceHandlers.js', fs.existsSync('src/SourceHandlers.js'));
    checkResult('MusicManager.js', fs.existsSync('src/MusicManager.js'));
    checkResult('SmartAutoPlay.js', fs.existsSync('src/SmartAutoPlay.js'));
    checkResult('LocalVideoServer.js', fs.existsSync('src/LocalVideoServer.js'));

    // 5. Check environment variables
    console.log('\n🔐 Environment Configuration:');
    require('dotenv').config();
    checkResult('DISCORD_TOKEN', process.env.DISCORD_TOKEN && process.env.DISCORD_TOKEN !== 'YOUR_BOT_TOKEN_HERE');
    checkResult('CLIENT_ID', process.env.CLIENT_ID && process.env.CLIENT_ID !== 'YOUR_CLIENT_ID_HERE');

    // 6. Check system dependencies
    console.log('\n🔧 System Dependencies:');
    
    // Check FFmpeg
    try {
        await new Promise((resolve) => {
            const ffmpeg = spawn('ffmpeg', ['-version']);
            ffmpeg.on('close', (code) => {
                checkResult('FFmpeg', code === 0, 'Install FFmpeg: apt install ffmpeg');
                resolve();
            });
            ffmpeg.on('error', () => {
                checkResult('FFmpeg', false, 'Install FFmpeg: apt install ffmpeg');
                resolve();
            });
        });
    } catch (error) {
        checkResult('FFmpeg', false, 'Install FFmpeg: apt install ffmpeg');
    }

    // Check yt-dlp (critical for music streaming)
    try {
        await new Promise((resolve) => {
            const ytdlp = spawn('yt-dlp', ['--version']);
            ytdlp.on('close', (code) => {
                checkResult('yt-dlp (CRITICAL)', code === 0, 'Install yt-dlp: pip3 install yt-dlp');
                resolve();
            });
            ytdlp.on('error', () => {
                checkResult('yt-dlp (CRITICAL)', false, 'Install yt-dlp: pip3 install yt-dlp');
                resolve();
            });
        });
    } catch (error) {
        checkResult('yt-dlp (CRITICAL)', false, 'Install yt-dlp: pip3 install yt-dlp');
    }

    // 7. Check Node dependencies
    console.log('\n📚 Node.js Dependencies:');
    try {
        const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
        const nodeModulesExists = fs.existsSync('node_modules');
        checkResult('node_modules installed', nodeModulesExists, 'Run: npm install');

        if (nodeModulesExists) {
            const criticalDeps = [
                'discord.js',
                '@discordjs/voice',
                'ytdl-core',
                'play-dl',
                'youtube-sr',
                'spotify-web-api-node',
                'express'
            ];

            for (const dep of criticalDeps) {
                const exists = fs.existsSync(`node_modules/${dep}`);
                checkResult(`${dep} module`, exists, `npm install ${dep}`);
            }
        }
    } catch (error) {
        checkResult('package.json parsing', false, 'Check package.json syntax');
    }

    // 8. Port availability check
    console.log('\n🌐 Network Configuration:');
    const port = process.env.PORT || 3000;
    console.log(`📡 Server will run on port: ${port}`);

    // Final summary
    console.log('\n📋 DEPLOYMENT VALIDATION SUMMARY');
    console.log('=====================================');
    
    if (!hasErrors) {
        console.log('🎉 ALL CHECKS PASSED! Your VPS deployment is ready to go!');
        console.log('');
        console.log('🚀 To start the bot:');
        console.log('   npm start');
        console.log('   or');
        console.log('   node start.js');
        console.log('');
        console.log('🎵 Your Ative Music Bot should connect to Discord successfully!');
    } else {
        console.log('⚠️  Some issues found. Please fix them before starting the bot.');
        console.log('');
        console.log('🔧 Most common fixes:');
        console.log('1. Run: npm install');
        console.log('2. Create .env file with your Discord bot credentials');
        console.log('3. Install system dependencies: apt install ffmpeg');
        console.log('4. Install yt-dlp: pip3 install yt-dlp');
    }
}

runCheck().catch(console.error);