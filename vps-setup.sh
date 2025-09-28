#!/bin/bash
# VPS Setup Script for Ative Music Bot

echo "🎵 Setting up Ative Music Bot on VPS..."

# Install yt-dlp
echo "📺 Installing yt-dlp..."
if command -v pip3 &> /dev/null; then
    pip3 install --upgrade yt-dlp
elif command -v pip &> /dev/null; then
    pip install --upgrade yt-dlp
else
    echo "⚠️ pip not found, using curl method..."
    curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
    chmod a+rx /usr/local/bin/yt-dlp
fi

# Verify yt-dlp installation
if command -v yt-dlp &> /dev/null; then
    echo "✅ yt-dlp installed: $(yt-dlp --version)"
else
    echo "❌ yt-dlp installation failed"
    exit 1
fi

# Install ffmpeg if not present
if ! command -v ffmpeg &> /dev/null; then
    echo "🎬 Installing ffmpeg..."
    apt-get update && apt-get install -y ffmpeg || echo "⚠️ Could not install ffmpeg via apt"
fi

# Pull latest code
echo "📡 Pulling latest code from GitHub..."
git pull origin main

# Install npm dependencies
echo "📦 Installing npm dependencies..."
npm install

echo "✅ Setup complete!"
echo "🚀 Start the bot with: npm start"