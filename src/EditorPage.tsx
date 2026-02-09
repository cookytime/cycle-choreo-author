import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { clearToken, getTokenRecord, getValidAccessToken, isLoggedIn, loginWithSpotify } from "./auth";

/**
 * Cycle Choreo Author - EditorPage (Base44-style marking UI)
 * - WAV upload OR Spotify Web Playback SDK (Premium required)
 * - Mark cues as "steps" with exercise/gear/rpm/position/note
 * - Undo/Redo + Export/Import (JSON)
 */

type Exercise = "flat" | "climb" | "sprint" | "recover" | "run";

type Step = {
  id: string;
  t_ms: number;
  timestamp: string; // M:SS
  exercise: Exercise;
  gear: number;
  resistance: string; // display only (e.g., L5)
  position: string;
  rpmMin: number;
  rpmMax: number;
  note?: string;
};

const STEPS_LS_KEY = "cycle_choreo_steps_backup_v1";

const MOVEMENTS: { key: Exercise; label: string }[] = [
  { key: "flat", label: "Flat / Ride Easy" },
  { key: "climb", label: "Climb" },
  { key: "sprint", label: "Sprint" },
  { key: "recover", label: "Recovery" },
  { key: "run", label: "Interval / Surge" },
];

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function uid() {
  return Math.random().toString(36).slice(2, 10) + "-" + Date.now().toString(36);
}

function formatTimestamp(ms: number) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function parseTimestamp(ts: string) {
  const m = ts.match(/^(\d+):([0-5]\d)$/);
  if (!m) return 0;
  const min = Number(m[1]);
  const sec = Number(m[2]);
  return (min * 60 + sec) * 1000;
}

