// 屏東縣復興國小 360° 實景管理工作台 (Visual 360 CMS Studio)
// Version: 1.0.0
import * as THREE from './vendor/three/three.module.js';
import { OrbitControls } from './vendor/three/addons/controls/OrbitControls.js';

// ==========================================
// 1. Authentication & Security Guard
// ==========================================
const AUTH_KEY = 'fuxing_admin_auth';
const DEFAULT_PASSWORD = 'fuxing360';

function initAuth() {
  const modal = document.getElementById('adminAuthModal');
  const input = document.getElementById('authPasswordInput');
  const btn = document.getElementById('btnSubmitAuth');
  const err = document.getElementById('authErrorMsg');
  const btnLock = document.getElementById('btnLockAuth');

  const isAuthed = sessionStorage.getItem(AUTH_KEY) === '1';
  if (!isAuthed) {
    modal.style.display = 'flex';
    input.focus();
  }

  function verifyPassword() {
    if (input.value.trim() === DEFAULT_PASSWORD) {
      sessionStorage.setItem(AUTH_KEY, '1');
      modal.style.display = 'none';
      err.style.display = 'none';
      input.value = '';
      showToast('歡迎進入 360 實景管理工作台！');
    } else {
      err.style.display = 'block';
      input.select();
    }
  }

  btn.addEventListener('click', verifyPassword);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') verifyPassword(); });

  btnLock?.addEventListener('click', () => {
    sessionStorage.removeItem(AUTH_KEY);
    modal.style.display = 'flex';
    input.value = '';
    showToast('工作台已安全鎖定');
  });
}

// ==========================================
// 2. Data State & Local Storage Management
// ==========================================
const STORAGE_KEY = 'fuxing_360_spots_custom';
let spotsData = [];
let activeSpotId = 'spot-12';
let filterFloor = 'ALL';
let searchQuery = '';
let stepUnit = 0.5;
let isRaycastPickMode = true;

function loadSpotsData() {
  // 1. Priority: Load from localStorage
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) {
        spotsData = parsed;
        console.log(`[CMS] Loaded ${spotsData.length} spots from localStorage.`);
        return;
      }
    } catch (e) {
      console.warn('[CMS] Failed to parse custom spots from localStorage', e);
    }
  }

  // 2. Fallback: Load from window.CAMPUS_360_SPOTS in campus-ui.js
  if (window.CAMPUS_360_SPOTS && Array.isArray(window.CAMPUS_360_SPOTS)) {
    spotsData = JSON.parse(JSON.stringify(window.CAMPUS_360_SPOTS));
  } else {
    spotsData = [];
  }
}

function saveSpotsDataLocally(silent = false) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(spotsData));
    if (!silent) showToast('已保存至本地！前台重新整理即可立即生效');
  } catch (e) {
    alert('保存失敗：' + e.message);
  }
}

function getActiveSpot() {
  return spotsData.find(s => s.id === activeSpotId) || spotsData[0];
}

// ==========================================
// 3. Google Maps Smart URL Parser
// ==========================================
function parseGoogleMapsStreetViewUrl(url) {
  if (!url) return null;
  const result = {
    panoId: '',
    latitude: 22.6594591,
    longitude: 120.4870018,
    heading: 0,
    pitch: 0,
    embedUrl: '',
    externalUrl: url.trim(),
    thumb: '',
    panoUrl: ''
  };

  // Extract panoId: !1s([A-Za-z0-9_-]+)!2e10 or panoid=([A-Za-z0-9_-]+)
  const panoMatch = url.match(/!1s([A-Za-z0-9_-]+)!2e10/) || url.match(/[?&]panoid=([A-Za-z0-9_-]+)/);
  if (panoMatch) result.panoId = panoMatch[1];

  // Extract Coordinates: @lat,lng or !3dlat!4dlng
  const coordMatch = url.match(/@([0-9.]+),([0-9.]+)/) || url.match(/!3d([0-9.]+)!4d([0-9.]+)/);
  if (coordMatch) {
    result.latitude = parseFloat(coordMatch[1]);
    result.longitude = parseFloat(coordMatch[2]);
  }

  // Extract Heading: ya([0-9.-]+) or ,([0-9.]+)y
  const headingMatch = url.match(/ya([0-9.-]+)/) || url.match(/,([0-9.-]+)y/);
  if (headingMatch) result.heading = parseFloat(headingMatch[1]);

  // Extract Pitch: pi([0-9.-]+) or ,([0-9.-]+)t or ,([0-9.-]+)h
  const pitchMatch = url.match(/pi([0-9.-]+)/) || url.match(/,([0-9.-]+)t/);
  if (pitchMatch) result.pitch = parseFloat(pitchMatch[1]);

  // Generate Embed URL (Google official street view svembed protocol)
  result.embedUrl = `https://maps.google.com/maps?layer=c&cbll=${result.latitude},${result.longitude}&panoid=${result.panoId}&cbp=12,${result.heading},,0,${result.pitch}&output=svembed`;

  // Extract or generate thumbnail & high-res pano URL
  const imgMatch = url.match(/6s(https%3A%2F%2F[^\s!]+)/) || url.match(/6s(https:\/\/[^\s!]+)/);
  if (imgMatch) {
    const rawImgUrl = decodeURIComponent(imgMatch[1]);
    result.thumb = rawImgUrl.replace(/=w[0-9]+-h[0-9]+[^=]*/, '=w400-h250-k-no');
    result.panoUrl = rawImgUrl.replace(/=w[0-9]+-h[0-9]+[^=]*/, '=w2048');
  } else if (result.panoId) {
    result.thumb = `https://streetviewpixels-pa.clients6.google.com/v1/thumbnail?cb_client=maps_sv.tactile&w=400&h=250&pitch=0&panoid=${result.panoId}&yaw=${result.heading}`;
    result.panoUrl = `https://streetviewpixels-pa.clients6.google.com/v1/thumbnail?cb_client=maps_sv.tactile&w=2048&h=1024&pitch=0&panoid=${result.panoId}&yaw=${result.heading}`;
  }

  return result;
}

