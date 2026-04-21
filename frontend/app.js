import * as THREE from "./vendor/three.module.js";
import { OrbitControls } from "./vendor/OrbitControls.js";

const API_BASE = `${window.location.protocol}//${window.location.hostname}:5001`;
const sceneContainer = document.getElementById("sceneContainer");

const totalCountEl = document.getElementById("totalCount");
const suspiciousCountEl = document.getElementById("suspiciousCount");
const ratioCountEl = document.getElementById("ratioCount");
const lastPacketEl = document.getElementById("lastPacket");
const topLocationsListEl = document.getElementById("topLocationsList");
const topLocationsTitleEl = document.getElementById("topLocationsTitle");
const activityTitleEl = document.getElementById("activityTitle");
const latFilterStateEl = document.getElementById("latFilterState");

const pauseBtn = document.getElementById("pauseBtn");
const suspiciousOnlyCheckbox = document.getElementById("suspiciousOnly");
const lifetimeSlider = document.getElementById("lifetimeSlider");
const lifetimeValue = document.getElementById("lifetimeValue");
const windowButtons = Array.from(document.querySelectorAll(".windowBtn"));

const chartCanvas = document.getElementById("activityChart");
const chartCtx = chartCanvas.getContext("2d");
const suspiciousChartCanvas = document.getElementById("suspiciousChart");
const suspiciousChartCtx = suspiciousChartCanvas.getContext("2d");
const latitudeChartCanvas = document.getElementById("latitudeChart");
const latitudeChartCtx = latitudeChartCanvas.getContext("2d");

let isPaused = false;
let suspiciousOnly = false;
let pointLifetimeMs = Number(lifetimeSlider.value) * 1000;
let statsWindowSec = 30;
let selectedLatBand = null;
let latBarHitboxes = [];

const points = [];
const MAX_POINTS = 8000;
const EARTH_RADIUS = 5;
const LAT_BANDS = [
  { id: "-90..-60", start: -90, end: -60 },
  { id: "-60..-30", start: -60, end: -30 },
  { id: "-30..0", start: -30, end: 0 },
  { id: "0..30", start: 0, end: 30 },
  { id: "30..60", start: 30, end: 60 },
  { id: "60..90", start: 60, end: 90 },
];

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x03080e, 20, 50);

const camera = new THREE.PerspectiveCamera(
  50,
  sceneContainer.clientWidth / sceneContainer.clientHeight,
  0.1,
  1000
);
camera.position.set(0, 7, 14);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(sceneContainer.clientWidth, sceneContainer.clientHeight);
sceneContainer.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.enablePan = false;
controls.minDistance = 8;
controls.maxDistance = 24;

const ambientLight = new THREE.AmbientLight(0x78b6ff, 0.6);
scene.add(ambientLight);

const keyLight = new THREE.DirectionalLight(0xffffff, 1.2);
keyLight.position.set(7, 8, 6);
scene.add(keyLight);

const globeGroup = new THREE.Group();
scene.add(globeGroup);

const earthGeometry = new THREE.SphereGeometry(EARTH_RADIUS, 64, 64);
const textureLoader = new THREE.TextureLoader();
const earthMaterial = new THREE.MeshPhongMaterial({
  map: textureLoader.load("./assets/earth_atmos_2048.jpg"),
  normalMap: textureLoader.load("./assets/earth_normal_2048.jpg"),
  specularMap: textureLoader.load("./assets/earth_specular_2048.jpg"),
  specular: new THREE.Color(0x333333),
  shininess: 14,
});
const earthMesh = new THREE.Mesh(earthGeometry, earthMaterial);
globeGroup.add(earthMesh);

const cloudMesh = new THREE.Mesh(
  new THREE.SphereGeometry(EARTH_RADIUS * 1.012, 64, 64),
  new THREE.MeshPhongMaterial({
    map: textureLoader.load("./assets/earth_clouds_1024.png"),
    transparent: true,
    opacity: 0.36,
    depthWrite: false,
  })
);
globeGroup.add(cloudMesh);

const atmosphere = new THREE.Mesh(
  new THREE.SphereGeometry(EARTH_RADIUS * 1.03, 48, 48),
  new THREE.MeshBasicMaterial({
    color: 0x2ea8ff,
    transparent: true,
    opacity: 0.08,
    side: THREE.BackSide,
  })
);
globeGroup.add(atmosphere);

