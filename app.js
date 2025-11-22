// 全局变量
let ggwave = null;
let ggwaveInstance = null;
let audioContext = null;
let selectedFile = null;
let receivedData = null;
let isReceiving = false;
let mediaStream = null;

// 波形图相关变量
let analyser = null;
let waveformAnimationId = null;
let waveformCanvas = null;
let waveformCtx = null;

// 文件传输配置
const MAX_FILE_SIZE = 100 * 1024; // 100KB
const CHUNK_SIZE = 64; // 每个数据包的字节数
const HEADER_DELIMITER = '|||';
const CHUNK_DELIMITER = ':::';

// 初始化
async function init() {
    try {
        // 等待 GGWave 模块加载
        if (typeof ggwave_factory === 'undefined') {
            throw new Error('GGWave library not loaded');
        }

        // 加载 ggwave 模块
        ggwave = await ggwave_factory();

        // 创建 AudioContext，推荐使用 48000 采样率
        audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 });

        // 初始化 ggwave 实例
        const parameters = ggwave.getDefaultParameters();
        parameters.sampleRateInp = audioContext.sampleRate;
        parameters.sampleRateOut = audioContext.sampleRate;
        ggwaveInstance = ggwave.init(parameters);

        console.log('GGWave initialized successfully');
        console.log('Sample rate:', audioContext.sampleRate);
    } catch (error) {
        console.error('Failed to initialize:', error);
        alert('初始化失败: ' + error.message + '\n请刷新页面重试');
    }
}

// 标签页切换
document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
        const targetTab = tab.dataset.tab;

        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));

        tab.classList.add('active');
        document.getElementById(`${targetTab}-panel`).classList.add('active');

        // 切换到发送面板时停止接收
        if (targetTab === 'send' && isReceiving) {
            stopReceiving();
        }
    });
});

// 文件选择处理
document.getElementById('file-input').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (file.size > MAX_FILE_SIZE) {
        alert(`文件大小超过限制 (最大 ${MAX_FILE_SIZE / 1024}KB)`);
        e.target.value = '';
        return;
    }

    selectedFile = file;

    // 显示文件信息
    document.getElementById('file-name').textContent = file.name;
    document.getElementById('file-size').textContent = formatFileSize(file.size);
    document.getElementById('file-type').textContent = file.type || '未知';
    document.getElementById('file-info').classList.remove('hidden');
    document.getElementById('send-btn').classList.remove('hidden');
});

// 发送文件
document.getElementById('send-btn').addEventListener('click', async () => {
    if (!selectedFile) return;

    document.getElementById('send-btn').disabled = true;
    document.getElementById('send-progress').classList.remove('hidden');

    try {
        await sendFile(selectedFile);
    } catch (error) {
        console.error('Send error:', error);
        alert('发送失败: ' + error.message);
    } finally {
        document.getElementById('send-btn').disabled = false;
    }
});

// 发送文件主函数
async function sendFile(file) {
    const reader = new FileReader();

    reader.onload = async (e) => {
        const arrayBuffer = e.target.result;
        const uint8Array = new Uint8Array(arrayBuffer);

        // 创建文件头信息
        const header = {
            name: file.name,
            size: file.size,
            type: file.type,
            chunks: Math.ceil(uint8Array.length / CHUNK_SIZE)
        };

        const headerStr = JSON.stringify(header);
        updateSendProgress('发送文件信息...', 0);

        // 发送文件头
        await sendChunk(headerStr, true);
        await sleep(2000);

        // 分块发送文件数据
        const totalChunks = header.chunks;
        for (let i = 0; i < totalChunks; i++) {
            const start = i * CHUNK_SIZE;
            const end = Math.min(start + CHUNK_SIZE, uint8Array.length);
            const chunk = uint8Array.slice(start, end);

            // 转换为 base64
            const base64Chunk = btoa(String.fromCharCode.apply(null, chunk));
            const chunkData = `${i}${CHUNK_DELIMITER}${base64Chunk}`;

            await sendChunk(chunkData, false);

            const progress = ((i + 1) / totalChunks) * 100;
            updateSendProgress(`发送中 (${i + 1}/${totalChunks})`, progress);

            // 块之间延迟，确保传输可靠
            await sleep(1500);
        }

        updateSendProgress('发送完成!', 100);
        setTimeout(() => {
            document.getElementById('send-progress').classList.add('hidden');
            resetSendForm();
        }, 2000);
    };

    reader.readAsArrayBuffer(file);
}

