// SPDX-License-Identifier: MIT
//
// fetch-network.js
// ---------------------------------------------------------------------------
// 一个用浏览器 `fetch()` 模拟互联网的网关，挂在 @tombl/linux 的
// `ethernetNetwork()` 交换机上。
//
// 它只实现了足以让客户机(Linux + busybox/wget)上网的最小协议栈：
//   - ARP：应答网关 IP 的 who-has 请求
//   - IPv4：解析 / 封装 IP 包(带正确的 IP/TCP 校验和)
//   - TCP：与真实内核的 TCP 栈完成三次握手、按窗口推送数据、挥手关闭
//   - DNS：对任何 A/AAAA 查询都回一个合成 IP(203.0.113.1)，从而无需
//          真正的 DNS 解析
//   - jsexec 服务：在网关 IP 的 execPort(默认 8080)上提供一个 HTTP 服务，
//          接收 JS 源码、在宿主(浏览器)全局环境里执行、把「最后一个表达式
//          的完成值」作为响应体返回。等价于原 /dev/jsexec 设备的语义，
//          让 initramfs 里的 blog 脚本可以运行。
//
// 关键思路(slirp 风格的"用户态网络栈")：
//   客户机以为自己在和真实服务器通信，实际上所有目的 IP 都被路由到本网关。
//   网关从 TCP 流里解析出 HTTP 请求，用 fetch() 去真实世界取数据，再把响应
//   按正确的 TCP 序号/确认号/校验和伪装成"服务器"回包送回客户机。
//
// 限制：
//   - 只代理明文 HTTP(端口任意)。HTTPS 的 TLS 负载无法解析，暂不支持。
//   - 浏览器跨源隔离(COEP)下，只有返回 CORS 头的站点才能让 fetch 读到响应体。
//     这是浏览器安全限制，不是本模拟的 bug。可通过 options.corsProxy 配置 CORS
//     代理回退(默认 https://cors-anywhere.mayx.eu.org/?)缓解：直连失败时用
//     `${corsProxy}${url}` 再请求一次。

// 注意：本模块不依赖 dist，调用方负责传入 `ethernetNetwork()` 创建的交换机。
// 这样在 Node 里做单元测试时无需加载 vmlinux.wasm。

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

const ETHERTYPE_IPV4 = 0x0800;
const ETHERTYPE_ARP = 0x0806;
const IPPROTO_TCP = 6;
const IPPROTO_UDP = 17;
const IPPROTO_ICMP = 1;

function ipToBytes(ip) {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !(n >= 0 && n <= 255)))
    throw new Error("bad ip: " + ip);
  return Uint8Array.from(p);
}
function bytesToIp(b) {
  return `${b[0]}.${b[1]}.${b[2]}.${b[3]}`;
}
function macEquals(a, b) {
  return a.length === 6 && a.every((x, i) => x === b[i]);
}
function randomU32() {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] >>> 0;
}

// 互联网校验和(16 位反码求和)
function internetChecksum(parts) {
  let sum = 0;
  for (const part of parts) {
    const len = part.length;
    let i = 0;
    for (; i + 1 < len; i += 2) sum += (part[i] << 8) | part[i + 1];
    if (i < len) sum += part[i] << 8; // 末尾奇数字节当高字节，低字节补 0
  }
  while (sum >>> 16) sum = (sum & 0xffff) + (sum >>> 16);
  return (~sum) & 0xffff;
}

// ---------------------------------------------------------------------------
// 帧 / 包构造
// ---------------------------------------------------------------------------

// 构造一个完整的以太网帧并发送
function sendEthernet(port, ethDst, ethSrc, ethertype, payload) {
  const frame = new Uint8Array(14 + payload.length);
  frame.set(ethDst, 0);
  frame.set(ethSrc, 6);
  frame[12] = (ethertype >> 8) & 0xff;
  frame[13] = ethertype & 0xff;
  frame.set(payload, 14);
  return port.send(frame);
}

