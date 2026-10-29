// 节点源拉取失败的原因一句话化。原文由 backend/src/providers/fetcher.ts / load.ts 生成,
// 改了那边的报错文案要回来对一下这里的匹配;匹配不上时退回原文第一句,不会丢信息。
// 卡片上只放这句短的,完整原文放 tooltip。

/**
 * 多条线路全失败时后端用「;」拼接每条线路的原因:`经 BP-QA: HTTP 403(...);直连: 请求超时`。
 * 单条原因里自己也可能带「;」(如 403 的提示),所以只在后面紧跟线路前缀的地方切。
 */
const ROUTE_SEPARATOR = /;(?=(?:经 .+?|直连|出口 .+?): )/;

export function splitFetchErrorRoutes(error: string): string[] {
  return error.split(ROUTE_SEPARATOR).map((p) => p.trim()).filter(Boolean);
}

function summarizeOne(raw: string): string {
  const msg = raw.trim();
  if (/未识别到任何节点|没解析出节点/.test(msg)) return "拿到了内容,但解析不出节点";
  if (/content 为空|返回空内容/.test(msg)) return "上游返回空内容";
  const http = /HTTP (\d{3})/.exec(msg);
  if (http) {
    const code = Number(http[1]);
    if (code === 401 || code === 403) return `上游拒绝了请求(HTTP ${code})`;
    if (code === 404) return "订阅地址不存在(HTTP 404)";
    if (code >= 500) return `上游出错(HTTP ${code})`;
    return `上游返回 HTTP ${code}`;
  }
  // SSH 的报错里也带「超时」「失败」,要先于下面的通用匹配
  if (/^SSH 登录/.test(msg)) return "出口机登录失败";
  if (/^SSH 连接|出口机拒绝转发/.test(msg)) return "连不上出口机";
  if (/超时/.test(msg)) return "请求超时";
  if (/ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|fetch failed/.test(msg)) return "连接失败";
  // 兜底:取到第一个句读或括号为止
  return msg.split(/[。;(]/)[0] || msg;
}

/** 去掉「经 xxx: / 直连: 」线路前缀,只留原因 */
function stripRoute(part: string): string {
  const m = /^(?:经 .+?|直连|出口 .+?): (.*)$/s.exec(part.trim());
  return m ? m[1] : part;
}

export function summarizeFetchError(error: string): string {
  const parts = splitFetchErrorRoutes(error);
  if (parts.length <= 1) return summarizeOne(stripRoute(error));
  // 最后一条是直连兜底,它的原因最能说明「最终为什么没拉到」;每条线路的细节看 tooltip
  return `${summarizeOne(stripRoute(parts[parts.length - 1]))} · ${parts.length} 条线路都失败`;
}
