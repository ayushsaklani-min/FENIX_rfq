export const TxStatus = {
    PREPARED: 'PREPARED',
    SUBMITTED: 'SUBMITTED',
    CONFIRMED: 'CONFIRMED',
    REJECTED: 'REJECTED',
    EXPIRED: 'EXPIRED',
} as const;
export type TxStatus = typeof TxStatus[keyof typeof TxStatus];

export const RFQStatus = {
    NONE: 'NONE',
    OPEN: 'OPEN',
    REVEAL: 'REVEAL',
    WINNER_SELECTED: 'WINNER_SELECTED',
    ESCROW_FUNDED: 'ESCROW_FUNDED',
    COMPLETED: 'COMPLETED',
    CANCELLED: 'CANCELLED',
    WINNER_DECLINED: 'WINNER_DECLINED',
} as const;
export type RFQStatus = typeof RFQStatus[keyof typeof RFQStatus];

export const EventType = {
    RFQ_CREATED: 'RFQ_CREATED',
    BID_COMMITTED: 'BID_COMMITTED',
    BID_REVEALED: 'BID_REVEALED',
    WINNER_SELECTED: 'WINNER_SELECTED',
    WINNER_RESPONDED: 'WINNER_RESPONDED',
    STAKE_SLASHED: 'STAKE_SLASHED',
    STAKE_REFUNDED: 'STAKE_REFUNDED',
    ESCROW_FUNDED: 'ESCROW_FUNDED',
    PAYMENT_RELEASED: 'PAYMENT_RELEASED',
    INVOICE_PAID: 'INVOICE_PAID',
    AUCTION_IMPORTED: 'AUCTION_IMPORTED',
    PLATFORM_CONFIGURED: 'PLATFORM_CONFIGURED',
} as const;
export type EventType = typeof EventType[keyof typeof EventType];

export const ErrorClass = {
    TRANSIENT: 'TRANSIENT',
    LOGICAL: 'LOGICAL',
    NETWORK: 'NETWORK',
    UNKNOWN: 'UNKNOWN',
} as const;
export type ErrorClass = typeof ErrorClass[keyof typeof ErrorClass];
