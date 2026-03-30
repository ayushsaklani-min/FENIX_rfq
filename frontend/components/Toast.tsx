'use client';

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { X, CheckCircle, AlertTriangle, Info, XCircle } from 'lucide-react';

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface Toast {
    id: string;
    type: ToastType;
    message: string;
    dismissing?: boolean;
}

interface ToastContextType {
    toast: (type: ToastType, message: string) => void;
    success: (message: string) => void;
    error: (message: string) => void;
    warning: (message: string) => void;
    info: (message: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export function useToast() {
    const context = useContext(ToastContext);
    if (!context) throw new Error('useToast must be used within ToastProvider');
    return context;
}

export function ToastProvider({ children }: { children: ReactNode }) {
    const [toasts, setToasts] = useState<Toast[]>([]);

    const dismiss = useCallback((id: string) => {
        setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, dismissing: true } : t)));
        setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 300);
    }, []);

    const addToast = useCallback((type: ToastType, message: string) => {
        const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        setToasts((prev) => [...prev.slice(-4), { id, type, message }]);
        setTimeout(() => dismiss(id), 5000);
    }, [dismiss]);

    const value: ToastContextType = {
        toast: addToast,
        success: (msg) => addToast('success', msg),
        error: (msg) => addToast('error', msg),
        warning: (msg) => addToast('warning', msg),
        info: (msg) => addToast('info', msg),
    };

    return (
        <ToastContext.Provider value={value}>
            {children}
            <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 w-full max-w-sm pointer-events-none">
                {toasts.map((t) => (
                    <ToastItem key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
                ))}
            </div>
        </ToastContext.Provider>
    );
}

const icons = {
    success: CheckCircle,
    error: XCircle,
    warning: AlertTriangle,
    info: Info,
};

const styles = {
    success: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100',
    error: 'border-red-500/30 bg-red-500/10 text-red-100',
    warning: 'border-amber-500/30 bg-amber-500/10 text-amber-100',
    info: 'border-blue-500/30 bg-blue-500/10 text-blue-100',
};

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
    const Icon = icons[toast.type];
    return (
        <div
            className={`pointer-events-auto flex items-start gap-3 rounded-xl border px-4 py-3 shadow-lg backdrop-blur-sm ${styles[toast.type]} ${toast.dismissing ? 'animate-toast-out' : 'animate-toast-in'}`}
        >
            <Icon className="h-5 w-5 shrink-0 mt-0.5" />
            <p className="flex-1 text-sm">{toast.message}</p>
            <button onClick={onDismiss} className="shrink-0 opacity-60 hover:opacity-100 transition-opacity">
                <X className="h-4 w-4" />
            </button>
        </div>
    );
}
