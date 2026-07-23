// SPDX-License-Identifier: MIT
//
// fetch-network.js
// ---------------------------------------------------------------------------
// 一个用浏览器 `fetch()` 模拟互联网的网关，挂在 @tombl/linux 的
// `ethernetNetwork()` 交换机上。
//
// 本版本用 vendored 的 tcpip 库(lwIP 编译成 WASM)承担全部 L2-L4 协议栈：
// ARP / IPv4 / TCP(握手、窗口、重传、挥手) / UDP / ICMP 都由 lwIP 处理，
// 本文件只做四件事：
//   1. 帧桥接：把交换机进来的以太网帧喂给 lwIP 的 tap 接口，反向亦然；
//   2. 双 tap 承接合成 IP：tapA 持网关 IP(10.0.2.2)，tapB 持合成 IP
//      (203.0.113.1)。DNS 对一切 A 查询都答合成 IP，客户机经默认路由把
//      流量送到网关 MAC，lwIP 因 tapB 持有该 IP 而本地交付——无需 NAT。
//   3. 应用层服务：
//      - TCP 80：HTTP 代理(明文请求默认升级 https 去真实世界 fetch)
//      - TCP 443：forge 终结 TLS(自签名证书 + TLS 1.2 RSA/AES-CBC-SHA256，
//        兼容 busybox 1.38)，解密出的明文请求走同一代理逻辑
//      - TCP execPort(默认 8080，仅网关 IP)：jsexec 服务，POST 的 JS 源码
//        在宿主(浏览器)全局环境执行，返回最后一个表达式的完成值
//      - UDP 53：合成 DNS
//   4. fetch 代理本身(直连失败回退 CORS 代理)。
//
// HTTP 解析、DNS 应答构造、TLS 证书生成、fetch 回退等纯逻辑全部内联在
// 本文件(不依赖 fetch-network-manual.js；后者仅作为手写栈参考实现保留)。
//
// 与手写栈版的行为差异：
//   - 代理只监听 80/443 端口；客户机访问其它端口(如 http://x:8081)会被
//     lwIP 直接 RST(手写栈版对任意端口代理)。实际客户机流量只有 80/443。
//   - fetchInternetGateway 现在是 async(需要实例化 lwIP WASM)。
//
// 限制：
//   - 浏览器跨源隔离(COEP)下，只有返回 CORS 头的站点才能让 fetch 读到响应体，
//     直连失败会自动回退 corsProxy。
//   - TLS 仅支持 RSA 密钥交换 + AES-CBC(SHA1/SHA256 MAC)，无 GCM/ECDHE；
//     busybox wget 默认套件(0x003D)在此范围内。

import { createStack } from "./vendor/tcpip/dist/index.js";
import { forge } from "./vendor/forge/forge.js";

// 把 MAC 统一成 "aa:bb:cc:dd:ee:ff" 字符串(tcpip 库的 createTap 需要)
function macToString(mac) {
  if (typeof mac === "string") return mac;
  const bytes = mac instanceof Uint8Array ? Array.from(mac) : mac;
  return bytes.map((b) => (b & 0xff).toString(16).padStart(2, "0")).join(":");
}

// 读到 requestComplete 为止(或流结束)，返回累积缓冲；超过 maxLen 直接放弃
async function readHttpRequest(reader, maxLen = 1 << 20) {
  let buf = new Uint8Array(0);
  while (true) {
    if (requestComplete(buf)) return buf;
    const { value, done } = await reader.read();
    if (done) return buf.length ? buf : null;
    if (value && value.length) buf = appendBytes(buf, value);
    if (buf.length > maxLen) return null;
  }
}

// Uint8Array <-> forge 内部用的 Latin1 二进制串
function encBin(u8) {
  return forge.util.binary.raw.encode(u8);
}
function decBin(str) {
  return str ? forge.util.binary.raw.decode(str) : new Uint8Array(0);
}
function appendBytes(a, b) {
  if (!a || a.length === 0) return b;
  if (!b || b.length === 0) return a;
  const n = new Uint8Array(a.length + b.length);
  n.set(a, 0);
  n.set(b, a.length);
  return n;
}

