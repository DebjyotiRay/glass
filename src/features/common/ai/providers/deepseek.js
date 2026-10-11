const OpenAI = require('openai');

class DeepSeekProvider {
    static async validateApiKey(key = process.env.DEEPSEEK_API_KEY) {
        if (!key || typeof key !== 'string' || !key.startsWith('sk-')) {
            return { success: false, error: 'Invalid DeepSeek API key format.' };
        }

        try {
            const response = await fetch('https://api.deepseek.com/models', {
                headers: { 'Authorization': `Bearer ${key}` }
            });

            if (response.ok) {
                return { success: true };
            } else {
                const errorData = await response.json().catch(() => ({}));
                const message = errorData.error?.message || `Validation failed with status: ${response.status}`;
                return { success: false, error: message };
            }
        } catch (error) {
            console.error(`[DeepSeekProvider] Network error during key validation:`, error);
            return { success: false, error: 'A network error occurred during validation.' };
        }
    }
}

/**
 * Creates a DeepSeek STT session placeholder
 */
async function createSTT({ apiKey = process.env.DEEPSEEK_API_KEY, language = 'en', callbacks = {}, ...config }) {
    console.warn("[DeepSeek] STT not supported. DeepSeek provides LLM services.");
    return {
        sendRealtimeInput: async () => {},
        close: async () => {}
    };
}

/**
 * Creates a DeepSeek LLM instance
 * @param {object} opts - Configuration options
 * @param {string} opts.apiKey - DeepSeek API key
 * @param {string} [opts.model='deepseek-chat'] - Model name ('deepseek-chat' or 'deepseek-reasoner')
 * @param {number} [opts.temperature=0.7] - Temperature
 * @param {number} [opts.maxTokens=2048] - Max tokens
 * @returns {object} LLM instance
 */
function createLLM({ apiKey = process.env.DEEPSEEK_API_KEY, model = 'deepseek-chat', temperature = 0.7, maxTokens = 2048, ...config }) {
    const client = new OpenAI({
        apiKey,
        baseURL: 'https://api.deepseek.com'
    });

    const callApi = async (messages) => {
        const response = await client.chat.completions.create({
            model: model,
            messages: messages,
            temperature: temperature,
            max_tokens: maxTokens
        });
        return {
            content: response.choices[0].message.content.trim(),
            raw: response
        };
    };

    return {
        generateContent: async (parts) => {
            const messages = [];
            let systemPrompt = '';
            let userContent = [];

            for (const part of parts) {
                if (typeof part === 'string') {
                    if (systemPrompt === '' && part.includes('You are')) {
                        systemPrompt = part;
                    } else {
                        userContent.push({ type: 'text', text: part });
                    }
                } else if (part.inlineData) {
                    userContent.push({
                        type: 'image_url',
                        image_url: { url: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}` }
                    });
                }
            }

            if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
            if (userContent.length > 0) messages.push({ role: 'user', content: userContent });

            const result = await callApi(messages);

            return {
                response: {
                    text: () => result.content
                },
                raw: result.raw
            };
        },

        chat: async (messages) => {
            return await callApi(messages);
        }
    };
}

/**
 * Creates a DeepSeek streaming LLM instance
 */
function createStreamingLLM({ apiKey, model = 'deepseek-chat', temperature = 0.7, maxTokens = 2048, ...config }) {
    return {
        streamChat: async (messages) => {
            const fetchUrl = 'https://api.deepseek.com/chat/completions';
            const response = await fetch(fetchUrl, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model: model,
                    messages,
                    temperature,
                    max_tokens: maxTokens,
                    stream: true,
                }),
            });

            if (!response.ok) {
                throw new Error(`DeepSeek API error: ${response.status} ${response.statusText}`);
            }

            return response;
        }
    };
}

module.exports = {
    DeepSeekProvider,
    createSTT,
    createLLM,
    createStreamingLLM
};
