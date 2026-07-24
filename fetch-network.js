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
    // 连接 -> AbortController 映射，供 443 回环代理在客户端断开时取消 fetch。
    _abortMap: new Map(),
    _abortSeq: 0,
  };

  const stack = await createStack();
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

  return {
    close() {
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
    },
  };
}

export { evalJS, fetchWithFallback, generateTlsCert, toPemCert, toPemKey };
