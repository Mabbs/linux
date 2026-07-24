// SPDX-License-Identifier: MIT
//
// sw.js — 反向代理 service worker (标准 postMessage 通道版)
// ---------------------------------------------------------------------------
// 拦截 https://<host>/<站点目录>/http/<port>/<path> 形式的请求，通过 Service Worker 标准的
// client.postMessage 把请求发给运行着网关的终端页(index.html)；页面用 lwIP 栈去连 guest 真实
// IP:<port>，把 guest 内 HTTP 服务的响应流式 postMessage 回本 SW，再 respondWith 给浏览器。
//
// 为什么用标准 postMessage 而不是 BroadcastChannel / MessageChannel(port 转移)：
//   - MessageChannel 需要把 MessagePort 转移给页面(client.postMessage(meta,[port2]))，在部分
//     浏览器下 event.ports[0] 会为空、消息根本不送达 -> 页面收不到请求 -> SW 永远等不到回音。
//   - BroadcastChannel 在 SW<->页面这一跳在不少环境也不可靠(页面收不到 SW 广播)。
//   - 标准 postMessage 最稳：SW 用 self.clients.matchAll 找到终端页后 client.postMessage(请求)；
//     页面用 navigator.serviceWorker.getRegistration(<scope>).active.postMessage(响应) 回传，
//     双方都用普通对象(靠 requestId 配对)，不需要端口转移，所有现代浏览器都支持。
//
// 例：访问  https://<host>/<站点目录>/http/8080/foo?x=1
//   -> 网关连 guestIp:8080，发 GET /foo?x=1 HTTP/1.1，guest 响应被代理回浏览器。
//
// 作用域只注册在 <站点目录>/http/，避免与 coi-serviceworker(作用域为站点目录，负责跨源隔离头)冲突。
// 路径前缀不写死，从本 SW 脚本自身位置推导。
// ---------------------------------------------------------------------------

self.addEventListener("install", (event) => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

const SW_DIR = self.location.pathname.replace(/\/[^/]*$/, "/");
const PREFIX = SW_DIR + "http/";

// <站点目录>/http/<port>/<path> -> { port, path(含 query) }，非法则返回 null。
function parseTarget(url) {
  if (!url.pathname.startsWith(PREFIX)) return null;
  const rest = url.pathname.slice(PREFIX.length); // "<port>/<path>"
  const slash = rest.indexOf("/");
  const portStr = slash < 0 ? rest : rest.slice(0, slash);
  const path = slash < 0 ? "/" : rest.slice(slash); // 含前导 /
  const port = parseInt(portStr, 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;
  return { port, path: path + url.search };
}

const pending = new Map(); // id -> { finish, controllerRef, chunks, resolved, claimed, workerId }

// 页面经 navigator.serviceWorker.getRegistration(<scope>).active.postMessage 把响应发回这里。
self.addEventListener("message", (event) => {
  const d = event.data;
  if (!d || d.type !== "guest-proxy-resp") return;
  const ctx = pending.get(d.id);
  if (!ctx) return;
  if (d.error) {
    ctx.finish(new Response(d.error, { status: 502, headers: { "content-type": "text/plain; charset=utf-8" } }));
    return;
  }
  if (typeof d.status === "number") {
    if (ctx.claimed) return; // 多个网关页时只认第一个响应者，避免重复 chunk
    ctx.claimed = true;
    ctx.workerId = d.workerId;
    const hs = new Headers();
    for (const [k, v] of d.headers || []) { try { hs.set(k, v); } catch { } }
    // 页面随 status 一并发来完整 body(Uint8Array)：直接构造定长响应，最稳，
    // 浏览器拿到明确 Content-Length 即知 body 何时结束，绝不转圈。
    if (d.body) {
      const b = d.body instanceof Uint8Array ? d.body : new Uint8Array(d.body && d.body.byteLength !== undefined ? d.body : 0);
      ctx.finish(new Response(b, { status: d.status, statusText: d.statusText || "", headers: hs }));
      return;
    }
    // 兼容旧协议（无 body，走分块）：流式转发，done 先到则 start 里补关。
    const stream = new ReadableStream({
      start(ctrl) {
        ctx.controllerRef = ctrl;
        for (const c of ctx.chunks) ctrl.enqueue(c);
        ctx.chunks.length = 0;
        if (ctx.closed) try { ctrl.close(); } catch { }
      },
    });
    ctx.finish(new Response(stream, { status: d.status, statusText: d.statusText || "", headers: hs }));
    return;
  }
  if (d.done) {
    ctx.closed = true; // 记下结束，若 controller 尚未就绪则 start 时补关
    if (ctx.controllerRef) try { ctx.controllerRef.close(); } catch { }
    return;
  }
  if (d.chunk) {
    if (ctx.claimed && d.workerId !== ctx.workerId) return; // 忽略其它页的重复分块
    const chunk = d.chunk instanceof Uint8Array ? d.chunk
      : (d.chunk && d.chunk.byteLength !== undefined ? new Uint8Array(d.chunk) : null);
    if (chunk) {
      if (ctx.controllerRef) ctx.controllerRef.enqueue(chunk);
      else ctx.chunks.push(chunk);
    }
  }
});

// 在所有 window 客户端里找“终端页”：URL 以 SW_DIR 开头、但不以 /http/ 开头的那个。
async function findGatewayClient() {
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const c of clients) {
    try {
      const u = new URL(c.url);
      if (u.pathname.startsWith(SW_DIR) && !u.pathname.startsWith(PREFIX)) return c;
    } catch { }
  }
  return null;
}

let seq = 0;
async function proxyToGuest(event, target, url) {
  const req = event.request;
  // 先确认终端页是否真的开着(它承载网关)。没开就立刻 503，不用等 20s。
  const client = await findGatewayClient();
  if (!client) {
    return new Response("gateway unavailable: the linux terminal page must be open (no terminal page found)", {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  const headers = {};
  for (const [k, v] of req.headers) headers[k] = v;
  let body = null;
  if (["POST", "PUT", "PATCH"].includes(req.method)) {
    try { body = new Uint8Array(await req.arrayBuffer()); } catch { }
  }
  const id = "r" + (++seq);
  return new Promise((resolve) => {
    let resolved = false;
    // 兜底超时：只有当终端页在线却彻底没回音时才触发(正常会很快回 502/数据)。
    // 取 30s 是因为无 Content-Length/非 chunked 的响应最坏要 25s 才靠硬超时收尾。
    const timeoutId = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        pending.delete(id);
        resolve(new Response("gateway unavailable: the linux terminal page must be open (no reply via postMessage)", {
          status: 503,
          headers: { "content-type": "text/plain; charset=utf-8" },
        }));
      }
    }, 30000);
    const finish = (r) => {
      if (!resolved) { resolved = true; clearTimeout(timeoutId); pending.delete(id); resolve(r); }
    };
    pending.set(id, { finish, controllerRef: null, chunks: [], resolved: false, claimed: false, workerId: null, closed: false });
    // 注意：不传 transfer 列表，用普通对象 postMessage；页面端经
    // navigator.serviceWorker 的 message 事件接收，再用 reg.active.postMessage 回传。
    client.postMessage({ type: "guest-proxy", id, request: { method: req.method, path: target.path, headers, body, port: target.port } });
  });
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  const target = parseTarget(url);
  if (!target) return; // 不匹配 <站点目录>/http/，不拦截
  event.respondWith(proxyToGuest(event, target, url));
});
