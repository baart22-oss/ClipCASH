'use strict';

/**
 * Deposit Routes
 *
 * POST /api/deposit/initiate  (requires user JWT)
 *   Creates a pending deposit / subscription transaction in the backend store.
 *   User uploads proof of payment, and admin approves it manually.
 */

const express = require('express');
const router  = express.Router();

const { requireUserJWT } = require('./auth');
const { store, generateId } = require('./store');

// ── POST /api/deposit/initiate ────────────────────────────────────────────────
router.post('/initiate', requireUserJWT, async (req, res) => {
  const userId   = req.userId;
  const user     = await store.findUser(userId);
  const username = user ? user.username : '';
  const email    = user ? user.email    : '';

  const { tier, tierName, amount, method, proofData, proofName, proofType } = req.body || {};

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

  if (!proofData || !proofName || !proofType) {
    return res.status(400).json({ error: 'Proof of payment is required' });
  }

  if (!String(proofData).startsWith('data:')) {
    return res.status(400).json({ error: 'Invalid proof file format' });
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
    method:    method || 'eft',
    note:      'EFT payment pending admin verification',
    createdAt: Date.now(),
    proofData,
    proofName,
    proofType,
  };

  await store.saveTransaction(transaction);
  console.log(`[Deposit] Pending EFT transaction created: ${txId} for user ${userId} tier ${tier}`);

  return res.status(201).json({ success: true, transactionId: txId, transaction });
});

module.exports = router;
