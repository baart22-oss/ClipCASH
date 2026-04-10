'use strict';

/**
 * Withdrawal Routes (all require a valid user JWT)
 *
 * POST /api/withdrawal/submit
 *   Creates a pending withdrawal request in the backend store.
 *   The request stays pending until an admin processes it via
 *   POST /api/admin/process-withdrawal.
 *
 * GET /api/withdrawal/my
 *   Returns all withdrawal requests for the authenticated user.
 *   User identity is taken from the JWT, not a query parameter.
 */

const express = require('express');
const router  = express.Router();

const { requireUserJWT } = require('./auth');
const { store, generateId } = require('./store');

const WITHDRAWAL_FEE_RATE = 0.10;
const WITHDRAWAL_MIN      = 50;

// All routes below require a valid user JWT
router.use(requireUserJWT);

// ── POST /api/withdrawal/submit ─────────────────────────────────────────────
router.post('/submit', (req, res) => {
  // userId comes from the verified JWT, not the request body
  const userId = req.userId;
  const user   = store.users.find(u => u.id === userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const { amount, method, account } = req.body || {};

  if (!amount || !method || !account) {
    return res.status(400).json({ error: 'amount, method, and account are required' });
  }

  const parsedAmount = Number(amount);
  if (!Number.isFinite(parsedAmount) || parsedAmount < WITHDRAWAL_MIN) {
    return res.status(400).json({ error: `Minimum withdrawal amount is R${WITHDRAWAL_MIN}` });
  }

  if ((user.wallet || 0) < parsedAmount) {
    return res.status(400).json({ error: 'Insufficient wallet balance' });
  }

  const fee = parseFloat((parsedAmount * WITHDRAWAL_FEE_RATE).toFixed(2));
  const net = parseFloat((parsedAmount - fee).toFixed(2));
  const now = Date.now();

  // Deduct from wallet
  user.wallet = parseFloat(((user.wallet || 0) - parsedAmount).toFixed(2));

  const withdrawal = {
    id:        generateId(),
    userId:    user.id,
    username:  user.username,
    email:     user.email,
    amount:    parsedAmount,
    fee,
    net,
    method,
    account,
    status:    'pending',
    createdAt: now,
  };

  store.withdrawals.push(withdrawal);

  // Transaction log entry
  store.transactions.push({
    id:        generateId(),
    userId:    user.id,
    username:  user.username,
    email:     user.email,
    type:      'withdrawal',
    amount:    parsedAmount,
    status:    'pending',
    note:      `${method} withdrawal`,
    createdAt: now,
  });

  console.log(`[Withdrawal] Pending withdrawal created: ${withdrawal.id} for user ${userId} amount ${parsedAmount}`);
  return res.status(201).json({ success: true, withdrawalId: withdrawal.id, withdrawal });
});

// ── GET /api/withdrawal/my ──────────────────────────────────────────────────
router.get('/my', (req, res) => {
  const myWithdrawals = store.withdrawals
    .filter(w => w.userId === req.userId)
    .sort((a, b) => b.createdAt - a.createdAt);
  return res.json({ withdrawals: myWithdrawals });
});

module.exports = router;