// 构造 IPv4 包(含正确校验和)，返回 Uint8Array
function buildIp(srcIp, dstIp, protocol, payload) {
  const ihl = 5;
  const total = 20 + payload.length;
  const pkt = new Uint8Array(total);
  const dv = new DataView(pkt.buffer);
  dv.setUint8(0, (4 << 4) | ihl); // version=4, IHL=5
  dv.setUint8(1, 0); // TOS
  dv.setUint16(2, total); // total length
  dv.setUint16(4, 0); // id
  dv.setUint16(6, 0x4000); // flags=DF, frag offset 0
  dv.setUint8(8, 64); // TTL
  dv.setUint8(9, protocol);
  // checksum 占位，后面填
  pkt.set(srcIp, 12);
  pkt.set(dstIp, 16);
  dv.setUint16(10, internetChecksum([pkt.subarray(0, 20)]));
  pkt.set(payload, 20);
  return pkt;
}

// 构造 TCP 段(含正确校验和，含伪首部)
function buildTcp(
  srcIp,
  dstIp,
  srcPort,
  dstPort,
  seq,
  ack,
  flags,
  window,
  payload,
) {
  const dataOffset = 5;
  const headerLen = dataOffset * 4;
  const seg = new Uint8Array(headerLen + payload.length);
  const dv = new DataView(seg.buffer);
  dv.setUint16(0, srcPort);
  dv.setUint16(2, dstPort);
  dv.setUint32(4, seq >>> 0);
  dv.setUint32(8, ack >>> 0);
  dv.setUint8(12, (dataOffset << 4) | 0); // data offset, reserved
  dv.setUint8(13, flags);
  dv.setUint16(14, window);
  dv.setUint16(16, 0); // checksum 占位
  dv.setUint16(18, 0); // urgent pointer
  seg.set(payload, headerLen);
  // 伪首部
  const pseudo = new Uint8Array(12);
  pseudo.set(srcIp, 0);
  pseudo.set(dstIp, 4);
  pseudo[8] = 0;
  pseudo[9] = IPPROTO_TCP;
  pseudo[10] = (seg.length >> 8) & 0xff;
  pseudo[11] = seg.length & 0xff;
  dv.setUint16(16, internetChecksum([pseudo, seg]));
  return seg;
}

// TCP 标志位
const TCP_FIN = 0x01;
const TCP_SYN = 0x02;
const TCP_RST = 0x04;
const TCP_PSH = 0x08;
const TCP_ACK = 0x10;

// ---------------------------------------------------------------------------
// ARP
// ---------------------------------------------------------------------------

function handleArp(gw, frame) {
  const arp = frame.subarray(14);
  const dv = new DataView(arp.buffer, arp.byteOffset, arp.byteLength);
  const op = dv.getUint16(6);
  if (op !== 1) return; // 只看 request
  const senderIp = bytesToIp(arp.subarray(14, 18));
  const targetIp = bytesToIp(arp.subarray(24, 28));
  if (targetIp !== gw.gatewayIp) return;
  const senderMac = arp.subarray(8, 14);
  const reply = new Uint8Array(28);
  const rdv = new DataView(reply.buffer);
  rdv.setUint16(0, 1); // htype ethernet
  rdv.setUint16(2, 0x0800); // ptype IPv4
  rdv.setUint8(4, 6); // hlen
  rdv.setUint8(5, 4); // plen
  rdv.setUint16(6, 2); // reply
  reply.set(gw.gatewayMac, 8); // sender mac
  reply.set(ipToBytes(gw.gatewayIp), 14); // sender ip
  reply.set(senderMac, 18); // target mac
  reply.set(ipToBytes(senderIp), 24); // target ip
  sendEthernet(
    gw.port,
    senderMac,
    gw.gatewayMac,
    ETHERTYPE_ARP,
    reply,
  );
}

// ---------------------------------------------------------------------------
// ICMP(仅 echo reply，方便 ping 网关)
// ---------------------------------------------------------------------------

function handleIcmp(gw, ip, srcMac) {
  const icmp = ip.subarray(20);
  if (icmp[0] !== 8) return; // echo request
  const reply = new Uint8Array(icmp.length);
  reply.set(icmp);
  reply[0] = 0; // echo reply
  const dv = new DataView(reply.buffer);
  dv.setUint16(2, 0); // checksum 占位
  dv.setUint16(2, internetChecksum([reply]));
  const outIp = buildIp(
    ipToBytes(gw.gatewayIp),
    ip.subarray(12, 16),
    IPPROTO_ICMP,
    reply,
  );
  sendEthernet(gw.port, srcMac, gw.gatewayMac, ETHERTYPE_IPV4, outIp);
}

