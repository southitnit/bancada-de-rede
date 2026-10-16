
/* ---------- sistemas operacionais dos hosts (registro) ---------- */
const OSES={
  'ubuntu-24.04':{name:'Ubuntu 24.04.1 LTS',fam:'deb',ver:'24.04',code:'noble',kernel:'6.8.0-45-generic',pm:'apt',fw:'ufw',img:'ubuntu:24.04',ssh:'ssh'},
  'ubuntu-22.04':{name:'Ubuntu 22.04.5 LTS',fam:'deb',ver:'22.04',code:'jammy',kernel:'5.15.0-122-generic',pm:'apt',fw:'ufw',img:'ubuntu:22.04',ssh:'ssh'},
  'debian-12':{name:'Debian GNU/Linux 12 (bookworm)',fam:'deb',ver:'12',code:'bookworm',kernel:'6.1.0-25-amd64',pm:'apt',fw:'none',img:'debian:12',ssh:'ssh'},
  'fedora-40':{name:'Fedora Linux 40 (Server Edition)',fam:'rpm',ver:'40',kernel:'6.10.6-200.fc40.x86_64',pm:'dnf',fw:'firewalld',img:'fedora:40',ssh:'sshd'},
  'rocky-9':{name:'Rocky Linux 9.4 (Blue Onyx)',fam:'rpm',ver:'9.4',kernel:'5.14.0-427.13.1.el9_4.x86_64',pm:'dnf',fw:'firewalld',img:'rockylinux:9',ssh:'sshd'},
  'rhel-9':{name:'Red Hat Enterprise Linux 9.4 (Plow)',fam:'rpm',ver:'9.4',kernel:'5.14.0-427.13.1.el9_4.x86_64',pm:'dnf',fw:'firewalld',img:'redhat/ubi9',ssh:'sshd'},
  'alpine-3.20':{name:'Alpine Linux v3.20',fam:'apk',ver:'3.20.3',kernel:'6.6.49-0-lts',pm:'apk',fw:'none',img:'alpine:3.20',ssh:'sshd'},
  'rhcos-4.16':{name:'Red Hat Enterprise Linux CoreOS 416.94',fam:'rpm',ver:'4.16',kernel:'5.14.0-427.33.1.el9_4.x86_64',pm:'rpm-ostree',fw:'none',img:'',ssh:'sshd'},
  'windows-11':{name:'Windows 11 Pro 23H2',fam:'win',ver:'10.0.22631',kernel:'',pm:'winget',fw:'windows',img:''},
  'windows-server-2022':{name:'Windows Server 2022 Standard',fam:'win',ver:'10.0.20348',kernel:'',pm:'feature',fw:'windows',img:''}
};
const OS_LIST=Object.entries(OSES).filter(([k])=>k!=='rhcos-4.16').map(([k,v])=>[k,v.name]);
const osInfo=d=>d&&d.os?OSES[d.os]||null:null;
const isWin=d=>{const o=osInfo(d);return!!o&&o.fam==='win'};
/* serviços: portas que abrem quando ativos */
const SVCDEF={ssh:{ports:[['tcp',22]],desc:'OpenBSD Secure Shell server'},sshd:{ports:[['tcp',22]],desc:'OpenSSH server daemon'},
  nginx:{ports:[['tcp',80]],web:'nginx',desc:'A high performance web server'},apache2:{ports:[['tcp',80]],web:'apache',desc:'The Apache HTTP Server'},httpd:{ports:[['tcp',80]],web:'apache',desc:'The Apache HTTP Server'},
  named:{ports:[['udp',53],['tcp',53]],dns:true,desc:'BIND Domain Name Server'},'mariadb':{ports:[['tcp',3306]],desc:'MariaDB database server'},mysql:{ports:[['tcp',3306]],desc:'MySQL Community Server'},
  postgresql:{ports:[['tcp',5432]],desc:'PostgreSQL RDBMS'},'redis-server':{ports:[['tcp',6379]],desc:'Advanced key-value store'},redis:{ports:[['tcp',6379]],desc:'Redis persistent key-value database'},
  haproxy:{ports:[['tcp',80]],web:'haproxy',desc:'HAProxy Load Balancer'},squid:{ports:[['tcp',3128]],desc:'Squid Web Proxy Server'},vsftpd:{ports:[['tcp',21]],desc:'vsftpd FTP server'},
  smbd:{ports:[['tcp',445],['tcp',139]],desc:'Samba SMB Daemon'},smb:{ports:[['tcp',445],['tcp',139]],desc:'Samba SMB Daemon'},'nfs-server':{ports:[['tcp',2049]],desc:'NFS server and services'},
  'strongswan':{ports:[['udp',500],['udp',4500]],desc:'strongSwan IPsec IKEv1/IKEv2 daemon using swanctl'},'strongswan-starter':{ports:[['udp',500],['udp',4500]],desc:'strongSwan IPsec IKEv1/IKEv2 daemon using ipsec.conf'},
  docker:{ports:[],desc:'Docker Application Container Engine'},frr:{ports:[['tcp',179]],desc:'FRRouting'},'isc-dhcp-server':{ports:[['udp',67]],desc:'ISC DHCP IPv4 server'},dhcpd:{ports:[['udp',67]],desc:'DHCPv4 Server Daemon'},
  chrony:{ports:[['udp',123]],desc:'chrony, an NTP client/server'},chronyd:{ports:[['udp',123]],desc:'NTP client/server'},prometheus:{ports:[['tcp',9090]],web:'prometheus',desc:'Monitoring system and time series database'},
  'grafana-server':{ports:[['tcp',3000]],web:'grafana',desc:'Grafana instance'},'prometheus-node-exporter':{ports:[['tcp',9100]],web:'metrics',desc:'Prometheus exporter for machine metrics'},node_exporter:{ports:[['tcp',9100]],web:'metrics',desc:'Prometheus node exporter'},
  cockpit:{ports:[['tcp',9090]],web:'cockpit',desc:'Cockpit Web Service'},'wg-quick@wg0':{ports:[['udp',51820]],desc:'WireGuard via wg-quick(8) for wg0'},kubelet:{ports:[['tcp',10250]],desc:'kubelet: The Kubernetes Node Agent'},
  crio:{ports:[],desc:'Container Runtime Interface for OCI (CRI-O)'},containerd:{ports:[],desc:'containerd container runtime'},
  W3SVC:{ports:[['tcp',80]],web:'iis',desc:'World Wide Web Publishing Service'},WinRM:{ports:[['tcp',5985]],desc:'Windows Remote Management (WS-Management)'},TermService:{ports:[['tcp',3389]],desc:'Remote Desktop Services'},
  LanmanServer:{ports:[['tcp',445]],desc:'Server'},DNS:{ports:[['udp',53],['tcp',53]],dns:true,desc:'DNS Server'},DHCPServer:{ports:[['udp',67]],desc:'DHCP Server'},sshd_win:{ports:[['tcp',22]],desc:'OpenSSH SSH Server'}};
