/**
 * Safe localStorage utilities for SSR compatibility
 * 
 * These functions can be safely called during server-side rendering
 * and will return default values instead of throwing errors.
 */

/**
 * Check if localStorage is available (client-side only)
 */
export function isLocalStorageAvailable(): boolean {
    try {
        return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
    } catch {
        return false;
    }
}

/**
 * Safely get an item from localStorage
 * Returns null if localStorage is not available or key doesn't exist
 */
export function safeGetItem(key: string): string | null {
    if (!isLocalStorageAvailable()) {
        return null;
    }
    
    try {
        return window.localStorage.getItem(key);
    } catch (error) {
        console.warn(`Failed to get localStorage item "${key}":`, error);
        return null;
    }
}

/**
 * Safely set an item in localStorage
 * Does nothing if localStorage is not available
 */
export function safeSetItem(key: string, value: string): boolean {
    if (!isLocalStorageAvailable()) {
        return false;
    }
    
    try {
        window.localStorage.setItem(key, value);
        return true;
    } catch (error) {
        console.warn(`Failed to set localStorage item "${key}":`, error);
        return false;
    }
}

/**
 * Safely remove an item from localStorage
 * Does nothing if localStorage is not available
 */
export function safeRemoveItem(key: string): boolean {
    if (!isLocalStorageAvailable()) {
        return false;
    }
    
    try {
        window.localStorage.removeItem(key);
        return true;
    } catch (error) {
        console.warn(`Failed to remove localStorage item "${key}":`, error);
        return false;
    }
}

/**
 * Safely clear all localStorage
 * Does nothing if localStorage is not available
 */
export function safeClear(): boolean {
    if (!isLocalStorageAvailable()) {
        return false;
    }
    
    try {
        window.localStorage.clear();
        return true;
    } catch (error) {
        console.warn('Failed to clear localStorage:', error);
        return false;
    }
}