// 发送单个数据块
async function sendChunk(data, isHeader) {
    const prefix = isHeader ? 'HEADER' : 'CHUNK';
    const message = `${prefix}${HEADER_DELIMITER}${data}`;

    // 使用 ggwave 编码文本为音频
    // 参数: instance, text, protocolId, volume
    const waveform = ggwave.encode(
        ggwaveInstance,
        message,
        ggwave.ProtocolId.GGWAVE_PROTOCOL_AUDIBLE_FAST,
        10
    );

    // 转换为 Float32Array
    const floatWaveform = convertTypedArray(waveform, Float32Array);

    // 播放音频
    await playAudio(floatWaveform);
}

// 类型数组转换辅助函数
function convertTypedArray(src, type) {
    const buffer = new ArrayBuffer(src.byteLength);
    new src.constructor(buffer).set(src);
    return new type(buffer);
}

// 播放音频
function playAudio(waveform) {
    return new Promise((resolve) => {
        const buffer = audioContext.createBuffer(1, waveform.length, audioContext.sampleRate);
        const channelData = buffer.getChannelData(0);
        channelData.set(waveform);

        const source = audioContext.createBufferSource();
        source.buffer = buffer;
        source.connect(audioContext.destination);

        source.onended = () => resolve();
        source.start();
    });
}

// 开始接收
document.getElementById('receive-btn').addEventListener('click', async () => {
    await startReceiving();
});

// 停止接收
document.getElementById('stop-receive-btn').addEventListener('click', () => {
    stopReceiving();
});

// 开始接收函数
async function startReceiving() {
    try {
        // 请求麦克风权限，禁用回声消除等
        mediaStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: false,
                autoGainControl: false,
                noiseSuppression: false
            }
        });

        isReceiving = true;
        receivedData = {
            header: null,
            chunks: []
        };

        document.getElementById('receive-btn').classList.add('hidden');
        document.getElementById('stop-receive-btn').classList.remove('hidden');
        document.getElementById('receive-status').querySelector('.status-text').textContent = '正在监听...';
        document.getElementById('received-file').classList.add('hidden');

        // 创建音频处理节点
        const source = audioContext.createMediaStreamSource(mediaStream);
        const processor = audioContext.createScriptProcessor(4096, 1, 1);

        processor.onaudioprocess = (e) => {
            if (!isReceiving) return;

            const inputData = e.inputBuffer.getChannelData(0);

            // 转换为 Int8Array 进行解码
            const int8Data = convertTypedArray(new Float32Array(inputData), Int8Array);
            const res = ggwave.decode(ggwaveInstance, int8Data);

            if (res && res.length > 0) {
                // 解码结果转为字符串
                const decoded = new TextDecoder("utf-8").decode(res);
                handleReceivedData(decoded);
            }
        };

        // 启动波形图（在连接音频链路之前）
        startWaveform();

        // 连接音频链路: source -> analyser -> processor -> destination
        source.connect(analyser);
        analyser.connect(processor);
        processor.connect(audioContext.destination);

        // 保存引用以便清理
        window.audioProcessor = processor;
        window.audioSource = source;

    } catch (error) {
        console.error('Failed to start receiving:', error);
        alert('无法访问麦克风: ' + error.message);
        stopReceiving();
    }
}