function osDefaults(osId,type){const o=OSES[osId];if(!o)return{pkgs:[],svcs:{},hfw:{on:false,allow:[],icmp:true}};const srv=type!=='pc';
  if(o.fam==='win'){const svcs={LanmanServer:{active:true,enabled:true}};if(osId==='windows-server-2022')svcs.WinRM={active:true,enabled:true};
    return{pkgs:[],svcs,hfw:{on:true,allow:osId==='windows-server-2022'?[['tcp',5985]]:[],icmp:false}}}
  const base={deb:['bash','coreutils','iproute2','iputils-ping','curl','ca-certificates','systemd','vim-tiny','netplan.io','ufw'],rpm:['bash','coreutils','iproute','iputils','curl','systemd','vim-minimal','NetworkManager','firewalld','dnf'],apk:['busybox','alpine-baselayout','apk-tools','musl']}[o.fam]||[];
  const pkgs=[...base];const svcs={};
  if(srv&&o.fam!=='apk'){pkgs.push(o.fam==='deb'?'openssh-server':'openssh-server');svcs[o.ssh]={active:true,enabled:true}}
  if(osId==='rocky-9'||osId==='rhel-9'){pkgs.push('cockpit');svcs.cockpit={active:true,enabled:true}}
  if(o.fw==='firewalld')svcs.firewalld={active:true,enabled:true};if(o.fam==='deb')pkgs.push('openssh-client','iputils-ping','iproute2','netcat-openbsd','nano');if(o.fam==='rpm')pkgs.push('openssh-clients');if(o.fam==='apk')pkgs.push('openssh-client');
  if(osId==='rhcos-4.16'){pkgs.push('cri-o','kubelet');svcs.crio={active:true,enabled:true};svcs.kubelet={active:true,enabled:true}}
  const hfw=o.fw==='firewalld'?{on:true,allow:[['tcp',22],...(svcs.cockpit?[['tcp',9090]]:[])],icmp:true}:{on:false,allow:[],icmp:true};
  return{pkgs,svcs,hfw}}
