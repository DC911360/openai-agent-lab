
export interface parametersType {
    // JSON Schema 允许任意扩展字段，同时满足 OpenAI 的 FunctionParameters 索引签名要求
    [key:string]: unknown,
    type:string,
    properties:{
        [key:string]:{
            type:string,
            description:string,
            enum?:string[]
        }
    }
    required:string[],
    additionalProperties:boolean
}
/***
 * 工具定义： 提供给模型识别和调用
 */
export interface ToolDefinition {
    type:"function",
    function:{
        name:string,
        description:string,
        parameters: parametersType;
    }
}

/***
 * 工具：由共工具定义和执行函数组成
 */

export interface Tool<TInput = unknown, TResult = unknown>{
    definition:ToolDefinition,
    execute:(input:TInput)=>Promise<TResult>
}


/***
 * 定义天气输入
 */
export interface GetWeatherInput {
    latitude: number,
    longitude: number,
}

/***
 * 定义天气输出
 */
export interface GetWeatherResult {
    [props: string]: unknown   
}

/***
 * 定义城市转经纬度输入
 */
export interface GetCityCoordinatesInput {
    city: string,
}

/***
 * 定义城市转经纬度输出
 */
export interface GetCityCoordinatesResult {
    latitude : number,
    longitude: number,
    [props: string]: unknown   
}
