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

// ── GET /api/user/me ─────────────────────────────────────────────────────────
router.get('/me', async (req, res) => {
  const user = await store.findUser(req.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const { passwordHash: _ph, ...safeUser } = user;
  return res.json({ user: safeUser });
});

// ── PATCH /api/user/me — update non-sensitive mutable fields ─────────────────
router.patch('/me', async (req, res) => {
  const user = await store.findUser(req.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const { watchedTrailers, lastEarningsProcessed, dailyEarnings, dailyEarningsDate, dailyClipsWatched } = req.body || {};

  if (Array.isArray(watchedTrailers)) user.watchedTrailers = watchedTrailers;
  if (typeof lastEarningsProcessed === 'number') user.lastEarningsProcessed = lastEarningsProcessed;
  if (typeof dailyEarnings === 'number') user.dailyEarnings = dailyEarnings;
  if (typeof dailyEarningsDate === 'string') user.dailyEarningsDate = dailyEarningsDate;
  if (typeof dailyClipsWatched === 'number') user.dailyClipsWatched = dailyClipsWatched;

  await store.saveUser(user);
  const { passwordHash: _ph, ...safeUser } = user;
  return res.json({ user: safeUser });
});

// ── GET /api/user/transactions ───────────────────────────────────────────────
router.get('/transactions', async (req, res) => {
  const myTx = await store.getUserTransactions(req.userId, 50);
  return res.json({ transactions: myTx });
});

// ── POST /api/user/subscription — activate or upgrade a plan ─────────────────
router.post('/subscription', async (req, res) => {
  const user = await store.findUser(req.userId);
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
    user.dailyEarnings = 0;
    user.dailyEarningsDate = new Date(now).toISOString().slice(0, 10);
    user.dailyClipsWatched = 0;
    await store.saveUser(user);
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
  user.dailyEarnings         = 0;
  user.dailyEarningsDate     = new Date(now).toISOString().slice(0, 10);
  user.dailyClipsWatched     = 0;

  await store.saveUser(user);

  // Log deposit transaction
  await store.saveTransaction({
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
  await creditReferralBonuses(user, tier.price, now);

  const { passwordHash: _ph, ...safeUser } = user;
  return res.json({ user: safeUser });
});

// ── POST /api/user/earnings — credit earnings for watching a trailer ─────────
router.post('/earnings', async (req, res) => {
  const user = await store.findUser(req.userId);
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

  const today = new Date(now).toISOString().slice(0, 10);
  const dailyCap = parseFloat((tier.price * tier.dailyROI).toFixed(4));

  // Reset daily counters when the day changes
  if (user.dailyEarningsDate !== today) {
    user.dailyEarningsDate = today;
    user.dailyEarnings = 0;
    user.dailyClipsWatched = 0;
  }

  const MAX_CLIPS_PER_DAY = 10;

  if ((user.dailyEarnings || 0) >= dailyCap) {
    return res.status(400).json({ error: 'Daily earnings cap reached' });
  }

  if ((user.dailyClipsWatched || 0) >= MAX_CLIPS_PER_DAY) {
    return res.status(400).json({ error: 'Daily clip limit reached' });
  }

  const cap = tier.maxEarnings;
  const totalRemaining = cap - (user.totalEarned || 0);

  if (totalRemaining <= 0) {
    return res.status(400).json({ error: 'Earnings cap reached' });
  }

  const dailyRemaining = dailyCap - (user.dailyEarnings || 0);
  const creditable = Math.min(amount, dailyRemaining, totalRemaining);
  const credited = parseFloat(creditable.toFixed(4));

  if (credited <= 0) {
    return res.status(400).json({ error: 'Daily earnings cap reached' });
  }

  user.wallet      = parseFloat(((user.wallet || 0) + credited).toFixed(4));
  user.totalEarned = parseFloat(((user.totalEarned || 0) + credited).toFixed(4));
  user.dailyEarnings = parseFloat(((user.dailyEarnings || 0) + credited).toFixed(4));
  user.dailyClipsWatched = (user.dailyClipsWatched || 0) + 1;

  if (trailerId && !user.watchedTrailers.includes(trailerId)) {
    user.watchedTrailers.push(trailerId);
  }
  user.lastEarningsProcessed = now;

  await store.saveUser(user);

  await store.saveTransaction({
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

async function creditReferralBonuses(newUser, amount, now) {
  if (!newUser.referredBy) return;

  const l1 = await store.findUserByReferralCode(newUser.referredBy);
  if (!l1) return;
  await _creditBonus(l1, amount * REFERRAL_LEVELS[1], now, 'Level 1 referral bonus from ' + newUser.username);

  if (!l1.referredBy) return;
  const l2 = await store.findUserByReferralCode(l1.referredBy);
  if (!l2) return;
  await _creditBonus(l2, amount * REFERRAL_LEVELS[2], now, 'Level 2 referral bonus');

  if (!l2.referredBy) return;
  const l3 = await store.findUserByReferralCode(l2.referredBy);
  if (!l3) return;
  await _creditBonus(l3, amount * REFERRAL_LEVELS[3], now, 'Level 3 referral bonus');
}

async function _creditBonus(user, bonus, now, note) {
  user.wallet          = parseFloat(((user.wallet          || 0) + bonus).toFixed(4));
  user.referralEarnings = parseFloat(((user.referralEarnings || 0) + bonus).toFixed(4));
  await store.saveUser(user);
  await store.saveTransaction({
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
