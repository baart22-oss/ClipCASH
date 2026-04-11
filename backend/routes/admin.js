'use strict';

/**
 * Admin API Routes
 *
 * POST /api/admin/login     — verify ADMIN_USERNAME + ADMIN_PASSWORD, return signed JWT
 *
 * All other routes require Authorization: Bearer <admin-jwt>.
 */

const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const router  = express.Router();

const { store } = require('./store');

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const JWT_SECRET     = process.env.JWT_SECRET     || 'clipcash-dev-jwt-secret-change-in-production';
const JWT_ADMIN_TTL  = '4h';

let cachedAdminHash = null;

// ── POST /api/admin/login ──────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ error: 'username and password are required' });
  }

  if (!ADMIN_PASSWORD) {
    return res.status(503).json({
      error: 'Admin password not configured on server. Set ADMIN_PASSWORD env var.',
    });
  }

  if (!cachedAdminHash) {
    cachedAdminHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
  }

  const passwordValid = await bcrypt.compare(password, cachedAdminHash);
  if (!passwordValid || username !== ADMIN_USERNAME) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  const token     = jwt.sign({ sub: username, role: 'admin' }, JWT_SECRET, { expiresIn: JWT_ADMIN_TTL });
  const expiresAt = Date.now() + 4 * 60 * 60 * 1000;

  console.log('[Admin] Admin session created for:', username);
  return res.json({ token, expiresAt });
});

// ── Auth Middleware ────────────────────────────────────────────────────────────
function requireAdminJWT(req, res, next) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: missing admin token' });
  }
  try {
    const payload = jwt.verify(auth.slice(7), JWT_SECRET);
    if (payload.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden: admin token required' });
    }
    next();
  } catch (_err) {
    return res.status(401).json({ error: 'Unauthorized: invalid or expired admin token' });
  }
}

router.use(requireAdminJWT);

// ── GET /api/admin/stats ───────────────────────────────────────────────────────
router.get('/stats', async (_req, res) => {
  const stats = await store.getStats();
  res.json({ ...stats, timestamp: new Date().toISOString() });
});

// ── POST /api/admin/verify-transaction ────────────────────────────────────────
router.post('/verify-transaction', async (req, res) => {
  const { transactionId, action } = req.body || {};
  if (!transactionId || !action) {
    return res.status(400).json({ error: 'transactionId and action are required' });
  }
  if (!['approve', 'reject'].includes(action)) {
    return res.status(400).json({ error: 'action must be "approve" or "reject"' });
  }

  const tx = await store.findTransaction(transactionId);
  if (!tx) return res.status(404).json({ error: 'Transaction not found' });
  if (tx.status !== 'pending') return res.status(400).json({ error: 'Transaction is not pending' });

  tx.status      = action === 'approve' ? 'approved' : 'rejected';
  tx.processedAt = new Date().toISOString();
  tx.processedBy = 'admin';

  await store.saveTransaction(tx);

  if (action === 'approve') {
    const user = await store.findUser(tx.userId);
    if (user) {
      user.subscriptionActive = true;
      user.subscriptionTier   = tx.tier;
      user.subscriptionStart  = new Date().toISOString();
      await store.saveUser(user);
    }
  }

  console.log(`[Admin] Transaction ${transactionId} ${tx.status}`);
  return res.json({ success: true, transaction: tx });
});

// ── POST /api/admin/process-withdrawal ────────────────────────────────────────
router.post('/process-withdrawal', async (req, res) => {
  const { withdrawalId, action } = req.body || {};
  if (!withdrawalId || !action) {
    return res.status(400).json({ error: 'withdrawalId and action are required' });
  }
  if (!['approve', 'reject'].includes(action)) {
    return res.status(400).json({ error: 'action must be "approve" or "reject"' });
  }

  const w = await store.findWithdrawal(withdrawalId);
  if (!w) return res.status(404).json({ error: 'Withdrawal not found' });
  if (w.status !== 'pending') return res.status(400).json({ error: 'Withdrawal is not pending' });

  w.status      = action === 'approve' ? 'approved' : 'rejected';
  w.processedAt = new Date().toISOString();
  w.processedBy = 'admin';

  await store.saveWithdrawal(w);

  if (action === 'reject') {
    const user = await store.findUser(w.userId);
    if (user) {
      user.wallet = parseFloat(((user.wallet || 0) + w.amount).toFixed(2));
      await store.saveUser(user);
    }
  }

  console.log(`[Admin] Withdrawal ${withdrawalId} ${w.status}`);
  return res.json({ success: true, withdrawal: w });
});

// ── GET /api/admin/withdrawals ────────────────────────────────────────────────
router.get('/withdrawals', async (_req, res) => {
  const withdrawals = await store.getWithdrawals();
  res.json({ withdrawals });
});

// ── GET /api/admin/transactions ───────────────────────────────────────────────
router.get('/transactions', async (_req, res) => {
  const transactions = await store.getTransactions();
  res.json({ transactions });
});

// ── GET /api/admin/users ──────────────────────────────────────────────────────
router.get('/users', async (_req, res) => {
  const users = await store.getUsers();
  res.json({
    users: users.map(u => ({ ...u, passwordHash: undefined, password: undefined })),
  });
});

// ── POST /api/admin/sync — bulk-import data (for demo / migration) ─────────────
router.post('/sync', async (req, res) => {
  const { users, withdrawals, transactions } = req.body || {};
  if (users)        await Promise.all(users.map(u => store.saveUser(u)));
  if (withdrawals)  await Promise.all(withdrawals.map(w => store.saveWithdrawal(w)));
  if (transactions) await Promise.all(transactions.map(t => store.saveTransaction(t)));

  const [allUsers, allWithdrawals, allTransactions] = await Promise.all([
    store.getUsers(),
    store.getWithdrawals(),
    store.getTransactions(),
  ]);

  res.json({
    success: true,
    synced: {
      users:        allUsers.length,
      withdrawals:  allWithdrawals.length,
      transactions: allTransactions.length,
    },
  });
});

module.exports = router;
module.exports.requireAdminJWT = requireAdminJWT;