// forge 证书对象 / 私钥对象 -> PEM 字符串(若已经是字符串则原样返回)。
// 注意：本仓库 vendored 的 forge 包里，tls.createConnection 的 server 端
// 只会读取 getCertificate / getPrivateKey 回调返回的 PEM，options.cert /
// options.key 会被直接忽略。所以无论调用方传 forge 对象还是 PEM，都先转成
// PEM 字符串再交给 forge。
function toPemCert(c) {
  return typeof c === "string" ? c : forge.pki.certificateToPem(c);
}
function toPemKey(k) {
  return typeof k === "string" ? k : forge.pki.privateKeyToPem(k);
}

// 生成一张自签名证书 + 私钥，返回 PEM 字符串。
// busybox wget 不验证证书，所以自签名即可用于 TLS 终结。
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

// "1.2.3.4" -> Uint8Array(4)
function ipToBytes(ip) {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !(n >= 0 && n <= 255)))
    throw new Error("bad ip: " + ip);
  return Uint8Array.from(p);
}

// 根据查询构造合成 DNS 应答：对任何 A 查询回 syntheticIp(默认 203.0.113.1)。
// 返回 DNS 消息字节；畸形包返回 null。
function buildDnsAnswer(udp, syntheticIp) {
  // 边界保护：至少要放得下 12 字节 DNS 头部
  if (udp.length < 12) return null;
  const qdcount = (udp[4] << 8) | udp[5];
  if (qdcount < 1) return null;

  // 解析所有 question(支持一次查询带 A + AAAA 等多个问题)
  const questions = [];
  let off = 12;
  for (let q = 0; q < qdcount; q++) {
    const labels = [];
    let ok = true;
    while (off < udp.length && udp[off] !== 0) {
      const len = udp[off];
      if (len >= 0xc0) { ok = false; break; } // 压缩指针：请求里不该出现
      if (off + 1 + len > udp.length) { ok = false; break; }
      labels.push(String.fromCharCode(...udp.subarray(off + 1, off + 1 + len)));
      off += len + 1;
    }
    if (!ok || off >= udp.length) return null; // 畸形，放弃
    off += 1; // 跳过根标签 0
    if (off + 4 > udp.length) return null;
    const qtype = (udp[off] << 8) | udp[off + 1];
    const qclass = (udp[off + 2] << 8) | udp[off + 3];
    off += 4;
    questions.push({ labels, qtype, qclass });
  }

  const id = udp.subarray(0, 2);
  const rdata = ipToBytes(syntheticIp);
  // 每个 A 问题对应一个 answer；AAAA 等其它类型回 NOERROR 无答案(让解析器回退到 A)
  const ancount = questions.reduce((n, q) => n + (q.qtype === 1 ? 1 : 0), 0);

  // 预算大小
  let qsize = 0;
  const nameBytesList = questions.map((q) => {
    const nb = [];
    for (const label of q.labels) {
      nb.push(label.length);
      for (let i = 0; i < label.length; i++) nb.push(label.charCodeAt(i));
    }
    nb.push(0);
    qsize += nb.length + 2 + 2; // name + qtype + qclass
    return nb;
  });
  const total = 12 + qsize + ancount * (2 + 2 + 2 + 4 + 2 + 4);
  const answer = new Uint8Array(total);
  let p = 0;
  answer.set(id, p); p += 2;
  answer[p++] = 0x81; answer[p++] = 0x80; // QR=1 AA=1 RA=1
  answer[p++] = (qdcount >> 8) & 0xff; answer[p++] = qdcount & 0xff;
  answer[p++] = (ancount >> 8) & 0xff; answer[p++] = ancount & 0xff;
  answer[p++] = 0; answer[p++] = 0; // nscount
  answer[p++] = 0; answer[p++] = 0; // arcount
  const qOffsets = [];
  for (let i = 0; i < questions.length; i++) {
    qOffsets.push(p);
    answer.set(nameBytesList[i], p); p += nameBytesList[i].length;
    answer[p++] = (questions[i].qtype >> 8) & 0xff;
    answer[p++] = questions[i].qtype & 0xff;
    answer[p++] = (questions[i].qclass >> 8) & 0xff;
    answer[p++] = questions[i].qclass & 0xff;
  }
  for (let i = 0; i < questions.length; i++) {
    if (questions[i].qtype !== 1) continue;
    answer[p++] = 0xc0; answer[p++] = qOffsets[i] & 0xff; // 指针回问题名
    answer[p++] = 0; answer[p++] = 1; // type A
    answer[p++] = 0; answer[p++] = 1; // class IN
    answer.set([0, 0, 0, 60], p); p += 4; // TTL 60
    answer[p++] = 0; answer[p++] = 4; // rdlength
    answer.set(rdata, p); p += 4;
  }
  return answer;
}

