# 想飛記帳本：公開共用 PWA + Google Sheets

任何訪客開啟同一個網站網址，都可查看、新增、修改、刪除同一份帳本；不需要登入或金鑰。離線先儲存在裝置，上線後同步。這是依擁有者選擇的**公開讀寫模式**。

**程式碼已提供完整串接，但實際 Google 試算表必須由 Google 帳號擁有者授權並部署 Apps Script。指定目的地為 [這份 Google 試算表](https://docs.google.com/spreadsheets/d/17BTKjJJPznABLK0su4HlHf5UkvCicoeFbK7aFf-tu6s/edit)。`cloud-config.json` 的 `url` 尚未填入時，只能本機記帳，不能跨裝置同步。**

## 讓同一個網址連到同一份資料

1. 依 [Google 建表與部署步驟](setup.html)，從指定試算表的「擴充功能 → Apps Script」開啟專案，貼入 [Code.gs](google-apps-script/Code.gs) 及 [資訊清單](google-apps-script/appsscript.json)。執行帳號須能編輯這份試算表。
2. 執行 `setup` 並授權，會在指定試算表新增五個「想飛_」分頁，保留原本分頁與資料，不另外建立試算表。重複執行會保留既有帳目；若首次設定時已有同名分頁，會停止，不會覆寫。
3. 部署為網頁應用程式：以「我」執行、允許「任何人」存取。取得 `/exec` 網址。
4. 將 `/exec` 網址填入 [cloud-config.json](cloud-config.json) 的 `url`，提交並重新發布網站。這是公開的連線設定，不需 Google 密碼或秘密金鑰。
5. 每位訪客開啟相同網站網址即會自動連線。設定頁也可手動輸入部署網址，或複製含連線參數的共用網址供部署測試；正式使用以 `cloud-config.json` 統一設定為準。

在一台裝置新增收支，確認「已同步 Google Sheets」，再用另一台開啟同一個網址驗證。前景約每 30 秒檢查雲端，本機修改後約 1 秒啟動同步，也可手動「立即同步」。不是持續推播，也不保證關閉 App 後背景同步。

## 資料與衝突

指定試算表新增「想飛_連線設定」「想飛_帳本資料」「想飛_交易明細」「想飛_固定支出」「想飛_月結報表」。「想飛_帳本資料」是來源；明細是方便閱讀的投影，直接改投影儲存格不會修改 App。金額以整數分保存，明細以元顯示。單一帳本上限 JSON 100 萬字元、每類 10,000 筆。

多裝置同時修改，以版本檢查與 Apps Script 鎖阻擋覆寫。App 會保留本機資料，要求明確選擇保留本機或雲端；請先下載 JSON 備份。此版不自動合併兩份帳本。公開訪客都可讀寫，沒有使用者隔離；試算表檔案本身可保持限制分享，公開的是網站 API。

## 開發與測試

無套件依賴，使用 Node.js 24、Python 3：

```bash
node --test tests/*.test.mjs
node scripts/build-site.mjs
python3 -m http.server 4173 --bind 0.0.0.0 --directory dist
```

若機器提供 Chromium，可另執行 `node tests/browser-smoke.mjs`，檢查真正瀏覽器的離線重開、記帳、公開連線網址，以及模擬 Sheets 存取。

本機自動化測試使用模擬 Google 服務，驗證匿名讀寫、版本衝突、完整快照寫入及離線重試；不能代替真實 Google 授權與跨來源網路測試。實際部署後請用兩台裝置確認資料來回存取。

`index.html` 是 PWA 入口。中文手機 HTML 保留原離線版，供獨立下載及相容性檢查。原本 Windows 絕對路徑的 patch 腳本不是部署步驟。

## GitHub Pages

[工作流程](.github/workflows/pages.yml) 會測試、建立網站目錄、部署 Pages。第一次需到 GitHub repository → Settings → Pages → Source 選擇 **GitHub Actions**，再執行「Test and publish PWA」。預期網站路徑為 `https://angela6711.github.io/angela1113-1/`；是否已上線須以 Pages 與 Actions 成功結果確認。

部署目錄只包含網站與公開 Apps Script 範本，不包含儲存庫內的 Excel、舊部署壓縮檔或裝置資料。原先已追蹤的 Excel 和壓縮檔仍在 Git 儲存庫，未予刪除。

更新快取檔時同步更改 `sw.js` 的 CACHE 版本。設定頁可套用等待中的更新；同步 API 與 `cloud-config.json` 不進靜態快取。Apps Script 更新後須到「管理部署作業」選擇新版本，保持原 `/exec` 網址。

## Google 需求

Google 帳號需有 Apps Script 與試算表權限。Workspace 管理員可能禁止匿名 web app 存取，需由管理員允許。Google Apps Script 有執行與試算表配額；這是輕量共用帳本，不保證大量匿名訪客的服務容量。即時匯率另外依賴 ExchangeRate-API，不影響帳目存取。
