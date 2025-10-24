import { BG_CONFIG } from "./bg-config.js";

const log = (...args) => console.log("[BG-Integration]", ...args);
function getTelegramContext() {
    const tg = (typeof window !== "undefined" && window.Telegram && window.Telegram.WebApp) ? window.Telegram.WebApp : null;
    if (!tg) return null;
    const unsafe = tg.initDataUnsafe || {};
    const user = unsafe.user || null;
    return {
        tg,
        initData: tg.initData || "",
        initDataUnsafe: unsafe,
        user
    };
}

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

const SESSION_KEY = "bg_session_v1";
function saveSession(s) { try { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch {} }
function loadSession() { try { return JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); } catch { return null; } }
function clearSession() { try { localStorage.removeItem(SESSION_KEY); } catch {} }

function buildRegisterPayload() {
    const ctx = getTelegramContext();
    const u = ctx?.user || null;

    return {
        telegram_id: u?.id ?? 0,
        username: (u?.username ?? null) || null,
        first_name: (u?.first_name ?? null) || null,
        last_name: (u?.last_name ?? null) || null
    };
}

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
    return data;
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
            if (document.visibilityState === "hidden") {
                endSession("visibility_hidden");
            }
        });
        window.addEventListener("beforeunload", () => endSession("beforeunload"));

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
