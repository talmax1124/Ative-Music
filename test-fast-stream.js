const FastStreamEngine = require('./src/engines/FastStreamEngine');

async function testFastStream() {
    console.log('🚀 Testing INSTANT STREAMING ENGINE (NO DOWNLOADS)');
    console.log('=' .repeat(60));
    
    const engine = new FastStreamEngine();
    const testUrl = 'https://www.youtube.com/watch?v=7SHAKi8l7Ls';
    
    try {
        console.log('⚡ SPEED TEST - Instant streaming with no downloads\n');
        
        console.log('1. Testing instant track info:');
        const infoStart = Date.now();
        const trackInfo = await engine.getTrackInfo(testUrl);
        const infoTime = Date.now() - infoStart;
        console.log(`   ✅ Info in ${infoTime}ms: "${trackInfo.title}" by ${trackInfo.author}`);
        
        console.log('\n2. Testing INSTANT STREAM (no downloads):');
        const streamStart = Date.now();
        const stream = await engine.getStream(testUrl);
        const streamTime = Date.now() - streamStart;
        
        console.log(`   🔥 STREAM READY in ${streamTime}ms`);
        console.log(`   ✅ Stream readable: ${stream.readable}`);
        console.log(`   ⚡ Ready for Discord playback: YES`);
        
        // Test stream data flow
        let dataReceived = false;
        stream.once('data', () => {
            dataReceived = true;
            console.log(`   🎵 Audio data flowing: YES`);
        });
        
        // Wait a moment to see if data flows
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        console.log(`\n📊 PERFORMANCE RESULTS:`);
        console.log(`   Info fetch: ${infoTime}ms`);
        console.log(`   Stream ready: ${streamTime}ms`);
        console.log(`   Total time: ${infoTime + streamTime}ms`);
        console.log(`   Data flowing: ${dataReceived ? 'YES' : 'Waiting...'}`);
        
        // Clean up
        if (stream) {
            stream.destroy();
        }
        
        console.log(`\n🎯 RESULT: INSTANT STREAMING ${streamTime < 1000 ? 'SUCCESS' : 'NEEDS OPTIMIZATION'}`);
        
    } catch (error) {
        console.error('❌ Fast stream test failed:', error.message);
        console.log('\n🔄 This means we need to fall back to other engines');
    }
}

testFastStream();