import { redirect } from 'next/navigation';

export default function EscrowReleaseRedirect({ params }: { params: { rfqId: string } }) {
    redirect(`/escrow/${encodeURIComponent(params.rfqId)}`);
}
