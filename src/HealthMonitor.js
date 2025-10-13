const EventEmitter = require('events');

class HealthMonitor extends EventEmitter {
    constructor(engineManager) {
        super();
        this.engineManager = engineManager;
        this.checks = new Map();
        this.alertThresholds = {
            maxFailureRate: 0.5, // 50% failure rate triggers alert
            maxResponseTime: 15000, // 15 seconds max response time
            minSuccessfulEngines: 2, // At least 2 engines should be working
            maxMemoryUsage: 512 * 1024 * 1024 // 512MB memory limit
        };
        
        this.monitoring = false;
        this.checkInterval = 60000; // 1 minute
        this.monitoringTimer = null;
        this.lastHealthCheck = null;
        
        this.initializeChecks();
    }

    initializeChecks() {
        // Register health check functions
        this.checks.set('engine_availability', this.checkEngineAvailability.bind(this));
        this.checks.set('performance_metrics', this.checkPerformanceMetrics.bind(this));
        this.checks.set('memory_usage', this.checkMemoryUsage.bind(this));
        this.checks.set('concurrent_streams', this.checkConcurrentStreams.bind(this));
        this.checks.set('error_rates', this.checkErrorRates.bind(this));
    }

    startMonitoring() {
        if (this.monitoring) return;
        
        console.log('🩺 Starting health monitoring...');
        this.monitoring = true;
        
        // Run initial health check
        this.runHealthCheck();
        
        // Set up periodic monitoring
        this.monitoringTimer = setInterval(() => {
            this.runHealthCheck();
        }, this.checkInterval);
        
        console.log(`✅ Health monitoring started (interval: ${this.checkInterval}ms)`);
    }

    stopMonitoring() {
        if (!this.monitoring) return;
        
        console.log('🛑 Stopping health monitoring...');
        this.monitoring = false;
        
        if (this.monitoringTimer) {
            clearInterval(this.monitoringTimer);
            this.monitoringTimer = null;
        }
        
        console.log('✅ Health monitoring stopped');
    }

    async runHealthCheck() {
        const startTime = Date.now();
        const results = new Map();
        let overallHealth = 'healthy';
        const issues = [];

        try {
            console.log('🔍 Running health check...');

            // Run all health checks
            for (const [checkName, checkFunction] of this.checks) {
                try {
                    const result = await checkFunction();
                    results.set(checkName, result);
                    
                    if (result.status !== 'healthy') {
                        if (result.status === 'critical') {
                            overallHealth = 'critical';
                        } else if (overallHealth === 'healthy') {
                            overallHealth = 'warning';
                        }
                        issues.push(`${checkName}: ${result.message}`);
                    }
                } catch (error) {
                    const errorResult = {
                        status: 'critical',
                        message: `Check failed: ${error.message}`,
                        error: error.message
                    };
                    results.set(checkName, errorResult);
                    overallHealth = 'critical';
                    issues.push(`${checkName}: Check failed - ${error.message}`);
                }
            }

            const healthReport = {
                timestamp: new Date().toISOString(),
                overallHealth,
                checkDuration: Date.now() - startTime,
                checks: Object.fromEntries(results),
                issues,
                systemInfo: this.getSystemInfo()
            };

            this.lastHealthCheck = healthReport;

            // Emit health check event
            this.emit('healthCheck', healthReport);

            // Handle alerts
            if (overallHealth !== 'healthy') {
                this.handleHealthAlert(healthReport);
            }

            // Log summary
            const checkCount = results.size;
            const healthyCount = Array.from(results.values()).filter(r => r.status === 'healthy').length;
            console.log(`🩺 Health check completed: ${healthyCount}/${checkCount} checks passed (${overallHealth})`);

            if (issues.length > 0) {
                console.warn('⚠️ Health issues detected:');
                issues.forEach(issue => console.warn(`   ${issue}`));
            }

        } catch (error) {
            console.error('❌ Health check failed:', error.message);
            this.emit('healthCheckError', error);
        }
    }

    async checkEngineAvailability() {
        const status = this.engineManager.getSystemStatus();
        const workingEngines = status.engines.filter(e => e.initialized).length;
        
        if (workingEngines === 0) {
            return {
                status: 'critical',
                message: 'No engines are available',
                data: { workingEngines, totalEngines: status.totalEngines }
            };
        } else if (workingEngines < this.alertThresholds.minSuccessfulEngines) {
            return {
                status: 'warning',
                message: `Only ${workingEngines} engines available`,
                data: { workingEngines, totalEngines: status.totalEngines }
            };
        }

        return {
            status: 'healthy',
            message: `${workingEngines}/${status.totalEngines} engines available`,
            data: { workingEngines, totalEngines: status.totalEngines }
        };
    }

    async checkPerformanceMetrics() {
        const stats = this.engineManager.getStats();
        const issues = [];

        // Check overall failure rate
        const failureRate = stats.failed / Math.max(stats.total, 1);
        if (failureRate > this.alertThresholds.maxFailureRate) {
            issues.push(`High failure rate: ${(failureRate * 100).toFixed(1)}%`);
        }

        // Check individual engine performance
        for (const [engineName, engineStats] of Object.entries(stats.engines)) {
            if (engineStats.averageResponseTime > this.alertThresholds.maxResponseTime) {
                issues.push(`${engineName} slow response: ${engineStats.averageResponseTime}ms`);
            }
        }

        if (issues.length > 0) {
            return {
                status: 'warning',
                message: issues.join(', '),
                data: stats
            };
        }

        return {
            status: 'healthy',
            message: 'Performance metrics normal',
            data: stats
        };
    }

