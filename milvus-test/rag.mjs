import dotenv from "dotenv";
import path from "path";
import {
  MilvusClient,
  DataType,
  MetricType,
  IndexType,
} from "@zilliz/milvus2-sdk-node";
import { OpenAIEmbeddings, ChatOpenAI } from "@langchain/openai";

dotenv.config({
  path: path.resolve(process.cwd(), "../.env"),
});

const COLLECTION_NAME = "ai_diary";
const VECTOR_DIM = 1024;

const model = new ChatOpenAI({
  temperature: 0.7,
  modelName: process.env.MODEL_NAME || "undefined",
  apiKey: process.env.OPENAI_API_KEY,
  configuration: {
    baseURL: process.env.OPENAI_BASE_URL,
  },
});

const embeddings = new OpenAIEmbeddings({
  apiKey: process.env.OPENAI_API_KEY,
  model: process.env.EMBEDDINGS_MODEL_NAME,
  configuration: {
    baseURL: process.env.OPENAI_BASE_URL,
  },
  dimensions: VECTOR_DIM,
});

const client = new MilvusClient({
  address: "localhost:19530",
});

async function getEmbedding(text) {
  const result = await embeddings.embedQuery(text);
  return result;
}

async function retrieveRelevantDiaries(question, k = 2) {
  try {
    const queryVector = await getEmbedding(question);
    const searchResult = await client.search({
      collection_name: COLLECTION_NAME,
      vector: queryVector,
      limit: k,
      metric_type: MetricType.COSINE,
      output_fields: ["id", "content", "date", "mood", "tags"],
    });
    return searchResult.results;
  } catch (error) {
    console.error("Failed to retrieve data:", error);
  }
}

async function answerQuestion(question, k = 2) {
  console.log(`====Question====: ${question}`);
  // 1. 检索相关日记
  const relatedDiaries = await retrieveRelevantDiaries(question, k);
  if (!relatedDiaries.length) {
    console.log("No any related diaries");
    return "No any related diaries";
  }

  // 2. 打印检索到的日记及相似度
  relatedDiaries.forEach((diary, i) => {
    console.log(`\n[日记 ${i + 1}] 相似度: ${diary.score.toFixed(4)}`);
    console.log(`日期: ${diary.date}`);
    console.log(`心情: ${diary.mood}`);
    console.log(`标签: ${diary.tags?.join(", ")}`);
    console.log(`内容: ${diary.content}`);
  });

  // 3. 构建上下文
  const context = relatedDiaries
    .map((diary, i) => {
      return `[日记 ${i + 1}]
日期: ${diary.date}
心情: ${diary.mood}
标签: ${diary.tags?.join(", ")}
内容: ${diary.content}`;
    })
    .join("\n\n━━━━━\n\n");

  // 4. 构建并增强 prompt
  const prompt = `你是一个温暖贴心的 AI 日记助手。基于用户的日记内容回答问题，用亲切自然的语言。

请根据以下日记内容回答问题：
${context}

用户问题: ${question}

回答要求：
1. 如果日记中有相关信息，请结合日记内容给出详细、温暖的回答
2. 可以总结多篇日记的内容，找出共同点或趋势
3. 如果日记中没有相关信息，请温和地告知用户
4. 用第一人称"你"来称呼日记的作者
5. 回答要有同理心，让用户感到被理解和关心

AI 助手的回答:`;

  // 5. 调用 LLM 生成回答
  console.log("\n【AI 回答】");
  const response = await model.invoke(prompt);
  console.log(response.content);
  console.log("\n");

  return response.content;
}

async function main() {
  try {
    console.log('连接到 Milvus...');
    await client.connectPromise;
    console.log('✓ 已连接\n');

    await answerQuestion("我最近做了什么让我感到快乐的事情？", 2);
  } catch (error) {
    console.error('错误:', error.message);
  }
}

main();