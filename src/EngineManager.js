// const ProStreamEngineAdapter = require('./engines/ProStreamEngine'); // DISABLED
const HybridEngine = require('./engines/HybridEngine');
const YtdlCoreEngine = require('./engines/YtdlCoreEngine');
const SoundCloudEngine = require('./engines/SoundCloudEngine');
const DirectHTTPEngine = require('./engines/DirectHTTPEngine');

class EngineManager {
    constructor() {
        this.engines = [];
        this.stats = {
            totalRequests: 0,
            successfulRequests: 0,
            failedRequests: 0,
            engineStats: new Map()
        };
        
        this.isVPS = process.env.NODE_ENV === 'production' || process.env.VPS === 'true';
        this.maxConcurrentStreams = this.isVPS ? 3 : 5;
        this.activeStreams = new Set();
        
        this.initializeEngines();
    }

    async initializeEngines() {
        console.log('🚀 Initializing streaming engines...');
        
        try {
            // Initialize engines in priority order (lower number = higher priority)
            this.engines = [
                // new ProStreamEngineAdapter(), // DISABLED - caused issues
                new HybridEngine(),           // Priority -3 - RESTORED working engine
                new YtdlCoreEngine(),         // Priority 0 - Backup fast streaming
                new SoundCloudEngine(),       // Priority 2 - SoundCloud URLs
                new DirectHTTPEngine()        // Priority 3 - Direct HTTP streams
            ];

            // Wait for all engines to initialize
            await Promise.all(this.engines.map(engine => {
                if (engine.initialize && typeof engine.initialize === 'function') {
                    return engine.initialize();
                }
                return Promise.resolve();
            }));

            // Sort engines by priority (lower number = higher priority)
            this.engines.sort((a, b) => a.priority - b.priority);

            console.log('✅ All streaming engines initialized:');
            this.engines.forEach(engine => {
                const status = engine.getStatus();
                console.log(`   ${status.name}: Priority ${status.priority}, Supports: ${status.supports.join(', ')}`);
                this.stats.engineStats.set(status.name, {
                    requests: 0,
                    successes: 0,
                    failures: 0,
                    averageResponseTime: 0
                });
            });

        } catch (error) {
            console.error('❌ Engine initialization failed:', error.message);
        }
    }

    async handleURL(url) {
        return this.processRequest('url', url);
    }

    async search(query, limit = 10) {
        return this.processRequest('search', query, limit);
    }

    async getStream(track) {
        // Check concurrent stream limit
        if (this.activeStreams.size >= this.maxConcurrentStreams) {
            console.warn(`⚠️ Max concurrent streams reached (${this.maxConcurrentStreams}), queuing request...`);
            await this.waitForAvailableSlot();
        }

        const url = track.url || track;
        const streamId = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        this.activeStreams.add(streamId);

        try {
            const result = await this.processRequest('stream', url);
            
            if (result && result.readable) {
                // Add cleanup listener
                result.on('end', () => this.activeStreams.delete(streamId));
                result.on('close', () => this.activeStreams.delete(streamId));
                result.on('error', () => this.activeStreams.delete(streamId));
            }
            
            return result;
        } catch (error) {
            this.activeStreams.delete(streamId);
            throw error;
        }
    }

    async processRequest(type, input, limit = null) {
        const startTime = Date.now();
        this.stats.totalRequests++;

        // Find the best engine for this request
        const suitableEngines = await this.findSuitableEngines(type, input);
        
        if (suitableEngines.length === 0) {
            console.error(`❌ No suitable engines found for ${type}: ${input}`);
            this.stats.failedRequests++;
            throw new Error('No suitable streaming engines available');
        }

        let lastError;
        
        // Try engines in priority order
        for (const engine of suitableEngines) {
            try {
                console.log(`🎯 Trying ${engine.name} engine for ${type}: ${input}`);
                
                let result;
                const engineStats = this.stats.engineStats.get(engine.name);
                engineStats.requests++;

                switch (type) {
                    case 'url':
                        result = await engine.getTrackInfo(input);
                        break;
                    case 'search':
                        result = await engine.search(input, limit);
                        break;
                    case 'stream':
                        result = await engine.getStream(input);
                        break;
                    default:
                        throw new Error(`Unknown request type: ${type}`);
                }

                if (result && (Array.isArray(result) ? result.length > 0 : true)) {
                    const responseTime = Date.now() - startTime;
                    engineStats.successes++;
                    engineStats.averageResponseTime = 
                        (engineStats.averageResponseTime * (engineStats.successes - 1) + responseTime) / engineStats.successes;
                    
                    this.stats.successfulRequests++;
                    console.log(`✅ ${engine.name} succeeded in ${responseTime}ms`);
                    return result;
                }

            } catch (error) {
                lastError = error;
                const engineStats = this.stats.engineStats.get(engine.name);
                engineStats.failures++;
                console.warn(`⚠️ ${engine.name} engine failed: ${error.message}`);
                
                // Don't immediately fail if it's a network timeout - try next engine
                if (this.isRecoverableError(error)) {
                    continue;
                }
            }
        }

        this.stats.failedRequests++;
        console.error(`❌ All engines failed for ${type}: ${input}`);
        throw new Error(`All engines failed. Last error: ${lastError?.message}`);
    }

