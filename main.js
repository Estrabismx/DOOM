/* Browser translation of the data flow used by Linux DOOM.
 * The original C engine uses fixed-point values and a 35 Hz tic loop.
 * This port keeps the WAD structures, tic cadence, map geometry and
 * line collision rules while using Canvas as the video device. */
"use strict";

const canvas = document.getElementById("game-canvas");
const ctx = canvas.getContext("2d");
const statusNode = document.getElementById("status");
const mapNode = document.getElementById("map-name");
const messageNode = document.getElementById("screen-message");
const FIXED_TIC = 1 / 35;
const PLAYER_RADIUS = 16;
const PLAYER_HEIGHT = 56;
const FOV = Math.PI / 2.7;
const input = { forward: 0, strafe: 0, turn: 0, use: false };

const game = {
  wad: null,
  map: null,
  running: false,
  lastTime: 0,
  accumulator: 0,
  player: { x: 0, y: 0, angle: 0, floor: 0, ceiling: 128 }
};

function i16(view, offset) { return view.getInt16(offset, true); }
function u16(view, offset) { return view.getUint16(offset, true); }
function u32(view, offset) { return view.getUint32(offset, true); }
function text(bytes) {
  return new TextDecoder("ascii").decode(bytes).replace(/\0/g, "").trim().toUpperCase();
}

function parseWad(buffer) {
  const view = new DataView(buffer);
  if (view.byteLength < 12) throw new Error("El archivo es demasiado pequeño para ser un WAD.");
  const kind = text(new Uint8Array(buffer, 0, 4));
  if (kind !== "IWAD" && kind !== "PWAD") throw new Error("La cabecera no es IWAD ni PWAD.");
  const count = u32(view, 4);
  const directory = u32(view, 8);
  if (directory > view.byteLength || count > (view.byteLength - directory) / 16) {
    throw new Error("El directorio del WAD está fuera de sus límites.");
  }
  const lumps = [];
  for (let index = 0; index < count; index += 1) {
    const entry = directory + index * 16;
    const offset = u32(view, entry);
    const size = u32(view, entry + 4);
    if (offset > view.byteLength || size > view.byteLength - offset) continue;
    lumps.push({ name: text(new Uint8Array(buffer, entry + 8, 8)), bytes: new Uint8Array(buffer, offset, size) });
  }
  return { kind, lumps };
}

function mapMarkers(wad) {
  return wad.lumps
    .map((lump, index) => ({ ...lump, index }))
    .filter((lump) => /^E[1-4]M[1-9]$/.test(lump.name) || /^MAP\d\d$/.test(lump.name));
}

function mapLump(wad, markerIndex, name) {
  const marker = wad.lumps[markerIndex];
  const nextMarker = wad.lumps.findIndex((lump, index) => index > markerIndex &&
    (/^E[1-4]M[1-9]$/.test(lump.name) || /^MAP\d\d$/.test(lump.name)));
  const end = nextMarker < 0 ? wad.lumps.length : nextMarker;
  return wad.lumps.slice(markerIndex + 1, end).find((lump) => lump.name === name)?.bytes;
}

function readVertices(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const result = [];
  for (let offset = 0; offset + 3 < bytes.length; offset += 4) {
    result.push({ x: i16(view, offset), y: i16(view, offset + 2) });
  }
  return result;
}

function readSectors(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const result = [];
  for (let offset = 0; offset + 25 < bytes.length; offset += 26) {
    result.push({ floor: i16(view, offset), ceiling: i16(view, offset + 2), light: i16(view, offset + 20) });
  }
  return result;
}

function readSideDefs(bytes, sectors) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const result = [];
  for (let offset = 0; offset + 29 < bytes.length; offset += 30) {
    const sector = u16(view, offset + 28);
    result.push({ sector: sectors[sector] || { floor: 0, ceiling: 128, light: 160 } });
  }
  return result;
}

function readLineDefs(bytes, vertices, sides) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const result = [];
  for (let offset = 0; offset + 13 < bytes.length; offset += 14) {
    const start = u16(view, offset);
    const end = u16(view, offset + 2);
    const flags = u16(view, offset + 4);
    const right = u16(view, offset + 10);
    const left = u16(view, offset + 12);
    if (!vertices[start] || !vertices[end] || !sides[right]) continue;
    result.push({
      x1: vertices[start].x, y1: vertices[start].y, x2: vertices[end].x, y2: vertices[end].y,
      flags, right: sides[right], left: left === 0xffff ? null : sides[left]
    });
  }
  return result;
}

function readPlayer(bytes) {
  if (!bytes) return { x: 0, y: 0, angle: 0 };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = 0; offset + 9 < bytes.length; offset += 10) {
    if (i16(view, offset + 6) === 1) {
      return { x: i16(view, offset), y: i16(view, offset + 2), angle: i16(view, offset + 4) * Math.PI / 180 };
    }
  }
  return { x: 0, y: 0, angle: 0 };
}

