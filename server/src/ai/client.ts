import OpenAI from "openai";
import { env } from "../config/env.js";

/** 全进程共享一个 SDK Client，避免每个请求重复初始化连接池。 */
export const aiClient = new OpenAI({
  baseURL: env.deepseekBaseURL,
  apiKey: env.deepseekApiKey,
  // SDK 默认超时较长且会自动重试；显式限制，避免请求长时间挂起
  timeout: env.deepseekTimeoutMs,
  maxRetries: env.deepseekMaxRetries,
});
