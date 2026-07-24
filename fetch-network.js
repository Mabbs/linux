// SPDX-License-Identifier: MIT
//
// fetch-network.js
// ---------------------------------------------------------------------------
// 一个用浏览器 `fetch()` 模拟互联网的网关，挂在 @tombl/linux 的
// `ethernetNetwork()` 交换机上。

import { createStack } from "./vendor/tcpip/dist/index.js";
import { forge } from "./vendor/forge/forge.js";
import { createHttp } from "./vendor/tcpip-http/dist/index.js";
import { createDns } from "./vendor/tcpip-dns/index.js";

function macToString(mac) {
  if (typeof mac === "string") return mac;
  const bytes = mac instanceof Uint8Array ? Array.from(mac) : mac;
  return bytes.map((b) => (b & 0xff).toString(16).padStart(2, "0")).join(":");
}

function encBin(u8) {
  return forge.util.binary.raw.encode(u8);
}
function decBin(str) {
  return str ? forge.util.binary.raw.decode(str) : new Uint8Array(0);
}

function toPemCert(c) {
  return typeof c === "string" ? c : forge.pki.certificateToPem(c);
}
function toPemKey(k) {
  return typeof k === "string" ? k : forge.pki.privateKeyToPem(k);
}

function generateTlsCert() {
  const keys = forge.pki.rsa.generateKeyPair({ bits: 2048 });
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = "01";
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notAfter.getFullYear() + 20);
  const attrs = [{ name: "commonName", value: "fetch-gateway" }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return {
    cert: forge.pki.certificateToPem(cert),
    key: forge.pki.privateKeyToPem(keys.privateKey),
  };
}

// 由请求头 + scheme/port 反推上游真实 URL(端口后缀规则)。
// 这是原 pipeHttpResponse 的纯函数内核，抽出来便于单测。
//   - https：端口 443 不加后缀；其它(如 8080)保留
//   - http ：端口 80 不加后缀；其它保留
export function buildUpstreamUrl(scheme, port, hostHeader, path) {
  const hostName = hostHeader ? hostHeader.replace(/:\d+$/, "") : "";
  const portSuffix = scheme === "https"
    ? (port === 80 || port === 443 ? "" : ":" + port)
    : (port === 80 ? "" : ":" + port);
  return `${scheme}://${hostName}${portSuffix}${path}`;
}

async function evalJS(src) {
  try {
    let r = (0, eval)(src);
    if (r && typeof r.then === "function") r = await r;
    return r === undefined || r === null ? "" : String(r);
  } catch (e) {
    return "Error: " + (e && e.message ? e.message : String(e));
  }
}

async function fetchWithFallback(gw, url, init) {
  try {
    const resp = await gw.fetch(url, init);
    return { resp };
  } catch (err) {
    // 连接断开导致的主动 abort，不再重试（重试一个已断开的连接没有意义）。
    if (err && err.name === "AbortError") return { error: "fetch aborted: " + (err.message || "client disconnected") };
    const msg = err && err.message ? err.message : String(err);
    const proxy = gw.corsProxy;
    if (!proxy) return { error: "fetch failed: " + msg };
    if (gw.debug) console.log("[fetch-gw] direct fetch failed, retrying via proxy:", msg);
    try {
      const proxiedUrl = proxy + url;
      const resp = await gw.fetch(proxiedUrl, init);
      return { resp };
    } catch (err2) {
      return {
        error: "fetch failed (direct + proxy): " + (err2 && err2.message ? err2.message : String(err2)),
      };
    }
  }
}

// 字节级辅助
function concatBytes(...chunks) {
  let len = 0;
  for (const c of chunks) len += c.length;
  const out = new Uint8Array(len);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}
