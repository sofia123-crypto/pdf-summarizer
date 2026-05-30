// Configure PDF.js Worker
pdfjsLib.GlobalWorkerOptions.workerSrc = 'pdf.worker.min.js';

// Application State
let appState = {
    extractedText: '',
    fileName: '',
    fileSize: '',
    worker: null,
    isProcessing: false,
    downloads: {} // Track downloading files by key
};

// UI Elements
const elements = {
    dropzone: document.getElementById('dropzone'),
    fileInput: document.getElementById('file-input'),
    fileInfo: document.getElementById('file-info'),
    fileName: document.getElementById('file-name'),
    fileSize: document.getElementById('file-size'),
    removeFileBtn: document.getElementById('remove-file-btn'),
    docLang: document.getElementById('doc-lang'),
    summaryLang: document.getElementById('summary-lang'),
    summaryLength: document.getElementById('summary-length'),
    modelSpeed: document.getElementById('model-speed'),
    generateBtn: document.getElementById('generate-btn'),
    btnText: document.getElementById('btn-text'),
    tabBtns: document.querySelectorAll('.tab-btn'),
    tabPanels: document.querySelectorAll('.tab-panel'),
    summaryPlaceholder: document.getElementById('summary-placeholder'),
    summaryResultContainer: document.getElementById('summary-result-container'),
    summaryText: document.getElementById('summary-text'),
    statSourceWords: document.getElementById('stat-source-words'),
    statSummaryWords: document.getElementById('stat-summary-words'),
    statCompression: document.getElementById('stat-compression'),
    copyBtn: document.getElementById('copy-btn'),
    downloadTxtBtn: document.getElementById('download-txt-btn'),
    printPdfBtn: document.getElementById('print-pdf-btn'),
    consoleLog: document.getElementById('console-log'),
    clearConsoleBtn: document.getElementById('clear-console-btn'),
    downloadsList: document.getElementById('downloads-list')
};

// Initialize Application
function init() {
    setupEventListeners();
    
    // Check if opened via file:// protocol
    if (window.location.protocol === 'file:') {
        const corsWarning = document.getElementById('cors-warning');
        if (corsWarning) corsWarning.classList.remove('hidden');
        writeLog('warning', 'L\'application est ouverte via le protocole file://. Les restrictions CORS du navigateur peuvent bloquer l\'exécution du Web Worker.');
    }
    
    initWorker();
    writeLog('system', 'SummaPDF est prêt. Veuillez charger un document PDF.');
}

// Initialize Web Worker
function initWorker() {
    if (appState.worker) {
        appState.worker.terminate();
    }
    
    appState.worker = new Worker('worker.js', { type: 'module' });
    
    appState.worker.onmessage = function(e) {
        const { status, type, message, model, progressData, summary, sourceWords, summaryWords, error } = e.data;
        
        switch (status) {
            case 'log':
                writeLog(type, message);
                break;
                
            case 'progress':
                handleDownloadProgress(model, progressData);
                break;
                
            case 'complete':
                handleGenerationComplete(summary, sourceWords, summaryWords);
                break;
                
            case 'error':
                handleGenerationError(error);
                break;
        }
    };
    
    appState.worker.onerror = function(err) {
        writeLog('error', `Erreur critique du Worker: ${err.message}`);
        handleGenerationError(err.message);
    };
}

/* ==========================================================================
   Event Listeners
   ========================================================================== */
function setupEventListeners() {
    // File Input selection
    elements.fileInput.addEventListener('change', handleFileSelect);
    
    // Drag & Drop
    ['dragenter', 'dragover'].forEach(eventName => {
        elements.dropzone.addEventListener(eventName, (e) => {
            e.preventDefault();
            elements.dropzone.classList.add('dragover');
        }, false);
    });
    
    ['dragleave', 'drop'].forEach(eventName => {
        elements.dropzone.addEventListener(eventName, (e) => {
            e.preventDefault();
            elements.dropzone.classList.remove('dragover');
        }, false);
    });
    
    elements.dropzone.addEventListener('drop', handleFileDrop);
    
    // Remove File
    elements.removeFileBtn.addEventListener('click', resetFile);
    
    // Generate Button
    elements.generateBtn.addEventListener('click', startGeneration);
    
    // Tab switching
    elements.tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const tabId = btn.getAttribute('data-tab');
            switchTab(tabId);
        });
    });
    
    // Console actions
    elements.clearConsoleBtn.addEventListener('click', () => {
        elements.consoleLog.innerHTML = '';
        writeLog('system', 'Console effacée.');
    });
    
    // Summary Actions
    elements.copyBtn.addEventListener('click', copySummaryToClipboard);
    elements.downloadTxtBtn.addEventListener('click', downloadSummaryAsTxt);
    elements.printPdfBtn.addEventListener('click', exportSummaryAsPdf);
}

