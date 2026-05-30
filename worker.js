self.onmessage = async function(e) {
    const { action, text, docLang, summaryLang, summaryLength, apiKey } = e.data;

    if (action === 'generate') {
        try {
            log('info', 'Envoi du texte à Groq API...');

            const lengthInstruction = summaryLength === 'short' 
                ? 'un résumé court (5-8 phrases)' 
                : summaryLength === 'long' 
                ? 'un résumé détaillé (20-30 phrases)' 
                : 'un résumé moyen (10-15 phrases)';

            const langInstruction = summaryLang === 'fr' 
                ? 'Réponds en français.' 
                : 'Reply in English.';

            const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                    model: 'llama3-8b-8192',
                    max_tokens: 1024,
                    messages: [
                        {
                            role: 'system',
                            content: `Tu es un assistant spécialisé dans la synthèse de documents. ${langInstruction}`
                        },
                        {
                            role: 'user',
                            content: `Fais ${lengthInstruction} du document suivant.\n\nDocument:\n${text.slice(0, 15000)}`
                        }
                    ]
                })
            });

            const data = await response.json();

            if (data.error) throw new Error(data.error.message);

            const summary = data.choices[0].message.content;

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