// ==========================================
// 4. UI: Sidebar Spot List & Form Binding
// ==========================================
function renderSpotCards() {
  const container = document.getElementById('spotCardsContainer');
  if (!container) return;
  container.innerHTML = '';

  const q = searchQuery.toLowerCase().trim();
  const filtered = spotsData.filter(s => {
    if (filterFloor !== 'ALL' && s.floor !== filterFloor) return false;
    if (q) {
      const matchName = (s.name || '').toLowerCase().includes(q);
      const matchGroup = (s.group || '').toLowerCase().includes(q);
      const matchId = (s.id || '').toLowerCase().includes(q);
      const matchNum = String(s.num || '').includes(q);
      return matchName || matchGroup || matchId || matchNum;
    }
    return true;
  });

  document.getElementById('spotCountChip').textContent = `景點總數：${filtered.length} / ${spotsData.length} 處`;

  filtered.forEach(s => {
    const card = document.createElement('div');
    card.className = 'spot-card' + (s.id === activeSpotId ? ' is-active' : '');
    card.dataset.id = s.id;

    card.innerHTML = `
      <img src="${s.thumb || './assets/campus_overview_preview.jpg'}" class="spot-card-thumb" onerror="this.src='./assets/campus_overview_preview.jpg'">
      <div class="spot-card-info">
        <div class="spot-card-name">#${s.num} ${s.name}</div>
        <div class="spot-card-sub">
          <span style="color:#a7f3d0;">${s.floor || '1F'}</span>
          <span>·</span>
          <span>${s.group || '校園'}</span>
        </div>
        <div class="spot-card-coords">X:${(s.x||0).toFixed(1)} Y:${(s.y||0).toFixed(1)} Z:${(s.z||0).toFixed(1)}</div>
      </div>
    `;

    card.addEventListener('click', () => {
      selectSpot(s.id);
    });

    container.appendChild(card);
  });
}

function selectSpot(spotId) {
  activeSpotId = spotId;
  const spot = getActiveSpot();
  if (!spot) return;

  // 1. Highlight list card
  document.querySelectorAll('.spot-card').forEach(el => {
    el.classList.toggle('is-active', el.dataset.id === spotId);
  });

  // 2. Fill form
  document.getElementById('activeSpotIdLabel').textContent = `#${spot.id}`;
  document.getElementById('fId').value = spot.id;
  document.getElementById('fNum').value = spot.num || '';
  document.getElementById('fName').value = spot.name || '';
  document.getElementById('fGroup').value = spot.group || '校門與戶外前庭';
  document.getElementById('fFloor').value = spot.floor || '1F';
  document.getElementById('fDesc').value = spot.desc || '';
  document.getElementById('fX').value = (spot.x !== undefined ? spot.x : 0).toFixed(2);
  document.getElementById('fY').value = (spot.y !== undefined ? spot.y : 2.2).toFixed(2);
  document.getElementById('fZ').value = (spot.z !== undefined ? spot.z : 0).toFixed(2);
  document.getElementById('fPx').value = spot.px || 0;
  document.getElementById('fPy').value = spot.py || 0;
  document.getElementById('fThumb').value = spot.thumb || '';
  document.getElementById('fPanoUrl').value = spot.panoUrl || '';
  document.getElementById('fEmbedUrl').value = spot.embedUrl || '';
  document.getElementById('fExternalUrl').value = spot.externalUrl || '';

  // 3. Update HUD
  document.getElementById('hudSpotName').textContent = `#${spot.num} ${spot.name}`;
  updateHudCoords(spot.x, spot.y, spot.z);

  // 4. Update 3D Beacon Focus
  updateThreeActiveSpot(spot);

  // 5. Update 2.5D Plan Marker
  updatePlanActiveSpot(spot);

  // 6. Update Live Preview
  updatePreviewSpot(spot);
}

function updateHudCoords(x, y, z) {
  const el = document.getElementById('hudCoordsDisplay');
  if (el) el.textContent = `X: ${(x||0).toFixed(2)}, Y: ${(y||0).toFixed(2)}, Z: ${(z||0).toFixed(2)}`;
}

