/* =============================================
   withdrawal.js – Withdrawal with 10% fee, R50 min
   ============================================= */

'use strict';

const WITHDRAWAL_FEE_RATE = 0.10;
const WITHDRAWAL_MIN      = 50;

let currentUser = null;

document.addEventListener('DOMContentLoaded', async () => {
  currentUser = requireAuth();
  if (!currentUser) return;

  // Refresh user data from backend
  try {
    const data = await apiRequest('/api/user/me');
    currentUser = data.user;
    saveCurrentUser(currentUser);
  } catch (_err) { /* use cached user */ }

  renderWalletInfo();
  renderWithdrawalHistory();

  const amountInput = document.getElementById('withdrawal-amount');
  if (amountInput) {
    amountInput.addEventListener('input', updateFeeBreakdown);
    amountInput.addEventListener('blur',  validateAmount);
  }

  document.getElementById('withdrawal-form')  ?.addEventListener('submit', handleWithdrawal);
  document.getElementById('withdraw-max-btn') ?.addEventListener('click', setMaxAmount);
});

// ── Wallet Info ───────────────────────────────────────────────────────────────
function renderWalletInfo() {
  setEl('wallet-balance',   formatZAR(currentUser.wallet || 0));
  setEl('wallet-available', formatZAR(Math.max(0, currentUser.wallet || 0)));

  const minEl = document.getElementById('withdraw-min-display');
  if (minEl) minEl.textContent = formatZAR(WITHDRAWAL_MIN);
}

// ── Fee Breakdown ─────────────────────────────────────────────────────────────
function updateFeeBreakdown() {
  const rawVal = parseFloat(document.getElementById('withdrawal-amount')?.value) || 0;
  const fee    = rawVal * WITHDRAWAL_FEE_RATE;
  const net    = rawVal - fee;

  setEl('fee-gross',  rawVal > 0 ? formatZAR(rawVal) : '—');
  setEl('fee-amount', rawVal > 0 ? formatZAR(fee)    : '—');
  setEl('fee-net',    rawVal > 0 ? formatZAR(net)    : '—');

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

function validateAmount() { updateFeeBreakdown(); }

function setMaxAmount() {
  const maxInput = document.getElementById('withdrawal-amount');
  if (maxInput) {
    maxInput.value = (currentUser.wallet || 0).toFixed(2);
    updateFeeBreakdown();
  }
}

// ── Submit Withdrawal ─────────────────────────────────────────────────────────
async function handleWithdrawal(e) {
  e.preventDefault();

  const amount  = parseFloat(document.getElementById('withdrawal-amount')?.value) || 0;
  const method  = document.getElementById('withdrawal-method')?.value || 'bank_transfer';
  const account = document.getElementById('withdrawal-account')?.value.trim() || '';
  const btn     = document.getElementById('withdraw-btn');

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

  const fee = parseFloat((amount * WITHDRAWAL_FEE_RATE).toFixed(2));
  const net = parseFloat((amount - fee).toFixed(2));

  try {
    // Submit withdrawal to backend — wallet is deducted server-side.
    // userId is derived from the JWT, not sent by the client.
    await apiRequest('/api/withdrawal/submit', {
      method: 'POST',
      body: { amount, method, account },
    });

    // Refresh user data to reflect wallet deduction made by backend
    try {
      const userData = await apiRequest('/api/user/me');
      currentUser = userData.user;
      saveCurrentUser(currentUser);
    } catch (_e) {
      // Optimistic local update if backend refresh fails
      currentUser.wallet = parseFloat(((currentUser.wallet || 0) - amount).toFixed(2));
      saveCurrentUser(currentUser);
    }

    const form = document.getElementById('withdrawal-form');
    if (form) form.reset();
    updateFeeBreakdown();
    renderWalletInfo();
    await renderWithdrawalHistory();

    showToast(`Withdrawal of ${formatZAR(amount)} submitted! You'll receive ${formatZAR(net)} after fees.`, 'success', 6000);
  } catch (err) {
    showToast('Withdrawal failed: ' + err.message, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ── Withdrawal History ────────────────────────────────────────────────────────
async function renderWithdrawalHistory() {
  const tbody = document.getElementById('withdrawal-tbody');
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted" style="padding:2rem">Loading…</td></tr>`;

  try {
    // userId is inferred from the JWT by the backend
    const data = await apiRequest('/api/withdrawal/my');
    const myW  = data.withdrawals || [];

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
  } catch (_err) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted" style="padding:2rem">Could not load withdrawal history.</td></tr>`;
  }
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
