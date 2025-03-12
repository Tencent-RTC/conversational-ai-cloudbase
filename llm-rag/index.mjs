import OpenAI from 'openai';
import dotenv from 'dotenv';
import { createHash } from 'crypto';
dotenv.config();

// Configuration with defaults
const BASE_URL = process.env.LLM_BASE_URL || 'https://api.openai.com/v1';
const API_KEY = process.env.LLM_API_KEY || '';
const MODEL = process.env.LLM_MODEL || 'gpt-4o';
const DEFAULT_PROMPT = process.env.LLM_DEFAULT_PROMPT || '你是一个有用的AI助手，会利用检索到的信息回答问题';
const MAX_CONTEXT_MESSAGES = parseInt(process.env.MAX_CONTEXT_MESSAGES || '10', 10);
const CONTEXT_EXPIRY_HOURS = parseInt(process.env.CONTEXT_EXPIRY_HOURS || '10', 10);

// RAG configuration
const RAG_CONFIG = {
    enabled: process.env.USE_RAG === 'true' || true,
    similarityThreshold: parseFloat(process.env.RAG_SIMILARITY_THRESHOLD || '0.7'),
    maxDocuments: parseInt(process.env.RAG_MAX_DOCUMENTS || '3'),
    embeddingModel: process.env.EMBEDDING_MODEL || 'text-embedding-ada-002'
};

// Log configuration on startup
console.log(`Configuration: BASE_URL=${BASE_URL}, MODEL=${MODEL}`);
console.log(`API Key configured: ${API_KEY ? 'Yes' : 'No'}`);
console.log(`RAG: ${RAG_CONFIG.enabled ? 'enabled' : 'disabled'}, threshold: ${RAG_CONFIG.similarityThreshold}, max docs: ${RAG_CONFIG.maxDocuments}`);

// Initialize OpenAI client
const openai = new OpenAI({
    apiKey: API_KEY,
    baseURL: BASE_URL
});

/**
 * Simple In-Memory RAG implementation
 */
class RAGSystem {
    constructor() {
        this.documents = [];
        this.initialized = false;
        console.log('RAG system initialized');
    }

    // Initialize RAG with sample documents
    async initialize() {
        if (this.initialized) return;

        // Sample documents for demonstration
        const sampleDocuments = [
            {
                id: '1',
                title: '机器学习基础',
                content: '机器学习是人工智能的一个分支，主要研究如何使计算机系统从数据中自动"学习"。机器学习算法可分为监督学习、无监督学习和强化学习三大类。监督学习需要标记数据，无监督学习不需要标记，而强化学习通过与环境互动来学习最优策略。'
            },
            {
                id: '2',
                title: '深度学习简介',
                content: '深度学习是机器学习的一个子领域，专注于使用神经网络进行特征学习。深度神经网络包含多个隐藏层，每一层学习不同层次的抽象特征。深度学习在计算机视觉、自然语言处理和语音识别等领域取得了突破性成果。'
            },
            {
                id: '3',
                title: '自然语言处理技术',
                content: '自然语言处理(NLP)是研究计算机与人类语言交互的领域。主要任务包括文本分类、情感分析、机器翻译、问答系统等。近年来，Transformer架构和大型语言模型如BERT、GPT等推动了NLP技术的快速发展。'
            },
            {
                id: '4',
                title: '大型语言模型',
                content: '大型语言模型(LLM)是基于Transformer架构训练的大规模语言模型，如GPT、PaLM、Llama等。这些模型通过自监督学习从互联网规模的文本中学习语言规律和知识。LLM能够执行多种任务，如文本生成、翻译、问答和编程辅助等。'
            },
            {
                id: '5',
                title: '向量数据库',
                content: '向量数据库是一种专为高维向量数据设计的数据库系统，用于存储和检索嵌入向量。在RAG系统中，向量数据库存储文档嵌入，支持高效的相似性搜索，常见实现有Pinecone、Faiss、Milvus等。'
            }
        ];

        // Embed and store documents
        for (const doc of sampleDocuments) {
            await this.addDocument(doc);
        }

        this.initialized = true;
        console.log(`RAG system initialized with ${this.documents.length} documents`);
    }

    // Add a document to the RAG system
    async addDocument(document) {
        try {
            // Generate embedding for document content
            const embedding = await this.getEmbedding(document.content);

            // Store document with embedding
            this.documents.push({
                ...document,
                embedding: embedding
            });

            console.log(`Added document: ${document.id} - ${document.title}`);
            return true;
        } catch (error) {
            console.error('Error adding document to RAG:', error);
            return false;
        }
    }

    // Get embedding vector for text
    async getEmbedding(text) {
        try {
            // For demo purposes, we'll use a mock embedding function
            // In production, you would use:
            // const response = await openai.embeddings.create({
            //     model: RAG_CONFIG.embeddingModel,
            //     input: text
            // });
            // return response.data[0].embedding;

            // Mock embedding generation (hash-based for demo)
            return this.mockEmbedding(text);
        } catch (error) {
            console.error('Error getting embedding:', error);
            throw error;
        }
    }

    // Mock embedding function for demonstration
    mockEmbedding(text) {
        // Create a deterministic hash from the text
        const hash = createHash('sha256').update(text).digest('hex');

        // Convert hash to a vector (simplified for demo)
        const vector = [];
        for (let i = 0; i < 20; i++) {
            const value = parseInt(hash.slice(i * 2, (i + 1) * 2), 16) / 255;
            vector.push(value);
        }

        return vector;
    }

