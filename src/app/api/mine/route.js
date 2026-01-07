import { NextResponse } from 'next/server';
import { submitPoints, getSession } from '@/lib/sessionStore';
import { withRateLimit, withWalletClickLimit } from '@/lib/security';
import { decryptPayload } from '@/lib/encryption';

async function handler(req) {
    try {
        // Get encrypted payload
        const body = await req.json();
        const { p: encryptedPayload } = body;

        if (!encryptedPayload || typeof encryptedPayload !== 'string') {
            return NextResponse.json({ error: 'Invalid request format' }, { status: 400 });
        }

        // Decrypt and validate payload
        let decryptedData;
        try {
            decryptedData = decryptPayload(encryptedPayload);
        } catch (decryptError) {
            return NextResponse.json({ 
                error: 'Invalid or tampered request',
                code: 'DECRYPT_FAIL'
            }, { status: 400 });
        }

        const { wallet, points } = decryptedData;

        // Validate decrypted data
        if (!wallet || typeof wallet !== 'string' || wallet.length < 32 || wallet.length > 44) {
            return NextResponse.json({ error: 'Invalid wallet address' }, { status: 400 });
        }

        if (typeof points !== 'number' || points <= 0 || points > 100) {
            // Limit points per request to prevent abuse
            return NextResponse.json({ error: 'Invalid points value' }, { status: 400 });
        }

        // Additional validation: points should be reasonable (1-100 per request)
        if (!Number.isInteger(points)) {
            return NextResponse.json({ error: 'Points must be an integer' }, { status: 400 });
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
        return NextResponse.json({ 
            error: 'Server error',
            message: process.env.NODE_ENV === 'development' ? error.message : 'Internal error'
        }, { status: 500 });
    }
}

export const POST = withRateLimit(withWalletClickLimit(handler));
