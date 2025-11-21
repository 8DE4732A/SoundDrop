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
        profilesPrefix: "example/",
        memoryInitializerPrefix: "example/",
        libfecPrefix: "example/"
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
        warning: document.getElementById('warning')
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

        elements.sendProgressText.textContent = '正在发送文件信息...';
        await sendPacket(metadata);
        await sleep(500); // 给接收方一点时间处理元数据

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
            await sleep(100); // 给接收方一点时间处理
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

                    transmitter.transmit(combined.buffer, resolve);
                } else {
                    transmitter.transmit(Quiet.str2ab(json), resolve);
                }
            } catch (error) {
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
            const profileName = document.querySelector('[data-quiet-profile-name]').getAttribute('data-quiet-profile-name');

            transmitter = Quiet.transmitter({
                profile: profileName,
                onFinish: () => {
                    // 传输完成
                }
            });

            setTimeout(resolve, 500);
        });
    }

    // 初始化接收器
    function initReceiver() {
        const profileName = document.querySelector('[data-quiet-profile-name]').getAttribute('data-quiet-profile-name');

        receiver = Quiet.receiver({
            profile: profileName,
            onReceive: onReceivePacket,
            onCreateFail: (reason) => {
                console.error('接收器创建失败:', reason);
                showWarning('无法访问麦克风，请检查权限设置');
            },
            onReceiveFail: (numFails) => {
                console.log('接收失败次数:', numFails);
            }
        });
    }

    // 接收数据包
    function onReceivePacket(payload) {
        try {
            // 尝试解析为文本
            const text = Quiet.ab2str(payload);

            // 检查是否包含分隔符（数据包）
            if (text.includes('|') && text.startsWith('{"type":1')) {
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

                if (packet.type === PACKET_TYPE.METADATA) {
                    handleMetadataPacket(packet);
                } else if (packet.type === PACKET_TYPE.END) {
                    handleEndPacket();
                }
            }
        } catch (error) {
            console.error('解析数据包失败:', error);
        }
    }

    function handleMetadataPacket(packet) {
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
    }

    function handleDataPacket(index, data) {
        if (!fileMetadata) return;

        receivedChunks[index] = data;
        receivedChunkCount++;

        const progress = (receivedChunkCount / fileMetadata.chunks * 100).toFixed(0);
        elements.receiveProgressBar.style.width = progress + '%';
        elements.receiveProgressText.textContent = `接收中... ${receivedChunkCount}/${fileMetadata.chunks} (${progress}%)`;
    }

    function handleEndPacket() {
        if (!fileMetadata) return;

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
        console.log('Quiet.js 已就绪');
    }

    function onQuietFail(reason) {
        console.error('Quiet.js 初始化失败:', reason);
        showWarning('音频系统初始化失败: ' + reason);
    }

    // 页面加载完成后初始化
    document.addEventListener('DOMContentLoaded', () => {
        Quiet.addReadyCallback(onQuietReady, onQuietFail);
    });

})();
