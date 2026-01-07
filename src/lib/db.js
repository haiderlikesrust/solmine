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
        miners: {} // sessionId -> { wallet -> { points, joinedAt } }
    }, null, 2));
}

function readDB() {
    try {
        const data = fs.readFileSync(DB_PATH, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        console.error('DB Read Error:', err);
        return { currentSession: null, previousSession: null, miners: {} };
    }
}

function writeDB(data) {
    try {
        fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
    } catch (err) {
        console.error('DB Write Error:', err);
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
