import { PageShell, Panel } from '@/components/protocol/ProtocolPrimitives';

export default function PrivacyPage() {
    return (
        <PageShell>
            <Panel>
                <h1 className="text-2xl font-bold text-white mb-4">Privacy Policy</h1>
                <div className="space-y-3 text-sm text-[hsl(var(--muted-foreground))]">
                    <p>
                        SealRFQ stores the minimum application data required to run RFQs, bids, sessions,
                        audit events, and escrow records.
                    </p>
                    <p>
                        Wallet authentication uses signed challenges. Bid commitments and transaction status
                        records may be stored in the backend for workflow coordination and auditability.
                    </p>
                    <p>
                        This policy page is for the demo build and should be replaced with a legal
                        review before production launch.
                    </p>
                </div>
            </Panel>
        </PageShell>
    );
}
