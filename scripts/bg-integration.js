
// BG Soft — Telegram Game Backend Integration
// Adapted for FastAPI PlayerRegisterSchema (telegram_id, username, first_name, last_name)

import { BG_CONFIG } from "./bg-config.js";

function getInitDataRaw() {
    try { return (window.Telegram?.WebApp?.initData) || ""; } catch { return ""; }
}

function getURLParams() {
    const p = new URLSearchParams(window.location.search);
    const val = (k) => {
        const v = p.get(k);
        return v === null || v === "" ? null : v;
    };
    const uidRaw = val("tg_uid");
    const uid = uidRaw ? Number(uidRaw) : null;
    return {
        uid,
        username: val("tg_username"),
        first: val("tg_first"),
        last: val("tg_last"),
        lang: val("tg_lang"),
        premium: val("tg_premium") === "true",
        sig: val("sig"),
    };
}

const log = (...args) => console.log("[BG-Integration]", ...args);

function parseInitDataFromURL() {
    try {
        const qs = new URLSearchParams(window.location.search);
        const raw = qs.get("tgWebAppData") || qs.get("tgwebappdata");
        if (!raw) return null;
        const decoded = decodeURIComponent(raw);
        const kv = new URLSearchParams(decoded);
        const userStr = kv.get("user");
        let user = null;
        if (userStr) { try { user = JSON.parse(userStr); } catch {} }
        return { initData: decoded, user };
    } catch { return null; }
}

// Safe access to Telegram WebApp API
function getTelegramContext() {
    const tg = (typeof window !== "undefined" && window.Telegram && window.Telegram.WebApp) ? window.Telegram.WebApp : null;
    if (!tg) {
        const parsed = parseInitDataFromURL();
        if (parsed && parsed.user) {
            return { tg: null, initData: parsed.initData, initDataUnsafe: {}, user: parsed.user };
        }
        return null;
    }
    const unsafe = tg.initDataUnsafe || {};
    const user = unsafe.user || null;
    return {
        tg,
        initData: tg.initData || "",
        initDataUnsafe: unsafe,
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

function buildRegisterPayload() {
    const q = getURLParams();
    if (q.uid) {
        // Быстрый путь — берём из URL
        return {
            telegram_id: q.uid,
            username: q.username,
            first_name: q.first,
            last_name: q.last,
        };
    }

    // fallback на Telegram.WebApp (если URL-параметров нет)
    const u = window.Telegram?.WebApp?.initDataUnsafe?.user || null;
    return {
        telegram_id: u?.id ?? 0,
        username: u?.username ?? null,
        first_name: u?.first_name ?? null,
        last_name: u?.last_name ?? null,
    };
}

// Optional common headers helper
function buildCommonHeaders() {
    const headers = { "Content-Type": "application/json" };
    const q = getURLParams();
    if (q.sig) headers["X-URL-Signature"] = q.sig;
    headers["X-URL-Params"] = window.location.search.slice(1).substring(0, 4000);
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
        const ctx = getTelegramContext();
        if (ctx && ctx.tg) {
            try { ctx.tg.expand(); } catch {}
            try { ctx.tg.ready(); } catch {}
        }

        await registerPlayer();

        const doStart = async () => {
            if (_started) return;
            _started = true;
            try { await startSession(); } catch (e) { console.warn(e); }
        };

        doStart();
        ["pointerdown", "keydown", "touchstart"].forEach(evt =>
            window.addEventListener(evt, doStart, { once: true, passive: true })
        );

        document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "hidden") endSession("visibility_hidden");
        });
        window.addEventListener("beforeunload", () => endSession("beforeunload"));

        // Expose manual API
        window.BGIntegration = { startSession, endSession, registerPlayer, loadSession };

        log("Integration initialized (Telegram fallback ready).");
    } catch (e) {
        console.warn("[BG-Integration] init failed:", e);
    }
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initIntegration, { once: true });
} else {
    initIntegration();
}
