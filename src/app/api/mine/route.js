import { NextResponse } from 'next/server';
import { submitPoints, getSession } from '@/lib/sessionStore';
import { withRateLimit, withWalletClickLimit } from '@/lib/security';

async function handler(req) {
    try {
        const { wallet, points } = await req.json();

        if (!wallet || typeof points !== 'number' || points <= 0) {
            return NextResponse.json({ error: 'Invalid data' }, { status: 400 });
        }

        submitPoints(wallet, points);
        const session = getSession();

        // Find user's current points
        let userPoints = 0;
        if (session.miners.has(wallet)) {
            userPoints = session.miners.get(wallet).points;
        }

        return NextResponse.json({
            success: true,
            userPoints,
            sessionId: session.id
        });
    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export const POST = withRateLimit(withWalletClickLimit(handler));
