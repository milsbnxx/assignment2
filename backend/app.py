import json
import math
import os
import time
from collections import Counter, deque
from datetime import datetime, timezone
from queue import Empty, Full, Queue
from threading import Lock
from typing import Any, Dict, List

from flask import Flask, Response, jsonify, request, stream_with_context

app = Flask(__name__)

RETENTION_SECONDS = int(os.getenv("RETENTION_SECONDS", "300"))
TOP_WINDOW_SECONDS = int(os.getenv("TOP_WINDOW_SECONDS", "60"))
SSE_KEEPALIVE_SECONDS = int(os.getenv("SSE_KEEPALIVE_SECONDS", "15"))
MIN_WINDOW_SECONDS = 10

_events: deque[Dict[str, Any]] = deque()
_subscribers: List[Queue] = []
_stats = {"total_packets": 0, "suspicious_packets": 0}
_lock = Lock()


def _to_float(value: Any, field: str) -> float:
    try:
        return float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"Invalid '{field}' value: {value}") from exc


def _to_int(value: Any, field: str) -> int:
    try:
        return int(float(value))
    except (TypeError, ValueError) as exc:
        raise ValueError(f"Invalid '{field}' value: {value}") from exc


def _normalize_packet(raw: Dict[str, Any]) -> Dict[str, Any]:
    ip = str(raw.get("ip", "")).strip()
    if not ip:
        raise ValueError("Missing required field: ip")

    lat = _to_float(raw.get("lat"), "lat")
    lng = _to_float(raw.get("lng"), "lng")
    timestamp = _to_int(raw.get("timestamp"), "timestamp")
    suspicious = 1 if _to_int(raw.get("suspicious", 0), "suspicious") else 0

    event_time_iso = datetime.fromtimestamp(timestamp, tz=timezone.utc).isoformat()
    return {
        "ip": ip,
        "lat": lat,
        "lng": lng,
        "timestamp": timestamp,
        "event_time_iso": event_time_iso,
        "suspicious": suspicious,
    }


def _prune_old_events(now_ts: float) -> None:
    while _events and (now_ts - _events[0]["server_received_ts"]) > RETENTION_SECONDS:
        _events.popleft()


def _publish_to_subscribers(packet: Dict[str, Any]) -> None:
    stale = []
    for queue_obj in _subscribers:
        try:
            queue_obj.put_nowait(packet)
        except Full:
            stale.append(queue_obj)
    for queue_obj in stale:
        if queue_obj in _subscribers:
            _subscribers.remove(queue_obj)


def _location_key(lat: float, lng: float) -> str:
    return f"{lat:.1f},{lng:.1f}"


def _resolve_window_seconds(raw_value: str | None) -> int:
    if raw_value is None:
        return TOP_WINDOW_SECONDS
    try:
        requested = int(raw_value)
    except ValueError:
        return TOP_WINDOW_SECONDS
    return max(MIN_WINDOW_SECONDS, min(requested, RETENTION_SECONDS))


@app.after_request
def add_cors_headers(response: Response) -> Response:
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return response


@app.get("/health")
def health() -> Response:
    return jsonify({"status": "ok"})


@app.get("/api/ingest")
def ingest() -> Response:
    raw_payload = dict(request.args)
    if not raw_payload and request.is_json:
        raw_payload = request.get_json(silent=True) or {}

    try:
        packet = _normalize_packet(raw_payload)
    except ValueError as err:
        return jsonify({"status": "error", "message": str(err)}), 400

    now_ts = time.time()
    packet["server_received_ts"] = now_ts
    packet["server_received_iso"] = datetime.fromtimestamp(
        now_ts, tz=timezone.utc
    ).isoformat()

    with _lock:
        _stats["total_packets"] += 1
        _stats["suspicious_packets"] += packet["suspicious"]
        _events.append(packet)
        _prune_old_events(now_ts)
        _publish_to_subscribers(packet)
        total_packets = _stats["total_packets"]

    return jsonify({"status": "ok", "packet_number": total_packets})