function readFormIntoActiveSpot() {
  const spot = getActiveSpot();
  if (!spot) return;

  spot.num = parseInt(document.getElementById('fNum').value, 10) || spot.num;
  spot.name = document.getElementById('fName').value.trim() || spot.name;
  spot.group = document.getElementById('fGroup').value;
  spot.floor = document.getElementById('fFloor').value;
  spot.desc = document.getElementById('fDesc').value.trim();

  spot.x = parseFloat(document.getElementById('fX').value) || 0;
  spot.y = parseFloat(document.getElementById('fY').value) || 2.2;
  spot.z = parseFloat(document.getElementById('fZ').value) || 0;
  spot.pos = [spot.x, spot.y, spot.z];

  spot.px = parseInt(document.getElementById('fPx').value, 10) || 0;
  spot.py = parseInt(document.getElementById('fPy').value, 10) || 0;

  spot.thumb = document.getElementById('fThumb').value.trim();
  spot.panoUrl = document.getElementById('fPanoUrl').value.trim();
  spot.embedUrl = document.getElementById('fEmbedUrl').value.trim();
  spot.externalUrl = document.getElementById('fExternalUrl').value.trim();

  updateHudCoords(spot.x, spot.y, spot.z);
  updateThreePinPosition(spot);
  updatePlanActiveSpot(spot);
}

// ==========================================
// 5. Three.js 3D Viewport Engine
// ==========================================
let tScene, tCamera, tRenderer, tControls;
let tGroundPlane;
let tPinsGroup;
let tActiveBeaconBeam, tActiveReticle;
const tRaycaster = new THREE.Raycaster();
const tMouse = new THREE.Vector2();