/* ==========================================================================
   File Handling & PDF Text Extraction
   ========================================================================== */
function handleFileDrop(e) {
    const dt = e.dataTransfer;
    const files = dt.files;
    if (files.length > 0) {
        processSelectedFile(files[0]);
    }
}

function handleFileSelect(e) {
    const files = e.target.files;
    if (files.length > 0) {
        processSelectedFile(files[0]);
    }
}

function processSelectedFile(file) {
    if (file.type !== 'application/pdf') {
        writeLog('error', `Type de fichier non supporté : ${file.type}. Veuillez utiliser un document PDF.`);
        alert('Veuillez sélectionner un fichier PDF valide.');
        return;
    }
    
    appState.fileName = file.name;
    appState.fileSize = formatBytes(file.size);
    
    elements.fileName.textContent = appState.fileName;
    elements.fileSize.textContent = appState.fileSize;
    
    elements.dropzone.classList.add('hidden');
    elements.fileInfo.classList.remove('hidden');
    
    writeLog('info', `Fichier chargé : ${appState.fileName} (${appState.fileSize})`);
    extractTextFromPDF(file);
}

function resetFile() {
    appState.extractedText = '';
    appState.fileName = '';
    appState.fileSize = '';
    
    elements.fileInput.value = '';
    elements.dropzone.classList.remove('hidden');
    elements.fileInfo.classList.add('hidden');
    elements.generateBtn.disabled = true;
    
    // Hide results if showing
    elements.summaryPlaceholder.classList.remove('hidden');
    elements.summaryResultContainer.classList.add('hidden');
    
    writeLog('system', 'Fichier retiré. En attente d\'un nouveau document PDF...');
}

async function extractTextFromPDF(file) {
    writeLog('info', 'Extraction du texte du fichier PDF...');
    elements.generateBtn.disabled = true;
    
    const fileReader = new FileReader();
    
    fileReader.onload = async function() {
        try {
            const typedarray = new Uint8Array(this.result);
            const pdf = await pdfjsLib.getDocument(typedarray).promise;
            
            writeLog('success', `PDF analysé avec succès. Nombre de pages : ${pdf.numPages}`);
            
            let fullText = '';
            
            for (let i = 1; i <= pdf.numPages; i++) {
                writeLog('system', `Lecture de la page ${i}/${pdf.numPages}...`);
                const page = await pdf.getPage(i);
                const textContent = await page.getTextContent();
                const pageText = textContent.items.map(item => item.str).join(' ');
                fullText += pageText + '\n\n';
            }
            
            appState.extractedText = fullText.trim();
            const wordCount = countWords(appState.extractedText);
            
            writeLog('success', `Extraction terminée. Total : ${wordCount} mots trouvés.`);
            
            if (wordCount < 10) {
                writeLog('warning', 'Le document extrait contient très peu de texte. Vérifiez s\'il s\'agit d\'un document scanné (image).');
            }
            
            elements.generateBtn.disabled = false;
            
        } catch (error) {
            writeLog('error', `Erreur lors de l'extraction du texte: ${error.message}`);
            alert('Impossible de lire le texte de ce fichier PDF. Il se peut qu\'il soit protégé ou corrompu.');
        }
    };
    
    fileReader.onerror = function() {
        writeLog('error', 'Erreur de lecture du fichier.');
    };
    
    fileReader.readAsArrayBuffer(file);
}

/* ==========================================================================
   UI / Tab / Console Controls
   ========================================================================== */
function switchTab(tabId) {
    elements.tabBtns.forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-tab') === tabId);
    });
    
    elements.tabPanels.forEach(panel => {
        panel.classList.toggle('active', panel.id === tabId);
    });
}

