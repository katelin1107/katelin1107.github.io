const SHEET_ID = '1sQB5IIknjniETE7VAHmWHpY4XSJR0HKY80zhpqk4PY8';
const SHEET_GID = '226388722'; // 即時庫存查詢表的工作表 ID
const SHEET_EXPORT_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${SHEET_GID}`;
const PRODUCT_SHEET_GID = '0'; // 商品明細表的工作表 ID
const PRODUCT_EXPORT_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${PRODUCT_SHEET_GID}`;
const GAS_WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbxCP05mnRebBqfrCKCZk31TxSJ1_fcsV4kW-fLS7LNfPiUq2Q9ybMzfbHEL67ETAqp-/exec'; // 請填入 Google Apps Script Web App URL
const API_TOKEN = 'yun-202602'; // 與 GAS Script Properties 的 API_TOKEN 一致

let sheetData = []; // Store data globally for lookup
let productDetailsData = [];
let html5QrcodeScanner = null;
let productQrcodeScanner = null;
let fileQrcodeReader = null;

document.addEventListener('DOMContentLoaded', () => {
    // Initial fetch
    fetchData();
    fetchProductDetailsData();

    // Setup Refresh Button
    const refreshBtn = document.getElementById('refresh-btn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            refreshBtn.classList.add('spinning');
            fetchData().finally(() => {
                setTimeout(() => {
                    refreshBtn.classList.remove('spinning');
                }, 500);
            });
        });
    }

    initScanControls();
});

// UI Navigation
function showSection(sectionId) {
    // Hide all sections
    document.querySelectorAll('main').forEach(el => el.classList.add('hidden'));

    // Show target section
    const target = document.getElementById(sectionId);
    if (target) {
        target.classList.remove('hidden');
    }

    // Handle Scanner specific logic
    if (sectionId === 'scanner-section') {
        resetScanStatusUI();
    }

    if (sectionId === 'product-update-section') {
        resetProductScannerUI();
    }
}

// Scanner Logic
function startScanner() {
    if (html5QrcodeScanner) {
        // Already running or initialized
        return;
    }

    const supportedFormats = [
        Html5QrcodeSupportedFormats.CODE_128
    ];

    // Initialize scanner
    // fps: frames per second, qrbox: scanning region size
    html5QrcodeScanner = new Html5QrcodeScanner(
        "reader",
        {
            fps: 10,
            qrbox: { width: 320, height: 200 },
            formatsToSupport: supportedFormats,
            experimentalFeatures: { useBarCodeDetectorIfSupported: true }
        },
        /* verbose= */ false
    );

    html5QrcodeScanner.render(onScanSuccess, onScanFailure);
}

function stopScanner() {
    if (html5QrcodeScanner) {
        try {
            html5QrcodeScanner.clear().then(() => {
                html5QrcodeScanner = null;
            }).catch(error => {
                console.error("Failed to clear scanner", error);
            });
        } catch (e) {
            console.error(e);
        }
    }
}

// Product Update Scanner
function startProductScanner() {
    const reader = document.getElementById('product-reader');
    if (!reader) return;

    if (productQrcodeScanner) {
        return;
    }

    const supportedFormats = [
        Html5QrcodeSupportedFormats.CODE_128
    ];

    productQrcodeScanner = new Html5QrcodeScanner(
        "product-reader",
        {
            fps: 10,
            qrbox: { width: 320, height: 200 },
            formatsToSupport: supportedFormats,
            experimentalFeatures: { useBarCodeDetectorIfSupported: true }
        },
        false
    );

    productQrcodeScanner.render(onProductScanSuccess, onScanFailure);
    updateProductStatus('啟動掃描中...');
}

function stopProductScanner() {
    if (productQrcodeScanner) {
        try {
            productQrcodeScanner.clear().then(() => {
                productQrcodeScanner = null;
            }).catch(error => {
                console.error("Failed to clear product scanner", error);
            });
        } catch (e) {
            console.error(e);
        }
    }
}

async function onScanSuccess(decodedText, decodedResult) {
    // Handle the scanned code
    console.log(`Code matched = ${decodedText}`, decodedResult);

    const barcodeInput = document.getElementById('scan-barcode');
    if (barcodeInput) {
        barcodeInput.value = decodedText;
    }

    populateProductName(decodedText);
}

function onScanFailure(error) {
    // handle scan failure, usually better to ignore and keep scanning.
    // console.warn(`Code scan error = ${error}`);
}

