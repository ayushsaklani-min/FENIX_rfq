import './globals.css';
import { WalletProvider } from '@/contexts/WalletContext';
import { FhenixWalletProvider } from '@/contexts/ProvableWalletProvider';
import { ToastProvider } from '@/components/Toast';
import type { Metadata } from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import WalletErrorModal from '@/components/WalletErrorModal';
import AppRouteGuard from '@/components/AppRouteGuard';
import AppBackdrop from '@/components/AppBackdrop';

const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Fhenix SEAL - Private Procurement with FHE',
  description: 'Fully homomorphic encryption powered sealed-bid procurement. Create RFQs, bid privately, settle on-chain.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={`${jakarta.variable} font-sans min-h-screen flex flex-col`}>
        <FhenixWalletProvider>
        <WalletProvider>
          <ToastProvider>
            <Navbar />
            <WalletErrorModal />
            <main className="premium-app flex-grow pt-16 relative">
              <AppBackdrop />
              <div className="relative z-10">
                <AppRouteGuard>{children}</AppRouteGuard>
              </div>
            </main>
            <Footer />
          </ToastProvider>
        </WalletProvider>
        </FhenixWalletProvider>
      </body>
    </html>
  );
}
