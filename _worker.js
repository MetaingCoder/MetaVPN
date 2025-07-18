import { connect } from 'cloudflare:sockets';


let userID = '36756fee-e048-45ae-a86a-1cd141b0273a';

let proxyIP = '';// 小白勿动，该地址并不影响你的网速，这是给CF代理使用的。'cdn.xn--b6gac.eu.org', 'cdn-all.xn--b6gac.eu.org', 'edgetunnel.anycast.eu.org'

//let sub = '';// 留空则显示原版内容
let sub = 'vless-4ca.pages.dev';// 内置优选订阅生成器，可自行搭建 https://github.com/cmliu/WorkerVless2sub
let subconverter = 'api.v1.mk';// clash订阅转换后端，目前使用肥羊的订阅转换功能。自带虚假uuid和host订阅。
let subconfig = "https://raw.githubusercontent.com/cmliu/ACL4SSR/main/Clash/config/ACL4SSR_Online_Full_MultiMode.ini"; //订阅配置文件
// The user name and password do not contain special characters
// Setting the address will ignore proxyIP
// Example:  user:pass@host:port  or  host:port
let socks5Address = '';
let RproxyIP = 'false';
if (!isValidUUID(userID)) {
    throw new Error('uuid is not valid');
}

let parsedSocks5Address = {};
let enableSocks = false;

// 虚假uuid和hostname，用于发送给配置生成服务
let fakeUserID = generateUUID();
let fakeHostName = generateRandomString();
let tls = true;
export default {
    async fetch(request, env, ctx) {
        try {
            const userAgent = request.headers.get('User-Agent').toLowerCase();
            userID = (env.UUID || userID).toLowerCase();
            proxyIP = env.PROXYIP || proxyIP;
            socks5Address = env.SOCKS5 || socks5Address;
            sub = env.SUB || sub;
            subconverter = env.SUBAPI || subconverter;
            subconfig = env.SUBCONFIG || subconfig;
            if (socks5Address) {
                RproxyIP = env.RPROXYIP || 'false';
                try {
                    parsedSocks5Address = socks5AddressParser(socks5Address);
                    enableSocks = true;
                } catch (err) {
                    let e = err;
                    console.log(e.toString());
                    enableSocks = false;
                }
            } else {
                RproxyIP = env.RPROXYIP || !proxyIP ? 'true' : 'false';
            }
            const upgradeHeader = request.headers.get('Upgrade');
            const url = new URL(request.url);
            if (url.searchParams.has('notls')) tls = false;
            if (!upgradeHeader || upgradeHeader !== 'websocket') {
                // const url = new URL(request.url);
                switch (url.pathname.toLowerCase()) {
                    case '/':
                        return new Response(JSON.stringify(request.cf), { status: 200 });
                    case `/${userID}`: {
                        const vlessConfig = await getVLESSConfig(userID, request.headers.get('Host'), sub, userAgent, RproxyIP);
                        const now = Date.now();
                        const timestamp = Math.floor(now / 1000);
                        const expire = 32503651200;//2099-12-31
                        const today = new Date(now);
                        today.setHours(0, 0, 0, 0);
                        const UD = Math.floor(((now - today.getTime())/86400000) * 24 * 1099511627776 / 2);
                        if (userAgent && userAgent.includes('mozilla')){
                            return new Response(`${vlessConfig}`, {
                                status: 200,
                                headers: {
                                    "Content-Type": "text/plain;charset=utf-8",
                                }
                            });
                        } else {
                            return new Response(`${vlessConfig}`, {
                                status: 200,
                                headers: {
                                    "Content-Disposition": "attachment; filename=edgetunnel; filename*=utf-8''edgetunnel",
                                    "Content-Type": "text/plain;charset=utf-8",
                                    "Profile-Update-Interval": "6",
                                    "Subscription-Userinfo": `upload=${UD}; download=${UD}; total=${24 * 1099511627776}; expire=${expire}`,
                                }
                            });
                        }
                    }
                    default:
                        return new Response('Not found', { status: 404 });
                }
            } else {
                if (new RegExp('/proxyip=', 'i').test(url.pathname)) proxyIP = url.pathname.split("=")[1];
                else if (new RegExp('/proxyip.', 'i').test(url.pathname)) proxyIP = url.pathname.split("/proxyip.")[1];
                else if (!proxyIP || proxyIP == '') proxyIP = 'proxyip.fxxk.dedyn.io';
                return await vlessOverWSHandler(request);
            }
        } catch (err) {
             let e = err;
            return new Response(e.toString());
        }
    },
};
async function vlessOverWSHandler(request) {

        // @ts-ignore
    const webSocketPair = new WebSocketPair();
    const [client, webSocket] = Object.values(webSocketPair);

    webSocket.accept();

    let address = '';
    let portWithRandomLog = '';
    const log = ( info,  event) => {
        console.log(`[${address}:${portWithRandomLog}] ${info}`, event || '');
    };
    const earlyDataHeader = request.headers.get('sec-websocket-protocol') || '';

    const readableWebSocketStream = makeReadableWebSocketStream(webSocket, earlyDataHeader, log);

    let remoteSocketWapper = {
        value: null,
    };
    let isDns = false;

    // ws --> remote
    readableWebSocketStream.pipeTo(new WritableStream({
        async write(chunk, controller) {
            if (isDns) {
                return await handleDNSQuery(chunk, webSocket, null, log);
            }
            if (remoteSocketWapper.value) {
                const writer = remoteSocketWapper.value.writable.getWriter()
                await writer.write(chunk);
                writer.releaseLock();
                return;
            }

            const {
                hasError,
                message,
                addressType,
                portRemote = 443,
                addressRemote = '',
                rawDataIndex,
                vlessVersion = new Uint8Array([0, 0]),
                isUDP,
            } = processVlessHeader(chunk, userID);
            address = addressRemote;
            portWithRandomLog = `${portRemote}--${Math.random()} ${isUDP ? 'udp ' : 'tcp '
            } `;
            if (hasError) {
                // controller.error(message);
                throw new Error(message); // cf seems has bug, controller.error will not end stream
                // webSocket.close(1000, message);
                return;
            }
            // if UDP but port not DNS port, close it
            if (isUDP) {
                if (portRemote === 53) {
                    isDns = true;
                } else {
                    // controller.error('UDP proxy only enable for DNS which is port 53');
                    throw new Error('UDP proxy only enable for DNS which is port 53'); // cf seems has bug, controller.error will not end stream
         
