import { Connection, LAMPORTS_PER_SOL, Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { NextResponse } from 'next/server';

export async function GET() {
    try {
        const rpcUrl = process.env.NEXT_PUBLIC_HELIUS_RPC_URL;
        const secretKeyString = process.env.REWARD_WALLET_PRIVATE_KEY;

        if (!rpcUrl || !secretKeyString) {
            return NextResponse.json({
                balance: 0,
                balanceSOL: 0,
                available: 0,
                error: 'Not configured'
            });
        }

        const connection = new Connection(rpcUrl, 'confirmed');
        const secretKey = bs58.decode(secretKeyString);
        const payer = Keypair.fromSecretKey(secretKey);

        const balance = await connection.getBalance(payer.publicKey);
        const balanceSOL = balance / LAMPORTS_PER_SOL;
        const availableSOL = Math.max(0, balanceSOL - 0.01); // Reserve for fees

        return NextResponse.json({
            balance,
            balanceSOL: balanceSOL.toFixed(6),
            available: availableSOL.toFixed(6),
            walletAddress: payer.publicKey.toString().slice(0, 8) + '...'
        });
    } catch (error) {
        return NextResponse.json({
            balance: 0,
            balanceSOL: 0,
            available: 0,
            error: error.message
        });
    }
}
