'use strict';

/**
 * User Auth Routes
 *
 * POST /api/auth/register  — create account, returns { token, user }
 * POST /api/auth/login     — verify credentials, returns { token, user }
 *
 * Also exports requireUserJWT middleware for use by /api/user/* and
 * /api/withdrawal/* routes.
 */

const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const router  = express.Router();

const { store, SUBSCRIPTION_TIERS, generateId } = require('./store');

const JWT_SECRET    = process.env.JWT_SECRET || 'clipcash-dev-jwt-secret-change-in-production';
const JWT_USER_TTL  = '7d';
const BCRYPT_ROUNDS = 10;

// ── Token helpers ─────────────────────────────────────────────────────────────
function signUserToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, username: user.username, role: 'user' },
    JWT_SECRET,
    { expiresIn: JWT_USER_TTL }
  );
}

// ── Middleware — exported for use by other route files ────────────────────────
function requireUserJWT(req, res, next) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: missing token' });
  }
  try {
    const payload = jwt.verify(auth.slice(7), JWT_SECRET);
    if (payload.role !== 'user') {
      return res.status(403).json({ error: 'Forbidden: user token required' });
    }
    req.userId = payload.sub;
    next();
  } catch (_err) {
    return res.status(401).json({ error: 'Unauthorized: invalid or expired token' });
  }
}

// ── POST /api/auth/register ───────────────────────────────────────────────────
router.post('/register', async (req, res) => {
  const { username, email, password, referralCode } = req.body || {};

  if (!username || !email || !password) {
    return res.status(400).json({ error: 'username, email, and password are required' });
  }
  if (username.length < 3) {
    return res.status(400).json({ error: 'Username must be at least 3 characters' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  if (!/^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/.test(email)) {
    return res.status(400).json({ error: 'Invalid email address' });
  }

  const emailLower = email.toLowerCase();

  if (await store.findUserByEmail(emailLower)) {
    return res.status(409).json({ error: 'An account with this email already exists' });
  }
  if (await store.findUserByUsername(username)) {
    return res.status(409).json({ error: 'Username is already taken' });
  }

  // Validate referral code
  let referredBy = null;
  if (referralCode) {
    const referrer = await store.findUserByReferralCode(referralCode.toUpperCase());
    if (!referrer) {
      return res.status(400).json({ error: 'Invalid referral code' });
    }
    referredBy = referralCode.toUpperCase();
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);

  const newUser = {
    id:                    generateId(),
    username,
    email:                 emailLower,
    passwordHash,
    isAdmin:               false,
    wallet:                0,
    totalEarned:           0,
    referralCode:          generateReferralCode(),
    referredBy,
    referralEarnings:      0,
    subscription: {
      tier:        'free_intern',
      activatedAt: now,
      expiresAt:   now + 3 * 86400000,
    },
    createdAt:             now,
    lastEarningsProcessed: now,
    watchedTrailers:       [],
    dailyEarnings:         0,
    dailyEarningsDate:     today,
    dailyClipsWatched:     0,
  };

  await store.saveUser(newUser);

  const token = signUserToken(newUser);
  const { passwordHash: _ph, ...safeUser } = newUser;

  console.log(`[Auth] User registered: ${newUser.username} (${newUser.email})`);
  return res.status(201).json({ token, user: safeUser });
});

// ── POST /api/auth/login ──────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  const user = await store.findUserByEmail(email.toLowerCase());

  // Always run bcrypt.compare to prevent timing-based user-enumeration attacks.
  const dummyHash = '$2a$10$invalidhashpadding000000000000000000000000000000000000';
  const valid = user
    ? await bcrypt.compare(password, user.passwordHash)
    : (await bcrypt.compare(password, dummyHash), false);

  if (!valid) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  await processPendingEarnings(user);

  const token = signUserToken(user);
  const { passwordHash: _ph, ...safeUser } = user;

  console.log(`[Auth] User logged in: ${user.username}`);
  return res.json({ token, user: safeUser });
});

// ── Internal: process pending daily ROI ───────────────────────────────────────
async function processPendingEarnings(user) {
  const tierKey = user.subscription && user.subscription.tier;
  const tier    = SUBSCRIPTION_TIERS[tierKey];
  if (!tier || tier.dailyROI === 0) return;

  const now = Date.now();
  if (user.subscription.expiresAt && now > user.subscription.expiresAt) return;

  const today = new Date(now).toISOString().slice(0, 10);
  const dailyCap = parseFloat((tier.price * tier.dailyROI).toFixed(4));

  // Reset daily counters if new day
  if (user.dailyEarningsDate !== today) {
    user.dailyEarningsDate = today;
    user.dailyEarnings = 0;
    user.dailyClipsWatched = 0;
  }

  const lastTs    = user.lastEarningsProcessed || user.createdAt || now;
  const daysSince = Math.floor((now - lastTs) / 86400000);
  if (daysSince < 1) return;

  const cap      = tier.maxEarnings;

  for (let i = 0; i < daysSince; i++) {
    if ((user.totalEarned || 0) >= cap) break;
    if ((user.dailyEarnings || 0) >= dailyCap) break;

    const remainingTotal = cap - (user.totalEarned || 0);
    const remainingDaily  = dailyCap - (user.dailyEarnings || 0);
    const credit = Math.min(tier.price * tier.dailyROI, remainingTotal, remainingDaily);

    if (credit <= 0) break;

    user.totalEarned = parseFloat(((user.totalEarned || 0) + credit).toFixed(4));
    user.wallet      = parseFloat(((user.wallet      || 0) + credit).toFixed(4));
    user.dailyEarnings = parseFloat(((user.dailyEarnings || 0) + credit).toFixed(4));

    await store.saveTransaction({
      id:        generateId(),
      userId:    user.id,
      username:  user.username,
      email:     user.email,
      type:      'daily_roi',
      amount:    parseFloat(credit.toFixed(4)),
      status:    'approved',
      note:      'Daily ROI credit',
      createdAt: now,
    });
  }

  user.lastEarningsProcessed = now;
  await store.saveUser(user);
}

// ���─ Utility ───────────────────────────────────────────────────────────────────
function generateReferralCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

module.exports = router;
module.exports.requireUserJWT = requireUserJWT;
module.exports.signUserToken   = signUserToken;
