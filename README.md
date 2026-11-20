# 想飛記帳本 PWA + 私人 Google Sheets

既有記帳介面加入 PWA 安裝、離線快取、Google Sheets 雙向存取與跨裝置同步。公開網站只提供程式；個人資料留在私人試算表與裝置。此程式碼已提供串接，**必須完成 Google Apps Script 的真實部署才會有雲端資料庫**。

## 使用

1. 依 [建表與部署步驟](setup.html) 在自己的 Google 帳號部署 [Code.gs](google-apps-script/Code.gs) 與 [資訊清單](google-apps-script/appsscript.json)。執行 `setup` 建立新的私人「想飛記帳本」。
2. 在 App 設定填入 `/exec` 網址及試算表「連線設定」B2 金鑰。空白雲端首次同步會存入本機帳本；既有雲端資料不會在未選擇版本時被覆蓋。
3. 複製「跨裝置私人連線網址」給自己的手機、電腦。連線資訊透過 URL fragment 傳入，不會寫進 GitHub，也不會傳給靜態網站伺服器；開啟後立即移除 fragment，保存在該裝置。誰持有網址，誰就可以讀寫帳本，請私下保存。
4. 新增一筆收支，確認「已同步 Google Sheets」並在另一台裝置讀取。前景約每 30 秒檢查雲端；離線先保留本機，回到 App 後重試。這不是持續推播或保證的背景同步。

試算表含連線設定、帳本資料、交易明細、固定支出、月結報表。「帳本資料」是來源，其餘帳目分頁是方便閱讀的投影；直接改投影儲存格不會修改 App。金額來源以整數分儲存，明細以元顯示。單一帳本上限為 JSON 100 萬字元及每類 10,000 筆；接近配額時請下載備份。

多裝置同時修改以版本檢查與 Apps Script 鎖阻擋覆寫，保留本機並要求明確選擇。這個人版不自動合併兩份帳本。同步寫入成功但回應遺失時，也可能提示版本衝突；先備份再選擇。

## 開發與檢查

不需安裝套件。使用 Node.js 24、Python 3：

```bash
node --test tests/*.test.mjs
node scripts/build-site.mjs
python3 -m http.server 4173 --bind 0.0.0.0 --directory dist
```

開發伺服器只提供靜態檔；實際 Google 存取需要已部署的 Apps Script。本機測試使用模擬 Google 服務驗證驗證金鑰、版本衝突、狀態完整寫入與離線重試，不能代替真實 Google 授權及跨來源網路測試。

`index.html` 是新版入口。中文手機 HTML 保留原離線版，作為獨立下載與相容性檢查。原先 Windows 絕對路徑的測試與 patch 腳本未作為部署步驟使用。

## 上傳與 GitHub Pages

`.github/workflows/pages.yml` 會測試、建立白名單網站目錄，再部署 GitHub Pages。第一次需在 GitHub repository → Settings → Pages → Build and deployment → Source 選擇 **GitHub Actions**，再執行工作流程。預期網站路徑為 `https://angela6711.github.io/angela1113-1/`；是否已上線要以 Actions／Pages 的成功結果為準。

部署只包含網站與公開後端程式範本，不包含儲存庫內的 Excel、舊部署壓縮檔或裝置連線設定。原先已追蹤的 Excel 和壓縮檔仍在 Git 儲存庫，並未刪除；不要把私人帳本匯出檔 commit 到公開儲存庫。

更新靜態檔時請同步更改 `sw.js` 的 CACHE 版本；設定頁可套用等待中的版本。快取僅處理本站白名單靜態檔，不快取 Google API、POST 或金鑰。Apps Script 程式更新後，須在「管理部署作業」選擇新版本，維持原 `/exec` 部署網址。

## 存取與限制

- Google 試算表保持私人，後端以擁有者身分執行，入口以隨機 64 位十六進位金鑰保護。金鑰只放私人試算表、雜湊指令碼屬性及你自己的裝置；透過 HTTPS POST 傳送。
- 請避免在共用或不可信裝置設定。此個人版使用瀏覽器 localStorage 保存連線金鑰與離線帳目，並非裝置端加密保險箱。第三方 JavaScript 不會載入主程式。
- Google Apps Script 有執行與試算表配額，Workspace 管理員也可能禁止「任何人」的 web app 部署。這些限制需要 Google 帳號擁有者處理。
- 使用者首次執行自己建立的 Apps Script 可能出現未驗證應用提示；確認程式內容與擁有者後再授權。無須提供 Google 密碼給本專案。
- 即時匯率功能另外依賴 ExchangeRate-API 的網路可用性，不影響記帳與 Sheets 同步。