function osSetup(d,osId){const def=osDefaults(osId,d.type);d.os=osId;d.pkgs=def.pkgs;d.svcs=def.svcs;d.hfw=def.hfw;d.fs={};d.listen=[];d.dockers=[];if(!d.dns&&isWin(d))d.dns='';return d}
const hostFw=d=>d.hfw||osDefaults(d.os,d.type).hfw;
function hostSvcPorts(d,dstIp){const o=[];const S2=d.svcs||{};Object.entries(S2).forEach(([n,s])=>{if(!s.active)return;const def=SVCDEF[n];if(def)def.ports.forEach(([pr,pt],i)=>o.push({proto:pr,port:i===0&&s.port?+s.port:pt,svc:n,web:def.web,dns:def.dns}))});
  (d.dockers||[]).forEach(c=>{if(c.state==='running')(c.ports||[]).forEach(([h,,pr])=>o.push({proto:pr||'tcp',port:+h,svc:'docker-proxy',web:c.image.split(':')[0],ct:c}))});
  (d.listen||[]).forEach(l=>o.push(l));o.push(...k8sPorts(d,dstIp));return o}
function hostAccept(d,proto,port,dstIp,srcIp){if(!d)return{ok:true};
  if(d.type==='cloud')return cloudAccept(d,proto,port,dstIp);
  if(!isHost(d.type))return{ok:true};
  {const k=d.ports.findIndex((p,j)=>isMgmt(d,j));const c=k>=0&&pc(d.ports[k].ip);if(c&&c.ip===dstIp){if(proto==='icmp')return{ok:true};if(proto==='tcp'&&[22,80,443,5900].includes(+port))return{ok:true,svc:{svc:'bmc',web:'bmc'}};if(proto==='udp'&&+port===623)return{ok:true,svc:{svc:'ipmi'}};return{ok:false,why:`${d.name} ${(modelOf(d)||{}).bmc||'BMC'}: nada escutando em ${proto}/${port} (o BMC atende 22, 80, 443, 5900 e IPMI 623/udp)`}}}
  if(d.ct&&d.ctOn&&Array.isArray(d.ctPorts)){if(proto==='icmp')return{ok:true};const hit=d.ctPorts.some(p=>p.proto===proto&&+p.port===+port);return hit?{ok:true,svc:{svc:'container',ct:true}}:{ok:false,why:`${d.name} (container): nada escutando em ${proto}/${port} — conexão recusada`}}
  if(!d.os)return{ok:true};const os=osInfo(d);const fw=hostFw(d);
  const L=hostSvcPorts(d,dstIp);const k8=L.find(x=>x.k8s&&x.proto===proto&&+x.port===+port);const hit0=L.find(x=>x.proto===proto&&+x.port===+port);
  if(fw.on&&!k8){const fwn=os.fw==='windows'?'Windows Defender Firewall':os.fw==='firewalld'?'firewalld':'ufw';
    if(proto==='icmp'){if(!fw.icmp)return{ok:false,why:`${d.name}: o ${fwn} descarta o ICMP de entrada (${os.fw==='windows'?'New-NetFirewallRule -Protocol ICMPv4 -IcmpType 8 -Action Allow':'libere o ICMP'})`}}
    else if(!(hit0&&hit0.ct&&os.fw==='ufw')&&!(fw.allow||[]).some(([p,n,src])=>(p===proto||p==='any')&&(n==='any'||+n===+port)&&(!src||(pc(src)&&inNet(srcIp,pc(src))))))return{ok:false,why:`${d.name}: o ${fwn} bloqueia ${proto}/${port} (${os.fw==='windows'?`New-NetFirewallRule -Direction Inbound -Protocol ${proto.toUpperCase()} -LocalPort ${port} -Action Allow`:os.fw==='firewalld'?`firewall-cmd --add-port=${port}/${proto} --permanent && firewall-cmd --reload`:`ufw allow ${port}/${proto}`})`}}
  if(proto==='icmp')return{ok:true};
  const hit=L.find(x=>x.proto===proto&&+x.port===+port);
  if(!hit){const hint=+port===80?(os.fam==='win'?'Install-WindowsFeature Web-Server':`${os.pm==='apt'?'apt install nginx':os.pm==='apk'?'apk add nginx && rc-service nginx start':'dnf install nginx && systemctl enable --now nginx'}`):+port===22?(os.fam==='win'?'Add-WindowsCapability -Online -Name OpenSSH.Server':`${os.pm} install openssh-server`):'';
    return{ok:false,why:`${d.name}: nada escutando em ${proto}/${port} — conexão recusada${hint?' (ex.: '+hint+')':''}`}}
  return{ok:true,svc:hit}}

