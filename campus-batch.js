// ============================================================================
// 屏東縣復興國小 3D 數位校園 — 靜態幾何合批 (Static Geometry Batching) v2.9.0
// ----------------------------------------------------------------------------
// 校園模型以數萬個小方塊程序化堆疊而成（每根欄杆、每張課桌各一個 Mesh），
// 每個 Mesh 每幀都要一次 draw call（開陰影時再加一次）。本模組在建築構建完成後，
// 將「同一父節點、同一材質、同一陰影設定、同一 userData」的靜態 Mesh 烘焙世界座標
// 後合併為單一 BufferGeometry，使 draw call 降低一個數量級。
//
// 設計重點：
//  * 只在同一父節點內合併 → 群組層級的顯示/隱藏（圖層開關、LOD、單體觀察）完全不受影響。
//  * userData 相同才合併 → 點選建築時沿父節點尋找 landmarkId 的邏輯維持不變。
//  * 材質物件保持共用 → 日夜、四季、PBR 延遲貼圖對材質的修改仍即時生效。
//  * 動態物件（行人、旗幟、燈泡、信標、平面圖疊層…）由呼叫端以 exclude 排除。
// ============================================================================
import * as THREE from 'three';

const defaultOnBeforeRender = THREE.Object3D.prototype.onBeforeRender;
const _normalMatrix = new THREE.Matrix3();
const _v = new THREE.Vector3();

function attributeSignature(geo) {
  const names = Object.keys(geo.attributes).sort();
  const parts = [];
  for (const n of names) {
    const a = geo.attributes[n];
    if (a.isInterleavedBufferAttribute || a.isInstancedBufferAttribute) return null;
    parts.push(`${n}:${a.itemSize}:${a.normalized ? 1 : 0}:${a.array.constructor.name}`);
  }
  return parts.join('|');
}

function isMergeable(o, excluded) {
  if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || o.isBatchedMesh) return false;
  if (o.children.length || !o.visible || excluded.has(o)) return false;
  if (Array.isArray(o.material) || !o.material) return false;
  if (o.onBeforeRender !== defaultOnBeforeRender) return false;
  if (o.morphTargetInfluences && o.morphTargetInfluences.length) return false;
  const g = o.geometry;
  if (!g || !g.isBufferGeometry || !g.attributes.position) return false;
  if (Object.keys(g.morphAttributes).length) return false;
  // 單一材質時 three.js 會忽略 geometry.groups（BoxGeometry 預設 6 組），可安全合併
  if (g.drawRange.start !== 0 || g.drawRange.count !== Infinity) return false;
  return true;
}

function mergeInto(list, signature) {
  // list: [{ mesh, matrix }]
  let vCount = 0, iCount = 0;
  for (const it of list) {
    const g = it.mesh.geometry;
    const n = g.attributes.position.count;
    vCount += n;
    iCount += g.index ? g.index.count : n;
  }
  const first = list[0].mesh.geometry;
  const names = Object.keys(first.attributes);
  const out = new THREE.BufferGeometry();
  const outArrays = {};
  for (const name of names) {
    const a = first.attributes[name];
    const Ctor = a.array.constructor;
    outArrays[name] = new Ctor(vCount * a.itemSize);
  }
  const IndexCtor = vCount > 65535 ? Uint32Array : Uint16Array;
  const index = new IndexCtor(iCount);

  let vOff = 0, iOff = 0;
  for (const it of list) {
    const g = it.mesh.geometry;
    const m = it.matrix;
    const flip = m.determinant() < 0;
    _normalMatrix.getNormalMatrix(m);
    const n = g.attributes.position.count;
    for (const name of names) {
      const src = g.attributes[name];
      const dst = outArrays[name];
      const size = src.itemSize;
      const base = vOff * size;
      if (name === 'position') {
        for (let i = 0; i < n; i++) {
          _v.fromBufferAttribute(src, i).applyMatrix4(m);
          dst[base + i * 3] = _v.x; dst[base + i * 3 + 1] = _v.y; dst[base + i * 3 + 2] = _v.z;
        }
      } else if (name === 'normal') {
        for (let i = 0; i < n; i++) {
          _v.fromBufferAttribute(src, i).applyMatrix3(_normalMatrix).normalize();
          dst[base + i * 3] = _v.x; dst[base + i * 3 + 1] = _v.y; dst[base + i * 3 + 2] = _v.z;
        }
      } else if (name === 'tangent' && size === 4) {
        for (let i = 0; i < n; i++) {
          _v.set(src.getX(i), src.getY(i), src.getZ(i)).transformDirection(m);
          dst[base + i * 4] = _v.x; dst[base + i * 4 + 1] = _v.y; dst[base + i * 4 + 2] = _v.z;
          dst[base + i * 4 + 3] = src.getW(i) * (flip ? -1 : 1);
        }
      } else if (src.array.length === n * size) {
        dst.set(src.array, base);
      } else {
        for (let i = 0; i < n; i++) for (let c = 0; c < size; c++) dst[base + i * size + c] = src.array[i * size + c];
      }
    }
    if (g.index) {
      const idx = g.index.array;
      const cnt = g.index.count;
      if (flip) {
        for (let i = 0; i < cnt; i += 3) {
          index[iOff + i] = idx[i] + vOff; index[iOff + i + 1] = idx[i + 2] + vOff; index[iOff + i + 2] = idx[i + 1] + vOff;
        }
      } else {
        for (let i = 0; i < cnt; i++) index[iOff + i] = idx[i] + vOff;
      }
      iOff += cnt;
    } else {
      for (let i = 0; i < n; i += 3) {
        index[iOff + i] = vOff + i;
        index[iOff + i + 1] = vOff + (flip ? i + 2 : i + 1);
        index[iOff + i + 2] = vOff + (flip ? i + 1 : i + 2);
      }
      iOff += n;
    }
    vOff += n;
  }
  for (const name of names) {
    const a = first.attributes[name];
    out.setAttribute(name, new THREE.BufferAttribute(outArrays[name], a.itemSize, a.normalized));
  }
  out.setIndex(new THREE.BufferAttribute(index, 1));
  out.computeBoundingBox();
  out.computeBoundingSphere();
  out.userData.batchSignature = signature;
  return out;
}

