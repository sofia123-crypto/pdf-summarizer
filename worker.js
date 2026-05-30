// Import Transformers.js UMD build from CDN
importScripts('https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/transformers.min.js');

// Configure environment to fetch models only from Hugging Face Hub (no local assets)
const { pipeline, env } = transformers;
env.allowLocalModels = false;

// Pipelines cache
let pipelines = {
    summarization: null,
    translation_fr_en: null,
    translation_en_fr: null
};

// Current loaded model names to detect changes
let currentModels = {
    summarization: '',
    translation_fr_en: 'Xenova/opus-mt-fr-en',
    translation_en_fr: 'Xenova/opus-mt-en-fr'
};

// Listen for messages from the main thread
self.onmessage = async function(e) {
    const { action, text, docLang, summaryLang, summaryLength, modelSpeed } = e.data;

    if (action === 'generate') {
        try {
            log('info', 'Début de la génération du résumé...');
            
            // 1. Determine model selections
            const summarizationModel = modelSpeed === 'fast' ? 'Xenova/t5-small' : 'Xenova/distilbart-cnn-6-6';
            log('info', `Sélection du modèle de résumé : ${summarizationModel}`);

            // 2. Initialize required pipelines
            await getSummarizerPipeline(summarizationModel);
            
            let sourceText = text;
            
            // 3. Translation Pipeline (FR -> EN) if document is French and we summarize in English
            // OR if document is French and we summarize in French (since our summarization models are optimized for English)
            const needsFrToEnTranslation = (docLang === 'fr');
            
            if (needsFrToEnTranslation) {
                log('info', 'Document en français détecté. Initialisation du traducteur FR -> EN...');
                await getTranslationFrEnPipeline();
                
                log('info', 'Traduction du texte source en cours (Français vers Anglais)...');
                sourceText = await translateChunked(sourceText, pipelines.translation_fr_en);
                log('success', 'Traduction source complétée.');
            }

            // 4. Summarization Pipeline
            log('info', 'Génération du résumé en cours (modèle local)...');
            
            // Config limits based on length selection
            let minLength = 30;
            let maxLength = 100;
            if (summaryLength === 'short') {
                minLength = 15;
                maxLength = 50;
            } else if (summaryLength === 'long') {
                minLength = 80;
                maxLength = 200;
            }
            
            let summaryText = await summarizeChunked(sourceText, pipelines.summarization, minLength, maxLength);
            log('success', 'Résumé brut généré.');

            // 5. Translation Pipeline (EN -> FR) if target summary is French
            const needsEnToFrTranslation = (summaryLang === 'fr');
            
            if (needsEnToFrTranslation) {
                log('info', 'Traduction du résumé en cours (Anglais vers Français)...');
                await getTranslationEnFrPipeline();
                
                summaryText = await translateChunked(summaryText, pipelines.translation_en_fr);
                log('success', 'Traduction du résumé complétée.');
            }

            // 6. Send final result
            self.postMessage({
                status: 'complete',
                summary: summaryText,
                sourceWords: countWords(text),
                summaryWords: countWords(summaryText)
            });

        } catch (error) {
            log('error', `Erreur lors de la génération: ${error.message}`);
            self.postMessage({ status: 'error', error: error.message });
        }
    }
};

/* ==========================================================================
   Helper Pipeline Getters (with caching)
   ========================================================================== */
async function getSummarizerPipeline(modelName) {
    if (pipelines.summarization && currentModels.summarization === modelName) {
        return pipelines.summarization;
    }
    
    log('info', `Chargement du modèle de résumé : ${modelName} (cela peut prendre du temps la première fois)...`);
    currentModels.summarization = modelName;
    pipelines.summarization = await pipeline('summarization', modelName, {
        progress_callback: (progressData) => {
            self.postMessage({ status: 'progress', model: modelName, progressData });
        }
    });
    log('success', 'Modèle de résumé chargé avec succès.');
    return pipelines.summarization;
}

async function getTranslationFrEnPipeline() {
    const modelName = currentModels.translation_fr_en;
    if (pipelines.translation_fr_en) return pipelines.translation_fr_en;
    
    log('info', 'Chargement du modèle de traduction FR-EN (Helsinki-NLP)...');
    pipelines.translation_fr_en = await pipeline('translation', modelName, {
        progress_callback: (progressData) => {
            self.postMessage({ status: 'progress', model: modelName, progressData });
        }
    });
    log('success', 'Modèle de traduction FR-EN chargé.');
    return pipelines.translation_fr_en;
}

