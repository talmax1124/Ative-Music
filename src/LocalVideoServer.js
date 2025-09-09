const express = require('express');
const path = require('path');
const fs = require('fs');
const http = require('http');

class LocalVideoServer {
    constructor(port = 3000) {
        this.port = port;
        this.app = express();
        this.server = null;
        this.isRunning = false;
        this.cacheDir = path.join(__dirname, '../cache/videos');
        this.setupServer();
    }

    setupServer() {
        // Serve static files from cache directory
        this.app.use('/videos', express.static(this.cacheDir));
        
        // Main video player page
        this.app.get('/', (req, res) => {
            res.send(this.createVideoPlayerHTML());
        });

        // Get video info endpoint
        this.app.get('/api/video/:id', (req, res) => {
            const videoId = req.params.id;
            const videoPath = path.join(this.cacheDir, `${videoId}.mp4`);
            
            if (fs.existsSync(videoPath)) {
                const stats = fs.statSync(videoPath);
                res.json({
                    exists: true,
                    size: stats.size,
                    url: `/videos/${videoId}.mp4`,
                    fullUrl: `http://localhost:${this.port}/videos/${videoId}.mp4`
                });
            } else {
                res.json({ exists: false });
            }
        });

        // Play specific video endpoint
        this.app.get('/play/:id', (req, res) => {
            const videoId = req.params.id;
            const videoPath = path.join(this.cacheDir, `${videoId}.mp4`);
            
            if (fs.existsSync(videoPath)) {
                res.send(this.createVideoPlayerHTML(videoId));
            } else {
                res.status(404).send('Video not found. Please cache it first.');
            }
        });

        // List all cached videos
        this.app.get('/api/videos', (req, res) => {
            try {
                const files = fs.readdirSync(this.cacheDir)
                    .filter(file => file.endsWith('.mp4'))
                    .map(file => {
                        const stats = fs.statSync(path.join(this.cacheDir, file));
                        return {
                            id: path.parse(file).name,
                            filename: file,
                            size: this.formatBytes(stats.size),
                            modified: stats.mtime.toISOString()
                        };
                    });
                
                res.json(files);
            } catch (error) {
                res.status(500).json({ error: 'Failed to list videos' });
            }
        });
    }

