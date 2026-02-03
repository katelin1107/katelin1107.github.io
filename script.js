const SHEET_ID = '1sQB5IIknjniETE7VAHmWHpY4XSJR0HKY80zhpqk4PY8';
const SHEET_GID = '226388722'; // 即時庫存查詢表的工作表 ID
const SHEET_EXPORT_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${SHEET_GID}`;
const GAS_WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbxCP05mnRebBqfrCKCZk31TxSJ1_fcsV4kW-fLS7LNfPiUq2Q9ybMzfbHEL67ETAqp-/exec'; // 請填入 Google Apps Script Web App URL
const API_TOKEN = 'yun-202602'; // 與 GAS Script Properties 的 API_TOKEN 一致

let sheetData = []; // Store data globally for lookup
let html5QrcodeScanner = null;
let productQrcodeScanner = null;
let fileQrcodeReader = null;

document.addEventListener('DOMContentLoaded', () => {
    // Initial fetch
    fetchData();

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

    const scanContext = getScanContext();
    if (!scanContext) {
        return;
    }

    // Stop scanning to prevent multiple triggers
    stopScanner();

    // Lookup product
    const product = findProductByBarcode(decodedText);
    const productName = product ? (product['名稱'] || product['Product Name (產品名稱)'] || '') : '';

    updateScanStatus(product ? `已找到商品：${productName || decodedText}` : `條碼 ${decodedText} 未找到對應商品`);

    if (!GAS_WEB_APP_URL) {
        updateScanStatus('尚未設定 GAS Web App URL，請先完成後端部署。');
        restartScannerLater();
        return;
    }

    try {
        const response = await postScanRecord({
            barcode: decodedText,
            productName,
            quantity: scanContext.quantity,
            type: scanContext.type,
            staff: scanContext.staff,
            partnerInfo: scanContext.partnerInfo
        });

        if (response?.status === 'success') {
            const actionLabel = scanContext.type === 'in' ? '進貨' : '出貨';
            const suffix = response?.optimistic ? '（已送出，請稍後確認表單）' : '';
            updateScanStatus(`已完成${actionLabel}紀錄，數量：${scanContext.quantity}${suffix}`);
            fetchData();
        } else {
            updateScanStatus(response?.message || '寫入失敗，請稍後再試');
        }
    } catch (error) {
        console.error(error);
        updateScanStatus(error?.message || '寫入失敗，請檢查後端設定');
    } finally {
        restartScannerLater();
    }
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

    const productSaveBtn = document.getElementById('product-save-btn');
    if (productSaveBtn) {
        productSaveBtn.addEventListener('click', saveProductDetail);
    }

    const productTestBtn = document.getElementById('product-test-btn');
    if (productTestBtn) {
        productTestBtn.addEventListener('click', runProductWriteTest);
    }

    const productPhotoInput = document.getElementById('product-photo');
    if (productPhotoInput) {
        productPhotoInput.addEventListener('change', handleProductPhoto);
    }
}

function setStockAction(action) {
    const hiddenInput = document.getElementById('stock-action');
    const partnerLabel = document.getElementById('partner-label');
    const actionButtons = document.querySelectorAll('.segmented-btn');

    actionButtons.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.action === action);
    });

    if (hiddenInput) hiddenInput.value = action;
    if (partnerLabel) {
        partnerLabel.textContent = action === 'in' ? '進貨廠商' : '客戶資訊';
    }
}

function getScanContext() {
    const staffInput = document.getElementById('staff-name');
    const actionInput = document.getElementById('stock-action');
    const quantityInput = document.getElementById('scan-quantity');
    const partnerInput = document.getElementById('partner-info');

    const staff = staffInput?.value?.trim();
    if (!staff) {
        updateScanStatus('請先輸入點貨人員姓名');
        return null;
    }

    const quantity = Math.max(1, parseInt(quantityInput?.value, 10) || 1);

    return {
        staff,
        type: actionInput?.value === 'out' ? 'out' : 'in',
        quantity,
        partnerInfo: partnerInput?.value?.trim() || ''
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

function getFileQrcodeReader() {
    if (!fileQrcodeReader) {
        fileQrcodeReader = new Html5Qrcode("file-reader");
    }
    return fileQrcodeReader;
}

async function decodeBarcodeFromFile(file) {
    const reader = getFileQrcodeReader();
    const formats = [
        Html5QrcodeSupportedFormats.CODE_128
    ];

    try {
        const processed = await preprocessBarcodeImage(file);
        return await reader.scanFile(processed, true, formats);
    } catch (error) {
        // Fallback to original image if preprocessing fails
        return reader.scanFile(file, true, formats);
    }
}

async function preprocessBarcodeImage(file) {
    const imageBitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', { willReadFrequently: true });

    // Crop a horizontal band from the center to focus on barcode area
    const cropWidth = Math.floor(imageBitmap.width * 0.9);
    const cropHeight = Math.floor(imageBitmap.height * 0.35);
    const cropX = Math.floor((imageBitmap.width - cropWidth) / 2);
    const cropY = Math.floor((imageBitmap.height - cropHeight) / 2);

    canvas.width = cropWidth;
    canvas.height = cropHeight;
    context.drawImage(
        imageBitmap,
        cropX,
        cropY,
        cropWidth,
        cropHeight,
        0,
        0,
        cropWidth,
        cropHeight
    );

    // Enhance contrast and convert to grayscale
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    const contrast = 1.4; // >1 increases contrast

    for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const gray = (r * 0.299 + g * 0.587 + b * 0.114);
        const boosted = Math.min(255, Math.max(0, (gray - 128) * contrast + 128));
        data[i] = boosted;
        data[i + 1] = boosted;
        data[i + 2] = boosted;
    }

    context.putImageData(imageData, 0, 0);

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    if (!blob) {
        throw new Error('Image preprocess failed');
    }
    return blob;
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
        updateScanStatus('辨識失敗，請再拍清楚一點');
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
        updateProductStatus('辨識失敗，請再拍清楚一點');
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

    if (initialStock === null) {
        if (initialError) initialError.classList.remove('hidden');
        updateProductStatus('庫存初始量需為整數');
        return;
    }

    if (minStock === null) {
        if (minError) minError.classList.remove('hidden');
        updateProductStatus('庫存下限需為整數');
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

async function runProductWriteTest() {
    if (!GAS_WEB_APP_URL) {
        updateProductStatus('尚未設定 GAS Web App URL，請先完成後端部署。');
        return;
    }

    const timestamp = new Date();
    const barcode = `TEST-${timestamp.getTime()}`;
    const name = `測試品項-${timestamp.toLocaleString()}`;

    updateProductStatus('測試寫入中...');

    try {
        const response = await postScanRecord({
            mode: 'product',
            barcode,
            productName: name,
            minStock: 0
        });

        const suffix = response?.optimistic ? '（已送出，請稍後確認表單）' : '';
        updateProductStatus(`測試寫入完成${suffix}`);
    } catch (error) {
        console.error(error);
        updateProductStatus(error?.message || '測試寫入失敗，請檢查後端設定');
    }
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

function findProductByBarcode(barcode) {
    if (!sheetData) return null;
    // Normalize barcode just in case
    return sheetData.find(row => (
        String(row['Barcode (條碼)'] || row['Barcode (條碼號碼)'] || row['條碼'] || '') === String(barcode)
    ));
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

    let tableHTML = '<table><thead><tr>';

    // Create Headers
    headers.forEach(header => {
        tableHTML += `<th>${header}</th>`;
    });
    tableHTML += '</tr></thead><tbody>';

    // Create Rows
    validData.forEach(row => {
        tableHTML += '<tr>';
        headers.forEach(header => {
            tableHTML += `<td>${row[header] || ''}</td>`;
        });
        tableHTML += '</tr>';
    });

    tableHTML += '</tbody></table>';
    container.innerHTML = tableHTML;
}