// ---------------------------------------------------------------------------
// DNS(对任何 A/AAAA 查询回合成 IP)
// ---------------------------------------------------------------------------

// 计算 UDP 校验和(带 IPv4 伪首部)。udp 为完整 UDP 段，且校验和字段已先置 0。
function udpChecksum(srcIp, dstIp, udp) {
  const pseudo = new Uint8Array(12);
  pseudo.set(srcIp, 0);
  pseudo.set(dstIp, 4);
  pseudo[8] = 0;
  pseudo[9] = IPPROTO_UDP;
  pseudo[10] = (udp.length >> 8) & 0xff;
  pseudo[11] = udp.length & 0xff;
  return internetChecksum([pseudo, udp]);
}

function handleDns(gw, udp, srcIp, srcMac, srcPort) {
  // 边界保护：至少要放得下 12 字节 DNS 头部
  if (udp.length < 12) return;
  const qdcount = (udp[4] << 8) | udp[5];
  if (qdcount < 1) return;

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
    if (!ok || off >= udp.length) return; // 畸形，放弃
    off += 1; // 跳过根标签 0
    if (off + 4 > udp.length) return;
    const qtype = (udp[off] << 8) | udp[off + 1];
    const qclass = (udp[off + 2] << 8) | udp[off + 3];
    off += 4;
    questions.push({ labels, qtype, qclass });
  }

  const id = udp.subarray(0, 2);
  const rdata = ipToBytes(gw.syntheticIp);
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

  const outUdp = new Uint8Array(8 + answer.length);
  outUdp[0] = (gw.dnsPort >> 8) & 0xff; // 源端口 = 网关 DNS 端口
  outUdp[1] = gw.dnsPort & 0xff;
  outUdp[2] = (srcPort >> 8) & 0xff; // 目的端口 = 客户机源端口
  outUdp[3] = srcPort & 0xff;
  const udpLen = 8 + answer.length; // UDP 整段长度 = 头(8) + 数据
  outUdp[4] = (udpLen >> 8) & 0xff;
  outUdp[5] = udpLen & 0xff;
  outUdp.set(answer, 8);
  // UDP 校验和(带伪首部)：不再是 0，避免被严格校验的栈丢弃
  const srcIpBytes = typeof srcIp === "string" ? ipToBytes(srcIp) : srcIp;
  let csum = udpChecksum(ipToBytes(gw.gatewayIp), srcIpBytes, outUdp);
  if (csum === 0) csum = 0xffff; // 规定校验和恰好为 0 时存 0xffff
  outUdp[6] = (csum >> 8) & 0xff;
  outUdp[7] = csum & 0xff;
  const outIp = buildIp(
    ipToBytes(gw.gatewayIp),
    srcIpBytes,
    IPPROTO_UDP,
    outUdp,
  );
  sendEthernet(gw.port, srcMac, gw.gatewayMac, ETHERTYPE_IPV4, outIp);
}

// ---------------------------------------------------------------------------
// TCP 连接状态机
// ---------------------------------------------------------------------------

class TcpConnection {
  constructor(gw, clientMac, clientIp, clientPort, serverIp, serverPort, isn) {
    this.gw = gw;
    this.clientMac = clientMac;
    this.clientIp = clientIp;
    this.clientPort = clientPort;
    this.serverIp = serverIp; // 合成 IP(来自客户机 IP 目的地址)
    this.serverPort = serverPort;
    this.clientIsn = isn;
    this.serverIsn = randomU32();
    this.nextClientSeq = (isn + 1) >>> 0; // 期望的下一个客户机序号
    this.nextServerSeq = this.serverIsn; // 下一段"服务器"数据的序号(SYN 本身占用 1)
    this.clientWindow = 65535;
    this.recvBuf = new Uint8Array(0);
    this.established = false;
    this.fetchStarted = false;
    this.response = null; // 构造好的完整 HTTP 响应(Uint8Array)
    this.sent = 0; // 已发送的响应字节数
    this.acked = 0; // 客户机已确认的响应字节数
    this.finSent = false;
    this.clientFin = false;
    this.done = false;
    this.rexmitTimer = null; // 超时重传定时器
    this.rexmitRto = 400; // 当前重传超时(毫秒)，收到 ACK 进展时重置为 400
    this.rexmitCount = 0;
    this.gwKey = null;
  }