    async findSuitableEngines(type, input) {
        const suitable = [];

        for (const engine of this.engines) {
            try {
                let canHandle = true;

                if (type === 'url') {
                    canHandle = await engine.canHandle(input);
                } else if (type === 'search') {
                    // All engines except DirectHTTPEngine can search
                    canHandle = engine.name !== 'direct-http';
                } else if (type === 'stream') {
                    canHandle = await engine.canHandle(input);
                }

                if (canHandle) {
                    suitable.push(engine);
                }
            } catch (error) {
                console.warn(`⚠️ Error checking if ${engine.name} can handle ${input}:`, error.message);
            }
        }

        return suitable;
    }

    isRecoverableError(error) {
        const recoverableMessages = [
            'timeout',
            'network',
            'econnreset',
            'enotfound',
            'econnrefused',
            '429', // Rate limit
            '503', // Service unavailable
            '502'  // Bad gateway
        ];

        const message = error.message.toLowerCase();
        return recoverableMessages.some(msg => message.includes(msg));
    }

    async waitForAvailableSlot() {
        while (this.activeStreams.size >= this.maxConcurrentStreams) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }

    // Health monitoring methods
    getSystemStatus() {
        const engineStatuses = this.engines.map(engine => engine.getStatus());
        
        return {
            totalEngines: this.engines.length,
            activeEngines: this.engines.filter(e => e.initialized).length,
            activeStreams: this.activeStreams.size,
            maxConcurrentStreams: this.maxConcurrentStreams,
            isVPS: this.isVPS,
            engines: engineStatuses,
            stats: this.getStats()
        };
    }

    getStats() {
        const engineStats = {};
        for (const [name, stats] of this.stats.engineStats) {
            const successRate = stats.requests > 0 ? (stats.successes / stats.requests * 100).toFixed(1) : '0.0';
            engineStats[name] = {
                ...stats,
                successRate: `${successRate}%`
            };
        }

        return {
            total: this.stats.totalRequests,
            successful: this.stats.successfulRequests,
            failed: this.stats.failedRequests,
            successRate: this.stats.totalRequests > 0 ? 
                `${(this.stats.successfulRequests / this.stats.totalRequests * 100).toFixed(1)}%` : '0.0%',
            engines: engineStats
        };
    }

    // Performance optimization methods
    async optimizeForVPS() {
        if (!this.isVPS) return;

        console.log('🔧 Applying VPS optimizations...');

        // Reduce cache TTL for memory efficiency
        this.engines.forEach(engine => {
            if (engine.cacheTTL) {
                engine.cacheTTL = Math.min(engine.cacheTTL, 5 * 60 * 1000); // Max 5 minutes
            }
        });

        // Set conservative timeout values
        this.engines.forEach(engine => {
            if (engine.timeout) {
                engine.timeout = Math.min(engine.timeout, 12000); // Max 12 seconds
            }
        });

        console.log('✅ VPS optimizations applied');
    }

    clearAllCaches() {
        console.log('🧹 Clearing all engine caches...');
        this.engines.forEach(engine => {
            if (engine.clearCache) {
                engine.clearCache();
            }
        });
        console.log('✅ All caches cleared');
    }

    // Graceful shutdown
    async shutdown() {
        console.log('🛑 Shutting down Engine Manager...');
        
        // Wait for active streams to finish (with timeout)
        const shutdownTimeout = 10000; // 10 seconds
        const startTime = Date.now();
        
        while (this.activeStreams.size > 0 && Date.now() - startTime < shutdownTimeout) {
            console.log(`⏳ Waiting for ${this.activeStreams.size} active streams to finish...`);
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        this.clearAllCaches();
        console.log('✅ Engine Manager shutdown complete');
    }

    // Development helpers
    async testAllEngines() {
        console.log('🧪 Testing all engines...');
        
        const testQueries = [
            'test music',
            'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
            'https://soundcloud.com/example/test'
        ];

        for (const engine of this.engines) {
            console.log(`\n🔍 Testing ${engine.name}:`);
            
            for (const query of testQueries) {
                try {
                    if (query.startsWith('http')) {
                        const canHandle = await engine.canHandle(query);
                        console.log(`   ${query}: ${canHandle ? '✅' : '❌'}`);
                    } else {
                        const results = await engine.search(query, 1);
                        console.log(`   Search "${query}": ${results.length > 0 ? '✅' : '❌'} (${results.length} results)`);
                    }
                } catch (error) {
                    console.log(`   ${query}: ❌ ${error.message}`);
                }
            }
        }
    }
}

module.exports = EngineManager;