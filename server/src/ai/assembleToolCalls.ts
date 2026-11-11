import type { LlmToolCall } from "./ai.types.js";

export interface ToolCallChunk {
  index: number;
  id?: string;
  type?: "function";
  function?: {
    name?: string;
    arguments?: string;
  };
}

/****
 * 参考数据：
 *  [{"index":0,"id":"call_00_02nrOrHq4W8ZKtcAbEzV5115","type":"function","function":{"name":"web_fetch","arguments":""}}]
 *  [{"index":0,"function":{"arguments":"{\""}}]
 * [{"index":0,"function":{"arguments":"url"}}]
 * [{"index":0,"function":{"arguments":"\""}}]
 * [{"index":0,"function":{"arguments":": \""}}]
 * [{"index":0,"function":{"arguments":"https"}}]
 * [{"index":0,"function":{"arguments":"://"}}]
 * [{"index":0,"function":{"arguments":"zh"}}]
 * [{"index":0,"function":{"arguments":"uan"}}]
 * [{"index":0,"function":{"arguments":"lan"}}]
 * [{"index":0,"function":{"arguments":"."}}]
 * [{"index":0,"function":{"arguments":"zh"}}]
 * [{"index":0,"function":{"arguments":"ihu"}}]
 * [{"index":0,"function":{"arguments":".com"}}]
 * [{"index":0,"function":{"arguments":"/p"}}]
 * [{"index":0,"function":{"arguments":"/"}}]
 * [{"index":0,"function":{"arguments":"206"}}]
 * [{"index":0,"function":{"arguments":"911"}}]
 * [{"index":0,"function":{"arguments":"187"}}]
 * [{"index":0,"function":{"arguments":"316"}}]
 * [{"index":0,"function":{"arguments":"165"}}]
 * [{"index":0,"function":{"arguments":"605"}}]
 * [{"index":0,"function":{"arguments":"6"}}]
 * [{"index":0,"function":{"arguments":"\""}}]
 * [{"index":0,"function":{"arguments":"}"}}]
 */
export function assembleToolCalls(
  chunks: ToolCallChunk[],
): LlmToolCall[] {
  const toolCalls = new Map<
    number,
    {
      id: string;
      type: "function";
      name: string;
      arguments: string;
    }
  >();

  for (const chunk of chunks) {
    const index = chunk.index;

    if (!toolCalls.has(index)) {
      toolCalls.set(index, {
        id: "",
        type: "function",
        name: "",
        arguments: "",
      });
    }

    const current = toolCalls.get(index)!;

    if (chunk.id) {
      current.id = chunk.id;
    }

    if (chunk.type) {
      current.type = chunk.type;
    }

    if (chunk.function?.name) {
      current.name += chunk.function.name;
    }

    if (chunk.function?.arguments) {
      current.arguments += chunk.function.arguments;
    }
  }

  // arguments 保持模型返回的原始 JSON 字符串，直接用于 assistant.tool_calls；
  // 执行工具时再解析，避免来回 JSON.parse / JSON.stringify。
  return Array.from(toolCalls.values()).map(
    (item): LlmToolCall => ({
      id: item.id,
      type: "function",
      function: {
        name: item.name,
        arguments: item.arguments,
      },
    }),
  );
}
