const SERVER_INFO = { name: "bilibili-mcp", version: "1.0.0" };

const TOOLS = [
  {
    name: "get_video_info",
    description: "获取 B 站视频的标题、UP 主、简介、统计数据和 BV 号。",
    inputSchema: {
      type: "object",
      properties: { url: { type: "string", description: "B 站视频 URL 或 BV 号" } },
      required: ["url"]
    }
  },
  {
    name: "get_subtitles",
    description: "读取 B 站视频可用字幕；没有字幕时返回说明。",
    inputSchema: {
      type: "object",
      properties: { url: { type: "string", description: "B 站视频 URL 或 BV 号" } },
      required: ["url"]
    }
  },
  {
    name: "get_danmaku",
    description: "获取 B 站视频的部分弹幕，默认最多返回 100 条。",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "B 站视频 URL 或 BV 号" },
        limit: { type: "number", description: "最多返回条数，1 到 300" }
      },
      required: ["url"]
    }
  },
  {
    name: "get_comments",
    description: "获取 B 站视频第一页评论。",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "B 站视频 URL 或 BV 号" },
        page: { type: "number", description: "页码，默认 1" }
      },
      required: ["url"]
    }
  },
  {
    name: "list_favorite_folders",
    description: "列出小号创建的 B 站收藏夹。需要 Cloudflare Secrets。",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "create_favorite_folder",
    description: "创建一个私密 B 站收藏夹。需要 Cloudflare Secrets。",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "收藏夹名称" },
        intro: { type: "string", description: "收藏夹简介" }
      },
      required: ["title"]
    }
  },
  {
    name: "save_video_to_folder",
    description: "把视频收藏到指定收藏夹。需要 Cloudflare Secrets；调用前请确认收藏夹和视频。",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "B 站视频 URL 或 BV 号" },
        media_id: { type: "number", description: "目标收藏夹的完整 media_id" }
      },
      required: ["url", "media_id"]
    }
  }
];

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "mcp-protocol-version": "2025-03-26",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version",
      "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
      ...extra
    }
  });
}

function text(value, status = 200) {
  return new Response(value, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", "access-control-allow-origin": "*" }
  });
}

function rpcResult(id, result) { return { jsonrpc: "2.0", id, result }; }
function rpcError(id, code, message) { return { jsonrpc: "2.0", id, error: { code, message } }; }

function getBvid(value) {
  const match = String(value || "").match(/BV[0-9A-Za-z]+/i);
  if (!match) throw new Error("没有识别到 BV 号");
  return match[0];
}

async function api(path, params = {}, init = {}) {
  const url = new URL(`https://api.bilibili.com${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, {
    ...init,
    headers: { "user-agent": "Mozilla/5.0", accept: "application/json", ...(init.headers || {}) }
  });
  if (!response.ok) throw new Error(`B 站 HTTP ${response.status}`);
  const data = await response.json();
  if (data.code !== 0) throw new Error(`B 站接口错误 ${data.code}: ${data.message || "未知错误"}`);
  return data.data;
}

async function videoInfo(input) {
  const bvid = getBvid(input);
  return api("/x/web-interface/view", { bvid });
}

function cookieHeaders(env) {
  if (!env.BILI_SESSDATA || !env.BILI_CSRF) {
    throw new Error("尚未配置 BILI_SESSDATA 和 BILI_CSRF 两个 Cloudflare Secret");
  }
  return {
    cookie: `SESSDATA=${env.BILI_SESSDATA}; bili_jct=${env.BILI_CSRF}`,
    referer: "https://www.bilibili.com/"
  };
}

async function authApi(path, params, env, method = "GET") {
  const headers = cookieHeaders(env);
  if (method === "GET") return api(path, params, { headers });
  const body = new URLSearchParams(params);
  return api(path, {}, { method: "POST", headers: { ...headers, "content-type": "application/x-www-form-urlencoded" }, body });
}

async function subtitles(input) {
  const info = await videoInfo(input);
  const list = info.subtitle?.list || [];
  if (!list.length) return { bvid: info.bvid, message: "这个视频没有可用字幕。" };
  const result = [];
  for (const item of list.slice(0, 3)) {
    const subtitleUrl = item.subtitle_url.startsWith("//") ? `https:${item.subtitle_url}` : item.subtitle_url;
    const response = await fetch(subtitleUrl);
    const data = await response.json();
    result.push({ lan: item.lan, lan_doc: item.lan_doc, text: (data.body || []).map(x => ({ from: x.from, to: x.to, content: x.content })) });
  }
  return { bvid: info.bvid, subtitles: result };
}

async function danmaku(input, limit = 100) {
  const info = await videoInfo(input);
  const response = await fetch(`https://api.bilibili.com/x/v1/dm/list.so?oid=${info.cid}`);
  const xml = await response.text();
  const messages = [...xml.matchAll(/<d p="([^"]*)">([\s\S]*?)<\/d>/g)].map(match => {
    const parts = match[1].split(",");
    return { time: Number(parts[0]) || 0, mode: Number(parts[1]) || 1, text: match[2] };
  });
  return { bvid: info.bvid, count: messages.length, danmaku: messages.slice(0, Math.min(Math.max(Number(limit) || 100, 1), 300)) };
}