  // 向客户机发送一段 TCP(从当前 nextServerSeq 处)
  _send(flags, payload) {
    this._sendAt(this.nextServerSeq, flags, payload);
  }

  // 从指定序号处发送一段 TCP(用于重传未确认段，seq 必须为该段原始的序号)
  _sendAt(seq, flags, payload) {
    const gw = this.gw;
    const seg = buildTcp(
      ipToBytes(this.serverIp),
      ipToBytes(this.clientIp),
      this.serverPort,
      this.clientPort,
      seq,
      this.nextClientSeq,
      flags,
      this.clientWindow,
      payload,
    );
    const outIp = buildIp(
      ipToBytes(this.serverIp),
      ipToBytes(this.clientIp),
      IPPROTO_TCP,
      seg,
    );
    sendEthernet(gw.port, this.clientMac, gw.gatewayMac, ETHERTYPE_IPV4, outIp);
  }

  // 发送 SYN-ACK(握手第二步)
  sendSynAck() {
    this._send(TCP_SYN | TCP_ACK, new Uint8Array(0));
    // SYN 占一个序号
    this.nextServerSeq = (this.serverIsn + 1) >>> 0;
  }

  // 仅 ACK
  sendAck() {
    this._send(TCP_ACK, new Uint8Array(0));
  }

  // 收到带数据的段(PSH)
  onData(payload) {
    if (payload.length === 0) return;
    const next = new Uint8Array(this.recvBuf.length + payload.length);
    next.set(this.recvBuf, 0);
    next.set(payload, this.recvBuf.length);
    this.recvBuf = next;
    this.nextClientSeq = (this.nextClientSeq + payload.length) >>> 0;
    this.sendAck();
    if (!this.fetchStarted && requestComplete(this.recvBuf)) {
      this.fetchStarted = true;
      if (this.serverIp === this.gw.gatewayIp && this.serverPort === this.gw.execPort) {
        this.startExec();
      } else {
        this.startFetch();
      }
    }
  }

