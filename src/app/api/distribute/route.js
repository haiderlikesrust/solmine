import { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import bs58 from 'bs58';
import { NextResponse } from 'next/server';
import { getSessionForDistribution, markSessionDistributed } from '@/lib/sessionStore';

// Track if distribution is in progress to prevent double-triggers
let isDistributing = false;
let lastDistributionSession = null;

export async function POST(req) {
    try {
        const session = getSessionForDistribution();
        const timeRemaining = Math.max(0, Math.floor((session.endTime - Date.now()) / 1000));

        // Log for debugging
        console.log(`Distribution triggered. Session: ${session.id}, Miners: ${session.miners.size}`);

        // Prevent double distribution for same session
        /* DISABLED FOR TESTING
        if (lastDistributionSession === session.id) {
            return NextResponse.json({
                message: 'Already distributed for this session',
                sessionId: session.id
            }, { status: 200 });
        }
        */

        // Prevent concurrent distribution
        if (isDistributing) {
            return NextResponse.json({
                message: 'Distribution in progress'
            }, { status: 200 });
        }

        isDistributing = true;

        // Get miners from session
        const miners = [];
        session.miners.forEach((data, wallet) => {
            if (data.points > 0) {
                miners.push({ wallet, points: data.points });
            }
        });

        if (miners.length === 0) {
            isDistributing = false;
            lastDistributionSession = session.id;
            return NextResponse.json({ message: 'No miners to reward' }, { status: 200 });
        }

        // Validate environment
        const rpcUrl = process.env.NEXT_PUBLIC_HELIUS_RPC_URL;
        const secretKeyString = process.env.REWARD_WALLET_PRIVATE_KEY;

        if (!rpcUrl || !secretKeyString) {
            isDistributing = false;
            console.error("Missing server configuration");
            return NextResponse.json({ message: 'Server not configured' }, { status: 500 });
        }

        // Setup connection and wallet
        const connection = new Connection(rpcUrl, 'confirmed');
        let payer;
        try {
            const secretKey = bs58.decode(secretKeyString);
            payer = Keypair.fromSecretKey(secretKey);
        } catch (e) {
            isDistributing = false;
            console.error("Invalid private key format", e);
            return NextResponse.json({ message: 'Server key error' }, { status: 500 });
        }

        // Get reward wallet balance
        const balance = await connection.getBalance(payer.publicKey);
        const balanceSOL = balance / LAMPORTS_PER_SOL;

        // Reserve 0.01 SOL for transaction fees
        const availableSOL = Math.max(0, balanceSOL - 0.01);
        const availableLamports = Math.floor(availableSOL * LAMPORTS_PER_SOL);

        if (availableLamports <= 0) {
            isDistributing = false;
            lastDistributionSession = session.id;
            return NextResponse.json({ message: 'Insufficient reward pool' }, { status: 200 });
        }

        // Calculate total points
        const totalPoints = miners.reduce((sum, m) => sum + m.points, 0);

        // Calculate rewards based on FIXED RATE: 100,000 Points = 1 SOL
        const rewards = miners.map(miner => {
            // 1 Point = 0.00001 SOL
            const rewardSOL = miner.points / 100000;
            const rewardLamports = Math.floor(rewardSOL * LAMPORTS_PER_SOL);

            return {
                wallet: miner.wallet,
                points: miner.points,
                share: 'Fixed Rate',
                lamports: rewardLamports,
                sol: rewardSOL
            };
        }).filter(r => r.lamports >= 5000); // Min 0.000005 SOL to avoid dust

        // Check if total needed exceeds available balance
        const totalNeededLamports = rewards.reduce((sum, r) => sum + r.lamports, 0);

        if (totalNeededLamports > availableLamports) {
            // If we don't have enough, revert to proportional distribution of what we have
            const scalingFactor = availableLamports / totalNeededLamports;
            rewards.forEach(r => {
                r.lamports = Math.floor(r.lamports * scalingFactor);
                r.sol = r.lamports / LAMPORTS_PER_SOL;
            });
        }

        if (rewards.length === 0) {
            isDistributing = false;
            lastDistributionSession = session.id;
            return NextResponse.json({ message: 'Rewards too small' }, { status: 200 });
        }

        // Send transactions
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
                    wallet: reward.wallet.slice(0, 8) + '...',
                    sol: reward.sol.toFixed(6),
                    signature: signature.slice(0, 16) + '...',
                    success: true
                });

                console.log(`Sent ${reward.sol} SOL to ${reward.wallet.slice(0, 8)}...`);
            } catch (txError) {
                console.error(`Failed to send to ${reward.wallet}:`, txError.message);
                results.push({
                    wallet: reward.wallet.slice(0, 8) + '...',
                    sol: reward.sol.toFixed(6),
                    error: txError.message,
                    success: false
                });
            }
        }

        isDistributing = false;
        lastDistributionSession = session.id;
        markSessionDistributed(session.id); // Mark as complete in store

        const totalDistributed = results
            .filter(r => r.success)
            .reduce((s, r) => s + parseFloat(r.sol), 0);

        return NextResponse.json({
            success: true,
            sessionId: session.id,
            totalDistributed: totalDistributed.toFixed(6),
            minerCount: results.length,
            results
        });

    } catch (error) {
        isDistributing = false;
        console.error('Distribution Error:', error);
        return NextResponse.json({
            message: 'Distribution failed',
            error: error.message
        }, { status: 500 });
    }
}
