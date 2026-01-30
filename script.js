const SHEET_ID = '1sQB5IIknjniETE7VAHmWHpY4XSJR0HKY80zhpqk4PY8';
const SHEET_GID = '226388722'; // 即時庫存查詢表的工作表 ID
const SHEET_EXPORT_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${SHEET_GID}`;
const GAS_WEB_APP_URL = ''; // 請填入 Google Apps Script Web App URL

let sheetData = []; // Store data globally for lookup
let html5QrcodeScanner = null;
let productQrcodeScanner = null;

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
        startScanner();
    } else {
        stopScanner();
    }

    if (sectionId === 'product-update-section') {
        resetProductScannerUI();
    } else {
        stopProductScanner();
    }
}

// Scanner Logic
function startScanner() {
    if (html5QrcodeScanner) {
        // Already running or initialized
        return;
    }

    const supportedFormats = [
        Html5QrcodeSupportedFormats.CODE_39,
        Html5QrcodeSupportedFormats.CODE_128,
        Html5QrcodeSupportedFormats.EAN_13,
        Html5QrcodeSupportedFormats.EAN_8,
        Html5QrcodeSupportedFormats.UPC_A,
        Html5QrcodeSupportedFormats.UPC_E,
        Html5QrcodeSupportedFormats.ITF
    ];

    // Initialize scanner
    // fps: frames per second, qrbox: scanning region size
    html5QrcodeScanner = new Html5QrcodeScanner(
        "reader",
        {
            fps: 10,
            qrbox: { width: 320, height: 200 },
            formatsToSupport: supportedFormats
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
        Html5QrcodeSupportedFormats.CODE_39,
        Html5QrcodeSupportedFormats.CODE_128,
        Html5QrcodeSupportedFormats.EAN_13,
        Html5QrcodeSupportedFormats.EAN_8,
        Html5QrcodeSupportedFormats.UPC_A,
        Html5QrcodeSupportedFormats.UPC_E,
        Html5QrcodeSupportedFormats.ITF
    ];

    productQrcodeScanner = new Html5QrcodeScanner(
        "product-reader",
        {
            fps: 10,
            qrbox: { width: 320, height: 200 },
            formatsToSupport: supportedFormats
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
            updateScanStatus(`已完成${scanContext.type === 'in' ? '進貨' : '出貨'}紀錄，數量：${scanContext.quantity}`);
            fetchData();
        } else {
            updateScanStatus(response?.message || '寫入失敗，請稍後再試');
        }
    } catch (error) {
        console.error(error);
        updateScanStatus('寫入失敗，請檢查後端設定');
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

    const productScanBtn = document.getElementById('product-scan-btn');
    if (productScanBtn) {
        productScanBtn.addEventListener('click', () => {
            if (productQrcodeScanner) {
                stopProductScanner();
                updateProductStatus('已停止掃描');
                setProductScanButtonText('start');
            } else {
                startProductScanner();
                setProductScanButtonText('stop');
            }
        });
    }

    const productSaveBtn = document.getElementById('product-save-btn');
    if (productSaveBtn) {
        productSaveBtn.addEventListener('click', saveProductDetail);
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

function setProductScanButtonText(state) {
    const productScanBtn = document.getElementById('product-scan-btn');
    if (!productScanBtn) return;
    productScanBtn.textContent = state === 'stop' ? '停止掃描' : '開始掃條碼';
}

function resetProductScannerUI() {
    setProductScanButtonText('start');
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
    const response = await fetch(GAS_WEB_APP_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            ...payload,
            scannedAt: new Date().toISOString()
        })
    });

    return response.json();
}

async function saveProductDetail() {
    const barcode = document.getElementById('product-barcode')?.value?.trim();
    const name = document.getElementById('product-name')?.value?.trim();
    const minStockRaw = document.getElementById('product-min-stock')?.value?.trim();
    const minStock = minStockRaw === '' ? null : Math.max(0, parseInt(minStockRaw, 10) || 0);

    if (!barcode) {
        updateProductStatus('請輸入或掃描條碼');
        return;
    }

    if (!name) {
        updateProductStatus('請輸入品項名稱');
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
            minStock
        });

        if (response?.status === 'success') {
            updateProductStatus('商品明細已更新');
        } else {
            updateProductStatus(response?.message || '更新失敗，請稍後再試');
        }
    } catch (error) {
        console.error(error);
        updateProductStatus('更新失敗，請檢查後端設定');
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
