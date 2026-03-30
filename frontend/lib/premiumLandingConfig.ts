export type HeroStat = {
    value: number;
    suffix: string;
    label: string;
};

export const preloaderConfig = {
    brandName: 'Fhenix SEAL',
    brandSubname: 'FHE Encryption',
    yearText: 'Powered by Fhenix',
};

export const heroConfig = {
    scriptText: 'Trustless Procurement & Auctions',
    mainTitle: 'Private. Secure.\nTrustless.',
    ctaButtonText: 'Connect Wallet',
    stats: [
        { value: 100, suffix: '%', label: 'Privacy Guaranteed' },
        { value: 0, suffix: '', label: 'Counterparty Risk' },
        { value: 3, suffix: '', label: 'Auction Types' },
    ] satisfies HeroStat[],
    decorativeText: 'FULLY HOMOMORPHIC ENCRYPTION',
    backgroundImage: '/images/hero-banner.jpg',
    brandImage: '/images/photo-retro.png',
};

export const auctionShowcaseConfig = {
    scriptText: 'Auction Mechanisms',
    subtitle: 'SUPPORTING THREE MAJOR MARKET DYNAMICS',
    mainTitle: 'Choose Your Auction Type',
    ctaButtonText: 'Explore Security',
    items: [
        {
            id: 'rfq',
            name: 'Classic RFQ',
            subtitle: 'Request for Quote',
            year: 'FHE Sealed Bid',
            image: '/images/auction-rfq.png',
            filter: '',
            glowClass: 'bg-indigo-500/20',
            description:
                'Standard sealed-bid procurement for targeted business needs. Buyers configure procurement requests and vendors submit FHE-encrypted bids that remain completely confidential throughout the process.',
            detail:
                'Ideal for enterprise procurement teams seeking competitive pricing without revealing strategies.',
            statA: 'Instant',
            statB: 'Private',
            statC: 'Automated',
        },
        {
            id: 'vickrey',
            name: 'Vickrey Auction',
            subtitle: 'Second-Price Sealed-Bid',
            year: 'Truthful Bidding',
            image: '/images/auction-vickrey.png',
            filter: 'brightness(1.15) sepia(0.2) hue-rotate(200deg) saturate(1.2)',
            glowClass: 'bg-blue-500/20',
            description:
                'The highest bidder wins, but only pays the second-highest bid price. This mechanism encourages bidders to bid their true maximum valuation without fear of overpaying.',
            detail: 'Ideal for fair-market price discovery and encouraging truthful bidding behavior.',
            statA: 'Fair',
            statB: 'Optimal',
            statC: 'Efficient',
        },
        {
            id: 'dutch',
            name: 'Dutch Auction',
            subtitle: 'Descending Price',
            year: 'First Accept Wins',
            image: '/images/auction-dutch.png',
            filter: 'brightness(1.2) sepia(0.3) hue-rotate(160deg) saturate(0.9)',
            glowClass: 'bg-emerald-500/20',
            description:
                'The auction starts at a high asking price that continuously decreases. The first vendor to accept the current price wins and settles exactly at that price.',
            detail: 'Excellent for time-sensitive liquidations and rapid price discovery.',
            statA: 'Fast',
            statB: 'Dynamic',
            statC: 'Immediate',
        },
    ],
    features: [
        {
            icon: 'Sparkles',
            title: 'Fully Homomorphic Encryption',
            description: 'FHE-encrypted payloads ensure bid amounts remain hidden from all parties until settlement - computed on without decryption.',
        },
        {
            icon: 'Clock',
            title: 'Fast Finality',
            description: 'Automated smart contract settlements execute when auction criteria are met on the Fhenix network.',
        },
        {
            icon: 'ShieldCheck',
            title: 'MEV Protection',
            description: 'Encrypted transactions prevent front-running and value extraction by malicious actors.',
        },
    ],
    quote: {
        prefix: 'The',
        text: 'Code is law. If the criteria are met, the escrow pays out autonomously. No brokers. No trust required.',
        attribution: 'Fhenix SEAL Protocol',
    },
};

