'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { ActionBar, Field, Notice, PageHeader, PageShell, Panel, TextInput } from '@/components/protocol/ProtocolPrimitives';

export default function EscrowHubPage() {
    const router = useRouter();
    const [rfqId, setRfqId] = useState('');

    return (
        <PageShell className="space-y-6">
            <PageHeader
                eyebrow="Settlement"
                title="Escrow"
                description="Open a settlement workspace for an RFQ, then manage releases and timeout protection actions."
            />

            <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
                <Panel title="Open settlement" subtitle="Every escrow action is keyed by RFQ id.">
                    <div className="space-y-4">
                        <Field label="RFQ id" hint="Use the bytes32 RFQ id from the buyer or the shared RFQ dashboard.">
                            <TextInput value={rfqId} onChange={(event) => setRfqId(event.target.value)} placeholder="0x..." />
                        </Field>
                        <ActionBar>
                            <Button onClick={() => router.push(`/escrow/${encodeURIComponent(rfqId)}`)} disabled={!rfqId.trim()}>
                                Open settlement
                            </Button>
                            <div className="text-sm text-[hsl(var(--muted-foreground))]">Paste the RFQ id exactly as stored on-chain.</div>
                        </ActionBar>
                    </div>
                </Panel>

                <div className="space-y-6">
                    <Panel title="Quick links">
                        <div className="space-y-3">
                            <Link
                                href="/buyer/rfqs"
                                className="group flex items-center justify-between rounded-xl border border-white/12 bg-white/[0.04] px-4 py-4 transition hover:border-amber-200/30 hover:bg-white/[0.08]"
                            >
                                <div>
                                    <div className="text-sm font-semibold text-white">Creator dashboard</div>
                                    <div className="mt-0.5 text-xs text-white/55">Fund escrow and manage releases</div>
                                </div>
                                <ArrowRight className="h-4 w-4 text-white/35 transition group-hover:translate-x-0.5 group-hover:text-white/70" />
                            </Link>
                            <Link
                                href="/vendor/my-bids"
                                className="group flex items-center justify-between rounded-xl border border-white/12 bg-white/[0.04] px-4 py-4 transition hover:border-amber-200/30 hover:bg-white/[0.08]"
                            >
                                <div>
                                    <div className="text-sm font-semibold text-white">Vendor dashboard</div>
                                    <div className="mt-0.5 text-xs text-white/55">Claim stake or escrow</div>
                                </div>
                                <ArrowRight className="h-4 w-4 text-white/35 transition group-hover:translate-x-0.5 group-hover:text-white/70" />
                            </Link>
                        </div>
                    </Panel>

                    <Notice tone="neutral" title="Sepolia escrow workspace">
                        This workspace tracks the live Ethereum Sepolia RFQ settlement flow: fund escrow, release payments publicly, and review linked invoice state from one place.
                    </Notice>
                </div>
            </div>
        </PageShell>
    );
}