function indexOfBytes(haystack, needle) {
  const n = needle.length;
  if (n === 0) return 0;
  const last = haystack.length - n;
  for (let i = 0; i <= last; i++) {
    let ok = true;
    for (let j = 0; j < n; j++) {
      if (haystack[i + j] !== needle[j]) { ok = false; break; }
    }
    if (ok) return i;
  }
  return -1;
}
// 在 HTTP 请求头块末尾(\r\n\r\n 之前)插入一行 X-Fetch-Abort: <token>。
// 找不到完整头块时原样返回(调用方需继续缓冲)。
const PROXY_DEBUG = false;
function pdbg(...a) { if (PROXY_DEBUG) console.log("[proxy]", ...a); }
const CRLF = new Uint8Array([13, 10]);
const CRLFCRLF = new Uint8Array([13, 10, 13, 10]);
function insertAbortHeader(buf, token) {
  const idx = indexOfBytes(buf, CRLFCRLF);
  if (idx < 0) return buf;
  const head = buf.subarray(0, idx);
  const tail = buf.subarray(idx);
  const inject = new TextEncoder().encode("\r\nX-Fetch-Abort: " + token);
  const out = new Uint8Array(head.length + inject.length + tail.length);
  out.set(head, 0);
  out.set(inject, head.length);
  out.set(tail, head.length + inject.length);
  return out;
}

// 把上游响应体包一层：客户端断开导致本流被取消(pull 失败)时，取消本次
// fetch 对应的 AbortController，释放仍在进行的上游下载。
function wrapBodyForAbort(body, ac) {
  if (!body) return null;
  const reader = body.getReader();
  return new ReadableStream({
    async pull(controller) {
      try {
        const { value, done } = await reader.read();
        if (done) { controller.close(); return; }
        controller.enqueue(value);
      } catch (e) {
        ac.abort(); // 上游读取失败/被取消
        controller.error(e);
      }
    },
    async cancel() {
      try { await reader.cancel(); } catch { }
      ac.abort(); // 客户端连接已断开
    },
  });
}

// ---------------------------------------------------------------------------
// 代理 handler：收到标准 Request，按 scheme/port 构造上游 URL 去 fetch，
// 透传/过滤头，回标准 Response（@tcpip/http 负责序列化，流式 chunked）。
//
// 连接断开即取消对应 fetch：
//   - ac.signal 传给 fetch，TLS 回环路径还会通过 resolveSignal 拿到与本次
//     客户端连接绑定的 signal（客户端一断，立刻 abort，含握手后等待响应头期间）；
//   - 明文/其它路径没有外部 signal，则靠响应体被 @tcpip/http 取消时触发 abort。
// ---------------------------------------------------------------------------
function makeProxyHandler(gw, scheme, port, opts = {}) {
  return async (request) => {
    const reqUrl = new URL(request.url); // @tcpip/http 已按 Host 头拼成 http://host/path
    const hostHeader = reqUrl.host;
    const path = reqUrl.pathname + reqUrl.search;
    const url = buildUpstreamUrl(scheme, port, hostHeader, path);

    // 每个请求一个 AbortController，连接断开时取消对应的上游 fetch。
    const ac = new AbortController();
    if (typeof opts.resolveSignal === "function") {
      const sig = opts.resolveSignal(request);
      if (sig) sig.addEventListener("abort", () => ac.abort());
    }

    const init = { method: request.method, headers: new Headers(), redirect: "follow", signal: ac.signal };
    for (const [k, v] of request.headers) {
      const lk = k.toLowerCase();
      // 不向上游透传 X-Fetch-Abort（仅网关内部用于关联连接）。
      if (["host", "content-length", "connection", "transfer-encoding", "x-fetch-abort"].includes(lk)) continue;
      try { init.headers.set(k, v); } catch { }
    }
    if (["POST", "PUT", "PATCH"].includes(request.method) && request.body) {
      // 先把请求体完整读出来再转发：浏览器/Node 对流请求体(body 为
      // ReadableStream)的 fetch 支持不一致——Node(undici) 与 Chrome 都要求
      // duplex:"half"，否则直接抛错落到 502。缓冲成字节可跨环境零歧义工作。
      // （上传通常是表单/小数据，缓冲可接受；响应体仍保持流式。）
      try {
        init.body = new Uint8Array(await request.arrayBuffer());
      } catch { /* 读不到请求体则不带 body */ }
    }

    const fetched = await fetchWithFallback(gw, url, init);
    if (!fetched.resp) {
      return new Response(fetched.error, {
        status: 502,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
    const resp = fetched.resp;
    // 宿主 fetch 已透明解压，原 content-encoding/length 作废；只保留安全头，
    // 让 @tcpip/http 重新按 chunked 序列化（busybox wget 支持 chunked）。
    const keep = new Set([
      "content-type", "last-modified", "etag", "cache-control",
      "expires", "server", "date", "location",
    ]);
    const outHeaders = new Headers();
    resp.headers.forEach((v, k) => {
      const lk = k.toLowerCase();
      if (["content-encoding", "content-length", "transfer-encoding", "connection"].includes(lk)) return;
      if (keep.has(lk)) outHeaders.set(k, v);
    });
    return new Response(wrapBodyForAbort(resp.body, ac), {
      status: resp.status,
      statusText: resp.statusText,
      headers: outHeaders,
    });
  };
}

// jsexec handler：读请求体当 JS 执行，回文本结果。
async function execHandler(request) {
  const src = await request.text();
  const result = await evalJS(src);
  return new Response(result, {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

// 合成 DNS：一切 A 查询回合成 IP，其余类型(NOERROR 无答案)。
function makeDnsHandler(gw) {
  return async ({ type }) => {
    if (type === "A") return { type: "A", ttl: 60, ip: gw.syntheticIp };
    return []; // NOERROR 无答案（如 AAAA），客户机回退到 A
  };
}

// ---------------------------------------------------------------------------
// 反向代理：浏览器 -> 网关 -> guest 内的 HTTP 服务。
// 复用 @tcpip/http 的客户端能力(gw._http.fetch)：它内部用 lwIP 栈的 tcp.connect 连
// guest 真实 IP:<port>，并用内置的 http_parser.wasm 解析响应，返回标准 Response。
// 我们只需过滤逐跳头、缓冲 body 为定长 Uint8Array(一次性回传，规避流式 done 竞态转圈)。
// 注意：guest 内的服务需监听在 guest 的可达 IP(或 0.0.0.0)，而不能只绑 127.0.0.1，
// 否则从网关侧(走 guest 的外部接口)无法抵达。
// ---------------------------------------------------------------------------
// Promise 超时包装：ms 内未 settle 则 reject(带 msg)，避免代理永久挂起。
function withTimeout(promise, ms, msg) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(msg)), ms);
    Promise.resolve(promise).then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); }
    );
  });
}

