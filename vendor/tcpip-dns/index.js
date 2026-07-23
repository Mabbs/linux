// node_modules/@tcpip/transport/dist/index.js
function c(e, r) {
  let a = e.getReader();
  return m(a, r);
}
async function* m(e, r) {
  try {
    for (; ; ) {
      let { done: a, value: n } = await e.read();
      if (a) return n;
      yield n;
    }
  } finally {
    r?.preventCancel || await e.cancel(), e.releaseLock();
  }
}

// node_modules/@tcpip/wire/dist/index.js
function k(e) {
  if (e.length === 0) throw new Error("empty string");
  let t = 0;
  for (let r = 0; r < e.length; r++) {
    let n = e.charCodeAt(r);
    if (n < 48 || n > 57) throw new Error("invalid character");
    t = t * 10 + (n - 48);
  }
  return t;
}
function M(e) {
  let t = 0;
  for (let r = 0; r < e.length; r++) {
    let n = e.charCodeAt(r), o;
    if (n >= 48 && n <= 57) o = n - 48;
    else if (n >= 97 && n <= 102) o = n - 87;
    else if (n >= 65 && n <= 70) o = n - 55;
    else throw new Error("invalid hex character");
    t = t << 4 | o;
  }
  return t;
}
function P(e) {
  if (e.length !== 4) throw new Error("invalid ipv4 address");
  return e.join(".");
}
function u(e) {
  let t = e.split("."), r = new Uint8Array(4);
  if (t.length !== 4) throw new Error("invalid ipv4 address");
  for (let n = 0; n < 4; n++) {
    let o = t[n];
    if (o.length === 0) throw new Error(`invalid ipv4 address: empty octet at position ${n}`);
    if (o.length > 3) throw new Error(`invalid ipv4 address: octet too long at position ${n}`);
    let s = k(o);
    if (s > 255) throw new Error(`invalid ipv4 address: octet too large at position ${n}`);
    r[n] = s;
  }
  return r;
}
function Me(e) {
  if (e.length !== 16) throw new Error("invalid ipv6 address");
  return e.reduce((t, r) => t + r.toString(16).padStart(2, "0"), "").match(/.{1,4}/g).join(":");
}
function ze(e) {
  let r = te(e).split(":"), n = new Uint8Array(16);
  if (r.length !== 8) throw new Error("invalid ipv6 address");
  for (let o = 0; o < 8; o++) {
    let s = r[o];
    if (s.length === 0) throw new Error(`invalid ipv6 address: empty group at position ${o}`);
    if (s.length > 4) throw new Error(`invalid ipv6 address: group too long at position ${o}`);
    let i = M(s);
    if (i > 65535) throw new Error(`invalid ipv6 address: group value too large at position ${o}`);
    n[o * 2] = i >> 8, n[o * 2 + 1] = i & 255;
  }
  return n;
}
function De(e) {
  let r = e.toLowerCase().split(":").map((a) => a.replace(/^0+(?=\w)/, "")), n = -1, o = 0, s = -1, i = 0;
  for (let a = 0; a < r.length; a++) r[a] === "0" || r[a] === "" ? (s === -1 && (s = a), i++, i > o && (n = s, o = i)) : (s = -1, i = 0);
  return o >= 2 && (r.splice(n, o), n === 0 ? r.unshift("", "") : n === r.length ? r.push("", "") : r.splice(n, 0, "")), r.join(":");
}
function te(e) {
  if (!e) throw new Error(`invalid IPv6 address: ${e}`);
  let t = e.split("::").map((a) => a.split(":"));
  if (t.length > 2) throw new Error(`invalid IPv6 address: ${e}`);
  let [r, n] = t;
  if (!r) throw new Error(`invalid IPv6 address: ${e}`);
  if (!n) return r.map((a) => a.padStart(4, "0")).join(":");
  let s = 8 - (r.length + n.length), i = Array(s).fill("0000");
  return [...r, ...i, ...n].map((a) => a.padStart(4, "0")).join(":");
}

