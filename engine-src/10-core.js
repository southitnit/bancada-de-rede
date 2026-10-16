/* Bancada de Rede — motor de rede (modelo, simulação, exportadores, importadores e CLI).
   Gerado a partir de engine-src/ por tools/bundle-engine.sh. Usado pelo navegador (window.Engine) e pelo Node (require). */
(function (root) {
'use strict';
const CAT = (typeof module !== 'undefined' && module.exports) ? require('./catalog.js') : root.BancadaCatalog;

const TYPES = {
  sw2: { label: 'Switch L2', ports: 24, pre: 'SW' },
  sw3: { label: 'Switch L3', ports: 24, pre: 'SW-L3' },
  rtr: { label: 'Roteador', ports: 4, pre: 'R' },
  fw:  { label: 'Firewall', ports: 8, pre: 'FW' },
  pc:  { label: 'PC', ports: 1, pre: 'PC' },
  srv: { label: 'Servidor', ports: 1, pre: 'SRV' },
  chassis: { label: 'Chassis blade', ports: 0, pre: 'CH' },
  cloud: { label: 'Nuvem (Internet)', ports: 24, pre: 'NUVEM' }
};
const VENDORS = [['auto', 'Automático (SO de cada modelo)'], ['cisco', 'Cisco IOS / IOS-XE'], ['nxos', 'Cisco NX-OS'], ['junos', 'Juniper Junos'], ['eos', 'Arista EOS'],
  ['aoscx', 'HPE Aruba AOS-CX'], ['os10', 'Dell OS10'], ['huawei', 'Huawei VRP'], ['routeros', 'MikroTik RouterOS 7'], ['fortios', 'Fortinet FortiOS'], ['vyos', 'VyOS 1.4']];
const VN = Object.fromEntries(VENDORS); VN.linux = 'Linux'; VN.generic = 'genérico';
const isSw = t => t === 'sw2' || t === 'sw3', isHost = t => t === 'pc' || t === 'srv', fwd = t => t === 'sw3' || t === 'rtr' || t === 'fw' || t === 'cloud';

let S = null, OSPF = {}, OADJ = {};
const HITS = {}, NATT = {};
const use = s => (S = s);
const state = () => S;

/* ---------- IP ---------- */
function ip2i(s){const p=String(s??'').trim().split('.');if(p.length!==4)return null;let n=0;for(const x of p){if(!/^\d{1,3}$/.test(x))return null;const v=+x;if(v>255)return null;n=n*256+v}return n>>>0}
function i2ip(n){n>>>=0;return[n>>>24,(n>>>16)&255,(n>>>8)&255,n&255].join('.')}
const lenMask=l=>l===0?0:(0xFFFFFFFF<<(32-l))>>>0;
function pc(s){if(s===undefined||s===null)return null;s=String(s).trim();if(!s)return null;if(s==='any')return{ip:0,len:0,mask:0,net:0};const[a,b]=s.split('/');const ip=ip2i(a);if(ip===null)return null;const len=b===undefined?32:Number(b);if(!Number.isInteger(len)||len<0||len>32)return null;const mask=lenMask(len);return{ip,len,mask,net:(ip&mask)>>>0}}
const inNet=(ip,c)=>((ip&c.mask)>>>0)===c.net;
const netStr=c=>i2ip(c.net)+'/'+c.len, cidrStr=c=>i2ip(c.ip)+'/'+c.len, wc=c=>i2ip((~c.mask)>>>0), msk=c=>i2ip(c.mask);
function maskLen(m){const n=ip2i(m);if(n===null)return null;let l=0;while(l<32&&(n&(0x80000000>>>l)))l++;return lenMask(l)===n?l:null}
function parseList(s){const out=[];String(s||'').replace(/\s+to\s+/gi,'-').split(/[,\s]+/).forEach(t=>{const m=t.match(/^(\d+)(?:-(\d+))?$/);if(!m)return;const a=+m[1],b=m[2]?+m[2]:a;for(let i=a;i<=b&&i<=4094;i++)out.push(i)});return out}
const allAllowed=p=>!p.allowed||!String(p.allowed).trim()||/all/i.test(p.allowed);
const allowedHas=(p,v)=>allAllowed(p)||parseList(p.allowed).includes(v);

/* ---------- catálogo e portas ---------- */
const modelOf=d=>d&&d.model?CAT.BY[d.model]||null:null;
const pinfo=(d,k)=>{const m=modelOf(d);return m&&m.names[k]?m.names[k]:null};
const isMgmt=(d,k)=>{const i=pinfo(d,k);return!!(i&&i.role==='mgmt')};
const isInternal=(d,k)=>{const i=pinfo(d,k);return!!(i&&i.role==='internal')};
const portSpeed=(d,k)=>{const i=pinfo(d,k);return i?i.sp:(isHost(d.type)?'1G':'1G')};
function osOf(d){const m=modelOf(d);if(isHost(d.type))return'linux';if(m&&m.os&&m.os!=='generic'&&m.os!=='linux')return m.os;if(d.type==='fw')return'fortios';return'cisco'}
function unitsOf(d){const m=modelOf(d);if(m)return m.u||0;if(d.type==='pc'||d.parent)return 0;return 1}
function wattsOf(d){const m=modelOf(d);if(m)return m.w||0;return({sw2:120,sw3:250,rtr:300,fw:250,srv:500,pc:0})[d.type]||0}

/* ---------- modelo ---------- */
const dev=id=>S.devices.find(d=>d.id===id);
const byName=n=>S.devices.find(d=>d.name===n);
function uid(p){S.seq=(S.seq||0)+1;return p+S.seq}
const mkPort=(t,role)=>({mode:role==='mgmt'?'routed':(isSw(t)?'access':'routed'),vlan:1,allowed:'',native:1,ip:'',desc:'',shut:false,subs:[],nat:false,lag:0,gw:''});
function mkDev(type,name,x,y,o={}){o={...o};const m=o.model?CAT.BY[o.model]:null;
  const ports=m?m.names.map(n=>mkPort(type,n.role)):Array.from({length:TYPES[type].ports},()=>mkPort(type));
  const d={id:uid('d'),type,name,x,y,ports,vlans:[],svis:[],routes:[],rules:[],gw:'',ospf:{on:false,area:0}};
  const pp=o.ports;delete o.ports;Object.assign(d,o);if(pp)pp.forEach(([k,p])=>Object.assign(d.ports[k-1],p));S.devices.push(d);return d}
function addLink(a,ak,b,bk,extra){const l={id:uid('l'),a:{dev:a.id,k:ak-1},b:{dev:b.id,k:bk-1},...(extra||{})};S.links.push(l);return l}
function linkAt(id,k){const l=S.links.find(l=>(l.a.dev===id&&l.a.k===k)||(l.b.dev===id&&l.b.k===k));if(!l)return null;const o=(l.a.dev===id&&l.a.k===k)?l.b:l.a;return{link:l,peer:o.dev,peerK:o.k}}
const linkCount=d=>S.links.filter(l=>l.a.dev===d.id||l.b.dev===d.id).length;
function uniqName(t,pre){pre=pre||TYPES[t].pre;let i=1;while(byName(`${pre}-${String(i).padStart(2,'0')}`))i++;return`${pre}-${String(i).padStart(2,'0')}`}
function freePort(d,peer){const free=k=>!linkAt(d.id,k)&&!isInternal(d,k);const oob=x=>!!x&&/oob/i.test(modelOf(x)?.role||'');
  const mg=d.ports.findIndex((p,k)=>isMgmt(d,k)&&free(k));if(oob(peer)&&mg>=0)return mg;
  const data=d.ports.map((p,k)=>k).filter(k=>free(k)&&!isMgmt(d,k));if(!data.length)return mg>=0&&oob(peer)?mg:-1;
  if(isSw(d.type)&&peer&&!isHost(peer.type)&&!oob(d))return data[data.length-1];return data[0]}
function prefixFor(m,type){if(!m)return TYPES[type].pre;const r=(m.role||'').toLowerCase();
  if(/spine/.test(r))return'SPINE';if(/leaf|tor/.test(r))return'LEAF';if(/oob/.test(r))return'OOB';if(/pe|borda/.test(r)&&type==='rtr')return'PE';if(type==='fw')return'FW';if(/fabric interconnect/.test(r))return'FI';
  if(type==='srv')return/controller/i.test(m.role)?'CTRL':'SRV';if(type==='chassis')return'BLADE';return TYPES[type].pre}

/* ---------- LAG (LACP / bond) ---------- */
const lagMembers=(d,n)=>d.ports.map((p,k)=>k).filter(k=>+d.ports[k].lag===+n&&+n>0);
function lagMaster(d,k){const p=d.ports[k];if(!p||!+p.lag)return k;return lagMembers(d,p.lag)[0]}
function lagUp(d,n){return lagMembers(d,n).find(k=>!d.ports[k].shut&&linkAt(d.id,k))}
function lagName(v,d,n){n=+n;if(isHost(d.type)||v==='linux')return'bond'+(n-1);
  return({cisco:'Port-channel'+n,nxos:'port-channel'+n,eos:'Port-Channel'+n,os10:'port-channel'+n,aoscx:'lag '+n,junos:'ae'+(n-1),huawei:'Eth-Trunk'+n,routeros:'bond'+n,fortios:'agg'+n,vyos:'bond'+(n-1)})[v]||'Po'+n}
const lagShort=(d,n)=>isHost(d.type)?'bond'+(n-1):'Po'+n;

/* ---------- nomes de portas ---------- */
function dataIndex(d,k){let n=0;for(let j=0;j<k;j++)if(!isMgmt(d,j))n++;return n}
function spn(d,k){const i=pinfo(d,k);if(i)return i.s;if(isHost(d.type))return'eth'+k;return isSw(d.type)?`Gi1/0/${k+1}`:`Gi0/${k}`}
function mgmtName(v,d){return({cisco:isSw(d.type)?'GigabitEthernet0/0':'GigabitEthernet0',nxos:'mgmt0',junos:d.type==='sw3'||d.type==='sw2'?'em0':'fxp0',eos:'Management1',aoscx:'mgmt',os10:'mgmt1/1/1',huawei:'MEth0/0/0',routeros:'ether-mgmt',fortios:'mgmt',vyos:'eth-mgmt'})[v]||'mgmt0'}
function pn(v,d,k){const i=pinfo(d,k),m=modelOf(d);if(v==='auto')v=osOf(d);
  if(isHost(d.type)||v==='linux')return spn(d,k);
  if(i&&m&&m.os===v)return i.f;if(i&&i.role==='mgmt')return mgmtName(v,d);
  const sw=isSw(d.type),x=dataIndex(d,k),n=x+1;
  switch(v){case'cisco':return sw?`GigabitEthernet1/0/${n}`:`GigabitEthernet0/${x}`;case'nxos':return`Ethernet1/${n}`;case'junos':return`ge-0/0/${x}`;case'eos':return`Ethernet${n}`;
    case'aoscx':return`1/1/${n}`;case'os10':return`ethernet1/1/${n}`;case'huawei':return sw?`GigabitEthernet0/0/${n}`:`GigabitEthernet0/0/${x}`;case'routeros':return`ether${n}`;case'fortios':return`port${n}`;case'vyos':return`eth${x}`}
  return spn(d,k)}
function loName(v,id){id=+id||0;return({cisco:'Loopback',nxos:'loopback',eos:'Loopback',os10:'loopback',aoscx:'loopback ',junos:'lo0.',huawei:'LoopBack',routeros:'loopback',fortios:'loopback',vyos:'dum',linux:'lo'})[v]+id}
function ifName(d,f){if(f.kind==='svi')return'Vlan'+f.vlan;if(f.kind==='loop')return'Lo'+f.id;const base=f.lag?lagShort(d,f.lag):spn(d,f.k);return f.kind==='sub'?base+'.'+f.vlan:base}
function ifFull(v,d,f){if(!f)return'?';if(v==='auto')v=osOf(d);if(f.kind==='loop')return loName(v,f.id);if(f.kind==='svi')return({cisco:'Vlan',nxos:'Vlan',junos:'irb.',eos:'Vlan',aoscx:'vlan',os10:'vlan',huawei:'Vlanif',routeros:'vlan',fortios:'vlan',vyos:'br0.',linux:'vlan'})[v]+f.vlan;
  const b=f.lag?lagName(v,d,f.lag):pn(v,d,f.k);if(f.kind==='sub')return(v==='junos'?b+'.':b+'.')+f.vlan;return v==='junos'?b+'.0':b}

/* ---------- interfaces L3 ---------- */
function portDown(d,k){const p=d.ports[k];if(d.power==='off'&&!isMgmt(d,k))return true;if(+p.lag)return lagMembers(d,p.lag).every(j=>d.ports[j].shut);return p.shut}
function l3ifs(d,all){const out=[];const host=isHost(d.type);d.ports.forEach((p,k)=>{if(p.mode!=='routed')return;if(+p.lag&&lagMaster(d,k)!==k)return;if(!all&&portDown(d,k))return;
    const mg=isMgmt(d,k),lag=+p.lag||0;const c=pc(p.ip);const vf=x=>host?'':(x||'');if(c&&p.ip!=='any'){const sec=[...String(p.sec||'').split(/[\s,]+/).map(x=>pc(x)).filter(Boolean).map(x=>x.ip),...(host&&!mg?secIps(d,k,c):[])];out.push({dev:d.id,key:'p'+k,k,kind:'port',c,nat:!!p.nat,mgmt:mg,lag,vip:ip2i(p.vip),vrf:mg?MGV:vf(p.vrf),mpls:!mg&&!host&&!!p.mpls,...(sec.length?{sec}:{})})}
    (p.subs||[]).forEach(s=>{const c=pc(s.ip);if(c){const sec=host?secIps(d,k,c,s.vlan):[];out.push({dev:d.id,key:`p${k}.${s.vlan}`,k,vlan:+s.vlan,kind:'sub',c,nat:!!s.nat,mgmt:false,lag,vip:ip2i(s.vip),vrf:vf(s.vrf),mpls:!host&&!!s.mpls,...(sec.length?{sec}:{})})}})});
  (d.svis||[]).forEach(s=>{const c=pc(s.ip);if(c)out.push({dev:d.id,key:'v'+s.vlan,vlan:+s.vlan,kind:'svi',c,nat:false,mgmt:false,lag:0,vip:ip2i(s.vip),vrf:host?'':(s.vrf||''),mpls:!host&&!!s.mpls,agw:!!s.agw})});
  if(!host)(d.loops||[]).forEach(l=>{const c=pc(l.ip);if(c)out.push({dev:d.id,key:'lo'+l.id,id:+l.id,kind:'loop',c,nat:false,mgmt:false,lag:0,vip:null,vrf:l.vrf||'',mpls:false})});
  if(d.type==='cloud'&&d.cloud&&d.cloud.mode==='host'&&pc(d.cloud.lan||'')){const lan=pc(d.cloud.lan);const h=ip2i(d.cloud.hostIp||'');
    const lanIps=[];S.devices.forEach(x=>{if(x.type==='cloud')return;l3ifs(x).forEach(f=>{if(!f.mgmt&&inNet(f.c.ip,lan))lanIps.push(f.c.ip)})});
    out.forEach(f=>{if(f.kind==='port'&&inNet(f.c.ip,lan)){f.parp=[...(h!==null?[h]:[]),...lanIps.filter(ip=>ip!==f.c.ip)];f.parpLan=lan}})}
  if(d.vpns&&d.vpns.length){const ta=tunAddrs(d);if(ta.length){const f=out.find(f=>!f.mgmt&&f.kind!=='loop'&&!f.vrf);if(f)f.sec=[...(f.sec||[]),...ta]}}return out}
const getIf=(d,key)=>l3ifs(d).find(f=>f.key===key);
function vipMasterOf(vip){let best=null;S.devices.forEach(d=>l3ifs(d).forEach(f=>{if(f.vip===vip&&(!best||f.c.ip>best.f.c.ip))best={d,f}}));return best}
const ownsIp=(f,ip)=>{if(f.c.ip===ip)return true;if(f.sec&&f.sec.includes(ip))return true;if(f.vip==null||f.vip!==ip)return false;const m=vipMasterOf(ip);return!!m&&m.d.id===f.dev&&m.f.key===f.key};

/* ---------- camada 2 ---------- */
function l2Run(init){const eps=[],drops=[],seen=new Set(),q=[];
  const emit=(did,k,tag,path,vxh)=>{const d=dev(did);let p=d.ports[k];
    if(+p.lag){const u=lagUp(d,p.lag);if(u===undefined){drops.push(`${d.name} ${lagShort(d,p.lag)}: nenhum membro do LAG está ativo`);return}k=u;p=d.ports[k]}
    const L=linkAt(did,k);if(!L)return;if(p.shut){drops.push(`${d.name} ${spn(d,k)} está em shutdown`);return}q.push({t:'a',dev:L.peer,k:L.peerK,tag,path:[...path,L.link.id],vxh})};
  init(emit,q);
  while(q.length){const e=q.shift();
    if(e.t==='a'){const key=`a${e.dev}|${e.k}|${e.tag}`;if(seen.has(key))continue;seen.add(key);const d=dev(e.dev);let p=d.ports[e.k];
      if(p.shut){drops.push(`${d.name} ${spn(d,e.k)} está em shutdown`);continue}
      if(isSw(d.type)&&p.mode!=='routed'){let v;
        if(p.mode==='access'){if(e.tag===null||e.tag===+p.vlan)v=+p.vlan;else{drops.push(`${d.name} ${spn(d,e.k)}: chegou quadro com tag ${e.tag} numa porta access (VLAN ${p.vlan}); os dois lados deveriam ser trunk`);continue}}
        else{const nat=+p.native||1;v=e.tag===null?nat:e.tag;if(!allowedHas(p,v)){drops.push(`${d.name} ${spn(d,e.k)}: VLAN ${v} não está permitida no trunk`);continue}}
        q.push({t:'f',dev:d.id,vlan:v,from:e.k,fromLag:+p.lag||0,path:e.path,vxh:e.vxh})}
      else{const m=lagMaster(d,e.k);p=d.ports[m];
        if(e.tag===null){if(p.mode==='routed'&&pc(p.ip))eps.push({dev:d.id,key:'p'+m,path:e.path,vxh:e.vxh})}
        else{const s=(p.subs||[]).find(s=>+s.vlan===e.tag);if(s)eps.push({dev:d.id,key:`p${m}.${e.tag}`,path:e.path,vxh:e.vxh});else drops.push(`${d.name} ${spn(d,e.k)}: chegou quadro com tag ${e.tag}, mas não existe subinterface para essa VLAN`)}}}
    else{const key=`f${e.dev}|${e.vlan}`;if(seen.has(key))continue;seen.add(key);const d=dev(e.dev);
      if(e.vlan!==1&&!(d.vlans||[]).some(x=>+x.id===e.vlan)){drops.push(`${d.name}: a VLAN ${e.vlan} não existe neste switch`);continue}
      const sentLag=new Set();
      d.ports.forEach((p,k)=>{if(k===e.from||p.mode==='routed')return;if(e.fromLag&&+p.lag===e.fromLag)return;
        if(+p.lag){if(sentLag.has(+p.lag))return;sentLag.add(+p.lag)}
        if(p.mode==='access'&&+p.vlan===e.vlan)emit(d.id,k,null,e.path,e.vxh);else if(p.mode==='trunk'&&allowedHas(p,e.vlan))emit(d.id,k,e.vlan===(+p.native||1)?null:e.vlan,e.path,e.vxh)});
      if(e.from!==-1)(d.svis||[]).forEach(s=>{if(+s.vlan===e.vlan&&pc(s.ip))eps.push({dev:d.id,key:'v'+s.vlan,path:e.path,vxh:e.vxh})});
      if(!VXOFF&&!e.vx){const vx=vxOf(d,e.vlan);if(vx){const vt=vtepIp(d);if(vt===null)drops.push(`${d.name}: VNI ${vx.vni} sem VTEP (falta a loopback de origem da interface NVE)`);
        else((EVX[d.id]||{})[vx.vni]||[]).forEach(pe=>{const pd=dev(pe.dev);const pv=pd&&vxVlan(pd,pe.vni||vx.vni);if(pv==null)return;const up=underPath(d,pe.ip);
          if(!up.ok){drops.push(`${d.name}: VTEP ${i2ip(pe.ip)} (${pd.name}) inalcançável pelo underlay`);return}q.push({t:'f',dev:pd.id,vlan:pv,from:-2,fromLag:0,path:[...e.path,...up.links],vx:true,vxh:[...(e.vxh||[]),`VXLAN VNI ${vx.vni} ${d.name}→${pd.name}`]})})}}}}
  return{eps,drops:[...new Set(drops)]}}
function l2Reach(devId,ifc){if(ifc.kind==='loop')return{eps:[],drops:[]};return l2Run((emit,q)=>{if(ifc.kind==='svi')q.push({t:'f',dev:devId,vlan:ifc.vlan,from:-1,fromLag:0,path:[]});else emit(devId,ifc.k,ifc.kind==='sub'?ifc.vlan:null,[])})}
function l2FromPort(devId,k,tag){return l2Run(emit=>emit(devId,k,tag,[]))}

/* ---------- VRF ---------- */
const MGV='__mgmt';
const vrfKey=(d,vrf)=>vrf?d.id+'|'+vrf:d.id;
const vrfList=d=>(d.vrfs||[]).map(v=>v.name);
const vrfObj=(d,n)=>(d.vrfs||[]).find(v=>v.name===n);
const vrfLabel=v=>v===MGV?'management':(v||'default');
const isMgmtVrfName=n=>/^(mgmt|management|mgmt-vrf|mgmt_junos|_management_vpn_|mgmtvrf)$/i.test(String(n||''));
const isNull=nh=>/^(null0?|blackhole|discard)$/i.test(String(nh||'').trim());
const routesIn=(d,vrf)=>(d.routes||[]).filter(r=>(r.vrf||'')===(vrf||''));
function ifsIn(d,vrf,all){return l3ifs(d,all).filter(f=>f.vrf===(vrf||''))}

/* ---------- roteamento ---------- */
let BGP={},BGPT={},BSESS={};
function ospfCfg(d,vrf){if(!fwd(d.type))return null;if(!vrf)return d.ospf&&d.ospf.on?d.ospf:null;const v=vrfObj(d,vrf);return v&&v.ospf&&v.ospf.on?v.ospf:null}
function hasDefault(d,vrf,withBgp){if(routesIn(d,vrf).some(r=>{const c=pc(r.dst);return c&&c.len===0}))return true;
  if(withBgp){const t=BGP[vrfKey(d,vrf)]||[];return t.some(r=>r.c.len===0&&!r.local)}return false}
function ospfPass(withBgp){OSPF={};OADJ={};const adj={},nodes=[];
  S.devices.forEach(d=>{if(!fwd(d.type))return;['',...vrfList(d)].forEach(v=>{if(ospfCfg(d,v))nodes.push({d,v,key:vrfKey(d,v)})})});
  nodes.forEach(({d,v,key})=>{const cfg=ospfCfg(d,v);adj[key]=[];ifsIn(d,v).forEach(f=>{l2Reach(d.id,f).eps.forEach(ep=>{const pd=dev(ep.dev);if(pd.id===d.id||!fwd(pd.type))return;const pf=getIf(pd,ep.key);if(!pf||pf.mgmt)return;
      const pcfg=ospfCfg(pd,pf.vrf);if(!pcfg||+pcfg.area!==+cfg.area)return;
      if(pf.c.net===f.c.net&&pf.c.len===f.c.len){const to=vrfKey(pd,pf.vrf);if(!adj[key].some(x=>x.to===to&&x.ifc.key===f.key))adj[key].push({to,dev:pd.id,vrf:pf.vrf,nh:pf.c.ip,ifc:f})}})})});
  OADJ=adj;const nodeOf={};nodes.forEach(n=>nodeOf[n.key]=n);
  nodes.forEach(({d,v,key})=>{const first={[key]:null},dist={[key]:0},q=[key];
    while(q.length){const u=q.shift();(adj[u]||[]).forEach(n=>{if(n.to in dist)return;dist[n.to]=dist[u]+1;first[n.to]=u===key?n:first[u];q.push(n.to)})}
    const rts=[],have=new Set(ifsIn(d,v).map(f=>f.c.net+'/'+f.c.len));
    Object.keys(dist).forEach(id=>{if(id===key)return;const o=nodeOf[id],fh=first[id];ifsIn(o.d,o.v).forEach(f=>{const k=f.c.net+'/'+f.c.len;if(have.has(k))return;have.add(k);rts.push({c:{...f.c,ip:f.c.net},nh:fh.nh,ifc:fh.ifc,cost:dist[id]*10+10,via:o.d.name})})});
    if(!hasDefault(d,v,false))Object.keys(dist).forEach(id=>{if(id===key||rts.some(r=>r.c.len===0))return;const o=nodeOf[id],oc=ospfCfg(o.d,o.v);
      if(oc&&oc.dio&&hasDefault(o.d,o.v,withBgp)){const fh=first[id];rts.push({c:{ip:0,len:0,mask:0,net:0},nh:fh.nh,ifc:fh.ifc,cost:dist[id]*10+10,via:o.d.name,ext:true})}});
    OSPF[key]=rts})}
function computeOspf(){EVX={};UPC={};BGP={};ospfPass(false);computeBgp();UPC={};if(S.devices.some(d=>vxOn(d)||(fwd(d.type)&&((d.ospf&&d.ospf.dio)||(d.vrfs||[]).some(v=>v.ospf&&v.ospf.dio)))))ospfPass(true)}
function mgmtLookup(d,dst,mg){let best=null;mg.forEach(f=>{if(inNet(dst,f.c)&&(!best||f.c.len>best.len))best={len:f.c.len,ifc:f,nh:dst,src:'C',label:netStr(f.c),ad:0}});
  if(!best)mg.forEach(f=>{const g=ip2i(d.ports[f.k].gw);if(g!==null&&inNet(g,f.c)&&!best)best={len:0,ifc:f,nh:g,src:'M',label:'0.0.0.0/0 (gerência)',ad:1}});return best}
/* o: {vrf, src, origin, noBgp} */
function lookup(d,dst,o={}){const vrf=o.vrf||'';const all=l3ifs(d),mg=all.filter(f=>f.mgmt);
  if(vrf===MGV||(o.src!=null&&mg.some(f=>ownsIp(f,o.src))))return mgmtLookup(d,dst,mg);
  const main=all.filter(f=>!f.mgmt&&f.vrf===vrf);
  let best=null;const take=(len,ifc,nh,src,label,ad,extra)=>{if(!best||len>best.len||(len===best.len&&ad<best.ad))best={len,ifc,nh,src,label,ad,...(extra||{})}};
  main.forEach(f=>{if(inNet(dst,f.c)&&!(d.type==='cloud'&&!cloudPortHas(d,f,dst)))take(f.c.len,f,dst,'C',netStr(f.c),0)});
  if(fwd(d.type)||isHost(d.type))routesIn(d,vrf).forEach(r=>{const c=pc(r.dst),nh=ip2i(r.nh);if(c&&isNull(r.nh)){if(inNet(dst,c))take(c.len,null,null,'S',netStr(c),1,{blackhole:true});return}if(!c||nh===null)return;if(inNet(dst,c)){const f=main.find(f=>inNet(nh,f.c));if(f)take(c.len,f,nh,'S',netStr(c),1)}});
  if(fwd(d.type)){(OSPF[vrfKey(d,vrf)]||[]).forEach(r=>{if(inNet(dst,r.c))take(r.c.len,r.ifc,r.nh,'O',netStr(r.c),110)});
    if(!o.noBgp)(BGP[vrfKey(d,vrf)]||[]).forEach(r=>{if(!r.local&&r.ifc&&inNet(dst,r.c))take(r.c.len,r.ifc,r.via,'B',netStr(r.c),r.ebgp?20:200,{bgpNh:r.nh,vpn:r.imp||null})})}
  else if(!vrf&&d.gw){const g=ip2i(d.gw);const f=g!==null&&main.find(f=>inNet(g,f.c));if(f)take(0,f,g,'G','0.0.0.0/0',1)}
  if(!best&&o.origin&&!vrf)return mgmtLookup(d,dst,mg);
  if(best&&best.blackhole&&o.noBgp)return null;
  return best}

/* ---------- BGP ---------- */
const bgpOn=d=>!!(fwd(d.type)&&d.bgp&&+d.bgp.asn>0);
const bgpRid=d=>(d.bgp&&ip2i(d.bgp.rid)!==null)?d.bgp.rid:ridOf(d);
function ridOf(d){if(d.ospf&&d.ospf.rid)return d.ospf.rid;const all=l3ifs(d);const lo=all.filter(f=>f.kind==='loop'&&!f.vrf);if(lo.length)return i2ip(Math.max(...lo.map(f=>f.c.ip)));const ips=all.filter(f=>!f.mgmt).map(f=>f.c.ip);return ips.length?i2ip(Math.max(...ips)):'0.0.0.0'}
function rdFor(d,v){const x=vrfObj(d,v);if(x&&x.rd)return x.rd;const i=(d.vrfs||[]).findIndex(y=>y.name===v);return`${d.bgp&&+d.bgp.asn?d.bgp.asn:65000}:${i+1}`}
const hasUs=n=>n&&n.us!==''&&n.us!=null&&!isNaN(+n.us);
function nbFams(n){if(n.vrf)return['v4'];const f=[];if(!n.noV4)f.push('v4');if(n.vpnv4)f.push('vpnv4');if(n.evpn)f.push('evpn');return f}
/* ---------- políticas: prefix-list, community-list, route-map ---------- */
const WKC={'no-export':1,'no-advertise':1,'internet':1,'local-as':1};
function commList(s){return String(s||'').split(/[\s,]+/).map(x=>x.trim().toLowerCase().replace(/^no-export-subconfed$/,'local-as')).filter(x=>WKC[x]||/^\d+:\d+$/.test(x))}
function rtList(s){return String(s||'').split(/[\s,]+/).map(x=>x.trim().replace(/^target:/i,'')).filter(x=>/^[\d.]+:\d+$/.test(x))}
const rtHit=(a,b)=>(a||[]).some(x=>(b||[]).includes(x));
const seqd=rs=>(rs||[]).slice().sort((a,b)=>(+a.seq||0)-(+b.seq||0));
function plMatch(d,name,c){const pl=(d.pfx||[]).find(x=>x.name===name);if(!pl)return false;
  for(const r of seqd(pl.rules)){const p=pc(r.pfx);if(!p||c.len<p.len||((c.net&p.mask)>>>0)!==p.net)continue;const ge=+r.ge||0,le=+r.le||0;
    const ok=!ge&&!le?c.len===p.len:c.len>=(ge||p.len)&&c.len<=(le||32);if(ok)return r.act!=='deny'}return false}
function clMatch(d,name,comm){const cl=(d.clists||[]).find(x=>x.name===name);if(!cl)return false;for(const r of cl.rules||[]){const w=commList(r.comm);if(w.length&&w.every(x=>(comm||[]).includes(x)))return r.act!=='deny'}return false}
function rmApply(d,name,p){const rm=(d.rmaps||[]).find(x=>x.name===name);if(!rm)return null;
  for(const r of seqd(rm.rules)){if(r.mPfx&&!plMatch(d,r.mPfx,p.c))continue;if(r.mComm&&!clMatch(d,r.mComm,p.comm))continue;if(r.act==='deny')return null;
    const q={...p,comm:(p.comm||[]).slice(),asPath:p.asPath.slice()};if(r.sLp!==''&&r.sLp!=null&&!isNaN(+r.sLp))q.lp=+r.sLp;if(r.sMed!==''&&r.sMed!=null&&!isNaN(+r.sMed))q.med=+r.sMed;
    if(r.sComm){const cs=commList(r.sComm);q.comm=r.sAdd?[...new Set([...q.comm,...cs])]:cs}if(r.sPre){const pre=String(r.sPre).split(/[\s,]+/).map(Number).filter(n=>n>0);q.asPath=[...pre,...q.asPath]}return q}return null}
/* ---------- MPLS / LDP ---------- */
function hsh(s){let h=2166136261;for(const ch of String(s)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0}return h}
const ldpLabel=(d,fec)=>16+hsh(d.id+'|'+fec)%8000;
const vpnLabel=(d,vrf)=>24000+hsh(d.id+'|vpn|'+vrf)%8000;
const mplsOn=d=>fwd(d.type)&&l3ifs(d,true).some(f=>f.mpls);
function ldpRid(d){const all=l3ifs(d);const lo=all.filter(f=>f.kind==='loop'&&!f.vrf);if(lo.length){const z=lo.find(f=>f.id===0)||lo[0];return z.c.ip}const ips=all.filter(f=>!f.mgmt&&!f.vrf).map(f=>f.c.ip);return ips.length?Math.max(...ips):0}
function ldpNbrs(d){if(!fwd(d.type))return[];const out=[];l3ifs(d).filter(f=>f.mpls&&!f.vrf).forEach(f=>{l2Reach(d.id,f).eps.forEach(ep=>{const pd=dev(ep.dev);if(!pd||pd.id===d.id||!fwd(pd.type))return;const pf=getIf(pd,ep.key);if(!pf||!pf.mpls||pf.vrf)return;
    let x=out.find(o=>o.pd===pd);if(!x){const rid=ldpRid(pd);const up=!!lookup(d,rid,{})&&!!lookup(pd,ldpRid(d),{});x={pd,rid,up,ifs:[]};out.push(x)}x.ifs.push({f,pf,nh:pf.c.ip})})});return out}
const ldpOk=(d,f,nd,nf)=>!!(f&&f.mpls&&nf&&nf.mpls&&ldpNbrs(d).some(x=>x.pd.id===nd.id&&x.up));
/* ---------- VXLAN ---------- */
let EVX={},UPC={},VXOFF=false;
const vxOn=d=>d.type==='sw3'&&!!d.vxlan&&Array.isArray(d.vxlan.vnis);
function vtepIp(d){if(!vxOn(d)||d.vxlan.src===''||d.vxlan.src==null)return null;const l=l3ifs(d).find(f=>f.kind==='loop'&&f.id===+d.vxlan.src&&!f.vrf);return l?l.c.ip:null}
const l2vnis=d=>vxOn(d)?d.vxlan.vnis.filter(x=>+x.vni>0&&!(d.vrfs||[]).some(v=>+v.l3vni===+x.vni)):[];
const vxOf=(d,vlan)=>l2vnis(d).find(x=>+x.vlan===+vlan)||null;
const vxVlan=(d,vni)=>{const x=l2vnis(d).find(y=>+y.vni===+vni);return x?+x.vlan:null};
function underPath(d,ip){const key=d.id+'>'+ip;if(UPC[key])return UPC[key];const save=VXOFF;VXOFF=true;let cur=d;const links=[];let res={ok:false,links:[]};
  for(let i=0;i<32;i++){if(l3ifs(cur).some(f=>!f.mgmt&&!f.vrf&&f.c.ip===ip)){res={ok:true,links};break}
    const rt=lookup(cur,ip,{});if(!rt||!rt.ifc||rt.blackhole)break;const r=l2Reach(cur.id,rt.ifc);
    const ep=r.eps.find(ep=>{if(ep.dev===cur.id&&ep.key===rt.ifc.key)return false;const f=getIf(dev(ep.dev),ep.key);return f&&ownsIp(f,rt.nh)});if(!ep)break;links.push(...ep.path);cur=dev(ep.dev)}
  VXOFF=save;UPC[key]=res;return res}
function evpnHosts(d,vlan){const save=VXOFF;VXOFF=true;const r=l2Run((emit,q)=>q.push({t:'f',dev:d.id,vlan,from:-1,fromLag:0,path:[]}));VXOFF=save;
  const out=[];r.eps.forEach(ep=>{const pd=dev(ep.dev);if(!pd||!isHost(pd.type))return;const f=getIf(pd,ep.key);if(f)out.push({ip:f.c.ip,mac:mac(pd.id,f.key).join(''),dev:pd.id})});return out}
function vxStatic(){S.devices.forEach(d=>{if(!vxOn(d))return;l2vnis(d).forEach(x=>{String(x.peers||'').split(/[\s,]+/).map(ip2i).filter(v=>v!==null).forEach(ip=>{
  const pd=S.devices.find(o=>o.id!==d.id&&vtepIp(o)===ip);if(!pd||vxVlan(pd,x.vni)==null)return;const L=((EVX[d.id]=EVX[d.id]||{})[x.vni]=EVX[d.id][x.vni]||[]);if(!L.some(p=>p.dev===pd.id))L.push({dev:pd.id,ip,how:'static'})})})})}
/* ---------- sessões e propagação ---------- */
function bgpSrc(d,nb){const vrf=nb.vrf||'';if(hasUs(nb)){const lf=l3ifs(d).find(f=>f.kind==='loop'&&f.id===+nb.us);return lf&&lf.vrf===vrf?{ip:lf.c.ip}:{err:`update-source Loopback${nb.us} não existe, está sem IP ou em outra VRF`}}
  const rt=lookup(d,ip2i(nb.ip),{vrf});if(!rt||!rt.ifc||rt.blackhole)return{err:`sem rota para ${nb.ip} na VRF ${vrfLabel(vrf)}`,noroute:true};return{ip:rt.ifc.c.ip,rt}}
function bgpSess(sp){BSESS={};const sess=[];
  sp.forEach(d=>{BSESS[d.id]=[];(d.bgp.neighbors||[]).forEach(nb=>{const vrf=nb.vrf||'';const ip=ip2i(nb.ip);const st={nb,vrf,state:'Idle',why:'',rcv:0,sent:0,fams:[]};BSESS[d.id].push(st);
    if(ip===null){st.why='IP do vizinho inválido';return}
    if(vrf&&!vrfObj(d,vrf)){st.why=`a VRF ${vrf} não existe`;return}
    if(nb.shut){st.state='Idle (Admin)';st.why='neighbor shutdown';return}
    if(!(+nb.ras>0)){st.why='falta remote-as';return}
    const rt=lookup(d,ip,{vrf});if(!rt||!rt.ifc||rt.blackhole){st.state='Active';st.why=`sem rota para ${nb.ip} na VRF ${vrfLabel(vrf)}`;return}
    const s1=bgpSrc(d,nb);if(s1.err){st.state=s1.noroute?'Active':'Idle';st.why=s1.err;return}const src=s1.ip;
    const cands=[];S.devices.forEach(x=>{if(x.id===d.id)return;l3ifs(x).forEach(f=>{if(!f.mgmt&&f.c.ip===ip)cands.push({x,f})})});
    const pick=cands.find(c=>bgpOn(c.x)&&(c.x.bgp.neighbors||[]).some(n=>(n.vrf||'')===c.f.vrf&&ip2i(n.ip)===src))||cands.find(c=>bgpOn(c.x))||cands[0];
    if(!pick){st.state='Active';st.why=`nenhum equipamento responde em ${nb.ip}`;return}const pd=pick.x,pf=pick.f;
    if(!bgpOn(pd)){st.state='Active';st.why=`${pd.name} não tem BGP ativo`;return}
    const ebgp=+d.bgp.asn!==+pd.bgp.asn;
    if(ebgp&&!nb.mh&&!inNet(ip,rt.ifc.c)){st.state='Idle';st.why=`eBGP com ${nb.ip}, que não está numa rede conectada: configure ebgp-multihop (e update-source)`;return}
    if(rt.src==='C'){const r=l2Reach(d.id,rt.ifc);if(!r.eps.some(ep=>ep.dev===pd.id&&ep.key===pf.key)){st.state='Active';st.why=`${nb.ip} não responde na camada 2${r.drops[0]?' ('+r.drops[0]+')':''}`;return}}
    const pvrf=pf.vrf;
    const back=(pd.bgp.neighbors||[]).find(n=>(n.vrf||'')===pvrf&&ip2i(n.ip)===src);
    if(!back){const mine=new Set(ifsIn(d,vrf).map(f=>f.c.ip));const other=(pd.bgp.neighbors||[]).find(n=>(n.vrf||'')===pvrf&&mine.has(ip2i(n.ip)));
      st.state='Active';st.why=other?`${pd.name} espera a sessão vindo de ${other.ip}, mas ${d.name} sai com ${i2ip(src)} (configure update-source)`:`${pd.name} não tem "neighbor" apontando para ${d.name} (${i2ip(src)})${pvrf?' na VRF '+pvrf:''}`;return}
    if(+nb.ras!==+pd.bgp.asn){st.state='Idle';st.why=`remote-as ${nb.ras} não confere: ${pd.name} é AS ${pd.bgp.asn} (NOTIFICATION bad peer AS)`;return}
    if(+back.ras!==+d.bgp.asn){st.state='Idle';st.why=`${pd.name} espera AS ${back.ras}, mas ${d.name} é AS ${d.bgp.asn}`;return}
    if(back.shut){st.state='Idle';st.why=`${pd.name} desligou a sessão (shutdown)`;return}
    const s2=bgpSrc(pd,back);if(s2.err||s2.ip!==ip){st.state='Active';st.why=s2.err?`${pd.name}: ${s2.err}`:`${pd.name} sai com ${i2ip(s2.ip)}, mas ${d.name} espera ${nb.ip} (configure update-source em ${pd.name})`;return}
    if(ebgp&&!back.mh&&!inNet(src,s2.rt?s2.rt.ifc.c:{mask:0xffffffff,net:-1})){st.state='Idle';st.why=`${pd.name} precisa de ebgp-multihop para ${i2ip(src)}`;return}
    const fa=nbFams(back);const fams=nbFams(nb).filter(x=>fa.includes(x));
    Object.assign(st,{state:'Established',pd,pvrf,local:src,remote:ip,ebgp,back,fams});sess.push({d,vrf,st})})});
  return sess}
function bgpLocal(d,vrf){const out=new Map();const add=(c,origin,how,rm)=>{const n={...c,ip:c.net};const key=netStr(n);if(out.has(key))return;let p={c:n,key,asPath:[],lp:100,med:0,comm:[],origin,nh:null,local:true,how};if(rm){p=rmApply(d,rm,p);if(!p)return}out.set(key,p)};
  const ifs=ifsIn(d,vrf),sts=routesIn(d,vrf),os=OSPF[vrfKey(d,vrf)]||[];
  (d.bgp.networks||[]).filter(n=>(n.vrf||'')===vrf).forEach(n=>{const c=pc(n.pfx);if(!c)return;const k=netStr(c);
    const ok=ifs.some(f=>netStr(f.c)===k)||sts.some(r=>pc(r.dst)&&netStr(pc(r.dst))===k)||os.some(r=>netStr(r.c)===k);if(ok)add(c,'i','network',n.rm)});
  (d.bgp.redist||[]).filter(r=>(r.vrf||'')===vrf).forEach(r=>{
    if(r.src==='connected')ifs.forEach(f=>add(f.c,'?','connected',r.rm));
    if(r.src==='static')sts.forEach(s=>{const c=pc(s.dst);if(c)add(c,'?','static',r.rm)});
    if(r.src==='ospf')os.forEach(o=>add(o.c,'?','ospf',r.rm))});
  return out}
function bgpBetter(a,b){if(a.local!==b.local)return a.local?-1:1;if(a.lp!==b.lp)return b.lp-a.lp;if(a.asPath.length!==b.asPath.length)return a.asPath.length-b.asPath.length;
  if(a.origin!==b.origin)return a.origin==='i'?-1:1;if((a.med||0)!==(b.med||0))return(a.med||0)-(b.med||0);if(!!a.ebgp!==!!b.ebgp)return a.ebgp?-1:1;return(a.from?a.from.ip:0)-(b.from?b.from.ip:0)}
const vrfVpn=(d,v)=>{const x=vrfObj(d,v);return!!x&&!!(x.rtImp||x.rtExp||+x.l3vni>0)};
function computeBgp(){BGP={};BGPT={};BSESS={};EVX={};const sp=S.devices.filter(bgpOn);
  if(sp.length){let last=null,prev=null;
    for(let phase=0;phase<5;phase++){const sess=bgpSess(sp);const sig=sess.map(x=>x.d.id+'>'+x.st.nb.ip+'|'+x.vrf+'|'+x.st.fams.join('.')).join(',');
      if(phase&&sig===last){BSESS=prev;break}last=sig;runBgp(sp,sess);prev=BSESS}}
  vxStatic()}
function runBgp(sp,sess){BGPT={};EVX={};UPC={};const NB={};const nodes={};
  const nk=(d,vrf,fam)=>fam==='v4'?vrfKey(d,vrf):d.id+'#'+fam;
  const node=(d,vrf,fam)=>{const k=nk(d,vrf,fam);return nodes[k]||(nodes[k]={k,d,vrf,fam,local:fam==='v4'?bgpLocal(d,vrf):new Map(),inp:{},best:new Map(),all:new Map()})};
  sp.forEach(d=>{node(d,'','v4');vrfList(d).forEach(v=>{if(['neighbors','networks','redist'].some(k=>(d.bgp[k]||[]).some(n=>(n.vrf||'')===v))||vrfVpn(d,v))node(d,v,'v4')})});
  sess.forEach(({d,vrf,st})=>st.fams.forEach(f=>{node(d,f==='v4'?vrf:'',f);node(st.pd,f==='v4'?st.pvrf:'',f)}));
  const hosts={};S.devices.forEach(d=>{if(nodes[d.id+'#evpn']&&vxOn(d))hosts[d.id]=Object.fromEntries(l2vnis(d).map(x=>[x.vlan,evpnHosts(d,+x.vlan)]))});
  const covers=(d,ip,except)=>{const g=nodes[vrfKey(d,'')];return!!g&&[...g.best.values()].some(r=>r.key!==except&&inNet(ip,r.c)&&(r.local||!!lookup(d,r.nh,{noBgp:true})))};
  const valid=(n,p)=>{if(p.local)return true;if(n.fam!=='v4'||p.imp)return!!lookup(n.d,p.nh,{})||covers(n.d,p.nh);return!!lookup(n.d,p.nh,{vrf:n.vrf,noBgp:true})||(!n.vrf&&covers(n.d,p.nh,p.key))};
  const decide=n=>{const all=new Map();const add=p=>{if(!all.has(p.key))all.set(p.key,[]);all.get(p.key).push(p)};n.local.forEach(add);Object.values(n.inp).forEach(m=>m.forEach(add));
    const best=new Map();all.forEach((ps,k)=>{const v=ps.filter(p=>valid(n,p)).sort(bgpBetter);if(v.length)best.set(k,v[0])});n.all=all;n.best=best};
  const vpnLocal=d=>{const m=new Map();vrfList(d).forEach(v=>{const vn=nodes[vrfKey(d,v)];if(!vn)return;const vo=vrfObj(d,v),rd=rdFor(d,v),rts=rtList(vo.rtExp);
    vn.best.forEach(p=>{if(p.imp)return;const key=rd+':'+p.key;m.set(key,{...p,key,pfx:p.key,rd,rts,label:vpnLabel(d,v),eg:{dev:d.id,vrf:v},local:true,from:null,oid:undefined,fam:'vpnv4'})})});return m};
  const evpnLocal=d=>{const m=new Map();const vt=vtepIp(d);if(vt===null)return m;const asn=+d.bgp.asn;const h32=ip=>({ip,len:32,mask:0xffffffff,net:ip});
    l2vnis(d).forEach(x=>{const rd=`${i2ip(vt)}:${x.vlan}`;const rts=x.rt?rtList(x.rt):[`${asn}:${x.vni}`];const base={rd,rts,vni:+x.vni,vtep:vt,asPath:[],lp:100,origin:'i',med:0,comm:[],nh:null,local:true,eg:{dev:d.id},fam:'evpn'};
      const k3=`[3][${rd}][${i2ip(vt)}]`;m.set(k3,{...base,c:h32(vt),key:k3,type:3});
      ((hosts[d.id]||{})[x.vlan]||[]).forEach(h=>{const k2=`[2][${rd}][${h.mac}][${i2ip(h.ip)}]`;m.set(k2,{...base,c:h32(h.ip),key:k2,type:2,mac:h.mac})})});
    vrfList(d).forEach(v=>{const vo=vrfObj(d,v);if(!(+vo.l3vni>0))return;const vn=nodes[vrfKey(d,v)];if(!vn)return;const rd=rdFor(d,v);const rts=vo.rtExp?rtList(vo.rtExp):[`${asn}:${vo.l3vni}`];
      vn.best.forEach(p=>{if(p.imp)return;const k5=`[5][${rd}][${p.key}]`;m.set(k5,{...p,key:k5,pfx:p.key,type:5,rd,rts,vni:+vo.l3vni,vtep:vt,local:true,from:null,oid:undefined,eg:{dev:d.id,vrf:v},fam:'evpn'})})});return m};
  const imports=n=>{const m=new Map();const d=n.d,vo=vrfObj(d,n.vrf);if(!vo)return m;const imp=rtList(vo.rtImp);
    const add=(p,fam)=>{const ex=m.get(p.pfx);const q={c:p.c,key:p.pfx,asPath:p.asPath.slice(),lp:p.lp,origin:p.origin,med:p.med||0,comm:(p.comm||[]).slice(),nh:p.nh,from:p.from,ebgp:false,local:false,imp:{fam,label:p.label,vni:p.vni,rd:p.rd,eg:p.eg}};if(!ex||bgpBetter(q,ex)<0)m.set(p.pfx,q)};
    const vp=nodes[d.id+'#vpnv4'];if(vp&&imp.length)vp.best.forEach(p=>{if(!p.eg||p.eg.dev===d.id||!rtHit(p.rts,imp))return;add(p,'vpnv4')});
    const ev=nodes[d.id+'#evpn'];if(ev&&+vo.l3vni>0)ev.best.forEach(p=>{if(p.type!==5||!p.eg||p.eg.dev===d.id)return;if(imp.length?!rtHit(p.rts,imp):+p.vni!==+vo.l3vni)return;add(p,'evpn')});return m};
  const all=()=>Object.values(nodes);all().forEach(decide);
  const sigOf=()=>all().map(n=>[...n.best.values()].map(p=>p.key+':'+(p.from?p.from.ip:'L')+':'+p.asPath.join('.')+':'+p.lp+':'+(p.comm||[]).join('.')).sort().join(',')).join('|');let last=sigOf();
  for(let round=0;round<40;round++){
    all().forEach(n=>{n.inp={};if(n.fam==='vpnv4')n.local=vpnLocal(n.d);if(n.fam==='evpn')n.local=evpnLocal(n.d)});
    all().forEach(n=>{if(n.fam==='v4'&&n.vrf&&vrfVpn(n.d,n.vrf))n.inp['#imp']=imports(n)});
    sess.forEach(({d,vrf,st})=>st.fams.forEach(fam=>{const sn=nodes[nk(d,vrf,fam)],rn=nodes[nk(st.pd,st.pvrf,fam)];if(!sn||!rn)return;const m=new Map();
      const fin=q=>{if(!st.nb.sc){q.comm=[];if(fam!=='v4')q.rts=[]}q.rrc=!!st.back.rrc;if(fam==='v4'&&st.back.rmIn){q=rmApply(st.pd,st.back.rmIn,q);if(!q)return}m.set(q.key,q)};
      const send=p=>{if(p.from&&!p.ebgp&&!st.ebgp&&!(p.rrc||st.nb.rrc))return;if(p.from&&p.from.dev===st.pd.id)return;if(!st.ebgp&&p.oid===st.pd.id)return;if(st.ebgp&&p.asPath.includes(+st.pd.bgp.asn))return;
        const cm=p.comm||[];if(cm.includes('no-advertise'))return;if(st.ebgp&&(cm.includes('no-export')||cm.includes('local-as')))return;
        let q={...p,asPath:p.asPath.slice(),comm:cm.slice(),from:{dev:d.id,ip:st.local,name:d.name},ebgp:st.ebgp,local:false,rrc:false,oid:st.ebgp?undefined:(p.oid||d.id)};if(fam==='v4'){delete q.imp;delete q.how}
        if(fam==='v4'&&st.nb.rmOut){q=rmApply(d,st.nb.rmOut,q);if(!q)return}
        if(st.ebgp){q.asPath=[+d.bgp.asn,...q.asPath];q.lp=100;if(!p.local)q.med=0}
        q.nh=fam==='evpn'?(p.local?p.vtep:p.nh):((st.ebgp||p.local||st.nb.nhs)?st.local:p.nh);fin(q)};
      sn.best.forEach(send);
      if(fam==='v4'&&st.nb.dio){const c={ip:0,len:0,mask:0,net:0};fin({c,key:'0.0.0.0/0',asPath:st.ebgp?[+d.bgp.asn]:[],lp:100,med:0,comm:[],origin:'i',nh:st.local,from:{dev:d.id,ip:st.local,name:d.name},ebgp:st.ebgp,local:false,oid:st.ebgp?undefined:d.id})}
      rn.inp[d.id+'|'+vrf+'|'+st.nb.ip]=m}));
    all().forEach(decide);const s=sigOf();if(s===last)break;last=s}
  sess.forEach(({d,vrf,st})=>{st.rcv=0;st.sent=0;st.rcvF={};st.sentF={}});
  sess.forEach(({d,vrf,st})=>st.fams.forEach(fam=>{const rn=nodes[nk(st.pd,st.pvrf,fam)];const m=rn&&rn.inp[d.id+'|'+vrf+'|'+st.nb.ip];const n=m?m.size:0;st.sent+=n;st.sentF[fam]=n;const back=(BSESS[st.pd.id]||[]).find(x=>x.nb===st.back);if(back){back.rcv+=n;back.rcvF=back.rcvF||{};back.rcvF[fam]=n}}));
  all().forEach(n=>{BGPT[n.k]={all:n.all||new Map(),best:n.best,fam:n.fam}});
  const fix=n=>{NB[n.k]=[...n.best.values()].map(p=>{if(p.local)return{...p};if(p.imp){const r=lookup(n.d,p.nh,{});return{...p,ifc:r&&r.ifc,via:r&&(r.src==='C'?p.nh:r.nh)}}const r=lookup(n.d,p.nh,{vrf:n.vrf,noBgp:true});return{...p,ifc:r&&r.ifc,via:r&&(r.src==='C'?p.nh:r.nh)}})};
  all().filter(n=>n.fam==='v4'&&!n.vrf).forEach(fix);BGP=NB;all().filter(n=>n.fam==='v4'&&n.vrf).forEach(fix);
  S.devices.forEach(d=>{if(!vxOn(d))return;const ev=nodes[d.id+'#evpn'];if(!ev)return;l2vnis(d).forEach(x=>{ev.best.forEach(p=>{if(p.type!==3||!p.eg||p.eg.dev===d.id)return;if(x.rt?!rtHit(p.rts,rtList(x.rt)):+p.vni!==+x.vni)return;const pd=dev(p.eg.dev);if(!pd||vxVlan(pd,p.vni)==null)return;
    const L=((EVX[d.id]=EVX[d.id]||{})[x.vni]=EVX[d.id][x.vni]||[]);if(!L.some(y=>y.dev===pd.id))L.push({dev:pd.id,ip:p.vtep,how:'evpn',vni:+p.vni})})})})}

function ruleMatch(r,p){if(r.proto!=='any'&&r.proto!==p.proto)return false;const s=pc(r.src||'any'),t=pc(r.dst||'any');if(!s||!t)return false;if(!inNet(p.src,s)||!inNet(p.dst,t))return false;if((r.proto==='tcp'||r.proto==='udp')&&r.port&&+r.port!==+p.port)return false;return true}
function ruleCheck(d,p){const rs=d.rules||[];if(d.type!=='fw'&&!rs.length)return{ok:true,silent:true};for(let i=0;i<rs.length;i++)if(ruleMatch(rs[i],p))return{ok:rs[i].act==='permit',rule:i+1};return{ok:false,implicit:true}}

/* ---------- simulação ---------- */
let SIMDEPTH=0;
function simulate(srcId,dstStr,proto='icmp',port=0,opt={}){if(!SIMDEPTH)computeOspf();SIMDEPTH++;try{if(SIMDEPTH===1&&!opt.noVpn)vpnStates();return simulate0(srcId,dstStr,proto,port,opt)}finally{SIMDEPTH--}}
function simulate0(srcId,dstStr,proto,port,opt){const R={ok:false,lines:[],f:[],r:[],hops:[]};const sd=dev(srcId),dst=ip2i(dstStr);
  if(!sd){R.lines.push('Origem inválida.');R.why='origem inválida';return R}if(dst===null){R.lines.push(`"${dstStr}" não é um IPv4 válido.`);R.why='destino inválido';return R}
  const ovrf=opt.vrf&&!isHost(sd.type)?(isMgmtVrfName(opt.vrf)?MGV:opt.vrf):'';
  if(ovrf&&ovrf!==MGV&&!vrfObj(sd,ovrf)){R.lines.push(`A VRF ${opt.vrf} não existe em ${sd.name}.`);R.why=`VRF ${opt.vrf} inexistente`;return R}
  const nat=[];
  function leg(start,src,t,reply,vrf0){let cur=start,s=src,first=true,vrf=vrf0,tun=null;const links=[];
    for(let ttl=0;ttl<64;ttl++){const d=dev(cur);
      if(tun&&l3ifs(d).some(f=>!f.mgmt&&!f.vrf&&f.c.ip===tun.end)){
        if(tun.eg&&tun.eg.vpn&&d.id===tun.eg.dev){R.lines.push(`   ${d.name}: decifra ${tun.kind==='wg'?'WireGuard':'IPsec'} (túnel ${tun.name})`);vrf='';tun=null}
        else{if(!tun.eg||d.id!==tun.eg.dev)return{ok:false,why:`${d.name}: chegou o pacote ${tun.kind==='mpls'?'com rótulo VPN '+tun.label:'VXLAN VNI '+tun.vni}, mas ele pertence a ${tun.eg?(dev(tun.eg.dev)||{}).name:'outro PE'} (next-hop alterado no caminho)`};
        if(!vrfObj(d,tun.eg.vrf))return{ok:false,why:`${d.name}: a VRF ${tun.eg.vrf} não existe mais neste equipamento`};
        R.lines.push(`   ${d.name}: ${tun.kind==='mpls'?`retira o rótulo VPN ${tun.label}`:`desencapsula VXLAN VNI ${tun.vni}`} → VRF ${tun.eg.vrf}`);vrf=tun.eg.vrf;tun=null}}
      if(reply&&!tun){const n=nat.find(n=>n.dev===cur&&n.pub===t);if(n){R.lines.push(`   ${d.name}: NAT reverso ${i2ip(n.pub)} → ${i2ip(n.priv)}`);t=n.priv;nat.splice(nat.indexOf(n),1)}}
      if(!tun&&!reply&&(d.dnat||[]).length){const m=d.dnat.find(r=>(r.proto||'tcp')===proto&&+r.port===+port&&ip2i(r.to)!==null&&l3ifs(d).some(f=>!f.mgmt&&f.c.ip===t));
        if(m){R.lines.push(`   ${d.name}: NAT de destino (port forward) ${i2ip(t)}:${port} → ${m.to}:${m.toPort||port}`);R.dnat={dev:d.id,ip:t,port};t=ip2i(m.to);port=+m.toPort||port}}
      if(reply&&!tun&&d.type==='cloud'&&d.cloud&&d.cloud.mode==='host'&&pc(d.cloud.lan||'')&&inNet(t,pc(d.cloud.lan))&&!labOwns(t))return{ok:true,at:cur,s,t,links,vrf:'',ext:true};
      if(!tun){const mine=l3ifs(d).find(f=>ownsIp(f,t)&&(isHost(d.type)?!(first&&!reply&&f.mgmt):(f.mgmt?vrf===MGV||(first&&!vrf):f.vrf===vrf)));
        if(mine)return{ok:true,at:cur,s,t,links,vrf:mine.mgmt?MGV:mine.vrf}}
      if(!first&&!fwd(d.type))return{ok:false,why:`${d.name} recebeu o pacote, mas não roteia (não é o destino)`};
      let rt;
      if(tun){rt=lookup(d,tun.end,{});if(!rt||rt.blackhole)return{ok:false,why:`${d.name}: sem rota para ${i2ip(tun.end)} (${tun.kind==='mpls'?'fim do LSP':'VTEP remoto'}) na tabela global`}}
      else{rt=lookup(d,t,{vrf,src:first?s:null,origin:first});
        if(!rt&&d.type==='cloud'){const ex=cloudExit(d,s,t,reply);if(ex){if(ex.err)return{ok:false,why:ex.err};R.lines.push(`   ${d.name}: ${ex.line}`);return{ok:true,at:cur,s,t,links,vrf:'',ext:true}}}
        if(!rt)return{ok:false,why:`${d.name}: sem rota para ${i2ip(t)}${vrf&&vrf!==MGV?' na VRF '+vrf:''}${!fwd(d.type)&&!d.gw?' (sem gateway padrão)':''}`};
        if(rt.blackhole)return{ok:false,why:`${d.name}: descartado pela rota ${rt.label} → Null0 (blackhole)`};
        if(rt.vpn){const kind=rt.vpn.fam==='evpn'?'vxlan':'mpls';tun={kind,end:rt.bgpNh,eg:rt.vpn.eg,label:rt.vpn.label,vni:rt.vpn.vni};
          if(s===null){const vi=ifsIn(d,vrf)[0];if(!vi)return{ok:false,why:`${d.name}: nenhuma interface com IP na VRF ${vrf} para usar como origem`};s=vi.c.ip}
          if(!first&&!reply){const rc=ruleCheck(d,{src:s,dst:t,proto,port});if(!rc.ok)return{ok:false,why:`${d.name}: bloqueado ${rc.implicit?'pelo deny implícito (nenhuma regra casou)':'pela regra #'+rc.rule}`}}
          R.lines.push(`   ${d.name}: [B ${rt.label} vrf ${vrf}] ${kind==='mpls'?`empilha rótulo VPN ${tun.label}`:`encapsula em VXLAN VNI ${tun.vni}`} → ${(dev(tun.eg&&tun.eg.dev)||{}).name||'?'} (${i2ip(tun.end)})`);
          const rt2=lookup(d,tun.end,{});if(!rt2||rt2.blackhole)return{ok:false,why:`${d.name}: sem rota na tabela global para o next-hop ${i2ip(tun.end)} (${kind==='mpls'?'PE remoto':'VTEP remoto'})`};rt=rt2}}
      if(s===null)s=rt.ifc.c.ip;
      if(!tun&&!first&&!reply){const rc=ruleCheck(d,{src:s,dst:t,proto,port});if(!rc.ok)return{ok:false,why:`${d.name}: bloqueado ${rc.implicit?'pelo deny implícito (nenhuma regra casou)':'pela regra #'+rc.rule}`};
        if(rc.rule){const h=HITS[d.id]||(HITS[d.id]=[]);h[rc.rule-1]=(h[rc.rule-1]||0)+1}if(!rc.silent)R.lines.push(`   ${d.name}: permitido pela regra #${rc.rule}`)}
      if(!tun&&!opt.noVpn){const m=vpnMatch(d,s,t);if(m){if(first&&!reply&&m.t.addr&&pc(m.t.addr))s=pc(m.t.addr).ip;tun={kind:m.t.kind==='wireguard'?'wg':'ipsec',end:m.peerIp,eg:{dev:m.pd.id,vrf:'',vpn:true},name:m.t.name};R.lines.push(`   ${d.name}: ${tun.kind==='wg'?'WireGuard':'IPsec ESP'} (túnel ${m.t.name}) cifra ${i2ip(s)} → ${i2ip(t)} e envia para ${m.t.peer}`);const rt2=lookup(d,tun.end,{});if(!rt2||rt2.blackhole)return{ok:false,why:`${d.name}: sem rota para o peer VPN ${m.t.peer}`};rt=rt2}}
      if(!tun&&!first&&!reply&&rt.ifc.nat){nat.push({dev:cur,pub:rt.ifc.c.ip,priv:s});const nt=NATT[cur]||(NATT[cur]=[]);nt.unshift({proto,port,inLocal:s,inGlobal:rt.ifc.c.ip,out:t});if(nt.length>30)nt.pop();R.lines.push(`   ${d.name}: NAT de origem ${i2ip(s)} → ${i2ip(rt.ifc.c.ip)}`);s=rt.ifc.c.ip}
      const r=l2Reach(cur,rt.ifc);const epOk=ep=>{if(ep.dev===cur&&ep.key===rt.ifc.key)return false;const f=getIf(dev(ep.dev),ep.key);return f&&(ownsIp(f,rt.nh)||(f.parp&&f.parp.includes(rt.nh))||(f.parpLan&&inNet(rt.nh,f.parpLan)&&!labOwns(rt.nh)))};const ep=r.eps.find(ep=>epOk(ep)&&dev(ep.dev).type!=='cloud')||r.eps.find(epOk);
      if(!ep)return{ok:false,why:`${d.name}: ARP para ${i2ip(rt.nh)} sem resposta (saída ${ifName(d,rt.ifc)})`,drops:r.drops};
      const nd=dev(ep.dev),nf=getIf(nd,ep.key);let tag='';
      if(tun&&tun.kind==='mpls'){if(!rt.ifc.mpls||!nf.mpls)return{ok:false,why:`LSP quebrado entre ${d.name} e ${nd.name}: MPLS/LDP não está habilitado em ${!rt.ifc.mpls?d.name+' '+ifName(d,rt.ifc):nd.name+' '+ifName(nd,nf)} — o pacote rotulado é descartado`};
        if(!ldpOk(d,rt.ifc,nd,nf))return{ok:false,why:`LSP quebrado: a sessão LDP ${d.name} ↔ ${nd.name} não sobe (LSR-ID ${i2ip(ldpRid(nd))} sem rota)`};
        const own=l3ifs(nd).some(f=>!f.mgmt&&!f.vrf&&f.c.ip===tun.end);tag=` | MPLS ${own?'pop (PHP)':ldpLabel(nd,tun.end)}/${tun.label}`}
      else if(tun)tag=tun.kind==='ipsec'?' | ESP':tun.kind==='wg'?' | WireGuard':` | VXLAN VNI ${tun.vni}`;
      const vtag=!tun&&rt.ifc.vrf&&!rt.ifc.mgmt?` vrf ${rt.ifc.vrf}`:'';
      if(ep.vxh&&ep.vxh.length)R.lines.push(`   ${ep.vxh.join(', ')} (quadro L2 estendido pelo underlay)`);R.lines.push(` ${d.name} ${ifName(d,rt.ifc)} → ${nd.name} ${ifName(nd,nf)}   [${rt.src} ${rt.label} via ${i2ip(rt.nh)}${rt.bgpNh!=null&&rt.bgpNh!==rt.nh?' (BGP next-hop '+i2ip(rt.bgpNh)+')':''}${nf.vip===rt.nh?' (VRRP)':''}${vtag}${tag}]`);
      if(!reply)R.hops.push({name:nd.name,ip:i2ip(rt.nh),mpls:tun&&tun.kind==='mpls'?tag.replace(/^ \| MPLS /,''):null});
      links.push(...ep.path);cur=ep.dev;first=false;vrf=isHost(nd.type)?'':(nf.mgmt?MGV:nf.vrf)}
    return{ok:false,why:'TTL esgotado — provável loop de roteamento'}}
  R.lines.push(`→ ${proto.toUpperCase()}${proto!=='icmp'?'/'+port:''} de ${sd.name}${ovrf?' (vrf '+vrfLabel(ovrf)+')':''} para ${i2ip(dst)}`);
  const a=leg(srcId,opt.srcIp?ip2i(opt.srcIp):null,dst,false,ovrf);
  if(!a.ok){R.lines.push(`✕ ${a.why}`);(a.drops||[]).forEach(x=>R.lines.push(`   · ${x}`));R.why=a.why;return R}
  R.srcAtDst=a.s;R.at=a.at;R.dstIp=a.t;
  if(!a.ext&&!opt.noAccept){const acc=hostAccept(dev(a.at),proto,port,a.t,a.s);if(!acc.ok){R.f=a.links;R.lines.push(`✕ ${acc.why}`);R.why=acc.why;R.refused=true;return R}if(acc.svc)R.svc=acc.svc}
  R.f=a.links;R.ext=!!a.ext;R.lines.push(a.ext?`← resposta da Internet (fora do lab, ${i2ip(a.t)}) para ${i2ip(a.s)}`:`← resposta de ${dev(a.at).name} (${i2ip(a.t)}) para ${i2ip(a.s)}`);
  const b=leg(a.at,a.t,a.s,true,a.vrf);
  if(!b.ok){R.lines.push(`✕ ${b.why}`);(b.drops||[]).forEach(x=>R.lines.push(`   · ${x}`));R.why='o pacote chegou, mas a resposta não voltou: '+b.why;return R}
  R.r=b.links;R.ok=true;return R}

/* ---------- diagnóstico ---------- */
function lint(){const out=[],seen={};
  S.devices.forEach(d=>{if(d.type==='chassis')return;l3ifs(d,true).forEach(f=>{if(f.agw||(f.vrf&&f.vrf!==MGV))return;(seen[f.c.ip]=seen[f.c.ip]||[]).push({f,n:`${d.name} ${ifName(d,f)}`})});
    if(isHost(d.type)){const ifs=l3ifs(d,true).filter(f=>!f.mgmt);if(!ifs.length)out.push(['warn',`${d.name}: sem endereço IP`]);else if(!d.gw)out.push(['warn',`${d.name}: sem gateway padrão — só alcança as próprias sub-redes`]);else{const g=ip2i(d.gw);if(g===null||!ifs.some(f=>inNet(g,f.c)))out.push(['bad',`${d.name}: gateway ${d.gw} fora das sub-redes do servidor`])}}
    d.ports.forEach((p,k)=>{if(isMgmt(d,k)&&p.gw&&pc(p.ip)&&!inNet(ip2i(p.gw)??0,pc(p.ip)))out.push(['bad',`${d.name} ${spn(d,k)}: gateway de gerência ${p.gw} fora da sub-rede`])});
    if(isSw(d.type))d.ports.forEach((p,k)=>{if(p.mode==='access'&&+p.vlan!==1&&!d.vlans.some(v=>+v.id===+p.vlan))out.push(['bad',`${d.name} ${spn(d,k)}: VLAN ${p.vlan} atribuída, mas não criada`])});
    (d.svis||[]).forEach(s=>{if(+s.vlan!==1&&!d.vlans.some(v=>+v.id===+s.vlan))out.push(['bad',`${d.name}: SVI Vlan${s.vlan} sem a VLAN ${s.vlan} criada`])});
    const lags=[...new Set(d.ports.map(p=>+p.lag).filter(Boolean))];lags.forEach(n=>{const ms=lagMembers(d,n),a=d.ports[ms[0]];
      if(ms.some(k=>{const p=d.ports[k];return p.mode!==a.mode||+p.vlan!==+a.vlan||String(p.allowed)!==String(a.allowed)}))out.push(['warn',`${d.name} ${lagShort(d,n)}: membros com configuração diferente`]);
      ms.forEach(k=>{const L=linkAt(d.id,k);if(L){const pd=dev(L.peer);if(pd&&pd.type!=='chassis'&&!+pd.ports[L.peerK].lag)out.push(['warn',`${d.name} ${spn(d,k)} está no ${lagShort(d,n)}, mas ${pd.name} ${spn(pd,L.peerK)} não está em agregação (LACP de um lado só)`])}})});
    if(!linkCount(d)&&!d.parent)out.push(['info',`${d.name}: sem nenhuma conexão`]);
    (d.routes||[]).forEach(r=>{if(isNull(r.nh)&&pc(r.dst))return;const nh=ip2i(r.nh);if(nh===null||!pc(r.dst))out.push(['bad',`${d.name}: rota estática inválida (${r.dst} via ${r.nh})`]);else if(!l3ifs(d).some(f=>!f.mgmt&&f.vrf===(r.vrf||'')&&inNet(nh,f.c)))out.push(['bad',`${d.name}: próximo salto ${r.nh} não está em nenhuma rede conectada${r.vrf?' da VRF '+r.vrf:''}`])})});
  Object.entries(seen).forEach(([ip,a])=>{if(a.length<2)return;const fs=a.map(x=>x.f);const clash=fs.some((f,i)=>fs.some((g,j)=>j>i&&(f.kind==='loop'||g.kind==='loop'?f.kind===g.kind&&f.dev!==g.dev&&ospfCfg(dev(f.dev),'')&&ospfCfg(dev(g.dev),''):l2Reach(f.dev,f).eps.some(ep=>ep.dev===g.dev&&ep.key===g.key))));
    out.push(clash?['bad',`IP duplicado ${i2ip(+ip)}: ${a.map(x=>x.n).join(', ')}`]:['info',`IP ${i2ip(+ip)} repetido em redes isoladas (${a.map(x=>x.n).join(', ')}) — normal entre clientes de VPNs diferentes`])});
  S.links.forEach(l=>{const A=dev(l.a.dev),B=dev(l.b.dev);if(!A||!B)return;const pa=A.ports[l.a.k],pb=B.ports[l.b.k],na=`${A.name} ${spn(A,l.a.k)}`,nb=`${B.name} ${spn(B,l.b.k)}`;
    if(isSw(A.type)&&isSw(B.type)&&pa.mode!=='routed'&&pb.mode!=='routed'){if(pa.mode!==pb.mode)out.push(['bad',`Modo divergente: ${na} é ${pa.mode} e ${nb} é ${pb.mode}`]);else if(pa.mode==='access'&&+pa.vlan!==+pb.vlan)out.push(['warn',`VLAN divergente: ${na} (VLAN ${pa.vlan}) ↔ ${nb} (VLAN ${pb.vlan})`]);else if(pa.mode==='trunk'&&(+pa.native||1)!==(+pb.native||1))out.push(['warn',`Native VLAN divergente entre ${na} e ${nb}`])}
    const sa=portSpeed(A,l.a.k),sb=portSpeed(B,l.b.k);const okSp={'10G|25G':1,'25G|10G':1,'40G|100G':1,'100G|40G':1,'1G|10G':1,'10G|1G':1};if(modelOf(A)&&modelOf(B)&&sa!==sb&&!okSp[sa+'|'+sb])out.push(['info',`Velocidades diferentes no enlace ${na} (${sa}) ↔ ${nb} (${sb}) — não há óptica comum; use breakout ou outra porta`]);
    if(pa.shut||pb.shut)out.push(['info',`Enlace ${na} ↔ ${nb} com porta em shutdown`])});
  (S.racks||[]).forEach(r=>{const w=S.devices.filter(d=>d.rack===r.id).reduce((a,d)=>a+wattsOf(d),0);if(r.kw&&w>r.kw*1000)out.push(['warn',`Rack ${r.name}: consumo estimado ${(w/1000).toFixed(1)} kW passa do orçamento de ${r.kw} kW`])});
  computeOspf();S.devices.forEach(d=>{if(!fwd(d.type))return;const vs=new Set(vrfList(d));const bad=n=>n&&!vs.has(n);
    d.ports.forEach((p,k)=>{if(bad(p.vrf))out.push(['bad',`${d.name} ${spn(d,k)}: VRF ${p.vrf} não existe`]);(p.subs||[]).forEach(x=>{if(bad(x.vrf))out.push(['bad',`${d.name} ${spn(d,k)}.${x.vlan}: VRF ${x.vrf} não existe`])})});
    (d.svis||[]).forEach(x=>{if(bad(x.vrf))out.push(['bad',`${d.name} Vlan${x.vlan}: VRF ${x.vrf} não existe`])});
    const rmN=new Set((d.rmaps||[]).map(x=>x.name)),plN=new Set((d.pfx||[]).map(x=>x.name)),clN=new Set((d.clists||[]).map(x=>x.name));
    (d.rmaps||[]).forEach(m=>(m.rules||[]).forEach(r=>{if(r.mPfx&&!plN.has(r.mPfx))out.push(['bad',`${d.name}: route-map ${m.name} usa a prefix-list ${r.mPfx}, que não existe`]);if(r.mComm&&!clN.has(r.mComm))out.push(['bad',`${d.name}: route-map ${m.name} usa a community-list ${r.mComm}, que não existe`])}));
    if(d.bgp){(d.bgp.neighbors||[]).forEach(n=>{['rmIn','rmOut'].forEach(k=>{if(n[k]&&!rmN.has(n[k]))out.push(['bad',`${d.name}: vizinho ${n.ip} usa a route-map ${n[k]}, que não existe (tudo é negado)`])});
        if((n.vpnv4||n.evpn)&&!n.sc)out.push(['warn',`${d.name}: vizinho ${n.ip} em ${n.vpnv4?'VPNv4':'EVPN'} sem send-community extended — os route-targets não são enviados e o outro lado não importa nada`])});
      (d.bgp.redist||[]).forEach(r=>{if(r.rm&&!rmN.has(r.rm))out.push(['bad',`${d.name}: redistribute ${r.src} usa a route-map ${r.rm}, que não existe`])})}
    (d.vrfs||[]).forEach(v=>{if(+v.l3vni>0&&!vxOn(d))out.push(['warn',`${d.name}: VRF ${v.name} tem L3VNI ${v.l3vni}, mas o equipamento não tem VXLAN configurado`]);if(v.rtImp&&!rtList(v.rtImp).length)out.push(['bad',`${d.name}: route-target de importação inválido na VRF ${v.name} (use ASN:nn)`])});
    if(vxOn(d)){if(vtepIp(d)===null)out.push(['bad',`${d.name}: VXLAN sem VTEP — a loopback ${d.vxlan.src} não existe ou está sem IP`]);
      l2vnis(d).forEach(x=>{if(+x.vlan!==1&&!d.vlans.some(v=>+v.id===+x.vlan))out.push(['bad',`${d.name}: VNI ${x.vni} mapeada na VLAN ${x.vlan}, que não existe`]);
        else if(!((EVX[d.id]||{})[x.vni]||[]).length)out.push(['info',`${d.name}: VNI ${x.vni} sem nenhum VTEP remoto (EVPN tipo 3 não recebida nem peer estático)`])})}
    ldpNbrs(d).forEach(n=>{if(!n.up)out.push(['warn',`${d.name}: sessão LDP com ${n.pd.name} não sobe — sem rota para o LSR-ID ${i2ip(n.rid)}`])});
    l3ifs(d).filter(f=>f.mpls&&!f.vrf).forEach(f=>{if(!l2Reach(d.id,f).eps.some(ep=>{const pf=getIf(dev(ep.dev),ep.key);return ep.dev!==d.id&&pf&&pf.mpls}))out.push(['warn',`${d.name} ${ifName(d,f)}: MPLS habilitado, mas o vizinho não tem MPLS nessa interface (sem LDP)`])});
    (BSESS[d.id]||[]).forEach(st=>{if(st.state!=='Established')out.push(['warn',`${d.name}: sessão BGP com ${st.nb.ip}${st.vrf?' (vrf '+st.vrf+')':''} em ${st.state} — ${st.why||'sem resposta'}`])})});
  try{vpnLint(out);S.devices.filter(isCluster).forEach(c=>k8sNodes(c).forEach(n=>{const r=nodeReady(c,n);if(!r.ok)out.push(['warn',`${c.name}: nó ${n.name} NotReady — ${r.why}`])}))}catch(e){}
  return out}

/* ---------- chassis blade ---------- */
function bladeSlots(ch){return S.devices.filter(d=>d.parent===ch.id&&modelOf(d)&&modelOf(d).form==='blade')}
function placeMembers(ch){const m=modelOf(ch);if(!m)return;const cols=m.k8s?Math.min(5,(m.cp||1)+(m.workers||0)):Math.min(6,Math.ceil(m.bays/2));const ioms=S.devices.filter(d=>d.parent===ch.id&&modelOf(d)?.form==='iom');
  ioms.forEach((d,i)=>{d.x=ch.x+70+i*Math.max(200,(cols-1)*100);d.y=ch.y+40});
  const gx=ch.k8s?124:100;bladeSlots(ch).forEach(d=>{const s=+d.slot-1,r=Math.floor(s/cols),c=s%cols;d.x=ch.x+20+c*gx;d.y=ch.y+170+r*110})}
function addBlade(ch,slot){const m=modelOf(ch);if(!m)return null;const used=new Set(bladeSlots(ch).map(d=>+d.slot));if(!slot){slot=1;while(used.has(slot))slot++}if(slot>m.bays||used.has(slot))return null;
  const b=mkDev('srv',`${ch.name}-B${slot}`,0,0,{model:m.blade,parent:ch.id,slot});
  const ioms=S.devices.filter(d=>d.parent===ch.id&&modelOf(d)?.form==='iom');
  ioms.forEach((io,i)=>{const ik=io.ports.findIndex((p,k)=>isInternal(io,k)&&k===slot-1);if(ik>=0&&b.ports[i]&&!isMgmt(b,i))S.links.push({id:uid('l'),a:{dev:b.id,k:i},b:{dev:io.id,k:ik},internal:true})});
  placeMembers(ch);return b}
function addChassis(modelId,name,x,y,fill){const m=CAT.BY[modelId];const ch=mkDev('chassis',name,x,y,{model:modelId});
  (m.ioms||[]).forEach(lbl=>mkDev(CAT.BY[m.iom].type,`${name}-${lbl}`,0,0,{model:m.iom,parent:ch.id,slot:lbl}));
  const n=fill===undefined?Math.min(m.bays,4):fill;for(let i=1;i<=n;i++)addBlade(ch,i);placeMembers(ch);return ch}
const membersOf=ch=>S.devices.filter(d=>d.parent===ch.id);

/* ---------- racks ---------- */
function addRack(name,u,kw){S.racks=S.racks||[];const r={id:uid('r'),name:name||`R${String(S.racks.length+1).padStart(2,'0')}`,u:u||42,kw:kw||8};S.racks.push(r);return r}
function rackFree(r,ru,u,exceptId){if(ru<1||ru+u-1>r.u)return false;return!S.devices.some(d=>d.rack===r.id&&d.id!==exceptId&&unitsOf(d)>0&&!(ru+u-1<d.ru||ru>d.ru+unitsOf(d)-1))}
function rackPlace(d,r,ru){const u=unitsOf(d);if(!u)return'Este equipamento não ocupa U de rack.';if(!ru){for(let x=r.u-u+1;x>=1;x--)if(rackFree(r,x,u,d.id)){ru=x;break}}if(!ru||!rackFree(r,ru,u,d.id))return`Não há ${u}U livres nessa posição do rack ${r.name}.`;d.rack=r.id;d.ru=ru;return null}
function rackPower(r){return S.devices.filter(d=>d.rack===r.id).reduce((a,d)=>a+wattsOf(d),0)}
