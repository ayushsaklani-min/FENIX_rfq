# SEALrfq - Privacy-Preserving Procurement Protocol

<p align="center">
  <img src="https://img.shields.io/badge/Blockchain-Ethereum-blue" alt="Ethereum">
  <img src="https://img.shields.io/badge/Privacy-FHE-green" alt="FHE">
  <img src="https://img.shields.io/badge/License-MIT-yellow" alt="License">
</p>

<p align="center">
  <a href="https://frontend-mauve-eta-12.vercel.app"><strong>🚀 Live Application</strong></a> •
  <a href="https://documentation-theta-six.vercel.app/"><strong>📚 Documentation</strong></a>
   <a href="https://youtu.be/yPO8uzswaTE"><strong>Demo_Video</strong></a>
</p>

## Overview

SEALrfq (Sealed Encrypted Auction Ledger for Request for Quotation) is a privacy-preserving procurement protocol that leverages Fully Homomorphic Encryption (FHE) to enable confidential bidding in enterprise procurement.

**The Problem**: Global procurement corruption costs $2+ trillion annually. Traditional systems expose bid prices, enabling collusion and bid manipulation.

**Our Solution**: Cryptographically sealed bids that remain encrypted throughout the entire auction process, with winner determination happening on encrypted data.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        SEALrfq                              │
├─────────────────┬─────────────────┬─────────────────────────┤
│    Frontend     │    Backend      │    Smart Contracts      │
│    (Next.js)    │    (Node.js)    │    (Solidity + FHE)     │
├─────────────────┼─────────────────┼─────────────────────────┤
│ • Web3 Wallet   │ • REST API      │ • SealedRFQ.sol         │
│ • RFQ Creation  │ • Bid Storage   │ • SealedVickrey.sol     │
│ • Bid Interface │ • Audit Trail   │ • SealedDutch.sol       │
│ • Audit View    │ • FHE Bridge    │ • SealedInvoice.sol     │
└─────────────────┴─────────────────┴─────────────────────────┘
```

## Features

- **🔒 FHE-Encrypted Bids**: Bids remain encrypted on-chain, invisible to all parties
- **⚖️ Fair Auctions**: Vickrey (second-price) and Dutch auction mechanisms
- **📋 RFQ Management**: Complete request-for-quotation workflow
- **💰 Escrow System**: Automated payment release on delivery confirmation
- **📊 Audit Trail**: Immutable, privacy-preserving audit logs
- **🔐 Zero-Knowledge Proofs**: Verify computations without revealing data

## Project Structure

```
SEALrfq/
├── frontend/           # Next.js web application
├── fehenix_backend/    # Node.js API server
├── fehenix-contract/   # Solidity smart contracts
├── documentation/      # Project documentation
│   ├── IDEA.md        # Product concept and problem statement
│   ├── progress.md    # Development progress
│   └── vision.md      # Future roadmap
└── docs/              # Additional documentation
```

## Quick Start

### Prerequisites

- Node.js 18+
- npm or yarn
- MetaMask or compatible Web3 wallet

### Frontend

```bash
cd frontend
npm install
npm run dev
```

### Backend

```bash
cd fehenix_backend
npm install
cp .env.example .env.local
# Configure your environment variables
npm run dev
```

### Smart Contracts

See [fehenix-contract/README.md](./fehenix-contract/README.md) for deployment instructions.

## Documentation

| Document | Description |
|----------|-------------|
| [IDEA.md](./documentation/IDEA.md) | Product concept and problem analysis |
| [progress.md](./documentation/progress.md) | Development milestones and status |
| [vision.md](./documentation/vision.md) | Future roadmap and expansion plans |

## Technology Stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 14, React 18, TailwindCSS, wagmi, RainbowKit |
| Backend | Node.js, Express, TypeScript |
| Blockchain | Ethereum (Sepolia), Solidity |
| Encryption | Fully Homomorphic Encryption (FHE) via Fhenix |
| Wallet | MetaMask, WalletConnect |

## Deployed Contracts (Sepolia)

| Contract | Address |
|----------|---------|
| SealedRFQ | `0xF6E986D3ED172322984e3e10E60Ba8a899959078` |
| SealedVickrey | `0x2e1c05C474D92D52ce265f8CB5Cfe562C2BC1D42` |
| SealedDutch | `0xE69e123db61227699808AfCba4213cCA829A0501` |
| SealedInvoice | `0x91fE02b3Ff4737fB8d7336004D122D488cA51c8F` |

## Use Cases

1. **Government Procurement**: Transparent yet confidential public tenders
2. **Enterprise Supply Chain**: Competitive vendor selection without price exposure
3. **Healthcare**: HIPAA-compliant procurement for sensitive equipment
4. **Defense**: Classified procurement with cryptographic guarantees

## Contributing

Contributions are welcome! Please read our contributing guidelines before submitting PRs.

## License

MIT License - see [LICENSE](./LICENSE) for details.

## Contact

For questions or partnership inquiries, reach out to the team.

---

<p align="center">
  <strong>Built with 🔐 for a more transparent, fair procurement future</strong>
</p>
