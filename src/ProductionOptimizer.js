class ProductionOptimizer {
    constructor() {
        this.isProduction = process.env.NODE_ENV === 'production' || process.env.VPS === 'true';
        this.optimizations = {
            memory: false,
            network: false,
            cache: false,
            logging: false,
            gc: false
        };
        
        if (this.isProduction) {
            this.initializeProductionOptimizations();
        }
    }

    initializeProductionOptimizations() {
        console.log('🚀 Initializing production optimizations...');
        
        this.optimizeMemory();
        this.optimizeNetwork();
        this.optimizeCache();
        this.optimizeLogging();
        this.optimizeGarbageCollection();
        
        console.log('✅ Production optimizations applied');
        this.logOptimizationStatus();
    }

    optimizeMemory() {
        // Set memory limits
        if (!process.env.NODE_OPTIONS || !process.env.NODE_OPTIONS.includes('--max-old-space-size')) {
            process.env.NODE_OPTIONS = (process.env.NODE_OPTIONS || '') + ' --max-old-space-size=512';
        }
        
        // Enable aggressive garbage collection
        if (global.gc) {
            setInterval(() => {
                const usage = process.memoryUsage();
                if (usage.heapUsed > 400 * 1024 * 1024) { // 400MB threshold
                    global.gc();
                    console.log('🧹 Automatic GC triggered');
                }
            }, 30000); // Every 30 seconds
        }
        
        this.optimizations.memory = true;
    }

    optimizeNetwork() {
        const http = require('http');
        const https = require('https');
        
        // Optimize global agents for production
        const agentOptions = {
            keepAlive: true,
            keepAliveMsecs: 5000,
            maxSockets: 8,
            maxFreeSockets: 4,
            timeout: 12000,
            freeSocketTimeout: 10000
        };
        
        http.globalAgent = new http.Agent(agentOptions);
        https.globalAgent = new https.Agent(agentOptions);
        
        // Set DNS timeout
        const dns = require('dns');
        dns.setDefaultResultOrder('ipv4first');
        
        this.optimizations.network = true;
    }

    optimizeCache() {
        // Override console methods in production to reduce I/O
        if (this.isProduction && !process.env.VERBOSE_LOGGING) {
            const originalLog = console.log;
            const originalWarn = console.warn;
            
            // Reduce console output in production
            console.log = (...args) => {
                const message = args[0];
                if (typeof message === 'string' && (
                    message.includes('✅') || 
                    message.includes('❌') || 
                    message.includes('🚨') ||
                    message.includes('ERROR') ||
                    message.includes('WARNING')
                )) {
                    originalLog(...args);
                }
            };
            
            console.warn = (...args) => {
                originalWarn(...args);
            };
        }
        
        this.optimizations.logging = true;
    }

    optimizeLogging() {
        // Implement efficient logging for production
        if (this.isProduction) {
            const fs = require('fs');
            const path = require('path');
            
            // Create logs directory if it doesn't exist
            const logsDir = path.join(process.cwd(), 'logs');
            if (!fs.existsSync(logsDir)) {
                fs.mkdirSync(logsDir, { recursive: true });
            }
            
            // Create production log file
            const logFile = path.join(logsDir, 'production.log');
            const logStream = fs.createWriteStream(logFile, { flags: 'a' });
            
            // Override console.error for production logging
            const originalError = console.error;
            console.error = (...args) => {
                const timestamp = new Date().toISOString();
                const message = args.map(arg => 
                    typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
                ).join(' ');
                
                logStream.write(`[${timestamp}] ERROR: ${message}\n`);
                originalError(...args);
            };
        }
        
        this.optimizations.logging = true;
    }

    optimizeGarbageCollection() {
        // Configure V8 flags for production
        const currentFlags = process.env.NODE_OPTIONS || '';
        const productionFlags = [
            '--optimize-for-size',
            '--gc-interval=100',
            '--max-semi-space-size=64'
        ];
        
        for (const flag of productionFlags) {
            if (!currentFlags.includes(flag)) {
                process.env.NODE_OPTIONS = (process.env.NODE_OPTIONS || '') + ` ${flag}`;
            }
        }
        
        this.optimizations.gc = true;
    }

    // Production monitoring
    setupProductionMonitoring(engineManager, healthMonitor) {
        if (!this.isProduction) return;
        
        console.log('📊 Setting up production monitoring...');
        
        // Health monitoring with alerts
        healthMonitor.on('healthAlert', (alert) => {
            this.logProductionAlert('HEALTH', alert.severity, alert.issues);
        });
        
        // Engine performance monitoring
        setInterval(() => {
            const stats = engineManager.getStats();
            const systemStatus = engineManager.getSystemStatus();
            
            // Log performance metrics every 5 minutes
            console.log(`📊 Production Metrics: ${stats.successRate} success rate, ${systemStatus.activeStreams} active streams`);
            
            // Alert on high failure rates
            if (stats.total > 10 && parseFloat(stats.successRate) < 50) {
                this.logProductionAlert('PERFORMANCE', 'critical', ['High failure rate detected']);
            }
        }, 5 * 60 * 1000); // Every 5 minutes
        
        // Memory monitoring
        setInterval(() => {
            const usage = process.memoryUsage();
            const heapUsedMB = Math.round(usage.heapUsed / 1024 / 1024);
            
            if (heapUsedMB > 450) { // 450MB warning
                this.logProductionAlert('MEMORY', 'warning', [`High memory usage: ${heapUsedMB}MB`]);
            }
        }, 2 * 60 * 1000); // Every 2 minutes
        
        console.log('✅ Production monitoring active');
    }

    logProductionAlert(type, severity, issues) {
        const timestamp = new Date().toISOString();
        const alert = {
            timestamp,
            type,
            severity: severity.toUpperCase(),
            issues,
            pid: process.pid,
            uptime: Math.round(process.uptime()),
            memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024)
        };
        
        console.error(`🚨 PRODUCTION ALERT [${type}:${severity.toUpperCase()}]:`, JSON.stringify(alert, null, 2));
        
        // You could add webhook notifications, email alerts, etc. here
    }

    // Performance tuning for specific components
    tuneEngineManager(engineManager) {
        if (!this.isProduction) return;
        
        // Reduce concurrent streams for VPS
        engineManager.maxConcurrentStreams = Math.min(engineManager.maxConcurrentStreams, 3);
        
        // Apply production timeouts
        engineManager.engines.forEach(engine => {
            if (engine.timeout) {
                engine.timeout = Math.min(engine.timeout, 10000); // Max 10 seconds
            }
            if (engine.cacheTTL) {
                engine.cacheTTL = Math.min(engine.cacheTTL, 3 * 60 * 1000); // Max 3 minutes
            }
        });
        
        console.log('🔧 Engine Manager tuned for production');
    }

    tuneHealthMonitor(healthMonitor) {
        if (!this.isProduction) return;
        
        // More frequent health checks in production
        healthMonitor.setCheckInterval(30000); // Every 30 seconds
        
        // Stricter thresholds for production
        healthMonitor.updateThresholds({
            maxFailureRate: 0.3, // 30% instead of 50%
            maxResponseTime: 10000, // 10s instead of 15s
            maxMemoryUsage: 450 * 1024 * 1024 // 450MB instead of 512MB
        });
        
        console.log('🔧 Health Monitor tuned for production');
    }

    // Graceful shutdown handling
    setupGracefulShutdown(musicManager) {
        const shutdownHandler = async (signal) => {
            console.log(`🛑 Received ${signal}, initiating graceful shutdown...`);
            
            try {
                // Stop accepting new requests
                if (musicManager && musicManager.engineManager) {
                    musicManager.engineManager.maxConcurrentStreams = 0;
                }
                
                // Wait for active streams to finish (with timeout)
                let countdown = 10; // 10 seconds max
                while (countdown > 0 && musicManager?.engineManager?.activeStreams?.size > 0) {
                    console.log(`⏳ Waiting for ${musicManager.engineManager.activeStreams.size} streams to finish... (${countdown}s)`);
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    countdown--;
                }
                
                // Cleanup
                if (musicManager && musicManager.cleanup) {
                    await musicManager.cleanup();
                }
                
                console.log('✅ Graceful shutdown completed');
                process.exit(0);
            } catch (error) {
                console.error('❌ Error during graceful shutdown:', error);
                process.exit(1);
            }
        };
        
        process.on('SIGTERM', () => shutdownHandler('SIGTERM'));
        process.on('SIGINT', () => shutdownHandler('SIGINT'));
        process.on('SIGUSR2', () => shutdownHandler('SIGUSR2')); // For nodemon
        
        console.log('🛡️ Graceful shutdown handlers registered');
    }

    logOptimizationStatus() {
        console.log('🔧 Production Optimization Status:');
        for (const [key, enabled] of Object.entries(this.optimizations)) {
            console.log(`   ${key}: ${enabled ? '✅' : '❌'}`);
        }
        
        const usage = process.memoryUsage();
        console.log(`📊 Current Memory Usage: ${Math.round(usage.heapUsed / 1024 / 1024)}MB`);
        console.log(`📊 Memory Limit: ${process.env.NODE_OPTIONS?.includes('max-old-space-size') ? 'Set' : 'Default'}`);
    }

    // Static method to create production-ready instance
    static createForProduction(musicManager) {
        const optimizer = new ProductionOptimizer();
        
        if (optimizer.isProduction && musicManager) {
            optimizer.setupProductionMonitoring(musicManager.engineManager, musicManager.healthMonitor);
            optimizer.tuneEngineManager(musicManager.engineManager);
            optimizer.tuneHealthMonitor(musicManager.healthMonitor);
            optimizer.setupGracefulShutdown(musicManager);
        }
        
        return optimizer;
    }
}

module.exports = ProductionOptimizer;