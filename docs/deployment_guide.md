# 後端部署指南 (Backend Deployment Guide)

本指南將引導您如何設定 Google Apps Script (GAS) 以啟用資料寫入功能，並補充前端讀取所需的 Google Sheets 設定。

## 前置準備
- 擁有一份 Google Sheet 作為庫存資料表。
- 建議建立四個工作表（表頭名稱需一致）：
  - **商品明細表**: `條碼`、`名稱`、`規格`、`單價`、`庫存上限`、`庫存下限`
  - **進貨紀錄表**: `日期`、`商品名稱`、`數量`、`進貨廠商`、`點貨人員`
  - **出貨紀錄表**: `日期`、`商品名稱`、`數量`、`客戶資訊`、`點貨人員`
  - **即時庫存查詢表 (樞紐分析)**: 使用 `=SUMIF()` 公式自動計算庫存

## 步驟 1: 開啟腳本編輯器
1. 開啟您的 Google Sheet。
2. 點擊選單中的 **擴充功能 (Extensions)** > **Apps Script**。

## 步驟 2: 貼上程式碼
刪除編輯器中原有的程式碼，並貼上以下內容：

```javascript
/*
 * 庫存管理系統後端 API
 * 支援功能：讀取庫存 (GET)、更新庫存 (POST)
 */

// GET 請求：回傳所有資料
function doGet(e) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const data = sheet.getDataRange().getValues();
  
  // 將二維陣列轉換為 JSON 物件陣列
  const headers = data[0];
  const rows = data.slice(1);
  const result = rows.map(row => {
    let obj = {};
    headers.forEach((header, index) => {
      obj[header] = row[index];
    });
    return obj;
  });

  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// POST 請求：更新庫存
function doPost(e) {
  try {
    const postData = JSON.parse(e.postData.contents);
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    
    // 尋找欄位索引
    const barcodeIndex = headers.indexOf('Barcode (條碼)'); 
    const quantityIndex = headers.indexOf('Quantity (數量)');
    const timeIndex = headers.indexOf('Last Updated (最後更新時間)');
    
    if (barcodeIndex === -1 || quantityIndex === -1) {
      throw new Error('找不到必要的欄位 (Barcode 或 Quantity)');
    }

    let found = false;
    let newQuantity = 0;

    // 搜尋對應的 Barcode
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][barcodeIndex]) === String(postData.barcode)) {
        // 找到商品，計算新數量
        let currentQty = parseInt(data[i][quantityIndex]) || 0;
        
        if (postData.action === 'increment') {
          newQuantity = currentQty + 1;
        } else if (postData.action === 'decrement') {
          newQuantity = Math.max(0, currentQty - 1);
        } else if (typeof postData.quantity !== 'undefined') {
          newQuantity = parseInt(postData.quantity);
        }
        
        // 寫入新數量 (列數為 i+1)
        sheet.getRange(i + 1, quantityIndex + 1).setValue(newQuantity);
        
        // 更新時間
        if (timeIndex !== -1) {
            sheet.getRange(i + 1, timeIndex + 1).setValue(new Date());
        }

        found = true;
        break;
      }
    }

    if (!found) {
      return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: '找不到該條碼' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService.createTextOutput(JSON.stringify({ status: 'success', newQuantity: newQuantity }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
```

## 步驟 3: 部署為 Web 應用程式
1. 點擊右上角的 **部署 (Deploy)** > **新增部署 (New deployment)**。
2. 點擊齒輪圖示，選擇 **網頁應用程式 (Web app)**。
3. 設定如下：
    - **說明 (Description)**: Inventory API
    - **執行身份 (Execute as)**: **我 (Me)** (您的帳號)
    - **存取權限 (Who has access)**: **任何人 (Anyone)** (重要！這樣網頁才能存取)
4. 點擊 **部署 (Deploy)**。
5. **複製網頁應用程式網址 (Web App URL)**。

## 步驟 4: 設定 Google Sheets 讀取權限
前端透過 CSV 讀取 Google Sheets，請完成以下其中一種設定：
1. **發佈到網路**：在 Google Sheets 中點選 **檔案 > 發佈到網路**，選擇要發佈的工作表。
2. **分享權限**：將表單設定為「任何人知道連結即可檢視」。

## 步驟 5: 建立即時庫存查詢表
1. 在「即時庫存查詢表」建立欄位：`商品名稱`、`期初庫存`、`總進貨量`、`總出貨量`、`即時庫存`。
2. 使用 `SUMIF()` 計算進/出貨總量（以下示意）：
   - 總進貨量：`=SUMIF(進貨紀錄表!B:B, A2, 進貨紀錄表!C:C)`
   - 總出貨量：`=SUMIF(出貨紀錄表!B:B, A2, 出貨紀錄表!C:C)`
   - 即時庫存：`=B2 + C2 - D2`
3. 若使用條碼做查詢，可將條碼欄位也加入並以 `VLOOKUP` 或 `XLOOKUP` 對應商品明細表。

## 步驟 6: 前端設定
1. 開啟 `script.js`。
2. 更新 `SHEET_ID` 為您的 Google Sheets ID：
   - 範例：`https://docs.google.com/spreadsheets/d/<SHEET_ID>/edit`
3. 建議前端讀取「即時庫存查詢表」的 CSV，以顯示最新庫存。
4. 確認前端能成功讀取資料並顯示表格。

## 測試方式
- **讀取測試**：開啟前端頁面，確認資料表可載入。
- **寫入測試 (GAS)**：以 API 測試工具（如 Postman）對 Web App URL 發送 POST，確認回傳 `success`。
- **進/出貨紀錄測試**：確認新增紀錄時會寫入日期與點貨人員欄位。
- **商品明細更新 (規劃中)**：確認可掃條碼或輸入條碼後，手動填寫品項名稱並寫入商品明細表。

## 常見問題排除
- **讀取不到資料**：確認 Sheet 已發佈到網路或分享權限為可檢視。
- **欄位對不上**：請檢查表頭名稱是否與程式碼一致。
- **POST 無法寫入**：確認部署權限為 `Anyone` 並重新部署。

## 下一步
若需要啟用前端寫入功能，請於 `script.js` 串接 GAS Web App URL 並實作：
- 掃條碼前輸入「點貨人員」。
- 選擇「進貨 / 出貨」類型。
- 寫入對應紀錄表並自動補上更新時間。
- 進入工具頁增加「商品明細更新」入口，支援掃條碼或手動輸入條碼與品項名稱。
