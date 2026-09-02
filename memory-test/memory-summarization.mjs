/**
 * 当token超过上下文限制时，对之前部分进行summarize，然后再给到LLM分析
 */
import dotenv from "dotenv";
import { ChatOpenAI } from "@langchain/openai";
import { InMemoryChatMessageHistory } from "@langchain/core/chat_history";
import {
  HumanMessage,
  SystemMessage,
  AIMessage,
  getBufferString,
} from "@langchain/core/messages";
import { getEncoding } from "js-tiktoken";
import path from "path";

dotenv.config({
  path: path.resolve(process.cwd(), "../.env"),
});

const model = new ChatOpenAI({
  modelName: process.env.MODEL_NAME,
  apiKey: process.env.OPENAI_API_KEY,
  temperature: 0,
  configuration: {
    baseURL: process.env.OPENAI_BASE_URL,
  },
});

/**
 * 计算消息内容的 token 数量
 *
 * 注意：
 * 这里只计算 message.content，
 * 并不是 OpenAI API 实际请求的完整 token 数量。
 * 因此它更适合作为一个近似值，用于 Memory trimming。
 */
function countTokens(messages, encoder) {
  let total = 0;

  for (const msg of messages) {
    const content =
      typeof msg.content === "string"
        ? msg.content
        : JSON.stringify(msg.content);

    total += encoder.encode(content).length;
  }

  return total;
}

/**
 * 获取单条消息的 token 数量
 */
function countMessageTokens(message, encoder) {
  const content =
    typeof message.content === "string"
      ? message.content
      : JSON.stringify(message.content);

  return encoder.encode(content).length;
}

/**
 * 总结历史消息
 */
async function summarizeHistory(messages) {
  if (messages.length === 0) {
    return "";
  }

  // 将AIMessage, HumanMessage等转换成普通字符串，发送给ai总结
  const conversationText = getBufferString(messages, {
    humanPrefix: "用户",
    aiPrefix: "助手",
  });

  const summaryPrompt = `请总结以下对话的核心内容，保留对后续对话有用的重要信息。

要求：
1. 保留用户的需求、目标和偏好
2. 保留已经确定的重要事实
3. 保留已经完成的操作和当前进度
4. 保留后续对话可能需要的信息
5. 不要添加原对话中不存在的信息
6. 简洁但不要丢失关键上下文

以下是历史对话：

${conversationText}

总结：`;

  const summaryResponse = await model.invoke([
    new SystemMessage(summaryPrompt),
  ]);

  return typeof summaryResponse.content === "string"
    ? summaryResponse.content
    : JSON.stringify(summaryResponse.content);
}

/**
 * Summary + Recent Messages Memory Demo
 */