function initThreeViewport() {
  const host = document.getElementById('threeCanvasHost');
  if (!host) return;

  const w = host.clientWidth || 800;
  const h = host.clientHeight || 600;

  tScene = new THREE.Scene();
  tScene.background = new THREE.Color(0x0a100e);

  tCamera = new THREE.PerspectiveCamera(45, w / h, 0.5, 2000);
  tCamera.position.set(130, 95, 140);

  tRenderer = new THREE.WebGLRenderer({ antialias: true });
  tRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  tRenderer.setSize(w, h);
  tRenderer.shadowMap.enabled = true;
  host.appendChild(tRenderer.domElement);

  tControls = new OrbitControls(tCamera, tRenderer.domElement);
  tControls.enableDamping = true;
  tControls.dampingFactor = 0.08;
  tControls.maxPolarAngle = Math.PI / 2 - 0.05; // Don't dip below ground

  // Lighting
  const hemi = new THREE.HemisphereLight(0xdcfce7, 0x0f1715, 1.2);
  tScene.add(hemi);

  const dir = new THREE.DirectionalLight(0xfffbeb, 1.5);
  dir.position.set(150, 200, 100);
  tScene.add(dir);

  // Ground Grid & Overview Map Overlay
  const groundGeo = new THREE.PlaneGeometry(600, 450);
  groundGeo.rotateX(-Math.PI / 2);

  const texLoader = new THREE.TextureLoader();
  const groundTex = texLoader.load('./assets/campus_overview_preview.jpg');
  groundTex.colorSpace = THREE.SRGBColorSpace;

  const groundMat = new THREE.MeshStandardMaterial({
    map: groundTex,
    roughness: 0.85,
    metalness: 0.1
  });
  tGroundPlane = new THREE.Mesh(groundGeo, groundMat);
  tGroundPlane.position.set(0, 0, 0);
  tScene.add(tGroundPlane);

  // Invisible Raycast Pick Plane (Wide)
  const pickPlaneGeo = new THREE.PlaneGeometry(2000, 2000);
  pickPlaneGeo.rotateX(-Math.PI / 2);
  const pickPlane = new THREE.Mesh(pickPlaneGeo, new THREE.MeshBasicMaterial({ visible: false }));
  pickPlane.position.y = 0;
  tScene.add(pickPlane);

  // Grid Helper
  const grid = new THREE.GridHelper(600, 60, 0x10b981, 0x1e3a2e);
  grid.position.y = 0.05;
  tScene.add(grid);

  // Pins Group
  tPinsGroup = new THREE.Group();
  tScene.add(tPinsGroup);

  // Active Spot Beacon Beam (Yellow Vertical Light Beam)
  const beamGeo = new THREE.CylinderGeometry(0.4, 1.2, 40, 16);
  const beamMat = new THREE.MeshBasicMaterial({
    color: 0xfacc15,
    transparent: true,
    opacity: 0.6,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  tActiveBeaconBeam = new THREE.Mesh(beamGeo, beamMat);
  tActiveBeaconBeam.position.y = 20;
  tScene.add(tActiveBeaconBeam);

  // Ground Targeting Reticle Ring
  tActiveReticle = new THREE.Mesh(
    new THREE.RingGeometry(0.8, 1.5, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x10b981, transparent: true, opacity: 0.9, side: THREE.DoubleSide })
  );
  tActiveReticle.position.y = 0.2;
  tScene.add(tActiveReticle);

  buildThreePins();

  // Mouse Raycasting & Pick Handling
  tRenderer.domElement.addEventListener('pointerdown', onThreePointerDown);
  tRenderer.domElement.addEventListener('pointermove', onThreePointerMove);

  window.addEventListener('resize', onThreeResize);

  function animate() {
    requestAnimationFrame(animate);
    tControls.update();

    if (tActiveReticle) {
      tActiveReticle.rotation.y += 0.02;
    }
    tRenderer.render(tScene, tCamera);
  }
  animate();
}

function onThreeResize() {
  const host = document.getElementById('threeCanvasHost');
  if (!host || !tRenderer || !tCamera) return;
  tCamera.aspect = host.clientWidth / host.clientHeight;
  tCamera.updateProjectionMatrix();
  tRenderer.setSize(host.clientWidth, host.clientHeight);
}

function buildThreePins() {
  if (!tPinsGroup) return;
  while (tPinsGroup.children.length > 0) {
    const c = tPinsGroup.children.pop();
    if (c.geometry) c.geometry.dispose();
  }

  const pinConeGeo = new THREE.ConeGeometry(1.6, 5.0, 16);
  pinConeGeo.rotateX(Math.PI); // Point down
  pinConeGeo.translate(0, 3.5, 0);

  spotsData.forEach(s => {
    const isAct = s.id === activeSpotId;
    const mat = new THREE.MeshStandardMaterial({
      color: isAct ? 0xfacc15 : 0x10b981,
      roughness: 0.3,
      metalness: 0.2,
      emissive: isAct ? 0xfacc15 : 0x059669,
      emissiveIntensity: isAct ? 0.6 : 0.2
    });
    const mesh = new THREE.Mesh(pinConeGeo, mat);
    mesh.position.set(s.x || 0, s.y || 2.2, s.z || 0);
    mesh.userData = { isSpotPin: true, spotId: s.id };

    tPinsGroup.add(mesh);
  });
}

function updateThreeActiveSpot(spot) {
  if (!spot || !tPinsGroup) return;

  tPinsGroup.children.forEach(mesh => {
    const isAct = mesh.userData.spotId === spot.id;
    mesh.material.color.setHex(isAct ? 0xfacc15 : 0x10b981);
    mesh.material.emissive.setHex(isAct ? 0xfacc15 : 0x059669);
    mesh.material.emissiveIntensity = isAct ? 0.6 : 0.2;
    mesh.scale.setScalar(isAct ? 1.35 : 1.0);
  });

  if (tActiveBeaconBeam) {
    tActiveBeaconBeam.position.set(spot.x, (spot.y || 2.2) + 20, spot.z);
  }
  if (tActiveReticle) {
    tActiveReticle.position.set(spot.x, 0.2, spot.z);
  }
}

function updateThreePinPosition(spot) {
  if (!spot || !tPinsGroup) return;
  const pin = tPinsGroup.children.find(m => m.userData.spotId === spot.id);
  if (pin) {
    pin.position.set(spot.x, spot.y, spot.z);
  }
  if (tActiveBeaconBeam) {
    tActiveBeaconBeam.position.set(spot.x, (spot.y || 2.2) + 20, spot.z);
  }
  if (tActiveReticle) {
    tActiveReticle.position.set(spot.x, 0.2, spot.z);
  }
}

let isPointerDrag = false;
let downPos = { x: 0, y: 0 };

function onThreePointerDown(e) {
  downPos = { x: e.clientX, y: e.clientY };
  isPointerDrag = false;
}

function onThreePointerMove(e) {
  if (Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y) > 4) {
    isPointerDrag = true;
  }
}

tRenderer?.domElement.addEventListener('pointerup', e => {
  if (isPointerDrag) return;
  const rect = tRenderer.domElement.getBoundingClientRect();
  tMouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  tMouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

  tRaycaster.setFromCamera(tMouse, tCamera);

  // 1. First test: Clicking on existing pin cone
  const pinHits = tRaycaster.intersectObjects(tPinsGroup.children, true);
  if (pinHits.length > 0) {
    const clickedId = pinHits[0].object.userData.spotId;
    if (clickedId) {
      selectSpot(clickedId);
      renderSpotCards();
      return;
    }
  }

  // 2. Second test: Ground Raycast Picking Mode
  if (isRaycastPickMode) {
    const groundHits = tRaycaster.intersectObject(tGroundPlane);
    if (groundHits.length > 0) {
      const p = groundHits[0].point;
      const spot = getActiveSpot();
      if (spot) {
        spot.x = Math.round(p.x * 100) / 100;
        spot.z = Math.round(p.z * 100) / 100;
        spot.pos = [spot.x, spot.y, spot.z];

        document.getElementById('fX').value = spot.x.toFixed(2);
        document.getElementById('fZ').value = spot.z.toFixed(2);
        updateHudCoords(spot.x, spot.y, spot.z);
        updateThreePinPosition(spot);

        // Update list card coords
        renderSpotCards();
        saveSpotsDataLocally(true);
        showToast(`已設定 #${spot.num} 坐標為 (X: ${spot.x}, Z: ${spot.z})`);
      }
    }
  }
});

