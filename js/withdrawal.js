/* =============================================
   withdrawal.js – Withdrawal with 10% fee, R50 min
   ============================================= */

'use strict';

const WITHDRAWAL_FEE_RATE = 0.10;
const WITHDRAWAL_MIN      = 50;

let currentUser = null;

document.addEventListener('DOMContentLoaded', () => {
  currentUser = requireAuth();
  if (!currentUser) return;

  renderWalletInfo();
  renderWithdrawalHistory();

  const amountInput = document.getElementById('withdrawal-amount');
  if (amountInput) {
    amountInput.addEventListener('input', updateFeeBreakdown);
    amountInput.addEventListener('blur',  validateAmount);
  }

  document.getElementById('withdrawal-form')?.addEventListener('submit', handleWithdrawal);
  document.getElementById('withdraw-max-btn')?.addEventListener('click', setMaxAmount);
});

// ── Wallet Info ───────────────────────────────────────────────────────────────
function renderWalletInfo() {
  setEl('wallet-balance', formatZAR(currentUser.wallet || 0));
  setEl('wallet-available', formatZAR(Math.max(0, (currentUser.wallet || 0))));

  const minEl = document.getElementById('withdraw-min-display');
  if (minEl) minEl.textContent = formatZAR(WITHDRAWAL_MIN);
}

// ── Fee Breakdown ─────────────────────────────────────────────────────────────
function updateFeeBreakdown() {
  const rawVal = parseFloat(document.getElementById('withdrawal-amount')?.value) || 0;
  const fee    = rawVal * WITHDRAWAL_FEE_RATE;
  const net    = rawVal - fee;

  setEl('fee-gross',   rawVal > 0 ? formatZAR(rawVal) : '—');
  setEl('fee-amount',  rawVal > 0 ? formatZAR(fee)    : '—');
  setEl('fee-net',     rawVal > 0 ? formatZAR(net)    : '—');

  // Validation color hints
  const amountEl = document.getElementById('withdrawal-amount');
  const errorEl  = document.getElementById('amount-error');

  if (rawVal > 0 && rawVal < WITHDRAWAL_MIN) {
    amountEl?.classList.add('error');
    if (errorEl) { errorEl.textContent = `Minimum withdrawal is ${formatZAR(WITHDRAWAL_MIN)}.`; errorEl.classList.add('show'); }
  } else if (rawVal > (currentUser.wallet || 0)) {
    amountEl?.classList.add('error');
    if (errorEl) { errorEl.textContent = 'Amount exceeds your wallet balance.'; errorEl.classList.add('show'); }
  } else {
    amountEl?.classList.remove('error');
    if (errorEl) { errorEl.textContent = ''; errorEl.classList.remove('show'); }
  }
}

function validateAmount() {
  updateFeeBreakdown();
}

function setMaxAmount() {
  const maxInput = document.getElementById('withdrawal-amount');
  if (maxInput) {
    maxInput.value = (currentUser.wallet || 0).toFixed(2);
    updateFeeBreakdown();
  }
}

// ── Submit Withdrawal ─────────────────────────────────────────────────────────
function handleWithdrawal(e) {
  e.preventDefault();

  const amount  = parseFloat(document.getElementById('withdrawal-amount')?.value) || 0;
  const method  = document.getElementById('withdrawal-method')?.value || 'bank_transfer';
  const account = document.getElementById('withdrawal-account')?.value.trim() || '';
  const btn     = document.getElementById('withdraw-btn');

  // Validate
  if (amount < WITHDRAWAL_MIN) {
    showToast(`Minimum withdrawal is ${formatZAR(WITHDRAWAL_MIN)}.`, 'error');
    return;
  }
  if (amount > (currentUser.wallet || 0)) {
    showToast('Insufficient wallet balance.', 'error');
    return;
  }
  if (!account) {
    showToast('Please enter your account / payment details.', 'error');
    return;
  }

  if (btn) btn.disabled = true;

  const fee    = parseFloat((amount * WITHDRAWAL_FEE_RATE).toFixed(2));
  const net    = parseFloat((amount - fee).toFixed(2));
  const now    = Date.now();

  // Deduct from wallet
  currentUser.wallet = parseFloat(((currentUser.wallet || 0) - amount).toFixed(2));
  updateUserInStore(currentUser);

  // Create withdrawal request in admin data
  const admin = getAdminData();
  admin.withdrawals.push({
    id:        generateId(),
    userId:    currentUser.id,
    username:  currentUser.username,
    email:     currentUser.email,
    amount,
    fee,
    net,
    method,
    account,
    status:    'pending',
    createdAt: now,
  });
  saveAdminData(admin);

  // Log transaction
  addTransaction(currentUser.id, 'withdrawal', amount, `${method} withdrawal`, 'pending');

  // Reset form
  const form = document.getElementById('withdrawal-form');
  if (form) form.reset();
  updateFeeBreakdown();
  renderWalletInfo();
  renderWithdrawalHistory();

  showToast(`✅ Withdrawal of ${formatZAR(amount)} submitted! You'll receive ${formatZAR(net)} after fees.`, 'success', 6000);
  if (btn) btn.disabled = false;
}

// ── Withdrawal History ────────────────────────────────────────────────────────
function renderWithdrawalHistory() {
  const tbody = document.getElementById('withdrawal-tbody');
  if (!tbody) return;

  const admin = getAdminData();
  const myW   = admin.withdrawals
    .filter(w => w.userId === currentUser.id)
    .sort((a, b) => b.createdAt - a.createdAt);

  if (myW.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted" style="padding:2rem">No withdrawals yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = myW.map(w => `
    <tr>
      <td data-label="Date">${formatDateTime(w.createdAt)}</td>
      <td data-label="Amount">${formatZAR(w.amount)}</td>
      <td data-label="Fee" class="text-red">- ${formatZAR(w.fee)}</td>
      <td data-label="You Receive" class="text-green">${formatZAR(w.net)}</td>
      <td data-label="Method">${methodLabel(w.method)}</td>
      <td data-label="Status"><span class="badge badge-${w.status}">${statusDot(w.status)} ${w.status}</span></td>
    </tr>
  `).join('');
}

function methodLabel(method) {
  const map = { bank_transfer: '🏦 Bank Transfer', paypal: '🅿️ PayPal', crypto: '₿ Crypto' };
  return map[method] || method;
}

function statusDot(status) {
  return `<span class="badge-dot"></span>`;
}

// ── DOM Helper ────────────────────────────────────────────────────────────────
function setEl(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}
