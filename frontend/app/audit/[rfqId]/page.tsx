'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import {
    ActionBar,
    CopyInlineButton,
    CopyableText,
    DataGrid,
    DataPoint,
    Field,
    Notice,
    PageHeader,
    PageShell,
    Panel,
    SelectInput,
} from '@/components/protocol/ProtocolPrimitives';
import { authenticatedFetch } from '@/lib/authFetch';
import { getExplorerTxUrl } from '@/lib/sepoliaClient';
import { truncateMiddle } from '@/lib/utils';

type AuditEvent = {
    id: string;
    eventType: string;
    txId: string;
    blockHeight: number;
    eventVersion: number;
    processedAt: string;
    rfqId?: string;
    transition?: string;
    eventData?: any;
};

function short(value?: string, n = 12): string {
    if (!value) return '-';
    if (value.length <= n) return value;
    return `${value.substring(0, n)}...`;
}

function isExplorerTx(value?: string): boolean {
    return Boolean(value && value.startsWith('0x'));
}

function toCsv(events: AuditEvent[]): string {
    const header = ['block_height', 'processed_at', 'event_type', 'tx_id', 'event_version', 'rfq_id', 'transition'];
    const rows = events.map((e) => [
        e.blockHeight,
        e.processedAt,
        e.eventType,
        e.txId,
        e.eventVersion,
        e.rfqId || '',
        e.transition || '',
    ]);
    return [header, ...rows].map((r) => r.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(',')).join('\n');
}

export default function AuditTrailPage({ params }: { params: { rfqId?: string } }) {
    const rfqId = params.rfqId;

    const [events, setEvents] = useState<AuditEvent[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [filterEventType, setFilterEventType] = useState<string>('ALL');

    useEffect(() => {
        const fetchAuditTrail = async () => {
            try {
                const q = new URLSearchParams();
                if (rfqId) q.append('rfqId', rfqId);
                if (filterEventType !== 'ALL') q.append('eventType', filterEventType);

                const response = await authenticatedFetch(`/api/audit/trail?${q.toString()}`);

                const json = await response.json();
                if (!response.ok) {
                    throw new Error(json?.error?.message || 'Failed to fetch audit trail');
                }

                setEvents(json.data || []);
            } catch (err: any) {
                setError(err?.message || 'Failed to fetch audit trail');
            } finally {
                setLoading(false);
            }
        };

        fetchAuditTrail();
    }, [rfqId, filterEventType]);

    const eventTypes = useMemo(() => {
        const base = ['ALL'];
        const dynamic = Array.from(new Set(events.map((e) => e.eventType).filter(Boolean))).sort();
        return [...base, ...dynamic];
    }, [events]);

    const exportCsv = () => {
        const csv = toCsv(events);
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `audit_trail_${Date.now()}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    if (loading) {
        return (
            <PageShell>
                <Panel title="Loading audit trail">
                    <div className="text-sm text-white/55">Fetching indexed events and filters.</div>
                </Panel>
            </PageShell>
        );
    }

    if (error) {
        return (
            <PageShell>
                <Notice tone="danger">{error}</Notice>
            </PageShell>
        );
    }

    const latestBlock = events.reduce((max, event) => Math.max(max, event.blockHeight || 0), 0);

    return (
        <PageShell className="space-y-6">
            <PageHeader
                eyebrow="Audit"
                title="Audit trail"
                description={rfqId ? `Indexed event history for RFQ ${rfqId}.` : 'Indexed event history for all RFQs.'}
                actions={
                    <ActionBar>
                        {rfqId ? <CopyableText value={rfqId} displayValue={truncateMiddle(rfqId, 16, 10)} /> : null}
                        <Button variant="secondary" onClick={exportCsv} disabled={events.length === 0}>
                            Export CSV
                        </Button>
                    </ActionBar>
                }
            />

            <DataGrid columns={3}>
                <DataPoint label="Events" value={events.length} />
                <DataPoint label="Event types" value={eventTypes.length - 1} />
                <DataPoint label="Latest block" value={latestBlock || '--'} />
            </DataGrid>

            <Panel title="Filters" subtitle="Narrow the event table before exporting.">
                <div className="grid gap-4 md:grid-cols-[minmax(0,240px)_1fr]">
                    <Field label="Event type">
                        <SelectInput value={filterEventType} onChange={(e) => setFilterEventType(e.target.value)}>
                            {eventTypes.map((type) => (
                                <option key={type} value={type}>
                                    {type}
                                </option>
                            ))}
                        </SelectInput>
                    </Field>
                    <Notice title="Scope">{rfqId ? 'Showing one RFQ audit trail.' : 'Showing all indexed audit events.'}</Notice>
                </div>
            </Panel>

            <Panel title="Events" subtitle="Every processed event is timestamped and exportable.">
                {events.length === 0 ? (
                    <div className="text-sm text-white/55">No events found for the current filter set.</div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="min-w-[980px] w-full text-sm">
                            <thead className="bg-white/[0.04]">
                                <tr className="text-left text-white/50">
                                    <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.16em]">Block</th>
                                    <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.16em]">Processed</th>
                                    <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.16em]">Event type</th>
                                    <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.16em]">Transition</th>
                                    <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.16em]">Tx</th>
                                    <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.16em]">Version</th>
                                    <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.16em]">RFQ</th>
                                </tr>
                            </thead>
                            <tbody>
                                {events.map((event) => (
                                    <tr key={event.id} className="border-t border-white/[0.06] align-top transition hover:bg-white/[0.03]">
                                        <td className="px-4 py-3 font-medium text-white">{event.blockHeight}</td>
                                        <td className="px-4 py-3 text-white/55">{new Date(event.processedAt).toLocaleString()}</td>
                                        <td className="px-4 py-3 font-medium text-white">{event.eventType}</td>
                                        <td className="px-4 py-3 text-white/60">{event.transition || '-'}</td>
                                        <td className="px-4 py-3">
                                            <div className="flex items-center gap-2">
                                                {isExplorerTx(event.txId) ? (
                                                    <a
                                                        href={getExplorerTxUrl(event.txId)}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="font-mono text-[13px] text-emerald-300 hover:underline"
                                                    >
                                                        {short(event.txId, 18)}
                                                    </a>
                                                ) : (
                                                    <span className="font-mono text-[13px] text-white/60">{short(event.txId, 18)}</span>
                                                )}
                                                <CopyInlineButton value={event.txId} />
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 text-white/55">{event.eventVersion}</td>
                                        <td className="px-4 py-3">
                                            {event.rfqId ? (
                                                <CopyableText value={event.rfqId} displayValue={short(event.rfqId, 18)} />
                                            ) : (
                                                <span className="text-white/30">-</span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </Panel>
        </PageShell>
    );
}
