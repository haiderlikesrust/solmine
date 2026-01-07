import { db } from './db';

// Rate limiting constants
const IP_RATE_LIMIT = {
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 1000 // 1000 requests per minute
};

const WALLET_CLICK_LIMIT = {
  windowMs: 1000, // 1 second
  maxClicks: 25 // 25 clicks per second
};

// Clean up old rate limit entries
function cleanupOldEntries(data) {
  const now = Date.now();
  const ipWindowStart = now - IP_RATE_LIMIT.windowMs;
  const walletWindowStart = now - WALLET_CLICK_LIMIT.windowMs;

  // Clean up IP rate limits
  if (data.ipRateLimits) {
    Object.keys(data.ipRateLimits).forEach(ip => {
      data.ipRateLimits[ip] = data.ipRateLimits[ip].filter(
        timestamp => timestamp > ipWindowStart
      );
      if (data.ipRateLimits[ip].length === 0) {
        delete data.ipRateLimits[ip];
      }
    });
  }

  // Clean up wallet click limits
  if (data.walletClickLimits) {
    Object.keys(data.walletClickLimits).forEach(wallet => {
      data.walletClickLimits[wallet] = data.walletClickLimits[wallet].filter(
        timestamp => timestamp > walletWindowStart
      );
      if (data.walletClickLimits[wallet].length === 0) {
        delete data.walletClickLimits[wallet];
      }
    });
  }

  return data;
}

// Check IP rate limit
export function checkIpRateLimit(ip) {
  let result = { allowed: false, remaining: 0 };

  db.update(data => {
    // Ensure we have all required fields
    if (!data.currentSession) data.currentSession = null;
    if (!data.previousSession) data.previousSession = null;
    if (!data.miners) data.miners = {};
    if (!data.ipRateLimits) data.ipRateLimits = {};
    if (!data.walletClickLimits) data.walletClickLimits = {};

    data = cleanupOldEntries(data);

    if (!data.ipRateLimits[ip]) {
      data.ipRateLimits[ip] = [];
    }

    // Check if under limit
    if (data.ipRateLimits[ip].length < IP_RATE_LIMIT.maxRequests) {
      data.ipRateLimits[ip].push(Date.now());
      result = { allowed: true, remaining: IP_RATE_LIMIT.maxRequests - data.ipRateLimits[ip].length };
    } else {
      result = { allowed: false, remaining: 0 };
    }

    return data; // Return the modified data object, not the result
  });

  return result;
}

// Check wallet click rate limit
export function checkWalletClickLimit(wallet) {
  let result = { allowed: false, remaining: 0 };

  db.update(data => {
    // Ensure we have all required fields
    if (!data.currentSession) data.currentSession = null;
    if (!data.previousSession) data.previousSession = null;
    if (!data.miners) data.miners = {};
    if (!data.ipRateLimits) data.ipRateLimits = {};
    if (!data.walletClickLimits) data.walletClickLimits = {};

    data = cleanupOldEntries(data);

    if (!data.walletClickLimits[wallet]) {
      data.walletClickLimits[wallet] = [];
    }

    // Check if under limit
    if (data.walletClickLimits[wallet].length < WALLET_CLICK_LIMIT.maxClicks) {
      data.walletClickLimits[wallet].push(Date.now());
      result = { allowed: true, remaining: WALLET_CLICK_LIMIT.maxClicks - data.walletClickLimits[wallet].length };
    } else {
      result = { allowed: false, remaining: 0 };
    }

    return data; // Return the modified data object, not the result
  });

  return result;
}

// Get client IP from request
export function getClientIP(request) {
  // Try different headers for IP detection
  const forwarded = request.headers.get('x-forwarded-for');
  const realIP = request.headers.get('x-real-ip');
  const clientIP = request.headers.get('x-client-ip');

  if (forwarded) {
    // x-forwarded-for can contain multiple IPs, take the first one
    return forwarded.split(',')[0].trim();
  }

  if (realIP) {
    return realIP;
  }

  if (clientIP) {
    return clientIP;
  }

  // Fallback (this won't work in production without proper proxy setup)
  return '127.0.0.1';
}

// Rate limiting middleware
export function withRateLimit(handler) {
  return async (request, context) => {
    const ip = getClientIP(request);

    // Check IP rate limit
    const ipCheck = checkIpRateLimit(ip);
    if (!ipCheck.allowed) {
      return new Response(JSON.stringify({
        error: 'Too many requests from this IP',
        retryAfter: Math.ceil(IP_RATE_LIMIT.windowMs / 1000)
      }), {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': Math.ceil(IP_RATE_LIMIT.windowMs / 1000).toString(),
          'X-RateLimit-Limit': IP_RATE_LIMIT.maxRequests.toString(),
          'X-RateLimit-Remaining': '0'
        }
      });
    }

    // Add rate limit headers
    const response = await handler(request, context);

    if (response && typeof response.headers !== 'undefined') {
      response.headers.set('X-RateLimit-Limit', IP_RATE_LIMIT.maxRequests.toString());
      response.headers.set('X-RateLimit-Remaining', ipCheck.remaining.toString());
    }

    return response;
  };
}

// Wallet click rate limiting middleware
export function withWalletClickLimit(handler) {
  return async (request, context) => {
    try {
      const body = await request.json();
      const { wallet } = body;

      if (wallet) {
        const walletCheck = checkWalletClickLimit(wallet);
        if (!walletCheck.allowed) {
          return new Response(JSON.stringify({
            error: 'Too many clicks from this wallet',
            retryAfter: Math.ceil(WALLET_CLICK_LIMIT.windowMs / 1000)
          }), {
            status: 429,
            headers: {
              'Content-Type': 'application/json',
              'Retry-After': Math.ceil(WALLET_CLICK_LIMIT.windowMs / 1000).toString()
            }
          });
        }
      }

      // Reconstruct request with parsed body
      const newRequest = new Request(request.url, {
        method: request.method,
        headers: request.headers,
        body: JSON.stringify(body)
      });

      return handler(newRequest, context);
    } catch (error) {
      // If JSON parsing fails, continue without wallet check
      return handler(request, context);
    }
  };
}