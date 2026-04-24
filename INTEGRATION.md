# Mithaq Frontend Integration

## Files to add to your GitHub Pages repo

```
mithaq/
├── mithaq-api.js          ← Core API client — include on every page
├── success.html           ← Post-payment account activation
├── login.html             ← Email/password + UAE PASS login
├── dashboard.html         ← Agreement management portal
└── auth/
    └── uaepass-callback.html  ← UAE PASS OAuth callback
```

---

## Setup Steps

### 1. Get your Supabase Anon Key

Go to: **Supabase Dashboard → Settings → API → Project API Keys → anon (public)**

In `mithaq-api.js`, replace the placeholder:
```js
const SUPABASE_ANON = "YOUR_ANON_KEY_HERE";
```

The anon key is safe to expose in frontend code — it only grants public access governed by RLS.

### 2. Update UAE PASS Client ID

Once you have sandbox credentials, update `login.html`:
```js
const clientId = "YOUR_UAEPASS_CLIENT_ID";
```

### 3. Ensure existing purchase.html points to success.html

Your `create-checkout-session` function already sets:
```
success_url: `${SITE_BASE}/success.html?session_id={CHECKOUT_SESSION_ID}`
```
This is already correct — no change needed.

---

## User Flow

```
User clicks "Start Silver/Gold/Platinum/Diamond"
        ↓
purchase.html → Stripe Checkout
        ↓
success.html?session_id=xxx
  → calls /purchase Edge Function
  → creates Supabase auth user
  → sends login email with magic link
        ↓
User clicks email link → login.html (magic link handled)
        ↓
dashboard.html
  → loads agreement status
  → shows passport upload form
  → shows sign button when ready
  → shows submit button when signed
```

---

## API Reference (MithaqAPI)

All methods return Promises and throw on error.

### `MithaqAPI.auth`

| Method | Description |
|---|---|
| `auth.signIn(email, password)` | Sign in with email + password |
| `auth.signOut()` | Sign out, clear session |
| `auth.getUser()` | Returns current user object |
| `auth.isAuthenticated()` | Returns true if session is valid |
| `auth.requireAuth(returnTo?)` | Redirects to login if not authenticated |
| `auth.handleMagicLink()` | Call on login page to handle magic link from URL hash |
| `auth.uaePassCallback(code, state)` | Exchange UAE PASS auth code for session |

### `MithaqAPI.agreement`

| Method | Description |
|---|---|
| `agreement.draft(opts)` | Create a new draft agreement |
| `agreement.sign(id, payload)` | Sign an agreement |
| `agreement.status(id)` | Get full agreement status |
| `agreement.submit(id)` | Submit to government queue |

### `MithaqAPI.passport`

| Method | Description |
|---|---|
| `passport.upload(agreementId, file, metadata)` | Upload passport document |
| `passport.getSignedUrl(documentId)` | Get 5-min signed URL for viewing |

### `MithaqAPI.payment`

| Method | Description |
|---|---|
| `payment.activateAccount(email, packageType, stripeSessionId)` | Create account post-purchase |

### `MithaqAPI.ui`

| Method | Description |
|---|---|
| `ui.toast(message, type, duration?)` | Show toast notification |
| `ui.setButtonLoading(btn, loading, text?)` | Toggle button loading state |
| `ui.fieldError(input, message)` | Show field validation error |
| `ui.clearErrors(form)` | Clear all validation errors |

---

## Security Notes

- The `SUPABASE_ANON` key is safe to expose in frontend code
- The `SUPABASE_SERVICE_ROLE_KEY` is **never** in frontend code — only in Edge Functions
- All passport documents are in a private bucket — accessed via signed URLs only (5-min expiry)
- Sessions are stored in `sessionStorage` (cleared when tab closes)
- All Edge Functions validate JWT before processing
