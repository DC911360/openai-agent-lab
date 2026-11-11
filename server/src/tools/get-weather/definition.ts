/*
  https://api.open-meteo.com/v1/forecast
  ?latitude=39.9042
  &longitude=116.4074
  &current=temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m
  &daily=weather_code,temperature_2m_max,temperature_2m_min
  &timezone=Asia%2FShanghai
  &forecast_days=1

  参数说明：
latitude=39.9042：纬度，这里指的是北京的纬度。
longitude=116.4074：经度，这里指的是北京的经度。
current
temperature_2m：地面以上 2 米处的空气温度。
relative_humidity_2m：地面以上 2 米处的相对湿度。
precipitation：降水量（通常指请求时刻前一段时间的总和）。
weather_code：WMO 天气状况代码，用数字代表晴、雨、雪等。
wind_speed_10m：地面以上 10 米处的风速。

daily
weather_code：当天的整体天气状况代码。
temperature_2m_max：当天的最高气温。
temperature_2m_min：当天的最低气温。

timezone
设置返回数据使用的时区为北京时间。这对于正确划分“今天”的起止时间至关重要

forecast_days=1
将预报天数限制为 1 天。如果不加这个参数，API 默认会返回 7 天的预报数据。加上它，就只会返回“今天”这一天的数据。
*/

import { ToolDefinition } from "../too.type.js";

export const getWeatherToolDefinition:ToolDefinition = {
  type: "function",
  function: {
    name: "get_weather",
    description:
      "获取指定城市的天气信息，包括当前温度、湿度、降水量、风速，以及当天的最高和最低气温。",
    parameters: {
      type: "object",
      properties: {
        latitude: {
          type:  "number",
          description: "纬度 目标城市的纬度",
        },
        longitude: {
          type:  "number",
          description: "经度 目标城市的经度",
        },
      },
      required: ["latitude","longitude"],
      additionalProperties: false,
    },
  },
} as const; 