// SPDX-License-Identifier: MIT
//
// fetch-network.js
// ---------------------------------------------------------------------------
// 一个用浏览器 `fetch()` 模拟互联网的网关，挂在 @tombl/linux 的
// `ethernetNetwork()` 交换机上。

import { createStack } from "./vendor/tcpip/dist/index.js";
import { forge } from "./vendor/forge/forge.js";
import { createHttp } from "./vendor/tcpip-http/dist/index.js";

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
// 连接断开即取消对应 fetch：ac.signal 传给 fetch，响应体被 @tcpip/http 取消时
// 触发 abort（明文路径无独立外部 signal）。
// ---------------------------------------------------------------------------
function makeProxyHandler(gw, scheme, port) {
  return async (request) => {
    const reqUrl = new URL(request.url); // @tcpip/http 已按 Host 头拼成 http://host/path
    const hostHeader = reqUrl.host;
    const path = reqUrl.pathname + reqUrl.search;
    const url = buildUpstreamUrl(scheme, port, hostHeader, path);

    // 每个请求一个 AbortController，连接断开时取消对应的上游 fetch。
    const ac = new AbortController();

    const init = { method: request.method, headers: new Headers(), redirect: "follow", signal: ac.signal };
    for (const [k, v] of request.headers) {
      const lk = k.toLowerCase();
      if (["host", "content-length", "connection", "transfer-encoding"].includes(lk)) continue;
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
    const drop = new Set([
      "content-encoding", "content-length", "transfer-encoding", "connection",
    ]);
    const outHeaders = new Headers();
    resp.headers.forEach((v, k) => {
      const lk = k.toLowerCase();
      if (drop.has(lk)) return;
      outHeaders.append(k, v);
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

// ---------------------------------------------------------------------------
// DNS 服务
//   A  ：保持原有合成逻辑，回合成 IP（gw.syntheticIp）。
//   AAAA：保持原有逻辑，NOERROR 无答案，客户机回退到 A。
//   其它类型：把整段 DNS 查询报文按 RFC 8484 规则经 DoH wire 端点转发。
// ---------------------------------------------------------------------------

// 1. 准确获取 Question 段在 DNS 报文中的结束位置 (Header 12B + QNAME + QTYPE 2B + QCLASS 2B)
function getQuestionEndOffset(data) {
  if (!data || data.length < 12) return -1;
  let off = 12;
  while (off < data.length) {
    const len = data[off];
    if (len === 0) { off += 1; break; }
    if ((len & 0xc0) === 0xc0) { off += 2; break; } // 指针
    off += len + 1;
  }
  if (off + 4 > data.length) return -1;
  return off + 4; // 指向 Question 结尾后的偏移量
}

// 解析 DNS 查询首条 question 的 type 数值（1=A, 28=AAAA, 5=CNAME…）
function dnsQuestionType(data) {
  const end = getQuestionEndOffset(data);
  if (end === -1) return null;
  return (data[end - 4] << 8) | data[end - 3];
}

// 仅提取纯粹的 Question 字节段（过滤掉末尾可能的 EDNS0/OPT 附加数据，防止构建应答时报文结构破坏）
function extractQuestionSection(query) {
  const end = getQuestionEndOffset(query);
  return end > 12 ? query.subarray(12, end) : new Uint8Array(0);
}

// Uint8Array -> base64url（浏览器/Node 通用的 btoa）
function bytesToBase64url(bytes) {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// 把 DNS wire 查询发给 DoH 端点（改用 fetchWithFallback 以支持 CORS Proxy 与代理能力）
async function forwardViaDoh(gw, queryBytes) {
  const url = `${gw.dohWire}?dns=${bytesToBase64url(queryBytes)}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const fetched = await fetchWithFallback(gw, url, {
      headers: { accept: "application/dns-message" },
      signal: ctrl.signal,
    });
    if (!fetched.resp || !fetched.resp.ok) return null;
    const buf = await fetched.resp.arrayBuffer();
    return new Uint8Array(buf);
  } catch {
    return null; // 超时 / 网络异常：交由上层回 SERVFAIL
  } finally {
    clearTimeout(timer);
  }
}

// 构造 DNS 响应头：复制事务 ID，QR=1/RD=1/RA=1，指定 rcode
function buildDnsHeader(query, an, rcode) {
  const hdr = new Uint8Array(12);
  hdr.set(query.subarray(0, 2), 0);
  const dv = new DataView(hdr.buffer);
  dv.setUint16(2, 0x8180 | (rcode & 0x0f)); // QR=1, RD=1, RA=1
  dv.setUint16(4, 1); // question count
  dv.setUint16(6, an); // answer count
  return hdr;
}

// A：合成应答（使用 extractQuestionSection 安全截取，抛弃 EDNS0 杂项）
function buildSyntheticA(gw, query) {
  const hdr = buildDnsHeader(query, 1, 0);
  const question = extractQuestionSection(query);
  const ip = gw.syntheticIp.split(".").map((n) => Number(n) & 0xff);
  const rr = new Uint8Array(12 + 4);
  const dv = new DataView(rr.buffer);
  rr[0] = 0xc0; rr[1] = 0x0c; // name 压缩指针 -> offset 12
  dv.setUint16(2, 1);         // type A
  dv.setUint16(4, 1);         // class IN
  dv.setUint32(6, 60);        // TTL
  dv.setUint16(10, 4);        // RDLENGTH
  rr.set(ip, 12);             // RDATA = IPv4
  const out = new Uint8Array(hdr.length + question.length + rr.length);
  out.set(hdr, 0);
  out.set(question, hdr.length);
  out.set(rr, hdr.length + question.length);
  return out;
}

// AAAA / 无答案：NOERROR 空应答
function buildEmpty(gw, query) {
  const hdr = buildDnsHeader(query, 0, 0);
  const question = extractQuestionSection(query);
  const out = new Uint8Array(hdr.length + question.length);
  out.set(hdr, 0);
  out.set(question, hdr.length);
  return out;
}

// 服务端或转发失败时回 SERVFAIL
function buildServfail(gw, query) {
  const hdr = buildDnsHeader(query, 0, 2);
  const question = extractQuestionSection(query);
  const out = new Uint8Array(hdr.length + question.length);
  out.set(hdr, 0);
  out.set(question, hdr.length);
  return out;
}

// 处理单条 DNS 查询
async function handleDnsQuery(gw, query) {
  const qtype = dnsQuestionType(query);
  if (qtype === 1) return buildSyntheticA(gw, query);   // A：合成 IP
  if (qtype === 28) return buildEmpty(gw, query);        // AAAA：NOERROR 空
  if (qtype === null) return buildServfail(gw, query);   // 报文畸形
  try {
    return (await forwardViaDoh(gw, query)) || buildServfail(gw, query);
  } catch (e) {
    if (gw.debug) console.log("[fetch-gw] DoH forward failed:", e && e.message ? e.message : e);
    return buildServfail(gw, query);
  }
}

// 复用 @tcpip 的 ReadableStream -> async iterable 适配器
function c(e, r) {
  let a = e.getReader();
  return m(a, r);
}
async function* m(e, r) {
  try {
    for (; ;) {
      let { done: a, value: n } = await e.read();
      if (a) return n;
      yield n;
    }
  } finally {
    r?.preventCancel || await e.cancel(), e.releaseLock();
  }
}

// 在 UDP 上起 DNS 服务（使用写入链 Promise 队列，防止并发 write 导致 Stream 报错崩溃）
function startDnsServer(gw, stack) {
  let socket = null;
  (async () => {
    try {
      socket = await stack.udp.open({ host: gw.gatewayIp, port: gw.dnsPort });
      const writer = socket.writable.getWriter();

      // 串行写入队列，避免并发 write 触发 TypeError: Stream locked/busy
      let writeChain = Promise.resolve();
      const safeWrite = (pkt) => {
        writeChain = writeChain.then(() => writer.write(pkt)).catch(() => { });
      };

      for await (const pkt of c(socket.readable)) {
        const { host, port, data } = pkt;
        handleDnsQuery(gw, data)
          .then((resp) => { if (resp) safeWrite({ host, port, data: resp }); })
          .catch((e) => { if (gw.debug) console.log("[fetch-gw] dns query err:", e && e.message ? e.message : e); });
      }
    } catch (e) {
      if (gw.debug) console.log("[fetch-gw] dns server ended:", e && e.message ? e.message : e);
    }
  })();
  return {
    close() {
      try { if (socket && socket.close) socket.close(); } catch { }
    },
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
  "keep-alive", "proxy-connection", "upgrade", "proxy-authenticate", "trailer"];

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

  if (gw.debug) console.log("[proxy] connect ->", guestIp + ":" + port, method, req.path);
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
  if (gw.debug) console.log("[proxy] response", res.status, res.statusText);

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
  if (gw.debug) console.log("[proxy] body complete", res.status, body.length, "bytes");
  return { status: res.status, statusText: res.statusText, headers: outHeaders, body };
}

// ---------------------------------------------------------------------------
// TLS 终结(443)：forge 完成 TLS 握手、读出明文请求后，不再把数据转发到上游，
// 而是直接回一个 301 重定向，把客户机引到对应的 http:// 地址，由网关的明文
// HTTP 代理(端口 80)接管后续请求。
// ---------------------------------------------------------------------------
async function serveTlsConn(gw, conn) {
  const reader = conn.readable.getReader();
  const writer = conn.writable.getWriter();
  let reqBuf = "";   // 累积解密出的明文请求，直到头块结束(\r\n\r\n)
  let responded = false;

  // 从明文请求头中取出请求路径与 Host，拼出对应的 http:// 地址。
  const buildLocation = () => {
    const firstLineEnd = reqBuf.indexOf("\r\n");
    const headEnd = reqBuf.indexOf("\r\n\r\n");
    const requestLine = firstLineEnd >= 0 ? reqBuf.slice(0, firstLineEnd) : "";
    const parts = requestLine.split(" ");
    const path = parts.length >= 2 ? parts[1] : "/";
    let host = "";
    if (headEnd > 0 && firstLineEnd > 0) {
      const restHead = reqBuf.slice(firstLineEnd + 2, headEnd);
      for (const line of restHead.split("\r\n")) {
        const i = line.indexOf(":");
        if (i > 0 && line.slice(0, i).trim().toLowerCase() === "host") {
          host = line.slice(i + 1).trim();
          break;
        }
      }
    }
    return "http://" + (host || gw.gatewayIp) + path;
  };

  // 回 301 并关闭连接，客户机会跟着 Location 走 http 明文。
  // 注意：tls.prepare() 需要原始字节串(内部 createBuffer)，不能传 Uint8Array，
  // 传 Uint8Array 会经 util.binary.raw.encode 抛错导致 301 无法发出去。
  const sendRedirect = () => {
    responded = true;
    const head = "HTTP/1.1 301 Moved Permanently\r\n"
      + "Location: " + buildLocation() + "\r\n"
      + "Content-Length: 0\r\n"
      + "Connection: close\r\n"
      + "\r\n";
    try { tls.prepare(head); tls.process(); } catch (e) {
      if (gw.debug) console.log("[fetch-gw] tls redirect send err:", e && e.message ? e.message : e);
    }
    try { tls.close(); } catch { }
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
    connected: () => { /* 握手完成，等待第一条明文请求 */ },
    tlsDataReady: (c) => {
      const bytes = decBin(c.tlsData.getBytes());
      if (bytes && bytes.length) writer.write(bytes).catch(() => { });
    },
    dataReady: (c) => {
      if (responded) return; // 已回完 301，忽略后续数据
      const plain = decBin(c.data.getBytes());
      if (plain && plain.length) reqBuf += new TextDecoder().decode(plain);
      if (reqBuf.indexOf("\r\n\r\n") >= 0) sendRedirect();
    },
    closed: () => {
      writer.close().catch(() => { });
    },
    error: (c, e) => {
      if (gw.debug) console.log("[fetch-gw] tls error:", e && e.message ? e.message : e);
      writer.close().catch(() => { });
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
    forceHttps: options.forceHttps !== false,
    corsProxy: options.corsProxy !== undefined ? options.corsProxy : "https://cors-anywhere.mayx.eu.org/?",
    dohWire: options.dohWire || "https://dns.mayx.eu.org/dns-query",
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
  // 80：明文代理（forceHttps 时升级 https）。
  const proxyServer = await http.serve({ port: 80 }, makeProxyHandler(gw, gw.forceHttps ? "https" : "http", 80));
  const execServer = await http.serve({ host: gw.gatewayIp, port: gw.execPort }, execHandler);

  // --- 443：TLS 终结，握手读到明文请求后回 301 -> 明文代理 ---
  const tlsListener = await stack.tcp.listen({ port: 443 });
  acceptLoop(gw, tlsListener, (conn) => serveTlsConn(gw, conn));

  // --- DNS 服务 ---
  const dnsServer = startDnsServer(gw, stack);

  // 注意：必须返回完整的 gw 对象(而非只返回 {close})，因为 proxyToGuest 由页面经 service
  // worker 桥接「外部」调用，依赖 gw._stack / gw.guestIp 等字段。若只返回 {close}，
  // gw._stack 会丢失 -> proxyToGuest 报 "gateway stack not ready"。
  gw.close = function () {
    closed = true;
    try { proxyServer.close(); } catch { }
    try { execServer.close(); } catch { }
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