// Center Camera Fly-to
function centerCameraOnSpot() {
  const spot = getActiveSpot();
  if (!spot || !tControls) return;
  tControls.target.set(spot.x, spot.y || 2.2, spot.z);
  tCamera.position.set(spot.x + 25, (spot.y || 2.2) + 30, spot.z + 35);
  showToast(`已將鏡頭聚焦於 #${spot.num} ${spot.name}`);
}

// ==========================================
// 6. 2.5D Plan Calibration Engine
// ==========================================
let currentPlanFloor = '1F';

function initPlanCalibration() {
  const img = document.getElementById('planBgImg');
  const container = document.getElementById('planImgContainer');

  document.querySelectorAll('[data-plan-floor]').forEach(btn => {
    btn.addEventListener('click', e => {
      document.querySelectorAll('[data-plan-floor]').forEach(b => b.classList.remove('is-active'));
      e.target.classList.add('is-active');
      currentPlanFloor = e.target.dataset.planFloor;
      img.src = `./assets/plans/${currentPlanFloor.toLowerCase()}.jpg`;
      renderPlanPins();
    });
  });

  img.addEventListener('click', e => {
    const rect = img.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    // Convert to natural image resolution
    const scaleX = img.naturalWidth / rect.width;
    const scaleY = img.naturalHeight / rect.height;

    const px = Math.round(clickX * scaleX);
    const py = Math.round(clickY * scaleY);

    const spot = getActiveSpot();
    if (spot) {
      spot.px = px;
      spot.py = py;
      spot.floor = currentPlanFloor;

      document.getElementById('fPx').value = px;
      document.getElementById('fPy').value = py;
      document.getElementById('fFloor').value = currentPlanFloor;

      renderPlanPins();
      renderSpotCards();
      saveSpotsDataLocally(true);
      showToast(`已更新 #${spot.num} 平面坐標：PX ${px}, PY ${py} (${currentPlanFloor})`);
    }
  });

  img.onload = () => {
    renderPlanPins();
  };
}

function renderPlanPins() {
  const layer = document.getElementById('planPinsLayer');
  const img = document.getElementById('planBgImg');
  if (!layer || !img || !img.naturalWidth) return;

  layer.innerHTML = '';
  const scaleX = img.clientWidth / img.naturalWidth;
  const scaleY = img.clientHeight / img.naturalHeight;

  spotsData.forEach(s => {
    if (s.floor && s.floor !== currentPlanFloor) return;
    if (s.px === undefined || s.py === undefined) return;

    const pin = document.createElement('div');
    const isAct = s.id === activeSpotId;
    pin.className = 'plan-pin-marker' + (isAct ? ' is-active' : '');
    pin.style.left = `${(s.px * scaleX)}px`;
    pin.style.top = `${(s.py * scaleY)}px`;
    pin.textContent = s.num || '';
    pin.title = `#${s.num} ${s.name}`;

    layer.appendChild(pin);
  });
}

function updatePlanActiveSpot(spot) {
  if (spot.floor && spot.floor !== currentPlanFloor) {
    currentPlanFloor = spot.floor;
    document.querySelectorAll('[data-plan-floor]').forEach(b => {
      b.classList.toggle('is-active', b.dataset.planFloor === currentPlanFloor);
    });
    const img = document.getElementById('planBgImg');
    if (img) img.src = `./assets/plans/${currentPlanFloor.toLowerCase()}.jpg`;
  }
  renderPlanPins();
}

// ==========================================
// 7. 360 Live Preview Studio (Street View & WebGL True Color)
// ==========================================
let previewMode = 'street'; // 'street' | 'webgl'
let prevRenderer, prevScene, prevCamera, prevMesh, prevAnimId;