async function comments(input, page = 1) {
  const info = await videoInfo(input);
  const data = await api("/x/v2/reply", { type: 1, oid: info.aid, pn: Math.max(Number(page) || 1, 1), ps: 20, sort: 2 });
  return {
    bvid: info.bvid,
    page: Number(page) || 1,
    comments: (data.replies || []).map(item => ({
      rpid: item.rpid,
      user: item.member?.uname,
      like: item.like,
      content: item.content?.message,
      time: item.ctime
    }))
  };
}

async function listFolders(env) {
  const nav = await authApi("/x/web-interface/nav", {}, env);
  const data = await authApi("/x/v3/fav/folder/created/list-all", { up_mid: nav.mid, type: 2 }, env);
  return { mid: nav.mid, folders: (data.list || []).map(folder => ({ id: folder.id, title: folder.title, private: Boolean(folder.attr & 1), media_count: folder.media_count })) };
}

async function createFolder(args, env) {
  const data = await authApi("/x/v3/fav/folder/add", { title: args.title, intro: args.intro || "", privacy: 1, csrf: env.BILI_CSRF }, env, "POST");
  return { message: "已创建私密收藏夹", folder: { id: data.id, title: data.title, private: true } };
}

async function saveVideo(args, env) {
  const info = await videoInfo(args.url);
  const data = await authApi("/x/v3/fav/resource/deal", {
    rid: info.aid,
    type: 2,
    add_media_ids: args.media_id,
    del_media_ids: "",
    platform: "web",
    csrf: env.BILI_CSRF
  }, env, "POST");
  return { message: "已收藏视频", bvid: info.bvid, title: info.title, media_id: args.media_id, data };
}

async function callTool(name, args, env) {
  switch (name) {
    case "get_video_info": return await videoInfo(args.url);
    case "get_subtitles": return await subtitles(args.url);
    case "get_danmaku": return await danmaku(args.url, args.limit);
    case "get_comments": return await comments(args.url, args.page);
    case "list_favorite_folders": return await listFolders(env);
    case "create_favorite_folder": return await createFolder(args, env);
    case "save_video_to_folder": return await saveVideo(args, env);
    default: throw new Error(`未知工具: ${name}`);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version", "access-control-allow-methods": "GET, POST, DELETE, OPTIONS" } });
    if (url.pathname !== "/mcp") return text("MCP server is running. Use /mcp");
    if (request.method === "GET") return text("MCP endpoint is ready.");
    if (request.method !== "POST") return text("Method Not Allowed", 405);

    let message;
    try { message = await request.json(); } catch { return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Invalid JSON" } }, 400); }
    if (message.method === "notifications/initialized") return new Response(null, { status: 202 });

    try {
      let result;
      if (message.method === "initialize") result = rpcResult(message.id, { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: SERVER_INFO });
      else if (message.method === "ping") result = rpcResult(message.id, {});
      else if (message.method === "tools/list") result = rpcResult(message.id, { tools: TOOLS });
      else if (message.method === "tools/call") {
        const value = await callTool(message.params?.name, message.params?.arguments || {}, env);
        result = rpcResult(message.id, { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] });
      } else result = rpcError(message.id, -32601, `Method not found: ${message.method}`);
      return json(result);
    } catch (error) {
      return json(rpcResult(message.id, { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : "请求失败" }] }));
    }
  }
};