// 读取响应体并缓冲为 Uint8Array。idleMs 内无新数据即取消读取(视为 body 结束)，
// 用于应对 guest 的 keep-alive 连接不关闭导致的 until-close 挂起——本地回环延迟
// 极低，2s 无新数据即可判定 body 已结束，避免代理无限转圈。
async function readBody(res, idleMs) {
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  let idleTimer = null;
  const arm = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { try { reader.cancel(); } catch { } }, idleMs);
  };
  arm();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value && value.length) { chunks.push(value); total += value.length; arm(); }
    }
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

// 反向代理用到的逐跳头(不应透传给 guest / 不应回传给浏览器)。
const HOP_BY_HOP = ["host", "connection", "content-length", "transfer-encoding",
  "x-fetch-abort", "keep-alive", "proxy-connection", "upgrade", "proxy-authenticate", "trailer"];

export async function proxyToGuest(gw, req) {
  const guestIp = gw.guestIp || "10.0.2.15";
  const port = req.port;
  if (!gw._stack || !gw._stack.tcp) return { error: "gateway stack not ready" };
  if (!gw._http) return { error: "gateway http client not ready" };
  const method = (req.method || "GET").toUpperCase();
  const url = "http://" + guestIp + ":" + port + (req.path || "/");

  // 过滤逐跳头；强制 Connection: close 让 guest 响应完即关连接，便于判定 body 结束。
  const headers = {};
  for (const [k, v] of Object.entries(req.headers || {})) {
    if (HOP_BY_HOP.includes(("" + k).toLowerCase())) continue;
    headers[k] = v;
  }
  headers["Connection"] = "close";

  pdbg("connect ->", guestIp + ":" + port, method, req.path);
  const init = { method, headers };
  if (req.body && req.body.length) init.body = req.body;

  let res;
  try {
    // 总超时兜底：lwIP 对未监听端口会一直 SYN 重传，createHttp 内部 connect 本身
    // 无超时；这里保证最坏 10s 必返回(错误而非无限转圈)。
    res = await withTimeout(
      gw._http.fetch(url, init),
      10000,
      "guest " + guestIp + ":" + port + " http request timed out (10s)"
    );
  } catch (e) {
    return { error: "proxy to guest failed: " + (e && e.message ? e.message : e) };
  }
  pdbg("response", res.status, res.statusText);

  // 用 @tcpip/http 的解析结果，把 body 整体缓冲为 Uint8Array 一次性回传，规避
  // “流式分块 + 结束协议”在 SW<->页面<->浏览器 三段链路上的 done 竞态转圈。
  // readBody 带 2s 空闲超时，应对 guest 的 keep-alive 连接不关闭(否则 until-close
  // 的 body 会无限挂起)；有明确 Content-Length/chunked 时连接正常关则立即结束。
  let body;
  try {
    body = await readBody(res, 2000);
  } catch (e) {
    try { res.body && res.body.cancel(); } catch { }
    return { error: "read guest body failed: " + (e && e.message ? e.message : e) };
  }

  const outHeaders = [];
  res.headers.forEach((v, k) => {
    if (HOP_BY_HOP.includes(("" + k).toLowerCase())) return;
    outHeaders.push([k, v]);
  });
  outHeaders.push(["Content-Length", String(body.length)]); // 定长回传，浏览器明确知道何时结束
  pdbg("body complete", res.status, body.length, "bytes");
  return { status: res.status, statusText: res.statusText, headers: outHeaders, body };
}

