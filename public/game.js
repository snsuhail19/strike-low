const canvas=document.getElementById("game"),ctx=canvas.getContext("2d",{alpha:false});
const menu=document.getElementById("menu"),hud=document.getElementById("hud"),statusEl=document.getElementById("status");
const nameEl=document.getElementById("name"),roomEl=document.getElementById("room");
const hpEl=document.getElementById("hp"),weaponEl=document.getElementById("weapon"),feed=document.getElementById("feed");
let ws, me=null, room="", running=false, last=performance.now(), shootAt=0;
let keys=new Set(), mouseDown=false, mouseX=0, yaw=0, weapon="pistol";
const others=new Map();
const W=2200,H=1400, SPEED=230;
const weapons={pistol:{damage:28,cooldown:280},smg:{damage:16,cooldown:90},rifle:{damage:32,cooldown:170},shotgun:{damage:14,cooldown:650}};
function resize(){canvas.width=Math.min(1280,innerWidth);canvas.height=Math.min(720,innerHeight);if(canvas.width<innerWidth)canvas.style.width="100%";if(canvas.height<innerHeight)canvas.style.height="100%"}addEventListener("resize",resize);resize();

function connect(action,code){
  statusEl.textContent="Connecting...";
  ws=new WebSocket(location.origin.replace(/^http/,"ws"));
  ws.onopen=()=>{send({type:"hello",name:nameEl.value||"Player"}); action==="quick"?send({type:"quickMatch"}):send({type:action,code});};
  ws.onclose=()=>{if(running){running=false;hud.style.display="none";menu.classList.remove("hidden");statusEl.textContent="Disconnected from server."}};
  ws.onmessage=e=>handle(JSON.parse(e.data));
}
function send(o){if(ws&&ws.readyState===1)ws.send(JSON.stringify(o))}
function start(action,code=""){menu.classList.add("hidden");hud.style.display="block";connect(action,code)}
document.getElementById("quick").onclick=()=>start("quick");
document.getElementById("create").onclick=()=>{const c=(roomEl.value||Math.random().toString(36).slice(2,7)).toUpperCase();roomEl.value=c;start("createRoom",c)};
document.getElementById("join").onclick=()=>{const c=roomEl.value.trim().toUpperCase();if(c)start("joinRoom",c)};

