// ─── FIX #1: Set PDF.js worker from CDN (matches the library version loaded in index.html)
// Never set this to a local file path; always match the version loaded via <script>.
pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// ─── FIX #2: Detect file:// protocol and warn user
if (location.protocol === 'file:') {
  document.getElementById('cors-warning').classList.remove('hidden');
}

// ══════════════════════════════════════════════
//  DOM refs
// ══════════════════════════════════════════════
const dropzone       = document.getElementById('dropzone');
const fileInput      = document.getElementById('file-input');
const fileInfo       = document.getElementById('file-info');
const fileName       = document.getElementById('file-name');
const fileSize       = document.getElementById('file-size');
const removeFileBtn  = document.getElementById('remove-file-btn');
const apiKeyInput    = document.getElementById('api-key-input');
const docLang        = document.getElementById('doc-lang');
const summaryLang    = document.getElementById('summary-lang');
const summaryLength  = document.getElementById('summary-length');
const modelSelect    = document.getElementById('model-select');
const generateBtn    = document.getElementById('generate-btn');
const btnText        = document.getElementById('btn-text');

const placeholder    = document.getElementById('placeholder');
const resultBlock    = document.getElementById('result-block');
const summaryText    = document.getElementById('summary-text');
const statSrc        = document.getElementById('stat-src');
const statSum        = document.getElementById('stat-sum');
const statRatio      = document.getElementById('stat-ratio');

const copyBtn        = document.getElementById('copy-btn');
const downloadTxt    = document.getElementById('download-txt-btn');
const printPdf       = document.getElementById('print-pdf-btn');

const tabBtns        = document.querySelectorAll('.tab');
const tabPanels      = document.querySelectorAll('.tab-panel');
const logOutput      = document.getElementById('log-output');
const clearLogBtn    = document.getElementById('clear-log-btn');

// ══════════════════════════════════════════════
//  State
// ══════════════════════════════════════════════
let currentFile = null;

// ══════════════════════════════════════════════
//  Logging
// ══════════════════════════════════════════════
function log(msg, type = 'info') {
  const now = new Date().toLocaleTimeString('fr-FR');
  const div = document.createElement('div');
  div.className = `log-line ${type}`;
  div.textContent = `[${now}] ${msg}`;
  logOutput.appendChild(div);
  logOutput.scrollTop = logOutput.scrollHeight;
}

clearLogBtn.addEventListener('click', () => {
  logOutput.innerHTML = '';
  log('Console effacée.', 'sys');
});

// ══════════════════════════════════════════════
//  Tab switching
// ══════════════════════════════════════════════
tabBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    tabBtns.forEach(b => b.classList.remove('active'));
    tabPanels.forEach(p => { p.classList.add('hidden'); p.classList.remove('active'); });
    btn.classList.add('active');
    const target = document.getElementById(btn.dataset.tab);
    target.classList.remove('hidden');
    target.classList.add('active');
  });
});

// ══════════════════════════════════════════════
//  File handling
// ══════════════════════════════════════════════
function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' o';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' Ko';
  return (bytes / 1048576).toFixed(1) + ' Mo';
}

function setFile(file) {
  if (!file || file.type !== 'application/pdf') {
    log('Fichier ignoré : ce n\'est pas un PDF.', 'warn');
    return;
  }
  currentFile = file;
  fileName.textContent = file.name;
  fileSize.textContent = formatBytes(file.size);
  fileInfo.classList.remove('hidden');
  dropzone.classList.add('has-file');
  checkReady();
  log(`Fichier chargé : ${file.name} (${formatBytes(file.size)})`, 'success');
}

removeFileBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  currentFile = null;
  fileInput.value = '';
  fileInfo.classList.add('hidden');
  dropzone.classList.remove('has-file');
  checkReady();
  log('Fichier retiré.', 'sys');
});

fileInput.addEventListener('change', () => setFile(fileInput.files[0]));

dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('drag-over'); });
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
dropzone.addEventListener('drop', e => {
  e.preventDefault();
  dropzone.classList.remove('drag-over');
  setFile(e.dataTransfer.files[0]);
});

// ══════════════════════════════════════════════
//  Enable/disable generate button
// ══════════════════════════════════════════════
function checkReady() {
  generateBtn.disabled = !(currentFile && apiKeyInput.value.trim().startsWith('gsk_'));
}
apiKeyInput.addEventListener('input', checkReady);

// ══════════════════════════════════════════════
//  PDF text extraction (FIX #3: proper async, ArrayBuffer)
// ══════════════════════════════════════════════
async function extractTextFromPDF(file) {
  log('Extraction du texte depuis le PDF…', 'info');
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  log(`PDF chargé : ${pdf.numPages} page(s).`, 'info');

  let fullText = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map(item => item.str).join(' ');
    fullText += pageText + '\n';
  }
  return fullText.trim();
}

// ══════════════════════════════════════════════
//  FIX #4: Text chunking for long documents
//  distilbart / llama context limits ≈ 4000 tokens ≈ 3000 words
//  We chunk at 2500 words to be safe.
// ══════════════════════════════════════════════
const CHUNK_WORD_LIMIT = 2500;

function chunkText(text, maxWords = CHUNK_WORD_LIMIT) {
  const words = text.split(/\s+/);
  const chunks = [];
  for (let i = 0; i < words.length; i += maxWords) {
    chunks.push(words.slice(i, i + maxWords).join(' '));
  }
  return chunks;
}

