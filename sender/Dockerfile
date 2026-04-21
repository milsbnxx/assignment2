FROM python:3.11-slim

WORKDIR /app

COPY sender/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY sender/sender.py /app/sender.py
COPY data/ip_addresses.csv /data/ip_addresses.csv

CMD ["python", "sender.py", "--csv", "/data/ip_addresses.csv", "--endpoint", "http://backend:5000/api/ingest", "--speed-factor", "1.0"]
