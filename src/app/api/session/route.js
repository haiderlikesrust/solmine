import { NextResponse } from 'next/server';
import { getSession, joinSession, getLeaderboard, getTotalPoints, getMinerCount } from '@/lib/sessionStore';
import { withRateLimit } from '@/lib/security';

async function getHandler() {
    const session = getSession();
    const leaderboard = getLeaderboard();
    const totalPoints = getTotalPoints();
    const minerCount = getMinerCount();

    const timeRemaining = Math.max(0, Math.floor((session.endTime - Date.now()) / 1000));

    return NextResponse.json({
        sessionId: session.id,
        timeRemaining,
        totalPoints,
        minerCount,
        leaderboard,
        // Conversion: 1 SOL = 10000 points
        estimatedPoolSOL: totalPoints / 10000
    });
}

async function postHandler(req) {
    try {
        const { wallet } = await req.json();

        if (!wallet || wallet.length < 32) {
            return NextResponse.json({ error: 'Invalid wallet' }, { status: 400 });
        }

        joinSession(wallet);
        const session = getSession();
        const timeRemaining = Math.max(0, Math.floor((session.endTime - Date.now()) / 1000));

        return NextResponse.json({
            success: true,
            sessionId: session.id,
            timeRemaining
        });
    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export const GET = withRateLimit(getHandler);
export const POST = withRateLimit(postHandler);
