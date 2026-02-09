import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

type TrackRecord = {
  spotify_id: string;
  title: string;
  artist: string;
  album?: string;
  spotify_album_art?: string;
  spotify_url?: string;
  duration_minutes?: number;
  bpm?: number;
  intensity?: string;
  focus_area?: string;
  track_type?: string;
  position?: string;
  resistance_min?: number;
  resistance_max?: number;
  cadence_min?: number;
  cadence_max?: number;
  choreography?: any[];
  cues?: any[];
  notes?: string;
  is_sample?: boolean;
  updated_date?: string;
};

export default function TrackSelectionPage() {
  const navigate = useNavigate();
  const [tracks, setTracks] = useState<TrackRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    loadTracks();
  }, []);

  async function loadTracks() {
    try {
      setLoading(true);
      setError("");
      const response = await fetch("/api/tracks");
      if (!response.ok) {
        throw new Error(`Failed to load tracks: ${response.statusText}`);
      }
      const data = await response.json();
      setTracks(data.tracks || []);
    } catch (err: any) {
      setError(err.message || "Failed to load tracks");
    } finally {
      setLoading(false);
    }
  }

  function selectTrack(track: TrackRecord) {
    // Navigate back to editor with track data
    navigate("/", { state: { selectedTrack: track } });
  }

  function formatDuration(ms: number) {
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  const filteredTracks = tracks.filter((track) => {
    const term = searchTerm.toLowerCase();
    return (
      track.title.toLowerCase().includes(term) ||
      track.artist.toLowerCase().includes(term) ||
      (track.album?.toLowerCase() || "").includes(term) ||
      (track.intensity?.toLowerCase() || "").includes(term) ||
      (track.focus_area?.toLowerCase() || "").includes(term)
    );
  });

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
    padding: 24,
    maxWidth: 1200,
    margin: "0 auto",
  };

  const searchInput: React.CSSProperties = {
    width: "100%",
    padding: "12px 16px",
    background: "rgba(255,255,255,0.08)",
    border: "1px solid rgba(255,255,255,0.2)",
    borderRadius: 8,
    color: "rgba(255,255,255,0.92)",
    fontSize: 16,
    fontFamily: "inherit",
    outline: "none",
  };

  const trackItem: React.CSSProperties = {
    padding: "16px 20px",
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 12,
    cursor: "pointer",
    transition: "all 0.2s ease",
    marginBottom: 12,
  };

  const button: React.CSSProperties = {
    padding: "10px 20px",
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.15)",
    borderRadius: 8,
    color: "rgba(255,255,255,0.92)",
    fontSize: 14,
    fontFamily: "inherit",
    cursor: "pointer",
    transition: "all 0.2s ease",
  };

  return (
    <div style={bg}>
      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <h1 style={{ margin: 0, fontSize: 32, fontWeight: 600 }}>Select Track</h1>
          <button
            style={button}
            onClick={() => navigate("/")}
            onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.1)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.06)")}
          >
            ← Back to Editor
          </button>
        </div>

        <div style={{ marginBottom: 24 }}>
          <input
            type="text"
            placeholder="Search tracks, artists, or albums..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={searchInput}
            onFocus={(e) => (e.currentTarget.style.borderColor = "rgba(59,130,246,0.5)")}
            onBlur={(e) => (e.currentTarget.style.borderColor = "rgba(255,255,255,0.2)")}
          />
        </div>

        {loading && (
          <div style={{ textAlign: "center", padding: 40, opacity: 0.6 }}>
            Loading tracks...
          </div>
        )}

        {error && (
          <div style={{ padding: 20, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 12, marginBottom: 20 }}>
            <strong>Error:</strong> {error}
            <br />
            <button style={{ ...button, marginTop: 12 }} onClick={loadTracks}>
              Retry
            </button>
          </div>
        )}

        {!loading && !error && filteredTracks.length === 0 && (
          <div style={{ textAlign: "center", padding: 40, opacity: 0.6 }}>
            {searchTerm ? "No tracks match your search" : "No tracks found in database"}
          </div>
        )}

        <div style={{ maxHeight: "calc(100vh - 300px)", overflowY: "auto" }}>
          {filteredTracks.map((track) => (
            <div
              key={track.spotify_id}
              style={trackItem}
              onClick={() => selectTrack(track)}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(255,255,255,0.08)";
                e.currentTarget.style.borderColor = "rgba(59,130,246,0.4)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "rgba(255,255,255,0.04)";
                e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)";
              }}
            >
              <div style={{ display: "flex", gap: 16 }}>
                {track.spotify_album_art && (
                  <img 
                    src={track.spotify_album_art} 
                    alt="Album art"
                    style={{ width: 80, height: 80, borderRadius: 8, objectFit: "cover" }}
                  />
                )}
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
                  <div>
                    <div style={{ fontSize: 18, fontWeight: 500, marginBottom: 4 }}>{track.title}</div>
                    <div style={{ fontSize: 14, opacity: 0.7 }}>
                      {track.artist}
                      {track.album && ` • ${track.album}`}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 16, fontSize: 13, opacity: 0.6, flexWrap: "wrap" }}>
                    {track.duration_minutes && (
                      <span>⏱️ {formatDuration(Math.round(track.duration_minutes * 60 * 1000))}</span>
                    )}
                    {track.bpm && <span>🎵 {Math.round(track.bpm)} BPM</span>}
                    {track.intensity && <span>💪 {track.intensity}</span>}
                    {track.focus_area && <span>🎯 {track.focus_area}</span>}
                    {track.is_sample && <span style={{ color: "rgba(34,197,94,0.8)" }}>✨ Sample</span>}
                  </div>
                  {track.notes && (
                    <div style={{ fontSize: 12, opacity: 0.5, fontStyle: "italic" }}>
                      {track.notes.length > 100 ? track.notes.substring(0, 100) + "..." : track.notes}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {!loading && !error && filteredTracks.length > 0 && (
          <div style={{ marginTop: 20, textAlign: "center", opacity: 0.5, fontSize: 14 }}>
            Showing {filteredTracks.length} of {tracks.length} tracks
          </div>
        )}
      </div>
    </div>
  );
}