// ---------------------------------------------------------------------------
// TLS 终结(443)：forge 解密后，把明文请求经回环 TCP 喂给本地 @tcpip/http
// 代理服务(tlsLocalPort)，再把代理响应读回、加密发回客户机。
// ---------------------------------------------------------------------------
async function serveTlsConn(gw, conn, stack) {
  const reader = conn.readable.getReader();
  const writer = conn.writable.getWriter();

  let loopWriter = null;
  let loopConn = null;
  let loopClosed = false;
  const pending = []; // 回环未连好前，暂存已解密的请求字节
  let tlsClosed = false;

  // 本次客户端 TLS 连接对应的 AbortController：客户端断开即取消上游 fetch。
  const token = "gw" + (++gw._abortSeq);
  const connAc = new AbortController();
  gw._abortMap.set(token, connAc);
  let headerInjected = false; // 已在第一笔完整请求头上注入 token
  let headerBuf = new Uint8Array(0);

  // 把解密后的明文请求字节转给回环代理；第一笔完整请求头里注入 abort token。
  const forwardToLoop = (plain) => {
    if (!loopWriter) { pending.push(plain); return; }
    if (!headerInjected) {
      headerBuf = concatBytes(headerBuf, plain);
      if (indexOfBytes(headerBuf, CRLFCRLF) < 0) {
        // 头还没收全，继续缓冲(上限保护，避免异常长头撑爆内存)。
        if (headerBuf.length > 65536) { loopWriter.write(headerBuf).catch(() => { }); headerBuf = new Uint8Array(0); }
        return;
      }
      loopWriter.write(insertAbortHeader(headerBuf, token)).catch(() => { });
      headerBuf = new Uint8Array(0);
      headerInjected = true;
    } else {
      loopWriter.write(plain).catch(() => { });
    }
  };

  const abortUpstream = () => {
    try { connAc.abort(); } catch { }
    gw._abortMap.delete(token);
  };

  const tls = forge.tls.createConnection({
    server: true,
    getCertificate: () => gw.tlsCert,
    getPrivateKey: () => gw.tlsKey,
    cipherSuites: [
      forge.tls.CipherSuites.TLS_RSA_WITH_AES_256_CBC_SHA256,
      forge.tls.CipherSuites.TLS_RSA_WITH_AES_128_CBC_SHA256,
      forge.tls.CipherSuites.TLS_RSA_WITH_AES_256_CBC_SHA,
      forge.tls.CipherSuites.TLS_RSA_WITH_AES_128_CBC_SHA,
    ],
    verifyClient: false,
    connected: () => {
      stack.tcp.connect({ host: "127.0.0.1", port: gw.tlsLocalPort })
        .then(async (lc) => {
          loopConn = lc;
          loopWriter = lc.writable.getWriter();
          if (pending.length) { forwardToLoop(concatBytes(...pending)); pending.length = 0; }
          const r = lc.readable.getReader();
          try {
            while (true) {
              const { value, done } = await r.read();
              if (done) break;
              if (value && value.length) {
                tls.prepare(encBin(value));
                tls.process();
              }
            }
          } catch { }
          // 回环侧关闭 -> 关闭 TLS
          if (!tlsClosed) { try { tls.close(); } catch { } }
        })
        .catch((e) => {
          if (gw.debug) console.log("[fetch-gw] tls loopback connect err:", e && e.message ? e.message : e);
          try { writer.close(); } catch { }
        });
    },
    tlsDataReady: (c) => {
      const bytes = decBin(c.tlsData.getBytes());
      if (bytes.length) writer.write(bytes).catch(() => { });
    },
    dataReady: (c) => {
      const plain = decBin(c.data.getBytes());
      if (plain && plain.length) forwardToLoop(plain);
    },
    closed: () => {
      tlsClosed = true;
      writer.close().catch(() => { });
      abortUpstream();
      if (loopConn && !loopClosed) { loopClosed = true; try { loopConn.close(); } catch { } }
    },
    error: (c, e) => {
      if (gw.debug) console.log("[fetch-gw] tls error:", e && e.message ? e.message : e);
      tlsClosed = true;
      writer.close().catch(() => { });
      abortUpstream();
      if (loopConn && !loopClosed) { loopClosed = true; try { loopConn.close(); } catch { } }
    },
  });

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value && value.length) {
        try { tls.process(encBin(value)); } catch (e) {
          if (gw.debug) console.log("[fetch-gw] tls process err:", e && e.message ? e.message : e);
        }
      }
    }
  } catch { }
  try { reader.releaseLock(); } catch { }
  abortUpstream();
}

