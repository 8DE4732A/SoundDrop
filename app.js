(function() {
    'use strict';

    // 常量定义
    const MAX_FILE_SIZE = 100 * 1024; // 100KB
    const CHUNK_SIZE = 4096; // 每个数据块 4KB
    const PACKET_TYPE = {
        METADATA: 0,
        DATA: 1,
        END: 2
    };

    // 初始化 Quiet.js
    Quiet.init({
        profilesPrefix: "/",
        memoryInitializerPrefix: "/",
        libfecPrefix: "/"
    });

    // 全局变量
    let transmitter = null;
    let receiver = null;
    let selectedFile = null;
    let receivedChunks = [];
    let fileMetadata = null;
    let totalChunks = 0;
    let receivedChunkCount = 0;

    // DOM 元素
    const elements = {
        tabs: document.querySelectorAll('.tab-btn'),
        tabContents: document.querySelectorAll('.tab-content'),
        fileInput: document.getElementById('fileInput'),
        fileInfo: document.getElementById('fileInfo'),
        fileName: document.getElementById('fileName'),
        fileSize: document.getElementById('fileSize'),
        fileType: document.getElementById('fileType'),
        sendBtn: document.getElementById('sendBtn'),
        sendProgress: document.getElementById('sendProgress'),
        sendProgressBar: document.getElementById('sendProgressBar'),
        sendProgressText: document.getElementById('sendProgressText'),
        receiverStatus: document.getElementById('receiverStatus'),
        receiveProgress: document.getElementById('receiveProgress'),
        receiveProgressBar: document.getElementById('receiveProgressBar'),
        receiveProgressText: document.getElementById('receiveProgressText'),
        receivedFile: document.getElementById('receivedFile'),
        receivedFileName: document.getElementById('receivedFileName'),
        receivedFileSize: document.getElementById('receivedFileSize'),
        downloadBtn: document.getElementById('downloadBtn'),
        warning: document.getElementById('warning'),
        debugInfo: document.getElementById('debugInfo')
    };

    // 工具函数
    function formatFileSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    }

    function showWarning(message) {
        elements.warning.textContent = message;
        elements.warning.classList.remove('hidden');
        setTimeout(() => {
            elements.warning.classList.add('hidden');
        }, 5000);
    }

    function showElement(element) {
        element.classList.remove('hidden');
    }

    function hideElement(element) {
        element.classList.add('hidden');
    }

    // 标签页切换
    elements.tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const tabName = tab.getAttribute('data-tab');

            // 更新标签按钮状态
            elements.tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            // 更新内容显示
            elements.tabContents.forEach(content => {
                if (content.id === tabName) {
                    content.classList.add('active');
                } else {
                    content.classList.remove('active');
                }
            });

            // 切换到接收模式时启动接收器
            if (tabName === 'receive' && !receiver) {
                initReceiver();
            }
        });
    });

    // 文件选择处理
    elements.fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        // 验证文件大小
        if (file.size > MAX_FILE_SIZE) {
            showWarning(`文件大小超过限制！最大允许 ${formatFileSize(MAX_FILE_SIZE)}`);
            e.target.value = '';
            return;
        }

        selectedFile = file;

        // 显示文件信息
        elements.fileName.textContent = file.name;
        elements.fileSize.textContent = formatFileSize(file.size);
        elements.fileType.textContent = file.type || '未知';

        showElement(elements.fileInfo);
        showElement(elements.sendBtn);
    });

    // 发送文件
    elements.sendBtn.addEventListener('click', async () => {
        if (!selectedFile) return;

        elements.sendBtn.disabled = true;
        showElement(elements.sendProgress);

        try {
            const arrayBuffer = await selectedFile.arrayBuffer();
            await sendFile(selectedFile.name, selectedFile.type, arrayBuffer);
        } catch (error) {
            console.error('发送失败:', error);
            showWarning('发送失败，请重试');
            elements.sendBtn.disabled = false;
            hideElement(elements.sendProgress);
        }
    });

    // 下载接收到的文件
    elements.downloadBtn.addEventListener('click', () => {
        if (!fileMetadata || receivedChunks.length === 0) return;

        // 重组文件数据
        const blob = new Blob(receivedChunks, { type: fileMetadata.type });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = fileMetadata.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    });

    // 发送文件函数
    async function sendFile(fileName, fileType, arrayBuffer) {
        if (!transmitter) {
            await initTransmitter();
        }

        const chunks = [];
        let offset = 0;

        // 分块
        while (offset < arrayBuffer.byteLength) {
            const chunk = arrayBuffer.slice(offset, offset + CHUNK_SIZE);
            chunks.push(chunk);
            offset += CHUNK_SIZE;
        }

        totalChunks = chunks.length;

        // 发送元数据
        const metadata = {
            type: PACKET_TYPE.METADATA,
            name: fileName,
            fileType: fileType,
            size: arrayBuffer.byteLength,
            chunks: totalChunks
        };

        console.log('发送元数据:', metadata);
        elements.sendProgressText.textContent = '正在发送文件信息...';
        await sendPacket(metadata);
        console.log('元数据已发送');
        await sleep(2000); // 给接收方足够时间处理元数据

        // 发送数据块
        for (let i = 0; i < chunks.length; i++) {
            const packet = {
                type: PACKET_TYPE.DATA,
                index: i,
                data: chunks[i]
            };

            const progress = ((i + 1) / totalChunks * 100).toFixed(0);
            elements.sendProgressBar.style.width = progress + '%';
            elements.sendProgressText.textContent = `发送中... ${i + 1}/${totalChunks} (${progress}%)`;

            await sendPacket(packet);
            await sleep(200); // 给接收方足够时间处理每个数据块
        }

        // 发送结束标记
        const endPacket = { type: PACKET_TYPE.END };
        await sendPacket(endPacket);

        elements.sendProgressText.textContent = '发送完成！';
        setTimeout(() => {
            elements.sendBtn.disabled = false;
            hideElement(elements.sendProgress);
            elements.sendProgressBar.style.width = '0%';
        }, 2000);
    }

    function sendPacket(packet) {
        return new Promise((resolve, reject) => {
            try {
                const json = JSON.stringify(packet);

                // 如果有数据块，需要特殊处理
                if (packet.type === PACKET_TYPE.DATA) {
                    const header = JSON.stringify({
                        type: packet.type,
                        index: packet.index
                    });

                    // 创建一个包含 header 和 data 的 ArrayBuffer
                    const headerBytes = new TextEncoder().encode(header + '|');
                    const combined = new Uint8Array(headerBytes.length + packet.data.byteLength);
                    combined.set(headerBytes, 0);
                    combined.set(new Uint8Array(packet.data), headerBytes.length);

                    console.log(`发送数据块 ${packet.index}, 大小: ${combined.buffer.byteLength} 字节`);
                    transmitter.transmit(combined.buffer, resolve);
                } else {
                    console.log('发送数据包类型:', packet.type === PACKET_TYPE.METADATA ? 'METADATA' : 'END');
                    transmitter.transmit(Quiet.str2ab(json), resolve);
                }
            } catch (error) {
                console.error('发送数据包失败:', error);
                reject(error);
            }
        });
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // 初始化发送器
    function initTransmitter() {
        return new Promise((resolve, reject) => {
            console.log('初始化发送器...');
            const profileName = document.querySelector('[data-quiet-profile-name]').getAttribute('data-quiet-profile-name');
            console.log('使用配置:', profileName);

            transmitter = Quiet.transmitter({
                profile: profileName,
                onFinish: () => {
                    console.log('发送器传输完成回调');
                }
            });

            console.log('发送器已创建');
            setTimeout(resolve, 500);
        });
    }

    // 初始化接收器
    function initReceiver() {
        if (receiver) {
            console.log('接收器已存在，跳过初始化');
            updateDebugInfo('接收器已运行');
            return;
        }

        console.log('=== 开始初始化接收器 ===');
        updateDebugInfo('正在初始化接收器...');

        const profileName = document.querySelector('[data-quiet-profile-name]').getAttribute('data-quiet-profile-name');
        console.log('使用配置:', profileName);

        // 检查 Quiet 是否已就绪
        if (typeof Quiet === 'undefined') {
            console.error('Quiet.js 未加载！');
            showWarning('音频库未加载，请刷新页面');
            updateDebugInfo('错误：Quiet.js 未加载');
            return;
        }

        try {
            receiver = Quiet.receiver({
                profile: profileName,
                onReceive: onReceivePacket,
                onCreateFail: (reason) => {
                    console.error('!!! 接收器创建失败 !!!');
                    console.error('失败原因:', reason);
                    showWarning('无法访问麦克风，请检查权限设置');
                    elements.receiverStatus.textContent = '麦克风访问失败';
                    updateDebugInfo('错误：' + reason);
                },
                onReceiveFail: (numFails) => {
                    console.warn('接收失败次数:', numFails);
                    updateDebugInfo('接收失败 ' + numFails + ' 次');
                }
            });

            console.log('✓ 接收器对象已创建:', receiver);
            console.log('✓ 等待接收数据...');
            elements.receiverStatus.textContent = '等待接收文件...（麦克风已就绪）';
            updateDebugInfo('接收器就绪，等待数据...');

            // 定期检查接收器状态
            let statusCheckCount = 0;
            setInterval(() => {
                if (receiver) {
                    statusCheckCount++;
                    console.log('[接收器状态] 运行中，等待数据... (检查次数:' + statusCheckCount + ')');
                    updateDebugInfo('运行中 - 检查 ' + statusCheckCount + ' 次');
                }
            }, 10000); // 每10秒输出一次状态
        } catch (error) {
            console.error('创建接收器时出错:', error);
            showWarning('接收器初始化失败: ' + error.message);
            updateDebugInfo('错误：' + error.message);
        }
    }

    // 更新调试信息
    function updateDebugInfo(message) {
        if (elements.debugInfo) {
            const timestamp = new Date().toLocaleTimeString();
            elements.debugInfo.textContent = `[${timestamp}] ${message}`;
        }
    }

    // 接收数据包
    function onReceivePacket(payload) {
        console.log('========================================');
        console.log('!!! 收到数据包 !!!');
        console.log('数据包大小:', payload.byteLength, '字节');
        console.log('========================================');

        updateDebugInfo('收到数据包 ' + payload.byteLength + ' 字节');

        try {
            // 尝试解析为文本
            const text = Quiet.ab2str(payload);
            console.log('数据包内容预览:', text.substring(0, 100));

            // 检查是否包含分隔符（数据包）
            if (text.includes('|') && text.startsWith('{"type":1')) {
                console.log('检测到数据块包');
                // 这是一个数据包
                const separatorIndex = text.indexOf('|');
                const headerText = text.substring(0, separatorIndex);
                const header = JSON.parse(headerText);

                // 提取数据部分
                const headerBytes = new TextEncoder().encode(headerText + '|');
                const data = payload.slice(headerBytes.length);

                handleDataPacket(header.index, data);
            } else {
                // 这是元数据或结束标记
                const packet = JSON.parse(text);
                console.log('收到数据包，类型:', packet.type);

                if (packet.type === PACKET_TYPE.METADATA) {
                    console.log('!!! 收到元数据包 !!!:', packet);
                    updateDebugInfo('收到文件: ' + packet.name);
                    handleMetadataPacket(packet);
                } else if (packet.type === PACKET_TYPE.END) {
                    console.log('!!! 收到结束包 !!!');
                    updateDebugInfo('文件接收完成');
                    handleEndPacket();
                }
            }
        } catch (error) {
            console.error('解析数据包失败:', error);
            console.error('原始数据:', payload);
            updateDebugInfo('解析错误: ' + error.message);
        }
    }

    function handleMetadataPacket(packet) {
        console.log('处理元数据:', packet.name, packet.size, '字节,', packet.chunks, '个数据块');
        fileMetadata = {
            name: packet.name,
            type: packet.fileType,
            size: packet.size,
            chunks: packet.chunks
        };

        receivedChunks = new Array(packet.chunks);
        receivedChunkCount = 0;

        elements.receiverStatus.textContent = `正在接收: ${packet.name}`;
        showElement(elements.receiveProgress);
        hideElement(elements.receivedFile);
        console.log('已准备接收', packet.chunks, '个数据块');
    }

    function handleDataPacket(index, data) {
        if (!fileMetadata) {
            console.warn('收到数据块但没有元数据，索引:', index);
            return;
        }

        receivedChunks[index] = data;
        receivedChunkCount++;

        console.log(`收到数据块 ${index}, 进度: ${receivedChunkCount}/${fileMetadata.chunks}`);

        const progress = (receivedChunkCount / fileMetadata.chunks * 100).toFixed(0);
        elements.receiveProgressBar.style.width = progress + '%';
        elements.receiveProgressText.textContent = `接收中... ${receivedChunkCount}/${fileMetadata.chunks} (${progress}%)`;
    }

    function handleEndPacket() {
        if (!fileMetadata) {
            console.warn('收到结束包但没有元数据');
            return;
        }

        console.log('文件接收完成，共', receivedChunkCount, '个数据块');
        elements.receiveProgressText.textContent = '接收完成！';
        elements.receivedFileName.textContent = fileMetadata.name;
        elements.receivedFileSize.textContent = formatFileSize(fileMetadata.size);

        setTimeout(() => {
            hideElement(elements.receiveProgress);
            showElement(elements.receivedFile);
            elements.receiverStatus.textContent = '文件接收成功！';
        }, 1000);
    }

    // Quiet.js 就绪回调
    function onQuietReady() {
        console.log('========================================');
        console.log('Quiet.js 已就绪');
        console.log('========================================');

        // 检查当前是否在接收标签页，如果是则自动初始化接收器
        const receiveTab = document.getElementById('receive');
        if (receiveTab && receiveTab.classList.contains('active')) {
            console.log('当前在接收标签页，自动初始化接收器');
            setTimeout(initReceiver, 500); // 延迟一下确保 DOM 就绪
        }
    }

    function onQuietFail(reason) {
        console.error('========================================');
        console.error('Quiet.js 初始化失败:', reason);
        console.error('========================================');
        showWarning('音频系统初始化失败: ' + reason);
    }

    // 页面加载完成后初始化
    document.addEventListener('DOMContentLoaded', () => {
        Quiet.addReadyCallback(onQuietReady, onQuietFail);
    });

})();
