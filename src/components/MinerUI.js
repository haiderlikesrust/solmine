'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export default function MinerUI() {
    const [walletAddress, setWalletAddress] = useState('');
    const [isWalletSet, setIsWalletSet] = useState(false);
    const [points, setPoints] = useState(0);
    const [timeLeft, setTimeLeft] = useState(60);
    const [miningActive, setMiningActive] = useState(false);
    const [statusMessage, setStatusMessage] = useState('');
    const [clicks, setClicks] = useState([]);
    const [leaderboard, setLeaderboard] = useState([]);
    const [sessionStats, setSessionStats] = useState({
        totalPoints: 0,
        minerCount: 0
    });
    const [poolInfo, setPoolInfo] = useState({
        available: 0,
        balanceSOL: 0
    });
    const [pendingPoints, setPendingPoints] = useState(0);
    const [clickCount, setClickCount] = useState(0);
    const [soundEnabled, setSoundEnabled] = useState(true);
    const audioContextRef = useRef(null);
    const [miningStats, setMiningStats] = useState({
        totalSessions: 0,
        totalPoints: 0,
        totalClicks: 0,
        bestSession: 0,
        averageEfficiency: 0,
        totalSOLEarned: 0
    });

    const fetchPool = useCallback(async () => {
        try {
            const res = await fetch('/api/pool');
            const data = await res.json();
            setPoolInfo({
                available: parseFloat(data.available) || 0,
                balanceSOL: parseFloat(data.balanceSOL) || 0
            });
        } catch {
            // Silent fail - will retry on next interval
        }
    }, []);

    const fetchSession = useCallback(async () => {
        try {
            const res = await fetch('/api/session');
            const data = await res.json();
            setTimeLeft(data.timeRemaining);
            setLeaderboard(data.leaderboard || []);
            setSessionStats({
                totalPoints: data.totalPoints,
                minerCount: data.minerCount
            });
        } catch {
            // Silent fail - will retry on next interval
        }
    }, []);

    // Use ref for pendingPoints to avoid re-creating syncPoints on every click
    const pendingPointsRef = useRef(pendingPoints);
    useEffect(() => {
        pendingPointsRef.current = pendingPoints;
    }, [pendingPoints]);

    const syncPoints = useCallback(async () => {
        const pointsToSync = pendingPointsRef.current;
        if (pointsToSync > 0 && walletAddress) {
            try {
                await fetch('/api/mine', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ wallet: walletAddress, points: pointsToSync })
                });
                setPendingPoints(prev => Math.max(0, prev - pointsToSync));
            } catch {
                // Silent fail - will retry on next sync
            }
        }
    }, [walletAddress]);

    // Sound functions using Web Audio API
    const initAudio = useCallback(() => {
        if (!audioContextRef.current && typeof window !== 'undefined') {
            audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
        }
    }, []);

    const playSound = useCallback((frequency, duration, type = 'sine') => {
        if (!soundEnabled || !audioContextRef.current) return;

        const oscillator = audioContextRef.current.createOscillator();
        const gainNode = audioContextRef.current.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioContextRef.current.destination);

        oscillator.frequency.setValueAtTime(frequency, audioContextRef.current.currentTime);
        oscillator.type = type;

        gainNode.gain.setValueAtTime(0.1, audioContextRef.current.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContextRef.current.currentTime + duration);

        oscillator.start(audioContextRef.current.currentTime);
        oscillator.stop(audioContextRef.current.currentTime + duration);
    }, [soundEnabled]);

    const playClickSound = useCallback(() => playSound(800, 0.1, 'square'), [playSound]);
    const playStartSound = useCallback(() => playSound(600, 0.3), [playSound]);
    const playEndSound = useCallback(() => playSound(400, 0.5), [playSound]);
    const playRewardSound = useCallback(() => {
        playSound(800, 0.2);
        setTimeout(() => playSound(1000, 0.2), 100);
        setTimeout(() => playSound(1200, 0.3), 200);
    }, [playSound]);

    // Keep a ref to the latest syncPoints so we don't restart the interval when it changes
    const syncPointsRef = useRef(syncPoints);
    useEffect(() => {
        syncPointsRef.current = syncPoints;
    }, [syncPoints]);

    useEffect(() => {
        fetchSession();
        fetchPool();
        initAudio();
        const interval = setInterval(() => {
            fetchSession();
            fetchPool();
            if (syncPointsRef.current) syncPointsRef.current();
        }, 3000);
        return () => clearInterval(interval);
    }, [fetchSession, fetchPool, initAudio]);

    // Trigger distribution when session ends
    const triggerDistribution = useCallback(async () => {
        try {
            setStatusMessage('💰 Distributing rewards...');
            const res = await fetch('/api/distribute', { method: 'POST' });
            const data = await res.json();
            if (data.success) {
                playRewardSound();
                setStatusMessage(`🎉 Distributed ${data.totalDistributed} SOL to ${data.minerCount} clickers!`);
            } else {
                setStatusMessage(data.message || 'Distribution complete');
            }
        } catch {
            setStatusMessage('Distribution triggered');
        }
    }, [playRewardSound]);

    // Timer countdown effect
    useEffect(() => {
        const timer = setInterval(() => {
            setTimeLeft(prev => {
                const newValue = prev - 1;
                // If timer hits 0, it should stay 0 until server says otherwise
                return Math.max(0, newValue);
            });
        }, 1000);
        return () => clearInterval(timer);
    }, []);

    // Session completion handler
    useEffect(() => {
        if (timeLeft <= 0 && miningActive) {
            setMiningActive(false);
            playEndSound();
            syncPoints();
            triggerDistribution();
        }

        // If timer is stuck at 0 for too long (>5s), force a session refresh
        if (timeLeft === 0 && !miningActive) {
            const stuckTimer = setTimeout(() => {
                fetchSession(); // Force refresh to pick up new session
            }, 5000);
            return () => clearTimeout(stuckTimer);
        }
    }, [timeLeft, miningActive, syncPoints, triggerDistribution, fetchSession, playEndSound]);

    const handleWalletSubmit = async (e) => {
        e.preventDefault();
        if (walletAddress.length >= 32 && walletAddress.length <= 44) {
            try {
                await fetch('/api/session', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ wallet: walletAddress })
                });
                setIsWalletSet(true);
                setStatusMessage('✅ Wallet registered! Ready to click.');
            } catch (err) {
                setStatusMessage('❌ Failed to join session');
            }
        } else {
            setStatusMessage('❌ Invalid wallet address');
        }
    };

    const handleStart = () => {
        setMiningActive(true);
        setStatusMessage('🖱️ Clicking active! Tap the orb!');
        playStartSound();
    };

    const handleMine = (e) => {
        if (!miningActive || timeLeft <= 0) return;

        setPoints(prev => prev + 1);
        setPendingPoints(prev => prev + 1);
        setClickCount(prev => prev + 1);

        playClickSound();

        const id = Date.now() + Math.random();
        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        setClicks(prev => [...prev, { id, x, y }]);
        setTimeout(() => {
            setClicks(prev => prev.filter(c => c.id !== id));
        }, 600);
    };

    const formatTime = (seconds) => {
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    };

    const getUserRank = () => {
        const idx = leaderboard.findIndex(l => l.fullWallet === walletAddress);
        return idx >= 0 ? idx + 1 : '-';
    };

    const getEstimatedReward = () => {
        if (points === 0) return '0.000000';

        // Fixed Rate: 100,000 Points = 1 SOL
        const estimatedSOL = points / 100000;

        // Cap at available pool balance
        const cappedReward = Math.min(estimatedSOL, poolInfo.available);
        return cappedReward.toFixed(6);
    };

    const isPoolLow = poolInfo.available < 0.1;
    const sessionProgress = ((60 - timeLeft) / 60) * 100;

    return (
        <div className="app-container">
            {/* Animated Background */}
            <div className="bg-grid" />
            <div className="bg-gradient" />
            <div className="floating-orbs">
                <div className="orb orb-1" />
                <div className="orb orb-2" />
                <div className="orb orb-3" />
            </div>

            {/* Header */}
            <header className="site-header">
                <div className="logo">
                    <img src="/logo.jpg" alt="KEEPCLICKING" className="logo-img" />
                    <span className="logo-text">KEEPCLICKING</span>
                </div>
                <div className="header-stats">
                    <div className="header-stat">
                        <span className="header-stat-label">Active Clickers</span>
                        <span className="header-stat-value">{sessionStats.minerCount}</span>
                    </div>
                    <div className="header-stat">
                        <span className="header-stat-label">Total Points</span>
                        <span className="header-stat-value">{sessionStats.totalPoints.toLocaleString()}</span>
                    </div>
                    <div className="header-stat">
                        <span className="header-stat-label">Reward Pool</span>
                        <span className={`header-stat-value ${isPoolLow ? 'pool-low' : 'pool-ok'}`}>
                            {poolInfo.available.toFixed(4)} SOL
                        </span>
                    </div>
                    <div className="header-stat">
                        <button
                            onClick={() => setSoundEnabled(!soundEnabled)}
                            className="sound-toggle"
                            title={soundEnabled ? 'Disable Sound' : 'Enable Sound'}
                        >
                            {soundEnabled ? '🔊' : '🔇'}
                        </button>
                    </div>
                </div>
            </header>

            {/* Main Content */}
            <main className="main-content">
                {/* Top Row */}
                <div className="top-row">
                    {/* Left Panel */}
                    <div className="side-panel glass-card">
                        <div className="panel-header">
                            <div className="panel-icon">📋</div>
                            <h3 className="panel-title">How It Works</h3>
                        </div>

                        <div className="pool-display ${isPoolLow ? 'low' : ''}">
                            <div className="pool-label">Current Reward Pool</div>
                            <div className="pool-value">{poolInfo.available.toFixed(4)} SOL</div>
                            <div className="pool-subtext">Distributed at session end</div>
                        </div>

                        <div className="steps-list">
                            <div className="step-item">
                                <span className="step-number">01</span>
                                <div className="step-content">
                                    <h4>Connect Wallet</h4>
                                    <p>Enter your Solana wallet address to join the clicking session</p>
                                </div>
                            </div>
                            <div className="step-item">
                                <span className="step-number">02</span>
                                <div className="step-content">
                                    <h4>Click to Earn Points</h4>
                                    <p>Tap the clicking orb to accumulate points during the session</p>
                                </div>
                            </div>
                            <div className="step-item">
                                <span className="step-number">03</span>
                                <div className="step-content">
                                    <h4>Earn SOL</h4>
                                    <p>Pool is split proportionally based on your share of total points</p>
                                </div>
                            </div>
                        </div>

                        <div className="reward-info">
                            <div className="reward-info-title">Distribution Method</div>
                            <div className="reward-info-value">Your Points ÷ Total Points × Pool</div>
                        </div>
                    </div>

                    {/* Center - Mining Area */}
                    <div className="mine-container">
                        <motion.div
                            className="mine-card"
                            initial={{ opacity: 0, y: 30 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.5 }}
                        >
                            {/* Session Timer */}
                            <div className="session-timer">
                                <div className="timer-label">Session Ends In</div>
                                <motion.div
                                    className={`timer-value ${timeLeft < 60 ? 'warning' : ''}`}
                                    key={timeLeft}
                                    initial={{ scale: 1.05 }}
                                    animate={{ scale: 1 }}
                                >
                                    {formatTime(timeLeft)}
                                </motion.div>
                            </div>

                            {!isWalletSet ? (
                                <motion.form
                                    onSubmit={handleWalletSubmit}
                                    className="wallet-form"
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                >
                                    <div className="form-group">
                                        <label className="form-label">Solana Wallet Address</label>
                                        <input
                                            type="text"
                                            value={walletAddress}
                                            onChange={(e) => setWalletAddress(e.target.value)}
                                            placeholder="Enter your SOL address..."
                                            className="wallet-input"
                                        />
                                    </div>
                                    <motion.button
                                        type="submit"
                                        className="submit-btn"
                                        whileHover={{ scale: 1.02 }}
                                        whileTap={{ scale: 0.98 }}
                                    >
                                        🔓 Start Clicking
                                    </motion.button>
                                </motion.form>
                            ) : (
                                <>
                                    <div className="wallet-display">
                                        <span className="wallet-icon">👛</span>
                                        <span className="wallet-address">
                                            {walletAddress.slice(0, 6)}...{walletAddress.slice(-6)}
                                        </span>
                                    </div>

                                    <div className="points-display">
                                        <motion.div
                                            className="points-value"
                                            key={points}
                                            initial={{ scale: 1.1 }}
                                            animate={{ scale: 1 }}
                                            transition={{ type: "spring", stiffness: 400 }}
                                        >
                                            {points.toLocaleString()}
                                        </motion.div>
                                        <div className="points-label">Points Earned</div>
                                        <div className="estimated-reward">
                                            <span>Est. Reward:</span>
                                            <span className="reward-value">{getEstimatedReward()} SOL</span>
                                        </div>
                                    </div>

                                    <div className="clicking-orb-container">
                                        <motion.div
                                            className={`clicking-orb ${!miningActive ? 'inactive' : ''}`}
                                            whileHover={miningActive ? { scale: 1.05 } : {}}
                                            whileTap={miningActive ? { scale: 0.95, rotate: -5 } : {}}
                                            onClick={handleMine}
                                        >
                                            <div className="orb-inner">
                                                <motion.span
                                                    className="orb-emoji"
                                                    animate={miningActive ? {
                                                        rotate: [0, -3, 3, 0],
                                                    } : {}}
                                                    transition={{ repeat: Infinity, duration: 1.5 }}
                                                >
                                                    💎
                                                </motion.span>
                                            </div>
                                        </motion.div>

                                        <AnimatePresence>
                                            {clicks.map((click) => (
                                                <motion.div
                                                    key={click.id}
                                                    initial={{ opacity: 1, scale: 0.5, x: click.x - 100, y: click.y - 100 }}
                                                    animate={{ opacity: 0, scale: 2, y: click.y - 180 }}
                                                    exit={{ opacity: 0 }}
                                                    transition={{ duration: 0.5 }}
                                                    className="spark-particle"
                                                >
                                                    ✨
                                                </motion.div>
                                            ))}
                                        </AnimatePresence>
                                    </div>

                                    {miningActive && (
                                        <div className="clicking-progress">
                                            <div className="progress-label">
                                                <span>Session Progress</span>
                                                <span>{sessionProgress.toFixed(0)}%</span>
                                            </div>
                                            <div className="progress-bar">
                                                <motion.div
                                                    className="progress-fill"
                                                    initial={{ width: 0 }}
                                                    animate={{ width: `${sessionProgress}%` }}
                                                />
                                            </div>
                                        </div>
                                    )}

                                    {!miningActive && timeLeft > 0 && (
                                        <motion.button
                                            onClick={handleStart}
                                            className="start-btn"
                                            whileHover={{ scale: 1.02 }}
                                            whileTap={{ scale: 0.98 }}
                                        >
                                            🖱️ Start Clicking
                                        </motion.button>
                                    )}
                                </>
                            )}

                            <AnimatePresence>
                                {statusMessage && (
                                    <motion.div
                                        className="status-message"
                                        initial={{ opacity: 0, y: 10 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0 }}
                                    >
                                        {statusMessage}
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </motion.div>
                    </div>
                </div> {/* End top-row */}

                {/* Bottom Row - Statistics Dashboard */}
                <div className="bottom-row">
                    <div className="stats-dashboard glass-card">
                        <div className="panel-header">
                            <div className="panel-icon">📊</div>
                            <h3 className="panel-title">Mining Statistics</h3>
                        </div>

                        <div className="stats-grid">
                            <div className="stat-card">
                                <div className="stat-icon">🎯</div>
                                <div className="stat-info">
                                    <div className="stat-value">{miningStats.totalSessions}</div>
                                    <div className="stat-label">Sessions Mined</div>
                                </div>
                            </div>

                            <div className="stat-card">
                                <div className="stat-icon">⚡</div>
                                <div className="stat-info">
                                    <div className="stat-value">{miningStats.averageEfficiency.toFixed(1)}</div>
                                    <div className="stat-label">Avg Points/Session</div>
                                </div>
                            </div>

                            <div className="stat-card">
                                <div className="stat-icon">🏆</div>
                                <div className="stat-info">
                                    <div className="stat-value">{miningStats.bestSession.toLocaleString()}</div>
                                    <div className="stat-label">Best Session</div>
                                </div>
                            </div>

                            <div className="stat-card">
                                <div className="stat-icon">💎</div>
                                <div className="stat-info">
                                    <div className="stat-value">{miningStats.totalSOLEarned.toFixed(4)}</div>
                                    <div className="stat-label">Total SOL Earned</div>
                                </div>
                            </div>

                            <div className="stat-card">
                                <div className="stat-icon">🖱️</div>
                                <div className="stat-info">
                                    <div className="stat-value">{miningStats.totalClicks.toLocaleString()}</div>
                                    <div className="stat-label">Total Clicks</div>
                                </div>
                            </div>

                            <div className="stat-card">
                                <div className="stat-icon">📈</div>
                                <div className="stat-info">
                                    <div className="stat-value">
                                        {miningStats.totalClicks > 0 ? (miningStats.totalPoints / miningStats.totalClicks * 100).toFixed(1) : 0}%
                                    </div>
                                    <div className="stat-label">Click Efficiency</div>
                                </div>
                            </div>
                        </div>
                    </div> {/* End bottom-row */}
                </div>

                {/* Right Panel - Leaderboard */}
                <div className="side-panel glass-card">
                    <div className="panel-header">
                        <div className="panel-icon">🏆</div>
                        <h3 className="panel-title">Leaderboard</h3>
                    </div>

                    {isWalletSet && (
                        <div className="user-stats">
                            <div className="user-stat">
                                <div className="user-stat-icon">🎯</div>
                                <div className="user-stat-value">{getUserRank()}</div>
                                <div className="user-stat-label">Your Rank</div>
                            </div>
                            <div className="user-stat">
                                <div className="user-stat-icon">💰</div>
                                <div className="user-stat-value">{getEstimatedReward()}</div>
                                <div className="user-stat-label">Est. SOL</div>
                            </div>
                            <div className="user-stat">
                                <div className="user-stat-icon">⚡</div>
                                <div className="user-stat-value">{points.toLocaleString()}</div>
                                <div className="user-stat-label">Points</div>
                            </div>
                            <div className="user-stat">
                                <div className="user-stat-icon">🖱️</div>
                                <div className="user-stat-value">{clickCount}</div>
                                <div className="user-stat-label">Clicks</div>
                            </div>
                        </div>
                    )}

                    <div className="leaderboard-list">
                        {leaderboard.length > 0 ? (
                            leaderboard.map((miner, idx) => (
                                <motion.div
                                    key={miner.wallet}
                                    className={`leaderboard-item 
                                        ${idx === 0 ? 'top-1' : ''} 
                                        ${idx === 1 ? 'top-2' : ''} 
                                        ${idx === 2 ? 'top-3' : ''} 
                                        ${miner.fullWallet === walletAddress ? 'is-you' : ''}`}
                                    initial={{ opacity: 0, x: 20 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    transition={{ delay: idx * 0.05 }}
                                >
                                    <div className="rank-badge">
                                        {idx === 0 ? '👑' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : idx + 1}
                                    </div>
                                    <span className="leaderboard-wallet">
                                        {miner.wallet}
                                        {miner.fullWallet === walletAddress && ' (You)'}
                                    </span>
                                    <span className="leaderboard-points">{miner.points.toLocaleString()}</span>
                                </motion.div>
                            ))
                        ) : (
                            <div className="leaderboard-empty">
                                No clickers yet. Be the first! 🚀
                            </div>
                        )}
                    </div>
                </div>
            </main>
        </div>
    );
}
