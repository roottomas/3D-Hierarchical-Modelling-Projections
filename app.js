import { buildProgramFromSources, loadShadersFromURLS, setupWebGL } from "../../libs/utils.js";
import { ortho, lookAt, perspective, flatten } from "../../libs/MV.js";
import {
  modelView, loadMatrix, multRotationX, multRotationY, multRotationZ,
  multScale, multTranslation, popMatrix, pushMatrix
} from "../../libs/stack.js";

import * as CUBE from '../../libs/objects/cube.js';
import * as CYLINDER from '../../libs/objects/cylinder.js';
import * as SPHERE from '../../libs/objects/sphere.js';
import * as PYRAMID from '../../libs/objects/pyramid.js';

/**
 * Authors:
 * Ricardo Laur 68342 r.laur@campus.fct.unl.pt
 * Tomás Silvestre 68594 tm.silvestre@campus.fct.unl.pt
 * AI Disclaimer: We used ChatGPT to correct some syntax/logic errors
 * that we came upon throughout the making of the project,
 * as well as to help us with some questions we had,
 * during the making of the barrel minigame.
 */

let canvas, gl, program;
let mode;

// Projection / view
let parallel = true, multiView = false, oblique = false;
let obliqueParams = { alpha:45, l:0.5 };
let zoom = 1.0;

// Camera preset
let activePreset = 1;

// Tank state (trimmed to used fields)
const TANK = {
  x: 0,
  prevX: 0,
  turretYaw: 0,
  cannonPitch: 90,
  wheelAngle: 90,
  wheelRotation: 0,
  moveSpeed: 0.05,
  angle: 1
};

// Tomatoes
let tomatoes = [];
const G = -9.8;
let lastTime = 0;

const COLS = 20, ROWS = 20;

let scene = null;

// single place to be populated by syncNodesWithTankSizes()
const NODES = {};

// GAMEMODE
let gameModeActive = false;
let barrels = []; 
// make each tomato fill 1/8 of the barrel 
const BARREL_FILL_INCREMENT = 0.125; 
const TOMATO_FILL_AMOUNT = BARREL_FILL_INCREMENT;
// approximate tomato visual radius (world units)
const TOMATO_RADIUS = 0.05; 

// transparency alpha for the outer shell
const TRANSPARENCY_ALPHA = 0.42;

function createBarrels() {
  const r = 0.3;     
  const h = 0.6;     
  const sideZ = -2.0;  
  const xFront = [-6, -4, -2, 0, 2];
  const xBack = xFront.map(x => x - 1.2); 
  barrels = [];

  // create front row
  for (const dx of xFront) {
    barrels.push({
      pos: [dx, h / 2, sideZ],
      radius: r,
      height: h,
      fill: 0.0
    });
  }

  // create middle row
  for (const dx of xBack) {
    barrels.push({
      pos: [dx, h / 2, sideZ - 0.8],
      radius: r,
      height: h,
      fill: 0.0
    });
  }

  // create back row
  for (const dx of xFront) {
    barrels.push({
      pos: [dx, h / 2, sideZ - 1.6],
      radius: r,
      height: h,
      fill: 0.0
    });
  }
}

function clearBarrels() {
  barrels = [];
}

/**
 * initializes WebGL, creates program and geometry, sets GL state and starts render loop.
 */
function setup(shaders) {
  canvas = document.getElementById("gl-canvas");
  gl = setupWebGL(canvas);
  program = buildProgramFromSources(gl, shaders["shader.vert"], shaders["shader.frag"]);
  gl.useProgram(program);
  mode = gl.TRIANGLES;

  CUBE.init(gl);
  CYLINDER.init(gl);
  SPHERE.init(gl);
  PYRAMID.init(gl);

  gl.enable(gl.DEPTH_TEST);
  // enable blending for translucency
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(0.48,0.56,0.65,1);

  setupEventHandlers();
  resize();
  window.addEventListener("resize", resize);

  syncNodesWithTankSizes();

  // load scene.json
  fetch("scene.json")
    .then(resp => resp.json())
    .then(data => {
      scene = data;
      window.requestAnimationFrame(render);
    });
}

/**
 * updates canvas and viewport size to match window.
 */
