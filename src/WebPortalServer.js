const express = require('express');
const { getVoiceConnection } = require('@discordjs/voice');

class WebPortalServer {
  constructor(bot) {
    this.bot = bot;
    this.app = express();
    this.port = process.env.WEB_PORT || 25567;
    this.host = process.env.WEB_HOST || '0.0.0.0';
    this.publicHost = process.env.PUBLIC_HOST || process.env.SERVER_HOST || process.env.HOST || 'localhost';
    this.publicPort = process.env.PUBLIC_PORT || process.env.SERVER_PORT || process.env.WEB_PORT || 25567;
    this.apiToken = process.env.WEB_API_TOKEN || null;
    
    this.setupRoutes();
  }

  auth(req, res, next) {
    // Simple auth bypass for now
    next();
  }

  setupRoutes() {
    this.app.use(express.json());

    // Ultra-Modern Web Player UI inspired by Spotify/Apple Music
    this.app.get('/', (req, res) => {
      const base = `http://${this.publicHost}:${this.publicPort}`;
      const hasAuth = Boolean(this.apiToken);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      
      const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Ative Music</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet">
  <style>
    :root {
      --primary-bg: #0d1117;
      --secondary-bg: #161b22;
      --tertiary-bg: #21262d;
      --surface: #30363d;
      --surface-hover: #484f58;
      --border: #30363d;
      --text-primary: #f0f6fc;
      --text-secondary: #8b949e;
      --text-muted: #656d76;
      --accent: #238636;
      --accent-hover: #2ea043;
      --accent-light: rgba(35, 134, 54, 0.15);
      --danger: #da3633;
      --warning: #ffa500;
      --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.12);
      --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.15);
      --shadow-lg: 0 10px 25px rgba(0, 0, 0, 0.25);
      --shadow-xl: 0 20px 40px rgba(0, 0, 0, 0.35);
      --gradient-primary: linear-gradient(135deg, #238636 0%, #2ea043 100%);
      --gradient-surface: linear-gradient(145deg, #21262d 0%, #30363d 100%);
      --blur: blur(20px);
    }
    
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: var(--primary-bg);
      color: var(--text-primary);
      line-height: 1.6;
      overflow-x: hidden;
      min-height: 100vh;
      padding-bottom: 100px;
    }
    
    /* Header */
    .header {
      background: rgba(13, 17, 23, 0.95);
      backdrop-filter: var(--blur);
      border-bottom: 1px solid var(--border);
      padding: 1rem 0;
      position: sticky;
      top: 0;
      z-index: 100;
    }
    
    .header-content {
      max-width: 1400px;
      margin: 0 auto;
      padding: 0 2rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    
    .logo {
      font-size: 1.5rem;
      font-weight: 700;
      background: var(--gradient-primary);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    
    .connection-status {
      display: flex;
      align-items: center;
      gap: 1rem;
      background: var(--surface);
      padding: 0.5rem 1rem;
      border-radius: 50px;
      font-size: 0.875rem;
      border: 1px solid var(--border);
    }
    
    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--danger);
      animation: pulse 2s infinite;
    }
    
    .status-dot.connected {
      background: var(--accent);
    }
    
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.6; }
    }
    
    /* Main Layout */
    .main-container {
      max-width: 1400px;
      margin: 0 auto;
      padding: 2rem;
      display: grid;
      grid-template-columns: 300px 1fr;
      gap: 2rem;
      min-height: calc(100vh - 200px);
    }
    
    /* Sidebar */
    .sidebar {
      background: var(--gradient-surface);
      border-radius: 20px;
      padding: 2rem;
      border: 1px solid var(--border);
      box-shadow: var(--shadow-lg);
      height: fit-content;
      position: sticky;
      top: 120px;
    }
    