// node_modules/@tcpip/dns/dist/index.js
function R(e) {
  let t = e.split(".");
  if (t.length === 4) return `${t.reverse().join(".")}.in-addr.arpa`;
  let n = te(e), s = ze(n);
  return `${Array.from(s).flatMap((o) => [o >> 4, o & 15].map((i) => i.toString(16))).reverse().join(".")}.ip6.arpa`;
}
function q(e) {
  let [t, n, ...s] = e.split(".").reverse().filter((r) => !!r);
  if (t !== "arpa") throw new Error(`invalid PTR name: ${e}`);
  switch (n) {
    case "in-addr":
      return { type: "ipv4", ip: s.join(".") };
    case "ip6":
      return { type: "ipv6", ip: De(s.join("").replace(/(.{4})/g, "$1:").replace(/:$/, "")) };
    default:
      throw new Error(`invalid PTR name: ${e}`);
  }
}
var l = { A: 1, NS: 2, CNAME: 5, SOA: 6, PTR: 12, MX: 15, TXT: 16, AAAA: 28, SRV: 33, ANY: 255 };
var d = { IN: 1 };
var w = { QUERY: 0, IQUERY: 1, STATUS: 2, NOTIFY: 4, UPDATE: 5 };
var h = { NOERROR: 0, FORMERR: 1, SERVFAIL: 2, NXDOMAIN: 3, NOTIMP: 4, REFUSED: 5 };
function v(e, t) {
  let n = [], s = t;
  for (; ; ) {
    let r = e[s];
    if (r === void 0 || r === 0) break;
    s++;
    let o = new TextDecoder().decode(e.slice(s, s + r));
    n.push(o), s += r;
  }
  return [n.join("."), s + 1];
}
function C(e) {
  let t = e.split("."), n = new Uint8Array(e.length + 2), s = 0;
  if (e !== "") for (let r of t) {
    n[s] = r.length, s++;
    for (let o = 0; o < r.length; o++) n[s + o] = r.charCodeAt(o);
    s += r.length;
  }
  return n[s] = 0, n.slice(0, s + 1);
}
function T(e) {
  let [t] = Object.entries(l).find(([, n]) => n === e) ?? [];
  if (!t) throw new Error(`unknown dns type: ${e}`);
  return t;
}
function O(e) {
  if (!(e in l)) throw new Error(`unknown dns type: ${e}`);
  return l[e];
}
function E(e) {
  let [t] = Object.entries(d).find(([, n]) => n === e) ?? [];
  if (!t) throw new Error(`unknown dns class: ${e}`);
  return t;
}
function b(e) {
  if (!(e in d)) throw new Error(`unknown dns class: ${e}`);
  return d[e];
}
function H(e) {
  let [t] = Object.entries(w).find(([, n]) => n === e) ?? [];
  if (!t) throw new Error(`unknown dns opcode: ${e}`);
  return t;
}
function V(e) {
  if (!(e in w)) throw new Error(`unknown dns opcode: ${e}`);
  return w[e];
}
function Q(e) {
  let [t] = Object.entries(h).find(([, n]) => n === e) ?? [];
  if (!t) throw new Error(`unknown dns rcode: ${e}`);
  return t;
}
function B(e) {
  if (!(e in h)) throw new Error(`unknown dns rcode: ${e}`);
  return h[e];
}
function F(e, t) {
  let [n, s] = v(e, t), r = new DataView(e.buffer), o = T(r.getUint16(s)), i = E(r.getUint16(s + 2));
  return [{ name: n, type: o, class: i }, s + 4];
}
function L(e) {
  let t = C(e.name), n = new Uint8Array(t.length + 4), s = new DataView(n.buffer), r = 0;
  return n.set(t, r), r += t.length, s.setUint16(r, O(e.type)), s.setUint16(r + 2, b(e.class)), n;
}
function X(e, t, n) {
  let s = [], r = t, o = t + n;
  for (; r < o; ) {
    let i = e[r];
    if (i === void 0) break;
    r++;
    let p = new TextDecoder().decode(e.slice(r, r + i));
    s.push(p), r += i;
  }
  return [s.join(""), r];
}
function Y(e) {
  if (e.length === 0) return new Uint8Array([0]);
  let n = new TextEncoder().encode(e), s = [];
  for (let p = 0; p < n.length; p += 255) s.push(n.slice(p, Math.min(p + 255, n.length)));
  let r = s.reduce((p, c2) => p + 1 + c2.length, 0), o = new Uint8Array(r), i = 0;
  for (let p of s) o[i] = p.length, o.set(p, i + 1), i += 1 + p.length;
  return o;
}
function x(e, t) {
  let [n, s] = v(e, t), r = new DataView(e.buffer), o = T(r.getUint16(s)), i = E(r.getUint16(s + 2)), p = r.getUint32(s + 4), c2 = r.getUint16(s + 8), a = s + 10;
  switch (o) {
    case "A": {
      let u2 = P(e.slice(a, a + c2)), f = a + c2;
      return [{ name: n, class: i, ttl: p, type: o, ip: u2 }, f];
    }
    case "AAAA": {
      let u2 = Me(e.slice(a, a + c2)), f = De(u2), U = a + c2;
      return [{ name: n, class: i, ttl: p, type: o, ip: f }, U];
    }
    case "TXT": {
      let [u2, f] = X(e, a, c2);
      return [{ name: n, class: i, ttl: p, type: o, value: u2 }, f];
    }
    case "PTR": {
      let [u2, f] = v(e, a);
      return [{ name: n, class: i, ttl: p, type: o, ptr: u2 }, f];
    }
    default:
      throw new Error(`unsupported record type: ${o}`);
  }
}
function W(e) {
  switch (e.type) {
    case "A":
      return u(e.ip);
    case "AAAA":
      return ze(te(e.ip));
    case "TXT":
      return Y(e.value);
    case "PTR":
      return C(e.ptr);
    default:
      throw new Error("unsupported record type");
  }
}
function A(e) {
  let n = C(e.name), s = W(e), r = new Uint8Array(n.length + 10 + s.length), o = new DataView(r.buffer), i = 0;
  return r.set(n, i), i += n.length, o.setUint16(i, O(e.type)), o.setUint16(i + 2, b(e.class)), o.setUint32(i + 4, e.ttl), o.setUint16(i + 8, s.length), i += 10, r.set(s, i), r;
}
function G(e) {
  if (e.length < 12) throw new Error("DNS header is too short");
  let t = new DataView(e.buffer);
  return [{ id: t.getUint16(0), isResponse: !!(e[2] & 128), opcode: H(e[2] >> 3 & 15), isAuthoritativeAnswer: !!(e[2] & 4), isTruncated: !!(e[2] & 2), isRecursionDesired: !!(e[2] & 1), isRecursionAvailable: !!(e[3] & 128), rcode: Q(e[3] & 15), questionCount: t.getUint16(4), answerCount: t.getUint16(6), authorityCount: t.getUint16(8), additionalCount: t.getUint16(10) }, 12];
}
function _(e) {
  let t = new Uint8Array(12), n = new DataView(t.buffer);
  return n.setUint16(0, e.id), t[2] = (e.isResponse ? 128 : 0) | (V(e.opcode) & 15) << 3 | (e.isAuthoritativeAnswer ? 4 : 0) | (e.isTruncated ? 2 : 0) | (e.isRecursionDesired ? 1 : 0), t[3] = (e.isRecursionAvailable ? 128 : 0) | B(e.rcode) & 15, n.setUint16(4, e.questionCount), n.setUint16(6, e.answerCount), n.setUint16(8, e.authorityCount), n.setUint16(10, e.additionalCount), t;
}
function D(e) {
  if (e.length < 12) throw new Error("DNS message is too short");
  let t = 0, [n, s] = G(e);
  t = s;
  let r = [];
  for (let c2 = 0; c2 < n.questionCount; c2++) {
    let [a, u2] = F(e, t);
    r.push(a), t = u2;
  }
  let o = [];
  for (let c2 = 0; c2 < n.answerCount; c2++) {
    let [a, u2] = x(e, t);
    o.push(a), t = u2;
  }
  let i = [];
  for (let c2 = 0; c2 < n.authorityCount; c2++) {
    let [a, u2] = x(e, t);
    i.push(a), t = u2;
  }
  let p = [];
  for (let c2 = 0; c2 < n.additionalCount; c2++) {
    let [a, u2] = x(e, t);
    p.push(a), t = u2;
  }
  return { header: n, questions: r, answers: o, authorities: i, additionals: p };
}
function m2(e) {
  e.header.questionCount = e.questions.length, e.header.answerCount = e.answers?.length ?? 0, e.header.authorityCount = e.authorities?.length ?? 0, e.header.additionalCount = e.additionals?.length ?? 0;
  let t = _(e.header), n = e.questions.map(L), s = e.answers?.map(A) ?? [], r = e.authorities?.map(A) ?? [], o = e.additionals?.map(A) ?? [], i = t.length;
  for (let a of n) i += a.length;
  for (let a of s) i += a.length;
  for (let a of r) i += a.length;
  for (let a of o) i += a.length;
  let p = new Uint8Array(i), c2 = 0;
  p.set(t, c2), c2 += t.length;
  for (let a of n) p.set(a, c2), c2 += a.length;
  for (let a of s) p.set(a, c2), c2 += a.length;
  for (let a of r) p.set(a, c2), c2 += a.length;
  for (let a of o) p.set(a, c2), c2 += a.length;
  return p;
}
var g = class {
  #t;
  #e;
  #n = 0;
  constructor(t, n = {}) {
    this.#t = t, this.#e = n.nameServer ?? { ip: "127.0.0.1", port: 53 };
  }
  async #s(t) {
    let n = { header: { id: this.#r(), isResponse: false, opcode: "QUERY", isAuthoritativeAnswer: false, isTruncated: false, isRecursionDesired: true, isRecursionAvailable: false, rcode: "NOERROR", questionCount: 0, answerCount: 0, authorityCount: 0, additionalCount: 0 }, questions: [{ name: t.name, type: t.type, class: "IN" }] }, s = await this.#t.open(), r = m2(n);
    await s.writable.getWriter().write({ host: this.#e.ip, port: this.#e.port, data: r });
    for await (let i of c(s.readable)) {
      let p = D(i.data);
      if (p.header.id !== n.header.id) continue;
      if (p.header.rcode !== "NOERROR") throw new Error(`dns query failed with rcode: ${p.header.rcode}`);
      if (p.header.answerCount > 1) throw new Error("expected exactly one dns answer");
      let [c2] = p.answers ?? [];
      if (!c2) throw new Error("no dns answer found");
      return c2;
    }
    throw new Error("udp socket closed before receiving response");
  }
  async lookup(t) {
    let n = await this.#s({ name: t, type: "A" });
    if (!n || n.type !== "A") throw new Error(`no A record found for ${t}`);
    return n.ip;
  }
  async reverse(t) {
    let n = R(t), s = await this.#s({ name: n, type: "PTR" });
    if (!s || s.type !== "PTR") throw new Error(`No PTR record found for ${t}`);
    return s.ptr;
  }
  #r() {
    return this.#n = (this.#n + 1) % 65536, this.#n;
  }
};
var y = class {
  #t;
  #e;
  constructor(t, n) {
    this.#t = t, this.#e = n;
  }
  async listen() {
    let t = await this.#t.open({ host: this.#e.host, port: this.#e.port ?? 53 });
    this.#n(t);
  }
  async #n(t) {
    let n = t.writable.getWriter();
    for await (let s of c(t.readable)) this.#s(s, n);
  }
  async #s(t, n) {
    try {
      let { host: s, port: r } = t, o = D(t.data), i = await Z(o, this.#e.request), p = m2(i);
      await n.write({ host: s, port: r, data: p });
    } catch (s) {
      console.error("error handling dns query:", s);
    }
  }
};
async function Z(e, t) {
  if (e.questions.length > 1) throw new Error("only one dns question is supported");
  let [n] = e.questions;
  if (!n) throw new Error("no question found in dns message");
  if (n.class !== "IN") throw new Error("only IN class is supported");
  let s = await t({ name: n.name, type: n.type });
  return ee(e, s);
}
function ee(e, t) {
  if (!t) return { header: { ...e.header, isResponse: true, isRecursionAvailable: false, rcode: "NXDOMAIN" }, questions: e.questions, answers: [], authorities: [], additionals: [] };
  let n = e.questions[0];
  if (!n) throw new Error("no question found in dns message");
  if (n.class !== "IN") throw new Error("only IN class is supported");
  let r = (Array.isArray(t) ? t : [t]).map((o) => ({ name: n.name, class: "IN", ...o }));
  return { header: { ...e.header, isResponse: true, isRecursionAvailable: false, rcode: "NOERROR" }, questions: e.questions, answers: r, authorities: [], additionals: [] };
}
async function De2(e, t = {}) {
  let n = new g(e, t.client);
  return { serve: async (s) => {
    let r = new y(e, s);
    return await r.listen(), r;
  }, lookup: async (s) => n.lookup(s), reverse: async (s) => n.reverse(s) };
}
export {
  g as DnsClient,
  y as DnsServer,
  De2 as createDns,
  R as ipToPtrName,
  q as ptrNameToIP
};