  // 解析 HTTP 请求并发起 fetch
  async startFetch() {
    const text = new TextDecoder().decode(this.recvBuf);
    const headerEnd = text.indexOf("\r\n\r\n");
    const header = text.slice(0, headerEnd);
    const [requestLine, ...headerLines] = header.split("\r\n");
    const [method, path] = requestLine.split(" ");
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
    const port = this.serverPort; // 客户机连的端口
    const hostName = host ? host.replace(/:\d+$/, "") : this.serverIp;
    // 默认把客户机的 http 请求升级为 https 去取真实站点(现代站点基本都支持 https)
    const scheme = this.gw.forceHttps ? "https" : "http";
    const portSuffix =
      scheme === "https"
        ? (port === 80 || port === 443 ? "" : ":" + port)
        : (port === 80 ? "" : ":" + port);
    const url = `${scheme}://${hostName}${portSuffix}${path}`;
    const fetchHeaders = new Headers();
    for (const [k, v] of Object.entries(headers)) {
      if (["host", "content-length", "connection", "transfer-encoding"].includes(k))
        continue;
      try { fetchHeaders.set(k, v); } catch { }
    }
    const init = {
      method,
      headers: fetchHeaders,
      redirect: "follow",
    };
    if (["POST", "PUT", "PATCH"].includes(method)) {
      const cl = parseInt(headers["content-length"] || "0", 10);
      const body = this.recvBuf.subarray(headerEnd + 4, headerEnd + 4 + cl);
      init.body = body;
    }
    let statusLine, headerStr, bodyBytes;
    const fetched = await fetchWithFallback(this.gw, url, init);
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
      bodyBytes = new Uint8Array(await resp.arrayBuffer());
    } else {
      statusLine = "HTTP/1.1 502 Bad Gateway\r\n";
      headerStr = "";
      bodyBytes = new TextEncoder().encode(fetched.error);
    }
    const head = new TextEncoder().encode(
      statusLine + headerStr + `Content-Length: ${bodyBytes.length}\r\n\r\n`,
    );
    const response = new Uint8Array(head.length + bodyBytes.length);
    response.set(head, 0);
    response.set(bodyBytes, head.length);
    this.response = response;
    this.pump();
  }

  // 发起真实 fetch：先直连，失败(典型是 COEP 跨源隔离下目标站无 CORS 头)
  // 再用 CORS 代理回退一次。返回 { resp } 或 { error }。
  async _fetchWithFallback(url, init) {
    return fetchWithFallback(this.gw, url, init);
  }

  // jsexec 服务：把请求体当成 JavaScript，在宿主(浏览器)全局环境里执行，
  // 把「最后一个表达式的完成值」作为 HTTP 响应体返回。等价于原 /dev/jsexec 设备。
  async startExec() {
    const text = new TextDecoder().decode(this.recvBuf);
    const headerEnd = text.indexOf("\r\n\r\n");
    const header = text.slice(0, headerEnd);
    const method = header.split(" ")[0];
    let bodyBytes;
    if (["POST", "PUT", "PATCH"].includes(method)) {
      const m = /content-length:\s*(\d+)/i.exec(header);
      const len = m ? parseInt(m[1], 10) : 0;
      bodyBytes = this.recvBuf.subarray(headerEnd + 4, headerEnd + 4 + len);
    } else {
      bodyBytes = this.recvBuf.subarray(headerEnd + 4);
    }
    const src = new TextDecoder().decode(bodyBytes);
    const result = await evalJS(src);
    const body = new TextEncoder().encode(result);
    const head = new TextEncoder().encode(
      "HTTP/1.1 200 OK\r\n" +
      "Content-Type: text/plain; charset=utf-8\r\n" +
      `Content-Length: ${body.length}\r\n` +
      "Connection: close\r\n\r\n",
    );
    const response = new Uint8Array(head.length + body.length);
    response.set(head, 0);
    response.set(body, head.length);
    this.response = response;
    this.pump();
  }

  // 按客户机窗口把响应推出去，发完补一个 FIN
  pump() {
    if (!this.response) return;
    while (this.sent < this.response.length) {
      const inFlight = this.sent - this.acked;
      if (inFlight >= this.clientWindow) break; // 窗口满，等 ACK
      const seg = Math.min(
        this.gw.mss,
        this.clientWindow - inFlight,
        this.response.length - this.sent,
      );
      const payload = this.response.subarray(this.sent, this.sent + seg);
      this._send(TCP_PSH | TCP_ACK, payload);
      this.sent += seg;
      this.nextServerSeq = (this.nextServerSeq + seg) >>> 0;
    }
    if (this.sent >= this.response.length && !this.finSent) {
      this.finSent = true;
      this._send(TCP_FIN | TCP_ACK, new Uint8Array(0));
      this.nextServerSeq = (this.nextServerSeq + 1) >>> 0;
      // 双方都已关闭则立刻释放，避免占用临时端口
      if (this.clientFin && this.gwKey != null)
        this.gw.connections.delete(this.gwKey);
    } else if (this.sent < this.response.length && !this.finSent) {
      // 还有数据没推完(多半是窗口满后还没等到 ACK)：排期一次超时重传，
      // 防链路偶发丢帧后永久卡死。
      this.scheduleRexmit();
    }
  }

  // 超时重传：链路偶发丢帧时，若一段时间没收到 ACK 推进，就重发最旧的未确认段。
  // 用指数退避，收到进展(onAck)时会被取消并重置超时。重传不受客户机窗口限制
  // (TCP 规范：客户机必须收下重传段)，这样在"链路丢帧、客户机窗口其实还空、
  // 只是一直没 ACK"的死锁场景也能自我恢复。
  scheduleRexmit() {
    if (this.rexmitTimer || this.done) return;
    const rto = this.rexmitRto || 400;
    this.rexmitTimer = setTimeout(() => {
      this.rexmitTimer = null;
      if (this.done) return;
      if (this.rexmitCount++ > 8) {
        this.done = true;
        if (this.gwKey != null) this.gw.connections.delete(this.gwKey);
        return;
      }
      if (this.sent >= this.response.length) {
        // 数据已发完，只差 FIN 被确认；若 FIN 还没发就补发
        if (!this.finSent) this.pump();
        return;
      }
      // 超时仍无 ACK 进展：重发最旧的未确认段(序号必须对应原始位置)
      const start = this.acked;
      const seg = Math.min(this.gw.mss, this.response.length - start);
      this._sendAt(
        (this.serverIsn + 1 + start) >>> 0,
        TCP_PSH | TCP_ACK,
        this.response.subarray(start, start + seg),
      );
      this.rexmitRto = Math.min((this.rexmitRto || 400) * 2, 4000); // 指数退避，上限 4s
      this.scheduleRexmit();
    }, rto);
  }

  // 客户机的 ACK(推进窗口)
  onAck() {
    if (this.rexmitTimer) { clearTimeout(this.rexmitTimer); this.rexmitTimer = null; }
    this.rexmitRto = 400; // 收到进展，重置退避
    this.rexmitCount = 0;
    this.pump();
  }
}

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

