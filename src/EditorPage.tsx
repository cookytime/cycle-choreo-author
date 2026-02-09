import React, { useEffect, useMemo, useRef, useState } from "react";
import { clearToken, getTokenRecord, getValidAccessToken, isLoggedIn, loginWithSpotify } from "./auth";

/**
 * Choreo Marker Editor (WAV or Spotify)
 *
 * WAV mode: load a local audio file and scrub precisely.
 * Spotify mode: uses Spotify Web Playback SDK (Premium required) + OAuth (PKCE) on localhost.
 */

type Marker = {
  id: string;
  label: string;
  t_ms: number; // position in milliseconds
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function msToClock(ms: number) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function uid() {
  return Math.random().toString(36).slice(2, 10) + "-" + Date.now().toString(36);
}

export default function EditorPage() {
  // Shared editor state
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [nowMs, setNowMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [isPlayingUI, setIsPlayingUI] = useState(false);

  // WAV transport
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [audioUrl, setAudioUrl] = useState<string>("");

  // Spotify transport
  const spotifyPlayerRef = useRef<any>(null);
  const [useSpotify, setUseSpotify] = useState(false);
  const [spotifyTrackUri, setSpotifyTrackUri] = useState<string>("");
  const [spotifyDeviceId, setSpotifyDeviceId] = useState<string>("");
  const [spotifyReady, setSpotifyReady] = useState(false);
  const [spotifyStatus, setSpotifyStatus] = useState<string>("");

  // Smooth UI anchoring to Spotify clock
  const spotifyBasePosRef = useRef(0); // ms
  const spotifyBaseTsRef = useRef(0); // Date.now() when last state arrived
  const spotifyPausedRef = useRef(true);
  const spotifyDurationRef = useRef(0);

  function getSpotifyNowMs() {
    const base = spotifyBasePosRef.current;
    const ts = spotifyBaseTsRef.current;
    const paused = spotifyPausedRef.current;
    if (paused) return base;
    return base + Math.max(0, Date.now() - ts);
  }

  // WAV listeners
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;

    const onLoaded = () => setDurationMs(Math.floor((a.duration || 0) * 1000));
    const onPlay = () => setIsPlayingUI(true);
    const onPause = () => setIsPlayingUI(false);
    const onEnded = () => setIsPlayingUI(false);

    a.addEventListener("loadedmetadata", onLoaded);
    a.addEventListener("play", onPlay);
    a.addEventListener("pause", onPause);
    a.addEventListener("ended", onEnded);

    return () => {
      a.removeEventListener("loadedmetadata", onLoaded);
      a.removeEventListener("play", onPlay);
      a.removeEventListener("pause", onPause);
      a.removeEventListener("ended", onEnded);
    };
  }, [audioUrl]);

  // Spotify SDK init
  useEffect(() => {
    if (!useSpotify) return;

    // Ensure logged in
    if (!isLoggedIn()) {
      setSpotifyStatus("Not logged in. Click “Login with Spotify”.");
      setSpotifyReady(false);
      return;
    }

    let cancelled = false;

    const existing = document.getElementById("spotify-sdk");
    if (!existing) {
      const s = document.createElement("script");
      s.id = "spotify-sdk";
      s.src = "https://sdk.scdn.co/spotify-player.js";
      s.async = true;
      document.body.appendChild(s);
    }

    (window as any).onSpotifyWebPlaybackSDKReady = async () => {
      if (cancelled) return;
      const Spotify = (window as any).Spotify;
      if (!Spotify) return;

      const player = new Spotify.Player({
        name: "Choreo Editor (Web)",
        // getOAuthToken can be async (we call cb when we have it)
        getOAuthToken: async (cb: (t: string) => void) => {
          try {
            const t = await getValidAccessToken();
            cb(t);
          } catch (e) {
            // force relogin
            setSpotifyStatus("Token invalid. Please log in again.");
          }
        },
        volume: 0.85,
      });

      spotifyPlayerRef.current = player;

      player.addListener("ready", ({ device_id }: any) => {
        setSpotifyDeviceId(device_id);
        setSpotifyReady(true);
        setSpotifyStatus("Spotify ready");
      });

      player.addListener("not_ready", () => {
        setSpotifyReady(false);
        setSpotifyStatus("Spotify not ready");
      });

      player.addListener("player_state_changed", (state: any) => {
        if (!state) return;

        spotifyBasePosRef.current = state.position ?? 0;
        spotifyBaseTsRef.current = Date.now();
        spotifyPausedRef.current = !!state.paused;
        spotifyDurationRef.current = state.duration ?? 0;

        setIsPlayingUI(!state.paused);
        setDurationMs(state.duration ?? 0);
        setNowMs(state.position ?? 0);
      });

      player.connect();
    };

    return () => {
      cancelled = true;
      try {
        spotifyPlayerRef.current?.disconnect?.();
      } catch {}
      spotifyPlayerRef.current = null;
      setSpotifyReady(false);
      setSpotifyDeviceId("");
    };
  }, [useSpotify]);

  // Smooth time updates
  useEffect(() => {
    let raf = 0;

    const tick = () => {
      if (useSpotify) {
        const n = getSpotifyNowMs();
        const max = durationMs || spotifyDurationRef.current || Number.MAX_SAFE_INTEGER;
        setNowMs(clamp(Math.floor(n), 0, max));
      } else {
        const a = audioRef.current;
        if (a && audioUrl) setNowMs(Math.floor(a.currentTime * 1000));
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [useSpotify, audioUrl, durationMs]);

  // Transport
  async function togglePlay() {
    if (useSpotify) {
      const p = spotifyPlayerRef.current;
      if (!p) return;
      await p.togglePlay();
      return;
    }
    const a = audioRef.current;
    if (!a || !audioUrl) return;
    if (a.paused) await a.play();
    else a.pause();
  }

  async function seekTo(targetMs: number) {
    const t = clamp(targetMs, 0, durationMs || 0);

    if (useSpotify) {
      const p = spotifyPlayerRef.current;
      if (!p) return;
      await p.seek(t);
      spotifyBasePosRef.current = t;
      spotifyBaseTsRef.current = Date.now();
      setNowMs(t);
      return;
    }

    const a = audioRef.current;
    if (!a || !audioUrl) return;
    a.currentTime = t / 1000;
    setNowMs(t);
  }

  async function seekBy(deltaMs: number) {
    await seekTo(nowMs + deltaMs);
  }

  async function spotifyLoadAndPlay() {
    if (!spotifyReady || !spotifyDeviceId || !spotifyTrackUri) return;
    const token = await getValidAccessToken();

    // Transfer playback
    await fetch("https://api.spotify.com/v1/me/player", {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ device_ids: [spotifyDeviceId], play: false }),
    });

    // Start playing track
    await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(spotifyDeviceId)}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ uris: [spotifyTrackUri] }),
    });
  }

  // Markers
  function addMarker(atMs: number) {
    setMarkers((prev) => {
      const m: Marker = {
        id: uid(),
        label: `Mark ${prev.length + 1}`,
        t_ms: clamp(Math.floor(atMs), 0, durationMs || Math.floor(atMs)),
      };
      return [...prev, m].sort((a, b) => a.t_ms - b.t_ms);
    });
  }

  function updateMarker(id: string, patch: Partial<Marker>) {
    setMarkers((prev) =>
      prev
        .map((m) => (m.id === id ? { ...m, ...patch, t_ms: patch.t_ms ?? m.t_ms } : m))
        .map((m) => ({ ...m, t_ms: clamp(Math.floor(m.t_ms), 0, durationMs || m.t_ms) }))
        .sort((a, b) => a.t_ms - b.t_ms)
    );
  }

  function deleteMarker(id: string) {
    setMarkers((prev) => prev.filter((m) => m.id !== id));
  }

  function nudgeMarker(id: string, deltaMs: number) {
    setMarkers((prev) =>
      prev
        .map((m) =>
          m.id === id
            ? { ...m, t_ms: clamp(m.t_ms + deltaMs, 0, durationMs || Number.MAX_SAFE_INTEGER) }
            : m
        )
        .sort((a, b) => a.t_ms - b.t_ms)
    );
  }

  function exportJson() {
    const payload = {
      version: 1,
      created_at: new Date().toISOString(),
      source: useSpotify ? "spotify" : "wav",
      duration_ms: durationMs,
      spotify_track_uri: useSpotify ? spotifyTrackUri : undefined,
      markers,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `choreo_markers_${useSpotify ? "spotify" : "wav"}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function importJson(file: File) {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!data || !Array.isArray(data.markers)) throw new Error("Invalid file: missing markers[]");
    const imported: Marker[] = data.markers
      .filter((m: any) => m && typeof m.t_ms === "number")
      .map((m: any) => ({
        id: String(m.id || uid()),
        label: String(m.label || "Mark"),
        t_ms: Math.floor(m.t_ms),
      }))
      .sort((a, b) => a.t_ms - b.t_ms);

    setMarkers(imported);
    if (typeof data.spotify_track_uri === "string") setSpotifyTrackUri(data.spotify_track_uri);
  }

  const playbackLabel = useMemo(() => `${msToClock(nowMs)} / ${msToClock(durationMs)}`, [nowMs, durationMs]);
  const canControl = useSpotify ? spotifyReady : !!audioUrl;

  const tokenRec = getTokenRecord();
  const loggedIn = !!tokenRec?.access_token;

  return (
    <div style={{ fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial", padding: 16, maxWidth: 1100, margin: "0 auto" }}>
      <h1 style={{ margin: 0 }}>Choreo Marker Editor</h1>
      <p style={{ marginTop: 8, color: "#444" }}>
        Mark choreography points while playing music. Use WAV for exact scrubbing, or Spotify for live playback (Premium required).
      </p>

      {/* Spotify auth bar */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", padding: 12, border: "1px solid #ddd", borderRadius: 12 }}>
        <strong>Spotify:</strong>
        {loggedIn ? (
          <>
            <span style={{ color: "#2a7" }}>Logged in</span>
            <button
              onClick={() => {
                clearToken();
                setSpotifyReady(false);
                setSpotifyDeviceId("");
                setSpotifyStatus("Logged out");
              }}
              style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid #ccc", cursor: "pointer" }}
            >
              Logout
            </button>
          </>
        ) : (
          <>
            <span style={{ color: "#a66" }}>Not logged in</span>
            <button
              onClick={() => loginWithSpotify().catch((e) => alert(String(e?.message || e)))}
              style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid #ccc", cursor: "pointer" }}
            >
              Login with Spotify
            </button>
          </>
        )}

        <span style={{ marginLeft: "auto", color: "#666" }}>{spotifyStatus}</span>
      </div>

      {/* Transport Mode */}
      <div style={{ marginTop: 12, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", padding: 12, border: "1px solid #ddd", borderRadius: 12 }}>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="checkbox"
            checked={useSpotify}
            onChange={(e) => {
              const on = e.target.checked;
              setUseSpotify(on);
              setIsPlayingUI(false);
              setNowMs(0);
              setDurationMs(0);
              if (on && !isLoggedIn()) setSpotifyStatus("Not logged in. Click “Login with Spotify”.");
            }}
          />
          <strong>Use Spotify</strong>
        </label>

        {!useSpotify ? (
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span>Load WAV/MP3:</span>
            <input
              type="file"
              accept="audio/*"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                const url = URL.createObjectURL(f);
                setAudioUrl((old) => {
                  if (old) URL.revokeObjectURL(old);
                  return url;
                });
                setNowMs(0);
                setIsPlayingUI(false);
              }}
            />
          </label>
        ) : (
          <>
            <label style={{ display: "flex", gap: 8, alignItems: "center", flex: "1 1 320px" }}>
              <span>Track URI:</span>
              <input
                value={spotifyTrackUri}
                onChange={(e) => setSpotifyTrackUri(e.target.value.trim())}
                placeholder="spotify:track:xxxxxxxxxxxxxxxxxxxx"
                style={{ width: "100%" }}
              />
            </label>

            <button
              onClick={() => spotifyLoadAndPlay().catch((e) => alert(String(e?.message || e)))}
              disabled={!spotifyReady || !spotifyTrackUri || !loggedIn}
              style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid #ccc", cursor: "pointer" }}
              title={!spotifyReady ? "Waiting for Spotify SDK/device…" : "Transfers playback to this browser and plays the track"}
            >
              Load Track
            </button>

            <span style={{ color: spotifyReady ? "green" : "#a66" }}>
              {spotifyReady ? "Spotify ready" : "Spotify not ready"}
            </span>
          </>
        )}
      </div>

      {/* Hidden audio element for WAV mode */}
      <audio ref={audioRef} src={audioUrl || undefined} />

      {/* Transport controls */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginTop: 12 }}>
        <button
          onClick={() => togglePlay().catch((e) => alert(String(e?.message || e)))}
          disabled={!canControl}
          style={{ padding: "10px 14px", borderRadius: 12, border: "1px solid #ccc", cursor: "pointer" }}
        >
          {isPlayingUI ? "Pause" : "Play"}
        </button>

        <button onClick={() => seekBy(-5000)} disabled={!canControl} style={{ padding: "10px 14px", borderRadius: 12, border: "1px solid #ccc", cursor: "pointer" }}>
          -5s
        </button>
        <button onClick={() => seekBy(-2000)} disabled={!canControl} style={{ padding: "10px 14px", borderRadius: 12, border: "1px solid #ccc", cursor: "pointer" }}>
          -2s
        </button>
        <button onClick={() => seekBy(2000)} disabled={!canControl} style={{ padding: "10px 14px", borderRadius: 12, border: "1px solid #ccc", cursor: "pointer" }}>
          +2s
        </button>
        <button onClick={() => seekBy(5000)} disabled={!canControl} style={{ padding: "10px 14px", borderRadius: 12, border: "1px solid #ccc", cursor: "pointer" }}>
          +5s
        </button>

        <div style={{ marginLeft: "auto", fontVariantNumeric: "tabular-nums" }}>
          <strong>{playbackLabel}</strong>
        </div>
      </div>

      {/* Timeline */}
      <div style={{ marginTop: 12, padding: 12, border: "1px solid #eee", borderRadius: 12 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button
            onClick={() => addMarker(nowMs)}
            disabled={!canControl}
            style={{ padding: "10px 14px", borderRadius: 12, border: "1px solid #ccc", cursor: "pointer" }}
          >
            Add marker @ now
          </button>

          <button onClick={() => exportJson()} style={{ padding: "10px 14px", borderRadius: 12, border: "1px solid #ccc", cursor: "pointer" }}>
            Export JSON
          </button>

          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span>Import JSON:</span>
            <input
              type="file"
              accept="application/json"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                importJson(f).catch((err) => alert(String(err?.message || err)));
              }}
            />
          </label>

          <button onClick={() => setMarkers([])} style={{ padding: "10px 14px", borderRadius: 12, border: "1px solid #ccc", cursor: "pointer" }}>
            Clear
          </button>
        </div>

        {/* Scrub bar */}
        <div style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "center" }}>
          <input
            type="range"
            min={0}
            max={Math.max(0, durationMs)}
            value={clamp(nowMs, 0, Math.max(0, durationMs))}
            onChange={(e) => setNowMs(Number(e.target.value))}
            onMouseUp={() => seekTo(nowMs)}
            onTouchEnd={() => seekTo(nowMs)}
            disabled={!canControl || !durationMs}
            style={{ width: "100%" }}
          />
          <button onClick={() => seekTo(nowMs)} disabled={!canControl || !durationMs} style={{ padding: "10px 14px", borderRadius: 12, border: "1px solid #ccc", cursor: "pointer" }}>
            Seek
          </button>
        </div>
      </div>

      {/* Marker list */}
      <div style={{ marginTop: 14, padding: 12, border: "1px solid #eee", borderRadius: 12 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
          <h2 style={{ margin: 0 }}>Markers</h2>
          <span style={{ color: "#666" }}>{markers.length} total</span>
        </div>

        {markers.length === 0 ? (
          <p style={{ color: "#666" }}>No markers yet. Hit “Add marker @ now” while the track plays.</p>
        ) : (
          <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
            {markers.map((m) => (
              <div key={m.id} style={{ display: "grid", gridTemplateColumns: "140px 1fr 260px", gap: 10, alignItems: "center", padding: 10, border: "1px solid #f0f0f0", borderRadius: 12 }}>
                <div style={{ fontVariantNumeric: "tabular-nums" }}>
                  <strong>{msToClock(m.t_ms)}</strong>
                  <div style={{ fontSize: 12, color: "#666" }}>{m.t_ms} ms</div>
                </div>

                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <input value={m.label} onChange={(e) => updateMarker(m.id, { label: e.target.value })} style={{ width: "100%" }} />
                  <input
                    type="number"
                    value={m.t_ms}
                    onChange={(e) => updateMarker(m.id, { t_ms: Number(e.target.value) })}
                    style={{ width: 140 }}
                    title="Edit timestamp (ms)"
                  />
                </div>

                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
                  <button onClick={() => seekTo(m.t_ms)} disabled={!canControl} style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid #ccc", cursor: "pointer" }}>
                    Jump
                  </button>
                  <button onClick={() => nudgeMarker(m.id, -250)} style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid #ccc", cursor: "pointer" }}>
                    -250ms
                  </button>
                  <button onClick={() => nudgeMarker(m.id, -100)} style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid #ccc", cursor: "pointer" }}>
                    -100ms
                  </button>
                  <button onClick={() => nudgeMarker(m.id, 100)} style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid #ccc", cursor: "pointer" }}>
                    +100ms
                  </button>
                  <button onClick={() => nudgeMarker(m.id, 250)} style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid #ccc", cursor: "pointer" }}>
                    +250ms
                  </button>
                  <button onClick={() => deleteMarker(m.id)} style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid #ccc", cursor: "pointer" }}>
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ marginTop: 16, color: "#555", fontSize: 13, lineHeight: 1.4 }}>
        <p style={{ margin: 0 }}>
          <strong>Spotify setup:</strong> Add this Redirect URI to your Spotify app: <code>http://127.0.0.1:8888/callback</code>. Then set <code>VITE_SPOTIFY_CLIENT_ID</code> in your <code>.env</code>.
        </p>
        <p style={{ marginTop: 8, marginBottom: 0 }}>
          <strong>Timing tip:</strong> Web playback has a little latency. Use the nudge buttons (±100/250ms) to dial markers in.
        </p>
      </div>
    </div>
  );
}