function onProductScanSuccess(decodedText) {
    const barcodeInput = document.getElementById('product-barcode');
    if (barcodeInput) {
        barcodeInput.value = decodedText;
    }
    updateProductStatus(`已掃描條碼：${decodedText}`);
}

// Scan Controls
function initScanControls() {
    const actionButtons = document.querySelectorAll('.segmented-btn');
    actionButtons.forEach(button => {
        button.addEventListener('click', () => {
            setStockAction(button.dataset.action);
        });
    });

    setStockAction('in');

    const scanPhotoInput = document.getElementById('scan-photo');
    if (scanPhotoInput) {
        scanPhotoInput.addEventListener('change', handleScanPhoto);
    }

    const scanBarcodeInput = document.getElementById('scan-barcode');
    if (scanBarcodeInput) {
        scanBarcodeInput.addEventListener('input', () => {
            const barcode = scanBarcodeInput.value.trim();
            populateProductName(barcode);
        });
    }

    const scanSaveBtn = document.getElementById('scan-save-btn');
    if (scanSaveBtn) {
        scanSaveBtn.addEventListener('click', saveScanRecord);
    }

    const productSaveBtn = document.getElementById('product-save-btn');
    if (productSaveBtn) {
        productSaveBtn.addEventListener('click', saveProductDetail);
    }

    const productPhotoInput = document.getElementById('product-photo');
    if (productPhotoInput) {
        productPhotoInput.addEventListener('change', handleProductPhoto);
    }
}

function setStockAction(action) {
    const hiddenInput = document.getElementById('stock-action');
    const staffLabel = document.getElementById('staff-label');
    const staffInput = document.getElementById('staff-name');
    const actionButtons = document.querySelectorAll('.segmented-btn');

    actionButtons.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.action === action);
    });

    if (hiddenInput) hiddenInput.value = action;
    if (staffLabel) {
        staffLabel.textContent = action === 'in' ? '入庫人員' : '出庫人員';
    }
    if (staffInput) {
        staffInput.placeholder = action === 'in' ? '請輸入入庫人員姓名' : '請輸入出庫人員姓名';
    }
}

function getScanContext() {
    const staffInput = document.getElementById('staff-name');
    const actionInput = document.getElementById('stock-action');
    const quantityInput = document.getElementById('scan-quantity');

    const staff = staffInput?.value?.trim();
    if (!staff) {
        updateScanStatus('請先輸入人員姓名');
        return null;
    }

    const quantity = Math.max(1, parseInt(quantityInput?.value, 10) || 1);

    return {
        staff,
        type: actionInput?.value === 'out' ? 'out' : 'in',
        quantity
    };
}

function updateScanStatus(message) {
    const status = document.getElementById('scan-status');
    if (status) status.textContent = message;
}

function updateProductStatus(message) {
    const status = document.getElementById('product-status');
    if (status) status.textContent = message;
}

function populateProductName(barcode) {
    const nameInput = document.getElementById('scan-product-name');
    if (!nameInput) return;

    if (!barcode) {
        nameInput.value = '';
        updateScanStatus('');
        return;
    }

    const productName = findProductNameByBarcode(barcode);
    if (productName) {
        nameInput.value = productName;
        updateScanStatus(`已找到商品：${productName}`);
    } else {
        nameInput.value = '';
        updateScanStatus(`條碼 ${barcode} 未找到對應商品`);
    }
}

function resetScanStatusUI() {
    updateScanStatus('');
}

function resetProductScannerUI() {
    updateProductStatus('');
}

function restartScannerLater() {
    setTimeout(() => {
        const section = document.getElementById('scanner-section');
        if (section && !section.classList.contains('hidden')) {
            startScanner();
        }
    }, 1500);
}

async function postScanRecord(payload) {
    const body = JSON.stringify({
        token: API_TOKEN,
        ...payload,
        scannedAt: new Date().toISOString()
    });

    try {
        if (navigator.sendBeacon) {
            const blob = new Blob([body], { type: 'text/plain;charset=UTF-8' });
            const queued = navigator.sendBeacon(GAS_WEB_APP_URL, blob);
            if (queued) {
                return { status: 'success', optimistic: true };
            }
        }

        await fetch(GAS_WEB_APP_URL, {
            method: 'POST',
            mode: 'no-cors',
            body
        });

        return { status: 'success', optimistic: true };
    } catch (error) {
        throw error;
    }
}

