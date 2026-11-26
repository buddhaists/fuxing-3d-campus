// ============================================================================
// 屏東縣復興國小 3D 數位校園 — 3D 行走物理、防穿牆碰撞、樓梯升降與飛行模式引擎
// ============================================================================
// 設計架構：
//  1. 支援世界座標與各棟建築局部座標 (`xf: { toLocal, toWorld }`) 之 3D 實體碰撞盒 (OBB)，
//     即使建築依航照旋轉，人物貼牆移動仍可沿牆面平順滑行，絕不穿牆或卡角。
//  2. 統一管理可站立樓板 (`floors`)、階梯與無障礙坡道 (`ramps`)，支援自動跨階上下樓梯與重力貼地。
//  3. 教室自動感應門 (`doors`)：人物靠近時自動平順推開／滑開，離開後自動關回。
//  4. 空間位置追蹤 (`zones`)：即時回報目前所在的「建築・樓層・教室名稱」供 HUD 顯示。
//  5. 雙模式引擎：
//     - 地面行走 (`walk`)：真實步速、重力、自動上下樓梯、全面建築結構防穿牆。
//     - 自由飛行 (`fly`)：高空鳥瞰自由飛行，切回步行時自動尋找安全落腳點。
// ============================================================================

const PLAYER_RADIUS = 0.27;
const PLAYER_EYE_H = 1.66;
const PLAYER_HEAD_H = 1.76;
const STEP_UP_MAX = 0.46;
const GRAVITY = 22.0;

const CAMPUS_BOUNDS = {
  minX: -128,
  maxX: 132,
  minZ: -64,
  maxZ: 82
};

const FLY_BOUNDS = {
  minX: -145,
  maxX: 150,
  minZ: -85,
  maxZ: 105,
  minY: 0.55,
  maxY: 130
};

