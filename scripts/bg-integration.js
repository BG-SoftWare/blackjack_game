
// BG Soft — Telegram Game Backend Integration
// Adapted for FastAPI PlayerRegisterSchema (telegram_id, username, first_name, last_name)

import { BG_CONFIG } from "./bg-config.js";

const log = (...args) => console.log("[BG-Integration]", ...args);

// Safe access to Telegram WebApp API
function getTelegramContext() {
    const tg = (typeof window !== "undefined" && window.Telegram && window.Telegram.WebApp) ? window.Telegram.WebApp : null;
    if (!tg) return null;
    const unsafe = tg.initDataUnsafe || {};
    const user = unsafe.user || null;
    return {
        tg,
        initData: tg.initData || "",         // raw initData string (for optional future server-side verification)
        initDataUnsafe: unsafe,              // object parsed by Telegram
        user
    };
}

// Small helper for fetch with timeout & retries
async function fetchWithTimeout(url, options = {}, timeoutMs = BG_CONFIG.TIMEOUT_MS, retries = BG_CONFIG.RETRIES) {
    for (let attempt = 0; attempt <= retries; attempt++) {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const res = await fetch(url, { ...options, signal: controller.signal });
            clearTimeout(id);
            return res;
        } catch (e) {
            clearTimeout(id);
            if (attempt === retries) throw e;
        }
    }
}

// Local session state
const SESSION_KEY = "bg_session_v1";
function saveSession(s) { try { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch {} }
function loadSession() { try { return JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); } catch { return null; } }
function clearSession() { try { localStorage.removeItem(SESSION_KEY); } catch {} }

// === Registration payload strictly per PlayerRegisterSchema ===
function buildRegisterPayload() {
    const ctx = getTelegramContext();
    const u = ctx?.user || null;

    // Map to your schema fields:
    // telegram_id: int >= 1
    // username: str|None (1..32 trimmed), first_name: str|None (<=64), last_name: str|None (<=64)
    return {
        telegram_id: u?.id ?? 0, // backend should validate >=1; if 0, you'll get 422
        username: (u?.username ?? null) || null,
        first_name: (u?.first_name ?? null) || null,
        last_name: (u?.last_name ?? null) || null
    };
}

// Optional common headers helper
function buildCommonHeaders() {
    const headers = { "Content-Type": "application/json" };
    if (BG_CONFIG.ATTACH_HINT_HEADERS) {
        try {
            if (navigator?.userAgent) headers["X-Client-User-Agent"] = navigator.userAgent;
            const lang = (navigator?.language || navigator?.userLanguage);
            if (lang) headers["X-Client-Lang"] = lang;
            const sr = `${window?.screen?.width || 0}x${window?.screen?.height || 0}`;
            headers["X-Client-Screen"] = sr;
        } catch {}
    }
    return headers;
}

// API calls
async function registerPlayer() {
    const url = BG_CONFIG.BASE_URL + BG_CONFIG.ENDPOINTS.REGISTER_PLAYER;
    const payload = buildRegisterPayload();
    log("Registering player…", payload);
    const res = await fetchWithTimeout(url, {
        method: "POST",
        headers: buildCommonHeaders(),
        body: JSON.stringify(payload)
    });
    if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Register failed: ${res.status} ${text}`);
    }
    const data = await res.json().catch(() => ({}));
    log("Register OK", data);
    return data; // PlayerResponseSchema
}

async function startSession() {
    const url = BG_CONFIG.BASE_URL + BG_CONFIG.ENDPOINTS.START_SESSION;
    const ctx = getTelegramContext();
    const payload = {
        started_at: new Date().toISOString(),
        telegram_id: ctx?.user?.id ?? null
    };
    const res = await fetchWithTimeout(url, {
        method: "POST",
        headers: buildCommonHeaders(),
        body: JSON.stringify(payload)
    });
    if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Start session failed: ${res.status} ${text}`);
    }
    const data = await res.json().catch(() => ({}));
    saveSession({ id: data.session_id || data.id || null, started_at: payload.started_at });
    log("Session started", data);
    return data;
}

async function endSession(reason = "page_hidden") {
    const session = loadSession();
    const ctx = getTelegramContext();
    const url = BG_CONFIG.BASE_URL + BG_CONFIG.ENDPOINTS.END_SESSION;
    const payload = {
        session_id: session?.id ?? null,
        ended_at: new Date().toISOString(),
        reason,
        telegram_id: ctx?.user?.id ?? null
    };

    const res = await fetchWithTimeout(url, {
        method: "POST",
        headers: buildCommonHeaders(),
        body: JSON.stringify(payload)
    }).catch((e) => {
        // Swallow network error on unload
        console.warn("[BG-Integration] endSession network error:", e.message);
        return null;
    });

    clearSession();
    if (res && !res.ok) {
        const text = await res.text().catch(() => "");
        console.warn("[BG-Integration] endSession failed:", res.status, text);
    }
}

// Wire up lifecycle
let _started = false;

async function initIntegration() {
    try {
        // Telegram hints
        const ctx = getTelegramContext();
        if (ctx && ctx.tg) {
            try { ctx.tg.expand(); } catch {}
            try { ctx.tg.ready(); } catch {}
        }

        // Register (idempotent server-side)
        await registerPlayer();

        // Start session after first user gesture or immediately (choose both for safety)
        const doStart = async () => {
            if (_started) return;
            _started = true;
            try { await startSession(); } catch (e) { console.warn(e); }
        };

        // Start asap and also on first interaction
        doStart();
        ["pointerdown", "keydown", "touchstart"].forEach(evt =>
            window.addEventListener(evt, doStart, { once: true, passive: true })
        );

        // End session on page hide/close
        document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "hidden") {
                endSession("visibility_hidden");
            }
        });
        window.addEventListener("beforeunload", () => endSession("beforeunload"));

        // Expose manual API
        window.BGIntegration = { startSession, endSession, registerPlayer, loadSession };

        log("Integration initialized (FastAPI schema)");
    } catch (e) {
        console.warn("[BG-Integration] init failed:", e);
    }
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initIntegration, { once: true });
} else {
    initIntegration();
}