async function getTranslationEnFrPipeline() {
    const modelName = currentModels.translation_en_fr;
    if (pipelines.translation_en_fr) return pipelines.translation_en_fr;
    
    log('info', 'Chargement du modèle de traduction EN-FR (Helsinki-NLP)...');
    pipelines.translation_en_fr = await pipeline('translation', modelName, {
        progress_callback: (progressData) => {
            self.postMessage({ status: 'progress', model: modelName, progressData });
        }
    });
    log('success', 'Modèle de traduction EN-FR chargé.');
    return pipelines.translation_en_fr;
}

/* ==========================================================================
   Text Chunking Engines for Long Documents
   ========================================================================== */

/**
 * Splits text into chunks of maximum size while trying to respect sentence boundaries.
 */
function chunkText(text, maxChars = 2500) {
    const chunks = [];
    let currentIndex = 0;
    
    while (currentIndex < text.length) {
        // If remaining text is smaller than max size, grab it all
        if (text.length - currentIndex <= maxChars) {
            chunks.push(text.slice(currentIndex));
            break;
        }
        
        // Find best split point (period, exclamation, question mark, or space)
        let splitIndex = currentIndex + maxChars;
        let searchRange = text.slice(currentIndex, splitIndex);
        
        let sentenceBoundary = Math.max(
            searchRange.lastIndexOf('. '),
            searchRange.lastIndexOf('! '),
            searchRange.lastIndexOf('? ')
        );
        
        if (sentenceBoundary !== -1) {
            splitIndex = currentIndex + sentenceBoundary + 2; // Split after the punctuation and space
        } else {
            // Fallback to space
            let lastSpace = searchRange.lastIndexOf(' ');
            if (lastSpace !== -1) {
                splitIndex = currentIndex + lastSpace + 1;
            }
        }
        
        chunks.push(text.slice(currentIndex, splitIndex));
        currentIndex = splitIndex;
    }
    
    return chunks;
}

/**
 * Translates long texts by chunking them to avoid token limits
 */
async function translateChunked(text, translationPipeline) {
    const chunks = chunkText(text, 2000); // 2000 chars is safe for translation models
    let translatedParts = [];
    
    log('info', `Texte divisé en ${chunks.length} section(s) pour la traduction.`);
    
    for (let i = 0; i < chunks.length; i++) {
        log('info', `Traduction de la section ${i + 1}/${chunks.length}...`);
        const output = await translationPipeline(chunks[i]);
        const translatedChunk = output[0].translation_text;
        translatedParts.push(translatedChunk);
    }
    
    return translatedParts.join(' ');
}

/**
 * Summarizes long texts by summarizing chunks and compiling them
 */
async function summarizeChunked(text, summarizationPipeline, minLength, maxLength) {
    const chunks = chunkText(text, 3500); // ~700-800 words per chunk
    let summarizedParts = [];
    
    log('info', `Texte divisé en ${chunks.length} section(s) pour le résumé.`);
    
    for (let i = 0; i < chunks.length; i++) {
        log('info', `Calcul du résumé de la section ${i + 1}/${chunks.length}...`);
        
        // If a single chunk is very small, we can keep it without summarizing
        const chunkWords = countWords(chunks[i]);
        if (chunkWords < minLength * 1.5) {
            summarizedParts.push(chunks[i]);
            continue;
        }

        const output = await summarizationPipeline(chunks[i], {
            min_length: minLength,
            max_length: maxLength,
            no_repeat_ngram_size: 3
        });
        
        summarizedParts.push(output[0].summary_text);
    }
    
    // If we have multiple summarized chunks, let's assemble them.
    // If the assembled summary is still very large and we have more than 3 chunks,
    // we could summarize the summary. For simplicity and readability, compiling is perfect.
    let finalSummary = summarizedParts.join('\n\n');
    
    // If combined result is too long and has multiple paragraphs, we clean up
    if (chunks.length > 2) {
        log('info', "Assemblage et mise en forme des résumés intermédiaires...");
    }
    
    return finalSummary;
}

/* ==========================================================================
   Utilities
   ========================================================================== */
function log(type, message) {
    self.postMessage({ status: 'log', type, message });
}

function countWords(str) {
    if (!str || str.trim() === '') return 0;
    return str.trim().split(/\s+/).length;
}
