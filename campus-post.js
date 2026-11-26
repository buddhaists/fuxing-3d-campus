// ============================================================================
// 屏東縣復興國小 3D 數位校園 — 後處理（環境光遮蔽 GTAO + 光暈 Bloom）
// ----------------------------------------------------------------------------
// 只在「精緻」畫質（桌機）以動態 import 載入，其他畫質完全不下載、不執行。
//
//  * GTAO：建築轉角、走廊、樹下、欄杆與地面交接處的接觸陰影。
//    鏡頭移動時暫停（避免每幀多畫一次整個場景的法線/深度），停止後補繪一張含 AO 的畫面。
//  * Bloom：白天門檻極高（只有太陽光暈會發光），夜間降低門檻讓窗光、路燈泛出光暈。
//  * 本專案啟用 logarithmicDepthBuffer，three 內建的 GTAO / 去噪 shader 只認標準透視深度，
//    因此在執行期把「對數深度」換算回標準深度後再交給原本的演算法（見 patchLogDepth）。
// ============================================================================
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// three 的對數深度：depth = log2(1 + w) / log2(far + 1)，w 為裁切空間 w（= −viewZ）
// → −viewZ = (far + 1)^depth − 1，再以 viewZToPerspectiveDepth 轉回標準透視深度
function patchLogDepth(mat, camera, replacements) {
  mat.uniforms.logCamNear = { value: camera.near };
  mat.uniforms.logCamFar = { value: camera.far };
  let fs = mat.fragmentShader;
  const helper = `
    uniform float logCamNear;
    uniform float logCamFar;
    float logToPerspDepth(const in float d) {
      if (d >= 1.0) return 1.0;
      float viewZ = -(pow(logCamFar + 1.0, d) - 1.0);
      return viewZToPerspectiveDepth(viewZ, logCamNear, logCamFar);
    }
  `;
  const anchor = '#include <packing>';
  const at = fs.indexOf(anchor);
  if (at < 0) return false;
  fs = fs.slice(0, at + anchor.length) + helper + fs.slice(at + anchor.length);
  let hits = 0;
  for (const src of replacements) {
    if (fs.includes(src)) { fs = fs.split(src).join(`logToPerspDepth(${src})`); hits++; }
  }
  mat.fragmentShader = fs;
  mat.needsUpdate = true;
  return hits > 0;
}

export function createPostFX(renderer, scene, camera) {
  const size = renderer.getSize(new THREE.Vector2());
  const pr = renderer.getPixelRatio();
  // 多重取樣的 HDR 畫面緩衝：保留 MSAA 抗鋸齒（否則改走 composer 後邊緣會出現鋸齒）
  const rt = new THREE.WebGLRenderTarget(size.x * pr, size.y * pr, {
    type: THREE.HalfFloatType,
    samples: renderer.capabilities.isWebGL2 ? 4 : 0
  });
  const composer = new EffectComposer(renderer, rt);
  composer.setPixelRatio(pr);
  composer.setSize(size.x, size.y);

  composer.addPass(new RenderPass(scene, camera));

  const gtao = new GTAOPass(scene, camera, size.x, size.y);
  gtao.output = GTAOPass.OUTPUT.Default;
  gtao.blendIntensity = 1.0;
  // 螢幕空間半徑：半徑單位為「100 像素在該像素深度的世界寬度」，逐像素自動縮放。
  // 固定公尺半徑時，遠景需約 5 m 才有效果，但同樣 5 m 在室內近景會在桌椅周圍形成大片髒污暗斑；
  // 改用螢幕空間後，遠處約 2 m、近處約 0.1～0.3 m，兩種情況都自然。
  gtao.updateGtaoMaterial({ screenSpaceRadius: true, radius: 0.55, distanceExponent: 1.6, thickness: 0.9, scale: 1.4, samples: 12, distanceFallOff: 1.0 });
  gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 10, rings: 3, samples: 16 });
  if (renderer.capabilities.logarithmicDepthBuffer) {
    patchLogDepth(gtao.gtaoMaterial, camera, [
      'textureLod(tDepth, uv.xy, 0.0).DEPTH_SWIZZLING',
      'texelFetch(tDepth, uv.xy, 0).DEPTH_SWIZZLING'
    ]);
    patchLogDepth(gtao.pdMaterial, camera, [
      'textureLod(tDepth, uv.xy, 0.0).r',
      'texelFetch(tDepth, uv.xy, 0).r',
      'textureLod(tDepth, uv.xy, 0.0).a',
      'texelFetch(tDepth, uv.xy, 0).a'
    ]);
  }
  composer.addPass(gtao);

  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.15, 0.45, 2.6);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  let lastW = 0, lastH = 0, lastPr = 0;

  const api = {
    enabled: true,
    composer, gtao, bloom,
    // 夜間：降低門檻讓窗光與路燈發光；白天只讓遠大於白牆亮度的太陽光暈發光
    setNight(isNight, isDusk) {
      if (isNight) { bloom.threshold = 0.55; bloom.strength = 0.55; bloom.radius = 0.5; }
      else if (isDusk) { bloom.threshold = 1.6; bloom.strength = 0.3; bloom.radius = 0.5; }
      else { bloom.threshold = 2.6; bloom.strength = 0.15; bloom.radius = 0.45; }
    },
    render(moving) {
      // 解析度或視窗大小改變（動態解析度、自動畫質、resize）時同步 composer
      const w = window.innerWidth, h = window.innerHeight, p = renderer.getPixelRatio();
      if (w !== lastW || h !== lastH || p !== lastPr) {
        lastW = w; lastH = h; lastPr = p;
        composer.setPixelRatio(p);
        composer.setSize(w, h);
      }
      gtao.enabled = !moving;
      composer.render();
    },
    dispose() {
      composer.passes.forEach(ps => ps.dispose && ps.dispose());
      rt.dispose();
    }
  };
  return api;
}