const normalPointMaterial = new THREE.MeshBasicMaterial({
  color: 0x4dd4ff,
  transparent: true,
  opacity: 0.95,
});
const suspiciousPointMaterial = new THREE.MeshBasicMaterial({
  color: 0xff6b42,
  transparent: true,
  opacity: 1.0,
});
const pointGeometry = new THREE.SphereGeometry(0.05, 8, 8);

function latLngToVector3(lat, lng, radius) {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lng + 180) * (Math.PI / 180);
  const x = -(radius * Math.sin(phi) * Math.cos(theta));
  const z = radius * Math.sin(phi) * Math.sin(theta);
  const y = radius * Math.cos(phi);
  return new THREE.Vector3(x, y, z);
}

function enforcePointCap() {
  while (points.length > MAX_POINTS) {
    const expired = points.shift();
    scene.remove(expired.mesh);
  }
}

function isPointInSelectedBand(lat) {
  if (!selectedLatBand) {
    return true;
  }
  const isLastBand = selectedLatBand.end === 90;
  return (
    (lat >= selectedLatBand.start && lat < selectedLatBand.end) ||
    (isLastBand && lat <= selectedLatBand.end)
  );
}

function formatLatBand(band) {
  const startAbs = Math.abs(band.start);
  const endAbs = Math.abs(band.end);
  const hemi = band.end <= 0 ? "S" : band.start >= 0 ? "N" : "EQ";
  if (hemi === "EQ") {
    return `${startAbs} to ${endAbs}`;
  }
  return `${startAbs}° to ${endAbs}° ${hemi}`;
}

function applyVisibilityFilter() {
  for (const point of points) {
    const suspiciousOk = !suspiciousOnly || point.suspicious === 1;
    const latOk = isPointInSelectedBand(point.lat);
    point.mesh.visible = suspiciousOk && latOk;
  }
}

function addPoint(packet) {
  if (isPaused) {
    return;
  }

  const material = packet.suspicious ? suspiciousPointMaterial : normalPointMaterial;
  const mesh = new THREE.Mesh(pointGeometry, material.clone());
  mesh.position.copy(latLngToVector3(packet.lat, packet.lng, EARTH_RADIUS + 0.04));
  scene.add(mesh);

  const point = {
    mesh,
    createdAt: performance.now(),
    suspicious: packet.suspicious ? 1 : 0,
    lat: packet.lat,
  };

  points.push(point);
  enforcePointCap();
  applyVisibilityFilter();
}

function cleanupOldPoints(now) {
  for (let i = points.length - 1; i >= 0; i -= 1) {
    const point = points[i];
    const age = now - point.createdAt;
    if (age > pointLifetimeMs) {
      scene.remove(point.mesh);
      points.splice(i, 1);
      continue;
    }
    const alpha = Math.max(0, 1 - age / pointLifetimeMs);
    point.mesh.material.opacity = alpha;
  }
}

function updateTopLocations(locations, hotspots, windowSeconds) {
  topLocationsTitleEl.textContent = `Top Locations (Last ${windowSeconds}s)`;
  topLocationsListEl.innerHTML = "";
  if (!locations.length && !hotspots.length) {
    const li = document.createElement("li");
    li.textContent = "Waiting for incoming data...";
    topLocationsListEl.appendChild(li);
    return;
  }

  for (const item of locations) {
    const li = document.createElement("li");
    li.textContent = `(${item.lat.toFixed(1)}, ${item.lng.toFixed(1)}) - ${item.count}`;
    topLocationsListEl.appendChild(li);
  }

  for (const hotspot of hotspots) {
    const li = document.createElement("li");
    li.textContent = `Grid ${hotspot.cell} - ${hotspot.count}`;
    topLocationsListEl.appendChild(li);
  }
}

function drawActivityChart(series, windowSeconds) {
  activityTitleEl.textContent = `Activity (packets/sec, Last ${windowSeconds}s)`;
  const width = chartCanvas.width;
  const height = chartCanvas.height;
  chartCtx.clearRect(0, 0, width, height);

  chartCtx.fillStyle = "#05131f";
  chartCtx.fillRect(0, 0, width, height);

  const maxValue = Math.max(1, ...series.map((p) => p.count));
  const pad = 10;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;

  chartCtx.strokeStyle = "rgba(110, 180, 230, 0.25)";
  chartCtx.lineWidth = 1;
  chartCtx.beginPath();
  for (let i = 0; i <= 4; i += 1) {
    const y = pad + (innerH / 4) * i;
    chartCtx.moveTo(pad, y);
    chartCtx.lineTo(width - pad, y);
  }
  chartCtx.stroke();

  chartCtx.strokeStyle = "#3db8ff";
  chartCtx.lineWidth = 2;
  chartCtx.beginPath();
  series.forEach((point, index) => {
    const x = pad + (innerW * index) / Math.max(series.length - 1, 1);
    const y = pad + innerH - (point.count / maxValue) * innerH;
    if (index === 0) {
      chartCtx.moveTo(x, y);
    } else {
      chartCtx.lineTo(x, y);
    }
  });
  chartCtx.stroke();
}

