/** @type {import('next').NextConfig} */
const path = require('path');
const BACKEND_API_URL = process.env.BACKEND_API_URL || 'http://localhost:3000';
const COFHE_SDK_DIST = path.resolve(__dirname, '../fehenix-contract/node_modules/@cofhe/sdk/dist');

const nextConfig = {
    experimental: {
        externalDir: true,
    },

    // Bundle size optimization
    compress: true,

    // Proxy /api/* to the backend so relative fetch('/api/...') works from the frontend.
    async rewrites() {
        return [
            {
                source: '/api/:path*',
                destination: `${BACKEND_API_URL}/api/:path*`,
            },
        ];
    },

    // Production optimizations
    swcMinify: true,

    // Remove unused code
    modularizeImports: {
        '@mui/icons-material': {
            transform: '@mui/icons-material/{{member}}',
        },
    },

    // Webpack bundle analyzer (enable with ANALYZE=true)
    webpack: (config, { isServer }) => {
        config.resolve = config.resolve || {};
        config.resolve.alias = {
            ...(config.resolve.alias || {}),
            '@cofhe/sdk': path.join(COFHE_SDK_DIST, 'core.js'),
            '@cofhe/sdk/web': path.join(COFHE_SDK_DIST, 'web.js'),
            '@cofhe/sdk/node': path.join(COFHE_SDK_DIST, 'node.js'),
            '@cofhe/sdk/chains': path.join(COFHE_SDK_DIST, 'chains.js'),
            '@cofhe/sdk/permits': path.join(COFHE_SDK_DIST, 'permits.js'),
        };

        if (process.env.ANALYZE === 'true') {
            const { BundleAnalyzerPlugin } = require('webpack-bundle-analyzer');
            config.plugins.push(
                new BundleAnalyzerPlugin({
                    analyzerMode: 'static',
                    reportFilename: isServer
                        ? '../analyze/server.html'
                        : './analyze/client.html',
                })
            );
        }

        return config;
    },

    // Ignore TypeScript errors during build (CoFHE SDK has internal issues)
    typescript: {
        ignoreBuildErrors: true,
    },
};

module.exports = nextConfig;
