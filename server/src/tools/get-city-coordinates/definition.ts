import { ToolDefinition,GetCityCoordinatesInput,GetCityCoordinatesResult } from  '../too.type.js';


export const getCityCoordinatesDefinition:ToolDefinition = {
    type: "function",
    function:{
        name: "get_city_coordinates",
        description: "获取指定城市的经纬度信息",
        parameters: {
            type: "object",
            properties: {
                city: {
                    type: "string",
                    description: "城市名称",
                },
            },
            required: ["city"],
            additionalProperties: false,
        },  
    }
}