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

  // 收集所有父節點（遇到排除節點即停止往下）
  const parents = [];
  const visit = node => {
    if (excluded.has(node)) return;
    if (node.children.length) parents.push(node);
    for (const c of node.children) visit(c);
  };
  roots.forEach(r => r && visit(r));

  // 幾何體引用計數（用於安全釋放 GPU 緩衝）
  const geoUsers = new Map();
  roots.forEach(r => r && r.traverse(o => {
    if (o.geometry) geoUsers.set(o.geometry, (geoUsers.get(o.geometry) || 0) + 1);
  }));

  let meshesBefore = 0, meshesAfter = 0, batches = 0;
  for (const parent of parents) {
    const buckets = new Map();
    for (const o of parent.children) {
      if (!o.isMesh) continue;
      meshesBefore++;
      if (batchedOutputs.has(o) || !isMergeable(o, excluded)) continue;
      const sig = attributeSignature(o.geometry);
      if (!sig) continue;
      o.updateMatrix();
      const flip = o.matrix.determinant() < 0 ? 'f' : 'n';
      let ud = '';
      if (o.userData && Object.keys(o.userData).length) {
        try { ud = JSON.stringify(o.userData); } catch { continue; }
      }
      const key = [o.material.uuid, o.castShadow ? 1 : 0, o.receiveShadow ? 1 : 0, o.renderOrder,
        o.frustumCulled ? 1 : 0, o.layers.mask, flip, sig, ud].join('#');
      let b = buckets.get(key);
      if (!b) buckets.set(key, (b = { sig, list: [] }));
      b.list.push({ mesh: o, matrix: o.matrix.clone() });
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
        parent.remove(mesh);
        const left = (geoUsers.get(mesh.geometry) || 1) - 1;
        geoUsers.set(mesh.geometry, left);
        if (left <= 0) mesh.geometry.dispose();
      }
      parent.add(merged);
      batchedOutputs.add(merged);
      batches++;
    }
    for (const o of parent.children) if (o.isMesh) meshesAfter++;
  }
  return { meshesBefore, meshesAfter, batches, ms: Math.round(performance.now() - t0) };
}
