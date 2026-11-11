import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { getWeather } from "./get-weather.js";
import { getWeatherToolDefinition } from "./definition.js";

const originalFetch = globalThis.fetch;

const INPUT = {
  latitude: 39.9042,
  longitude: 116.4074,
};

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("请求正确的 URL 并返回解析后的 JSON", async () => {
  const requested: string[] = [];

  globalThis.fetch = (async (input: string | URL | Request) => {
    requested.push(String(input));
    return new Response(
      JSON.stringify({ current: { temperature_2m: 23.5 } }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;

  const result = await getWeather(INPUT);

  assert.equal(requested.length, 1);

  const url = new URL(requested[0]!);
  assert.equal(
    url.origin + url.pathname,
    "https://api.open-meteo.com/v1/forecast",
  );
  assert.equal(url.searchParams.get("latitude"), "39.9042");
  assert.equal(url.searchParams.get("longitude"), "116.4074");
  assert.equal(
    url.searchParams.get("current"),
    "temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m",
  );
  assert.equal(
    url.searchParams.get("daily"),
    "weather_code,temperature_2m_max,temperature_2m_min",
  );
  assert.equal(url.searchParams.get("timezone"), "Asia/Shanghai");
  assert.equal(url.searchParams.get("forecast_days"), "1");

  assert.deepEqual(result, { current: { temperature_2m: 23.5 } });
});

test("HTTP 状态非 2xx 时 reject", async () => {
  globalThis.fetch = (async () =>
    new Response("oops", { status: 500 })) as typeof fetch;

  await assert.rejects(
    getWeather(INPUT),
    /HTTP error! status: 500/,
  );
});

test("fetch 抛错时原样 reject", async () => {
  globalThis.fetch = (async () => {
    throw new Error("network down");
  }) as typeof fetch;

  await assert.rejects(getWeather(INPUT), /network down/);
});

test("响应不是合法 JSON 时 reject", async () => {
  globalThis.fetch = (async () =>
    new Response("not json", { status: 200 })) as typeof fetch;

  await assert.rejects(getWeather(INPUT));
});

test("required 参数都必须在 properties 中定义", () => {
  const { parameters } = getWeatherToolDefinition.function;

  for (const key of parameters.required) {
    assert.ok(
      key in parameters.properties,
      `required 参数 ${key} 缺少 properties 定义`,
    );
  }
});
