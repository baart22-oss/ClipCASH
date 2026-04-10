/* =============================================
   auth.js – Register / Login logic
   ============================================= */

'use strict';

document.addEventListener('DOMContentLoaded', () => {
  // Redirect if already logged in
  const token = getUserToken();
  if (token && getCurrentUser()) { window.location.href = 'dashboard.html'; return; }

  // Pre-select tab from URL param
  const params = new URLSearchParams(window.location.search);
  if (params.get('tab') === 'register') switchTab('register');

  // Form wiring
  document.getElementById('login-form')   ?.addEventListener('submit', handleLogin);
  document.getElementById('register-form')?.addEventListener('submit', handleRegister);

  // Toggle password visibility
  document.querySelectorAll('.toggle-pw').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = btn.previousElementSibling;
      if (!input) return;
      input.type = input.type === 'password' ? 'text' : 'password';
      btn.textContent = input.type === 'password' ? '👁️' : '🙈';
    });
  });

  // Real-time password strength
  const pwInput = document.getElementById('reg-password');
  if (pwInput) pwInput.addEventListener('input', updatePasswordStrength);
});

// ── Tab Switching ────────────────────────────────────────────────────────────
function switchTab(tab) {
  const loginPanel    = document.getElementById('login-panel');
  const registerPanel = document.getElementById('register-panel');
  const loginTab      = document.getElementById('tab-login');
  const registerTab   = document.getElementById('tab-register');

  if (tab === 'login') {
    loginPanel   ?.classList.remove('hidden');
    registerPanel?.classList.add('hidden');
    loginTab    ?.classList.add('active');
    registerTab ?.classList.remove('active');
  } else {
    loginPanel   ?.classList.add('hidden');
    registerPanel?.classList.remove('hidden');
    registerTab  ?.classList.add('active');
    loginTab     ?.classList.remove('active');
  }
  clearErrors();
}

// ── Login ────────────────────────────────────────────────────────────────────
async function handleLogin(e) {
  e.preventDefault();
  clearErrors();

  const email    = document.getElementById('login-email')   ?.value.trim().toLowerCase();
  const password = document.getElementById('login-password')?.value;
  const btn      = document.getElementById('login-btn');

  if (!email || !password) {
    showError('login-error', 'Please enter your email and password.');
    return;
  }

  setLoading(btn, true);

  try {
    const data = await apiRequest('/api/auth/login', {
      method: 'POST',
      body: { email, password },
    });

    setUserToken(data.token);
    saveCurrentUser(data.user);

    showToast('Welcome back, ' + data.user.username + '! 👋', 'success');
    setTimeout(() => {
      window.location.href = 'dashboard.html';
    }, 800);
  } catch (err) {
    showError('login-error', err.status === 401
      ? 'Invalid email or password. Please try again.'
      : 'Login failed: ' + err.message);
    setLoading(btn, false);
  }
}

// ── Register ─────────────────────────────────────────────────────────────────
async function handleRegister(e) {
  e.preventDefault();
  clearErrors();

  const username    = document.getElementById('reg-username')   ?.value.trim();
  const email       = document.getElementById('reg-email')      ?.value.trim().toLowerCase();
  const password    = document.getElementById('reg-password')   ?.value;
  const confirmPw   = document.getElementById('reg-confirm-pw') ?.value;
  const referralInp = document.getElementById('reg-referral')   ?.value.trim().toUpperCase();
  const btn         = document.getElementById('register-btn');

  // Client-side validation
  let valid = true;

  if (!username || username.length < 3) {
    showError('reg-username-error', 'Username must be at least 3 characters.');
    valid = false;
  }
  if (!isValidEmail(email)) {
    showError('reg-email-error', 'Please enter a valid email address.');
    valid = false;
  }
  if (!password || password.length < 6) {
    showError('reg-password-error', 'Password must be at least 6 characters.');
    valid = false;
  }
  if (password !== confirmPw) {
    showError('reg-confirm-error', 'Passwords do not match.');
    valid = false;
  }
  if (!valid) return;

  setLoading(btn, true);

  try {
    const data = await apiRequest('/api/auth/register', {
      method: 'POST',
      body: {
        username,
        email,
        password,
        referralCode: referralInp || undefined,
      },
    });

    setUserToken(data.token);
    saveCurrentUser(data.user);

    showToast('Account created! Welcome to Clip Cash 🎉', 'success');
    setTimeout(() => { window.location.href = 'dashboard.html'; }, 1000);
  } catch (err) {
    if (err.status === 409) {
      // Duplicate email or username
      const msg = err.data && err.data.error ? err.data.error : 'Account already exists.';
      if (msg.toLowerCase().includes('email')) {
        showError('reg-email-error', msg);
      } else {
        showError('reg-username-error', msg);
      }
    } else if (err.status === 400 && err.data && err.data.error && err.data.error.toLowerCase().includes('referral')) {
      showError('reg-referral-error', err.data.error);
    } else {
      showError('reg-email-error', 'Registration failed: ' + err.message);
    }
    setLoading(btn, false);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || '');
}

function showError(elId, msg) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
}

function clearErrors() {
  document.querySelectorAll('.form-error').forEach(el => {
    el.textContent = '';
    el.classList.remove('show');
  });
}

function setLoading(btn, loading) {
  if (!btn) return;
  btn.disabled = loading;
  btn.textContent = loading ? 'Please wait…' : btn.getAttribute('data-default-text') || btn.textContent;
}

function updatePasswordStrength() {
  const pw    = document.getElementById('reg-password')?.value || '';
  const bar   = document.getElementById('pw-strength-bar');
  const label = document.getElementById('pw-strength-label');
  if (!bar) return;

  let score = 0;
  if (pw.length >= 6)          score++;
  if (pw.length >= 10)         score++;
  if (/[A-Z]/.test(pw))        score++;
  if (/[0-9]/.test(pw))        score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;

  const levels = [
    { label: 'Too short',  color: '#ff4757', width: '10%'  },
    { label: 'Weak',       color: '#ff6b35', width: '25%'  },
    { label: 'Fair',       color: '#f0a500', width: '50%'  },
    { label: 'Good',       color: '#2ed573', width: '75%'  },
    { label: 'Strong',     color: '#00d68f', width: '100%' },
  ];
  const lvl = levels[Math.min(score, 4)];
  bar.style.width      = pw.length < 1 ? '0%'    : lvl.width;
  bar.style.background = pw.length < 1 ? ''      : lvl.color;
  if (label) label.textContent = pw.length < 1 ? '' : lvl.label;
}
