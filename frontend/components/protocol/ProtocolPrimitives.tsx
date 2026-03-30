'use client';

import Link from 'next/link';
import { Check, ChevronDown, Copy, Inbox } from 'lucide-react';
import { useState, type ComponentProps, type ReactNode } from 'react';
import { Badge } from '@/components/ui/Badge';
import { pricingLabel, STATUS_LABELS, tokenLabel, TOKEN_TYPE } from '@/lib/sealProtocol';
import { cn } from '@/lib/utils';

export function PageShell({ children, className }: { children: ReactNode; className?: string }) {
    return <div className={cn('mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8', className)}>{children}</div>;
}

export function PageHeader({
    eyebrow,
    title,
    description,
    actions,
}: {
    eyebrow?: string;
    title: string;
    description?: string;
    actions?: ReactNode;
}) {
    return (
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="space-y-1.5">
                {eyebrow ? (
                    <div className="inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.28em] text-emerald-200/75">
                        <span className="h-1 w-1 rounded-full bg-emerald-400/70" />
                        {eyebrow}
                    </div>
                ) : null}
                <h1 className="premium-heading text-2xl font-bold tracking-tight text-white sm:text-3xl">{title}</h1>
                {description ? <p className="max-w-3xl text-sm leading-6 text-white/70">{description}</p> : null}
            </div>
            {actions ? <div className="flex flex-wrap items-center gap-2 sm:justify-end">{actions}</div> : null}
        </div>
    );
}

export function Panel({
    title,
    subtitle,
    children,
    className,
}: {
    title?: string;
    subtitle?: string;
    children: ReactNode;
    className?: string;
}) {
    return (
        <section className={cn('premium-panel rounded-2xl border border-white/12 bg-white/[0.04] p-5 text-white', className)}>
            {title || subtitle ? (
                <header className="mb-4 space-y-1">
                    {title ? <h2 className="text-base font-semibold tracking-tight text-white">{title}</h2> : null}
                    {subtitle ? <p className="text-sm leading-6 text-white/65">{subtitle}</p> : null}
                </header>
            ) : null}
            {children}
        </section>
    );
}

export function DataGrid({ children, columns = 2 }: { children: ReactNode; columns?: 2 | 3 | 4 }) {
    const gridClass =
        columns === 4
            ? 'grid gap-3 sm:grid-cols-2 xl:grid-cols-4'
            : columns === 3
              ? 'grid gap-3 sm:grid-cols-2 xl:grid-cols-3'
              : 'grid gap-3 sm:grid-cols-2';
    return <div className={gridClass}>{children}</div>;
}

export function DataPoint({ label, value, subtle }: { label: string; value: ReactNode; subtle?: ReactNode }) {
    return (
        <div className="rounded-xl border border-white/12 bg-white/[0.05] p-3.5 transition-colors hover:bg-white/[0.07]">
            <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/45">{label}</div>
            <div className="mt-2 text-sm font-bold text-white">{value}</div>
            {subtle ? <div className="mt-1.5 text-xs leading-5 text-white/50">{subtle}</div> : null}
        </div>
    );
}

export function Field({
    label,
    hint,
    children,
    className,
}: {
    label: string;
    hint?: ReactNode;
    children: ReactNode;
    className?: string;
}) {
    return (
        <label className={cn('space-y-1.5 text-sm text-white/80', className)}>
            <div className="font-medium text-white">{label}</div>
            {hint ? <div className="text-xs leading-5 text-white/60">{hint}</div> : null}
            {children}
        </label>
    );
}

const inputBaseClass =
    'w-full rounded-xl border border-white/15 bg-white/[0.06] px-3.5 py-2.5 text-sm text-white outline-none transition placeholder:text-white/45 focus:border-emerald-300/45 focus:ring-4 focus:ring-emerald-300/10 [&>option]:bg-[#0f172a] [&>option]:text-white';

export function TextInput({ className, ...props }: ComponentProps<'input'>) {
    return <input className={cn(inputBaseClass, className)} {...props} />;
}

export function TextAreaInput({ className, ...props }: ComponentProps<'textarea'>) {
    return <textarea className={cn(inputBaseClass, 'min-h-[110px] resize-y', className)} {...props} />;
}

export function SelectInput({ className, children, ...props }: ComponentProps<'select'>) {
    return (
        <select className={cn(inputBaseClass, className)} {...props}>
            {children}
        </select>
    );
}

export function ActionBar({ children, className }: { children: ReactNode; className?: string }) {
    return <div className={cn('flex flex-wrap items-center gap-2.5', className)}>{children}</div>;
}

