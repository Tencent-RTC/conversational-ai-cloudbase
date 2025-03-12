import OpenAI from 'openai';
import dotenv from 'dotenv';
dotenv.config();

// Configuration with defaults
const BASE_URL = process.env.LLM_BASE_URL || 'https://api.openai.com/v1';
const API_KEY = process.env.LLM_API_KEY || '';
const MODEL = process.env.LLM_MODEL || 'gpt-4o';
const DEFAULT_PROMPT = process.env.LLM_DEFAULT_PROMPT || '你是一个有用的AI助手。请直接开始回答用户的问题，不要加入多余的开场白，使回答更加简洁自然。';
const MAX_CONTEXT_MESSAGES = parseInt(process.env.MAX_CONTEXT_MESSAGES || '10', 10);
const CONTEXT_EXPIRY_HOURS = parseInt(process.env.CONTEXT_EXPIRY_HOURS || '10', 10);

// Small model system prompt
const SMALL_MODEL_PROMPT = process.env.SMALL_MODEL_PROMPT || `你是一个快速反应助理。不要回答用户的问题，而是给出一个自然的过渡回应。
回复要简短（10字以内），表示你正在思考或准备回答，使用更加通用的表达。
示例：
用户：给我讲个故事
回复：好呀～ 让我想一个故事
用户：解释下量子力学
回复：好的，我来解释下量子力学
用户：给我讲个笑话
回复：没问题，让我想一个笑话`;

// Progressive response configuration
const PROGRESSIVE_RESPONSE = {
    enabled: process.env.USE_PROGRESSIVE_RESPONSE === 'true' || false,
    smallModel: process.env.SMALL_MODEL || 'Qwen/Qwen2.5-7B-Instruct',
    maxTokens: parseInt(process.env.SMALL_MODEL_MAX_TOKENS || '100', 10),
    temperature: parseFloat(process.env.SMALL_MODEL_TEMPERATURE || '0.4')
};

// Log configuration on startup
console.log(`Configuration: BASE_URL=${BASE_URL}, MODEL=${MODEL}`);
console.log(`API Key configured: ${API_KEY ? 'Yes' : 'No'}`);
console.log(`Progressive response: ${PROGRESSIVE_RESPONSE.enabled ? 'enabled' : 'disabled'}, small model: ${PROGRESSIVE_RESPONSE.smallModel}`);

// Initialize OpenAI client
const openai = new OpenAI({
    apiKey: API_KEY,
    baseURL: BASE_URL
});

/**
 * Context management class for storing conversation history
 */
class ContextManager {
    constructor() {
        this.contexts = new Map();
        setInterval(() => this.cleanExpiredContexts(), 1000 * 60 * 30);
        console.log(`ContextManager initialized with message limit: ${MAX_CONTEXT_MESSAGES}`);
    }

    getContext(taskId) {
        // If no taskId is provided, don't store the context
        if (!taskId) {
            console.log('No taskId provided, returning default context without storing');
            return {
                messages: [{ role: 'system', content: DEFAULT_PROMPT }],
                createdAt: Date.now(),
                lastAccessedAt: Date.now()
            };
        }

        if (!this.contexts.has(taskId)) {
            console.log(`Creating new context for task ID: ${taskId}`);
            this.contexts.set(taskId, {
                messages: [{ role: 'system', content: DEFAULT_PROMPT }],
                createdAt: Date.now(),
                lastAccessedAt: Date.now()
            });
        } else {
            console.log(`Retrieved existing context for task ID: ${taskId}`);
            console.log(`Current messages in context: ${JSON.stringify(this.contexts.get(taskId).messages)}`);
        }

        const context = this.contexts.get(taskId);
        context.lastAccessedAt = Date.now();
        return context;
    }

    addMessage(taskId, message) {
        // If no taskId is provided, don't store the message
        if (!taskId) {
            console.log('No taskId provided, message not stored in context');
            return null;
        }

        console.log(`Adding ${message.role} message to context for task ID: ${taskId}`);
        const context = this.getContext(taskId);
        context.messages.push(message);

        if (context.messages.length > MAX_CONTEXT_MESSAGES + 1) {
            console.log(`Context for ${taskId} exceeded max length. Trimming...`);
            const systemMessage = context.messages[0];
            const recentMessages = context.messages.slice(-(MAX_CONTEXT_MESSAGES));
            context.messages = [systemMessage, ...recentMessages];
        }

        return context;
    }

    cleanExpiredContexts() {
        const now = Date.now();
        const expiryTime = CONTEXT_EXPIRY_HOURS * 60 * 60 * 1000;
        let expiredCount = 0;

        for (const [taskId, context] of this.contexts.entries()) {
            if (now - context.lastAccessedAt > expiryTime) {
                console.log(`Context for task ${taskId} expired. Removing...`);
                this.contexts.delete(taskId);
                expiredCount++;
            }
        }

        if (expiredCount > 0) {
            console.log(`Cleanup completed. Removed ${expiredCount} expired contexts.`);
        }
    }
}

const contextManager = new ContextManager();

// Helper function to send SSE content
function sendSSEContent(sse, content, isChunk = true) {
    if (!content || sse.closed) return;

    if (isChunk) {
        // Send as a Delta object matching OpenAI chunk format
        sse.send(`data: ${JSON.stringify({
            choices: [{
                delta: { content }
            }]
        })}\n\n`);
    } else {
        // Send raw data
        sse.send(`data: ${JSON.stringify(content)}\n\n`);
    }
}

