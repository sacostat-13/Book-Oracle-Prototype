// src/components/ShelfScene.jsx — v0.31
// npm install three
//
// FACE ASSIGNMENT (settled, no ambiguity):
//   We orient the book with its COVER facing +Z (toward camera) at rotation.y = 0.
//   The spine is on the +X face (right side at rest).
//
//   BoxGeometry face order: 0=+X, 1=-X, 2=+Y, 3=-Y, 4=+Z, 5=-Z
//
//   Face 4 (+Z) = FRONT COVER   → faces camera at rotation.y = 0
//   Face 5 (-Z) = BACK COVER    → faces camera at rotation.y = PI
//   Face 0 (+X) = SPINE         → faces camera at rotation.y = -PI/2
//   Face 1 (-X) = FORE-EDGE     → pages, faces camera at rotation.y = PI/2
//   Face 2 (+Y) = TOP edge
//   Face 3 (-Y) = BOTTOM edge
//
// ON SHELF: books stand spine-out. We rotate each book -PI/2 on Y so spine faces camera.
//   restRotY = -PI/2  → spine (+X face) faces camera ✓
//
// PULL SEQUENCE (all rotations absolute, not relative):
//   rotState 0: restRotY = -PI/2        → spine visible (on shelf / just lifted)
//   rotState 1: rotation.y = 0          → front cover faces camera
//   rotState 2: rotation.y = PI         → back cover faces camera
//   rotState 3: return to shelf         → animate back to restRotY, fire onOpenBook
//
// SPINES ON SHELF: individual meshes (not instanced) so each gets its own texture.
//   ~40 books × 1 draw call each is fine for a shelf scene.

import { useEffect, useRef, useMemo, useState, useCallback } from 'react';
import * as THREE from 'three';
import { useT } from '../lib/I18nContext';

// ─── Constants ────────────────────────────────────────────────────────────────
const MAX_VISIBLE  = 120;
const ROWS         = 3;
const ROW_GAP      = 2.6;
const GAP          = 0;
const BOARD_H      = 0.09;
const HOVER_RISE   = 0.22;
const ZOOM_SPEED   = 0.9; // ortho zoom per wheel pixel
const REST_ROT_Y   = Math.PI / 2;  // spine faces camera on shelf (left side = spine, reads L→R)

const DISPLAY_ASPECT = 0.65; // cover width/height ratio

// ─── Palette ──────────────────────────────────────────────────────────────────
const PAL = [
  ['#7a312a','#52201c'],['#5a221d','#36130f'],['#2f4434','#1c2c20'],
  ['#23484a','#13282a'],['#212f50','#121a30'],['#2f2552','#1a1330'],
  ['#3e2746','#251530'],['#6e5527','#42330f'],['#4c4c24','#2c2c11'],
  ['#4a3322','#2a1c11'],['#2c333c','#171b21'],['#5e2436','#37111e'],
  ['#244049','#13242a'],['#5a3d1a','#33210d'],['#3a2030','#21121c'],
  ['#1f3a2e','#10211a'],['#4a1c2c','#2c0e18'],['#1c3a4a','#0e2230'],
  ['#3a3a1c','#20200a'],['#4a2a0a','#2c1805'],
];
const FOILS = ['#e8d8b4','#c9a24b','#dcc8d2','#d2b48c','#e0c8a0'];

function mod(a,n){ return((a%n)+n)%n; }
function dh(n){ return(Math.imul((n+1)*2654435761,1)>>>0); }

function mkCfg(book, idx) {
  const h   = dh(idx);
  const pp  = book.pp || book.pages || 280;
  const spW = 0.14 + Math.min(pp,900)/900*0.22;
  const spH = 1.55 + mod(h>>>5,6)*0.08;
  const pal  = PAL[mod(idx*7+(h>>>3), PAL.length)];
  const foil = FOILS[mod(h>>>11, FOILS.length)];
  const hl   = mod(h>>>13,100)/100;
  return { book, idx, spW, spH, pal, foil, hl };
}

// ─── Canvas texture builders ──────────────────────────────────────────────────
function lerpH(a,b,t){
  const p=h=>({r:parseInt(h.slice(1,3),16),g:parseInt(h.slice(3,5),16),b:parseInt(h.slice(5,7),16)});
  const ca=p(a),cb=p(b);
  return `rgb(${Math.round(ca.r+(cb.r-ca.r)*t)},${Math.round(ca.g+(cb.g-ca.g)*t)},${Math.round(ca.b+(cb.b-ca.b)*t)})`;
}

