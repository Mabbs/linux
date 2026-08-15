// SPDX-License-Identifier: MIT
//
// webrtc-p2p.js
// ---------------------------------------------------------------------------
// 浏览器里跑 Linux 项目的「局域网 WebRTC 点对点直连」桥。
//
//   showLocalSdp()              —— 生成本机随机 IP + offer，打印单行 token
//   connectToPeer('<token>')    —— 作为对端连接，打印回传 token / 连接成功信息
//
// 原理：把 ethernetNetwork 交换机的某个端口与 WebRTC DataChannel 对插，
// 形成一条「二层以太网隧道(L2 over WebRTC)」。两台机器各自自动生成随机 IP，
// 经隧道互通；数据面纯局域网直连，无需 STUN/TURN，无服务器。
//
// 依赖（由 index.html 在初始化时挂到 window 上）：
//   window.__netdev     —— ethernetNetwork() 实例

(() => {
    const GATEWAY_IP = "10.0.2.2";

    let pc = null;        // RTCPeerConnection
    let dc = null;        // DataChannel
    let bridgePort = null; // network.addPort 返回值
    let myIp = null;      // 本机随机 IP
    let peerIp = null;    // 对端随机 IP
    let peerMac = null;   // 对端 guest 的 MAC（从对端真实帧学习）
    let state = "idle";

    // ---- 工具 ----
    const b64e = (s) => btoa(unescape(encodeURIComponent(s)));
    const b64d = (s) => decodeURIComponent(escape(atob(s.trim())));

    // 二进制安全的 base64（用于 gzip 后的字节）
    function bytesToB64(bytes) {
        let bin = "";
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        return btoa(bin);
    }
    function b64ToBytes(b64) {
        const bin = atob(b64.trim());
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
    }
    // 浏览器原生 gzip（CompressionStream）。SDP 文本重复度高，压缩后体积明显变小，
    // 再 base64 成可复制的单行 token，比「直接 base64(JSON)」短很多。
    async function gzipStr(str) {
        const cs = new CompressionStream("gzip");
        const writer = cs.writable.getWriter();
        writer.write(new TextEncoder().encode(str));
        writer.close();
        const buf = await new Response(cs.readable).arrayBuffer();
        return new Uint8Array(buf);
    }
    async function gunzipBytes(bytes) {
        const ds = new DecompressionStream("gzip");
        const writer = ds.writable.getWriter();
        writer.write(bytes);
        writer.close();
        const buf = await new Response(ds.readable).arrayBuffer();
        return new TextDecoder().decode(new Uint8Array(buf));
    }

    function randomGuestIp(avoidIp) {
        // 落在 10.0.2.0/24 内，避开 .0/.1/.2(网关)/.255 与对方 IP，保证默认网关 10.0.2.2 仍可达且与对端不冲突
        let avoid = null;
        if (avoidIp) {
            const p = avoidIp.split(".");
            if (p.length === 4) avoid = parseInt(p[3], 10); // 只比对末段
        }
        let x, tries = 0;
        do {
            x = 3 + Math.floor(Math.random() * 251); // 3..253
            tries++;
        } while ((x === 2 || x === avoid) && tries < 200);
        return "10.0.2." + x;
    }

    // 帧指纹 + 回声抑制：防止广播帧在「交换机<->DC<->交换机」之间无限回环
    const seen = new Map(); // sig -> 过期时间戳
    function frameSig(frame) {
        const n = Math.min(frame.length, 64);
        let h = 0;
        for (let i = 0; i < n; i++) h = (h * 31 + frame[i]) >>> 0;
        return h;
    }
    function noteFrame(frame) {
        const s = frameSig(frame);
        const exp = seen.get(s);
        if (exp && exp > Date.now()) return false; // 近期见过 → 丢弃（回声）
        seen.set(s, Date.now() + 1000);
        if (seen.size > 4000) {
            const now = Date.now();
            for (const [k, v] of seen) if (v < now) seen.delete(k);
        }
        return true;
    }

    function macEqual(a, b) {
        for (let i = 0; i < 6; i++) if (a[i] !== b[i]) return false;
        return true;
    }
    function isBroadcast(mac) {
        for (let i = 0; i < 6; i++) if (mac[i] !== 0xff) return false;
        return true;
    }

    // 是否为「针对网关 IP(10.0.2.2)的 ARP」：禁止跨隧道转发，避免对端网关劫持本机默认路由
    function isGatewayArp(frame) {
        if (frame.length < 42) return false;
        const ethertype = (frame[12] << 8) | frame[13];
        if (ethertype !== 0x0806) return false;       // 仅 ARP
        const op = (frame[20] << 8) | frame[21];       // 1=request
        const tpa = Array.from(frame.subarray(38, 42)).join("."); // 目标协议地址
        return op === 1 && tpa === GATEWAY_IP;
    }

    // ---- 桥接：交换机端口 <-> DataChannel ----
    function attachBridge() {
        const network = window.__netdev;
        if (!network) throw new Error("network 未就绪（页面尚未初始化完成）");

        bridgePort = network.addPort((frame) => {
            if (!frame || frame.byteLength < 14) return;
            const dst = frame.subarray(0, 6);
            const broadcast = isBroadcast(dst);
            if (isGatewayArp(frame)) return;                       // 网关 ARP 不外泄
            if (!broadcast && !(peerMac && macEqual(dst, peerMac))) return; // 仅转发广播或发给对端的单播
            if (!noteFrame(frame)) return;                         // 回声抑制
            if (dc && dc.readyState === "open") {
                try { dc.send(frame); } catch { }
            }
        });

        dc.binaryType = "arraybuffer";
        dc.onmessage = (e) => {
            const frame = new Uint8Array(e.data);
            if (frame.byteLength < 14) return;
            if (!noteFrame(frame)) return;                        // 回声丢弃，且不学习
            peerMac = Uint8Array.from(frame.subarray(6, 12));     // 仅从对端真实帧学习其 MAC
            if (bridgePort) { try { bridgePort.send(frame); } catch { } }
        };
    }

    // 注意：本机 eth0 的 IP 配置不再由 JS 注入，改由 guest 内的 shell 脚本（p2p.sh）
    // 通过 jsexec 拿到下方输出的 P2P_LOCAL_IP 后，自行执行 ip 命令完成。

    function waitIce(p, timeout = 4000) {
        return new Promise((resolve) => {
            if (p.iceGatheringState === "complete") return resolve();
            const t = setTimeout(resolve, timeout);
            p.addEventListener("icegatheringstatechange", () => {
                if (p.iceGatheringState === "complete") { clearTimeout(t); resolve(); }
            });
        });
    }
    function waitDcOpen(timeout = 5000) {
        return new Promise((resolve) => {
            if (dc && dc.readyState === "connected" || (dc && dc.readyState === "open")) return resolve(true);
            const iv = setInterval(() => {
                if (dc && (dc.readyState === "open" || dc.readyState === "connected")) { clearInterval(iv); resolve(true); }
            }, 100);
            setTimeout(() => { clearInterval(iv); resolve(false); }, timeout);
        });
    }

    // 把 {sdp, role, ip} 打包成「gzip + base64」单行 token：
    // 既避免污染 SDP 本身，又靠 gzip 把冗长的 SDP 压短，复制更轻松。
    async function makeToken(sdp, role, ip) {
        const gz = await gzipStr(JSON.stringify({ s: sdp, r: role, i: ip }));
        return bytesToB64(gz);
    }
    async function parseToken(token) {
        const json = await gunzipBytes(b64ToBytes(token));
        const o = JSON.parse(json);
        return { sdp: cleanSdp(o.s), role: o.r || null, ip: o.i || null };
    }
    // 防御性清洗：去掉跨浏览器版本可能不被识别的 SDP 属性（如 a=max-message-size）。
    // 这类属性只影响单条消息大小上限协商，我们的帧 < 1500 字节，去掉无影响。
    function cleanSdp(sdp) {
        return sdp.split("\r\n").filter((l) => !/^a=max-message-size:/i.test(l)).join("\r\n");
    }

    // 等待 DataChannel 真正打开后，格式化的连接成功信息
    function connectedInfo() {
        const local = "本机随机 IP: " + myIp;
        const peer = peerIp
            ? ("对端随机 IP: " + peerIp + "  ——  用  ping " + peerIp + "  或  curl http://" + peerIp + "  互访")
            : "对端 IP 未知（信令未携带）";
        // P2P_LOCAL_IP 供 guest 内 shell 脚本（p2p.sh）解析并配置本机 eth0
        return "=== 已连接 ===\n" + local + "\n" + peer + "\nP2P_LOCAL_IP=" + myIp;
    }

    // ---- 函数 1：显示本机 SDP（作为 offerer）----
    async function showLocalSdp() {
        if (state === "offering" || state === "connected") {
            return "当前已处于 " + state + " 状态；若要重建连接，请刷新页面。";
        }
        if (!window.__netdev) return "network 尚未就绪，请稍候重试。";

        myIp = randomGuestIp();
        pc = new RTCPeerConnection({ iceServers: [] }); // 纯局域网：不需要 STUN/TURN
        dc = pc.createDataChannel("p2p", { ordered: false, maxRetransmits: 0 }); // 类 UDP，更贴近以太网语义
        attachBridge();

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await waitIce(pc);

        const token = await makeToken(pc.localDescription.sdp, "offer", myIp);
        state = "offering";

        return (
            "=== 本机 OFFER token（复制后发给对端，让其执行 connectToPeer）===\n" +
            token + "\n" +
            "P2P_LOCAL_IP=" + myIp + "\n" +
            "（复制上面的 token 发给对端；对端连通后可用 ping " + myIp + " 互访）"
        );
    }

    // ---- 函数 2：连接对端的 SDP ----
    async function connectToPeer(token) {
        if (!token || typeof token !== "string") {
            return "用法：connectToPeer('<对端粘来的 token>')";
        }
        let meta;
        try { meta = await parseToken(token); } catch (e) { return "token 解析失败，请确认完整复制了单行 token（且浏览器需支持 CompressionStream/gzip）。"; }

        const remoteSdp = meta.sdp;
        if (!meta.role) return "token 不含角色信息，无法判断是 offer 还是 answer。";

        if (meta.ip) peerIp = meta.ip; // 无论 offer/answer 都带对端 guest IP

        if (meta.role === "offer") {
            // —— 本端作为 answerer ——
            // peerIp 已从 offer 拿到，生成本机 IP 时避开对端 IP，杜绝冲突
            if (!myIp) myIp = randomGuestIp(peerIp);
            pc = new RTCPeerConnection({ iceServers: [] });
            pc.ondatachannel = (ev) => { dc = ev.channel; attachBridge(); };
            await pc.setRemoteDescription({ type: "offer", sdp: remoteSdp });
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            await waitIce(pc);

            const out = await makeToken(pc.localDescription.sdp, "answer", myIp);
            state = "answering";

            const ok = await waitDcOpen();
            const tail = ok ? ("\n" + connectedInfo()) : "\n（answer 已生成，但对端尚未回连；待对端执行 connectToPeer 后本端会自动连通）";
            // 本机 IP 在生成 answer 时即已确定，无论 DC 是否已开都先输出，确保 shell 能立即配置
            return (
                "=== 本机 ANSWER token（复制后回传给对端，让其再执行一次 connectToPeer）===\n" +
                out + "\n" +
                "P2P_LOCAL_IP=" + myIp + "\n" +
                tail
            );
        }

        // —— 本端作为 offerer，收到 answer：补全连接 ——
        if (!pc) return "未找到本机 offer，请先执行 showLocalSdp()。";
        // showLocalSdp 时还不知道对端 IP，若与对方撞了则重生成（IP 由 shell 重新配置）
        if (peerIp && myIp && myIp === peerIp) {
            myIp = randomGuestIp(peerIp);
        }
        await pc.setRemoteDescription({ type: "answer", sdp: remoteSdp });
        state = "connected";
        const ok = await waitDcOpen();
        if (!ok) return "已设置 answer，但 DataChannel 未在规定时间内打开，请检查两台机器是否在同一局域网。";
        return connectedInfo();
    }

    window.showLocalSdp = showLocalSdp;
    window.connectToPeer = connectToPeer;
})();
