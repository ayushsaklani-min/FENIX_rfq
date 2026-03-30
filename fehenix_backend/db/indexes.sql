-- Database Index Optimization
-- Gate 1: Performance Pass - Critical Query Indexes

-- Transaction status lookup (high frequency)
CREATE INDEX IF NOT EXISTS idx_tx_idempotency_key 
  ON transactions(idempotency_key);

CREATE INDEX IF NOT EXISTS idx_tx_canonical_key 
  ON transactions(canonical_key);

CREATE INDEX IF NOT EXISTS idx_tx_status 
  ON transactions(status);

-- Audit trail queries (high volume, read-heavy)
CREATE INDEX IF NOT EXISTS idx_rfq_event_rfq_block 
  ON rfq_events(rfq_id, block_height DESC);

CREATE INDEX IF NOT EXISTS idx_rfq_event_actor 
  ON rfq_events(actor);

CREATE INDEX IF NOT EXISTS idx_rfq_event_type 
  ON rfq_events(event_type);

CREATE INDEX IF NOT EXISTS idx_rfq_event_timestamp 
  ON rfq_events(timestamp DESC);

-- Bid queries (vendor dashboard)
CREATE INDEX IF NOT EXISTS idx_bid_vendor 
  ON bids(vendor);

CREATE INDEX IF NOT EXISTS idx_bid_rfq 
  ON bids(rfq_id);

CREATE INDEX IF NOT EXISTS idx_bid_revealed 
  ON bids(is_revealed);

-- Escrow queries
CREATE INDEX IF NOT EXISTS idx_escrow_rfq 
  ON escrows(rfq_id);

-- RFQ queries
CREATE INDEX IF NOT EXISTS idx_rfq_buyer 
  ON rfqs(buyer);

CREATE INDEX IF NOT EXISTS idx_rfq_status 
  ON rfqs(status);

-- Payment queries
CREATE INDEX IF NOT EXISTS idx_payment_escrow 
  ON payments(escrow_id);

CREATE INDEX IF NOT EXISTS idx_payment_timestamp 
  ON payments(timestamp DESC);

-- Auth session queries
CREATE INDEX IF NOT EXISTS idx_auth_session_wallet 
  ON auth_sessions(wallet_address);

CREATE INDEX IF NOT EXISTS idx_auth_session_revoked 
  ON auth_sessions(is_revoked) 
  WHERE is_revoked = false;

-- Composite indexes for complex queries
CREATE INDEX IF NOT EXISTS idx_tx_user_status 
  ON transactions(user_id, status);

CREATE INDEX IF NOT EXISTS idx_rfq_buyer_status 
  ON rfqs(buyer, status);

CREATE INDEX IF NOT EXISTS idx_bid_vendor_rfq 
  ON bids(vendor, rfq_id);

-- Performance analysis
-- Run EXPLAIN ANALYZE on critical queries to validate index usage
-- Expected result: Index Scan instead of Seq Scan on all queries

ANALYZE transactions;
ANALYZE rfq_events;
ANALYZE bids;
ANALYZE rfqs;
ANALYZE escrows;
ANALYZE payments;
ANALYZE auth_sessions;