/* ---------- nuvens: Internet real e Internet fake ---------- */
const PRIV=[['10.0.0.0',8],['172.16.0.0',12],['192.168.0.0',16],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['0.0.0.0',8],['224.0.0.0',3]].map(([a,l])=>pc(a+'/'+l));
const isPublic=ip=>ip!=null&&!PRIV.some(c=>inNet(ip,c));
const cloudKind=d=>d&&d.type==='cloud'?((d.cloud&&d.cloud.kind)||'fake'):null;
const labOwns=ip=>S.devices.some(x=>l3ifs(x).some(f=>!f.mgmt&&ownsIp(f,ip)&&!(x.type==='cloud'&&f.kind==='loop')));
const cloudHost=d=>cloudKind(d)==='real'&&d.cloud&&d.cloud.mode==='host'&&pc(d.cloud.lan||'');
/* na ponte para a rede do computador, várias portas da nuvem estão na mesma sub-rede: só vale a porta cujo vizinho tem o IP */
function cloudPortHas(d,f,dst){if(!cloudHost(d)||f.kind!=='port')return true;if(ownsIp(f,dst))return true;return l2Reach(d.id,f).eps.some(ep=>{if(ep.dev===d.id)return false;const g=getIf(dev(ep.dev),ep.key);return g&&ownsIp(g,dst)})}
function cloudExit(d,s,t,reply){if(cloudKind(d)!=='real'||reply)return null;if(labOwns(t))return null;
  const lan=cloudHost(d);
  if(!isPublic(t))return{err:lan&&inNet(t,lan)?`${d.name}: ${i2ip(t)} é um aparelho real da sua rede local — a simulação não chega até ele (só à Internet)`:`${d.name}: ${i2ip(t)} é um endereço privado — não existe na Internet`};
  if(s!=null&&!isPublic(s)){if(lan&&inNet(s,lan))return{line:`roteador da sua casa (${d.cloud.gw||''}) faz NAT ${i2ip(s)} → ${d.cloud.pub||'seu IP público'} e envia para a Internet real (${i2ip(t)})`};return{err:`${d.name}: origem ${i2ip(s)} é privada — a Internet descarta (falta NAT na borda)`}}
  return{line:`sai do lab para a Internet real (${i2ip(t)})`}}
function cloudAccept(d,proto,port,ip){if(cloudHost(d)&&ip===ip2i(d.cloud.gw||'')){if(proto==='icmp'||(proto==='udp'||proto==='tcp')&&+port===53)return{ok:true,svc:{svc:'dns',dns:true}};return{ok:false,why:`${d.name}: o roteador da sua casa (${d.cloud.gw}) só responde ping e DNS na simulação`}}const lo=(d.loops||[]).some(l=>pc(l.ip)&&pc(l.ip).ip===ip);if(proto==='icmp')return{ok:true};
  if(lo){if(+port===53)return{ok:true,svc:{svc:'dns',dns:true}};if(+port===80||+port===443)return{ok:true,svc:{svc:'web',web:'cloud'}};}
  return{ok:false,why:`${d.name}: nada escutando em ${proto}/${port} (${lo?'só DNS e HTTP neste endereço':'interface da nuvem'})`}}
