import { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import bs58 from 'bs58';
import { NextResponse } from 'next/server';
import { getSessionForDistribution, markSessionDistributed } from '@/lib/sessionStore';
import { withRateLimit } from '@/lib/security';

// Track if distribution is in progress to prevent double-triggers
let isDistributing = false;
let lastDistributionSession = null;

async function handler(req) {
    try {
        const session = getSessionForDistribution();

        // Prevent double distribution for same session
        if (lastDistributionSession === session.id) {
            return NextResponse.json({
                message: 'Already distributed for this session',
                sessionId: session.id
            }, { status: 200 });
        }

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
            return NextResponse.json({ message: 'Server not configured' }, { status: 500 });
        }

        // Setup connection and wallet
        const connection = new Connection(rpcUrl, 'confirmed');
        let payer;
        try {
            const secretKey = bs58.decode(secretKeyString);
            payer = Keypair.fromSecretKey(secretKey);
        } catch {
            isDistributing = false;
            return NextResponse.json({ message: 'Server key error' }, { status: 500 });
        }

        // Get reward wallet balance
        const balance = await connection.getBalance(payer.publicKey);
        const balanceSOL = balance / LAMPORTS_PER_SOL;

        // Reserve SOL for transaction fees and safety buffer
        // Each transaction costs ~0.000005 SOL, reserve extra for network congestion
        // Reserve: 0.05 SOL base + 0.00001 SOL per miner (for transaction fees)
        const reserveBase = 0.05; // Base reserve for fees and safety
        const reservePerMiner = 0.00001; // Additional reserve per miner transaction
        const totalReserve = reserveBase + (miners.length * reservePerMiner);
        
        const availableSOL = Math.max(0, balanceSOL - totalReserve);
        const availableLamports = Math.floor(availableSOL * LAMPORTS_PER_SOL);

        if (availableLamports <= 0) {
            isDistributing = false;
            lastDistributionSession = session.id;
            return NextResponse.json({ 
                message: 'Insufficient reward pool - need at least ' + totalReserve.toFixed(4) + ' SOL reserved',
                requiredReserve: totalReserve.toFixed(4),
                currentBalance: balanceSOL.toFixed(4)
            }, { status: 200 });
        }

        // Calculate total points
        const totalPoints = miners.reduce((sum, m) => sum + m.points, 0);

        if (totalPoints === 0) {
            isDistributing = false;
            lastDistributionSession = session.id;
            return NextResponse.json({ message: 'No points to distribute' }, { status: 200 });
        }

        // Calculate rewards proportionally: (individual_points / total_points) * reward_wallet_balance
        const rewards = miners.map(miner => {
            // Calculate share: individual_points / total_points
            const share = miner.points / totalPoints;
            // Calculate reward: share * available_balance
            const rewardLamports = Math.floor(share * availableLamports);
            const rewardSOL = rewardLamports / LAMPORTS_PER_SOL;

            return {
                wallet: miner.wallet,
                points: miner.points,
                share: (share * 100).toFixed(2) + '%',
                lamports: rewardLamports,
                sol: rewardSOL
            };
        }).filter(r => r.lamports >= 5000); // Min 0.000005 SOL to avoid dust

        if (rewards.length === 0) {
            isDistributing = false;
            lastDistributionSession = session.id;
            return NextResponse.json({ message: 'Rewards too small' }, { status: 200 });
        }

        // Safety check: Ensure total rewards don't exceed available balance
        const totalRewardLamports = rewards.reduce((sum, r) => sum + r.lamports, 0);
        if (totalRewardLamports > availableLamports) {
            // Scale down rewards proportionally if they exceed available balance
            const scaleFactor = availableLamports / totalRewardLamports;
            rewards.forEach(r => {
                r.lamports = Math.floor(r.lamports * scaleFactor);
                r.sol = r.lamports / LAMPORTS_PER_SOL;
            });
        }

        // Final verification: Ensure we're not trying to send more than available
        const finalTotalLamports = rewards.reduce((sum, r) => sum + r.lamports, 0);
        if (finalTotalLamports > availableLamports) {
            isDistributing = false;
            lastDistributionSession = session.id;
            return NextResponse.json({ 
                message: 'Reward calculation error - exceeds available balance',
                available: availableLamports,
                requested: finalTotalLamports
            }, { status: 500 });
        }

        // Send transactions
        const results = [];
        let totalSentLamports = 0;

        for (const reward of rewards) {
            // Safety check: Don't send if it would exceed available balance
            if (totalSentLamports + reward.lamports > availableLamports) {
                results.push({
                    wallet: reward.wallet.slice(0, 8) + '...',
                    sol: reward.sol.toFixed(6),
                    error: 'Would exceed available balance',
                    fullWallet: reward.wallet,
                    success: false
                });
                continue;
            }
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

                totalSentLamports += reward.lamports;
                
                results.push({
                    wallet: reward.wallet.slice(0, 8) + '...',
                    sol: reward.sol.toFixed(6),
                    signature: signature,
                    fullWallet: reward.wallet,
                    success: true
                });

            } catch (txError) {
                results.push({
                    wallet: reward.wallet.slice(0, 8) + '...',
                    sol: reward.sol.toFixed(6),
                    error: txError.message,
                    fullWallet: reward.wallet,
                    success: false
                });
            }
        }

        isDistributing = false;
        lastDistributionSession = session.id;
        markSessionDistributed(session.id);

        const successfulTx = results.filter(r => r.success);
        if (successfulTx.length > 0) {
            const { addDistribution } = require('@/lib/sessionStore');
            addDistribution(session.id, successfulTx);
        }

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
        return NextResponse.json({
            message: 'Distribution failed',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal error'
        }, { status: 500 });
    }
}

export const POST = withRateLimit(handler);