// 返回 { method, path, headers, host, headerEnd, bodyBytes }。
function parseHttpRequest(buf) {
  const text = new TextDecoder().decode(buf);
  const headerEnd = text.indexOf("\r\n\r\n");
  const header = headerEnd < 0 ? text : text.slice(0, headerEnd);
  const [requestLine, ...headerLines] = header.split("\r\n");
  const sp = requestLine.indexOf(" ");
  const method = (sp < 0 ? requestLine : requestLine.slice(0, sp)).trim() || "GET";
  const rest = sp < 0 ? "" : requestLine.slice(sp + 1);
  const path = (rest.split(" ")[0] || "/").trim();
  const headers = {};
  let host = "";
  for (const line of headerLines) {
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const k = line.slice(0, idx).trim().toLowerCase();
    const v = line.slice(idx + 1).trim();
    headers[k] = v;
    if (k === "host") host = v;
  }
  let bodyBytes = new Uint8Array(0);
  if (headerEnd >= 0 && ["POST", "PUT", "PATCH"].includes(method)) {
    const m = /content-length:\s*(\d+)/i.exec(header);
    const len = m ? parseInt(m[1], 10) : 0;
    bodyBytes = buf.subarray(headerEnd + 4, headerEnd + 4 + len);
  }
  return { method, path, headers, host, headerEnd, bodyBytes };
}

// 判断缓冲里的 HTTP 请求是否已完整收到(含 body)。
function requestComplete(buf) {
  const text = new TextDecoder().decode(buf);
  const headerEnd = text.indexOf("\r\n\r\n");
  if (headerEnd < 0) return false;
  const header = text.slice(0, headerEnd);
  const method = header.split(" ")[0];
  if (["POST", "PUT", "PATCH"].includes(method)) {
    const m = /content-length:\s*(\d+)/i.exec(header);
    const len = m ? parseInt(m[1], 10) : 0;
    return buf.length >= headerEnd + 4 + len;
  }
  return true;
}

// 把一个解析后的请求按 scheme/port 拼成真实 URL，去 fetch，再把响应
// 重装成带正确 Content-Length 的 HTTP 响应字节。HTTP 与 HTTPS 共用。
async function buildHttpResponse(gw, req, scheme, port) {
  const { method, path, headers, host, bodyBytes } = req;
  const hostName = host ? host.replace(/:\d+$/, "") : "";
  const portSuffix =
    scheme === "https"
      ? (port === 80 || port === 443 ? "" : ":" + port)
      : (port === 80 ? "" : ":" + port);
  const url = `${scheme}://${hostName}${portSuffix}${path}`;
  const fetchHeaders = new Headers();
  for (const [k, v] of Object.entries(headers)) {
    if (["host", "content-length", "connection", "transfer-encoding"].includes(k))
      continue;
    try { fetchHeaders.set(k, v); } catch {}
  }
  const init = {
    method,
    headers: fetchHeaders,
    redirect: "follow",
  };
  if (["POST", "PUT", "PATCH"].includes(method) && bodyBytes && bodyBytes.length) {
    init.body = bodyBytes;
  }
  let statusLine, headerStr, body;
  // 先直连 fetch，失败(典型是 COEP 跨源隔离下目标站无 CORS 头)再用 CORS 代理回退一次
  const fetched = await fetchWithFallback(gw, url, init);
  if (fetched.resp) {
    const resp = fetched.resp;
    statusLine = `HTTP/1.1 ${resp.status} ${resp.statusText}\r\n`;
    const keep = new Set([
      "content-type",
      "content-encoding",
      "last-modified",
      "etag",
      "cache-control",
      "expires",
      "server",
      "date",
      "location",
    ]);
    headerStr = "";
    resp.headers.forEach((v, k) => {
      if (k.toLowerCase() === "content-encoding") return; // 我们已解码
      if (k.toLowerCase() === "content-length") return; // 我们重算
      if (keep.has(k.toLowerCase())) headerStr += `${k}: ${v}\r\n`;
    });
    body = new Uint8Array(await resp.arrayBuffer());
  } else {
    statusLine = "HTTP/1.1 502 Bad Gateway\r\n";
    headerStr = "";
    body = new TextEncoder().encode(fetched.error);
  }
  const head = new TextEncoder().encode(
    statusLine + headerStr + `Content-Length: ${body.length}\r\n\r\n`,
  );
  const response = new Uint8Array(head.length + body.length);
  response.set(head, 0);
  response.set(body, head.length);
  return response;
}

