/**
 * Environment variable validation.
 * Call this once at application startup. Throws on any misconfiguration
 * so the process fails fast with a clear message rather than silently
 * using insecure defaults in production.
 */

const INSECURE_JWT_DEFAULT = 'development-secret-change-in-production';

interface EnvRule {
    name: string;
    required: boolean;
    insecureValues?: string[];
    description: string;
}

const RULES: EnvRule[] = [
    {
        name: 'JWT_SECRET',
        required: true,
        insecureValues: [INSECURE_JWT_DEFAULT, 'secret', 'changeme', ''],
        description: 'JWT signing secret (min 32 chars, cryptographically random)',
    },
    {
        name: 'DATABASE_URL',
        required: true,
        description: 'Database connection string (PostgreSQL for production)',
    },
];

const FHENIX_RULES: EnvRule[] = [
    {
        name: 'FHENIX_RPC_URL',
        required: true,
        description: 'Ethereum Sepolia RPC endpoint URL for SEAL contract reads and tx preparation',
    },
    {
        name: 'FHENIX_CHAIN_ID',
        required: true,
        description: 'Ethereum Sepolia chain id (11155111)',
    },
    {
        name: 'FHENIX_PRIVATE_KEY',
        required: true,
        description: 'Relayer private key used for Fhenix transaction signing',
    },
    {
        name: 'FHENIX_SEAL_RFQ_ADDRESS',
        required: true,
        description: 'Deployed SealRFQ contract address',
    },
    {
        name: 'FHENIX_SEAL_VICKREY_ADDRESS',
        required: true,
        description: 'Deployed SealVickrey contract address',
    },
    {
        name: 'FHENIX_SEAL_DUTCH_ADDRESS',
        required: true,
        description: 'Deployed SealDutch contract address',
    },
    {
        name: 'FHENIX_SEAL_INVOICE_ADDRESS',
        required: true,
        description: 'Deployed SealInvoice contract address',
    },
];

const PRODUCTION_ONLY_RULES: EnvRule[] = [
    {
        name: 'REDIS_URL',
        required: true,
        description: 'Redis connection URL for rate limiting',
    },
];

export function validateEnv(): void {
    const isProduction = process.env.NODE_ENV === 'production';
    const errors: string[] = [];
    const warnings: string[] = [];

    const fhenixEnabled = process.env.FHENIX_BACKEND_ENABLED === 'true';
    const rulesToCheck = isProduction
        ? [...RULES, ...PRODUCTION_ONLY_RULES]
        : RULES;

    for (const rule of rulesToCheck) {
        const value = process.env[rule.name];

        if (!value || value.trim() === '') {
            if (rule.required) {
                errors.push(`Missing required env var: ${rule.name} — ${rule.description}`);
            } else {
                warnings.push(`Optional env var not set: ${rule.name} — ${rule.description}`);
            }
            continue;
        }

        if (rule.insecureValues?.includes(value)) {
            if (isProduction) {
                errors.push(
                    `Insecure value for ${rule.name} in production. ${rule.description}`
                );
            } else {
                warnings.push(
                    `Insecure default value detected for ${rule.name}. This will fail in production.`
                );
            }
        }
    }

    if (fhenixEnabled) {
        for (const rule of FHENIX_RULES) {
            const value = process.env[rule.name];
            if (!value || value.trim() === '') {
                errors.push(`Missing required env var: ${rule.name} — ${rule.description}`);
            }
        }
    }

    // JWT_SECRET length check
    const jwtSecret = process.env.JWT_SECRET || '';
    if (jwtSecret.length < 32 && jwtSecret !== '') {
        const msg = `JWT_SECRET is too short (${jwtSecret.length} chars). Minimum 32 characters required.`;
        if (isProduction) errors.push(msg);
        else warnings.push(msg);
    }

    const chainIdRaw = process.env.FHENIX_CHAIN_ID || '';
    if (chainIdRaw) {
        const chainId = Number(chainIdRaw);
        if (!Number.isInteger(chainId) || chainId <= 0) {
            errors.push('FHENIX_CHAIN_ID must be a positive integer.');
        }
    }

    // Block insecure flags in production
    if (isProduction) {
        if (process.env.DEMO_MODE === 'true') {
            errors.push('DEMO_MODE=true is not allowed in production.');
        }
        if (process.env.ALLOW_MOCK_WALLET_SIGNATURE === 'true') {
            errors.push('ALLOW_MOCK_WALLET_SIGNATURE=true is not allowed in production.');
        }
        if (process.env.ALLOW_INSECURE_WALLET_SIGNATURE === 'true') {
            errors.push('ALLOW_INSECURE_WALLET_SIGNATURE=true is not allowed in production.');
        }
    }

    if (warnings.length > 0) {
        console.warn('[ENV] Configuration warnings:\n' + warnings.map((w) => `  ⚠ ${w}`).join('\n'));
    }

    if (errors.length > 0) {
        const message =
            '[ENV] Fatal configuration errors. Fix these before starting the server:\n' +
            errors.map((e) => `  ✗ ${e}`).join('\n');
        throw new Error(message);
    }

    console.log('[ENV] Environment validation passed.');
}
