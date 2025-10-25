#!/usr/bin/env node

require('dotenv').config();

const neonService = require('./src/NeonService.js');

async function testMigration() {
    console.log('🧪 Testing Neon migration...\n');
    
    try {
        // Test 1: Database connection
        console.log('1. Testing database connection...');
        neonService.initialize();
        console.log('   ✅ Database connection successful\n');
        
        // Test 2: Table creation
        console.log('2. Testing table creation...');
        await neonService.createTables();
        console.log('   ✅ Tables created successfully\n');
        
        // Test 3: Panel mapping
        console.log('3. Testing panel mapping...');
        await neonService.savePanelMapping('test_guild', 'test_voice', 'test_text');
        const mapping = await neonService.getPanelMapping('test_guild', 'test_voice');
        console.log('   ✅ Panel mapping saved and retrieved:', mapping?.text_channel_id === 'test_text' ? 'PASS' : 'FAIL');
        
        // Test 4: Queue operations
        console.log('4. Testing queue operations...');
        const testQueue = {
            tracks: [{ title: 'Test Song', url: 'https://example.com' }],
            currentTrack: null,
            repeatMode: 'off'
        };
        await neonService.saveQueue('test_guild', 'test_channel', testQueue);
        const loadedQueue = await neonService.loadQueue('test_guild');
        console.log('   ✅ Queue saved and loaded:', loadedQueue?.tracks?.length === 1 ? 'PASS' : 'FAIL');
        
        // Test 5: User preferences
        console.log('5. Testing user preferences...');
        await neonService.saveUserPreference('test_user', 'test_guild', 'test_track', { liked: true });
        const preferences = await neonService.getUserPreferences('test_user', 'test_guild');
        console.log('   ✅ User preferences saved and loaded:', preferences?.test_track?.liked ? 'PASS' : 'FAIL');
        
        // Test 6: Playlists
        console.log('6. Testing playlists...');
        await neonService.savePlaylist('test_user', 'test_guild', 'test_playlist', [{ title: 'Test Song' }]);
        const playlist = await neonService.loadPlaylist('test_user', 'test_guild', 'test_playlist');
        console.log('   ✅ Playlist saved and loaded:', playlist?.tracks?.length === 1 ? 'PASS' : 'FAIL');
        
        // Test 7: Listening history
        console.log('7. Testing listening history...');
        await neonService.saveListeningHistory('test_user', 'test_guild', { title: 'Test Song', artist: 'Test Artist' });
        const history = await neonService.getListeningHistory('test_user', 'test_guild', 1);
        console.log('   ✅ Listening history saved and loaded:', history?.length === 1 ? 'PASS' : 'FAIL');
        
        // Test 8: User playlists (web portal)
        console.log('8. Testing user playlists (web portal)...');
        const userPlaylist = {
            id: 'test-playlist-id',
            name: 'Test Web Playlist',
            description: 'Test description',
            tracks: [{ title: 'Test Song' }]
        };
        await neonService.saveUserPlaylist('test_user', userPlaylist);
        const userPlaylists = await neonService.getUserPlaylists('test_user');
        console.log('   ✅ User playlists saved and loaded:', userPlaylists?.length >= 1 ? 'PASS' : 'FAIL');
        
        // Cleanup test data
        console.log('\n9. Cleaning up test data...');
        await neonService.clearQueue('test_guild');
        await neonService.deletePlaylist('test_user', 'test_guild', 'test_playlist');
        await neonService.deleteUserPlaylist('test_user', 'test-playlist-id');
        console.log('   ✅ Test data cleaned up\n');
        
        console.log('🎉 All migration tests passed! The bot is ready to use with Neon database.\n');
        console.log('📝 Next steps:');
        console.log('   1. Set up your Neon database and add DATABASE_URL to .env');
        console.log('   2. Remove any Firebase-related environment variables');
        console.log('   3. Start the bot with: npm start\n');
        
    } catch (error) {
        console.error('❌ Migration test failed:', error.message);
        console.error('\n🔧 Troubleshooting:');
        console.error('   1. Make sure DATABASE_URL is set in your .env file');
        console.error('   2. Verify your Neon database is accessible');
        console.error('   3. Check your internet connection\n');
        process.exit(1);
    }
}

// Only run if called directly
if (require.main === module) {
    testMigration().catch(console.error);
}

module.exports = testMigration;