"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import { useAccount, useConnect, useDisconnect, usePublicClient, useSignMessage, useWalletClient } from "wagmi";
import { safeGetItem, safeSetItem, safeRemoveItem } from "@/lib/safeLocalStorage";
import { authenticatedFetch, getAccessToken, setAccessToken, clearAccessToken } from "@/lib/authFetch";
import { disconnectCofhe, initCofheClient } from "@/lib/cofheClient";

export interface WalletConnectionError {
    type: 'NOT_INSTALLED' | 'LOCKED' | 'REJECTED' | 'UNKNOWN';
    title: string;
    hint: string;
}

interface WalletContextType {
    ready: boolean;
    sessionHydrating: boolean;
    walletAddress: string | null;
    role: string | null;
    connecting: boolean;
    switchingRole: boolean;
    connectionError: WalletConnectionError | null;
    connectWallet: () => Promise<boolean>;
    disconnectWallet: () => void;
    switchRole: (nextRole: string) => Promise<boolean>;
    clearConnectionError: () => void;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

export function WalletProvider({ children }: { children: React.ReactNode }) {
    const [ready, setReady] = useState(false);
    const [sessionHydrating, setSessionHydrating] = useState(false);
    const [role, setRole] = useState<string | null>(null);
    const [connecting, setConnecting] = useState(false);
    const [switchingRole, setSwitchingRole] = useState(false);
    const [connectionError, setConnectionError] = useState<WalletConnectionError | null>(null);

    // wagmi hooks
    const { address, isConnected } = useAccount();
    const { connectAsync, connectors } = useConnect();
    const { disconnect } = useDisconnect();
    const { signMessageAsync } = useSignMessage();
    const publicClient = usePublicClient();
    const { data: walletClient } = useWalletClient();

    const walletAddress = isConnected && address ? address : null;

    const clearSessionState = () => {
        clearAccessToken();
        safeRemoveItem("role");
        setRole(null);
    };

    useEffect(() => {
        const storedRole = safeGetItem("role");
        if (storedRole) setRole(storedRole);
        setReady(true);
    }, []);

    // Sync wallet address to localStorage when it changes
    useEffect(() => {
        if (walletAddress) {
            safeSetItem("walletAddress", walletAddress);
        } else {
            safeRemoveItem("walletAddress");
            clearSessionState();
            setSessionHydrating(false);
        }
    }, [walletAddress]);

    useEffect(() => {
        let cancelled = false;

        if (!ready || !walletAddress) {
            return () => {
                cancelled = true;
            };
        }

        setSessionHydrating(true);

        const syncSession = async () => {
            try {
                const response = await fetch("/api/auth/me", {
                    cache: "no-store",
                    headers: getAccessToken()
                        ? {
                              Authorization: `Bearer ${getAccessToken()}`,
                          }
                        : undefined,
                    credentials: "same-origin",
                });

                const payload = response.ok ? await response.json().catch(() => null) : null;
                const sessionWallet = payload?.data?.walletAddress?.toLowerCase?.() ?? null;

                if (cancelled) {
                    return;
                }

                if (sessionWallet === walletAddress.toLowerCase()) {
                    safeSetItem("role", payload.data.role);
                    setRole(payload.data.role);
                    return;
                }

                clearSessionState();
                await authenticateWalletSession(walletAddress);
            } catch {
                if (!cancelled) {
                    clearSessionState();
                }
            } finally {
                if (!cancelled) {
                    setSessionHydrating(false);
                }
            }
        };

        syncSession();

        return () => {
            cancelled = true;
        };
    }, [ready, walletAddress]);

    useEffect(() => {
        const w = window as any;
        if (walletClient) {
            w.__wagmiWalletClient = walletClient;
        } else {
            delete w.__wagmiWalletClient;
        }
        if (publicClient) {
            w.__wagmiPublicClient = publicClient;
        } else {
            delete w.__wagmiPublicClient;
        }
    }, [publicClient, walletClient]);

    useEffect(() => {
        if (!isConnected || !walletClient || !publicClient) {
            disconnectCofhe();
            return;
        }

        initCofheClient(publicClient as any, walletClient as any).catch((error) => {
            console.error('[wallet] CoFHE init failed', error);
        });
    }, [isConnected, publicClient, walletClient]);

    const clearConnectionError = () => setConnectionError(null);

    const authenticateWalletSession = async (walletAddr: string) => {
        const challengeRes = await fetch("/api/auth/challenge", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ walletAddress: walletAddr }),
            credentials: "same-origin",
        });

        const challengeData = await challengeRes.json();
        if (!challengeRes.ok || challengeData.status !== "success") {
            throw new Error(challengeData?.error?.message || "Failed to create auth challenge");
        }

        const nonce = challengeData.data.nonce as string;
        const message =
            (challengeData.data.message as string | undefined) ||
            `Sign this nonce to authenticate: ${nonce}`;

        const signature = await signMessageAsync({
            message,
            account: walletAddr,
        });

        const connectRes = await fetch("/api/auth/connect", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                walletAddress: walletAddr,
                nonce,
                signature,
            }),
            credentials: "same-origin",
        });

        const connectData = await connectRes.json();
        if (!connectRes.ok || connectData.status !== "success") {
            throw new Error(connectData?.error?.message || "Failed to connect wallet");
        }

        setAccessToken(connectData.data.accessToken ?? null);
        safeSetItem("role", connectData.data.role);
        setRole(connectData.data.role);

        return connectData.data;
    };

    const connectWallet = async () => {
        if (connecting) return false;
        setConnecting(true);
        setConnectionError(null);

        try {
            // Resolve the wallet address — connect MetaMask first if needed
            let walletAddr = address;
            if (!isConnected) {
                const injectedConnector =
                    connectors.find((connector) => connector.type === 'injected') || connectors[0];
                if (!injectedConnector) {
                    throw new Error('No wallet connector available');
                }
                const result = await connectAsync({ connector: injectedConnector });
                walletAddr = result.accounts[0];
            }

            if (!walletAddr) {
                throw new Error('Wallet not connected');
            }

            await authenticateWalletSession(walletAddr);
            return true;
        } catch (error: any) {
            console.error(error);
            const message = error?.message || '';

            if (message.includes('rejected') || message.includes('denied') || message.includes('cancel')) {
                setConnectionError({
                    type: 'REJECTED',
                    title: 'Connection cancelled',
                    hint: 'You cancelled the signature request. Click "Connect" again and approve the request.',
                });
            } else {
                setConnectionError({
                    type: 'UNKNOWN',
                    title: 'Connection failed',
                    hint: message || 'Make sure your wallet is unlocked and try again.',
                });
            }
            return false;
        } finally {
            setConnecting(false);
        }
    };

    const disconnectWallet = () => {
        fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
        safeRemoveItem("walletAddress");
        clearSessionState();
        disconnectCofhe();
        disconnect();
    };

    const switchRole = async (nextRole: string) => {
        if (!walletAddress || !nextRole || nextRole === role || switchingRole) return false;
        setSwitchingRole(true);
        try {
            let res = await authenticatedFetch("/api/auth/dev/switch-role", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ role: nextRole }),
            });

            if (res.status === 401) {
                await authenticateWalletSession(walletAddress);
                res = await authenticatedFetch("/api/auth/dev/switch-role", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ role: nextRole }),
                });
            }

            const json = await res.json();
            if (!res.ok || json.status !== "success") {
                throw new Error(json?.error?.message || "Failed to switch role");
            }

            setAccessToken(json.data.accessToken ?? null);
            safeSetItem("role", json.data.role);
            setRole(json.data.role);
            return true;
        } catch (error: any) {
            console.error(error);
            return false;
        } finally {
            setSwitchingRole(false);
        }
    };

    return (
        <WalletContext.Provider
            value={{
                ready,
                sessionHydrating,
                walletAddress,
                role,
                connecting,
                switchingRole,
                connectionError,
                connectWallet,
                disconnectWallet,
                switchRole,
                clearConnectionError,
            }}
        >
            {children}
        </WalletContext.Provider>
    );
}

export function useWallet() {
    const context = useContext(WalletContext);
    if (context === undefined) {
        throw new Error("useWallet must be used within a WalletProvider");
    }
    return context;
}
