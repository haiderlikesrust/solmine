import { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import bs58 from 'bs58';
import { NextResponse } from 'next/server';

// Points to SOL conversion: 1 SOL = 10000 points
const POINTS_PER_SOL = 10000;

export async function POST(req) {
    try {
        const { miners } = await req.json(); // Array of { wallet, points }

        if (!miners || !Array.isArray(miners) || miners.length === 0) {
            return NextResponse.json({ message: 'No miners to reward' }, { status: 400 });
        }

        // 1. Validate environment
        const rpcUrl = process.env.NEXT_PUBLIC_HELIUS_RPC_URL;
        const secretKeyString = process.env.REWARD_WALLET_PRIVATE_KEY;

        if (!rpcUrl || !secretKeyString) {
            console.error("Missing server configuration");
            return NextResponse.json({ message: 'Server misconfiguration' }, { status: 500 });
        }

        // 2. Setup connection and wallet
        const connection = new Connection(rpcUrl, 'confirmed');
        let payer;
        try {
            const secretKey = bs58.decode(secretKeyString);
            payer = Keypair.fromSecretKey(secretKey);
        } catch (e) {
            console.error("Invalid private key format", e);
            return NextResponse.json({ message: 'Server key error' }, { status: 500 });
        }

        // 3. Get reward wallet balance
        const balance = await connection.getBalance(payer.publicKey);
        const balanceSOL = balance / LAMPORTS_PER_SOL;

        // Reserve 0.01 SOL for transaction fees
        const availableSOL = Math.max(0, balanceSOL - 0.01);
        const availableLamports = Math.floor(availableSOL * LAMPORTS_PER_SOL);

        if (availableLamports <= 0) {
            return NextResponse.json({ message: 'Insufficient reward pool balance' }, { status: 500 });
        }

        // 4. Calculate total points
        const totalPoints = miners.reduce((sum, m) => sum + m.points, 0);

        if (totalPoints === 0) {
            return NextResponse.json({ message: 'No points to distribute' }, { status: 400 });
        }

        // 5. Calculate rewards proportionally
        const rewards = miners.map(miner => {
            const share = miner.points / totalPoints;
            const rewardLamports = Math.floor(share * availableLamports);
            return {
                wallet: miner.wallet,
                points: miner.points,
                share: (share * 100).toFixed(2),
                lamports: rewardLamports,
                sol: rewardLamports / LAMPORTS_PER_SOL
            };
        }).filter(r => r.lamports >= 5000); // Min 0.000005 SOL to avoid dust

        if (rewards.length === 0) {
            return NextResponse.json({ message: 'Rewards too small to distribute' }, { status: 400 });
        }

        // 6. Create and send transactions (batch if needed)
        const results = [];

        for (const reward of rewards) {
            try {
                const toPublicKey = new PublicKey(reward.wallet);

                const transaction = new Transaction().add(
                    SystemProgram.transfer({
                        fromPubkey: payer.publicKey,
                        toPubkey: toPublicKey,
                        lamports: reward.lamports,
                    })
                );

                const signature = await sendAndConfirmTransaction(
                    connection,
                    transaction,
                    [payer]
                );

                results.push({
                    wallet: reward.wallet,
                    sol: reward.sol,
                    signature,
                    success: true
                });
            } catch (txError) {
                console.error(`Failed to send to ${reward.wallet}:`, txError);
                results.push({
                    wallet: reward.wallet,
                    sol: reward.sol,
                    error: txError.message,
                    success: false
                });
            }
        }

        return NextResponse.json({
            success: true,
            totalDistributed: results.filter(r => r.success).reduce((s, r) => s + r.sol, 0),
            results
        });

    } catch (error) {
        console.error('Distribution Error:', error);
        return NextResponse.json({ message: 'Internal Server Error', error: error.message }, { status: 500 });
    }
}
