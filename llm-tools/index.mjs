import OpenAI from 'openai';
import dotenv from 'dotenv';
dotenv.config();

// Configuration with defaults
const BASE_URL = process.env.LLM_BASE_URL || 'https://api.openai.com/v1';
const API_KEY = process.env.LLM_API_KEY || '';
const MODEL = process.env.LLM_MODEL || 'gpt-4o';
const DEFAULT_PROMPT = process.env.LLM_DEFAULT_PROMPT || '你是一个有用的AI助手，可以帮我查询天气等信息';
const MAX_CONTEXT_MESSAGES = parseInt(process.env.MAX_CONTEXT_MESSAGES || '10', 10);
const CONTEXT_EXPIRY_HOURS = parseInt(process.env.CONTEXT_EXPIRY_HOURS || '10', 10);

// Log configuration on startup
console.log(`Configuration: BASE_URL=${BASE_URL}, MODEL=${MODEL}`);
console.log(`API Key configured: ${API_KEY ? 'Yes' : 'No'}`);

// Initialize OpenAI client
const openai = new OpenAI({
    apiKey: API_KEY,
    baseURL: BASE_URL
});

// Weather tool definition
const weatherTool = {
    type: "function",
    function: {
        name: "get_weather",
        description: "Get current weather information for a specific location",
        parameters: {
            type: "object",
            properties: {
                location: {
                    type: "string",
                    description: "City name or location, e.g. 'Beijing' or '北京'"
                },
                unit: {
                    type: "string",
                    enum: ["celsius", "fahrenheit"],
                    description: "Temperature unit, celsius or fahrenheit"
                }
            },
            required: ["location"]
        }
    }
};

// Mock weather API implementation for development and testing
async function getWeather(params) {
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 500));

    const { location, unit = "celsius" } = params;

    // Generate random but reasonable weather data
    const tempCelsius = Math.round(Math.random() * 35) - 5; // -5 to 30 degrees Celsius
    const temp = unit === "celsius" ? tempCelsius : (tempCelsius * 9/5) + 32;

    const weatherTypes = ['sunny', 'cloudy', 'overcast', 'light rain', 'heavy rain', 'thunderstorm', 'light snow', 'heavy snow'];
    const randomWeather = weatherTypes[Math.floor(Math.random() * weatherTypes.length)];

    const humidity = Math.round(Math.random() * 100);
    const windSpeed = Math.round(Math.random() * 30);

    console.log(`[Weather API] Mocked weather data for ${location}: ${temp}${unit === "celsius" ? "°C" : "°F"}, ${randomWeather}`);

    return {
        location: location,
        temperature: temp,
        unit: unit === "celsius" ? "°C" : "°F",
        description: randomWeather,
        humidity: humidity,
        windSpeed: windSpeed,
        time: new Date().toLocaleString(),
        note: "This is simulated weather data for testing purposes"
    };
}

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
        // 如果没有 taskId，则不存储上下文
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
        // 如果没有 taskId，则不存储消息
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

// Handle function call
async function handleFunctionCall(functionCall, sse, requestId) {
    console.log(`[${requestId}] Function call detected: ${functionCall.name}`);

    let functionResult = { error: "Function not implemented" };

    if (functionCall.name === "get_weather") {
        try {
            const args = JSON.parse(functionCall.arguments);
            console.log(`[${requestId}] Weather request for location: ${args.location}`);

            functionResult = await getWeather(args);
            console.log(`[${requestId}] Weather data retrieved:`, functionResult);
        } catch (error) {
            console.error(`[${requestId}] Error parsing function arguments:`, error);
            functionResult = { error: `Error parsing arguments: ${error.message}` };
        }
    }

    return JSON.stringify(functionResult);
}

