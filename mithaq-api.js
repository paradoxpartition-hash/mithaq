/**
 * mithaq-api.js — v2 with multilingual support
 * Include on every page: <script src="/mithaq/mithaq-api.js"></script>
 */

(function (global) {
  "use strict";

  const SUPABASE_URL  = "https://xbbdigovnztxoxpydjav.supabase.co";
  const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhiYmRpZ292bnp0eG94cHlkamF2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU1NjEyNTQsImV4cCI6MjA5MTEzNzI1NH0.KowtdA94sOokbvh5C5aTHV75e15cX6vY8vEvuX5qEMs";
  const FN_BASE       = `${SUPABASE_URL}/functions/v1`;

  // ─── SUPPORTED LOCALES ────────────────────────────────────────────────────
  const SUPPORTED_LOCALES = ['en','ar','ru','zh','es','hi','ur'];
  const RTL_LOCALES = ['ar','ur'];

  // ─── LOCALE DETECTION ─────────────────────────────────────────────────────
  // Reads locale set by the frontend language switcher (localStorage)
  // Falls back to browser language, then 'en'
  function getLocale() {
    const stored = localStorage.getItem('mithaq_lang');
    if (stored && SUPPORTED_LOCALES.includes(stored)) return stored;
    const browser = (navigator.language || 'en').split('-')[0].toLowerCase();
    return SUPPORTED_LOCALES.includes(browser) ? browser : 'en';
  }

  function setLocale(locale) {
    if (SUPPORTED_LOCALES.includes(locale)) {
      localStorage.setItem('mithaq_lang', locale);
    }
  }

  // ─── SESSION ──────────────────────────────────────────────────────────────
  const SESSION_KEY = "mithaq_session";
  function saveSession(s) { try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch (_) {} }
  function loadSession() { try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null"); } catch (_) { return null; } }
  function clearSession() { try { sessionStorage.removeItem(SESSION_KEY); } catch (_) {} }
  function getToken() { const s = loadSession(); return s?.access_token || null; }

  // ─── HTTP HELPERS ─────────────────────────────────────────────────────────
  // Automatically attaches Accept-Language + X-Locale headers to every request
  async function callFunction(name, body, method = "POST") {
    const token = getToken();
    const locale = getLocale();
    const headers = {
      "Content-Type": "application/json",
      "Accept-Language": locale,
      "X-Locale": locale,
    };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const res = await fetch(`${FN_BASE}/${name}`, {
      method,
      headers,
      body: method !== "GET" ? JSON.stringify(body) : undefined,
    });

    const data = await res.json().catch(() => ({ error: "Invalid response from server" }));
    if (!res.ok) throw new Error(data.error || `Request failed: ${res.status}`);
    return data;
  }

  async function callFunctionGet(name, params = {}) {
    const token = getToken();
    const locale = getLocale();
    const headers = { "Accept-Language": locale, "X-Locale": locale };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const qs = new URLSearchParams(params).toString();
    const res = await fetch(`${FN_BASE}/${name}${qs ? "?" + qs : ""}`, { method: "GET", headers });
    const data = await res.json().catch(() => ({ error: "Invalid response from server" }));
    if (!res.ok) throw new Error(data.error || `Request failed: ${res.status}`);
    return data;
  }

  async function callSupabaseAuth(path, body) {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "apikey": SUPABASE_ANON },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({ error: "Auth error" }));
    if (!res.ok) throw new Error(data.error_description || data.msg || data.error || "Auth failed");
    return data;
  }

  // ─── AUTH ─────────────────────────────────────────────────────────────────
  const auth = {
    async signIn(email, password) {
      const data = await callSupabaseAuth("token?grant_type=password", { email, password });
      saveSession(data);
      return data;
    },
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
    getSession() { return loadSession(); },
    getUser() { const s = loadSession(); return s?.user || null; },
    isAuthenticated() {
      const s = loadSession();
      if (!s?.access_token || !s?.expires_at) return false;
      return Date.now() / 1000 < s.expires_at;
    },
    requireAuth(returnTo) {
      if (!this.isAuthenticated()) {
        const redirect = returnTo || window.location.pathname + window.location.search;
        window.location.href = `/mithaq/login.html?returnTo=${encodeURIComponent(redirect)}`;
      }
    },
    async uaePassCallback(code, state) {
      const data = await callFunction("auth-uaepass", { code, state });
      if (data.magic_link) window.location.href = data.magic_link;
      return data;
    },
    async handleMagicLink() {
      const hash = window.location.hash.substring(1);
      const params = new URLSearchParams(hash);
      const accessToken  = params.get("access_token");
      const refreshToken = params.get("refresh_token");
      const expiresIn    = params.get("expires_in");
      const type         = params.get("type");
      if (accessToken) {
        const session = {
          access_token: accessToken, refresh_token: refreshToken,
          expires_at: Math.floor(Date.now() / 1000) + parseInt(expiresIn || "3600"),
          token_type: "bearer",
        };
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

  // ─── AGREEMENT ────────────────────────────────────────────────────────────
  const agreement = {
    async draft(opts) { return callFunction("agreement-draft", opts); },
    async sign(agreementId, signaturePayload) {
      return callFunction("agreement-sign", { agreement_id: agreementId, signature_payload: signaturePayload });
    },
    async status(agreementId) { return callFunctionGet("agreement-status", { agreement_id: agreementId }); },
    async submit(agreementId) { return callFunction("submission", { agreement_id: agreementId }); },
  };

  // ─── PASSPORT ─────────────────────────────────────────────────────────────
  const passport = {
    async upload(agreementId, file, metadata) {
      const token = getToken();
      const locale = getLocale();
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
        headers: { "Authorization": `Bearer ${token}`, "Accept-Language": locale, "X-Locale": locale },
        body: form,
      });
      const data = await res.json().catch(() => ({ error: "Upload failed" }));
      if (!res.ok) throw new Error(data.error || "Passport upload failed");
      return data;
    },
    async getSignedUrl(documentId) { return callFunction("passport-signed-url", { document_id: documentId }); },
  };

  // ─── PAYMENT ──────────────────────────────────────────────────────────────
  const payment = {
    async activateAccount(email, packageType, stripeSessionId) {
      return callFunction("purchase", { email, package_type: packageType, stripe_session_id: stripeSessionId });
    },
  };

  // ─── UI UTILITIES ─────────────────────────────────────────────────────────
  const ui = {
    toast(message, type = "info", duration = 4000) {
      const existing = document.querySelector(".mithaq-toast");
      if (existing) existing.remove();
      const colors = { success: "#1a6b3c", error: "#8b1a1a", info: "#1a3a6b" };
      const locale = getLocale();
      const isRtl = RTL_LOCALES.includes(locale);
      const toast = document.createElement("div");
      toast.className = "mithaq-toast";
      toast.textContent = message;
      Object.assign(toast.style, {
        position: "fixed", bottom: "2rem",
        right: isRtl ? "auto" : "2rem",
        left: isRtl ? "2rem" : "auto",
        direction: isRtl ? "rtl" : "ltr",
        background: colors[type] || colors.info,
        color: "#fff", padding: "1rem 1.5rem", borderRadius: "4px",
        fontSize: "0.9rem", fontFamily: "inherit",
        boxShadow: "0 4px 20px rgba(0,0,0,0.3)", zIndex: "9999",
        maxWidth: "360px", lineHeight: "1.4",
        opacity: "0", transform: "translateY(10px)",
        transition: "opacity 0.2s, transform 0.2s",
      });
      document.body.appendChild(toast);
      requestAnimationFrame(() => { toast.style.opacity = "1"; toast.style.transform = "translateY(0)"; });
      setTimeout(() => {
        toast.style.opacity = "0"; toast.style.transform = "translateY(10px)";
        setTimeout(() => toast.remove(), 300);
      }, duration);
    },
    setButtonLoading(btn, loading, loadingText = "Please wait…") {
      if (loading) {
        btn.dataset.originalText = btn.textContent;
        btn.textContent = loadingText; btn.disabled = true; btn.style.opacity = "0.7";
      } else {
        btn.textContent = btn.dataset.originalText || btn.textContent;
        btn.disabled = false; btn.style.opacity = "";
      }
    },
    fieldError(input, message) {
      const existing = input.parentNode.querySelector(".mithaq-field-error");
      if (existing) existing.remove();
      if (message) {
        const err = document.createElement("span");
        err.className = "mithaq-field-error";
        err.textContent = message;
        Object.assign(err.style, { display: "block", color: "#c0392b", fontSize: "0.8rem", marginTop: "0.25rem" });
        input.parentNode.appendChild(err);
        input.style.borderColor = "#c0392b";
      } else { input.style.borderColor = ""; }
    },
    clearErrors(form) {
      form.querySelectorAll(".mithaq-field-error").forEach(e => e.remove());
      form.querySelectorAll("input, select").forEach(i => (i.style.borderColor = ""));
    },
  };

  // ─── EXPORT ───────────────────────────────────────────────────────────────
  global.MithaqAPI = {
    auth, agreement, passport, payment, ui,
    getLocale, setLocale,
    SUPABASE_URL, FN_BASE,
    SUPPORTED_LOCALES, RTL_LOCALES,
  };
})(window);
