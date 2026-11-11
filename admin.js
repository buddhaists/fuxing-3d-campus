// 復興國小 360° 平面圖定位管理後台 (Visual Plan CMS)
// Version: 2.0.0 (Simplified Plan-focused Edition)

// ==========================================
// 1. Auth Guard & Security
// ==========================================
const AUTH_KEY = 'fuxing_admin_auth';
const DEFAULT_PASSWORD = 'fuxing360';

function initAuth() {
  const modal = document.getElementById('adminAuthModal');
  const input = document.getElementById('authPasswordInput');
  const btn = document.getElementById('btnSubmitAuth');
  const err = document.getElementById('authErrorMsg');
  const btnLock = document.getElementById('btnLockAuth');

  if (sessionStorage.getItem(AUTH_KEY) !== '1') {
    modal.style.display = 'flex';
    input.focus();
  }

  function verify() {
    if (input.value.trim() === DEFAULT_PASSWORD) {
      sessionStorage.setItem(AUTH_KEY, '1');
      modal.style.display = 'none';
      err.style.display = 'none';
      input.value = '';
      showToast('歡迎進入平面圖定位工作台！');
    } else {
      err.style.display = 'block';
      input.select();
    }
  }

  btn.addEventListener('click', verify);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') verify(); });

  btnLock?.addEventListener('click', () => {
    sessionStorage.removeItem(AUTH_KEY);
    modal.style.display = 'flex';
    input.value = '';
    showToast('工作台已安全鎖定');
  });
}

// ==========================================
// 2. Coordinate Mapper & Scale Formulas
// ==========================================
// Fuxing Elementary School Exact Metric Linear Transform
// 1024 x 746 Map Origin: (512, 240), Scale: 0.26 meters per pixel
const S = 0.26, OX = 512, OY = 240;

function pxToX(px) {
  return Math.round((px - OX) * S * 100) / 100;
}

function pyToZ(py) {
  return Math.round((py - OY) * S * 100) / 100;
}

function xToPx(x) {
  return Math.round(x / S + OX);
}

function zToPy(z) {
  return Math.round(z / S + OY);
}

function getFloorDefaultY(floor) {
  switch (floor) {
    case '1F': return 2.2;
    case '2F': return 6.2;
    case '3F': return 10.2;
    case 'BF': return -2.5;
    default: return 2.2;
  }
}

// ==========================================
// 3. State Management
// ==========================================
const STORAGE_KEY = 'fuxing_360_spots_custom';
let spotsData = [];
let activeSpotId = 'spot-12';
let currentFloor = '1F';
let searchQuery = '';

function loadSpotsData() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) {
        spotsData = parsed;
        sanitizeCoordinates();
        console.log(`[PlanCMS] Loaded ${spotsData.length} spots from localStorage.`);
        return;
      }
    } catch (e) {
      console.warn('[PlanCMS] Parse error from localStorage', e);
    }
  }

  // Fallback: window.CAMPUS_360_SPOTS in campus-ui.js
  if (window.CAMPUS_360_SPOTS && Array.isArray(window.CAMPUS_360_SPOTS)) {
    spotsData = JSON.parse(JSON.stringify(window.CAMPUS_360_SPOTS));
  } else {
    spotsData = [];
  }
  sanitizeCoordinates();
}

