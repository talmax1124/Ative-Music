const HybridEngine = require('./src/engines/HybridEngine');

async function testHybridEngine() {
    console.log('⚡ Testing HYBRID ENGINE (Stream first, download fallback)');
    console.log('=' .repeat(60));
    
    const engine = new HybridEngine();
    const testUrl = 'https://www.youtube.com/watch?v=FUak2C_KEeU'; // The problematic one
    
    try {
        console.log('🎯 This engine tries FAST STREAMING first, then falls back to PROVEN DOWNLOAD\n');
        
        console.log('1. Engine status:');
        const status = engine.getStatus();
        console.log(`   Name: ${status.name}`);
        console.log(`   Priority: ${status.priority} (highest)`);
        console.log(`   Features: ${status.features.join(', ')}`);
        
        console.log('\n2. URL handling:');
        const canHandle = await engine.canHandle(testUrl);
        console.log(`   Can handle: ${canHandle}`);
        
        console.log('\n3. ⚡ HYBRID STREAMING TEST:');
        const streamStart = Date.now();
        const stream = await engine.getStream(testUrl);
        const streamTime = Date.now() - streamStart;
        
        console.log(`\n📊 RESULTS:`);
        console.log(`   ✅ Stream created: ${stream ? 'YES' : 'NO'}`);
        console.log(`   ✅ Stream readable: ${stream?.readable || false}`);
        console.log(`   ⏱️ Total time: ${streamTime}ms`);
        
        let expectedTime = '';
        if (streamTime < 5000) expectedTime = 'INSTANT (streaming worked)';
        else if (streamTime < 15000) expectedTime = 'FAST (download fallback)';
        else expectedTime = 'SLOW (needs optimization)';
        
        console.log(`   🎯 Performance: ${expectedTime}`);
        
        // Test actual data flow
        if (stream) {
            let dataSize = 0;
            let dataReceived = false;
            
            stream.on('data', (chunk) => {
                if (!dataReceived) {
                    dataReceived = true;
                    console.log(`   🎵 Audio data: FLOWING`);
                }
                dataSize += chunk.length;
            });
            
            // Wait to accumulate some data
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            console.log(`   📊 Data received: ${(dataSize / 1024).toFixed(1)}KB`);
            console.log(`   📡 Stream status: ${dataReceived ? 'ACTIVE' : 'WAITING'}`);
            
            stream.destroy(); // Clean up
        }
        
        console.log(`\n🎉 HYBRID ENGINE: ${stream && stream.readable ? 'SUCCESS' : 'FAILED'}`);
        console.log('   This should work even when YouTube blocks streaming!');
        
    } catch (error) {
        console.error('\n❌ HYBRID ENGINE FAILED:', error.message);
        console.log('\n🔍 This suggests a deeper issue with the system');
    }
}

testHybridEngine();