'use strict';

/**
 * Admin API Routes
 *
 * Protected routes require either:
 *  - X-Admin-Key header matching ADMIN_API_KEY env var, OR
 *  - A valid session token obtained via POST /api/admin/login
 *
 * In production, replace the in-memory store with a real database.
 */

const express = require('express');
const crypto  = require('crypto');
const router  = express.Router();

const ADMIN_API_KEY   = process.env.ADMIN_API_KEY   || 'clipcash-admin-dev-key';
const ADMIN_PASSWORD  = process.env.ADMIN_PASSWORD  || '';
const SESSION_TTL_MS  = 4 * 60 * 60 * 1000; // 4 hours

// ── In-memory session token store ──────────────────────────────────────────
// Maps token -> { expiresAt: timestamp }
const sessionTokens = new Map();

// ── In-memory demo store ───────────────────────────────────────────────────
const store = {
  users: [],
  withdrawals: [],
  transactions: [],
};

// ── POST /api/admin/login ──────────────────────────────────────────────────
// Issues a session token after verifying the admin password.
// Does NOT require an existing admin key — it is the auth entry point.
router.post('/login', (req, res) => {
  const { password } = req.body || {};
  if (!password) {
    return res.status(400).json({ error: 'password is required' });
  }
  if (!ADMIN_PASSWORD) {
    return res.status(503).json({ error: 'Admin password not configured on server. Set ADMIN_PASSWORD env var.' });
  }
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Invalid admin password' });
  }

  // Purge any expired sessions
  const now = Date.now();
  for (const [tok, meta] of sessionTokens) {
    if (meta.expiresAt <= now) sessionTokens.delete(tok);
  }

  const token     = crypto.randomBytes(32).toString('hex');
  const expiresAt = now + SESSION_TTL_MS;
  sessionTokens.set(token, { expiresAt });

  console.log('[Admin] New admin session created');
  return res.json({ token, expiresAt });
});

// ── Auth Middleware ────────────────────────────────────────────────────────
function requireAdminKey(req, res, next) {
  const key = req.headers['x-admin-key'] || req.query.adminKey;
  if (!key) {
    return res.status(401).json({ error: 'Unauthorized: missing admin key' });
  }

  // Accept static API key (for server-to-server / CI use)
  if (key === ADMIN_API_KEY) return next();

  // Accept valid session tokens (issued by /api/admin/login)
  const session = sessionTokens.get(key);
  if (session && session.expiresAt > Date.now()) return next();

  // Token might have expired — clean it up
  sessionTokens.delete(key);
  return res.status(401).json({ error: 'Unauthorized: invalid or expired admin key' });
}

router.use(requireAdminKey);

// ── GET /api/admin/stats ────────────────────────────────────────────────────
router.get('/stats', (_req, res) => {
  const pendingWithdrawals   = store.withdrawals.filter(w => w.status === 'pending').length;
  const pendingTransactions  = store.transactions.filter(t => t.status === 'pending').length;
  const totalWithdrawalVolume = store.withdrawals.reduce((sum, w) => sum + (w.amount || 0), 0);

  res.json({
    totalUsers:          store.users.length,
    pendingWithdrawals,
    pendingTransactions,
    totalWithdrawalVolume,
    activeSubscriptions: store.users.filter(u => u.subscriptionActive).length,
    timestamp:           new Date().toISOString(),
  });
});

// ── POST /api/admin/verify-transaction ─────────────────────────────────────
router.post('/verify-transaction', (req, res) => {
  const { transactionId, action } = req.body;
  if (!transactionId || !action) {
    return res.status(400).json({ error: 'transactionId and action are required' });
  }
  if (!['approve', 'reject'].includes(action)) {
    return res.status(400).json({ error: 'action must be "approve" or "reject"' });
  }

  const tx = store.transactions.find(t => t.id === transactionId);
  if (!tx) return res.status(404).json({ error: 'Transaction not found' });
  if (tx.status !== 'pending') return res.status(400).json({ error: 'Transaction is not pending' });

  tx.status      = action === 'approve' ? 'approved' : 'rejected';
  tx.processedAt = new Date().toISOString();
  tx.processedBy = 'admin_api';

  if (action === 'approve') {
    // Activate subscription for the user
    const user = store.users.find(u => u.id === tx.userId);
    if (user) {
      user.subscriptionActive = true;
      user.subscriptionTier   = tx.tier;
      user.subscriptionStart  = new Date().toISOString();
    }
  }

  console.log(`[Admin] Transaction ${transactionId} ${tx.status}`);
  res.json({ success: true, transaction: tx });
});

// ── POST /api/admin/process-withdrawal ─────────────────────────────────────
router.post('/process-withdrawal', (req, res) => {
  const { withdrawalId, action } = req.body;
  if (!withdrawalId || !action) {
    return res.status(400).json({ error: 'withdrawalId and action are required' });
  }
  if (!['approve', 'reject'].includes(action)) {
    return res.status(400).json({ error: 'action must be "approve" or "reject"' });
  }

  const w = store.withdrawals.find(x => x.id === withdrawalId);
  if (!w) return res.status(404).json({ error: 'Withdrawal not found' });
  if (w.status !== 'pending') return res.status(400).json({ error: 'Withdrawal is not pending' });

  w.status      = action === 'approve' ? 'approved' : 'rejected';
  w.processedAt = new Date().toISOString();
  w.processedBy = 'admin_api';

  if (action === 'reject') {
    // Refund wallet
    const user = store.users.find(u => u.id === w.userId);
    if (user) user.walletBalance = (user.walletBalance || 0) + w.amount;
  }

  console.log(`[Admin] Withdrawal ${withdrawalId} ${w.status}`);
  res.json({ success: true, withdrawal: w });
});

// ── GET /api/admin/withdrawals ──────────────────────────────────────────────
router.get('/withdrawals', (_req, res) => {
  res.json({ withdrawals: store.withdrawals });
});

// ── GET /api/admin/transactions ─────────────────────────────────────────────
router.get('/transactions', (_req, res) => {
  res.json({ transactions: store.transactions });
});

// ── GET /api/admin/users ────────────────────────────────────────────────────
router.get('/users', (_req, res) => {
  res.json({ users: store.users.map(u => ({ ...u, passwordHash: undefined, password: undefined }) )});
});

// ── POST /api/admin/sync ────────────────────────────────────────────────────
// Sync localStorage data to the server (for demo integration)
router.post('/sync', (req, res) => {
  const { users, withdrawals, transactions } = req.body;
  if (users)        store.users        = users;
  if (withdrawals)  store.withdrawals  = withdrawals;
  if (transactions) store.transactions = transactions;
  res.json({ success: true, synced: { users: store.users.length, withdrawals: store.withdrawals.length, transactions: store.transactions.length } });
});

// ── Expose store for use by deposit/withdrawal routes ──────────────────────
module.exports = router;
module.exports.store = store;