function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  gl.viewport(0,0,canvas.width,canvas.height);
}

/**
 * registers keyboard and mouse/wheel handlers for interaction.
 */
function setupEventHandlers() {
  document.onkeydown = (ev)=>{
    const k = ev.key.toLowerCase();
    switch(k){
      case 'h':
        const panel = document.getElementById("overlay2");
        if (panel) {
          const isHidden = panel.style.display === "none";
          panel.style.display = isHidden ? "block" : "none";
        }
        break;
      case 'a':
        TANK.turretYaw = Math.min(TANK.turretYaw + 2, 359);
        break;
      case 'd':
        TANK.turretYaw = Math.max(TANK.turretYaw - 2, -359);
        break;
      case 'w': TANK.cannonPitch=Math.max(50,TANK.cannonPitch-2); break;
      case 's': TANK.cannonPitch=Math.min(110,TANK.cannonPitch+2); break;
      case 'q': TANK.x-=TANK.moveSpeed; break;
      case 'e': TANK.x+=TANK.moveSpeed; break;
      case 'z': shootTomato(); break;
      case '0': multiView=!multiView; break;
      case '8':
        if (activePreset === 4) {
          oblique = !oblique;}
        break;
      case '9': parallel=!parallel; break;
      case ' ': mode=(mode===gl.LINES)?gl.TRIANGLES:gl.LINES; break;
      case 'r': resetView(); break;
      case '1': activePreset=1; break;
      case '2': activePreset=2; break;
      case '3': activePreset=3; break;
      case '4': activePreset=4; break;
      case 'm': // toggle gamemode
        gameModeActive = !gameModeActive;
        if (gameModeActive) {
          createBarrels();      
        } else {
          clearBarrels();
        }
  break;
      case 'c':
        TANK.angle +=10;
        break;
      case 'v':
        TANK.angle-=10;
        break;

    }
    if(ev.key==='ArrowLeft') obliqueParams.alpha-=1;
    if(ev.key==='ArrowRight') obliqueParams.alpha+=1;
    if(ev.key==='ArrowUp') obliqueParams.l+=0.2;
    if(ev.key==='ArrowDown') obliqueParams.l-=0.2;
  };

  // wheel zoom
  canvas.addEventListener('wheel',(ev)=>{
    ev.preventDefault();
    zoom*=(ev.deltaY>0)?1.07:(1/1.07);
    zoom=Math.max(0.2,Math.min(4.0,zoom));
  }, {passive:false});
}

/**
 * restores camera and projection-related global settings to defaults.
 */
function resetView(){zoom=1.0; obliqueParams={alpha:45,l:0.5}; parallel=true; multiView=false; activePreset=1;}

/** 
 * return a small object grouping tank dimension constants.
 */
function tankSizes(){
  return {
    baseWidth:220, baseHeight:28, baseDepth:120,
    hullWidth:160, hullHeight:36, hullDepth:100,
    turretWidth:120, turretHeight:40, turretDepth:60,
    turretOffset:8, cannonLen:300, wheelRadius:0.25, wheelThickness:0.03,
  };
}

/**
 * sets shader uniform u_color, if the uniform exists.
 */
function trySetColor(r,g,b,a=1){
  const loc=gl.getUniformLocation(program,"u_color");
  if(loc && loc!==-1) gl.uniform4f(loc,r,g,b,a);
}

/**
 * helper to draw primitives
 */
function drawWithMode(drawFn, args = [], solidColor = [1,1,1,1], lineColor = [0,0,0,1], overlayLines = true) {
  if (mode === gl.LINES) {
    trySetColor(...lineColor);
    uploadModelView();
    drawFn(gl, program, gl.LINES, ...args);
  } else {
    // solid
    trySetColor(...solidColor);
    uploadModelView();
    drawFn(gl, program, gl.TRIANGLES, ...args);

    // wireframe
    if (overlayLines) {
      trySetColor(...lineColor);
      uploadModelView();
      drawFn(gl, program, gl.LINES, ...args);
    }
  }
}

/**
 * renders a checkerboard ground plane composed of many scaled cubes.
 */
