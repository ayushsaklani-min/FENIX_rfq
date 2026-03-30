'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Field, Notice, PageHeader, PageShell, Panel, TextInput } from '@/components/protocol/ProtocolPrimitives';

export default function AuditHomePage() {
    const router = useRouter();
    const [rfqId, setRfqId] = useState('');

    const openAudit = (e: FormEvent) => {
        e.preventDefault();
        const value = rfqId.trim();
        if (!value) return;
        router.push(`/audit/${encodeURIComponent(value)}`);
    };

    return (
        <PageShell>
            <PageHeader
                eyebrow="Audit"
                title="Audit Trail"
                description="Enter an RFQ ID to inspect the event trail and export it as CSV."
            />
            <Panel title="Open audit workspace" subtitle="Load the indexed event trail for a single RFQ.">
                <form onSubmit={openAudit} className="space-y-4">
                    <Field label="RFQ id" hint="Paste the exact RFQ id stored on-chain.">
                        <TextInput
                            type="text"
                            value={rfqId}
                            onChange={(e) => setRfqId(e.target.value)}
                            placeholder="e.g. 1771260740925field"
                        />
                    </Field>
                    {!rfqId.trim() ? (
                        <Notice title="Tip">You can export a CSV after loading the trail.</Notice>
                    ) : null}
                    <Button type="submit" className="w-full">
                        Open audit view
                    </Button>
                </form>
            </Panel>
        </PageShell>
    );
}