// Spine: visible on shelf (this is what you see looking at a real bookshelf)
function makeSpineTex(cfg, W=96, H=512) {
  const c=document.createElement('canvas');
  c.width=W; c.height=H;
  const ctx=c.getContext('2d');
  const g=ctx.createLinearGradient(0,0,0,H);
  g.addColorStop(0,cfg.pal[0]);
  g.addColorStop(0.5,lerpH(cfg.pal[0],cfg.pal[1],0.35));
  g.addColorStop(1,cfg.pal[1]);
  ctx.fillStyle=g; ctx.fillRect(0,0,W,H);
  // Left specular
  const hl=ctx.createLinearGradient(0,0,W*0.55,0);
  hl.addColorStop(0,`rgba(255,255,255,${0.16+cfg.hl*0.12})`);
  hl.addColorStop(0.4,'rgba(255,255,255,0.02)');
  hl.addColorStop(1,'rgba(0,0,0,0.20)');
  ctx.fillStyle=hl; ctx.fillRect(0,0,W,H);
  // Top shadow
  const ts=ctx.createLinearGradient(0,0,0,H*0.10);
  ts.addColorStop(0,'rgba(0,0,0,0.38)');
  ts.addColorStop(1,'rgba(0,0,0,0)');
  ctx.fillStyle=ts; ctx.fillRect(0,0,W,H*0.10);
  // Foil bands
  ctx.fillStyle=cfg.foil+'cc'; ctx.fillRect(0,0,W,5); ctx.fillRect(0,H-5,W,5);
  ctx.strokeStyle=cfg.foil+'33'; ctx.lineWidth=0.5; ctx.strokeRect(4,8,W-8,H-16);
  // Title
  ctx.save();
  ctx.translate(W/2,H/2); ctx.rotate(-Math.PI/2);
  ctx.fillStyle=cfg.foil;
  const title=cfg.book.t||'';
  const fs=Math.min(15,220/Math.max(title.length,1)+4);
  ctx.font=`300 ${fs}px "JetBrains Mono",monospace`;
  ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.shadowColor='rgba(0,0,0,0.55)'; ctx.shadowBlur=3;
  ctx.fillText(title.length>34?title.slice(0,33)+'…':title,0,0);
  ctx.restore();
  return new THREE.CanvasTexture(c);
}

// Front cover
function makeFrontTex(cfg) {
  const W=384,H=512,c=document.createElement('canvas');
  c.width=W; c.height=H;
  const ctx=c.getContext('2d');
  const g=ctx.createLinearGradient(0,0,W,H);
  g.addColorStop(0,cfg.pal[0]); g.addColorStop(1,lerpH(cfg.pal[0],cfg.pal[1],0.85));
  ctx.fillStyle=g; ctx.fillRect(0,0,W,H);
  // Subtle texture
  ctx.globalAlpha=0.035;
  for(let i=0;i<H;i+=4){ctx.fillStyle=i%8===0?'#fff':'#000';ctx.fillRect(0,i,W,2);}
  ctx.globalAlpha=1;
  // Vignette
  const v=ctx.createRadialGradient(W*0.45,H*0.35,0,W/2,H*0.5,H*0.9);
  v.addColorStop(0,'rgba(255,255,255,0.09)'); v.addColorStop(1,'rgba(0,0,0,0.55)');
  ctx.fillStyle=v; ctx.fillRect(0,0,W,H);
  // Borders
  ctx.strokeStyle=`${cfg.foil}55`; ctx.lineWidth=2; ctx.strokeRect(12,12,W-24,H-24);
  ctx.strokeStyle=`${cfg.foil}22`; ctx.lineWidth=0.8; ctx.strokeRect(18,18,W-36,H-36);
  // Eyebrow
  ctx.fillStyle=`${cfg.foil}bb`;
  ctx.font='300 10px "JetBrains Mono",monospace'; ctx.textAlign='center';
  ctx.fillText('✦  EL ORÁCULO  ✦',W/2,34);
  ctx.strokeStyle=`${cfg.foil}44`; ctx.lineWidth=0.8;
  ctx.beginPath(); ctx.moveTo(W*0.2,44); ctx.lineTo(W*0.8,44); ctx.stroke();
  // Title
  const title=cfg.book.t||'';
  const fs=Math.min(32,420/Math.max(title.length,1)+8);
  ctx.fillStyle='#f5ecd8';
  ctx.font=`italic 600 ${fs}px "Cormorant Garamond",Georgia,serif`;
  ctx.textAlign='center';
  ctx.shadowColor='rgba(0,0,0,0.5)'; ctx.shadowBlur=6;
  const words=title.split(' '),lines=[];let cur='';
  for(const w of words){
    const t=cur?cur+' '+w:w;
    if(ctx.measureText(t).width>W-52&&cur){lines.push(cur);cur=w;}else cur=t;
  }
  if(cur)lines.push(cur);
  const lh=Math.round(fs*1.28);
  let ty=H*0.48-((lines.length-1)*lh)/2;
  lines.forEach(l=>{ctx.fillText(l,W/2,ty);ty+=lh;});
  ctx.shadowBlur=0;
  // Author
  ctx.fillStyle='rgba(235,220,185,0.62)';
  ctx.font='300 10px "JetBrains Mono",monospace';
  ctx.fillText((cfg.book.a||'').toUpperCase().slice(0,42),W/2,H-28);
  return new THREE.CanvasTexture(c);
}