function drawGround() {
    const tileSize = 1.2;           
    const tileThickness = 0.02;
    const halfCols = Math.floor(COLS / 2);
    const halfRows = Math.floor(ROWS / 2);

    for (let i = -halfCols; i < halfCols; i++) {
        for (let j = -halfRows; j < halfRows; j++) {
            pushMatrix();
            const cx = i * tileSize;
            const cz = j * tileSize;
            const cy = -tileThickness / 2;
            multTranslation([cx, cy, cz]);
            multScale([tileSize, tileThickness, tileSize]);

            const dark = (i + j) % 2 === 0;
            
            if (dark) {
                trySetColor(0.4, 0.4, 0.4, 1);
            } else {
                trySetColor(0.8, 0.8, 0.8, 1);
            }

            uploadModelView();
            CUBE.draw(gl, program, mode);
            popMatrix();
        }
    }
    trySetColor(1,1,1,1);
}

/** 
 * creates a new tomato projectile positioned at the cannon tip,
 * and with an initial velocitytowards the cannon direction.
 * Stores prevPos on spawn so continuous collision can use it.
 */
function shootTomato() {
  const speed = 5; // initial speed

  // angles in radians
  const yaw = -TANK.turretYaw * Math.PI / 180;
  const pitch = (90 - TANK.cannonPitch) * Math.PI / 180;

  const s = tankSizes();

  const offsetX = (s.baseWidth * 0.52 / 100) - 0.5;
  const turretBaseY = (s.baseHeight * 1.6 / 100) + (s.hullHeight / 175);

  // pivot (base) position of the cannon in world coordinates (before applying barrel offset)
  const pivotX = TANK.x + Math.cos(yaw) * offsetX;
  const pivotY = turretBaseY;
  const pivotZ = Math.sin(yaw) * offsetX;

  // direction vector in world coordinates (unit direction of the cannon)
  const dirX = Math.cos(pitch) * Math.cos(yaw);
  const dirY = Math.sin(pitch);
  const dirZ = Math.cos(pitch) * Math.sin(yaw);

  // approximate barrel length (matches the scale/translations used when drawing the cylinder)
  const barrelLength = 0.8;
  const offset = 0.02; // small offset to avoid spawning inside the geometry

  // starting position = pivot + direction * (barrelLength + eps)
  const startX = pivotX + dirX * (barrelLength + offset);
  const startY = pivotY + dirY * (barrelLength + offset);
  const startZ = pivotZ + dirZ * (barrelLength + offset);

  // velocity along direction
  const vx = speed * dirX;
  const vy = speed * dirY;
  const vz = speed * dirZ;

  tomatoes.push({
    pos: [startX, startY, startZ],
    prevPos: [startX, startY, startZ],
    vel: [vx, vy, vz],
    alive: true
  });
}

/**
 * renders all active tomato projectiles.
 */
function drawTomatoes() {
  for (let t of tomatoes) {
    if (!t.alive) continue;

    pushMatrix();
    multTranslation(t.pos);

    // Sphere (tomato body)
    pushMatrix();
    const sphereScale = TOMATO_RADIUS; 
    multScale([sphereScale, sphereScale, sphereScale]);
    uploadModelView();
    drawWithMode(SPHERE.draw, [], [0.8,0.1,0.1,1], [0,0,0,1], false);
    popMatrix();

    // Stem
    const sphereRadius = 0.5 * sphereScale;
    const stemHeight = 0.005;  
    const stemRadius = 0.02;  
    pushMatrix();
      multTranslation([0, sphereRadius + stemHeight*0.5, 0]);
      multScale([stemRadius, stemHeight, stemRadius]);
      uploadModelView();
      drawWithMode(CYLINDER.draw, [], [0.12,0.55,0.12,1], [0,0,0,1], false);
    popMatrix();

    // Top cap
    const capHeight = 0.002;     
    const capRadius = 0.03;  
    pushMatrix();
      multTranslation([0, sphereRadius + stemHeight + capHeight*0.5, 0]);
      multScale([capRadius, capHeight, capRadius]);
      uploadModelView();
      drawWithMode(CYLINDER.draw, [], [0.1,0.45,0.1,1], [0,0,0,1], false);
    popMatrix();

    // Thin stalk on top
    const stalkHeight = 0.01;     
    const stalkRadius = 0.005;    
    pushMatrix();
      multTranslation([0, sphereRadius + stemHeight + capHeight + stalkHeight*0.5, 0]);
      multScale([stalkRadius, stalkHeight, stalkRadius]);
      uploadModelView();
      drawWithMode(CYLINDER.draw, [], [0.08,0.35,0.08,1], [0,0,0,1], false);
    popMatrix();
    popMatrix();
  }
}

