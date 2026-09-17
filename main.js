/* Experimental browser port of the classic DOOM data flow. */
"use strict";

const canvas = document.getElementById("game-canvas");
const ctx = canvas.getContext("2d");
const statusNode = document.getElementById("status");
const mapNode = document.getElementById("map-name");
const messageNode = document.getElementById("screen-message");
const input = { forward: 0, turn: 0 };
const TAU = Math.PI * 2;
const FIXED_TIC = 1 / 35;

const game = {
  wad: null,
  map: null,
  running: false,
  lastTime: 0,
  accumulator: 0,
  player: { x: 0, y: 0, angle: 0 },
  demo: [
    { x1: -320, y1: -220, x2: 320, y2: -220 },
    { x1: 320, y1: -220, x2: 320, y2: 220 },
    { x1: 320, y1: 220, x2: -320, y2: 220 },
    { x1: -320, y1: 220, x2: -320, y2: -220 },
    { x1: -160, y1: -220, x2: -160, y2: 40 },
    { x1: -160, y1: 40, x2: 80, y2: 40 },
    { x1: 80, y1: 40, x2: 80, y2: 220 }
  ]
};

function readI16(view, offset) { return view.getInt16(offset, true); }
function readU32(view, offset) { return view.getUint32(offset, true); }
function lumpName(bytes) {
  return new TextDecoder("ascii").decode(bytes).replace(/\0/g, "").trim().toUpperCase();
}

function parseWad(buffer) {
  const view = new DataView(buffer);
  if (view.byteLength < 12) throw new Error("El archivo es demasiado pequeño para ser un WAD.");
  const kind = new TextDecoder("ascii").decode(new Uint8Array(buffer, 0, 4));
  if (kind !== "IWAD" && kind !== "PWAD") throw new Error("El archivo no tiene una cabecera IWAD o PWAD.");
  const count = readU32(view, 4);
  const directoryOffset = readU32(view, 8);
  if (directoryOffset + count * 16 > view.byteLength) throw new Error("El directorio del WAD está incompleto.");
  const lumps = new Map();
  for (let i = 0; i < count; i += 1) {
    const offset = directoryOffset + i * 16;
    const filePos = readU32(view, offset);
    const size = readU32(view, offset + 4);
    const name = lumpName(new Uint8Array(buffer, offset + 8, 8));
    if (filePos + size > view.byteLength) continue;
    lumps.set(name, new Uint8Array(buffer, filePos, size));
  }
  return { kind, lumps };
}

function findMap(lumps) {
  const marker = [...lumps.keys()].find((name) => /^E[1-4]M[1-9]$/.test(name) || /^MAP\d\d$/.test(name));
  if (!marker) throw new Error("No se encontró un marcador de mapa (E1M1 o MAP01).");
  const vertices = lumps.get("VERTEXES");
  const linedefs = lumps.get("LINEDEFS");
  if (!vertices || !linedefs || vertices.length < 4 || linedefs.length < 14) {
    throw new Error(`${marker} no tiene VERTEXES o LINEDEFS utilizables.`);
  }
  const vertexView = new DataView(vertices.buffer, vertices.byteOffset, vertices.byteLength);
  const vertexList = [];
  for (let i = 0; i + 3 < vertices.length; i += 4) {
    vertexList.push({ x: readI16(vertexView, i), y: readI16(vertexView, i + 2) });
  }
  const lineView = new DataView(linedefs.buffer, linedefs.byteOffset, linedefs.byteLength);
  const walls = [];
  for (let i = 0; i + 13 < linedefs.length; i += 14) {
    const start = readI16(lineView, i);
    const end = readI16(lineView, i + 2);
    if (vertexList[start] && vertexList[end]) {
      walls.push({ x1: vertexList[start].x, y1: vertexList[start].y, x2: vertexList[end].x, y2: vertexList[end].y });
    }
  }
  const player = readPlayerSpawn(lumps.get("THINGS"));
  return { name: marker, walls, player };
}

function readPlayerSpawn(bytes) {
  if (!bytes) return { x: 0, y: 0, angle: 0 };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i + 9 < bytes.length; i += 10) {
    if (readI16(view, i + 6) === 1) {
      return { x: readI16(view, i), y: readI16(view, i + 2), angle: readI16(view, i + 4) * Math.PI / 180 };
    }
  }
  return { x: 0, y: 0, angle: 0 };
}

function setStatus(text, error = false) {
  statusNode.textContent = text;
  statusNode.style.color = error ? "#e36a4e" : "";
}

function startWorld(map, label) {
  game.map = map;
  game.player = { ...map.player };
  game.running = true;
  game.lastTime = performance.now();
  game.accumulator = 0;
  mapNode.textContent = label;
  messageNode.classList.add("hidden");
  setStatus("Motor activo · 35 tics por segundo");
  requestAnimationFrame(frame);
}

function startDemo() {
  startWorld({ name: "DEMO", walls: game.demo, player: { x: 0, y: 0, angle: 0 } }, "DEMO");
}

