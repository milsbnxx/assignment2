import argparse
import csv
import time
from pathlib import Path
from typing import Dict, List

import requests


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Replay packet CSV to Flask backend.")
    parser.add_argument("--csv", default="/data/ip_addresses.csv", help="Path to CSV file")
    parser.add_argument(
        "--endpoint",
        default="http://backend:5000/api/ingest",
        help="Flask ingest endpoint",
    )
    parser.add_argument(
        "--speed-factor",
        type=float,
        default=1.0,
        help="Replay speed multiplier (1.0 = real intervals, 2.0 = 2x faster).",
    )
    parser.add_argument(
        "--loop",
        action="store_true",
        help="Loop dataset indefinitely after reaching the end.",
    )
    parser.add_argument(
        "--request-timeout",
        type=float,
        default=5.0,
        help="Timeout in seconds for a single request.",
    )
    return parser.parse_args()


def load_packets(csv_path: Path) -> List[Dict]:
    packets = []
    with csv_path.open("r", newline="", encoding="utf-8") as file_obj:
        reader = csv.DictReader(file_obj)
        for index, row in enumerate(reader):
            packet = {
                "ip": row["ip address"].strip(),
                "lat": float(row["Latitude"]),
                "lng": float(row["Longitude"]),
                "timestamp": int(float(row["Timestamp"])),
                "suspicious": int(float(row["suspicious"])) if row["suspicious"] else 0,
                "order": index,
            }
            packets.append(packet)

    packets.sort(key=lambda item: (item["timestamp"], item["order"]))
    return packets


def replay_once(
    packets: List[Dict], endpoint: str, speed_factor: float, request_timeout: float
) -> None:
    session = requests.Session()
    previous_ts = None

    for idx, packet in enumerate(packets, start=1):
        if previous_ts is not None:
            original_delay = packet["timestamp"] - previous_ts
            delay = max(0.0, original_delay / speed_factor)
            if delay > 0:
                time.sleep(delay)

        payload = {
            "ip": packet["ip"],
            "lat": packet["lat"],
            "lng": packet["lng"],
            "timestamp": packet["timestamp"],
            "suspicious": packet["suspicious"],
        }

        success = False
        for attempt in range(3):
            try:
                response = session.get(endpoint, params=payload, timeout=request_timeout)
                response.raise_for_status()
                success = True
                break
            except requests.RequestException as exc:
                print(f"[WARN] packet {idx} send failed (attempt {attempt + 1}/3): {exc}")
                time.sleep(0.5 * (attempt + 1))

        if not success:
            print(f"[ERROR] packet {idx} dropped after 3 attempts")

        if idx % 200 == 0 or idx == len(packets):
            print(f"[INFO] sent {idx}/{len(packets)} packets")

        previous_ts = packet["timestamp"]


def main() -> None:
    args = parse_args()

    if args.speed_factor <= 0:
        raise ValueError("--speed-factor must be > 0")

    csv_path = Path(args.csv)
    if not csv_path.exists():
        raise FileNotFoundError(f"CSV not found: {csv_path}")

    packets = load_packets(csv_path)
    print(f"[INFO] loaded {len(packets)} packets from {csv_path}")
    print(f"[INFO] endpoint={args.endpoint}, speed_factor={args.speed_factor}")

    run = 0
    while True:
        run += 1
        print(f"[INFO] replay run #{run} started")
        replay_once(
            packets=packets,
            endpoint=args.endpoint,
            speed_factor=args.speed_factor,
            request_timeout=args.request_timeout,
        )
        print(f"[INFO] replay run #{run} finished")
        if not args.loop:
            break


if __name__ == "__main__":
    main()
