import { Tool } from "../too.type.js";
import type { GetWeatherInput, GetWeatherResult } from "../too.type.js";
import { getWeatherToolDefinition } from "./definition.js";
import { getWeather } from "./get-weather.js";

export const getWeatherTool:Tool<GetWeatherInput,GetWeatherResult> = {
    definition: getWeatherToolDefinition,
    execute:getWeather
}