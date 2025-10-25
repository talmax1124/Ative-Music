class MobileGestureHandler {
    constructor() {
        this.gestures = new Map();
        this.activeGestures = new Map();
        this.config = {
            swipeThreshold: 50,
            swipeTimeout: 300,
            doubleTapDelay: 300,
            longPressDelay: 500,
            pinchThreshold: 10,
            dragThreshold: 10
        };
        
        this.callbacks = {
            swipe: new Map(),
            tap: new Map(),
            doubleTap: new Map(),
            longPress: new Map(),
            pinch: new Map(),
            drag: new Map(),
            pullToRefresh: new Map()
        };
        
        this.init();
    }
    
    init() {
        // Prevent default touch behaviors that interfere with custom gestures
        document.addEventListener('touchstart', this.handleTouchStart.bind(this), { passive: false });
        document.addEventListener('touchmove', this.handleTouchMove.bind(this), { passive: false });
        document.addEventListener('touchend', this.handleTouchEnd.bind(this), { passive: false });
        document.addEventListener('touchcancel', this.handleTouchCancel.bind(this), { passive: false });
        
        // Add CSS for touch feedback
        this.addTouchStyles();
        
        console.log('📱 Mobile gesture handler initialized');
    }
    
    addTouchStyles() {
        const style = document.createElement('style');
        style.textContent = `
            .gesture-area {
                touch-action: manipulation;
                -webkit-user-select: none;
                user-select: none;
            }
            
            .swipeable {
                touch-action: pan-y;
                position: relative;
                overflow: hidden;
            }
            
            .swipeable::after {
                content: '';
                position: absolute;
                top: 0;
                right: 0;
                bottom: 0;
                left: 0;
                background: rgba(255, 255, 255, 0.1);
                opacity: 0;
                transition: opacity 0.2s ease;
                pointer-events: none;
            }
            
            .swipeable.swiping::after {
                opacity: 1;
            }
            
            .draggable {
                touch-action: none;
                position: relative;
                cursor: grab;
            }
            
            .draggable.dragging {
                cursor: grabbing;
                z-index: 1000;
                transform: scale(1.05);
                box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
            }
            
            .long-pressable {
                position: relative;
            }
            
            .long-pressable.pressing {
                transform: scale(0.95);
                transition: transform 0.1s ease;
            }
            
            .pull-to-refresh {
                position: relative;
                overflow: hidden;
            }
            
            .pull-to-refresh-indicator {
                position: absolute;
                top: -60px;
                left: 50%;
                transform: translateX(-50%);
                width: 40px;
                height: 40px;
                border-radius: 50%;
                background: var(--accent);
                display: flex;
                align-items: center;
                justify-content: center;
                color: white;
                transition: all 0.3s ease;
                opacity: 0;
            }
            
            .pull-to-refresh.pulling .pull-to-refresh-indicator {
                opacity: 1;
                top: 10px;
            }
            
            .haptic-feedback {
                animation: haptic-pulse 0.1s ease;
            }
            
            @keyframes haptic-pulse {
                0% { transform: scale(1); }
                50% { transform: scale(1.05); }
                100% { transform: scale(1); }
            }
        `;
        document.head.appendChild(style);
    }
    
    // Register gesture listeners
    onSwipe(element, callback, direction = 'all') {
        const id = this.generateId();
        element.classList.add('swipeable', 'gesture-area');
        element.dataset.gestureId = id;
        
        this.callbacks.swipe.set(id, { callback, direction, element });
        return id;
    }
    
    onTap(element, callback) {
        const id = this.generateId();
        element.classList.add('gesture-area');
        element.dataset.gestureId = id;
        
        this.callbacks.tap.set(id, { callback, element });
        return id;
    }
    
    onDoubleTap(element, callback) {
        const id = this.generateId();
        element.classList.add('gesture-area');
        element.dataset.gestureId = id;
        
        this.callbacks.doubleTap.set(id, { callback, element });
        return id;
    }
    
    onLongPress(element, callback) {
        const id = this.generateId();
        element.classList.add('long-pressable', 'gesture-area');
        element.dataset.gestureId = id;
        
        this.callbacks.longPress.set(id, { callback, element });
        return id;
    }
    
    onDrag(element, callback) {
        const id = this.generateId();
        element.classList.add('draggable', 'gesture-area');
        element.dataset.gestureId = id;
        
        this.callbacks.drag.set(id, { callback, element });
        return id;
    }
    
    onPullToRefresh(element, callback) {
        const id = this.generateId();
        element.classList.add('pull-to-refresh', 'gesture-area');
        element.dataset.gestureId = id;
        
        // Add refresh indicator
        const indicator = document.createElement('div');
        indicator.className = 'pull-to-refresh-indicator';
        indicator.innerHTML = '↻';
        element.appendChild(indicator);
        
        this.callbacks.pullToRefresh.set(id, { callback, element, indicator });
        return id;
    }
    
    // Touch event handlers
    handleTouchStart(event) {
        const touch = event.touches[0];
        const element = event.target.closest('[data-gesture-id]');
        
        if (!element) return;
        
        const gestureId = element.dataset.gestureId;
        const gesture = {
            id: gestureId,
            element,
            startTime: Date.now(),
            startX: touch.clientX,
            startY: touch.clientY,
            currentX: touch.clientX,
            currentY: touch.clientY,
            deltaX: 0,
            deltaY: 0,
            moved: false,
            longPressTimer: null,
            tapCount: 0
        };
        
        this.activeGestures.set(gestureId, gesture);
        
        // Start long press timer
        if (this.callbacks.longPress.has(gestureId)) {
            element.classList.add('pressing');
            gesture.longPressTimer = setTimeout(() => {
                this.triggerLongPress(gesture);
            }, this.config.longPressDelay);
        }
        
        // Handle pull to refresh
        if (this.callbacks.pullToRefresh.has(gestureId)) {
            const scrollTop = element.scrollTop;
            if (scrollTop === 0) {
                gesture.canPullToRefresh = true;
            }
        }
    }
    
    handleTouchMove(event) {
        const touch = event.touches[0];
        
        for (const [gestureId, gesture] of this.activeGestures.entries()) {
            if (!gesture.element.contains(event.target)) continue;
            
            const deltaX = touch.clientX - gesture.startX;
            const deltaY = touch.clientY - gesture.startY;
            
            gesture.currentX = touch.clientX;
            gesture.currentY = touch.clientY;
            gesture.deltaX = deltaX;
            gesture.deltaY = deltaY;
            
            if (!gesture.moved && (Math.abs(deltaX) > 5 || Math.abs(deltaY) > 5)) {
                gesture.moved = true;
                
                // Cancel long press if moved
                if (gesture.longPressTimer) {
                    clearTimeout(gesture.longPressTimer);
                    gesture.element.classList.remove('pressing');
                }
            }
            
            // Handle swipe feedback
            if (this.callbacks.swipe.has(gestureId) && gesture.moved) {
                gesture.element.classList.add('swiping');
                this.handleSwipeProgress(gesture);
            }
            
            // Handle drag
            if (this.callbacks.drag.has(gestureId) && gesture.moved) {
                gesture.element.classList.add('dragging');
                this.triggerDrag(gesture, 'move');
                event.preventDefault();
            }
            
            // Handle pull to refresh
            if (this.callbacks.pullToRefresh.has(gestureId) && gesture.canPullToRefresh && deltaY > 0) {
                const pullDistance = Math.min(deltaY, 100);
                gesture.element.style.transform = `translateY(${pullDistance * 0.5}px)`;
                
                if (pullDistance > 60) {
                    gesture.element.classList.add('pulling');
                }
                
                event.preventDefault();
            }
        }
    }
    
    handleTouchEnd(event) {
        for (const [gestureId, gesture] of this.activeGestures.entries()) {
            // Clean up long press
            if (gesture.longPressTimer) {
                clearTimeout(gesture.longPressTimer);
                gesture.element.classList.remove('pressing');
            }
            
            // Clean up visual feedback
            gesture.element.classList.remove('swiping', 'dragging');
            
            // Handle swipe
            if (this.callbacks.swipe.has(gestureId) && gesture.moved) {
                this.checkSwipe(gesture);
            }
            
            // Handle tap
            if (this.callbacks.tap.has(gestureId) && !gesture.moved) {
                this.triggerTap(gesture);
            }
            
            // Handle double tap
            if (this.callbacks.doubleTap.has(gestureId) && !gesture.moved) {
                this.checkDoubleTap(gesture);
            }
            
            // Handle drag end
            if (this.callbacks.drag.has(gestureId) && gesture.moved) {
                this.triggerDrag(gesture, 'end');
            }
            
            // Handle pull to refresh
            if (this.callbacks.pullToRefresh.has(gestureId) && gesture.canPullToRefresh) {
                this.checkPullToRefresh(gesture);
            }
            
            this.activeGestures.delete(gestureId);
        }
    }
    
    handleTouchCancel(event) {
        for (const [gestureId, gesture] of this.activeGestures.entries()) {
            if (gesture.longPressTimer) {
                clearTimeout(gesture.longPressTimer);
                gesture.element.classList.remove('pressing');
            }
            
            gesture.element.classList.remove('swiping', 'dragging', 'pulling');
            gesture.element.style.transform = '';
        }
        
        this.activeGestures.clear();
    }
    
    // Gesture trigger methods
    checkSwipe(gesture) {
        const { deltaX, deltaY } = gesture;
        const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
        
        if (distance < this.config.swipeThreshold) return;
        
        const callback = this.callbacks.swipe.get(gesture.id);
        if (!callback) return;
        
        let direction;
        if (Math.abs(deltaX) > Math.abs(deltaY)) {
            direction = deltaX > 0 ? 'right' : 'left';
        } else {
            direction = deltaY > 0 ? 'down' : 'up';
        }
        
        if (callback.direction === 'all' || callback.direction === direction) {
            this.triggerHapticFeedback(gesture.element);
            callback.callback({
                direction,
                distance,
                deltaX,
                deltaY,
                element: gesture.element
            });
        }
    }
    
    triggerTap(gesture) {
        const callback = this.callbacks.tap.get(gesture.id);
        if (callback) {
            this.triggerHapticFeedback(gesture.element);
            callback.callback({
                x: gesture.startX,
                y: gesture.startY,
                element: gesture.element
            });
        }
    }
    
    checkDoubleTap(gesture) {
        const callback = this.callbacks.doubleTap.get(gesture.id);
        if (!callback) return;
        
        const now = Date.now();
        const lastTap = gesture.element.dataset.lastTap;
        
        if (lastTap && now - parseInt(lastTap) < this.config.doubleTapDelay) {
            this.triggerHapticFeedback(gesture.element);
            callback.callback({
                x: gesture.startX,
                y: gesture.startY,
                element: gesture.element
            });
            gesture.element.dataset.lastTap = '';
        } else {
            gesture.element.dataset.lastTap = now.toString();
        }
    }
    
    triggerLongPress(gesture) {
        const callback = this.callbacks.longPress.get(gesture.id);
        if (callback) {
            this.triggerHapticFeedback(gesture.element);
            callback.callback({
                x: gesture.startX,
                y: gesture.startY,
                element: gesture.element
            });
        }
        gesture.element.classList.remove('pressing');
    }
    
    triggerDrag(gesture, phase) {
        const callback = this.callbacks.drag.get(gesture.id);
        if (callback) {
            callback.callback({
                phase, // 'start', 'move', 'end'
                deltaX: gesture.deltaX,
                deltaY: gesture.deltaY,
                startX: gesture.startX,
                startY: gesture.startY,
                currentX: gesture.currentX,
                currentY: gesture.currentY,
                element: gesture.element
            });
        }
    }
    
    checkPullToRefresh(gesture) {
        const callback = this.callbacks.pullToRefresh.get(gesture.id);
        if (!callback) return;
        
        const isPulling = gesture.element.classList.contains('pulling');
        
        // Reset transform
        gesture.element.style.transform = '';
        gesture.element.classList.remove('pulling');
        
        if (isPulling && gesture.deltaY > 60) {
            this.triggerHapticFeedback(gesture.element);
            
            // Show loading indicator
            const indicator = callback.indicator;
            indicator.innerHTML = '⟳';
            indicator.style.animation = 'spin 1s linear infinite';
            
            callback.callback({
                element: gesture.element,
                complete: () => {
                    indicator.innerHTML = '↻';
                    indicator.style.animation = '';
                }
            });
        }
    }
    
    handleSwipeProgress(gesture) {
        const progress = Math.min(Math.abs(gesture.deltaX) / this.config.swipeThreshold, 1);
        gesture.element.style.setProperty('--swipe-progress', progress);
    }
    
    // Haptic feedback simulation
    triggerHapticFeedback(element) {
        if ('vibrate' in navigator) {
            navigator.vibrate(10);
        }
        
        element.classList.add('haptic-feedback');
        setTimeout(() => element.classList.remove('haptic-feedback'), 100);
    }
    
    // Utility methods
    generateId() {
        return `gesture_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    
    removeGesture(id) {
        this.callbacks.swipe.delete(id);
        this.callbacks.tap.delete(id);
        this.callbacks.doubleTap.delete(id);
        this.callbacks.longPress.delete(id);
        this.callbacks.drag.delete(id);
        this.callbacks.pullToRefresh.delete(id);
    }
    
    // Queue-specific gestures
    initQueueGestures(queueContainer) {
        // Swipe to remove tracks
        this.onSwipe(queueContainer, (gesture) => {
            const trackElement = gesture.element.closest('.queue-item-mobile');
            if (trackElement && gesture.direction === 'left') {
                this.animateTrackRemoval(trackElement);
            }
        }, 'left');
        
        // Long press for track options
        this.onLongPress(queueContainer, (gesture) => {
            const trackElement = gesture.element.closest('.queue-item-mobile');
            if (trackElement) {
                this.showTrackContextMenu(trackElement, gesture.x, gesture.y);
            }
        });
        
        // Drag to reorder
        this.onDrag(queueContainer, (gesture) => {
            const trackElement = gesture.element.closest('.queue-item-mobile');
            if (trackElement && gesture.phase === 'move') {
                this.handleTrackReorder(trackElement, gesture);
            }
        });
        
        // Pull to refresh queue
        this.onPullToRefresh(queueContainer, (gesture) => {
            // Refresh queue or fetch recommendations
            this.refreshQueue(gesture.complete);
        });
    }
    
    // Music player gestures
    initPlayerGestures(playerContainer) {
        // Swipe for next/previous track
        this.onSwipe(playerContainer, (gesture) => {
            if (gesture.direction === 'left') {
                this.triggerPlayerAction('next');
            } else if (gesture.direction === 'right') {
                this.triggerPlayerAction('previous');
            }
        }, 'horizontal');
        
        // Double tap to favorite
        this.onDoubleTap(playerContainer, () => {
            this.triggerPlayerAction('favorite');
        });
        
        // Long press for player options
        this.onLongPress(playerContainer, (gesture) => {
            this.showPlayerContextMenu(gesture.x, gesture.y);
        });
    }
    
    // Search gestures
    initSearchGestures(searchContainer) {
        // Pull to refresh search results
        this.onPullToRefresh(searchContainer, (gesture) => {
            this.refreshSearchResults(gesture.complete);
        });
        
        // Swipe search results for quick actions
        this.onSwipe(searchContainer, (gesture) => {
            const resultElement = gesture.element.closest('.search-result-item');
            if (resultElement) {
                if (gesture.direction === 'right') {
                    this.quickAddToQueue(resultElement);
                } else if (gesture.direction === 'left') {
                    this.showSearchResultOptions(resultElement);
                }
            }
        });
    }
    
    // Animation helpers
    animateTrackRemoval(trackElement) {
        trackElement.style.transform = 'translateX(-100%)';
        trackElement.style.opacity = '0';
        
        setTimeout(() => {
            trackElement.remove();
            // Trigger queue update event
            window.dispatchEvent(new CustomEvent('track-removed', {
                detail: { trackId: trackElement.dataset.trackId }
            }));
        }, 300);
    }
    
    handleTrackReorder(trackElement, gesture) {
        const container = trackElement.parentElement;
        const rect = container.getBoundingClientRect();
        const y = gesture.currentY - rect.top;
        
        const targetElement = this.getElementAtPosition(container, y);
        if (targetElement && targetElement !== trackElement) {
            const targetRect = targetElement.getBoundingClientRect();
            const containerRect = container.getBoundingClientRect();
            
            if (y < targetRect.top - containerRect.top + targetRect.height / 2) {
                container.insertBefore(trackElement, targetElement);
            } else {
                container.insertBefore(trackElement, targetElement.nextSibling);
            }
            
            // Trigger reorder event
            window.dispatchEvent(new CustomEvent('track-reordered', {
                detail: {
                    trackId: trackElement.dataset.trackId,
                    newPosition: Array.from(container.children).indexOf(trackElement)
                }
            }));
        }
    }
    
    getElementAtPosition(container, y) {
        const children = Array.from(container.children);
        return children.find(child => {
            const rect = child.getBoundingClientRect();
            const containerRect = container.getBoundingClientRect();
            const childY = rect.top - containerRect.top;
            return y >= childY && y <= childY + rect.height;
        });
    }
    
    // Context menu helpers
    showTrackContextMenu(trackElement, x, y) {
        // Implementation would show a context menu
        console.log('Show track context menu', trackElement, x, y);
    }
    
    showPlayerContextMenu(x, y) {
        // Implementation would show player context menu
        console.log('Show player context menu', x, y);
    }
    
    showSearchResultOptions(resultElement) {
        // Implementation would show search result options
        console.log('Show search result options', resultElement);
    }
    
    // Action helpers
    triggerPlayerAction(action) {
        window.dispatchEvent(new CustomEvent('player-action', {
            detail: { action }
        }));
    }
    
    refreshQueue(complete) {
        // Implementation would refresh the queue
        setTimeout(() => {
            complete();
        }, 1000);
    }
    
    refreshSearchResults(complete) {
        // Implementation would refresh search results
        setTimeout(() => {
            complete();
        }, 1000);
    }
    
    quickAddToQueue(resultElement) {
        window.dispatchEvent(new CustomEvent('quick-add-to-queue', {
            detail: { resultElement }
        }));
    }
    
    // Cleanup
    destroy() {
        this.activeGestures.clear();
        this.callbacks.swipe.clear();
        this.callbacks.tap.clear();
        this.callbacks.doubleTap.clear();
        this.callbacks.longPress.clear();
        this.callbacks.drag.clear();
        this.callbacks.pullToRefresh.clear();
    }
}

// Auto-initialize if in browser environment
if (typeof window !== 'undefined') {
    window.MobileGestureHandler = MobileGestureHandler;
    
    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            window.gestureHandler = new MobileGestureHandler();
        });
    } else {
        window.gestureHandler = new MobileGestureHandler();
    }
}

module.exports = MobileGestureHandler;