async function saveScanRecord() {
    const scanContext = getScanContext();
    if (!scanContext) {
        return;
    }

    const barcodeInput = document.getElementById('scan-barcode');
    const nameInput = document.getElementById('scan-product-name');
    const barcode = barcodeInput?.value?.trim();
    let productName = nameInput?.value?.trim();

    if (!barcode) {
        updateScanStatus('請輸入或掃描條碼');
        return;
    }

    if (!productName) {
        productName = findProductNameByBarcode(barcode);
    }

    if (!productName) {
        updateScanStatus('找不到商品名稱，請先確認條碼');
        return;
    }

    if (!GAS_WEB_APP_URL) {
        updateScanStatus('尚未設定 GAS Web App URL，請先完成後端部署。');
        return;
    }

    updateScanStatus('送出中...');

    try {
        const response = await postScanRecord({
            barcode,
            productName,
            quantity: scanContext.quantity,
            type: scanContext.type,
            staff: scanContext.staff
        });

        if (response?.status === 'success') {
            const actionLabel = scanContext.type === 'in' ? '入庫' : '出庫';
            const suffix = response?.optimistic ? '（已送出，請稍後確認表單）' : '';
            updateScanStatus(`已完成${actionLabel}紀錄，數量：${scanContext.quantity}${suffix}`);
            if (barcodeInput) barcodeInput.value = '';
            if (nameInput) nameInput.value = '';
            fetchData();
        } else {
            updateScanStatus(response?.message || '寫入失敗，請稍後再試');
        }
    } catch (error) {
        console.error(error);
        updateScanStatus(error?.message || '寫入失敗，請檢查後端設定');
    }
}

function getFileQrcodeReader() {
    if (!fileQrcodeReader) {
        fileQrcodeReader = new Html5Qrcode("file-reader");
    }
    return fileQrcodeReader;
}

async function decodeBarcodeFromFile(file) {
    const reader = getFileQrcodeReader();
    const formats = [
        Html5QrcodeSupportedFormats.CODE_128,
        Html5QrcodeSupportedFormats.CODE_39,
        Html5QrcodeSupportedFormats.EAN_13,
        Html5QrcodeSupportedFormats.EAN_8,
        Html5QrcodeSupportedFormats.UPC_A
    ];

    let normalizedFile = file;
    let lastError = null;

    try {
        normalizedFile = await normalizeImageFile(file);
    } catch (error) {
        lastError = error;
    }

    normalizedFile = ensureFile(normalizedFile, file?.name);

    try {
        const detected = await detectWithBarcodeDetector(normalizedFile);
        if (detected) {
            return detected;
        }
    } catch (error) {
        lastError = error;
    }

    const attempts = [
        { mode: 'band', contrast: 1.6, binarize: false, rotate: 0 },
        { mode: 'band', contrast: 1.9, binarize: true, threshold: 160, rotate: 0 },
        { mode: 'band', contrast: 2.1, binarize: true, threshold: 140, rotate: 0 },
        { mode: 'band-wide', contrast: 1.6, binarize: false, rotate: 0 },
        { mode: 'band-wide', contrast: 1.9, binarize: true, threshold: 160, rotate: 0 },
        { mode: 'full', contrast: 1.6, binarize: false, rotate: 0 },
        { mode: 'full', contrast: 1.9, binarize: true, threshold: 160, rotate: 0 },
        { mode: 'band', contrast: 1.6, binarize: false, rotate: 90 },
        { mode: 'band', contrast: 1.9, binarize: true, threshold: 160, rotate: 90 },
        { mode: 'full', contrast: 1.6, binarize: false, rotate: 90 },
        { mode: 'full', contrast: 1.9, binarize: true, threshold: 160, rotate: 90 }
    ];

    for (const option of attempts) {
        try {
            const processed = await preprocessBarcodeImage(normalizedFile, option);
            return await reader.scanFile(processed, true, formats);
        } catch (error) {
            lastError = error;
        }
    }

    try {
        return await reader.scanFile(normalizedFile, true, formats);
    } catch (error) {
        lastError = error;
    }

    if (normalizedFile !== file) {
        try {
            return await reader.scanFile(file, true, formats);
        } catch (error) {
            lastError = error;
        }
    }

    const finalError = new Error('辨識失敗，請再拍清楚一點');
    finalError.details = lastError;
    throw finalError;
}

