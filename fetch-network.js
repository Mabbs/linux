// SPDX-License-Identifier: MIT
//
// fetch-network.js
// ---------------------------------------------------------------------------
// 一个用浏览器 `fetch()` 模拟互联网的网关，挂在 @tombl/linux 的
// `ethernetNetwork()` 交换机上。

import { createStack } from "./vendor/tcpip/dist/index.js";
import { forge } from "./vendor/forge/forge.js";

// ===========================================================================
// 高效缓冲分块累加器 (替代频繁 appendBytes / Uint8Array 重新分配)
// ===========================================================================
class ChunkBuffer {
  constructor() {
    this.chunks = [];
    this.length = 0;
  }

  push(chunk) {
    if (chunk && chunk.length > 0) {
      this.chunks.push(chunk);
      this.length += chunk.length;
    }
  }

  // 跨 Chunk 寻找 \r\n\r\n (13, 10, 13, 10)，返回起始字节偏移量 (找不到返回 -1)
  findHeaderEnd() {
    let state = 0;
    let globalIdx = 0;
    for (const chunk of this.chunks) {
      for (let i = 0; i < chunk.length; i++) {
        const b = chunk[i];
        if (state === 0 && b === 13) state = 1;
        else if (state === 1 && b === 10) state = 2;
        else if (state === 2 && b === 13) state = 3;
        else if (state === 3 && b === 10) return globalIdx - 3;
        else if (b === 13) state = 1;
        else state = 0;
        globalIdx++;
      }
    }
    return -1;
  }

  // 按字节范围提取 Uint8Array 子集 (必要时才做跨块拼接)
  subarray(start, end = this.length) {
    if (start >= end || start >= this.length) return new Uint8Array(0);
    const actualEnd = Math.min(end, this.length);
    const targetLen = actualEnd - start;
    const result = new Uint8Array(targetLen);

    let offset = 0;
    let copied = 0;
    for (const chunk of this.chunks) {
      const chunkStart = offset;
      const chunkEnd = offset + chunk.length;
      if (chunkEnd > start && chunkStart < actualEnd) {
        const srcStart = Math.max(0, start - chunkStart);
        const srcEnd = Math.min(chunk.length, actualEnd - chunkStart);
        const slice = chunk.subarray(srcStart, srcEnd);
        result.set(slice, copied);
        copied += slice.length;
        if (copied >= targetLen) break;
      }
      offset = chunkEnd;
    }
    return result;
  }
}

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

async function readHttpRequest(reader, maxLen = 1 << 20) {
  const buf = new ChunkBuffer();
  while (true) {
    if (requestComplete(buf)) return buf;
    const { value, done } = await reader.read();
    if (done) return buf.length ? buf : null;
    if (value && value.length) buf.push(value);
    if (buf.length > maxLen) return null;
  }
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

function ipToBytes(ip) {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !(n >= 0 && n <= 255)))
    throw new Error("bad ip: " + ip);
  return Uint8Array.from(p);
}

function buildDnsAnswer(udp, syntheticIp) {
  if (udp.length < 12) return null;
  const qdcount = (udp[4] << 8) | udp[5];
  if (qdcount < 1) return null;

  const questions = [];
  let off = 12;
  for (let q = 0; q < qdcount; q++) {
    const labels = [];
    let ok = true;
    while (off < udp.length && udp[off] !== 0) {
      const len = udp[off];
      if (len >= 0xc0) { ok = false; break; }
      if (off + 1 + len > udp.length) { ok = false; break; }
      labels.push(String.fromCharCode(...udp.subarray(off + 1, off + 1 + len)));
      off += len + 1;
    }
    if (!ok || off >= udp.length) return null;
    off += 1;
    if (off + 4 > udp.length) return null;
    const qtype = (udp[off] << 8) | udp[off + 1];
    const qclass = (udp[off + 2] << 8) | udp[off + 3];
    off += 4;
    questions.push({ labels, qtype, qclass });
  }

  const id = udp.subarray(0, 2);
  const rdata = ipToBytes(syntheticIp);
  const ancount = questions.reduce((n, q) => n + (q.qtype === 1 ? 1 : 0), 0);

  let qsize = 0;
  const nameBytesList = questions.map((q) => {
    const nb = [];
    for (const label of q.labels) {
      nb.push(label.length);
      for (let i = 0; i < label.length; i++) nb.push(label.charCodeAt(i));
    }
    nb.push(0);
    qsize += nb.length + 2 + 2;
    return nb;
  });
  const total = 12 + qsize + ancount * (2 + 2 + 2 + 4 + 2 + 4);
  const answer = new Uint8Array(total);
  let p = 0;
  answer.set(id, p); p += 2;
  answer[p++] = 0x81; answer[p++] = 0x80;
  answer[p++] = (qdcount >> 8) & 0xff; answer[p++] = qdcount & 0xff;
  answer[p++] = (ancount >> 8) & 0xff; answer[p++] = ancount & 0xff;
  answer[p++] = 0; answer[p++] = 0;
  answer[p++] = 0; answer[p++] = 0;
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
    answer[p++] = 0xc0; answer[p++] = qOffsets[i] & 0xff;
    answer[p++] = 0; answer[p++] = 1;
    answer[p++] = 0; answer[p++] = 1;
    answer.set([0, 0, 0, 60], p); p += 4;
    answer[p++] = 0; answer[p++] = 4;
    answer.set(rdata, p); p += 4;
  }
  return answer;
}