    async checkMemoryUsage() {
        const usage = process.memoryUsage();
        const heapUsed = usage.heapUsed;
        
        if (heapUsed > this.alertThresholds.maxMemoryUsage) {
            return {
                status: 'warning',
                message: `High memory usage: ${(heapUsed / 1024 / 1024).toFixed(1)}MB`,
                data: {
                    heapUsed: `${(heapUsed / 1024 / 1024).toFixed(1)}MB`,
                    heapTotal: `${(usage.heapTotal / 1024 / 1024).toFixed(1)}MB`,
                    external: `${(usage.external / 1024 / 1024).toFixed(1)}MB`
                }
            };
        }

        return {
            status: 'healthy',
            message: `Memory usage normal: ${(heapUsed / 1024 / 1024).toFixed(1)}MB`,
            data: {
                heapUsed: `${(heapUsed / 1024 / 1024).toFixed(1)}MB`,
                heapTotal: `${(usage.heapTotal / 1024 / 1024).toFixed(1)}MB`
            }
        };
    }

    async checkConcurrentStreams() {
        const status = this.engineManager.getSystemStatus();
        const activeStreams = status.activeStreams;
        const maxStreams = status.maxConcurrentStreams;
        
        const utilization = activeStreams / maxStreams;
        
        if (utilization > 0.9) {
            return {
                status: 'warning',
                message: `High stream utilization: ${activeStreams}/${maxStreams}`,
                data: { activeStreams, maxStreams, utilization: `${(utilization * 100).toFixed(1)}%` }
            };
        }

        return {
            status: 'healthy',
            message: `Stream utilization normal: ${activeStreams}/${maxStreams}`,
            data: { activeStreams, maxStreams, utilization: `${(utilization * 100).toFixed(1)}%` }
        };
    }

    async checkErrorRates() {
        const stats = this.engineManager.getStats();
        const criticalEngines = [];
        
        for (const [engineName, engineStats] of Object.entries(stats.engines)) {
            const successRate = parseFloat(engineStats.successRate);
            if (engineStats.requests > 5 && successRate < 20) { // Less than 20% success rate
                criticalEngines.push(`${engineName}: ${engineStats.successRate}`);
            }
        }

        if (criticalEngines.length > 0) {
            return {
                status: 'critical',
                message: `Engines with critical error rates: ${criticalEngines.join(', ')}`,
                data: stats.engines
            };
        }

        return {
            status: 'healthy',
            message: 'Error rates within normal ranges',
            data: stats.engines
        };
    }

    handleHealthAlert(healthReport) {
        console.warn('🚨 HEALTH ALERT TRIGGERED');
        console.warn(`   Status: ${healthReport.overallHealth.toUpperCase()}`);
        console.warn(`   Issues: ${healthReport.issues.length}`);
        
        // Emit alert event
        this.emit('healthAlert', {
            severity: healthReport.overallHealth,
            issues: healthReport.issues,
            timestamp: healthReport.timestamp,
            report: healthReport
        });

        // Auto-recovery actions for critical issues
        if (healthReport.overallHealth === 'critical') {
            this.attemptAutoRecovery(healthReport);
        }
    }

    async attemptAutoRecovery(healthReport) {
        console.log('🔧 Attempting automatic recovery...');
        
        const recoveryActions = [];

        // Check if memory is too high
        if (healthReport.checks.memory_usage?.status !== 'healthy') {
            recoveryActions.push('clear_caches');
        }

        // Check if engines are failing
        if (healthReport.checks.engine_availability?.status === 'critical') {
            recoveryActions.push('restart_engines');
        }

        // Execute recovery actions
        for (const action of recoveryActions) {
            try {
                await this.executeRecoveryAction(action);
                console.log(`✅ Recovery action completed: ${action}`);
            } catch (error) {
                console.error(`❌ Recovery action failed: ${action} - ${error.message}`);
            }
        }

        if (recoveryActions.length > 0) {
            // Run health check again after recovery
            setTimeout(() => this.runHealthCheck(), 5000);
        }
    }

    async executeRecoveryAction(action) {
        switch (action) {
            case 'clear_caches':
                this.engineManager.clearAllCaches();
                if (global.gc) {
                    global.gc();
                }
                break;
                
            case 'restart_engines':
                await this.engineManager.initializeEngines();
                break;
                
            default:
                throw new Error(`Unknown recovery action: ${action}`);
        }
    }

    getSystemInfo() {
        const usage = process.memoryUsage();
        return {
            nodeVersion: process.version,
            platform: process.platform,
            uptime: `${(process.uptime() / 60).toFixed(1)}m`,
            memory: {
                heapUsed: `${(usage.heapUsed / 1024 / 1024).toFixed(1)}MB`,
                heapTotal: `${(usage.heapTotal / 1024 / 1024).toFixed(1)}MB`
            },
            engines: this.engineManager.getSystemStatus()
        };
    }

    // API methods for external monitoring
    getLastHealthCheck() {
        return this.lastHealthCheck;
    }

    getHealthSummary() {
        if (!this.lastHealthCheck) {
            return { status: 'unknown', message: 'No health checks run yet' };
        }

        return {
            status: this.lastHealthCheck.overallHealth,
            timestamp: this.lastHealthCheck.timestamp,
            checkDuration: this.lastHealthCheck.checkDuration,
            issueCount: this.lastHealthCheck.issues.length,
            systemInfo: this.lastHealthCheck.systemInfo
        };
    }

    // Configuration methods
    updateThresholds(newThresholds) {
        this.alertThresholds = { ...this.alertThresholds, ...newThresholds };
        console.log('🔧 Health monitoring thresholds updated:', newThresholds);
    }

    setCheckInterval(intervalMs) {
        this.checkInterval = intervalMs;
        
        if (this.monitoring) {
            this.stopMonitoring();
            this.startMonitoring();
        }
    }
}

module.exports = HealthMonitor;