    .sidebar h3 {
      font-size: 1rem;
      font-weight: 600;
      margin-bottom: 1.5rem;
      color: var(--text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    
    .form-group {
      margin-bottom: 1.5rem;
    }
    
    .form-group label {
      display: block;
      font-size: 0.875rem;
      font-weight: 500;
      margin-bottom: 0.5rem;
      color: var(--text-secondary);
    }
    
    .form-control {
      width: 100%;
      padding: 0.75rem 1rem;
      background: var(--tertiary-bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      color: var(--text-primary);
      font-size: 0.875rem;
      transition: all 0.2s ease;
    }
    
    .form-control:focus {
      outline: none;
      border-color: var(--accent);
      box-shadow: 0 0 0 3px var(--accent-light);
    }
    
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      padding: 0.75rem 1.5rem;
      background: var(--gradient-primary);
      color: white;
      border: none;
      border-radius: 12px;
      font-size: 0.875rem;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s ease;
      text-decoration: none;
      box-shadow: var(--shadow-sm);
    }
    
    .btn:hover {
      transform: translateY(-1px);
      box-shadow: var(--shadow-md);
    }
    
    .btn:active {
      transform: translateY(0);
    }
    
    .btn-secondary {
      background: var(--surface);
      color: var(--text-primary);
      border: 1px solid var(--border);
    }
    
    .btn-secondary:hover {
      background: var(--surface-hover);
    }
    
    .btn-danger {
      background: linear-gradient(135deg, #da3633 0%, #ff4444 100%);
    }
    
    .btn-small {
      padding: 0.5rem 1rem;
      font-size: 0.75rem;
      border-radius: 8px;
    }
    
    .btn-icon {
      padding: 0.5rem;
      border-radius: 8px;
      width: 36px;
      height: 36px;
    }
    
    /* Content Area */
    .content {
      display: flex;
      flex-direction: column;
      gap: 2rem;
    }
    
    .section {
      background: var(--gradient-surface);
      border-radius: 20px;
      padding: 2rem;
      border: 1px solid var(--border);
      box-shadow: var(--shadow-lg);
    }
    
    .section-header {
      display: flex;
      align-items: center;
      justify-content: between;
      margin-bottom: 1.5rem;
    }
    
    .section-title {
      font-size: 1.25rem;
      font-weight: 600;
      color: var(--text-primary);
    }
    
    /* Search */
    .search-container {
      position: relative;
    }
    
    .search-input {
      width: 100%;
      padding: 1rem 1rem 1rem 3rem;
      background: var(--tertiary-bg);
      border: 1px solid var(--border);
      border-radius: 50px;
      color: var(--text-primary);
      font-size: 1rem;
      transition: all 0.2s ease;
    }
    
    .search-input:focus {
      outline: none;
      border-color: var(--accent);
      box-shadow: 0 0 0 3px var(--accent-light);
    }
    
    .search-icon {
      position: absolute;
      left: 1rem;
      top: 50%;
      transform: translateY(-50%);
      color: var(--text-muted);
      font-size: 1rem;
    }
    
    .search-btn {
      position: absolute;
      right: 0.5rem;
      top: 50%;
      transform: translateY(-50%);
      background: var(--gradient-primary);
      border: none;
      border-radius: 50px;
      padding: 0.5rem 1.5rem;
      color: white;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s ease;
    }
    
    /* Track Grid */
    .track-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 1.5rem;
      margin-top: 1.5rem;
    }
    
    .track-card {
      background: var(--surface);
      border-radius: 16px;
      padding: 1.5rem;
      border: 1px solid var(--border);
      transition: all 0.3s ease;
      cursor: pointer;
      position: relative;
      overflow: hidden;
    }
    
    .track-card:hover {
      transform: translateY(-4px);
      box-shadow: var(--shadow-xl);
      border-color: var(--accent);
    }
    
    .track-card::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 3px;
      background: var(--gradient-primary);
      transform: scaleX(0);
      transition: transform 0.3s ease;
    }
    
    .track-card:hover::before {
      transform: scaleX(1);
    }
    
    .track-thumbnail {
      width: 100%;
      height: 160px;
      background: var(--tertiary-bg);
      border-radius: 12px;
      margin-bottom: 1rem;
      position: relative;
      overflow: hidden;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    
    .track-thumbnail img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    
    .track-thumbnail .fallback-icon {
      font-size: 3rem;
      color: var(--text-muted);
    }
    
    .track-info {
      margin-bottom: 1rem;
    }
    
    .track-title {
      font-size: 1rem;
      font-weight: 600;
      color: var(--text-primary);
      margin-bottom: 0.25rem;
      line-height: 1.3;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    
    .track-artist {
      font-size: 0.875rem;
      color: var(--text-secondary);
      display: -webkit-box;
      -webkit-line-clamp: 1;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    
    .track-meta {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 1rem;
      font-size: 0.75rem;
      color: var(--text-muted);
    }
    
    .track-source {
      display: flex;
      align-items: center;
      gap: 0.25rem;
      background: var(--accent-light);
      color: var(--accent);
      padding: 0.25rem 0.5rem;
      border-radius: 6px;
      font-weight: 500;
    }
    
    .track-actions {
      display: flex;
      gap: 0.5rem;
    }
    
    .play-btn {
      flex: 1;
      background: var(--gradient-primary);
      color: white;
      border: none;
      border-radius: 8px;
      padding: 0.75rem;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s ease;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
    }
    
    .play-btn:hover {
      transform: translateY(-1px);
      box-shadow: var(--shadow-md);
    }
    
    .play-btn.loading {
      background: var(--surface);
      color: var(--text-secondary);
      cursor: not-allowed;
    }
    
    .queue-btn {
      background: var(--surface);
      color: var(--text-secondary);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 0.75rem;
      cursor: pointer;
      transition: all 0.2s ease;
    }
    
    .queue-btn:hover {
      background: var(--surface-hover);
      color: var(--text-primary);
    }
    
    /* Loading Spinner */
    .spinner {
      width: 16px;
      height: 16px;
      border: 2px solid transparent;
      border-top: 2px solid currentColor;
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }
    
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    
    /* Bottom Player */
    .bottom-player {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      background: rgba(22, 27, 34, 0.95);
      backdrop-filter: var(--blur);
      border-top: 1px solid var(--border);
      padding: 1rem 2rem;
      z-index: 1000;
      display: flex;
      align-items: center;
      gap: 2rem;
    }
    
    .player-track-info {
      display: flex;
      align-items: center;
      gap: 1rem;
      min-width: 300px;
    }
    
    .player-thumbnail {
      width: 50px;
      height: 50px;
      background: var(--surface);
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
    }
    
    .player-thumbnail img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    
    .player-text {
      flex: 1;
    }
    
    .player-title {
      font-size: 0.875rem;
      font-weight: 500;
      color: var(--text-primary);
      margin-bottom: 0.25rem;
    }
    
    .player-artist {
      font-size: 0.75rem;
      color: var(--text-secondary);
    }
    
    .player-controls {
      display: flex;
      align-items: center;
      gap: 1rem;
      flex: 1;
      justify-content: center;
    }
    
    .control-btn {
      background: transparent;
      border: none;
      color: var(--text-secondary);
      font-size: 1.25rem;
      cursor: pointer;
      padding: 0.5rem;
      border-radius: 50%;
      transition: all 0.2s ease;
    }
    
    .control-btn:hover {
      color: var(--text-primary);
      background: var(--surface);
    }
    
    .control-btn.primary {
      background: var(--gradient-primary);
      color: white;
      font-size: 1rem;
      width: 40px;
      height: 40px;
    }
    
    .progress-section {
      flex: 1;
      max-width: 500px;
    }
    
    .progress-bar {
      width: 100%;
      height: 4px;
      background: var(--surface);
      border-radius: 2px;
      cursor: pointer;
      position: relative;
      margin: 0.5rem 0;
    }
    
    .progress-fill {
      height: 100%;
      background: var(--gradient-primary);
      border-radius: 2px;
      width: 0%;
      transition: width 0.1s ease;
    }
    
    .progress-times {
      display: flex;
      justify-content: space-between;
      font-size: 0.75rem;
      color: var(--text-muted);
    }
    
    /* Queue Section */
    .queue-list {
      margin-top: 1rem;
    }
    
    .queue-item {
      display: flex;
      align-items: center;
      gap: 1rem;
      padding: 0.75rem;
      background: var(--surface);
      border-radius: 12px;
      margin-bottom: 0.5rem;
      border: 1px solid var(--border);
      transition: all 0.2s ease;
    }
    
    .queue-item:hover {
      background: var(--surface-hover);
    }
    
    .queue-item.current {
      border-color: var(--accent);
      background: var(--accent-light);
    }
    
    /* Responsive */
    @media (max-width: 1024px) {
      .main-container {
        grid-template-columns: 1fr;
        gap: 1rem;
      }
      
      .sidebar {
        position: static;
      }
      
      .track-grid {
        grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
      }
    }
    
    /* Loading Spinner */
    .spinner {
      display: inline-block;
      width: 12px;
      height: 12px;
      border: 2px solid rgba(255,255,255,0.3);
      border-radius: 50%;
      border-top-color: #fff;
      animation: spin 1s ease-in-out infinite;
    }
    
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    
    .loading {
      opacity: 0.7;
      cursor: not-allowed !important;
    }
    
    @media (max-width: 768px) {
      .main-container {
        padding: 1rem;
      }
      
      .section {
        padding: 1.5rem;
      }
      
      .track-grid {
        grid-template-columns: 1fr;
      }
      
      .bottom-player {
        flex-direction: column;
        gap: 1rem;
        padding: 1rem;
      }
      
      .player-controls {
        order: -1;
      }
    }
    
    /* Empty States */
    .empty-state {
      text-align: center;
      padding: 3rem;
      color: var(--text-muted);
    }
    
    .empty-state i {
      font-size: 3rem;
      margin-bottom: 1rem;
      opacity: 0.5;
    }
    
    /* Notifications */
    .notification {
      position: fixed;
      top: 1rem;
      right: 1rem;
      background: var(--surface);
      color: var(--text-primary);
      padding: 1rem 1.5rem;
      border-radius: 12px;
      border: 1px solid var(--border);
      box-shadow: var(--shadow-lg);
      z-index: 1001;
      transform: translateX(100%);
      transition: transform 0.3s ease;
    }
    
    .notification.show {
      transform: translateX(0);
    }
    
    .notification.success {
      border-color: var(--accent);
      background: var(--accent-light);
    }
    
    .notification.error {
      border-color: var(--danger);
      background: rgba(218, 54, 51, 0.15);
    }
  </style>
</head>
<body>
  <!-- Header -->
  <div class="header">
    <div class="header-content">
      <div class="logo">
        <i class="fas fa-music"></i> Ative Music
      </div>
      <div class="connection-status">
        <div class="status-dot" id="status-dot"></div>
        <span id="connection-text">Disconnected</span>
      </div>
    </div>
  </div>

  <!-- Main Container -->
  <div class="main-container">
    <!-- Sidebar -->
    <div class="sidebar">
      <h3>Connection</h3>
      
      <div class="form-group">
        <label>Server</label>
        <select class="form-control" id="guild">
          <option value="">Select server...</option>
        </select>
      </div>
      
      <div class="form-group">
        <label>Voice Channel</label>
        <select class="form-control" id="channel">
          <option value="">Select channel...</option>
        </select>
      </div>
      
      <div style="display: flex; gap: 0.5rem; margin-bottom: 2rem;">
        <button class="btn btn-small" id="connect">
          <i class="fas fa-plug"></i> Connect
        </button>
        <button class="btn btn-secondary btn-small" id="disconnect">
          <i class="fas fa-times"></i> Disconnect
        </button>
      </div>
      
      <h3>Quick Actions</h3>
      
      <div style="display: flex; flex-direction: column; gap: 0.5rem;">
        <button class="btn btn-secondary btn-small" id="btn-shuffle">
          <i class="fas fa-random"></i> Shuffle
        </button>
        <button class="btn btn-secondary btn-small" id="btn-repeat">
          <i class="fas fa-repeat"></i> Repeat
        </button>
      </div>
    </div>

    <!-- Content -->
    <div class="content">
      <!-- Search Section -->
      <div class="section">
        <div class="section-header">
          <h2 class="section-title">
            <i class="fas fa-search"></i> Search Music
          </h2>
        </div>
        
        <div class="search-container">
          <i class="fas fa-search search-icon"></i>
          <input type="text" class="search-input" id="search" placeholder="Search for songs, artists, or playlists..." />
          <button class="search-btn" id="search-btn">Search</button>
        </div>
        
        <div id="results" class="track-grid"></div>
      </div>

      <!-- Queue Section -->
      <div class="section">
        <div class="section-header">
          <h2 class="section-title">
            <i class="fas fa-list"></i> Queue
          </h2>
        </div>
        
        <div id="queue" class="queue-list">
          <div class="empty-state">
            <i class="fas fa-music"></i>
            <p>No tracks in queue</p>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Bottom Player -->
  <div class="bottom-player">
    <div class="player-track-info">
      <div class="player-thumbnail" id="player-thumbnail">
        <i class="fas fa-music"></i>
      </div>
      <div class="player-text">
        <div class="player-title" id="player-title">No track playing</div>
        <div class="player-artist" id="player-artist">Select a song to play</div>
      </div>
    </div>
    
    <div class="player-controls">
      <button class="control-btn" id="btn-prev">
        <i class="fas fa-step-backward"></i>
      </button>
      <button class="control-btn primary" id="btn-play">
        <i class="fas fa-play"></i>
      </button>
      <button class="control-btn" id="btn-next">
        <i class="fas fa-step-forward"></i>
      </button>
    </div>
    
    <div class="progress-section">
      <div class="progress-times">
        <span id="current-time">0:00</span>
        <span id="total-time">0:00</span>
      </div>
      <div class="progress-bar" id="progress-bar">
        <div class="progress-fill" id="progress-fill"></div>
      </div>
    </div>
  </div>

  <!-- Notification Area -->
  <div id="notification" class="notification"></div>

  <script>
    const BASE = '${base}';
    let currentGuild = null;
    let currentChannel = null;
    let currentTrack = null;
    let isPlaying = false;
    let currentTime = 0;
    let totalTime = 0;

    // DOM Elements
    const els = {
      guild: document.getElementById('guild'),
      channel: document.getElementById('channel'),
      search: document.getElementById('search'),
      results: document.getElementById('results'),
      queue: document.getElementById('queue'),
      statusDot: document.getElementById('status-dot'),
      connectionText: document.getElementById('connection-text'),
      playerTitle: document.getElementById('player-title'),
      playerArtist: document.getElementById('player-artist'),
      playerThumbnail: document.getElementById('player-thumbnail'),
      btnPlay: document.getElementById('btn-play'),
      btnPrev: document.getElementById('btn-prev'),
      btnNext: document.getElementById('btn-next'),
      btnShuffle: document.getElementById('btn-shuffle'),
      btnRepeat: document.getElementById('btn-repeat'),
      progressBar: document.getElementById('progress-bar'),
      progressFill: document.getElementById('progress-fill'),
      currentTime: document.getElementById('current-time'),
      totalTime: document.getElementById('total-time'),
      notification: document.getElementById('notification')
    };

    // Initialize
    window.addEventListener('load', () => {
      loadGuilds();
      updateStatus();
      setInterval(updateStatus, 5000);
    });

    // Helper Functions
    function headers() {
      return { 'Content-Type': 'application/json' };
    }

    function showNotification(message, type = 'info') {
      els.notification.textContent = message;
      els.notification.className = \`notification show \${type}\`;
      setTimeout(() => {
        els.notification.classList.remove('show');
      }, 3000);
    }

    function formatTime(seconds) {
      const mins = Math.floor(seconds / 60);
      const secs = Math.floor(seconds % 60);
      return \`\${mins}:\${secs.toString().padStart(2, '0')}\`;
    }

    // API Functions
    async function loadGuilds() {
      try {
        const response = await fetch(BASE + '/api/guilds');
        const guilds = await response.json();
        
        els.guild.innerHTML = '<option value="">Select server...</option>';
        guilds.forEach(guild => {
          const option = document.createElement('option');
          option.value = guild.id;
          option.textContent = guild.name;
          els.guild.appendChild(option);
        });
        
        // Restore saved guild from localStorage
        const savedGuildId = localStorage.getItem('musicBot_guildId');
        if (savedGuildId && guilds.find(g => g.id === savedGuildId)) {
          els.guild.value = savedGuildId;
          currentGuild = savedGuildId;
          loadChannels(); // Auto-load channels for saved guild
        }
      } catch (error) {
        showNotification('Failed to load servers', 'error');
      }
    }

    async function loadChannels() {
      const guildId = els.guild.value;
      if (!guildId) return;
      
      try {
        const response = await fetch(BASE + '/api/channels/' + guildId);
        const data = await response.json();
        const channels = data.channels || data; // Handle both old and new response formats
        
        els.channel.innerHTML = '<option value="">Select channel...</option>';
        channels.forEach(channel => {
          const option = document.createElement('option');
          option.value = channel.id;
          option.textContent = channel.name + (channel.connected ? ' (🔌 Connected)' : '');
          els.channel.appendChild(option);
        });
        
        // Auto-select connected channel if available, otherwise restore from localStorage
        if (data.connectedChannel) {
          els.channel.value = data.connectedChannel;
          currentChannel = data.connectedChannel;
          showNotification('Bot already connected to this channel', 'success');
        } else {
          // Restore saved channel from localStorage
          const savedChannelId = localStorage.getItem('musicBot_channelId');
          if (savedChannelId && channels.find(c => c.id === savedChannelId)) {
            els.channel.value = savedChannelId;
            currentChannel = savedChannelId;
          }
        }
      } catch (error) {
        showNotification('Failed to load channels', 'error');
      }
    }

    async function searchMusic() {
      const query = els.search.value.trim();
      if (!query) return;

      try {
        showNotification('Searching...', 'info');
        const response = await fetch(BASE + '/api/search', {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify({ query })
        });
        
        const results = await response.json();
        displayResults(results);
        showNotification(\`Found \${results.length} results\`, 'success');
      } catch (error) {
        showNotification('Search failed', 'error');
      }
    }

    function displayResults(results) {
      if (!results || results.length === 0) {
        els.results.innerHTML = \`
          <div class="empty-state">
            <i class="fas fa-search"></i>
            <p>No results found</p>
          </div>
        \`;
        return;
      }

      els.results.innerHTML = results.map(track => \`
        <div class="track-card">
          <div class="track-thumbnail">
            \${track.thumbnail ? 
              \`<img src="\${track.thumbnail}" alt="\${track.title}" onerror="this.style.display='none'" />\` :
              \`<i class="fas fa-music fallback-icon"></i>\`
            }
          </div>
          <div class="track-info">
            <div class="track-title">\${track.title}</div>
            <div class="track-artist">\${track.author}</div>
          </div>
          <div class="track-meta">
            <span class="track-source">
              <i class="fab fa-\${track.source === 'youtube' ? 'youtube' : 'spotify'}"></i>
              \${track.source}
            </span>
            <span>\${track.duration || 'Unknown'}</span>
          </div>
          <div class="track-actions">
            <button class="play-btn" onclick="playTrack('\${track.url}', this)">
              <i class="fas fa-play"></i> Play
            </button>
            <button class="queue-btn" onclick="queueTrack('\${track.url}')">
              <i class="fas fa-plus"></i>
            </button>
          </div>
        </div>
      \`).join('');
    }

    async function updateStatus() {
      try {
        const response = await fetch(BASE + '/api/status');
        const data = await response.json();
        
        // Update connection status
        if (data.connected) {
          els.statusDot.classList.add('connected');
          els.connectionText.textContent = \`Connected to \${data.channel || 'Voice Channel'}\`;
        } else {
          els.statusDot.classList.remove('connected');
          els.connectionText.textContent = 'Disconnected';
        }

        // Update player
        if (data.currentTrack) {
          updatePlayer(data.currentTrack, data.isPlaying, data.currentTime, data.totalTime);
        }

        // Update queue
        if (data.queue) {
          updateQueue(data.queue, data.currentIndex);
        }
      } catch (error) {
        console.error('Status update failed:', error);
      }
    }

    function updatePlayer(track, playing, current, total) {
      currentTrack = track;
      isPlaying = playing;
      currentTime = current || 0;
      totalTime = total || 0;

      els.playerTitle.textContent = track.title || 'No track playing';
      els.playerArtist.textContent = track.author || 'Select a song to play';
      
      if (track.thumbnail) {
        els.playerThumbnail.innerHTML = \`<img src="\${track.thumbnail}" alt="\${track.title}" />\`;
      } else {
        els.playerThumbnail.innerHTML = '<i class="fas fa-music"></i>';
      }

      // Update play button
      els.btnPlay.innerHTML = playing ? 
        '<i class="fas fa-pause"></i>' : 
        '<i class="fas fa-play"></i>';

      // Update progress
      const progressPercent = totalTime > 0 ? (currentTime / totalTime) * 100 : 0;
      els.progressFill.style.width = progressPercent + '%';
      els.currentTime.textContent = formatTime(currentTime);
      els.totalTime.textContent = formatTime(totalTime);
    }

    function updateQueue(queue, currentIndex) {
      if (!queue || queue.length === 0) {
        els.queue.innerHTML = \`
          <div class="empty-state">
            <i class="fas fa-music"></i>
            <p>No tracks in queue</p>
          </div>
        \`;
        return;
      }

      els.queue.innerHTML = queue.map((track, index) => \`
        <div class="queue-item \${index === currentIndex ? 'current' : ''}">
          <div style="width: 40px; height: 40px; background: var(--surface); border-radius: 8px; display: flex; align-items: center; justify-content: center; overflow: hidden;">
            \${track.thumbnail ? 
              \`<img src="\${track.thumbnail}" style="width: 100%; height: 100%; object-fit: cover;" />\` :
              \`<i class="fas fa-music"></i>\`
            }
          </div>
          <div style="flex: 1;">
            <div style="font-weight: 500; color: var(--text-primary);">\${track.title}</div>
            <div style="font-size: 0.875rem; color: var(--text-secondary);">\${track.author}</div>
          </div>
          <div style="display: flex; gap: 0.5rem;">
            <button class="btn btn-small" onclick="control('jump', null, {index: \${index}})">
              <i class="fas fa-play"></i>
            </button>
            <button class="btn btn-secondary btn-small" onclick="control('remove', null, {index: \${index}})">
              <i class="fas fa-times"></i>
            </button>
          </div>
        </div>
      \`).join('');
    }

    // Player Functions
    window.playTrack = async (url, button) => {
      if (!currentGuild || !currentChannel) {
        showNotification('Please select a server and channel first', 'error');
        return;
      }

      // Show loading state
      if (button) {
        const originalHTML = button.innerHTML;
        button.innerHTML = '<div class="spinner"></div> Loading...';
        button.classList.add('loading');
        button.disabled = true;
      }

      try {
        const response = await fetch(BASE + '/api/play', {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify({
            guildId: currentGuild,
            channelId: currentChannel,
            query: url
          })
        });

        const result = await response.json();
        
        if (result.success) {
          showNotification('Track started playing!', 'success');
          updateStatus(); // Refresh player state
        } else {
          showNotification(result.error || 'Failed to play track', 'error');
        }
      } catch (error) {
        showNotification('Failed to play track', 'error');
      } finally {
        // Reset button state
        if (button) {
          button.innerHTML = '<i class="fas fa-play"></i> Play';
          button.classList.remove('loading');
          button.disabled = false;
        }
      }
    };

    window.queueTrack = async (url) => {
      if (!currentGuild || !currentChannel) {
        showNotification('Please select a server and channel first', 'error');
        return;
      }

      try {
        const response = await fetch(BASE + '/api/queue', {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify({
            guildId: currentGuild,
            channelId: currentChannel,
            query: url
          })
        });

        const result = await response.json();
        
        if (result.success) {
          showNotification('Track added to queue!', 'success');
          updateStatus();
        } else {
          showNotification(result.error || 'Failed to queue track', 'error');
        }
      } catch (error) {
        showNotification('Failed to queue track', 'error');
      }
    };

    window.control = async (action, value, options) => {
      try {
        const response = await fetch(BASE + '/api/control', {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify({
            guildId: currentGuild,
            channelId: currentChannel,
            action,
            value,
            ...options
          })
        });

        const result = await response.json();
        
        if (result.success) {
          showNotification(\`\${action} executed\`, 'success');
          updateStatus();
        } else {
          showNotification(result.error || \`Failed to \${action}\`, 'error');
        }
      } catch (error) {
        showNotification(\`Failed to \${action}\`, 'error');
      }
    };

    // Event Listeners
    els.guild.addEventListener('change', () => {
      currentGuild = els.guild.value;
      localStorage.setItem('musicBot_guildId', currentGuild); // Save to localStorage
      loadChannels();
    });

    els.channel.addEventListener('change', () => {
      currentChannel = els.channel.value;
      localStorage.setItem('musicBot_channelId', currentChannel); // Save to localStorage
    });

    els.search.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        searchMusic();
      }
    });

    document.getElementById('search-btn').addEventListener('click', searchMusic);
    document.getElementById('connect').addEventListener('click', () => control('connect'));
    document.getElementById('disconnect').addEventListener('click', () => control('disconnect'));

    els.btnPlay.addEventListener('click', () => {
      if (isPlaying) {
        control('pause');
      } else {
        control('resume');
      }
    });

    els.btnPrev.addEventListener('click', () => control('previous'));
    els.btnNext.addEventListener('click', () => control('skip'));
    els.btnShuffle.addEventListener('click', () => control('shuffle'));
    els.btnRepeat.addEventListener('click', () => control('repeat'));

    els.progressBar.addEventListener('click', async (e) => {
      if (!currentTrack || totalTime === 0) return;
      
      const rect = els.progressBar.getBoundingClientRect();
      const percent = (e.clientX - rect.left) / rect.width;
      const seekTime = Math.floor(percent * totalTime);
      
      await control('seek', seekTime);
    });

    // Auto-refresh status
    setInterval(updateStatus, 2000);
  </script>
</body>
</html>`;
      
      res.send(html);
    });

    // API Routes
    this.app.get('/api/guilds', this.auth, (req, res) => {
      try {
        const guilds = this.bot.client.guilds.cache.map(guild => ({
          id: guild.id,
          name: guild.name,
          memberCount: guild.memberCount
        }));
        res.json(guilds);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.get('/api/channels/:guildId', this.auth, (req, res) => {
      try {
        const guild = this.bot.client.guilds.cache.get(req.params.guildId);
        if (!guild) return res.status(404).json({ error: 'Guild not found' });

        // Check if bot is already connected to a voice channel in this guild
        const existingConnection = this.bot.client.voice?.connections?.get(guild.id);
        let connectedChannelId = null;
        
        if (existingConnection && existingConnection.joinConfig) {
          connectedChannelId = existingConnection.joinConfig.channelId;
          console.log(`🎵 Bot already connected to channel ${connectedChannelId} in guild ${guild.name}`);
        }

        const channels = guild.channels.cache
          .filter(channel => channel.type === 2) // Voice channels
          .map(channel => ({
            id: channel.id,
            name: channel.name,
            memberCount: channel.members.size,
            connected: channel.id === connectedChannelId // Mark if bot is connected
          }));
        
        res.json({ 
          channels,
          connectedChannel: connectedChannelId // Send the connected channel ID
        });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.post('/api/search', this.auth, async (req, res) => {
      try {
        const { query } = req.body;
        if (!query) return res.status(400).json({ error: 'Query required' });

        console.log(`🔍 Web portal search: ${query}`);
        const results = await this.bot.sourceHandlers.search(query, 12);
        
        res.json(results || []);
      } catch (error) {
        console.error('Search error:', error);
        res.status(500).json({ error: error.message });
      }
    });

    this.app.post('/api/play', this.auth, async (req, res) => {
      try {
        const { guildId, channelId, query } = req.body;
        
        if (!guildId || !channelId || !query) {
          return res.status(400).json({ error: 'Missing required fields' });
        }

        console.log(`🎵 Play request from web portal: ${query} in guild ${guildId}, channel ${channelId}`);

        const guild = this.bot.client.guilds.cache.get(guildId);
        if (!guild) return res.status(404).json({ error: 'Guild not found' });

        const channel = guild.channels.cache.get(channelId);
        if (!channel) return res.status(404).json({ error: 'Channel not found' });

        console.log(`🔌 Connecting to channel: ${channel.name}`);

        // Skip Discord Player - use built-in system directly (this was the working solution)
        console.log(`🔄 Bypassing Discord Player - using built-in system directly: ${query}`);
        
        // Find an appropriate text channel for this voice channel
        const textChannel = this.bot.getTextChannelForVoice(channelId, guild);
        
        // Go directly to built-in SourceHandlers (skip Discord Player entirely)
        console.log(`🔍 Using built-in SourceHandlers for: "${query}"`);
        
        // Store the text channel for this voice channel
        if (textChannel) {
          this.bot.musicTextChannels.set(channelId, textChannel.id);
          console.log(`📝 Stored text channel ${textChannel.id} for voice channel ${channelId} (built-in)`);
        }

        try {
          const results = await this.bot.sourceHandlers.search(query, 1);
          console.log(`✅ Found ${results.length} total results for: ${query}`);
          
          if (results.length === 0) {
            return res.status(404).json({ 
              error: 'No tracks found',
              message: `No results found for "${query}"`
            });
          }

          const track = results[0];
          console.log(`✅ Found via built-in search: ${track.title} from ${track.source}`);
          
          // Force bypass Discord Player completely
          console.log(`🔄 Bypassing Discord Player - using original MusicManager system`);
          
          // Use the working built-in system
          const mockInteraction = {
            guildId: guildId,
            channelId: textChannel?.id || guild.channels.cache.find(ch => ch.type === 0)?.id,
            channel: textChannel || guild.channels.cache.find(ch => ch.type === 0),
            member: {
            voice: {
              channel: channel
            }
          },
          deferReply: () => Promise.resolve(),
          editReply: () => Promise.resolve(),
          reply: () => Promise.resolve()
        };

        // Use the working built-in system directly (this was the solution that worked)
        console.log(`🔄 Using original system with found track: "${track.title}"`);
        
        // Connect to voice channel using the bot's connection logic (this is how it actually works)
        const { joinVoiceChannel } = require('@discordjs/voice');
        const connection = joinVoiceChannel({
          channelId: channel.id,
          guildId: guildId,
          adapterCreator: channel.guild.voiceAdapterCreator,
          selfDeaf: false,
          selfMute: false
        });
        
        // Get MusicManager and set the connection (this is the working pattern)
        const musicManager = this.bot.getMusicManager(guildId, channelId);
        musicManager.setConnection(connection);
        
        // Add track; MusicManager will auto-start if queue was empty
        const t0 = Date.now();
        // One-time timing hook to measure press-to-sound
        const prevOnStart = musicManager.onTrackStart;
        musicManager.onTrackStart = (trk) => {
          const dt = Date.now() - t0;
          console.log(`⏱️ Time from /api/play to Playing: ${dt}ms (${trk?.title || 'Unknown'})`);
          try { if (typeof prevOnStart === 'function') prevOnStart(trk); } catch {}
          // Restore original handler
          musicManager.onTrackStart = prevOnStart;
        };
        musicManager.addToQueue(track);
        
        const currentTime = Date.now();
        console.log(`⚡ Built-in search completed in ${currentTime - Date.now()}ms`);
        
        res.json({ success: true, message: 'Track queued and starting' });
        
        } catch (searchError) {
          console.error('Built-in search failed:', searchError);
          return res.status(500).json({ 
            success: false, 
            error: 'Failed to search for track',
            message: searchError.message 
          });
        }

      } catch (error) {
        console.error('Play error:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    this.app.post('/api/queue', this.auth, async (req, res) => {
      try {
        const { guildId, channelId, query } = req.body;
        
        if (!guildId || !channelId || !query) {
          return res.status(400).json({ error: 'Missing required fields' });
        }

        const musicManager = this.bot.musicManagers?.get(channelId);
        if (musicManager) {
          const results = await this.bot.sourceHandlers.search(query, 1);
          if (results && results.length > 0) {
            musicManager.addToQueue(results[0]);
            res.json({ success: true, message: 'Track added to queue' });
          } else {
            res.json({ success: false, error: 'No results found' });
          }
        } else {
          res.json({ success: false, error: 'No active music session' });
        }
      } catch (error) {
        console.error('Queue error:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    this.app.post('/api/control', this.auth, async (req, res) => {
      try {
        const { guildId, channelId, action, value, index } = req.body;
        
        if (!guildId || !channelId || !action) {
          return res.status(400).json({ error: 'Missing required fields' });
        }

        const guild = this.bot.client.guilds.cache.get(guildId);
        if (!guild) return res.status(404).json({ error: 'Guild not found' });

        const channel = guild.channels.cache.get(channelId);
        if (!channel) return res.status(404).json({ error: 'Channel not found' });

        let result = { success: true };

        switch (action) {
          case 'connect':
            await this.bot.stayConnectedManager.connectToChannel(channel);
            break;
          case 'disconnect':
            this.bot.stayConnectedManager.disconnect(guildId);
            break;
          case 'pause':
          case 'resume':
          case 'skip':
          case 'previous':
          case 'shuffle':
          case 'repeat':
            const musicManager = this.bot.musicManagers?.get(channelId);
            if (musicManager) {
              if (action === 'pause') musicManager.pause();
              else if (action === 'resume') musicManager.resume();
              else if (action === 'skip') musicManager.skip();
              else if (action === 'previous') musicManager.previous();
              else if (action === 'shuffle') musicManager.toggleShuffle();
              else if (action === 'repeat') musicManager.toggleRepeat();
            } else {
              result = { success: false, error: 'No active music session' };
            }
            break;
          case 'jump':
            const jumpManager = this.bot.musicManagers?.get(channelId);
            if (jumpManager && typeof index === 'number') {
              jumpManager.jumpTo(index);
            } else {
              result = { success: false, error: 'Invalid jump request' };
            }
            break;
          case 'remove':
            const removeManager = this.bot.musicManagers?.get(channelId);
            if (removeManager && typeof index === 'number') {
              removeManager.removeFromQueue(index);
            } else {
              result = { success: false, error: 'Invalid remove request' };
            }
            break;
          case 'seek':
            const seekManager = this.bot.musicManagers?.get(channelId);
            if (seekManager && seekManager.currentTrack && typeof value === 'number') {
              await seekManager.seek(value);
            } else {
              result = { success: false, error: 'Invalid seek request or no active track' };
            }
            break;
          default:
            result = { success: false, error: 'Unknown action' };
        }

        res.json(result);
      } catch (error) {
        console.error('Control error:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    this.app.get('/api/status', this.auth, (req, res) => {
      try {
        // Get the first connected voice channel (simplified)
        const connections = Array.from(this.bot.stayConnectedManager.connections.values());
        const connection = connections[0];
        
        let status = {
          connected: !!connection,
          channel: null,
          currentTrack: null,
          isPlaying: false,
          currentTime: 0,
          totalTime: 0,
          queue: [],
          currentIndex: -1
        };

        if (connection && connection.joinConfig) {
          const guild = this.bot.client.guilds.cache.get(connection.joinConfig.guildId);
          const channel = guild?.channels.cache.get(connection.joinConfig.channelId);
          
          if (channel) {
            status.channel = channel.name;
            
            // Get music manager for this channel
            const musicManager = this.bot.musicManagers?.get(channel.id);
            if (musicManager) {
              status.currentTrack = musicManager.currentTrack;
              status.isPlaying = musicManager.isPlaying && !musicManager.isPaused;
              
              // Calculate current time based on track start time
              if (musicManager.trackStartTime && musicManager.isPlaying && !musicManager.isPaused) {
                status.currentTime = Math.floor((Date.now() - musicManager.trackStartTime) / 1000);
              } else {
                status.currentTime = 0;
              }
              
              // Derive total time from track metadata when available
              try {
                if (musicManager.currentTrack?.durationMS) {
                  status.totalTime = Math.floor(musicManager.currentTrack.durationMS / 1000);
                } else if (musicManager.currentTrack?.duration) {
                  // Fallback: parse mm:ss
                  const parts = String(musicManager.currentTrack.duration).split(':').map(n => parseInt(n, 10));
                  status.totalTime = parts.reduce((acc, val) => acc * 60 + (isNaN(val) ? 0 : val), 0);
                } else {
                  status.totalTime = 180;
                }
              } catch { status.totalTime = 180; }
              status.queue = musicManager.queue || [];
              status.currentIndex = musicManager.currentTrackIndex || -1;
            }
          }
        }

        res.json(status);
      } catch (error) {
        console.error('Status error:', error);
        res.status(500).json({ error: error.message });
      }
    });
  }

  start() {
    return new Promise((resolve, reject) => {
      this.server = this.app.listen(this.port, this.host, (err) => {
        if (err) {
          reject(err);
        } else {
          console.log(`🌐 Web portal listening on http://${this.host}:${this.port}`);
          console.log(`🕸️ Web portal started: http://${this.publicHost}:${this.publicPort}`);
          resolve();
        }
      });
    });
  }

  stop() {
    if (this.server) {
      this.server.close();
    }
  }
}

module.exports = WebPortalServer;
