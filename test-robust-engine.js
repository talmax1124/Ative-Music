const RobustStreamEngine = require('./src/engines/RobustStreamEngine');

async function testRobustEngine() {
    console.log('🛡️ Testing ROBUST STREAMING ENGINE');
    console.log('=' .repeat(50));
    
    const engine = new RobustStreamEngine();
    const testUrl = 'https://www.youtube.com/watch?v=FUak2C_KEeU'; // The one that was failing
    
    try {
        console.log('🎯 Testing the URL that was failing with 403 errors\n');
        
        console.log('1. Engine status:');
        const status = engine.getStatus();
        console.log(`   Name: ${status.name}`);
        console.log(`   Priority: ${status.priority} (highest)`);
        console.log(`   Strategies: ${status.strategies}`);
        console.log(`   Features: ${status.features.join(', ')}`);
        
        console.log('\n2. URL handling:');
        const canHandle = await engine.canHandle(testUrl);
        console.log(`   Can handle: ${canHandle}`);
        
        console.log('\n3. Track info (quick):');
        const infoStart = Date.now();
        const trackInfo = await engine.getTrackInfo(testUrl);
        const infoTime = Date.now() - infoStart;
        console.log(`   ✅ Info in ${infoTime}ms`);
        console.log(`   Title: ${trackInfo.title}`);
        console.log(`   Author: ${trackInfo.author}`);
        
        console.log('\n4. 🛡️ ROBUST STREAMING TEST:');
        const streamStart = Date.now();
        const stream = await engine.getStream(testUrl);
        const streamTime = Date.now() - streamStart;
        
        console.log(`\n📊 RESULTS:`);
        console.log(`   ✅ Stream created: ${stream ? 'YES' : 'NO'}`);
        console.log(`   ✅ Stream readable: ${stream?.readable || false}`);
        console.log(`   ⏱️ Total time: ${streamTime}ms`);
        console.log(`   🎯 Status: ${streamTime < 5000 ? 'FAST' : streamTime < 10000 ? 'GOOD' : 'SLOW'}`);
        
        // Test data flow
        let dataReceived = false;
        if (stream) {
            stream.once('data', () => {
                dataReceived = true;
                console.log(`   🎵 Audio data: FLOWING`);
            });
            
            // Wait to see data
            await new Promise(resolve => setTimeout(resolve, 2000));
            console.log(`   📡 Data flowing: ${dataReceived ? 'YES' : 'Waiting...'}`);
            
            stream.destroy();
        }
        
        console.log(`\n🎉 ROBUST ENGINE TEST: ${stream && stream.readable ? 'SUCCESS' : 'FAILED'}`);
        
    } catch (error) {
        console.error('\n❌ ROBUST ENGINE FAILED:', error.message);
        console.log('\n🔍 This means we need to check the strategies or add more fallbacks');
    }
}

testRobustEngine();