function writeLog(type, message) {
    const timestamp = new Date().toLocaleTimeString();
    const line = document.createElement('div');
    line.className = `console-line ${type}`;
    
    const timeSpan = document.createElement('span');
    timeSpan.className = 'timestamp';
    timeSpan.textContent = `[${timestamp}]`;
    
    const textNode = document.createTextNode(` ${message}`);
    
    line.appendChild(timeSpan);
    line.appendChild(textNode);
    elements.consoleLog.appendChild(line);
    
    // Autoscroll
    elements.consoleLog.scrollTop = elements.consoleLog.scrollHeight;
}

/* ==========================================================================
   Transformers.js Model Download Handlers
   ========================================================================== */
function handleDownloadProgress(modelName, progressData) {
    const { status, file, progress, loaded, total } = progressData;
    
    // We only care about progress events for files
    if (status !== 'progress' && status !== 'done' && status !== 'ready') return;
    
    // Unique ID for the file progress card
    const cardId = `model-file-${file.replace(/[^a-zA-Z0-9]/g, '-')}`;
    let card = document.getElementById(cardId);
    
    // Remove "no downloads" text
    const noDownloads = elements.downloadsList.querySelector('.no-downloads');
    if (noDownloads) noDownloads.remove();
    
    if (status === 'done' || progress === 100) {
        if (card) card.remove();
        delete appState.downloads[file];
        return;
    }
    
    // Format model display name for readability
    const shortModelName = modelName.split('/')[1] || modelName;
    const shortFileName = file.split('/').pop();
    
    if (!card) {
        card = document.createElement('div');
        card.id = cardId;
        card.className = 'model-progress-card';
        card.innerHTML = `
            <div class="model-info-row">
                <span class="model-name-label">${shortModelName} • ${shortFileName}</span>
                <span class="model-percentage">0%</span>
            </div>
            <div class="model-progress-bar-container">
                <div class="model-progress-bar"></div>
            </div>
            <div class="model-bytes">0 / 0 MB</div>
        `;
        elements.downloadsList.appendChild(card);
    }
    
    appState.downloads[file] = { loaded, total };
    
    // Update progress values
    const percent = progress.toFixed(1);
    card.querySelector('.model-progress-bar').style.width = `${percent}%`;
    card.querySelector('.model-percentage').textContent = `${percent}%`;
    card.querySelector('.model-bytes').textContent = `${(loaded / 1024 / 1024).toFixed(1)} / ${(total / 1024 / 1024).toFixed(1)} Mo`;
}

/* ==========================================================================
   Generation Actions & Pipelines
   ========================================================================== */
