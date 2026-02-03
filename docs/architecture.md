# 系統架構文件 (System Architecture)

**專案名稱**: Inventory Manager (庫存管理系統)
**目標**: 提供一個靜態網頁介面，讓使用者可以讀取並更新 Google Sheet 中的庫存資料。

## 系統概觀

本系統採用 **Serverless** 架構，由以下三個主要部分組成：

1.  **前端 (Frontend)**: GitHub Pages (靜態網頁)
2.  **後端 (Backend)**: Google Apps Script (API)
3.  **資料庫 (Database)**: Google Sheets

### 架構圖

```mermaid
graph LR
    User[使用者] -->|瀏覽/操作| Web[GitHub Pages (Frontend)]
    Web -->|GET (讀取)| GAS[Google Apps Script]
    Web -->|POST (更新)| GAS
    GAS -->|讀寫| Sheet[Google Sheets]
```

## 元件詳細說明

### 1. 前端 (GitHub Pages)
- **技術棧**: HTML5, CSS3, Vanilla JavaScript。
- **外部套件**:
    - `PapaParse`: 用於解析 CSV 格式資料。
    - `html5-qrcode`: 用於掃描條碼。
- **功能**:
    - **工具入口**: 進入「打工仔的盤點工具」。
    - **首頁**: 導航至掃描或查看功能。
    - **庫存查看**: 以表格顯示庫存，支援手動重新整理 (Refresh)。
    - **掃描功能**: 使用相機掃描條碼，查詢商品資訊。
    - **進/出貨紀錄**: 以掃條碼寫入進貨或出貨紀錄（含點貨人員、時間戳）。
    - **商品明細更新 (規劃中)**: 可掃條碼或手動輸入條碼，並手動輸入品項名稱更新明細。

### 2. 後端 (Google Apps Script)
由於 GitHub Pages 是靜態託管，無法安全地直接連線 Google Sheets API (會暴露金鑰)。因此，我們使用 Google Apps Script (GAS) 作為中介層（目前為可選元件，尚未與前端寫入流程串接）。

- **`doGet(e)`**:
    - 處理 GET 請求。
    - 讀取 Sheet 所有資料，轉換為 JSON 格式回傳。
- **`doPost(e)`**:
    - 處理 POST 請求。
    - 接收 JSON Payload (包含 `barcode`, `action` 或 `quantity`)。
    - 根據 Barcode 搜尋對應行數，並更新數量。

### 3. 資料庫 (Google Sheets)
- **工作表結構**（四個工作表）:
    - **商品明細表**: `條碼`、`名稱`、`規格`、`單價`、`庫存上限`、`庫存下限`。
    - **進貨紀錄表**: `日期`、`商品名稱`、`數量`、`進貨廠商`、`點貨人員`。
    - **出貨紀錄表**: `日期`、`商品名稱`、`數量`、`客戶資訊`、`點貨人員`。
    - **即時庫存查詢表 (樞紐分析)**:
        - 以 `=SUMIF()` 計算庫存（期初庫存 + 總進貨量 - 總出貨量）。
        - 作為前端查詢/顯示的資料來源。

## 資料流與互動流程
### 讀取流程
1. 前端透過 Google Sheets 的 CSV 匯出網址讀取資料。
2. `PapaParse` 解析 CSV 成 JSON。
3. 表格渲染並提供快速查閱。

### 掃描流程
1. 使用者先填寫「點貨人員」與選擇「進貨/出貨」。
2. `html5-qrcode` 取得條碼值。
3. 系統建立進貨或出貨紀錄，並自動寫入更新時間。
4. 即時庫存查詢表依公式自動更新。

### 商品明細更新流程 (規劃中)
1. 使用者選擇「商品明細更新」。
2. 掃條碼或手動輸入條碼。
3. 手動輸入品項名稱與庫存初始量（必填），庫存下限需為整數。
4. 後端 GAS 寫入/更新「商品明細表」對應資料。
5. 前端顯示「儲存成功/失敗」回饋訊息，成功後清除欄位。

### 寫入流程
1. 前端提交 `barcode`、`quantity`、`type (in/out)`、`staff`。
2. 後端 GAS 寫入「進貨紀錄表」或「出貨紀錄表」，並補上時間戳。
3. 即時庫存查詢表自動更新。

## 設定與可調整項
- **Google Sheet ID**: 定義在前端 `script.js` 的 `SHEET_ID`。
- **資料來源表**: 建議前端讀取「即時庫存查詢表」的 CSV。
- **資料欄位名稱**: 需與表格標題一致（例：條碼、名稱、數量）。
- **資料存取權限**: 需允許前端讀取 CSV（建議設定為可用連結存取或發佈到網頁）。

## 已知限制
- CSV 匯出依賴 Google Sheets 分享/發佈設定。
- 商品明細更新功能尚未上線。

## 安全性考量
- **API 權限**: Google Apps Script 部署為 Web App 時，權限設定為 `Execute as: Me` (擁有者)，`Access: Anyone` (任何網路使用者)。
- **資料保護**: 建議在 GAS 中增加 Token 驗證，前端請求需附上 `token`，避免未授權寫入。

## 延伸與擴充方向
- 加入前端寫入流程與後端驗證。
- 提供權限控管（Token 或 Google Identity）。
- 增加查詢/篩選與批次調整功能。
