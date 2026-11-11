import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { getCityCoordinates } from "./get-city-coordinates.js";
import { getCityCoordinatesDefinition } from "./definition.js";

const originalFetch = globalThis.fetch;

const INPUT = { city: "北京" };

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("请求正确的 URL 并返回解析后的经纬度", async () => {
  const requested: string[] = [];

  globalThis.fetch = (async (input: string | URL | Request) => {
    requested.push(String(input));
    return new Response(
      JSON.stringify({
        results: [
          {
            latitude: 39.90469,
            longitude: 116.40717,
            name: "北京",
            country: "中国",
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;

  const result = await getCityCoordinates(INPUT);

  assert.equal(requested.length, 1);

  const url = new URL(requested[0]!);
  assert.equal(
    url.origin + url.pathname,
    "https://geocoding-api.open-meteo.com/v1/search",
  );
  assert.equal(url.searchParams.get("name"), "北京");
  assert.ok(
    url.search.includes(`name=${encodeURIComponent("北京")}`),
    "城市名应该经过 encodeURIComponent 编码",
  );
  assert.equal(url.searchParams.get("count"), "1");
  assert.equal(url.searchParams.get("language"), "zh");
  assert.equal(url.searchParams.get("format"), "json");

  assert.deepEqual(result, { latitude: 39.90469, longitude: 116.40717 });
  assert.equal(typeof result.latitude, "number");
  assert.equal(typeof result.longitude, "number");
});

test("没有匹配结果时 reject", async () => {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ results: [] }), {
      status: 200,
    })) as typeof fetch;

  await assert.rejects(
    getCityCoordinates(INPUT),
    /No coordinates found for city: 北京/,
  );
});

test("HTTP 状态非 2xx 时 reject", async () => {
  globalThis.fetch = (async () =>
    new Response("oops", { status: 500 })) as typeof fetch;

  await assert.rejects(getCityCoordinates(INPUT), /HTTP error! status: 500/);
});

test("fetch 抛错时原样 reject", async () => {
  globalThis.fetch = (async () => {
    throw new Error("network down");
  }) as typeof fetch;

  await assert.rejects(getCityCoordinates(INPUT), /network down/);
});

test("响应不是合法 JSON 时 reject", async () => {
  globalThis.fetch = (async () =>
    new Response("not json", { status: 200 })) as typeof fetch;

  await assert.rejects(getCityCoordinates(INPUT));
});

test("required 参数都必须在 properties 中定义", () => {
  const { parameters } = getCityCoordinatesDefinition.function;

  for (const key of parameters.required) {
    assert.ok(
      key in parameters.properties,
      `required 参数 ${key} 缺少 properties 定义`,
    );
  }
});