async function evalJS(src) {
  try {
    let r = (0, eval)(src);
    // 支持异步脚本(如 fetch 返回 Promise)：结果为 thenable 时等待其完成值，
    // 这样 jsexec 里写 `fetch(url).then(...)` 也能拿到真正的字符串结果。
    if (r && typeof r.then === "function") r = await r;
    return r === undefined || r === null ? "" : String(r);
  } catch (e) {
    return "Error: " + (e && e.message ? e.message : String(e));
  }
}

// ---------------------------------------------------------------------------
// TCP 入口
// ---------------------------------------------------------------------------

function handleTcp(gw, ip, srcMac, srcIp) {
  const tcp = ip.subarray(20);
  const dv = new DataView(tcp.buffer, tcp.byteOffset, tcp.byteLength);
  const srcPort = dv.getUint16(0);
  const dstPort = dv.getUint16(2);
  const seq = dv.getUint32(4) >>> 0;
  const ack = dv.getUint32(8) >>> 0;
  const dataOffset = (tcp[12] >> 4) & 0x0f;
  const flags = tcp[13];
  const window = dv.getUint16(14);
  const payload = tcp.subarray(dataOffset * 4);

  const serverIp = bytesToIp(ip.subarray(16, 20)); // 客户机的目的 IP(合成 IP)
  const key = `${srcPort}:${dstPort}`;
  let conn = gw.connections.get(key);

  if (flags & TCP_SYN) {
    if (conn) return; // 重复 SYN，忽略
    conn = new TcpConnection(
      gw,
      srcMac,
      srcIp,
      srcPort,
      serverIp,
      dstPort,
      seq,
    );
    conn.clientWindow = window;
    conn.gwKey = key;
    gw.connections.set(key, conn);
    conn.sendSynAck();
    return;
  }
  if (!conn) return; // 未知连接，丢弃

  // 关键：每收到客户机的一段都更新其通告的接收窗口。否则 clientWindow 永远停留在
  // SYN 时的值；当客户机接收大数据、应用读取慢导致缓冲区阶段性填满、窗口收缩时，
  // 网关仍按旧的大窗口继续发，超额段被客户机丢弃且不再回 ACK，inFlight 卡死，连接
  // 永久停滞。这是"数据较大时卡住"的直接原因。
  conn.clientWindow = window;

  // 更新期望的客户机序号(仅当本段携带数据时)
  if (payload.length > 0) {
    conn.onData(payload);
  } else {
    // 纯 ACK(握手的第三步 / 数据 ACK)
    if (flags & TCP_ACK) {
      conn.acked = (ack - (conn.serverIsn + 1)) >>> 0;
      conn.onAck();
    }
  }
  if (flags & TCP_FIN) {
    conn.clientFin = true;
    conn.nextClientSeq = (conn.nextClientSeq + 1) >>> 0;
    conn.sendAck();
  }
  if (conn.clientFin && conn.finSent) {
    conn.done = true;
    if (conn.rexmitTimer) { clearTimeout(conn.rexmitTimer); conn.rexmitTimer = null; }
    if (conn.gwKey != null) gw.connections.delete(conn.gwKey);
  }
}

// ---------------------------------------------------------------------------
// UDP 入口
// ---------------------------------------------------------------------------