// ══════════════════════════════════════════════
//  FIX #5: Use Groq API (cloud, free tier) instead of broken local ONNX models
// ══════════════════════════════════════════════
async function callGroq(prompt, apiKey, model) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 1024,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Groq error ${res.status}`);
  }
  const data = await res.json();
  return data.choices[0].message.content.trim();
}

// ══════════════════════════════════════════════
//  Build summarization prompt
// ══════════════════════════════════════════════
function buildPrompt(text, srcLang, tgtLang, length) {
  const lengthMap = {
    short: '2 to 3 sentences',
    medium: '5 to 6 sentences',
    long: 'a detailed paragraph of 10 or more sentences',
  };

  const srcNote = srcLang === 'auto'
    ? 'The source text may be in any language.'
    : `The source text is in ${srcLang === 'fr' ? 'French' : 'English'}.`;

  const tgtNote = tgtLang === 'fr'
    ? 'Write the summary in French.'
    : 'Write the summary in English.';

  return `You are an expert document summarizer.
${srcNote}
${tgtNote}
Length: ${lengthMap[length]}.
Be factual, clear, and concise. Do not add commentary or opinions.
Summarize the following text:

${text}`;
}

// ══════════════════════════════════════════════
//  Main generation flow
// ══════════════════════════════════════════════
generateBtn.addEventListener('click', async () => {
  if (!currentFile) return;

  const apiKey = apiKeyInput.value.trim();
  if (!apiKey.startsWith('gsk_')) {
    log('Clé API Groq invalide. Elle doit commencer par gsk_.', 'error');
    return;
  }

  const model  = modelSelect.value;
  const srcLang = docLang.value;
  const tgtLang = summaryLang.value;
  const length  = summaryLength.value;

  // Switch to console tab to show progress
  tabBtns.forEach(b => b.classList.remove('active'));
  tabPanels.forEach(p => { p.classList.add('hidden'); p.classList.remove('active'); });
  document.querySelector('[data-tab="tab-log"]').classList.add('active');
  document.getElementById('tab-log').classList.remove('hidden');
  document.getElementById('tab-log').classList.add('active');

  generateBtn.disabled = true;
  btnText.textContent = 'Génération en cours…';

  try {
    // 1. Extract text
    const rawText = await extractTextFromPDF(currentFile);
    const wordCount = rawText.split(/\s+/).length;
    log(`Texte extrait : ${wordCount} mots.`, 'success');

    if (wordCount < 20) {
      throw new Error('Le PDF semble vide ou contient uniquement des images (pas de texte extractible).');
    }

    // 2. Chunk if needed (FIX #4)
    const chunks = chunkText(rawText, CHUNK_WORD_LIMIT);
    log(`Découpage : ${chunks.length} bloc(s) de max ${CHUNK_WORD_LIMIT} mots.`, 'info');

    // 3. Summarize each chunk, then merge if multiple
    let finalSummary;

    if (chunks.length === 1) {
      log(`Envoi au modèle ${model}…`, 'info');
      finalSummary = await callGroq(buildPrompt(chunks[0], srcLang, tgtLang, length), apiKey, model);
    } else {
      // Summarize each chunk
      const partials = [];
      for (let i = 0; i < chunks.length; i++) {
        log(`Résumé du bloc ${i + 1}/${chunks.length}…`, 'info');
        const partial = await callGroq(buildPrompt(chunks[i], srcLang, tgtLang, 'short'), apiKey, model);
        partials.push(partial);
      }
      // Merge partial summaries into final
      log('Fusion des résumés partiels…', 'info');
      const mergePrompt = buildPrompt(partials.join('\n\n'), srcLang, tgtLang, length);
      finalSummary = await callGroq(mergePrompt, apiKey, model);
    }

    log('Résumé généré avec succès !', 'success');

    // 4. Display result
    const summaryWords = finalSummary.split(/\s+/).length;
    const ratio = wordCount > 0 ? Math.round((1 - summaryWords / wordCount) * 100) : 0;

    statSrc.textContent   = `${wordCount.toLocaleString('fr-FR')} mots`;
    statSum.textContent   = `${summaryWords} mots`;
    statRatio.textContent = `${ratio} %`;
    summaryText.textContent = finalSummary;

    placeholder.classList.add('hidden');
    resultBlock.classList.remove('hidden');

    // Switch to result tab
    tabBtns.forEach(b => b.classList.remove('active'));
    tabPanels.forEach(p => { p.classList.add('hidden'); p.classList.remove('active'); });
    document.querySelector('[data-tab="tab-result"]').classList.add('active');
    document.getElementById('tab-result').classList.remove('hidden');
    document.getElementById('tab-result').classList.add('active');

  } catch (err) {
    log(`Erreur : ${err.message}`, 'error');
    console.error(err);
  } finally {
    generateBtn.disabled = false;
    btnText.textContent = 'Générer le résumé';
    checkReady();
  }
});

// ══════════════════════════════════════════════
//  Export actions
// ══════════════════════════════════════════════
copyBtn.addEventListener('click', async () => {
  const text = summaryText.textContent;
  try {
    await navigator.clipboard.writeText(text);
    copyBtn.innerHTML = '<i class="fa-solid fa-check"></i> Copié !';
    setTimeout(() => { copyBtn.innerHTML = '<i class="fa-solid fa-copy"></i> Copier'; }, 2000);
  } catch {
    log('Impossible d\'accéder au presse-papiers.', 'warn');
  }
});

downloadTxt.addEventListener('click', () => {
  const text = summaryText.textContent;
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'resume.txt';
  a.click();
  URL.revokeObjectURL(a.href);
});

printPdf.addEventListener('click', () => {
  window.print();
});