function sanitizeCoordinates() {
  spotsData.forEach(s => {
    // If px, py missing but x, z present
    if ((s.px === undefined || s.py === undefined) && s.x !== undefined && s.z !== undefined) {
      s.px = xToPx(s.x);
      s.py = zToPy(s.z);
    }
    // If x, z missing but px, py present
    if ((s.x === undefined || s.z === undefined) && s.px !== undefined && s.py !== undefined) {
      s.x = pxToX(s.px);
      s.z = pyToZ(s.py);
    }
    if (s.y === undefined) {
      s.y = getFloorDefaultY(s.floor || '1F');
    }
    s.pos = [s.x || 0, s.y || 2.2, s.z || 0];
  });
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
// 4. Google Maps Smart URL Parser
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

  const panoMatch = url.match(/!1s([A-Za-z0-9_-]+)!2e10/) || url.match(/[?&]panoid=([A-Za-z0-9_-]+)/);
  if (panoMatch) result.panoId = panoMatch[1];

  const coordMatch = url.match(/@([0-9.]+),([0-9.]+)/) || url.match(/!3d([0-9.]+)!4d([0-9.]+)/);
  if (coordMatch) {
    result.latitude = parseFloat(coordMatch[1]);
    result.longitude = parseFloat(coordMatch[2]);
  }

  const headingMatch = url.match(/ya([0-9.-]+)/) || url.match(/,([0-9.]+)y/);
  if (headingMatch) result.heading = parseFloat(headingMatch[1]);

  const pitchMatch = url.match(/pi([0-9.-]+)/) || url.match(/,([0-9.-]+)t/) || url.match(/,([0-9.-]+)h/);
  if (pitchMatch) result.pitch = parseFloat(pitchMatch[1]);

  result.embedUrl = `https://maps.google.com/maps?layer=c&cbll=${result.latitude},${result.longitude}&panoid=${result.panoId}&cbp=12,${result.heading},,0,${result.pitch}&output=svembed`;

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
// 5. Plan Viewport: Pan, Zoom & Drag Engine
// ==========================================
let zoomScale = 1.0;
let panX = 0, panY = 0;
let isPanning = false;
let startPanX = 0, startPanY = 0;

function initPlanViewport() {
  const viewport = document.getElementById('planViewport');
  const transformLayer = document.getElementById('planTransformLayer');
  const planImg = document.getElementById('planImg');

  function updateTransform() {
    transformLayer.style.transform = `translate(${panX}px, ${panY}px) scale(${zoomScale})`;
    document.getElementById('zoomLevelLabel').textContent = `${Math.round(zoomScale * 100)}%`;
  }

  function centerMap() {
    if (!viewport || !planImg) return;
    const vw = viewport.clientWidth;
    const vh = viewport.clientHeight;
    const iw = 1024;
    const ih = 746;

    // Fit view
    zoomScale = Math.min((vw - 40) / iw, (vh - 40) / ih, 1.25);
    panX = (vw - iw * zoomScale) / 2;
    panY = (vh - ih * zoomScale) / 2;
    updateTransform();
  }

  // Wheel Zoom (centered at mouse pointer)
  viewport.addEventListener('wheel', e => {
    e.preventDefault();
    const rect = viewport.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const oldScale = zoomScale;
    const factor = e.deltaY < 0 ? 1.15 : 0.87;
    const newScale = Math.max(0.4, Math.min(3.5, zoomScale * factor));

    panX = mouseX - (mouseX - panX) * (newScale / oldScale);
    panY = mouseY - (mouseY - panY) * (newScale / oldScale);
    zoomScale = newScale;

    updateTransform();
  }, { passive: false });

  // Pan Map by dragging background
  let isMapDrag = false;
  let clickStartX = 0, clickStartY = 0;

  viewport.addEventListener('pointerdown', e => {
    // If clicking on pin, do not pan map
    if (e.target.closest('.spot-pin')) return;

    isPanning = true;
    isMapDrag = false;
    startPanX = e.clientX - panX;
    startPanY = e.clientY - panY;
    clickStartX = e.clientX;
    clickStartY = e.clientY;
  });

  window.addEventListener('pointermove', e => {
    if (!isPanning) return;
    if (Math.hypot(e.clientX - clickStartX, e.clientY - clickStartY) > 5) {
      isMapDrag = true;
    }
    panX = e.clientX - startPanX;
    panY = e.clientY - startPanY;
    updateTransform();
  });

  window.addEventListener('pointerup', e => {
    if (!isPanning) return;
    isPanning = false;

    // If it was a quick click on map (not a drag), teleport active pin to click location!
    if (!isMapDrag && (e.target === planImg || e.target.id === 'pinsLayer' || e.target === viewport)) {
      teleportActivePinToMouse(e);
    }
  });

  // Zoom Toolbar Buttons
  document.getElementById('btnZoomIn')?.addEventListener('click', () => {
    zoomScale = Math.min(3.5, zoomScale * 1.2);
    updateTransform();
  });
  document.getElementById('btnZoomOut')?.addEventListener('click', () => {
    zoomScale = Math.max(0.4, zoomScale / 1.2);
    updateTransform();
  });
  document.getElementById('btnResetZoom')?.addEventListener('click', centerMap);

  // Initial center on load
  planImg.onload = centerMap;
  window.addEventListener('resize', centerMap);
  setTimeout(centerMap, 100);
}

// Convert client mouse event to 1024x746 image pixel coordinates
function getMapPixelCoords(e) {
  const planImg = document.getElementById('planImg');
  const rect = planImg.getBoundingClientRect();

  const clickX = e.clientX - rect.left;
  const clickY = e.clientY - rect.top;

  const scaleX = 1024 / rect.width;
  const scaleY = 746 / rect.height;

  let px = Math.round(clickX * scaleX);
  let py = Math.round(clickY * scaleY);

  px = Math.max(5, Math.min(1019, px));
  py = Math.max(5, Math.min(741, py));

  return { px, py };
}

function teleportActivePinToMouse(e) {
  const { px, py } = getMapPixelCoords(e);
  const spot = getActiveSpot();
  if (!spot) return;

  spot.px = px;
  spot.py = py;
  spot.x = pxToX(px);
  spot.z = pyToZ(py);
  spot.floor = (currentFloor === 'ALL') ? spot.floor : currentFloor;
  spot.pos = [spot.x, spot.y || 2.2, spot.z];

  updateFormValues(spot);
  renderPins();
  renderMiniList();
  saveSpotsDataLocally(true);
  showToast(`已移動 #${spot.num} 至 (PX: ${px}, PY: ${py}) ➜ 3D: (${spot.x}, ${spot.z})`);
}

// ==========================================
// 6. Pins Layer & Direct Drag Engine
// ==========================================
let isDraggingPin = false;
let draggedSpot = null;

function renderPins() {
  const layer = document.getElementById('pinsLayer');
  if (!layer) return;
  layer.innerHTML = '';

  spotsData.forEach(s => {
    // Floor filter: If current floor is specific (e.g. 1F), only show pins for that floor
    if (currentFloor !== 'ALL' && s.floor && s.floor !== currentFloor) {
      return;
    }

    const pin = document.createElement('div');
    const isAct = s.id === activeSpotId;
    pin.className = 'spot-pin' + (isAct ? ' is-active' : '');
    pin.dataset.id = s.id;
    pin.style.left = `${s.px || 512}px`;
    pin.style.top = `${s.py || 240}px`;

    pin.innerHTML = `
      <div class="pin-badge">${s.num || ''}</div>
      <div class="pin-label">${s.name}</div>
    `;

    // Direct Drag & Drop Pin Handling
    pin.addEventListener('pointerdown', e => {
      e.stopPropagation();
      selectSpot(s.id);

      isDraggingPin = true;
      draggedSpot = s;
      pin.setPointerCapture(e.pointerId);

      const onPointerMove = ev => {
        if (!isDraggingPin || draggedSpot !== s) return;
        const { px, py } = getMapPixelCoords(ev);
        s.px = px;
        s.py = py;
        s.x = pxToX(px);
        s.z = pyToZ(py);
        s.pos = [s.x, s.y || 2.2, s.z];

        pin.style.left = `${px}px`;
        pin.style.top = `${py}px`;

        updateHud(s);
        updateFormValues(s);
      };

      const onPointerUp = ev => {
        isDraggingPin = false;
        draggedSpot = null;
        pin.releasePointerCapture(e.pointerId);
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);

        renderMiniList();
        saveSpotsDataLocally(true);
        showToast(`已精確定位 #${s.num} 坐標：PX ${s.px}, PY ${s.py}`);
      };

      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
    });

    layer.appendChild(pin);
  });
}

