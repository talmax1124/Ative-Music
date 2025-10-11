const express = require('express');
const { getVoiceConnection } = require('@discordjs/voice');
const axios = require('axios');
const firebaseService = require('./FirebaseService.js');

class WebPortalServer {
  constructor(bot) {
    this.bot = bot;
    this.app = express();
    this.port = process.env.WEB_PORT || 25567;
    this.host = process.env.WEB_HOST || '0.0.0.0';
    this.publicHost = process.env.PUBLIC_HOST || process.env.SERVER_HOST || process.env.HOST || 'localhost';
    this.publicPort = process.env.PUBLIC_PORT || process.env.SERVER_PORT || process.env.WEB_PORT || 25567;
    this.apiToken = process.env.WEB_API_TOKEN || null;
    this.requireAuth = process.env.REQUIRE_DISCORD_AUTH === 'true';
    
    // Discord OAuth settings
    this.discordClientId = process.env.DISCORD_CLIENT_ID;
    this.discordClientSecret = process.env.DISCORD_CLIENT_SECRET;
    this.discordRedirectUri = `http://${this.publicHost}:${this.publicPort}/auth/discord/callback`;
    
    // Store SSE clients for progress updates
    this.progressClients = new Set();
    
    // In-memory session store (consider using Redis in production)
    this.sessions = new Map();
    
    this.setupRoutes();
    this.setupAuthRoutes();
    this.setupPlaylistRoutes();
    this.setupProgressListener();
  }

  auth = (req, res, next) => {
    // Check for Discord auth session or API token
    const sessionToken = req.headers['authorization']?.replace('Bearer ', '') || req.query.token;
    const discordUser = req.session?.discordUser;
    
    // Always allow access if no auth is required (default for now)
    if (!this.requireAuth) {
      req.user = discordUser || null;
      next();
      return;
    }
    
    // Check authentication if required
    if (discordUser || sessionToken === this.apiToken) {
      req.user = discordUser || null;
      next();
    } else {
      res.status(401).json({ error: 'Authentication required' });
    }
  }