function cloudLanNext(c){const lan=pc(c.cloud.lan);const used=new Set();S.devices.forEach(x=>l3ifs(x,true).forEach(f=>used.add(f.c.ip)));(c.cloud.reserved||[]).forEach(ip=>used.add(ip2i(ip)));const bc=(lan.net|(~lan.mask))>>>0;
  for(let n=lan.net+200;n<bc;n++)if(!used.has(n>>>0))return n>>>0;for(let n=lan.net+2;n<lan.net+200;n++)if(!used.has(n>>>0))return n>>>0;return null}
function cloudPoolNext(c){const pool=pc((c.cloud&&c.cloud.pool)||'200.10.0.0/16');if(!pool)return null;const used=new Set();
  S.devices.forEach(x=>l3ifs(x,true).forEach(f=>used.add((f.c.ip&0xfffffffc)>>>0)));
  for(let n=pool.net+4;n<pool.net+Math.pow(2,32-pool.len)-4;n+=4){if(!used.has(n>>>0))return n>>>0}return null}
function cloudAttach(l){const A=dev(l.a.dev),B=dev(l.b.dev);if(!A||!B)return null;let c,ce,o,oe;if(A.type==='cloud'){c=A;ce=l.a;o=B;oe=l.b}else if(B.type==='cloud'){c=B;ce=l.b;o=A;oe=l.a}else return null;
  if(o.type==='cloud')return null;const cp=c.ports[ce.k];if(pc(cp.ip))return null;
  if(cloudHost(c)){const lan=pc(c.cloud.lan);const gw=c.cloud.gw||i2ip(lan.net+1);const ip=cloudLanNext(c);if(ip===null)return null;cp.mode='routed';cp.ip=`${gw}/${lan.len}`;cp.desc=cp.desc||o.name;const op=o.ports[oe.k];let peer=null;
    if(!isMgmt(o,oe.k)&&!+op.lag&&o.type!=='sw2'&&!pc(op.ip)&&!(op.subs||[]).length&&(fwd(o.type)||isHost(o.type))){op.mode='routed';op.ip=`${i2ip(ip)}/${lan.len}`;op.desc=op.desc||c.name;peer=i2ip(ip);
      if(isHost(o.type)){if(!o.gw)o.gw=gw;if(!o.dns)o.dns=gw}else{if(!(o.routes||[]).some(r=>!r.vrf&&pc(r.dst)&&pc(r.dst).len===0))(o.routes=o.routes||[]).push({dst:'0.0.0.0/0',nh:gw});if(o.type==='fw'||o.type==='rtr')op.nat=true}}
    return{cloud:gw,peer,host:true}}
  const n=cloudPoolNext(c);if(n===null)return null;
  cp.mode='routed';cp.ip=`${i2ip(n+1)}/30`;cp.desc=cp.desc||o.name;const op=o.ports[oe.k];let peer=null;
  if(!isMgmt(o,oe.k)&&!+op.lag&&o.type!=='sw2'&&!pc(op.ip)&&!(op.subs||[]).length&&(fwd(o.type)||isHost(o.type))){if(o.type==='sw3')op.mode='routed';op.mode='routed';op.ip=`${i2ip(n+2)}/30`;op.desc=op.desc||c.name;peer=i2ip(n+2);
    if(isHost(o.type)){if(!o.gw)o.gw=i2ip(n+1)}else if(!(o.routes||[]).some(r=>!r.vrf&&pc(r.dst)&&pc(r.dst).len===0))(o.routes=o.routes||[]).push({dst:'0.0.0.0/0',nh:i2ip(n+1)})}
  return{cloud:i2ip(n+1),peer}}
