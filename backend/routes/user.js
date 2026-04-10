'use strict';

/**
 * User Data Routes (all require a valid user JWT)
 *
 * GET   /api/user/me              — return current user profile
 * PATCH /api/user/me              — update mutable fields (watchedTrailers, etc.)
 * GET   /api/user/transactions    — return user's transaction history
 * POST  /api/user/subscription    — activate / upgrade subscription
 * POST  /api/user/earnings        — credit trailer-watching earnings
 */

const express = require('express');
const router  = express.Router();

const { requireUserJWT } = require('./auth');
const { store, SUBSCRIPTION_TIERS, generateId } = require('./store');

// All routes below require a valid user JWT
router.use(requireUserJWT);

// ── GET /api/user/me ──────────────────────────────────────────────────────────
router.get('/me', (req, res) => {
  const user = store.users.find(u => u.id === req.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const { passwordHash: _ph, ...safeUser } = user;
  return res.json({ user: safeUser });
});

// ── PATCH /api/user/me — update non-sensitive mutable fields ──────────────────
router.patch('/me', (req, res) => {
  const user = store.users.find(u => u.id === req.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const { watchedTrailers, lastEarningsProcessed } = req.body || {};

  if (Array.isArray(watchedTrailers))          user.watchedTrailers       = watchedTrailers;
  if (typeof lastEarningsProcessed === 'number') user.lastEarningsProcessed = lastEarningsProcessed;

  const { passwordHash: _ph, ...safeUser } = user;
  return res.json({ user: safeUser });
});

// ── GET /api/user/transactions ────────────────────────────────────────────────
router.get('/transactions', (req, res) => {
  const myTx = store.transactions
    .filter(t => t.userId === req.userId)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 50);
  return res.json({ transactions: myTx });
});

// ── POST /api/user/subscription — activate or upgrade a plan ─────────────────
router.post('/subscription', (req, res) => {
  const user = store.users.find(u => u.id === req.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const { tier: tierKey, method } = req.body || {};
  if (!tierKey) return res.status(400).json({ error: 'tier is required' });

  const tier = SUBSCRIPTION_TIERS[tierKey];
  if (!tier) return res.status(400).json({ error: 'Invalid subscription tier' });

  const now = Date.now();

  // Free intern plan — no payment needed
  if (tierKey === 'free_intern') {
    user.subscription = {
      tier:        'free_intern',
      activatedAt: now,
      expiresAt:   now + 3 * 86400000,
    };
    const { passwordHash: _ph, ...safeUser } = user;
    return res.json({ user: safeUser });
  }

  if (method !== 'wallet') {
    return res.status(400).json({
      error: 'Use method "wallet" or initiate a Yoco payment via POST /api/deposit/initiate',
    });
  }

  if ((user.wallet || 0) < tier.price) {
    return res.status(400).json({ error: 'Insufficient wallet balance' });
  }

  user.wallet       = parseFloat(((user.wallet || 0) - tier.price).toFixed(2));
  user.subscription = {
    tier:        tierKey,
    activatedAt: now,
    expiresAt:   now + tier.durationDays * 86400000,
  };
  user.totalEarned           = 0;
  user.lastEarningsProcessed = now;

  // Log deposit transaction
  store.transactions.push({
    id:        generateId(),
    userId:    user.id,
    username:  user.username,
    email:     user.email,
    type:      'deposit',
    tier:      tierKey,
    tierName:  tier.name || tierKey,
    amount:    tier.price,
    status:    'approved',
    method:    'wallet',
    note:      tierKey + ' plan via Wallet',
    createdAt: now,
  });

  // Credit referral bonuses up 3 levels
  creditReferralBonuses(user, tier.price, now);

  const { passwordHash: _ph, ...safeUser } = user;
  return res.json({ user: safeUser });
});

// ── POST /api/user/earnings — credit earnings for watching a trailer ──────────
router.post('/earnings', (req, res) => {
  const user = store.users.find(u => u.id === req.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const { amount, trailerId, trailerTitle } = req.body || {};

  if (!amount || typeof amount !== 'number' || amount <= 0) {
    return res.status(400).json({ error: 'A positive numeric amount is required' });
  }

  const tierKey = user.subscription && user.subscription.tier;
  const tier    = SUBSCRIPTION_TIERS[tierKey];

  if (!tier || tier.dailyROI === 0) {
    return res.status(400).json({ error: 'No active paid subscription' });
  }

  const now = Date.now();
  if (user.subscription.expiresAt && now > user.subscription.expiresAt) {
    return res.status(400).json({ error: 'Subscription expired' });
  }

  const cap       = tier.maxEarnings;
  const remaining = cap - (user.totalEarned || 0);

  if (remaining <= 0) {
    return res.status(400).json({ error: 'Earnings cap reached' });
  }

  const credited = parseFloat(Math.min(amount, remaining).toFixed(4));
  user.wallet      = parseFloat(((user.wallet      || 0) + credited).toFixed(4));
  user.totalEarned = parseFloat(((user.totalEarned || 0) + credited).toFixed(4));

  if (trailerId && !user.watchedTrailers.includes(trailerId)) {
    user.watchedTrailers.push(trailerId);
  }
  user.lastEarningsProcessed = now;

  store.transactions.push({
    id:        generateId(),
    userId:    user.id,
    username:  user.username,
    email:     user.email,
    type:      'trailer_earn',
    amount:    credited,
    status:    'approved',
    note:      trailerTitle ? `Watched "${trailerTitle}"` : 'Trailer earning',
    createdAt: now,
  });

  const { passwordHash: _ph, ...safeUser } = user;
  return res.json({ user: safeUser, credited });
});

// ── Internal: credit multi-level referral bonuses ─────────────────────────────
const REFERRAL_LEVELS = { 1: 0.10, 2: 0.05, 3: 0.02 };

function creditReferralBonuses(newUser, amount, now) {
  if (!newUser.referredBy) return;

  const l1 = store.users.find(u => u.referralCode === newUser.referredBy);
  if (!l1) return;
  _creditBonus(l1, amount * REFERRAL_LEVELS[1], now, 'Level 1 referral bonus from ' + newUser.username);

  if (!l1.referredBy) return;
  const l2 = store.users.find(u => u.referralCode === l1.referredBy);
  if (!l2) return;
  _creditBonus(l2, amount * REFERRAL_LEVELS[2], now, 'Level 2 referral bonus');

  if (!l2.referredBy) return;
  const l3 = store.users.find(u => u.referralCode === l2.referredBy);
  if (!l3) return;
  _creditBonus(l3, amount * REFERRAL_LEVELS[3], now, 'Level 3 referral bonus');
}

function _creditBonus(user, bonus, now, note) {
  user.wallet          = parseFloat(((user.wallet          || 0) + bonus).toFixed(4));
  user.referralEarnings = parseFloat(((user.referralEarnings || 0) + bonus).toFixed(4));
  store.transactions.push({
    id:        generateId(),
    userId:    user.id,
    username:  user.username,
    email:     user.email,
    type:      'referral_bonus',
    amount:    parseFloat(bonus.toFixed(4)),
    status:    'approved',
    note,
    createdAt: now,
  });
}

module.exports = router;
