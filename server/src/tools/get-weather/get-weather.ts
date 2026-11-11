import type { GetWeatherInput, GetWeatherResult } from "../too.type.js";
export function getWeather(input: GetWeatherInput): Promise<GetWeatherResult> {
  return new Promise((resolve, reject) => {
    const { latitude, longitude } = input;
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=Asia%2FShanghai&forecast_days=1`;

    fetch(url)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.json();
      })
      .then((data) => {
        console.log("getWeather data:", data); // Log the data for debugging
        resolve(data);
      })
      .catch((error) => {
        reject(error);
      });
  });
}
