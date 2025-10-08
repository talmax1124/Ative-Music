const axios = require('axios');
const firebaseService = require('./FirebaseService.js');

class PlaylistManager {
    constructor() {
        this.firebaseService = firebaseService;
    }

    // === WEB PORTAL METHODS ===

  async importPlaylist(url) {
    try {
      // Determine source
      const source = this.detectPlaylistSource(url);
      
      switch (source) {
        case 'spotify':
          return await this.importSpotifyPlaylist(url);
        case 'youtube':
          return await this.importYouTubePlaylist(url);
        default:
          throw new Error('Unsupported playlist source');
      }
    } catch (error) {
      console.error('Playlist import error:', error);
      throw error;
    }
  }

  detectPlaylistSource(url) {
    if (url.includes('spotify.com/playlist/')) {
      return 'spotify';
    } else if (url.includes('youtube.com/playlist') || url.includes('youtu.be/playlist')) {
      return 'youtube';
    }
    return 'unknown';
  }

  async importSpotifyPlaylist(url) {
    try {
      // Prefer using SourceHandlers (accurate via API)
      if (this.bot && this.bot.sourceHandlers && this.bot.sourceHandlers.getSpotifyPlaylist) {
        console.log('🎵 Importing Spotify playlist via API...');
        try {
          const data = await this.bot.sourceHandlers.getSpotifyPlaylist(url);
          return {
            name: data.name,
            description: data.description || 'Imported from Spotify',
            source: 'spotify',
            image: data.image || null,
            tracks: data.tracks || []
          };
        } catch (apiErr) {
          console.log('⚠️ Spotify API import failed, falling back to HTML parse...', apiErr?.message || apiErr);
          // fall through to legacy HTML parsing
        }
      }

      // Legacy fallback (HTML parse)
      // Extract playlist ID from URL
      const playlistIdMatch = url.match(/playlist\/([a-zA-Z0-9]+)/);
      if (!playlistIdMatch) {
        throw new Error('Invalid Spotify playlist URL');
      }
      const playlistId = playlistIdMatch[1];
      console.log(`🎵 Importing Spotify playlist: ${playlistId}`);
      const playlist = await this.parseSpotifyPlaylistBasic(url);
      if (playlist && Array.isArray(playlist.tracks) && playlist.tracks.length > 0) {
        return playlist;
      }
      // Last-resort fallback: search YouTube for a matching playlist by name
      try {
        const name = playlist?.name || 'Spotify Playlist';
        const query = `${name} playlist`;
        if (this.bot?.sourceHandlers?.searchYouTubePlaylistByName) {
          const ytPlaylist = await this.bot.sourceHandlers.searchYouTubePlaylistByName(query, 100);
          if (ytPlaylist && ytPlaylist.tracks?.length) {
            console.log(`🔁 Fallback matched YouTube playlist with ${ytPlaylist.tracks.length} tracks`);
            return ytPlaylist;
          }
        }
      } catch (e) {
        console.log('⚠️ YouTube playlist name fallback failed:', e?.message || e);
      }
      return playlist; // return whatever minimal data we had
    } catch (error) {
      console.error('Spotify import error:', error);
      throw new Error('Failed to import Spotify playlist. Please try again.');
    }
  }

  async importYouTubePlaylist(url) {
    try {
      // Extract playlist ID from URL
      const playlistIdMatch = url.match(/[?&]list=([a-zA-Z0-9_-]+)/);
      if (!playlistIdMatch) {
        throw new Error('Invalid YouTube playlist URL');
      }
      
      const playlistId = playlistIdMatch[1];
      console.log(`🎵 Importing YouTube playlist: ${playlistId}`);

      // Use ytdl-core or youtube-sr to get playlist info
      const playlist = await this.parseYouTubePlaylist(playlistId);
      return playlist;
      
    } catch (error) {
      console.error('YouTube import error:', error);
      throw new Error('Failed to import YouTube playlist. Please try again.');
    }
  }