function drawSuspiciousChart(distribution) {
  const width = suspiciousChartCanvas.width;
  const height = suspiciousChartCanvas.height;
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) * 0.32;

  suspiciousChartCtx.clearRect(0, 0, width, height);
  suspiciousChartCtx.fillStyle = "#05131f";
  suspiciousChartCtx.fillRect(0, 0, width, height);

  const suspicious = distribution?.suspicious ?? 0;
  const normal = distribution?.normal ?? 0;
  const total = suspicious + normal;

  if (!total) {
    suspiciousChartCtx.fillStyle = "#8cb2d1";
    suspiciousChartCtx.font = "14px Space Grotesk";
    suspiciousChartCtx.textAlign = "center";
    suspiciousChartCtx.fillText("No data yet", cx, cy);
    return;
  }

  const suspiciousRatio = suspicious / total;
  let start = -Math.PI / 2;
  const slices = [
    { value: normal, color: "#3db8ff" },
    { value: suspicious, color: "#ff6b42" },
  ];

  for (const slice of slices) {
    const angle = (slice.value / total) * Math.PI * 2;
    suspiciousChartCtx.beginPath();
    suspiciousChartCtx.moveTo(cx, cy);
    suspiciousChartCtx.arc(cx, cy, radius, start, start + angle);
    suspiciousChartCtx.closePath();
    suspiciousChartCtx.fillStyle = slice.color;
    suspiciousChartCtx.fill();
    start += angle;
  }

  suspiciousChartCtx.beginPath();
  suspiciousChartCtx.fillStyle = "#05131f";
  suspiciousChartCtx.arc(cx, cy, radius * 0.55, 0, Math.PI * 2);
  suspiciousChartCtx.fill();

  suspiciousChartCtx.fillStyle = "#d5ebff";
  suspiciousChartCtx.font = "700 14px Space Grotesk";
  suspiciousChartCtx.textAlign = "center";
  suspiciousChartCtx.fillText(`${(suspiciousRatio * 100).toFixed(1)}%`, cx, cy - 2);
  suspiciousChartCtx.fillStyle = "#8cb2d1";
  suspiciousChartCtx.font = "12px Space Grotesk";
  suspiciousChartCtx.fillText("suspicious", cx, cy + 14);

  suspiciousChartCtx.textAlign = "left";
  suspiciousChartCtx.fillStyle = "#3db8ff";
  suspiciousChartCtx.fillRect(12, height - 28, 12, 12);
  suspiciousChartCtx.fillStyle = "#a8cbe8";
  suspiciousChartCtx.fillText(`Normal: ${normal}`, 30, height - 17);
  suspiciousChartCtx.fillStyle = "#ff6b42";
  suspiciousChartCtx.fillRect(width / 2 + 8, height - 28, 12, 12);
  suspiciousChartCtx.fillStyle = "#a8cbe8";
  suspiciousChartCtx.fillText(`Suspicious: ${suspicious}`, width / 2 + 26, height - 17);
}

