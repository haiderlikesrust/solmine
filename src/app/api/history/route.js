import { NextResponse } from 'next/server';
import { getDistributions } from '@/lib/sessionStore';
import { withRateLimit } from '@/lib/security';

async function handler() {
    const history = getDistributions();
    return NextResponse.json({ history });
}

export const GET = withRateLimit(handler);