/**
 * helper: check segment intersection with vertical cylinder (axis aligned in Y)
 * returns true if intersects within barrel bounds.
 */
function segmentIntersectsBarrel(prev, curr, b) {
  // barrel axis center in XZ plane
  const cx = b.pos[0], cz = b.pos[2];
  const r = b.radius;
  const tol = 0.03; // small vertical tolerance

  // vector of segment
  const vx = curr[0] - prev[0];
  const vy = curr[1] - prev[1];
  const vz = curr[2] - prev[2];

  const px = prev[0], pz = prev[2];
  const dx = vx, dz = vz;
  const ux = cx - px, uz = cz - pz;

  const denom = dx*dx + dz*dz;
  let tClosest = 0;
  if (denom > 1e-8) {
    tClosest = (ux*dx + uz*dz) / denom;
    tClosest = Math.max(0, Math.min(1, tClosest));
  } else {
    // movement mostly vertical: evaluate at t = 0
    tClosest = 0;
  }

  // closest point on segment in XZ
  const closestX = px + tClosest * dx;
  const closestZ = pz + tClosest * dz;
  const distSq = (closestX - cx)*(closestX - cx) + (closestZ - cz)*(closestZ - cz);

  const threshold = r + TOMATO_RADIUS * 0.9;
  if (distSq > threshold * threshold) {
    return false;
  }

  // check Y at tClosest
  const yAtT = prev[1] + tClosest * vy;
  const barrelBottom = b.pos[1] - b.height / 2;
  const barrelTop = b.pos[1] + b.height / 2;

  if (yAtT >= barrelBottom - tol && yAtT <= barrelTop + tol) {
    return true;
  }

  // if the vertical movement can cross barrel Y range at some other t, check Y overlap for whole segment
  const minY = Math.min(prev[1], curr[1]);
  const maxY = Math.max(prev[1], curr[1]);
  if (maxY < barrelBottom - tol || minY > barrelTop + tol) return false;
  return true;
}

/**
 * draw barrels (outer shell + inner fill) if gamemode active.
 */
function drawBarrels() {
  if (!gameModeActive || !barrels || barrels.length === 0) return;

  for (const b of barrels) {
    // draw inner fill first (opaque red) that grows bottom-up
    if (b.fill > 0) {
      const fillRatio = Math.max(0, Math.min(1, b.fill));
      const fillHeight = b.height * fillRatio;

      pushMatrix();
        // position the fill so it sits at the bottom of the barrel and grows upward:
        // barrel center is at b.pos; bottom is b.pos[1] - b.height/2
        const fillCenterY = b.pos[1] - b.height / 2 + (fillHeight / 2);
        multTranslation([b.pos[0], fillCenterY, b.pos[2]]);
        // scale inner fill using SAME basis as outer shell (so heights match)
        multScale([b.radius * 0.92, fillHeight, b.radius * 0.92]);
        uploadModelView();
        trySetColor(0.82, 0.08, 0.08, 1.0); // opaque red
        CYLINDER.draw(gl, program, mode);
      popMatrix();
    }

    // draw outer shell as semi-transparent grey, and disable depth mask so inner is visible through it
    gl.depthMask(false);
    pushMatrix();
      multTranslation(b.pos);
      // scale outer shell using same Y basis as fill 
      multScale([b.radius, b.height, b.radius]);
      uploadModelView();
      trySetColor(0.48, 0.48, 0.50, TRANSPARENCY_ALPHA); // grey-ish translucent
      CYLINDER.draw(gl, program, mode);
    popMatrix();
    gl.depthMask(true);

    // opaque
    pushMatrix();
      multTranslation([b.pos[0], b.pos[1] + b.height/2 + 0.005, b.pos[2]]);
      multScale([b.radius * 1.02, 0.005, b.radius * 1.02]);
      uploadModelView();
      trySetColor(0.15, 0.08, 0.03, 1.0);
      CYLINDER.draw(gl, program, mode);
    popMatrix();
  }
}