function drawLatitudeChart(distribution) {
  const width = latitudeChartCanvas.width;
  const height = latitudeChartCanvas.height;
  latitudeChartCtx.clearRect(0, 0, width, height);
  latitudeChartCtx.fillStyle = "#05131f";
  latitudeChartCtx.fillRect(0, 0, width, height);

  const bars = distribution?.length
    ? distribution
    : LAT_BANDS.map((b) => ({ band: b.id, start: b.start, end: b.end, count: 0 }));
  const maxValue = Math.max(1, ...bars.map((item) => item.count));
  const padX = 14;
  const padY = 14;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2 - 20;
  const barW = innerW / bars.length - 8;
  latBarHitboxes = [];

  bars.forEach((item, index) => {
    const x = padX + index * (barW + 8);
    const h = (item.count / maxValue) * innerH;
    const y = padY + (innerH - h);
    const active = selectedLatBand && selectedLatBand.id === item.band;
    latitudeChartCtx.fillStyle = active ? "#ff9b66" : "#3db8ff";
    latitudeChartCtx.fillRect(x, y, barW, h || 2);

    latitudeChartCtx.fillStyle = "#8cb2d1";
    latitudeChartCtx.font = "11px Space Grotesk";
    latitudeChartCtx.textAlign = "center";
    const start = item.start ?? Number(item.band.split("..")[0]);
    const end = item.end ?? Number(item.band.split("..")[1]);
    const startLabel = start === 0 ? "EQ" : `${Math.abs(start)}${start < 0 ? "S" : "N"}`;
    const endLabel = end === 0 ? "EQ" : `${Math.abs(end)}${end < 0 ? "S" : "N"}`;
    const shortLabel = `${startLabel}/${endLabel}`;
    latitudeChartCtx.fillText(shortLabel, x + barW / 2, height - 8);
    latBarHitboxes.push({ x, y: padY, w: barW, h: innerH, band: item.band });
  });
}

async function fetchStats() {
  try {
    const response = await fetch(`${API_BASE}/api/stats?window_sec=${statsWindowSec}`);
    if (!response.ok) {
      return;
    }

    const stats = await response.json();
    const usedWindowSec = stats.window_seconds || statsWindowSec;
    totalCountEl.textContent = String(stats.total_packets);
    suspiciousCountEl.textContent = String(stats.suspicious_packets);
    ratioCountEl.textContent = `${stats.suspicious_ratio_percent}%`;
    updateTopLocations(stats.top_locations || [], stats.hotspot_cells || [], usedWindowSec);
    drawActivityChart(stats.packets_per_second || [], usedWindowSec);
    drawSuspiciousChart(stats.suspicious_distribution || { normal: 0, suspicious: 0 });
    drawLatitudeChart(stats.lat_band_distribution || []);
  } catch (_err) {
    // Keep UI running even if backend is restarting.
  }
}

function connectStream() {
  const source = new EventSource(`${API_BASE}/api/stream`);

  source.onmessage = (event) => {
    const packet = JSON.parse(event.data);
    addPoint(packet);
    lastPacketEl.textContent = new Date(packet.server_received_ts * 1000).toLocaleTimeString();
  };

  source.onerror = () => {
    source.close();
    setTimeout(connectStream, 2000);
  };
}

function updateLatFilterLabel() {
  if (!selectedLatBand) {
    latFilterStateEl.textContent = "Filter: all zones";
    return;
  }
  latFilterStateEl.textContent = `Filter: ${formatLatBand(selectedLatBand)}`;
}

function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  cleanupOldPoints(now);
  controls.update();
  renderer.render(scene, camera);
}

pauseBtn.addEventListener("click", () => {
  isPaused = !isPaused;
  pauseBtn.textContent = isPaused ? "Resume Drawing" : "Pause Drawing";
});

suspiciousOnlyCheckbox.addEventListener("change", (event) => {
  suspiciousOnly = event.target.checked;
  applyVisibilityFilter();
});

lifetimeSlider.addEventListener("input", (event) => {
  const nextValue = Number(event.target.value);
  pointLifetimeMs = nextValue * 1000;
  lifetimeValue.textContent = String(nextValue);
});

windowButtons.forEach((button) => {
  button.addEventListener("click", () => {
    statsWindowSec = Number(button.dataset.window || "60");
    windowButtons.forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    fetchStats();
  });
});

latitudeChartCanvas.addEventListener("click", (event) => {
  const rect = latitudeChartCanvas.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * latitudeChartCanvas.width;
  const y = ((event.clientY - rect.top) / rect.height) * latitudeChartCanvas.height;

  const clicked = latBarHitboxes.find(
    (hitbox) => x >= hitbox.x && x <= hitbox.x + hitbox.w && y >= hitbox.y && y <= hitbox.y + hitbox.h
  );
  if (!clicked) {
    return;
  }

  if (selectedLatBand && selectedLatBand.id === clicked.band) {
    selectedLatBand = null;
  } else {
    selectedLatBand = LAT_BANDS.find((band) => band.id === clicked.band) || null;
  }

  updateLatFilterLabel();
  applyVisibilityFilter();
  fetchStats();
});

window.addEventListener("resize", () => {
  const width = sceneContainer.clientWidth;
  const height = sceneContainer.clientHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
});

connectStream();
updateLatFilterLabel();
fetchStats();
setInterval(fetchStats, 2000);
animate();