export default function EditorPage() {
  const navigate = useNavigate();
  const location = useLocation();
  
  // ----------------------------
  // Layout helpers
  // ----------------------------
  const [isPortraitNarrow, setIsPortraitNarrow] = useState(() => window.innerWidth < 980);
  useEffect(() => {
    const onResize = () => setIsPortraitNarrow(window.innerWidth < 980);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const bg: React.CSSProperties = {
    minHeight: "100vh",
    padding: 12,
    background:
      "radial-gradient(1200px 600px at 15% 0%, rgba(59,130,246,0.18), transparent 55%)," +
      "radial-gradient(900px 500px at 85% 20%, rgba(168,85,247,0.18), transparent 55%)," +
      "radial-gradient(900px 600px at 60% 90%, rgba(34,197,94,0.12), transparent 55%)," +
      "linear-gradient(180deg, #0b1020, #070a14 60%, #060810)",
    color: "rgba(255,255,255,0.92)",
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial",
  };

  const card: React.CSSProperties = {
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 18,
    boxShadow: "0 10px 30px rgba(0,0,0,0.25) inset, 0 10px 40px rgba(0,0,0,0.25)",
    backdropFilter: "blur(10px)",
  };

  const baseBtn: React.CSSProperties = {
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.15)",
    color: "rgba(255,255,255,0.92)",
    cursor: "pointer",
    userSelect: "none",
  };

  const smallBtn: React.CSSProperties = {
    ...baseBtn,
    padding: "7px 10px",
    borderRadius: 10,
    fontWeight: 800,
    fontSize: 12,
  };

  const inputStyle: React.CSSProperties = {
    background: "rgba(0,0,0,0.25)",
    border: "1px solid rgba(255,255,255,0.14)",
    color: "rgba(255,255,255,0.92)",
    borderRadius: 10,
    padding: "8px 10px",
    outline: "none",
  };

  const selectStyle: React.CSSProperties = {
    ...inputStyle,
    padding: "8px 10px",
  };

  // ----------------------------
  // Core state: steps + undo/redo
  // ----------------------------
  const [steps, setSteps] = useState<Step[]>(() => {
    try {
      const saved = localStorage.getItem(STEPS_LS_KEY);
      return saved ? (JSON.parse(saved) as Step[]) : [];
    } catch {
      return [];
    }
  });
  const [undoStack, setUndoStack] = useState<Step[][]>([]);
  const [redoStack, setRedoStack] = useState<Step[][]>([]);

  useEffect(() => {
    localStorage.setItem(STEPS_LS_KEY, JSON.stringify(steps));
  }, [steps]);

  function pushUndo(prevSteps: Step[]) {
    setUndoStack((u) => [...u.slice(-30), prevSteps]); // cap
    setRedoStack([]); // clear redo on new action
    setSaveMessage(""); // clear save message when editing
  }

  function undo() {
    setUndoStack((u) => {
      if (u.length === 0) return u;
      const prev = u[u.length - 1];
      setRedoStack((r) => [...r, steps]);
      setSteps(prev);
      return u.slice(0, -1);
    });
  }

  function redo() {
    setRedoStack((r) => {
      if (r.length === 0) return r;
      const next = r[r.length - 1];
      setUndoStack((u) => [...u, steps]);
      setSteps(next);
      return r.slice(0, -1);
    });
  }

  const stepsSorted = useMemo(() => [...steps].sort((a, b) => a.t_ms - b.t_ms), [steps]);

  // ----------------------------
  // Transport state: Spotify only
  // ----------------------------
  const [nowMs, setNowMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  
  // Track from database
  const [currentTrackId, setCurrentTrackId] = useState<string | null>(null);
  const [currentTrackTitle, setCurrentTrackTitle] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string>("");

  // Spotify
  const spotifyPlayerRef = useRef<any>(null);
  const autoLoadedRef = useRef<string | null>(null);
  const [spotifyTrackUri, setSpotifyTrackUri] = useState<string>("");
  const [spotifyDeviceId, setSpotifyDeviceId] = useState<string>("");
  const [spotifyReady, setSpotifyReady] = useState(false);
  const [spotifyStatus, setSpotifyStatus] = useState<string>("");

  const spotifyBasePosRef = useRef(0);
  const spotifyBaseTsRef = useRef(0);
  const spotifyPausedRef = useRef(true);
  const spotifyDurationRef = useRef(0);

  function getSpotifyNowMs() {
    const base = spotifyBasePosRef.current;
    const ts = spotifyBaseTsRef.current;
    const paused = spotifyPausedRef.current;
    if (paused) return base;
    return base + Math.max(0, Date.now() - ts);
  }

  const getCurrentTimeMs = useCallback(() => {
    return getSpotifyNowMs();
  }, []);

  // Check login status
  const tokenRec = getTokenRecord();
  const loggedIn = !!tokenRec?.access_token;

  // Handle track selected from database
  useEffect(() => {
    const selectedTrack = (location.state as any)?.selectedTrack;
    if (selectedTrack) {
      // Store the track ID and title for saving later
      setCurrentTrackId(selectedTrack.spotify_id);
      setCurrentTrackTitle(selectedTrack.title);
      
      // Extract Spotify URI from URL or use spotify_id
      let uri = "";
      if (selectedTrack.spotify_url) {
        // Convert URL like "https://open.spotify.com/track/ABC123" to "spotify:track:ABC123"
        const match = selectedTrack.spotify_url.match(/\/track\/([a-zA-Z0-9]+)/);
        if (match) {
          uri = `spotify:track:${match[1]}`;
        }
      } else if (selectedTrack.spotify_id) {
        uri = `spotify:track:${selectedTrack.spotify_id}`;
      }
      
      if (uri) {
        setSpotifyTrackUri(uri);
        // Convert duration_minutes to milliseconds
        const durationMs = selectedTrack.duration_minutes 
          ? Math.round(selectedTrack.duration_minutes * 60 * 1000) 
          : 0;
        setDurationMs(durationMs);
        
        // Load existing choreography if present
        if (selectedTrack.choreography && Array.isArray(selectedTrack.choreography)) {
          setSteps(selectedTrack.choreography);
        }
        
        // Clear the location state so it doesn't reload on refresh
        navigate(location.pathname, { replace: true, state: {} });
      }
    }
  }, [location.state]);

  // Auto-load track when URI is set and player is ready
  useEffect(() => {
    if (spotifyReady && spotifyDeviceId && spotifyTrackUri && loggedIn) {
      // Only auto-load if we haven't already loaded this URI
      if (autoLoadedRef.current !== spotifyTrackUri) {
        autoLoadedRef.current = spotifyTrackUri;
        const timer = setTimeout(() => {
          spotifyLoadAndPlay().catch((e) => {
            setSpotifyStatus(`Error: ${e.message || 'Failed to load track'}`);
            autoLoadedRef.current = null;
          });
        }, 2000);
        return () => clearTimeout(timer);
      }
    }
  }, [spotifyTrackUri, spotifyReady, spotifyDeviceId, loggedIn]);

  // init spotify sdk
  useEffect(() => {
    if (!isLoggedIn()) {
      setSpotifyStatus("Not logged in. Click “Login with Spotify”.");
      setSpotifyReady(false);
      return;
    }

    let cancelled = false;

    const initPlayer = async () => {
      const Spotify = (window as any).Spotify;
      if (!Spotify) return;

      const player = new Spotify.Player({
        name: "Cycle Choreo Author (Web)",
        getOAuthToken: async (cb: (t: string) => void) => {
          try {
            const t = await getValidAccessToken();
            cb(t);
          } catch {
            setSpotifyStatus("Token invalid. Please log in again.");
          }
        },
        volume: 0.85,
      });

      spotifyPlayerRef.current = player;

      player.addListener("ready", ({ device_id }: any) => {
        if (cancelled) return;
        setSpotifyDeviceId(device_id);
        setSpotifyReady(true);
        setSpotifyStatus("Spotify ready");
      });

      player.addListener("initialization_error", (e: any) => {
        if (cancelled) return;
        setSpotifyStatus(`Spotify init error: ${e?.message || "unknown"}`);
      });

      player.addListener("authentication_error", (e: any) => {
        if (cancelled) return;
        setSpotifyStatus(`Spotify auth error: ${e?.message || "unknown"}`);
      });

      player.addListener("account_error", (e: any) => {
        if (cancelled) return;
        setSpotifyStatus(`Spotify account error: ${e?.message || "unknown"}`);
      });

      player.addListener("playback_error", (e: any) => {
        if (cancelled) return;
        setSpotifyStatus(`Spotify playback error: ${e?.message || "unknown"}`);
      });

      player.addListener("not_ready", () => {
        if (cancelled) return;
        setSpotifyReady(false);
        setSpotifyDeviceId("");
        setSpotifyStatus("Spotify not ready");
      });

      player.addListener("player_state_changed", (state: any) => {
        if (cancelled || !state) return;

        spotifyBasePosRef.current = state.position ?? 0;
        spotifyBaseTsRef.current = Date.now();
        spotifyPausedRef.current = !!state.paused;
        spotifyDurationRef.current = state.duration ?? 0;

        setIsPlaying(!state.paused);
        setDurationMs(state.duration ?? 0);
        setNowMs(state.position ?? 0);
      });

      player.connect();
    };

    if ((window as any).Spotify) {
      initPlayer();
    } else {
      (window as any).onSpotifyWebPlaybackSDKReady = () => {
        if (!cancelled) initPlayer();
      };
      const existing = document.getElementById("spotify-sdk");
      if (!existing) {
        const s = document.createElement("script");
        s.id = "spotify-sdk";
        s.src = "https://sdk.scdn.co/spotify-player.js";
        s.async = true;
        document.body.appendChild(s);
      }
    }

    return () => {
      cancelled = true;
      try {
        spotifyPlayerRef.current?.disconnect?.();
      } catch {}
      spotifyPlayerRef.current = null;
      setSpotifyReady(false);
      setSpotifyDeviceId("");
    };
  }, [loggedIn]);

  // keep nowMs updated
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const n = getSpotifyNowMs();
      const max = durationMs || spotifyDurationRef.current || Number.MAX_SAFE_INTEGER;
      setNowMs(clamp(Math.floor(n), 0, max));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [durationMs]);

  async function togglePlay() {
    const p = spotifyPlayerRef.current;
    if (!p) return;
    await p.togglePlay();
  }

  async function seekTo(targetMs: number) {
    const t = clamp(targetMs, 0, durationMs || 0);
    const p = spotifyPlayerRef.current;
    if (!p) return;
    await p.seek(t);
    spotifyBasePosRef.current = t;
    spotifyBaseTsRef.current = Date.now();
    setNowMs(t);
  }

  async function seekBy(deltaMs: number) {
    const current = getCurrentTimeMs();
    await seekTo(current + deltaMs);
  }

  async function spotifyLoadAndPlay() {
    if (!spotifyReady || !spotifyDeviceId || !spotifyTrackUri) return;
    
    const token = await getValidAccessToken();
    const player = spotifyPlayerRef.current;
    try {
      await player?.activateElement?.();
    } catch {}
    try {
      await player?.connect?.();
    } catch {}

    const waitForDevice = async (timeoutMs = 20000, intervalMs = 500): Promise<string | null> => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const res = await fetch("https://api.spotify.com/v1/me/player/devices", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          const devices = Array.isArray(data?.devices) ? data.devices : [];
          const exact = devices.find((d: any) => d?.id === spotifyDeviceId);
          if (exact?.id) return exact.id;
          const byName = devices.find(
            (d: any) =>
              typeof d?.name === "string" &&
              d.name.toLowerCase().includes("cycle choreo author")
          );
          if (byName?.id) {
            setSpotifyDeviceId(byName.id);
            return byName.id;
          }
          setSpotifyStatus(`Waiting for Spotify device to be ready. Found ${devices.length} device(s).`);
        }
        try {
          const p = spotifyPlayerRef.current;
          if (p) {
            const state = await p.getCurrentState();
            if (!state) await p.connect();
          }
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
      return null;
    };

    const resolvedDeviceId = await waitForDevice();
    if (!resolvedDeviceId) {
      setSpotifyStatus("Waiting for Spotify device to be ready.");
      return;
    }

    const transferPlayback = async () => {
      const transferResponse = await fetch("https://api.spotify.com/v1/me/player", {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ device_ids: [resolvedDeviceId], play: false }),
      });

      return transferResponse;
    };

    let transferResponse = await transferPlayback();
    if (!transferResponse.ok) {
      const transferError = await transferResponse.text();
      const isDeviceNotFound = transferResponse.status === 404 || transferError.toLowerCase().includes("device not found");
      if (isDeviceNotFound) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        transferResponse = await transferPlayback();
      }

      if (!transferResponse.ok) {
        const retryError = await transferResponse.text();
        if (isDeviceNotFound) {
          try {
            const devicesRes = await fetch("https://api.spotify.com/v1/me/player/devices", {
              headers: { Authorization: `Bearer ${token}` },
            });
            if (devicesRes.ok) {
              const data = await devicesRes.json();
              const devices = Array.isArray(data?.devices) ? data.devices : [];
              const names = devices.map((d: any) => d?.name).filter(Boolean).join(", ");
              setSpotifyStatus(`Spotify device not found. Available devices: ${names || "none"}.`);
              return;
            }
          } catch {}
          setSpotifyStatus("Spotify device not found. Try pressing Play to activate the web player.");
          return;
        }
        throw new Error(`Failed to transfer playback: ${transferResponse.status} ${retryError || transferError}`);
      }
    }

    const response = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(resolvedDeviceId)}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ uris: [spotifyTrackUri] }),
    });
    
    if (!response.ok) {
      const error = await response.text();
      const isDeviceNotFound = response.status === 404 || error.toLowerCase().includes("device not found");
      if (isDeviceNotFound) {
        setSpotifyStatus(`Waiting for Spotify device to be ready. ${error || "Device not found."}`);
        return;
      }
      throw new Error(`Failed to play track: ${response.status} ${error}`);
    }
  }

  // ----------------------------
  // Base44-style selector state
  // ----------------------------
  const [baseGear, setBaseGear] = useState<number>(5);
  const [selExercise, setSelExercise] = useState<Exercise>("flat");
  const [selGear, setSelGear] = useState<number>(5);
  const [selPosition, setSelPosition] = useState<string>("Ride easy");
  const [selRpmMin, setSelRpmMin] = useState<number>(65);
  const [selRpmMax, setSelRpmMax] = useState<number>(75);
  const [selNote, setSelNote] = useState<string>("");
  const [rpmTrend, setRpmTrend] = useState<"down" | "up" | "">("");

  useEffect(() => {
    setSelGear(baseGear);
  }, [baseGear]);

  // ----------------------------
  // Step editing helpers
  // ----------------------------
  function upsertAtNow(stepPatch: Omit<Step, "id" | "t_ms" | "timestamp">) {
    const t = clamp(Math.floor(getCurrentTimeMs()), 0, durationMs || Number.MAX_SAFE_INTEGER);
    const snapMs = 250;

    setSteps((prev) => {
      const prevCopy = [...prev];
      // find a step within ±snapMs
      const idx = prevCopy.findIndex((s) => Math.abs(s.t_ms - t) <= snapMs);

      const next: Step[] =
        idx >= 0
          ? prevCopy.map((s, i) =>
              i === idx
                ? {
                    ...s,
                    ...stepPatch,
                    t_ms: t,
                    timestamp: formatTimestamp(t),
                  }
                : s
            )
          : [
              ...prevCopy,
              {
                id: uid(),
                ...stepPatch,
                t_ms: t,
                timestamp: formatTimestamp(t),
              },
            ];

      pushUndo(prevCopy);
      return next.sort((a, b) => a.t_ms - b.t_ms);
    });
  }

  function markCueNow() {
    const baseNote = selNote?.trim() ?? "";
    const trendTag = rpmTrend ? (rpmTrend === "down" ? "RPM↓ " : "RPM↑ ") : "";
    upsertAtNow({
      exercise: selExercise,
      gear: selGear,
      resistance: `L${selGear}`,
      position: selPosition,
      rpmMin: selRpmMin,
      rpmMax: selRpmMax,
      note: (trendTag + baseNote).trim() || undefined,
    });
  }

  function updateStep(id: string, patch: Partial<Step>) {
    setSteps((prev) => {
      const prevCopy = [...prev];
      const next = prevCopy.map((s) => {
        if (s.id !== id) return s;
        const updated = { ...s, ...patch } as Step;
        // If timestamp edited, update t_ms
        if (patch.timestamp) updated.t_ms = parseTimestamp(patch.timestamp);
        updated.timestamp = formatTimestamp(updated.t_ms);
        updated.gear = clamp(Number(updated.gear), 1, 30);
        updated.rpmMin = clamp(Number(updated.rpmMin), 40, 160);
        updated.rpmMax = clamp(Number(updated.rpmMax), 40, 160);
        updated.resistance = `L${updated.gear}`;
        return updated;
      });

      pushUndo(prevCopy);
      return next.sort((a, b) => a.t_ms - b.t_ms);
    });
  }

  function deleteStep(id: string) {
    setSteps((prev) => {
      const prevCopy = [...prev];
      const next = prevCopy.filter((s) => s.id !== id);
      pushUndo(prevCopy);
      return next;
    });
  }

  function nudgeStep(id: string, deltaMs: number) {
    setSteps((prev) => {
      const prevCopy = [...prev];
      const next = prevCopy.map((s) => {
        if (s.id !== id) return s;
        const t = clamp(s.t_ms + deltaMs, 0, durationMs || Number.MAX_SAFE_INTEGER);
        return { ...s, t_ms: t, timestamp: formatTimestamp(t) };
      });
      pushUndo(prevCopy);
      return next.sort((a, b) => a.t_ms - b.t_ms);
    });
  }

  const currentStep = useMemo(() => {
    if (stepsSorted.length === 0) return null;
    const t = nowMs;
    // last step with t_ms <= nowMs
    let last: Step | null = null;
    for (const s of stepsSorted) {
      if (s.t_ms <= t) last = s;
      else break;
    }
    return last;
  }, [stepsSorted, nowMs]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === "INPUT" || (e.target as HTMLElement).tagName === "TEXTAREA" || (e.target as HTMLElement).tagName === "SELECT") return;
      switch (e.code) {
        case "Space":
          e.preventDefault();
          togglePlay();
          break;
        case "ArrowLeft":
          e.preventDefault();
          seekBy(e.shiftKey ? -5000 : -2000);
          break;
        case "ArrowRight":
          e.preventDefault();
          seekBy(e.shiftKey ? 5000 : 2000);
          break;
        case "KeyM":
          e.preventDefault();
          markCueNow();
          break;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [durationMs, nowMs, selExercise, selGear, selPosition, selRpmMin, selRpmMax, selNote, rpmTrend]);

  // Export / Import
  function exportSession() {
    const payload = {
      version: 1,
      created_at: new Date().toISOString(),
      source: "spotify",
      track: spotifyTrackUri,
      duration_ms: durationMs,
      steps: stepsSorted,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cycle_choreo_spotify.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function saveChoreography() {
    if (!currentTrackId) {
      alert("No track loaded from database. Use 'Load from DB' to select a track first.");
      return;
    }

    setIsSaving(true);
    setSaveMessage("");

    try {
      const response = await fetch(`/api/tracks/${currentTrackId}/choreography`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          choreography: stepsSorted,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to save choreography");
      }

      const result = await response.json();
      setSaveMessage(`✓ Saved to database: ${currentTrackTitle}`);
      
      // Clear message after 3 seconds
      setTimeout(() => setSaveMessage(""), 3000);
    } catch (error: any) {
      setSaveMessage(`✗ Error: ${error.message}`);
      setTimeout(() => setSaveMessage(""), 5000);
    } finally {
      setIsSaving(false);
    }
  }

  async function importSession(file: File) {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!data || !Array.isArray(data.steps)) throw new Error("Invalid file: missing steps[]");

    const imported: Step[] = data.steps
      .filter((s: any) => s && typeof s.t_ms === "number")
      .map((s: any) => ({
        id: String(s.id || uid()),
        t_ms: Math.floor(s.t_ms),
        timestamp: formatTimestamp(Math.floor(s.t_ms)),
        exercise: (s.exercise as Exercise) || "flat",
        gear: clamp(Number(s.gear ?? 5), 1, 30),
        resistance: String(s.resistance ?? `L${s.gear ?? 5}`),
        position: String(s.position ?? "Ride easy"),
        rpmMin: clamp(Number(s.rpmMin ?? 65), 40, 160),
        rpmMax: clamp(Number(s.rpmMax ?? 75), 40, 160),
        note: typeof s.note === "string" ? s.note : undefined,
      }))
      .sort((a, b) => a.t_ms - b.t_ms);

    pushUndo(steps);
    setSteps(imported);
    if (typeof data.track === "string" && data.source === "spotify") setSpotifyTrackUri(data.track);
  }

  // Drag & drop audio/json
  const [isDragging, setIsDragging] = useState(false);
  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };
  const onDragLeave = () => setIsDragging(false);
  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (!file) return;

    if (file.type === "application/json" || file.name.endsWith(".json")) {
      try {
        await importSession(file);
        alert("Session imported!");
      } catch (err) {
        alert(String(err));
      }
    } else {
      alert("Drop a session JSON file.");
    }
  };

  // ----------------------------
  // Header labels
  // ----------------------------
  const trackName = currentTrackTitle || spotifyTrackUri || "(no track loaded)";
  const playbackLabel = `${formatTimestamp(nowMs)} / ${formatTimestamp(durationMs || 0)}`;
  const canControl = spotifyReady;

  return (
    <div style={{ ...bg, backgroundColor: isDragging ? "#111827" : undefined }} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
      <div style={{ maxWidth: 1400, margin: "0 auto" }}>
        {/* Spotify auth bar */}
        <div style={{ ...card, padding: 12, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <strong>Spotify:</strong>
          {loggedIn ? (
            <>
              <span style={{ color: "#34d399", fontWeight: 800 }}>Logged in</span>
              <button
                style={smallBtn}
                onClick={() => {
                  clearToken();
                  if (spotifyPlayerRef.current) {
                    spotifyPlayerRef.current.disconnect();
                    spotifyPlayerRef.current = null;
                  }
                  setSpotifyReady(false);
                  setSpotifyDeviceId("");
                  setSpotifyStatus("Logged out");
                  window.location.reload();
                }}
              >
                Logout
              </button>
            </>
          ) : (
            <>
              <span style={{ color: "#fca5a5", fontWeight: 800 }}>Not logged in</span>
              <button style={smallBtn} onClick={() => loginWithSpotify().catch((e) => alert(String(e?.message || e)))}>
                Login with Spotify
              </button>
            </>
          )}

          <div style={{ marginLeft: "auto", color: "rgba(255,255,255,0.75)", fontSize: 12 }}>{spotifyStatus}</div>
          <div style={{ color: "rgba(255,255,255,0.6)", fontSize: 12 }}>
            Shortcuts: <b>Space</b> play/pause, <b>←/→</b> seek, <b>M</b> mark
          </div>
        </div>

        {/* Top transport bar (matches the first screenshot) */}
        <div style={{ ...card, padding: 12, marginTop: 12, display: "flex", gap: 12, alignItems: "center" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11, opacity: 0.75 }}>Track</div>
            <div style={{ fontSize: 15, fontWeight: 900, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {trackName}
            </div>
            <div style={{ fontSize: 11, opacity: 0.7 }}>{playbackLabel}</div>
          </div>

          <button style={smallBtn} onClick={() => seekBy(-5000)} disabled={!canControl}>
            Back
          </button>
          <button style={smallBtn} onClick={() => togglePlay().catch((e) => alert(String(e?.message || e)))} disabled={!canControl}>
            {isPlaying ? "Pause" : "Play"}
          </button>
          <button style={smallBtn} onClick={() => seekBy(5000)} disabled={!canControl}>
            Fwd
          </button>

          <button style={smallBtn} onClick={undo} disabled={undoStack.length === 0}>
            Undo
          </button>
          <button style={smallBtn} onClick={redo} disabled={redoStack.length === 0}>
            Redo
          </button>

          <button style={smallBtn} onClick={exportSession} disabled={stepsSorted.length === 0}>
            Export
          </button>

          {/* Save to DB button */}
          <button 
            style={{
              ...smallBtn,
              background: currentTrackId ? "rgba(34,197,94,0.15)" : "rgba(255,255,255,0.06)",
              borderColor: currentTrackId ? "rgba(34,197,94,0.4)" : "rgba(255,255,255,0.15)",
            }}
            onClick={saveChoreography} 
            disabled={!currentTrackId || isSaving || stepsSorted.length === 0}
          >
            {isSaving ? "Saving..." : "Save to DB"}
          </button>

          {/* Load from database */}
          <button style={smallBtn} onClick={() => navigate("/tracks")}>
            Load Track
          </button>
        </div>

        {/* Save message feedback */}
        {saveMessage && (
          <div 
            style={{ 
              ...card, 
              marginTop: 12, 
              padding: "10px 16px", 
              background: saveMessage.startsWith("✓") ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)",
              borderColor: saveMessage.startsWith("✓") ? "rgba(34,197,94,0.4)" : "rgba(239,68,68,0.4)",
              fontSize: 14,
              fontWeight: 600,
              textAlign: "center"
            }}
          >
            {saveMessage}
          </div>
        )}

        {/* Spotify status row */}
        <div style={{ ...card, marginTop: 12, padding: 12, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ fontSize: 14, opacity: 0.85 }}>
            {spotifyTrackUri ? (
              <>
                <strong>Loaded:</strong> {currentTrackTitle || spotifyTrackUri}
              </>
            ) : (
              "No track loaded. Use 'Load Track' button to select from database."
            )}
          </div>

          <div style={{ marginLeft: "auto", display: "flex", gap: 12, alignItems: "center" }}>
            <span style={{ color: spotifyReady ? "#34d399" : "#fca5a5", fontWeight: 800, fontSize: 13 }}>
              {spotifyReady ? "● Spotify ready" : "○ Spotify not ready"}
            </span>
          </div>
        </div>

        {/* Base Gear row */}
        <div style={{ ...card, marginTop: 12, padding: 14, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <div style={{ fontSize: 14, opacity: 0.9 }}>Base Gear:</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {Array.from({ length: 10 }, (_, i) => i + 1).map((g) => {
              const active = g === baseGear;
              return (
                <button
                  key={g}
                  style={{
                    ...baseBtn,
                    width: 44,
                    height: 44,
                    borderRadius: 10,
                    fontWeight: 900,
                    background: active ? "rgba(59,130,246,0.45)" : "rgba(255,255,255,0.06)",
                    border: active ? "1px solid rgba(96,165,250,0.9)" : "1px solid rgba(255,255,255,0.15)",
                  }}
                  onClick={() => setBaseGear(g)}
                >
                  {g}
                </button>
              );
            })}
          </div>
          <div style={{ marginLeft: 10, opacity: 0.8 }}>
            Current: <b>{baseGear}</b>
          </div>
        </div>

        {/* Marking panel */}
        <div style={{ ...card, marginTop: 12, padding: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: isPortraitNarrow ? "1fr" : "1.2fr 1fr 1.2fr 1fr", gap: 16, alignItems: "start" }}>
            {/* Exercise */}
            <div>
              <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 8 }}>Exercise</div>
              <div style={{ display: "grid", gap: 10 }}>
                {[
                  { label: "Flat / Ride Easy", ex: "flat" as Exercise, position: "Ride easy" },
                  { label: "Climb", ex: "climb" as Exercise, position: "Seated Climb" },
                  { label: "Sprint", ex: "sprint" as Exercise, position: "Sprint" },
                  { label: "Recovery", ex: "recover" as Exercise, position: "Ride easy" },
                  { label: "Interval / Surge", ex: "run" as Exercise, position: "Surge" },
                ].map((item) => {
                  const active = selExercise === item.ex;
                  return (
                    <button
                      key={item.label}
                      style={{
                        ...baseBtn,
                        padding: "12px 14px",
                        borderRadius: 10,
                        fontWeight: 900,
                        textAlign: "left",
                        background: active ? "rgba(168,85,247,0.55)" : "rgba(255,255,255,0.06)",
                        border: active ? "1px solid rgba(192,132,252,0.9)" : "1px solid rgba(255,255,255,0.15)",
                      }}
                      disabled={!canControl}
                      onClick={() => {
                        setSelExercise(item.ex);
                        setSelPosition(item.position);
                      }}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Resistance */}
            <div>
              <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 8 }}>Resistance</div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {[-2, -1, 0, 1].map((d) => {
                  const g = clamp(baseGear + d, 1, 30);
                  const active = selGear === g;
                  return (
                    <button
                      key={d}
                      style={{
                        ...baseBtn,
                        width: 56,
                        height: 44,
                        borderRadius: 10,
                        fontWeight: 900,
                        background: active ? "rgba(168,85,247,0.55)" : "rgba(255,255,255,0.06)",
                        border: active ? "1px solid rgba(192,132,252,0.9)" : "1px solid rgba(255,255,255,0.15)",
                      }}
                      disabled={!canControl}
                      onClick={() => setSelGear(g)}
                    >
                      {g}
                    </button>
                  );
                })}
                {/* plus two above base */}
                {[2].map((d) => {
                  const g = clamp(baseGear + d, 1, 30);
                  const active = selGear === g;
                  return (
                    <button
                      key={"p" + d}
                      style={{
                        ...baseBtn,
                        width: 56,
                        height: 44,
                        borderRadius: 10,
                        fontWeight: 900,
                        background: active ? "rgba(168,85,247,0.55)" : "rgba(255,255,255,0.06)",
                        border: active ? "1px solid rgba(192,132,252,0.9)" : "1px solid rgba(255,255,255,0.15)",
                      }}
                      disabled={!canControl}
                      onClick={() => setSelGear(g)}
                    >
                      {g}
                    </button>
                  );
                })}
              </div>

              <div style={{ marginTop: 10, display: "flex", gap: 10, alignItems: "center" }}>
                <div style={{ opacity: 0.8, fontSize: 12 }}>or</div>
                <input
                  style={{ ...inputStyle, flex: 1 }}
                  type="number"
                  value={selGear}
                  min={1}
                  max={30}
                  onChange={(e) => setSelGear(clamp(Number(e.target.value), 1, 30))}
                  placeholder="Set gear"
                  disabled={!canControl}
                />
              </div>

              <div style={{ marginTop: 14, opacity: 0.9 }}>
                <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 8 }}>Pace (RPM)</div>
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <input
                    style={{ ...inputStyle, width: 84, textAlign: "center" }}
                    type="number"
                    value={selRpmMin}
                    min={40}
                    max={160}
                    onChange={(e) => setSelRpmMin(clamp(Number(e.target.value), 40, 160))}
                    disabled={!canControl}
                  />
                  <div style={{ opacity: 0.75 }}>—</div>
                  <input
                    style={{ ...inputStyle, width: 84, textAlign: "center" }}
                    type="number"
                    value={selRpmMax}
                    min={40}
                    max={160}
                    onChange={(e) => setSelRpmMax(clamp(Number(e.target.value), 40, 160))}
                    disabled={!canControl}
                  />
                  <div style={{ opacity: 0.75, fontSize: 12 }}>RPM</div>
                </div>

                <div style={{ marginTop: 10, display: "flex", gap: 10 }}>
                  <button
                    style={{
                      ...baseBtn,
                      flex: 1,
                      padding: "12px 12px",
                      borderRadius: 12,
                      fontWeight: 900,
                      background: rpmTrend === "down" ? "rgba(168,85,247,0.55)" : "rgba(168,85,247,0.22)",
                      border: "1px solid rgba(192,132,252,0.55)",
                    }}
                    disabled={!canControl}
                    onClick={() => setRpmTrend(rpmTrend === "down" ? "" : "down")}
                  >
                    RPM ↓
                  </button>
                  <button
                    style={{
                      ...baseBtn,
                      flex: 1,
                      padding: "12px 12px",
                      borderRadius: 12,
                      fontWeight: 900,
                      background: rpmTrend === "up" ? "rgba(168,85,247,0.55)" : "rgba(168,85,247,0.22)",
                      border: "1px solid rgba(192,132,252,0.55)",
                    }}
                    disabled={!canControl}
                    onClick={() => setRpmTrend(rpmTrend === "up" ? "" : "up")}
                  >
                    RPM ↑
                  </button>
                </div>
              </div>
            </div>

            {/* Position */}
            <div>
              <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 8 }}>Position</div>
              <div style={{ display: "grid", gap: 10 }}>
                {["Ride easy", "Seated Climb", "Racing Climb", "Standing Climb"].map((p) => {
                  const active = selPosition.toLowerCase() === p.toLowerCase();
                  return (
                    <button
                      key={p}
                      style={{
                        ...baseBtn,
                        padding: "12px 14px",
                        borderRadius: 10,
                        fontWeight: 900,
                        background: active ? "rgba(168,85,247,0.55)" : "rgba(255,255,255,0.06)",
                        border: active ? "1px solid rgba(192,132,252,0.9)" : "1px solid rgba(255,255,255,0.15)",
                      }}
                      disabled={!canControl}
                      onClick={() => setSelPosition(p)}
                    >
                      {p}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Note */}
            <div>
              <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 8 }}>Note (optional)</div>
              <input
                style={{ ...inputStyle, width: "100%", padding: "12px 12px", fontSize: 13 }}
                value={selNote}
                onChange={(e) => setSelNote(e.target.value)}
                placeholder="Quick cue..."
                disabled={!canControl}
              />

              <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <label style={{ ...smallBtn, display: "inline-flex", alignItems: "center", gap: 8 }}>
                  Import
                  <input
                    type="file"
                    accept="application/json"
                    style={{ display: "none" }}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      importSession(f).catch((err) => alert(String(err?.message || err)));
                    }}
                  />
                </label>
                <button
                  style={smallBtn}
                  onClick={() => {
                    pushUndo(steps);
                    setSteps([]);
                  }}
                  disabled={stepsSorted.length === 0}
                >
                  Clear
                </button>
              </div>
            </div>
          </div>

          {/* Big Mark button */}
          <button
            style={{
              marginTop: 16,
              width: "100%",
              padding: "16px 14px",
              borderRadius: 12,
              fontSize: 16,
              fontWeight: 950,
              cursor: canControl ? "pointer" : "not-allowed",
              background: "rgba(34,197,94,0.85)",
              border: "1px solid rgba(34,197,94,0.95)",
              color: "#07120a",
              opacity: canControl ? 1 : 0.6,
            }}
            disabled={!canControl}
            onClick={markCueNow}
          >
            + Mark Cue at {formatTimestamp(nowMs)}
          </button>
        </div>

        {/* Bottom: audio + steps list */}
        <div style={{ display: "grid", gridTemplateColumns: isPortraitNarrow ? "1fr" : "0.9fr 1.1fr", gap: 12, marginTop: 12 }}>
          <div style={{ ...card, padding: 12 }}>
            <div style={{ padding: 14, borderRadius: 14, background: "rgba(0,0,0,0.25)", border: "1px solid rgba(255,255,255,0.12)" }}>
              <div style={{ fontSize: 12, opacity: 0.75 }}>Spotify playback</div>
              <div style={{ marginTop: 6, fontSize: 13, opacity: 0.9 }}>
                Use <b>Back/Play/Fwd</b> above to control the track. (Spotify Web Playback SDK)
              </div>
            </div>

            <div style={{ marginTop: 10, ...card, padding: 10 }}>
              <div style={{ fontSize: 12, opacity: 0.75 }}>Active</div>
              <div style={{ fontSize: 14, fontWeight: 900 }}>{currentStep ? `${currentStep.exercise} • ${currentStep.position}` : "(none yet)"}</div>
              <div style={{ marginTop: 6, fontSize: 12, opacity: 0.85 }}>
                {currentStep
                  ? `RPM ${currentStep.rpmMin}-${currentStep.rpmMax} • Gear ${currentStep.gear} • Note: ${currentStep.note || "—"}`
                  : "Press Play and click “Mark Cue” to create your first step."}
              </div>
            </div>
          </div>

          <div style={{ ...card, padding: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <div style={{ fontSize: 15, fontWeight: 950 }}>Choreography</div>
              <div style={{ fontSize: 12, opacity: 0.75 }}>{stepsSorted.length} steps</div>
            </div>

            <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8, maxHeight: isPortraitNarrow ? 680 : 820, overflow: "auto" }}>
              {stepsSorted.length === 0 && <div style={{ opacity: 0.75, fontSize: 13 }}>No steps yet. Hit Play and click “Mark Cue”.</div>}

              {stepsSorted.map((s: Step) => (
                <div key={s.id} style={{ ...card, padding: 10, borderRadius: 16, background: "rgba(255,255,255,0.04)" }}>
                  <div style={{ display: "grid", gridTemplateColumns: isPortraitNarrow ? "84px 1fr" : "92px 1fr", gap: 10, alignItems: "start" }}>
                    <div style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12, opacity: 0.92 }}>
                      <div style={{ marginBottom: 6 }}>{s.timestamp}</div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <button style={smallBtn} onClick={() => nudgeStep(s.id, -250)}>-250</button>
                        <button style={smallBtn} onClick={() => nudgeStep(s.id, -50)}>-50</button>
                        <button style={smallBtn} onClick={() => nudgeStep(s.id, 50)}>+50</button>
                        <button style={smallBtn} onClick={() => nudgeStep(s.id, 250)}>+250</button>
                      </div>
                      <button style={{ ...smallBtn, marginTop: 6, border: "1px solid rgba(239,68,68,0.55)" }} onClick={() => deleteStep(s.id)}>
                        Delete
                      </button>
                      <button style={{ ...smallBtn, marginTop: 6 }} onClick={() => seekTo(s.t_ms)} disabled={!canControl}>
                        Jump
                      </button>
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <div style={{ display: "grid", gridTemplateColumns: isPortraitNarrow ? "1fr 1fr" : "120px 1fr 1fr 1fr 1fr", gap: 8 }}>
                        <input style={inputStyle} value={s.timestamp} onChange={(e) => updateStep(s.id, { timestamp: e.target.value })} title="Timestamp (M:SS)" />
                        <select style={selectStyle} value={s.exercise} onChange={(e) => updateStep(s.id, { exercise: e.target.value as Exercise })}>
                          {MOVEMENTS.map((m: { key: Exercise; label: string }) => (
                            <option key={m.key} value={m.key}>
                              {m.label}
                            </option>
                          ))}
                        </select>
                        <input style={inputStyle} type="number" value={s.gear} onChange={(e) => updateStep(s.id, { gear: Number(e.target.value) })} title="Gear (numeric)" />
                        <input style={inputStyle} type="number" value={s.rpmMin} onChange={(e) => updateStep(s.id, { rpmMin: Number(e.target.value) })} title="RPM min" />
                        <input style={inputStyle} type="number" value={s.rpmMax} onChange={(e) => updateStep(s.id, { rpmMax: Number(e.target.value) })} title="RPM max" />
                      </div>

                      <div style={{ display: "grid", gridTemplateColumns: isPortraitNarrow ? "1fr" : "1.2fr 0.8fr", gap: 8 }}>
                        <input style={inputStyle} value={s.position} onChange={(e) => updateStep(s.id, { position: e.target.value })} placeholder="Position" />
                        <input style={inputStyle} value={s.note ?? ""} onChange={(e) => updateStep(s.id, { note: e.target.value })} placeholder="Note" />
                      </div>

                      <div style={{ fontSize: 12, opacity: 0.8 }}>
                        Resistance: <b>{s.resistance}</b> • RPM <b>{s.rpmMin}-{s.rpmMax}</b> • {s.exercise}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div style={{ ...card, padding: 12, marginTop: 12, opacity: 0.85, fontSize: 12 }}>
              The big “Mark Cue” button upserts a step at the current time (snap ±250ms). Drag & Drop audio/JSON anywhere.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