const batchedOutputs = new WeakSet();

// ---- 材質去重：外觀參數完全相同的「純色」MeshStandardMaterial 統一為同一個實例 ----
// 合批是以「同父節點 + 同材質」為單位，建模時大量重複建立同色同粗糙度的材質，使合批結果被不必要地拆散。
// 只處理「無貼圖、非透明、無自發光」的材質；會在執行期被修改的材質（四季樹葉、夜間窗光、
// 草坪、壁畫、PBR 延遲貼圖目標…）由呼叫端以 protect 傳入、或標記 userData.noDedupe，一律不合併。
const _canonMats = new Map();
const _MAP_KEYS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'alphaMap', 'bumpMap', 'emissiveMap', 'aoMap', 'envMap', 'lightMap', 'displacementMap'];
function dedupeSignature(m, protect) {
  if (!m || m.type !== 'MeshStandardMaterial' || protect.has(m)) return null;
  if (m.userData && Object.keys(m.userData).length) return null;       // 帶有 noDedupe / phenoRole 等標記者不動
  if (m.transparent || m.alphaTest || !m.visible || m.wireframe || m.vertexColors || m.clippingPlanes) return null;
  for (const k of _MAP_KEYS) if (m[k]) return null;
  if (m.emissive && m.emissive.getHex() !== 0) return null;
  return [m.color.getHex(), m.roughness, m.metalness, m.side, m.opacity, m.depthWrite, m.depthTest, m.flatShading,
    m.polygonOffset ? `${m.polygonOffsetFactor},${m.polygonOffsetUnits}` : '', m.envMapIntensity, m.name].join('|');
}
function dedupeMaterials(roots, excluded, protect) {
  let replaced = 0;
  roots.forEach(r => r && r.traverse(o => {
    if (!o.isMesh || excluded.has(o) || Array.isArray(o.material)) return;
    const sig = dedupeSignature(o.material, protect);
    if (!sig) return;
    const canon = _canonMats.get(sig);
    if (!canon) _canonMats.set(sig, o.material);
    else if (canon !== o.material) { o.material = canon; replaced++; }
  }));
  return replaced;
}

/**
 * 合併 roots 底下所有可合併的靜態 Mesh。
 * @param {THREE.Object3D[]} roots
 * @param {{ exclude?: Iterable<THREE.Object3D>, minCount?: number }} opts
 * @returns {{ meshesBefore:number, meshesAfter:number, batches:number, ms:number }}
 */