  setupRoutes() {
    this.app.use(express.json());
    
    // Add CORS headers
    this.app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
      next();
    });

    // Simple session middleware - set up early
    this.app.use((req, res, next) => {
      const sessionId = req.headers['x-session-id'];
      if (sessionId && this.sessions.has(sessionId)) {
        req.session = this.sessions.get(sessionId);
      } else {
        req.session = {};
      }
      next();
    });

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
  <!-- Tailwind CSS -->
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      theme: {
        extend: {
          colors: {
            surface: {
              50: '#f8fafc',
              100: '#f1f5f9',
              200: '#e2e8f0',
              300: '#cbd5e1',
              400: '#94a3b8',
              500: '#64748b',
              600: '#475569',
              700: '#334155',
              800: '#1e293b',
              900: '#0f172a',
            }
          }
        }
      },
      darkMode: 'class'
    }
  </script>
  
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
      grid-template-columns: 320px 1fr;
      gap: 2rem;
      min-height: calc(100vh - 200px);
    }
    
    /* Server selection container override */
    .server-selection-container {
      display: block;
      max-width: none;
      padding: 0;
      margin: 0;
      width: 100%;
      height: 100vh;
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
      font-size: 1.1rem;
      font-weight: 600;
      margin-bottom: 1rem;
      color: var(--text-primary);
    }
    
    .sidebar h4 {
      font-size: 0.9rem;
      font-weight: 600;
      margin-bottom: 1rem;
      margin-top: 1.5rem;
      color: var(--text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    
    .server-header {
      display: flex;
      flex-direction: column;
      gap: 1rem;
      margin-bottom: 1.5rem;
      padding-bottom: 1.5rem;
      border-bottom: 1px solid var(--border);
    }
    
    .connection-section {
      margin-bottom: 1.5rem;
      padding-bottom: 1.5rem;
      border-bottom: 1px solid var(--border);
    }
    
    .btn-outline {
      background: transparent;
      color: var(--text-secondary);
      border: 1px solid var(--border);
    }
    
    .btn-outline:hover {
      background: var(--surface-hover);
      color: var(--text-primary);
      border-color: var(--accent);
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
    
    .btn.loading {
      opacity: 0.7;
      cursor: not-allowed;
    }
    
    .spinner {
      display: inline-block;
      width: 12px;
      height: 12px;
      border: 2px solid transparent;
      border-top: 2px solid currentColor;
      border-radius: 50%;
      animation: spin 1s linear infinite;
      margin-right: 6px;
    }
    
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
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
    
    /* Tabs */
    .search-tabs {
      display: flex;
      gap: 0.5rem;
      margin-bottom: 2rem;
      border-bottom: 1px solid var(--border);
      flex-wrap: wrap; /* Prevent icon/text overflow on narrow screens */
    }

    .tab-btn {
      background: transparent;
      border: none;
      color: var(--text-secondary);
      padding: 1rem 1.5rem;
      font-size: 0.9rem;
      font-weight: 500;
      cursor: pointer;
      border-bottom: 2px solid transparent;
      transition: all 0.2s ease;
      display: flex;
      align-items: center;
      gap: 0.5rem;
      min-width: 0; /* allow shrinking in flex row */
      max-width: 100%;
      overflow-wrap: anywhere; /* let label wrap under icon */
      white-space: normal; /* allow text to wrap */
    }

    .tab-btn i { flex: 0 0 auto; }

    .tab-btn:hover {
      color: var(--text-primary);
      background: var(--surface-hover);
    }

    .tab-btn.active {
      color: var(--accent);
      border-bottom-color: var(--accent);
    }

    .tab-content {
      display: none;
    }

    .tab-content.active {
      display: block;
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

    .search-btn:hover {
      transform: translateY(-50%) translateY(-1px);
      box-shadow: var(--shadow-md);
    }

    /* Playlist */
    .playlist-container {
      max-width: 800px;
    }

    .playlist-input-section {
      margin-bottom: 2rem;
    }

    .playlist-input-section label {
      display: block;
      font-size: 1rem;
      font-weight: 600;
      margin-bottom: 1rem;
      color: var(--text-primary);
    }

    .playlist-input-group {
      position: relative;
      display: flex;
      align-items: center;
      gap: 0.5rem;
      flex-wrap: nowrap;
    }

    .playlist-icon {
      position: absolute;
      left: 1rem;
      color: var(--text-muted);
      font-size: 1rem;
      z-index: 10;
    }

    .playlist-input {
      flex: 1;
      padding: 1rem 1rem 1rem 3rem;
      background: var(--tertiary-bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      color: var(--text-primary);
      font-size: 1rem;
      height: 48px;
      box-sizing: border-box;
      transition: all 0.2s ease;
      min-width: 0;
    }

    .playlist-input:focus {
      outline: none;
      border-color: var(--accent);
      box-shadow: 0 0 0 3px var(--accent-light);
    }

    #import-playlist-btn {
      background: var(--gradient-primary) !important;
      color: white !important;
      border: none !important;
      border-radius: 12px;
      padding: 1rem 1.5rem;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s ease;
      display: flex;
      align-items: center;
      gap: 0.5rem;
      white-space: nowrap;
      min-width: 120px;
      height: 48px;
      justify-content: center;
      font-size: 14px;
      line-height: 1;
      flex-shrink: 0;
      box-sizing: border-box;
    }

    #import-playlist-btn span {
      display: inline-block;
      margin: 0;
      padding: 0;
    }

    #import-playlist-btn i {
      font-size: 14px !important;
      margin: 0;
      padding: 0;
    }

    #import-playlist-btn:hover {
      transform: translateY(-1px);
      box-shadow: var(--shadow-md);
    }

    #import-playlist-btn:disabled {
      opacity: 0.6;
      cursor: not-allowed;
      transform: none;
    }

    .playlist-examples {
      margin-top: 1rem;
      color: var(--text-muted);
    }

    .example-link {
      color: var(--accent);
      font-family: monospace;
      background: var(--accent-light);
      padding: 0.2rem 0.4rem;
      border-radius: 4px;
    }

    .playlist-results {
      margin-top: 2rem;
    }

    .playlist-header {
      display: flex;
      align-items: center;
      gap: 1rem;
      margin-bottom: 2rem;
      padding: 1.5rem;
      background: var(--gradient-surface);
      border-radius: 16px;
      border: 1px solid var(--border);
    }

    .playlist-cover {
      width: 80px;
      height: 80px;
      border-radius: 12px;
      background: var(--surface);
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
    }

    .playlist-cover img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .playlist-info h3 {
      font-size: 1.25rem;
      font-weight: 600;
      color: var(--text-primary);
      margin-bottom: 0.5rem;
    }

    .playlist-meta {
      color: var(--text-secondary);
      font-size: 0.875rem;
    }

    .playlist-actions {
      margin-left: auto;
      display: flex;
      gap: 0.5rem;
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
      align-items: center;
      overflow: hidden;
      flex-wrap: wrap; /* Allow controls (incl. heart) to wrap instead of overflow */
      width: 100%;
      min-width: 0;
    }
    
    .play-btn {
      flex: 1 1 140px; /* Let it shrink and wrap with icons */
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
      padding: 0.5rem;
      cursor: pointer;
      transition: all 0.2s ease;
      width: 40px;
      height: 40px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
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
    
    /* Download Progress Section */
    .download-progress {
      background: var(--tertiary-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 12px;
      margin: 16px 0;
      animation: slideDown 0.3s ease-out;
    }
    
    .download-info {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
    }
    
    .download-title {
      font-weight: 500;
      color: var(--text-primary);
      font-size: 0.9rem;
    }
    
    .download-status {
      font-size: 0.8rem;
      color: var(--text-secondary);
    }
    
    .download-bar {
      width: 100%;
      height: 6px;
      background: var(--surface);
      border-radius: 3px;
      overflow: hidden;
      margin-bottom: 8px;
    }
    
    .download-fill {
      height: 100%;
      background: linear-gradient(90deg, var(--accent), #2ea043);
      border-radius: 3px;
      transition: width 0.3s ease;
      animation: pulse 2s ease-in-out infinite alternate;
    }
    
    .download-percent {
      text-align: center;
      font-size: 0.8rem;
      color: var(--text-secondary);
      font-weight: 500;
    }
    
    @keyframes slideDown {
      from {
        opacity: 0;
        transform: translateY(-10px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }
    
    @keyframes pulse {
      0% { opacity: 0.8; }
      100% { opacity: 1; }
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
    
    /* Mobile Responsive */
    @media (max-width: 768px) {
      .main-container {
        grid-template-columns: 1fr;
        padding: 1rem;
      }
      
      .sidebar {
        position: static;
        margin-bottom: 2rem;
      }
      
      .server-selection {
        padding: 1rem;
        min-height: calc(100vh - 120px);
      }
      
      .server-selection-header h1 {
        font-size: 2rem;
      }
      
      .server-selection-header p {
        font-size: 1rem;
      }
      
      .server-selection-header {
        margin-bottom: 2rem;
      }
      
      .server-grid {
        grid-template-columns: 1fr;
        gap: 1.5rem;
      }
      
      .server-card {
        padding: 2rem 1.5rem;
        min-height: 200px;
      }
      
      .server-icon {
        width: 80px;
        height: 80px;
        font-size: 2rem;
        margin-bottom: 1.5rem;
      }
      
      .server-name {
        font-size: 1.25rem;
      }
      
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

    /* Tablet Responsive */
    @media (max-width: 1024px) and (min-width: 769px) {
      .server-selection-header h1 {
        font-size: 2.5rem;
      }
      
      .server-grid {
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        gap: 1.5rem;
      }
      
      .server-card {
        padding: 2.5rem 2rem;
        min-height: 220px;
      }
    }

    /* Small Mobile */
    @media (max-width: 480px) {
      .server-selection {
        padding: 0.5rem;
      }
      
      .server-selection-header h1 {
        font-size: 1.75rem;
      }
      
      .server-selection-header p {
        font-size: 0.9rem;
      }
      
      .server-card {
        padding: 1.5rem 1rem;
        min-height: 180px;
      }
      
      .server-icon {
        width: 70px;
        height: 70px;
        font-size: 1.75rem;
        margin-bottom: 1rem;
      }
      
      .server-name {
        font-size: 1.1rem;
      }
      
      .server-members {
        font-size: 0.9rem;
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
    
    /* Server Selection */
    .server-selection {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 2rem;
      width: 100%;
      box-sizing: border-box;
    }

    .server-selection-content {
      max-width: 1200px;
      width: 100%;
      margin: 0 auto;
    }

    .server-selection-header {
      text-align: center;
      margin-bottom: 4rem;
    }

    .server-selection-header h1 {
      font-size: 3rem;
      font-weight: 700;
      color: var(--text-primary);
      margin-bottom: 1rem;
      line-height: 1.2;
    }

    .server-selection-header p {
      font-size: 1.25rem;
      color: var(--text-secondary);
      max-width: 600px;
      margin: 0 auto;
      line-height: 1.6;
    }

    .server-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 2rem;
      justify-content: center;
      align-items: stretch;
    }

    .server-card {
      background: var(--gradient-surface);
      border-radius: 24px;
      padding: 3rem 2rem;
      border: 1px solid var(--border);
      cursor: pointer;
      transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
      text-align: center;
      position: relative;
      overflow: hidden;
      min-height: 240px;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
    }

    .server-card:hover {
      transform: translateY(-8px) scale(1.02);
      box-shadow: var(--shadow-xl);
      border-color: var(--accent);
    }

    .server-card::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 4px;
      background: var(--gradient-primary);
      transform: scaleX(0);
      transition: transform 0.4s ease;
    }

    .server-card:hover::before {
      transform: scaleX(1);
    }

    .server-icon {
      width: 100px;
      height: 100px;
      border-radius: 50%;
      background: var(--gradient-primary);
      margin: 0 auto 2rem;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 2.5rem;
      color: white;
      box-shadow: var(--shadow-md);
      transition: all 0.3s ease;
    }

    .server-card:hover .server-icon {
      transform: scale(1.1);
      box-shadow: var(--shadow-lg);
    }

    .server-name {
      font-size: 1.5rem;
      font-weight: 600;
      color: var(--text-primary);
      margin-bottom: 0.75rem;
      line-height: 1.3;
      word-break: break-word;
    }

    .server-members {
      font-size: 1rem;
      color: var(--text-secondary);
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
    }

    .server-members::before {
      content: '👥';
      font-size: 0.875rem;
    }

    .loading-servers {
      text-align: center;
      padding: 4rem 2rem;
      color: var(--text-muted);
      grid-column: 1 / -1;
      background: var(--gradient-surface);
      border-radius: 24px;
      border: 1px solid var(--border);
      margin: 0 auto;
      max-width: 500px;
    }

    .loading-servers .spinner {
      width: 32px;
      height: 32px;
      margin-bottom: 1.5rem;
      border-width: 3px;
    }

    .loading-servers p {
      font-size: 1.1rem;
      margin-bottom: 0.5rem;
    }

    .loading-servers p:last-child {
      font-size: 0.9rem;
      opacity: 0.7;
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

    /* User Playlists Styles */
    .user-playlists-container {
      padding: 1rem;
    }

    .playlist-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 1.5rem;
      gap: 1rem;
      flex-wrap: wrap; /* avoid overflow with long titles/actions */
    }

    .playlist-header h3 {
      margin: 0;
      color: var(--text-primary);
      font-size: 1.25rem;
      display: flex; /* Keep heart and text inline without overflow */
      align-items: center;
      gap: 0.5rem;
      min-width: 0;
    }

    .create-playlist-btn {
      background: var(--accent);
      color: white;
      border: none;
      padding: 0.75rem 1rem;
      border-radius: 8px;
      cursor: pointer;
      font-weight: 500;
      display: flex;
      align-items: center;
      gap: 0.5rem;
      transition: background-color 0.2s;
    }

    .create-playlist-btn:hover {
      background: var(--accent-dark);
    }

    .user-playlists-list {
      display: grid;
      gap: 1.5rem;
      padding: 0.5rem 0;
    }

    .user-playlist-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 1rem;
      display: grid;
      grid-template-columns: auto 1fr auto;
      grid-template-areas: "icon details actions";
      gap: 1rem;
      align-items: center;
      transition: all 0.2s ease;
      position: relative;
      width: 100%;
      box-sizing: border-box;
      min-height: 80px;
      container-type: inline-size;
    }

    .user-playlist-card:hover {
      border-color: var(--accent);
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    }

    .user-playlist-card .playlist-icon {
      grid-area: icon;
      width: 48px;
      height: 48px;
      background: linear-gradient(135deg, var(--accent-light), var(--accent));
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-size: 18px;
      flex-shrink: 0;
      overflow: hidden;
      position: relative;
    }

    .user-playlist-card .playlist-icon::before {
      content: '';
      position: absolute;
      inset: 0;
      background: rgba(255, 255, 255, 0.1);
      border-radius: inherit;
      opacity: 0;
      transition: opacity 0.2s ease;
    }

    .user-playlist-card:hover .playlist-icon::before {
      opacity: 1;
    }

    .user-playlist-card .playlist-icon i {
      font-size: 18px;
      line-height: 1;
      margin: 0;
      display: block;
      position: relative;
      z-index: 1;
    }

    .user-playlist-card .playlist-details {
      grid-area: details;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }

    .user-playlist-card .playlist-details h4 {
      margin: 0;
      font-size: 1rem;
      font-weight: 600;
      line-height: 1.3;
      color: var(--text-primary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .user-playlist-card .playlist-details p {
      margin: 0;
      font-size: 0.875rem;
      color: var(--text-muted);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .user-playlist-card .playlist-details small {
      margin: 0;
      font-size: 0.75rem;
      color: var(--text-muted);
      opacity: 0.8;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .user-playlist-card .playlist-actions {
      grid-area: actions;
      display: flex;
      gap: 0.5rem;
      align-items: center;
      flex-shrink: 0;
    }

    .user-playlist-card .btn {
      width: 36px;
      height: 36px;
      padding: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 8px;
      border: 1px solid var(--border);
      background: var(--surface);
      color: var(--text-secondary);
      transition: all 0.2s ease;
      cursor: pointer;
      font-size: 14px;
      flex-shrink: 0;
    }

    .user-playlist-card .btn:hover {
      background: var(--accent-light);
      border-color: var(--accent);
      color: var(--accent);
      transform: scale(1.05);
    }

    .user-playlist-card .btn.btn-danger {
      border-color: rgba(239, 68, 68, 0.3);
      color: rgb(239, 68, 68);
    }

    .user-playlist-card .btn.btn-danger:hover {
      background: rgba(239, 68, 68, 0.1);
      border-color: rgb(239, 68, 68);
      color: rgb(239, 68, 68);
    }

    @container (max-width: 500px) {
      .user-playlist-card {
        grid-template-columns: auto 1fr;
        grid-template-areas: 
          "icon details"
          "actions actions";
        gap: 0.75rem;
      }
      
      .user-playlist-card .playlist-actions {
        justify-content: center;
        gap: 1rem;
      }
    }

    @container (max-width: 350px) {
      .user-playlist-card {
        grid-template-columns: 1fr;
        grid-template-areas: 
          "details"
          "actions";
        text-align: center;
      }
      
      .user-playlist-card .playlist-icon {
        display: none;
      }
    }

    .empty-playlists {
      text-align: center;
      padding: 3rem 1rem;
      color: var(--text-muted);
    }

    .empty-playlists i {
      font-size: 3rem;
      margin-bottom: 1rem;
      color: var(--accent);
    }

    .empty-playlists p {
      margin: 0 0 0.5rem 0;
      font-size: 1.125rem;
      font-weight: 500;
    }

    .empty-playlists small {
      font-size: 0.875rem;
      opacity: 0.7;
    }

    /* Modal Styles */
    .modal {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.8);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
    }

    .modal-content {
      background: var(--surface);
      border-radius: 12px;
      max-width: 500px;
      width: 90%;
      max-height: 80vh;
      overflow-y: auto;
    }

    .modal-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 1.5rem;
      border-bottom: 1px solid var(--border);
    }

    .modal-header h3 {
      margin: 0;
      color: var(--text-primary);
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .modal-close {
      background: none;
      border: none;
      color: var(--text-muted);
      font-size: 1.5rem;
      cursor: pointer;
      padding: 0.25rem;
      line-height: 1;
    }

    .modal-close:hover {
      color: var(--text-primary);
    }

    .modal-body {
      padding: 1.5rem;
    }

    .form-group {
      margin-bottom: 1rem;
    }

    .form-group label {
      display: block;
      margin-bottom: 0.5rem;
      color: var(--text-primary);
      font-weight: 500;
    }

    .form-group input,
    .form-group textarea {
      width: 100%;
      padding: 0.75rem;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--background);
      color: var(--text-primary);
      font-family: inherit;
    }

    .form-group textarea {
      resize: vertical;
      min-height: 80px;
    }

    .form-group input:focus,
    .form-group textarea:focus {
      outline: none;
      border-color: var(--accent);
    }

    .modal-footer {
      display: flex;
      gap: 0.75rem;
      padding: 1.5rem;
      border-top: 1px solid var(--border);
      justify-content: flex-end;
    }

    .btn {
      padding: 0.625rem 1rem;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-weight: 500;
      display: flex;
      align-items: center;
      gap: 0.5rem;
      transition: all 0.2s;
      font-family: inherit;
    }

    .btn-primary {
      background: var(--accent);
      color: white;
    }

    .btn-primary:hover:not(:disabled) {
      background: var(--accent-dark);
    }

    .btn-primary:disabled {
      background: var(--border);
      color: var(--text-muted);
      cursor: not-allowed;
    }

    .btn-secondary {
      background: var(--surface-elevated);
      color: var(--text-primary);
      border: 1px solid var(--border);
    }

    .btn-secondary:hover {
      background: var(--border);
    }

    .btn-small {
      padding: 0.5rem;
      font-size: 0.875rem;
      border-radius: 6px;
    }

    .btn-danger {
      background: var(--danger);
      color: white;
    }

    .btn-danger:hover {
      background: #d73027;
    }

    /* Add to Playlist Modal */
    .track-preview {
      display: flex;
      gap: 1rem;
      margin-bottom: 1.5rem;
      padding: 1rem;
      background: var(--surface-elevated);
      border-radius: 8px;
    }

    .track-preview .track-thumbnail {
      width: 64px;
      height: 64px;
      border-radius: 8px;
      overflow: hidden;
      background: var(--border);
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--text-muted);
    }

    .track-preview .track-thumbnail img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .track-details {
      flex: 1;
    }

    .track-details strong {
      display: block;
      color: var(--text-primary);
      margin-bottom: 0.25rem;
    }

    .track-details p {
      margin: 0;
      color: var(--text-muted);
      font-size: 0.875rem;
    }

    .playlist-selection h4 {
      margin: 0 0 1rem 0;
      color: var(--text-primary);
    }

    .playlist-options {
      display: grid;
      gap: 0.5rem;
      max-height: 200px;
      overflow-y: auto;
    }

    .playlist-option {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.75rem;
      background: var(--surface-elevated);
      border: 1px solid var(--border);
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.2s;
      gap: 0.5rem;
    }

    .playlist-option:hover {
      border-color: var(--accent);
    }

    .playlist-option.selected {
      border-color: var(--accent);
      background: var(--accent-light);
    }

    .playlist-info strong {
      display: block;
      color: var(--text-primary);
      margin-bottom: 0.25rem;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .playlist-info small {
      color: var(--text-muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .playlist-option .playlist-info { flex: 1 1 auto; min-width: 0; }
    .playlist-option i { flex: 0 0 auto; }

    /* Ensure track cards never cause horizontal overflow */
    .track-card { max-width: 100%; }

    /* Responsive tweaks to avoid overflow on very narrow screens */
    @media (max-width: 420px) {
      .track-grid { grid-template-columns: 1fr; }
      .track-actions { width: 100%; }
      .play-btn { flex: 1 1 100%; }
      .search-tabs { gap: 0.25rem; }
      .tab-btn { padding: 0.75rem 1rem; }
    }

    .no-playlists {
      text-align: center;
      padding: 2rem;
      color: var(--text-muted);
    }

    .no-playlists p {
      margin: 0 0 1rem 0;
    }

    /* Playlist button in track cards */
    .playlist-btn {
      background: var(--surface-elevated);
      color: var(--accent);
      border: 1px solid var(--border);
      padding: 0.5rem;
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.2s;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 40px;
      height: 40px;
      flex-shrink: 0;
      min-width: 40px;
      max-width: 40px;
      position: relative;
      z-index: 1;
      overflow: hidden;
    }

    .playlist-btn:hover {
      background: var(--accent-light);
      border-color: var(--accent);
    }

    .playlist-btn i {
      font-size: 14px;
      position: relative;
      z-index: 2;
    }
  </style>
  
  <!-- Component System -->
  <script src="/src/components/ComponentManager.js"></script>
  <script src="/src/components/PlaylistCard.js"></script>
  <script src="/src/components/ImportForm.js"></script>
  <script src="/src/components/PlaylistDetailView.js"></script>
  <script src="/src/components/SuggestionsSection.js"></script>
  <script src="/src/components/index.js"></script>
</head>
<body class="bg-surface-900 text-slate-100 font-sans min-h-screen">
  <!-- Login Overlay -->
  <div id="login-overlay" style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.95); z-index: 10000; display: flex; align-items: center; justify-content: center;">
    <div style="background: var(--secondary-bg); padding: 2rem; border-radius: 12px; max-width: 400px; width: 100%; text-align: center; border: 1px solid var(--border);">
      <h2 style="color: var(--text-primary); margin-bottom: 1rem;">
        <i class="fab fa-discord"></i> Discord Login Required
      </h2>
      <p style="color: var(--text-secondary); margin-bottom: 2rem;">
        Sign in with Discord to save your personal playlists and preferences.
      </p>
      <button onclick="loginWithDiscord()" style="background: #5865F2; color: white; border: none; padding: 1rem 2rem; border-radius: 8px; font-size: 1rem; cursor: pointer; display: inline-flex; align-items: center; gap: 0.5rem; margin: 0 auto;">
        <i class="fab fa-discord"></i> Login with Discord
      </button>
    </div>
  </div>

  <!-- Header -->
  <header class="fixed top-0 left-0 right-0 z-50 bg-surface-900/95 backdrop-blur-lg border-b border-surface-700">
    <div class="max-w-7xl mx-auto px-6 py-4">
      <div class="flex items-center justify-between">
        <!-- Logo -->
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl flex items-center justify-center">
            <i class="fas fa-music text-white text-lg"></i>
          </div>
          <div>
            <h1 class="text-xl font-bold text-white">Ative Music</h1>
            <p class="text-xs text-slate-400">Your personal music companion</p>
          </div>
        </div>

        <!-- Right side -->
        <div class="flex items-center gap-4">
          <!-- User info -->
          <div id="user-info" class="hidden items-center gap-3 bg-surface-800 rounded-full px-4 py-2 border border-surface-600">
            <img id="user-avatar" src="" alt="" class="w-8 h-8 rounded-full hidden">
            <span id="user-name" class="text-slate-200 font-medium"></span>
            <button onclick="logout()" class="text-xs bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded-full transition-colors">
              Logout
            </button>
          </div>
          
          <!-- Connection status -->
          <div class="flex items-center gap-2 bg-surface-800 rounded-full px-4 py-2 border border-surface-600">
            <div class="w-2 h-2 rounded-full bg-red-500 animate-pulse" id="status-dot"></div>
            <span id="connection-text" class="text-sm text-slate-400">Disconnected</span>
          </div>
        </div>
      </div>
    </div>
  </header>

  <!-- Server Selection Container (full screen) -->
  <div id="server-selection-container" class="server-selection-container">
    <div id="server-selection" class="server-selection">
      <div class="server-selection-content">
        <div class="server-selection-header">
          <h1><i class="fas fa-server"></i> Select a Server</h1>
          <p>Choose a Discord server to connect to and control music</p>
        </div>
        
        <div class="server-grid" id="server-grid">
          <div class="loading-servers">
            <div class="spinner"></div>
            <p>Loading servers...</p>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Music Interface Container (hidden initially) -->
  <div id="music-interface-container" class="fixed inset-0 top-20 grid grid-cols-[320px_1fr] bg-surface-900" style="display: none;">
    <!-- Sidebar -->
    <div class="bg-surface-800/50 border-r border-surface-700 p-6 overflow-y-auto">
      <!-- Server Header -->
      <div class="bg-surface-800 rounded-xl p-4 mb-6 border border-surface-700">
        <h3 id="current-server-name" class="text-lg font-semibold text-slate-100 mb-3">Current Server</h3>
        <button class="w-full px-4 py-2 bg-surface-700 hover:bg-surface-600 border border-surface-600 text-slate-200 rounded-lg transition-colors duration-200 text-sm flex items-center justify-center gap-2" id="change-server">
          <i class="fas fa-exchange-alt"></i> 
          <span>Change Server</span>
        </button>
      </div>
      
      <!-- Voice Channel Section -->
      <div class="bg-surface-800 rounded-xl p-4 mb-6 border border-surface-700">
        <h4 class="text-md font-medium text-slate-200 mb-3 flex items-center gap-2">
          <i class="fas fa-volume-up text-blue-400"></i>
          Voice Channel
        </h4>
        <select class="w-full p-3 bg-surface-700 border border-surface-600 rounded-lg text-slate-100 mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" id="channel">
          <option value="">Select voice channel...</option>
        </select>
        
        <div class="grid grid-cols-2 gap-2">
          <button class="px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors duration-200 text-sm flex items-center justify-center gap-2" id="connect">
            <i class="fas fa-plug"></i> 
            <span>Connect</span>
          </button>
          <button class="px-3 py-2 bg-surface-700 hover:bg-surface-600 border border-surface-600 text-slate-200 rounded-lg transition-colors duration-200 text-sm flex items-center justify-center gap-2" id="disconnect">
            <i class="fas fa-times"></i> 
            <span>Disconnect</span>
          </button>
        </div>
      </div>
      
      <!-- Music Controls -->
      <div class="bg-surface-800 rounded-xl p-4 border border-surface-700">
        <h4 class="text-md font-medium text-slate-200 mb-3 flex items-center gap-2">
          <i class="fas fa-sliders-h text-purple-400"></i>
          Music Controls
        </h4>
        <div class="space-y-2">
          <button class="w-full px-4 py-2 bg-surface-700 hover:bg-surface-600 border border-surface-600 text-slate-200 rounded-lg transition-colors duration-200 text-sm flex items-center gap-3" id="btn-shuffle">
            <i class="fas fa-random text-blue-400"></i> 
            <span>Shuffle</span>
          </button>
          <button class="w-full px-4 py-2 bg-surface-700 hover:bg-surface-600 border border-surface-600 text-slate-200 rounded-lg transition-colors duration-200 text-sm flex items-center gap-3" id="btn-repeat">
            <i class="fas fa-repeat text-green-400"></i> 
            <span>Repeat</span>
          </button>
          <button class="w-full px-4 py-2 bg-surface-700 hover:bg-surface-600 border border-surface-600 text-slate-200 rounded-lg transition-colors duration-200 text-sm flex items-center justify-between" id="btn-autoplay">
            <div class="flex items-center gap-3">
              <i class="fas fa-magic text-purple-400"></i> 
              <span>Auto-play</span>
            </div>
            <span class="autoplay-status text-xs bg-surface-600 px-2 py-1 rounded opacity-70">OFF</span>
          </button>
          <button class="w-full px-4 py-2 bg-surface-700 hover:bg-surface-600 border border-surface-600 text-slate-200 rounded-lg transition-colors duration-200 text-sm flex items-center gap-3" id="btn-fill-queue">
            <i class="fas fa-sparkles text-yellow-400"></i> 
            <span>Fill Queue</span>
          </button>
          <button class="w-full px-4 py-2 bg-red-600/20 hover:bg-red-600/30 border border-red-600/40 text-red-400 hover:text-red-300 rounded-lg transition-colors duration-200 text-sm flex items-center gap-3" id="btn-clear-queue">
            <i class="fas fa-trash"></i> 
            <span>Clear Queue</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Main Content -->
    <div class="flex flex-col overflow-hidden">
      <div class="flex-1 overflow-y-auto p-6 space-y-8">
        <!-- Search Section -->
        <div class="bg-surface-800/50 rounded-xl border border-surface-700 p-6">
          <div class="flex items-center gap-3 mb-6">
            <div class="w-10 h-10 bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg flex items-center justify-center">
              <i class="fas fa-search text-white"></i>
            </div>
            <div>
              <h2 class="text-xl font-bold text-slate-100">Search Music</h2>
              <p class="text-sm text-slate-400">Find and play your favorite tracks</p>
            </div>
          </div>
          
          <!-- Tabs Navigation -->
          <div class="flex bg-surface-700/50 rounded-lg p-1 mb-6">
            <button class="tab-btn flex-1 py-2 px-4 rounded-md text-sm font-medium transition-all duration-200 text-white bg-blue-600 shadow-sm" id="tab-search">
              <i class="fas fa-search mr-2"></i> Search Music
            </button>
            <button class="tab-btn flex-1 py-2 px-4 rounded-md text-sm font-medium transition-all duration-200 text-slate-400 hover:text-slate-200 hover:bg-surface-600" id="tab-playlist">
              <i class="fas fa-list-ul mr-2"></i> Import Playlist
            </button>
            <button class="tab-btn flex-1 py-2 px-4 rounded-md text-sm font-medium transition-all duration-200 text-slate-400 hover:text-slate-200 hover:bg-surface-600" id="tab-user-playlists">
              <i class="fas fa-heart mr-2"></i> My Playlists
            </button>
          </div>

          <!-- Search Tab -->
          <div id="search-tab" class="tab-content active">
            <div class="relative flex items-center gap-3 mb-6">
              <div class="absolute left-4 z-10">
                <i class="fas fa-search text-slate-400"></i>
              </div>
              <input type="text" class="flex-1 pl-12 pr-32 py-4 bg-surface-700 border border-surface-600 rounded-xl text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200" id="search" placeholder="Search for songs, artists, or playlists..." />
              <button class="absolute right-2 top-1/2 -translate-y-1/2 px-6 py-2.5 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white rounded-lg font-medium transition-all duration-200 hover:scale-105" id="search-btn">
                Search
              </button>
            </div>
            
            <div id="results" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"></div>
          </div>

        <!-- Playlist Tab -->
        <div id="playlist-tab" class="tab-content">
          <div class="playlist-container">
            <div class="bg-surface-800 border border-surface-700 rounded-xl p-6">
              <!-- Header -->
              <div class="flex items-center gap-3 mb-4">
                <div class="w-10 h-10 bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg flex items-center justify-center">
                  <i class="fas fa-download text-white"></i>
                </div>
                <div>
                  <h3 class="text-lg font-semibold text-slate-100">Import Playlist</h3>
                  <p class="text-sm text-slate-400">Add playlists from Spotify or YouTube</p>
                </div>
              </div>

              <!-- URL Input -->
              <div class="space-y-2">
                <label for="playlist-url" class="block text-sm font-medium text-slate-300">
                  Playlist URL
                </label>
                <div class="relative flex items-center gap-2">
                  <div class="absolute left-3 z-10">
                    <i class="fas fa-link text-slate-400"></i>
                  </div>
                  <input 
                    type="text" 
                    id="playlist-url"
                    class="flex-1 pl-10 pr-32 py-3 bg-surface-700 border border-surface-600 rounded-lg text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200" 
                    placeholder="Paste Spotify or YouTube playlist URL..."
                  />
                  <button 
                    id="import-playlist-btn"
                    class="absolute right-2 top-1/2 -translate-y-1/2 px-4 py-2 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white rounded-lg font-medium transition-all duration-200 hover:scale-105 flex items-center gap-2 min-w-[100px] justify-center"
                  >
                    <i class="fas fa-download"></i>
                    <span>Import</span>
                  </button>
                </div>
              </div>

              <!-- Examples -->
              <div class="mt-4 bg-surface-900/50 rounded-lg p-4 border border-surface-600">
                <h4 class="text-sm font-medium text-slate-300 mb-2 flex items-center gap-2">
                  <i class="fas fa-info-circle text-blue-400"></i>
                  Supported Formats
                </h4>
                <ul class="space-y-1 text-xs text-slate-500 font-mono">
                  <li>Spotify: https://open.spotify.com/playlist/...</li>
                  <li>YouTube: https://youtube.com/playlist?list=...</li>
                  <li>YouTube Music: https://music.youtube.com/playlist?list=...</li>
                </ul>
              </div>
            </div>
            
            <div id="playlist-results" class="playlist-results"></div>
          </div>
        </div>

          <!-- User Playlists Tab -->
          <div id="user-playlists-tab" class="tab-content">
            <div class="flex items-center justify-between mb-6">
              <div class="flex items-center gap-3">
                <div class="w-8 h-8 bg-gradient-to-br from-pink-500 to-red-600 rounded-lg flex items-center justify-center">
                  <i class="fas fa-heart text-white text-sm"></i>
                </div>
                <h3 class="text-lg font-semibold text-slate-100">My Playlists</h3>
              </div>
              <button class="px-4 py-2 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white rounded-lg font-medium transition-all duration-200 hover:scale-105 flex items-center gap-2" id="create-playlist-btn">
                <i class="fas fa-plus"></i> 
                <span>Create Playlist</span>
              </button>
            </div>
            
            <div id="user-playlists-list" class="grid gap-6 py-2">
              <div class="flex flex-col items-center justify-center py-12 text-center">
                <div class="w-16 h-16 bg-surface-700/50 rounded-full flex items-center justify-center mb-4">
                  <i class="fas fa-heart text-2xl text-slate-500"></i>
                </div>
                <p class="text-lg font-medium text-slate-300 mb-2">No playlists yet</p>
                <small class="text-slate-500">Create your first playlist to get started!</small>
              </div>
            </div>
          </div>
        </div>
        
        <!-- Queue Section -->
        <div class="bg-surface-800/50 rounded-xl border border-surface-700 p-6">
          <div class="flex items-center gap-3 mb-6">
            <div class="w-10 h-10 bg-gradient-to-br from-green-500 to-green-600 rounded-lg flex items-center justify-center">
              <i class="fas fa-list text-white"></i>
            </div>
            <div>
              <h2 class="text-xl font-bold text-slate-100">Queue</h2>
              <p class="text-sm text-slate-400">Up next tracks</p>
            </div>
          </div>
          
          <div id="queue" class="space-y-2">
            <div class="flex flex-col items-center justify-center py-8 text-center">
              <div class="w-12 h-12 bg-surface-700/50 rounded-full flex items-center justify-center mb-3">
                <i class="fas fa-music text-xl text-slate-500"></i>
              </div>
              <p class="text-slate-400">No tracks in queue</p>
            </div>
          </div>
        </div>

        <!-- Suggestions Section -->
        <div id="suggestions-container">
          <!-- SuggestionsSection component will be rendered here -->
        </div>
      </div>
    </div>
    </div>
  </div>

  <!-- Bottom Player (hidden on server selection) -->
  <div class="bottom-player" id="bottom-player" style="display: none;">
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
    
    <!-- Download Progress Section -->
    <div class="download-progress" id="download-progress" style="display: none;">
      <div class="download-info">
        <div class="download-title" id="download-title">Preparing track...</div>
        <div class="download-status" id="download-status">Starting download...</div>
      </div>
      <div class="download-bar">
        <div class="download-fill" id="download-fill" style="width: 0%"></div>
      </div>
      <div class="download-percent" id="download-percent">0%</div>
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

  <!-- Create Playlist Modal -->
  <div id="create-playlist-modal" class="modal" style="display: none;">
    <div class="modal-content">
      <div class="modal-header">
        <h3><i class="fas fa-plus"></i> Create New Playlist</h3>
        <button class="modal-close" id="modal-close-btn">&times;</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label for="playlist-name">Playlist Name</label>
          <input type="text" id="playlist-name" placeholder="Enter playlist name..." maxlength="50" />
        </div>
        <div class="form-group">
          <label for="playlist-description">Description (optional)</label>
          <textarea id="playlist-description" placeholder="Enter playlist description..." maxlength="200"></textarea>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" id="cancel-playlist-btn">Cancel</button>
        <button class="btn btn-primary" id="save-playlist-btn">
          <i class="fas fa-save"></i> Create Playlist
        </button>
      </div>
    </div>
  </div>

  <!-- Add to Playlist Modal -->
  <div id="add-to-playlist-modal" class="modal" style="display: none;">
    <div class="modal-content">
      <div class="modal-header">
        <h3><i class="fas fa-plus"></i> Add to Playlist</h3>
        <button class="modal-close" id="add-modal-close-btn">&times;</button>
      </div>
      <div class="modal-body">
        <div class="track-info" id="add-track-info">
          <!-- Track info will be populated here -->
        </div>
        <div class="playlist-selection">
          <h4>Select Playlist:</h4>
          <div id="playlist-options" class="playlist-options">
            <!-- Playlists will be loaded here -->
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" id="cancel-add-btn">Cancel</button>
        <button class="btn btn-primary" id="confirm-add-btn" disabled>
          <i class="fas fa-plus"></i> Add to Playlist
        </button>
      </div>
    </div>
  </div>

  <script>
    const BASE = '${base}';
    let currentGuild = null;
    let currentChannel = null;
    let currentTrack = null;
    let isPlaying = false;
    let currentTime = 0;
    let totalTime = 0;
    let loadedServers = null; // Cache loaded servers
    let sessionId = null;
    let currentUser = null;

    // Session storage with expiration (30 days)
    function setSessionWithExpiry(sessionId, userInfo = null) {
      const now = new Date();
      const expiryDate = new Date(now.getTime() + (30 * 24 * 60 * 60 * 1000)); // 30 days
      const sessionData = {
        sessionId: sessionId,
        expiry: expiryDate.getTime(),
        timestamp: now.getTime(),
        user: userInfo
      };
      localStorage.setItem('discord_session_data', JSON.stringify(sessionData));
      
      // Also store in sessionStorage for better reliability
      sessionStorage.setItem('discord_session_temp', sessionId);
    }

    function getSessionWithExpiry() {
      // First check sessionStorage for immediate session
      const tempSession = sessionStorage.getItem('discord_session_temp');
      if (tempSession) {
        return { sessionId: tempSession, user: null };
      }
      
      const sessionDataStr = localStorage.getItem('discord_session_data');
      if (!sessionDataStr) return null;
      
      try {
        const sessionData = JSON.parse(sessionDataStr);
        const now = new Date().getTime();
        
        if (now > sessionData.expiry) {
          // Session expired, remove it
          clearSession();
          return null;
        }
        
        return {
          sessionId: sessionData.sessionId,
          user: sessionData.user || null
        };
      } catch (e) {
        // Invalid data, clean up
        clearSession();
        return null;
      }
    }

    function clearSession() {
      localStorage.removeItem('discord_session_data');
      localStorage.removeItem('discord_session'); // Clean old format too
      sessionStorage.removeItem('discord_session_temp');
      
      // Also clear any other auth-related storage
      sessionStorage.removeItem('discord_user_cache');
    }

    // Check for session in URL params or localStorage
    const urlParams = new URLSearchParams(window.location.search);
    const sessionFromUrl = urlParams.get('session');
    if (sessionFromUrl) {
      sessionId = sessionFromUrl;
      setSessionWithExpiry(sessionId);
      // Clean URL
      window.history.replaceState({}, document.title, window.location.pathname);
    } else {
      const sessionData = getSessionWithExpiry();
      if (sessionData) {
        sessionId = sessionData.sessionId;
        // If we have cached user data, restore it immediately
        if (sessionData.user) {
          currentUser = sessionData.user;
          updateUserDisplay();
        }
      } else {
        // Also check old format and migrate if exists
        const oldSession = localStorage.getItem('discord_session');
        if (oldSession) {
          sessionId = oldSession;
          setSessionWithExpiry(sessionId);
          localStorage.removeItem('discord_session'); // Remove old format
        }
      }
    }

    // Authentication functions
    async function checkAuth() {
      if (!sessionId) {
        document.getElementById('login-overlay').style.display = 'flex';
        return false;
      }

      try {
        const response = await fetch(\`\${BASE}/api/user\`, {
          headers: { 'X-Session-Id': sessionId }
        });
        
        if (response.status === 401) {
          clearSession();
          sessionId = null;
          document.getElementById('login-overlay').style.display = 'flex';
          return false;
        }

        const data = await response.json();
        if (data.user) {
          currentUser = data.user;
          updateUserDisplay();
          // Store user data with session for faster future loads
          setSessionWithExpiry(sessionId, data.user);
          document.getElementById('login-overlay').style.display = 'none';
          return true;
        } else {
          document.getElementById('login-overlay').style.display = 'flex';
          return false;
        }
      } catch (error) {
        console.error('Auth check failed:', error);
        
        // If it's a network error, don't immediately clear session
        if (error.name === 'TypeError' || error.message.includes('fetch')) {
          console.log('Network error during auth check, keeping session for retry');
          // Don't show login overlay immediately on network errors
          return false;
        }
        
        // For other errors, clear session and show login
        clearSession();
        sessionId = null;
        currentUser = null;
        document.getElementById('login-overlay').style.display = 'flex';
        return false;
      }
    }

    function updateUserDisplay() {
      if (currentUser) {
        const userInfo = document.getElementById('user-info');
        const userName = document.getElementById('user-name');
        const userAvatar = document.getElementById('user-avatar');
        
        userInfo.style.display = 'flex';
        userName.textContent = currentUser.username;
        
        if (currentUser.avatar) {
          userAvatar.src = \`https://cdn.discordapp.com/avatars/\${currentUser.id}/\${currentUser.avatar}.png?size=64\`;
          userAvatar.style.display = 'block';
        }
      }
    }

    function loginWithDiscord() {
      console.log('Initiating Discord login...');
      // Store a flag to indicate login attempt
      sessionStorage.setItem('discord_login_attempt', 'true');
      window.location.href = \`\${BASE}/auth/discord\`;
    }

    async function logout() {
      await fetch(\`\${BASE}/api/logout\`, {
        method: 'POST',
        headers: { 'X-Session-Id': sessionId }
      });
      clearSession();
      sessionId = null;
      currentUser = null;
      document.getElementById('user-info').style.display = 'none';
      document.getElementById('login-overlay').style.display = 'flex';
    }

    // Add session header to all API calls
    const originalFetch = window.fetch;
    window.fetch = function(url, options = {}) {
      if (sessionId && url.startsWith(BASE)) {
        options.headers = options.headers || {};
        options.headers['X-Session-Id'] = sessionId;
      }
      return originalFetch.call(this, url, options);
    };

    // DOM Elements
    const els = {
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
      btnAutoplay: document.getElementById('btn-autoplay'),
      btnClearQueue: document.getElementById('btn-clear-queue'),
      progressBar: document.getElementById('progress-bar'),
      progressFill: document.getElementById('progress-fill'),
      currentTime: document.getElementById('current-time'),
      totalTime: document.getElementById('total-time'),
      notification: document.getElementById('notification')
    };

    // URL Routing
    function getServerFromURL() {
      const params = new URLSearchParams(window.location.search);
      return params.get('server');
    }

    function setServerInURL(serverId) {
      const url = new URL(window.location);
      url.searchParams.set('server', serverId);
      window.history.pushState({}, '', url);
    }

    function clearServerFromURL() {
      const url = new URL(window.location);
      url.searchParams.delete('server');
      window.history.pushState({}, '', url);
    }

    // Debug function to check session status
    function debugSessionStatus() {
      const sessionData = getSessionWithExpiry();
      console.log('Session Debug Info:', {
        hasSessionId: !!sessionId,
        hasCurrentUser: !!currentUser,
        sessionData: sessionData,
        localStorage: localStorage.getItem('discord_session_data'),
        sessionStorage: sessionStorage.getItem('discord_session_temp')
      });
    }

    // Auto-restore session if available
    async function autoRestoreSession() {
      if (sessionId && !currentUser) {
        console.log('Auto-restoring session...');
        const authSuccess = await checkAuth();
        if (authSuccess) {
          console.log('Session restored successfully');
          showNotification('Welcome back! Session restored.', 'success');
        }
      }
    }

    // Make debug function available globally for troubleshooting
    window.debugSessionStatus = debugSessionStatus;

    // Initialize
    window.addEventListener('load', async () => {
      console.log('🎵 Ative Music initializing...');
      
      // Debug session info
      debugSessionStatus();
      
      // Check authentication first - try to restore session automatically
      let authSuccess = false;
      if (sessionId) {
        console.log('Found session ID, attempting authentication...');
        authSuccess = await checkAuth();
        
        // If we have a sessionId but auth failed, try one more time after a short delay
        if (!authSuccess) {
          console.log('Initial auth failed, retrying in 1 second...');
          await new Promise(resolve => setTimeout(resolve, 1000));
          authSuccess = await checkAuth();
        }
      }
      
      if (authSuccess) {
        console.log('✅ Authentication successful');
        showNotification('Welcome back! Session restored.', 'success');
      } else {
        console.log('❌ Authentication failed or no session');
      }
      
      // ALWAYS show server selection first
      loadServersForSelection();
      updateStatus();
      setInterval(updateStatus, 1000);
      
      // Initialize suggestions when page loads
      setTimeout(() => {
        loadSuggestions();
      }, 2000);
      
      // Set up periodic session validation (every 10 minutes)
      setInterval(async () => {
        // Only validate if page is visible and user is logged in
        if (sessionId && currentUser && !document.hidden) {
          console.log('🔄 Periodic session validation...');
          const stillValid = await checkAuth();
          if (!stillValid) {
            showNotification('Session expired. Please log in again.', 'warning');
          }
        }
      }, 10 * 60 * 1000); // 10 minutes
      
      // Handle page visibility changes - check auth when page becomes visible
      document.addEventListener('visibilitychange', async () => {
        if (!document.hidden && sessionId && currentUser) {
          console.log('👁️ Page visible, validating session...');
          await checkAuth();
        }
      });
      
      // Force auth check on focus
      window.addEventListener('focus', async () => {
        if (sessionId && !currentUser) {
          console.log('🎯 Window focused, checking auth...');
          await checkAuth();
        }
      });
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

    // Server Selection Functions
    async function loadServersAndSelectFromURL(serverId) {
      try {
        const response = await fetch(BASE + '/api/guilds');
        if (!response.ok) {
          throw new Error(\`HTTP \${response.status}: \${response.statusText}\`);
        }
        const guilds = await response.json();
        
        const guild = guilds.find(g => g.id === serverId);
        if (guild) {
          // Valid server ID - go directly to music interface
          selectServer(serverId, guild.name);
          // Guild dropdown no longer needed
        } else {
          // Invalid server ID - show server selection
          clearServerFromURL();
          loadServersForSelection();
        }
      } catch (error) {
        console.error('Failed to load servers from URL:', error);
        clearServerFromURL();
        loadServersForSelection();
      }
    }

    async function loadServersForSelection() {
      try {
        const response = await fetch(BASE + '/api/guilds');
        if (!response.ok) {
          throw new Error(\`HTTP \${response.status}: \${response.statusText}\`);
        }
        const guilds = await response.json();
        
        if (!Array.isArray(guilds) || guilds.length === 0) {
          document.getElementById('server-grid').innerHTML = \`
            <div class="loading-servers">
              <i class="fas fa-exclamation-triangle" style="font-size: 3rem; margin-bottom: 1rem; color: var(--warning);"></i>
              <p>No servers available</p>
              <p style="font-size: 0.875rem; opacity: 0.7;">Bot is not in any servers or not ready yet</p>
            </div>
          \`;
          return;
        }
        
        const serverCardsHTML = guilds.map(guild => {
          const safeName = guild.name.split("'").join("\\'");
          const iconContent = guild.iconURL 
            ? \`<img src="\${guild.iconURL}" alt="\${guild.name}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;">\`
            : \`<i class="fas fa-server"></i>\`;
          return \`
          <div class="server-card" onclick="selectServer('\${guild.id}', '\${safeName}')">
            <div class="server-icon">
              \${iconContent}
            </div>
            <div class="server-name">\${guild.name}</div>
            <div class="server-members">\${guild.memberCount} members</div>
          </div>
        \`;
        }).join('');
        
        document.getElementById('server-grid').innerHTML = serverCardsHTML;
        
        // Cache the loaded servers for reuse
        loadedServers = serverCardsHTML;
        
        // Always show server selection first - don't auto-select previously used servers
        // Users must explicitly choose a server each time they visit
      } catch (error) {
        console.error('Failed to load servers:', error);
        document.getElementById('server-grid').innerHTML = \`
          <div class="loading-servers">
            <i class="fas fa-exclamation-triangle" style="font-size: 3rem; margin-bottom: 1rem; color: var(--danger);"></i>
            <p>Failed to load servers</p>
            <p style="font-size: 0.875rem; opacity: 0.7;">Retrying in 3 seconds...</p>
          </div>
        \`;
        setTimeout(loadServersForSelection, 3000);
      }
    }

    function selectServer(guildId, guildName) {
      currentGuild = guildId;
      localStorage.setItem('musicBot_guildId', currentGuild);
      
      // Update URL
      setServerInURL(guildId);
      
      // Hide server selection and show music interface
      document.getElementById('server-selection-container').style.display = 'none';
      document.getElementById('music-interface-container').style.display = 'grid';
      
      // Update server name display
      document.getElementById('current-server-name').textContent = guildName;
      
      // Show the bottom player when entering a server
      document.getElementById('bottom-player').style.display = 'flex';
      
      // Load channels for the selected server
      loadChannels();
      loadAutoplayStatus();
      
      // Immediately check for current playing state
      updateStatus();
      
      showNotification(\`Selected server: \${guildName}\`, 'success');
    }

    function showServerSelection() {
      // Clear URL
      clearServerFromURL();
      
      // Clear all search and playlist content
      clearAllContent();
      
      document.getElementById('server-selection-container').style.display = 'block';
      document.getElementById('music-interface-container').style.display = 'none';
      
      // Hide the bottom player when going back to server selection
      document.getElementById('bottom-player').style.display = 'none';
      
      // Use cached servers if available, otherwise load them
      if (loadedServers) {
        console.log('📋 Using cached server list');
        document.getElementById('server-grid').innerHTML = loadedServers;
      } else {
        console.log('🔄 Loading server list...');
        loadServersForSelection();
      }
    }

    function clearAllContent() {
      // Clear search input
      document.getElementById('search').value = '';
      
      // Clear search results
      document.getElementById('results').innerHTML = '';
      
      // Clear playlist input
      document.getElementById('playlist-url').value = '';
      
      // Clear playlist results
      document.getElementById('playlist-results').innerHTML = '';
      
      // Reset to search tab
      switchTab('search');
      
      // Clear any stored playlist data
      window.currentPlaylist = null;
      
      console.log('🧹 Cleared all search and playlist content');
    }

    // API Functions (simplified since we don't use guild dropdown anymore)
    async function loadGuilds() {
      // This function is kept for any future needs but simplified
      // The main guild loading is now handled by loadServersForSelection()
      return;
    }

    async function loadChannels() {
      if (!currentGuild) return;
      
      try {
        const response = await fetch(BASE + '/api/channels/' + currentGuild);
        const data = await response.json();
        
        // Ensure we have an array of channels
        let channels = [];
        if (Array.isArray(data)) {
          channels = data;
        } else if (data && data.channels && Array.isArray(data.channels)) {
          channels = data.channels;
        }
        
        els.channel.innerHTML = '<option value="">Select voice channel...</option>';
        
        if (channels.length > 0) {
          channels.forEach(channel => {
            const option = document.createElement('option');
            option.value = channel.id;
            option.textContent = channel.name + (channel.connected ? ' (🔌 Connected)' : '');
            els.channel.appendChild(option);
          });
        }
        
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
        console.error('Failed to load channels:', error);
        showNotification('Failed to load channels: ' + error.message, 'error');
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
            <button class="playlist-btn" onclick="showAddToPlaylistModal({title: '\${track.title.replace(/'/g, '\\\\\\'')}', author: '\${track.author.replace(/'/g, '\\\\\\'')}', url: '\${track.url}', thumbnail: '\${track.thumbnail || ''}', duration: '\${track.duration || ''}'})">
              <i class="fas fa-heart"></i>
            </button>
          </div>
        </div>
      \`).join('');
    }

    async function updateStatus() {
      try {
        const params = new URLSearchParams({ guildId: currentGuild || '', channelId: currentChannel || '' });
        const response = await fetch(BASE + '/api/status?' + params.toString());
        const data = await response.json();
        
        // Update connection status
        if (data.connected) {
          els.statusDot.classList.add('connected');
          els.connectionText.textContent = \`Connected to \${data.channel || 'Voice Channel'}\`;
        } else {
          els.statusDot.classList.remove('connected');
          els.connectionText.textContent = 'Disconnected';
        }
        
        // Update auto-play button status
        if (data.autoPlayEnabled !== undefined) {
          updateAutoplayButton(data.autoPlayEnabled);
          
          // Auto-fill queue if autoplay is enabled and queue is low
          if (data.autoPlayEnabled && data.queue && data.queue.length <= 1 && data.currentTrack && data.isPlaying) {
            // Only auto-fill every 30 seconds to avoid spam
            const now = Date.now();
            if (!window.lastAutoFill || (now - window.lastAutoFill) > 30000) {
              window.lastAutoFill = now;
              console.log('🎵 Auto-filling queue due to low count...');
              setTimeout(() => {
                control('fillqueue').catch(e => console.log('Auto-fill failed:', e.message));
              }, 2000);
            }
          }
        }

        // Update player - always update to ensure sync across users
        if (data.currentTrack) {
          updatePlayer(data.currentTrack, data.isPlaying, data.currentTime, data.totalTime);
          // Show the bottom player if we have a current track and we're in the music interface
          if (document.getElementById('music-interface-container').style.display !== 'none') {
            document.getElementById('bottom-player').style.display = 'flex';
          }
        } else {
          // Clear player when no track is playing
          updatePlayer({title: 'No track playing', author: 'Select a song to play'}, false, 0, 0);
        }

        // Update queue - always update to ensure sync
        if (data.queue !== undefined) {
          updateQueue(data.queue, data.currentIndex);
        }
      } catch (error) {
        console.error('Status update failed:', error);
      }
    }

    let lastUpdateTime = 0;
    let localCurrentTime = 0;
    let isLocalTracking = false;

    function updatePlayer(track, playing, current, total) {
      currentTrack = track;
      const wasPlaying = isPlaying;
      isPlaying = playing;
      totalTime = total || 0;

      // Handle time tracking more smoothly
      if (current !== undefined && current !== null) {
        currentTime = current;
        localCurrentTime = current;
        lastUpdateTime = Date.now();
        isLocalTracking = false; // Reset local tracking when we get server update
      }

      // If we're switching from paused to playing, preserve the time
      if (!wasPlaying && playing && currentTime > 0) {
        localCurrentTime = currentTime;
        lastUpdateTime = Date.now();
        isLocalTracking = true;
      }

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

      // Update progress display
      updateProgressDisplay();
    }

    function updateProgressDisplay() {
      let displayTime = currentTime;
      
      // Use local tracking for smoother updates when playing
      if (isPlaying && isLocalTracking) {
        const elapsed = (Date.now() - lastUpdateTime) / 1000;
        displayTime = Math.min(localCurrentTime + elapsed, totalTime);
      }
      
      const progressPercent = totalTime > 0 ? (displayTime / totalTime) * 100 : 0;
      els.progressFill.style.width = progressPercent + '%';
      els.currentTime.textContent = formatTime(displayTime);
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

    // Tab switching functionality
    function switchTab(tabName) {
      // Remove active class from all tabs and content
      document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
        // Update styling for inactive tabs
        btn.className = 'tab-btn flex-1 py-2 px-4 rounded-md text-sm font-medium transition-all duration-200 text-slate-400 hover:text-slate-200 hover:bg-surface-600';
      });
      document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
      
      // Add active class to selected tab and content
      const activeTabBtn = document.getElementById('tab-' + tabName);
      const activeTabContent = document.getElementById(tabName + '-tab');
      
      if (activeTabBtn) {
        activeTabBtn.classList.add('active');
        // Update styling for active tab
        activeTabBtn.className = 'tab-btn flex-1 py-2 px-4 rounded-md text-sm font-medium transition-all duration-200 text-white bg-blue-600 shadow-sm';
      }
      
      if (activeTabContent) {
        activeTabContent.classList.add('active');
      }
      
      // Load user playlists when switching to that tab
      if (tabName === 'user-playlists') {
        loadUserPlaylists();
      }
    }

    // Playlist functionality
    async function importPlaylist() {
      const url = document.getElementById('playlist-url').value.trim();
      const button = document.getElementById('import-playlist-btn');
      
      if (!url) {
        showNotification('Please enter a playlist URL', 'error');
        return;
      }

      // Validate URL
      if (!isValidPlaylistUrl(url)) {
        showNotification('Please enter a valid Spotify or YouTube playlist URL', 'error');
        return;
      }

      // Show loading state
      const originalHTML = button.innerHTML;
      button.innerHTML = '<div class="spinner"></div> Importing...';
      button.disabled = true;

      try {
        const response = await fetch(BASE + '/api/playlist/import', {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify({ url })
        });

        const result = await response.json();
        
        if (result.success) {
          displayPlaylistResults(result.playlist);
          showNotification('Playlist imported successfully!', 'success');
        } else {
          showNotification(result.error || 'Failed to import playlist', 'error');
        }
      } catch (error) {
        showNotification('Failed to import playlist', 'error');
      } finally {
        // Reset button state
        button.innerHTML = originalHTML;
        button.disabled = false;
      }
    }

    function isValidPlaylistUrl(url) {
      // Very simple and permissive validation - just check for key URL patterns
      const lowerUrl = url.toLowerCase();
      
      // Check for Spotify playlist
      if (lowerUrl.includes('spotify.com/playlist/')) {
        return true;
      }
      
      // Check for YouTube playlist - be very permissive
      if ((lowerUrl.includes('youtube.com/playlist?list=') || lowerUrl.includes('youtu.be/playlist?list=')) && lowerUrl.includes('list=')) {
        return true;
      }
      
      return false;
    }

    function displayPlaylistResults(playlist) {
      const resultsDiv = document.getElementById('playlist-results');
      
      if (!playlist || !playlist.tracks || playlist.tracks.length === 0) {
        resultsDiv.innerHTML = '<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>No tracks found in playlist</p></div>';
        return;
      }

      resultsDiv.innerHTML = \`
        <div class="playlist-header">
          <div class="playlist-cover">
            \${playlist.image ? 
              \`<img src="\${playlist.image}" alt="\${playlist.name}" />\` :
              \`<i class="fas fa-list-ul" style="font-size: 2rem; color: var(--text-muted);"></i>\`
            }
          </div>
          <div class="playlist-info">
            <h3>\${playlist.name}</h3>
            <div class="playlist-meta">
              \${playlist.tracks.length} tracks • \${playlist.source === 'spotify' ? 'Spotify' : 'YouTube'}
              \${playlist.description ? \` • \${playlist.description}\` : ''}
            </div>
          </div>
          <div class="playlist-actions">
            <button class="btn btn-small" onclick="queuePlaylist()">
              <i class="fas fa-plus"></i> Queue All
            </button>
            <button class="btn btn-small" onclick="playPlaylist()">
              <i class="fas fa-play"></i> Play All
            </button>
          </div>
        </div>
        
        <div class="track-grid">
          \${playlist.tracks.map((track, index) => \`
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
                  <i class="fab fa-\${playlist.source === 'spotify' ? 'spotify' : 'youtube'}"></i>
                  \${playlist.source}
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
          \`).join('')}
        </div>
      \`;
      
      // Store current playlist for queue/play all functions
      window.currentPlaylist = playlist;
    }

    window.queuePlaylist = async () => {
      if (!window.currentPlaylist || !currentGuild || !currentChannel) {
        showNotification('Please select a server and channel first', 'error');
        return;
      }

      try {
        const response = await fetch(BASE + '/api/playlist/queue', {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify({
            guildId: currentGuild,
            channelId: currentChannel,
            tracks: window.currentPlaylist.tracks
          })
        });

        const result = await response.json();
        
        if (result.success) {
          showNotification(\`Added \${window.currentPlaylist.tracks.length} tracks to queue!\`, 'success');
          updateStatus();
        } else {
          showNotification(result.error || 'Failed to queue playlist', 'error');
        }
      } catch (error) {
        showNotification('Failed to queue playlist', 'error');
      }
    };

    window.playPlaylist = async () => {
      if (!window.currentPlaylist || !currentGuild || !currentChannel) {
        showNotification('Please select a server and channel first', 'error');
        return;
      }

      try {
        const response = await fetch(BASE + '/api/playlist/play', {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify({
            guildId: currentGuild,
            channelId: currentChannel,
            tracks: window.currentPlaylist.tracks
          })
        });

        const result = await response.json();
        
        if (result.success) {
          showNotification(\`Playing playlist: \${window.currentPlaylist.name}\`, 'success');
          updateStatus();
        } else {
          showNotification(result.error || 'Failed to play playlist', 'error');
        }
      } catch (error) {
        showNotification('Failed to play playlist', 'error');
      }
    };

    // User Playlist Functions
    let userPlaylists = [];
    let selectedTrackForPlaylist = null;

    async function loadUserPlaylists() {
      if (!currentUser) {
        document.getElementById('user-playlists-list').innerHTML = \`
          <div class="empty-playlists">
            <i class="fas fa-sign-in-alt"></i>
            <p>Please log in to view your playlists</p>
            <small>You need to be logged in with Discord to create and manage playlists</small>
          </div>
        \`;
        return;
      }

      try {
        const response = await fetch(BASE + '/api/user/playlists', {
          method: 'GET',
          headers: headers()
        });
        
        if (!response.ok) {
          throw new Error('Failed to load playlists');
        }
        
        userPlaylists = await response.json();
        displayUserPlaylists();
      } catch (error) {
        console.error('Error loading user playlists:', error);
        showNotification('Failed to load playlists', 'error');
        document.getElementById('user-playlists-list').innerHTML = \`
          <div class="empty-playlists">
            <i class="fas fa-exclamation-triangle"></i>
            <p>Failed to load playlists</p>
            <small>Please try again later</small>
          </div>
        \`;
      }
    }

    function displayUserPlaylists() {
      const container = document.getElementById('user-playlists-list');
      
      if (!userPlaylists || userPlaylists.length === 0) {
        container.innerHTML = \`
          <div class="empty-playlists">
            <i class="fas fa-heart"></i>
            <p>No playlists yet</p>
            <small>Create your first playlist to get started!</small>
          </div>
        \`;
        return;
      }

      container.innerHTML = userPlaylists.map(playlist => \`
        <div class="playlist-card bg-surface-800 border border-surface-700 rounded-xl p-4 hover:border-blue-500 hover:-translate-y-1 hover:shadow-xl transition-all duration-300 group cursor-pointer" data-playlist-id="\${playlist.id}" onclick="viewPlaylistDetails('\${playlist.id}')">
          <div class="flex items-center gap-4">
            <!-- Icon -->
            <div class="w-12 h-12 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl flex items-center justify-center text-white shadow-lg group-hover:shadow-blue-500/25 transition-all duration-300 flex-shrink-0">
              <i class="fas fa-music text-lg"></i>
            </div>
            
            <!-- Details -->
            <div class="flex-1 min-w-0">
              <h4 class="font-semibold text-slate-100 text-base leading-tight truncate mb-1" title="\${playlist.name}">
                \${playlist.name}
              </h4>
              <p class="text-sm text-slate-400 truncate">
                \${playlist.tracks?.length || 0} track\${playlist.tracks?.length === 1 ? '' : 's'}
              </p>
              \${playlist.description ? \`
                <p class="text-xs text-slate-500 truncate mt-1" title="\${playlist.description}">
                  \${playlist.description}
                </p>
              \` : ''}
            </div>
            
            <!-- Actions -->
            <div class="playlist-actions flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
              <button 
                class="playlist-action-btn w-9 h-9 bg-surface-700 hover:bg-blue-600 border border-surface-600 hover:border-blue-500 text-slate-300 hover:text-white rounded-lg flex items-center justify-center transition-all duration-200 hover:scale-105" 
                onclick="event.stopPropagation(); playUserPlaylist('\${playlist.id}')" 
                title="Play playlist" 
                aria-label="Play \${playlist.name}">
                <i class="fas fa-play text-sm"></i>
              </button>
              <button 
                class="playlist-action-btn w-9 h-9 bg-surface-700 hover:bg-green-600 border border-surface-600 hover:border-green-500 text-slate-300 hover:text-white rounded-lg flex items-center justify-center transition-all duration-200 hover:scale-105" 
                onclick="event.stopPropagation(); queueUserPlaylist('\${playlist.id}')" 
                title="Add to queue" 
                aria-label="Add \${playlist.name} to queue">
                <i class="fas fa-plus text-sm"></i>
              </button>
              <button 
                class="playlist-action-btn w-9 h-9 bg-surface-700 hover:bg-red-600 border border-surface-600 hover:border-red-500 text-slate-300 hover:text-white rounded-lg flex items-center justify-center transition-all duration-200 hover:scale-105" 
                onclick="event.stopPropagation(); deleteUserPlaylist('\${playlist.id}', '\${playlist.name}')" 
                title="Delete playlist" 
                aria-label="Delete \${playlist.name}">
                <i class="fas fa-trash text-sm"></i>
              </button>
            </div>
          </div>
        </div>
      \`).join('');
    }

    // Playlist detail view state
    let currentPlaylistView = null;
    let playlistDetailInstance = null;
    let suggestionsInstance = null;

    function viewPlaylistDetails(playlistId) {
      const playlist = userPlaylists.find(p => p.id === playlistId);
      if (!playlist) {
        showNotification('Playlist not found', 'error');
        return;
      }

      // Hide main content and show detail view
      const mainContent = document.getElementById('user-playlists-tab');
      const detailContainer = document.getElementById('playlist-detail-container') || createPlaylistDetailContainer();
      
      mainContent.style.display = 'none';
      detailContainer.style.display = 'block';
      
      // Render playlist detail view
      if (playlistDetailInstance) {
        componentManager.destroy(playlistDetailInstance.instanceId);
      }
      
      const { instance, instanceId } = componentManager.render('PlaylistDetailView', detailContainer, {
        playlist: playlist,
        onBack: () => {
          mainContent.style.display = 'block';
          detailContainer.style.display = 'none';
          currentPlaylistView = null;
        },
        onPlaySong: (track, index) => {
          console.log('Playing song:', track.title || track.name);
          showNotification(\`Playing: \${track.title || track.name}\`, 'info');
          // TODO: Implement actual play functionality
        },
        onQueueSong: (track) => {
          console.log('Queuing song:', track.title || track.name);
          showNotification(\`Added to queue: \${track.title || track.name}\`, 'success');
          // TODO: Implement actual queue functionality
        },
        onRemoveSong: (track, index) => {
          // Remove song from playlist
          playlist.tracks.splice(index, 1);
          playlistDetailInstance.instance.updatePlaylist(playlist);
          showNotification(\`Removed: \${track.title || track.name}\`, 'success');
          // TODO: Save to backend
        },
        onPlayAll: (playlist) => {
          console.log('Playing all songs in playlist:', playlist.name);
          showNotification(\`Playing all songs from \${playlist.name}\`, 'info');
          // TODO: Implement actual play all functionality
        },
        onShuffleAll: (playlist) => {
          console.log('Shuffling playlist:', playlist.name);
          showNotification(\`Shuffling \${playlist.name}\`, 'info');
          // TODO: Implement actual shuffle functionality
        }
      });
      
      playlistDetailInstance = { instance, instanceId };
      currentPlaylistView = playlistId;
    }

    function createPlaylistDetailContainer() {
      const container = document.createElement('div');
      container.id = 'playlist-detail-container';
      container.className = 'playlist-detail-container';
      container.style.display = 'none';
      
      // Insert after the user playlists tab
      const userPlaylistsTab = document.getElementById('user-playlists-tab');
      userPlaylistsTab.parentNode.insertBefore(container, userPlaylistsTab.nextSibling);
      
      return container;
    }

    // Suggestions functionality
    function loadSuggestions() {
      // Mock suggestions for now - in real app, this would come from API
      const mockSuggestions = [
        {
          title: "Blinding Lights",
          artist: "The Weeknd",
          duration: "3:20",
          thumbnail: null,
          url: "https://example.com/song1"
        },
        {
          title: "Watermelon Sugar",
          artist: "Harry Styles", 
          duration: "2:54",
          thumbnail: null,
          url: "https://example.com/song2"
        },
        {
          title: "Levitating",
          artist: "Dua Lipa",
          duration: "3:23",
          thumbnail: null,
          url: "https://example.com/song3"
        },
        {
          title: "Good 4 U",
          artist: "Olivia Rodrigo",
          duration: "2:58",
          thumbnail: null,
          url: "https://example.com/song4"
        },
        {
          title: "Stay",
          artist: "The Kid LAROI, Justin Bieber",
          duration: "2:21",
          thumbnail: null,
          url: "https://example.com/song5"
        }
      ];

      const suggestionsContainer = document.getElementById('suggestions-container') || createSuggestionsContainer();
      
      if (suggestionsInstance) {
        suggestionsInstance.instance.setLoading(true);
      }
      
      // Simulate loading delay
      setTimeout(() => {
        if (suggestionsInstance) {
          componentManager.destroy(suggestionsInstance.instanceId);
        }
        
        const { instance, instanceId } = componentManager.render('SuggestionsSection', suggestionsContainer, {
          suggestions: mockSuggestions,
          loading: false,
          onPlaySong: (song) => {
            console.log('Playing suggested song:', song.title);
            showNotification(\`Playing: \${song.title}\`, 'info');
            // TODO: Implement actual play functionality
          },
          onQueueSong: (song) => {
            console.log('Queuing suggested song:', song.title);
            showNotification(\`Added to queue: \${song.title}\`, 'success');
            // TODO: Implement actual queue functionality
          },
          onAddToPlaylist: (song) => {
            // Show playlist selection modal
            showAddToPlaylistModal(song);
          },
          onRefresh: () => {
            loadSuggestions();
          }
        });
        
        suggestionsInstance = { instance, instanceId };
      }, 1000);
    }

    function createSuggestionsContainer() {
      // Use the existing suggestions container from the new layout
      let container = document.getElementById('suggestions-container');
      if (!container) {
        // Fallback: create and add to content area if not found
        container = document.createElement('div');
        container.id = 'suggestions-container';
        container.className = 'mt-8';
        
        const contentArea = document.querySelector('.flex-1.overflow-y-auto');
        if (contentArea) {
          const lastChild = contentArea.lastElementChild;
          if (lastChild) {
            lastChild.appendChild(container);
          }
        }
      }
      
      return container;
    }

    function showAddToPlaylistModal(song) {
      if (userPlaylists.length === 0) {
        showNotification('Create a playlist first to add songs', 'warning');
        return;
      }
      
      // Simple playlist selection for now
      const playlistNames = userPlaylists.map(p => p.name);
      const selectedPlaylist = prompt(\`Add "\${song.title}" to which playlist?\\n\\nAvailable playlists:\\n\${playlistNames.join('\\n')}\`);
      
      if (selectedPlaylist) {
        const playlist = userPlaylists.find(p => p.name === selectedPlaylist);
        if (playlist) {
          // Add song to playlist
          if (!playlist.tracks) {
            playlist.tracks = [];
          }
          playlist.tracks.push(song);
          showNotification(\`Added "\${song.title}" to \${playlist.name}\`, 'success');
          // TODO: Save to backend
        } else {
          showNotification('Playlist not found', 'error');
        }
      }
    }

    async function createPlaylist() {
      const name = document.getElementById('playlist-name').value.trim();
      const description = document.getElementById('playlist-description').value.trim();
      
      if (!name) {
        showNotification('Please enter a playlist name', 'error');
        return;
      }
      
      if (!currentUser) {
        showNotification('Please log in to create playlists', 'error');
        return;
      }

      try {
        const response = await fetch(BASE + '/api/user/playlists', {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify({
            name,
            description,
            tracks: []
          })
        });
        
        if (!response.ok) {
          throw new Error('Failed to create playlist');
        }
        
        const newPlaylist = await response.json();
        userPlaylists.unshift(newPlaylist);
        displayUserPlaylists();
        closeCreatePlaylistModal();
        showNotification(\`Playlist "\${name}" created successfully!\`, 'success');
      } catch (error) {
        console.error('Error creating playlist:', error);
        showNotification('Failed to create playlist', 'error');
      }
    }

    async function deleteUserPlaylist(playlistId, playlistName) {
      if (!confirm(\`Are you sure you want to delete the playlist "\${playlistName}"?\`)) {
        return;
      }

      try {
        const response = await fetch(BASE + \`/api/user/playlists/\${playlistId}\`, {
          method: 'DELETE',
          headers: headers()
        });
        
        if (!response.ok) {
          throw new Error('Failed to delete playlist');
        }
        
        userPlaylists = userPlaylists.filter(p => p.id !== playlistId);
        displayUserPlaylists();
        showNotification(\`Playlist "\${playlistName}" deleted\`, 'success');
      } catch (error) {
        console.error('Error deleting playlist:', error);
        showNotification('Failed to delete playlist', 'error');
      }
    }

    async function playUserPlaylist(playlistId) {
      const playlist = userPlaylists.find(p => p.id === playlistId);
      if (!playlist || !playlist.tracks || playlist.tracks.length === 0) {
        showNotification('Playlist is empty', 'error');
        return;
      }

      if (!currentGuild || !currentChannel) {
        showNotification('Please select a server and channel first', 'error');
        return;
      }

      try {
        const response = await fetch(BASE + '/api/playlist/play', {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify({
            guildId: currentGuild,
            channelId: currentChannel,
            tracks: playlist.tracks
          })
        });

        const result = await response.json();
        
        if (result.success) {
          showNotification(\`Playing playlist: \${playlist.name}\`, 'success');
          updateStatus();
        } else {
          showNotification(result.error || 'Failed to play playlist', 'error');
        }
      } catch (error) {
        showNotification('Failed to play playlist', 'error');
      }
    }

    async function queueUserPlaylist(playlistId) {
      const playlist = userPlaylists.find(p => p.id === playlistId);
      if (!playlist || !playlist.tracks || playlist.tracks.length === 0) {
        showNotification('Playlist is empty', 'error');
        return;
      }

      if (!currentGuild || !currentChannel) {
        showNotification('Please select a server and channel first', 'error');
        return;
      }

      try {
        const response = await fetch(BASE + '/api/playlist/queue', {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify({
            guildId: currentGuild,
            channelId: currentChannel,
            tracks: playlist.tracks
          })
        });

        const result = await response.json();
        
        if (result.success) {
          showNotification(\`Added \${playlist.tracks.length} tracks from "\${playlist.name}" to queue!\`, 'success');
          updateStatus();
        } else {
          showNotification(result.error || 'Failed to queue playlist', 'error');
        }
      } catch (error) {
        showNotification('Failed to queue playlist', 'error');
      }
    }

    function showCreatePlaylistModal() {
      document.getElementById('playlist-name').value = '';
      document.getElementById('playlist-description').value = '';
      document.getElementById('create-playlist-modal').style.display = 'flex';
    }

    function closeCreatePlaylistModal() {
      document.getElementById('create-playlist-modal').style.display = 'none';
    }

    function showAddToPlaylistModal(trackData) {
      if (!currentUser) {
        showNotification('Please log in to add tracks to playlists', 'error');
        return;
      }

      selectedTrackForPlaylist = trackData;
      
      // Show track info
      document.getElementById('add-track-info').innerHTML = \`
        <div class="track-preview">
          <div class="track-thumbnail">
            \${trackData.thumbnail ? 
              \`<img src="\${trackData.thumbnail}" alt="\${trackData.title}" />\` :
              \`<i class="fas fa-music"></i>\`
            }
          </div>
          <div class="track-details">
            <strong>\${trackData.title}</strong>
            <p>\${trackData.author}</p>
          </div>
        </div>
      \`;
      
      // Load playlist options
      const playlistOptions = document.getElementById('playlist-options');
      if (userPlaylists.length === 0) {
        playlistOptions.innerHTML = \`
          <div class="no-playlists">
            <p>No playlists available</p>
            <button class="btn btn-small" onclick="closeAddToPlaylistModal(); showCreatePlaylistModal();">
              <i class="fas fa-plus"></i> Create First Playlist
            </button>
          </div>
        \`;
      } else {
        playlistOptions.innerHTML = userPlaylists.map(playlist => \`
          <div class="playlist-option" onclick="selectPlaylistOption('\${playlist.id}')">
            <div class="playlist-info">
              <strong>\${playlist.name}</strong>
              <small>\${playlist.tracks?.length || 0} tracks</small>
            </div>
            <i class="fas fa-heart"></i>
          </div>
        \`).join('');
      }
      
      document.getElementById('add-to-playlist-modal').style.display = 'flex';
      document.getElementById('confirm-add-btn').disabled = true;
    }

    function closeAddToPlaylistModal() {
      document.getElementById('add-to-playlist-modal').style.display = 'none';
      selectedTrackForPlaylist = null;
    }

    function selectPlaylistOption(playlistId) {
      // Remove previous selection
      document.querySelectorAll('.playlist-option').forEach(opt => opt.classList.remove('selected'));
      
      // Add selection to clicked option
      event.target.closest('.playlist-option').classList.add('selected');
      
      // Enable confirm button
      document.getElementById('confirm-add-btn').disabled = false;
      document.getElementById('confirm-add-btn').onclick = () => addTrackToPlaylist(playlistId);
    }

    async function addTrackToPlaylist(playlistId) {
      if (!selectedTrackForPlaylist) return;

      const playlist = userPlaylists.find(p => p.id === playlistId);
      const playlistName = playlist ? playlist.name : 'playlist';
      const trackTitle = selectedTrackForPlaylist.title || 'Track'; // Store track title before it gets cleared
      
      // Show loading state
      const confirmBtn = document.getElementById('confirm-add-btn');
      const originalText = confirmBtn.innerHTML;
      confirmBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Adding...';
      confirmBtn.disabled = true;

      try {
        const response = await fetch(BASE + \`/api/user/playlists/\${playlistId}/tracks\`, {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify({
            track: selectedTrackForPlaylist
          })
        });
        
        if (response.ok) {
          // Success case
          try {
            const updatedPlaylist = await response.json();
            // Update local playlist data
            const playlistIndex = userPlaylists.findIndex(p => p.id === playlistId);
            if (playlistIndex !== -1) {
              userPlaylists[playlistIndex] = updatedPlaylist;
              displayUserPlaylists();
            }
          } catch (parseError) {
            console.log('Response parse failed but track was added successfully');
            // Update local data manually
            if (playlist) {
              if (!playlist.tracks) playlist.tracks = [];
              playlist.tracks.push(selectedTrackForPlaylist);
              displayUserPlaylists();
            }
          }
          
          closeAddToPlaylistModal();
          showNotification('✅ Added "' + trackTitle + '" to ' + playlistName + '!', 'success');
        } else {
          // Server returned error
          const errorText = await response.text();
          throw new Error(errorText || 'Server error');
        }
      } catch (error) {
        console.error('Error adding track to playlist:', error);
        confirmBtn.innerHTML = originalText;
        confirmBtn.disabled = false;
        
        if (error.message.includes('already exists') || error.message.includes('duplicate')) {
          showNotification('"' + trackTitle + '" is already in ' + playlistName, 'warning');
        } else {
          showNotification('❌ Failed to add track to ' + playlistName + ': ' + error.message, 'error');
        }
      }
    }

    // Make functions globally available
    window.selectServer = selectServer;
    window.playUserPlaylist = playUserPlaylist;
    window.queueUserPlaylist = queueUserPlaylist;
    window.deleteUserPlaylist = deleteUserPlaylist;
    window.showAddToPlaylistModal = showAddToPlaylistModal;

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
    document.getElementById('change-server').addEventListener('click', showServerSelection);
    
    // Tab switching
    document.getElementById('tab-search').addEventListener('click', () => switchTab('search'));
    document.getElementById('tab-playlist').addEventListener('click', () => switchTab('playlist'));
    document.getElementById('tab-user-playlists').addEventListener('click', () => switchTab('user-playlists'));
    
    // Playlist functionality
    document.getElementById('import-playlist-btn').addEventListener('click', importPlaylist);
    document.getElementById('playlist-url').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        importPlaylist();
      }
    });

    // User playlist modal functionality
    document.getElementById('create-playlist-btn').addEventListener('click', showCreatePlaylistModal);
    document.getElementById('modal-close-btn').addEventListener('click', closeCreatePlaylistModal);
    document.getElementById('cancel-playlist-btn').addEventListener('click', closeCreatePlaylistModal);
    document.getElementById('save-playlist-btn').addEventListener('click', createPlaylist);
    
    // Add to playlist modal functionality
    document.getElementById('add-modal-close-btn').addEventListener('click', closeAddToPlaylistModal);
    document.getElementById('cancel-add-btn').addEventListener('click', closeAddToPlaylistModal);

    // Close modals when clicking outside
    document.getElementById('create-playlist-modal').addEventListener('click', (e) => {
      if (e.target.id === 'create-playlist-modal') {
        closeCreatePlaylistModal();
      }
    });
    
    document.getElementById('add-to-playlist-modal').addEventListener('click', (e) => {
      if (e.target.id === 'add-to-playlist-modal') {
        closeAddToPlaylistModal();
      }
    });

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
    // Helper function for auto-play button
    function updateAutoplayButton(enabled) {
      const statusSpan = els.btnAutoplay.querySelector('.autoplay-status');
      statusSpan.textContent = enabled ? 'ON' : 'OFF';
      statusSpan.style.color = enabled ? '#4CAF50' : '#f44336';
      els.btnAutoplay.style.backgroundColor = enabled ? 'rgba(76, 175, 80, 0.1)' : 'rgba(244, 67, 54, 0.1)';
    }
    
    els.btnAutoplay.addEventListener('click', async () => {
      try {
        // Check if we have required values
        if (!currentGuild || !currentChannel) {
          showNotification('Please connect to a voice channel first', 'warning');
          return;
        }

        const response = await fetch(BASE + '/api/control', {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify({
            guildId: currentGuild,
            channelId: currentChannel,
            action: 'autoplay'
          })
        });

        const result = await response.json();
        
        if (result.success && result.autoPlayEnabled !== undefined) {
          updateAutoplayButton(result.autoPlayEnabled);
          showNotification('Auto-play ' + (result.autoPlayEnabled ? 'enabled' : 'disabled'), 'success');
        } else {
          showNotification(result.error || 'Failed to toggle auto-play', 'error');
        }
      } catch (error) {
        console.error('Auto-play toggle error:', error);
        showNotification('Failed to toggle auto-play', 'error');
      }
    });
    
    // Initialize auto-play button status on page load
    async function loadAutoplayStatus() {
      try {
        const params = new URLSearchParams({ guildId: currentGuild || '', channelId: currentChannel || '' });
        const response = await fetch(BASE + '/api/status?' + params.toString());
        if (response.ok) {
          const status = await response.json();
          if (status.currentTrack && status.autoPlayEnabled !== undefined) {
            updateAutoplayButton(status.autoPlayEnabled);
          }
        }
      } catch (error) {
        console.error('Failed to load auto-play status:', error);
      }
    }
    
    els.btnClearQueue.addEventListener('click', async () => {
      if (confirm('Are you sure you want to clear the entire queue?')) {
        const result = await control('clearqueue');
        if (result && result.success) {
          showNotification('Queue cleared successfully', 'success');
        } else {
          showNotification('Failed to clear queue', 'error');
        }
      }
    });

    document.getElementById('btn-fill-queue').addEventListener('click', async () => {
      try {
        // Check if we have required values
        if (!currentGuild || !currentChannel) {
          showNotification('Please connect to a voice channel first', 'warning');
          return;
        }

        const result = await control('fillqueue');
        if (result && result.success) {
          showNotification('Queue filled with recommendations!', 'success');
        } else {
          showNotification(result?.error || 'Failed to fill queue', 'error');
        }
      } catch (error) {
        console.error('Fill queue error:', error);
        showNotification('Failed to fill queue', 'error');
      }
    });

    els.progressBar.addEventListener('click', async (e) => {
      if (!currentTrack || totalTime === 0) return;
      
      const rect = els.progressBar.getBoundingClientRect();
      const percent = (e.clientX - rect.left) / rect.width;
      const seekTime = Math.floor(percent * totalTime);
      
      await control('seek', seekTime);
    });

    // Progress tracking variables
    let progressEventSource = null;
    let isProcessingTrack = false;

    // Connect to progress stream
    function connectToProgressStream() {
      if (progressEventSource) {
        progressEventSource.close();
      }
      
      progressEventSource = new EventSource(BASE + '/api/progress');
      
      progressEventSource.onopen = () => {
        console.log('Connected to progress stream');
      };
      
      progressEventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'progress') {
            updateDownloadProgress(data);
          }
        } catch (error) {
          console.error('Error parsing progress data:', error);
        }
      };
      
      progressEventSource.onerror = (error) => {
        console.log('Progress stream error, reconnecting in 5s...');
        setTimeout(connectToProgressStream, 5000);
      };
    }

    // Update download progress UI
    function updateDownloadProgress(data) {
      const progressSection = document.getElementById('download-progress');
      const titleEl = document.getElementById('download-title');
      const statusEl = document.getElementById('download-status');
      const fillEl = document.getElementById('download-fill');
      const percentEl = document.getElementById('download-percent');
      
      // Ignore progress for other servers/channels if context is provided
      if (data.guildId && currentGuild && data.guildId !== currentGuild) return;
      if (data.channelId && currentChannel && data.channelId !== currentChannel) return;

      const isCurrentTrack = currentTrack && data.title && (currentTrack.title === data.title);
      const isPrefetch = Boolean(data.prefetch) || !isCurrentTrack;

      if (!isProcessingTrack && data.progress < 100) {
        // Show progress bar when processing starts
        isProcessingTrack = true;
        progressSection.style.display = 'block';
      }
      
      // Visual hint when prefetching vs preparing the current track
      titleEl.textContent = (isPrefetch ? 'Warming next track: ' : '') + (data.title || 'Processing track...');
      statusEl.textContent = (isPrefetch ? 'Prefetching • ' : '') + (data.status || 'Processing...');
      fillEl.style.width = data.progress + '%';
      percentEl.textContent = data.progress + '%';
      
      if (data.progress >= 100) {
        // Hide progress bar after a short delay
        setTimeout(() => {
          progressSection.style.display = 'none';
          isProcessingTrack = false;
        }, 1500);
      }
    }

    // Connect to progress stream on page load
    connectToProgressStream();

    // Auto-refresh status more frequently for better sync
    setInterval(() => {
      updateStatus();
      updateProgressDisplay(); // Update progress display for smooth timeline
    }, 1000);
  </script>
</body>
</html>`;
      
      res.send(html);
    });

    // API Routes
    this.app.get('/api/guilds', this.auth, async (req, res) => {
      try {
        // Check if user is authenticated and get their guild list from Discord
        if (req.user && req.user.access_token) {
          try {
            // Get user's guilds from Discord API
            const userGuildsResponse = await axios.get('https://discord.com/api/users/@me/guilds', {
              headers: { Authorization: `Bearer ${req.user.access_token}` }
            });
            
            const userGuilds = userGuildsResponse.data;
            const userGuildIds = new Set(userGuilds.map(g => g.id));
            
            // Filter bot guilds to only include ones the user is a member of
            if (this.bot.client && this.bot.client.guilds && this.bot.client.guilds.cache.size > 0) {
              const filteredGuilds = this.bot.client.guilds.cache
                .filter(guild => userGuildIds.has(guild.id))
                .map(guild => ({
                  id: guild.id,
                  name: guild.name,
                  memberCount: guild.memberCount,
                  iconURL: guild.iconURL({ size: 256, extension: 'png' }) || null
                }));
              
              res.json(filteredGuilds);
            } else {
              res.json([]);
            }
          } catch (authError) {
            console.error('Error fetching user guilds:', authError);
            // Fall back to showing all bot guilds if auth fails
            if (this.bot.client && this.bot.client.guilds && this.bot.client.guilds.cache.size > 0) {
              const guilds = this.bot.client.guilds.cache.map(guild => ({
                id: guild.id,
                name: guild.name,
                memberCount: guild.memberCount,
                iconURL: guild.iconURL({ size: 256, extension: 'png' }) || null
              }));
              res.json(guilds);
            } else {
              res.json([]);
            }
          }
        } else {
          // No authentication - show all bot guilds (backward compatibility)
          if (this.bot.client && this.bot.client.guilds && this.bot.client.guilds.cache.size > 0) {
            const guilds = this.bot.client.guilds.cache.map(guild => ({
              id: guild.id,
              name: guild.name,
              memberCount: guild.memberCount,
              iconURL: guild.iconURL({ size: 256, extension: 'png' }) || null
            }));
            res.json(guilds);
          } else {
            // Return demo server when Discord is not connected
            res.json([{
              id: 'demo',
              name: 'Demo Server (Discord Disconnected)',
              memberCount: 0,
              iconURL: null
            }]);
          }
        }
      } catch (error) {
        console.error('Error in /api/guilds:', error);
        // Return fallback response
        res.json([{
          id: 'error',
          name: 'Error Loading Servers',
          memberCount: 0,
          iconURL: null
        }]);
      }
    });

    this.app.get('/api/channels/:guildId', this.auth, (req, res) => {
      try {
        // Handle demo server case when Discord is not connected
        if (req.params.guildId === 'demo' || req.params.guildId === 'error') {
          return res.json({ 
            channels: [{
              id: 'demo-channel',
              name: 'Demo Voice Channel',
              memberCount: 0,
              connected: false
            }],
            connectedChannel: null
          });
        }

        // Check if Discord client is available
        if (!this.bot.client || !this.bot.client.guilds) {
          return res.json({ 
            channels: [{
              id: 'unavailable',
              name: 'Voice channels unavailable (Discord disconnected)',
              memberCount: 0,
              connected: false
            }],
            connectedChannel: null
          });
        }

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
        console.error('Error in /api/channels:', error);
        res.json({ 
          channels: [{
            id: 'error',
            name: 'Error loading channels',
            memberCount: 0,
            connected: false
          }],
          connectedChannel: null
        });
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
          case 'autoplay':
          case 'clearqueue':
            const musicManager = this.bot.musicManagers?.get(channelId);
            if (musicManager) {
              if (action === 'pause') musicManager.pause();
              else if (action === 'resume') musicManager.resume();
              else if (action === 'skip') musicManager.skip();
              else if (action === 'previous') musicManager.previous();
              else if (action === 'shuffle') musicManager.toggleShuffle();
              else if (action === 'repeat') musicManager.toggleRepeat();
              else if (action === 'autoplay') {
                const enabled = musicManager.setAutoPlay(!musicManager.autoPlayEnabled);
                result = { success: true, autoPlayEnabled: enabled };
              }
              else if (action === 'clearqueue') {
                musicManager.clearQueue(true); // true indicates user-initiated
                result = { success: true, message: 'Queue cleared successfully' };
              }
              else if (action === 'fillqueue') {
                if (musicManager.autoPlayEnabled) {
                  musicManager.fillQueueWithRecommendations(5, {});
                  result = { success: true, message: 'Queue filled with recommendations' };
                } else {
                  result = { success: false, error: 'Auto-play must be enabled to fill queue' };
                }
              }
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
        const { guildId, channelId } = req.query || {};
        // Prefer explicit guild/channel
        let connection = null;
        if (guildId && channelId) {
          const existing = this.bot.stayConnectedManager.connections.get(guildId);
          if (existing && existing.joinConfig?.channelId === channelId) {
            connection = existing;
          }
        }
        // Fallback to any connection
        if (!connection) {
          const connections = Array.from(this.bot.stayConnectedManager.connections.values());
          connection = connections[0];
        }

        let status = {
          connected: !!connection,
          guildId: guildId || (connection?.joinConfig?.guildId || null),
          channelId: channelId || (connection?.joinConfig?.channelId || null),
          channel: null,
          currentTrack: null,
          isPlaying: false,
          currentTime: 0,
          totalTime: 0,
          queue: [],
          currentIndex: -1,
          autoPlayEnabled: true // Default value
        };

        const targetGuildId = guildId || connection?.joinConfig?.guildId;
        const targetChannelId = channelId || connection?.joinConfig?.channelId;
        if (targetGuildId && targetChannelId) {
          const guild = this.bot.client.guilds.cache.get(targetGuildId);
          const channel = guild?.channels.cache.get(targetChannelId);
          
          if (channel) {
            status.channel = channel.name;
            
            // Get music manager for this channel
            const musicManager = this.bot.musicManagers?.get(targetChannelId);
            if (musicManager) {
              status.currentTrack = musicManager.currentTrack;
              status.isPlaying = musicManager.isPlaying && !musicManager.isPaused;
              
              // Calculate current time based on track start time and pause state
              if (musicManager.trackStartTime && musicManager.currentTrack) {
                if (musicManager.isPaused && typeof musicManager._lastPositionAtPauseMs === 'number') {
                  // Use the position where we paused
                  status.currentTime = Math.floor(musicManager._lastPositionAtPauseMs / 1000);
                } else if (musicManager.isPlaying && !musicManager.isPaused) {
                  // Calculate current time from track start
                  status.currentTime = Math.floor((Date.now() - musicManager.trackStartTime) / 1000);
                } else if (musicManager.isPaused) {
                  // When paused but no explicit pause time, calculate from start time
                  const pausedPosition = Date.now() - musicManager.trackStartTime;
                  status.currentTime = Math.floor(pausedPosition / 1000);
                } else {
                  status.currentTime = 0;
                }
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
              status.autoPlayEnabled = musicManager.autoPlayEnabled;
            }
          }
        }

        res.json(status);
      } catch (error) {
        console.error('Status error:', error);
        res.status(500).json({ error: error.message });
      }
    });

    // Server-Sent Events endpoint for progress updates
    this.app.get('/api/progress', this.auth, (req, res) => {
      // Set up SSE headers
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Cache-Control'
      });

      // Add client to the set
      this.progressClients.add(res);
      
      // Send initial connection confirmation
      res.write('data: {"type": "connected"}\n\n');

      // Clean up when client disconnects
      req.on('close', () => {
        this.progressClients.delete(res);
      });
    });
  }

  setupProgressListener() {
    // Listen for progress events from AudioProcessor
    // The audioProcessor is in SourceHandlers, which might be in different places
    setTimeout(() => {
      // Try to find the audioProcessor in the bot structure
      let audioProcessor = null;
      
      // Check if it's in SourceHandlers
      if (this.bot.sourceHandlers?.audioProcessor) {
        audioProcessor = this.bot.sourceHandlers.audioProcessor;
      }
      
      // Check MusicManagers for audioProcessor
      if (!audioProcessor && this.bot.musicManagers) {
        for (const [key, musicManager] of this.bot.musicManagers) {
          if (musicManager.sourceHandlers?.audioProcessor) {
            audioProcessor = musicManager.sourceHandlers.audioProcessor;
            break;
          }
        }
      }
      
      if (audioProcessor) {
        console.log('🔗 Connected to AudioProcessor for progress updates');
        audioProcessor.on('progress', (data) => {
          this.broadcastProgress(data);
        });
      } else {
        console.log('⚠️ AudioProcessor not found, progress updates disabled');
      }
    }, 1000); // Wait for bot initialization
  }

  broadcastProgress(data) {
    const message = `data: ${JSON.stringify({ type: 'progress', ...data })}\n\n`;
    
    // Send to all connected clients
    for (const client of this.progressClients) {
      try {
        client.write(message);
      } catch (error) {
        // Remove client if write fails
        this.progressClients.delete(client);
      }
    }
  }

  setupAuthRoutes() {
    // Discord OAuth login route
    this.app.get('/auth/discord', (req, res) => {
      if (!this.discordClientId) {
        return res.status(500).json({ error: 'Discord OAuth not configured. Please set DISCORD_CLIENT_ID in your .env file.' });
      }
      
      const authUrl = `https://discord.com/api/oauth2/authorize?client_id=${this.discordClientId}&redirect_uri=${encodeURIComponent(this.discordRedirectUri)}&response_type=code&scope=identify%20guilds`;
      res.redirect(authUrl);
    });

    // Discord OAuth callback route
    this.app.get('/auth/discord/callback', async (req, res) => {
      try {
        const { code } = req.query;
        if (!code) {
          return res.status(400).json({ error: 'No authorization code provided' });
        }

        // Exchange code for access token
        const params = new URLSearchParams();
        params.append('client_id', this.discordClientId);
        params.append('client_secret', this.discordClientSecret);
        params.append('grant_type', 'authorization_code');
        params.append('code', code);
        params.append('redirect_uri', this.discordRedirectUri);
        
        const tokenResponse = await axios.post('https://discord.com/api/oauth2/token', params, {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        const { access_token } = tokenResponse.data;

        // Get user info
        const userResponse = await axios.get('https://discord.com/api/users/@me', {
          headers: { Authorization: `Bearer ${access_token}` }
        });

        const user = userResponse.data;
        
        // Create session
        const sessionId = Math.random().toString(36).substring(2, 15);
        this.sessions.set(sessionId, {
          discordUser: {
            id: user.id,
            username: user.username,
            discriminator: user.discriminator,
            avatar: user.avatar,
            access_token: access_token
          }
        });

        // Redirect back to main page with session
        res.redirect(`/?session=${sessionId}`);
      } catch (error) {
        console.error('Discord OAuth error:', error);
        res.status(500).json({ error: 'Authentication failed' });
      }
    });

    // Get current user info
    this.app.get('/api/user', this.auth, (req, res) => {
      if (req.user) {
        const { access_token, ...userInfo } = req.user;
        res.json({ user: userInfo });
      } else {
        res.json({ user: null });
      }
    });

    // Logout route
    this.app.post('/api/logout', (req, res) => {
      const sessionId = req.headers['x-session-id'];
      if (sessionId && this.sessions.has(sessionId)) {
        this.sessions.delete(sessionId);
      }
      res.json({ success: true });
    });

    // User-specific playlist routes
    this.app.get('/api/user/playlists', this.auth, async (req, res) => {
      try {
        if (!req.user) {
          return res.status(401).json({ error: 'User not authenticated' });
        }

        const playlists = await firebaseService.getUserPlaylists(req.user.id);
        res.json(playlists || []);
      } catch (error) {
        console.error('Error fetching user playlists:', error);
        res.status(500).json({ error: 'Failed to fetch playlists' });
      }
    });

    this.app.post('/api/user/playlists', this.auth, async (req, res) => {
      try {
        if (!req.user) {
          return res.status(401).json({ error: 'User not authenticated' });
        }

        const { name, description, tracks = [] } = req.body;
        if (!name) {
          return res.status(400).json({ error: 'Playlist name required' });
        }

        const playlist = {
          id: Math.random().toString(36).substring(2, 15),
          name,
          description: description || '',
          tracks,
          createdBy: req.user.id,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };

        await firebaseService.saveUserPlaylist(req.user.id, playlist);
        res.json(playlist);
      } catch (error) {
        console.error('Error creating user playlist:', error);
        res.status(500).json({ error: 'Failed to create playlist' });
      }
    });

    this.app.put('/api/user/playlists/:playlistId', this.auth, async (req, res) => {
      try {
        if (!req.user) {
          return res.status(401).json({ error: 'User not authenticated' });
        }

        const { playlistId } = req.params;
        const { name, description, tracks } = req.body;

        const playlists = await firebaseService.getUserPlaylists(req.user.id);
        const playlist = playlists?.find(p => p.id === playlistId);

        if (!playlist) {
          return res.status(404).json({ error: 'Playlist not found' });
        }

        if (playlist.createdBy !== req.user.id) {
          return res.status(403).json({ error: 'Not authorized to edit this playlist' });
        }

        const updatedPlaylist = {
          ...playlist,
          name: name || playlist.name,
          description: description !== undefined ? description : playlist.description,
          tracks: tracks || playlist.tracks,
          updatedAt: new Date().toISOString()
        };

        await firebaseService.updateUserPlaylist(req.user.id, updatedPlaylist);
        res.json(updatedPlaylist);
      } catch (error) {
        console.error('Error updating user playlist:', error);
        res.status(500).json({ error: 'Failed to update playlist' });
      }
    });

    this.app.delete('/api/user/playlists/:playlistId', this.auth, async (req, res) => {
      try {
        if (!req.user) {
          return res.status(401).json({ error: 'User not authenticated' });
        }

        const { playlistId } = req.params;
        const playlists = await firebaseService.getUserPlaylists(req.user.id);
        const playlist = playlists?.find(p => p.id === playlistId);

        if (!playlist) {
          return res.status(404).json({ error: 'Playlist not found' });
        }

        if (playlist.createdBy !== req.user.id) {
          return res.status(403).json({ error: 'Not authorized to delete this playlist' });
        }

        await firebaseService.deleteUserPlaylist(req.user.id, playlistId);
        res.json({ success: true });
      } catch (error) {
        console.error('Error deleting user playlist:', error);
        res.status(500).json({ error: 'Failed to delete playlist' });
      }
    });

    // Add track to playlist
    this.app.post('/api/user/playlists/:playlistId/tracks', this.auth, async (req, res) => {
      try {
        const { playlistId } = req.params;
        const { track } = req.body;

        if (!track) {
          return res.status(400).json({ error: 'Track data is required' });
        }

        // Get current playlists to find the one to update
        const playlists = await firebaseService.getUserPlaylists(req.user.id);
        const playlist = playlists.find(p => p.id === playlistId);

        if (!playlist) {
          return res.status(404).json({ error: 'Playlist not found' });
        }

        // Check ownership
        if (playlist.createdBy !== req.user.id) {
          return res.status(403).json({ error: 'Not authorized to modify this playlist' });
        }

        // Add the track to the playlist
        const tracks = playlist.tracks || [];
        tracks.push(track);

        const updatedPlaylist = {
          ...playlist,
          tracks
        };

        await firebaseService.updateUserPlaylist(req.user.id, updatedPlaylist);
        res.json(updatedPlaylist);
      } catch (error) {
        console.error('Error adding track to playlist:', error);
        res.status(500).json({ error: 'Failed to add track to playlist' });
      }
    });
  }

  setupPlaylistRoutes() {
    // Playlist API endpoints
    this.app.post('/api/playlist/import', this.auth, async (req, res) => {
      try {
        const { url } = req.body;
        
        if (!url) {
          return res.status(400).json({ success: false, error: 'URL is required' });
        }

        // Check if playlistManager is available
        if (!this.bot.playlistManager) {
          console.error('PlaylistManager not available');
          return res.status(503).json({ 
            success: false, 
            error: 'Playlist service not available - bot not fully initialized' 
          });
        }

        console.log(`📥 Processing playlist import request: ${url}`);
        const playlist = await this.bot.playlistManager.importPlaylist(url);
        console.log(`✅ Playlist import successful: ${playlist.name} (${playlist.tracks.length} tracks)`);
        res.json({ success: true, playlist });
      } catch (error) {
        console.error('Playlist import error:', error);
        res.status(500).json({ 
          success: false, 
          error: `Failed to import playlist: ${error.message}`,
          message: error.message 
        });
      }
    });

    this.app.post('/api/playlist/queue', this.auth, async (req, res) => {
      try {
        const { guildId, channelId, tracks } = req.body;
        
        if (!guildId || !channelId || !tracks?.length) {
          return res.status(400).json({ 
            success: false, 
            error: 'Guild ID, channel ID, and tracks are required' 
          });
        }

        const result = await this.bot.playlistManager.queuePlaylist(guildId, channelId, tracks);
        res.json(result);
      } catch (error) {
        console.error('Playlist queue error:', error);
        res.status(500).json({ 
          success: false, 
          error: 'Failed to queue playlist',
          message: error.message 
        });
      }
    });

    this.app.post('/api/playlist/play', this.auth, async (req, res) => {
      try {
        const { guildId, channelId, tracks } = req.body;
        
        if (!guildId || !channelId || !tracks?.length) {
          return res.status(400).json({ 
            success: false, 
            error: 'Guild ID, channel ID, and tracks are required' 
          });
        }

        const result = await this.bot.playlistManager.playPlaylist(guildId, channelId, tracks);
        res.json(result);
      } catch (error) {
        console.error('Playlist play error:', error);
        res.status(500).json({ 
          success: false, 
          error: 'Failed to play playlist',
          message: error.message 
        });
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
          const publicUrl = this.publicHost && this.publicHost !== 'localhost' 
            ? `http://${this.publicHost}:${this.publicPort}` 
            : `http://localhost:${this.port}`;
          console.log(`🕸️ Web portal started: ${publicUrl}`);
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
