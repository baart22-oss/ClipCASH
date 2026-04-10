'use strict';

/**
 * Shared in-memory data store and subscription tier definitions.
 * In production, replace with a real database.
 */

// ── Subscription Tiers (mirrors js/app.js SUBSCRIPTION_TIERS) ─────────────────
const SUBSCRIPTION_TIERS = {
  free_intern: { price: 0,     dailyROI: 0,    durationDays: 3,  maxEarnings: 0     },
  starter:     { price: 100,   dailyROI: 0.05, durationDays: 30, maxEarnings: 200   },
  bronze:      { price: 500,   dailyROI: 0.05, durationDays: 30, maxEarnings: 1000  },
  silver:      { price: 1000,  dailyROI: 0.05, durationDays: 30, maxEarnings: 2000  },
  gold:        { price: 5000,  dailyROI: 0.05, durationDays: 30, maxEarnings: 10000 },
  platinum:    { price: 10000, dailyROI: 0.05, durationDays: 30, maxEarnings: 20000 },
  diamond:     { price: 20000, dailyROI: 0.05, durationDays: 30, maxEarnings: 40000 },
};

// ── In-memory store ───────────────────────────────────────────────────────────
const store = {
  users:        [],
  withdrawals:  [],
  transactions: [],
};

// ── Utility ───────────────────────────────────────────────────────────────────
function generateId() {
  return 'cc_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
}

module.exports = { store, SUBSCRIPTION_TIERS, generateId };
