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
    
    // Store SSE clients for progress updates
    this.progressClients = new Set();
    
    this.setupRoutes();
    this.setupPlaylistRoutes();
    this.setupProgressListener();
  }

  auth(req, res, next) {
    // Simple auth bypass for now
    next();
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
    }

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
      transition: all 0.2s ease;
    }

    .playlist-input:focus {
      outline: none;
      border-color: var(--accent);
      box-shadow: 0 0 0 3px var(--accent-light);
    }

    .playlist-btn {
      background: var(--gradient-primary);
      color: white;
      border: none;
      border-radius: 12px;
      padding: 1rem 1.5rem;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s ease;
      display: flex;
      align-items: center;
      gap: 0.5rem;
      white-space: nowrap;
    }

    .playlist-btn:hover {
      transform: translateY(-1px);
      box-shadow: var(--shadow-md);
    }

    .playlist-btn:disabled {
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
  <div id="music-interface-container" class="main-container" style="display: none;">
    <!-- Sidebar -->
    <div class="sidebar">
      <div class="server-header">
        <h3 id="current-server-name">Current Server</h3>
        <button class="btn btn-outline btn-small" id="change-server">
          <i class="fas fa-exchange-alt"></i> Change Server
        </button>
      </div>
      
      <div class="connection-section">
        <h4>Voice Channel</h4>
        <select class="form-control" id="channel" style="margin-bottom: 1rem;">
          <option value="">Select voice channel...</option>
        </select>
        
        <div style="display: flex; gap: 0.5rem; margin-bottom: 2rem;">
          <button class="btn btn-small" id="connect">
            <i class="fas fa-plug"></i> Connect
          </button>
          <button class="btn btn-secondary btn-small" id="disconnect">
            <i class="fas fa-times"></i> Disconnect
          </button>
        </div>
      </div>
      
      <h4>Music Controls</h4>
      <div style="display: flex; flex-direction: column; gap: 0.5rem;">
        <button class="btn btn-secondary btn-small" id="btn-shuffle">
          <i class="fas fa-random"></i> Shuffle
        </button>
        <button class="btn btn-secondary btn-small" id="btn-repeat">
          <i class="fas fa-repeat"></i> Repeat
        </button>
        <button class="btn btn-secondary btn-small" id="btn-autoplay" style="position: relative;">
          <i class="fas fa-magic"></i> Auto-play
          <span class="autoplay-status" style="position: absolute; right: 8px; top: 50%; transform: translateY(-50%); font-size: 0.7rem; opacity: 0.7;">OFF</span>
        </button>
        <button class="btn btn-danger btn-small" id="btn-clear-queue">
          <i class="fas fa-trash"></i> Clear Queue
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
        
        <div class="search-tabs">
          <button class="tab-btn active" id="tab-search">
            <i class="fas fa-search"></i> Search Music
          </button>
          <button class="tab-btn" id="tab-playlist">
            <i class="fas fa-list-ul"></i> Import Playlist
          </button>
        </div>

        <!-- Search Tab -->
        <div id="search-tab" class="tab-content active">
          <div class="search-container">
            <i class="fas fa-search search-icon"></i>
            <input type="text" class="search-input" id="search" placeholder="Search for songs, artists, or playlists..." />
            <button class="search-btn" id="search-btn">Search</button>
          </div>
          
          <div id="results" class="track-grid"></div>
        </div>

        <!-- Playlist Tab -->
        <div id="playlist-tab" class="tab-content">
          <div class="playlist-container">
            <div class="playlist-input-section">
              <label for="playlist-url">Playlist URL</label>
              <div class="playlist-input-group">
                <i class="fas fa-link playlist-icon"></i>
                <input type="text" class="playlist-input" id="playlist-url" placeholder="Paste Spotify or YouTube playlist URL..." />
                <button class="playlist-btn" id="import-playlist-btn">
                  <i class="fas fa-download"></i> Import
                </button>
              </div>
              <div class="playlist-examples">
                <small>
                  <strong>Supported:</strong> 
                  <span class="example-link">spotify.com/playlist/...</span> • 
                  <span class="example-link">youtube.com/playlist?list=...</span>
                </small>
              </div>
            </div>
            
            <div id="playlist-results" class="playlist-results"></div>
          </div>
        </div>
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

  <script>
    const BASE = '${base}';
    let currentGuild = null;
    let currentChannel = null;
    let currentTrack = null;
    let isPlaying = false;
    let currentTime = 0;
    let totalTime = 0;
    let loadedServers = null; // Cache loaded servers

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

    // Initialize
    window.addEventListener('load', () => {
      // ALWAYS show server selection first
      loadServersForSelection();
      updateStatus();
      setInterval(updateStatus, 1000);
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
        const channels = data.channels || data; // Handle both old and new response formats
        
        els.channel.innerHTML = '<option value="">Select voice channel...</option>';
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

    // Tab switching functionality
    function switchTab(tabName) {
      // Remove active class from all tabs and content
      document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
      
      // Add active class to selected tab and content
      document.getElementById('tab-' + tabName).classList.add('active');
      document.getElementById(tabName + '-tab').classList.add('active');
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

    // Make functions globally available
    window.selectServer = selectServer;

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
    
    // Playlist functionality
    document.getElementById('import-playlist-btn').addEventListener('click', importPlaylist);
    document.getElementById('playlist-url').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        importPlaylist();
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
    setInterval(updateStatus, 1000);
  </script>
</body>
</html>`;
      
      res.send(html);
    });

    // API Routes
    this.app.get('/api/guilds', this.auth, (req, res) => {
      try {
        // Check if Discord client is ready and has guilds
        if (this.bot.client && this.bot.client.guilds && this.bot.client.guilds.cache.size > 0) {
          const guilds = this.bot.client.guilds.cache.map(guild => ({
            id: guild.id,
            name: guild.name,
            memberCount: guild.memberCount,
            iconURL: guild.iconURL({ size: 256, extension: 'png' }) || null
          }));
          res.json(guilds);
        } else {
          // Return empty array or demo server when Discord is not connected
          res.json([{
            id: 'demo',
            name: 'Demo Server (Discord Disconnected)',
            memberCount: 0,
            iconURL: null
          }]);
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