function loadMap(wad, marker) {
  const vertices = mapLump(wad, marker.index, "VERTEXES");
  const sectors = mapLump(wad, marker.index, "SECTORS");
  const sideDefs = mapLump(wad, marker.index, "SIDEDEFS");
  const lineDefs = mapLump(wad, marker.index, "LINEDEFS");
  if (!vertices || !sectors || !sideDefs || !lineDefs) {
    throw new Error(`${marker.name} no contiene todos los lumps de geometría necesarios.`);
  }
  const sectorList = readSectors(sectors);
  const sideList = readSideDefs(sideDefs, sectorList);
  const player = readPlayer(mapLump(wad, marker.index, "THINGS"));
  return {
    name: marker.name,
    walls: readLineDefs(lineDefs, readVertices(vertices), sideList),
    player: { ...player, floor: 0, ceiling: 128 }
  };
}

function setStatus(textValue, error = false) {
  statusNode.textContent = textValue;
  statusNode.style.color = error ? "#e36a4e" : "";
}

function pointDistanceToSegment(x, y, line) {
  const dx = line.x2 - line.x1;
  const dy = line.y2 - line.y1;
  const lengthSquared = dx * dx + dy * dy;
  const factor = lengthSquared ? Math.max(0, Math.min(1, ((x - line.x1) * dx + (y - line.y1) * dy) / lengthSquared)) : 0;
  const nearestX = line.x1 + factor * dx;
  const nearestY = line.y1 + factor * dy;
  return Math.hypot(x - nearestX, y - nearestY);
}

function lineBlocks(line, x, y) {
  if (line.left && !(line.flags & 1)) {
    const low = Math.max(line.right.sector.floor, line.left.sector.floor);
    const high = Math.min(line.right.sector.ceiling, line.left.sector.ceiling);
    return high - low < PLAYER_HEIGHT;
  }
  return true;
}

function canMoveTo(x, y) {
  return game.map.walls.every((line) => !lineBlocks(line, x, y) || pointDistanceToSegment(x, y, line) >= PLAYER_RADIUS);
}

function updatePlayer() {
  const p = game.player;
  const angle = p.angle + input.turn * 0.034;
  p.angle = (angle + Math.PI * 2) % (Math.PI * 2);
  const speed = input.forward * (input.use ? 4 : 2.5);
  const side = input.strafe * 2.5;
  const nextX = p.x + Math.cos(p.angle) * speed - Math.sin(p.angle) * side;
  const nextY = p.y + Math.sin(p.angle) * speed + Math.cos(p.angle) * side;
  if (canMoveTo(nextX, p.y)) p.x = nextX;
  if (canMoveTo(p.x, nextY)) p.y = nextY;
}

function startWorld(map) {
  game.map = map;
  game.player = { ...map.player };
  game.running = true;
  game.lastTime = performance.now();
  game.accumulator = 0;
  mapNode.textContent = map.name;
  messageNode.classList.add("hidden");
  setStatus(`Motor activo · ${game.map.walls.length} líneas · 35 tics por segundo`);
  requestAnimationFrame(frame);
}

function projectPoint(x, y) {
  const p = game.player;
  const dx = x - p.x;
  const dy = y - p.y;
  return {
    depth: dx * Math.cos(p.angle) + dy * Math.sin(p.angle),
    side: -dx * Math.sin(p.angle) + dy * Math.cos(p.angle)
  };
}

function clip(point, other, near) {
  const ratio = (near - point.depth) / (other.depth - point.depth);
  return { depth: near, side: point.side + (other.side - point.side) * ratio };
}

function projectWall(line) {
  const near = 8;
  let a = projectPoint(line.x1, line.y1);
  let b = projectPoint(line.x2, line.y2);
  if (a.depth < near && b.depth < near) return null;
  if (a.depth < near) a = clip(a, b, near);
  if (b.depth < near) b = clip(b, a, near);
  const focal = canvas.width / (2 * Math.tan(FOV / 2));
  const screen = (point) => canvas.width / 2 + point.side * focal / point.depth;
  return { line, x1: screen(a), x2: screen(b), d1: a.depth, d2: b.depth };
}

