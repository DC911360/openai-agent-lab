import { webFetchTool } from "./web-fetch/tools.js";
import { getCityCoordinatesTool } from './get-city-coordinates/tool.js';
import { getWeatherTool } from './get-weather/tool.js';

import { registerTool,getToolDefinitions,getToolDefinitionsMap } from "./registry.js";
export function initializeTools() {
  // 注册网页抓取工具
  registerTool(webFetchTool);
  registerTool(getCityCoordinatesTool);
  registerTool(getWeatherTool);



  console.log("[Tools] 工具初始化完成");
  console.log("getToolDefinitions=>",getToolDefinitions())
}