async function normalizeImageFile(file) {
    const lowerName = (file?.name || '').toLowerCase();
    const isHeic = file?.type === 'image/heic' || file?.type === 'image/heif' || lowerName.endsWith('.heic') || lowerName.endsWith('.heif');

    if (!isHeic) {
        return file;
    }

    if (typeof heic2any !== 'function') {
        throw new Error('HEIC 轉檔工具尚未載入');
    }

    const converted = await heic2any({
        blob: file,
        toType: 'image/jpeg',
        quality: 0.9
    });

    const output = Array.isArray(converted) ? converted[0] : converted;
    if (output instanceof Blob) {
        return output;
    }
    return new Blob([output], { type: 'image/jpeg' });
}

function ensureFile(blobOrFile, originalName = 'upload') {
    if (blobOrFile instanceof File) {
        return blobOrFile;
    }
    const name = originalName ? originalName.replace(/\.(heic|heif)$/i, '.jpg') : 'upload.jpg';
    const type = blobOrFile?.type || 'image/jpeg';
    return new File([blobOrFile], name, { type });
}

async function preprocessBarcodeImage(file, options = { mode: 'band', contrast: 1.6, binarize: false, threshold: 160, rotate: 0 }) {
    const imageBitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', { willReadFrequently: true });

    const mode = options?.mode || 'band';
    const sourceWidth = imageBitmap.width;
    const sourceHeight = imageBitmap.height;

    let cropWidth = sourceWidth;
    let cropHeight = sourceHeight;
    let cropX = 0;
    let cropY = 0;

    if (mode === 'band' || mode === 'band-wide') {
        // Crop a horizontal band from the center to focus on barcode area
        cropWidth = Math.floor(sourceWidth * 0.9);
        cropHeight = Math.floor(sourceHeight * (mode === 'band-wide' ? 0.5 : 0.35));
        cropX = Math.floor((sourceWidth - cropWidth) / 2);
        cropY = Math.floor((sourceHeight - cropHeight) / 2);
    }

    const maxWidth = 2200;
    const minWidth = 1000;
    const scaleUp = cropWidth < minWidth ? (minWidth / cropWidth) : 1;
    const scaleDown = maxWidth / cropWidth;
    const scale = Math.min(2, Math.max(1, Math.min(scaleUp, scaleDown)));
    const targetWidth = Math.floor(cropWidth * scale);
    const targetHeight = Math.floor(cropHeight * scale);

    canvas.width = targetWidth;
    canvas.height = targetHeight;
    context.drawImage(
        imageBitmap,
        cropX,
        cropY,
        cropWidth,
        cropHeight,
        0,
        0,
        targetWidth,
        targetHeight
    );

    // Enhance contrast and convert to grayscale
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    const contrast = typeof options?.contrast === 'number' ? options.contrast : 1.6; // >1 increases contrast
    const binarize = Boolean(options?.binarize);
    const threshold = typeof options?.threshold === 'number' ? options.threshold : 160;
    const rotate = Number(options?.rotate || 0);

    for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const gray = (r * 0.299 + g * 0.587 + b * 0.114);
        const boosted = Math.min(255, Math.max(0, (gray - 128) * contrast + 128));
        const value = binarize ? (boosted > threshold ? 255 : 0) : boosted;
        data[i] = value;
        data[i + 1] = value;
        data[i + 2] = value;
    }

    context.putImageData(imageData, 0, 0);

    const outputCanvas = rotate ? rotateCanvas(canvas, rotate) : canvas;
    const blob = await new Promise((resolve) => outputCanvas.toBlob(resolve, 'image/jpeg', 0.92));
    if (!blob) {
        throw new Error('Image preprocess failed');
    }
    return blob;
}

function rotateCanvas(sourceCanvas, degrees) {
    const normalized = ((degrees % 360) + 360) % 360;
    if (normalized === 0) return sourceCanvas;

    const rotated = document.createElement('canvas');
    const ctx = rotated.getContext('2d');
    if (!ctx) return sourceCanvas;

    const width = sourceCanvas.width;
    const height = sourceCanvas.height;

    if (normalized === 90 || normalized === 270) {
        rotated.width = height;
        rotated.height = width;
    } else {
        rotated.width = width;
        rotated.height = height;
    }

    ctx.translate(rotated.width / 2, rotated.height / 2);
    ctx.rotate((normalized * Math.PI) / 180);
    ctx.drawImage(sourceCanvas, -width / 2, -height / 2);
    return rotated;
}