/**
 * updates on-screen HTML overlays with current tomato count, view preset and render mode.
 * fetches elements by id and assigns textContent where present.
 */
function updateOverlay() {
  const countEl = document.getElementById("tomato-count");
  if (countEl) countEl.textContent = tomatoes.length;
  
  const viewEl = document.getElementById("view-id");
  if (viewEl) viewEl.textContent = activePreset;

  const modeEl = document.getElementById("mode-id");
  if (modeEl) modeEl.textContent = (mode === gl.LINES) ? "wireframe" : "solid";

  const gmEl = document.getElementById("gamemode-id");
  if (gmEl) gmEl.textContent = gameModeActive ? "ON (m to toggle)" : "OFF (m to toggle)";

  // show barrels fill summary if present
  const barrelsEl = document.getElementById("barrels-info");
  if (barrelsEl) {
    if (!gameModeActive || !barrels || barrels.length === 0) barrelsEl.textContent = "—";
    else {
      barrelsEl.textContent = barrels.map((b,i) => `B${i+1}: ${(b.fill*100).toFixed(0)}%`).join("  ");
    }
  }
}

/**
 * uploads projection matrix to shader uniform u_projection if present.
 * gets uniform location and calls uniformMatrix4fv with flattened matrix.
 */
function uploadProjection(mProj){
  const loc=gl.getUniformLocation(program,"u_projection");
  if(loc && loc!==-1) gl.uniformMatrix4fv(loc,false,flatten(mProj));
}

/** 
 * uploads current model-view matrix to shader uniform u_model_view.
 * queries the uniform location and passes the flattened modelView() matrix.
 */
function uploadModelView(){
  const loc=gl.getUniformLocation(program,"u_model_view");
  if(loc && loc!==-1) gl.uniformMatrix4fv(loc,false,flatten(modelView()));
}

/**
 * computes a reasonable orthographic view size based on tank geometry and zoom.
 * by measuring key tank dimensions, and returns a scaled value influenced by zoom.
 * This to keep the tank framed in both ortho and perspective presets.
 */
function computeOrthoSize(){
  const s=tankSizes();
  const baseW=s.baseWidth/100, baseD=s.baseDepth/140;
  const hullH=s.hullHeight/80, turretH=s.turretHeight/80;
  return Math.max(baseW,baseD,hullH+turretH,1.2)*1.6*zoom;
}

/**
 * set projection/view for a camera preset and draw scene content (ground, tank, tomatoes).
 * chooses projection based on flags, loads view matrix, sets lighting uniforms, then draws objects.
 */
function drawSceneForPreset(presetId, dt, vpW, vpH) {
    const aspect = vpW / vpH;
    const orthoSize = computeOrthoSize();
    const s = tankSizes();
    const tankCenterY = s.baseHeight / 100 + s.hullHeight / 160;

    let mView, mProjection;

       if (presetId === 4 && oblique) {
        const alphaRad = obliqueParams.alpha * Math.PI / 180;
        const l = obliqueParams.l;
        const camX = 4 + Math.tan(alphaRad) * l;
        const camY = 2 + l;
        const camZ = 4;
        mProjection = ortho(-aspect * orthoSize, aspect * orthoSize, -orthoSize, orthoSize, 0.1, 1000);
        mView = lookAt([camX, camY, camZ], [0, tankCenterY, 0], [0, 1, 0]);
    } else {
        mProjection = parallel
            ? ortho(-aspect * orthoSize, aspect * orthoSize, -orthoSize, orthoSize, -1000, 1000)
            : perspective(45, aspect, 0.1, 2000);

        if (presetId === 1) mView = lookAt([orthoSize * 1.5, tankCenterY, 0], [0, tankCenterY, 0], [0, 1, 0]);
        else if (presetId === 2) mView = lookAt([0, orthoSize * 3.5, 0.01], [0, tankCenterY, 0], [0, 0, -1]);
        else if (presetId === 3) mView = lookAt([0, tankCenterY, orthoSize * 1.5], [0, tankCenterY, 0], [0, 1, 0]);
        else if (presetId === 4) mView = lookAt([4, 2, 4], [0, tankCenterY, 0], [0, 1, 0]);
    }

    uploadProjection(mProjection);
    loadMatrix(mView);

    //(simple static lights for shading)
    const lightPosLoc = gl.getUniformLocation(program, "u_light_pos");
    if (lightPosLoc) gl.uniform3fv(lightPosLoc, [5, 10, 5]);
    const viewPosLoc = gl.getUniformLocation(program, "u_view_pos");
    if (viewPosLoc) gl.uniform3fv(viewPosLoc, [0, 3, 5]);

    // draw scene
    drawGround();
    if (scene) drawTankFromJSON(scene);

    // draw barrels (only when gamemode active)
    drawBarrels();
    drawTomatoes();
}

