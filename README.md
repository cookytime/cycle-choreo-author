# Choreo Marker Editor (WAV + Spotify OAuth)

Runs locally on:
- http://127.0.0.1:8888
Callback:
- http://127.0.0.1:8888/callback

## Setup
1) Create a Spotify Developer App and add this Redirect URI exactly:
   http://127.0.0.1:8888/callback

2) Copy `.env.example` to `.env` and set:
   VITE_SPOTIFY_CLIENT_ID=...

3) Install and run:
   npm install
   npm run dev

## Notes
- Spotify Web Playback SDK requires Spotify Premium.
- Token refresh is included if Spotify returns a refresh_token.