    // Calculate cosine similarity between two vectors
    cosineSimilarity(vecA, vecB) {
        // Ensure vectors have the same length
        const length = Math.min(vecA.length, vecB.length);

        let dotProduct = 0;
        let normA = 0;
        let normB = 0;

        for (let i = 0; i < length; i++) {
            dotProduct += vecA[i] * vecB[i];
            normA += vecA[i] * vecA[i];
            normB += vecB[i] * vecB[i];
        }

        return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    }

    // Retrieve relevant documents for a query
    async retrieveRelevantDocuments(query) {
        try {
            // Generate embedding for the query
            const queryEmbedding = await this.getEmbedding(query);

            // Calculate similarity with all documents
            const scoredDocs = this.documents.map(doc => {
                const similarity = this.cosineSimilarity(queryEmbedding, doc.embedding);
                return { ...doc, similarity };
            });

            // Sort by similarity and filter based on threshold
            const relevantDocs = scoredDocs
                .filter(doc => doc.similarity >= RAG_CONFIG.similarityThreshold)
                .sort((a, b) => b.similarity - a.similarity)
                .slice(0, RAG_CONFIG.maxDocuments);

            console.log(`Found ${relevantDocs.length} relevant documents for query: "${query.slice(0, 30)}..."`);

            return relevantDocs.length > 0 ? relevantDocs : null;
        } catch (error) {
            console.error('Error retrieving documents:', error);
            return null;
        }
    }

    // Create context from retrieved documents
    createContext(documents) {
        if (!documents || documents.length === 0) return null;

        let context = "以下是相关信息：\n\n";

        documents.forEach((doc, index) => {
            context += `[文档${index + 1}：${doc.title}]\n${doc.content}\n\n`;
        });

        context += "根据上述提供的信息来回答问题。如果信息不足，可以使用你自己的知识，但要明确指出哪些是来自文档的内容，哪些是你自己的补充。";

        return context;
    }
}

// Initialize RAG system
const ragSystem = new RAGSystem();
ragSystem.initialize().catch(err => console.error('RAG initialization error:', err));

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

// Enhance system message with RAG context
async function enhanceSystemMessage(query, systemMessage) {
    if (!RAG_CONFIG.enabled) {
        console.log('RAG is disabled, using original system message');
        return systemMessage;
    }

    try {
        // Retrieve relevant documents
        const relevantDocs = await ragSystem.retrieveRelevantDocuments(query);

        if (!relevantDocs || relevantDocs.length === 0) {
            console.log('No relevant documents found, using original system message');
            return systemMessage;
        }

        // Create context from documents
        const ragContext = ragSystem.createContext(relevantDocs);

        if (!ragContext) {
            console.log('Failed to create RAG context, using original system message');
            return systemMessage;
        }

        // Enhance system message with RAG context
        const enhancedContent = `${systemMessage.content}\n\n${ragContext}`;
        console.log(`Enhanced system message with RAG context. Original length: ${systemMessage.content.length}, Enhanced length: ${enhancedContent.length}`);

        // Return document sources for citation
        const sources = relevantDocs.map(doc => doc.title);

        return {
            role: 'system',
            content: enhancedContent,
            sources
        };
    } catch (error) {
        console.error('Error enhancing system message with RAG:', error);
        return systemMessage;
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
        // Get the latest user query for RAG
        const userQuery = findLatestUserQuery(contextData.messages);

        if (RAG_CONFIG.enabled && userQuery) {
            console.log(`[${requestId}] Enhancing system message with RAG for query: "${userQuery.slice(0, 30)}..."`);

            // Get the original system message
            const originalSystemMsg = contextData.messages[0];

            // Enhance with RAG
            const enhancedSystemMsg = await enhanceSystemMessage(userQuery, originalSystemMsg);

            // Replace the system message
            contextData.messages[0] = enhancedSystemMsg;

            if (enhancedSystemMsg.sources) {
                console.log(`[${requestId}] RAG sources: ${enhancedSystemMsg.sources.join(', ')}`);
            }
        }

        console.log(`[${requestId}] Sending streaming request to LLM with ${contextData.messages.length} messages`);

        // Ensure model parameter is valid
        if (!model) {
            throw new Error('Model parameter is required but was not provided');
        }

        // Main model stream request
        const startTime = Date.now();

        // Send SSE notification that RAG is being processed
        if (RAG_CONFIG.enabled && userQuery) {
            sendSSEContent(sse, "正在检索相关信息以提供更准确的回答...\n", true);
        }

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
        console.log(`[${requestId}] LLM streaming completed in ${duration}ms. Response length: ${assistantResponse.length}`);

        // Append sources from RAG if available
        const enhancedSystemMsg = contextData.messages[0];
        if (RAG_CONFIG.enabled && enhancedSystemMsg.sources && enhancedSystemMsg.sources.length > 0) {
            const sourcesText = `\n\nReferences: ${enhancedSystemMsg.sources.join(', ')}`;
            assistantResponse += sourcesText;

            // Send sources as a final chunk
            if (!sse.closed) {
                sendSSEContent(sse, sourcesText, true);
            }
        }

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

// Helper function to find the latest user query
function findLatestUserQuery(messages) {
    // Start from the end and find the first user message
    for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'user' && messages[i].content) {
            return messages[i].content;
        }
    }
    return null;
}