function initPreviewStudio() {
  const streetBtn = document.getElementById('prevModeStreetBtn');
  const webglBtn = document.getElementById('prevModeWebglBtn');
  const iframe = document.getElementById('previewIframe');
  const webglHost = document.getElementById('previewWebglCanvas');

  streetBtn?.addEventListener('click', () => setPreviewMode('street'));
  webglBtn?.addEventListener('click', () => setPreviewMode('webgl'));

  function setPreviewMode(m) {
    previewMode = m;
    streetBtn.classList.toggle('is-active', m === 'street');
    webglBtn.classList.toggle('is-active', m === 'webgl');

    if (m === 'street') {
      iframe.style.display = 'block';
      webglHost.style.display = 'none';
      if (prevAnimId) { cancelAnimationFrame(prevAnimId); prevAnimId = null; }
    } else {
      iframe.style.display = 'none';
      webglHost.style.display = 'block';
      initWebglPanoSphere();
      loadActiveSpotIntoSphere();
    }
  }

  function initWebglPanoSphere() {
    if (prevRenderer) return;
    const w = webglHost.clientWidth || 800;
    const h = webglHost.clientHeight || 600;

    prevScene = new THREE.Scene();
    prevCamera = new THREE.PerspectiveCamera(75, w / h, 0.1, 1000);

    const geo = new THREE.SphereGeometry(500, 60, 40);
    geo.scale(-1, 1, 1);
    // True Color: 0xffffff, no black tint!
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    prevMesh = new THREE.Mesh(geo, mat);
    prevScene.add(prevMesh);

    prevRenderer = new THREE.WebGLRenderer({ antialias: true });
    prevRenderer.setSize(w, h);
    prevRenderer.outputColorSpace = THREE.SRGBColorSpace;
    prevRenderer.toneMapping = THREE.NoToneMapping;
    webglHost.appendChild(prevRenderer.domElement);

    let isDrag = false;
    let downX = 0, downY = 0, lon = 90, lat = 0;

    webglHost.addEventListener('pointerdown', e => {
      isDrag = true;
      downX = e.clientX;
      downY = e.clientY;
    });
    window.addEventListener('pointermove', e => {
      if (!isDrag) return;
      lon = (downX - e.clientX) * 0.15 + lon;
      lat = (e.clientY - downY) * 0.15 + lat;
      lat = Math.max(-85, Math.min(85, lat));
      downX = e.clientX;
      downY = e.clientY;
    });
    window.addEventListener('pointerup', () => { isDrag = false; });

    function renderLoop() {
      prevAnimId = requestAnimationFrame(renderLoop);
      if (!isDrag) lon += 0.05;
      const phi = THREE.MathUtils.degToRad(90 - lat);
      const theta = THREE.MathUtils.degToRad(lon);
      prevCamera.lookAt(
        500 * Math.sin(phi) * Math.cos(theta),
        500 * Math.cos(phi),
        500 * Math.sin(phi) * Math.sin(theta)
      );
      prevRenderer.render(prevScene, prevCamera);
    }
    renderLoop();
  }

  function loadActiveSpotIntoSphere() {
    if (!prevMesh) return;
    const spot = getActiveSpot();
    if (!spot) return;

    const loader = new THREE.TextureLoader();
    loader.crossOrigin = 'anonymous';
    const url = spot.panoUrl || spot.thumb;
    if (!url) return;

    loader.load(url, tex => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.minFilter = THREE.LinearFilter;
      prevMesh.material.color.setHex(0xffffff); // 100% True color
      prevMesh.material.map = tex;
      prevMesh.material.needsUpdate = true;
    });
  }
}

function updatePreviewSpot(spot) {
  const iframe = document.getElementById('previewIframe');
  if (iframe) {
    const url = spot.embedUrl || `https://maps.google.com/maps?layer=c&cbll=${spot.latitude||22.6594591},${spot.longitude||120.4870018}&panoid=${spot.panoId||''}&output=svembed`;
    if (iframe.src !== url) {
      iframe.src = url;
    }
  }
}