function acceptLoop(gw, listener, handler) {
  (async () => {
    try {
      for await (const conn of listener) {
        handler(conn).catch((e) => {
          if (gw.debug) console.log("[fetch-gw] conn handler err:", e && e.message ? e.message : e);
        });
      }
    } catch (e) {
      if (gw.debug) console.log("[fetch-gw] accept loop end:", e && e.message ? e.message : e);
    }
  })();
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

export async function fetchInternetGateway(network, options = {}) {
  const tlsPair = options.tlsCert && options.tlsKey
    ? { cert: toPemCert(options.tlsCert), key: toPemKey(options.tlsKey) }
    : generateTlsCert();
  const gw = {
    gatewayIp: options.gatewayIp || "10.0.2.2",
    gatewayMac: macToString(options.gatewayMac || "52:55:0a:00:02:02"),
    syntheticIp: options.syntheticIp || "203.0.113.1",
    dnsPort: options.dnsPort || 53,
    execPort: options.execPort || 8080,
    tlsLocalPort: options.tlsLocalPort || 8443,
    forceHttps: options.forceHttps !== false,
    corsProxy: options.corsProxy !== undefined ? options.corsProxy : "https://cors-anywhere.mayx.eu.org/?",
    fetch: options.fetch || fetch,
    tlsCert: tlsPair.cert,
    tlsKey: tlsPair.key,
    debug: options.debug || false,
    // guest 的真实 IP：反向代理(浏览器 -> guest 内服务)的目标。
    // 默认 10.0.2.15（@tombl/linux 客户机惯例地址）；也可由 options.guestIp 显式指定。
    guestIp: options.guestIp || "10.0.2.15",
    _guestIpExplicit: !!options.guestIp,
    // lwIP 栈引用，供 proxyToGuest 反向连入 guest。
    _stack: null,
    // 连接 -> AbortController 映射，供 443 回环代理在客户端断开时取消 fetch。
    _abortMap: new Map(),
    _abortSeq: 0,
  };

  const stack = await createStack();
  gw._stack = stack;
  const tapA = await stack.interfaces.createTap({
    ip: gw.gatewayIp + "/24",
    mac: gw.gatewayMac,
  });
  const tapB = await stack.interfaces.createTap({
    ip: gw.syntheticIp + "/24",
  });

  const tapAWriter = tapA.writable.getWriter();
  const gwMacBytes = Uint8Array.from(gw.gatewayMac.split(":").map((h) => parseInt(h, 16)));
  let closed = false;
  const port = network.addPort((frame) => {
    if (closed || !frame || frame.byteLength < 14) return;
    const dst = frame.subarray(0, 6);
    const src = frame.subarray(6, 12);
    const ethertype = (frame[12] << 8) | frame[13];
    // 自动发现 guest 的 IP：从 guest 发出的 IPv4 包源地址学习。
    // 网关自身发出的包源 MAC == gatewayMac，跳过；0.0.0.0(DHCP 探测)与网关自身 IP 也跳过。
    // 仅在未显式指定 guestIp 时覆盖默认。
    if (ethertype === 0x0800 && frame.byteLength >= 30 && !gw._guestIpExplicit) {
      const isGatewaySrc = src.every((x, i) => x === gwMacBytes[i]);
      if (!isGatewaySrc) {
        const sip = Array.from(frame.subarray(26, 30)).join(".");
        if (sip !== "0.0.0.0" && sip !== gw.gatewayIp) gw.guestIp = sip;
      }
    }
    const isBroadcast = dst.every((b) => b === 0xff);
    const isMine = dst.every((x, i) => x === gwMacBytes[i]);
    if (!isBroadcast && !isMine) return;
    tapAWriter.write(frame).catch(() => { });
  });
  gw.port = port;

  const sendOut = (frame) => {
    try {
      const r = port.send(frame);
      if (r && typeof r.catch === "function") r.catch(() => { });
    } catch { }
  };
  tapA.readable.pipeTo(new WritableStream({ write: sendOut })).catch(() => { });
  tapB.readable.pipeTo(new WritableStream({ write: sendOut })).catch(() => { });

  // --- HTTP 服务(@tcpip/http) ---
  const http = await createHttp(stack.tcp);
  gw._http = http; // 反向代理(proxyToGuest)复用同一实例的 .fetch 客户端能力
  // 80：明文代理（forceHttps 时升级 https）；回环 https：供 443 经 forge 解密后转发
  const proxyServer = await http.serve({ port: 80 }, makeProxyHandler(gw, gw.forceHttps ? "https" : "http", 80));
  const execServer = await http.serve({ host: gw.gatewayIp, port: gw.execPort }, execHandler);
  // 443 回环代理：通过注入的 X-Fetch-Abort 头找回本次客户端连接的 AbortController，
  // 客户端一断开（TLS closed/error）即可立刻取消上游 fetch。
  const tlsProxyServer = await http.serve({ host: "127.0.0.1", port: gw.tlsLocalPort }, makeProxyHandler(gw, "https", 443, {
    resolveSignal: (request) => {
      const t = request.headers.get("x-fetch-abort");
      return t ? (gw._abortMap.get(t) || null)?.signal || null : null;
    },
  }));

  // --- 443：TLS 终结，解密后回环到 tlsProxyServer ---
  const tlsListener = await stack.tcp.listen({ port: 443 });
  acceptLoop(gw, tlsListener, (conn) => serveTlsConn(gw, conn, stack));

  // --- DNS 服务(@tcpip/dns) ---
  const dns = await createDns(stack.udp);
  const dnsServer = await dns.serve({
    host: gw.gatewayIp,
    port: gw.dnsPort,
    request: makeDnsHandler(gw),
  });

  // 注意：必须返回完整的 gw 对象(而非只返回 {close})，因为 proxyToGuest 由页面经 service
  // worker 桥接「外部」调用，依赖 gw._stack / gw.guestIp / gw._abortMap 等字段。若只返回
  // {close}，gw._stack 会丢失 -> proxyToGuest 报 "gateway stack not ready"。
  gw.close = function () {
    closed = true;
    try { proxyServer.close(); } catch { }
    try { execServer.close(); } catch { }
    try { tlsProxyServer.close(); } catch { }
    try { dnsServer.close(); } catch { }
    try { tlsListener.close(); } catch { }
    try { port.close(); } catch { }
    try { tapAWriter.releaseLock(); } catch { }
    stack.interfaces.remove(tapA).catch(() => { });
    stack.interfaces.remove(tapB).catch(() => { });
  };
  return gw;
}

export { evalJS, fetchWithFallback, generateTlsCert, toPemCert, toPemKey };
