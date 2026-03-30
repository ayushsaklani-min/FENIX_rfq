import { PageShell, Panel } from '@/components/protocol/ProtocolPrimitives';

export default function TermsPage() {
    return (
        <PageShell>
            <Panel>
                <h1 className="text-2xl font-bold text-white mb-4">Terms of Service</h1>
                <div className="space-y-3 text-sm text-[hsl(var(--muted-foreground))]">
                    <p>
                        The current SealRFQ deployment is a prototype and demo environment.
                    </p>
                    <p>
                        It is provided for evaluation only and should not be used for real procurement,
                        regulated purchasing, or production fund flows without a full security, legal,
                        and compliance review.
                    </p>
                    <p>
                        By using this demo, you acknowledge that features, uptime, and data retention may
                        change without notice.
                    </p>
                </div>
            </Panel>
        </PageShell>
    );
}
