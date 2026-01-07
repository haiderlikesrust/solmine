import fs from 'fs';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'data', 'db.json');

// Ensure DB directory exists
if (!fs.existsSync(path.dirname(DB_PATH))) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
}

// Initialize DB if not exists
if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify({
        currentSession: null,
        previousSession: null,
        miners: {}, // sessionId -> { wallet -> { points, joinedAt } }
        ipRateLimits: {}, // ip -> [timestamps]
        walletClickLimits: {} // wallet -> [timestamps]
    }, null, 2));
}

function readDB() {
    try {
        const data = fs.readFileSync(DB_PATH, 'utf8');
        return JSON.parse(data);
    } catch {
        return {
            currentSession: null,
            previousSession: null,
            miners: {},
            ipRateLimits: {},
            walletClickLimits: {}
        };
    }
}

function writeDB(data) {
    try {
        fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
    } catch {
        // Silent fail - file operations may fail in some environments
    }
}

export const db = {
    get: () => readDB(),
    set: (data) => writeDB(data),
    update: (callback) => {
        const data = readDB();
        const newData = callback(data);
        writeDB(newData);
        return newData;
    }
};