function handleUdp(gw, ip, srcMac, srcIp) {
  const udp = ip.subarray(20);
  const dv = new DataView(udp.buffer, udp.byteOffset, udp.byteLength);
  const dstPort = dv.getUint16(2);
  if (dstPort === gw.dnsPort) {
    // 注意：handleDns 把入参当作「纯 DNS 段」解析(DNS 头在偏移 0)，
    // 所以这里必须跳过 8 字节 UDP 头，否则会把 UDP 长度字段误读成 qdcount。
    const dns = udp.subarray(8);
    handleDns(gw, dns, srcIp, srcMac, dv.getUint16(0));
  }
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

/**
 * 在指定的以太网网络上挂载一个 fetch 网关。
 * @param {object} network 来自 `ethernetNetwork()` 的交换机
 * @param {object} [options]
 * @param {string} [options.gatewayIp="10.0.2.2"] 网关 IP(客户机默认路由指向它)
 * @param {number[]} [options.gatewayMac] 网关 MAC(任意合法地址，需固定)
 * @param {string} [options.syntheticIp="203.0.113.1"] 对所有域名返回的假 IP
 * @param {number} [options.dnsPort=53] 网关监听的 DNS 端口
 * @param {number} [options.execPort=8080] 网关提供的 jsexec HTTP 服务端口
 *          客户机把 JS 源码 POST 到 10.0.2.2:execPort 即可在宿主环境执行，
 *          响应体为「最后一个表达式的完成值」。等价于原 /dev/jsexec 设备。
 * @param {number} [options.mss=1460] 我们发给客户机时使用的 TCP MSS
 * @param {typeof fetch} [options.fetch] 自定义 fetch(默认全局 fetch)
 * @param {string} [options.corsProxy="https://cors-anywhere.mayx.eu.org/?"]
 *           CORS 代理回退。当「直接 fetch」失败(典型是跨源隔离 COEP 下目标站
 *           不返回 CORS 头导致 fetch 抛错)时，会用
 *           `${corsProxy}${url}` 再请求一次。传空字符串 "" 可禁用回退。
 * @returns {{ close: () => void }}
 */
export function fetchInternetGateway(network, options = {}) {
  const gw = {
    gatewayIp: options.gatewayIp || "10.0.2.2",
    gatewayMac: options.gatewayMac || [0x52, 0x55, 0x0a, 0x00, 0x02, 0x02],
    syntheticIp: options.syntheticIp || "203.0.113.1",
    dnsPort: options.dnsPort || 53,
    execPort: options.execPort || 8080,
    mss: options.mss || 1460,
    forceHttps: options.forceHttps !== false, // 默认把客户机的 http 请求升级为 https 去 fetch
    corsProxy: options.corsProxy !== undefined ? options.corsProxy : "https://cors-anywhere.mayx.eu.org/?",
    fetch: options.fetch || fetch,
    connections: new Map(),
  };
  const log = options.debug
    ? (...a) => console.log("[fetch-gw]", ...a)
    : () => { };

  const port = network.addPort((frame) => {
    if (frame.byteLength < 14) return;
    const dstMac = frame.subarray(0, 6);
    const srcMac = frame.subarray(6, 12);
    const ethertype = (frame[12] << 8) | frame[13];
    // 只处理发给本网关的，或广播(ARP)
    const isBroadcast = dstMac.every((b) => b === 0xff);
    if (!isBroadcast && !macEquals(dstMac, gw.gatewayMac)) return;

    if (ethertype === ETHERTYPE_ARP) {
      handleArp(gw, frame);
    } else if (ethertype === ETHERTYPE_IPV4) {
      const ip = frame.subarray(14);
      if (ip.byteLength < 20) return;
      const ihl = (ip[0] & 0x0f) * 4;
      if (ip.byteLength < ihl) return;
      const proto = ip[9];
      const srcIp = bytesToIp(ip.subarray(12, 16));
      if (proto === IPPROTO_TCP) {
        log("tcp", srcIp, "->", bytesToIp(ip.subarray(16, 20)));
        handleTcp(gw, ip, srcMac, srcIp);
      } else if (proto === IPPROTO_UDP) {
        handleUdp(gw, ip, srcMac, srcIp);
      } else if (proto === IPPROTO_ICMP) {
        handleIcmp(gw, ip, srcMac);
      }
    }
  });
  gw.port = port;

  return {
    close() {
      port.close();
      for (const c of gw.connections.values()) {
        if (c.rexmitTimer) clearTimeout(c.rexmitTimer);
      }
      gw.connections.clear();
    },
  };
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

// 仅供测试：暴露内部处理函数，便于单元测试验证
export { handleDns, evalJS, fetchWithFallback, TcpConnection };