async function detectWithBarcodeDetector(file) {
    if (typeof BarcodeDetector !== 'function') {
        return '';
    }
    const supported = ['code_128', 'code_39', 'ean_13', 'ean_8', 'upc_a'];
    const detector = new BarcodeDetector({ formats: supported });
    const bitmap = await createImageBitmap(file);
    const results = await detector.detect(bitmap);
    if (Array.isArray(results) && results.length > 0 && results[0]?.rawValue) {
        return results[0].rawValue;
    }
    return '';
}

async function handleScanPhoto(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    updateScanStatus('辨識中...');

    try {
        const decodedText = await decodeBarcodeFromFile(file);
        await onScanSuccess(decodedText, null);
    } catch (error) {
        console.error(error);
        updateScanStatus(error?.message || '辨識失敗，請再拍清楚一點');
    } finally {
        event.target.value = '';
    }
}

async function handleProductPhoto(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    updateProductStatus('辨識中...');

    try {
        const decodedText = await decodeBarcodeFromFile(file);
        const barcodeInput = document.getElementById('product-barcode');
        if (barcodeInput) {
            barcodeInput.value = decodedText;
        }
        updateProductStatus(`已辨識條碼：${decodedText}`);
    } catch (error) {
        console.error(error);
        updateProductStatus(error?.message || '辨識失敗，請再拍清楚一點');
    } finally {
        event.target.value = '';
    }
}

async function saveProductDetail() {
    const barcode = document.getElementById('product-barcode')?.value?.trim();
    const name = document.getElementById('product-name')?.value?.trim();
    const initialStockRaw = document.getElementById('product-initial-stock')?.value?.trim();
    const minStockRaw = document.getElementById('product-min-stock')?.value?.trim();

    const initialStock = parseIntegerField(initialStockRaw);
    const minStock = parseIntegerField(minStockRaw);

    const initialError = document.getElementById('product-initial-error');
    const minError = document.getElementById('product-min-error');

    if (initialError) initialError.classList.add('hidden');
    if (minError) minError.classList.add('hidden');

    if (!barcode) {
        updateProductStatus('請輸入或掃描條碼');
        return;
    }

    if (!name) {
        updateProductStatus('請輸入品項名稱');
        return;
    }

    const existing = findProductDetailByBarcode(barcode);
    if (existing) {
        updateProductStatus('商品明細已經存在');
        return;
    }

    if (initialStock === null) {
        if (initialError) initialError.classList.remove('hidden');
        updateProductStatus('庫存初始量需為整數');
        return;
    }

    if (minStock === null) {
        if (minError) minError.classList.remove('hidden');
        updateProductStatus('商品庫存下限需為整數');
        return;
    }

    if (!GAS_WEB_APP_URL) {
        updateProductStatus('尚未設定 GAS Web App URL，請先完成後端部署。');
        return;
    }

    updateProductStatus('送出中...');

    try {
        const response = await postScanRecord({
            mode: 'product',
            barcode,
            productName: name,
            initialStock,
            minStock
        });

        if (response?.status === 'success') {
            const suffix = response?.optimistic ? '（已送出，請稍後確認表單）' : '';
            updateProductStatus(`商品明細已更新${suffix}`);
            clearProductForm();
            fetchProductDetailsData();
        } else {
            updateProductStatus(response?.message || '更新失敗，請稍後再試');
        }
    } catch (error) {
        console.error(error);
        updateProductStatus(error?.message || '更新失敗，請檢查後端設定');
    }
}

function clearProductForm() {
    const barcodeInput = document.getElementById('product-barcode');
    const nameInput = document.getElementById('product-name');
    const initialStockInput = document.getElementById('product-initial-stock');
    const minStockInput = document.getElementById('product-min-stock');
    const productPhotoInput = document.getElementById('product-photo');

    if (barcodeInput) barcodeInput.value = '';
    if (nameInput) nameInput.value = '';
    if (initialStockInput) initialStockInput.value = '';
    if (minStockInput) minStockInput.value = '';
    if (productPhotoInput) productPhotoInput.value = '';
}

function parseIntegerField(value) {
    if (value === '' || value === null || typeof value === 'undefined') {
        return null;
    }
    if (!/^\d+$/.test(value)) {
        return null;
    }
    return parseInt(value, 10);
}

