'use strict';

/**
 * Withdrawal Routes
 *
 * POST /api/withdrawal/submit
 *   Creates a pending withdrawal request in the backend store.
 *   The request stays pending until an admin processes it via
 *   POST /api/admin/process-withdrawal.
 *
 * GET /api/withdrawal/my?userId=<id>
 *   Returns all withdrawal requests for a given user ID.
 */

const express = require('express');
const router  = express.Router();

// Share the same in-memory store as the admin routes
const { store } = require('./admin');

const WITHDRAWAL_FEE_RATE = 0.10;
const WITHDRAWAL_MIN      = 50;

function generateId() {
  return 'cc_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
}

// ── POST /api/withdrawal/submit ─────────────────────────────────────────────
router.post('/submit', (req, res) => {
  const { userId, username, email, amount, method, account } = req.body || {};

  if (!userId || !amount || !method || !account) {
    return res.status(400).json({ error: 'userId, amount, method, and account are required' });
  }

  const parsedAmount = Number(amount);
  if (!Number.isFinite(parsedAmount) || parsedAmount < WITHDRAWAL_MIN) {
    return res.status(400).json({ error: `Minimum withdrawal amount is R${WITHDRAWAL_MIN}` });
  }

  const fee = parseFloat((parsedAmount * WITHDRAWAL_FEE_RATE).toFixed(2));
  const net = parseFloat((parsedAmount - fee).toFixed(2));

  const withdrawal = {
    id:        generateId(),
    userId,
    username:  username || '',
    email:     email    || '',
    amount:    parsedAmount,
    fee,
    net,
    method,
    account,
    status:    'pending',
    createdAt: Date.now(),
  };

  store.withdrawals.push(withdrawal);

  // Also add a transaction log entry
  store.transactions.push({
    id:        generateId(),
    userId,
    username:  username || '',
    email:     email    || '',
    type:      'withdrawal',
    amount:    parsedAmount,
    status:    'pending',
    note:      `${method} withdrawal`,
    createdAt: Date.now(),
  });

  console.log(`[Withdrawal] Pending withdrawal created: ${withdrawal.id} for user ${userId} amount ${parsedAmount}`);
  return res.status(201).json({ success: true, withdrawalId: withdrawal.id, withdrawal });
});

// ── GET /api/withdrawal/my ──────────────────────────────────────────────────
router.get('/my', (req, res) => {
  const { userId } = req.query;
  if (!userId) {
    return res.status(400).json({ error: 'userId query parameter is required' });
  }

  const myWithdrawals = store.withdrawals
    .filter(w => w.userId === userId)
    .sort((a, b) => b.createdAt - a.createdAt);

  return res.json({ withdrawals: myWithdrawals });
});

module.exports = router;