function update(tics) {
  const speed = 5 * tics;
  const angle = game.player.angle + input.turn * 0.055 * tics;
  game.player.angle = (angle + TAU) % TAU;
  game.player.x += Math.cos(angle) * input.forward * speed;
  game.player.y += Math.sin(angle) * input.forward * speed;
}

function projectWall(wall) {
  const p = game.player;
  const fov = Math.PI / 2.7;
  const near = 8;
  const transform = (x, y) => {
    const dx = x - p.x;
    const dy = y - p.y;
    return { depth: dx * Math.cos(p.angle) + dy * Math.sin(p.angle), side: -dx * Math.sin(p.angle) + dy * Math.cos(p.angle) };
  };
  let a = transform(wall.x1, wall.y1);
  let b = transform(wall.x2, wall.y2);
  if (a.depth < near && b.depth < near) return null;
  if (a.depth < near) a = clip(a, b, near);
  if (b.depth < near) b = clip(b, a, near);
  const focal = canvas.width / (2 * Math.tan(fov / 2));
  return {
    x1: canvas.width / 2 + a.side * focal / a.depth,
    x2: canvas.width / 2 + b.side * focal / b.depth,
    d1: a.depth, d2: b.depth
  };
}

function clip(a, b, near) {
  const ratio = (near - a.depth) / (b.depth - a.depth);
  return { depth: near, side: a.side + (b.side - a.side) * ratio };
}

function render() {
  ctx.fillStyle = "#171b24";
  ctx.fillRect(0, 0, canvas.width, canvas.height / 2);
  ctx.fillStyle = "#28231e";
  ctx.fillRect(0, canvas.height / 2, canvas.width, canvas.height / 2);
  const walls = game.map?.walls || game.demo;
  const projected = walls.map(projectWall).filter(Boolean).sort((a, b) => b.d1 + b.d2 - a.d1 - a.d2);
  for (const wall of projected) {
    const height1 = Math.min(canvas.height * 2, 9000 / wall.d1);
    const height2 = Math.min(canvas.height * 2, 9000 / wall.d2);
    const top1 = canvas.height / 2 - height1 / 2;
    const top2 = canvas.height / 2 - height2 / 2;
    const shade = Math.max(45, Math.min(210, 225 - (wall.d1 + wall.d2) / 3));
    ctx.fillStyle = `rgb(${shade}, ${Math.floor(shade * .66)}, ${Math.floor(shade * .24)})`;
    ctx.beginPath();
    ctx.moveTo(wall.x1, top1);
    ctx.lineTo(wall.x2, top2);
    ctx.lineTo(wall.x2, canvas.height - top2);
    ctx.lineTo(wall.x1, canvas.height - top1);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#100e0b";
    ctx.stroke();
  }
}

function frame(now) {
  if (!game.running) return;
  const elapsed = Math.min(.25, (now - game.lastTime) / 1000);
  game.lastTime = now;
  game.accumulator += elapsed;
  while (game.accumulator >= FIXED_TIC) {
    update(1);
    game.accumulator -= FIXED_TIC;
  }
  render();
  requestAnimationFrame(frame);
}

async function loadBuffer(buffer, label) {
  try {
    const wad = parseWad(buffer);
    const map = findMap(wad.lumps);
    game.wad = wad;
    startWorld(map, map.name);
    setStatus(`${label} · ${wad.kind} · ${wad.lumps.size} lumps`);
  } catch (error) {
    setStatus(error.message, true);
    messageNode.textContent = "No se pudo cargar el WAD";
    messageNode.classList.remove("hidden");
  }
}

async function loadBundledWad() {
  const url = "Doom1.WAD";
  setStatus(`Descargando ${url}...`);
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}: no se pudo descargar ${url}.`);
    await loadBuffer(await response.arrayBuffer(), url);
  } catch (error) {
    setStatus(`${error.message} Comprueba que Doom1.WAD esté junto a index.html.`, true);
    messageNode.textContent = "No se encontró Doom1.WAD";
    messageNode.classList.remove("hidden");
  }
}

window.addEventListener("keydown", (event) => {
  if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " "].includes(event.key)) event.preventDefault();
  if (event.key === "w" || event.key === "W" || event.key === "ArrowUp") input.forward = 1;
  if (event.key === "s" || event.key === "S" || event.key === "ArrowDown") input.forward = -1;
  if (event.key === "a" || event.key === "A" || event.key === "ArrowLeft") input.turn = -1;
  if (event.key === "d" || event.key === "D" || event.key === "ArrowRight") input.turn = 1;
});
window.addEventListener("keyup", (event) => {
  if (["w", "W", "s", "S", "ArrowUp", "ArrowDown"].includes(event.key)) input.forward = 0;
  if (["a", "A", "d", "D", "ArrowLeft", "ArrowRight"].includes(event.key)) input.turn = 0;
});
render();
loadBundledWad();