function parseHttpRequest(buf) {
  const headerEndByte = buf.findHeaderEnd();
  const headerBytes = headerEndByte < 0 ? buf.subarray(0, buf.length) : buf.subarray(0, headerEndByte);

  const headerText = new TextDecoder().decode(headerBytes);
  const [requestLine, ...headerLines] = headerText.split("\r\n");

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
  if (headerEndByte >= 0 && ["POST", "PUT", "PATCH"].includes(method)) {
    const len = parseInt(headers["content-length"] || "0", 10);
    const bodyStart = headerEndByte + 4;
    bodyBytes = buf.subarray(bodyStart, bodyStart + len);
  }

  return { method, path, headers, host, headerEnd: headerEndByte, bodyBytes };
}

function requestComplete(buf) {
  const headerEndByte = buf.findHeaderEnd();
  if (headerEndByte < 0) return false;

  const headerText = new TextDecoder().decode(buf.subarray(0, headerEndByte));
  const method = headerText.split(" ")[0];
  if (["POST", "PUT", "PATCH"].includes(method)) {
    const m = /content-length:\s*(\d+)/i.exec(headerText);
    const len = m ? parseInt(m[1], 10) : 0;
    return buf.length >= headerEndByte + 4 + len;
  }
  return true;
}

// ---------------------------------------------------------------------------
// 修复核心：HTTP/1.1 分块编码（Chunked Encoding）流式输出
// ---------------------------------------------------------------------------
async function pipeHttpResponse(gw, req, scheme, port, writeChunk) {
  const { method, path, headers, host, bodyBytes } = req;
  const hostName = host ? host.replace(/:\d+$/, "") : "";
  const portSuffix = scheme === "https"
    ? (port === 80 || port === 443 ? "" : ":" + port)
    : (port === 80 ? "" : ":" + port);
  const url = `${scheme}://${hostName}${portSuffix}${path}`;

  const fetchHeaders = new Headers();
  for (const [k, v] of Object.entries(headers)) {
    if (["host", "content-length", "connection", "transfer-encoding"].includes(k)) continue;
    try { fetchHeaders.set(k, v); } catch { }
  }

  const init = { method, headers: fetchHeaders, redirect: "follow" };
  if (["POST", "PUT", "PATCH"].includes(method) && bodyBytes && bodyBytes.length) {
    init.body = bodyBytes;
  }

  const fetched = await fetchWithFallback(gw, url, init);

  if (!fetched.resp) {
    const statusLine = "HTTP/1.1 502 Bad Gateway\r\n";
    const body = new TextEncoder().encode(fetched.error);
    const head = new TextEncoder().encode(
      `${statusLine}Content-Type: text/plain; charset=utf-8\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n`
    );
    await writeChunk(head);
    await writeChunk(body);
    return;
  }

  const resp = fetched.resp;
  const statusLine = `HTTP/1.1 ${resp.status} ${resp.statusText}\r\n`;

  // 注意：【致命 Bug 修复点】绝不能在这里保留原站的 content-length！
  // 因为宿主 fetch 已经透明解压，原压缩体积已经作废。
  const keep = new Set([
    "content-type",
    "last-modified",
    "etag",
    "cache-control",
    "expires",
    "server",
    "date",
    "location"
  ]);

  let headerStr = "";
  resp.headers.forEach((v, k) => {
    const key = k.toLowerCase();
    // 强制丢弃原长度和编码
    if (key === "content-encoding" || key === "content-length") return;
    if (keep.has(key)) headerStr += `${k}: ${v}\r\n`;
  });

  const isNoBody = [204, 205, 304].includes(resp.status) || req.method === "HEAD";

  // 添加 Chunked 标识位并标明短链接
  if (!isNoBody) {
    headerStr += "Transfer-Encoding: chunked\r\n";
  }
  headerStr += "Connection: close\r\n";

  // 1. 下发 HTTP 头部
  const head = new TextEncoder().encode(`${statusLine}${headerStr}\r\n`);
  await writeChunk(head);

  // 2. 将数据流包装成 HTTP/1.1 标准的 Chunk 协议发送
  if (!isNoBody && resp.body) {
    const reader = resp.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value && value.length > 0) {
          // Chunk 头: 16进制长度 + \r\n
          const hexLen = value.length.toString(16) + "\r\n";
          await writeChunk(new TextEncoder().encode(hexLen));
          // Chunk 数据本身
          await writeChunk(value);
          // Chunk 尾: \r\n
          await writeChunk(new TextEncoder().encode("\r\n"));
        }
      }
    } finally {
      reader.releaseLock();
    }
    // 发送结束块标识: 0\r\n\r\n
    await writeChunk(new TextEncoder().encode("0\r\n\r\n"));
  }
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

