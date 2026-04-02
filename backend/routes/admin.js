'use strict';

/**
 * Admin API Routes
 *
 * All routes require the X-Admin-Key header to match ADMIN_API_KEY in .env
 *
 * In production, replace the in-memory store with a real database.
 */

const express = require('express');
const router  = express.Router();

const ADMIN_API_KEY = process.env.ADMIN_API_KEY || 'clipcash-admin-dev-key';

// ── In-memory demo store ───────────────────────────────────────────────────
const store = {
  users: [],
  withdrawals: [],
  transactions: [],
};

// ── Auth Middleware ────────────────────────────────────────────────────────
function requireAdminKey(req, res, next) {
  const key = req.headers['x-admin-key'] || req.query.adminKey;
  if (!key || key !== ADMIN_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized: invalid admin key' });
  }
  next();
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

// ── GET /api/admin/users ────────────────────────────────────────────────────
router.get('/users', (_req, res) => {
  res.json({ users: store.users.map(u => ({ ...u, password: undefined })) });
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

module.exports = router;