function cloudSetHost(d,info){info=info||{};const lan=pc(info.lan||'')||pc('192.168.1.0/24');d.cloud=d.cloud||{kind:'real',dns:[]};Object.assign(d.cloud,{kind:'real',mode:'host',lan:netStr(lan),gw:info.gw&&ip2i(info.gw)!==null?info.gw:i2ip(lan.net+1),pub:info.pub||d.cloud.pub||'',hostIp:info.ip||'',reserved:info.ip?[info.ip]:[]});d.loops=[];return d}
function cloudNew(d,kind,info){if(kind==='real'){d.cloud={kind,pool:'177.10.0.0/16',dns:[]};return cloudSetHost(d,info)}d.cloud={kind,pool:kind==='real'?'177.10.0.0/16':'200.10.0.0/16',dns:[]};if(kind==='fake'){d.loops=[{id:0,ip:'8.8.8.8/32',vrf:'',desc:'DNS público (fake)'},{id:1,ip:'1.1.1.1/32',vrf:'',desc:'DNS público (fake)'},{id:2,ip:'93.184.216.34/32',vrf:'',desc:'www.exemplo.com (fake)'}];d.cloud.dns=[{name:'www.exemplo.com',ip:'93.184.216.34'},{name:'exemplo.com',ip:'93.184.216.34'},{name:'dns.google',ip:'8.8.8.8'},{name:'one.one.one.one',ip:'1.1.1.1'}];d.cloud.mirror=true;d.loops.push({id:3,ip:MIRROR_IP+'/32',vrf:'',desc:'espelho de pacotes / registry (fake)'})}return d}

/* ---------- resolução de nomes dentro do lab ---------- */
function labName(n){n=String(n||'').toLowerCase().replace(/\.$/,'');const base=n.replace(/\.(lab|internet|local)$/,'');
  for(const c of S.devices.filter(x=>x.type==='cloud'))for(const r of(c.cloud&&c.cloud.dns)||[])if(r.name.toLowerCase()===n)return ip2i(r.ip);
  if(MIRROR_NAMES.includes(n)&&S.devices.some(c=>c.type==='cloud'&&c.cloud&&c.cloud.mirror))return ip2i(MIRROR_IP);
  const k=k8sName(n);if(k!=null)return k;
  const d=S.devices.find(x=>x.name.toLowerCase()===base&&x.type!=='chassis');if(d){const f=l3ifs(d).find(f=>!f.mgmt&&f.kind!=='loop')||l3ifs(d).find(f=>!f.mgmt);return f?f.c.ip:null}return null}
