self.onmessage = async function(e) {
    const { action, text, docLang, summaryLang, summaryLength, apiKey } = e.data;

    if (action === 'generate') {
        try {
            log('info', 'Envoi du texte à Claude API...');

            const lengthInstruction = summaryLength === 'short' 
                ? 'un résumé court (5-8 phrases)' 
                : summaryLength === 'long' 
                ? 'un résumé détaillé (20-30 phrases)' 
                : 'un résumé moyen (10-15 phrases)';

            const langInstruction = summaryLang === 'fr' 
                ? 'Réponds en français.' 
                : 'Reply in English.';

            const response = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': apiKey,
                    'anthropic-version': '2023-06-01',
                    'anthropic-dangerous-direct-browser-access': 'true'
                },
                body: JSON.stringify({
                    model: 'claude-haiku-4-5-20251001',
                    max_tokens: 1024,
                    messages: [{
                        role: 'user',
                        content: `Fais ${lengthInstruction} du document suivant. ${langInstruction}\n\nDocument:\n${text.slice(0, 15000)}`
                    }]
                })
            });

            const data = await response.json();

            if (data.error) throw new Error(data.error.message);

            const summary = data.content[0].text;

            self.postMessage({
                status: 'complete',
                summary,
                sourceWords: countWords(text),
                summaryWords: countWords(summary)
            });

        } catch (error) {
            log('error', `Erreur: ${error.message}`);
            self.postMessage({ status: 'error', error: error.message });
        }
    }
};

function log(type, message) {
    self.postMessage({ status: 'log', type, message });
}

function countWords(str) {
    if (!str || str.trim() === '') return 0;
    return str.trim().split(/\s+/).length;
}
