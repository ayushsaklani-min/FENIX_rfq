export const metadata = {
    title: 'SealRFQ Backend',
    description: 'API Server',
};

export default function RootLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <html lang="en">
            <body>{children}</body>
        </html>
    );
}
