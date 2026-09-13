const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;
const publicDir = path.join(__dirname, "public");

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split("?")[0]);
  if (urlPath === "/") urlPath = "/index.html";
  const file = path.join(publicDir, urlPath);
  if (!file.startsWith(publicDir)) return res.writeHead(403).end();
  fs.readFile(file, (err, data) => {
    if (err) return res.writeHead(404).end("Not found");
    const types = {".html":"text/html",".js":"text/javascript",".css":"text/css",".json":"application/json"};
    res.writeHead(200, {"Content-Type": types[path.extname(file)] || "application/octet-stream"});
    res.end(data);
  });
});

const wss = new WebSocket.Server({ server });
const players = new Map();
const rooms = new Map();

const MAP_W = 2200, MAP_H = 1400;
const weapons = {
  pistol:  { damage: 28, range: 900, cooldown: 280 },
  smg:     { damage: 16, range: 760, cooldown: 90 },
  rifle:   { damage: 32, range: 1100, cooldown: 170 },
  shotgun: { damage: 14, range: 420, cooldown: 650 }
};

function safeName(n) {
  return String(n || "Player").replace(/[^\w -]/g, "").slice(0, 16) || "Player";
}
function roomFor(code) { return rooms.get(code); }
function send(ws, obj) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}
function broadcast(room, obj, exceptId = null) {
  for (const id of room.players) if (id !== exceptId) send(players.get(id).ws, obj);
}
function spawn(room) {
  const margin = 100;
  return {
    x: margin + Math.random() * (MAP_W - margin * 2),
    y: margin + Math.random() * (MAP_H - margin * 2),
    angle: Math.random() * Math.PI * 2
  };
}
function playerList(room) {
  return [...room.players].map(id => {
    const p = players.get(id);
    return { id, name:p.name, x:p.x, y:p.y, angle:p.angle, hp:p.hp, weapon:p.weapon };
  });
}
function joinRoom(ws, code) {
  code = String(code || "").toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,8);
  if (!code) code = "QUICK";
  let room = rooms.get(code);
  if (!room) rooms.set(code, room = {players:new Set(), max:8});
  if (room.players.size >= room.max) return send(ws, {type:"error", message:"Room is full."});
  const p = players.get(ws.id);
  p.room = code; Object.assign(p, spawn(room)); p.hp = 100;
  room.players.add(ws.id);
  send(ws, {type:"joined", id:ws.id, room:code, players:playerList(room)});
  broadcast(room, {type:"playerJoined", player:{id:ws.id,name:p.name,x:p.x,y:p.y,angle:p.angle,hp:p.hp,weapon:p.weapon}}, ws.id);
}
function leaveRoom(ws) {
  const p = players.get(ws.id);
  if (!p || !p.room) return;
  const room = rooms.get(p.room);
  if (room) {
    room.players.delete(ws.id);
    broadcast(room, {type:"playerLeft", id:ws.id});
    if (!room.players.size && p.room !== "QUICK") rooms.delete(p.room);
  }
  p.room = null;
}
function respawn(p) {
  const room = rooms.get(p.room);
  if (!room) return;
  Object.assign(p, spawn(room)); p.hp = 100; p.weapon = "pistol";
  send(p.ws, {type:"respawn", x:p.x,y:p.y,angle:p.angle,hp:p.hp});
  broadcast(room, {type:"playerRespawn", player:{id:p.ws.id,x:p.x,y:p.y,angle:p.angle,hp:p.hp,weapon:p.weapon}}, p.ws.id);
}

wss.on("connection", ws => {
  ws.id = Math.random().toString(36).slice(2,10);
  players.set(ws.id, {ws,name:"Player",room:null,x:500,y:500,angle:0,hp:100,weapon:"pistol",lastShot:0});

  ws.on("message", raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    const p = players.get(ws.id);
    if (!p) return;

    if (m.type === "hello") {
      p.name = safeName(m.name);
      send(ws, {type:"hello", id:ws.id});
    } else if (m.type === "quickMatch") {
      leaveRoom(ws);
      const candidates = [...rooms.entries()].find(([code,r]) => code !== "QUICK" && r.players.size < r.max);
      joinRoom(ws, candidates ? candidates[0] : "QUICK");
    } else if (m.type === "createRoom") {
      leaveRoom(ws);
      joinRoom(ws, String(m.code || Math.random().toString(36).slice(2,7)));
    } else if (m.type === "joinRoom") {
      leaveRoom(ws); joinRoom(ws, m.code);
    } else if (m.type === "state" && p.room) {
      p.x = Math.max(20, Math.min(MAP_W-20, Number(m.x)||p.x));
      p.y = Math.max(20, Math.min(MAP_H-20, Number(m.y)||p.y));
      p.angle = Number(m.angle)||0;
      broadcast(rooms.get(p.room), {type:"state", player:{id:ws.id,x:p.x,y:p.y,angle:p.angle,hp:p.hp,weapon:p.weapon}}, ws.id);
    } else if (m.type === "weapon" && weapons[m.weapon]) {
      p.weapon = m.weapon;
    } else if (m.type === "shoot" && p.room && weapons[p.weapon]) {
      const now = Date.now(), w = weapons[p.weapon];
      if (now - p.lastShot < w.cooldown) return;
      p.lastShot = now;
      const room = rooms.get(p.room);
      let hit = null, bestDist = Infinity;
      const ax = Math.cos(p.angle), ay = Math.sin(p.angle);
      for (const id of room.players) {
        if (id === ws.id) continue;
        const t = players.get(id);
        if (!t || t.hp <= 0) continue;
        const dx=t.x-p.x, dy=t.y-p.y, dist=Math.hypot(dx,dy);
        if (dist > w.range) continue;
        const dot=(dx*ax+dy*ay)/dist;
        if (dot < 0.94) continue;
        if (dist < bestDist) { bestDist=dist; hit=t; }
      }
      if (hit) {
        hit.hp = Math.max(0, hit.hp - w.damage);
        broadcast(room, {type:"hit", attacker:ws.id, target:hit.ws.id, damage:w.damage, hp:hit.hp});
        if (hit.hp === 0) {
          send(ws, {type:"kill", victim:hit.name});
          setTimeout(() => { if (players.has(hit.ws.id) && players.get(hit.ws.id).room === p.room) respawn(hit); }, 1200);
        }
      }
      broadcast(room, {type:"shot", id:ws.id, angle:p.angle});
    }
  });

  ws.on("close", () => { leaveRoom(ws); players.delete(ws.id); });
});

server.listen(PORT, () => console.log(`FPS server running on http://localhost:${PORT}`));