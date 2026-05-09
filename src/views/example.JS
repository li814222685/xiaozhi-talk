    <script>
        let ws = null;
        let isConnected = false;
        let mediaRecorder = null;
        let audioChunks = [];
        let isRecording = false;
        let sessionId = null;
        let audioQueue = [];
        let isPlaying = false;
        let audioContext = null;
        let nextPlayTime = 0;
        let audioProcessor = null;
        let audioStream = null;
        let processorNode = null;
        const wsUrl = "{{ local_proxy_url }}";  // 使用配置的本地代理地址
        let silenceTimer = null;
        const SILENCE_TIMEOUT = 1000; // 1秒没有声音就自动停止
        let lastAudioTime = 0;
        let currentResponseDiv = null;  // 当前回复的消息 div
        const BUFFER_THRESHOLD = 3;     // 缓冲区阈值，当积累了这么多音频片段后开始播放
        let audioBufferQueue = [];      // 音频缓冲区队列
        let isAudioContextInitialized = false;
        let lastUserAudioLevel = 0;
        let lastAIAudioLevel = 0;
        let animationCheckInterval = null;

        // 初始化音频处理器
        async function initAudioProcessor() {
            if (!audioContext) {
                audioContext = new (window.AudioContext || window.webkitAudioContext)({
                    sampleRate: 16000
                });
                await audioContext.audioWorklet.addModule('/static/audio-processor.js');
            }
            return audioContext;
        }

        // 修改为点击切换通话状态
        function initRecordButton() {
            const button = document.getElementById('recordButton');
            
            // 点击切换通话状态
            button.addEventListener('click', async () => {
                if (!isRecording) {
                    await startRecording();
                    button.style.background = '#ea4335';
                } else {
                    stopRecording();
                    button.style.background = '#34a853';
                }
            });
        }

        // 开始录音
        async function startRecording() {
            try {
                // 显示通话界面
                const voiceCallMode = document.getElementById('voiceCallMode');
                voiceCallMode.classList.add('active');

                // 先停止所有正在播放的音频
                if (audioContext) {
                    await audioContext.close();
                    audioContext = null;
                    audioQueue = [];
                    isPlaying = false;
                    nextPlayTime = 0;
                }
                
                await initAudioProcessor();
                
                // 如果已经有流，先停止它
                if (audioStream) {
                    audioStream.getTracks().forEach(track => track.stop());
                }
                
                // 添加错误提示
                try {
                    audioStream = await navigator.mediaDevices.getUserMedia({ 
                        audio: {
                            sampleRate: 16000,
                            channelCount: 1,
                            echoCancellation: true,
                            noiseSuppression: true
                        }
                    });
                } catch (err) {
                    if (err.name === 'NotAllowedError') {
                        alert('请允许访问麦克风。如果在非 HTTPS 环境，请使用 localhost 或配置 HTTPS。');
                    } else if (err.name === 'NotFoundError') {
                        alert('未找到麦克风设备，请检查设备连接。');
                    } else {
                        alert(`麦克风访问错误: ${err.message}`);
                    }
                    throw err;
                }
                
                const source = audioContext.createMediaStreamSource(audioStream);
                
                // 如果已经有处理节点，先断开连接并重置
                if (processorNode) {
                    processorNode.port.postMessage({ type: 'reset' });
                    processorNode.disconnect();
                }
                
                // 创建音频处理节点
                processorNode = new AudioWorkletNode(audioContext, 'audio-processor', {
                    processorOptions: {
                        bufferSize: 960 // 60ms at 16kHz
                    }
                });

                // 处理音频数据
                processorNode.port.onmessage = (e) => {
                    if (isRecording && ws && ws.readyState === WebSocket.OPEN) {
                        if (e.data instanceof Float32Array) {
                            const audioLevel = detectAudioLevel(e.data);
                            updateUserWaveAnimation(audioLevel);
                            ws.send(e.data.buffer);
                            lastAudioTime = Date.now();
                        } else if (e.data.buffer) {
                            const audioData = new Float32Array(e.data.buffer);
                            const audioLevel = detectAudioLevel(audioData);
                            updateUserWaveAnimation(audioLevel);
                        ws.send(e.data.buffer);
                        lastAudioTime = Date.now();
                        }
                    }
                };

                source.connect(processorNode);
                processorNode.connect(audioContext.destination);

                // 发送开始录音消息
                if (ws && ws.readyState === WebSocket.OPEN) {
                    const startMessage = JSON.stringify({
                        type: "listen",
                        state: "start",
                        mode: "auto"
                    });
                    ws.send(startMessage);
                }

                isRecording = true;
                lastAudioTime = Date.now();
                
                // 启动静音检测
                silenceTimer = setInterval(() => {
                    if (isRecording && Date.now() - lastAudioTime > SILENCE_TIMEOUT) {
                        // 检测到静音，发送静音帧
                        if (ws && ws.readyState === WebSocket.OPEN) {
                            const silenceFrame = new Int16Array(960);
                            ws.send(silenceFrame.buffer);
                        }
                    }
                }, 100);

                updateRecordButtonStyle(true);

            } catch (err) {
                console.error('Error starting recording:', err);
                updateRecordButtonStyle(false);
                alert('无法访问麦克风');
            }
        }

        // 停止录音
        function stopRecording() {
            // 隐藏通话界面
            const voiceCallMode = document.getElementById('voiceCallMode');
            voiceCallMode.classList.remove('active');

            if (silenceTimer) {
                clearInterval(silenceTimer);
                silenceTimer = null;
            }
            
            // 发送停止消息
            if (ws && ws.readyState === WebSocket.OPEN) {
                const stopMessage = JSON.stringify({
                    type: "listen",
                    state: "stop",
                    mode: "auto"
                });
                ws.send(stopMessage);
            }

            // 清理资源
            if (audioStream) {
                audioStream.getTracks().forEach(track => track.stop());
                audioStream = null;
            }
            
            if (processorNode) {
                processorNode.port.postMessage({ type: 'reset' });
                processorNode.disconnect();
                processorNode = null;
            }
            
            // 等待当前音频播放完成
            if (audioContext) {
                const currentTime = audioContext.currentTime;
                if (nextPlayTime > currentTime) {
                    setTimeout(() => {
                        if (audioContext) {
                            audioContext.close();
                            audioContext = null;
                        }
                        audioQueue = [];
                        isPlaying = false;
                        nextPlayTime = 0;
                    }, (nextPlayTime - currentTime) * 1000);
                } else {
                    audioContext.close();
                    audioContext = null;
                    audioQueue = [];
                    isPlaying = false;
                    nextPlayTime = 0;
                }
            }
            
            isRecording = false;
            updateRecordButtonStyle(false);
            showUserWaveAnimation(false);
            showAIWaveAnimation(false);

            if (animationCheckInterval) {
                clearInterval(animationCheckInterval);
                animationCheckInterval = null;
            }
            
            updateUserWaveAnimation(0);
            updateAIWaveAnimation(0);
        }

        // 连接WebSocket
        function connect() {
            console.log('Connecting to:', wsUrl);
            ws = new WebSocket(wsUrl);
            
            ws.onopen = function() {
                console.log('Connected to WebSocket server');
                isConnected = true;
                document.getElementById('connectionStatus').className = 'status connected';
                document.getElementById('connectionStatus').textContent = '已连接';
                
                // 发送hello消息
                const helloMessage = JSON.stringify({
                    type: "hello",
                    version: 3,
                    transport: "websocket",
                    audio_params: {
                        format: "opus",
                        sample_rate: 16000,
                        channels: 1,
                        frame_duration: 60
                    }
                });
                console.log('Sending hello message:', helloMessage);
                ws.send(helloMessage);
            };
            
            ws.onclose = function(event) {
                console.log('WebSocket closed with code:', event.code, 'reason:', event.reason);
                isConnected = false;
                sessionId = null;
                document.getElementById('connectionStatus').className = 'status disconnected';
                document.getElementById('connectionStatus').textContent = '未连接';
                
                // 3秒后重连
                setTimeout(connect, 3000);
            };
            
            ws.onerror = function(error) {
                console.error('WebSocket error:', error);
                document.getElementById('connectionStatus').className = 'status error';
                document.getElementById('connectionStatus').textContent = '错误';
            };
            
            ws.onmessage = async function(event) {
                try {
                    if (event.data instanceof Blob) {
                        showAIWaveAnimation(true);
                        queueAudio(event.data);
                    } else {
                        // 处理文本消息
                        const data = JSON.parse(event.data);
                        console.log('Received message:', data);
                        
                        if (data.type === 'hello') {
                            sessionId = data.session_id;
                            console.log('Session ID:', sessionId);
                        } else if (data.type === 'stt') {
                            // 只有在录音状态且没有source字段时才显示语音识别结果
                            if (data.text && data.text.trim() && isRecording && !data.source) {
                                appendMessage('user', data.text);  // 直接显示文本，不加[语音识别]前缀
                            }
                        } else if (data.type === 'tts') {
                            if (data.state === 'start') {
                                showAIWaveAnimation(true);
                                // 创建新的回复消息
                                if (data.text && data.text.trim()) {
                                    currentResponseDiv = appendMessage('server', data.text);
                                }
                            } else if (data.state === 'sentence_start') {
                                showAIWaveAnimation(true);
                                // 如果是新的句子，且有文本内容
                                if (data.text && data.text.trim()) {
                                if (!currentResponseDiv) {
                                        // 如果没有当前回复div，创建一个新的
                                    currentResponseDiv = appendMessage('server', data.text);
                                } else {
                                        // 如果已有回复div，追加内容
                                        currentResponseDiv.innerHTML += ' ' + data.text;
                                        // 滚动到底部
                                    const chatBox = document.getElementById('chatBox');
                                    chatBox.scrollTop = chatBox.scrollHeight;
                                    }
                                }
                            } else if (data.state === 'end' || data.state === 'stop') {
                                showAIWaveAnimation(false);
                                // 结束当前回复
                                currentResponseDiv = null;
                            }
                        }
                    }
                } catch (e) {
                    console.error('Error processing message:', e);
                }
            };
        }
        
        // 添加消息到聊天框
        function appendMessage(type, text) {
            const chatBox = document.getElementById('chatBox');
            const messageDiv = document.createElement('div');
            messageDiv.className = `message ${type}`;
            
            const contentDiv = document.createElement('div');
            contentDiv.className = 'message-content';
            
            // 处理消息内容，支持换行
            const formattedMessage = text.replace(/\n/g, '<br>');
            contentDiv.innerHTML = formattedMessage;
            
            const timeDiv = document.createElement('div');
            timeDiv.className = 'message-time';
            const now = new Date();
            timeDiv.textContent = now.toLocaleTimeString('zh-CN', { 
                hour: '2-digit', 
                minute: '2-digit'
            });
            
            messageDiv.appendChild(contentDiv);
            messageDiv.appendChild(timeDiv);
            chatBox.appendChild(messageDiv);
            
            // 滚动到底部
            chatBox.scrollTop = chatBox.scrollHeight;
            
            // 如果是服务器消息，返回内容div以支持追加内容
            if (type === 'server') {
                return contentDiv;
            }
            return messageDiv;
        }
        
        function sendMessage() {
            const input = document.getElementById('messageInput');
            const message = input.value.trim();
            
            if (message && ws && isConnected && sessionId) {
                // 发送文本消息
                const textMessage = JSON.stringify({
                    type: "listen",
                    state: "detect",
                    text: message,
                    source: "text"  // 标记这是文本消息
                });
                ws.send(textMessage);
                // 直接显示用户消息，不等待 stt 回复
                appendMessage('user', message);
                input.value = '';
            } else if (!sessionId) {
                console.error('No session ID available');
                appendMessage('server', '连接未就绪，请稍后再试');
            }
        }
        
        function handleKeyPress(event) {
            if (event.key === 'Enter') {
                sendMessage();
            }
        }
        
        // 初始化音频上下文
        function initAudioContext() {
            if (!audioContext) {
                audioContext = new (window.AudioContext || window.webkitAudioContext)({
                    sampleRate: 16000,  // 16kHz采样率
                    latencyHint: 'interactive'
                });
                nextPlayTime = audioContext.currentTime;
                isAudioContextInitialized = true;
            }
            if (audioContext.state === 'suspended') {
                audioContext.resume();
            }
        }
        
        // 添加音频到队列
        function queueAudio(audioBlob) {
            audioQueue.push(audioBlob);
            if (!isPlaying && audioQueue.length >= BUFFER_THRESHOLD) {
                isPlaying = true;
                playNextAudio();
            }
        }

        // 播放音频队列
        async function playNextAudio() {
            if (audioQueue.length === 0) {
                isPlaying = false;
                updateAIWaveAnimation(0); // 没有音频时停止动画
                return;
            }
            
            try {
                initAudioContext();
                const audioBlob = audioQueue.shift();
                const arrayBuffer = await audioBlob.arrayBuffer();
                
                // 检查WAV头
                const view = new DataView(arrayBuffer);
                const magic = String.fromCharCode(...new Uint8Array(arrayBuffer.slice(0, 4)));
                if (magic !== 'RIFF') {
                    throw new Error('Invalid WAV format');
                }
                
                const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
                const source = audioContext.createBufferSource();
                source.buffer = audioBuffer;

                // 创建分析器节点
                const analyser = audioContext.createAnalyser();
                analyser.fftSize = 256;
                const bufferLength = analyser.frequencyBinCount;
                const dataArray = new Float32Array(bufferLength);

                // 创建增益节点
                const gainNode = audioContext.createGain();
                source.connect(analyser);
                analyser.connect(gainNode);
                gainNode.connect(audioContext.destination);
                
                // 设置音频分析定时器
                if (animationCheckInterval) {
                    clearInterval(animationCheckInterval);
                }
                
                animationCheckInterval = setInterval(() => {
                    analyser.getFloatTimeDomainData(dataArray);
                    const audioLevel = detectAudioLevel(dataArray);
                    updateAIWaveAnimation(audioLevel);
                }, 50);
                
                // 确保音频片段之间无间隙
                const currentTime = audioContext.currentTime;
                const startTime = Math.max(currentTime, nextPlayTime);
                
                // 添加淡入淡出效果
                const fadeDuration = 0.005;
                gainNode.gain.setValueAtTime(0, startTime);
                gainNode.gain.linearRampToValueAtTime(1, startTime + fadeDuration);
                gainNode.gain.setValueAtTime(1, startTime + audioBuffer.duration - fadeDuration);
                gainNode.gain.linearRampToValueAtTime(0, startTime + audioBuffer.duration);
                
                source.start(startTime);
                nextPlayTime = startTime + audioBuffer.duration + 0.05;
                
                    source.onended = () => {
                    source.disconnect();
                    gainNode.disconnect();
                    analyser.disconnect();
                    
                    if (animationCheckInterval) {
                        clearInterval(animationCheckInterval);
                        animationCheckInterval = null;
                    }
                    
                            if (audioQueue.length > 0) {
                        setTimeout(() => playNextAudio(), 50);
                            } else {
                                isPlaying = false;
                        updateAIWaveAnimation(0);
                            }
                    };
            } catch (e) {
                console.error('Audio playback error:', e);
                isPlaying = false;
                updateAIWaveAnimation(0);
                if (audioQueue.length > 0) {
                    setTimeout(() => playNextAudio(), 100);
                }
            }
        }

        // 页面关闭时清理连接
        window.onbeforeunload = function() {
            if (ws) {
                ws.close();
            }
        };

        // 页面加载时连接
        window.onload = () => {
            connect();
            initRecordButton();
        };

        // 添加设置面板相关功能
        function toggleSettings() {
            const panel = document.getElementById('settingsPanel');
            const overlay = document.getElementById('overlay');
            panel.classList.toggle('active');
            overlay.classList.toggle('active');
        }

        function saveSettings() {
            const newRemoteUrl = document.getElementById('remoteServerUrl').value.trim();
            const newLocalProxyUrl = document.getElementById('localProxyUrl').value.trim();
            const enableToken = document.getElementById('enableToken').checked;
            const token = document.getElementById('serverToken').value.trim();
            
            if (newRemoteUrl && newLocalProxyUrl) {
                fetch('/save_config', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        ws_url: newRemoteUrl,
                        local_proxy_url: newLocalProxyUrl,
                        enable_token: enableToken,
                        token: enableToken ? token : ''
                    })
                })
                .then(response => response.json())
                .then(data => {
                    if (data.success) {
                        alert(data.message || '配置已保存');
                        if (ws) {
                            ws.close();
                            setTimeout(connect, 1000);
                        }
                    } else {
                        alert('保存配置失败：' + data.error);
                    }
                })
                .catch(error => {
                    console.error('Error saving config:', error);
                    alert('保存配置失败，请检查网络连接');
                });
            }
            toggleSettings();
        }

        // 添加 Token 开关事件监听
        document.getElementById('enableToken').addEventListener('change', function(e) {
            const tokenInput = document.getElementById('serverToken');
            const statusText = document.getElementById('tokenStatus');
            tokenInput.disabled = !e.target.checked;
            
            if (!e.target.checked) {
                tokenInput.style.backgroundColor = '#f3f4f6';
                tokenInput.style.borderColor = '#e5e7eb';
                statusText.textContent = '已关闭';
                statusText.style.color = '#374151';
            } else {
                tokenInput.style.backgroundColor = '';
                tokenInput.style.borderColor = '';
                statusText.textContent = '已开启';
                statusText.style.color = '#34c759';
            }
        });

        // 修改录音按钮样式
        function updateRecordButtonStyle(isRecording) {
            const button = document.getElementById('recordButton');
            if (isRecording) {
                button.style.background = '#ea4335';
            } else {
                button.style.background = '#34a853';
            }
        }

        // 添加音频波形动画控制
        function showAIWaveAnimation(show) {
            const wave = document.querySelector('.voice-wave');
            if (show) {
                wave.classList.add('active');
            } else {
                wave.classList.remove('active');
            }
        }

        function showUserWaveAnimation(show) {
            const wave = document.querySelector('.voice-wave');
            if (show) {
                wave.classList.add('active');
            } else {
                wave.classList.remove('active');
            }
        }

        // 添加音频电平检测
        function detectAudioLevel(audioData) {
            if (!audioData || !audioData.length) return 0;
            let sum = 0;
            for (let i = 0; i < audioData.length; i++) {
                sum += Math.abs(audioData[i]);
            }
            return sum / audioData.length;
        }

        // 更新用户说话时的波形显示
        function updateUserWaveAnimation(audioLevel) {
            const threshold = 0.01;
            const maxHeight = 24; // 最大高度
            const minHeight = 2;  // 最小高度
            
            if (audioLevel > threshold) {
                const height = Math.min(maxHeight, minHeight + (audioLevel * 100));
                document.documentElement.style.setProperty('--wave-height', `${height}px`);
                showUserWaveAnimation(true);
            } else {
                showUserWaveAnimation(false);
            }
        }

        // 更新AI说话时的头像动画
        function updateAIWaveAnimation(audioLevel) {
            const threshold = 0.01;
            const avatar = document.querySelector('.voice-avatar');
            const maxScale = 1.05;
            
            if (audioLevel > threshold) {
                // 根据音频电平计算缩放值
                const scale = 1 + (Math.min(audioLevel * 2, 0.05)); // 最大缩放到1.05
                avatar.style.transform = `scale(${scale})`;
                avatar.classList.add('speaking');
            } else {
                avatar.style.transform = 'scale(1)';
                // 注意这里不移除speaking类，让涟漪动画继续
                // 只有在完全停止说话时才移除
                if (audioLevel === 0) {
                    avatar.classList.remove('speaking');
                }
            }
        }
    </script>