// Back cover
function makeBackTex(cfg) {
  const W=384,H=512,c=document.createElement('canvas');
  c.width=W; c.height=H;
  const ctx=c.getContext('2d');
  const g=ctx.createLinearGradient(0,0,0,H);
  g.addColorStop(0,lerpH(cfg.pal[1],'#0d0a07',0.1)); g.addColorStop(1,'#080705');
  ctx.fillStyle=g; ctx.fillRect(0,0,W,H);
  ctx.strokeStyle=`${cfg.foil}33`; ctx.lineWidth=1.5; ctx.strokeRect(12,12,W-24,H-24);
  ctx.fillStyle=`${cfg.foil}66`;
  ctx.font='28px serif'; ctx.textAlign='center'; ctx.fillText('❦',W/2,54);
  const desc=(cfg.book.d||'A work of extraordinary power and literary distinction.').slice(0,320);
  ctx.fillStyle='rgba(235,220,185,0.65)';
  ctx.font='italic 14px "Cormorant Garamond",Georgia,serif'; ctx.textAlign='center';
  const words=desc.split(' '),lines=[];let cur='';
  for(const w of words){
    if((cur+' '+w).length>38&&cur){lines.push(cur);cur=w;}
    else cur=(cur?cur+' ':'')+w;
  }
  if(cur)lines.push(cur);
  let ty=82;
  lines.slice(0,12).forEach(l=>{ctx.fillText(l,W/2,ty);ty+=20;});
  ctx.fillStyle=`${cfg.foil}88`;
  ctx.font='300 9px "JetBrains Mono",monospace';
  ctx.fillText((cfg.book.a||'').toUpperCase(),W/2,H-26);
  return new THREE.CanvasTexture(c);
}

// Page edge
function makePageTex() {
  const W=128,H=32,c=document.createElement('canvas');
  c.width=W; c.height=H;
  const ctx=c.getContext('2d');
  ctx.fillStyle='#ede4cc'; ctx.fillRect(0,0,W,H);
  ctx.strokeStyle='#c8ba98'; ctx.lineWidth=0.6;
  for(let y=1;y<H;y+=2.5){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();}
  const t=new THREE.CanvasTexture(c);
  t.wrapS=t.wrapT=THREE.RepeatWrapping;
  return t;
}

// ─── Easing ───────────────────────────────────────────────────────────────────
const easeIO = t => t<0.5?4*t*t*t:(t-1)*(2*t-2)*(2*t-2)+1;
const easeO  = t => 1-(1-t)**3;

