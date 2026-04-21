# Traffic Visualization (Assignment 2)

This project visualizes incoming traffic packets on a 3D Earth globe and adds real-time analytics.

It implements all required assignment parts:
1. A Python sender that reads CSV and replays packets by original timestamps.
2. A Flask backend that receives, processes, and streams traffic data.
3. A Three.js frontend for map/globe visualization with interactive analytics.
4. Full Docker Compose deployment for one-command startup.

## What Happens in the System

1. `sender/sender.py` reads `data/ip_addresses.csv`.
2. It sends packets to backend endpoint `GET /api/ingest` in original order and timing.
3. The backend stores a rolling in-memory window of events and computes analytics.
4. The frontend listens to live updates via SSE (`/api/stream`) and draws points on the globe.
5. Additional charts are updated continuously from `/api/stats`.

Data flow:

`CSV dataset -> Sender -> Flask backend -> SSE/Stats API -> Three.js UI`

## Features

### Globe and Traffic
- Realistic Earth globe (texture, normal map, clouds).
- Live packet points by latitude/longitude.
- Suspicious packets highlighted separately.
- Adjustable point lifetime (to avoid instant pop/disappear behavior).
- Manual globe rotation/zoom (no auto-rotation).

### Analytics and Interaction
- Top locations list (real-time, by selected time window).
- Packets-per-second activity chart.
- Suspicious share donut chart.
- Latitude distribution bar chart.
- Clickable latitude bars to filter visible points on the globe.
- Analytics window switcher: `30s / 60s / 120s / 300s`.
- Pause/Resume drawing toggle.

## Assignment Requirements Coverage

- **World map or globe**: Implemented with Three.js globe.
- **Real dataset picture**: Visualization is driven by actual CSV packet data.
- **At least two interactions**: Multiple interactions included (filters, pause, window switch, chart click-filter, orbit controls).
- **Additional plots**: Activity, suspicious share, and latitude distribution charts.
- **Points should not instantly pop/disappear**: Adjustable lifetime and fade behavior.
- **Avoid overwhelming visualization**: Controlled retention and filtering controls.

## Project Structure

```text
.
├── backend
│   ├── app.py
│   ├── Dockerfile
│   └── requirements.txt
├── data
│   └── ip_addresses.csv
├── frontend
│   ├── app.js
│   ├── assets/
│   ├── Dockerfile
│   ├── index.html
│   └── style.css
├── sender
│   ├── Dockerfile
│   ├── requirements.txt
│   └── sender.py
└── docker-compose.yml
```

## Prerequisites

- Docker Desktop (or Docker Engine + Docker Compose plugin)

## Run (Recommended)

From project root:

```bash
docker compose up -d --build backend frontend
docker compose run --rm sender python sender.py --csv /data/ip_addresses.csv --endpoint http://backend:5000/api/ingest --speed-factor 10
```

Open:
- Frontend: `http://localhost:8080`
- Backend health: `http://localhost:5001/health`

Notes:
- Backend is mapped to host port `5001` (to avoid conflict with common `5000` usage).
- `--speed-factor 10` replays data faster than real time for demos.  
  Use `--speed-factor 1.0` for exact timing behavior.

## Useful Commands

Start backend + frontend only:

```bash
docker compose up -d --build backend frontend
```

Replay traffic again:

```bash
docker compose run --rm sender python sender.py --csv /data/ip_addresses.csv --endpoint http://backend:5000/api/ingest --speed-factor 10
```

View logs:

```bash
docker compose logs -f backend frontend
```

Stop everything:

```bash
docker compose down
```

## API Endpoints (Backend)

- `GET /health`  
  Basic health check.

- `GET /api/ingest`  
  Receives a packet (`ip`, `lat`, `lng`, `timestamp`, `suspicious`).

- `GET /api/stream`  
  Server-Sent Events (SSE) stream for live packets.

- `GET /api/stats?window_sec=<N>`  
  Aggregated analytics for selected rolling window.

## For Instructors

This solution is deterministic, reproducible via Docker, and directly tied to the provided dataset.  
All visual and analytic behavior in the UI is generated from received packet data, not mock values.
