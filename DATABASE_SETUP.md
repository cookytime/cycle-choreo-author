# Database Setup Guide

## Prerequisites

1. PostgreSQL installed and running locally
2. Node.js and npm installed

## Setup Steps

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Database

Create a `.env` file in the project root:

```bash
cp .env.example .env
```

Edit `.env` with your PostgreSQL credentials:

```
DB_HOST=localhost
DB_PORT=5432
DB_NAME=cycle_choreo
DB_USER=postgres
DB_PASSWORD=your_password_here
PORT=3001
```

### 3. Create Database and Table

Connect to PostgreSQL and create the database:

```sql
CREATE DATABASE cycle_choreo;
```

Then create the tracks table:

```sql
\c cycle_choreo

CREATE TABLE IF NOT EXISTS tracks (
  spotify_id TEXT PRIMARY KEY,

  title TEXT NOT NULL,
  artist TEXT,
  album TEXT,
  spotify_album_art TEXT,
  spotify_url TEXT,

  duration_minutes NUMERIC,
  bpm NUMERIC,
  intensity TEXT,
  focus_area TEXT,
  track_type TEXT,
  position TEXT,

  resistance_min NUMERIC,
  resistance_max NUMERIC,
  cadence_min NUMERIC,
  cadence_max NUMERIC,

  choreography JSONB NOT NULL DEFAULT '[]'::JSONB,
  cues JSONB NOT NULL DEFAULT '[]'::JSONB,
  notes TEXT,

  base44_id TEXT,
  created_date TIMESTAMPTZ,
  updated_date TIMESTAMPTZ,
  created_by_id TEXT,
  created_by TEXT,
  is_sample BOOLEAN NOT NULL DEFAULT FALSE,

  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes for faster searches
CREATE INDEX IF NOT EXISTS idx_tracks_updated_date ON tracks(updated_date);
CREATE INDEX IF NOT EXISTS idx_tracks_title ON tracks(title);
CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks(artist);
```

### 4. Run the Application

Start both the frontend and backend servers:

```bash
npm run dev:all
```

Or run them separately:

```bash
# Terminal 1 - Backend API
npm run server

# Terminal 2 - Frontend Dev Server
npm run dev
```

### 5. Access the Application

- Frontend: http://127.0.0.1:8888
- Backend API: http://localhost:3001

## API Endpoints

- `GET /api/health` - Health check
- `GET /api/tracks` - Get all tracks
- `GET /api/tracks/:id` - Get a specific track
- `GET /api/tracks/search/:query` - Search tracks

## Usage

1. Click the "Load from DB" button in the editor
2. Browse and search your track library
3. Click on a track to load it into the editor
4. The track will automatically load via Spotify if you're logged in

## Troubleshooting

**Database connection fails:**
- Verify PostgreSQL is running: `pg_isready`
- Check your credentials in `.env`
- Ensure the database exists

**No tracks appear:**
- Verify tracks are in the database: `SELECT COUNT(*) FROM tracks;`
- Check the browser console for API errors

**Track won't load:**
- Ensure you're logged into Spotify (click "Login with Spotify")
- Verify the track has a valid `spotify_uri` in the database