// 在宿主全局环境执行一段 JS，返回字符串结果(出错返回 "Error: ...")。
// 支持异步脚本(结果为 thenable 时 await 其完成值)。
async function evalJS(src) {
  try {
    let r = (0, eval)(src);
    if (r && typeof r.then === "function") r = await r;
    return r === undefined || r === null ? "" : String(r);
  } catch (e) {
    return "Error: " + (e && e.message ? e.message : String(e));
  }
}

// 发起真实 fetch：先直连，失败(典型是 COEP 跨源隔离下目标站无 CORS 头)再用
// CORS 代理回退一次。返回 { resp } 或 { error }。
async function fetchWithFallback(gw, url, init) {
  try {
    const resp = await gw.fetch(url, init);
    return { resp };
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    const proxy = gw.corsProxy;
    if (!proxy) {
      return { error: "fetch failed: " + msg };
    }
    if (gw.debug) {
      console.log("[fetch-gw] direct fetch failed, retrying via proxy:", msg);
    }
    try {
      const proxiedUrl = proxy + url;
      const resp = await gw.fetch(proxiedUrl, init);
      return { resp };
    } catch (err2) {
      return {
        error:
          "fetch failed (direct + proxy): " +
          (err2 && err2.message ? err2.message : String(err2)),
      };
    }
  }
}

// ---------------------------------------------------------------------------
// 各应用层服务(每个 accepted 连接一个处理器)
// ---------------------------------------------------------------------------

// TCP 80 / execPort：明文 HTTP。kind = "proxy" | "exec"
async function serveHttpConn(gw, conn, kind, port) {
  const reader = conn.readable.getReader();
  const writer = conn.writable.getWriter();
  try {
    const buf = await readHttpRequest(reader);
    if (!buf || !requestComplete(buf)) return;
    let response;
    if (kind === "exec") {
      // jsexec：请求体当 JS 在宿主全局环境执行(与 /dev/jsexec 语义一致)
      const req = parseHttpRequest(buf);
      const src = new TextDecoder().decode(req.bodyBytes && req.bodyBytes.length
        ? req.bodyBytes
        : buf.subarray(req.headerEnd + 4));
      const result = await evalJS(src);
      const body = new TextEncoder().encode(result);
      const head = new TextEncoder().encode(
        "HTTP/1.1 200 OK\r\n" +
          "Content-Type: text/plain; charset=utf-8\r\n" +
          `Content-Length: ${body.length}\r\n` +
          "Connection: close\r\n\r\n",
      );
      response = appendBytes(head, body);
    } else {
      const req = parseHttpRequest(buf);
      const scheme = gw.forceHttps ? "https" : "http";
      response = await buildHttpResponse(gw, req, scheme, port);
    }
    await writer.write(response);
  } catch (e) {
    if (gw.debug) console.log("[fetch-gw] http conn err:", e && e.message ? e.message : e);
  } finally {
    // 关闭写侧(FIN)。busybox wget 靠 Content-Length 判定结束，FIN 只是补刀。
    try { await writer.close(); } catch {}
    try { reader.releaseLock(); } catch {}
  }
}

