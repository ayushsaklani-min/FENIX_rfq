/**
 * Safe sessionStorage utilities for SSR compatibility.
 */

export function isSessionStorageAvailable(): boolean {
    try {
        return typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined';
    } catch {
        return false;
    }
}

export function safeGetSessionItem(key: string): string | null {
    if (!isSessionStorageAvailable()) {
        return null;
    }

    try {
        return window.sessionStorage.getItem(key);
    } catch (error) {
        console.warn(`Failed to get sessionStorage item "${key}":`, error);
        return null;
    }
}

export function safeSetSessionItem(key: string, value: string): boolean {
    if (!isSessionStorageAvailable()) {
        return false;
    }

    try {
        window.sessionStorage.setItem(key, value);
        return true;
    } catch (error) {
        console.warn(`Failed to set sessionStorage item "${key}":`, error);
        return false;
    }
}

export function safeRemoveSessionItem(key: string): boolean {
    if (!isSessionStorageAvailable()) {
        return false;
    }

    try {
        window.sessionStorage.removeItem(key);
        return true;
    } catch (error) {
        console.warn(`Failed to remove sessionStorage item "${key}":`, error);
        return false;
    }
}