function updateHud(spot) {
  document.getElementById('hudSpotTitle').textContent = `#${spot.num} ${spot.name} (${spot.floor || '1F'})`;
  document.getElementById('hudCoordsText').textContent = 
    `平面像素: PX ${spot.px}, PY ${spot.py} ➜ 自動換算 3D: X ${spot.x.toFixed(2)}, Y ${(spot.y||2.2).toFixed(2)}, Z ${spot.z.toFixed(2)}`;
  document.getElementById('formCoordsCalcPreview').textContent = 
    `換算 3D: X ${spot.x.toFixed(2)}, Z ${spot.z.toFixed(2)}`;
}

// ==========================================
// 7. Sidebar: Mini List & Form Controller
// ==========================================
function renderMiniList() {
  const container = document.getElementById('spotMiniList');
  if (!container) return;
  container.innerHTML = '';

  const q = searchQuery.toLowerCase().trim();
  const filtered = spotsData.filter(s => {
    if (currentFloor !== 'ALL' && s.floor !== currentFloor) return false;
    if (q) {
      return (s.name || '').toLowerCase().includes(q) ||
             (s.group || '').toLowerCase().includes(q) ||
             String(s.num || '').includes(q) ||
             (s.id || '').toLowerCase().includes(q);
    }
    return true;
  });

  document.getElementById('spotCountChip').textContent = `${filtered.length} / ${spotsData.length} 處景點`;

  filtered.forEach(s => {
    const item = document.createElement('div');
    const isAct = s.id === activeSpotId;
    item.className = 'mini-card' + (isAct ? ' is-active' : '');
    item.dataset.id = s.id;

    item.innerHTML = `
      <img src="${s.thumb || './assets/campus_overview_preview.jpg'}" class="mini-card-thumb" onerror="this.src='./assets/campus_overview_preview.jpg'">
      <div class="mini-card-name">#${s.num} ${s.name}</div>
      <div class="mini-card-badge">${s.floor || '1F'}</div>
    `;

    item.addEventListener('click', () => {
      selectSpot(s.id);
    });

    container.appendChild(item);
  });
}