export async function main(event, context) {
    const requestId = Math.random().toString(36).substring(2, 10);
    console.log(`[${requestId}] Request received:`, JSON.stringify(event));

    // Extract task ID from header or use null (no default)
    const taskId = context.httpContext?.headers?.['x-task-id'] || event.taskId || null;

    console.log(`[${requestId}] Processing request for task ID: ${taskId || 'No task ID provided'}`);

    // Extract data from the request
    const { messages = [], model } = event;
    // 确保始终使用有效的模型名称
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
        console.log(`[${requestId}] Sending streaming request to LLM with ${contextData.messages.length} messages`);
        console.log(`[${requestId}] Using tools: Weather API`);

        // 确保模型参数有效
        if (!model) {
            throw new Error('Model parameter is required but was not provided');
        }

        // Main model stream request with weather tool
        const startTime = Date.now();
        const stream = await openai.chat.completions.create({
            model: model,
            messages: contextData.messages,
            stream: true,
            tools: [weatherTool],
            tool_choice: "auto"
        });
        console.log(`[${requestId}] LLM streaming connection established`);

        let assistantResponse = '';
        let collectingToolCall = false;
        let toolCallData = null;
        let accumulatedArguments = '';

        for await (const chunk of stream) {
            // Handle tool call initiation
            if (chunk.choices[0]?.delta?.tool_calls) {
                const toolCallDelta = chunk.choices[0].delta.tool_calls[0];

                if (!collectingToolCall) {
                    collectingToolCall = true;
                    toolCallData = {
                        id: toolCallDelta.id || '',
                        type: toolCallDelta.type || '',
                        function: {
                            name: toolCallDelta.function?.name || '',
                            arguments: ''
                        }
                    };

                    console.log(`[${requestId}] Tool call started: ${toolCallData.function.name}`);
                }

                // Collect function arguments
                if (toolCallDelta.function?.arguments) {
                    accumulatedArguments += toolCallDelta.function.arguments;
                }

                continue;
            }

            // Handle tool call completion
            if (collectingToolCall && chunk.choices[0]?.finish_reason === 'tool_calls') {
                console.log(`[${requestId}] Tool call arguments collected:`, accumulatedArguments);
                toolCallData.function.arguments = accumulatedArguments;

                // Execute tool function
                const functionResult = await handleFunctionCall(toolCallData.function, sse, requestId);

                // Record tool call to context
                if (taskId) {
                    contextManager.addMessage(taskId, {
                        role: "assistant",
                        content: null,
                        tool_calls: [toolCallData]
                    });

                    contextManager.addMessage(taskId, {
                        role: "tool",
                        tool_call_id: toolCallData.id,
                        content: functionResult
                    });
                }

                // Continue conversation with tool call results
                const followUpResponse = await openai.chat.completions.create({
                    model: model,
                    messages: [
                        ...contextData.messages,
                        {
                            role: "assistant",
                            content: null,
                            tool_calls: [toolCallData]
                        },
                        {
                            role: "tool",
                            tool_call_id: toolCallData.id,
                            content: functionResult
                        }
                    ],
                    stream: true
                });

                console.log(`[${requestId}] Follow-up request with tool results initiated`);

                // Process follow-up response
                for await (const followUpChunk of followUpResponse) {
                    const content = followUpChunk.choices[0]?.delta?.content || '';
                    if (content) {
                        assistantResponse += content;
                        if (!sse.closed) {
                            sse.send(`data: ${JSON.stringify(followUpChunk)}\n\n`);
                        } else {
                            console.warn(`[${requestId}] SSE connection closed during streaming`);
                            break;
                        }
                    }
                }

                // Save final response to context
                if (assistantResponse && taskId) {
                    contextManager.addMessage(taskId, {
                        role: 'assistant',
                        content: assistantResponse
                    });
                }

                break; // Tool call processing completed, end stream processing
            }

            // Handle regular content
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
        console.log(`[${requestId}] LLM streaming completed in ${duration}ms. Response length: ${assistantResponse.length}`);

        // Save assistant response if no tool call was processed
        if (assistantResponse && taskId && !collectingToolCall) {
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