function handle(m){
 if(m.type==="hello") me={id:m.id,x:1100,y:700,angle:0,hp:100};
 if(m.type==="joined"){room=m.room;document.getElementById("roomLabel").textContent="ROOM "+room;running=true;others.clear();for(const p of m.players){if(p.id===me.id)Object.assign(me,p);else others.set(p.id,p)}}
 if(m.type==="playerJoined")others.set(m.player.id,m.player);
 if(m.type==="playerLeft")others.delete(m.id);
 if(m.type==="state"&&m.player.id!==me.id)others.set(m.player.id,m.player);
 if(m.type==="hit"){if(m.target===me.id){me.hp=m.hp;hpEl.textContent=me.hp;canvas.classList.add("flash");setTimeout(()=>canvas.classList.remove("flash"),80)}else{const p=others.get(m.target);if(p)p.hp=m.hp}}
 if(m.type==="kill")addFeed("ELIMINATED "+m.victim);
 if(m.type==="respawn"&&me){Object.assign(me,m);hpEl.textContent=me.hp}
 if(m.type==="playerRespawn")others.set(m.player.id,m.player);
 if(m.type==="error"){statusEl.textContent=m.message;setTimeout(()=>location.reload(),1600)}
}
function addFeed(t){const d=document.createElement("div");d.textContent=t;feed.prepend(d);setTimeout(()=>d.remove(),2500)}
addEventListener("keydown",e=>{keys.add(e.code);if(["Digit1","Digit2","Digit3","Digit4"].includes(e.code)){weapon={Digit1:"pistol",Digit2:"smg",Digit3:"rifle",Digit4:"shotgun"}[e.code];weaponEl.textContent=weapon.toUpperCase();send({type:"weapon",weapon})}});
addEventListener("keyup",e=>keys.delete(e.code));
canvas.addEventListener("mousemove",e=>{if(running) yaw += e.movementX*0.002});
canvas.addEventListener("mousedown",e=>{if(e.button===0){mouseDown=true;canvas.requestPointerLock?.()}});
addEventListener("mouseup",()=>mouseDown=false);
canvas.addEventListener("click",()=>canvas.requestPointerLock?.());
function shoot(){const now=performance.now(),w=weapons[weapon];if(now-shootAt>=w.cooldown){shootAt=now;send({type:"shoot"});}}
function update(dt){
 if(!me)return;
 let dx=0,dy=0;if(keys.has("KeyW"))dy+=1;if(keys.has("KeyS"))dy-=1;if(keys.has("KeyA"))dx-=1;if(keys.has("KeyD"))dx+=1;
 const len=Math.hypot(dx,dy)||1;dx/=len;dy/=len;
 const ca=Math.cos(yaw),sa=Math.sin(yaw);
 me.x=Math.max(25,Math.min(W-25,me.x+(dx*ca-dy*sa)*SPEED*dt));
 me.y=Math.max(25,Math.min(H-25,me.y+(dx*sa+dy*ca)*SPEED*dt));
 me.angle=yaw;send({type:"state",x:me.x,y:me.y,angle:me.angle});
 if(mouseDown)shoot();
}
function worldToScreen(x,y){const s=Math.min(canvas.width/W,canvas.height/H)*.72;return {x:canvas.width/2+(x-me.x)*s,y:canvas.height/2+(y-me.y)*s,s}}
function draw(){
 ctx.fillStyle="#111722";ctx.fillRect(0,0,canvas.width,canvas.height);
 // lightweight top-down tactical FPS view: intentionally cheap to render on low-end laptops
 const s=Math.min(canvas.width/W,canvas.height/H)*.72, ox=canvas.width/2-me.x*s, oy=canvas.height/2-me.y*s;
 ctx.strokeStyle="#222c3a";ctx.lineWidth=1;
 for(let x=0;x<W;x+=100){ctx.beginPath();ctx.moveTo(ox+x*s,oy);ctx.lineTo(ox+x*s,oy+H*s);ctx.stroke()}
 for(let y=0;y<H;y+=100){ctx.beginPath();ctx.moveTo(ox,oy+y*s);ctx.lineTo(ox+W*s,oy+y*s);ctx.stroke()}
 ctx.strokeStyle="#465264";ctx.strokeRect(ox,oy,W*s,H*s);
 // cover blocks
 for(const b of [{x:350,y:260,w:260,h:80},{x:1050,y:230,w:90,h:330},{x:1550,y:380,w:300,h:90},{x:600,y:930,w:380,h:90},{x:1300,y:900,w:100,h:300}]){
   ctx.fillStyle="#263141";ctx.fillRect(ox+b.x*s,oy+b.y*s,b.w*s,b.h*s);
 }
 for(const p of others.values())drawPlayer(p,ox,oy,s,false);
 drawPlayer(me,ox,oy,s,true);
}
function drawPlayer(p,ox,oy,s,self){
 const x=ox+p.x*s,y=oy+p.y*s,r=Math.max(5,12*s);
 ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fillStyle=self?"#e8edf3":"#e56d6d";ctx.fill();
 ctx.strokeStyle="#05070a";ctx.stroke();
 ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+Math.cos(p.angle)*r*2.5,y+Math.sin(p.angle)*r*2.5);ctx.strokeStyle="#f0c674";ctx.lineWidth=3;ctx.stroke();
 if(!self){ctx.fillStyle="#111";ctx.fillRect(x-18,y-r-12,36,4);ctx.fillStyle="#6ee7a8";ctx.fillRect(x-18,y-r-12,36*Math.max(0,p.hp)/100,4);ctx.fillStyle="#fff";ctx.font="10px Arial";ctx.textAlign="center";ctx.fillText(p.name||"Player",x,y-r-17)}
}
function loop(t){const dt=Math.min(.033,(t-last)/1000);last=t;if(running){update(dt);draw();document.getElementById("playersLabel").textContent=`${others.size+1}/8 PLAYERS`}requestAnimationFrame(loop)}requestAnimationFrame(loop);