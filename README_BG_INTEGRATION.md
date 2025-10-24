
# Telegram Game Backend Integration — BG Soft

This archive was patched to automatically call your backend when the game runs inside Telegram WebApp.

## What was added

- `scripts/bg-config.js` — change `BASE_URL` and endpoint paths to match your backend.
- `scripts/bg-integration.js` — collects Telegram context + device info and performs:
  - **Register Player** (idempotent) on load
  - **Start Session** on load / first interaction
  - **End Session** on `visibilitychange` and `beforeunload`
- `index.html` was modified to load the above modules **before** `scripts/main.js`.

The integration also exposes a tiny global API:
```js
window.BGIntegration.startSession();
window.BGIntegration.endSession("reason");
window.BGIntegration.registerPlayer();
window.BGIntegration.loadSession(); // { id, started_at } or null
```

## Expected backend endpoints (POST, JSON)

> Adjust paths in `bg-config.js`. The server should read the **client IP** from the request (not from JSON).

### 1) Register Player — `/api/v1/players/register`
**Request JSON** (example):
```json
{
  "user_agent": "Mozilla/5.0 ...",
  "language": "en-US",
  "screen": "1920x1080",
  "telegram": {
    "init_data": "<raw initData>", // verify HMAC on server with bot token
    "user": {
      "id": 123456789,
      "is_bot": false,
      "first_name": "John",
      "last_name": "Doe",
      "username": "johndoe",
      "language_code": "en",
      "is_premium": true
    }
  }
}
```
**Response JSON** (example):
```json
{ "player_id": "uuid-or-int", "status": "ok" }
```

### 2) Start Session — `/api/v1/sessions/start`
**Request JSON**:
```json
{
  "started_at": "2025-10-24T10:00:00.000Z",
  "...same base telemetry as above..."
}
```
**Response JSON**:
```json
{ "session_id": "uuid" }
```
The `session_id` is stored in `localStorage` by the script.

### 3) End Session — `/api/v1/sessions/end`
**Request JSON**:
```json
{
  "session_id": "uuid",
  "ended_at": "2025-10-24T10:15:31.000Z",
  "reason": "visibility_hidden",
  "...same base telemetry as above..."
}
```
**Response JSON**:
```json
{ "status": "ok" }
```

## Notes
- Works both inside Telegram and in a normal browser (for local testing). When Telegram is not present, the `telegram` field is `null`.
- The backend should verify `telegram.init_data` per Telegram WebApp docs and link sessions to a `player_id` (by `telegram.user.id`). IP is taken from request.
- If your backend requires a JWT — return it from **Register Player** and set it as a cookie in the response, or send it back and I can update the client code to attach `Authorization` on subsequent calls.
- If your game has a precise "Round Start/End" signal, you can call `BGIntegration.startSession()` and `BGIntegration.endSession("round_finished")` from the game's JS events (Construct can call global functions).

