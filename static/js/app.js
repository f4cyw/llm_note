class LLMAssistant {
    constructor() {
        this.apiBaseUrl = 'http://localhost:8000';
        this.currentSessionId = null;
        this.currentFileIds = [];
        this.uploadedFiles = [];
        this.sessions = [];
        this.isPdfVisible = false;
        this.currentPdf = null;
        this.currentPdfDoc = null;
        this.currentPage = 1;
        this.totalPages = 1;
        this.scale = 1.0;
        this.isAreaSelectionMode = false;
        this.areaSelectionStart = null;
        this.currentSelectionBox = null;
        this.selectedAreaCoords = null;
        this.documentAreas = [];
        this.selectedAreaImage = null;
        this.areaMemory = []; // Store selected areas for reuse
        
        // Bind area selection functions once to maintain references
        this.boundStartAreaSelection = this.startAreaSelection.bind(this);
        this.boundUpdateAreaSelection = this.updateAreaSelection.bind(this);
        this.boundFinishAreaSelection = this.finishAreaSelection.bind(this);
        
        this.initializeEventListeners();
        this.loadExistingSessions();
        this.initializePdfViewer();
        this.loadAreaMemory();
    }

    initializeEventListeners() {
        // File upload events
        const uploadArea = document.getElementById('uploadArea');
        const fileInput = document.getElementById('fileInput');
        const browseBtn = document.getElementById('browseBtn');

        // Debug: Check if elements exist
        console.log('Elements found:', {
            uploadArea: !!uploadArea,
            fileInput: !!fileInput,
            browseBtn: !!browseBtn
        });

        // Browse button - more robust approach
        if (browseBtn && fileInput) {
            browseBtn.onclick = () => {
                console.log('Browse button clicked');
                fileInput.value = '';
                fileInput.click();
            };
            
            // Also add event listener as backup
            browseBtn.addEventListener('click', (e) => {
                console.log('Browse button event listener triggered');
                e.preventDefault();
                fileInput.value = '';
                fileInput.click();
            });
        }
        
        // File input change
        if (fileInput) {
            fileInput.addEventListener('change', (e) => {
                console.log('File input changed:', e.target.files.length);
                if (e.target.files.length > 0) {
                    this.handleFileUpload(e.target.files[0]);
                }
                // Reset file input after handling
                e.target.value = '';
            });
        }

        // Drag and drop
        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.classList.add('dragover');
        });

        uploadArea.addEventListener('dragleave', () => {
            uploadArea.classList.remove('dragover');
        });

        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadArea.classList.remove('dragover');
            
            const files = e.dataTransfer.files;
            if (files.length > 0 && files[0].type === 'application/pdf') {
                this.handleFileUpload(files[0]);
            } else {
                this.showError('Please upload a PDF file only.');
            }
        });

        // Chat events
        const sendBtn = document.getElementById('sendBtn');
        const messageInput = document.getElementById('messageInput');
        const newChatBtn = document.getElementById('newChatBtn');
        const sessionsBtn = document.getElementById('sessionsBtn');

        sendBtn.addEventListener('click', () => this.sendMessage());
        messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.sendMessage();
        });
        
        newChatBtn.addEventListener('click', () => this.showUploadSection());
        sessionsBtn.addEventListener('click', () => this.toggleSessionsSection());

        // Chat toggle button
        const chatToggle = document.getElementById('chatToggle');
        if (chatToggle) {
            chatToggle.addEventListener('click', () => this.toggleChatPanel());
        }

        // PDF viewer events
        const pdfToggleBtn = document.getElementById('pdfToggleBtn');
        const prevPageBtn = document.getElementById('prevPageBtn');
        const nextPageBtn = document.getElementById('nextPageBtn');
        const zoomInBtn = document.getElementById('zoomInBtn');
        const zoomOutBtn = document.getElementById('zoomOutBtn');
        const documentSelector = document.getElementById('documentSelector');

        pdfToggleBtn.addEventListener('click', () => this.togglePdfViewer());
        prevPageBtn.addEventListener('click', () => this.previousPage());
        nextPageBtn.addEventListener('click', () => this.nextPage());
        zoomInBtn.addEventListener('click', () => this.zoomIn());
        zoomOutBtn.addEventListener('click', () => this.zoomOut());
        documentSelector.addEventListener('change', (e) => this.switchDocument(e.target.value));

        // Session management events
        const multiDocChatBtn = document.getElementById('multiDocChatBtn');
        const createSessionBtn = document.getElementById('createSessionBtn');
        const cancelSessionBtn = document.getElementById('cancelSessionBtn');

        multiDocChatBtn.addEventListener('click', () => this.showSessionCreator());
        createSessionBtn.addEventListener('click', () => this.createChatSession());
        cancelSessionBtn.addEventListener('click', () => this.hideSessionCreator());

        // Text selection and popup events
        document.addEventListener('selectionchange', () => this.handleTextSelection());
        document.getElementById('askBtn').addEventListener('click', () => this.askAboutSelection());
        document.getElementById('translateBtn').addEventListener('click', () => this.translateSelection());

        // Area selection events
        const toggleAreaSelectionBtn = document.getElementById('toggleAreaSelection');
        const saveAreaBtn = document.getElementById('saveAreaBtn');
        const cancelAreaBtn = document.getElementById('cancelAreaBtn');
        
        if (toggleAreaSelectionBtn) {
            toggleAreaSelectionBtn.addEventListener('click', () => this.toggleAreaSelectionMode());
        }

        // Clear area selections button
        const clearAreaSelectionsBtn = document.getElementById('clearAreaSelections');
        if (clearAreaSelectionsBtn) {
            console.log('Clear button found, attaching listener');
            clearAreaSelectionsBtn.addEventListener('click', (e) => {
                console.log('Clear button clicked');
                e.preventDefault();
                e.stopPropagation();
                
                // Confirm action
                if (confirm('Clear all selected areas?')) {
                    this.clearAreaMemory();
                    this.cancelAreaSelection();
                    this.updateAreaMemoryDisplay();
                    alert('Areas cleared!');
                }
            });
        } else {
            console.log('Clear button not found');
        }
        if (saveAreaBtn) {
            saveAreaBtn.addEventListener('click', () => this.saveSelectedArea());
        }
        if (cancelAreaBtn) {
            cancelAreaBtn.addEventListener('click', () => this.cancelAreaSelection());
        }

        // Area tag button events will be attached when popup is shown

        // Language selection events
        const responseLanguage = document.getElementById('responseLanguage');
        responseLanguage.addEventListener('change', () => this.saveLanguagePreference());

        // Initialize resizer
        this.initializeResizer();
        
        // Load language preference
        this.loadLanguagePreference();
    }

    initializePdfViewer() {
        // Set up PDF.js worker
        if (typeof pdfjsLib !== 'undefined') {
            pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
            // Set cMapUrl for CJK font support
            pdfjsLib.GlobalWorkerOptions.cMapUrl = '/static/cmaps/'; // Updated to local path
            pdfjsLib.GlobalWorkerOptions.cMapPacked = true;
        }
    }

    initializeResizer() {
        const resizer = document.getElementById('resizer');
        const pdfPanel = document.getElementById('pdfPanel');
        const chatContainer = document.getElementById('chatContainer');
        const splitLayout = document.getElementById('splitLayout');

        let isResizing = false;

        resizer.addEventListener('mousedown', (e) => {
            isResizing = true;
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
        });

        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;

            const splitLayoutRect = splitLayout.getBoundingClientRect();
            const pdfPanelWidth = e.clientX - splitLayoutRect.left;
            const minWidth = 300;
            const maxWidth = splitLayoutRect.width - 300;

            if (pdfPanelWidth >= minWidth && pdfPanelWidth <= maxWidth) {
                const pdfPercentage = (pdfPanelWidth / splitLayoutRect.width) * 100;
                pdfPanel.style.width = `${pdfPercentage}%`;
                chatContainer.style.width = `${100 - pdfPercentage}%`;
            }
        });

        document.addEventListener('mouseup', () => {
            isResizing = false;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        });
    }

    async handleFileUpload(file) {
        if (file.type !== 'application/pdf') {
            this.showError('Please select a PDF file.');
            return;
        }

        if (file.size > 50 * 1024 * 1024) { // 50MB limit
            this.showError('File size must be less than 50MB.');
            return;
        }

        console.log('Starting file upload...', file.name);
        this.showProgress(true);
        this.updateProgress(5, 'Starting upload...');
        
        try {
            const formData = new FormData();
            formData.append('file', file);

            console.log('Sending request to:', `${this.apiBaseUrl}/upload-pdf-fast`);
            
            // Start the fast upload (returns quickly with basic processing)
            const uploadPromise = fetch(`${this.apiBaseUrl}/upload-pdf-fast`, {
                method: 'POST',
                body: formData
            });

            // Start progress polling as soon as upload begins
            let fileId = null;
            const response = await uploadPromise;
            
            console.log('Response status:', response.status);
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error('Upload error response:', errorText);
                throw new Error(`Upload failed: ${response.statusText} - ${errorText}`);
            }

            const result = await response.json();
            fileId = result.file_id;
            console.log('Fast upload complete:', result);
            
            // Update progress to 100% immediately for fast upload
            this.updateProgress(100, result.message || 'Upload complete!');
            
            // Small delay to show completion
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Final success
            this.handleUploadSuccess(result);
            
        } catch (error) {
            console.error('Upload error:', error);
            this.showError(`Upload failed: ${error.message}`);
        } finally {
            this.showProgress(false);
        }
    }

    handleUploadSuccess(fileData) {
        this.uploadedFiles.push(fileData);
        this.updateFileList();
        
        // Show files section so user can choose what to do
        this.showFilesSection();
        
        // Show success message without assuming user wants to chat yet
        this.showSuccess(`✅ Successfully uploaded "${fileData.filename}"! 
        
📄 ${fileData.total_pages} pages processed  
🧩 ${fileData.total_chunks} text chunks created

You can upload more documents or start chatting! Use "Start Chat" for this document or "Multi-Document Chat" to combine files.`);
    }

    showFilesSection() {
        // Keep upload section visible for more uploads and show files section
        document.getElementById('uploadSection').style.display = 'block';
        const filesSection = document.getElementById('filesSection');
        const chatSection = document.getElementById('chatSection');
        
        // Don't show files section if we're in chat mode
        if (chatSection && chatSection.style.display !== 'none') {
            return;
        }
        
        filesSection.style.display = 'block';
        
        // Show quick actions if multiple files
        const quickActions = document.getElementById('quickActions');
        if (this.uploadedFiles.length > 1) {
            quickActions.style.display = 'block';
        }
    }



    updateFileList() {
        const fileList = document.getElementById('fileList');
        const filesSection = document.getElementById('filesSection');
        const quickActions = document.getElementById('quickActions');
        const chatSection = document.getElementById('chatSection');
        
        if (this.uploadedFiles.length === 0) {
            filesSection.style.display = 'none';
            return;
        }

        // Don't show files section if we're in chat mode
        if (chatSection && chatSection.style.display !== 'none') {
            return;
        }

        filesSection.style.display = 'block';
        fileList.innerHTML = '';

        this.uploadedFiles.forEach(file => {
            const fileItem = document.createElement('div');
            fileItem.className = 'file-item';
            fileItem.innerHTML = `
                <div class="file-info">
                    <h4>📄 ${file.filename}</h4>
                    <p>${file.total_pages} pages • ${file.total_chunks} chunks • Status: ${file.status}</p>
                </div>
                <div class="file-actions">
                    <button class="btn btn-primary" onclick="app.openSingleDocumentChat('${file.file_id}', '${file.filename}')">
                        💬 Start Chat
                    </button>
                    <button class="btn btn-secondary" onclick="app.deleteFile('${file.file_id}')">
                        🗑️ Delete
                    </button>
                </div>
            `;
            fileList.appendChild(fileItem);
        });

        // Show multi-document chat button if more than one file
        if (this.uploadedFiles.length > 1) {
            quickActions.style.display = 'block';
        }
    }

    async openSingleDocumentChat(fileId, filename) {
        try {
            // Create a new single-document session
            const response = await fetch(`${this.apiBaseUrl}/sessions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    file_ids: [fileId],
                    name: `Chat with ${filename}`
                })
            });

            if (response.ok) {
                const sessionData = await response.json();
                this.currentSessionId = sessionData.session_id;
                this.currentFileIds = [fileId];
                await this.showChatSection([filename], 'single-doc');
                this.clearChat();
                this.loadExistingSessions(); // Refresh sessions list
            }
        } catch (error) {
            console.error('Error creating single document session:', error);
            this.showError('Failed to create chat session');
        }
    }

    showSessionCreator() {
        const sessionCreator = document.getElementById('sessionCreator');
        const documentSelector = document.getElementById('sessionDocumentSelector');
        
        sessionCreator.style.display = 'block';
        documentSelector.innerHTML = '';

        // Create checkboxes for each uploaded file
        this.uploadedFiles.forEach(file => {
            const checkboxDiv = document.createElement('div');
            checkboxDiv.className = 'document-checkbox';
            checkboxDiv.innerHTML = `
                <input type="checkbox" id="doc_${file.file_id}" value="${file.file_id}">
                <label for="doc_${file.file_id}">
                    <strong>📄 ${file.filename}</strong><br>
                    <small>${file.total_pages} pages • ${file.total_chunks} chunks</small>
                </label>
            `;
            
            const checkbox = checkboxDiv.querySelector('input');
            checkbox.addEventListener('change', () => {
                if (checkbox.checked) {
                    checkboxDiv.classList.add('selected');
                } else {
                    checkboxDiv.classList.remove('selected');
                }
            });
            
            documentSelector.appendChild(checkboxDiv);
        });
    }

    hideSessionCreator() {
        document.getElementById('sessionCreator').style.display = 'none';
        document.getElementById('sessionNameInput').value = '';
        
        // Uncheck all checkboxes
        const checkboxes = document.querySelectorAll('.document-checkbox input');
        checkboxes.forEach(cb => {
            cb.checked = false;
            cb.closest('.document-checkbox').classList.remove('selected');
        });
    }

    async createChatSession() {
        const selectedFileIds = [];
        const checkboxes = document.querySelectorAll('.document-checkbox input:checked');
        
        checkboxes.forEach(cb => {
            selectedFileIds.push(cb.value);
        });

        if (selectedFileIds.length === 0) {
            this.showError('Please select at least one document');
            return;
        }

        const sessionName = document.getElementById('sessionNameInput').value.trim() || 
                           `Multi-doc chat (${selectedFileIds.length} documents)`;

        try {
            const response = await fetch(`${this.apiBaseUrl}/sessions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    file_ids: selectedFileIds,
                    name: sessionName
                })
            });

            if (response.ok) {
                const sessionData = await response.json();
                this.currentSessionId = sessionData.session_id;
                this.currentFileIds = selectedFileIds;
                
                // Get filenames for display
                const selectedFilenames = selectedFileIds.map(fileId => {
                    const file = this.uploadedFiles.find(f => f.file_id === fileId);
                    return file ? file.filename : 'Unknown';
                });

                await this.showChatSection(selectedFilenames, 'multi-doc');
                this.hideSessionCreator();
                this.clearChat();
                this.loadExistingSessions(); // Refresh sessions list
            }
        } catch (error) {
            console.error('Error creating multi-document session:', error);
            this.showError('Failed to create chat session');
        }
    }

    async ensureFileMetadata(fileIds) {
        const missingFileIds = fileIds.filter(id => !this.uploadedFiles.some(f => f.file_id === id));
        if (missingFileIds.length === 0) {
            return;
        }

        console.log('Fetching metadata for missing files:', missingFileIds);
        try {
            const promises = missingFileIds.map(id => 
                fetch(`${this.apiBaseUrl}/files/${id}`).then(res => {
                    if (res.ok) return res.json();
                    console.error(`Failed to fetch metadata for file ${id}`);
                    return null; 
                })
            );
            
            const filesData = await Promise.all(promises);
            
            filesData.forEach(fileData => {
                if (fileData && !this.uploadedFiles.some(f => f.file_id === fileData.file_id)) {
                    // To prevent duplicates, we check again.
                    this.uploadedFiles.push(fileData);
                }
            });

        } catch (error) {
            console.error('Error fetching missing file metadata:', error);
            this.showError('Could not load details for some documents.');
        }
    }

    async loadExistingSessions() {
        try {
            // Load files first using dedicated endpoint
            await this.loadAllFiles();
            
            // Then load sessions
            const response = await fetch(`${this.apiBaseUrl}/sessions`);
            if (response.ok) {
                const data = await response.json();
                this.sessions = data.sessions || [];
                this.updateSessionsList();
            } else {
                console.warn('Failed to load sessions:', response.status);
            }
        } catch (error) {
            console.error('Error loading sessions:', error);
            // Don't throw the error, just log it
        }
    }

    async loadAllFiles() {
        try {
            const response = await fetch(`${this.apiBaseUrl}/files`);
            if (response.ok) {
                const data = await response.json();
                this.uploadedFiles = data.files || [];
                this.updateFileList();
                console.log('Loaded files:', this.uploadedFiles.length);
            } else {
                console.warn('Failed to load files:', response.status);
                // Try fallback method if files endpoint fails
                await this.loadFilesFromSessions();
            }
        } catch (error) {
            console.error('Error loading files:', error);
            // Try fallback method
            await this.loadFilesFromSessions();
        }
    }

    async loadFilesFromSessions() {
        // Fallback method: load files from existing sessions
        try {
            const response = await fetch(`${this.apiBaseUrl}/sessions`);
            if (response.ok) {
                const data = await response.json();
                this.sessions = data.sessions || [];
                
                const allFileIds = new Set();
                this.sessions.forEach(session => {
                    try {
                        const fileIds = JSON.parse(session.file_ids.replace(/'/g, '"'));
                        if (Array.isArray(fileIds)) {
                            fileIds.forEach(id => allFileIds.add(id));
                        } else {
                            allFileIds.add(fileIds);
                        }
                    } catch {
                        if (session.file_ids) {
                            allFileIds.add(session.file_ids.replace(/['"]/g, ''));
                        }
                    }
                });

                if (allFileIds.size > 0) {
                    await this.ensureFileMetadata(Array.from(allFileIds));
                }
                
                this.updateFileList();
            }
        } catch (error) {
            console.error('Error in fallback file loading:', error);
        }
    }

    updateSessionsList() {
        const sessionList = document.getElementById('sessionList');
        const sessionsSection = document.getElementById('sessionsSection');
        
        sessionList.innerHTML = '';

        if (this.sessions.length === 0) {
            sessionList.innerHTML = '<p style="text-align: center; color: #666; padding: 20px;">No chat sessions yet. Upload a PDF to start!</p>';
            return;
        }

        this.sessions.forEach(session => {
            const sessionItem = document.createElement('div');
            sessionItem.className = 'session-item';
            
            // Parse file IDs to count documents
            let fileIds = [];
            try {
                fileIds = JSON.parse(session.file_ids.replace(/'/g, '"'));
            } catch {
                fileIds = [session.file_ids]; // Fallback for single file
            }

            const sessionDate = new Date(session.last_activity).toLocaleDateString();
            
            sessionItem.innerHTML = `
                <div class="session-info">
                    <div class="session-details">
                        <h4>${session.name}</h4>
                        <div class="session-meta">
                            Last active: ${sessionDate} • ${fileIds.length} document(s)
                        </div>
                        <div class="session-documents">
                            ${fileIds.length > 1 ? 'Multi-document session' : 'Single document session'}
                        </div>
                    </div>
                    <div class="session-actions">
                        <button class="btn btn-primary" onclick="app.openSession('${session.id}')">
                            💬 Continue Chat
                        </button>
                        <button class="btn btn-secondary" onclick="app.deleteSession('${session.id}')">
                            🗑️ Delete
                        </button>
                    </div>
                </div>
            `;
            
            sessionList.appendChild(sessionItem);
        });
    }

    async openSession(sessionId) {
        try {
            const session = this.sessions.find(s => s.id === sessionId);
            if (!session) {
                this.showError('Session not found');
                return;
            }

            this.currentSessionId = sessionId;
            
            // Parse file IDs
            let fileIds = [];
            try {
                fileIds = JSON.parse(session.file_ids.replace(/'/g, '"'));
            } catch {
                fileIds = [session.file_ids];
            }
            
            this.currentFileIds = fileIds;

            // Ensure we have metadata for all files before proceeding
            await this.ensureFileMetadata(fileIds);

            // Get filenames for display
            const filenames = fileIds.map(fileId => {
                const file = this.uploadedFiles.find(f => f.file_id === fileId);
                return file ? file.filename : 'Unknown Document';
            });

            await this.showChatSection(filenames, fileIds.length > 1 ? 'multi-doc' : 'single-doc');
            this.clearChat();
            
        } catch (error) {
            console.error('Error opening session:', error);
            this.showError('Failed to open session');
        }
    }

    async showChatSection(filenames, mode) {
        console.log('Showing chat section for:', filenames, 'mode:', mode);

        // Hide main view sections
        document.querySelector('.upload-section').style.display = 'none';
        document.querySelector('.files-section').style.display = 'none';
        document.querySelector('.sessions-section').style.display = 'none';

        // Show chat view
        const chatSection = document.getElementById('chatSection');
        chatSection.style.display = 'flex';

        const currentDocuments = document.getElementById('currentDocuments');
        const sessionMode = document.getElementById('sessionMode');
        
        currentDocuments.textContent = filenames.join(', ');
        sessionMode.textContent = mode === 'multi-doc' ? 'Mode: Multi-Document' : 'Mode: Single Document';
        sessionMode.className = `session-mode ${mode}`;
        
        // Handle PDF loading for different scenarios
        if (this.currentFileIds.length > 0) {
            // For multi-document sessions, try to maintain current selection or load last document
            let pdfToLoad = this.currentFileIds[0]; // Default to first
            
            if (mode === 'multi-doc') {
                // If we have a current PDF and it's still in the session, keep it
                if (this.currentPdf && this.currentFileIds.includes(this.currentPdf)) {
                    pdfToLoad = this.currentPdf;
                } else {
                    // Otherwise, load the last document for multi-doc sessions
                    pdfToLoad = this.currentFileIds[this.currentFileIds.length - 1];
                }
            }
            
            // Show PDF viewer if not visible, but don't auto-load document
            if (!this.isPdfVisible) {
                await this.showPdfViewerOnly();
            }
            
            // Load the selected document
            await this.loadPdf(pdfToLoad);
        }
        
        // Update document selector after PDF is loaded
        this.updateDocumentSelector();
        
        document.getElementById('messageInput').focus();
    }

    async showPdfViewerOnly() {
        const pdfPanel = document.getElementById('pdfPanel');
        const resizer = document.getElementById('resizer');
        const pdfToggleBtn = document.getElementById('pdfToggleBtn');
        const chatContainer = document.getElementById('chatContainer');

        // Show PDF viewer automatically without loading any document
        pdfPanel.style.display = 'flex';
        resizer.style.display = 'block';
        pdfPanel.style.width = '50%';
        chatContainer.style.width = '50%';
        pdfToggleBtn.textContent = '❌ Hide PDF';
        this.isPdfVisible = true;
    }

    async showPdfViewer() {
        await this.showPdfViewerOnly();
        
        // Load first document if available
        if (this.currentFileIds.length > 0) {
            await this.loadPdf(this.currentFileIds[0]);
        }
    }

    updateDocumentSelector() {
        const selector = document.getElementById('documentSelector');
        
        if (!selector) {
            console.error('Document selector not found');
            return;
        }

        selector.innerHTML = '<option value="">Select document...</option>';
        
        console.log('Updating document selector with:', this.currentFileIds);
        console.log('Available files:', this.uploadedFiles);
        
        this.currentFileIds.forEach(fileId => {
            const file = this.uploadedFiles.find(f => f.file_id === fileId);
            console.log(`Looking for file ${fileId}:`, file);
            
            if (file) {
                const option = document.createElement('option');
                option.value = fileId;
                option.textContent = file.filename || `Document ${fileId.substring(0, 8)}`;
                if (fileId === this.currentPdf) {
                    option.selected = true;
                }
                selector.appendChild(option);
                console.log(`Added option: ${option.textContent}`);
            } else {
                // Fallback: create option with partial ID if file not found
                const option = document.createElement('option');
                option.value = fileId;
                option.textContent = `Document ${fileId.substring(0, 8)}...`;
                if (fileId === this.currentPdf) {
                    option.selected = true;
                }
                selector.appendChild(option);
                console.log(`Added fallback option: ${option.textContent}`);
            }
        });

        // Show/hide selector based on document count
        const selectorContainer = selector.parentElement;
        if (this.currentFileIds.length > 1) {
            selectorContainer.style.display = 'flex';
        } else if (this.currentFileIds.length === 1) {
            // For single documents, still show selector but make it clear it's the only document
            selectorContainer.style.display = 'flex';
        } else {
            selectorContainer.style.display = 'none';
        }
        
        console.log(`Document selector updated. ${this.currentFileIds.length} files, visible: ${this.currentFileIds.length >= 1}`);
    }

    async togglePdfViewer() {
        const pdfPanel = document.getElementById('pdfPanel');
        const resizer = document.getElementById('resizer');
        const pdfToggleBtn = document.getElementById('pdfToggleBtn');
        const chatContainer = document.getElementById('chatContainer');

        if (this.isPdfVisible) {
            // Hide PDF viewer
            pdfPanel.style.display = 'none';
            resizer.style.display = 'none';
            chatContainer.style.width = '100%';
            pdfToggleBtn.textContent = '📄 Show PDF';
            this.isPdfVisible = false;
        } else {
            // Show PDF viewer
            pdfPanel.style.display = 'flex';
            resizer.style.display = 'block';
            pdfPanel.style.width = '50%';
            chatContainer.style.width = '50%';
            pdfToggleBtn.textContent = '❌ Hide PDF';
            this.isPdfVisible = true;

            // Load current document or first if none is selected
            if (this.currentFileIds.length > 0) {
                const pdfToLoad = this.currentPdf && this.currentFileIds.includes(this.currentPdf) 
                    ? this.currentPdf 
                    : this.currentFileIds[0];
                await this.loadPdf(pdfToLoad);
            }
        }
    }

    async switchDocument(fileId) {
        if (fileId && this.isPdfVisible && fileId !== this.currentPdf) {
            console.log(`Switching to document: ${fileId}`);
            await this.loadPdf(fileId);
        }
    }

    async loadPdf(fileId) {
        try {
            const pdfUrl = `${this.apiBaseUrl}/files/${fileId}/pdf`;
            console.log('Loading PDF from:', pdfUrl);
            console.log('Current PDF before load:', this.currentPdf);
            console.log('File ID to load:', fileId);

            // Clean up previous PDF document
            if (this.currentPdfDoc) {
                try {
                    this.currentPdfDoc.destroy();
                } catch (e) {
                    console.warn('Error destroying previous PDF:', e);
                }
            }

            // Clear canvas and text layer before loading new PDF
            const canvas = document.getElementById('pdfCanvas');
            const textLayer = document.getElementById('pdfTextLayer');
            if (canvas) {
                const context = canvas.getContext('2d');
                context.clearRect(0, 0, canvas.width, canvas.height);
                canvas.width = 0;
                canvas.height = 0;
            }
            if (textLayer) {
                textLayer.innerHTML = '';
            }

            // Reset scale for new document - will be adjusted in renderPage
            this.scale = 1.0;

            // Load PDF using PDF.js
            const loadingTask = pdfjsLib.getDocument({
                url: pdfUrl,
                cMapUrl: '/static/cmaps/',
                cMapPacked: true,
            });
            this.currentPdfDoc = await loadingTask.promise;
            this.totalPages = this.currentPdfDoc.numPages;
            this.currentPage = 1;
            this.currentPdf = fileId;

            // Update UI
            document.getElementById('totalPages').textContent = this.totalPages;
            document.getElementById('documentSelector').value = fileId;

            // Clear any previous text selection
            this.hideSelectionPopup();

            // Fit to container initially
            await this.fitToContainer();

            console.log(`Successfully loaded PDF: ${fileId}, ${this.totalPages} pages`);

        } catch (error) {
            console.error('Error loading PDF:', error);
            this.showError(`Failed to load PDF: ${error.message}`);
        }
    }

    async renderPage() {
        if (!this.currentPdfDoc) return;

        try {
            const page = await this.currentPdfDoc.getPage(this.currentPage);
            const canvas = document.getElementById('pdfCanvas');
            const context = canvas.getContext('2d');
            const container = document.getElementById('pdfViewerContainer');

            // Get container dimensions
            const containerWidth = container.clientWidth - 30; // Account for padding
            const containerHeight = container.clientHeight - 30;

            // Get page viewport at scale 1
            const baseViewport = page.getViewport({ scale: 1.0 });
            
            // Calculate max scale to fit container
            const maxScaleWidth = containerWidth / baseViewport.width;
            const maxScaleHeight = containerHeight / baseViewport.height;
            const maxScale = Math.min(maxScaleWidth, maxScaleHeight) * 0.9; // 90% of max to leave some margin

            // Limit user scale to reasonable bounds
            const minScale = 0.25;
            const actualMaxScale = Math.max(maxScale * 2, 2.0); // Allow 2x max container size or 200%
            
            // Clamp current scale
            this.scale = Math.max(minScale, Math.min(this.scale, actualMaxScale));

            // Calculate actual viewport
            const viewport = page.getViewport({ scale: this.scale });
            
            // Set canvas dimensions and style
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            canvas.style.width = `${viewport.width}px`;
            canvas.style.height = `${viewport.height}px`;

            const renderContext = {
                canvasContext: context,
                viewport: viewport
            };

            // Render PDF to canvas
            await page.render(renderContext).promise;

            // Wait for canvas to be fully rendered before positioning text layer
            await new Promise(resolve => requestAnimationFrame(resolve));

            // Render text layer for selection - MUST be after canvas rendering
            await this.renderTextLayer(page, viewport);

            // Update page info
            document.getElementById('currentPage').textContent = this.currentPage;
            document.getElementById('zoomLevel').textContent = Math.round(this.scale * 100) + '%';

            // Update navigation buttons
            document.getElementById('prevPageBtn').disabled = this.currentPage <= 1;
            document.getElementById('nextPageBtn').disabled = this.currentPage >= this.totalPages;

            console.log(`Rendered page ${this.currentPage} at scale ${this.scale} (${Math.round(this.scale * 100)}%) - Canvas: ${viewport.width}x${viewport.height}`);

            // Update areas display if in area selection mode
            if (this.isAreaSelectionMode) {
                this.updateAreasDisplay();
            }

        } catch (error) {
            console.error('Error rendering page:', error);
        }
    }

    async renderTextLayer(page, viewport) {
        const textLayerContainer = document.getElementById('pdfTextLayer');
        const canvas = document.getElementById('pdfCanvas');
        
        if (!textLayerContainer || !canvas) {
            console.warn('Text layer container or canvas not found');
            return;
        }
        
        // Clear previous text layer completely
        textLayerContainer.innerHTML = '';
        textLayerContainer.textContent = '';
        
        // Reset all styles to ensure clean state
        textLayerContainer.removeAttribute('style');
        
        // Set text layer to EXACTLY match canvas dimensions and position
        textLayerContainer.style.cssText = `
            position: absolute;
            left: 0px;
            top: 0px;
            width: ${viewport.width}px;
            height: ${viewport.height}px;
            overflow: hidden;
            opacity: 1;
            line-height: 1.0;
            z-index: 2;
            pointer-events: auto;
            user-select: text;
            --scale-factor: ${viewport.scale};
        `;

        try {
            const textContent = await page.getTextContent();
            
            if (!textContent || !textContent.items || textContent.items.length === 0) {
                console.warn('No text content found in PDF page');
                this.createFallbackTextLayer(textLayerContainer, viewport);
                return;
            }
            
            // Create a new textLayerRender using PDF.js API
            const textLayerRenderTask = pdfjsLib.renderTextLayer({
                textContentSource: textContent,
                container: textLayerContainer,
                viewport: viewport,
                textDivs: [],
                isOffscreenCanvasSupported: false,
                enhanceTextSelection: true
            });

            // Wait for text layer to complete rendering
            if (textLayerRenderTask && textLayerRenderTask.promise) {
                await textLayerRenderTask.promise;
            }
            
            // Add a class to enable enhanced text selection
            textLayerContainer.classList.add('enhanceTextSelection');

            console.log(`Text layer successfully rendered with ${textContent.items.length} text items at scale ${viewport.scale}`);
            
        } catch (error) {
            console.error('Text layer rendering failed:', error);
            this.createFallbackTextLayer(textLayerContainer, viewport);
        }

        // Ensure canvas does not interfere with text selection
        canvas.style.pointerEvents = 'none';
    }

    createFallbackTextLayer(container, viewport) {
        // Create a simple selectable div as fallback
        const fallbackDiv = document.createElement('div');
        fallbackDiv.style.position = 'absolute';
        fallbackDiv.style.left = '0';
        fallbackDiv.style.top = '0';
        fallbackDiv.style.width = `${viewport.width}px`;
        fallbackDiv.style.height = `${viewport.height}px`;
        fallbackDiv.style.background = 'transparent';
        fallbackDiv.style.cursor = 'text';
        fallbackDiv.textContent = 'Text selection enabled'; // Invisible but selectable
        fallbackDiv.style.color = 'transparent';
        fallbackDiv.style.userSelect = 'text';
        fallbackDiv.style.fontSize = '12px';
        fallbackDiv.style.lineHeight = '1.2';
        container.appendChild(fallbackDiv);
        console.log('Created fallback text layer');
    }

    handleTextSelection() {
        const selection = window.getSelection();
        const popup = document.getElementById('selectionPopup');
        
        if (!selection.rangeCount || selection.isCollapsed) {
            popup.style.display = 'none';
            return;
        }

        const range = selection.getRangeAt(0);
        const pdfViewerContainer = document.getElementById('pdfViewerContainer');
        const textLayer = document.getElementById('pdfTextLayer');

        // Check if the selection is within the PDF text layer
        if (!textLayer.contains(range.startContainer) && !textLayer.contains(range.endContainer)) {
            popup.style.display = 'none';
            return;
        }

        const rect = range.getBoundingClientRect();
        const containerRect = pdfViewerContainer.getBoundingClientRect();

        // Calculate position relative to the scrollable container
        const scrollTop = pdfViewerContainer.scrollTop;
        const scrollLeft = pdfViewerContainer.scrollLeft;

        // Position popup relative to the container
        const popupLeft = Math.max(10, Math.min(
            rect.left - containerRect.left + scrollLeft,
            containerRect.width - 200 // Prevent popup from going off-screen
        ));
        
        const popupTop = rect.bottom - containerRect.top + scrollTop + 5;

        popup.style.display = 'flex';
        popup.style.left = `${popupLeft}px`;
        popup.style.top = `${popupTop}px`;
        popup.style.position = 'absolute';
        popup.style.zIndex = '1000';
    }

    askAboutSelection() {
        const selection = window.getSelection();
        if (!selection.isCollapsed) {
            const selectedText = selection.toString().trim();
            if (selectedText) {
                const messageInput = document.getElementById('messageInput');
                const responseLanguage = document.getElementById('responseLanguage').value;
                
                // Provide a clear prompt for the LLM with language instruction
                let prompt = `Explain this part from the document: "${selectedText}"`;
                if (responseLanguage !== 'English') {
                    prompt += `\n\n[Please respond in ${responseLanguage}]`;
                }
                
                messageInput.value = prompt;
                this.sendMessage();
            }
        }
        this.hideSelectionPopup();
    }

    async translateSelection() {
        const selection = window.getSelection();
        if (!selection.isCollapsed) {
            const selectedText = selection.toString().trim();
            if (selectedText) {
                try {
                    const responseLanguage = document.getElementById('responseLanguage').value;
                    
                    const response = await fetch(`${this.apiBaseUrl}/api/translate`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ 
                            text: selectedText, 
                            target_language: responseLanguage 
                        })
                    });

                    if (!response.ok) {
                        throw new Error(`Translation failed: ${response.statusText}`);
                    }

                    const result = await response.json();
                    alert(`Original: "${result.original_text}"\nTranslated (${responseLanguage}): "${result.translated_text}"`);

                } catch (error) {
                    console.error('Translation error:', error);
                    this.showError(`Translation failed: ${error.message}`);
                }
            }
        }
        this.hideSelectionPopup();
    }

    hideSelectionPopup() {
        document.getElementById('selectionPopup').style.display = 'none';
        window.getSelection().removeAllRanges();
    }

    async previousPage() {
        if (this.currentPage > 1) {
            this.currentPage--;
            await this.renderPage();
        }
    }

    async nextPage() {
        if (this.currentPage < this.totalPages) {
            this.currentPage++;
            await this.renderPage();
        }
    }

    async zoomIn() {
        if (!this.currentPdfDoc) return;
        this.scale = Math.min(this.scale * 1.2, 3.0);
        await this.renderPage();
    }

    async zoomOut() {
        if (!this.currentPdfDoc) return;
        this.scale = Math.max(this.scale / 1.2, 0.25);
        await this.renderPage();
    }

    async fitToContainer() {
        if (!this.currentPdfDoc) return;

        try {
            const page = await this.currentPdfDoc.getPage(this.currentPage);
            const container = document.getElementById('pdfViewerContainer');
            
            // Get container dimensions
            const containerWidth = container.clientWidth - 30;
            const containerHeight = container.clientHeight - 30;
            
            // Get page dimensions at scale 1
            const baseViewport = page.getViewport({ scale: 1.0 });
            
            // Calculate scale to fit container
            const scaleWidth = containerWidth / baseViewport.width;
            const scaleHeight = containerHeight / baseViewport.height;
            
            // Use the smaller scale to ensure the page fits completely
            this.scale = Math.min(scaleWidth, scaleHeight) * 0.9; // 90% to leave some margin
            
            // Ensure minimum scale
            this.scale = Math.max(this.scale, 0.25);
            
            await this.renderPage();
            
            console.log(`Fitted PDF to container at scale ${this.scale} (${Math.round(this.scale * 100)}%)`);
            
        } catch (error) {
            console.error('Error fitting PDF to container:', error);
            await this.renderPage(); // Fallback to normal render
        }
    }

    toggleSessionsSection() {
        const sessionsSection = document.getElementById('sessionsSection');
        const chatSection = document.getElementById('chatSection');
        
        // If we're in chat view, go back to main page with sessions visible
        if (chatSection && chatSection.style.display !== 'none') {
            this.showUploadSection();
            return;
        }
        
        // Otherwise, toggle sessions section visibility on main page
        if (sessionsSection.style.display === 'none') {
            this.loadExistingSessions();
        } else {
            sessionsSection.style.display = 'none';
        }
    }

    showUploadSection() {
        // Hide chat and sessions sections
        document.getElementById('chatSection').style.display = 'none';
        document.getElementById('sessionsSection').style.display = 'block'; // Show sessions on main page
        
        // Show main page sections
        document.getElementById('uploadSection').style.display = 'block';
        document.getElementById('filesSection').style.display = this.uploadedFiles.length > 0 ? 'block' : 'none';

        // Reset session state
        this.currentSessionId = null;
        this.currentFileIds = [];
    }

    showProgress(show) {
        const uploadProgress = document.getElementById('uploadProgress');
        const uploadArea = document.getElementById('uploadArea');
        
        if (show) {
            uploadProgress.style.display = 'block';
            uploadArea.style.opacity = '0.5';
        } else {
            uploadProgress.style.display = 'none';
            uploadArea.style.opacity = '1';
        }
    }

    updateProgress(percent, message) {
        const progressFill = document.getElementById('progressFill');
        const progressText = document.getElementById('progressText');
        
        progressFill.style.width = percent + '%';
        progressText.textContent = message;
    }

    async sendMessage() {
        const messageInput = document.getElementById('messageInput');
        const responseLanguage = document.getElementById('responseLanguage').value;
        const message = messageInput.value.trim();
        
        if (!message || !this.currentSessionId) {
            if (!this.currentSessionId) {
                this.showError('No active chat session. Please create a session first.');
            }
            return;
        }

        // Add user message
        this.addMessage('user', message);
        messageInput.value = '';

        // Show typing indicator
        this.addTypingIndicator();

        try {
            // Add language instruction to the message if not English
            let enhancedMessage = message;
            
            // Include selected area image if available
            if (this.selectedAreaImage) {
                enhancedMessage = `Question about selected area from PDF:\n\nUser question: ${message}`;
            }
            
            if (responseLanguage !== 'English') {
                enhancedMessage = `${enhancedMessage}\n\n[Please respond in ${responseLanguage}]`;
            }

            const requestBody = { 
                message: enhancedMessage,
                response_language: responseLanguage
            };
            
            // Add image if available
            if (this.selectedAreaImage) {
                requestBody.image = this.selectedAreaImage;
                // Clear the selected area image after using it
                this.selectedAreaImage = null;
                messageInput.placeholder = "Ask a question about your document...";
            }

            const response = await fetch(`${this.apiBaseUrl}/sessions/${this.currentSessionId}/chat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                throw new Error(`Chat failed: ${response.statusText}`);
            }

            const result = await response.json();
            this.removeTypingIndicator();
            
            // Enhanced message with session context
            const contextInfo = result.mode === 'multi-doc' ? 
                `(📑 Multi-doc: ${result.documents_used} docs, ${responseLanguage})` : 
                `(📄 Single doc, ${responseLanguage})`;
            
            this.addMessage('assistant', result.answer, result.sources, contextInfo);

        } catch (error) {
            console.error('Chat error:', error);
            this.removeTypingIndicator();
            this.addMessage('assistant', `❌ Sorry, I encountered an error: ${error.message}`);
        }
    }

    addMessage(type, content, sources = null, contextInfo = '') {
        const chatMessages = document.getElementById('chatMessages');
        const messageDiv = document.createElement('div');
        messageDiv.className = `message message-${type}`;
        
        let sourcesHtml = '';
        if (sources && sources.length > 0) {
            sourcesHtml = `
                <div class="message-sources">
                    📚 Sources: ${sources.length} relevant passages found ${contextInfo}
                </div>
            `;
        } else if (contextInfo) {
            sourcesHtml = `
                <div class="message-sources">
                    ${contextInfo}
                </div>
            `;
        }
        
        messageDiv.innerHTML = `
            <div class="message-bubble">
                ${content.replace(/\n/g, '<br>')}
            </div>
            ${sourcesHtml}
        `;
        
        chatMessages.appendChild(messageDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    addTypingIndicator() {
        const chatMessages = document.getElementById('chatMessages');
        const typingDiv = document.createElement('div');
        typingDiv.className = 'message message-assistant typing-indicator';
        typingDiv.innerHTML = `
            <div class="message-bubble">
                <div class="loading"></div> AI is thinking...
            </div>
        `;
        chatMessages.appendChild(typingDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    removeTypingIndicator() {
        const typingIndicator = document.querySelector('.typing-indicator');
        if (typingIndicator) {
            typingIndicator.remove();
        }
    }

    clearChat() {
        document.getElementById('chatMessages').innerHTML = '';
        const welcomeMsg = this.currentFileIds.length > 1 ? 
            '👋 Hello! I\'m ready to answer questions about your documents. I can analyze multiple documents together and remember our conversation. What would you like to know?' :
            '👋 Hello! I\'m ready to answer questions about your document. I\'ll remember our conversation context. What would you like to know?';
        this.addMessage('assistant', welcomeMsg);
    }

    async deleteSession(sessionId) {
        if (!confirm('Are you sure you want to delete this chat session?')) {
            return;
        }

        try {
            const response = await fetch(`${this.apiBaseUrl}/sessions/${sessionId}`, {
                method: 'DELETE'
            });

            if (response.ok) {
                // Remove from local sessions array
                this.sessions = this.sessions.filter(s => s.id !== sessionId);
                this.updateSessionsList();
                
                // If this was the current session, close it
                if (this.currentSessionId === sessionId) {
                    this.showUploadSection();
                }
                
                alert('Session deleted successfully');
            } else {
                throw new Error('Failed to delete session');
            }
        } catch (error) {
            console.error('Error deleting session:', error);
            this.showError('Failed to delete session');
        }
    }

    async deleteFile(fileId) {
        if (!confirm('Are you sure you want to delete this file? This will also delete any associated chat sessions.')) {
            return;
        }

        try {
            console.log(`Attempting to delete file: ${fileId}`);
            
            const response = await fetch(`${this.apiBaseUrl}/files/${fileId}`, {
                method: 'DELETE'
            });

            console.log(`Delete response status: ${response.status}`);
            
            if (response.ok) {
                console.log('File deletion successful');
                
                // Remove from local files array
                this.uploadedFiles = this.uploadedFiles.filter(f => f.file_id !== fileId);
                
                // If current session uses this file, close it
                if (this.currentFileIds.includes(fileId)) {
                    this.showUploadSection();
                }
                
                this.updateFileList();
                
                // Refresh sessions (some may have been deleted)
                await this.loadExistingSessions();
                
                // Show success message
                this.showSuccess('File deleted successfully');
                
            } else {
                const errorText = await response.text();
                console.error('Delete failed with status:', response.status, errorText);
                throw new Error(`Failed to delete file: ${response.status} ${errorText}`);
            }
        } catch (error) {
            console.error('Error deleting file:', error);
            this.showError(`Failed to delete file: ${error.message}`);
        }
    }

    saveLanguagePreference() {
        const responseLanguage = document.getElementById('responseLanguage').value;
        localStorage.setItem('llm_assistant_language', responseLanguage);
        console.log(`Language preference saved: ${responseLanguage}`);
    }

    loadLanguagePreference() {
        const savedLanguage = localStorage.getItem('llm_assistant_language') || 'English';
        const responseLanguage = document.getElementById('responseLanguage');
        if (responseLanguage) {
            responseLanguage.value = savedLanguage;
            console.log(`Language preference loaded: ${savedLanguage}`);
        }
    }

    showError(message) {
        alert(`❌ Error: ${message}`);
    }

    showSuccess(message) {
        alert(`✅ ${message}`);
    }

    // Area Selection Methods
    toggleAreaSelectionMode() {
        this.isAreaSelectionMode = !this.isAreaSelectionMode;
        const toggleBtn = document.getElementById('toggleAreaSelection');
        const pdfContainer = document.getElementById('pdfContainer');
        const hint = document.querySelector('.area-selection-hint');
        const clearBtn = document.getElementById('clearAreaSelections');
        
        if (this.isAreaSelectionMode) {
            toggleBtn.classList.add('active');
            toggleBtn.textContent = '❌ Cancel Area Selection';
            pdfContainer.classList.add('area-selection-mode');
            if (hint) hint.style.display = 'block';
            if (clearBtn) clearBtn.style.display = 'inline-block';
            
            // Add mouse events for area selection
            this.initializeAreaSelection();
        } else {
            toggleBtn.classList.remove('active');
            toggleBtn.textContent = '🔍 Select Area to Ask Questions';
            pdfContainer.classList.remove('area-selection-mode');
            if (hint) hint.style.display = 'none';
            if (clearBtn) clearBtn.style.display = 'none';
            
            // Remove mouse events
            this.removeAreaSelection();
            
            // Clear any active selection
            this.cancelAreaSelection();
        }
    }

    initializeAreaSelection() {
        const pdfContainer = document.getElementById('pdfContainer');
        
        pdfContainer.addEventListener('mousedown', this.boundStartAreaSelection);
        pdfContainer.addEventListener('mousemove', this.boundUpdateAreaSelection);
        pdfContainer.addEventListener('mouseup', this.boundFinishAreaSelection);
    }

    removeAreaSelection() {
        const pdfContainer = document.getElementById('pdfContainer');
        
        pdfContainer.removeEventListener('mousedown', this.boundStartAreaSelection);
        pdfContainer.removeEventListener('mousemove', this.boundUpdateAreaSelection);
        pdfContainer.removeEventListener('mouseup', this.boundFinishAreaSelection);
    }

    startAreaSelection(e) {
        if (!this.isAreaSelectionMode) return;
        
        const rect = e.target.closest('#pdfContainer').getBoundingClientRect();
        this.areaSelectionStart = {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        };
        
        // Create selection box
        this.currentSelectionBox = document.createElement('div');
        this.currentSelectionBox.className = 'area-selection-box';
        document.getElementById('pdfContainer').appendChild(this.currentSelectionBox);
        
        e.preventDefault();
    }

    updateAreaSelection(e) {
        if (!this.isAreaSelectionMode || !this.areaSelectionStart || !this.currentSelectionBox) return;
        
        const rect = e.target.closest('#pdfContainer').getBoundingClientRect();
        const currentX = e.clientX - rect.left;
        const currentY = e.clientY - rect.top;
        
        const left = Math.min(this.areaSelectionStart.x, currentX);
        const top = Math.min(this.areaSelectionStart.y, currentY);
        const width = Math.abs(currentX - this.areaSelectionStart.x);
        const height = Math.abs(currentY - this.areaSelectionStart.y);
        
        this.currentSelectionBox.style.left = left + 'px';
        this.currentSelectionBox.style.top = top + 'px';
        this.currentSelectionBox.style.width = width + 'px';
        this.currentSelectionBox.style.height = height + 'px';
    }

    finishAreaSelection(e) {
        if (!this.isAreaSelectionMode || !this.areaSelectionStart || !this.currentSelectionBox) return;
        
        const rect = e.target.closest('#pdfContainer').getBoundingClientRect();
        const currentX = e.clientX - rect.left;
        const currentY = e.clientY - rect.top;
        
        const left = Math.min(this.areaSelectionStart.x, currentX);
        const top = Math.min(this.areaSelectionStart.y, currentY);
        const width = Math.abs(currentX - this.areaSelectionStart.x);
        const height = Math.abs(currentY - this.areaSelectionStart.y);
        
        // Only process area if large enough
        if (width > 10 && height > 10) {
            this.selectedAreaCoords = { x: left, y: top, width, height };
            
            // Immediately extract text and prepare for questioning
            this.processSelectedArea();
        } else {
            this.cancelAreaSelection();
        }
    }

    async processSelectedArea() {
        if (!this.selectedAreaCoords || !this.currentPdf) {
            console.error('No area selected or no PDF loaded');
            return;
        }
        
        try {
            // Capture screenshot of selected area
            console.log('Capturing screenshot of selected area:', this.selectedAreaCoords);
            
            const areaScreenshot = await this.captureAreaScreenshot(this.selectedAreaCoords);
            if (areaScreenshot) {
                this.selectedAreaImage = areaScreenshot;
                
                // Save to area memory for reuse
                this.saveAreaToMemory({
                    coordinates: this.selectedAreaCoords,
                    pageNumber: this.currentPageNum,
                    documentId: this.currentPdf,
                    image: areaScreenshot,
                    timestamp: Date.now()
                });
                
                // Show selection in chat and focus input
                this.showSelectedAreaInChat(null, areaScreenshot);
                this.focusMessageInput();
                
                // Clean up selection
                this.cleanupAreaSelection();
                
                // Update area memory display
                this.updateAreaMemoryDisplay();
            } else {
                this.showError('Failed to capture area screenshot');
            }
            
        } catch (error) {
            console.error('Error processing selected area:', error);
            this.showError('Error processing selected area');
        }
    }

    async captureAreaScreenshot(coordinates) {
        try {
            const canvas = document.getElementById('pdfCanvas');
            const rect = canvas.getBoundingClientRect();
            
            // Calculate scale factor between canvas and displayed size
            const scaleX = canvas.width / rect.width;
            const scaleY = canvas.height / rect.height;
            
            // Adjust coordinates for actual canvas size
            const actualCoords = {
                x: coordinates.x * scaleX,
                y: coordinates.y * scaleY,
                width: coordinates.width * scaleX,
                height: coordinates.height * scaleY
            };
            
            // Create a temporary canvas for the cropped area
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = actualCoords.width;
            tempCanvas.height = actualCoords.height;
            const tempCtx = tempCanvas.getContext('2d');
            
            // Draw the selected area from the main canvas
            tempCtx.drawImage(
                canvas,
                actualCoords.x, actualCoords.y, actualCoords.width, actualCoords.height,
                0, 0, actualCoords.width, actualCoords.height
            );
            
            // Convert to base64 image
            return tempCanvas.toDataURL('image/png');
            
        } catch (error) {
            console.error('Error capturing area screenshot:', error);
            return null;
        }
    }

    showSelectedAreaInChat(text, imageData) {
        const messagesContainer = document.getElementById('chatMessages');
        
        // Add a message showing what was selected
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message user-message';
        
        let content = `
            <div class="message-content">
                <div class="selected-area-indicator">
                    📸 <strong>Selected area from page ${this.currentPageNum}:</strong>
                </div>
        `;
        
        if (imageData) {
            content += `
                <div class="selected-image">
                    <img src="${imageData}" style="max-width: 300px; border: 2px solid #667eea; border-radius: 8px; margin: 8px 0;">
                </div>
            `;
        } else if (text) {
            content += `<div class="selected-text">"${text.substring(0, 200)}${text.length > 200 ? '...' : ''}"</div>`;
        }
        
        content += `
                <div class="area-prompt">What would you like to know about this selection?</div>
            </div>
        `;
        
        messageDiv.innerHTML = content;
        messagesContainer.appendChild(messageDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
    
    focusMessageInput() {
        const messageInput = document.getElementById('messageInput');
        if (messageInput) {
            messageInput.focus();
            messageInput.placeholder = "Ask about the selected area...";
        }
    }
    
    cleanupAreaSelection() {
        // Remove selection box
        if (this.currentSelectionBox) {
            this.currentSelectionBox.remove();
            this.currentSelectionBox = null;
        }
        
        // Reset state but keep area selection mode active
        this.areaSelectionStart = null;
        this.selectedAreaCoords = null;
        
        console.log('Area selection cleaned up, ready for next selection');
    }

    // Area Memory Management
    loadAreaMemory() {
        try {
            const stored = localStorage.getItem('areaMemory');
            this.areaMemory = stored ? JSON.parse(stored) : [];
            this.updateAreaMemoryDisplay();
        } catch (error) {
            console.error('Error loading area memory:', error);
            this.areaMemory = [];
        }
    }

    saveAreaToMemory(areaData) {
        // Add unique ID
        areaData.id = `area_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        // Add to beginning of array (most recent first)
        this.areaMemory.unshift(areaData);
        
        // Keep only last 10 areas to prevent storage bloat
        this.areaMemory = this.areaMemory.slice(0, 10);
        
        // Save to localStorage
        try {
            localStorage.setItem('areaMemory', JSON.stringify(this.areaMemory));
        } catch (error) {
            console.error('Error saving area memory:', error);
        }
    }

    updateAreaMemoryDisplay() {
        const hint = document.querySelector('.area-selection-hint');
        if (hint && this.isAreaSelectionMode) {
            if (this.areaMemory.length > 0) {
                hint.innerHTML = `
                    <div style="margin-bottom: 8px;">Drag to select new areas, or click to reuse:</div>
                    <div class="recent-areas">
                        ${this.areaMemory.slice(0, 3).map((area, index) => `
                            <img src="${area.image}" 
                                 class="recent-area-thumbnail" 
                                 data-area-id="${area.id}"
                                 title="Page ${area.pageNumber} - Click to reuse"
                                 style="width: 60px; height: 40px; object-fit: cover; border: 1px solid #ccc; border-radius: 4px; margin-right: 5px; cursor: pointer;">
                        `).join('')}
                        ${this.areaMemory.length > 3 ? `<span style="color: #888; font-size: 0.8em;">+${this.areaMemory.length - 3} more</span>` : ''}
                    </div>
                `;
                
                // Add click handlers for thumbnails
                hint.querySelectorAll('.recent-area-thumbnail').forEach(thumbnail => {
                    thumbnail.addEventListener('click', (e) => {
                        const areaId = e.target.dataset.areaId;
                        this.reuseAreaFromMemory(areaId);
                    });
                });
            } else {
                // Show simple message when no areas are stored
                hint.innerHTML = '<div style="margin-bottom: 8px;">Drag to select text areas, then ask questions about them</div>';
            }
        }
    }

    reuseAreaFromMemory(areaId) {
        const area = this.areaMemory.find(a => a.id === areaId);
        if (area) {
            // Set the selected image and show in chat
            this.selectedAreaImage = area.image;
            this.showSelectedAreaInChat(null, area.image);
            this.focusMessageInput();
            
            console.log(`Reusing area from page ${area.pageNumber}`);
        }
    }

    // UI Layout Management
    toggleChatPanel() {
        const chatContainer = document.getElementById('chatContainer');
        const pdfPanel = document.getElementById('pdfPanel');
        const chatToggle = document.getElementById('chatToggle');
        const resizer = document.getElementById('resizer');
        
        if (chatContainer.classList.contains('minimized')) {
            // Expand chat
            chatContainer.classList.remove('minimized');
            pdfPanel.classList.remove('fullwidth');
            pdfPanel.style.width = '70%';
            chatToggle.textContent = '❌';
            chatToggle.title = 'Minimize Chat';
            if (resizer) resizer.style.display = 'block';
            
            // Remove minimized indicator if exists
            const indicator = document.querySelector('.chat-minimized-indicator');
            if (indicator) indicator.remove();
            
        } else {
            // Minimize chat
            chatContainer.classList.add('minimized');
            pdfPanel.classList.add('fullwidth');
            pdfPanel.style.width = 'calc(100% - 60px)';
            chatToggle.textContent = '💬';
            chatToggle.title = 'Expand Chat';
            if (resizer) resizer.style.display = 'none';
            
            // Add minimized indicator
            const indicator = document.createElement('div');
            indicator.className = 'chat-minimized-indicator';
            indicator.textContent = 'Chat';
            indicator.onclick = () => this.toggleChatPanel();
            document.body.appendChild(indicator);
        }
    }

    selectAreaType(type) {
        console.log('Selecting area type:', type);
        
        // Update tag button selection
        document.querySelectorAll('.tag-button').forEach(btn => {
            btn.classList.remove('selected');
        });
        
        const selectedBtn = document.querySelector(`[data-type="${type}"]`);
        if (selectedBtn) {
            selectedBtn.classList.add('selected');
            this.selectedAreaType = type;
            console.log('Area type set to:', this.selectedAreaType);
            
            // Enable save button
            const saveBtn = document.getElementById('saveAreaBtn');
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.style.opacity = '1';
            }
        } else {
            console.error('Tag button not found for type:', type);
        }
    }

    async saveSelectedArea() {
        if (!this.selectedAreaCoords || !this.selectedAreaType || !this.currentPdf) {
            this.showError('Please select an area and choose a type');
            return;
        }
        
        try {
            const response = await fetch(`${this.apiBaseUrl}/files/${this.currentPdf}/areas`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    area_type: this.selectedAreaType,
                    page_number: this.currentPage,
                    coordinates: this.selectedAreaCoords
                })
            });
            
            if (!response.ok) {
                throw new Error(`Failed to save area: ${response.statusText}`);
            }
            
            const result = await response.json();
            this.showSuccess(`${this.selectedAreaType} area saved successfully!`);
            
            // Refresh areas display
            this.loadDocumentAreas();
            
            // Clean up
            this.cancelAreaSelection();
            
        } catch (error) {
            console.error('Error saving area:', error);
            this.showError(`Failed to save area: ${error.message}`);
        }
    }

    cancelAreaSelection() {
        // Remove current selection box
        if (this.currentSelectionBox) {
            this.currentSelectionBox.remove();
            this.currentSelectionBox = null;
        }
        
        // Remove any lingering selection boxes
        document.querySelectorAll('.area-selection-box').forEach(box => {
            box.remove();
        });
        
        // Hide popup
        const popup = document.getElementById('areaTaggingPopup');
        if (popup) {
            popup.style.display = 'none';
        }
        
        // Reset state
        this.areaSelectionStart = null;
        this.selectedAreaCoords = null;
        this.selectedAreaType = null;
        this.selectedAreaImage = null; // Clear image data
        
        // Reset input placeholder
        const messageInput = document.getElementById('messageInput');
        if (messageInput) {
            messageInput.placeholder = "Ask a question about your document...";
        }
        
        console.log('Area selection cancelled and overlays cleared');
    }

    clearAreaMemory() {
        console.log('Clearing area memory...');
        
        // Clear stored area memory
        this.areaMemory = [];
        
        // Clear localStorage
        try {
            localStorage.removeItem('areaMemory');
            console.log('localStorage cleared');
        } catch (error) {
            console.error('Error clearing localStorage:', error);
        }
        
        // Clear any current selection
        this.selectedAreaImage = null;
        this.selectedAreaCoords = null;
        
        // Reset hint display
        const hint = document.querySelector('.area-selection-hint');
        if (hint && this.isAreaSelectionMode) {
            hint.innerHTML = '<div style="margin-bottom: 8px;">Drag to select new areas</div>';
        }
        
        console.log('Area memory cleared, count:', this.areaMemory.length);
    }

    async loadDocumentAreas() {
        if (!this.currentPdf) return;
        
        try {
            const response = await fetch(`${this.apiBaseUrl}/files/${this.currentPdf}/areas`);
            if (response.ok) {
                const data = await response.json();
                this.documentAreas = data.areas || [];
                this.updateAreasDisplay();
            }
        } catch (error) {
            console.error('Error loading document areas:', error);
        }
    }

    updateAreasDisplay() {
        const savedAreasDiv = document.getElementById('savedAreas');
        savedAreasDiv.innerHTML = '';
        
        const currentPageAreas = this.documentAreas.filter(area => area.page_number === this.currentPage);
        
        if (currentPageAreas.length === 0) {
            savedAreasDiv.innerHTML = '<p style="text-align: center; color: #666; font-size: 0.8rem;">No areas tagged on this page</p>';
            return;
        }
        
        currentPageAreas.forEach(area => {
            const areaItem = document.createElement('div');
            areaItem.className = 'saved-area-item';
            areaItem.innerHTML = `
                <div>
                    <span class="area-type-badge ${area.area_type}">${area.area_type}</span>
                    <span>Page ${area.page_number}</span>
                </div>
                <button class="delete-area" onclick="app.deleteArea('${area.id}')">×</button>
            `;
            savedAreasDiv.appendChild(areaItem);
        });
    }

    async deleteArea(areaId) {
        if (!confirm('Delete this tagged area?')) return;
        
        try {
            const response = await fetch(`${this.apiBaseUrl}/files/${this.currentPdf}/areas/${areaId}`, {
                method: 'DELETE'
            });
            
            if (response.ok) {
                this.showSuccess('Area deleted successfully');
                this.loadDocumentAreas();
            } else {
                throw new Error('Failed to delete area');
            }
        } catch (error) {
            console.error('Error deleting area:', error);
            this.showError('Failed to delete area');
        }
    }
}

// Initialize the app (singleton pattern)
let app;
if (!window.llmAssistantApp) {
    app = new LLMAssistant();
    window.llmAssistantApp = app;
} else {
    app = window.llmAssistantApp;
}

// Add some helpful initial messages when page loads
document.addEventListener('DOMContentLoaded', () => {
    console.log('LLM Learning Assistant with Session Management loaded successfully!');
});