function mkTw(obj,end,dur,fn,done){
  const start={};
  for(const k in end) start[k]=typeof obj[k]==='number'?obj[k]:0;
  return {obj,start,end,dur,fn,done,elapsed:0};
}
function stepTw(tw,dt){
  tw.elapsed=Math.min(tw.elapsed+dt,tw.dur);
  const t=tw.fn(tw.elapsed/tw.dur);
  for(const k in tw.end) tw.obj[k]=tw.start[k]+(tw.end[k]-tw.start[k])*t;
  if(tw.elapsed>=tw.dur){tw.done?.();return true;}
  return false;
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function ShelfScene({books=[], onOpenBook, maxRows=ROWS}) {
  const mountRef=useRef(null);
  const [tooltip, setTooltip]=useState(null); // {x,y,title,author} | null
  const rafRef  =useRef(null);
  const tooltipCbRef=useRef(null); // set by effect to update tooltip state
  const [arrangement,setArrangement]=useState('recent');
  const [seed,setSeed]=useState(0);
  // Modal fade-in state: null | { book, opacity }
  const [modalFade,setModalFade]=useState(null);
  const t = useT();

  const MODES =['recent','shuffle','by-genre','by-pages'];
  const MLABEL={
    recent:   t('shelfScene.sortRecent'),
    shuffle:  t('shelfScene.sortShuffle'),
    'by-genre': t('shelfScene.sortGenre'),
    'by-pages': t('shelfScene.sortSize'),
  };

  const visible=useMemo(()=>{
    let pool=books.slice();
    if(arrangement==='shuffle'){
      let s=(seed+1)*9301+49297;
      for(let i=pool.length-1;i>0;i--){
        s=(s*9301+49297)%233280;
        const j=Math.floor(s/233280*(i+1));
        [pool[i],pool[j]]=[pool[j],pool[i]];
      }
    }else if(arrangement==='by-genre'){
      pool.sort((a,b)=>(a.g||'zzz').localeCompare(b.g||'zzz'));
    }else if(arrangement==='by-pages'){
      pool.sort((a,b)=>(b.pp||280)-(a.pp||280));
    }
    return pool.slice(0,MAX_VISIBLE).map((b,i)=>mkCfg(b,i));
  },[books,arrangement,seed]);

  useEffect(()=>{
    const el=mountRef.current;
    if(!el||!visible.length) return;

    const CW=el.clientWidth||900;
    const CH=Math.max(340,Math.min(520,window.innerHeight*0.44));
    el.style.height=CH+'px';

    const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});
    renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
    renderer.setSize(CW,CH);
    renderer.toneMapping=THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure=1.08;
    el.appendChild(renderer.domElement);

    const scene=new THREE.Scene();
    scene.background=null;
    scene.add(new THREE.AmbientLight(0x5a3f28,3.2));
    const key=new THREE.DirectionalLight(0xfff2e0,2.6);
    key.position.set(-3,8,6); scene.add(key);
    const fill=new THREE.PointLight(0xd08040,1.2,22);
    fill.position.set(4,1,5); scene.add(fill);
    const top=new THREE.DirectionalLight(0xffeedd,0.8);
    top.position.set(0,10,2); scene.add(top);

    const pageTex=makePageTex();
    const boardMat=new THREE.MeshStandardMaterial({color:0x2e1a0c,roughness:0.96,metalness:0.02});

    // ── Orthographic camera ───────────────────────────────────────────────────
    // Books sit at y=0 (row 0 top), y=-ROW_GAP (row 1 top), y=-2*ROW_GAP (row 2 top).
    // Max book height is 2.1. So scene spans from top of row 0 to bottom of last row.
    const maxSpH   = 2.1;
    const sceneTop = maxSpH + 0.3;                        // above row 0
    const sceneBot = -(maxRows-1)*ROW_GAP - 0.3;         // below last row
    const midY     = (sceneTop + sceneBot) / 2;
    const halfH    = (sceneTop - sceneBot) / 2;
    const halfW    = halfH * (CW/CH);
    const usableW  = halfW * 2;                           // books fill full width

    const camera = new THREE.OrthographicCamera(
      -halfW, halfW,          // left, right
      sceneTop, sceneBot,     // top, bottom  ← use actual scene bounds, not midY±halfH
      0.01, 50
    );
    camera.position.set(0, midY, 10);
    camera.lookAt(0, midY, 0);

    // Zoom: ortho camera.zoom > 1 = zoomed in. Smooth interpolation each frame.
    let zoomTarget  = 1.0;
    let zoomCurrent = 1.0;
    const ZOOM_MIN_VAL = 1.0;
    const ZOOM_MAX_VAL = 6.0;

    function onWheel(e){
      e.preventDefault();
      const delta = e.deltaY * (e.deltaMode===1?0.04:e.deltaMode===2?1:0.001);
      zoomTarget = Math.max(ZOOM_MIN_VAL, Math.min(ZOOM_MAX_VAL, zoomTarget - delta*ZOOM_SPEED));
    }
    el.addEventListener('wheel', onWheel, { passive: false });

    // ── Display size for pulled book ──────────────────────────────────────────
    // halfH * 2 = total world height visible at zoom=1.
    // DISPLAY_H = 50% of that = book fills half the container when pulled out.
    const DISPLAY_H = halfH * 2 * 0.50;
    const DISPLAY_W = DISPLAY_H * DISPLAY_ASPECT;
    const DISPLAY_D = DISPLAY_W * 0.14;
    const displayZ  = 2.0;
    const displayY  = midY;

    // ── Build shelf rows ──────────────────────────────────────────────────────
    const perRow=Math.ceil(visible.length/maxRows);
    const rowsData=Array.from({length:maxRows},(_,r)=>visible.slice(r*perRow,(r+1)*perRow));

    const allSpineMeshes=[]; // for raycasting
    const spineData=[];      // parallel array: {mesh, cfg, x, y, restY, rowY}

    rowsData.forEach((cfgs,ri)=>{
      if(!cfgs.length) return;
      const rowY=-ri*ROW_GAP;

      // Scale widths to fill usableW
      const rawW=cfgs.reduce((s,c)=>s+c.spW,0)+GAP*(cfgs.length-1);
      const sc=usableW/rawW;
      const scaled=cfgs.map(c=>({
        ...c,
        spW:c.spW*sc,
        spH:Math.min(c.spH*(1+sc*0.03),2.1),
        spD:Math.max(c.spW*sc*0.6,0.12),
      }));
      const totalW=scaled.reduce((s,c)=>s+c.spW,0)+GAP*(scaled.length-1);

      // Shelf board
      const bGeo=new THREE.BoxGeometry(totalW+0.3,BOARD_H,0.5);
      const board=new THREE.Mesh(bGeo,boardMat);
      board.position.set(0,rowY-BOARD_H/2,0);
      scene.add(board);

      let xCur=-totalW/2;
      scaled.forEach((cfg)=>{
        const cx=xCur+cfg.spW/2;
        xCur+=cfg.spW+GAP;
        const cy=rowY+cfg.spH/2;

        // Individual spine mesh — BoxGeometry(spW, spH, spD)
        // Rotated -PI/2 on Y so face 0 (+X) faces camera = spine texture
        const spineTex=makeSpineTex(cfg);
        const geo=new THREE.BoxGeometry(cfg.spW,cfg.spH,cfg.spD);
        const mesh=new THREE.Mesh(geo,[
          new THREE.MeshStandardMaterial({map:pageTex, roughness:0.92,metalness:0}),    // 0:+X fore-edge
          new THREE.MeshStandardMaterial({map:spineTex,roughness:0.80,metalness:0.04}), // 1:-X SPINE ← camera at REST_ROT_Y=+PI/2
          new THREE.MeshStandardMaterial({map:pageTex, roughness:0.92,metalness:0}),    // 2:+Y top
          new THREE.MeshStandardMaterial({map:pageTex, roughness:0.92,metalness:0}),    // 3:-Y bottom
          new THREE.MeshStandardMaterial({color:new THREE.Color(cfg.pal[1]).multiplyScalar(0.4),roughness:0.9}), // 4:+Z front cover (hidden on shelf)
          new THREE.MeshStandardMaterial({color:new THREE.Color(cfg.pal[1]).multiplyScalar(0.3),roughness:0.9}), // 5:-Z back (hidden)
        ]);
        mesh.position.set(cx,cy,0);
        mesh.rotation.y=REST_ROT_Y;
        scene.add(mesh);

        allSpineMeshes.push(mesh);
        spineData.push({mesh,cfg,x:cx,y:cy,restY:cy,rowY,visible:true});
      });
    });

    // ── Pulled-book state ─────────────────────────────────────────────────────
    let pulledMesh=null;   // the full 6-face book shown when pulled
    let pulledSd=null;     // spineData entry
    let rotState=0;        // 0=spine(lifted), 1=front cover, 2=back cover

    function destroyPulled(){
      if(!pulledMesh) return;
      scene.remove(pulledMesh);
      if(Array.isArray(pulledMesh.material))
        pulledMesh.material.forEach(m=>{m.map?.dispose();m.dispose();});
      pulledMesh.geometry.dispose();
      pulledMesh=null;
    }

    // Full 6-face book — fixed display size regardless of which book was clicked
    // Face assignment (at rotation.y = REST_ROT_Y = -PI/2):
    //   face 0 (+X) → spine faces camera ✓ (matching shelf orientation)
    // At rotation.y = 0:
    //   face 4 (+Z) → FRONT COVER faces camera ✓
    // At rotation.y = PI:
    //   face 5 (-Z) → BACK COVER faces camera ✓
    function buildFullBook(cfg, DISPLAY_W, DISPLAY_H, DISPLAY_D){
      const frontTex=makeFrontTex(cfg);
      const backTex=makeBackTex(cfg);
      const spineTex=makeSpineTex(cfg,64,512);
      const geo=new THREE.BoxGeometry(DISPLAY_W,DISPLAY_H,DISPLAY_D);
      const mesh=new THREE.Mesh(geo,[
        new THREE.MeshStandardMaterial({map:pageTex,  roughness:0.92,metalness:0}),    // 0:+X fore-edge
        new THREE.MeshStandardMaterial({map:spineTex, roughness:0.80,metalness:0.04}), // 1:-X SPINE ← faces camera at REST_ROT_Y=+PI/2
        new THREE.MeshStandardMaterial({map:pageTex,  roughness:0.92,metalness:0}),    // 2:+Y top
        new THREE.MeshStandardMaterial({map:pageTex,  roughness:0.92,metalness:0}),    // 3:-Y bottom
        new THREE.MeshStandardMaterial({map:frontTex, roughness:0.76,metalness:0.08}), // 4:+Z FRONT COVER
        new THREE.MeshStandardMaterial({map:backTex,  roughness:0.82,metalness:0.04}), // 5:-Z BACK COVER
      ]);
      // Async-load real cover image if available (CORS proxy)
      if(cfg.book.coverUrl){
        new THREE.TextureLoader().load(
          `https://images.weserv.nl/?url=${encodeURIComponent(cfg.book.coverUrl)}&w=512&output=jpg`,
          (tex)=>{ const m=mesh.material[4]; if(m){m.map?.dispose();m.map=tex;m.needsUpdate=true;} },
          undefined,
          ()=>{}  // silently ignore load errors (keeps procedural fallback)
        );
      }
      return mesh;
    }

    // ── Tweens ────────────────────────────────────────────────────────────────
    const tweens=new Set();
    let hovSd=null;

    // ── Raycaster helpers ─────────────────────────────────────────────────────
    const ray=new THREE.Raycaster();
    const mp=new THREE.Vector2();

    function getEventXY(e){ // normalise mouse & touch
      const src=e.touches?.[0]??e;
      return {cx:src.clientX, cy:src.clientY};
    }

    function hitSpine(cx,cy){
      if(pulledMesh) return null;
      const r=renderer.domElement.getBoundingClientRect();
      mp.set(((cx-r.left)/r.width)*2-1,((cy-r.top)/r.height)*-2+1);
      ray.setFromCamera(mp,camera);
      const vis=spineData.filter(sd=>sd.visible).map(sd=>sd.mesh);
      const hs=ray.intersectObjects(vis);
      if(!hs.length) return null;
      return spineData.find(sd=>sd.mesh===hs[0].object)||null;
    }

    function hitPulled(cx,cy){
      if(!pulledMesh) return false;
      const r=renderer.domElement.getBoundingClientRect();
      mp.set(((cx-r.left)/r.width)*2-1,((cy-r.top)/r.height)*-2+1);
      ray.setFromCamera(mp,camera);
      return ray.intersectObject(pulledMesh).length>0;
    }

    // ── Hover: lift spine on mouseover ────────────────────────────────────────
    function onMouseMove(e){
      if(pulledMesh) return;
      const {cx,cy}=getEventXY(e);
      const sd=hitSpine(cx,cy);
      if(sd===hovSd) return;
      if(hovSd){
        const h=hovSd;
        const tw=mkTw({v:h.mesh.position.y},{v:h.restY},150,easeO,null);
        tw._tick=()=>{h.mesh.position.y=tw.obj.v;};
        tweens.add(tw);
      }
      hovSd=sd;
      if(sd){
        const tw=mkTw({v:sd.mesh.position.y},{v:sd.restY+HOVER_RISE},150,easeO,null);
        tw._tick=()=>{sd.mesh.position.y=tw.obj.v;};
        tweens.add(tw);
        renderer.domElement.style.cursor='pointer';
        tooltipCbRef.current?.({
          title: sd.cfg.book.t||'',
          author: sd.cfg.book.a||'',
        });
      } else {
        renderer.domElement.style.cursor='';
        tooltipCbRef.current?.(null);
      }
    }

    function onMouseLeave(){
      if(hovSd){
        const h=hovSd;
        const tw=mkTw({v:h.mesh.position.y},{v:h.restY},150,easeO,null);
        tw._tick=()=>{h.mesh.position.y=tw.obj.v;};
        tweens.add(tw);
        hovSd=null;
      }
      renderer.domElement.style.cursor='';
      tooltipCbRef.current?.(null);
    }

    // ── Swipe / drag state (for pulled book rotation) ─────────────────────────
    let dragStart=null;   // {cx, cy, rotY} at pointerdown
    let dragging=false;   // true once moved > TAP_THRESHOLD px
    let dragVel=0;        // rotational velocity for momentum
    let lastDragX=0;
    const TAP_THRESHOLD=8;       // px — below this it's a tap, not a swipe
    const DRAG_SENSITIVITY=0.006; // radians per pixel
    // Face snap angles: spine=-PI/2, front=0, back=PI
    const SNAP_ANGLES=[Math.PI/2, 0, Math.PI]; // spine(rest), front cover, back cover

    function nearestSnap(y){
      // Normalise to [-PI, PI] range first
      let n=((y+Math.PI)%(2*Math.PI)+2*Math.PI)%(2*Math.PI)-Math.PI;
      return SNAP_ANGLES.reduce((a,b)=>Math.abs(b-n)<Math.abs(a-n)?b:a);
    }

    function snapBook(){
      if(!pulledMesh) return;
      const pm=pulledMesh;
      const target=nearestSnap(pm.rotation.y);
      // Update rotState to match
      if(Math.abs(target)<0.01) rotState=1;                                     // front cover
      else if(Math.abs(target-Math.PI)<0.01||Math.abs(target+Math.PI)<0.01) rotState=2; // back cover
      else rotState=0; // spine (PI/2)
      const rot={y:pm.rotation.y};
      // Shortest path to target
      let diff=target-rot.y;
      while(diff>Math.PI) diff-=2*Math.PI;
      while(diff<-Math.PI) diff+=2*Math.PI;
      const tw=mkTw(rot,{y:rot.y+diff},320,easeIO,null);
      tw._tick=()=>{pm.rotation.y=rot.y;};
      tweens.add(tw);
    }

    // ── Pointer down: start drag or shelf-click ───────────────────────────────
    function onPointerDown(e){
      const {cx,cy}=getEventXY(e);
      if(pulledMesh&&pulledSd){
        // Start tracking for swipe on pulled book
        dragStart={cx,cy,rotY:pulledMesh.rotation.y};
        lastDragX=cx;
        dragging=false;
        dragVel=0;
      }
    }

    // ── Pointer move: drive book rotation 1:1 with finger ────────────────────
    function onPointerMove(e){
      if(!pulledMesh||!dragStart) return;
      const {cx}=getEventXY(e);
      const dx=cx-dragStart.cx;
      if(!dragging&&Math.abs(dx)>TAP_THRESHOLD) dragging=true;
      if(dragging){
        dragVel=cx-lastDragX;
        lastDragX=cx;
        pulledMesh.rotation.y=dragStart.rotY - dx*DRAG_SENSITIVITY;
      }
    }

    // ── Pointer up: snap or tap ───────────────────────────────────────────────
    function onPointerUp(e){
      const {cx,cy}=getEventXY(e);
      if(pulledMesh&&pulledSd){
        if(dragging){
          // Apply momentum then snap to nearest face
          if(Math.abs(dragVel)>1.5){
            pulledMesh.rotation.y -= dragVel*DRAG_SENSITIVITY*8;
          }
          snapBook();
          dragStart=null; dragging=false; dragVel=0;
          return;
        }
        // It was a tap — decide based on where
        dragStart=null;
        if(hitPulled(cx,cy)){
          // Tapped the book → open modal
          openWithTransition();
        } else {
          // Tapped outside → shelve
          shelveBook();
        }
        return;
      }

      // No pulled book — tap on a shelf spine to pull it out
      if(dragging){ dragStart=null; dragging=false; return; }
      dragStart=null;
      const sd=hitSpine(cx,cy);
      if(!sd) return;
      pullBook(sd);
    }

    // ── Pull a book off the shelf ─────────────────────────────────────────────
    function pullBook(sd){
      hovSd=null;
      renderer.domElement.style.cursor='';
      sd.visible=false;
      sd.mesh.visible=false;

      const spW=sd.cfg.spW, spH=sd.cfg.spH, spD=sd.cfg.spD;
      pulledMesh=buildFullBook(sd.cfg,spW,spH,spD);
      pulledMesh.position.set(sd.x,sd.y,0);
      pulledMesh.rotation.y=REST_ROT_Y;
      pulledSd=sd;
      rotState=0;
      scene.add(pulledMesh);

      // Phase 1: fly to center, scale up, rotate to front cover
      const pm=pulledMesh;
      const pos={x:sd.x,y:sd.y,z:0};
      const rot={y:REST_ROT_Y};
      const scP={sx:1,sy:1,sz:1};
      const tX=DISPLAY_W/spW, tY=DISPLAY_H/spH, tZ=DISPLAY_D/spD;

      const ptw=mkTw(pos,{x:0,y:displayY,z:displayZ},700,easeIO,()=>{rotState=1;});
      ptw._tick=()=>{ pm.position.set(pos.x,pos.y,pos.z); };
      tweens.add(ptw);

      const stw=mkTw(scP,{sx:tX,sy:tY,sz:tZ},700,easeIO,null);
      stw._tick=()=>{ pm.scale.set(scP.sx,scP.sy,scP.sz); };
      tweens.add(stw);

      const rtw=mkTw(rot,{y:0},700,easeIO,null);
      rtw._tick=()=>{ pm.rotation.y=rot.y; };
      tweens.add(rtw);
    }

    function shelveBook(){
      if(!pulledMesh||!pulledSd) return;
      dragStart=null; dragging=false;
      const pm=pulledMesh, sd=pulledSd;
      const pos={x:pm.position.x,y:pm.position.y,z:pm.position.z};
      const rot={y:pm.rotation.y};
      const scP={sx:pm.scale.x,sy:pm.scale.y,sz:pm.scale.z};
      const ptw=mkTw(pos,{x:sd.x,y:sd.restY,z:0},440,easeIO,()=>{
        tooltipCbRef.current=null; setTooltip(null);
      destroyPulled();
        sd.mesh.visible=true; sd.visible=true;
        pulledSd=null; rotState=0;
      });
      ptw._tick=()=>{ pm.position.set(pos.x,pos.y,pos.z); };
      tweens.add(ptw);
      const stw=mkTw(scP,{sx:1,sy:1,sz:1},440,easeIO,null);
      stw._tick=()=>{ pm.scale.set(scP.sx,scP.sy,scP.sz); };
      tweens.add(stw);
      const rtw=mkTw(rot,{y:REST_ROT_Y},440,easeIO,null);
      rtw._tick=()=>{ pm.rotation.y=rot.y; };
      tweens.add(rtw);
    }

    function openWithTransition(){
      if(!pulledMesh||!pulledSd) return;
      const pm=pulledMesh, sd=pulledSd;
      const sc={v:1};
      const tw=mkTw(sc,{v:1.12},340,easeIO,()=>{
        if(!Array.isArray(pm.material)) return;
        pm.material.forEach(m=>{
          m.transparent=true;
          const op={v:1};
          const fade=mkTw(op,{v:0},200,easeO,()=>{
            tooltipCbRef.current=null; setTooltip(null);
      destroyPulled();
            sd.mesh.visible=true; sd.visible=true;
            pulledSd=null; rotState=0;
            if(onOpenBook) onOpenBook(sd.cfg.book);
          });
          fade._tick=()=>{ m.opacity=op.v; };
          tweens.add(fade);
        });
      });
      tw._tick=()=>{ pm.scale.setScalar(sc.v); };
      tweens.add(tw);
    }

    function onKey(e){
      if(e.key==='Escape'&&pulledMesh) shelveBook();
    }

    // ── Event listeners ───────────────────────────────────────────────────────
    // Use pointer events for unified mouse+touch, mousemove for desktop hover
    // Wire tooltip callback so event handlers can update React state
    tooltipCbRef.current = (data) => setTooltip(data);

    renderer.domElement.addEventListener('mousemove', onMouseMove);
    renderer.domElement.addEventListener('mouseleave', onMouseLeave);
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerup', onPointerUp);
    window.addEventListener('keydown', onKey);

    // ── Render loop ───────────────────────────────────────────────────────────
    const timer=new THREE.Timer();
    let lastT=0;

    function animate(){
      rafRef.current=requestAnimationFrame(animate);
      timer.update();
      const now=timer.getElapsed();
      const dt=Math.min((now-lastT)*1000,80);
      lastT=now;

      for(const tw of tweens){
        tw._tick?.();
        const done=stepTw(tw,dt);
        tw._tick?.();
        if(done) tweens.delete(tw);
      }

      // Smooth ortho zoom — always update so zoom feels continuous
      const zDiff = zoomTarget - zoomCurrent;
      if(Math.abs(zDiff) > 0.0005){
        zoomCurrent += zDiff * 0.12;
        camera.zoom = zoomCurrent;
        camera.updateProjectionMatrix();
      }

      renderer.render(scene,camera);
    }
    animate();

    function onResize(){
      const w=el.clientWidth;
      renderer.setSize(w,CH);
      const hw=halfH*(w/CH);
      camera.left=-hw; camera.right=hw;
      camera.top=sceneTop; camera.bottom=sceneBot;
      camera.updateProjectionMatrix();
    }
    window.addEventListener('resize',onResize);

    return ()=>{
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize',onResize);
      window.removeEventListener('keydown',onKey);
      renderer.domElement.removeEventListener('mousemove',onMouseMove);
      renderer.domElement.removeEventListener('mouseleave',onMouseLeave);
      renderer.domElement.removeEventListener('pointerdown',onPointerDown);
      renderer.domElement.removeEventListener('pointermove',onPointerMove);
      renderer.domElement.removeEventListener('pointerup',onPointerUp);
      el.removeEventListener('wheel',onWheel);
      tooltipCbRef.current=null; setTooltip(null);
      destroyPulled();
      spineData.forEach(sd=>{
        sd.mesh.geometry.dispose();
        if(Array.isArray(sd.mesh.material)) sd.mesh.material.forEach(m=>{m.map?.dispose();m.dispose();});
      });
      pageTex.dispose(); boardMat.dispose();
      renderer.dispose();
      if(el.contains(renderer.domElement)) el.removeChild(renderer.domElement);
    };
  },[visible,maxRows,onOpenBook]);

  const cycleMode=()=>{
    const idx=MODES.indexOf(arrangement);
    const next=MODES[(idx+1)%MODES.length];
    setArrangement(next);
    if(next==='shuffle') setSeed(s=>s+1);
  };

  if(!books.length) return(
    <div style={{padding:'2rem 0',color:'rgba(233,223,202,.3)',fontStyle:'italic',textAlign:'center'}}>
      {t('shelfScene.empty')}
    </div>
  );

  return(
    <div style={{position:'relative',width:'100%',marginBottom:'0.5rem'}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'14px'}}>
        <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:'11px',letterSpacing:'.22em',textTransform:'uppercase',color:'rgba(233,223,202,.4)'}}>
          {t('shelfScene.bookCount', { count: books.length })} · <span style={{color:'#d8b66a'}}>{MLABEL[arrangement]}</span>
        </div>
        <button className="btn btn-ghost" onClick={cycleMode}
          style={{fontSize:'11px',letterSpacing:'.14em',textTransform:'uppercase'}}>
          {t('shelfScene.rearrange')}
        </button>
      </div>
      <div style={{position:'relative',width:'100%'}}
        onMouseMove={e=>{
          if(!tooltip) return;
          // position tooltip near cursor but keep inside container
          const r=e.currentTarget.getBoundingClientRect();
          const x=Math.min(e.clientX-r.left+16, r.width-220);
          const y=Math.max(e.clientY-r.top-60, 8);
          setTooltip(t=>t?{...t,x,y}:null);
        }}
      >
        <div ref={mountRef} style={{
          width:'100%',borderRadius:'4px',
          border:'1px solid rgba(201,162,75,.12)',
          background:'linear-gradient(180deg,rgba(0,0,0,.22),rgba(0,0,0,.38))',
          overflow:'hidden',cursor:'default',
        }}/>
        {tooltip&&tooltip.title&&(
          <div style={{
            position:'absolute',
            left: tooltip.x??16, top: tooltip.y??8,
            pointerEvents:'none',
            background:'rgba(14,10,7,0.92)',
            border:'1px solid rgba(201,162,75,0.35)',
            borderRadius:'3px',
            padding:'8px 12px',
            maxWidth:'200px',
            backdropFilter:'blur(4px)',
            zIndex:10,
          }}>
            <div style={{fontFamily:"'Cormorant Garamond',Georgia,serif",fontStyle:'italic',fontWeight:600,fontSize:'14px',color:'#f0e6cc',lineHeight:1.25,marginBottom:'3px'}}>
              {tooltip.title}
            </div>
            {tooltip.author&&(
              <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:'9px',letterSpacing:'.12em',textTransform:'uppercase',color:'rgba(201,162,75,0.7)'}}>
                {tooltip.author}
              </div>
            )}
          </div>
        )}
      </div>
      <div style={{marginTop:'8px',fontFamily:"'JetBrains Mono',monospace",fontSize:'10px',
        letterSpacing:'.12em',textTransform:'uppercase',color:'rgba(233,223,202,.2)',textAlign:'center'}}>
        Scroll to zoom · click a spine · swipe to rotate · tap book to open · Esc to shelve
      </div>
    </div>
  );
}
