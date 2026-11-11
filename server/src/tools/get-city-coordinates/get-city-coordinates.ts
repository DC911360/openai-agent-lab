import { GetCityCoordinatesInput, GetCityCoordinatesResult } from "../too.type.js";

/** Open-Meteo Geocoding API 的响应结构 */
type OpenMeteoGeocodingResponse = {
  results?: Array<{
    latitude: number;
    longitude: number;
    name?: string;
    country?: string;
  }>;
};

export function getCityCoordinates(
  input: GetCityCoordinatesInput,
): Promise<GetCityCoordinatesResult> {
  return new Promise((resolve, reject) => {
    const { city } = input;
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=zh&format=json`;

    fetch(url)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.json();
      })
      .then((data) => {
        const first = (data as OpenMeteoGeocodingResponse).results?.[0];

        if (!first) {
          reject(new Error(`No coordinates found for city: ${city}`));
          return;
        } 

        resolve({
          latitude: first.latitude,
          longitude: first.longitude,
        });
      })
      .catch((error) => {
        reject(error);
      });
  });
}