function drawNode(nodeRef) {
  const node = NODES[nodeRef];
  pushMatrix();

  if (node.translation) multTranslation(node.translation);
  if (nodeRef === "TURRET_NODE") {
    multRotationY(TANK.turretYaw || 0);
    drawFlag();
  }

  // scale 
  if (node.scale) multScale(node.scale);

  // draw primitives 
  if (node.type === "CUBE") {
    drawWithMode(CUBE.draw, [], node.color || [0.8,0.8,0.8,1], [0,0,0,1]);
  } else if (node.type === "CYLINDER") {
    drawWithMode(CYLINDER.draw, [], node.color || [0.8,0.8,0.8,1], [0,0,0,1]);
  } else if (node.type === "SPHERE") {
    drawWithMode(SPHERE.draw, [0, Math.PI/2], node.color || [0.8,0.8,0.8,1], [0,0,0,1]);
  } else if (node.type === "GROUP") {
  }

  // apply wheel rotations per wheel
  if (node.wheels) {
    for (let w of node.wheels) {
      pushMatrix();
        multTranslation(w.translation);
        multRotationX(TANK.wheelAngle || 0);
        multRotationY(TANK.wheelRotation || 0);
        if (w.scale) multScale(w.scale);
        drawWithMode(CYLINDER.draw, [], [0.85, 0.15, 0.15, 1], [0,0,0,1]);

        const sideSign = (w.translation[2] >= 0) ? 1 : -1;

        pushMatrix();
          multTranslation([0, sideSign*0.6, 0]);
          multScale([0.5, 0.6, 0.5]); 
          drawWithMode(CYLINDER.draw, [], [0.1, 0.6, 0.1, 1], [0,0,0,1]);
        popMatrix();
        
        pushMatrix();
          multTranslation([0, sideSign*1, 0]);     
          multScale([0.08, 1, 0.08]);     
          drawWithMode(CYLINDER.draw, [], [0.1, 0.6, 0.1, 1], [0,0,0,1]);
        popMatrix();

        pushMatrix();
          multTranslation([0, sideSign*1.5, 0]);  
          multRotationZ(45);             
          multTranslation([0.15, 0, 0]);    
          multScale([0.25, 0.05, 0.25]);    
          drawWithMode(PYRAMID.draw, [], [0.1, 0.6, 0.1, 1], [0,0,0,1]);
        popMatrix();

      popMatrix();
    }
  }

  if (node.children) {
    for (let child of node.children) {
      if (child.ref === "CANNON_NODE") {
  const s = tankSizes();

  // Half cylinder 
  pushMatrix();
    multTranslation([s.baseWidth * 0.3 / 100, 0, 0]);
    multRotationX(90);
    multRotationY(-TANK.cannonPitch || 0);
    multScale([0.2, 0.2, 0.2]);
    drawWithMode(CYLINDER.draw, [0, Math.PI], [0.1, 0.6, 0.1, 1], [0,0,0,1]);
  popMatrix();

  // Barrel 
  pushMatrix();
    multTranslation([s.baseWidth * 0.52 / 100, 0, 0]);
    multTranslation([-0.5, 0, 0]);
    multRotationZ(-TANK.cannonPitch || 0);
    multTranslation([0, 0.5, 0]);
    multScale([0.05, 0.8, 0.05]);
    drawWithMode(CYLINDER.draw, [], [0.1, 0.6, 0.1, 1], [0,0,0,1]);
  popMatrix();
}
 // regular child (TURRET_CUBE, TURRET_HALFSPHERE, TURRET_TOP_CYL, etc.)
 else {drawNode(child.ref);}
    }
  }
  popMatrix();
}

