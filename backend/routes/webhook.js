'use strict';

/**
 * Yoco Webhook Handler
 *
 * Production setup:
 *  1. Set YOCO_WEBHOOK_SECRET in your .env file (from Yoco dashboard).
 *  2. Configure Yoco to POST to https://yourdomain.com/api/webhook/yoco
 *  3. The signature verification uses HMAC-SHA256.
 *
 * Yoco docs: https://developer.yoco.com/online/webhooks/overview
 */

const express = require('express');
const crypto  = require('crypto');
const router  = express.Router();

const { requireAdminJWT } = require('./admin');

const WEBHOOK_SECRET = process.env.YOCO_WEBHOOK_SECRET || '';

// In-memory store for demo. Replace with a real DB in production.
const pendingActivations = [];

/**
 * POST /api/webhook/yoco
 * Receives Yoco payment events.
 */
router.post('/yoco', (req, res) => {
  try {
    const rawBody  = req.body; // raw Buffer (because of express.raw middleware in server.js)
    const bodyStr  = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : JSON.stringify(rawBody);

    // ── Signature verification ──────────────────────────────────────────────
    if (WEBHOOK_SECRET) {
      const signature = req.headers['x-yoco-signature'] || '';
      const expected  = crypto
        .createHmac('sha256', WEBHOOK_SECRET)
        .update(bodyStr)
        .digest('hex');

      if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
        console.warn('[Webhook] Invalid Yoco signature received');
        return res.status(401).json({ error: 'Invalid signature' });
      }
    } else {
      console.warn('[Webhook] YOCO_WEBHOOK_SECRET not set — skipping signature verification');
    }

    // ── Parse event ─────────────────────────────────────────────────────────
    let event;
    try {
      event = JSON.parse(bodyStr);
    } catch {
      return res.status(400).json({ error: 'Invalid JSON payload' });
    }

    console.log('[Webhook] Received event:', event.type, event.id);

    // ── Handle payment.succeeded ─────────────────────────────────────────────
    if (event.type === 'payment.succeeded') {
      const payment  = event.payload || {};
      const metadata = payment.metadata || {};

      pendingActivations.push({
        yocoPaymentId: payment.id,
        userId:        metadata.userId    || null,
        tier:          metadata.tier      || null,
        amount:        payment.amountInCents ? payment.amountInCents / 100 : null,
        currency:      payment.currency   || 'ZAR',
        receivedAt:    new Date().toISOString(),
        status:        'pending_activation',
      });

      console.log('[Webhook] payment.succeeded for userId:', metadata.userId, 'tier:', metadata.tier);
    }

    // Always return 200 to Yoco so it doesn't retry
    return res.status(200).json({ received: true });

  } catch (err) {
    console.error('[Webhook] Unexpected error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
});

/**
 * GET /api/webhook/pending
 * Returns pending activations (admin use only).
 */
router.get('/pending', requireAdminJWT, (_req, res) => {
  res.json({ pendingActivations });
});

module.exports = router;
