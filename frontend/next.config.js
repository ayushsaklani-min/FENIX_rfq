/** @type {import('next').NextConfig} */
const BACKEND_API_URL = process.env.BACKEND_API_URL || 'http://localhost:3000';

const nextConfig = {
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