// 停止接收函数
function stopReceiving() {
    isReceiving = false;

    // 停止波形图
    stopWaveform();

    if (mediaStream) {
        mediaStream.getTracks().forEach(track => track.stop());
        mediaStream = null;
    }

    if (window.audioProcessor) {
        window.audioProcessor.disconnect();
        window.audioProcessor = null;
    }

    if (window.audioSource) {
        window.audioSource.disconnect();
        window.audioSource = null;
    }

    document.getElementById('receive-btn').classList.remove('hidden');
    document.getElementById('stop-receive-btn').classList.add('hidden');
    document.getElementById('receive-status').querySelector('.status-text').textContent = '已停止监听';
    document.getElementById('receive-progress').classList.add('hidden');
}

// 处理接收到的数据
function handleReceivedData(message) {
    try {
        // message 已经是解码后的字符串
        if (!message) return;

        if (message.startsWith('HEADER' + HEADER_DELIMITER)) {
            // 接收文件头
            const headerJson = message.substring(('HEADER' + HEADER_DELIMITER).length);
            receivedData.header = JSON.parse(headerJson);
            receivedData.chunks = new Array(receivedData.header.chunks).fill(null);

            document.getElementById('receive-progress').classList.remove('hidden');
            updateReceiveProgress(`接收文件: ${receivedData.header.name}`, 0);

            console.log('Received header:', receivedData.header);

        } else if (message.startsWith('CHUNK' + HEADER_DELIMITER)) {
            // 接收文件块
            if (!receivedData.header) return;

            const chunkData = message.substring(('CHUNK' + HEADER_DELIMITER).length);
            const [indexStr, base64Data] = chunkData.split(CHUNK_DELIMITER);
            const index = parseInt(indexStr);

            receivedData.chunks[index] = base64Data;

            // 计算进度
            const receivedCount = receivedData.chunks.filter(c => c !== null).length;
            const progress = (receivedCount / receivedData.header.chunks) * 100;
            updateReceiveProgress(`接收中 (${receivedCount}/${receivedData.header.chunks})`, progress);

            console.log(`Received chunk ${index}, progress: ${progress.toFixed(1)}%`);

            // 检查是否接收完成
            if (receivedCount === receivedData.header.chunks) {
                completeReceive();
            }
        }
    } catch (error) {
        console.error('Error handling received data:', error);
    }
}

// 完成接收
function completeReceive() {
    try {
        // 合并所有块
        const base64Complete = receivedData.chunks.join('');
        const binaryString = atob(base64Complete);
        const bytes = new Uint8Array(binaryString.length);

        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }

        // 创建 Blob
        const blob = new Blob([bytes], { type: receivedData.header.type });
        const url = URL.createObjectURL(blob);

        // 显示接收完成界面
        stopReceiving();
        document.getElementById('receive-progress').classList.add('hidden');
        document.getElementById('received-file').classList.remove('hidden');
        document.getElementById('received-name').textContent = receivedData.header.name;
        document.getElementById('received-size').textContent = formatFileSize(receivedData.header.size);

        // 设置下载按钮
        const downloadBtn = document.getElementById('download-btn');
        downloadBtn.onclick = () => {
            const a = document.createElement('a');
            a.href = url;
            a.download = receivedData.header.name;
            a.click();
        };

        console.log('File received successfully!');

    } catch (error) {
        console.error('Error completing receive:', error);
        alert('文件接收失败: ' + error.message);
    }
}

// 更新发送进度
function updateSendProgress(status, percent) {
    document.getElementById('send-status').textContent = status;
    document.getElementById('send-percent').textContent = `${Math.round(percent)}%`;
    document.getElementById('send-progress-fill').style.width = `${percent}%`;
}

// 更新接收进度
function updateReceiveProgress(status, percent) {
    document.getElementById('receive-status-text').textContent = status;
    document.getElementById('receive-percent').textContent = `${Math.round(percent)}%`;
    document.getElementById('receive-progress-fill').style.width = `${percent}%`;
}

