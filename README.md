# ClipCASH
Watch movie clips and rate them to earn rewards. A subscription is required to earn.

---

## Architecture

| Layer       | Technology         | Hosting              |
|-------------|--------------------|----------------------|
| Frontend    | Vanilla HTML/CSS/JS | GitHub Pages         |
| Backend API | Node.js / Express  | Render               |
| Payments    | Yoco               | Webhook → Render     |

The frontend is a static site deployed on GitHub Pages.  
All sensitive operations (admin auth, payment verification, withdrawal processing) are handled by the Render backend at `https://clipcash-kcif.onrender.com`.

---

## Frontend → Backend integration

The frontend JS (`js/app.js`) contains a single configurable constant:

```js
const API_BASE_URL = 'https://clipcash-kcif.onrender.com';
```

All API calls go through the `apiRequest()` helper, which attaches the admin session token when present.

---

## Deployment setup

### 1. Render backend environment variables

Set these in your Render service's **Environment** tab (no trailing slashes):

| Variable              | Description |
|-----------------------|-------------|
| `PORT`                | Server port — Render sets this automatically |
| `ALLOWED_ORIGIN`      | Your GitHub Pages URL, e.g. `https://your-username.github.io` |
| `ADMIN_API_KEY`       | Long random string for server-to-server/CI admin requests |
| `ADMIN_PASSWORD`      | Password used in the admin login form (never stored in browser) |
| `YOCO_WEBHOOK_SECRET` | From your Yoco dashboard (used for HMAC signature verification) |
| `YOCO_SECRET_KEY`     | Yoco secret key (for creating payment sessions) |

Copy `backend/.env.example` to `backend/.env` for local development.

### 2. GitHub Pages CORS setup

1. In your Render service set `ALLOWED_ORIGIN` to exactly your GitHub Pages origin:
   - For a personal/org site: `https://your-username.github.io`
   - For a project page: `https://your-username.github.io` (origin only, no path)
2. Once you switch to a custom domain update `ALLOWED_ORIGIN` to match, e.g. `https://clipcash.co.za`.

### 3. GitHub Pages deployment

No build step is required — the repository root is the site.  
In your repo **Settings → Pages**:
- Source: `Deploy from a branch`
- Branch: `main` / `master`, folder: `/ (root)`

---

## Admin panel access

The admin panel (`admin.html`) now requires backend authentication:

1. Navigate to `admin.html` — a login modal appears.
2. Enter the `ADMIN_PASSWORD` set on Render.
3. The backend verifies the password and returns a short-lived session token (4 hours).
4. The token is stored in `sessionStorage` (never `localStorage` — cleared on tab close).
5. All admin API calls (approve/reject withdrawals, verify transactions) use this token.

**No admin secrets are stored in the browser across sessions.**

---

## Yoco payment flow

1. User selects a plan and clicks **Pay with Yoco** → frontend calls `POST /api/deposit/initiate`.
2. Backend records a `pending` transaction.
3. Yoco processes the payment and sends a `payment.succeeded` webhook to `POST /api/webhook/yoco`.
4. Admin verifies the transaction in the admin panel → `POST /api/admin/verify-transaction`.
5. Subscription is activated for the user.

---

## Local development

```bash
cd backend
cp .env.example .env   # fill in values
npm install
npm run dev            # starts with nodemon on port 3000
```

Then open the frontend HTML files directly in a browser (or serve them with a local static server).
