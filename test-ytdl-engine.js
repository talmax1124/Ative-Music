const YtdlCoreEngine = require('./src/engines/YtdlCoreEngine');

async function testYtdlEngine() {
    console.log('Testing ytdl-core engine...');
    
    const engine = new YtdlCoreEngine();
    const testUrl = 'https://www.youtube.com/watch?v=7SHAKi8l7Ls';
    
    try {
        console.log('1. Testing URL handling:');
        const canHandle = await engine.canHandle(testUrl);
        console.log('   Can handle URL:', canHandle);
        
        console.log('2. Testing track info:');
        const trackInfo = await engine.getTrackInfo(testUrl);
        console.log('   Title:', trackInfo.title);
        console.log('   Author:', trackInfo.author);
        console.log('   Duration:', trackInfo.duration);
        
        console.log('3. Testing stream creation:');
        const startTime = Date.now();
        const stream = await engine.getStream(testUrl);
        const responseTime = Date.now() - startTime;
        
        console.log('   Stream success:', !!stream);
        console.log('   Stream readable:', stream.readable);
        console.log('   Response time:', responseTime + 'ms');
        
        // Clean up stream
        if (stream) {
            stream.destroy();
        }
        
        console.log('\n✅ ytdl-core engine test completed successfully!');
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
    }
}

testYtdlEngine();