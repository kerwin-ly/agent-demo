import { ChatOpenAI } from "@langchain/openai";
import dotenv from "dotenv";
import path from "path";
import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { HumanMessage, ToolMessage } from "@langchain/core/messages";
import chalk from "chalk";

dotenv.config({
  path: path.resolve(process.cwd(), "../../.env"),
});

const model = new ChatOpenAI({
  modelName: process.env.MODEL_NAME || "undefined",
  apiKey: process.env.OPENAI_API_KEY,
  configuration: {
    baseURL: process.env.OPENAI_BASE_URL,
  },
});

const mcpClient = new MultiServerMCPClient({
  mcpServers: {
    "my-mcp-server": {
      command: "node",
      args: [
        "/Users/kerwin/Desktop/git-project/agent-demo/tool-test/src/my-mcp-server.mjs",
      ],
    },
    "amap-maps-streamableHTTP": {
      url: "https://mcp.amap.com/mcp?key=" + process.env.AMAP_MAPS_API_KEY,
    },
    filesystem: {
      command: "npx",
      args: [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        ...["/Users/kerwin/Desktop/git-project/agent-demo"],
      ],
    },
    "chrome-devtools": {
      command: "npx",
      args: ["-y", "chrome-devtools-mcp@latest"],
    },
  },
});

const tools = await mcpClient.getTools();
const modelWithTools = model.bindTools(tools);

async function runAgentWithTools(query, maxIterations = 30) {
  const messages = [new HumanMessage(query)];

  for (let i = 0; i < maxIterations; i++) {
    const response = await modelWithTools.invoke(messages);
    messages.push(response);

    if (!response.tool_calls || response.tool_calls.length === 0) {
      console.log("Final response:", response.content);
      return response.content;
    }

    console.log(
      chalk.bgBlue("Detected tool calls:"),
      response.tool_calls.length,
    );
    console.log(
      chalk.bgBlue("Tool calls:"),
      response.tool_calls.map((t) => t.name).join(),
    );

    for (const toolCall of response.tool_calls) {
      const foundTool = tools.find((t) => t.name === toolCall.name);
      if (foundTool) {
        const toolResult = await foundTool.invoke(toolCall.args);

        // 确保 content 是字符串类型
        let contentStr;
        if (typeof toolResult === "string") {
          contentStr = toolResult;
        } else if (toolResult && toolResult.text) {
          // 如果返回对象有 text 字段，优先使用
          contentStr = toolResult.text;
        }
        messages.push(
          new ToolMessage({
            content: contentStr,
            tool_call_id: toolCall.id,
          }),
        );
      } else {
        console.warn(chalk.bgRed(`Tool ${toolCall.name} not found`));
      }
    }
  }

  return messages[messages.length - 1].content;
}

const query =
  "北京南站附近的酒店，最近的 3 个酒店，拿到酒店图片，打开浏览器，展示每个酒店的图片，每个 tab 一个 url 展示，并且在把那个页面标题改为酒店名";
const result = await runAgentWithTools(query);
console.log(chalk.bgGreen("Final result:"), result);
