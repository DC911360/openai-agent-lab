import type {Tool, ToolDefinition } from "./too.type.js";

/**
 * 工具注册表
 */

// 保存所有注册工具

const toolRegistry  = new Map<string,Tool<any,any>>();

/**
 * 注册工具
 */

export function registerTool(tool:Tool<any,any>){
    const name = tool.definition.function.name;
    if(toolRegistry.has(name)){
        throw new Error(`工具 ${name} 已经注册过了`);
    }
    toolRegistry.set(name,tool);

    console.log("toolRegistry=>",toolRegistry)
}


/***
 * 根据工具名称获取工具
 */

export function getTool(name:string): Tool<any,any> | undefined {
    return toolRegistry.get(name);
}


/***
 * 获取所有工具定义
 */

export function getToolDefinitions(): ToolDefinition[] {
    return Array.from(toolRegistry.values()).map(tool => tool.definition);
}


/***
 * 获取所有工具定义 映射结构
 */
export function getToolDefinitionsMap(): Record<string, ToolDefinition> {
    const definitionsMap: Record<string, ToolDefinition> = {};
    for (const [name, tool] of toolRegistry.entries()) {
        definitionsMap[name] = tool.definition;
    }
    return definitionsMap;
}   