// ---------------------------------------------------------------------------
// 各应用层服务
// ---------------------------------------------------------------------------

async function serveHttpConn(gw, conn, kind, port) {
  const reader = conn.readable.getReader();
  const writer = conn.writable.getWriter();
  try {
    const buf = await readHttpRequest(reader);
    if (!buf || !requestComplete(buf)) return;

    if (kind === "exec") {
      const req = parseHttpRequest(buf);
      const srcBytes = req.bodyBytes && req.bodyBytes.length
        ? req.bodyBytes
        : buf.subarray(req.headerEnd + 4);
      const src = new TextDecoder().decode(srcBytes);
      const result = await evalJS(src);
      const body = new TextEncoder().encode(result);
      const head = new TextEncoder().encode(
        "HTTP/1.1 200 OK\r\n" +
        "Content-Type: text/plain; charset=utf-8\r\n" +
        `Content-Length: ${body.length}\r\n` +
        "Connection: close\r\n\r\n",
      );
      await writer.write(head);
      await writer.write(body);
    } else {
      const req = parseHttpRequest(buf);
      const scheme = gw.forceHttps ? "https" : "http";
      await pipeHttpResponse(gw, req, scheme, port, (chunk) => writer.write(chunk));
    }
  } catch (e) {
    if (gw.debug) console.log("[fetch-gw] http conn err:", e && e.message ? e.message : e);
  } finally {
    try { await writer.close(); } catch { }
    try { reader.releaseLock(); } catch { }
  }
}

async function serveTlsConn(gw, conn) {
  const reader = conn.readable.getReader();
  const writer = conn.writable.getWriter();
  const plainBuf = new ChunkBuffer();
  let fetched = false;

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
      if (gw.debug) console.log("[fetch-gw] tls connected");
    },
    tlsDataReady: (c) => {
      const bytes = decBin(c.tlsData.getBytes());
      if (bytes.length) writer.write(bytes).catch(() => { });
    },
    dataReady: (c) => {
      const plain = decBin(c.data.getBytes());
      if (plain && plain.length) plainBuf.push(plain);

      if (!fetched && requestComplete(plainBuf)) {
        fetched = true;
        (async () => {
          const req = parseHttpRequest(plainBuf);
          try {
            await pipeHttpResponse(gw, req, "https", 443, async (chunk) => {
              tls.prepare(encBin(chunk));
              tls.process();
            });
            tls.close();
          } catch (e) {
            if (gw.debug) console.log("[fetch-gw] tls proxy err:", e && e.message ? e.message : e);
            try { tls.close(); } catch { }
          }
        })();
      }
    },
    closed: () => {
      if (gw.debug) console.log("[fetch-gw] tls closed");
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

async function serveDns(gw, sock) {
  const reader = sock.readable.getReader();
  const writer = sock.writable.getWriter();
  while (true) {
    let value, done;
    try { ({ value, done } = await reader.read()); } catch { break; }
    if (done) break;
    if (!value || !value.data) continue;
    const answer = buildDnsAnswer(value.data, gw.syntheticIp);
    if (!answer) continue;
    try {
      await writer.write({ host: value.host, port: value.port, data: answer });
    } catch (e) {
      if (gw.debug) console.log("[fetch-gw] dns send err:", e && e.message ? e.message : e);
    }
  }
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
    fetch: options.fetch || fetch,
    tlsCert: tlsPair.cert,
    tlsKey: tlsPair.key,
    debug: options.debug || false,
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

  const httpListener = await stack.tcp.listen({ port: 80 });
  acceptLoop(gw, httpListener, (conn) => serveHttpConn(gw, conn, "proxy", 80));
  const tlsListener = await stack.tcp.listen({ port: 443 });
  acceptLoop(gw, tlsListener, (conn) => serveTlsConn(gw, conn));
  const execListener = await stack.tcp.listen({ host: gw.gatewayIp, port: gw.execPort });
  acceptLoop(gw, execListener, (conn) => serveHttpConn(gw, conn, "exec", gw.execPort));
  const dnsSock = await stack.udp.open({ host: gw.gatewayIp, port: gw.dnsPort });
  serveDns(gw, dnsSock);

  return {
    close() {
      closed = true;
      try { port.close(); } catch { }
      try { dnsSock.close && dnsSock.close(); } catch { }
      try { tapAWriter.releaseLock(); } catch { }
      stack.interfaces.remove(tapA).catch(() => { });
      stack.interfaces.remove(tapB).catch(() => { });
    },
  };
}