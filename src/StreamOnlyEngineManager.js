const YtdlCoreEngine = require('./engines/YtdlCoreEngine');
const SoundCloudEngine = require('./engines/SoundCloudEngine');
const DirectHTTPEngine = require('./engines/DirectHTTPEngine');

class StreamOnlyEngineManager {
    constructor() {
        this.engines = [];
        this.stats = {
            totalRequests: 0,
            successfulRequests: 0,
            failedRequests: 0,
            engineStats: new Map()
        };
        
        this.isVPS = process.env.NODE_ENV === 'production' || process.env.VPS === 'true';
        this.maxConcurrentStreams = this.isVPS ? 2 : 4; // Reduced for pure streaming
        this.activeStreams = new Set();
        this.streamTimeout = 30000; // 30 seconds timeout for streams
        
        this.initializeEngines();
    }

    async initializeEngines() {
        console.log('🚀 Initializing pure streaming engines...');
        
        try {
            // Only use engines that support direct streaming without downloading
            this.engines = [
                new YtdlCoreEngine(),         // Priority 0 - Fast direct streaming
                new SoundCloudEngine(),       // Priority 2 - SoundCloud direct streams
                new DirectHTTPEngine()        // Priority 3 - Direct HTTP streams
            ];

            // Configure engines for streaming-only mode
            this.engines.forEach(engine => {
                if (engine.setStreamOnlyMode && typeof engine.setStreamOnlyMode === 'function') {
                    engine.setStreamOnlyMode(true);
                }
                if (engine.disableDownloading && typeof engine.disableDownloading === 'function') {
                    engine.disableDownloading();
                }
            });

            // Wait for all engines to initialize
            await Promise.all(this.engines.map(engine => {
                if (engine.initialize && typeof engine.initialize === 'function') {
                    return engine.initialize();
                }
                return Promise.resolve();
            }));

            // Sort engines by priority (lower number = higher priority)
            this.engines.sort((a, b) => a.priority - b.priority);

            console.log('✅ Pure streaming engines initialized:');
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
            console.error('❌ Stream engine initialization failed:', error.message);
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
            console.warn(`⚠️ Max concurrent streams reached (${this.maxConcurrentStreams}), waiting for slot...`);
            await this.waitForAvailableSlot();
        }

        const url = track.url || track;
        const streamId = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        this.activeStreams.add(streamId);

        // Set a timeout for the stream
        const timeoutId = setTimeout(() => {
            console.warn(`⚠️ Stream timeout for ${streamId}`);
            this.activeStreams.delete(streamId);
        }, this.streamTimeout);

        try {
            const result = await this.processRequest('stream', url);
            
            if (result && result.readable) {
                // Clear timeout on successful stream
                clearTimeout(timeoutId);
                
                // Add cleanup listeners
                result.on('end', () => {
                    clearTimeout(timeoutId);
                    this.activeStreams.delete(streamId);
                });
                result.on('close', () => {
                    clearTimeout(timeoutId);
                    this.activeStreams.delete(streamId);
                });
                result.on('error', () => {
                    clearTimeout(timeoutId);
                    this.activeStreams.delete(streamId);
                });
                
                // Add memory-efficient settings for streaming
                if (result.setMaxListeners) {
                    result.setMaxListeners(20);
                }
            }
            
            return result;
        } catch (error) {
            clearTimeout(timeoutId);
            this.activeStreams.delete(streamId);
            throw error;
        }
    }

    async waitForAvailableSlot() {
        return new Promise((resolve) => {
            const checkSlot = () => {
                if (this.activeStreams.size < this.maxConcurrentStreams) {
                    resolve();
                } else {
                    setTimeout(checkSlot, 100);
                }
            };
            checkSlot();
        });
    }

    async processRequest(operation, ...args) {
        this.stats.totalRequests++;
        const startTime = Date.now();

        for (const engine of this.engines) {
            const engineName = engine.constructor.name;
            let engineStats = this.stats.engineStats.get(engineName);
            
            // Initialize engine stats if not exists
            if (!engineStats) {
                engineStats = {
                    requests: 0,
                    successes: 0,
                    failures: 0,
                    averageResponseTime: 0
                };
                this.stats.engineStats.set(engineName, engineStats);
            }
            
            try {
                engineStats.requests++;
                
                let result;
                switch (operation) {
                    case 'url':
                        if (engine.handleURL) {
                            result = await engine.handleURL(args[0]);
                        }
                        break;
                    case 'search':
                        if (engine.search) {
                            result = await engine.search(args[0], args[1]);
                        }
                        break;
                    case 'stream':
                        if (engine.getStream) {
                            result = await engine.getStream(args[0]);
                        }
                        break;
                    default:
                        console.warn(`Unknown operation: ${operation}`);
                        continue;
                }

                if (result !== null && result !== undefined && (Array.isArray(result) ? result.length > 0 : result)) {
                    const responseTime = Date.now() - startTime;
                    engineStats.successes++;
                    engineStats.averageResponseTime = 
                        (engineStats.averageResponseTime * (engineStats.successes - 1) + responseTime) / engineStats.successes;
                    
                    this.stats.successfulRequests++;
                    console.log(`✅ ${operation} successful via ${engineName} (${responseTime}ms)`);
                    return result;
                }
            } catch (error) {
                engineStats.failures++;
                console.log(`❌ ${engineName} failed for ${operation}: ${error.message}`);
                continue;
            }
        }

        this.stats.failedRequests++;
        throw new Error(`All engines failed for ${operation}`);
    }

    getStats() {
        const totalResponseTime = Array.from(this.stats.engineStats.values())
            .reduce((total, stats) => total + (stats.averageResponseTime * stats.successes), 0);
        const totalSuccesses = Array.from(this.stats.engineStats.values())
            .reduce((total, stats) => total + stats.successes, 0);

        return {
            ...this.stats,
            overallAverageResponseTime: totalSuccesses > 0 ? totalResponseTime / totalSuccesses : 0,
            successRate: this.stats.totalRequests > 0 ? 
                (this.stats.successfulRequests / this.stats.totalRequests * 100).toFixed(2) + '%' : '0%',
            activeStreams: this.activeStreams.size,
            maxConcurrentStreams: this.maxConcurrentStreams
        };
    }

    // Cleanup method to free up resources
    cleanup() {
        console.log('🧹 Cleaning up streaming engines...');
        this.activeStreams.clear();
        
        this.engines.forEach(engine => {
            if (engine.cleanup && typeof engine.cleanup === 'function') {
                engine.cleanup();
            }
        });
    }

    // Health check for engines
    async healthCheck() {
        const healthStatus = {};
        
        for (const engine of this.engines) {
            const engineName = engine.constructor.name;
            try {
                if (engine.healthCheck && typeof engine.healthCheck === 'function') {
                    healthStatus[engineName] = await engine.healthCheck();
                } else {
                    healthStatus[engineName] = { status: 'unknown', message: 'No health check available' };
                }
            } catch (error) {
                healthStatus[engineName] = { status: 'error', message: error.message };
            }
        }
        
        return healthStatus;
    }
}

module.exports = StreamOnlyEngineManager;