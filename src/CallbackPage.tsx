import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { handleCallback, REDIRECT_URI } from "./auth";

export default function CallbackPage() {
  const nav = useNavigate();
  const [msg, setMsg] = useState("Connecting to Spotify...");
  
  // Suggestion 1: Fix React Strict Mode OAuth Race Condition
  const calledRef = useRef(false);

  useEffect(() => {
    if (calledRef.current) return;
    calledRef.current = true;

    (async () => {
      try {
        const params = new URLSearchParams(window.location.search);
        const code = params.get("code");
        const err = params.get("error");
        if (err) throw new Error(err);
        if (!code) throw new Error("Missing code in callback URL.");
        await handleCallback(code);
        nav("/");
      } catch (e: any) {
        setMsg(String(e?.message || e));
      }
    })();
  }, [nav]);

  return (
    <div style={{ padding: 24, fontFamily: "system-ui" }}>
      <h2>Spotify OAuth</h2>
      <p style={{ whiteSpace: "pre-wrap" }}>{msg}</p>
      {msg.includes("Missing PKCE verifier") && (
        <div style={{ marginTop: 16, padding: 12, background: "#fff3cd", color: "#856404", borderRadius: 8 }}>
          <strong>Quick fix:</strong>
          <ol style={{ marginTop: 8 }}>
            <li>Always access this app at <code>http://127.0.0.1:8888</code> (not localhost)</li>
            <li>Clear your browser cache and localStorage</li>
            <li>Try logging in again</li>
          </ol>
        </div>
      )}
      <p style={{ color: "#666", marginTop: 16 }}>
        If this failed, confirm your Spotify app Redirect URI is exactly: <code>{REDIRECT_URI}</code>
      </p>
    </div>
  );
}
