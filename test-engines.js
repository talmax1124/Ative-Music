const EngineManager = require('./src/EngineManager.js');
const HealthMonitor = require('./src/HealthMonitor.js');
const VPSOptimizer = require('./src/VPSOptimizer.js');

async function testEngines() {
    console.log('🧪 Testing Modern Engine System');
    console.log('================================\n');
    
    try {
        // Initialize components
        const engineManager = new EngineManager();
        const healthMonitor = new HealthMonitor(engineManager);
        const vpsOptimizer = new VPSOptimizer();
        
        // Apply VPS optimizations
        vpsOptimizer.optimizeForStreaming(engineManager);
        
        console.log('✅ All components initialized\n');
        
        // Test 1: Engine Status
        console.log('📊 Engine Status:');
        const status = engineManager.getSystemStatus();
        console.log(`   Total Engines: ${status.totalEngines}`);
        console.log(`   Active Engines: ${status.activeEngines}`);
        console.log(`   Max Concurrent Streams: ${status.maxConcurrentStreams}`);
        console.log(`   VPS Mode: ${status.isVPS}\n`);
        
        status.engines.forEach(engine => {
            console.log(`   ${engine.name}: Priority ${engine.priority}, Supports: ${engine.supports.join(', ')}`);
        });
        console.log('');
        
        // Test 2: Search Functionality
        console.log('🔍 Testing Search Functionality:');
        const searchQueries = ['test music', 'relaxing music', 'rock songs'];
        
        for (const query of searchQueries) {
            try {
                const results = await engineManager.search(query, 3);
                console.log(`   "${query}": ${results.length > 0 ? '✅' : '❌'} (${results.length} results)`);
                if (results.length > 0) {
                    console.log(`      First result: ${results[0].title} by ${results[0].author}`);
                }
            } catch (error) {
                console.log(`   "${query}": ❌ ${error.message}`);
            }
        }
        console.log('');
        
        // Test 3: URL Handling
        console.log('🔗 Testing URL Handling:');
        const testUrls = [
            'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
            'https://soundcloud.com/example/test'
        ];
        
        for (const url of testUrls) {
            try {
                const trackInfo = await engineManager.handleURL(url);
                console.log(`   ${url}: ${trackInfo ? '✅' : '❌'}`);
                if (trackInfo) {
                    console.log(`      Title: ${trackInfo.title}`);
                }
            } catch (error) {
                console.log(`   ${url}: ❌ ${error.message}`);
            }
        }
        console.log('');
        
        // Test 4: Performance Metrics
        console.log('📈 Performance Report:');
        const perfReport = vpsOptimizer.getPerformanceReport();
        console.log(`   Uptime: ${perfReport.uptime}`);
        console.log(`   Requests: ${perfReport.requests}`);
        console.log(`   Avg Response Time: ${perfReport.averageResponseTime}`);
        console.log(`   Memory: ${perfReport.memory.current} / ${perfReport.memory.limit}`);
        console.log(`   VPS Optimized: ${perfReport.isVPS}`);
        console.log('');
        
        // Test 5: Health Check
        console.log('🩺 Running Health Check:');
        await healthMonitor.runHealthCheck();
        const healthSummary = healthMonitor.getHealthSummary();
        console.log(`   Overall Health: ${healthSummary.status}`);
        console.log(`   Issues Found: ${healthSummary.issueCount || 0}`);
        console.log('');
        
        // Test 6: Engine Statistics
        console.log('📊 Engine Statistics:');
        const stats = engineManager.getStats();
        console.log(`   Total Requests: ${stats.total}`);
        console.log(`   Success Rate: ${stats.successRate}`);
        console.log(`   Failed Requests: ${stats.failed}`);
        console.log('');
        
        for (const [engineName, engineStats] of Object.entries(stats.engines)) {
            console.log(`   ${engineName}:`);
            console.log(`     Requests: ${engineStats.requests}`);
            console.log(`     Success Rate: ${engineStats.successRate}`);
            console.log(`     Avg Response Time: ${engineStats.averageResponseTime}ms`);
        }
        
        console.log('\n✅ All tests completed successfully!');
        
        // Cleanup
        await engineManager.shutdown();
        healthMonitor.stopMonitoring();
        await vpsOptimizer.cleanup();
        
    } catch (error) {
        console.error('❌ Test failed:', error);
        process.exit(1);
    }
}

// Run tests
testEngines().then(() => {
    console.log('\n🎉 Engine testing completed!');
    process.exit(0);
}).catch(error => {
    console.error('💥 Fatal error during testing:', error);
    process.exit(1);
});