export function InfoList({ children, className }: { children: ReactNode; className?: string }) {
    return <div className={cn('space-y-2.5 text-sm', className)}>{children}</div>;
}

export function InfoRow({
    label,
    value,
    className,
}: {
    label: string;
    value: ReactNode;
    className?: string;
}) {
    return (
        <div className={cn('flex items-start justify-between gap-4 border-b border-white/10 pb-3 text-sm last:border-b-0 last:pb-0', className)}>
            <span className="min-w-0 text-white/60">{label}</span>
            <span className="min-w-0 text-right font-medium text-white">{value}</span>
        </div>
    );
}

export function Notice({
    tone = 'neutral',
    title,
    children,
}: {
    tone?: 'neutral' | 'success' | 'warning' | 'danger';
    title?: string;
    children: ReactNode;
}) {
    const toneClass =
        tone === 'success'
            ? 'border-emerald-300/30 bg-emerald-400/12 text-emerald-100'
            : tone === 'warning'
              ? 'border-amber-300/30 bg-amber-400/12 text-amber-100'
              : tone === 'danger'
                ? 'border-red-300/30 bg-red-400/12 text-red-100'
                : 'border-blue-300/30 bg-blue-400/12 text-blue-100';
    return (
        <div className={cn('rounded-xl border p-3.5 text-sm shadow-sm shadow-slate-900/[0.02]', toneClass)}>
            {title ? <div className="mb-1 font-medium">{title}</div> : null}
            <div className="text-sm leading-6">{children}</div>
        </div>
    );
}

export function StatusChip({ status }: { status: string }) {
    const label = STATUS_LABELS[status] || status;
    const tone =
        status === 'COMPLETED'
            ? 'success'
            : status === 'CANCELLED' || status === 'WINNER_DECLINED'
              ? 'destructive'
              : status === 'REVEAL'
                ? 'warning'
                : 'default';
    return <Badge variant={tone as 'default' | 'warning' | 'destructive' | 'success'}>{label}</Badge>;
}

export function TokenChip({ tokenType, label }: { tokenType?: number | null; label?: string }) {
    const value = label ?? tokenLabel(tokenType);
    const variant =
        tokenType === TOKEN_TYPE.TOKEN1 ? 'success' : tokenType === TOKEN_TYPE.TOKEN2 ? 'warning' : 'default';
    return <Badge variant={variant as 'default' | 'success' | 'warning'}>{value}</Badge>;
}

export function PricingChip({ pricingMode }: { pricingMode?: number | null }) {
    return <Badge variant="outline">{pricingLabel(pricingMode)}</Badge>;
}

export function InlineMeta({ children }: { children: ReactNode }) {
    return <div className="flex flex-wrap items-center gap-1.5">{children}</div>;
}

export function EmptyState({
    title,
    description,
    actionHref,
    actionLabel,
}: {
    title: string;
    description: string;
    actionHref?: string;
    actionLabel?: string;
}) {
    return (
        <div className="rounded-2xl border border-dashed border-white/15 bg-white/[0.02] px-8 py-12 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-white/15 bg-white/[0.06]">
                <Inbox className="h-5 w-5 text-white/40" />
            </div>
            <div className="text-base font-semibold text-white">{title}</div>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-white/55">{description}</p>
            {actionHref && actionLabel ? (
                <Link
                    href={actionHref}
                    className="mt-5 inline-flex items-center gap-2 rounded-xl border border-emerald-300/30 bg-emerald-400/15 px-5 py-2 text-sm font-semibold text-emerald-100 transition hover:bg-emerald-400/25"
                >
                    {actionLabel}
                </Link>
            ) : null}
        </div>
    );
}

export function RecordsPanel({
    records,
    emptyLabel = 'No records cached in this browser yet.',
}: {
    records: Array<{ id: string; type: string; rfqId: string; createdAt: string }>;
    emptyLabel?: string;
}) {
    if (records.length === 0) {
        return <div className="text-sm text-white/60">{emptyLabel}</div>;
    }
    return (
        <div className="space-y-2">
            {records.map((record) => (
                <div key={record.id} className="rounded-xl border border-white/12 bg-white/[0.05] p-3">
                    <div className="flex items-center justify-between gap-3">
                        <div>
                            <div className="text-sm font-medium text-white">{record.type}</div>
                            <div className="text-xs text-white/60">RFQ {record.rfqId.slice(0, 12)}...</div>
                        </div>
                        <div className="text-xs text-white/60">{new Date(record.createdAt).toLocaleDateString()}</div>
                    </div>
                </div>
            ))}
        </div>
    );
}

export function Skeleton({ className }: { className?: string }) {
    return <div className={cn('skeleton', className)} />;
}

