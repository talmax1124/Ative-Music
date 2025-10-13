const FastStreamEngine = require('./FastStreamEngine');

async function testFastStream() {
    console.log('🧪 Testing FastStreamEngine...');
    
    const engine = new FastStreamEngine();
    
    try {
        // Test basic functionality
        console.log('✅ FastStreamEngine loaded successfully');
        
        const stats = engine.getStats();
        console.log('📊 Initial stats:', stats);
        
        console.log('🧹 Testing cache cleanup...');
        engine.cleanCache();
        
        console.log('✅ Basic functionality test passed!');
        console.log('💡 FastStreamEngine is ready to use');
        
        await engine.shutdown();
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        process.exit(1);
    }
}

testFastStream();