  async parseSpotifyPlaylistBasic(url) {
    try {
      console.log('🎵 Fetching Spotify playlist content...');
      
      // Fetch the Spotify playlist page with comprehensive headers
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'Referer': 'https://open.spotify.com/',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'same-origin',
          'Sec-Ch-Ua': '"Google Chrome";v="119", "Chromium";v="119", "Not?A_Brand";v="24"',
          'Sec-Ch-Ua-Mobile': '?0',
          'Sec-Ch-Ua-Platform': '"macOS"'
        },
        timeout: 10000,
        maxRedirects: 5
      });
      
      const html = response.data;
      
      // Extract playlist name
      let playlistName = 'Spotify Playlist';
      const nameMatch = html.match(/<title>([^<]+)<\/title>/);
      if (nameMatch && nameMatch[1]) {
        playlistName = nameMatch[1].replace(' | Spotify', '').trim();
      }
      
      // Extract playlist description
      let description = 'Imported from Spotify';
      const descMatch = html.match(/<meta name="description" content="([^"]+)"/);
      if (descMatch && descMatch[1]) {
        description = descMatch[1].trim();
      }
      
      // Extract playlist image
      let image = null;
      const imageMatch = html.match(/<meta property="og:image" content="([^"]+)"/);
      if (imageMatch && imageMatch[1]) {
        image = imageMatch[1];
      }
      
      // Extract tracks from the page
      const tracks = [];
      
      // Look for JSON data in the page that contains track info
      const jsonMatch = html.match(/window\.__INITIAL_STATE__\s*=\s*({.+?});/);
      if (jsonMatch) {
        try {
          const initialState = JSON.parse(jsonMatch[1]);
          
          // Navigate through the Spotify data structure to find tracks
          const entities = initialState?.entities;
          if (entities?.tracks) {
            Object.values(entities.tracks).forEach(track => {
              if (track.name && track.artists) {
                const artists = track.artists.map(artist => artist.name || 'Unknown Artist').join(', ');
                const duration = track.duration_ms ? this.formatDurationMs(track.duration_ms) : 'Unknown';
                
                tracks.push({
                  title: track.name,
                  author: artists,
                  url: `https://open.spotify.com/track/${track.id}`,
                  duration: duration,
                  thumbnail: track.album?.images?.[0]?.url || null,
                  source: 'spotify',
                  type: 'track'
                });
              }
            });
          }
        } catch (jsonError) {
          console.log('⚠️ Could not parse Spotify JSON data, trying alternative method...');
        }
      }
      
      // Fallback: Try to extract track info from HTML structure
      if (tracks.length === 0) {
        const trackMatches = html.matchAll(/<div[^>]*data-testid="tracklist-row"[^>]*>[\s\S]*?<\/div>/g);
        for (const match of trackMatches) {
          const trackHtml = match[0];
          
          // Extract track title
          const titleMatch = trackHtml.match(/aria-label="([^"]+)"/);
          const title = titleMatch ? titleMatch[1] : 'Unknown Track';
          
          // Extract artist (simplified)
          const artistMatch = trackHtml.match(/href="\/artist\/[^"]+">([^<]+)</);
          const artist = artistMatch ? artistMatch[1] : 'Unknown Artist';
          
          if (title !== 'Unknown Track') {
            tracks.push({
              title: title,
              author: artist,
              url: 'https://example.com/track', // Placeholder since we can't get direct audio URLs
              duration: 'Unknown',
              thumbnail: null,
              source: 'spotify',
              type: 'track'
            });
          }
        }
      }
      
      // If we still have no tracks, provide a helpful message
      if (tracks.length === 0) {
        console.log('⚠️ Could not extract tracks from Spotify playlist. This is common due to Spotify\'s restrictions.');
        return {
          name: playlistName || 'Spotify Playlist',
          description: 'Note: Spotify requires special API access to import playlists. Consider using YouTube playlists instead.',
          source: 'spotify',
          image: image,
          tracks: [{
            title: 'Spotify Import Not Available',
            author: 'Try using YouTube playlists or manually search for songs',
            url: url,
            duration: '0:00',
            thumbnail: null
          }]
        };
      }
      
      console.log(`✅ Successfully extracted ${tracks.length} tracks from Spotify playlist`);
      
      return {
        name: playlistName,
        description: description,
        source: 'spotify',
        image: image,
        tracks: tracks
      };
      
    } catch (error) {
      console.error('❌ Error fetching Spotify playlist:', error.message);
      
      // Return fallback with error info
      return {
        name: 'Spotify Playlist (Error)',
        description: 'Failed to load playlist content',
        source: 'spotify',
        image: null,
        tracks: [{
          title: 'Error loading playlist',
          author: error.message,
          url: 'https://example.com/error',
          duration: '0:00',
          thumbnail: null
        }]
      };
    }
  }

  async parseYouTubePlaylist(playlistId) {
    try {
      // Try to use the bot's existing YouTube search functionality if available
      if (this.bot && this.bot.sourceHandlers && this.bot.sourceHandlers.searchYouTubePlaylist) {
        console.log('📺 Using bot\'s YouTube search functionality...');
        const playlistData = await this.bot.sourceHandlers.searchYouTubePlaylist(playlistId);
        
        return {
          name: playlistData.title || 'YouTube Playlist',
          description: playlistData.description || '',
          source: 'youtube',
          image: playlistData.thumbnail || null,
          tracks: playlistData.videos?.map(video => ({
            title: video.title,
            author: video.channel?.name || video.author || 'Unknown',
            url: video.url,
            duration: this.formatDuration(video.duration),
            thumbnail: video.thumbnail?.url || video.thumbnail,
            source: 'youtube',
            type: 'track'
          })) || []
        };
      } else {
        // Fallback method - use direct YouTube scraping
        console.log('📺 Using YouTube fallback method...');
        return await this.parseYouTubePlaylistFallback(playlistId);
      }
    } catch (error) {
      console.error('YouTube playlist parsing error:', error);
      // Always try fallback if primary method fails
      console.log('⚠️ Primary method failed, trying fallback...');
      return await this.parseYouTubePlaylistFallback(playlistId);
    }
  }

  async parseYouTubePlaylistFallback(playlistId) {
    try {
      console.log('📺 Fetching YouTube playlist content...');
      
      // Fetch the YouTube playlist page
      const playlistUrl = `https://www.youtube.com/playlist?list=${playlistId}`;
      const response = await axios.get(playlistUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br'
        },
        timeout: 10000
      });
      
      const html = response.data;
      
      // Extract playlist name
      let playlistName = 'YouTube Playlist';
      const nameMatch = html.match(/<title>([^<]+)<\/title>/);
      if (nameMatch && nameMatch[1]) {
        playlistName = nameMatch[1].replace(' - YouTube', '').trim();
      }
      
      // Extract playlist description
      let description = 'Imported from YouTube';
      const descMatch = html.match(/<meta name="description" content="([^"]+)"/);
      if (descMatch && descMatch[1]) {
        description = descMatch[1].trim();
      }
      
      // Extract tracks from the page
      const tracks = [];
      
      // Look for JSON data in the page that contains video info
      const jsonMatches = html.matchAll(/var ytInitialData = ({.+?});/g);
      for (const match of jsonMatches) {
        try {
          const ytData = JSON.parse(match[1]);
          
          // Navigate through YouTube's data structure to find playlist contents
          const contents = ytData?.contents?.twoColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents?.[0]?.playlistVideoListRenderer?.contents;
          
          if (contents) {
            contents.forEach(item => {
              const videoRenderer = item.playlistVideoRenderer;
              if (videoRenderer && videoRenderer.title && videoRenderer.videoId) {
                const title = videoRenderer.title.runs?.[0]?.text || videoRenderer.title.simpleText || 'Unknown Title';
                const author = videoRenderer.shortBylineText?.runs?.[0]?.text || 'Unknown Author';
                const duration = videoRenderer.lengthText?.simpleText || 'Unknown';
                const thumbnail = videoRenderer.thumbnail?.thumbnails?.[0]?.url || null;
                
                tracks.push({
                  title: title,
                  author: author,
                  url: `https://www.youtube.com/watch?v=${videoRenderer.videoId}`,
                  duration: duration,
                  thumbnail: thumbnail,
                  source: 'youtube',
                  type: 'track'
                });
              }
            });
          }
        } catch (jsonError) {
          console.log('⚠️ Could not parse YouTube JSON data, trying alternative method...');
        }
      }
      
      // If we couldn't extract tracks, provide a helpful message
      if (tracks.length === 0) {
        console.log('⚠️ Could not extract tracks from YouTube playlist. The playlist might be private or YouTube changed their format.');
        return {
          name: playlistName || 'YouTube Playlist',
          description: 'Could not load tracks. Please ensure playlist is public and try again.',
          source: 'youtube',
          image: null,
          tracks: [{
            title: 'Unable to load playlist tracks',
            author: 'Make sure the playlist is public and accessible',
            url: playlistUrl,
            duration: '0:00',
            thumbnail: null
          }]
        };
      }
      
      console.log(`✅ Successfully extracted ${tracks.length} tracks from YouTube playlist`);
      
      return {
        name: playlistName,
        description: description,
        source: 'youtube',
        image: null,
        tracks: tracks
      };
      
    } catch (error) {
      console.error('❌ Error fetching YouTube playlist:', error.message);
      
      // Return fallback with error info
      return {
        name: 'YouTube Playlist (Error)',
        description: 'Failed to load playlist content',
        source: 'youtube',
        image: null,
        tracks: [{
          title: 'Error loading playlist',
          author: error.message,
          url: `https://www.youtube.com/playlist?list=${playlistId}`,
          duration: '0:00',
          thumbnail: null
        }]
      };
    }
  }

  async queuePlaylist(guildId, channelId, tracks) {
    try {
      if (!this.bot || !this.bot.musicManagers) {
        throw new Error('Discord bot is not connected. Please connect the bot to Discord to queue tracks.');
      }
      
      const musicManager = this.bot.getMusicManager(guildId, channelId);
      if (!musicManager) {
        throw new Error('Unable to get music manager for this channel.');
      }

      let queuedCount = 0;
      const failedTracks = [];

      for (const t of tracks) {
        const track = {
          source: (t.source ? t.source : (t.url?.includes('youtu') ? 'youtube' : (t.url?.includes('spotify') ? 'spotify' : 'youtube'))),
          type: t.type || 'track',
          title: t.title || 'Unknown Title',
          author: t.author || 'Unknown Artist',
          url: t.url || '',
          duration: t.duration || '0:00',
          thumbnail: t.thumbnail ?? null
        };
        try {
          // Use the bot's existing track queueing functionality
          await musicManager.addToQueue(track, -1, { 
            userId: 'web-portal', 
            guildId: guildId 
          });
          queuedCount++;
        } catch (error) {
          console.error(`Failed to queue track: ${track.title}`, error);
          failedTracks.push(track.title);
        }
      }

      return {
        success: true,
        queuedCount,
        totalTracks: tracks.length,
        failedTracks: failedTracks.length > 0 ? failedTracks : undefined
      };
    } catch (error) {
      console.error('Queue playlist error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async playPlaylist(guildId, channelId, tracks) {
    try {
      if (!this.bot || !this.bot.musicManagers) {
        throw new Error('Discord bot is not connected. Please connect the bot to Discord to play tracks.');
      }
      
      const musicManager = this.bot.getMusicManager(guildId, channelId);
      if (!musicManager) {
        throw new Error('Unable to get music manager for this channel.');
      }

      // Ensure there is an active voice connection for playback
      try {
        if (!musicManager.connection || !musicManager.connectionHealthy) {
          const guild = this.bot.client.guilds.cache.get(guildId);
          const channel = guild?.channels?.cache?.get(channelId);
          if (!guild || !channel) {
            throw new Error('Invalid guild or channel for voice connection');
          }
          const { joinVoiceChannel } = require('@discordjs/voice');
          const connection = joinVoiceChannel({
            channelId: channelId,
            guildId: guildId,
            adapterCreator: guild.voiceAdapterCreator,
            selfDeaf: false,
            selfMute: false
          });
          musicManager.setConnection(connection);
        }
      } catch (connErr) {
        console.error('Failed to establish voice connection for playlist playback:', connErr);
        throw new Error('Failed to connect to the voice channel');
      }

      // Clear current queue and add all tracks
      musicManager.clearQueue(true); // User initiated
      
      const result = await this.queuePlaylist(guildId, channelId, tracks);
      
      if (result.success && result.queuedCount > 0) {
        // Start playing the first track
        if (!musicManager.isPlaying) {
          await musicManager.play();
        }
        
        return {
          success: true,
          message: `Playing playlist with ${result.queuedCount} tracks`
        };
      } else {
        return {
          success: false,
          error: 'Failed to queue playlist tracks'
        };
      }
    } catch (error) {
      console.error('Play playlist error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  formatDuration(seconds) {
    if (!seconds) return 'Unknown';
    
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  formatDurationMs(milliseconds) {
    if (!milliseconds) return 'Unknown';
    
    const totalSeconds = Math.floor(milliseconds / 1000);
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  // === ORIGINAL DISCORD BOT METHODS ===

  async createPlaylist(userId, guildId, name, description = '', isPublic = false) {
    try {
        const playlistId = `${userId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const playlist = {
            id: playlistId,
            name: name.trim(),
            description: description.trim(),
            owner: userId,
            guildId,
            tracks: [],
            isPublic,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            playCount: 0,
            duration: 0
        };

        await this.firebaseService.savePlaylist(userId, guildId, playlistId, playlist.tracks);
        
        console.log(`📝 Created playlist: ${name} for user ${userId}`);
        return playlist;
    } catch (error) {
        console.error('Error creating playlist:', error);
        throw error;
    }
  }

  async getUserPlaylists(userId, guildId) {
    try {
        return await this.firebaseService.getUserPlaylists(userId, guildId);
    } catch (error) {
        console.error('Error getting user playlists:', error);
        return [];
    }
  }

  async getPlaylist(userId, guildId, playlistName) {
    try {
        return await this.firebaseService.loadPlaylist(userId, guildId, playlistName);
    } catch (error) {
        return null;
    }
  }

  async addTrackToPlaylist(playlistName, track, userId, guildId) {
    try {
        const playlist = await this.getPlaylist(userId, guildId, playlistName);
        if (!playlist) {
            throw new Error('Playlist not found');
        }

        if (playlist.owner !== userId) {
            throw new Error('Permission denied: Not playlist owner');
        }

        const existingTrack = playlist.tracks.find(t => 
            t.url === track.url || (t.title === track.title && t.author === track.author)
        );

        if (existingTrack) {
            throw new Error('Track already exists in playlist');
        }

        const trackWithMeta = {
            ...track,
            addedAt: new Date().toISOString(),
            addedBy: userId
        };

        playlist.tracks.push(trackWithMeta);
        playlist.updatedAt = new Date().toISOString();
        playlist.duration = this.calculatePlaylistDuration(playlist.tracks);

        await this.firebaseService.savePlaylist(userId, guildId, playlistName, playlist.tracks);
        console.log(`➕ Added track to playlist: ${track.title} -> ${playlistName}`);
        return playlist;
    } catch (error) {
        console.error('Error adding track to playlist:', error);
        throw error;
    }
  }

  async removeTrackFromPlaylist(playlistName, trackIndex, userId, guildId) {
    try {
        const playlist = await this.getPlaylist(userId, guildId, playlistName);
        if (!playlist) {
            throw new Error('Playlist not found');
        }

        if (playlist.owner !== userId) {
            throw new Error('Permission denied: Not playlist owner');
        }

        if (trackIndex < 0 || trackIndex >= playlist.tracks.length) {
            throw new Error('Invalid track index');
        }

        const removedTrack = playlist.tracks.splice(trackIndex, 1)[0];
        playlist.updatedAt = new Date().toISOString();
        playlist.duration = this.calculatePlaylistDuration(playlist.tracks);

        await this.firebaseService.savePlaylist(userId, guildId, playlistName, playlist.tracks);
        console.log(`➖ Removed track from playlist: ${removedTrack.title} <- ${playlistName}`);
        return playlist;
    } catch (error) {
        console.error('Error removing track from playlist:', error);
        throw error;
    }
  }

  async deletePlaylist(playlistName, userId, guildId) {
    try {
        const playlist = await this.getPlaylist(userId, guildId, playlistName);
        if (!playlist) {
            throw new Error('Playlist not found');
        }

        if (playlist.owner !== userId) {
            throw new Error('Permission denied: Not playlist owner');
        }

        await this.firebaseService.deletePlaylist(userId, guildId, playlistName);
        
        console.log(`🗑️ Deleted playlist: ${playlistName}`);
        return true;
    } catch (error) {
        console.error('Error deleting playlist:', error);
        throw error;
    }
  }

  async updatePlaylist(playlistName, updates, userId, guildId) {
    try {
        const playlist = await this.getPlaylist(userId, guildId, playlistName);
        if (!playlist) {
            throw new Error('Playlist not found');
        }

        if (playlist.owner !== userId) {
            throw new Error('Permission denied: Not playlist owner');
        }

        if (updates.name) playlist.name = updates.name.trim();
        if (updates.description !== undefined) playlist.description = updates.description.trim();
        if (updates.isPublic !== undefined) playlist.isPublic = updates.isPublic;
        
        playlist.updatedAt = new Date().toISOString();

        await this.firebaseService.savePlaylist(userId, guildId, playlistName, playlist.tracks);
        console.log(`📝 Updated playlist: ${playlistName}`);
        return playlist;
    } catch (error) {
        console.error('Error updating playlist:', error);
        throw error;
    }
  }

  calculatePlaylistDuration(tracks) {
    return tracks.reduce((total, track) => {
        const duration = this.parseDuration(track.duration);
        return total + duration;
    }, 0);
  }

  parseDuration(duration) {
    if (typeof duration === 'number') return duration;
    if (!duration) return 0;

    const parts = duration.split(':').reverse();
    let seconds = 0;
    let multiplier = 1;

    for (const part of parts) {
        seconds += parseInt(part) * multiplier;
        multiplier *= 60;
    }

    return seconds * 1000;
  }

  async importPlaylistFromUrl(userId, guildId, url, name = null, sourceHandlers) {
    try {
        console.log(`📥 Importing playlist from URL: ${url}`);
        
        let tracks = [];
        let playlistName = name;
        
        if (url.includes('spotify.com/playlist')) {
            const spotifyTracks = await sourceHandlers.getSpotifyPlaylist(url);
            tracks = spotifyTracks;
            playlistName = playlistName || 'Imported Spotify Playlist';
        } else if (url.includes('youtube.com') && url.includes('list=')) {
            const youtubeTracks = await sourceHandlers.getYouTubePlaylist(url);
            tracks = youtubeTracks;
            playlistName = playlistName || 'Imported YouTube Playlist';
        } else {
            throw new Error('Unsupported playlist URL format');
        }

        if (tracks.length === 0) {
            throw new Error('No tracks found in playlist');
        }

        const playlist = await this.createPlaylist(
            userId,
            guildId, 
            playlistName, 
            `Imported from ${new URL(url).hostname}`, 
            false
        );

        for (const track of tracks) {
            try {
                await this.addTrackToPlaylist(playlistName, track, userId, guildId);
            } catch (trackError) {
                console.log(`⚠️ Skipped track: ${track.title} - ${trackError.message}`);
            }
        }

        const finalPlaylist = await this.getPlaylist(userId, guildId, playlistName);
        console.log(`✅ Imported playlist: ${finalPlaylist.tracks.length} tracks`);
        
        return finalPlaylist;
    } catch (error) {
        console.error('Error importing playlist:', error);
        throw error;
    }
  }

  async getPublicPlaylists(guildId, limit = 20) {
    try {
        const allPlaylists = await this.firebaseService.getUserPlaylists('*', guildId);
        const publicPlaylists = allPlaylists
            .filter(p => p.isPublic)
            .map(playlist => ({
                ...playlist,
                tracks: undefined,
                trackCount: playlist.tracks ? playlist.tracks.length : 0
            }))
            .sort((a, b) => (b.playCount || 0) - (a.playCount || 0))
            .slice(0, limit);
        
        return publicPlaylists;
    } catch (error) {
        console.error('Error getting public playlists:', error);
        return [];
    }
  }

  async incrementPlayCount(playlistName, userId, guildId) {
    try {
        const playlist = await this.getPlaylist(userId, guildId, playlistName);
        if (playlist) {
            playlist.playCount = (playlist.playCount || 0) + 1;
            playlist.lastPlayed = new Date().toISOString();
            await this.firebaseService.savePlaylist(userId, guildId, playlistName, playlist.tracks);
        }
    } catch (error) {
        console.error('Error incrementing play count:', error);
    }
  }

  formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
        return `${hours}:${(minutes % 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
    }
    return `${minutes}:${(seconds % 60).toString().padStart(2, '0')}`;
  }
}

module.exports = PlaylistManager;
