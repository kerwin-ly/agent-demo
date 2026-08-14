import { ChatOpenAI } from '@langchain/openai';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({
  path: path.resolve(process.cwd(), '../../.env')
});

const model = new ChatOpenAI({
  modelName: process.env.MODEL_NAME || 'undefined',
  apiKey: process.env.OPENAI_API_KEY,
  configuration: {
    baseURL: process.env.OPENAI_BASE_URL
  }
})

const res = await model.invoke('introduce yourself')
console.log(res.content);