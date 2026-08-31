import dotenv from "dotenv";
import path from "path";
import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import { CheerioWebBaseLoader } from "@langchain/community/document_loaders/web/cheerio";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { MemoryVectorStore } from "@langchain/classic/vectorstores/memory";

dotenv.config({
  path: path.resolve(process.cwd(), "../.env"),
});
const model = new ChatOpenAI({
  modelName: process.env.MODEL_NAME || "undefined",
  apiKey: process.env.OPENAI_API_KEY,
  configuration: {
    baseURL: process.env.OPENAI_BASE_URL,
  },
});
const embeddings = new OpenAIEmbeddings({
  modelName: process.env.EMBEDDINGS_MODULE_NAME || "undefined",
  apiKey: process.env.OPENAI_API_KEY,
  configuration: {
    baseURL: process.env.OPENAI_BASE_URL,
  },
});

const cheerioLoader = new CheerioWebBaseLoader(
  "https://juejin.cn/post/7233327509919547452",
  {
    selector: ".main-area p",
  },
);

const documents = await cheerioLoader.load();

const textSplitter = new RecursiveCharacterTextSplitter({
  chunkSize: 400, // 每个分块的字符数
  chunkOverlap: 50, // 分块之间的重叠字符数
  separators: ["。", "！", "？"], // 分割符，优先使用段落分隔
});

const splitDocuments = await textSplitter.splitDocuments(documents);

console.log(`文档分割完成，共 ${splitDocuments.length} 个分块\n`);

console.log("正在创建向量存储...");

const vectorStore = await MemoryVectorStore.fromDocuments(
  splitDocuments,
  embeddings,
);


console.log("向量存储创建完成\n");

const questions = ["父亲的去世对作者的人生态度产生了怎样的根本性逆转？"];

for (let question of questions) {
  // 使用 similaritySearchWithScore 获取文档和相似度评分
  const scoredResults = await vectorStore.similaritySearchVectorWithScore(
    question,
    2,
  );
  // 从 scoredResults 中提取文档和评分
  const retrievedDocs = scoredResults.map(([doc]) => doc);
  // 构建 prompt
  const context = retrievedDocs
    .map((doc, i) => `[片段${i + 1}\n]${doc.pageContent}`)
    .join("\n\n----\n\n");
    console.log('context', context)
  const prompt = `你是一个文章辅助阅读助手，根据文章内容来解答：

文章内容：
${context}

问题: ${question}

你的回答:`;

  console.log("\n【AI 回答】");
  const response = await model.invoke(prompt);
  console.log(response.content);
  console.log("\n");
}