    createVideoPlayerHTML(videoId = null) {
        const videoSection = videoId ? `
            <div class="video-container">
                <video controls autoplay style="width: 100%; max-width: 800px;">
                    <source src="/videos/${videoId}.mp4" type="video/mp4">
                    Your browser does not support the video tag.
                </video>
            </div>
            <div class="controls">
                <button onclick="location.href='/'">← Back to Video List</button>
                <button onclick="toggleFullscreen()">🔲 Fullscreen</button>
                <button onclick="location.reload()">🔄 Reload</button>
            </div>
        ` : `
            <div id="videoList"></div>
            <div class="instructions">
                <h3>📺 Screen Share Instructions:</h3>
                <ol>
                    <li>Choose a video from the list above</li>
                    <li>Click on it to start playback</li>
                    <li>In Discord, click the screen share button</li>
                    <li>Share this browser window</li>
                    <li>Use fullscreen for best experience</li>
                </ol>
            </div>
        `;

        return `
        <!DOCTYPE html>
        <html>
        <head>
            <title>🎵 Ative Music - Video Player</title>
            <style>
                body { 
                    font-family: 'Segoe UI', Arial, sans-serif; 
                    max-width: 900px; 
                    margin: 0 auto; 
                    padding: 20px; 
                    background: #1a1a1a; 
                    color: #fff;
                }
                .header {
                    text-align: center;
                    margin-bottom: 30px;
                    border-bottom: 2px solid #333;
                    padding-bottom: 20px;
                }
                .video-container { 
                    text-align: center; 
                    margin: 20px 0; 
                    background: #222;
                    padding: 20px;
                    border-radius: 10px;
                }
                .video-list {
                    display: grid;
                    gap: 15px;
                    margin: 20px 0;
                }
                .video-item {
                    background: #2a2a2a;
                    padding: 15px;
                    border-radius: 8px;
                    border: 1px solid #444;
                    cursor: pointer;
                    transition: all 0.3s ease;
                }
                .video-item:hover {
                    background: #333;
                    border-color: #666;
                    transform: translateY(-2px);
                }
                .controls {
                    text-align: center;
                    margin: 20px 0;
                }
                .controls button {
                    margin: 5px;
                    padding: 10px 20px;
                    background: #5865F2;
                    color: white;
                    border: none;
                    border-radius: 5px;
                    cursor: pointer;
                    font-size: 14px;
                }
                .controls button:hover {
                    background: #4752C4;
                }
                .instructions {
                    background: #2a2a2a;
                    padding: 20px;
                    border-radius: 10px;
                    margin: 20px 0;
                }
                .status {
                    text-align: center;
                    padding: 20px;
                    background: #2a2a2a;
                    border-radius: 10px;
                    margin: 20px 0;
                }
                .no-videos {
                    text-align: center;
                    padding: 40px;
                    background: #2a2a2a;
                    border-radius: 10px;
                    color: #aaa;
                }
            </style>
        </head>
        <body>
            <div class="header">
                <h1>🎵 Ative Music - Video Player</h1>
                <p>Perfect for Discord screen sharing!</p>
            </div>
            
            ${videoSection}
            
            <script>
                ${videoId ? '' : `
                // Load video list
                fetch('/api/videos')
                    .then(response => response.json())
                    .then(videos => {
                        const videoList = document.getElementById('videoList');
                        if (videos.length === 0) {
                            videoList.innerHTML = '<div class="no-videos"><h3>No cached videos</h3><p>Use the Discord bot to cache videos first!</p></div>';
                            return;
                        }
                        
                        const videoGrid = videos.map(video => 
                            \`<div class="video-item" onclick="location.href='/play/\${video.id}'">
                                <h3>📺 \${video.id}</h3>
                                <p>Size: \${video.size} | Modified: \${new Date(video.modified).toLocaleString()}</p>
                            </div>\`
                        ).join('');
                        
                        videoList.innerHTML = '<div class="video-list">' + videoGrid + '</div>';
                    })
                    .catch(error => {
                        document.getElementById('videoList').innerHTML = '<div class="status">❌ Failed to load videos</div>';
                    });
                `}
                
                function toggleFullscreen() {
                    const video = document.querySelector('video');
                    if (video.requestFullscreen) {
                        video.requestFullscreen();
                    } else if (video.webkitRequestFullscreen) {
                        video.webkitRequestFullscreen();
                    }
                }
                
                // Auto-play and sync controls
                ${videoId ? `
                document.addEventListener('DOMContentLoaded', function() {
                    const video = document.querySelector('video');
                    if (video) {
                        video.addEventListener('loadstart', () => console.log('🎬 Video loading...'));
                        video.addEventListener('canplay', () => console.log('✅ Video ready to play'));
                        video.addEventListener('play', () => console.log('▶️ Video playing'));
                        video.addEventListener('pause', () => console.log('⏸️ Video paused'));
                    }
                });
                ` : ''}
            </script>
        </body>
        </html>
        `;
    }

    formatBytes(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    async start() {
        return new Promise((resolve, reject) => {
            if (this.isRunning) {
                resolve(`Server already running on http://localhost:${this.port}`);
                return;
            }

            this.server = this.app.listen(this.port, 'localhost', (error) => {
                if (error) {
                    reject(error);
                    return;
                }
                
                this.isRunning = true;
                const url = `http://localhost:${this.port}`;
                console.log(`🌐 Local video server started at ${url}`);
                resolve(url);
            });
        });
    }

    stop() {
        return new Promise((resolve) => {
            if (!this.isRunning || !this.server) {
                resolve();
                return;
            }

            this.server.close(() => {
                this.isRunning = false;
                console.log('🛑 Local video server stopped');
                resolve();
            });
        });
    }

    getVideoUrl(videoId) {
        return `http://localhost:${this.port}/play/${videoId}`;
    }

    getServerUrl() {
        return `http://localhost:${this.port}`;
    }

    isVideoAvailable(videoId) {
        const videoPath = path.join(this.cacheDir, `${videoId}.mp4`);
        return fs.existsSync(videoPath);
    }
}

module.exports = LocalVideoServer;