function clamp(v, lo, hi) {
  return v < lo ? lo : (v > hi ? hi : v);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

export class WalkWorld {
  constructor() {
    this.solids = [];
    this.floors = [];
    this.ramps = [];
    this.zones = [];
    this.doors = [];
    this._groundFn = () => 0;
  }

  setGroundFn(fn) {
    this._groundFn = fn || (() => 0);
  }

  // ---- 1. 實體碰撞盒登錄 ----
  addSolid(minX, maxX, minY, maxY, minZ, maxZ, xf = null, tag = '') {
    const x0 = Math.min(minX, maxX), x1 = Math.max(minX, maxX);
    const y0 = Math.min(minY, maxY), y1 = Math.max(minY, maxY);
    const z0 = Math.min(minZ, maxZ), z1 = Math.max(minZ, maxZ);
    if (x1 - x0 < 0.01 || y1 - y0 < 0.01 || z1 - z0 < 0.01) return;
    this.solids.push({ xf, minX: x0, maxX: x1, minY: y0, maxY: y1, minZ: z0, maxZ: z1, tag });
  }

  addWall(cx, cy, cz, w, h, d, xf = null, tag = '') {
    this.addSolid(cx - w / 2, cx + w / 2, cy - h / 2, cy + h / 2, cz - d / 2, cz + d / 2, xf, tag);
  }

  /**
   * 沿 X 或 Z 軸建立含門洞開口的實體牆碰撞：
   *  - axis === 'x'：牆體沿 X 軸延伸 (minSpan..maxSpan)，固定 Z = fixedCoord，厚 thick
   *  - axis === 'z'：牆體沿 Z 軸延伸 (minSpan..maxSpan)，固定 X = fixedCoord，厚 thick
   *  - doors: [{ pos, width, height }]
   */
  addWallWithDoors(axis, fixedCoord, minSpan, maxSpan, yBot, yTop, thick, doors = [], xf = null, tag = '') {
    const s0 = Math.min(minSpan, maxSpan);
    const s1 = Math.max(minSpan, maxSpan);
    const halfT = thick / 2;
    const sorted = doors
      .map(d => ({
        a: clamp(d.pos - d.width / 2, s0, s1),
        b: clamp(d.pos + d.width / 2, s0, s1),
        h: d.height || 2.15
      }))
      .filter(d => d.b - d.a > 0.05)
      .sort((u, v) => u.a - v.a);

    const emit = (a, b, yb, yt) => {
      if (b - a < 0.04 || yt - yb < 0.04) return;
      if (axis === 'x') {
        this.addSolid(a, b, yb, yt, fixedCoord - halfT, fixedCoord + halfT, xf, tag);
      } else {
        this.addSolid(fixedCoord - halfT, fixedCoord + halfT, yb, yt, a, b, xf, tag);
      }
    };

    let cur = s0;
    for (const d of sorted) {
      if (d.a > cur) emit(cur, d.a, yBot, yTop);
      // 門洞上方過梁（身高超過門高時才擋，一般行走可從門洞通過）
      if (yBot + d.h < yTop) emit(d.a, d.b, yBot + d.h, yTop);
      cur = Math.max(cur, d.b);
    }
    if (cur < s1) emit(cur, s1, yBot, yTop);
  }

  // ---- 2. 可站立樓板與樓梯／斜坡登錄 ----
  addFloor(minX, maxX, minZ, maxZ, y, xf = null, meta = null) {
    const x0 = Math.min(minX, maxX), x1 = Math.max(minX, maxX);
    const z0 = Math.min(minZ, maxZ), z1 = Math.max(minZ, maxZ);
    this.floors.push({
      xf,
      minX: x0, maxX: x1,
      minZ: z0, maxZ: z1,
      y,
      label: meta?.label || '',
      priority: meta?.priority ?? 5
    });
  }

  /**
   * 樓梯或無障礙斜坡：
   *  - axis === 'x': 在 minX 處高 yStart，線性升／降至 maxX 處高 yEnd
   *  - axis === 'z': 在 minZ 處高 yStart，線性升／降至 maxZ 處高 yEnd
   */
  addRamp(minX, maxX, minZ, maxZ, axis, yStart, yEnd, xf = null, meta = null) {
    const x0 = Math.min(minX, maxX), x1 = Math.max(minX, maxX);
    const z0 = Math.min(minZ, maxZ), z1 = Math.max(minZ, maxZ);
    this.ramps.push({
      xf,
      minX: x0, maxX: x1,
      minZ: z0, maxZ: z1,
      axis,
      yStart,
      yEnd,
      minY: Math.min(yStart, yEnd),
      maxY: Math.max(yStart, yEnd),
      label: meta?.label || '',
      priority: meta?.priority ?? 8
    });
  }

  // ---- 3. 空間位置標籤登錄 ----
  addZone(minX, maxX, minY, maxY, minZ, maxZ, xf = null, label = '', priority = 10) {
    const x0 = Math.min(minX, maxX), x1 = Math.max(minX, maxX);
    const y0 = Math.min(minY, maxY), y1 = Math.max(minY, maxY);
    const z0 = Math.min(minZ, maxZ), z1 = Math.max(minZ, maxZ);
    this.zones.push({ xf, minX: x0, maxX: x1, minY: y0, maxY: y1, minZ: z0, maxZ: z1, label, priority });
  }

  // ---- 4. 自動感應開門登錄 ----
  /**
   * 登錄可自動開啟的門扇 Mesh（會標記 noBatch 防止被靜態合批）
   * opts: {
   *   type: 'slide' | 'swing',
   *   slideAxis: 'x' | 'z',
   *   slideDist: number,     // 滑開距離（公尺）
   *   hingeX, hingeZ,        // 旋轉門軸心（局部座標）
   *   openAngle: number,     // 推開角度（rad）
   *   xf: buildingXf | null  // 建築座標轉換
   * }
   */
  addDoor(mesh, opts = {}) {
    if (!mesh) return;
    mesh.userData = mesh.userData || {};
    mesh.userData.noBatch = true;
    const lx = opts.localX ?? mesh.position.x;
    const ly = opts.localY ?? mesh.position.y;
    const lz = opts.localZ ?? mesh.position.z;
    const xf = opts.xf || null;
    const [wx, wz] = xf ? xf.toWorld(lx, lz) : [lx, lz];
    this.doors.push({
      mesh,
      type: opts.type || 'slide',
      slideAxis: opts.slideAxis || 'x',
      slideDist: opts.slideDist ?? 0.82,
      openAngle: opts.openAngle ?? (Math.PI * 0.48),
      baseX: mesh.position.x,
      baseY: mesh.position.y,
      baseZ: mesh.position.z,
      baseRotY: mesh.rotation.y || 0,
      worldX: wx,
      worldY: ly,
      worldZ: wz,
      openFrac: 0
    });
  }

  updateDoors(playerX, playerFeetY, playerZ, dtSec) {
    if (!this.doors.length) return;
    const rate = clamp(dtSec * 6.5, 0, 1);
    for (let i = 0; i < this.doors.length; i++) {
      const d = this.doors[i];
      const dx = playerX - d.worldX;
      const dz = playerZ - d.worldZ;
      const dy = Math.abs((playerFeetY + 1.0) - d.worldY);
      const distSq = dx * dx + dz * dz;
      const wantOpen = (dy < 1.65 && distSq < 2.4 * 2.4);
      const target = wantOpen ? 1 : (distSq > 2.9 * 2.9 || dy > 2.0 ? 0 : d.openFrac > 0.5 ? 1 : 0);
      if (Math.abs(d.openFrac - target) < 0.002) {
        if (d.openFrac === target) continue;
        d.openFrac = target;
      } else {
        d.openFrac = lerp(d.openFrac, target, rate);
      }
      if (d.type === 'slide') {
        if (d.slideAxis === 'x') {
          d.mesh.position.x = d.baseX + d.slideDist * d.openFrac;
        } else {
          d.mesh.position.z = d.baseZ + d.slideDist * d.openFrac;
        }
      } else {
        d.mesh.rotation.y = d.baseRotY + d.openAngle * d.openFrac;
      }
    }
  }

  // ---- 5. 3D 水平圓柱 vs OBB 碰撞解算 ----
  isBlockedAt(px, feetY, pz, radius = PLAYER_RADIUS, headH = PLAYER_HEAD_H) {
    if (px < CAMPUS_BOUNDS.minX || px > CAMPUS_BOUNDS.maxX || pz < CAMPUS_BOUNDS.minZ || pz > CAMPUS_BOUNDS.maxZ) {
      return true;
    }
    const yLo = feetY + STEP_UP_MAX;
    const yHi = feetY + headH;
    const r2 = radius * radius;
    for (let i = 0; i < this.solids.length; i++) {
      const b = this.solids[i];
      if (b.maxY <= yLo || b.minY >= yHi) continue;
      let lx = px, lz = pz;
      if (b.xf) {
        const p = b.xf.toLocal(px, pz);
        lx = p[0]; lz = p[1];
      }
      const cx = clamp(lx, b.minX, b.maxX);
      const cz = clamp(lz, b.minZ, b.maxZ);
      const dx = lx - cx, dz = lz - cz;
      if (dx * dx + dz * dz < r2) return true;
    }
    return false;
  }

  resolveHorizontal(px, feetY, pz, radius = PLAYER_RADIUS, headH = PLAYER_HEAD_H) {
    let x = clamp(px, CAMPUS_BOUNDS.minX, CAMPUS_BOUNDS.maxX);
    let z = clamp(pz, CAMPUS_BOUNDS.minZ, CAMPUS_BOUNDS.maxZ);
    const yLo = feetY + STEP_UP_MAX;
    const yHi = feetY + headH;

    for (let iter = 0; iter < 3; iter++) {
      let pushed = false;
      for (let i = 0; i < this.solids.length; i++) {
        const b = this.solids[i];
        if (b.maxY <= yLo || b.minY >= yHi) continue;
        let lx = x, lz = z;
        if (b.xf) {
          const p = b.xf.toLocal(x, z);
          lx = p[0]; lz = p[1];
        }
        // 快速包圍盒排除
        if (lx < b.minX - radius || lx > b.maxX + radius || lz < b.minZ - radius || lz > b.maxZ + radius) continue;

        const cx = clamp(lx, b.minX, b.maxX);
        const cz = clamp(lz, b.minZ, b.maxZ);
        const dx = lx - cx;
        const dz = lz - cz;
        const distSq = dx * dx + dz * dz;

        if (distSq < radius * radius) {
          let nlx = lx, nlz = lz;
          if (distSq > 1e-8) {
            const dist = Math.sqrt(distSq);
            const push = radius - dist + 0.001;
            nlx = lx + (dx / dist) * push;
            nlz = lz + (dz / dist) * push;
          } else {
            // 圓心落在碰撞盒內部：朝最近邊界推出
            const dL = lx - b.minX, dR = b.maxX - lx;
            const dN = lz - b.minZ, dS = b.maxZ - lz;
            const m = Math.min(dL, dR, dN, dS);
            if (m === dL) nlx = b.minX - radius - 0.002;
            else if (m === dR) nlx = b.maxX + radius + 0.002;
            else if (m === dN) nlz = b.minZ - radius - 0.002;
            else nlz = b.maxZ + radius + 0.002;
          }
          if (b.xf) {
            const w = b.xf.toWorld(nlx, nlz);
            x = w[0]; z = w[1];
          } else {
            x = nlx; z = nlz;
          }
          pushed = true;
        }
      }
      if (!pushed) break;
    }

    x = clamp(x, CAMPUS_BOUNDS.minX, CAMPUS_BOUNDS.maxX);
    z = clamp(z, CAMPUS_BOUNDS.minZ, CAMPUS_BOUNDS.maxZ);
    return [x, z];
  }

  // ---- 6. 查詢腳下可站立支撐高度（地面 + 樓板 + 樓梯／斜坡） ----
  getSupport(px, pz, feetY) {
    const baseG = this._groundFn(px, pz, feetY);
    let bestY = baseG;
    let onStair = false;
    const maxStep = feetY + 0.62;
    const pad = 0.05;

    // 1) 檢查所有樓梯與斜坡
    for (let i = 0; i < this.ramps.length; i++) {
      const r = this.ramps[i];
      if (r.minY > maxStep) continue;
      let lx = px, lz = pz;
      if (r.xf) {
        const p = r.xf.toLocal(px, pz);
        lx = p[0]; lz = p[1];
      }
      if (lx < r.minX - pad || lx > r.maxX + pad || lz < r.minZ - pad || lz > r.maxZ + pad) continue;
      const t = r.axis === 'x'
        ? clamp((lx - r.minX) / Math.max(0.01, r.maxX - r.minX), 0, 1)
        : clamp((lz - r.minZ) / Math.max(0.01, r.maxZ - r.minZ), 0, 1);
      const sy = lerp(r.yStart, r.yEnd, t);
      if (sy <= maxStep && sy >= bestY - 0.02) {
        if (sy > bestY || (Math.abs(sy - bestY) < 0.02 && !onStair)) {
          bestY = sy;
          onStair = true;
        }
      }
    }

    // 2) 檢查所有平面樓板
    for (let i = 0; i < this.floors.length; i++) {
      const f = this.floors[i];
      if (f.y > maxStep || f.y < bestY - 0.02) continue;
      let lx = px, lz = pz;
      if (f.xf) {
        const p = f.xf.toLocal(px, pz);
        lx = p[0]; lz = p[1];
      }
      if (lx < f.minX - pad || lx > f.maxX + pad || lz < f.minZ - pad || lz > f.maxZ + pad) continue;
      if (f.y > bestY) {
        bestY = f.y;
        onStair = false;
      }
    }

    return { y: bestY, onStair };
  }

  // ---- 7. 查詢目前空間位置名稱（供 HUD 顯示） ----
  getLocationLabel(px, feetY, pz) {
    let bestLabel = '';
    let bestPri = -1;
    const probeY = feetY + 1.0;

    for (let i = 0; i < this.zones.length; i++) {
      const z = this.zones[i];
      if (z.priority < bestPri) continue;
      if (probeY < z.minY || probeY > z.maxY) continue;
      let lx = px, lz = pz;
      if (z.xf) {
        const p = z.xf.toLocal(px, pz);
        lx = p[0]; lz = p[1];
      }
      if (lx >= z.minX && lx <= z.maxX && lz >= z.minZ && lz <= z.maxZ) {
        bestPri = z.priority;
        bestLabel = z.label;
      }
    }

    if (bestLabel) return bestLabel;

    // 次選：樓梯與樓板本身自帶的標籤
    for (let i = 0; i < this.ramps.length; i++) {
      const r = this.ramps[i];
      if (!r.label || Math.abs(feetY - (r.minY + r.maxY) / 2) > Math.abs(r.maxY - r.minY) / 2 + 0.8) continue;
      let lx = px, lz = pz;
      if (r.xf) { const p = r.xf.toLocal(px, pz); lx = p[0]; lz = p[1]; }
      if (lx >= r.minX && lx <= r.maxX && lz >= r.minZ && lz <= r.maxZ) return r.label;
    }
    for (let i = 0; i < this.floors.length; i++) {
      const f = this.floors[i];
      if (!f.label || Math.abs(feetY - f.y) > 0.65) continue;
      let lx = px, lz = pz;
      if (f.xf) { const p = f.xf.toLocal(px, pz); lx = p[0]; lz = p[1]; }
      if (lx >= f.minX && lx <= f.maxX && lz >= f.minZ && lz <= f.maxZ) return f.label;
    }
    return '校園戶外地面';
  }

  // ---- 8. 地面行走物理步進 ----
  stepWalk(state, moveDx, moveDz, dtSec) {
    const dt = Math.min(dtSec, 0.05);
    let x = state.x;
    let z = state.z;
    let feetY = state.feetY;
    let velY = state.velY || 0;

    // 水平分步移動（每步最大 0.11m，徹底防止高速穿牆）
    const totalDist = Math.hypot(moveDx, moveDz);
    const steps = Math.max(1, Math.ceil(totalDist / 0.11));
    const stepDx = moveDx / steps;
    const stepDz = moveDz / steps;

    for (let s = 0; s < steps; s++) {
      const nx = x + stepDx;
      const nz = z + stepDz;
      const [rx, rz] = this.resolveHorizontal(nx, feetY, nz);
      x = rx;
      z = rz;
      // 每個子步都檢查腳下樓梯高度，讓斜向爬梯極致平順
      const sup = this.getSupport(x, z, feetY);
      if (sup.onStair && sup.y > feetY && sup.y <= feetY + 0.55) {
        feetY = lerp(feetY, sup.y, 0.45);
      }
    }

    // 垂直重力與貼地／上下階梯平滑插值
    const sup = this.getSupport(x, z, feetY);
    const diff = sup.y - feetY;
    let onGround = false;

    if (diff > 0.002) {
      // 上樓梯或踏上台階：平滑快速抬升
      feetY = lerp(feetY, sup.y, clamp(dt * 18, 0.18, 0.85));
      if (Math.abs(sup.y - feetY) < 0.008) feetY = sup.y;
      velY = 0;
      onGround = true;
    } else if (diff >= -0.42 && velY <= 0) {
      // 下樓梯或緩下坡：貼合階梯平順下降，不產生墜落感
      feetY = lerp(feetY, sup.y, clamp(dt * 18, 0.18, 0.85));
      if (Math.abs(sup.y - feetY) < 0.008) feetY = sup.y;
      velY = 0;
      onGround = true;
    } else {
      // 真正懸空：受重力下落並平穩落地
      velY = Math.max(-24, velY - GRAVITY * dt);
      feetY += velY * dt;
      if (feetY <= sup.y) {
        feetY = sup.y;
        velY = 0;
        onGround = true;
      }
    }

    state.x = x;
    state.z = z;
    state.feetY = feetY;
    state.velY = velY;
    state.onGround = onGround;
    state.onStair = sup.onStair;
    return {
      x,
      feetY,
      eyeY: feetY + PLAYER_EYE_H,
      z,
      velY,
      onGround,
      onStair: sup.onStair
    };
  }

  // ---- 9. 自由飛行模式步進 ----
  stepFly(pos, dx, dy, dz) {
    const x = clamp(pos.x + dx, FLY_BOUNDS.minX, FLY_BOUNDS.maxX);
    const z = clamp(pos.z + dz, FLY_BOUNDS.minZ, FLY_BOUNDS.maxZ);
    const minGroundY = this._groundFn(x, z, 0) + FLY_BOUNDS.minY;
    const y = clamp(pos.y + dy, minGroundY, FLY_BOUNDS.maxY);
    return { x, y, z };
  }

  // ---- 10. 從飛行／鳥瞰安全降落至地面或最近可站立樓層 ----
  findSafeWalkDrop(wx, wy, wz) {
    const cx = clamp(wx, CAMPUS_BOUNDS.minX + 1, CAMPUS_BOUNDS.maxX - 1);
    const cz = clamp(wz, CAMPUS_BOUNDS.minZ + 1, CAMPUS_BOUNDS.maxZ - 1);

    // 找出 (x, z) 處所有在 wy 以下的可站立高度（由高到低嘗試）
    const candidateYs = (tx, tz) => {
      const ys = [this._groundFn(tx, tz, 0)];
      for (let i = 0; i < this.floors.length; i++) {
        const f = this.floors[i];
        if (f.y > wy + 0.5) continue;
        let lx = tx, lz = tz;
        if (f.xf) { const p = f.xf.toLocal(tx, tz); lx = p[0]; lz = p[1]; }
        if (lx >= f.minX && lx <= f.maxX && lz >= f.minZ && lz <= f.maxZ) ys.push(f.y);
      }
      ys.sort((a, b) => b - a);
      return ys;
    };

    // 先在原地嘗試，再螺旋外擴最多 14m 尋找無阻擋落腳點
    const offsets = [[0, 0]];
    for (let r = 0.8; r <= 14.0; r += 0.8) {
      const n = Math.max(8, Math.round(r * 4));
      for (let k = 0; k < n; k++) {
        const ang = (k / n) * Math.PI * 2;
        offsets.push([Math.cos(ang) * r, Math.sin(ang) * r]);
      }
    }

    for (const [ox, oz] of offsets) {
      const tx = clamp(cx + ox, CAMPUS_BOUNDS.minX + 1, CAMPUS_BOUNDS.maxX - 1);
      const tz = clamp(cz + oz, CAMPUS_BOUNDS.minZ + 1, CAMPUS_BOUNDS.maxZ - 1);
      const ys = candidateYs(tx, tz);
      for (const fy of ys) {
        if (!this.isBlockedAt(tx, fy, tz, PLAYER_RADIUS + 0.04)) {
          return { x: tx, feetY: fy, eyeY: fy + PLAYER_EYE_H, z: tz };
        }
      }
    }

    // 保底：回傳校門中庭安全點
    const fallbackY = this._groundFn(20, -10, 0);
    return { x: 20, feetY: fallbackY, eyeY: fallbackY + PLAYER_EYE_H, z: -10 };
  }
}

export const WALK_CONSTANTS = {
  PLAYER_RADIUS,
  PLAYER_EYE_H,
  PLAYER_HEAD_H,
  STEP_UP_MAX,
  WALK_SPEED: 3.1,
  SPRINT_SPEED: 5.8,
  FLY_SPEED: 13.0,
  FLY_SPRINT_SPEED: 28.0,
  TURN_SPEED: 1.95
};
