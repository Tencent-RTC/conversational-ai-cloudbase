import OpenAI from 'openai';
import dotenv from 'dotenv';
dotenv.config();

// Configuration with defaults
const BASE_URL = process.env.LLM_BASE_URL || 'https://api.openai.com/v1';
const API_KEY = process.env.LLM_API_KEY || '';
const MODEL = process.env.LLM_MODEL || 'gpt-4o';
const DEFAULT_PROMPT = process.env.LLM_DEFAULT_PROMPT || '你是一个有用的AI助手';
const MAX_CONTEXT_MESSAGES = parseInt(process.env.MAX_CONTEXT_MESSAGES || '10', 10);
const CONTEXT_EXPIRY_HOURS = parseInt(process.env.CONTEXT_EXPIRY_HOURS || '10', 10);

// Log configuration on startup
console.log(`Configuration: BASE_URL=${BASE_URL}, MODEL=${MODEL}`);
console.log(`API Key configured: ${API_KEY ? 'Yes' : 'No'}`);

// Validate API key, exit directly if not configured
if (!API_KEY) {
    const errorMsg = 'API key is not configured! Please set LLM_API_KEY environment variable.';
    console.error(errorMsg);
    process.exit(1);
}

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

    return await handleStreamingRequest(requestId, taskId, modelToUse, context, contextData);
}

// Handle streaming request using SSE
async function handleStreamingRequest(requestId, taskId, model, context, contextData) {
    const sse = context.sse();

    if (!sse || sse.closed) {
        console.log(`[${requestId}] SSE connection unavailable or closed, aborting`);
        return '';
    }

    try {
        console.log(`[${requestId}] Sending streaming request to LLM with ${contextData.messages.length} messages`);
        console.log(`[${requestId}] LLM request payload:`, JSON.stringify({
            model: model,
            messages: contextData.messages
        }));

        // Ensure model parameter is valid
        if (!model) {
            throw new Error('Model parameter is required but was not provided');
        }

        const stream = await openai.chat.completions.create({
            model: model,
            messages: contextData.messages,
            stream: true
        });
        console.log(`[${requestId}] LLM streaming connection established`);

        // If your App needs to send some information use LLM SSE event to the trtc-ai terminal,
        // you can use this feature: add the meta.info custom message.
        // TRTC sdk will pass the message through the callback to the terminal, cmdID is 1, type is 10002.
        // see@https://cloud.tencent.com/document/product/647/32241
        // example:
        // receive msg from ai_xxx cmdId: 1 seq: 400658173 data:
        // {
        //     "type": 10002,
        //     "sender": "ai_xxx",
        //     "receiver": ["user_xxx"],
        //     "payload": {
        //     "timestamp": 1742365019674,
        //         "model": "xxxx",
        //         "requestId": "w2fwoy60",
        //         "description": "This is the meta info message from TCB demo, help you enrich your App"
        //      }
        // }

        // const metaInfoMessage = {
        //     "type": "meta.info",
        //     "metainfo": {
        //         "timestamp": Date.now(),
        //         "model": model,
        //         "requestId": requestId,
        //         "description": "This is the meta info message from TCB demo, help you enrich your App",
        //     }
        // };
        // sse.send(`data: ${JSON.stringify(metaInfoMessage)}\n\n`);

        // You can remove the code above if you don't need it.


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

        console.log(`[${requestId}] LLM streaming completed. Response length: ${assistantResponse.length}`);

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