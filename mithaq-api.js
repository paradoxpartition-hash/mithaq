/**
 * mithaq-api.js
 * Drop this file into your GitHub Pages repo root.
 * Include it on every page: <script src="/mithaq/mithaq-api.js"></script>
 *
 * Provides:
 *   MithaqAPI.auth.*       — login, logout, session
 *   MithaqAPI.agreement.*  — draft, sign, status
 *   MithaqAPI.passport.*   — upload, getSignedUrl
 *   MithaqAPI.submission.* — submit agreement
 */

(function (global) {
  "use strict";

  // ─── CONFIG ────────────────────────────────────────────────────────────────
  const SUPABASE_URL  = "https://xbbdigovnztxoxpydjav.supabase.co";
  const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhiYmRpZ292bnp0eG94cHlkamF2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU1NjEyNTQsImV4cCI6MjA5MTEzNzI1NH0.KowtdA94sOokbvh5C5aTHV75e15cX6vY8vEvuX5qEMs"; // Replace with your real anon key from Supabase dashboard → Settings → API
  const FN_BASE       = `${SUPABASE_URL}/functions/v1`;

  // ─── SESSION STORAGE ───────────────────────────────────────────────────────
  const SESSION_KEY = "mithaq_session";

  function saveSession(session) {
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch (_) {}
  }

  function loadSession() {
    try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null"); } catch (_) { return null; }
  }

  function clearSession() {
    try { sessionStorage.removeItem(SESSION_KEY); } catch (_) {}
  }

  function getToken() {
    const s = loadSession();
    return s?.access_token || null;
  }

  // ─── HTTP HELPERS ──────────────────────────────────────────────────────────
  async function callFunction(name, body, method = "POST") {
    const token = getToken();
    const headers = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const res = await fetch(`${FN_BASE}/${name}`, {
      method,
      headers,
      body: method !== "GET" ? JSON.stringify(body) : undefined,
    });

    const data = await res.json().catch(() => ({ error: "Invalid response from server" }));

    if (!res.ok) {
      throw new Error(data.error || `Request failed: ${res.status}`);
    }
    return data;
  }

  async function callFunctionGet(name, params = {}) {
    const token = getToken();
    const headers = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const qs = new URLSearchParams(params).toString();
    const url = `${FN_BASE}/${name}${qs ? "?" + qs : ""}`;

    const res = await fetch(url, { method: "GET", headers });
    const data = await res.json().catch(() => ({ error: "Invalid response from server" }));

    if (!res.ok) throw new Error(data.error || `Request failed: ${res.status}`);
    return data;
  }

  async function callSupabaseAuth(path, body) {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": SUPABASE_ANON,
      },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({ error: "Auth error" }));
    if (!res.ok) throw new Error(data.error_description || data.msg || data.error || "Auth failed");
    return data;
  }

  // ─── AUTH ──────────────────────────────────────────────────────────────────
  const auth = {
    /**
     * Sign in with email + password (for accounts created via /purchase)
     * @param {string} email
     * @param {string} password
     * @returns {Promise<{user, session}>}
     */
    async signIn(email, password) {
      const data = await callSupabaseAuth("token?grant_type=password", { email, password });
      saveSession(data);
      return data;
    },

    /**
     * Sign out — clears local session and invalidates server token
     */
    async signOut() {
      const token = getToken();
      if (token) {
        await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${token}`, "apikey": SUPABASE_ANON },
        }).catch(() => {});
      }
      clearSession();
    },

    /**
     * Get current session (from sessionStorage)
     * @returns {object|null}
     */
    getSession() {
      return loadSession();
    },

    /**
     * Get current user object
     * @returns {object|null}
     */
    getUser() {
      const s = loadSession();
      return s?.user || null;
    },

    /**
     * Check if user is authenticated
     * @returns {boolean}
     */
    isAuthenticated() {
      const s = loadSession();
      if (!s?.access_token || !s?.expires_at) return false;
      return Date.now() / 1000 < s.expires_at;
    },

    /**
     * Redirect to login if not authenticated
     * @param {string} [returnTo] — path to return to after login
     */
    requireAuth(returnTo) {
      if (!this.isAuthenticated()) {
        const base = "/mithaq/login.html";
        const redirect = returnTo || window.location.pathname + window.location.search;
        window.location.href = `${base}?returnTo=${encodeURIComponent(redirect)}`;
      }
    },

    /**
     * UAE PASS — exchange auth code for Supabase session
     * Called on the callback page after UAE PASS redirects back
     * @param {string} code — the auth code from UAE PASS
     * @param {string} state
     */
    async uaePassCallback(code, state) {
      const data = await callFunction("auth-uaepass", { code, state });
      // UAE PASS returns a magic link — follow it to complete session
      if (data.magic_link) {
        window.location.href = data.magic_link;
      }
      return data;
    },

    /**
     * Handle magic link / recovery token from URL hash
     * Call this on your auth callback page
     */
    async handleMagicLink() {
      const hash = window.location.hash.substring(1);
      const params = new URLSearchParams(hash);
      const accessToken  = params.get("access_token");
      const refreshToken = params.get("refresh_token");
      const expiresIn    = params.get("expires_in");
      const type         = params.get("type");

      if (accessToken) {
        const session = {
          access_token:  accessToken,
          refresh_token: refreshToken,
          expires_at:    Math.floor(Date.now() / 1000) + parseInt(expiresIn || "3600"),
          token_type:    "bearer",
        };
        // Fetch user info
        try {
          const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
            headers: { "Authorization": `Bearer ${accessToken}`, "apikey": SUPABASE_ANON },
          });
          if (res.ok) session.user = await res.json();
        } catch (_) {}

        saveSession(session);
        return { session, type };
      }
      return null;
    },
  };

  // ─── AGREEMENT ─────────────────────────────────────────────────────────────
  const agreement = {
    /**
     * Create a new draft agreement
     * @param {object} opts
     * @param {string} opts.marriage_type — 'sharia' | 'civil'
     * @param {string} opts.jurisdiction  — e.g. 'UAE'
     * @param {string} [opts.governing_law]
     * @param {string} [opts.dispute_resolution]
     * @returns {Promise<{agreement_id, reference_number, status}>}
     */
    async draft(opts) {
      return callFunction("agreement-draft", opts);
    },

    /**
     * Sign an agreement
     * @param {string} agreementId
     * @param {object} signaturePayload — any signature metadata
     * @returns {Promise<{agreement_id, agreement_hash, status, signed_at}>}
     */
    async sign(agreementId, signaturePayload) {
      return callFunction("agreement-sign", {
        agreement_id: agreementId,
        signature_payload: signaturePayload,
      });
    },

    /**
     * Get full agreement status including passport & submission
     * @param {string} agreementId
     * @returns {Promise<{agreement}>}
     */
    async status(agreementId) {
      return callFunctionGet("agreement-status", { agreement_id: agreementId });
    },

    /**
     * Submit a signed agreement to the government submission engine
     * @param {string} agreementId
     * @returns {Promise<{submission_id, submission_reference, provider, status}>}
     */
    async submit(agreementId) {
      return callFunction("submission", { agreement_id: agreementId });
    },
  };

  // ─── PASSPORT ──────────────────────────────────────────────────────────────
  const passport = {
    /**
     * Upload a passport document
     * @param {string} agreementId
     * @param {File} file
     * @param {object} metadata
     * @param {string} metadata.full_name
     * @param {string} metadata.passport_number
     * @param {string} metadata.nationality
     * @param {string} metadata.expiry_date — YYYY-MM-DD
     * @returns {Promise<{document_id, document_hash, verification_status}>}
     */
    async upload(agreementId, file, metadata) {
      const token = getToken();
      if (!token) throw new Error("Not authenticated");

      const form = new FormData();
      form.append("agreement_id", agreementId);
      form.append("file", file);
      form.append("full_name", metadata.full_name);
      form.append("passport_number", metadata.passport_number);
      form.append("nationality", metadata.nationality);
      form.append("expiry_date", metadata.expiry_date);

      const res = await fetch(`${FN_BASE}/passport-upload`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}` },
        body: form,
      });

      const data = await res.json().catch(() => ({ error: "Upload failed" }));
      if (!res.ok) throw new Error(data.error || "Passport upload failed");
      return data;
    },

    /**
     * Get a short-lived signed URL for a passport document (5 min expiry)
     * @param {string} documentId
     * @returns {Promise<{signed_url, expires_in_seconds}>}
     */
    async getSignedUrl(documentId) {
      return callFunction("passport-signed-url", { document_id: documentId });
    },
  };

  // ─── PAYMENT ───────────────────────────────────────────────────────────────
  const payment = {
    /**
     * Trigger account creation after a successful Stripe payment
     * Called from success.html with the session_id from the URL
     * @param {string} email
     * @param {string} packageType
     * @param {string} stripeSessionId
     * @returns {Promise<{success, message, user_id}>}
     */
    async activateAccount(email, packageType, stripeSessionId) {
      return callFunction("purchase", {
        email,
        package_type: packageType,
        stripe_session_id: stripeSessionId,
      });
    },
  };

  // ─── UI UTILITIES ──────────────────────────────────────────────────────────
  const ui = {
    /**
     * Show a toast notification
     * @param {string} message
     * @param {'success'|'error'|'info'} type
     * @param {number} [duration=4000]
     */
    toast(message, type = "info", duration = 4000) {
      const existing = document.querySelector(".mithaq-toast");
      if (existing) existing.remove();

      const colors = {
        success: "#1a6b3c",
        error:   "#8b1a1a",
        info:    "#1a3a6b",
      };

      const toast = document.createElement("div");
      toast.className = "mithaq-toast";
      toast.textContent = message;
      Object.assign(toast.style, {
        position:        "fixed",
        bottom:          "2rem",
        right:           "2rem",
        background:      colors[type] || colors.info,
        color:           "#fff",
        padding:         "1rem 1.5rem",
        borderRadius:    "4px",
        fontSize:        "0.9rem",
        fontFamily:      "inherit",
        boxShadow:       "0 4px 20px rgba(0,0,0,0.3)",
        zIndex:          "9999",
        maxWidth:        "360px",
        lineHeight:      "1.4",
        opacity:         "0",
        transform:       "translateY(10px)",
        transition:      "opacity 0.2s, transform 0.2s",
      });

      document.body.appendChild(toast);
      requestAnimationFrame(() => {
        toast.style.opacity = "1";
        toast.style.transform = "translateY(0)";
      });

      setTimeout(() => {
        toast.style.opacity = "0";
        toast.style.transform = "translateY(10px)";
        setTimeout(() => toast.remove(), 300);
      }, duration);
    },

    /**
     * Show/hide a loading spinner on a button
     * @param {HTMLElement} btn
     * @param {boolean} loading
     * @param {string} [loadingText]
     */
    setButtonLoading(btn, loading, loadingText = "Please wait…") {
      if (loading) {
        btn.dataset.originalText = btn.textContent;
        btn.textContent = loadingText;
        btn.disabled = true;
        btn.style.opacity = "0.7";
      } else {
        btn.textContent = btn.dataset.originalText || btn.textContent;
        btn.disabled = false;
        btn.style.opacity = "";
      }
    },

    /**
     * Display a field error under an input
     * @param {HTMLElement} input
     * @param {string} message
     */
    fieldError(input, message) {
      const existing = input.parentNode.querySelector(".mithaq-field-error");
      if (existing) existing.remove();

      if (message) {
        const err = document.createElement("span");
        err.className = "mithaq-field-error";
        err.textContent = message;
        Object.assign(err.style, {
          display:   "block",
          color:     "#c0392b",
          fontSize:  "0.8rem",
          marginTop: "0.25rem",
        });
        input.parentNode.appendChild(err);
        input.style.borderColor = "#c0392b";
      } else {
        input.style.borderColor = "";
      }
    },

    /** Clear all field errors in a form */
    clearErrors(form) {
      form.querySelectorAll(".mithaq-field-error").forEach(e => e.remove());
      form.querySelectorAll("input, select").forEach(i => (i.style.borderColor = ""));
    },
  };

  // ─── EXPORT ────────────────────────────────────────────────────────────────
  global.MithaqAPI = { auth, agreement, passport, payment, ui, SUPABASE_URL, FN_BASE };
})(window);
