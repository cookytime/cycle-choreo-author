import express from "express";
import pg from "pg";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3001;

// Configure PostgreSQL connection
const pool = new Pool({
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT || "5432"),
  database: process.env.DB_NAME || "cycle_choreo",
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD || "",
});

app.use(cors());
app.use(express.json());

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

// Get all tracks
app.get("/api/tracks", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        spotify_id,
        title,
        artist,
        album,
        spotify_album_art,
        spotify_url,
        duration_minutes,
        bpm,
        intensity,
        focus_area,
        track_type,
        position,
        resistance_min,
        resistance_max,
        cadence_min,
        cadence_max,
        choreography,
        cues,
        notes,
        is_sample,
        updated_date
      FROM tracks
      ORDER BY title ASC
    `);
    
    res.json({ tracks: result.rows });
  } catch (error) {
    console.error("Error fetching tracks:", error);
    res.status(500).json({ error: "Failed to fetch tracks", details: error.message });
  }
});

// Get a specific track by ID
app.get("/api/tracks/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      "SELECT * FROM tracks WHERE spotify_id = $1",
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Track not found" });
    }
    
    res.json({ track: result.rows[0] });
  } catch (error) {
    console.error("Error fetching track:", error);
    res.status(500).json({ error: "Failed to fetch track", details: error.message });
  }
});

// Search tracks
app.get("/api/tracks/search/:query", async (req, res) => {
  try {
    const { query } = req.params;
    const result = await pool.query(`
      SELECT 
        spotify_id,
        title,
        artist,
        album,
        spotify_album_art,
        spotify_url,
        duration_minutes,
        bpm,
        intensity,
        focus_area,
        track_type,
        choreography,
        cues,
        is_sample,
        updated_date
      FROM tracks
      WHERE 
        LOWER(title) LIKE LOWER($1) OR
        LOWER(artist) LIKE LOWER($1) OR
        LOWER(album) LIKE LOWER($1)
      ORDER BY title ASC
    `, [`%${query}%`]);
    
    res.json({ tracks: result.rows });
  } catch (error) {
    console.error("Error searching tracks:", error);
    res.status(500).json({ error: "Failed to search tracks", details: error.message });
  }
});

// Update track choreography
app.put("/api/tracks/:id/choreography", async (req, res) => {
  try {
    const { id } = req.params;
    const { choreography } = req.body;
    
    if (!choreography || !Array.isArray(choreography)) {
      return res.status(400).json({ error: "Invalid choreography data" });
    }
    
    const result = await pool.query(
      `UPDATE tracks 
       SET choreography = $1, updated_date = NOW() 
       WHERE spotify_id = $2 
       RETURNING spotify_id, title, updated_date`,
      [JSON.stringify(choreography), id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Track not found" });
    }
    
    res.json({ 
      success: true, 
      track: result.rows[0],
      message: "Choreography saved successfully" 
    });
  } catch (error) {
    console.error("Error updating choreography:", error);
    res.status(500).json({ error: "Failed to update choreography", details: error.message });
  }
});

// Serve the built frontend in production
if (process.env.NODE_ENV === "production") {
  const distPath = path.resolve(__dirname, "../dist");
  app.use(express.static(distPath));
  app.get("*", (req, res) => {
    res.sendFile(path.join(distPath, "index.html"));
  });
}

app.listen(port, "0.0.0.0", () => {
  console.log(`🚀 API server running on http://0.0.0.0:${port}`);
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  console.log("SIGTERM received, closing database pool...");
  await pool.end();
  process.exit(0);
});