// 重置发送表单
function resetSendForm() {
    selectedFile = null;
    document.getElementById('file-input').value = '';
    document.getElementById('file-info').classList.add('hidden');
    document.getElementById('send-btn').classList.add('hidden');
}

// 格式化文件大小
function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

// 延迟函数
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// 初始化波形图 Canvas
function initWaveformCanvas() {
    waveformCanvas = document.getElementById('waveform-canvas');
    waveformCtx = waveformCanvas.getContext('2d');

    // 设置 Canvas 实际尺寸（高分辨率）
    const container = document.getElementById('waveform-container');
    const dpr = window.devicePixelRatio || 1;

    // 使用固定宽度或容器宽度
    const width = container.clientWidth - 30 || 400; // 减去 padding
    const height = 120;

    waveformCanvas.width = width * dpr;
    waveformCanvas.height = height * dpr;

    // 设置 CSS 尺寸
    waveformCanvas.style.width = width + 'px';
    waveformCanvas.style.height = height + 'px';

    console.log('Canvas initialized:', width, 'x', height, 'dpr:', dpr);
}

// 绘制波形图
function drawWaveform() {
    if (!analyser || !waveformCtx || !isReceiving) return;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteTimeDomainData(dataArray);

    const dpr = window.devicePixelRatio || 1;
    const width = waveformCanvas.width / dpr;
    const height = waveformCanvas.height / dpr;

    // 重置变换并清除画布
    waveformCtx.setTransform(1, 0, 0, 1, 0, 0);
    waveformCtx.scale(dpr, dpr);

    // 清除画布
    waveformCtx.fillStyle = '#1a1a2e';
    waveformCtx.fillRect(0, 0, width, height);

    // 重置阴影
    waveformCtx.shadowBlur = 0;
    waveformCtx.shadowColor = 'transparent';

    // 绘制中心线
    waveformCtx.strokeStyle = 'rgba(102, 126, 234, 0.3)';
    waveformCtx.lineWidth = 1;
    waveformCtx.beginPath();
    waveformCtx.moveTo(0, height / 2);
    waveformCtx.lineTo(width, height / 2);
    waveformCtx.stroke();

    // 设置波形样式
    waveformCtx.lineWidth = 2;
    waveformCtx.strokeStyle = '#667eea';
    waveformCtx.shadowBlur = 8;
    waveformCtx.shadowColor = '#667eea';

    // 绘制波形
    waveformCtx.beginPath();

    const sliceWidth = width / bufferLength;
    let x = 0;

    for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 128.0;
        const y = (v * height) / 2;

        if (i === 0) {
            waveformCtx.moveTo(x, y);
        } else {
            waveformCtx.lineTo(x, y);
        }

        x += sliceWidth;
    }

    waveformCtx.stroke();

    // 继续动画
    waveformAnimationId = requestAnimationFrame(drawWaveform);
}

// 启动波形图
function startWaveform() {
    // 创建分析器节点
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.8;

    // 注意: 音频链路连接在 startReceiving 函数中完成
    // source -> analyser -> processor -> destination

    // 显示波形图容器
    document.getElementById('waveform-container').classList.remove('hidden');

    // 延迟一帧确保 DOM 更新完成后再初始化 Canvas
    requestAnimationFrame(() => {
        // 初始化 Canvas
        initWaveformCanvas();
        // 开始绘制
        drawWaveform();
    });
}

// 停止波形图
function stopWaveform() {
    if (waveformAnimationId) {
        cancelAnimationFrame(waveformAnimationId);
        waveformAnimationId = null;
    }

    if (analyser) {
        analyser.disconnect();
        analyser = null;
    }

    // 隐藏波形图容器
    document.getElementById('waveform-container').classList.add('hidden');
}

// 页面加载完成后初始化
window.addEventListener('load', init);
