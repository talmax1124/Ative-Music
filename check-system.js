#!/usr/bin/env node

const fs = require('fs');
const { execSync } = require('child_process');
const colors = require('colors');

console.log('🔍 Ative Music Bot - System Check'.rainbow);
console.log('=================================='.cyan);

let allGood = true;

function checkItem(name, check, fix = null) {
    try {
        process.stdout.write(`${name}... `.white);
        if (check()) {
            console.log('✅ OK'.green);
            return true;
        } else {
            console.log('❌ FAIL'.red);
            if (fix) {
                console.log(`   Fix: ${fix}`.yellow);
            }
            return false;
        }
    } catch (error) {
        console.log('❌ ERROR'.red);
        console.log(`   ${error.message}`.dim);
        if (fix) {
            console.log(`   Fix: ${fix}`.yellow);
        }
        return false;
    }
}

// Check Node.js version
allGood &= checkItem(
    'Node.js version (>= 16.9.0)',
    () => {
        const version = process.version.replace('v', '');
        const [major, minor] = version.split('.').map(Number);
        return major > 16 || (major === 16 && minor >= 9);
    },
    'Update Node.js from https://nodejs.org'
);

// Check npm
allGood &= checkItem(
    'npm installed',
    () => {
        execSync('npm --version', { stdio: 'pipe' });
        return true;
    },
    'Install npm (usually comes with Node.js)'
);

// Check FFmpeg
allGood &= checkItem(
    'FFmpeg installed',
    () => {
        execSync('ffmpeg -version', { stdio: 'pipe' });
        return true;
    },
    'Install FFmpeg: brew install ffmpeg (macOS) or apt install ffmpeg (Linux)'
);

// Check package.json
allGood &= checkItem(
    'package.json exists',
    () => fs.existsSync('package.json'),
    'Run this script from the bot directory'
);

// Check node_modules
allGood &= checkItem(
    'Dependencies installed',
    () => fs.existsSync('node_modules'),
    'Run: npm install'
);

// Check critical files
const criticalFiles = [
    'index.js',
    'config.js',
    'src/MusicManager.js',
    'src/SourceHandlers.js'
];

for (const file of criticalFiles) {
    allGood &= checkItem(
        `${file} exists`,
        () => fs.existsSync(file),
        'Re-download the bot files'
    );
}

// Check .env file
allGood &= checkItem(
    '.env configuration',
    () => {
        if (!fs.existsSync('.env')) return false;
        
        require('dotenv').config();
        return process.env.DISCORD_TOKEN && 
               process.env.DISCORD_TOKEN !== 'YOUR_BOT_TOKEN_HERE';
    },
    'Run: npm run setup'
);

// Check directories
const directories = ['data', 'cache', 'src'];
for (const dir of directories) {
    allGood &= checkItem(
        `${dir}/ directory`,
        () => fs.existsSync(dir),
        `Create directory: mkdir ${dir}`
    );
}

console.log('\n' + '='.repeat(50));

if (allGood) {
    console.log('🎉 All systems go! Your bot should work perfectly.'.green);
    console.log('\n🚀 Ready to start:'.cyan);
    console.log('   npm start'.white);
} else {
    console.log('⚠️  Some issues found. Please fix them before starting the bot.'.yellow);
    console.log('\n🔧 Common fixes:'.cyan);
    console.log('   npm install          # Install dependencies'.white);
    console.log('   npm run setup        # Configure bot credentials'.white);
    console.log('   brew install ffmpeg  # Install FFmpeg (macOS)'.white);
}

console.log('\n📖 For detailed help, see README.md or SETUP.md'.dim);