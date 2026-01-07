import { db } from './db';

// Session duration: 15 minutes
const SESSION_DURATION_MS = 2 * 60 * 1000;

// Helper to create a new session
function createNewSession() {
    return {
        id: Date.now(),
        startTime: Date.now(),
        endTime: Date.now() + SESSION_DURATION_MS,
        isDistributing: false,
        distributed: false
    };
}

// Check session status and rotate if needed
function checkAndRotateSession(data) {
    let { currentSession, miners } = data;
    const now = Date.now();

    // Initialize miners object if missing
    if (!miners) {
        data.miners = {};
        miners = data.miners;
    }

    // Initialize if missing
    if (!currentSession) {
        currentSession = createNewSession();
        data.currentSession = currentSession;
        if (!miners[currentSession.id]) {
            miners[currentSession.id] = {};
        }
        return true; // modified
    }

    // Check if expired and rotate
    // ALWAYS rotate if time is up. Distribution handles previousSession.
    if (now >= currentSession.endTime) {
        // Move current to previous (preserve data for later distribution)
        data.previousSession = {
            ...currentSession,
            miners: { ...miners[currentSession.id] }
        };

        // Create new session immediately
        currentSession = createNewSession();
        data.currentSession = currentSession;
        miners[currentSession.id] = {};

        // Save changes immediately
        return true;
    }

    return false;
}

export function getSession() {
    let data = db.get();
    if (checkAndRotateSession(data)) {
        db.set(data);
        data = db.get();
    }

    // Attach miners to session object for API consumption (converting from DB structure)
    const session = { ...data.currentSession };
    // Convert object to Map for compatibility if needed, or just return as Map-like object
    // The previous code expected a Map, let's adapt it to return a Map to minimize breakage elsewhere
    const sessionMiners = data.miners[session.id] || {};
    session.miners = new Map(Object.entries(sessionMiners));

    return session;
}

// Special function for distribution that gets the CLOSED session
export function getSessionForDistribution() {
    let data = db.get();
    if (checkAndRotateSession(data)) {
        db.set(data);
        data = db.get();
    }

    // If we have a previous session waiting for distribution, return that
    if (data.previousSession && !data.previousSession.distributed) {
        const session = { ...data.previousSession };
        // The miners are already stored in previousSession object during rotation (see checkAndRotateSession)
        // ensure it's a map for consistency
        session.miners = new Map(Object.entries(session.miners || {}));
        return session;
    }

    // Otherwise return current (shouldn't really happen for distribution trigger usually, unless logic changes)
    const session = { ...data.currentSession };
    const sessionMiners = data.miners[session.id] || {};
    session.miners = new Map(Object.entries(sessionMiners));
    return session;
}

export function markSessionDistributed(sessionId) {
    db.update(data => {
        if (data.previousSession && data.previousSession.id === sessionId) {
            data.previousSession.distributed = true;
        }
        if (data.currentSession && data.currentSession.id === sessionId) {
            data.currentSession.distributed = true;
        }
        return data;
    });
}

export function joinSession(wallet) {
    db.update(data => {
        checkAndRotateSession(data);
        const sessionId = data.currentSession.id;

        if (!data.miners[sessionId]) {
            data.miners[sessionId] = {};
        }

        if (!data.miners[sessionId][wallet]) {
            data.miners[sessionId][wallet] = { points: 0, joinedAt: Date.now() };
        }
        return data;
    });
    return getSession();
}

export function submitPoints(wallet, points) {
    db.update(data => {
        checkAndRotateSession(data);
        const sessionId = data.currentSession.id;

        if (!data.miners[sessionId]) {
            data.miners[sessionId] = {};
        }

        if (data.miners[sessionId][wallet]) {
            data.miners[sessionId][wallet].points += points;
        } else {
            data.miners[sessionId][wallet] = { points, joinedAt: Date.now() };
        }
        return data;
    });
    return getSession();
}

export function getLeaderboard() {
    const session = getSession();
    return Array.from(session.miners.entries())
        .map(([wallet, data]) => ({
            wallet: `${wallet.slice(0, 4)}...${wallet.slice(-4)}`,
            fullWallet: wallet,
            points: data.points
        }))
        .sort((a, b) => b.points - a.points)
        .slice(0, 50);
}

export function getTotalPoints() {
    const session = getSession();
    let total = 0;
    session.miners.forEach((data) => {
        total += data.points;
    });
    return total;
}

export function getMinerCount() {
    const session = getSession();
    return session.miners.size;
}

export function addDistribution(sessionId, transactions) {
    db.update(data => {
        if (!data.distributions) {
            data.distributions = [];
        }

        // Add new transactions to the history
        const newDistributions = transactions.map(tx => ({
            ...tx,
            sessionId,
            timestamp: Date.now()
        }));

        // Keep last 100 payouts
        data.distributions = [...newDistributions, ...data.distributions].slice(0, 100);
        return data;
    });
}

export function getDistributions() {
    const data = db.get();
    return data.distributions || [];
}