export const howItWorksConfig = {
    scriptText: 'The Process',
    subtitle: 'HOW FHENIX SEAL WORKS',
    mainTitle: 'Three Steps to Trustless Trading',
    locationTag: 'Built on Fhenix Network',
    slides: [
        {
            image: '/images/slider01.jpg',
            title: 'Configure & Deposit',
            subtitle: 'Step One',
            area: '100%',
            unit: 'Secure Escrow',
            description:
                'A buyer configures a procurement request or auction and deposits funds into an on-chain smart contract escrow. The contract terms are immutable and transparently verifiable.',
        },
        {
            image: '/images/slider02.jpg',
            title: 'Submit FHE-Encrypted Bids',
            subtitle: 'Step Two',
            area: 'Zero',
            unit: 'Information Leakage',
            description:
                'Vendors submit fully homomorphic encrypted bids using the CoFHE SDK. No one can see bid amounts while the market is live - not even the blockchain validators.',
        },
        {
            image: '/images/slider03.jpg',
            title: 'Automatic Settlement',
            subtitle: 'Step Three',
            area: 'Instant',
            unit: 'Finality',
            description:
                'Once the auction concludes, FHE decryption proofs determine the winner. The smart contract settles the transaction without manual intervention.',
        },
    ],
};

export const securityShowcaseConfig = {
    scriptText: 'Security First',
    subtitle: 'ENTERPRISE-GRADE PROTECTION',
    mainTitle: 'Absolute Privacy & Zero Risk',
    introText:
        "Fhenix SEAL leverages fully homomorphic encryption to ensure complete bid confidentiality, eliminate counterparty risk, and guarantee fair, tamper-proof settlements.",
    tabs: [
        {
            id: 'privacy',
            name: 'FHE Privacy',
            icon: 'History',
            image: '/images/museum-tab1.jpg',
            content: {
                title: 'Cryptographic Confidentiality',
                description:
                    'Every bid is encrypted using fully homomorphic encryption. The blockchain can compute on encrypted data without ever seeing the plaintext, ensuring complete strategic privacy for all participants.',
                highlight: 'No information leakage. Ever.',
            },
        },
        {
            id: 'security',
            name: 'Smart Contracts',
            icon: 'BookOpen',
            image: '/images/museum-tab2.jpg',
            content: {
                title: 'Trustless Escrow & Settlement',
                description:
                    'Funds are held in audited smart contracts that execute settlements automatically when predefined conditions are met. No intermediaries, no custody risk, no delays.',
                highlight: 'Code is law. Period.',
            },
        },
        {
            id: 'assets',
            name: 'Liquid Assets',
            icon: 'Award',
            image: '/images/museum-tab3.jpg',
            content: {
                title: 'Native High-Tier Liquidity',
                description:
                    'Full support for native FHE tokens and ERC20 stablecoins. Institutional-grade liquidity ensures seamless settlements at any scale.',
                highlight: 'Fast finality guaranteed.',
            },
        },
    ],
    timeline: [
        { year: 'Setup', event: 'Buyer creates auction with encrypted parameters' },
        { year: 'Bidding', event: 'Vendors submit FHE-protected sealed bids' },
        { year: 'Reveal', event: 'CoFHE decryption proof determines winner' },
        { year: 'Settlement', event: 'Smart contract executes autonomously' },
    ],
    supportedAssetsLabel: 'Supported Assets',
    supportedAssets: 'FHE, USDC, USDT',
    yearBadge: 'FHE',
    yearBadgeLabel: 'Powered By',
    quote: {
        prefix: 'Our',
        text: 'Mission is to eliminate trust requirements from B2B procurement while maintaining absolute privacy and mathematical certainty in every transaction.',
        attribution: 'Fhenix SEAL Team',
    },
    brandImage: '/images/photo-retro.png',
    brandImageAlt: 'Fhenix SEAL protocol architecture',
};

export const scrollToTopConfig = {
    ariaLabel: 'Back to top',
};
