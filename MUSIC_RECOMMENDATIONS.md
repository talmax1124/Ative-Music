# 🎵 Enhanced Music Recommendation System

Your Ative Music bot now includes a sophisticated music recommendation engine that uses multiple APIs and machine learning techniques to provide intelligent music suggestions.

## 🚀 Features

### Multi-Source Recommendations
- **Last.fm API**: Track similarity and genre-based recommendations
- **Spotify API**: Audio feature analysis and genre recommendations  
- **TheAudioDB**: Artist information and related tracks
- **Smart Fallbacks**: Multiple sources ensure recommendations are always available

### Intelligent Algorithms
- **Collaborative Filtering**: Learn from user preferences and similar users
- **Content-Based Filtering**: Analyze audio features and metadata
- **Hybrid Approach**: Combine multiple recommendation strategies
- **Anti-Recommendation**: Avoid unwanted genres/artists
- **Diversity Control**: Prevent repetitive recommendations

### Advanced Features
- **Real-time Learning**: Adapts based on user listening patterns
- **Smart Queue Building**: Generate entire playlists from a single track
- **Rate Limiting**: Respectful API usage with intelligent caching
- **Content Filtering**: Automatic removal of non-music content

## 🔧 Setup

### 1. API Keys (Optional but Recommended)

Add these to your `.env` file for enhanced recommendations:

```bash
# Last.fm API (Free) - Get from https://www.last.fm/api/account/create
LASTFM_API_KEY=your_lastfm_api_key_here

# Spotify API (Free) - Get from https://developer.spotify.com/dashboard
SPOTIFY_CLIENT_ID=your_spotify_client_id_here
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret_here

# TheAudioDB (Free tier available) - Get from https://www.theaudiodb.com/api_guide.php
AUDIODB_API_KEY=your_audiodb_key_here
```

### 2. No Setup Required!

The system works out of the box with intelligent fallbacks. API keys simply enhance the quality of recommendations.

## 🎮 Usage

### In Discord

The enhanced recommendations work automatically with your existing commands:

- **Auto-play**: Automatically uses advanced recommendations when queue is low
- **Smart Queue**: Use the brain button (🧠) to create intelligent playlists
- **Learning**: System learns from user preferences over time

### Web Portal

New API endpoints are available:

```javascript
// Get personalized recommendations
POST /api/recommendations
{
  "currentTrack": { "title": "Song Name", "artist": "Artist Name" },
  "guildId": "server_id",
  "channelId": "voice_channel_id",
  "count": 10
}

// Create smart queue from a track
POST /api/smartqueue  
{
  "track": { "title": "Seed Song", "artist": "Artist" },
  "guildId": "server_id", 
  "channelId": "voice_channel_id"
}
```

## 🧠 How It Works

### Recommendation Strategies

1. **API Similar Tracks** (35% weight)
   - Uses Last.fm and Spotify to find tracks similar to current song
   - Analyzes audio features and user listening patterns

2. **API Genre Recommendations** (25% weight)  
   - Finds popular tracks in the same genre
   - Uses multiple sources for genre classification

3. **User Preferred Artists** (20% weight)
   - Recommends tracks from artists the user enjoys
   - Based on listening history and explicit preferences

4. **Collaborative Filtering** (15% weight)
   - Finds users with similar taste and recommends their favorites
   - Machine learning approach to discover new music

5. **Theme-Based** (10% weight)
   - Maintains musical coherence based on current track's mood/genre
   - Ensures smooth transitions between songs

6. **Pattern Matching** (8% weight)
   - Learns from user's listening patterns (time of day, mood, etc.)
   - Adapts recommendations to context

### Quality Assurance

- **Content Filtering**: Removes playlists, compilations, and non-music content
- **Diversity Control**: Prevents the same artist from appearing too frequently  
- **Quality Scoring**: Multiple factors determine recommendation ranking
- **Fallback Systems**: Multiple layers ensure recommendations are always available

## 📊 Performance

### Caching & Rate Limiting
- **Smart Caching**: 1-hour cache for API responses
- **Rate Limiting**: Respectful API usage (4 requests/minute for Last.fm)
- **Parallel Processing**: Multiple APIs queried simultaneously
- **Graceful Degradation**: System works even when APIs are unavailable

### Optimization
- **Lazy Loading**: APIs only called when needed
- **Intelligent Scoring**: Multiple factors combined for best results
- **Memory Efficient**: Automatic cache cleanup
- **Fast Response**: Cached results return instantly

## 🔍 Troubleshooting

### Common Issues

**No recommendations returned:**
- Check your internet connection
- Verify API keys in `.env` file
- Try with more popular artists/songs

**Poor recommendation quality:**
- Add API keys for better data sources
- Let the system learn from more listening sessions
- Check that tracks have proper metadata (title, artist)

**Rate limiting warnings:**
- Normal behavior - system automatically handles this
- Multiple APIs provide redundancy
- Caching reduces API calls

### Debug Mode

Enable debug logging:
```bash
DEBUG=true
```

Monitor console output for detailed recommendation process information.

## 🚀 Advanced Usage

### Custom User Preferences

The system automatically learns, but you can also explicitly set preferences:

```javascript
// In your bot code
userPreferences.setPreferredGenres(userId, guildId, ['reggaeton', 'pop']);
userPreferences.setAvoidedArtists(userId, guildId, ['artist_to_avoid']);
```

### Bulk Queue Generation

Generate large playlists programmatically:

```javascript
const playlist = await smartAutoPlay.generateContinuousPlaylist(seedTrack, 50, userContext);
```

## 📈 Future Enhancements

Planned improvements:
- **Audio Analysis**: Direct audio feature extraction
- **Mood Detection**: Real-time mood analysis
- **Social Features**: Friend-based recommendations
- **ML Training**: Custom neural networks for your server's preferences

---

🎵 **Enjoy your enhanced music recommendations!** The system will continue learning and improving based on your server's listening patterns.