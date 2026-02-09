import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { handleCallback } from "./auth";

export default function CallbackPage() {
  const nav = useNavigate();
  const [msg, setMsg] = useState("Connecting to Spotify...");

  useEffect(() => {
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
      <p>{msg}</p>
      <p style={{ color: "#666" }}>
        If this failed, confirm your Spotify app Redirect URI is exactly: <code>http://127.0.0.1:8888/callback</code>
      </p>
    </div>
  );
}
