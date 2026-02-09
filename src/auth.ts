const CLIENT_ID = import.meta.env.VITE_SPOTIFY_CLIENT_ID as string;
export const REDIRECT_URI = "http://127.0.0.1:8888/callback";
export const SCOPES = "streaming user-read-playback-state user-modify-playback-state user-read-currently-playing";

type TokenRecord = {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  obtained_at: number; // ms epoch
};

const LS_KEY = "spotify_token_record";
const LS_VERIFIER = "pkce_verifier";

function b64url(bytes: Uint8Array) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomString(length: number) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const arr = new Uint8Array(length);
  crypto.getRandomValues(arr);
  let out = "";
  for (let i = 0; i < length; i++) out += chars[arr[i] % chars.length];
  return out;
}

async function sha256Base64Url(plain: string) {
  const data = new TextEncoder().encode(plain);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return b64url(new Uint8Array(digest));
}

export function getTokenRecord(): TokenRecord | null {
  const raw = localStorage.getItem(LS_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as TokenRecord;
  } catch {
    return null;
  }
}

export function clearToken() {
  localStorage.removeItem(LS_KEY);
}

function saveTokenRecord(rec: Omit<TokenRecord, "obtained_at">) {
  const existing = getTokenRecord();
  const merged: TokenRecord = {
    ...rec,
    // keep refresh_token if Spotify doesn't return it on refresh
    refresh_token: rec.refresh_token ?? existing?.refresh_token,
    obtained_at: Date.now(),
  };
  localStorage.setItem(LS_KEY, JSON.stringify(merged));
}

export function isLoggedIn() {
  return !!getTokenRecord()?.access_token;
}

export function getAccessTokenMaybeExpired(): string | null {
  return getTokenRecord()?.access_token ?? null;
}

export function isTokenExpiredOrNearExpiry(skewMs = 60_000) {
  const rec = getTokenRecord();
  if (!rec) return true;
  const expiresAt = rec.obtained_at + rec.expires_in * 1000;
  return Date.now() + skewMs >= expiresAt;
}

export async function getValidAccessToken(): Promise<string> {
  const rec = getTokenRecord();
  if (!rec) throw new Error("Not logged in to Spotify");
  if (!isTokenExpiredOrNearExpiry()) return rec.access_token;

  // Try refresh if we have refresh_token
  if (!rec.refresh_token) return rec.access_token; // fallback: user re-login

  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    grant_type: "refresh_token",
    refresh_token: rec.refresh_token,
  });

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    // refresh failed; clear and force login
    clearToken();
    throw new Error("Spotify token refresh failed; please log in again.");
  }

  const data = await res.json();
  saveTokenRecord({
    access_token: data.access_token,
    token_type: data.token_type ?? "Bearer",
    expires_in: data.expires_in ?? 3600,
    refresh_token: data.refresh_token, // may be undefined
    scope: data.scope,
  });

  return getTokenRecord()!.access_token;
}

export async function loginWithSpotify() {
  if (!CLIENT_ID) throw new Error("Missing VITE_SPOTIFY_CLIENT_ID in .env");

  const verifier = randomString(64);
  localStorage.setItem(LS_VERIFIER, verifier);
  const challenge = await sha256Base64Url(verifier);

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    code_challenge_method: "S256",
    code_challenge: challenge,
    scope: SCOPES,
  });

  window.location.href = "https://accounts.spotify.com/authorize?" + params.toString();
}

export async function handleCallback(code: string) {
  const verifier = localStorage.getItem(LS_VERIFIER);
  if (!verifier) throw new Error("Missing PKCE verifier in storage (login again).");

  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier,
  });

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error("Spotify token exchange failed: " + t);
  }

  const data = await res.json();
  saveTokenRecord({
    access_token: data.access_token,
    token_type: data.token_type ?? "Bearer",
    expires_in: data.expires_in ?? 3600,
    refresh_token: data.refresh_token,
    scope: data.scope,
  });
}