async function summarizationMemoryDemo() {
  const history = new InMemoryChatMessageHistory();

  // 超过这个 token 数量时触发总结
  const maxTokens = 200;

  // 总结完成后，保留最近消息的 token 数量
  const keepRecentTokens = 80;

  /**
   * 注意：
   * cl100k_base 只是一个 tokenizer。
   * 如果 MODEL_NAME 使用的是其他 tokenizer，
   * 这里应该根据实际模型选择对应 tokenizer。
   */
  const enc = getEncoding("cl100k_base");

  const messages = [
    {
      type: "human",
      content: "我想学做红烧肉，你能教我吗？",
    },
    {
      type: "ai",
      content:
        "当然可以！红烧肉是一道经典的中式菜肴。首先需要准备五花肉、冰糖、生抽、老抽、料酒等材料。",
    },
    {
      type: "human",
      content: "五花肉需要切多大块？",
    },
    {
      type: "ai",
      content:
        "建议切成3-4厘米见方的块，这样既容易入味，口感也更好。切好后可以用开水焯一下去除血沫。",
    },
    {
      type: "human",
      content: "炒糖色的时候有什么技巧吗？",
    },
    {
      type: "ai",
      content:
        "炒糖色是关键步骤。用小火慢慢炒，等冰糖完全融化变成焦糖色，冒小泡时就可以下肉了。注意不要炒过头，否则会发苦。",
    },
    {
      type: "human",
      content: "需要炖多长时间？",
    },
    {
      type: "ai",
      content:
        "一般需要炖40-60分钟，用小火慢炖，直到肉变得软糯入味。可以用筷子戳一下，能轻松戳透就说明好了。",
    },
    {
      type: "human",
      content: "最后收汁的时候要注意什么？",
    },
    {
      type: "ai",
      content:
        "收汁时要用大火，不断翻动，让汤汁均匀包裹在肉块上。看到汤汁变得浓稠，颜色红亮就可以出锅了。",
    },
  ];

  // ============================================================
  // 1. 添加原始消息
  // ============================================================

  for (const msg of messages) {
    if (msg.type === "human") {
      await history.addMessage(new HumanMessage(msg.content));
    } else {
      await history.addMessage(new AIMessage(msg.content));
    }
  }

  let allMessages = await history.getMessages();

  // ============================================================
  // 2. 计算当前 Memory 的 token 数量
  // ============================================================

  const totalTokens = countTokens(allMessages, enc);

  console.log("====================================");
  console.log("初始 Memory");
  console.log("====================================");
  console.log(`消息数量: ${allMessages.length}`);
  console.log(`Token 数量: ${totalTokens}`);
  console.log(`最大 Token: ${maxTokens}`);

  // ============================================================
  // 3. 判断是否需要总结
  // ============================================================

  if (totalTokens < maxTokens) {
    console.log(
      `\nToken 数量 (${totalTokens}) 未超过阈值 (${maxTokens})，无需总结`,
    );

    return;
  }

  console.log("\n💡 Token 数量超过阈值，开始总结...");

  // ============================================================
  // 4. 从后往前选择最近消息
  //
  //    保留最近 keepRecentTokens 个 token
  // ============================================================

  const recentMessages = [];
  let recentTokens = 0;

  for (let i = allMessages.length - 1; i >= 0; i--) {
    const msg = allMessages[i];
    const msgTokens = countMessageTokens(msg, enc);

    if (recentTokens + msgTokens <= keepRecentTokens) {
      recentMessages.unshift(msg);
      recentTokens += msgTokens;
    } else {
      break;
    }
  }

  // ============================================================
  // 5. 找出需要被总结的旧消息
  // ============================================================

  const messagesToSummarize = allMessages.slice(
    0,
    allMessages.length - recentMessages.length,
  );

  const summarizeTokens = countTokens(messagesToSummarize, enc);

  console.log(`\n📝 将被总结的消息数量: ${messagesToSummarize.length}`);
  console.log(`📝 将被总结的 Token 数量: ${summarizeTokens}`);

  console.log(`\n📝 将被保留的消息数量: ${recentMessages.length}`);
  console.log(`📝 将被保留的 Token 数量: ${recentTokens}`);

  // ============================================================
  // 6. 总结旧消息
  // ============================================================

  const summary = await summarizeHistory(messagesToSummarize);

  console.log("\n====================================");
  console.log("Summary");
  console.log("====================================");
  console.log(summary);

  await history.clear();

  // 把 summary 放回 Memory
  if (summary) {
    await history.addMessage(
      new SystemMessage(
        `以下是之前对话的总结，将其作为历史上下文使用：

${summary}`,
      ),
    );
  }

  // 再放入最近的原始消息
  for (const msg of recentMessages) {
    await history.addMessage(msg);
  }

  // ============================================================
  // 8. 查看最终 Memory
  // ============================================================

  const finalMessages = await history.getMessages();

  const finalTokens = countTokens(finalMessages, enc);

  console.log("\n====================================");
  console.log("最终 Memory");
  console.log("====================================");

  console.log(`消息数量: ${finalMessages.length}`);
  console.log(`Token 数量: ${finalTokens}`);

  console.log("\n最终 Memory 内容:");

  finalMessages.forEach((msg, index) => {
    const content =
      typeof msg.content === "string"
        ? msg.content
        : JSON.stringify(msg.content);

    const tokens = enc.encode(content).length;

    console.log(`\n[${index + 1}] ${msg.constructor.name} (${tokens} tokens)`);

    console.log(content);
  });

  // ============================================================
  // 9. 模拟下一次 Agent 调用
  // ============================================================

  console.log("\n====================================");
  console.log("下一次 Agent 调用");
  console.log("====================================");

  const nextUserMessage = new HumanMessage(
    "我现在已经把肉炖好了，接下来应该怎么收汁？",
  );

  const messagesForLLM = [...finalMessages, nextUserMessage];

  console.log("\n发送给 LLM 的上下文:");

  messagesForLLM.forEach((msg, index) => {
    console.log(`\n[${index + 1}] ${msg.constructor.name}:`, msg.content);
  });

  //
  // const response = await model.invoke(messagesForLLM);
  //
  // console.log("\nLLM Response:");
  // console.log(response.content);
}

summarizationMemoryDemo().catch(console.error);