function hostsFile(d){const t=(d.fs&&(isWin(d)?d.fs['C:/Windows/System32/drivers/etc/hosts']:d.fs['/etc/hosts']))||'';const m={};t.split('\n').forEach(l=>{const w=l.replace(/#.*/,'').trim().split(/\s+/);if(w.length>1&&ip2i(w[0])!==null)w.slice(1).forEach(n=>m[n.toLowerCase()]=ip2i(w[0]))});return m}
function nameserverOf(d){if(isWin(d))return d.dns||(S.devices.some(x=>x.type==='cloud')?'8.8.8.8':d.gw||'');const t=d.fs&&d.fs['/etc/resolv.conf'];if(t!=null){const m=t.match(/^\s*nameserver\s+(\S+)/m);return m?m[1]:''}return d.dns||(S.devices.some(x=>x.type==='cloud')?'8.8.8.8':d.gw||'')}
/* devolve {ip} | {err} | {ext:true} (precisa de DNS real) */
function resolveName(d,name){return dnsQuery(d,name)}

/* ---------- VPN: IPsec (IKEv1/IKEv2) e WireGuard ---------- */
let VPNS={};
const netsOf=s=>String(s||'').split(/[\s,]+/).map(x=>pc(x)).filter(Boolean).map(c=>({...c,ip:c.net}));
const netsKey=s=>netsOf(s).map(netStr).sort().join(' ');
const inNets=(ip,s)=>netsOf(s).some(c=>inNet(ip,c));
const vpnHolders=()=>S.devices.filter(d=>(d.vpns||[]).length&&(fwd(d.type)||isHost(d.type)));
function wgPub(priv){let h=hsh('wgpub|'+priv),s='';for(let i=0;i<32;i++){h=Math.imul(h^(i*2654435761),16777619)>>>0;s+=String.fromCharCode(h&255)}return(typeof btoa!=='undefined'?btoa(s):Buffer.from(s,'binary').toString('base64'))}
function vpnStates(){VPNS={};const hs=vpnHolders();if(!hs.length)return;
  hs.forEach(d=>{VPNS[d.id]=(d.vpns||[]).map(t=>{const st={t,state:'DOWN',why:''};const peerIp=ip2i(t.peer);st.peerIp=peerIp;
    if(t.shut){st.why='desativado';return st}if(peerIp===null){st.why='IP do peer inválido';return st}
    if(isHost(d.type)&&d.os&&!hostVpnReady(d,t)){st.why=t.kind==='wireguard'?'wireguard-tools não instalado ou interface wg não ativa (wg-quick up wg0)':'strongSwan não instalado ou parado (apt install strongswan && systemctl start strongswan-starter)';return st}
    if((t.kind!=='wireguard'&&!netsOf(t.lnets).length)||!netsOf(t.rnets).length){st.why='faltam as redes protegidas (local e remota)';return st}
    let P=null;S.devices.forEach(x=>{if(!P&&x.id!==d.id&&l3ifs(x).some(f=>!f.mgmt&&f.c.ip===peerIp))P=x});if(!P){st.why=`nenhum equipamento responde em ${t.peer}`;return st}
    const port=t.kind==='wireguard'?51820:500;const q=simulate(d.id,t.peer,'udp',port,{noVpn:true,noAccept:true});
    if(!q.ok){st.why=`${t.kind==='wireguard'?'handshake':'IKE'} sem resposta de ${t.peer}: ${q.why}`;return st}
    const seen=q.srcAtDst;const pt=(P.vpns||[]).find(x=>x.kind===t.kind&&!x.shut&&(ip2i(x.peer)===seen||l3ifs(d).some(f=>f.c.ip===ip2i(x.peer))));
    if(!pt){st.why=`${P.name} não tem túnel ${t.kind==='wireguard'?'WireGuard':'IPsec'} apontando para ${i2ip(seen)}`;st.pd=P;return st}
    st.pd=P;st.pt=pt;if(isHost(P.type)&&P.os&&!hostVpnReady(P,pt)){st.why=`${P.name}: ${t.kind==='wireguard'?'WireGuard':'strongSwan'} não está ativo do outro lado`;return st}
    if(t.kind==='wireguard'){if(wgPub(t.key||'')!==(pt.peerKey||'')||wgPub(pt.key||'')!==(t.peerKey||'')){st.why='handshake não completa: as chaves públicas não conferem (PublicKey do [Peer] deve ser a chave pública do outro lado)';return st}
      st.state='UP';return st}
    if((t.psk||'')!==(pt.psk||'')){st.why='AUTHENTICATION_FAILED — chave pré-compartilhada (PSK) diferente';return st}
    const prop=x=>[x.ike||'v2',x.enc||'aes256',x.hash||'sha256',x.dh||'14'];const a=prop(t),b=prop(pt);
    if(a[0]!==b[0]){st.why=`IKE ${a[0]} de um lado e ${b[0]} do outro — negociação falha`;return st}
    if(a.join()!==b.join()){st.why=`NO_PROPOSAL_CHOSEN — proposta diferente (${a.slice(1).join('/')} × ${b.slice(1).join('/')})`;return st}
    if(netsKey(t.lnets)!==netsKey(pt.rnets)||netsKey(t.rnets)!==netsKey(pt.lnets)){st.why=`TS_UNACCEPTABLE — redes protegidas não espelham (${netsKey(t.lnets)} ↔ ${netsKey(t.rnets)} × ${netsKey(pt.lnets)} ↔ ${netsKey(pt.rnets)})`;return st}
    st.state='UP';return st})})}
function hostVpnReady(d,t){const p=d.pkgs||[];if(t.kind==='wireguard')return p.includes('wireguard-tools')||p.includes('wireguard')||isWin(d);
  if(isWin(d))return true;return(p.includes('strongswan')||p.includes('libreswan'))&&Object.entries(d.svcs||{}).some(([n,s])=>/strongswan|ipsec/.test(n)&&s.active)}
function vpnMatch(d,s,t){const L=VPNS[d.id];if(!L)return null;for(const st of L){if(st.state!=='UP')continue;if(st.t.kind==='wireguard'){if(inNets(t,st.t.rnets))return{t:st.t,pd:st.pd,peerIp:st.peerIp};continue}
  if(s!=null&&inNets(s,st.t.lnets)&&inNets(t,st.t.rnets))return{t:st.t,pd:st.pd,peerIp:st.peerIp}}return null}
const vpnState=()=>VPNS;
