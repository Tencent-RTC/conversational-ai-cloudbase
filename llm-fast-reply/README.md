# LLM Fast Reply 服务

快速响应服务，为了解决大模型或在RAG使得对话时响应慢的问题，在标准 LLM 服务基础上增加了渐进式响应功能：
- 支持小模型快速预响应
- 使用较小的模型生成初步回复
- 同时启动大模型生成完整回复
- 可配置是否启用渐进式响应
- 支持自定义小模型参数（温度、最大 token 等）

1. 安装云函数开发工具：
```bash
npm i @cloudbase/functions-framework
npm i @cloudbase/cli 
```

2. 进入需要运行的云函数目录：
```bash
npm i
```

3. 本地启动云函数：
```bash
tcb-ff
```

服务将在 http://localhost:3000 启动。

4. 部署云函数
```bash
tcb cloudrunfunction deploy
```

测试示例：
```bash
curl -X POST http://localhost:3000 \
  -H "Content-Type: application/json" \
  -H "X-Task-ID: test-session-101" \
  -H "Accept: text/event-stream" \
  --data '{
    "messages": [
      {"role": "user", "content": "解释一下量子计算的基本原理"}
    ]
  }'
```


## 配置项
主要配置参数包括：
- `LLM_BASE_URL`: API 基础 URL
- `LLM_API_KEY`: API 访问密钥
- `LLM_MODEL`: 默认使用的模型
- `USE_PROGRESSIVE_RESPONSE`: 开启快速响应功能


## 对接TRTC-AI对话
部署云函数2.0后，每个函数都会提供一个访问入口：**默认域名**，将默认域名填入到TRTC-AI对话的Playground中, 即刻开启AI对话， 具体操作方式如下。
![func-url.png](./images/func-url.png)


### Playground 接入
在大模型接入的配置框中，将CloudBase部署云函数提供的url填入即可使用。

1. 首先进入配置页：https://console.cloud.tencent.com/trtc/conversational-ai

2. STT语音识别配置参考：https://cloud.tencent.com/document/product/647/116056#a9bf6945-84d1-477b-bd88-7ddee15e601f

3. LLM 配置
   将部署后的云函数2.0生成的的**默认域名**复制到下图的 API Url 框内
   如：https://sse-openai-proxy-xxxxx-x-xxxx.sh.run.tcloudbase.com/chat/completions
   ![llm-config-playground.png](./images/llm-config-playground.png)
   参考：https://cloud.tencent.com/document/product/647/116056#2d3404be-252f-4a04-9660-1685ca9e36a1

4. TTS 配置项参考： https://cloud.tencent.com/document/product/647/116056#68abd704-2c53-4c0b-be37-1a63c79d531e



### API 调用
部署云函数2.0后，每个函数都会提供一个访问入口：**默认域名**，将默认域名填入到TRTC-AI对话的Playground中, 即刻开启AI对话， 具体操作方式如下。
![func-url.png](./images/func-url.png)

在调用启动AI对话接口时（[StartAIConversation](https://cloud.tencent.com/document/api/647/108514)）时，可以将CloudBase部署云函数提供的**默认域名**填到LLMConfig.APIUrl参数中，即可使用LLM服务进行对话。

```json
{
   "LLMType": "openai",
   "Model":"xx",
   "APIKey":"xx",
   "APIUrl":"https://sse-openai-proxy-xxxxx-x-xxxx.sh.run.tcloudbase.com/chat/completions",
   "Streaming": true
}
```
