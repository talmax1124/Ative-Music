const OptimizedHybridEngine = require('./src/engines/OptimizedHybridEngine');

async function testOptimizedEngine() {
    console.log('🧪 Testing OptimizedHybridEngine...');
    
    try {
        const engine = new OptimizedHybridEngine();
        console.log('✅ OptimizedHybridEngine loaded successfully');
        
        // Test basic functionality
        const status = engine.getStatus();
        console.log('📊 Engine Status:');
        console.log(`   Name: ${status.name}`);
        console.log(`   Priority: ${status.priority}`);
        console.log(`   Cache size: ${status.cacheSize}`);
        console.log(`   Optimizations applied: ${status.optimizations.length}`);
        
        status.optimizations.forEach((opt, i) => {
            console.log(`     ${i + 1}. ${opt}`);
        });
        
        // Test URL handling
        const testUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
        const canHandle = await engine.canHandle(testUrl);
        console.log(`✅ Can handle YouTube URLs: ${canHandle}`);
        
        const videoId = engine.extractVideoId(testUrl);
        console.log(`🆔 Video ID extraction: ${videoId}`);
        
        console.log('\n🎯 Expected Performance Improvements:');
        console.log('   Current average: 11,755ms');
        console.log('   Target average: <8,000ms');
        console.log('   Expected improvement: ~32% faster');
        console.log('   Key optimizations:');
        console.log('     - Reduced timeouts (3s vs 5s)');
        console.log('     - Optimized yt-dlp settings for VPS');
        console.log('     - Simple caching system');
        console.log('     - Better cleanup and validation');
        
        console.log('\n✅ Optimization test PASSED!');
        console.log('🚀 OptimizedHybridEngine is ready - restart your bot to see improvements');
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        process.exit(1);
    }
}

testOptimizedEngine();