function startGeneration() {
    if (appState.isProcessing || !appState.extractedText) return;
    const apiKey = document.getElementById('api-key-input').value.trim();
    if (!apiKey) {
        alert('Veuillez entrer votre clé API Anthropic.');
        return;
    appState.isProcessing = true;
    elements.generateBtn.disabled = true;
    elements.removeFileBtn.disabled = true;
    elements.btnText.textContent = 'Calcul en cours...';
    elements.generateBtn.querySelector('i').className = 'fa-solid fa-spinner fa-spin';
    
    // Clear download indicator list (fresh run)
    elements.downloadsList.innerHTML = '';
    
    // Switch to console to view progress
    switchTab('console-tab');
    
    // Prepare configurations
    const docLang = elements.docLang.value;
    const summaryLang = elements.summaryLang.value;
    const summaryLength = elements.summaryLength.value;
    const modelSpeed = elements.modelSpeed.value;
    
    // Trigger worker
    appState.worker.postMessage({
        action: 'generate',
        text: appState.extractedText,
        docLang,
        summaryLang,
        summaryLength,
        modelSpeed,
        apikey
    });
}

function handleGenerationComplete(summary, sourceWords, summaryWords) {
    appState.isProcessing = false;
    elements.generateBtn.disabled = false;
    elements.removeFileBtn.disabled = false;
    elements.btnText.textContent = 'Générer le Résumé';
    elements.generateBtn.querySelector('i').className = 'fa-solid fa-wand-magic-sparkles';
    
    // Display results
    elements.summaryText.innerHTML = formatMarkdown(summary);
    
    // Calculate stats
    elements.statSourceWords.textContent = `${sourceWords} mots`;
    elements.statSummaryWords.textContent = `${summaryWords} mots`;
    
    const compressionRatio = Math.max(0, 100 - Math.round((summaryWords / sourceWords) * 100));
    elements.statCompression.textContent = `${compressionRatio}%`;
    
    // Show results section
    elements.summaryPlaceholder.classList.add('hidden');
    elements.summaryResultContainer.classList.remove('hidden');
    
    // Switch back to summary display tab
    switchTab('result-tab');
    
    writeLog('success', 'Félicitations ! Résumé généré et affiché.');
}

function handleGenerationError(errMessage) {
    appState.isProcessing = false;
    elements.generateBtn.disabled = false;
    elements.removeFileBtn.disabled = false;
    elements.btnText.textContent = 'Générer le Résumé';
    elements.generateBtn.querySelector('i').className = 'fa-solid fa-wand-magic-sparkles';
    
    alert(`Erreur lors de la génération: ${errMessage}`);
}

/* ==========================================================================
   Output Actions
   ========================================================================== */
function copySummaryToClipboard() {
    const text = elements.summaryText.innerText;
    navigator.clipboard.writeText(text).then(() => {
        elements.copyBtn.innerHTML = '<i class="fa-solid fa-check"></i> Copié !';
        setTimeout(() => {
            elements.copyBtn.innerHTML = '<i class="fa-solid fa-copy"></i> Copier';
        }, 2000);
    }).catch(err => {
        writeLog('error', `Erreur lors de la copie: ${err}`);
    });
}

function downloadSummaryAsTxt() {
    const text = elements.summaryText.innerText;
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement('a');
    link.href = url;
    
    // Custom name e.g. document_resume.txt
    const baseName = appState.fileName.substring(0, appState.fileName.lastIndexOf('.')) || appState.fileName;
    link.download = `${baseName}_resume.txt`;
    
    document.body.appendChild(link);
    link.click();
    
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

function exportSummaryAsPdf() {
    const text = elements.summaryText.innerText;
    const baseName = appState.fileName.substring(0, appState.fileName.lastIndexOf('.')) || appState.fileName;
    
    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>${baseName} - Résumé</title>
            <style>
                body {
                    font-family: 'Outfit', 'Helvetica Neue', Arial, sans-serif;
                    padding: 50px;
                    color: #1f2937;
                    line-height: 1.8;
                    max-width: 800px;
                    margin: 0 auto;
                }
                .header {
                    border-bottom: 2px solid #374151;
                    padding-bottom: 15px;
                    margin-bottom: 30px;
                }
                h1 {
                    font-size: 26px;
                    margin: 0 0 10px 0;
                    color: #111827;
                }
                .meta {
                    color: #6b7280;
                    font-size: 13px;
                    font-weight: 500;
                }
                .content {
                    font-size: 15px;
                    white-space: pre-line;
                    text-align: justify;
                }
                .footer {
                    margin-top: 50px;
                    border-top: 1px solid #e5e7eb;
                    padding-top: 15px;
                    font-size: 12px;
                    color: #9ca3af;
                    text-align: center;
                }
            </style>
        </head>
        <body>
            <div class="header">
                <h1>Résumé : ${appState.fileName}</h1>
                <div class="meta">Généré localement le ${new Date().toLocaleDateString('fr-FR')} par SummaPDF</div>
            </div>
            <div class="content">${text}</div>
            <div class="footer">
                Projet Académique PDF Summarizer - Réalisé par Soufia Bahrini (2EAN)
            </div>
            <script>
                window.onload = function() {
                    window.print();
                    setTimeout(function() { window.close(); }, 500);
                }
            </script>
        </body>
        </html>
    `);
    printWindow.document.close();
}

/* ==========================================================================
   Utility Helpers
   ========================================================================== */
function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'Ko', 'Mo', 'Go', 'To'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function countWords(str) {
    if (!str || str.trim() === '') return 0;
    return str.trim().split(/\s+/).length;
}

/**
 * Very basic formatter to display linebreaks and lists in HTML
 */
function formatMarkdown(text) {
    // Escaping HTML characters
    let html = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    
    // Line breaks to paragraphs
    html = html.split('\n\n').map(p => {
        // Bullet points
        if (p.trim().startsWith('- ') || p.trim().startsWith('* ')) {
            const listItems = p.split(/\n[\-\*]\s+/).map(item => {
                // remove leading dash if present
                const clean = item.replace(/^[\-\*]\s+/, '').trim();
                return `<li>${clean}</li>`;
            }).join('');
            return `<ul>${listItems}</ul>`;
        }
        
        return `<p>${p.trim()}</p>`;
    }).join('');
    
    return html;
}

// Start
window.onload = init;
