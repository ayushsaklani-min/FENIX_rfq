'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider, createConfig, http } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { defineChain, fallback } from 'viem';

const appRpcUrls = Array.from(
    new Set(
        [
            process.env.NEXT_PUBLIC_FHENIX_RPC_URL,
            process.env.NEXT_PUBLIC_FHENIX_RPC_FALLBACK_URL,
            'https://ethereum-sepolia-rpc.publicnode.com',
        ].filter((value): value is string => Boolean(value && value.trim())),
    ),
);

const appChain = defineChain({
    id: Number(process.env.NEXT_PUBLIC_FHENIX_CHAIN_ID) || 11155111,
    name: 'Ethereum Sepolia',
    nativeCurrency: {
        decimals: 18,
        name: 'Sepolia Ether',
        symbol: 'ETH',
    },
    rpcUrls: {
        default: {
            http: [
                ...appRpcUrls,
            ],
        },
    },
    blockExplorers: {
        default: {
            name: 'Etherscan',
            url: process.env.NEXT_PUBLIC_FHENIX_EXPLORER_URL || 'https://sepolia.etherscan.io',
        },
    },
    testnet: true,
});

const config = createConfig({
    chains: [appChain],
    connectors: [injected()],
    transports: {
        [appChain.id]: fallback(
            appRpcUrls.map((url) =>
                http(url, {
                    retryCount: 1,
                    retryDelay: 250,
                }),
            ),
        ),
    },
});

const queryClient = new QueryClient();

export function FhenixWalletProvider({ children }: { children: React.ReactNode }) {
    return (
        <WagmiProvider config={config}>
            <QueryClientProvider client={queryClient}>
                {children}
            </QueryClientProvider>
        </WagmiProvider>
    );
}

export { appChain, config as wagmiConfig };