/**
 * Draws the tank model described in a JSON scene graph,
 * by recursively drawing all its child nodes (e.g., hull, turret, cannon).
 */
function drawTankFromJSON(json) {
  const root = json || scene;
  pushMatrix();
    multTranslation([TANK.x, 0, 0]);
    multRotationY(TANK.angle);
    for (let child of root.children || []) {
      drawNode(child.ref);
    }
  popMatrix();
}

// draws the flag that is on top of the tank
function drawFlag() {
  const s = tankSizes();
  pushMatrix();
    // translation towards the top of the tower
    multTranslation([0, s.turretHeight / 100 + 0.3, 0]);

    pushMatrix();
      multScale([0.02, 1, 0.02]);
      drawWithMode(CYLINDER.draw, [], [0.1,0.6,0.1,1],[0,0,0,1]);
    popMatrix();

    // flag
    pushMatrix();
      multTranslation([0.15, 0.4, 0]); 
      multScale([0.3, 0.2, 0.01]);      
      drawWithMode(CUBE.draw, [], [1,0,0,1],[0,0,0,1]); // red
    popMatrix();

    // tomato drawn in flag
    pushMatrix();
      multTranslation([0.15, 0.4, 0]);
      multScale([0.1,0.1,0.1]);
      drawWithMode(SPHERE.draw, [], [0.8,0.1,0.1,1],[0,0,0,1]);
    popMatrix();
    pushMatrix();
      multTranslation([0.15, 0.45, 0]);
      multScale([0.05,0.01,0.05]);
      drawWithMode(CYLINDER.draw, [], [0.1,0.6,0.1,1],[0,0,0,1]);
    popMatrix();
  popMatrix();
}


/**
 * Populates the global NODES object with tank components.
 * Sets positions, scales, and colors for all parts (base, hull, turret, cannon, wheels).
 */
function syncNodesWithTankSizes() {
  const s = tankSizes();
  NODES.BASE_NODE = {
    type: "CUBE",
    translation: [0, s.baseHeight / 105, 0],
    scale: [s.baseWidth * 0.7 / 90, s.baseHeight * 1.5 / 100, s.baseDepth * 0.7 / 120],
    color: [0.6, 0.1, 0.1, 1]
  };
  NODES.HULL_NODE = {
    type: "CUBE",
    translation: [0, (s.baseHeight * 1 / 150) + (s.hullHeight / 180), 0],
    scale: [s.baseWidth * 1.0 / 110, s.hullHeight / 180, s.baseDepth * 1.0 / 120],
    color: [0.8, 0.2, 0.2, 1]
  };
  NODES.TURRET_NODE = {
    type: "GROUP",
    translation: [0, (s.baseHeight * 1.6 / 100) + (s.hullHeight / 175), 0],
    children: [
      { ref: "TURRET_CUBE" },
      { ref: "TURRET_HALFSPHERE" },
      { ref: "TURRET_TOP_CYL" },
      { ref: "CANNON_NODE" }
    ]
  };
  NODES.TURRET_CUBE = {
    type: "CUBE",
    scale: [s.baseWidth * 0.6 / 100, s.turretHeight / 122, s.baseDepth * 0.6 / 120],
    color: [0.7, 0.1, 0.1, 1]
  };
  NODES.TURRET_HALFSPHERE = {
    type: "SPHERE",
    translation: [0, s.turretHeight / 600, 0],
    scale: [0.5, 0.5, 0.5],
    color: [0.1, 0.6, 0.1, 1]
  };
  NODES.TURRET_TOP_CYL = {
    type: "CYLINDER",
    translation: [0, s.turretHeight / 600 + 0.5 * 0.5 - 0.02, 0],
    scale: [0.2, 0.08, 0.2],
    color: [0.1, 0.6, 0.1, 1]
  };
  NODES.CANNON_NODE = {
    type: "GROUP",
    children: [{ ref: "CANNON_HALF" }, { ref: "CANNON_BARREL" }]
  };
  NODES.CANNON_HALF = {
    type: "CYLINDER",
    translation: [s.baseWidth * 0.3 / 100, 0, 0],
    scale: [0.2, 0.2, 0.2],
    color: [0.1, 0.6, 0.1, 1],
    meta: { half: true }
  };
  NODES.CANNON_BARREL = {
    type: "CYLINDER",
    translation: [s.baseWidth * 0.52 / 100 - 0.5, 0, 0],
    scale: [0.05, 0.8, 0.05],
    color: [0.1, 0.6, 0.1, 1]
  };

  // Wheels
  const wheelOffsets = [-70, -42, -14, 14, 42, 70];
  const zOffset = (s.baseDepth * 0.65) / 200;
  const baseBottomY = (s.baseHeight / 260) - (s.baseHeight * 1.6 / 200);
  const wheelY = baseBottomY + s.wheelRadius;
  const wheelRadius = s.wheelRadius;
  const wheelThickness = 0.08;

  NODES.WHEELS_NODE = {
    type: "GROUP",
    color: [0.6, 0.6, 0.6, 1],
    wheels: wheelOffsets.flatMap(off => {
      const xOff = off / 100.0;
      return [
        { translation: [xOff, wheelY, -zOffset], scale: [wheelRadius, wheelThickness, wheelRadius] },
        { translation: [xOff, wheelY,  zOffset], scale: [wheelRadius, wheelThickness, wheelRadius] }
      ];
    })
  };
}