function drawWall(wall) {
  const floor1 = canvas.height / 2 + (wall.line.right.sector.floor - game.player.floor) * 1.4 * 160 / wall.d1;
  const floor2 = canvas.height / 2 + (wall.line.right.sector.floor - game.player.floor) * 1.4 * 160 / wall.d2;
  const ceil1 = canvas.height / 2 - (wall.line.right.sector.ceiling - game.player.floor) * 1.4 * 160 / wall.d1;
  const ceil2 = canvas.height / 2 - (wall.line.right.sector.ceiling - game.player.floor) * 1.4 * 160 / wall.d2;
  const light = Math.max(40, Math.min(220, wall.line.right.sector.light - (wall.d1 + wall.d2) / 7));
  const fill = `rgb(${light}, ${Math.floor(light * .68)}, ${Math.floor(light * .3)})`;
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(wall.x1, ceil1);
  ctx.lineTo(wall.x2, ceil2);
  ctx.lineTo(wall.x2, floor2);
  ctx.lineTo(wall.x1, floor1);
  ctx.closePath();
  ctx.fill();
  if (wall.line.left) {
    const backFloor1 = canvas.height / 2 + (wall.line.left.sector.floor - game.player.floor) * 1.4 * 160 / wall.d1;
    const backFloor2 = canvas.height / 2 + (wall.line.left.sector.floor - game.player.floor) * 1.4 * 160 / wall.d2;
    const backCeil1 = canvas.height / 2 - (wall.line.left.sector.ceiling - game.player.floor) * 1.4 * 160 / wall.d1;
    const backCeil2 = canvas.height / 2 - (wall.line.left.sector.ceiling - game.player.floor) * 1.4 * 160 / wall.d2;
    ctx.fillStyle = "rgba(12, 12, 14, .72)";
    if (backCeil1 > ceil1 || backCeil2 > ceil2) {
      ctx.beginPath();
      ctx.moveTo(wall.x1, ceil1); ctx.lineTo(wall.x2, ceil2);
      ctx.lineTo(wall.x2, backCeil2); ctx.lineTo(wall.x1, backCeil1); ctx.fill();
    }
    if (backFloor1 < floor1 || backFloor2 < floor2) {
      ctx.beginPath();
      ctx.moveTo(wall.x1, backFloor1); ctx.lineTo(wall.x2, backFloor2);
      ctx.lineTo(wall.x2, floor2); ctx.lineTo(wall.x1, floor1); ctx.fill();
    }
  }
  ctx.strokeStyle = "#100e0b";
  ctx.stroke();
}

function render() {
  ctx.fillStyle = "#171b24";
  ctx.fillRect(0, 0, canvas.width, canvas.height / 2);
  ctx.fillStyle = "#28231e";
  ctx.fillRect(0, canvas.height / 2, canvas.width, canvas.height / 2);
  if (!game.map) return;
  game.map.walls.map(projectWall).filter(Boolean)
    .sort((a, b) => b.d1 + b.d2 - a.d1 - a.d2)
    .forEach(drawWall);
}

function frame(now) {
  if (!game.running) return;
  game.accumulator += Math.min(.25, (now - game.lastTime) / 1000);
  game.lastTime = now;
  while (game.accumulator >= FIXED_TIC) {
    updatePlayer();
    game.accumulator -= FIXED_TIC;
  }
  render();
  requestAnimationFrame(frame);
}

async function loadBundledWad() {
  setStatus("Descargando Doom1.WAD...");
  try {
    const response = await fetch("Doom1.WAD");
    if (!response.ok) throw new Error(`HTTP ${response.status}: no se pudo descargar Doom1.WAD.`);
    const wad = parseWad(await response.arrayBuffer());
    const marker = mapMarkers(wad)[0];
    if (!marker) throw new Error("El WAD no contiene mapas E1M1/MAP01.");
    game.wad = wad;
    startWorld(loadMap(wad, marker));
    setStatus(`Doom1.WAD · ${wad.lumps.length} lumps · ${marker.name} · ${game.map.walls.length} líneas`);
  } catch (error) {
    setStatus(`${error.message} Comprueba que Doom1.WAD esté junto a index.html.`, true);
    messageNode.textContent = "No se pudo cargar Doom1.WAD";
    messageNode.classList.remove("hidden");
  }
}

window.addEventListener("keydown", (event) => {
  if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " "].includes(event.key)) event.preventDefault();
  if (event.key === "w" || event.key === "W" || event.key === "ArrowUp") input.forward = 1;
  if (event.key === "s" || event.key === "S" || event.key === "ArrowDown") input.forward = -1;
  if (event.key === "a" || event.key === "A") input.strafe = -1;
  if (event.key === "d" || event.key === "D") input.strafe = 1;
  if (event.key === "ArrowLeft") input.turn = -1;
  if (event.key === "ArrowRight") input.turn = 1;
  if (event.key === "Shift") input.use = true;
});
window.addEventListener("keyup", (event) => {
  if (["w", "W", "s", "S", "ArrowUp", "ArrowDown"].includes(event.key)) input.forward = 0;
  if (["a", "A", "d", "D"].includes(event.key)) input.strafe = 0;
  if (["ArrowLeft", "ArrowRight"].includes(event.key)) input.turn = 0;
  if (event.key === "Shift") input.use = false;
});

render();
loadBundledWad();