export function CardSkeleton() {
    return (
        <div className="premium-panel space-y-3 rounded-2xl border border-white/12 bg-white/[0.04] p-5">
            <div className="skeleton h-5 w-1/3" />
            <div className="skeleton h-4 w-2/3" />
            <div className="skeleton h-4 w-1/2" />
        </div>
    );
}

export type WorkflowGuideStep = {
    title: string;
    description: ReactNode;
    state?: 'complete' | 'current' | 'upcoming';
    action?: ReactNode;
};

export function WorkflowGuide({
    steps,
    className,
}: {
    steps: WorkflowGuideStep[];
    className?: string;
}) {
    return (
        <div className={cn('space-y-3', className)}>
            {steps.map((step, index) => {
                const state = step.state ?? 'upcoming';
                const shellClass =
                    state === 'complete'
                        ? 'border-emerald-300/30 bg-emerald-400/10'
                        : state === 'current'
                          ? 'border-blue-300/30 bg-blue-400/10'
                          : 'border-white/12 bg-white/[0.04]';
                const badgeClass =
                    state === 'complete'
                        ? 'border-emerald-300/40 bg-emerald-300/15 text-emerald-100'
                        : state === 'current'
                          ? 'border-blue-300/40 bg-blue-300/15 text-blue-100'
                          : 'border-white/20 bg-white/[0.08] text-white/70';
                const stateLabel = state === 'complete' ? 'Done' : state === 'current' ? 'Current' : 'Later';

                return (
                    <div key={`${index}-${step.title}`} className={cn('rounded-xl border p-4', shellClass)}>
                        <div className="flex items-start gap-3">
                            <div
                                className={cn(
                                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-sm font-semibold',
                                    badgeClass,
                                )}
                            >
                                {state === 'complete' ? <Check className="h-4 w-4" /> : index + 1}
                            </div>
                            <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                    <div className="text-sm font-semibold text-white">{step.title}</div>
                                    <span className={cn('rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.14em]', badgeClass)}>
                                        {stateLabel}
                                    </span>
                                </div>
                                <div className="mt-1 text-sm leading-6 text-white/70">{step.description}</div>
                                {step.action ? <div className="mt-3">{step.action}</div> : null}
                            </div>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

export function DisclosureCard({
    title,
    subtitle,
    children,
    defaultOpen = false,
    leading,
    trailing,
    className,
}: {
    title: ReactNode;
    subtitle?: ReactNode;
    children: ReactNode;
    defaultOpen?: boolean;
    leading?: ReactNode;
    trailing?: ReactNode;
    className?: string;
}) {
    return (
        <details
            open={defaultOpen}
            className={cn(
                'group overflow-hidden rounded-xl border border-white/12 bg-white/[0.04] transition open:bg-white/[0.08]',
                className,
            )}
        >
            <summary className="flex cursor-pointer list-none items-start justify-between gap-3 p-4">
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                        {leading}
                        <div className="min-w-0 text-sm font-semibold text-white">{title}</div>
                    </div>
                    {subtitle ? <div className="mt-1 text-xs leading-5 text-white/60">{subtitle}</div> : null}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                    {trailing}
                    <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/20 bg-white/[0.08] text-white/70 transition group-open:rotate-180">
                        <ChevronDown className="h-4 w-4" />
                    </span>
                </div>
            </summary>
            <div className="border-t border-white/10 px-4 pb-4 pt-3">{children}</div>
        </details>
    );
}

export function CopyInlineButton({
    value,
    className,
    title = 'Copy value',
}: {
    value: string;
    className?: string;
    title?: string;
}) {
    const [copied, setCopied] = useState(false);

    const handleCopy = async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
    };

    return (
        <button
            type="button"
            onClick={handleCopy}
            title={copied ? 'Copied' : title}
            className={cn(
                'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-white/20 bg-white/[0.08] text-white/70 transition hover:border-white/35 hover:text-white',
                className,
            )}
        >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
    );
}

export function CopyableText({
    value,
    displayValue,
    className,
    mono = true,
    breakAll = false,
}: {
    value: string;
    displayValue?: ReactNode;
    className?: string;
    mono?: boolean;
    breakAll?: boolean;
}) {
    return (
        <div className="flex items-start justify-end gap-2">
            <span
                title={value}
                className={cn(
                    'min-w-0 text-white',
                    mono ? 'font-mono text-[13px]' : '',
                    breakAll ? 'break-all' : 'truncate',
                    className,
                )}
            >
                {displayValue ?? value}
            </span>
            <CopyInlineButton value={value} />
        </div>
    );
}
