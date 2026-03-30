import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { PlatformConfig } from '@/lib/sealProtocol';

type ProtocolRecord = {
    id: string;
    type: 'WinnerCertificate' | 'WinnerEscrowClaimed' | 'AuctionImported' | 'InvoiceReceipt';
    rfqId: string;
    owner: string;
    payload: Record<string, unknown>;
    createdAt: string;
};

type ProtocolState = {
    tokenType: number;
    pricingMode: number;
    escrowToken: number;
    paid: boolean;
    feeBps: number;
    platformConfig: PlatformConfig | null;
    auctionSource: string | null;
    winnerCertificate: Record<string, unknown> | null;
    rfqSalts: Record<string, string>;
    auctionSalts: Record<string, string>;
    records: ProtocolRecord[];
    setWorkflow: (values: Partial<Pick<ProtocolState, 'tokenType' | 'pricingMode' | 'escrowToken' | 'paid' | 'feeBps' | 'auctionSource' | 'winnerCertificate'>>) => void;
    setPlatformConfig: (config: PlatformConfig | null) => void;
    saveRfqSalt: (rfqId: string, salt: string) => void;
    saveAuctionSalt: (auctionId: string, salt: string) => void;
    addRecord: (record: ProtocolRecord) => void;
    resetProtocol: () => void;
};

const initialState = {
    tokenType: 0,
    pricingMode: 0,
    escrowToken: 0,
    paid: false,
    feeBps: 0,
    platformConfig: null,
    auctionSource: null,
    winnerCertificate: null,
    rfqSalts: {},
    auctionSalts: {},
    records: [],
};

export const useProtocolStore = create<ProtocolState>()(
    persist(
        (set) => ({
            ...initialState,
            setWorkflow: (values) => set((state) => ({ ...state, ...values })),
            setPlatformConfig: (platformConfig) => set({ platformConfig, feeBps: platformConfig?.feeBps ?? 0 }),
            saveRfqSalt: (rfqId, salt) =>
                set((state) => ({
                    rfqSalts: {
                        ...state.rfqSalts,
                        [rfqId]: salt,
                    },
                })),
            saveAuctionSalt: (auctionId, salt) =>
                set((state) => ({
                    auctionSalts: {
                        ...state.auctionSalts,
                        [auctionId]: salt,
                    },
                })),
            addRecord: (record) =>
                set((state) => ({
                    records: [record, ...state.records.filter((current) => current.id !== record.id)],
                })),
            resetProtocol: () => set(initialState),
        }),
        {
            name: 'sealrfq-protocol',
            partialize: (state) => ({
                tokenType: state.tokenType,
                pricingMode: state.pricingMode,
                escrowToken: state.escrowToken,
                paid: state.paid,
                feeBps: state.feeBps,
                auctionSource: state.auctionSource,
                winnerCertificate: state.winnerCertificate,
                rfqSalts: state.rfqSalts,
                auctionSalts: state.auctionSalts,
                records: state.records,
            }),
        },
    ),
);