function selectSpot(spotId) {
  activeSpotId = spotId;
  const spot = getActiveSpot();
  if (!spot) return;

  // If spot has different floor, auto switch floor map
  if (currentFloor !== 'ALL' && spot.floor && spot.floor !== currentFloor) {
    switchFloorMap(spot.floor);
  }

  updateFormValues(spot);
  updateHud(spot);
  renderPins();
  renderMiniList();
}

function updateFormValues(spot) {
  document.getElementById('fId').value = spot.id;
  document.getElementById('fNum').value = spot.num || '';
  document.getElementById('fFloor').value = spot.floor || '1F';
  document.getElementById('fName').value = spot.name || '';
  document.getElementById('fGroup').value = spot.group || '校門與戶外前庭';
  document.getElementById('fPx').value = spot.px || 512;
  document.getElementById('fPy').value = spot.py || 240;
  document.getElementById('fY').value = (spot.y !== undefined ? spot.y : 2.2).toFixed(2);
  document.getElementById('fThumb').value = spot.thumb || '';
  document.getElementById('fEmbedUrl').value = spot.embedUrl || '';
  document.getElementById('fPanoUrl').value = spot.panoUrl || '';
  document.getElementById('fDesc').value = spot.desc || '';

  const thumbImg = document.getElementById('fThumbPreview');
  if (thumbImg) {
    thumbImg.src = spot.thumb || './assets/campus_overview_preview.jpg';
    thumbImg.onerror = () => { thumbImg.src = './assets/campus_overview_preview.jpg'; };
  }

  document.getElementById('formCoordsCalcPreview').textContent = 
    `換算 3D: X ${(spot.x || 0).toFixed(2)}, Z ${(spot.z || 0).toFixed(2)}`;
}

function readFormIntoSpot() {
  const spot = getActiveSpot();
  if (!spot) return;

  spot.num = parseInt(document.getElementById('fNum').value, 10) || spot.num;
  spot.floor = document.getElementById('fFloor').value;
  spot.name = document.getElementById('fName').value.trim() || spot.name;
  spot.group = document.getElementById('fGroup').value;

  spot.px = parseInt(document.getElementById('fPx').value, 10) || spot.px;
  spot.py = parseInt(document.getElementById('fPy').value, 10) || spot.py;
  spot.y = parseFloat(document.getElementById('fY').value) || 2.2;

  // Auto calculate X, Z from PX, PY
  spot.x = pxToX(spot.px);
  spot.z = pyToZ(spot.py);
  spot.pos = [spot.x, spot.y, spot.z];

  spot.thumb = document.getElementById('fThumb').value.trim();
  spot.embedUrl = document.getElementById('fEmbedUrl').value.trim();
  spot.panoUrl = document.getElementById('fPanoUrl').value.trim();
  spot.desc = document.getElementById('fDesc').value.trim();

  updateHud(spot);
  renderPins();
  renderMiniList();
}

// Floor Map Switcher
function switchFloorMap(floor) {
  currentFloor = floor;
  document.querySelectorAll('[data-floor]').forEach(b => {
    b.classList.toggle('is-active', b.dataset.floor === floor);
  });

  const planImg = document.getElementById('planImg');
  if (floor === 'ALL') {
    planImg.src = './assets/plans/all.jpg';
  } else {
    planImg.src = `./assets/plans/${floor.toLowerCase()}.jpg`;
  }

  renderPins();
  renderMiniList();
}

