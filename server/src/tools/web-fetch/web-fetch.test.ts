import {  webFetch } from './web-fetch.js'

async function main() {
  const result = await webFetch({
    url: "https://zhuanlan.zhihu.com/p/25964484",
    render: "browser",
  });

  console.log("抓取方式：", result.renderMode);
  console.log("网页标题：", result.title);
  console.log("HTTP 状态码：", result.status);
  console.log("网页内容：", result.content);
  console.log("result", JSON.stringify(result.title));
}

main().catch(console.error);