/**
 * main animation loop handler; updates physics and animation state, clears and draws scene, requests next frame.
 */
function render(now){
  now*=0.001;
  const dt=lastTime?now-lastTime:0;
  lastTime=now;

  // tomato physics: first store prevPos, then integrate
  for (let t of tomatoes) {
    if (!t.alive) continue;
    // store previous position for continuous collision detection
    t.prevPos = [t.pos[0], t.pos[1], t.pos[2]];
    // integrate
    t.vel[1] += G * dt;
    t.pos[0] += t.vel[0] * dt;
    t.pos[1] += t.vel[1] * dt;
    t.pos[2] += t.vel[2] * dt;
    if (t.pos[1] < 0) t.alive = false;
  }

  // collision: tomatoes -> barrels (only when gamemode active)
  if (gameModeActive && barrels && barrels.length > 0) {
    for (let t of tomatoes) {
      if (!t.alive) continue;
      for (let b of barrels) {
        if (b.fill >= 1.0) continue; // already full
        // continuous collision test using segment prevPos->pos
        if (segmentIntersectsBarrel(t.prevPos, t.pos, b)) {
          b.fill = Math.min(1.0, b.fill + TOMATO_FILL_AMOUNT);
          t.alive = false;
          break;
        }
      }
    }
  }

  // purge dead tomatoes
  tomatoes = tomatoes.filter(t => t.alive);

  const dx = TANK.x - TANK.prevX;
  if (dx !== 0) {
      const s = tankSizes();
      if(dx < 0){TANK.wheelRotation += 2; }
      else{ TANK.wheelRotation -= 2; }
      TANK.prevX = TANK.x;
  }

  gl.useProgram(program);

  const wide=canvas.width>=canvas.height;
  if(multiView && wide){
    const hw=Math.floor(canvas.width/2), hh=Math.floor(canvas.height/2);
    gl.viewport(0,hh,hw,hh); drawSceneForPreset(1,dt,hw,hh);
    gl.viewport(hw,hh,hw,hh); drawSceneForPreset(2,dt,hw,hh);
    gl.viewport(0,0,hw,hh); drawSceneForPreset(3,dt,hw,hh);
    gl.viewport(hw,0,hw,hh); drawSceneForPreset(4,dt,hw,hh);
  }else{
    gl.viewport(0,0,canvas.width,canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
    drawSceneForPreset(activePreset,dt,canvas.width,canvas.height);
  }
  window.requestAnimationFrame(render);
  updateOverlay();
}

loadShadersFromURLS(["shader.vert","shader.frag"]).then(shaders=>setup(shaders));