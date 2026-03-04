(function () {
    // Acquire VS Code API
    const vscode = acquireVsCodeApi();

    // DOM elements
    const projectSelect = document.getElementById('projectSelect');
    const sessionSelect = document.getElementById('sessionSelect');
    const modelSelect = document.getElementById('modelSelect');
    const newSessionBtn = document.getElementById('newSessionBtn');
    const messagesArea = document.getElementById('messagesArea');
    const emptyState = document.getElementById('emptyState');
    const streamingIndicator = document.getElementById('streamingIndicator');
    const messageInput = document.getElementById('messageInput');
    const sendBtn = document.getElementById('sendBtn');
    const errorBanner = document.getElementById('errorBanner');

    // State
    let currentProjectId = '';
    let currentSessionId = '';
    let currentLlmMode = 'gemini';
    let isStreaming = false;
    let currentAssistantEl = null;
    let currentAssistantContent = '';
    let pendingSources = null;

    // Restore persisted state
    const savedState = vscode.getState();
    if (savedState) {
        currentProjectId = savedState.projectId || '';
        currentSessionId = savedState.sessionId || '';
        currentLlmMode = savedState.llmMode || 'gemini';
    }
    modelSelect.value = currentLlmMode;

    // ── Helpers ──────────────────────────────────────────

    function saveState() {
        vscode.setState({
            projectId: currentProjectId,
            sessionId: currentSessionId,
            llmMode: currentLlmMode,
        });
    }

    function showError(msg) {
        errorBanner.textContent = msg;
        errorBanner.classList.add('visible');
        setTimeout(function () {
            errorBanner.classList.remove('visible');
        }, 8000);
    }

    function scrollToBottom() {
        messagesArea.scrollTop = messagesArea.scrollHeight;
    }

    /**
     * Simple markdown-like rendering:
     * - ```...``` code blocks
     * - `inline code`
     * - **bold**
     * - [Source N] citation markers
     */
    function renderMarkdown(text) {
        // Escape HTML
        let html = text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');

        // Code blocks: ```...```
        html = html.replace(/```(\w*)\n([\s\S]*?)```/g, function (_, lang, code) {
            return '<pre><code>' + code + '</code></pre>';
        });

        // Inline code: `...`
        html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

        // Bold: **...**
        html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

        return html;
    }

    function addMessageEl(role, content) {
        emptyState.style.display = 'none';

        var div = document.createElement('div');
        div.className = 'message';

        var roleEl = document.createElement('div');
        roleEl.className = 'message-role ' + role;
        roleEl.textContent = role;
        div.appendChild(roleEl);

        var contentEl = document.createElement('div');
        contentEl.className = 'message-content';
        contentEl.innerHTML = renderMarkdown(content);
        div.appendChild(contentEl);

        messagesArea.appendChild(div);
        scrollToBottom();

        return contentEl;
    }

    function addSourcesEl(sources) {
        if (!sources || sources.length === 0) {
            return;
        }

        var div = document.createElement('div');
        div.className = 'sources';

        var title = document.createElement('div');
        title.className = 'sources-title';
        title.textContent = 'Sources';
        div.appendChild(title);

        sources.forEach(function (source, idx) {
            var link = document.createElement('a');
            link.className = 'source-link';
            var label = source.filename || source.source_type + ' ' + source.source_id;
            link.textContent = '[' + (idx + 1) + '] ' + label;
            link.title = source.original_path || label;

            link.addEventListener('click', function (e) {
                e.preventDefault();
                if (source.original_path) {
                    vscode.postMessage({
                        type: 'openFile',
                        path: source.original_path,
                        line: 1,
                    });
                }
            });

            div.appendChild(link);
        });

        messagesArea.appendChild(div);
        scrollToBottom();
    }

    function setStreaming(active) {
        isStreaming = active;
        sendBtn.disabled = active;
        messageInput.disabled = active;
        streamingIndicator.classList.toggle('active', active);
    }

    // ── Event handlers ───────────────────────────────────

    function sendMessage() {
        var content = messageInput.value.trim();
        if (!content || isStreaming) {
            return;
        }

        if (!currentProjectId) {
            showError('Please select a project first.');
            return;
        }

        // Auto-create session if needed
        if (!currentSessionId) {
            vscode.postMessage({
                type: 'createSession',
                projectId: currentProjectId,
            });
            // Store the pending message to send once session is created
            messageInput.dataset.pendingMessage = content;
            setStreaming(true);
            return;
        }

        // Display user message
        addMessageEl('user', content);
        messageInput.value = '';
        autoResizeTextarea();

        // Send to extension host
        setStreaming(true);
        currentAssistantEl = null;
        currentAssistantContent = '';
        pendingSources = null;

        vscode.postMessage({
            type: 'sendMessage',
            projectId: currentProjectId,
            sessionId: currentSessionId,
            content: content,
            llmMode: currentLlmMode,
        });
    }

    sendBtn.addEventListener('click', sendMessage);

    messageInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    // Auto-resize textarea
    function autoResizeTextarea() {
        messageInput.style.height = 'auto';
        messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
    }

    messageInput.addEventListener('input', autoResizeTextarea);

    // Project selection
    projectSelect.addEventListener('change', function () {
        currentProjectId = projectSelect.value;
        currentSessionId = '';
        saveState();

        // Clear messages
        messagesArea.innerHTML = '';
        messagesArea.appendChild(emptyState);
        emptyState.style.display = '';

        // Clear sessions dropdown
        sessionSelect.innerHTML = '<option value="">New chat</option>';

        if (currentProjectId) {
            vscode.postMessage({
                type: 'getSessions',
                projectId: currentProjectId,
            });
        }
    });

    // Session selection
    sessionSelect.addEventListener('change', function () {
        currentSessionId = sessionSelect.value;
        saveState();

        // Clear messages area
        messagesArea.innerHTML = '';
        messagesArea.appendChild(emptyState);
        emptyState.style.display = '';

        if (currentSessionId && currentProjectId) {
            // Load existing messages
            vscode.postMessage({
                type: 'getMessages',
                projectId: currentProjectId,
                sessionId: currentSessionId,
            });
        }
    });

    // Model selection
    modelSelect.addEventListener('change', function () {
        currentLlmMode = modelSelect.value;
        saveState();
    });

    // New session button
    newSessionBtn.addEventListener('click', function () {
        currentSessionId = '';
        sessionSelect.value = '';
        saveState();

        // Clear messages
        messagesArea.innerHTML = '';
        messagesArea.appendChild(emptyState);
        emptyState.style.display = '';
    });

    // ── Messages from extension host ─────────────────────

    window.addEventListener('message', function (event) {
        var msg = event.data;

        switch (msg.type) {
            case 'token':
                if (!currentAssistantEl) {
                    currentAssistantEl = addMessageEl('assistant', '');
                }
                currentAssistantContent += msg.token;
                currentAssistantEl.innerHTML = renderMarkdown(currentAssistantContent);
                scrollToBottom();
                break;

            case 'sources':
                pendingSources = msg.sources;
                break;

            case 'done':
                setStreaming(false);
                if (pendingSources) {
                    addSourcesEl(pendingSources);
                    pendingSources = null;
                }
                currentAssistantEl = null;
                currentAssistantContent = '';

                // Refresh sessions list to show updated titles
                if (currentProjectId) {
                    vscode.postMessage({
                        type: 'getSessions',
                        projectId: currentProjectId,
                    });
                }
                break;

            case 'error':
                setStreaming(false);
                showError(msg.message || 'An error occurred.');
                currentAssistantEl = null;
                currentAssistantContent = '';
                pendingSources = null;
                break;

            case 'projects':
                populateProjects(msg.projects || []);
                break;

            case 'sessions':
                populateSessions(msg.sessions || []);
                break;

            case 'messages':
                populateMessages(msg.messages || []);
                break;

            case 'providers':
                populateProviders(msg.providers || []);
                break;

            case 'sessionCreated':
                var session = msg.session;
                currentSessionId = session.id;
                saveState();

                // Add to session dropdown
                var opt = document.createElement('option');
                opt.value = session.id;
                opt.textContent = session.title || 'New chat';
                sessionSelect.insertBefore(opt, sessionSelect.firstChild.nextSibling);
                sessionSelect.value = session.id;

                // If there was a pending message, send it now
                var pendingMsg = messageInput.dataset.pendingMessage;
                if (pendingMsg) {
                    delete messageInput.dataset.pendingMessage;
                    addMessageEl('user', pendingMsg);
                    messageInput.value = '';
                    autoResizeTextarea();

                    currentAssistantEl = null;
                    currentAssistantContent = '';
                    pendingSources = null;

                    vscode.postMessage({
                        type: 'sendMessage',
                        projectId: currentProjectId,
                        sessionId: currentSessionId,
                        content: pendingMsg,
                        llmMode: currentLlmMode,
                    });
                }
                break;

            case 'serverStarted':
                // Refresh projects
                vscode.postMessage({ type: 'getProjects' });
                break;

            case 'serverStopped':
                showError('Momodoc server stopped.');
                break;

            default:
                break;
        }
    });

    function populateProjects(projects) {
        projectSelect.innerHTML = '<option value="">Select project...</option>';
        projects.forEach(function (p) {
            var opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = p.name;
            projectSelect.appendChild(opt);
        });

        // Restore saved project
        if (currentProjectId) {
            projectSelect.value = currentProjectId;
            if (projectSelect.value === currentProjectId) {
                // Project still exists; load sessions
                vscode.postMessage({
                    type: 'getSessions',
                    projectId: currentProjectId,
                });
            } else {
                // Saved project no longer exists
                currentProjectId = '';
                currentSessionId = '';
                saveState();
            }
        }
    }

    function populateSessions(sessions) {
        sessionSelect.innerHTML = '<option value="">New chat</option>';
        sessions.forEach(function (s) {
            var opt = document.createElement('option');
            opt.value = s.id;
            opt.textContent = s.title || 'Untitled';
            sessionSelect.appendChild(opt);
        });

        // Restore saved session
        if (currentSessionId) {
            sessionSelect.value = currentSessionId;
            if (sessionSelect.value === currentSessionId) {
                // Load messages for the restored session
                vscode.postMessage({
                    type: 'getMessages',
                    projectId: currentProjectId,
                    sessionId: currentSessionId,
                });
            } else {
                currentSessionId = '';
                saveState();
            }
        }
    }

    function populateMessages(messages) {
        messagesArea.innerHTML = '';
        messagesArea.appendChild(emptyState);

        if (messages.length === 0) {
            emptyState.style.display = '';
            return;
        }

        emptyState.style.display = 'none';

        messages.forEach(function (m) {
            addMessageEl(m.role, m.content);
            if (m.sources && m.sources.length > 0) {
                addSourcesEl(m.sources);
            }
        });
    }

    function populateProviders(providers) {
        modelSelect.innerHTML = '';
        var providerLabels = {
            gemini: 'Gemini',
            claude: 'Claude',
            openai: 'OpenAI',
            ollama: 'Ollama'
        };
        providers.forEach(function (p) {
            var opt = document.createElement('option');
            opt.value = p.name;
            opt.textContent = providerLabels[p.name] || p.name;
            if (!p.available) {
                opt.disabled = true;
                opt.textContent += ' (no key)';
            }
            modelSelect.appendChild(opt);
        });
        // Restore saved model
        if (currentLlmMode) {
            modelSelect.value = currentLlmMode;
            // If saved mode is no longer available, pick first available
            if (modelSelect.value !== currentLlmMode) {
                var firstAvailable = providers.find(function(p) { return p.available; });
                if (firstAvailable) {
                    currentLlmMode = firstAvailable.name;
                    modelSelect.value = currentLlmMode;
                    saveState();
                }
            }
        }
    }

    // ── Initialization ───────────────────────────────────

    // Signal readiness to extension host
    vscode.postMessage({ type: 'ready' });
})();
