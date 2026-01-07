// Obfuscated encryption utilities for API security
const SECRET_KEY = process.env.API_ENCRYPTION_KEY || 'k3pcl1ck1ng_s3cr3t_k3y_2024';
const NONCE_LENGTH = 8;
const TIMESTAMP_TOLERANCE = 30000; // 30 seconds

// Simple XOR cipher with key rotation
function xorEncrypt(text, key) {
  let result = '';
  for (let i = 0; i < text.length; i++) {
    result += String.fromCharCode(text.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  }
  return result;
}

// Generate obfuscated payload
export function encryptPayload(data) {
  try {
    // Add timestamp and random nonce
    const timestamp = Date.now();
    const nonce = Array.from({ length: NONCE_LENGTH }, () => 
      Math.floor(Math.random() * 256)
    ).map(b => String.fromCharCode(b)).join('');
    
    const payload = {
      d: data,
      t: timestamp,
      n: nonce
    };
    
    const jsonStr = JSON.stringify(payload);
    const encrypted = xorEncrypt(jsonStr, SECRET_KEY);
    
    // Base64 encode and add obfuscation
    let base64;
    if (typeof Buffer !== 'undefined') {
      // Node.js environment
      base64 = Buffer.from(encrypted, 'binary').toString('base64');
    } else {
      // Browser environment
      base64 = btoa(encrypted);
    }
    
    // Add some obfuscation: reverse and add padding
    const reversed = base64.split('').reverse().join('');
    const obfuscated = btoa(reversed + '|' + timestamp.toString(36));
    
    return obfuscated;
  } catch (error) {
    throw new Error('Encryption failed');
  }
}

// Decrypt and validate payload
export function decryptPayload(encryptedData) {
  try {
    // Reverse obfuscation
    const decoded = atob(encryptedData);
    const parts = decoded.split('|');
    if (parts.length !== 2) {
      throw new Error('Invalid payload format');
    }
    
    const reversed = parts[0].split('').reverse().join('');
    let encrypted;
    if (typeof Buffer !== 'undefined') {
      // Node.js environment
      encrypted = Buffer.from(reversed, 'base64').toString('binary');
    } else {
      // Browser environment
      encrypted = atob(reversed);
    }
    
    // Decrypt
    const decrypted = xorEncrypt(encrypted, SECRET_KEY);
    const payload = JSON.parse(decrypted);
    
    // Validate timestamp (prevent replay attacks)
    const now = Date.now();
    const age = now - payload.t;
    if (age < 0 || age > TIMESTAMP_TOLERANCE) {
      throw new Error('Payload expired or invalid timestamp');
    }
    
    // Validate nonce exists
    if (!payload.n || payload.n.length !== NONCE_LENGTH) {
      throw new Error('Invalid nonce');
    }
    
    return payload.d;
  } catch (error) {
    throw new Error('Decryption failed: ' + error.message);
  }
}

// Generate a hash for additional validation (server-side only)
export function generateHash(data, timestamp) {
  if (typeof require !== 'undefined') {
    const crypto = require('crypto');
    const str = JSON.stringify(data) + timestamp + SECRET_KEY;
    return crypto.createHash('sha256').update(str).digest('hex').substring(0, 16);
  }
  return null;
}