@app.get("/api/stats")
def stats() -> Response:
    now_ts = time.time()
    window_seconds = _resolve_window_seconds(request.args.get("window_sec"))

    with _lock:
        _prune_old_events(now_ts)
        recent_window = [
            event
            for event in _events
            if (now_ts - event["server_received_ts"]) <= window_seconds
        ]

        location_counter = Counter(
            _location_key(event["lat"], event["lng"]) for event in recent_window
        )
        top_locations = []
        for key, count in location_counter.most_common(5):
            lat, lng = key.split(",")
            top_locations.append(
                {
                    "lat": float(lat),
                    "lng": float(lng),
                    "count": count,
                }
            )

        second_counter = Counter(int(event["server_received_ts"]) for event in recent_window)
        packets_per_second = [
            {"second": second, "count": second_counter.get(second, 0)}
            for second in range(int(now_ts) - window_seconds + 1, int(now_ts) + 1)
        ]

        suspicious_in_window = sum(event["suspicious"] for event in recent_window)
        normal_in_window = len(recent_window) - suspicious_in_window

        lat_band_ranges = [(-90, -60), (-60, -30), (-30, 0), (0, 30), (30, 60), (60, 90)]
        lat_band_counter: Counter[str] = Counter()
        for event in recent_window:
            lat = event["lat"]
            for start, end in lat_band_ranges:
                upper_inclusive = end == 90
                if start <= lat < end or (upper_inclusive and start <= lat <= end):
                    lat_band_counter[f"{start}..{end}"] += 1
                    break

        lat_band_distribution = [
            {
                "band": f"{start}..{end}",
                "start": start,
                "end": end,
                "count": lat_band_counter.get(f"{start}..{end}", 0),
            }
            for start, end in lat_band_ranges
        ]

        grid_step = 15
        hotspot_counter: Counter[str] = Counter()
        for event in recent_window:
            lat_cell = math.floor(event["lat"] / grid_step) * grid_step
            lng_cell = math.floor(event["lng"] / grid_step) * grid_step
            hotspot_counter[f"{lat_cell},{lng_cell}"] += 1

        hotspot_cells = []
        for key, count in hotspot_counter.most_common(6):
            lat_cell, lng_cell = key.split(",")
            lat_cell_value = int(lat_cell)
            lng_cell_value = int(lng_cell)
            hotspot_cells.append(
                {
                    "lat_center": lat_cell_value + grid_step / 2,
                    "lng_center": lng_cell_value + grid_step / 2,
                    "count": count,
                    "cell": f"{lat_cell_value}..{lat_cell_value + grid_step},"
                    f"{lng_cell_value}..{lng_cell_value + grid_step}",
                }
            )

        total_packets = _stats["total_packets"]
        suspicious_packets = _stats["suspicious_packets"]

    suspicious_ratio = (
        round((suspicious_packets / total_packets) * 100, 2) if total_packets else 0.0
    )

    return jsonify(
        {
            "total_packets": total_packets,
            "suspicious_packets": suspicious_packets,
            "suspicious_ratio_percent": suspicious_ratio,
            "buffer_size": len(recent_window),
            "window_seconds": window_seconds,
            "top_locations": top_locations,
            "packets_per_second": packets_per_second,
            "suspicious_distribution": {
                "normal": normal_in_window,
                "suspicious": suspicious_in_window,
            },
            "lat_band_distribution": lat_band_distribution,
            "hotspot_cells": hotspot_cells,
        }
    )


@app.get("/api/stream")
def stream() -> Response:
    queue_obj: Queue = Queue(maxsize=2000)
    with _lock:
        _subscribers.append(queue_obj)

    def event_stream():
        yield "retry: 2000\n\n"
        try:
            while True:
                try:
                    packet = queue_obj.get(timeout=SSE_KEEPALIVE_SECONDS)
                    data = json.dumps(packet, separators=(",", ":"))
                    yield f"data: {data}\n\n"
                except Empty:
                    yield ": keepalive\n\n"
        finally:
            with _lock:
                if queue_obj in _subscribers:
                    _subscribers.remove(queue_obj)

    return Response(
        stream_with_context(event_stream()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


if __name__ == "__main__":
    port = int(os.getenv("PORT", "5000"))
    app.run(host="0.0.0.0", port=port, threaded=True)