// Data Handling
function fetchData() {
    const container = document.getElementById('sheet-data');
    if (container) container.innerHTML = '<div class="loading">Loading data...</div>';

    // Add timestamp to bypass cache
    const urlWithTimestamp = `${SHEET_EXPORT_URL}&t=${new Date().getTime()}`;

    return new Promise((resolve) => {
        Papa.parse(urlWithTimestamp, {
            download: true,
            header: true,
            complete: function (results) {
                sheetData = results.data; // Store for lookup
                renderTable(results.data, container);
                resolve();
            },
            error: function (error) {
                console.error('Error parsing CSV:', error);
                if (container) container.innerHTML = '<div class="error-message">Failed to load data. Please try again later.</div>';
                resolve();
            }
        });
    });
}

function fetchProductDetailsData() {
    const urlWithTimestamp = `${PRODUCT_EXPORT_URL}&t=${new Date().getTime()}`;

    return new Promise((resolve) => {
        Papa.parse(urlWithTimestamp, {
            download: true,
            header: true,
            complete: function (results) {
                productDetailsData = results.data || [];
                resolve();
            },
            error: function (error) {
                console.error('Error parsing product CSV:', error);
                resolve();
            }
        });
    });
}

function findProductByBarcode(barcode) {
    if (!sheetData) return null;
    // Normalize barcode just in case
    return sheetData.find(row => (
        String(row['Barcode (條碼)'] || row['Barcode (條碼號碼)'] || row['條碼'] || '') === String(barcode)
    ));
}

function findProductDetailByBarcode(barcode) {
    if (!productDetailsData) return null;
    return productDetailsData.find(row => (
        String(row['Barcode (條碼)'] || row['Barcode (條碼號碼)'] || row['條碼'] || '') === String(barcode)
    ));
}

function findProductNameByBarcode(barcode) {
    const detail = findProductDetailByBarcode(barcode);
    if (detail) {
        return detail['名稱'] || detail['Product Name (產品名稱)'] || '';
    }

    const product = findProductByBarcode(barcode);
    if (product) {
        return product['名稱'] || product['Product Name (產品名稱)'] || '';
    }

    return '';
}

function parseNumericValue(value) {
    if (value === null || typeof value === 'undefined') return null;
    const cleaned = String(value).replace(/[^\d.-]/g, '');
    if (!cleaned) return null;
    const numberValue = Number(cleaned);
    return Number.isFinite(numberValue) ? numberValue : null;
}

function renderTable(data, container) {
    if (!container) return;

    if (!data || data.length === 0) {
        container.innerHTML = '<div class="error-message">No data found.</div>';
        return;
    }

    // Filter out empty rows
    const validData = data.filter(row => Object.values(row).some(val => val));

    if (validData.length === 0) {
        container.innerHTML = '<div class="error-message">No valid data found.</div>';
        return;
    }

    const headers = Object.keys(validData[0]);
    const stockHeader = headers.find(header => header === '即時總數量');
    const minHeader = headers.find(header => header === '商品庫存下限');
    const barcodeHeader = headers.find(header => /barcode|條碼/i.test(header));

    let tableHTML = '<table class="data-table"><thead><tr>';

    // Create Headers
    headers.forEach(header => {
        const headerClass = barcodeHeader && header === barcodeHeader ? ' class="barcode-col"' : ' class="center-col"';
        tableHTML += `<th${headerClass}>${header}</th>`;
    });
    tableHTML += '</tr></thead><tbody>';

    // Create Rows
    validData.forEach(row => {
        const stockValue = stockHeader ? parseNumericValue(row[stockHeader]) : null;
        const minValue = minHeader ? parseNumericValue(row[minHeader]) : null;
        const isLowStock = stockValue !== null && minValue !== null && stockValue < minValue;

        tableHTML += isLowStock ? '<tr class="low-stock-row">' : '<tr>';
        headers.forEach(header => {
            const cellValue = row[header] || '';
            const isBarcode = barcodeHeader && header === barcodeHeader;
            const classes = [];
            if (isLowStock && header === stockHeader) {
                classes.push('low-stock-cell');
            }
            classes.push(isBarcode ? 'barcode-col' : 'center-col');
            const cellClass = classes.length ? ` class="${classes.join(' ')}"` : '';
            tableHTML += `<td${cellClass}>${cellValue}</td>`;
        });
        tableHTML += '</tr>';
    });

    tableHTML += '</tbody></table>';
    container.innerHTML = tableHTML;
}
