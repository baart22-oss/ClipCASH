'use strict';

/**
 * Deposit Routes
 *
 * POST /api/deposit/initiate  (requires user JWT)
 *   Creates a pending deposit / subscription transaction in the backend store.
 *   Called by the frontend when a user selects Yoco as payment method.
 *   The transaction stays pending until either:
 *     - The Yoco webhook (payment.succeeded) auto-confirms it, or
 *     - An admin manually verifies it via POST /api/admin/verify-transaction.
 *
 * Environment variables required for Yoco live checkout:
 *   YOCO_SECRET_KEY  – your Yoco secret key (from Yoco dashboard)
 *   YOCO_PUBLIC_KEY  – your Yoco publishable key (optional, for display)
 */

const express = require('express');
const router  = express.Router();

const { requireUserJWT } = require('./auth');
const { store, generateId } = require('./store');

// ── POST /api/deposit/initiate ──────────────────────────────────────────────
router.post('/initiate', requireUserJWT, async (req, res) => {
  // userId comes from the verified JWT, not the request body
  const userId   = req.userId;
  const user     = await store.findUser(userId);
  const username = user ? user.username : '';
  const email    = user ? user.email    : '';

  const { tier, tierName, amount, method } = req.body || {};

  if (!tier || !amount) {
    return res.status(400).json({ error: 'tier and amount are required' });
  }

  const validTiers = ['starter', 'bronze', 'silver', 'gold', 'platinum', 'diamond'];
  if (!validTiers.includes(tier)) {
    return res.status(400).json({ error: 'Invalid subscription tier' });
  }

  const parsedAmount = Number(amount);
  if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
    return res.status(400).json({ error: 'Invalid amount' });
  }

  const txId = generateId();
  const transaction = {
    id:        txId,
    userId,
    username:  username || '',
    email:     email    || '',
    type:      'deposit',
    tier,
    tierName:  tierName || tier,
    amount:    parsedAmount,
    status:    'pending',
    method:    method || 'yoco',
    note:      'Yoco payment pending verification',
    createdAt: Date.now(),
  };

  await store.saveTransaction(transaction);
  console.log(`[Deposit] Pending transaction created: ${txId} for user ${userId} tier ${tier}`);

  return res.status(201).json({ success: true, transactionId: txId, transaction });
});

module.exports = router;
