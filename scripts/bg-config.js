export const BG_CONFIG = {
  BASE_URL: "http://192.168.1.152:12006",
  ENDPOINTS: {
    REGISTER_PLAYER: "/api/v1/players/register",
    START_SESSION: "/api/v1/games/sessions/start",
    END_SESSION: "/api/v1/games/sessions/end"
  },
  TIMEOUT_MS: 8000,
  RETRIES: 1
};
