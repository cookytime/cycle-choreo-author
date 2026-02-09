import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import EditorPage from "./EditorPage";
import CallbackPage from "./CallbackPage";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<EditorPage />} />
      <Route path="/callback" element={<CallbackPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