// ==========================================
// 8. CRUD Actions & Buttons Binding
// ==========================================
function bindEvents() {
  // Floor Tabs
  document.querySelectorAll('[data-floor]').forEach(btn => {
    btn.addEventListener('click', e => {
      switchFloorMap(e.currentTarget.dataset.floor);
    });
  });

  // Search input
  document.getElementById('searchSpotInput')?.addEventListener('input', e => {
    searchQuery = e.target.value;
    renderMiniList();
  });

  // Manual Coordinate Inputs Change
  ['fPx', 'fPy', 'fY'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', () => {
      readFormIntoSpot();
      saveSpotsDataLocally(true);
    });
  });

  // Name, Group, Floor change
  ['fName', 'fGroup', 'fFloor', 'fNum', 'fThumb', 'fEmbedUrl', 'fPanoUrl', 'fDesc'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', () => {
      readFormIntoSpot();
      saveSpotsDataLocally(true);
    });
  });

  // Floor dropdown change -> auto update Y height if default
  document.getElementById('fFloor')?.addEventListener('change', e => {
    const spot = getActiveSpot();
    if (spot) {
      spot.floor = e.target.value;
      spot.y = getFloorDefaultY(spot.floor);
      document.getElementById('fY').value = spot.y.toFixed(2);
      readFormIntoSpot();
      saveSpotsDataLocally(true);
    }
  });

  // Save Form Button
  document.getElementById('btnSaveSpotForm')?.addEventListener('click', () => {
    readFormIntoSpot();
    saveSpotsDataLocally();
  });

  // Save Local Top Button
  document.getElementById('btnSaveLocal')?.addEventListener('click', () => {
    saveSpotsDataLocally();
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
      alert('無法從該連結解析出 Google 街景的 panoId，請確認是否為 360 度實景街景網址！');
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

      updateFormValues(spot);
      renderMiniList();
      saveSpotsDataLocally(true);
      showToast('⚡ Google 街景解析完成！已自動填入嵌入網址與縮圖');
      input.value = '';
    }
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
      floor: currentFloor === 'ALL' ? '1F' : currentFloor,
      px: 512, py: 240,
      x: 0, y: getFloorDefaultY(currentFloor), z: 0,
      pos: [0, getFloorDefaultY(currentFloor), 0],
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
    saveSpotsDataLocally(true);
    showToast(`已建立全新景點 #${newNum}！請在地圖上拖曳圖釘定位。`);
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
    clone.px += 25;
    clone.py += 25;
    clone.x = pxToX(clone.px);
    clone.z = pyToZ(clone.py);
    clone.pos = [clone.x, clone.y, clone.z];

    spotsData.unshift(clone);
    selectSpot(clone.id);
    saveSpotsDataLocally(true);
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
      saveSpotsDataLocally();
      showToast(`已成功刪除景點 #${current.num}`);
    }
  });

  // Live Street View Preview Modal
  const previewModal = document.getElementById('previewModal');
  const previewIframe = document.getElementById('prevModalIframe');
  const previewTitle = document.getElementById('prevModalTitle');

  function openPreview() {
    const spot = getActiveSpot();
    if (!spot) return;
    previewTitle.textContent = `360 實景檢驗：#${spot.num} ${spot.name}`;
    previewIframe.src = spot.embedUrl || `https://maps.google.com/maps?layer=c&cbll=${spot.latitude||22.6594591},${spot.longitude||120.4870018}&panoid=${spot.panoId||''}&output=svembed`;
    previewModal.style.display = 'flex';
  }

  document.getElementById('btnOpenLivePreview')?.addEventListener('click', openPreview);
  document.getElementById('btnOverlayPreview')?.addEventListener('click', openPreview);
  document.getElementById('btnClosePreviewModal')?.addEventListener('click', () => {
    previewModal.style.display = 'none';
    previewIframe.src = 'about:blank';
  });

  // Export JSON
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

  // Copy Code
  document.getElementById('btnCopyCode')?.addEventListener('click', () => {
    const code = `const CAMPUS_360_SPOTS = ${JSON.stringify(spotsData, null, 2)};`;
    navigator.clipboard.writeText(code).then(() => {
      showToast('已複製 JavaScript 陣列代碼至剪貼簿！可直接覆蓋 campus-ui.js');
    }).catch(err => {
      alert('複製失敗，請手動複製：' + err);
    });
  });

  // Import JSON
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
            sanitizeCoordinates();
            selectSpot(spotsData[0].id);
            saveSpotsDataLocally();
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

  // Reset Default
  document.getElementById('btnResetDefault')?.addEventListener('click', () => {
    if (confirm('確定要還原為官方預設 46 處景點嗎？所有自訂修改將被清除。')) {
      localStorage.removeItem(STORAGE_KEY);
      loadSpotsData();
      selectSpot(spotsData[0].id);
      showToast('已重置回官方預設 46 處景點！');
    }
  });
}

// Toast
function showToast(msg) {
  const t = document.getElementById('adminToast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => {
    t.classList.remove('show');
  }, 2200);
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
// 9. Bootstrap
// ==========================================
window.addEventListener('DOMContentLoaded', () => {
  initAuth();
  loadSpotsData();
  initPlanViewport();
  bindEvents();

  if (spotsData.length > 0) {
    selectSpot(activeSpotId || spotsData[0].id);
  }

  checkUrlSpotParam();
});