// TCP 443：forge 终结 TLS，解密出的明文请求走代理
async function serveTlsConn(gw, conn) {
  const reader = conn.readable.getReader();
  const writer = conn.writable.getWriter();
  let plainBuf = new Uint8Array(0);
  let fetched = false;
  const tls = forge.tls.createConnection({
    server: true,
    // vendored forge 只认 getCertificate/getPrivateKey 回调返回的 PEM 字符串
    getCertificate: () => gw.tlsCert,
    getPrivateKey: () => gw.tlsKey,
    cipherSuites: [
      // busybox 1.38 是纯 TLS 1.2，主推 SHA256 版 RSA 套件(0x003D/0x003C)；
      // vendored forge 已扩展支持 TLS 1.2(P_SHA256 PRF + SHA256 握手哈希)。
      // 保留 SHA1 版(0x0035/0x002F, TLS 1.0/1.1)兼容老客户端。
      forge.tls.CipherSuites.TLS_RSA_WITH_AES_256_CBC_SHA256,
      forge.tls.CipherSuites.TLS_RSA_WITH_AES_128_CBC_SHA256,
      forge.tls.CipherSuites.TLS_RSA_WITH_AES_256_CBC_SHA,
      forge.tls.CipherSuites.TLS_RSA_WITH_AES_128_CBC_SHA,
    ],
    verifyClient: false,
    // forge 无条件调用 c.connected(c)，必须提供回调
    connected: () => {
      if (gw.debug) console.log("[fetch-gw] tls connected");
    },
    // 加密输出 → 写回客户机(lwIP 负责分段/重传/窗口)
    tlsDataReady: (c) => {
      const bytes = decBin(c.tlsData.getBytes());
      if (bytes.length) writer.write(bytes).catch(() => {});
    },
    // 解密出的明文请求
    dataReady: (c) => {
      const plain = decBin(c.data.getBytes());
      plainBuf = appendBytes(plainBuf, plain);
      if (!fetched && requestComplete(plainBuf)) {
        fetched = true;
        (async () => {
          const req = parseHttpRequest(plainBuf);
          try {
            const response = await buildHttpResponse(gw, req, "https", 443);
            tls.prepare(encBin(response));
            tls.process();
            tls.close(); // 发 close_notify；closed 回调里再关 TCP 写侧
          } catch (e) {
            if (gw.debug) console.log("[fetch-gw] tls proxy err:", e && e.message ? e.message : e);
            try { tls.close(); } catch {}
          }
        })();
      }
    },
    // TLS 会话关闭(close_notify 已发出)：关 TCP 写侧(FIN)
    closed: () => {
      if (gw.debug) console.log("[fetch-gw] tls closed");
      writer.close().catch(() => {});
    },
    error: (c, e) => {
      if (gw.debug) console.log("[fetch-gw] tls error:", e && e.message ? e.message : e);
      // 让 tlsDataReady 把 alert 发出去后再关闭
      writer.close().catch(() => {});
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
  } catch {}
  try { reader.releaseLock(); } catch {}
}

// UDP 53：合成 DNS(全部 A 查询 → syntheticIp)
async function serveDns(gw, sock) {
  const reader = sock.readable.getReader();
  const writer = sock.writable.getWriter();
  while (true) {
    let value, done;
    try { ({ value, done } = await reader.read()); } catch { break; }
    if (done) break;
    if (!value || !value.data) continue;
    const answer = buildDnsAnswer(value.data, gw.syntheticIp);
    if (!answer) continue; // 畸形查询，丢弃
    try {
      await writer.write({ host: value.host, port: value.port, data: answer });
    } catch (e) {
      if (gw.debug) console.log("[fetch-gw] dns send err:", e && e.message ? e.message : e);
    }
  }
}

// 逐个 accept 监听器上的连接，交给对应处理器(不阻塞 accept 循环)
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

/**
 * 在指定的以太网网络上挂载一个 fetch 网关(lwIP/tcpip 库实现)。
 * @param {object} network 来自 `ethernetNetwork()` 的交换机
 * @param {object} [options]
 * @param {string} [options.gatewayIp="10.0.2.2"] 网关 IP(客户机默认路由指向它)
 * @param {number[]|string} [options.gatewayMac] 网关 MAC(任意合法地址，需固定)
 * @param {string} [options.syntheticIp="203.0.113.1"] 对所有域名返回的假 IP
 * @param {number} [options.dnsPort=53] 网关监听的 DNS 端口
 * @param {number} [options.execPort=8080] jsexec HTTP 服务端口(仅网关 IP)
 * @param {typeof fetch} [options.fetch] 自定义 fetch(默认全局 fetch)
 * @param {boolean} [options.forceHttps=true] 明文 http 请求升级为 https 去 fetch
 * @param {string} [options.corsProxy] CORS 代理前缀(直连失败时回退)
 * @param {string|object} [options.tlsCert] TLS 证书(PEM 或 forge 对象；默认自动生成)
 * @param {string|object} [options.tlsKey] TLS 私钥(PEM 或 forge 对象)
 * @returns {Promise<{ close: () => void }>}
 */
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
    fetch: options.fetch || fetch,
    tlsCert: tlsPair.cert,
    tlsKey: tlsPair.key,
    debug: options.debug || false,
  };

  // lwIP 栈 + 双 tap：tapA=网关 IP(对外收发帧)；tapB=合成 IP(仅为让 lwIP
  // 持有该 IP、把发往它的连接本地交付，不直接桥接入帧)
  const stack = await createStack();
  const tapA = await stack.interfaces.createTap({
    ip: gw.gatewayIp + "/24",
    mac: gw.gatewayMac,
  });
  const tapB = await stack.interfaces.createTap({
    ip: gw.syntheticIp + "/24",
  });

  // --- 帧桥接 ---
  const tapAWriter = tapA.writable.getWriter();
  const gwMacBytes = Uint8Array.from(gw.gatewayMac.split(":").map((h) => parseInt(h, 16)));
  let closed = false;
  const port = network.addPort((frame) => {
    if (closed || !frame || frame.byteLength < 14) return;
    // 只喂发给网关 MAC 或广播的帧(与真实网卡行为一致)
    const dst = frame.subarray(0, 6);
    const isBroadcast = dst.every((b) => b === 0xff);
    const isMine = dst.every((x, i) => x === gwMacBytes[i]);
    if (!isBroadcast && !isMine) return;
    tapAWriter.write(frame).catch(() => {});
  });
  gw.port = port;
  // lwIP 出帧 → 交换机。send 可能同步 throw 也可能返回 rejected Promise，都要吞。
  const sendOut = (frame) => {
    try {
      const r = port.send(frame);
      if (r && typeof r.catch === "function") r.catch(() => {});
    } catch {}
  };
  tapA.readable.pipeTo(new WritableStream({ write: sendOut })).catch(() => {});
  // tapB 一般不出帧(回包按路由走 tapA)，但保险起见也桥出去
  tapB.readable.pipeTo(new WritableStream({ write: sendOut })).catch(() => {});

  // --- 应用层服务 ---
  const httpListener = await stack.tcp.listen({ port: 80 });
  acceptLoop(gw, httpListener, (conn) => serveHttpConn(gw, conn, "proxy", 80));
  const tlsListener = await stack.tcp.listen({ port: 443 });
  acceptLoop(gw, tlsListener, (conn) => serveTlsConn(gw, conn));
  // jsexec 只绑定网关 IP，避免拦截发往合成 IP 同端口的真实代理流量
  const execListener = await stack.tcp.listen({ host: gw.gatewayIp, port: gw.execPort });
  acceptLoop(gw, execListener, (conn) => serveHttpConn(gw, conn, "exec", gw.execPort));
  const dnsSock = await stack.udp.open({ host: gw.gatewayIp, port: gw.dnsPort });
  serveDns(gw, dnsSock);

  return {
    close() {
      closed = true;
      try { port.close(); } catch {}
      try { dnsSock.close && dnsSock.close(); } catch {}
      try { tapAWriter.releaseLock(); } catch {}
      stack.interfaces.remove(tapA).catch(() => {});
      stack.interfaces.remove(tapB).catch(() => {});
    },
  };
}

// 把内联的纯逻辑 re-export 出去，保持既有单元测试/调用方兼容。
// 注意：handleDns / TcpConnection 属于手写栈参考实现(fetch-network-manual.js)，
// 库版网关不使用，相关单元测试请直接从 fetch-network-manual.js 引入。
export {
  evalJS,
  fetchWithFallback,
  parseHttpRequest,
  requestComplete,
  buildHttpResponse,
  buildDnsAnswer,
  generateTlsCert,
  toPemCert,
  toPemKey,
  encBin,
  decBin,
  appendBytes,
  ipToBytes,
};
