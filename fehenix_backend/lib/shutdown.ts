/**
 * Graceful shutdown registry.
 *
 * Background jobs (reconciliation, cleanup intervals, Redis, DB) register
 * their stop functions here. On SIGTERM or SIGINT the process drains all
 * registered handlers before exiting.
 *
 * Usage:
 *   import { registerShutdownHandler } from '@/lib/shutdown';
 *   registerShutdownHandler('reconciliation', () => scheduler.stop());
 */

type ShutdownHandler = () => void | Promise<void>;

const handlers = new Map<string, ShutdownHandler>();
let shutdownRegistered = false;

export function registerShutdownHandler(name: string, fn: ShutdownHandler): void {
    handlers.set(name, fn);
    if (!shutdownRegistered) {
        shutdownRegistered = true;
        setupSignalHandlers();
    }
}

export function deregisterShutdownHandler(name: string): void {
    handlers.delete(name);
}

async function runShutdown(signal: string): Promise<void> {
    console.log(`[Shutdown] Received ${signal}. Stopping ${handlers.size} background job(s)...`);

    await Promise.allSettled(
        Array.from(handlers.entries()).map(async ([name, fn]) => {
            try {
                await fn();
                console.log(`[Shutdown] ✓ ${name} stopped`);
            } catch (err) {
                console.error(`[Shutdown] ✗ ${name} failed to stop:`, err);
            }
        })
    );

    console.log('[Shutdown] All handlers complete. Exiting.');
    process.exit(0);
}

function setupSignalHandlers(): void {
    process.once('SIGTERM', () => runShutdown('SIGTERM'));
    process.once('SIGINT',  () => runShutdown('SIGINT'));
}
