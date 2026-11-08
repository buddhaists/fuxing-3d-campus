# 屏東縣屏東市復興國小 3D 數位校園 (3D Digital Campus)

> **115學年度 屏東縣屏東市復興國民小學 互動式三維校園導覽系統**  
> 融合高精度 1:1 建築測繪、真實外立面彩繪壁畫、日夜光影模擬、多樓層二維建築平面圖與全校 66 處教室處室前走廊導航定位。

---

## 🌟 核心特色 (Key Features)

1. **三維沉浸式校園漫遊**
   - 涵蓋五大主體建築：**北棟（愛悅樓）**、**南棟（興學樓）**、**西棟（育樂樓）**、**東棟（彩繪行政大樓）**、**新棟（幼兒園）**。
   - 操場 PU 跑道、司令台、球場、中庭花園水池、復興路正門、新舊南側門與西後門等全校園設施。

2. **115學年度 全校 66 處教室處室精準定位**
   - 點選任一班級或處室，鏡頭即刻平滑飛往該教室的**前走廊（Front Corridor）**視角，直視教室門面與課桌椅陳設。
   - 點選各建築或設施，鏡頭自動切換為**正前方特寫視角（Front View）**。

3. **二維多樓層建築平面圖（2D Plan & Minimap）**
   - 支援 **1F / 2F / 3F / B1** 樓層切換，即時高亮教室代碼與名稱，點選即與三維空間雙向聯動。

4. **環境光影與四季模擬**
   - 24 小時晝夜即時太陽軌跡與動態陰影、晨曦、正午、黃昏夕照與校園夜景燈火。
   - 春、夏、秋、冬四季色溫與植被調色切換。

5. **第一人稱地面步行漫遊（Walk Mode）**
   - 鍵盤 `WASD` / 方向鍵行走，滑鼠視線轉向，支援地面碰撞偵測與預設導覽路徑。

6. **漸進式秒開極速架構（Progressive Instant-On & Service Worker PWA）**
   - **首畫面 < 30ms 零白屏瞬間呈現**：採用 1:1 精確視角 2.5D 高清預覽疊加層與非阻塞字型排程，開啟網頁瞬間立即可見校園全貌與 UI 目錄。
   - **全面資源解耦與依賴本土化**：Three.js 核心與 OrbitControls 本機收納（告別 unpkg CDN 連線延遲），2.85MB 細部貼圖資料自 `<head>` 移出並於背景空閒時動態串流加載。
   - **使用者預先互動佇列（Pre-interactive Queue）**：首頁載入期間點選任意地標立即標記，3D 引擎就緒後平滑無感淡入切換並自動執行鏡頭飛行。
   - **Service Worker 離線快取**：自動快取 App Shell 與三維核心模組，第二次開啟達 0.00 毫秒極速秒開。

---

## 🚀 部署到 GitHub Pages (How to Deploy)

1. 在 GitHub 上建立一個新的公開儲存庫（Repository），例如 `fuxing-3d-campus`。
2. 在本資料夾執行以下指令將專案推送到 GitHub：
   ```bash
   git remote add origin https://github.com/<您的使用者名稱>/<您的儲存庫名稱>.git
   git push -u origin main
   ```
3. 前往 GitHub 儲存庫頁面的 **Settings** > **Pages**：
   - **Source**：選擇 `Deploy from a branch`
   - **Branch**：選擇 `main` 分支，目錄選擇 `/ (root)`
   - 點擊 **Save**。
4. 稍等約 1 分鐘，即可獲得正式的線上網址：  
   `https://<您的使用者名稱>.github.io/<您的儲存庫名稱>/`

---

## 📁 檔案結構 (File Structure)

```
fuxing-3d-campus/
├── index.html        # 單一整合型 WebGL / Three.js 應用程式核心 (約 809 KB)
├── tex/              # 3D 幾何立面材質、彩繪壁畫數據與實景對照圖集 (79 個檔案，約 166 MB)
├── .gitignore        # Git 忽略設定
└── README.md         # 專案介紹與發布指引
```

---

## 🛠️ 本地執行 (Local Development)

本專案為純前端靜態網頁，無需安裝 Node.js 或建置工具：
- 使用 VS Code 的 **Live Server** 擴充功能直接點擊 `Go Live` 開啟 `index.html`。
- 或在終端機執行：`python -m http.server 8000` 並在瀏覽器訪問 `http://localhost:8000`。
