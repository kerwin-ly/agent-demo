// client.insert
import dotenv from "dotenv";
import path from "path";
import {
  MilvusClient,
  DataType,
  MetricType,
  IndexType,
} from "@zilliz/milvus2-sdk-node";
import { OpenAIEmbeddings } from "@langchain/openai";

dotenv.config({
  path: path.resolve(process.cwd(), "../.env"),
});

const COLLECTION_NAME = "ai_diary";
const VECTOR_DIM = 1024;

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

async function main() {
  try {
    console.log("Connecting to Milvus...");
    await client.connectPromise;
    console.log("✓ Connected\n");

    // 创建集合(table)
    console.log("Creating collection...");
    await client.createCollection({
      collection_name: COLLECTION_NAME,
      fields: [
        {
          name: "id",
          data_type: DataType.VarChar,
          max_length: 50,
          is_primary_key: true,
        },
        { name: "vector", data_type: DataType.FloatVector, dim: VECTOR_DIM },
        { name: "content", data_type: DataType.VarChar, max_length: 5000 },
        { name: "date", data_type: DataType.VarChar, max_length: 50 },
        { name: "mood", data_type: DataType.VarChar, max_length: 50 },
        {
          name: "tags",
          data_type: DataType.Array,
          element_type: DataType.VarChar,
          max_capacity: 10,
          max_length: 50,
        },
      ],
    });
    console.log("Collection created");

    // 创建索引
    console.log("\nCreating index...");
    await client.createIndex({
      collection_name: COLLECTION_NAME,
      field_name: "vector",
//       IVF 会先把数据分成很多个 cluster：

//                  Vector Space

//        ┌─────────┬─────────┬─────────┐
//        │ Cluster │ Cluster │ Cluster │
//        │    1    │    2    │    3    │
//        ├─────────┼─────────┼─────────┤
//        │ Cluster │ Cluster │ Cluster │
//        │    4    │    5    │    6    │
//        ├─────────┼─────────┼─────────┤
//        │ Cluster │ Cluster │ Cluster │
//        │    7    │    8    │    9    │
//        └─────────┴─────────┴─────────┘

// 查询的时候：

// Query
//   ↓
// 先判断 Query 属于哪些 Cluster
//   ↓
// 只搜索这些 Cluster
//   ↓
// 得到 Top K
      index_type: IndexType.IVF_FLAT, // 不要每次搜索都把所有向量拿出来比较，而是先把向量空间分成很多个区域，搜索的时候只搜索相关区域。
      metric_type: MetricType.COSINE, // 通过余弦相似度计算检索相关性
      params: { nlist: 1024 }, // IVF_FLAT 把整个向量空间划分成多少个 cluster / cell
    });
    console.log("Index created");

    // 加载集合
    console.log("\nLoading collection...");
    await client.loadCollection({ collection_name: COLLECTION_NAME });
    console.log("Collection loaded");

    // 插入日记数据
    console.log("\nInserting diary entries...");
    const diaryContents = [
      {
        id: "diary_001",
        content:
          "今天天气很好，去公园散步了，心情愉快。看到了很多花开了，春天真美好。",
        date: "2026-01-10",
        mood: "happy",
        tags: ["生活", "散步"],
      },
      {
        id: "diary_002",
        content:
          "今天工作很忙，完成了一个重要的项目里程碑。团队合作很愉快，感觉很有成就感。",
        date: "2026-01-11",
        mood: "excited",
        tags: ["工作", "成就"],
      },
      {
        id: "diary_003",
        content:
          "周末和朋友去爬山，天气很好，心情也很放松。享受大自然的感觉真好。",
        date: "2026-01-12",
        mood: "relaxed",
        tags: ["户外", "朋友"],
      },
      {
        id: "diary_004",
        content:
          "今天学习了 Milvus 向量数据库，感觉很有意思。向量搜索技术真的很强大。",
        date: "2026-01-12",
        mood: "curious",
        tags: ["学习", "技术"],
      },
      {
        id: "diary_005",
        content:
          "晚上做了一顿丰盛的晚餐，尝试了新菜谱。家人都说很好吃，很有成就感。",
        date: "2026-01-13",
        mood: "proud",
        tags: ["美食", "家庭"],
      },
    ];

    console.log("Generating embeddings...");
    const diaryData = await Promise.all(
      diaryContents.map(async (diary) => ({
        ...diary,
        vector: await getEmbedding(diary.content), // 把content向量化存入到向量数据库中
      })),
    );

    const insertResult = await client.insert({
      collection_name: COLLECTION_NAME,
      data: diaryData,
    });
    console.log(`✓ Inserted ${insertResult.insert_cnt} records\n`);
  } catch (error) {
    console.error("Error:", error.message);
  }
}

main();