// ==========================================
// 8. CRUD Actions & Stepper Controls
// ==========================================
function bindCrudEvents() {
  // Save form
  document.getElementById('btnSaveSpotForm')?.addEventListener('click', () => {
    readFormIntoActiveSpot();
    renderSpotCards();
    saveSpotsDataLocally();
    buildThreePins();
  });

  // Create Spot
  document.getElementById('btnCreateSpot')?.addEventListener('click', () => {
    const maxNum = spotsData.reduce((max, s) => Math.max(max, s.num || 0), 0);
    const newNum = maxNum + 1;
    const newId = `spot-${newNum}`;

    const newSpot = {
      id: newId,
      num: newNum,
      name: `新增 360 景點 #${newNum}`,
      group: '中庭與綠色花園',
      floor: '1F',
      px: 500, py: 500,
      x: 0, y: 2.2, z: 0,
      pos: [0, 2.2, 0],
      panoId: '',
      latitude: 22.6594591,
      longitude: 120.4870018,
      heading: 0,
      pitch: 0,
      thumb: './assets/campus_overview_preview.jpg',
      panoUrl: '',
      embedUrl: '',
      externalUrl: '',
      desc: '新建之 360 度實景導覽點。',
      adjacentSpotIds: []
    };

    spotsData.unshift(newSpot);
    selectSpot(newSpot.id);
    renderSpotCards();
    saveSpotsDataLocally(true);
    buildThreePins();
    showToast(`已建立全新景點 #${newNum}！請在右側 3D 畫面點選位置。`);
  });

  // Clone Spot
  document.getElementById('btnCloneSpot')?.addEventListener('click', () => {
    const current = getActiveSpot();
    if (!current) return;

    const maxNum = spotsData.reduce((max, s) => Math.max(max, s.num || 0), 0);
    const newNum = maxNum + 1;
    const clone = JSON.parse(JSON.stringify(current));
    clone.id = `spot-${newNum}`;
    clone.num = newNum;
    clone.name = `${current.name} (副本)`;
    clone.x += 2.0;
    clone.z += 2.0;
    clone.pos = [clone.x, clone.y, clone.z];

    spotsData.unshift(clone);
    selectSpot(clone.id);
    renderSpotCards();
    saveSpotsDataLocally(true);
    buildThreePins();
    showToast(`已複製建立景點 #${newNum}！`);
  });

  // Delete Spot
  document.getElementById('btnDeleteSpot')?.addEventListener('click', () => {
    const current = getActiveSpot();
    if (!current) return;

    if (spotsData.length <= 1) {
      alert('至少需保留一個景點！');
      return;
    }

    if (!confirm(`確定要刪除景點「#${current.num} ${current.name}」嗎？此操作不可逆。`)) {
      return;
    }

    const idx = spotsData.findIndex(s => s.id === current.id);
    if (idx !== -1) {
      spotsData.splice(idx, 1);
      const nextSpot = spotsData[idx] || spotsData[idx - 1] || spotsData[0];
      selectSpot(nextSpot.id);
      renderSpotCards();
      saveSpotsDataLocally();
      buildThreePins();
      showToast(`已成功刪除景點 #${current.num}`);
    }
  });

  // Smart Parser Execution
  document.getElementById('btnExecuteSmartParse')?.addEventListener('click', () => {
    const input = document.getElementById('smartUrlInput');
    const val = input.value.trim();
    if (!val) {
      alert('請先貼入 Google Maps 360 實景分享網址！');
      return;
    }

    const res = parseGoogleMapsStreetViewUrl(val);
    if (!res || !res.panoId) {
      alert('無法從該連結解析出 Google Street View 的 panoId，請確認是否為 360 度實景街景網址！');
      return;
    }

    const spot = getActiveSpot();
    if (spot) {
      spot.panoId = res.panoId;
      spot.latitude = res.latitude;
      spot.longitude = res.longitude;
      spot.heading = res.heading;
      spot.pitch = res.pitch;
      spot.embedUrl = res.embedUrl;
      spot.externalUrl = res.externalUrl;
      if (res.thumb) spot.thumb = res.thumb;
      if (res.panoUrl) spot.panoUrl = res.panoUrl;

      // Update Form Inputs
      document.getElementById('fEmbedUrl').value = spot.embedUrl;
      document.getElementById('fExternalUrl').value = spot.externalUrl;
      if (res.thumb) document.getElementById('fThumb').value = spot.thumb;
      if (res.panoUrl) document.getElementById('fPanoUrl').value = spot.panoUrl;

      renderSpotCards();
      updatePreviewSpot(spot);
      saveSpotsDataLocally(true);
      showToast('⚡ Google 街景解析完成！已自動填入嵌入網址與高清影像');
      input.value = '';
    }
  });

  // Stepper Unit Buttons
  document.querySelectorAll('[data-step-unit]').forEach(btn => {
    btn.addEventListener('click', e => {
      document.querySelectorAll('[data-step-unit]').forEach(b => b.classList.remove('is-active'));
      e.target.classList.add('is-active');
      stepUnit = parseFloat(e.target.dataset.stepUnit) || 0.5;
    });
  });

  // Stepper Arrow Buttons
  function applyStep(dx, dy, dz) {
    const spot = getActiveSpot();
    if (!spot) return;
    spot.x = Math.round((spot.x + dx) * 100) / 100;
    spot.y = Math.round((spot.y + dy) * 100) / 100;
    spot.z = Math.round((spot.z + dz) * 100) / 100;
    spot.pos = [spot.x, spot.y, spot.z];

    document.getElementById('fX').value = spot.x.toFixed(2);
    document.getElementById('fY').value = spot.y.toFixed(2);
    document.getElementById('fZ').value = spot.z.toFixed(2);

    updateHudCoords(spot.x, spot.y, spot.z);
    updateThreePinPosition(spot);
    renderSpotCards();
    saveSpotsDataLocally(true);
  }

  document.getElementById('stepXMinus')?.addEventListener('click', () => applyStep(-stepUnit, 0, 0));
  document.getElementById('stepXPlus')?.addEventListener('click', () => applyStep(stepUnit, 0, 0));
  document.getElementById('stepZMinus')?.addEventListener('click', () => applyStep(0, 0, -stepUnit));
  document.getElementById('stepZPlus')?.addEventListener('click', () => applyStep(0, 0, stepUnit));
  document.getElementById('stepYPlus')?.addEventListener('click', () => applyStep(0, stepUnit, 0));
  document.getElementById('stepYMinus')?.addEventListener('click', () => applyStep(0, -stepUnit, 0));
  document.getElementById('stepResetY')?.addEventListener('click', () => {
    const spot = getActiveSpot();
    if (spot) {
      spot.y = 2.2;
      spot.pos[1] = 2.2;
      document.getElementById('fY').value = '2.20';
      updateHudCoords(spot.x, spot.y, spot.z);
      updateThreePinPosition(spot);
      saveSpotsDataLocally(true);
    }
  });

  document.getElementById('btnCenterCamera')?.addEventListener('click', centerCameraOnSpot);

  // Toggle Raycast Mode
  document.getElementById('btnToggleRaycastPick')?.addEventListener('click', () => {
    isRaycastPickMode = !isRaycastPickMode;
    const txt = document.getElementById('pickModeStatus');
    if (txt) txt.textContent = isRaycastPickMode ? '開啟中' : '已關閉';
    showToast(isRaycastPickMode ? '點擊地面定位已開啟：在 3D 地面上點擊即可移動圖釘' : '點擊地面定位已關閉');
  });

  // Top Action: Save to Local
  document.getElementById('btnSaveLocal')?.addEventListener('click', () => {
    saveSpotsDataLocally();
  });

  // Top Action: Export JSON
  document.getElementById('btnExportJson')?.addEventListener('click', () => {
    const jsonStr = JSON.stringify(spotsData, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fuxing_360_spots_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('已匯出 spots.json 檔案！');
  });

  // Top Action: Copy Code
  document.getElementById('btnCopyCode')?.addEventListener('click', () => {
    const code = `const CAMPUS_360_SPOTS = ${JSON.stringify(spotsData, null, 2)};`;
    navigator.clipboard.writeText(code).then(() => {
      showToast('已複製 JavaScript 陣列代碼至剪貼簿！可直接覆蓋 campus-ui.js');
    }).catch(err => {
      alert('複製失敗，請手動複製：' + err);
    });
  });

  // Top Action: Import JSON
  const fileInput = document.getElementById('jsonFileInput');
  document.getElementById('btnImportJson')?.addEventListener('click', () => {
    fileInput.click();
  });

  fileInput.addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const parsed = JSON.parse(ev.target.result);
        if (Array.isArray(parsed) && parsed.length > 0) {
          if (confirm(`確認匯入包含 ${parsed.length} 處景點的 JSON 檔案嗎？這將覆蓋目前編輯資料。`)) {
            spotsData = parsed;
            selectSpot(spotsData[0].id);
            renderSpotCards();
            saveSpotsDataLocally();
            buildThreePins();
            showToast(`成功匯入 ${spotsData.length} 處景點！`);
          }
        } else {
          alert('匯入的 JSON 格式不正確，必須是景點陣列！');
        }
      } catch (err) {
        alert('解析 JSON 檔案失敗：' + err.message);
      }
    };
    reader.readAsText(file);
    fileInput.value = '';
  });

  // Top Action: Reset Default
  document.getElementById('btnResetDefault')?.addEventListener('click', () => {
    if (confirm('確定要還原為官方預設 46 處景點嗎？所有自訂修改將被清除。')) {
      localStorage.removeItem(STORAGE_KEY);
      loadSpotsData();
      selectSpot(spotsData[0].id);
      renderSpotCards();
      buildThreePins();
      showToast('已重置回官方預設 46 處景點！');
    }
  });

  // Floor Tabs Filter
  document.querySelectorAll('[data-filter-floor]').forEach(btn => {
    btn.addEventListener('click', e => {
      document.querySelectorAll('[data-filter-floor]').forEach(b => b.classList.remove('is-active'));
      e.target.classList.add('is-active');
      filterFloor = e.target.dataset.filterFloor;
      renderSpotCards();
    });
  });

  // Search input
  document.getElementById('searchSpotInput')?.addEventListener('input', e => {
    searchQuery = e.target.value;
    renderSpotCards();
  });

  // Stage Nav Tabs
  document.querySelectorAll('[data-stage-tab]').forEach(btn => {
    btn.addEventListener('click', e => {
      const tabId = e.currentTarget.dataset.stageTab;
      document.querySelectorAll('[data-stage-tab]').forEach(b => b.classList.remove('is-active'));
      e.currentTarget.classList.add('is-active');

      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('is-active'));
      const activePane = document.getElementById(tabId);
      if (activePane) activePane.classList.add('is-active');

      if (tabId === 'tab3d') {
        onThreeResize();
      } else if (tabId === 'tabPlan') {
        renderPlanPins();
      } else if (tabId === 'tabPreview') {
        updatePreviewSpot(getActiveSpot());
      }
    });
  });
}

// Toast Utility
function showToast(msg) {
  const t = document.getElementById('adminToast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => {
    t.classList.remove('show');
  }, 2400);
}

// Check URL param ?spot=spot-12
function checkUrlSpotParam() {
  const params = new URLSearchParams(window.location.search);
  const sParam = params.get('spot');
  if (sParam && spotsData.some(s => s.id === sParam)) {
    selectSpot(sParam);
  }
}

// ==========================================
// 9. Bootstrap Main Initialization
// ==========================================
window.addEventListener('DOMContentLoaded', () => {
  initAuth();
  loadSpotsData();
  renderSpotCards();
  initThreeViewport();
  initPlanCalibration();
  initPreviewStudio();
  bindCrudEvents();
  checkUrlSpotParam();

  // If first spot
  if (spotsData.length > 0) {
    selectSpot(activeSpotId || spotsData[0].id);
  }
});
