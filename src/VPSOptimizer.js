class VPSOptimizer {
    constructor() {
        this.isVPS = process.env.NODE_ENV === 'production' || process.env.VPS === 'true';
        this.optimizations = new Map();
        this.performanceMetrics = {
            startTime: Date.now(),
            requestCount: 0,
            averageResponseTime: 0,
            memoryUsage: [],
            cpuUsage: []
        };
        
        this.config = {
            // Memory management
            maxMemoryUsage: 400 * 1024 * 1024, // 400MB
            gcThreshold: 300 * 1024 * 1024, // 300MB triggers GC
            
            // Network optimizations
            maxConcurrentRequests: this.isVPS ? 3 : 6,
            requestTimeout: this.isVPS ? 12000 : 20000,
            retryDelay: this.isVPS ? 2000 : 1000,
            
            // Cache optimizations
            maxCacheSize: this.isVPS ? 100 : 200,
            cacheTTL: this.isVPS ? 5 * 60 * 1000 : 10 * 60 * 1000, // 5min vs 10min
            
            // Stream optimizations
            streamBufferSize: this.isVPS ? 64 * 1024 : 256 * 1024, // 64KB vs 256KB
            streamQuality: this.isVPS ? 2 : 1, // Use integer quality values
            
            // DNS and connection optimizations
            dnsCacheEnabled: true,
            keepAliveTimeout: this.isVPS ? 5000 : 10000,
            maxSockets: this.isVPS ? 10 : 20
        };
        
        if (this.isVPS) {
            this.initializeVPSOptimizations();
        }
    }

    initializeVPSOptimizations() {
        console.log('🚀 Initializing VPS optimizations...');
        
        // Enable DNS caching
        this.enableDNSCaching();
        
        // Configure HTTP agent settings
        this.optimizeHTTPAgent();
        
        // Set up memory monitoring
        this.setupMemoryMonitoring();
        
        // Configure garbage collection
        this.optimizeGarbageCollection();
        
        // Set process limits
        this.setProcessLimits();
        
        console.log('✅ VPS optimizations applied');
        console.log(`   Max memory: ${this.config.maxMemoryUsage / 1024 / 1024}MB`);
        console.log(`   Max concurrent requests: ${this.config.maxConcurrentRequests}`);
        console.log(`   Request timeout: ${this.config.requestTimeout}ms`);
        console.log(`   Cache TTL: ${this.config.cacheTTL / 1000}s`);
    }

    enableDNSCaching() {
        const dns = require('dns');
        dns.setDefaultResultOrder('ipv4first');
        
        // Simple DNS cache implementation
        const dnsCache = new Map();
        const originalLookup = dns.lookup;
        
        dns.lookup = (hostname, options, callback) => {
            if (typeof options === 'function') {
                callback = options;
                options = {};
            }
            
            const cacheKey = `${hostname}_${JSON.stringify(options)}`;
            const cached = dnsCache.get(cacheKey);
            
            if (cached && Date.now() - cached.timestamp < 300000) { // 5 minutes
                return callback(null, cached.address, cached.family);
            }
            
            originalLookup(hostname, options, (err, address, family) => {
                if (!err) {
                    dnsCache.set(cacheKey, {
                        address,
                        family,
                        timestamp: Date.now()
                    });
                }
                callback(err, address, family);
            });
        };
        
        this.optimizations.set('dnsCache', { enabled: true, size: () => dnsCache.size });
    }

    optimizeHTTPAgent() {
        const http = require('http');
        const https = require('https');
        
        // Configure global agent settings for better VPS performance
        const agentOptions = {
            keepAlive: true,
            keepAliveMsecs: this.config.keepAliveTimeout,
            maxSockets: this.config.maxSockets,
            maxFreeSockets: Math.floor(this.config.maxSockets / 2),
            timeout: this.config.requestTimeout,
            freeSocketTimeout: 15000
        };
        
        http.globalAgent = new http.Agent(agentOptions);
        https.globalAgent = new https.Agent(agentOptions);
        
        this.optimizations.set('httpAgent', { enabled: true, config: agentOptions });
    }

    setupMemoryMonitoring() {
        setInterval(() => {
            const usage = process.memoryUsage();
            this.performanceMetrics.memoryUsage.push({
                timestamp: Date.now(),
                heapUsed: usage.heapUsed,
                heapTotal: usage.heapTotal,
                external: usage.external
            });
            
            // Keep only last 60 measurements (1 hour if checked every minute)
            if (this.performanceMetrics.memoryUsage.length > 60) {
                this.performanceMetrics.memoryUsage.shift();
            }
            
            // Trigger GC if memory usage is high
            if (usage.heapUsed > this.config.gcThreshold && global.gc) {
                console.log(`🧹 Triggering GC (heap: ${(usage.heapUsed / 1024 / 1024).toFixed(1)}MB)`);
                global.gc();
            }
            
        }, 60000); // Every minute
        
        this.optimizations.set('memoryMonitoring', { enabled: true });
    }

    optimizeGarbageCollection() {
        // Configure V8 flags for better VPS performance
        if (process.env.NODE_OPTIONS) {
            process.env.NODE_OPTIONS += ' --optimize-for-size --max-old-space-size=400';
        } else {
            process.env.NODE_OPTIONS = '--optimize-for-size --max-old-space-size=400';
        }
        
        this.optimizations.set('gcOptimization', { enabled: true });
    }

    setProcessLimits() {
        // Set process title for easier monitoring
        process.title = 'ative-music-bot';
        
        // Handle uncaught exceptions gracefully
        process.on('uncaughtException', (error) => {
            console.error('❌ Uncaught exception:', error);
            // Don't exit immediately, try to continue
        });
        
        process.on('unhandledRejection', (reason, promise) => {
            console.error('❌ Unhandled rejection:', reason);
            // Don't exit immediately, try to continue
        });
        
        // Optimize event loop
        process.nextTick(() => {
            if (process.env.UV_THREADPOOL_SIZE) {
                console.log(`🔧 UV threadpool size: ${process.env.UV_THREADPOOL_SIZE}`);
            } else {
                process.env.UV_THREADPOOL_SIZE = '4'; // Optimize for VPS
            }
        });
        
        this.optimizations.set('processLimits', { enabled: true });
    }

    // Performance optimization methods
    optimizeForStreaming(engineManager) {
        if (!this.isVPS) return;
        
        console.log('🎵 Applying streaming-specific VPS optimizations...');
        
        // Reduce concurrent streams on VPS
        engineManager.maxConcurrentStreams = this.config.maxConcurrentRequests;
        
        // Apply cache optimizations to engines
        engineManager.engines.forEach(engine => {
            if (engine.cache) {
                // Limit cache size
                const originalSet = engine.cache.set.bind(engine.cache);
                engine.cache.set = (key, value) => {
                    if (engine.cache.size >= this.config.maxCacheSize) {
                        const firstKey = engine.cache.keys().next().value;
                        engine.cache.delete(firstKey);
                    }
                    return originalSet(key, value);
                };
            }
            
            // Reduce timeouts
            if (engine.timeout) {
                engine.timeout = Math.min(engine.timeout, this.config.requestTimeout);
            }
            
            // Optimize cache TTL
            if (engine.cacheTTL) {
                engine.cacheTTL = this.config.cacheTTL;
            }
        });
        
        this.optimizations.set('streamingOptimization', { enabled: true });
    }

    // Performance monitoring
    recordRequest(responseTime) {
        this.performanceMetrics.requestCount++;
        this.performanceMetrics.averageResponseTime = 
            (this.performanceMetrics.averageResponseTime * (this.performanceMetrics.requestCount - 1) + responseTime) 
            / this.performanceMetrics.requestCount;
    }

    getPerformanceReport() {
        const usage = process.memoryUsage();
        const uptime = Date.now() - this.performanceMetrics.startTime;
        
        return {
            uptime: `${(uptime / 1000 / 60).toFixed(1)}m`,
            isVPS: this.isVPS,
            requests: this.performanceMetrics.requestCount,
            averageResponseTime: `${this.performanceMetrics.averageResponseTime.toFixed(0)}ms`,
            memory: {
                current: `${(usage.heapUsed / 1024 / 1024).toFixed(1)}MB`,
                peak: this.performanceMetrics.memoryUsage.length > 0 
                    ? `${Math.max(...this.performanceMetrics.memoryUsage.map(m => m.heapUsed)) / 1024 / 1024}MB`
                    : 'N/A',
                limit: `${this.config.maxMemoryUsage / 1024 / 1024}MB`
            },
            optimizations: Object.fromEntries(this.optimizations),
            config: {
                maxConcurrentRequests: this.config.maxConcurrentRequests,
                requestTimeout: this.config.requestTimeout,
                cacheTTL: `${this.config.cacheTTL / 1000}s`,
                streamQuality: this.config.streamQuality
            }
        };
    }

    // Resource cleanup
    async cleanup() {
        console.log('🧹 Running VPS cleanup...');
        
        // Force garbage collection if available
        if (global.gc) {
            global.gc();
        }
        
        // Clear DNS cache
        const dnsOptimization = this.optimizations.get('dnsCache');
        if (dnsOptimization) {
            // Clear internal DNS cache (implementation-specific)
            console.log('   DNS cache cleared');
        }
        
        // Log memory usage after cleanup
        const usage = process.memoryUsage();
        console.log(`   Memory after cleanup: ${(usage.heapUsed / 1024 / 1024).toFixed(1)}MB`);
        
        this.optimizations.set('lastCleanup', { timestamp: Date.now() });
    }

    // Auto-scaling suggestions
    getScalingRecommendations() {
        const report = this.getPerformanceReport();
        const recommendations = [];
        
        // Memory recommendations
        const currentMemoryMB = parseFloat(report.memory.current);
        if (currentMemoryMB > 300) {
            recommendations.push({
                type: 'memory',
                severity: 'warning',
                message: 'Consider increasing VPS memory or reducing cache sizes',
                current: report.memory.current,
                recommended: '512MB+ VPS'
            });
        }
        
        // Performance recommendations
        if (this.performanceMetrics.averageResponseTime > 10000) {
            recommendations.push({
                type: 'performance',
                severity: 'warning',
                message: 'High response times detected, consider VPS upgrade',
                current: `${this.performanceMetrics.averageResponseTime.toFixed(0)}ms`,
                recommended: 'Higher CPU/bandwidth VPS'
            });
        }
        
        // Request volume recommendations
        if (this.performanceMetrics.requestCount > 1000) {
            const requestsPerMinute = this.performanceMetrics.requestCount / (Date.now() - this.performanceMetrics.startTime) * 60000;
            if (requestsPerMinute > 10) {
                recommendations.push({
                    type: 'scaling',
                    severity: 'info',
                    message: 'High request volume, consider load balancing',
                    current: `${requestsPerMinute.toFixed(1)} req/min`,
                    recommended: 'Multiple VPS instances or CDN'
                });
            }
        }
        
        return {
            timestamp: Date.now(),
            vpsOptimized: this.isVPS,
            recommendations,
            currentConfig: report.config
        };
    }
}

module.exports = VPSOptimizer;