export function batchStaticMeshes(roots, opts = {}) {
  const t0 = performance.now();
  const excludedRoots = new Set(opts.exclude || []);
  const excluded = new Set();
  excludedRoots.forEach(r => r && r.traverse && r.traverse(o => excluded.add(o)));
  const minCount = opts.minCount || 2;
  // 空間切塊（預設關閉；實測會增加 draw calls，僅供實驗）：同材質的方塊再依位置分格（水平 cellSize 公尺、垂直 cellY 公尺）合併，
  // 讓合批後的大 Mesh 仍能被視錐剔除（否則整棟建築只要有一角入鏡就整批繪製，含陰影 pass）。
  const cellSize = opts.cellSize === undefined ? 0 : opts.cellSize;
  const cellY = opts.cellY || 12;

  // 材質去重（需由呼叫端明確開啟 dedupe，並傳入執行期會被修改的材質 protect）
  let dedupReplaced = 0;
  if (opts.dedupe) dedupReplaced = dedupeMaterials(roots, excluded, opts.protect || new Set());

  // 收集合併單位（遇到排除節點即停止往下）
  //  * 預設：每個父節點各自為一個合併單位（原行為）
  //  * hoist：只有「邊界」節點是合併單位，邊界之間的純結構群組會被跨越——
  //    網格依「到邊界的相對矩陣」烘焙後合併到最近的邊界下，讓分散在許多小群組裡的同材質方塊也能併成一批。
  //    邊界 = 呼叫端指定（圖層、可點選建築、LOD 細節群組…）+ 帶 userData 的節點（點選時要沿父節點找 landmarkId）
  //          + 合批當下不可見的節點（之後可能被顯示）。
  const hoist = !!opts.hoist;
  const boundarySet = new Set(opts.boundaries || []);
  roots.forEach(r => r && boundarySet.add(r));
  const isBoundary = node => boundarySet.has(node) || !node.visible ||
    (node.userData && Object.keys(node.userData).length > 0) || batchedOutputs.has(node);
  const parents = [];
  const visit = node => {
    if (excluded.has(node)) return;
    if (node.children.length && (!hoist || isBoundary(node))) parents.push(node);
    for (const c of node.children) visit(c);
  };
  roots.forEach(r => r && visit(r));
  // hoist 時，取得某邊界底下（不跨越其他邊界、不進入排除節點）的所有直屬候選網格與其相對矩陣
  const collectUnder = boundary => {
    const out = [];
    const walk = (node, rel) => {
      for (const c of node.children) {
        if (excluded.has(c)) continue;
        if (c.isMesh && !c.children.length) {
          c.updateMatrix();
          out.push({ mesh: c, matrix: rel ? rel.clone().multiply(c.matrix) : c.matrix.clone() });
        } else if (c.children.length && !isBoundary(c)) {
          c.updateMatrix();
          walk(c, rel ? rel.clone().multiply(c.matrix) : c.matrix.clone());
        }
      }
    };
    walk(boundary, null);
    return out;
  };

  // 幾何體引用計數（用於安全釋放 GPU 緩衝）
  const geoUsers = new Map();
  roots.forEach(r => r && r.traverse(o => {
    if (o.geometry) geoUsers.set(o.geometry, (geoUsers.get(o.geometry) || 0) + 1);
  }));

  let meshesBefore = 0, meshesAfter = 0, batches = 0;
  for (const parent of parents) {
    const buckets = new Map();
    const candidates = hoist ? collectUnder(parent)
      : parent.children.filter(o => o.isMesh).map(o => { o.updateMatrix(); return { mesh: o, matrix: o.matrix.clone() }; });
    for (const { mesh: o, matrix: rel } of candidates) {
      meshesBefore++;
      if (batchedOutputs.has(o) || !isMergeable(o, excluded)) continue;
      const sig = attributeSignature(o.geometry);
      if (!sig) continue;
      const flip = rel.determinant() < 0 ? 'f' : 'n';
      let ud = '';
      if (o.userData && Object.keys(o.userData).length) {
        try { ud = JSON.stringify(o.userData); } catch { continue; }
      }
      const e = rel.elements;
      const cell = cellSize > 0 ? `${Math.floor(e[12] / cellSize)}_${Math.floor(e[13] / cellY)}_${Math.floor(e[14] / cellSize)}` : '';
      const key = [cell, o.material.uuid, o.castShadow ? 1 : 0, o.receiveShadow ? 1 : 0, o.renderOrder,
        o.frustumCulled ? 1 : 0, o.layers.mask, flip, sig, ud].join('#');
      let b = buckets.get(key);
      if (!b) buckets.set(key, (b = { sig, list: [] }));
      b.list.push({ mesh: o, matrix: rel });
    }
    for (const { sig, list } of buckets.values()) {
      if (list.length < minCount) continue;
      const proto = list[0].mesh;
      const geo = mergeInto(list, sig);
      const merged = new THREE.Mesh(geo, proto.material);
      merged.name = `batch:${proto.material.name || proto.material.type}`;
      merged.castShadow = proto.castShadow;
      merged.receiveShadow = proto.receiveShadow;
      merged.renderOrder = proto.renderOrder;
      merged.frustumCulled = proto.frustumCulled;
      merged.layers.mask = proto.layers.mask;
      merged.userData = proto.userData && Object.keys(proto.userData).length ? { ...proto.userData } : {};
      merged.matrixAutoUpdate = false;
      merged.updateMatrix();
      for (const { mesh } of list) {
        mesh.parent.remove(mesh);   // hoist 時網格可能位於中間群組，從它實際的父節點移除
        const left = (geoUsers.get(mesh.geometry) || 1) - 1;
        geoUsers.set(mesh.geometry, left);
        if (left <= 0) mesh.geometry.dispose();
      }
      parent.add(merged);
      batchedOutputs.add(merged);
      batches++;
    }
    if (!hoist) for (const o of parent.children) if (o.isMesh) meshesAfter++;
  }
  if (hoist) roots.forEach(r => r && r.traverse(o => { if (o.isMesh) meshesAfter++; }));
  return { meshesBefore, meshesAfter, batches, dedupReplaced, ms: Math.round(performance.now() - t0) };
}