// Get quick response from small model
async function getSmallModelResponse(userContent, sse, requestId) {
    console.log(`[${requestId}] Generating small model quick response...`);
    try {
        const smallModelMessages = [
            {
                role: "system",
                content: SMALL_MODEL_PROMPT
            },
            {
                role: "user",
                content: userContent
            }
        ];

        const startTime = Date.now();
        
        // Request small model to generate quick response
        const response = await openai.chat.completions.create({
            model: PROGRESSIVE_RESPONSE.smallModel,
            messages: smallModelMessages,
            temperature: PROGRESSIVE_RESPONSE.temperature,
            max_tokens: PROGRESSIVE_RESPONSE.maxTokens,
            stream: false  // Non-streaming for quick response
        });

        const smallModelContent = response.choices[0].message.content;
        console.log(`[${requestId}] Small model response (${Date.now() - startTime}ms): ${smallModelContent}`);

        sendSSEContent(sse, smallModelContent + "\n\n");
        return true;
    } catch (error) {
        console.error(`[${requestId}] Small model response failed:`, error.message);
        return false;
    }
}

export async function main(event, context) {
    const requestId = Math.random().toString(36).substring(2, 10);
    console.log(`[${requestId}] Request received:`, JSON.stringify(event));

    // Extract task ID from header or use null (no default)
    const taskId = context.httpContext?.headers?.['x-task-id'] || event.taskId || null;

    console.log(`[${requestId}] Processing request for task ID: ${taskId || 'No task ID provided'}`);

    // Extract data from the request
    const { messages = [], model } = event;
    // Ensure a valid model name is always used
    const modelToUse = model || MODEL;
    console.log(`[${requestId}] Request messages count: ${messages.length}, model: ${modelToUse}`);

    // Process messages into context
    let contextData;
    if (messages.length > 0) {
        contextData = contextManager.getContext(taskId);

        if (messages[0].role === 'system') {
            console.log(`[${requestId}] Replacing system message in context`);
            contextData.messages[0] = messages[0];

            for (let i = 1; i < messages.length; i++) {
                if (taskId) {
                    contextManager.addMessage(taskId, messages[i]);
                }
            }
        } else {
            for (const msg of messages) {
                if (taskId) {
                    contextManager.addMessage(taskId, msg);
                } else {
                    contextData.messages.push(msg);
                }
            }
        }
    } else {
        contextData = contextManager.getContext(taskId);
    }

    return await handleStreamingRequest(requestId, taskId, modelToUse, context, contextData, event);
}

// Handle streaming request using SSE
async function handleStreamingRequest(requestId, taskId, model, context, contextData, event) {
    const sse = context.sse();

    if (!sse || sse.closed) {
        console.log(`[${requestId}] SSE connection unavailable or closed, aborting`);
        return '';
    }

    try {
        // Check if progressive response should be used
        const enableProgressiveResponse =
            (event.useProgressiveResponse === true) ||
            (PROGRESSIVE_RESPONSE.enabled && event.useProgressiveResponse !== false);

        console.log(`[${requestId}] Progressive response: ${enableProgressiveResponse ? 'enabled' : 'disabled'}`);

        // Get the last user message directly from event.messages
        const lastMessage = event.messages[event.messages.length - 1];
        // If progressive response is enabled and we have a user message, use small model first
        if (enableProgressiveResponse && lastMessage?.role === 'user') {
            await getSmallModelResponse(lastMessage.content, sse, requestId);
        }

        // Process messages into context for main model
        console.log(`[${requestId}] Sending streaming request to LLM with ${contextData.messages.length} messages`);
        console.log(`[${requestId}] LLM request payload:`, JSON.stringify({
            model: model,
            messages: contextData.messages
        }));

        // Ensure model parameter is valid
        if (!model) {
            throw new Error('Model parameter is required but was not provided');
        }

        // Main model stream request
        const startTime = Date.now();
        const stream = await openai.chat.completions.create({
            model: model,
            messages: contextData.messages,
            stream: true
        });
        console.log(`[${requestId}] LLM streaming connection established`);

        let assistantResponse = '';

        for await (const chunk of stream) {
            const content = chunk.choices[0]?.delta?.content || '';
            if (content) {
                assistantResponse += content;
                if (!sse.closed) {
                    sse.send(`data: ${JSON.stringify(chunk)}\n\n`);
                } else {
                    console.warn(`[${requestId}] SSE connection closed during streaming`);
                    break;
                }
            }
        }

        const duration = Date.now() - startTime;
        // Add logging for the complete response
        console.log(`[${requestId}] LLM full response: ${assistantResponse}`);
        console.log(`[${requestId}] LLM streaming completed in ${duration}ms. Response length: ${assistantResponse.length}`);

        if (assistantResponse && taskId) {
            contextManager.addMessage(taskId, {
                role: 'assistant',
                content: assistantResponse
            });
        }

        if (!sse.closed) {
            sse.send('data: [DONE]\n\n');
            sse.end();
            console.log(`[${requestId}] SSE connection closed properly`);
        }

    } catch (error) {
        console.error(`[${requestId}] Error in streaming request:`, error);

        try {
            if (!sse.closed) {
                sse.send(`data: ${JSON.stringify({ error: error.message || 'Unknown error' })}\n\n`);
                sse.end();
                console.log(`[${requestId}] Error sent to client via SSE`);
            }
        } catch (sseError) {
            console.error(`[${requestId}] Failed to send error via SSE:`, sseError);
        }
    }

    return '';
}