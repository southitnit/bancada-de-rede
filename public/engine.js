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

/* ---------- exportadores ---------- */
const vname=v=>String(v.name||('VLAN'+v.id)).replace(/[^\w-]/g,'_');
function usedPort(d,k){const p=d.ports[k];return!!linkAt(d.id,k)||p.mode!==(isSw(d.type)?'access':'routed')||+p.vlan!==1||!!p.desc||p.shut||!!p.ip||(p.subs||[]).length>0||+p.lag>0}
const anyNat=d=>fwd(d.type)&&l3ifs(d,true).some(f=>f.nat);
const aclOn=d=>fwd(d.type)&&(d.type==='fw'||(d.rules||[]).length>0);
const rp=r=>(r.proto==='tcp'||r.proto==='udp')&&r.port;
const isAny=a=>{const c=pc(a||'any');return!c||c.len===0};
const today=()=>new Date().toISOString().slice(0,10);
const mdesc=d=>{const m=modelOf(d);return m?`${m.vendor} ${m.name}`:TYPES[d.type].label};
const hdr=(d,v,c)=>[`${c} ${d.name} — ${mdesc(d)} — ${VN[v]}`,`${c} Gerado pela Bancada de Rede em ${today()}. Revise antes de aplicar em produção.`];
const vrid=v=>((+v%255)||1);
/* interfaces lógicas: portas soltas e LAGs (com os membros), sem as de gerência */
function lports(d){const out=[],seen=new Set();d.ports.forEach((p,k)=>{if(isMgmt(d,k))return;
  if(+p.lag){if(seen.has(+p.lag))return;seen.add(+p.lag);const ms=lagMembers(d,p.lag);out.push({k:ms[0],p:d.ports[ms[0]],lag:+p.lag,members:ms})}
  else if(usedPort(d,k))out.push({k,p,lag:0,members:null})});return out}
const mgmtPorts=d=>d.ports.map((p,k)=>({p,k})).filter(x=>isMgmt(d,x.k)&&pc(x.p.ip));
const lagCount=d=>new Set(d.ports.map(p=>+p.lag).filter(Boolean)).size;
const ospfIfs=d=>l3ifs(d,true).filter(f=>!f.mgmt&&f.vrf==='');
const dvrfs=d=>fwd(d.type)?(d.vrfs||[]):[];
const vIfs=(d,v)=>l3ifs(d,true).filter(f=>!f.mgmt&&f.vrf===v);
const vRoutes=(d,v)=>routesIn(d,v).filter(r=>pc(r.dst)&&(ip2i(r.nh)!==null||isNull(r.nh)));
const vrfIdx=(d,n)=>dvrfs(d).findIndex(x=>x.name===n);
const ospfPid=(d,v)=>v?10+vrfIdx(d,v):1;
const ovrfs=d=>dvrfs(d).map(x=>({v:x.name,x,cfg:x.ospf&&x.ospf.on?x.ospf:null,pid:ospfPid(d,x.name)})).filter(o=>o.cfg);
const NBD={desc:'',dio:false,nhs:false,shut:false,us:'',mh:false,rrc:false,sc:false,vpnv4:false,evpn:false,noV4:false,rmIn:'',rmOut:''};
function bgpV(d){if(!bgpOn(d))return null;const b=d.bgp;const vs=['',...dvrfs(d).map(x=>x.name)];
  const g=vs.map(v=>({vrf:v,nb:(b.neighbors||[]).filter(n=>(n.vrf||'')===v&&ip2i(n.ip)!==null&&+n.ras>0).map(n=>({...NBD,...n,noV4:v?false:!!n.noV4,vpnv4:v?false:!!n.vpnv4,evpn:v?false:!!n.evpn})),
    net:(b.networks||[]).filter(n=>(n.vrf||'')===v).map(n=>pc(n.pfx)).filter(Boolean),neto:(b.networks||[]).filter(n=>(n.vrf||'')===v&&pc(n.pfx)).map(n=>({c:pc(n.pfx),rm:n.rm||''})),
    rd:(b.redist||[]).filter(r=>(r.vrf||'')===v).map(r=>r.src),rdo:(b.redist||[]).filter(r=>(r.vrf||'')===v).map(r=>({src:r.src,rm:r.rm||''}))}))
    .filter(x=>!x.vrf||x.nb.length||x.net.length||x.rd.length||vrfVpn(d,x.vrf));
  const g0=g[0];return{asn:+b.asn,rid:ip2i(b.rid)!==null?b.rid:'',groups:g,noV4:g0.nb.some(n=>n.noV4),vpn:g0.nb.filter(n=>n.vpnv4),ev:g0.nb.filter(n=>n.evpn)}}
const isEbgp=(b,n)=>+n.ras!==+b.asn;
const rdOf=(d,v,b)=>{const x=vrfObj(d,v);return(x&&x.rd)||`${b?b.asn:65000}:${vrfIdx(d,v)+1}`};
const GEN={};
/* recursos novos, comuns a todos os sistemas */
const dLoops=d=>fwd(d.type)?(d.loops||[]).filter(l=>pc(l.ip)).map(l=>({...l,c:pc(l.ip),f:l3ifs(d,true).find(f=>f.kind==='loop'&&f.id===+l.id)})):[];
const rtI=x=>rtList(x&&x.rtImp),rtE=x=>rtList(x&&x.rtExp);
const vxD=d=>vxOn(d)?d.vxlan:null;
const l3v=d=>dvrfs(d).filter(x=>+x.l3vni>0);
const coreVlan=(d,x)=>3900+Math.max(0,vrfIdx(d,x.name));
const vtepPeers=x=>String(x.peers||'').split(/[\s,]+/).filter(p=>ip2i(p)!==null);
const allPeers=d=>{const s=new Set();l2vnis(d).forEach(x=>vtepPeers(x).forEach(p=>s.add(p)));Object.values(EVX[d.id]||{}).forEach(ps=>ps.forEach(p=>s.add(i2ip(p.ip))));return[...s]};
const mplsIfs=d=>l3ifs(d,true).filter(f=>f.mpls&&!f.vrf);
const hasPol=d=>fwd(d.type)&&((d.pfx||[]).length||(d.clists||[]).length||(d.rmaps||[]).length);
const usOf=(v,n)=>hasUs(n)?loName(v,n.us):'';
const evRt=(d,x)=>x.rt||'';
function polCF(d,v){const L=[],I={cisco:' ',nxos:'  ',eos:'   ',os10:' ',aoscx:'     '}[v]||' ';
  (d.pfx||[]).forEach(p=>seqd(p.rules).forEach(r=>L.push(`ip prefix-list ${p.name} seq ${r.seq} ${r.act} ${r.pfx}${r.ge?' ge '+r.ge:''}${r.le?' le '+r.le:''}`)));
  (d.clists||[]).forEach(c=>(c.rules||[]).forEach((r,i)=>L.push(v==='eos'?`ip community-list ${c.name} ${r.act} ${r.comm}`:v==='aoscx'?`ip community-list ${c.name} seq ${10*(i+1)} ${r.act} ${r.comm}`:v==='nxos'?`ip community-list standard ${c.name} seq ${10*(i+1)} ${r.act} ${r.comm}`:`ip community-list standard ${c.name} ${r.act} ${r.comm}`)));
  (d.rmaps||[]).forEach(m=>seqd(m.rules).forEach(r=>{L.push(v==='aoscx'?`route-map ${m.name} ${r.act} seq ${r.seq}`:`route-map ${m.name} ${r.act} ${r.seq}`);
    if(r.mPfx)L.push(`${I}match ip address prefix-list ${r.mPfx}`);if(r.mComm)L.push(`${I}match community ${r.mComm}`);
    if(r.sLp!==''&&r.sLp!=null)L.push(`${I}set local-preference ${r.sLp}`);if(r.sMed!==''&&r.sMed!=null)L.push(`${I}set metric ${r.sMed}`);if(r.sComm)L.push(`${I}set community ${r.sComm}${r.sAdd?' additive':''}`);if(r.sPre)L.push(`${I}set as-path prepend ${r.sPre}`)}));
  if(L.length)L.push('!');return L}

/* ---- família Cisco: IOS/IOS-XE, NX-OS, EOS, Dell OS10 ---- */
function genCF(d,v){const L=hdr(d,v,'!'),sw=isSw(d.type),nat=anyNat(d),acl=aclOn(d),I={cisco:' ',nxos:'  ',eos:'   ',os10:' '}[v];
  const ipA=c=>v==='cisco'?`ip address ${i2ip(c.ip)} ${msk(c)}`:`ip address ${cidrStr(c)}`;
  const area=`0.0.0.${d.ospf?.area||0}`,ospf=fwd(d.type)&&d.ospf?.on;
  const hasVip=l3ifs(d,true).some(f=>f.vip!=null);
  L.push('!');
  const B=bgpV(d),VR=dvrfs(d),OV=ovrfs(d),MP=mplsIfs(d).length>0,VX=vxD(d),LO=dLoops(d),AGW=(d.svis||[]).some(s=>s.agw&&pc(s.ip));
  const lo0=LO.find(l=>!l.vrf);
  if(v==='nxos'){if(d.svis.length||l3v(d).length)L.push('feature interface-vlan');if(lagCount(d))L.push('feature lacp');if(ospf||OV.length)L.push('feature ospf');if(B)L.push('feature bgp');if(hasVip)L.push('feature vrrp');
    if(MP)L.push('install feature-set mpls','feature-set mpls','feature mpls ldp');if(B&&B.vpn.length)L.push('feature mpls l3vpn');if(VX)L.push('feature nv overlay','feature vn-segment-vlan-based','nv overlay evpn');if(AGW)L.push('feature fabric forwarding');L.push('!')}
  L.push(`hostname ${d.name}`,'!');
  if((v==='cisco'&&d.type==='sw3')||(v==='eos'&&fwd(d.type)))L.push('ip routing','!');
  if(MP){if(v==='cisco')L.push('mpls label protocol ldp',...(lo0?[`mpls ldp router-id ${loName('cisco',lo0.id)} force`]:[]),'!');if(v==='eos')L.push('mpls ip','!');if(v==='os10')L.push('! MPLS/LDP: o Dell OS10 não implementa MPLS; use outro sistema para este equipamento','!')}
  if(AGW){if(v==='nxos')L.push('fabric forwarding anycast-gateway-mac 2020.0000.00aa','!');if(v==='eos')L.push('ip virtual-router mac-address 00:1c:73:00:00:99','!');if(v==='os10')L.push('ip virtual-router mac-address 00:01:01:01:01:01','!')}
  if(v==='cisco'&&((d.clists||[]).length||(d.rmaps||[]).some(m=>m.rules.some(r=>r.sComm))))L.push('ip bgp-community new-format','!');
  const mg=mgmtPorts(d);if(v==='eos'&&mg.length)L.push('vrf instance MGMT','!');
  VR.forEach(x=>{const im=rtI(x),ex=rtE(x),l3=+x.l3vni>0;
    if(v==='cisco'){L.push(`vrf definition ${x.name}`,...(x.rd||B?[` rd ${rdOf(d,x.name,B)}`]:[]),' address-family ipv4');ex.forEach(r=>L.push(`  route-target export ${r}`));im.forEach(r=>L.push(`  route-target import ${r}`));if(l3){(ex.length?ex:[`${B?B.asn:65000}:${x.l3vni}`]).forEach(r=>L.push(`  route-target export ${r} stitching`));(im.length?im:[`${B?B.asn:65000}:${x.l3vni}`]).forEach(r=>L.push(`  route-target import ${r} stitching`))}L.push(' exit-address-family','!')}
    if(v==='nxos'){L.push(`vrf context ${x.name}`);if(l3)L.push(`  vni ${x.l3vni}`);if(x.rd)L.push(`  rd ${x.rd}`);else if(l3||im.length||ex.length)L.push('  rd auto');vRoutes(d,x.name).forEach(r=>L.push(`  ip route ${netStr(pc(r.dst))} ${r.nh}`));L.push('  address-family ipv4 unicast');
      ex.forEach(r=>L.push(`    route-target export ${r}`));im.forEach(r=>L.push(`    route-target import ${r}`));if(l3){if(!im.length&&!ex.length)L.push('    route-target both auto evpn');else{ex.forEach(r=>L.push(`    route-target export ${r} evpn`));im.forEach(r=>L.push(`    route-target import ${r} evpn`))}}L.push('!')}
    if(v==='eos')L.push(`vrf instance ${x.name}`,'!',`ip routing vrf ${x.name}`,'!');
    if(v==='os10')L.push(`ip vrf ${x.name}`,'!')});
  const vrfL=n=>n?[{cisco:` vrf forwarding ${n}`,nxos:`  vrf member ${n}`,eos:`   vrf ${n}`,os10:` ip vrf forwarding ${n}`}[v]]:[];
  if(sw&&v!=='os10'){(d.vlans||[]).forEach(x=>{L.push(`vlan ${x.id}`,`${I}name ${vname(x)}`);const vx=v==='nxos'&&VX&&VX.vnis.find(y=>+y.vlan===+x.id);if(vx)L.push(`${I}vn-segment ${vx.vni}`);L.push('!')});
    if(v==='nxos'&&VX)l3v(d).forEach(x=>{if(!(d.vlans||[]).some(y=>+y.id===coreVlan(d,x)))L.push(`vlan ${coreVlan(d,x)}`,`${I}name L3VNI-${x.name}`,`${I}vn-segment ${x.l3vni}`,'!')})}
  L.push(...polCF(d,v));
  const aA=a=>{if(isAny(a))return'any';const c=pc(a);if(v==='cisco')return c.len===32?`host ${i2ip(c.ip)}`:`${i2ip(c.net)} ${wc(c)}`;if(v==='eos'&&c.len===32)return`host ${i2ip(c.ip)}`;return netStr(c)};
  if(acl){L.push(v==='cisco'?'ip access-list extended LAB-FILTER':'ip access-list LAB-FILTER');
    d.rules.forEach((r,i)=>{const ace=`${r.act} ${r.proto==='any'?'ip':r.proto} ${aA(r.src)} ${aA(r.dst)}${rp(r)?' eq '+r.port:''}`;L.push(v==='cisco'?` ${ace}`:v==='os10'?`${I}seq ${10*(i+1)} ${ace}`:`${I}${10*(i+1)} ${ace}`)});
    const n=10*(d.rules.length+1);L.push(v==='cisco'?' deny ip any any log':v==='os10'?`${I}seq ${n} deny ip any any`:`${I}${n} deny ip any any log`,'!')}
  if(nat&&v==='eos'){L.push('ip access-list NAT-INSIDE');ospfIfs(d).filter(f=>!f.nat).forEach((f,i)=>L.push(`   ${10*(i+1)} permit ip ${netStr(f.c)} any`));L.push('!')}
  const ospfL=f=>{const oc=f&&!f.mgmt&&ospfCfg(d,f.vrf);if(!oc)return[];const ar=`0.0.0.${oc.area||0}`,pid=ospfPid(d,f.vrf);if(v==='nxos')return[`${I}ip router ospf ${pid} area ${ar}`];if(v==='os10')return[`${I}ip ospf ${pid} area ${ar}`];return[]};
  const mplsL=f=>f&&f.mpls&&!f.vrf?(v==='os10'?[]:v==='eos'?[`${I}mpls ip`,`${I}mpls ldp interface`]:[`${I}mpls ip`]):[];
  const l3x=(f,out)=>{const o=[];if(nat&&(v==='cisco'))o.push(out?`${I}ip nat outside`:`${I}ip nat inside`);if(nat&&v==='eos'&&out)o.push(`${I}ip nat source dynamic access-list NAT-INSIDE overload`);
    if(acl&&!out)o.push(`${I}ip access-group LAB-FILTER in`);o.push(...ospfL(f),...mplsL(f));
    if(f&&f.vip!=null){const g=vrid(f.vlan||f.k+1),x=i2ip(f.vip);if(v==='cisco')o.push(`${I}vrrp ${g} ip ${x}`);if(v==='nxos')o.push(`${I}vrrp ${g}`,`${I}  address ${x}`,`${I}  no shutdown`);if(v==='eos')o.push(`${I}vrrp ${g} ipv4 ${x}`);if(v==='os10')o.push(`${I}vrrp-group ${g}`,`${I}  virtual-address ${x}`)}
    return o};
  const sp=(p,isLag)=>{const o=[];if(p.mode==='access'){if(v==='nxos')o.push(`${I}switchport`);o.push(`${I}switchport mode access`);if(+p.vlan!==1)o.push(`${I}switchport access vlan ${p.vlan}`);if(!isLag)o.push(v==='nxos'?`${I}spanning-tree port type edge`:v==='os10'?`${I}spanning-tree port type edge`:`${I}spanning-tree portfast`)}
    else{if(v==='nxos')o.push(`${I}switchport`);if(v==='cisco'&&d.type==='sw3')o.push(`${I}switchport trunk encapsulation dot1q`);o.push(`${I}switchport mode trunk`);if(!allAllowed(p))o.push(`${I}switchport trunk allowed vlan ${String(p.allowed).replace(/\s+/g,'')}`);
      if(+p.native>1)o.push(v==='os10'?`${I}switchport access vlan ${p.native}`:`${I}switchport trunk native vlan ${p.native}`)}return o};
  LO.forEach(l=>{L.push(`interface ${loName(v,l.id)}`);if(l.desc)L.push(`${I}description ${l.desc}`);L.push(...vrfL(l.vrf),`${I}${ipA(l.c)}`,...ospfL(l.f),'!')});
  lports(d).forEach(lp=>{const p=lp.p,name=lp.lag?lagName(v,d,lp.lag):pn(v,d,lp.k),f=l3ifs(d,true).find(x=>x.kind==='port'&&x.k===lp.k);
    L.push(`interface ${name}`);if(p.desc)L.push(`${I}description ${p.desc}`);
    if(sw&&p.mode!=='routed')L.push(...sp(p,!!lp.lag));
    else{if(sw)L.push(`${I}no switchport`);L.push(...vrfL(p.vrf));const c=pc(p.ip);if(c)L.push(`${I}${ipA(c)}`,...l3x(f,p.nat));else if(v==='cisco'&&!(p.subs||[]).length)L.push(`${I}no ip address`)}
    L.push(p.shut?`${I}shutdown`:`${I}no shutdown`,'!');
    (lp.members||[]).forEach(k=>{const mp=d.ports[k];L.push(`interface ${pn(v,d,k)}`);if(mp.desc)L.push(`${I}description ${mp.desc}`);if(sw&&p.mode==='routed')L.push(`${I}no switchport`);
      if(v==='nxos'&&sw&&p.mode!=='routed')L.push(...sp(p,true));L.push(`${I}channel-group ${lp.lag} mode active`,mp.shut?`${I}shutdown`:`${I}no shutdown`,'!')});
    (p.subs||[]).forEach(s=>{const c=pc(s.ip),sf=l3ifs(d,true).find(x=>x.kind==='sub'&&x.k===lp.k&&x.vlan===+s.vlan);L.push(`interface ${name}.${s.vlan}`,v==='eos'?`${I}encapsulation dot1q vlan ${s.vlan}`:v==='cisco'?`${I}encapsulation dot1Q ${s.vlan}`:`${I}encapsulation dot1q ${s.vlan}`);L.push(...vrfL(s.vrf));if(c)L.push(`${I}${ipA(c)}`,...l3x(sf,s.nat));L.push('!')})});
  const sviIp=(s,c)=>s.agw&&v==='eos'?[`${I}ip address virtual ${cidrStr(c)}`]:s.agw&&v==='os10'?[`${I}${ipA(c)}`,`${I}ip virtual-router address ${i2ip(c.ip)}`]:[`${I}${ipA(c)}`,...(s.agw&&v==='nxos'?[`${I}fabric forwarding mode anycast-gateway`]:[]),...(s.agw&&v==='cisco'?[`${I}! anycast gateway (mesmo IP e MAC em todos os leafs)`]:[])];
  if(v==='os10')[...(d.vlans||[]),...(d.svis||[]).filter(s=>!(d.vlans||[]).some(x=>+x.id===+s.vlan)).map(s=>({id:+s.vlan,name:+s.vlan===1?'default':'VLAN'+s.vlan}))].sort((a,b)=>a.id-b.id).forEach(x=>{const s=(d.svis||[]).find(y=>+y.vlan===+x.id),c=s&&pc(s.ip),f=s&&l3ifs(d,true).find(y=>y.kind==='svi'&&y.vlan===+x.id);const vx=VX&&l2vnis(d).find(y=>+y.vlan===+x.id);
    L.push(`interface vlan${x.id}`,`${I}description ${vname(x)}`,...(vx?[`${I}virtual-network ${vx.vni}`]:[]),...vrfL(s&&s.vrf));if(c)L.push(...sviIp(s,c),...l3x(f,false));L.push(`${I}no shutdown`,'!')});
  else(d.svis||[]).forEach(s=>{const c=pc(s.ip),f=l3ifs(d,true).find(y=>y.kind==='svi'&&y.vlan===+s.vlan);L.push(`interface Vlan${s.vlan}`);if(v==='nxos')L.push(`${I}no shutdown`);L.push(...vrfL(s.vrf));if(c)L.push(...sviIp(s,c),...(d.type==='sw3'?l3x(f,false):[]));if(v!=='nxos')L.push(`${I}no shutdown`);L.push('!')});
  if(v==='nxos'&&VX)l3v(d).forEach(x=>L.push(`interface Vlan${coreVlan(d,x)}`,`${I}no shutdown`,`${I}vrf member ${x.name}`,`${I}ip forward`,'!'));
  if(VX){const src=VX.src!=null&&VX.src!==''?+VX.src:null;
    if(v==='nxos'){L.push('interface nve1','  no shutdown','  host-reachability protocol bgp');if(src!=null)L.push(`  source-interface ${loName('nxos',src)}`);
      l2vnis(d).forEach(x=>{L.push(`  member vni ${x.vni}`);const ps=vtepPeers(x);if(ps.length){L.push('    ingress-replication protocol static');ps.forEach(p=>L.push(`      peer-ip ${p}`))}else L.push('    ingress-replication protocol bgp')});
      l3v(d).forEach(x=>L.push(`  member vni ${x.l3vni} associate-vrf`));L.push('!','evpn');l2vnis(d).forEach(x=>{L.push(`  vni ${x.vni} l2`,'    rd auto');if(x.rt)L.push(`    route-target import ${x.rt}`,`    route-target export ${x.rt}`);else L.push('    route-target import auto','    route-target export auto')});L.push('!')}
    if(v==='eos'){L.push('interface Vxlan1');if(src!=null)L.push(`   vxlan source-interface ${loName('eos',src)}`);L.push('   vxlan udp-port 4789');l2vnis(d).forEach(x=>L.push(`   vxlan vlan ${x.vlan} vni ${x.vni}`));l3v(d).forEach(x=>L.push(`   vxlan vrf ${x.name} vni ${x.l3vni}`));
      const ps=[...new Set(l2vnis(d).flatMap(vtepPeers))];if(ps.length)L.push(`   vxlan flood vtep ${ps.join(' ')}`);L.push('!')}
    if(v==='os10'){L.push('nve');if(src!=null)L.push(` source-interface ${loName('os10',src)}`);L.push('!');l2vnis(d).forEach(x=>{L.push(`virtual-network ${x.vni}`,` vxlan-vni ${x.vni}`);vtepPeers(x).forEach(p=>L.push(`  remote-vtep ${p}`));L.push('!')});
      L.push('evpn');l2vnis(d).forEach(x=>{L.push(` evi ${x.vni}`,`  vni ${x.vni}`,'  rd auto',x.rt?`  route-target ${x.rt} both`:'  route-target auto')});l3v(d).forEach(x=>{L.push(` vrf ${x.name}`,`  vni ${x.l3vni}`);const im=rtI(x),ex=rtE(x);if(!im.length&&!ex.length)L.push('  route-target auto');ex.forEach(r=>L.push(`  route-target ${r} export`));im.forEach(r=>L.push(`  route-target ${r} import`))});L.push('!')}
    if(v==='cisco'){L.push('l2vpn evpn',' replication-type ingress',...(src!=null?[` router-id ${loName('cisco',src)}`]:[]),'!');l2vnis(d).forEach(x=>{L.push(`l2vpn evpn instance ${x.vlan} vlan-based`,' encapsulation vxlan');if(x.rt)L.push(` route-target both ${x.rt}`);L.push('!',`vlan configuration ${x.vlan}`,` member evpn-instance ${x.vlan} vni ${x.vni}`,'!')});
      l3v(d).forEach(x=>L.push(`vlan configuration ${coreVlan(d,x)}`,` member vni ${x.l3vni}`,'!'));
      L.push('interface nve1',' no ip address');if(src!=null)L.push(` source-interface ${loName('cisco',src)}`);L.push(' host-reachability protocol bgp');l2vnis(d).forEach(x=>{const ps=vtepPeers(x);if(ps.length)ps.forEach(p=>L.push(` member vni ${x.vni} ingress-replication ${p}`));else L.push(` member vni ${x.vni} ingress-replication`)});l3v(d).forEach(x=>L.push(` member vni ${x.l3vni} vrf ${x.name}`));L.push('!')}}
  mg.forEach(({p,k})=>{const c=pc(p.ip),n=pn(v,d,k);L.push(`interface ${n}`);
    if(v==='cisco')L.push(' vrf forwarding Mgmt-vrf',` ${ipA(c)}`,' no shutdown');if(v==='nxos')L.push('  vrf member management',`  ${ipA(c)}`);if(v==='eos')L.push('   vrf MGMT',`   ${ipA(c)}`);if(v==='os10')L.push(' no ip address dhcp',` ${ipA(c)}`,' no shutdown');L.push('!');
    if(p.gw){if(v==='cisco')L.push(`ip route vrf Mgmt-vrf 0.0.0.0 0.0.0.0 ${p.gw}`);if(v==='nxos')L.push('vrf context management',`  ip route 0.0.0.0/0 ${p.gw}`);if(v==='eos')L.push(`ip route vrf MGMT 0.0.0.0/0 ${p.gw}`);if(v==='os10')L.push(`management route 0.0.0.0/0 ${p.gw}`);L.push('!')}});
  if(d.type==='sw2'&&d.gw)L.push(v==='cisco'?`ip default-gateway ${d.gw}`:`ip route 0.0.0.0/0 ${d.gw}`,'!');
  if(fwd(d.type)){routesIn(d,'').forEach(r=>{const c=pc(r.dst);if(c)L.push(v==='cisco'?`ip route ${i2ip(c.net)} ${msk(c)} ${r.nh}`:`ip route ${netStr(c)} ${r.nh}`)});
    if(MP&&v==='nxos'){L.push('!','mpls ldp configuration');if(lo0)L.push(`  router-id ${loName('nxos',lo0.id)} force`)}
    if(MP&&v==='eos'){L.push('!','mpls ldp',`   router-id ${i2ip(ldpRid(d))}`);if(lo0)L.push(`   transport-address interface ${loName('eos',lo0.id)}`);L.push('   no shutdown')}
    if(ospf){L.push('!','router ospf 1');if(d.ospf.rid)L.push(`${I}router-id ${d.ospf.rid}`);
      if(v==='cisco')ospfIfs(d).forEach(f=>L.push(` network ${i2ip(f.c.net)} ${wc(f.c)} area ${d.ospf.area||0}`));if(v==='eos')ospfIfs(d).forEach(f=>L.push(`   network ${netStr(f.c)} area ${area}`));
      if(d.ospf.dio)L.push(`${I}default-information originate`)}
    if(v!=='nxos')VR.forEach(x=>vRoutes(d,x.name).forEach(r=>{const c=pc(r.dst);L.push(v==='cisco'?`ip route vrf ${x.name} ${i2ip(c.net)} ${msk(c)} ${r.nh}`:`ip route vrf ${x.name} ${netStr(c)} ${r.nh}`)}));
    OV.forEach(o=>{L.push('!');if(v==='nxos'){L.push(`router ospf ${o.pid}`,`  vrf ${o.v}`);if(o.cfg.rid)L.push(`    router-id ${o.cfg.rid}`);if(o.cfg.dio)L.push('    default-information originate');return}
      L.push(`router ospf ${o.pid} vrf ${o.v}`);if(o.cfg.rid)L.push(`${I}router-id ${o.cfg.rid}`);
      if(v==='cisco')vIfs(d,o.v).forEach(f=>L.push(` network ${i2ip(f.c.net)} ${wc(f.c)} area ${o.cfg.area||0}`));if(v==='eos')vIfs(d,o.v).forEach(f=>L.push(`   network ${netStr(f.c)} area 0.0.0.${o.cfg.area||0}`));if(o.cfg.dio)L.push(`${I}default-information originate`)});
    if(B)L.push('!',...bgpCF(d,v,B,I));
    if(nat&&v==='cisco'){const o=ospfIfs(d).find(f=>f.nat);L.push('!','ip access-list standard NAT-INSIDE');ospfIfs(d).filter(f=>!f.nat).forEach(f=>L.push(` permit ${i2ip(f.c.net)} ${wc(f.c)}`));routesIn(d,'').forEach(r=>{const c=pc(r.dst);if(c&&c.len>0&&!inNet(ip2i(r.nh)??0,o.c))L.push(` permit ${i2ip(c.net)} ${wc(c)}`)});L.push(`ip nat inside source list NAT-INSIDE interface ${ifFull('cisco',d,o)} overload`)}
    if(nat&&(v==='nxos'||v==='os10'))L.push('!',`! NAT de saída: ${VN[v]} não é usado como NAT de borda; faça o NAT no firewall ou no roteador de borda.`)}
  if(acl&&v==='cisco')L.push('!','! O ACL é stateless em IOS. Para inspeção stateful use Zone-Based Firewall (ZBF).');
  if(v==='cisco'||v==='eos')L.push('!','end');return L.join('\n')}
['cisco','nxos','eos','os10'].forEach(v=>GEN[v]=d=>genCF(d,v));
function bgpCF(d,v,B,I){const L=[],rs=src=>v==='nxos'?{connected:'direct',static:'static',ospf:'ospf 1'}[src]:src==='ospf'?'ospf 1':src;
  const rsx=r=>v==='nxos'?`${rs(r.src)} route-map ${r.rm||'BANCADA-REDIST'}`:`${rs(r.src)}${r.rm?' route-map '+r.rm:''}`;
  if(v==='nxos'&&B.groups.some(g=>g.rdo.some(r=>!r.rm)))L.push('route-map BANCADA-REDIST permit 10','!');
  L.push(`router bgp ${B.asn}`);
  if(v==='cisco'){if(B.rid)L.push(` bgp router-id ${B.rid}`);L.push(' bgp log-neighbor-changes');if(B.noV4)L.push(' no bgp default ipv4-unicast');const g0=B.groups[0];
    const nbG=(n,p)=>{L.push(`${p}neighbor ${n.ip} remote-as ${n.ras}`);if(n.desc)L.push(`${p}neighbor ${n.ip} description ${n.desc}`);if(hasUs(n))L.push(`${p}neighbor ${n.ip} update-source ${usOf('cisco',n)}`);if(n.mh)L.push(`${p}neighbor ${n.ip} ebgp-multihop 255`);if(n.shut)L.push(`${p}neighbor ${n.ip} shutdown`)};
    g0.nb.forEach(n=>nbG(n,' '));L.push(' !',' address-family ipv4');
    const af=(g,p)=>{g.neto.forEach(x=>L.push(`${p}network ${i2ip(x.c.net)} mask ${msk(x.c)}${x.rm?' route-map '+x.rm:''}`));g.rdo.forEach(x=>L.push(`${p}redistribute ${rsx(x)}`));g.nb.filter(n=>!n.noV4).forEach(n=>{L.push(`${p}neighbor ${n.ip} activate`);if(n.sc)L.push(`${p}neighbor ${n.ip} send-community both`);if(n.rrc)L.push(`${p}neighbor ${n.ip} route-reflector-client`);if(n.nhs)L.push(`${p}neighbor ${n.ip} next-hop-self`);if(n.dio)L.push(`${p}neighbor ${n.ip} default-originate`);if(n.rmIn)L.push(`${p}neighbor ${n.ip} route-map ${n.rmIn} in`);if(n.rmOut)L.push(`${p}neighbor ${n.ip} route-map ${n.rmOut} out`)})};
    af(g0,'  ');L.push(' exit-address-family');
    [['vpnv4',B.vpn],['l2vpn evpn',B.ev]].forEach(([fn,ns])=>{if(!ns.length)return;L.push(' !',` address-family ${fn}`);ns.forEach(n=>{L.push(`  neighbor ${n.ip} activate`);if(n.sc)L.push(`  neighbor ${n.ip} send-community ${fn==='vpnv4'?'extended':'both'}`);if(n.rrc)L.push(`  neighbor ${n.ip} route-reflector-client`);if(n.nhs&&fn==='vpnv4')L.push(`  neighbor ${n.ip} next-hop-self`)});L.push(' exit-address-family')});
    B.groups.slice(1).forEach(g=>{L.push(' !',` address-family ipv4 vrf ${g.vrf}`);if(+vrfObj(d,g.vrf).l3vni>0)L.push('  advertise l2vpn evpn');g.nb.forEach(n=>{L.push(`  neighbor ${n.ip} remote-as ${n.ras}`);if(n.desc)L.push(`  neighbor ${n.ip} description ${n.desc}`);if(n.mh)L.push(`  neighbor ${n.ip} ebgp-multihop 255`);if(n.shut)L.push(`  neighbor ${n.ip} shutdown`)});af(g,'  ');L.push(' exit-address-family')});L.push('!');return L}
  if(v==='eos'){if(B.rid)L.push(`   router-id ${B.rid}`);if(B.noV4)L.push('   no bgp default ipv4-unicast');const body=(g,p)=>{g.nb.forEach(n=>{L.push(`${p}neighbor ${n.ip} remote-as ${n.ras}`);if(n.desc)L.push(`${p}neighbor ${n.ip} description ${n.desc}`);if(hasUs(n))L.push(`${p}neighbor ${n.ip} update-source ${usOf('eos',n)}`);if(n.mh)L.push(`${p}neighbor ${n.ip} ebgp-multihop 255`);if(n.rrc)L.push(`${p}neighbor ${n.ip} route-reflector-client`);if(n.sc)L.push(`${p}neighbor ${n.ip} send-community`);if(n.nhs)L.push(`${p}neighbor ${n.ip} next-hop-self`);if(n.dio)L.push(`${p}neighbor ${n.ip} default-originate always`);if(n.rmIn)L.push(`${p}neighbor ${n.ip} route-map ${n.rmIn} in`);if(n.rmOut)L.push(`${p}neighbor ${n.ip} route-map ${n.rmOut} out`);if(n.shut)L.push(`${p}neighbor ${n.ip} shutdown`)});
      g.neto.forEach(x=>L.push(`${p}network ${netStr(x.c)}${x.rm?' route-map '+x.rm:''}`));g.rdo.forEach(x=>L.push(`${p}redistribute ${x.src}${x.rm?' route-map '+x.rm:''}`))};
    body(B.groups[0],'   ');
    const VX=vxD(d);if(VX)l2vnis(d).forEach(x=>L.push('   !',`   vlan ${x.vlan}`,'      rd auto',`      route-target both ${x.rt||B.asn+':'+x.vni}`,'      redistribute learned'));
    const g0=B.groups[0];if(B.noV4)L.push('   !','   address-family ipv4',...g0.nb.filter(n=>!n.noV4).map(n=>`      neighbor ${n.ip} activate`));else if(g0.nb.some(n=>n.noV4))L.push('   !','   address-family ipv4',...g0.nb.filter(n=>n.noV4).map(n=>`      no neighbor ${n.ip} activate`));
    [['vpn-ipv4',B.vpn],['evpn',B.ev]].forEach(([fn,ns])=>{if(ns.length)L.push('   !',`   address-family ${fn}`,...ns.map(n=>`      neighbor ${n.ip} activate`))});
    B.groups.slice(1).forEach(g=>{const x=vrfObj(d,g.vrf),l3=+x.l3vni>0;L.push('   !',`   vrf ${g.vrf}`,`      rd ${rdOf(d,g.vrf,B)}`);const fam=l3?'evpn':'vpn-ipv4';const im=rtI(x),ex=rtE(x);
      (im.length?im:l3?[`${B.asn}:${x.l3vni}`]:[]).forEach(r=>L.push(`      route-target import ${fam} ${r}`));(ex.length?ex:l3?[`${B.asn}:${x.l3vni}`]:[]).forEach(r=>L.push(`      route-target export ${fam} ${r}`));body(g,'      ')});L.push('!');return L}
  // NX-OS e OS10: neighbor em sub-modo
  const sp=v==='nxos'?'  ':' ';if(B.rid)L.push(`${sp}router-id ${B.rid}`);
  if(B.ev.length&&v==='nxos')L.push(`${sp}address-family l2vpn evpn`);
  const body=(g,p,top)=>{if(g.net.length||g.rd.length||(!top&&+vrfObj(d,g.vrf).l3vni>0)){L.push(`${p}address-family ipv4 unicast`);g.neto.forEach(x=>L.push(`${p}${sp}network ${netStr(x.c)}${x.rm?' route-map '+x.rm:''}`));g.rdo.forEach(x=>L.push(`${p}${sp}redistribute ${rsx(x)}`));if(!top&&+vrfObj(d,g.vrf).l3vni>0&&v==='nxos')L.push(`${p}${sp}advertise l2vpn evpn`)}
    g.nb.forEach(n=>{L.push(`${p}neighbor ${n.ip}`,`${p}${sp}remote-as ${n.ras}`);if(n.desc)L.push(`${p}${sp}description ${n.desc}`);if(hasUs(n))L.push(`${p}${sp}update-source ${usOf(v,n)}`);if(n.mh)L.push(`${p}${sp}ebgp-multihop 255`);if(n.sc&&v==='os10')L.push(`${p}${sp}send-community extended`);L.push(n.shut?`${p}${sp}shutdown`:(v==='os10'?`${p}${sp}no shutdown`:null));
      const a2=p+sp+sp;if(!n.noV4){L.push(`${p}${sp}address-family ipv4 unicast`);if(n.sc&&v==='nxos')L.push(`${a2}send-community`,`${a2}send-community extended`);if(n.rrc)L.push(`${a2}route-reflector-client`);if(n.nhs)L.push(`${a2}next-hop-self`);if(n.dio)L.push(`${a2}default-originate`);if(n.rmIn)L.push(`${a2}route-map ${n.rmIn} in`);if(n.rmOut)L.push(`${a2}route-map ${n.rmOut} out`)}
      else if(v==='os10')L.push(`${p}${sp}address-family ipv4 unicast`,`${a2}no activate`);
      [['vpnv4 unicast',n.vpnv4],['l2vpn evpn',n.evpn]].forEach(([fn,on])=>{if(!on)return;if(v==='os10'&&fn!=='l2vpn evpn'){L.push(`${p}${sp}! VPNv4 não é suportado no OS10`);return}L.push(`${p}${sp}address-family ${fn}`);if(v==='os10')L.push(`${a2}activate`);if(n.sc&&v==='nxos')L.push(`${a2}send-community`,`${a2}send-community extended`);if(n.rrc)L.push(`${a2}route-reflector-client`)})})};
  body(B.groups[0],sp,true);B.groups.slice(1).forEach(g=>{L.push(`${sp}vrf ${g.vrf}`);body(g,sp+sp,false)});L.push('!');return L.filter(x=>x!==null)}

/* ---- HPE Aruba AOS-CX ---- */
GEN.aoscx=d=>{const L=hdr(d,'aoscx','!'),sw=isSw(d.type),acl=aclOn(d),I='    ',area=`0.0.0.${d.ospf?.area||0}`,ospf=fwd(d.type)&&d.ospf?.on,B=bgpV(d),VX=vxD(d);
  L.push('!',`hostname ${d.name}`,'!');if(mplsIfs(d).length)L.push('! MPLS/LDP: o AOS-CX não implementa MPLS; o core MPLS precisa de outro sistema','!');
  dvrfs(d).forEach(x=>{L.push(`vrf ${x.name}`);if(x.rd||B)L.push(`${I}rd ${rdOf(d,x.name,B)}`);rtE(x).forEach(r=>L.push(`${I}route-target export ${r} evpn`));rtI(x).forEach(r=>L.push(`${I}route-target import ${r} evpn`));if(+x.l3vni>0&&!rtE(x).length&&!rtI(x).length)L.push(`${I}route-target both auto evpn`)});
  const va=n=>n?[`${I}vrf attach ${n}`]:[];const oA=(vf,c)=>{const oc=c&&ospfCfg(d,vf||'');return oc?[`${I}ip ospf ${ospfPid(d,vf||'')} area 0.0.0.${oc.area||0}`]:[]};
  if(sw)(d.vlans||[]).forEach(x=>L.push(`vlan ${x.id}`,`${I}name ${vname(x)}`));
  L.push(...polCF(d,'aoscx'));
  const aA=a=>{if(isAny(a))return'any';const c=pc(a);return c.len===32?i2ip(c.ip):`${i2ip(c.net)}/${msk(c)}`};
  if(acl){L.push('access-list ip LAB-FILTER');d.rules.forEach((r,i)=>L.push(`${I}${10*(i+1)} ${r.act} ${r.proto==='any'?'any':r.proto} ${aA(r.src)} ${aA(r.dst)}${rp(r)?' eq '+r.port:''}`));L.push(`${I}${10*(d.rules.length+1)} deny any any any`)}
  dLoops(d).forEach(l=>{L.push(`interface loopback ${l.id}`);if(l.desc)L.push(`${I}description ${l.desc}`);L.push(...va(l.vrf),`${I}ip address ${cidrStr(l.c)}`,...oA(l.vrf,l.c))});
  const body=(p,f)=>{const o=[];if(sw&&p.mode!=='routed'){o.push(`${I}no routing`);if(p.mode==='access')o.push(`${I}vlan access ${p.vlan}`);else{o.push(`${I}vlan trunk native ${+p.native||1}`,`${I}vlan trunk allowed ${allAllowed(p)?'all':String(p.allowed).replace(/\s+/g,'')}`)}}
    else{if(sw)o.push(`${I}routing`);o.push(...va(p.vrf));const c=pc(p.ip);if(c)o.push(`${I}ip address ${cidrStr(c)}`);o.push(...oA(p.vrf,c));if(acl&&c)o.push(`${I}apply access-list ip LAB-FILTER in`)}return o};
  lports(d).forEach(lp=>{const p=lp.p,f=null;if(lp.lag){L.push(`interface lag ${lp.lag}`,p.shut?`${I}shutdown`:`${I}no shutdown`);if(p.desc)L.push(`${I}description ${p.desc}`);L.push(...body(p,f),`${I}lacp mode active`);
      lp.members.forEach(k=>{L.push(`interface ${pn('aoscx',d,k)}`,`${I}no shutdown`);if(d.ports[k].desc)L.push(`${I}description ${d.ports[k].desc}`);L.push(`${I}lag ${lp.lag}`)})}
    else{L.push(`interface ${pn('aoscx',d,lp.k)}`,p.shut?`${I}shutdown`:`${I}no shutdown`);if(p.desc)L.push(`${I}description ${p.desc}`);L.push(...body(p,f))}
    (p.subs||[]).forEach(s=>{const c=pc(s.ip);L.push(`interface ${lp.lag?'lag '+lp.lag:pn('aoscx',d,lp.k)}.${s.vlan}`,`${I}encapsulation dot1q ${s.vlan}`,...va(s.vrf));if(c)L.push(`${I}ip address ${cidrStr(c)}`,...oA(s.vrf,c))})});
  (d.svis||[]).forEach(s=>{const c=pc(s.ip);L.push(`interface vlan ${s.vlan}`,...va(s.vrf));if(c)L.push(`${I}ip address ${cidrStr(c)}`);if(c&&s.agw)L.push(`${I}active-gateway ip mac 12:00:00:00:01:00`,`${I}active-gateway ip ${i2ip(c.ip)}`);if(s.vip&&ip2i(s.vip)!==null)L.push(`${I}vrrp ${vrid(s.vlan)} address-family ipv4`,`${I}${I}address ${s.vip} primary`,`${I}${I}no shutdown`);L.push(...oA(s.vrf,c))});
  if(VX){const lo=dLoops(d).find(l=>+l.id===+VX.src);L.push('interface vxlan 1');if(lo)L.push(`${I}source ip ${i2ip(lo.c.ip)}`);L.push(`${I}no shutdown`);l2vnis(d).forEach(x=>{L.push(`${I}vni ${x.vni}`,`${I}${I}vlan ${x.vlan}`);vtepPeers(x).forEach(p=>L.push(`${I}${I}vtep-peer ${p}`))});l3v(d).forEach(x=>L.push(`${I}vni ${x.l3vni}`,`${I}${I}vrf ${x.name}`));
    L.push('evpn');l2vnis(d).forEach(x=>L.push(`${I}vlan ${x.vlan}`,`${I}${I}rd auto`,`${I}${I}route-target export ${x.rt||'auto'}`,`${I}${I}route-target import ${x.rt||'auto'}`))}
  mgmtPorts(d).forEach(({p})=>{L.push('interface mgmt',`${I}no shutdown`,`${I}ip static ${cidrStr(pc(p.ip))}`);if(p.gw)L.push(`${I}default-gateway ${p.gw}`)});
  if(d.type==='sw2'&&d.gw)L.push(`ip route 0.0.0.0/0 ${d.gw}`);
  if(fwd(d.type)){routesIn(d,'').forEach(r=>{const c=pc(r.dst);if(c)L.push(`ip route ${netStr(c)} ${isNull(r.nh)?'blackhole':r.nh}`)});
    if(ospf){L.push('router ospf 1');if(d.ospf.rid)L.push(`${I}router-id ${d.ospf.rid}`);L.push(`${I}area ${area}`);if(d.ospf.dio)L.push(`${I}default-information originate`)}
    dvrfs(d).forEach(x=>vRoutes(d,x.name).forEach(r=>L.push(`ip route ${netStr(pc(r.dst))} ${isNull(r.nh)?'blackhole':r.nh} vrf ${x.name}`)));
    ovrfs(d).forEach(o=>{L.push(`router ospf ${o.pid} vrf ${o.v}`);if(o.cfg.rid)L.push(`${I}router-id ${o.cfg.rid}`);L.push(`${I}area 0.0.0.${o.cfg.area||0}`);if(o.cfg.dio)L.push(`${I}default-information originate`)});
    if(B){L.push(`router bgp ${B.asn}`);if(B.rid)L.push(`${I}bgp router-id ${B.rid}`);const body=(g,p)=>{g.nb.forEach(n=>{L.push(`${p}neighbor ${n.ip} remote-as ${n.ras}`);if(n.desc)L.push(`${p}neighbor ${n.ip} description ${n.desc}`);if(hasUs(n))L.push(`${p}neighbor ${n.ip} update-source loopback ${n.us}`);if(n.mh)L.push(`${p}neighbor ${n.ip} ebgp-multihop 255`);if(n.shut)L.push(`${p}neighbor ${n.ip} shutdown`)});
        L.push(`${p}address-family ipv4 unicast`);g.nb.filter(n=>!n.noV4).forEach(n=>{L.push(`${p}${I}neighbor ${n.ip} activate`);if(n.sc)L.push(`${p}${I}neighbor ${n.ip} send-community both`);if(n.rrc)L.push(`${p}${I}neighbor ${n.ip} route-reflector-client`);if(n.nhs)L.push(`${p}${I}neighbor ${n.ip} next-hop-self`);if(n.dio)L.push(`${p}${I}neighbor ${n.ip} default-originate`);if(n.rmIn)L.push(`${p}${I}neighbor ${n.ip} route-map ${n.rmIn} in`);if(n.rmOut)L.push(`${p}${I}neighbor ${n.ip} route-map ${n.rmOut} out`)});
        g.neto.forEach(x=>L.push(`${p}${I}network ${netStr(x.c)}${x.rm?' route-map '+x.rm:''}`));g.rdo.forEach(x=>L.push(`${p}${I}redistribute ${x.src}${x.rm?' route-map '+x.rm:''}`));L.push(`${p}exit-address-family`)};
      body(B.groups[0],I);if(!B.groups[0].nb.some(n=>!n.noV4))L.push(`${I}! IPv4 unicast desativado para os vizinhos sem activate`);
      if(B.vpn.length)L.push(`${I}! VPNv4 (MPLS L3VPN) não é suportado no AOS-CX: ${B.vpn.map(n=>n.ip).join(', ')}`);
      if(B.ev.length){L.push(`${I}address-family l2vpn evpn`);B.ev.forEach(n=>{L.push(`${I}${I}neighbor ${n.ip} activate`);if(n.sc)L.push(`${I}${I}neighbor ${n.ip} send-community extended`);if(n.rrc)L.push(`${I}${I}neighbor ${n.ip} route-reflector-client`)});L.push(`${I}exit-address-family`)}
      B.groups.slice(1).forEach(g=>{L.push(`${I}vrf ${g.vrf}`);body(g,I+I)})}}
  if(anyNat(d))L.push('!','! NAT de saída: faça no firewall ou no roteador de borda.');
  return L.join('\n')};

/* ---- Juniper Junos ---- */
const jMatch=r=>{const p=pc(r.pfx);const ge=+r.ge||0,le=+r.le||0;if(!ge&&!le)return'exact';if(!ge)return`upto /${le}`;return`prefix-length-range /${ge}-/${le||32}`};
GEN.junos=d=>{const L=hdr(d,'junos','#'),sw=isSw(d.type),acl=aclOn(d),nat=anyNat(d),s=x=>L.push('set '+x),area=`0.0.0.${d.ospf?.area||0}`;L.push('');
  s(`system host-name ${d.name}`);const B=bgpV(d),VX=vxD(d),LO=dLoops(d);
  const vn=id=>{const x=(d.vlans||[]).find(y=>+y.id===+id);return x?vname(x):(+id===1?'default':'VLAN'+id)};
  if(sw)(d.vlans||[]).forEach(x=>{s(`vlans ${vname(x)} vlan-id ${x.id}`);if((d.svis||[]).some(y=>+y.vlan===+x.id))s(`vlans ${vname(x)} l3-interface irb.${x.id}`)});
  if(lagCount(d))s(`chassis aggregated-devices ethernet device-count ${Math.max(...d.ports.map(p=>+p.lag||0))}`);
  const filt=(n,u,out)=>{if(acl&&!out)s(`interfaces ${n} unit ${u} family inet filter input LAB-FILTER`)};
  const vipLine=(n,u,c,vip,g)=>{if(vip!=null)s(`interfaces ${n} unit ${u} family inet address ${cidrStr(c)} vrrp-group ${g} virtual-address ${i2ip(vip)}`)};
  const fm=(n,u,on)=>{if(on&&fwd(d.type))s(`interfaces ${n} unit ${u} family mpls`)};
  LO.forEach(l=>{s(`interfaces lo0 unit ${l.id} family inet address ${cidrStr(l.c)}`);if(l.desc)s(`interfaces lo0 unit ${l.id} description "${l.desc}"`)});
  lports(d).forEach(lp=>{const p=lp.p,n=lp.lag?lagName('junos',d,lp.lag):pn('junos',d,lp.k);
    (lp.members||[]).forEach(k=>{const mn=pn('junos',d,k);if(d.ports[k].desc)s(`interfaces ${mn} description "${d.ports[k].desc}"`);s(`interfaces ${mn} ${d.type==='rtr'?'gigether-options':'ether-options'} 802.3ad ${n}`)});
    if(lp.lag)s(`interfaces ${n} aggregated-ether-options lacp active`);
    if(p.desc)s(`interfaces ${n} description "${p.desc}"`);if(p.shut)s(`interfaces ${n} disable`);
    if(sw&&p.mode==='access'){s(`interfaces ${n} unit 0 family ethernet-switching interface-mode access`);s(`interfaces ${n} unit 0 family ethernet-switching vlan members ${vn(p.vlan)}`)}
    else if(sw&&p.mode==='trunk'){s(`interfaces ${n} unit 0 family ethernet-switching interface-mode trunk`);s(`interfaces ${n} unit 0 family ethernet-switching vlan members ${allAllowed(p)?'all':'[ '+parseList(p.allowed).map(vn).join(' ')+' ]'}`);if(+p.native>1)s(`interfaces ${n} native-vlan-id ${p.native}`)}
    else{if((p.subs||[]).length)s(`interfaces ${n} vlan-tagging`);const c=pc(p.ip);if(c){s(`interfaces ${n} unit 0 family inet address ${cidrStr(c)}`);vipLine(n,0,c,ip2i(p.vip),vrid(lp.k+1));filt(n,0,p.nat);fm(n,0,p.mpls&&!p.vrf)}
      (p.subs||[]).forEach(x=>{const c=pc(x.ip);s(`interfaces ${n} unit ${x.vlan} vlan-id ${x.vlan}`);if(c){s(`interfaces ${n} unit ${x.vlan} family inet address ${cidrStr(c)}`);vipLine(n,x.vlan,c,ip2i(x.vip),vrid(x.vlan));filt(n,x.vlan,x.nat);fm(n,x.vlan,x.mpls&&!x.vrf)}})}});
  (d.svis||[]).forEach(x=>{const c=pc(x.ip);if(c){s(`interfaces irb unit ${x.vlan} family inet address ${cidrStr(c)}`);vipLine('irb',x.vlan,c,ip2i(x.vip),vrid(x.vlan));if(x.agw)s(`interfaces irb unit ${x.vlan} mac 00:00:5e:00:53:01`);if(d.type==='sw3')filt('irb',x.vlan,false)}});
  mgmtPorts(d).forEach(({p,k})=>{const n=pn('junos',d,k);s('system management-instance');s(`interfaces ${n} unit 0 family inet address ${cidrStr(pc(p.ip))}`);if(p.gw)s(`routing-instances mgmt_junos routing-options static route 0.0.0.0/0 next-hop ${p.gw}`)});
  if(d.type==='sw2'&&d.gw)s(`routing-options static route 0.0.0.0/0 next-hop ${d.gw}`);
  if(fwd(d.type)){routesIn(d,'').forEach(r=>{const c=pc(r.dst);if(c)s(`routing-options static route ${netStr(c)} ${isNull(r.nh)?'discard':'next-hop '+r.nh}`)});
    const MP=mplsIfs(d);if(MP.length){MP.forEach(f=>{s(`protocols mpls interface ${ifFull('junos',d,f)}`);s(`protocols ldp interface ${ifFull('junos',d,f)}`)});const l0=LO.find(l=>!l.vrf);if(l0)s(`protocols ldp interface lo0.${l0.id}`)}
    if(d.ospf?.on){if(d.ospf.rid)s(`routing-options router-id ${d.ospf.rid}`);ospfIfs(d).forEach(f=>s(`protocols ospf area ${area} interface ${ifFull('junos',d,f)}${f.kind==='loop'?' passive':''}`));
      if(d.ospf.dio||dvrfs(d).some(x=>ospfCfg(d,x.name)?.dio)){s('policy-options policy-statement EXPORTA-DEFAULT term padrao from protocol [ static bgp ]');s('policy-options policy-statement EXPORTA-DEFAULT term padrao from route-filter 0.0.0.0/0 exact');s('policy-options policy-statement EXPORTA-DEFAULT term padrao then accept');if(d.ospf.dio)s('protocols ospf export EXPORTA-DEFAULT')}}
    else if(dvrfs(d).some(x=>ospfCfg(d,x.name)?.dio)){s('policy-options policy-statement EXPORTA-DEFAULT term padrao from route-filter 0.0.0.0/0 exact');s('policy-options policy-statement EXPORTA-DEFAULT term padrao then accept')}
    dvrfs(d).forEach(x=>{const ri=`routing-instances ${x.name}`,vpn=!!(x.rd||rtI(x).length||rtE(x).length||+x.l3vni>0);s(`${ri} instance-type ${vpn?'vrf':'virtual-router'}`);vIfs(d,x.name).forEach(f=>s(`${ri} interface ${ifFull('junos',d,f)}`));
      if(vpn){s(`${ri} route-distinguisher ${rdOf(d,x.name,B)}`);rtI(x).forEach(r=>s(`${ri} vrf-target import target:${r}`));rtE(x).forEach(r=>s(`${ri} vrf-target export target:${r}`));if(+x.l3vni>0&&!rtI(x).length&&!rtE(x).length)s(`${ri} vrf-target target:${B?B.asn:65000}:${x.l3vni}`);s(`${ri} vrf-table-label`)}
      if(+x.l3vni>0){s(`${ri} protocols evpn ip-prefix-routes advertise direct-nexthop`);s(`${ri} protocols evpn ip-prefix-routes encapsulation vxlan`);s(`${ri} protocols evpn ip-prefix-routes vni ${x.l3vni}`)}
      vRoutes(d,x.name).forEach(r=>s(`${ri} routing-options static route ${netStr(pc(r.dst))} ${isNull(r.nh)?'discard':'next-hop '+r.nh}`));
      const oc=ospfCfg(d,x.name);if(oc){vIfs(d,x.name).forEach(f=>s(`${ri} protocols ospf area 0.0.0.${oc.area||0} interface ${ifFull('junos',d,f)}`));if(oc.dio){s(`${ri} protocols ospf export EXPORTA-DEFAULT`)}}});
    if(VX){const src=VX.src!=null&&VX.src!==''?+VX.src:null;if(src!=null)s(`switch-options vtep-source-interface lo0.${src}`);const vt=vtepIp(d);s(`switch-options route-distinguisher ${vt!=null?i2ip(vt):'0.0.0.0'}:1`);s('switch-options vrf-target auto');
      s('protocols evpn encapsulation vxlan');s('protocols evpn extended-vni-list all');l2vnis(d).forEach(x=>{s(`vlans ${vn(x.vlan)} vxlan vni ${x.vni}`);if(x.rt)s(`protocols evpn vni-options vni ${x.vni} vrf-target target:${x.rt}`);vtepPeers(x).forEach(p=>{s(`switch-options remote-vtep-list ${p}`);s(`vlans ${vn(x.vlan)} vxlan static-remote-vtep-list ${p}`)})})}
    /* políticas */
    (d.pfx||[]).forEach(p=>seqd(p.rules).forEach(r=>s(`policy-options route-filter-list ${p.name} ${r.pfx} ${jMatch(r)}${r.act==='deny'?' reject':''}`)));
    (d.clists||[]).forEach(c=>{const ms=[...new Set((c.rules||[]).filter(r=>r.act!=='deny').flatMap(r=>commList(r.comm)))];if(ms.length)s(`policy-options community ${c.name} members [ ${ms.join(' ')} ]`)});
    const outRm=new Set(B?B.groups.flatMap(g=>g.nb.map(n=>n.rmOut)).filter(Boolean):[]);
    (d.rmaps||[]).forEach(m=>{const ps=`policy-options policy-statement ${m.name}`;seqd(m.rules).forEach(r=>{const t=`${ps} term rm-${r.seq}`;if(r.mPfx)s(`${t} from route-filter-list ${r.mPfx}`);if(r.mComm)s(`${t} from community ${r.mComm}`);
      if(r.act!=='deny'){if(r.sLp!==''&&r.sLp!=null)s(`${t} then local-preference ${r.sLp}`);if(r.sMed!==''&&r.sMed!=null)s(`${t} then metric ${r.sMed}`);if(r.sComm){const cn=`BANCADA-SET-${m.name}-${r.seq}`;s(`policy-options community ${cn} members [ ${r.sComm} ]`);s(`${t} then community ${r.sAdd?'add':'set'} ${cn}`)}if(r.sPre)s(`${t} then as-path-prepend "${r.sPre}"`)}
      s(`${t} then ${r.act==='deny'?'reject':outRm.has(m.name)?'next policy':'accept'}`)});s(`${ps} term implicit-deny then reject`)});
    if(B){s(`routing-options autonomous-system ${B.asn}`);if(B.rid&&!d.ospf?.rid)s(`routing-options router-id ${B.rid}`);
      const pol=new Set();B.groups.forEach(g=>{const pre=g.vrf?`routing-instances ${g.vrf} `:'',pn2=`BGP-OUT${g.vrf?'-'+g.vrf:''}`,ps=`policy-options policy-statement ${pn2}`;let has=false;
        const vx2=g.vrf&&(g.net.length||g.rd.length)&&vrfVpn(d,g.vrf);if(vx2){const x=vrfObj(d,g.vrf);const rts=rtE(x).length?rtE(x):[`${B.asn}:${+x.l3vni>0?x.l3vni:vrfIdx(d,g.vrf)+1}`];s(`policy-options community BANCADA-RT-${g.vrf} members [ ${rts.map(r=>'target:'+r).join(' ')} ]`);s(`${ps} term vpn-rt then community add BANCADA-RT-${g.vrf}`)}
        g.net.forEach((c,i)=>{s(`${ps} term redes from route-filter ${netStr(c)} exact`);has=true});if(g.net.length)s(`${ps} term redes then accept`);
        g.rd.forEach(x=>{const pr={connected:'direct',static:'static',ospf:'ospf'}[x];s(`${ps} term ${pr} from protocol ${pr}`);s(`${ps} term ${pr} then accept`);has=true});
        if(vx2){s(`${ps} term vpn-bgp from protocol bgp`);s(`${ps} term vpn-bgp then accept`);s(`routing-instances ${g.vrf} vrf-export ${pn2}`)}
        g.nb.forEach(n=>{const ext=isEbgp(B,n),gr=ext?`EBGP-AS${n.ras}`:n.rrc?'IBGP-RR-CLIENTES':'IBGP',b=`${pre}protocols bgp group ${gr}`;s(`${b} type ${ext?'external':'internal'}`);if(ext)s(`${b} peer-as ${n.ras}`);if(n.rrc)s(`${b} cluster ${bgpRid(d)}`);s(`${b} neighbor ${n.ip}`);const nb=`${b} neighbor ${n.ip}`;if(n.desc)s(`${nb} description "${n.desc}"`);
          if(hasUs(n)){const lo=LO.find(l=>+l.id===+n.us);if(lo)s(`${nb} local-address ${i2ip(lo.c.ip)}`)}if(n.mh)s(`${nb} multihop ttl 255`);
          if(n.noV4||n.vpnv4||n.evpn){if(!n.noV4)s(`${nb} family inet unicast`);if(n.vpnv4)s(`${nb} family inet-vpn unicast`);if(n.evpn)s(`${nb} family evpn signaling`)}
          if(n.rmIn)s(`${nb} import ${n.rmIn}`);
          const ex=[...(n.rmOut?[n.rmOut]:[]),...(has?[pn2]:[]),...(n.nhs?['NHS']:[]),...(n.dio?['ENVIA-DEFAULT']:[])];if(n.nhs)pol.add('NHS');if(n.dio)pol.add('DEF');if(ex.length)s(`${nb} export [ ${ex.join(' ')} ]`);
          if(n.shut)L.push(`deactivate ${b} neighbor ${n.ip}`)})});
      if(pol.has('NHS'))s('policy-options policy-statement NHS term 1 then next-hop self');
      if(pol.has('DEF')){s('routing-options generate route 0.0.0.0/0 discard');s('policy-options policy-statement ENVIA-DEFAULT term default from route-filter 0.0.0.0/0 exact');s('policy-options policy-statement ENVIA-DEFAULT term default then accept')}}
    if(acl){d.rules.forEach((r,i)=>{const t=`firewall family inet filter LAB-FILTER term t${i+1}`;if(!isAny(r.src))s(`${t} from source-address ${netStr(pc(r.src))}`);if(!isAny(r.dst))s(`${t} from destination-address ${netStr(pc(r.dst))}`);if(r.proto!=='any')s(`${t} from protocol ${r.proto}`);if(rp(r))s(`${t} from destination-port ${r.port}`);s(`${t} then ${r.act==='permit'?'accept':'discard'}`)});s('firewall family inet filter LAB-FILTER term default then discard');
      L.push('# Filtro stateless. Em SRX (modo flow), converta as regras em security policies.')}
    if(nat){L.push('# NAT de origem — sintaxe SRX');ospfIfs(d).filter(f=>f.kind!=='loop').forEach(f=>s(`security zones security-zone ${f.nat?'untrust':'trust'} interfaces ${ifFull('junos',d,f)} host-inbound-traffic system-services ping`));
      s('security nat source rule-set LAN-WAN from zone trust');s('security nat source rule-set LAN-WAN to zone untrust');s('security nat source rule-set LAN-WAN rule masq match source-address 0.0.0.0/0');s('security nat source rule-set LAN-WAN rule masq then source-nat interface');
      s('security policies from-zone trust to-zone untrust policy lan-out match source-address any destination-address any application any');s('security policies from-zone trust to-zone untrust policy lan-out then permit')}}
  return L.join('\n')};

/* ---- Huawei VRP ---- */
GEN.huawei=d=>{const L=hdr(d,'huawei','#'),sw=isSw(d.type),acl=aclOn(d),nat=anyNat(d),B=bgpV(d),VX=vxD(d),LO=dLoops(d),MP=mplsIfs(d).length>0;L.push('#',`sysname ${d.name}`,'#');
  if(MP){L.push(`mpls lsr-id ${i2ip(ldpRid(d))}`,'mpls','#','mpls ldp','#')}
  if(VX)L.push('evpn-overlay enable','#');
  dvrfs(d).forEach(x=>{L.push(`ip vpn-instance ${x.name}`,' ipv4-family',`  route-distinguisher ${rdOf(d,x.name,B)}`);const l3=+x.l3vni>0;rtE(x).forEach(r=>L.push(`  vpn-target ${r} export-extcommunity${l3?' evpn':''}`));rtI(x).forEach(r=>L.push(`  vpn-target ${r} import-extcommunity${l3?' evpn':''}`));if(l3)L.push(` vxlan vni ${x.l3vni}`);L.push('#')});const bnd=n=>n?[` ip binding vpn-instance ${n}`]:[];
  if(sw&&(d.vlans||[]).length){L.push(`vlan batch ${d.vlans.map(x=>x.id).join(' ')}`,'#');d.vlans.forEach(x=>L.push(`vlan ${x.id}`,` description ${vname(x)}`,'#'))}
  if(VX){const vt=vtepIp(d);l2vnis(d).forEach(x=>{L.push(`bridge-domain ${x.vlan}`,` l2 binding vlan ${x.vlan}`,` vxlan vni ${x.vni}`,' evpn',`  route-distinguisher ${vt!=null?i2ip(vt):'0.0.0.0'}:${x.vlan}`,`  vpn-target ${x.rt||(B?B.asn:65000)+':'+x.vni} export-extcommunity`,`  vpn-target ${x.rt||(B?B.asn:65000)+':'+x.vni} import-extcommunity`,'#')})}
  (d.pfx||[]).forEach(p=>seqd(p.rules).forEach(r=>{const c=pc(r.pfx);L.push(`ip ip-prefix ${p.name} index ${r.seq} ${r.act} ${i2ip(c.net)} ${c.len}${r.ge?' greater-equal '+r.ge:''}${r.le?' less-equal '+r.le:''}`)}));
  (d.clists||[]).forEach(c=>(c.rules||[]).forEach(r=>L.push(`ip community-filter basic ${c.name} ${r.act} ${r.comm}`)));
  (d.rmaps||[]).forEach(m=>seqd(m.rules).forEach(r=>{L.push(`route-policy ${m.name} ${r.act} node ${r.seq}`);if(r.mPfx)L.push(` if-match ip-prefix ${r.mPfx}`);if(r.mComm)L.push(` if-match community-filter ${r.mComm}`);if(r.sLp!==''&&r.sLp!=null)L.push(` apply local-preference ${r.sLp}`);if(r.sMed!==''&&r.sMed!=null)L.push(` apply cost ${r.sMed}`);if(r.sComm)L.push(` apply community ${r.sComm}${r.sAdd?' additive':''}`);if(r.sPre)L.push(` apply as-path ${r.sPre} additive`);L.push('#')}));
  const hA=(kw,a)=>{if(isAny(a))return'';const c=pc(a);return c.len===32?` ${kw} ${i2ip(c.ip)} 0`:` ${kw} ${i2ip(c.net)} ${wc(c)}`};
  if(acl){L.push('acl number 3000');d.rules.forEach((r,i)=>L.push(` rule ${5*(i+1)} ${r.act} ${r.proto==='any'?'ip':r.proto}${hA('source',r.src)}${hA('destination',r.dst)}${rp(r)?' destination-port eq '+r.port:''}`));L.push(` rule ${5*(d.rules.length+1)} deny ip`,'#')}
  if(nat){L.push('acl number 2000');ospfIfs(d).filter(f=>!f.nat&&f.kind!=='loop').forEach((f,i)=>L.push(` rule ${5*(i+1)} permit source ${i2ip(f.c.net)} ${wc(f.c)}`));L.push('#')}
  const x=(out)=>{const o=[];if(nat&&out)o.push(' nat outbound 2000');if(acl&&!out)o.push(' traffic-filter inbound acl 3000');return o};
  const mp=on=>on?[' mpls',' mpls ldp']:[];
  const vr=(vip,g)=>vip&&ip2i(vip)!==null?[` vrrp vrid ${g} virtual-ip ${vip}`]:[];
  LO.forEach(l=>{L.push(`interface LoopBack${l.id}`);if(l.desc)L.push(` description ${l.desc}`);L.push(...bnd(l.vrf),` ip address ${i2ip(l.c.ip)} ${msk(l.c)}`,'#')});
  lports(d).forEach(lp=>{const p=lp.p,n=lp.lag?lagName('huawei',d,lp.lag):pn('huawei',d,lp.k);L.push(`interface ${n}`);if(lp.lag)L.push(' mode lacp');if(p.desc)L.push(` description ${p.desc}`);
    if(sw&&p.mode==='access'){L.push(' port link-type access');if(+p.vlan!==1)L.push(` port default vlan ${p.vlan}`);if(!lp.lag)L.push(' stp edged-port enable')}
    else if(sw&&p.mode==='trunk'){L.push(' port link-type trunk',` port trunk allow-pass vlan ${allAllowed(p)?'2 to 4094':parseList(p.allowed).join(' ')}`);if(+p.native>1)L.push(` port trunk pvid vlan ${p.native}`)}
    else{if(sw)L.push(' undo portswitch');L.push(...bnd(p.vrf));const c=pc(p.ip);if(c)L.push(` ip address ${i2ip(c.ip)} ${msk(c)}`,...vr(p.vip,vrid(lp.k+1)),...x(p.nat),...mp(p.mpls&&!p.vrf&&fwd(d.type)))}
    L.push(p.shut?' shutdown':' undo shutdown','#');
    (lp.members||[]).forEach(k=>{L.push(`interface ${pn('huawei',d,k)}`);if(d.ports[k].desc)L.push(` description ${d.ports[k].desc}`);L.push(` eth-trunk ${lp.lag}`,'#')});
    (p.subs||[]).forEach(s=>{const c=pc(s.ip);L.push(`interface ${n}.${s.vlan}`,` dot1q termination vid ${s.vlan}`,...bnd(s.vrf));if(c)L.push(` ip address ${i2ip(c.ip)} ${msk(c)}`,...vr(s.vip,vrid(s.vlan)),...x(s.nat),...mp(s.mpls&&!s.vrf&&fwd(d.type)));L.push(' arp broadcast enable','#')})});
  (d.svis||[]).forEach(s=>{const c=pc(s.ip);L.push(`interface Vlanif${s.vlan}`,...bnd(s.vrf));if(c)L.push(` ip address ${i2ip(c.ip)} ${msk(c)}`,...(s.agw?[' mac-address 0000-5e00-0101']:[]),...vr(s.vip,vrid(s.vlan)),...(d.type==='sw3'?x(false):[]),...mp(s.mpls&&!s.vrf));L.push('#')});
  if(VX){const lo=LO.find(l=>+l.id===+VX.src);L.push('interface Nve1');if(lo)L.push(` source ${i2ip(lo.c.ip)}`);l2vnis(d).forEach(x=>{const ps=vtepPeers(x);L.push(ps.length?` vni ${x.vni} head-end peer-list ${ps.join(' ')}`:` vni ${x.vni} head-end peer-list protocol bgp`)});L.push('#')}
  mgmtPorts(d).forEach(({p,k})=>{const c=pc(p.ip);L.push(`interface ${pn('huawei',d,k)}`,' ip binding vpn-instance _management_vpn_',` ip address ${i2ip(c.ip)} ${msk(c)}`,'#');if(p.gw)L.push(`ip route-static vpn-instance _management_vpn_ 0.0.0.0 0.0.0.0 ${p.gw}`,'#')});
  if(d.type==='sw2'&&d.gw)L.push(`ip route-static 0.0.0.0 0.0.0.0 ${d.gw}`,'#');
  if(fwd(d.type)){routesIn(d,'').forEach(r=>{const c=pc(r.dst);if(c)L.push(`ip route-static ${i2ip(c.net)} ${msk(c)} ${isNull(r.nh)?'NULL0':r.nh}`)});
    if(d.ospf?.on){L.push('#',`ospf 1${d.ospf.rid?' router-id '+d.ospf.rid:''}`);if(d.ospf.dio)L.push(' default-route-advertise');L.push(` area 0.0.0.${d.ospf.area||0}`);ospfIfs(d).forEach(f=>L.push(`  network ${i2ip(f.c.net)} ${wc(f.c)}`))}
    dvrfs(d).forEach(x=>vRoutes(d,x.name).forEach(r=>{const c=pc(r.dst);L.push(`ip route-static vpn-instance ${x.name} ${i2ip(c.net)} ${msk(c)} ${isNull(r.nh)?'NULL0':r.nh}`)}));
    ovrfs(d).forEach(o=>{L.push('#',`ospf ${o.pid}${o.cfg.rid?' router-id '+o.cfg.rid:''} vpn-instance ${o.v}`);if(o.cfg.dio)L.push(' default-route-advertise');L.push(` area 0.0.0.${o.cfg.area||0}`);vIfs(d,o.v).forEach(f=>L.push(`  network ${i2ip(f.c.net)} ${wc(f.c)}`))});
    if(B){const rs=x=>({connected:'direct',static:'static',ospf:'ospf 1'})[x];L.push('#',`bgp ${B.asn}`);if(B.rid)L.push(` router-id ${B.rid}`);
      B.groups[0].nb.forEach(n=>{L.push(` peer ${n.ip} as-number ${n.ras}`);if(n.desc)L.push(` peer ${n.ip} description ${n.desc}`);if(hasUs(n))L.push(` peer ${n.ip} connect-interface LoopBack${n.us}`);if(n.mh)L.push(` peer ${n.ip} ebgp-max-hop 255`);if(n.shut)L.push(` peer ${n.ip} ignore`)});
      const af=(g,p)=>{g.neto.forEach(x=>L.push(`${p}network ${i2ip(x.c.net)} ${msk(x.c)}${x.rm?' route-policy '+x.rm:''}`));g.rdo.forEach(x=>L.push(`${p}import-route ${rs(x.src)}${x.rm?' route-policy '+x.rm:''}`));g.nb.forEach(n=>{if(n.noV4){L.push(`${p}undo peer ${n.ip} enable`);return}L.push(`${p}peer ${n.ip} enable`);if(n.sc)L.push(`${p}peer ${n.ip} advertise-community`);if(n.rrc)L.push(`${p}peer ${n.ip} reflect-client`);if(n.nhs)L.push(`${p}peer ${n.ip} next-hop-local`);if(n.dio)L.push(`${p}peer ${n.ip} default-route-advertise`);if(n.rmIn)L.push(`${p}peer ${n.ip} route-policy ${n.rmIn} import`);if(n.rmOut)L.push(`${p}peer ${n.ip} route-policy ${n.rmOut} export`)})};
      L.push(' #',' ipv4-family unicast','  undo synchronization');af(B.groups[0],'  ');
      [['ipv4-family vpnv4',B.vpn],['l2vpn-family evpn',B.ev]].forEach(([fn,ns])=>{if(!ns.length)return;L.push(' #',` ${fn}`,'  policy vpn-target');ns.forEach(n=>{L.push(`  peer ${n.ip} enable`);if(n.sc)L.push(`  peer ${n.ip} advertise-community`);if(n.rrc)L.push(`  peer ${n.ip} reflect-client`);if(fn==='l2vpn-family evpn')L.push(`  peer ${n.ip} advertise irb`)})});
      B.groups.slice(1).forEach(g=>{L.push(' #',` ipv4-family vpn-instance ${g.vrf}`);if(+vrfObj(d,g.vrf).l3vni>0)L.push('  advertise l2vpn evpn');g.nb.forEach(n=>{L.push(`  peer ${n.ip} as-number ${n.ras}`);if(n.desc)L.push(`  peer ${n.ip} description ${n.desc}`);if(n.mh)L.push(`  peer ${n.ip} ebgp-max-hop 255`);if(n.shut)L.push(`  peer ${n.ip} ignore`)});af(g,'  ')})}}
  L.push('#','return');return L.join('\n')};

/* ---- MikroTik RouterOS 7 ---- */
GEN.routeros=d=>{const L=hdr(d,'routeros','#'),sw=isSw(d.type),ifs=l3ifs(d,true),acl=aclOn(d),nat=anyNat(d),VX=vxD(d),LO=dLoops(d),B=bgpV(d);L.push('',`/system identity set name="${d.name}"`);
  const lp=lports(d),nm=x=>x.lag?lagName('routeros',d,x.lag):pn('routeros',d,x.k);
  const eth=d.ports.map((p,k)=>({p,k})).filter(x=>usedPort(d,x.k)&&(x.p.desc||x.p.shut));
  if(eth.length){L.push('/interface ethernet');eth.forEach(({p,k})=>L.push(`set [ find default-name=${pn('routeros',d,k)} ]${p.desc?` comment="${p.desc}"`:''}${p.shut?' disabled=yes':''}`))}
  const lags=lp.filter(x=>x.lag);if(lags.length){L.push('/interface bonding');lags.forEach(x=>L.push(`add name=${nm(x)} slaves=${x.members.map(k=>pn('routeros',d,k)).join(',')} mode=802.3ad lacp-rate=1sec transmit-hash-policy=layer-3-and-4`))}
  if(LO.length){L.push('/interface bridge');LO.forEach(l=>L.push(`add name=${loName('routeros',l.id)} protocol-mode=none comment="loopback${l.desc?': '+l.desc:''}"`))}
  if(sw){const bp=lp.filter(x=>x.p.mode!=='routed');
    L.push('/interface bridge','add name=bridge1 vlan-filtering=no comment="vlan-filtering liga no final"');
    if(VX){const vt=vtepIp(d);L.push('/interface vxlan');l2vnis(d).forEach(x=>L.push(`add name=vxlan${x.vni} vni=${x.vni} port=4789${vt!=null?' local-address='+i2ip(vt):''}${x.rt?` comment="rt=${x.rt}"`:''}`));
      const ev=EVX[d.id]||{};const vt2=[];l2vnis(d).forEach(x=>{vtepPeers(x).forEach(p=>vt2.push(`add interface=vxlan${x.vni} remote-ip=${p}`));(ev[x.vni]||[]).filter(p=>p.how==='evpn').forEach(p=>vt2.push(`add interface=vxlan${x.vni} remote-ip=${i2ip(p.ip)} comment="aprendido por EVPN no lab"`))});if(vt2.length)L.push('/interface vxlan vteps',...vt2)}
    L.push('/interface bridge port');
    bp.forEach(x=>L.push(x.p.mode==='access'?`add bridge=bridge1 interface=${nm(x)} pvid=${x.p.vlan} frame-types=admit-only-untagged-and-priority-tagged`:`add bridge=bridge1 interface=${nm(x)}${+x.p.native>1?` pvid=${x.p.native}`:' frame-types=admit-only-vlan-tagged'}`));
    if(VX)l2vnis(d).forEach(x=>L.push(`add bridge=bridge1 interface=vxlan${x.vni} pvid=${x.vlan}`));
    const ids=[...new Set((d.vlans||[]).map(v=>+v.id))];
    if(ids.length){L.push('/interface bridge vlan');ids.forEach(id=>{const tg=bp.filter(x=>x.p.mode==='trunk'&&allowedHas(x.p,id)&&id!==(+x.p.native||1)).map(nm);if((d.svis||[]).some(s=>+s.vlan===id))tg.unshift('bridge1');
      const ut=bp.filter(x=>(x.p.mode==='access'&&+x.p.vlan===id)||(x.p.mode==='trunk'&&+x.p.native===id&&id!==1)).map(nm);if(VX&&l2vnis(d).some(x=>+x.vlan===id))ut.push(...l2vnis(d).filter(x=>+x.vlan===id).map(x=>'vxlan'+x.vni));
      if(tg.length||ut.length)L.push(`add bridge=bridge1 vlan-ids=${id}${tg.length?' tagged='+tg.join(','):''}${ut.length?' untagged='+ut.join(','):''}`)})}
    if((d.svis||[]).length){L.push('/interface vlan');d.svis.forEach(s=>L.push(`add interface=bridge1 name=vlan${s.vlan} vlan-id=${s.vlan}`))}}
  const subs=[];lp.forEach(x=>(x.p.subs||[]).forEach(s=>subs.push(`add interface=${nm(x)} name=${nm(x)}.${s.vlan} vlan-id=${s.vlan}`)));
  if(subs.length)L.push('/interface vlan',...subs);
  if(ifs.length){L.push('/ip address');ifs.forEach(f=>L.push(`add address=${cidrStr(f.c)} interface=${ifFull('routeros',d,f)}${f.mgmt?' comment="gerencia"':f.agw?' comment="anycast gateway"':''}`))}
  const vr=ifs.filter(f=>f.vip!=null);if(vr.length){L.push('/interface vrrp');vr.forEach(f=>L.push(`add interface=${ifFull('routeros',d,f)} name=vrrp${vrid(f.vlan||f.k+1)} vrid=${vrid(f.vlan||f.k+1)}`));L.push('/ip address');vr.forEach(f=>L.push(`add address=${i2ip(f.vip)}/32 interface=vrrp${vrid(f.vlan||f.k+1)}`))}
  const VR=dvrfs(d);if(VR.length){L.push('/ip vrf');VR.forEach(x=>L.push(`add name=${x.name} interfaces=${vIfs(d,x.name).map(f=>ifFull('routeros',d,f)).join(',')||'none'}${+x.l3vni>0?` comment="l3vni=${x.l3vni}${B&&(B.groups.find(g=>g.vrf===x.name)||{rd:[]}).rd.length&&!(B.groups.find(g=>g.vrf===x.name)).nb.length?' redistribute='+B.groups.find(g=>g.vrf===x.name).rd.join(','):''}"`:''}`))}
  const MP=mplsIfs(d);if(MP.length){L.push('/mpls ldp',`add afi=ip lsr-id=${i2ip(ldpRid(d))} transport-addresses=${i2ip(ldpRid(d))}`,'/mpls ldp interface');MP.forEach(f=>L.push(`add interface=${ifFull('routeros',d,f)}`))}
  const rts=[];if(d.type==='sw2'&&d.gw)rts.push(`add dst-address=0.0.0.0/0 gateway=${d.gw}`);
  VR.forEach(x=>vRoutes(d,x.name).forEach(r=>rts.push(`add dst-address=${netStr(pc(r.dst))} ${isNull(r.nh)?'blackhole':'gateway='+r.nh+'@'+x.name} routing-table=${x.name}`)));
  if(fwd(d.type))routesIn(d,'').forEach(r=>{const c=pc(r.dst);if(c)rts.push(`add dst-address=${netStr(c)} ${isNull(r.nh)?'blackhole':'gateway='+r.nh}`)});
  mgmtPorts(d).forEach(({p})=>{if(p.gw)rts.push(`add dst-address=0.0.0.0/0 gateway=${p.gw} distance=250 comment="gerencia"`)});
  if(rts.length)L.push('/ip route',...rts);
  if(fwd(d.type)&&d.ospf?.on){const a=d.ospf.area||0;L.push('/routing ospf instance',`add name=lab version=2${d.ospf.rid?' router-id='+d.ospf.rid:''}${d.ospf.dio?' originate-default=always':''}`,'/routing ospf area',`add name=area${a} area-id=0.0.0.${a} instance=lab`,'/routing ospf interface-template',`add area=area${a} networks=${ospfIfs(d).map(f=>netStr(f.c)).join(',')}`)}
  ovrfs(d).forEach(o=>{const a=o.cfg.area||0;L.push('/routing ospf instance',`add name=ospf-${o.v} version=2 vrf=${o.v}${o.cfg.rid?' router-id='+o.cfg.rid:''}${o.cfg.dio?' originate-default=always':''}`,'/routing ospf area',`add name=area${a}-${o.v} area-id=0.0.0.${a} instance=ospf-${o.v}`,'/routing ospf interface-template',`add area=area${a}-${o.v} networks=${vIfs(d,o.v).map(f=>netStr(f.c)).join(',')}`)});
  /* route-maps viram cadeias de /routing filter rule (prefix-lists e community-lists ficam embutidas; o comment guarda os nomes) */
  const rfr=[];(d.rmaps||[]).forEach(m=>{seqd(m.rules).forEach(r=>{const pl=r.mPfx?(d.pfx||[]).find(x=>x.name===r.mPfx):null,cl=r.mComm?(d.clists||[]).find(x=>x.name===r.mComm):null;
      const ents=pl?seqd(pl.rules).filter(e=>e.act!=='deny'):[null];const cm=cl?[...new Set((cl.rules||[]).filter(e=>e.act!=='deny').flatMap(e=>commList(e.comm)))]:[];
      const acts=r.act==='deny'?['reject']:[...(r.sLp!==''&&r.sLp!=null?[`set bgp-local-pref ${r.sLp}`]:[]),...(r.sMed!==''&&r.sMed!=null?[`set bgp-med ${r.sMed}`]:[]),...(r.sComm?[`${r.sAdd?'append':'set'} bgp-communities ${r.sComm}`]:[]),...(r.sPre?[`set bgp-path-prepend ${r.sPre.split(/\s+/).length}`]:[]),'accept'];
      ents.forEach(e=>{const cond=[...(e?[`dst in ${e.pfx}`,...(e.ge||e.le?[`dst-len in ${e.ge||pc(e.pfx).len}-${e.le||32}`]:[`dst-len == ${pc(e.pfx).len}`])]:[]),...(cm.length?[`bgp-communities includes ${cm.join(',')}`]:[])];
        const meta=[`rm=${m.name}`,`seq=${r.seq}`,...(pl?[`pl=${pl.name}`,`ple=${e.seq}`]:[]),...(cl?[`cl=${cl.name}`]:[]),...(r.sPre?[`pre=${r.sPre.replace(/\s+/g,'.')}`]:[])].join(' ');
        rfr.push(`add chain=${m.name} rule="${cond.length?'if ('+cond.join(' && ')+') { '+acts.join('; ')+' }':acts.join('; ')}" comment="${meta}"`)})});rfr.push(`add chain=${m.name} rule="reject" comment="rm=${m.name} fim"`)});
  if(rfr.length)L.push('/routing filter rule',...rfr);
  if(B){const nets=B.groups.filter(g=>g.net.length);if(nets.length){L.push('/ip firewall address-list');nets.forEach(g=>g.net.forEach(c=>L.push(`add list=bgp-redes${g.vrf?'-'+g.vrf:''} address=${netStr(c)}`)))}
    L.push('/routing bgp template',`set default as=${B.asn}${B.rid?' router-id='+B.rid:''}`);
    const vp=B.groups.filter(g=>g.vrf&&vrfVpn(d,g.vrf)&&!(+vrfObj(d,g.vrf).l3vni>0));if(vp.length){L.push('/routing bgp vpn');vp.forEach(g=>{const x=vrfObj(d,g.vrf);L.push(`add vrf=${g.vrf} route-distinguisher=${rdOf(d,g.vrf,B)} label-allocation-policy=per-vrf${rtI(x).length?' import.route-targets='+rtI(x).join(','):''}${rtE(x).length?' export.route-targets='+rtE(x).join(','):''}${g.rd.length?' export.redistribute='+g.rd.join(','):''}`)})}
    L.push('/routing bgp connection');
    B.groups.forEach(g=>g.nb.forEach(n=>{const ext=isEbgp(B,n);const o=[`add name=peer-${n.ip.replace(/\./g,'-')}${g.vrf?'-'+g.vrf:''} templates=default remote.address=${n.ip} remote.as=${n.ras} local.role=${ext?'ebgp':n.rrc?'ibgp-rr':'ibgp'}`];
      const af=[...(n.noV4?[]:['ip']),...(n.vpnv4?['vpnv4']:[]),...(n.evpn?['evpn']:[])];if(af.join(',')!=='ip')o.push(`address-families=${af.join(',')||'ip'}`);
      if(hasUs(n)){const lo=LO.find(l=>+l.id===+n.us);if(lo)o.push(`local.address=${i2ip(lo.c.ip)}`)}if(n.mh)o.push('multihop=yes');
      if(g.vrf)o.push(`vrf=${g.vrf} routing-table=${g.vrf}`);if(g.rd.length)o.push(`output.redistribute=${g.rd.join(',')}`);if(g.net.length)o.push(`output.network=bgp-redes${g.vrf?'-'+g.vrf:''}`);if(n.dio)o.push('output.default-originate=always');if(n.nhs)o.push('nexthop-choice=force-self');
      if(n.rmIn)o.push(`input.filter=${n.rmIn}`);if(n.rmOut)o.push(`output.filter-chain=${n.rmOut}`);if(n.desc)o.push(`comment="${n.desc}"`);if(n.shut)o.push('disabled=yes');L.push(o.join(' '))}));
    if(B.ev.length||l3v(d).length)L.push('# EVPN: RouterOS 7 só faz VXLAN com VTEPs estáticos; os vizinhos em EVPN servem para os demais equipamentos do lab')}
  if(acl){const ra=a=>isAny(a)?'':netStr(pc(a));L.push('/ip firewall filter','add chain=forward action=accept connection-state=established,related comment="retorno"');
    d.rules.forEach((r,i)=>L.push(`add chain=forward action=${r.act==='permit'?'accept':'drop'}${ra(r.src)?' src-address='+ra(r.src):''}${ra(r.dst)?' dst-address='+ra(r.dst):''}${r.proto!=='any'?' protocol='+r.proto:''}${rp(r)?' dst-port='+r.port:''} comment="${r.desc||'regra '+(i+1)}"`));
    L.push('add chain=forward action=drop comment="deny implicito"')}
  if(nat){L.push('/ip firewall nat');ifs.filter(f=>f.nat).forEach(f=>L.push(`add chain=srcnat out-interface=${ifFull('routeros',d,f)} action=masquerade`))}
  if(sw)L.push('/interface bridge set bridge1 vlan-filtering=yes');
  return L.join('\n')};

/* ---- Fortinet FortiOS ---- */
GEN.fortios=d=>{const L=hdr(d,'fortios','#');if(isSw(d.type)){L.push('#','# FortiOS é uma plataforma de firewall e não modela este switch.','# Exporte este equipamento em outro sistema ou use o modo Automático.');return L.join('\n')}
  const ifs=l3ifs(d,true),nat=anyNat(d),nm=x=>x.lag?lagName('fortios',d,x.lag):pn('fortios',d,x.k),LO=dLoops(d),B=bgpV(d);
  dvrfs(d).forEach((x,i)=>L.push(`# VRF ${i+1} = ${x.name}${+x.l3vni>0?' l3vni='+x.l3vni:''}`));
  if(mplsIfs(d).length)L.push('# MPLS/LDP: não configurado aqui — o FortiGate não participa do core MPLS/LDP');
  L.push('config system global',`    set hostname "${d.name}"`,'end','config system interface');
  const vrfN=v=>v&&vrfIdx(d,v)>=0?[`        set vrf ${vrfIdx(d,v)+1}`]:[];
  LO.forEach(l=>{L.push(`    edit "${loName('fortios',l.id)}"`,'        set vdom "root"','        set type loopback',...vrfN(l.vrf),`        set ip ${i2ip(l.c.ip)} ${msk(l.c)}`,'        set allowaccess ping');if(l.desc)L.push(`        set description "${l.desc}"`);L.push('    next')});
  lports(d).forEach(x=>{const p=x.p,c=pc(p.ip);L.push(`    edit "${nm(x)}"`,'        set vdom "root"');if(x.lag)L.push('        set type aggregate',`        set member ${x.members.map(k=>`"${pn('fortios',d,k)}"`).join(' ')}`,'        set lacp-mode active');
    L.push('        set mode static',...vrfN(p.vrf));if(c)L.push(`        set ip ${i2ip(c.ip)} ${msk(c)}`,'        set allowaccess ping');if(p.desc)L.push(`        set alias "${p.desc.slice(0,25)}"`);if(p.shut)L.push('        set status down');L.push('    next');
    (p.subs||[]).forEach(s=>{const c=pc(s.ip);L.push(`    edit "${nm(x)}.${s.vlan}"`,'        set vdom "root"',`        set interface "${nm(x)}"`,`        set vlanid ${s.vlan}`,...vrfN(s.vrf));if(c)L.push(`        set ip ${i2ip(c.ip)} ${msk(c)}`,'        set allowaccess ping');L.push('    next')})});
  mgmtPorts(d).forEach(({p,k})=>{const c=pc(p.ip);L.push(`    edit "${pn('fortios',d,k)}"`,`        set ip ${i2ip(c.ip)} ${msk(c)}`,'        set allowaccess ping https ssh','        set dedicated-to management','    next')});
  L.push('end');
  const rs=(d.routes||[]).filter(r=>pc(r.dst));const mgw=mgmtPorts(d).filter(x=>x.p.gw);
  if(rs.length||mgw.length){L.push('config router static');let n=0;rs.forEach(r=>{const c=pc(r.dst),nh=ip2i(r.nh),f=nh!==null&&ifs.find(f=>!f.mgmt&&f.vrf===(r.vrf||'')&&inNet(nh,f.c));L.push(`    edit ${++n}`,`        set dst ${i2ip(c.net)} ${msk(c)}`,...(isNull(r.nh)?['        set blackhole enable']:[`        set gateway ${r.nh}`]));if(r.vrf&&vrfIdx(d,r.vrf)>=0)L.push(`        set vrf ${vrfIdx(d,r.vrf)+1}`);if(f)L.push(`        set device "${ifFull('fortios',d,f)}"`);L.push('    next')});L.push('end')}
  if((d.pfx||[]).length){L.push('config router prefix-list');d.pfx.forEach(p=>{L.push(`    edit "${p.name}"`,'        config rule');seqd(p.rules).forEach(r=>{const c=pc(r.pfx);L.push(`            edit ${r.seq}`,`                set action ${r.act}`,`                set prefix ${i2ip(c.net)} ${msk(c)}`);if(r.ge)L.push(`                set ge ${r.ge}`);if(r.le)L.push(`                set le ${r.le}`);L.push('            next')});L.push('        end','    next')});L.push('end')}
  if((d.clists||[]).length){L.push('config router community-list');d.clists.forEach(c=>{L.push(`    edit "${c.name}"`,'        set type standard','        config rule');(c.rules||[]).forEach((r,i)=>L.push(`            edit ${i+1}`,`                set action ${r.act}`,`                set match "${r.comm}"`,'            next'));L.push('        end','    next')});L.push('end')}
  if((d.rmaps||[]).length){L.push('config router route-map');d.rmaps.forEach(m=>{L.push(`    edit "${m.name}"`,'        config rule');seqd(m.rules).forEach(r=>{L.push(`            edit ${r.seq}`,`                set action ${r.act}`);if(r.mPfx)L.push(`                set match-ip-address "${r.mPfx}"`);if(r.mComm)L.push(`                set match-community "${r.mComm}"`);
      if(r.sLp!==''&&r.sLp!=null)L.push(`                set set-local-preference ${r.sLp}`);if(r.sMed!==''&&r.sMed!=null)L.push(`                set set-metric ${r.sMed}`);if(r.sComm){L.push(`                set set-community "${r.sComm}"`);if(r.sAdd)L.push('                set set-community-additive enable')}if(r.sPre)L.push(`                set set-aspath "${r.sPre}"`);L.push('            next')});L.push('        end','    next')});L.push('end')}
  const rules=d.rules||[];
  if(rules.length){const an=a=>{const c=pc(a);return`NET_${i2ip(c.net)}_${c.len}`};const addrs=[...new Set(rules.flatMap(r=>[r.src,r.dst]).filter(a=>!isAny(a)))];
    if(addrs.length){L.push('config firewall address');addrs.forEach(a=>{const c=pc(a);L.push(`    edit "${an(a)}"`,`        set subnet ${i2ip(c.net)} ${msk(c)}`,'    next')});L.push('end')}
    const svc=r=>r.proto==='any'?'ALL':r.proto==='icmp'?'PING':rp(r)?`${r.proto.toUpperCase()}-${r.port}`:`ALL_${r.proto.toUpperCase()}`;
    const cs=[...new Set(rules.filter(rp).map(svc))];if(cs.length){L.push('config firewall service custom');cs.forEach(s=>{const[pr,po]=s.split('-');L.push(`    edit "${s}"`,`        set ${pr.toLowerCase()}-portrange ${po}`,'    next')});L.push('end')}
    computeOspf();const intf=a=>{if(isAny(a))return'"any"';const r=lookup(d,pc(a).net);return r&&r.ifc?`"${ifFull('fortios',d,r.ifc)}"`:'"any"'};
    const dintf=a=>{if(isAny(a)){const r=lookup(d,ip2i('8.8.8.8'));return r&&r.ifc?`"${ifFull('fortios',d,r.ifc)}"`:'"any"'}return intf(a)};
    L.push('config firewall policy');rules.forEach((r,i)=>{const out=dintf(r.dst);const natOut=nat&&ifs.some(f=>f.nat&&`"${ifFull('fortios',d,f)}"`===out);
      L.push(`    edit ${i+1}`,`        set name "regra-${i+1}"`,`        set srcintf ${intf(r.src)}`,`        set dstintf ${out}`,`        set srcaddr "${isAny(r.src)?'all':an(r.src)}"`,`        set dstaddr "${isAny(r.dst)?'all':an(r.dst)}"`,`        set action ${r.act==='permit'?'accept':'deny'}`,'        set schedule "always"',`        set service "${svc(r)}"`);
      if(r.act==='permit'&&natOut)L.push('        set nat enable');if(r.desc)L.push(`        set comments "${r.desc}"`);L.push('    next')});L.push('end')}
  if(d.ospf?.on&&ospfIfs(d).length){const a=`0.0.0.${d.ospf.area||0}`;L.push('config router ospf',`    set router-id ${d.ospf.rid||i2ip(ospfIfs(d)[0].c.ip)}`);if(d.ospf.dio)L.push('    set default-information-originate enable');L.push('    config area',`        edit ${a}`,'        next','    end','    config network');ospfIfs(d).forEach((f,i)=>L.push(`        edit ${i+1}`,`            set prefix ${i2ip(f.c.net)} ${msk(f.c)}`,`            set area ${a}`,'        next'));L.push('    end','end')}
  if(B){L.push('config router bgp',`    set as ${B.asn}`);if(B.rid)L.push(`    set router-id ${B.rid}`);L.push('    config neighbor');
    B.groups.forEach(g=>g.nb.forEach(n=>{L.push(`        edit "${n.ip}"`,`            set remote-as ${n.ras}`);if(g.vrf)L.push(`            # vizinho na VRF ${g.vrf} (vrf ${vrfIdx(d,g.vrf)+1}): use "config vrf" / vrf-leak conforme a versão do FortiOS`);if(n.desc)L.push(`            set description "${n.desc}"`);
      if(hasUs(n))L.push(`            set update-source "${loName('fortios',n.us)}"`);if(n.mh)L.push('            set ebgp-enforce-multihop enable');if(n.noV4)L.push('            set activate disable');if(n.vpnv4)L.push('            set activate-vpnv4 enable');if(n.evpn)L.push('            set activate-evpn enable');
      if(n.sc)L.push('            set send-community enable');if(n.rrc)L.push('            set route-reflector-client enable');if(n.rmIn)L.push(`            set route-map-in "${n.rmIn}"`);if(n.rmOut)L.push(`            set route-map-out "${n.rmOut}"`);
      if(n.nhs)L.push('            set next-hop-self enable');if(n.dio)L.push('            set capability-default-originate enable');if(n.shut)L.push('            set shutdown enable');L.push('        next')}));L.push('    end');
    const nets=B.groups.flatMap(g=>g.neto);if(nets.length){L.push('    config network');nets.forEach((x,i)=>{L.push(`        edit ${i+1}`,`            set prefix ${i2ip(x.c.net)} ${msk(x.c)}`);if(x.rm)L.push(`            set route-map "${x.rm}"`);L.push('        next')});L.push('    end')}
    const rd0=B.groups[0].rdo;rd0.forEach(x=>{L.push(`    config redistribute "${x.src}"`,'        set status enable');if(x.rm)L.push(`        set route-map "${x.rm}"`);L.push('    end')});
    const vp=dvrfs(d).filter(x=>x.rd||rtI(x).length||rtE(x).length);if(vp.length){L.push('    config vrf');vp.forEach(x=>{L.push(`        edit "${vrfIdx(d,x.name)+1}"`,'            set role pe',`            set rd "${rdOf(d,x.name,B)}"`);if(rtE(x).length)L.push(`            set export-rt ${rtE(x).map(r=>'"'+r+'"').join(' ')}`);if(rtI(x).length)L.push(`            set import-rt ${rtI(x).map(r=>'"'+r+'"').join(' ')}`);L.push('        next')});L.push('    end')}
    B.groups.slice(1).forEach(g=>g.rd.forEach(x=>L.push(`    # redistribute ${x} na VRF ${g.vrf} (vrf ${vrfIdx(d,g.vrf)+1})`)));L.push('end')}
  const VX=vxD(d);if(VX){L.push('config system vxlan');l2vnis(d).forEach(x=>{L.push(`    edit "vxlan${x.vni}"`,`        set interface "${loName('fortios',VX.src)}"`,`        set vni ${x.vni}`);const ps=allPeers(d);if(ps.length)L.push(`        set remote-ip ${ps.map(p=>'"'+p+'"').join(' ')}`);L.push('    next')});L.push('end')}
  if(ifs.some(f=>f.vip!=null))L.push('# VRRP: configure em "config system interface → config vrrp" no FortiOS.');
  return L.join('\n')};

/* ---- VyOS ---- */
GEN.vyos=d=>{const L=hdr(d,'vyos','#'),sw=isSw(d.type),acl=aclOn(d),nat=anyNat(d),s=x=>L.push('set '+x);L.push('');const B=bgpV(d),VX=vxD(d),LO=dLoops(d);
  s(`system host-name '${d.name}'`);
  const ifp=x=>x.lag?`bonding ${lagName('vyos',d,x.lag)}`:`ethernet ${pn('vyos',d,x.k)}`;
  LO.forEach(l=>{s(`interfaces dummy dum${l.id} address '${cidrStr(l.c)}'`);if(l.desc)s(`interfaces dummy dum${l.id} description '${l.desc}'`);if(l.vrf)s(`interfaces dummy dum${l.id} vrf ${l.vrf}`)});
  lports(d).forEach(x=>{const p=x.p,n=x.lag?lagName('vyos',d,x.lag):pn('vyos',d,x.k);
    if(x.lag){s(`interfaces bonding ${n} mode '802.3ad'`);x.members.forEach(k=>s(`interfaces bonding ${n} member interface ${pn('vyos',d,k)}`))}
    if(p.desc)s(`interfaces ${ifp(x)} description '${p.desc}'`);if(p.shut)s(`interfaces ${ifp(x)} disable`);
    if(sw&&p.mode!=='routed'){if(p.mode==='access')s(`interfaces bridge br0 member interface ${n} native-vlan ${p.vlan}`);else{if(+p.native>1)s(`interfaces bridge br0 member interface ${n} native-vlan ${p.native}`);(allAllowed(p)?(d.vlans||[]).map(v=>+v.id):parseList(p.allowed)).forEach(v=>s(`interfaces bridge br0 member interface ${n} allowed-vlan ${v}`))}}
    else{const c=pc(p.ip);if(p.vrf)s(`interfaces ${ifp(x)} vrf ${p.vrf}`);if(c)s(`interfaces ${ifp(x)} address '${cidrStr(c)}'`);(p.subs||[]).forEach(y=>{const c=pc(y.ip);if(y.vrf)s(`interfaces ${ifp(x)} vif ${y.vlan} vrf ${y.vrf}`);if(c)s(`interfaces ${ifp(x)} vif ${y.vlan} address '${cidrStr(c)}'`)})}});
  if(sw){s('interfaces bridge br0 enable-vlan');(d.svis||[]).forEach(x=>{const c=pc(x.ip);if(x.vrf)s(`interfaces bridge br0 vif ${x.vlan} vrf ${x.vrf}`);if(c)s(`interfaces bridge br0 vif ${x.vlan} address '${cidrStr(c)}'`);if(c&&x.agw)s(`interfaces bridge br0 vif ${x.vlan} mac '00:00:5e:00:01:01'`)})}
  if(VX){const vt=vtepIp(d);l2vnis(d).forEach(x=>{const n=`vxlan${x.vni}`;s(`interfaces vxlan ${n} vni ${x.vni}`);if(vt!=null)s(`interfaces vxlan ${n} source-address ${i2ip(vt)}`);s(`interfaces vxlan ${n} port 4789`);s(`interfaces vxlan ${n} parameters nolearning`);vtepPeers(x).forEach(p=>s(`interfaces vxlan ${n} remote ${p}`));s(`interfaces bridge br0 member interface ${n} native-vlan ${x.vlan}`)})}
  const MP=mplsIfs(d);if(MP.length){s(`protocols mpls ldp router-id ${i2ip(ldpRid(d))}`);s(`protocols mpls ldp discovery transport-ipv4-address ${i2ip(ldpRid(d))}`);MP.forEach(f=>{s(`protocols mpls interface ${ifFull('vyos',d,f)}`);s(`protocols mpls ldp interface ${ifFull('vyos',d,f)}`)})}
  dvrfs(d).forEach((x,i)=>{s(`vrf name ${x.name} table ${1000+i}`);if(+x.l3vni>0)s(`vrf name ${x.name} vni ${x.l3vni}`);vRoutes(d,x.name).forEach(r=>s(`vrf name ${x.name} protocols static route ${netStr(pc(r.dst))} ${isNull(r.nh)?'blackhole':'next-hop '+r.nh}`));
    const oc=ospfCfg(d,x.name);if(oc){if(oc.rid)s(`vrf name ${x.name} protocols ospf parameters router-id ${oc.rid}`);vIfs(d,x.name).forEach(f=>s(`vrf name ${x.name} protocols ospf area ${oc.area||0} network '${netStr(f.c)}'`));if(oc.dio)s(`vrf name ${x.name} protocols ospf default-information originate`)}});
  l3ifs(d,true).filter(f=>f.vip!=null).forEach(f=>{const g=vrid(f.vlan||f.k+1);s(`high-availability vrrp group G${g} vrid ${g}`);s(`high-availability vrrp group G${g} interface ${ifFull('vyos',d,f)}`);s(`high-availability vrrp group G${g} address ${i2ip(f.vip)}/${f.c.len}`)});
  mgmtPorts(d).forEach(({p,k})=>{s(`interfaces ethernet ${pn('vyos',d,k)} address '${cidrStr(pc(p.ip))}'`);s(`interfaces ethernet ${pn('vyos',d,k)} vrf MGMT`);s('vrf name MGMT table 100');if(p.gw)s(`vrf name MGMT protocols static route 0.0.0.0/0 next-hop ${p.gw}`)});
  if(d.type==='sw2'&&d.gw)s(`protocols static route 0.0.0.0/0 next-hop ${d.gw}`);
  if(fwd(d.type)){routesIn(d,'').forEach(r=>{const c=pc(r.dst);if(c)s(`protocols static route ${netStr(c)} ${isNull(r.nh)?'blackhole':'next-hop '+r.nh}`)});
    if(d.ospf?.on){if(d.ospf.rid)s(`protocols ospf parameters router-id ${d.ospf.rid}`);ospfIfs(d).forEach(f=>s(`protocols ospf area ${d.ospf.area||0} network '${netStr(f.c)}'`));if(d.ospf.dio)s('protocols ospf default-information originate')}
    if(acl){const b='firewall ipv4 forward filter';s(`${b} default-action 'drop'`);s(`${b} rule 1 action 'accept'`);s(`${b} rule 1 state 'established'`);s(`${b} rule 1 state 'related'`);
      d.rules.forEach((r,i)=>{const n=10*(i+1);s(`${b} rule ${n} action '${r.act==='permit'?'accept':'drop'}'`);if(!isAny(r.src))s(`${b} rule ${n} source address '${netStr(pc(r.src))}'`);if(!isAny(r.dst))s(`${b} rule ${n} destination address '${netStr(pc(r.dst))}'`);if(r.proto!=='any')s(`${b} rule ${n} protocol '${r.proto}'`);if(rp(r))s(`${b} rule ${n} destination port '${r.port}'`);if(r.desc)s(`${b} rule ${n} description '${r.desc}'`)})}
    (d.pfx||[]).forEach(p=>seqd(p.rules).forEach(r=>{const b=`policy prefix-list ${p.name} rule ${r.seq}`;s(`${b} action '${r.act}'`);s(`${b} prefix '${r.pfx}'`);if(r.ge)s(`${b} ge '${r.ge}'`);if(r.le)s(`${b} le '${r.le}'`)}));
    (d.clists||[]).forEach(c=>(c.rules||[]).forEach((r,i)=>{const b=`policy community-list ${c.name} rule ${10*(i+1)}`;s(`${b} action '${r.act}'`);s(`${b} regex '${r.comm}'`)}));
    (d.rmaps||[]).forEach(m=>seqd(m.rules).forEach(r=>{const b=`policy route-map ${m.name} rule ${r.seq}`;s(`${b} action '${r.act}'`);if(r.mPfx)s(`${b} match ip address prefix-list '${r.mPfx}'`);if(r.mComm)s(`${b} match community community-list '${r.mComm}'`);
      if(r.sLp!==''&&r.sLp!=null)s(`${b} set local-preference '${r.sLp}'`);if(r.sMed!==''&&r.sMed!=null)s(`${b} set metric '${r.sMed}'`);if(r.sComm)s(`${b} set community ${r.sAdd?'add':'replace'} '${r.sComm}'`);if(r.sPre)s(`${b} set as-path prepend '${r.sPre}'`)}));
    if(B)B.groups.forEach(g=>{const b=g.vrf?`vrf name ${g.vrf} protocols bgp`:'protocols bgp';s(`${b} system-as '${B.asn}'`);if(B.rid)s(`${b} parameters router-id '${B.rid}'`);
      g.nb.forEach(n=>{const nb=`${b} neighbor ${n.ip}`;s(`${nb} remote-as '${n.ras}'`);if(!n.noV4)s(`${nb} address-family ipv4-unicast`);if(n.desc)s(`${nb} description '${n.desc}'`);if(hasUs(n))s(`${nb} update-source dum${n.us}`);if(n.mh)s(`${nb} ebgp-multihop 255`);
        if(!n.noV4){if(n.nhs)s(`${nb} address-family ipv4-unicast nexthop-self`);if(n.dio)s(`${nb} address-family ipv4-unicast default-originate`);if(n.rrc)s(`${nb} address-family ipv4-unicast route-reflector-client`);if(n.rmIn)s(`${nb} address-family ipv4-unicast route-map import '${n.rmIn}'`);if(n.rmOut)s(`${nb} address-family ipv4-unicast route-map export '${n.rmOut}'`)}
        if(n.vpnv4){s(`${nb} address-family ipv4-vpn`);if(n.rrc)s(`${nb} address-family ipv4-vpn route-reflector-client`)}if(n.evpn){s(`${nb} address-family l2vpn-evpn`);if(n.rrc)s(`${nb} address-family l2vpn-evpn route-reflector-client`)}if(n.shut)s(`${nb} shutdown`)});
      g.neto.forEach(x=>s(`${b} address-family ipv4-unicast network '${netStr(x.c)}'${x.rm?' route-map '+x.rm:''}`));g.rdo.forEach(x=>s(`${b} address-family ipv4-unicast redistribute ${x.src}${x.rm?' route-map '+x.rm:''}`));
      if(g.vrf){const x=vrfObj(d,g.vrf),u=`${b} address-family ipv4-unicast`;if(!(+x.l3vni>0)&&(x.rd||rtI(x).length||rtE(x).length)){s(`${u} rd vpn export '${rdOf(d,g.vrf,B)}'`);if(rtI(x).length)s(`${u} route-target vpn import '${rtI(x).join(' ')}'`);if(rtE(x).length)s(`${u} route-target vpn export '${rtE(x).join(' ')}'`);s(`${u} label vpn export 'auto'`);s(`${u} export vpn`);s(`${u} import vpn`)}
        if(+x.l3vni>0){const e=`${b} address-family l2vpn-evpn`;s(`${e} advertise ipv4 unicast`);if(x.rd)s(`${e} rd '${x.rd}'`);if(rtI(x).length)s(`${e} route-target import '${rtI(x).join(' ')}'`);if(rtE(x).length)s(`${e} route-target export '${rtE(x).join(' ')}'`)}}
      else if(VX){s(`${b} address-family l2vpn-evpn advertise-all-vni`);l2vnis(d).forEach(x=>{if(x.rt)s(`${b} address-family l2vpn-evpn vni ${x.vni} route-target both '${x.rt}'`)})}});
    if(nat)l3ifs(d,true).filter(f=>f.nat).forEach((f,i)=>{s(`nat source rule ${100+i} outbound-interface name '${ifFull('vyos',d,f)}'`);s(`nat source rule ${100+i} translation address 'masquerade'`)})}
  return L.join('\n')};

/* ---- Linux (PCs e servidores) ---- */
function genLinux(d){const m=modelOf(d);const L=[`# ${d.name} — ${mdesc(d)}`,`# Gerado pela Bancada de Rede em ${today()}.`];
  const ifs=l3ifs(d,true),data=ifs.filter(f=>!f.mgmt);
  if(!data.length&&!ifs.length){L.push('#','# Este host ainda não tem IP. Configure na aba Geral ou Portas.');return L.join('\n')}
  const nm=f=>f.lag?lagName('linux',d,f.lag):spn(d,f.k),full=f=>f.kind==='sub'?`${nm(f)}.${f.vlan}`:nm(f);
  const gw=ip2i(d.gw),gwIf=gw!==null?data.find(f=>inNet(gw,f.c)):null;
  const routes=routesIn(d,'').filter(r=>pc(r.dst)&&ip2i(r.nh)!==null);
  const lags=[...new Set(d.ports.map(p=>+p.lag).filter(Boolean))];
  L.push('','# ---- netplan — /etc/netplan/01-bancada.yaml ----','network:','  version: 2','  ethernets:');
  d.ports.forEach((p,k)=>{if(isMgmt(d,k))return;const f=data.find(x=>x.kind==='port'&&x.k===k&&!x.lag);if(!f&&!+p.lag&&!(p.subs||[]).length)return;L.push(`    ${spn(d,k)}:`);
    if(f){L.push(`      addresses: [${cidrStr(f.c)}]`);if(gwIf===f||routes.some(r=>inNet(ip2i(r.nh),f.c))){L.push('      routes:');if(gwIf===f)L.push('        - to: default',`          via: ${d.gw}`);routes.filter(r=>inNet(ip2i(r.nh),f.c)).forEach(r=>L.push(`        - to: ${netStr(pc(r.dst))}`,`          via: ${r.nh}`))}}
    else if(!+p.lag)L.push('      dhcp4: false');else L.push('      dhcp4: false');if(p.shut)L.push('      optional: true')});
  if(lags.length){L.push('  bonds:');lags.forEach(n=>{const ms=lagMembers(d,n),f=data.find(x=>x.kind==='port'&&x.lag===n);L.push(`    ${lagName('linux',d,n)}:`,`      interfaces: [${ms.map(k=>spn(d,k)).join(', ')}]`,'      parameters:','        mode: 802.3ad','        lacp-rate: fast','        transmit-hash-policy: layer3+4','        mii-monitor-interval: 100');
    if(f){L.push(`      addresses: [${cidrStr(f.c)}]`);if(gwIf===f)L.push('      routes:','        - to: default',`          via: ${d.gw}`)}})}
  const subs=data.filter(f=>f.kind==='sub');if(subs.length){L.push('  vlans:');subs.forEach(f=>{L.push(`    ${full(f)}:`,`      id: ${f.vlan}`,`      link: ${nm(f)}`,`      addresses: [${cidrStr(f.c)}]`);const rr=routes.filter(r=>inNet(ip2i(r.nh),f.c));if(gwIf===f||rr.length){L.push('      routes:');if(gwIf===f)L.push('        - to: default',`          via: ${d.gw}`);rr.forEach(r=>L.push(`        - to: ${netStr(pc(r.dst))}`,`          via: ${r.nh}`))}})}
  L.push('','# ---- ou com iproute2 (temporário, até reiniciar) ----');
  lags.forEach(n=>{const b=lagName('linux',d,n);L.push(`ip link add ${b} type bond mode 802.3ad`);lagMembers(d,n).forEach(k=>L.push(`ip link set ${spn(d,k)} down && ip link set ${spn(d,k)} master ${b}`));L.push(`ip link set ${b} up`)});
  data.forEach(f=>{if(f.kind==='sub')L.push(`ip link add link ${nm(f)} name ${full(f)} type vlan id ${f.vlan}`);L.push(`ip link set ${full(f)} up`,`ip address add ${cidrStr(f.c)} dev ${full(f)}`)});
  if(d.gw)L.push(`ip route add default via ${d.gw}`);routes.forEach(r=>L.push(`ip route add ${netStr(pc(r.dst))} via ${r.nh}`));
  const bm=mgmtPorts(d);if(bm.length){const {p}=bm[0],c=pc(p.ip),bmc=(m&&m.bmc)||'BMC';L.push('',`# ---- ${bmc} (gerência fora de banda) ----`);
    if(/iDRAC/.test(bmc))L.push(`racadm set iDRAC.IPv4.DHCPEnable 0`,`racadm set iDRAC.IPv4.Address ${i2ip(c.ip)}`,`racadm set iDRAC.IPv4.Netmask ${msk(c)}`,...(p.gw?[`racadm set iDRAC.IPv4.Gateway ${p.gw}`]:[]));
    else if(/iLO/.test(bmc))L.push('# iLO via RESTful Interface Tool (ilorest):','ilorest login','ilorest select EthernetInterface.','ilorest set DHCPv4/DHCPEnabled=False',`ilorest set IPv4StaticAddresses/Address=${i2ip(c.ip)} IPv4StaticAddresses/SubnetMask=${msk(c)}${p.gw?' IPv4StaticAddresses/Gateway='+p.gw:''}`,'ilorest commit');
    L.push('# genérico (IPMI, roda no próprio servidor):','ipmitool lan set 1 ipsrc static',`ipmitool lan set 1 ipaddr ${i2ip(c.ip)}`,`ipmitool lan set 1 netmask ${msk(c)}`,...(p.gw?[`ipmitool lan set 1 defgw ipaddr ${p.gw}`]:[]))}
  if(d.type==='pc'&&data[0]&&data[0].kind==='port'){const c=data[0].c;L.push('','# ---- Windows (prompt como administrador) ----',`netsh interface ipv4 set address name="Ethernet" static ${i2ip(c.ip)} ${msk(c)}${d.gw?' '+d.gw:''}`);routes.forEach(r=>{const x=pc(r.dst);L.push(`route -p add ${i2ip(x.net)} mask ${msk(x)} ${r.nh}`)})}
  return L.join('\n')}
function genChassis(d){const m=modelOf(d),ms=membersOf(d);if(d.k8s)return genCluster(d);return[`# ${d.name} — ${mdesc(d)}`,`# Chassis com ${m?m.bays:'?'} baias. A configuração fica em cada componente:`,...ms.map(x=>`#   ${x.slot!=null?('baia '+x.slot).padEnd(9):''} ${x.name} — ${mdesc(x)}`)].join('\n')}
function gen(v,d){computeOspf();if(d.type==='chassis')return genChassis(d);if(isHost(d.type))return d.os?genHostOs(d):genLinux(d);if(d.type==='cloud')return genCloud(d);if(v==='auto')v=osOf(d);let t=(GEN[v]||GEN.cisco)(d);if(d.aclName)t=t.replace(/LAB-FILTER/g,String(d.aclName).replace(/[^\w-]/g,'_'));if((d.dnat||[]).length){const b=natGen(v,d);if(b){const j=['junos','vyos','fortios','routeros'].includes(v);if(!j&&/\nend\s*$/.test(t))t=t.replace(/\nend\s*$/,'\n'+b+'\nend\n');else t=t.replace(/\s*$/,'\n')+b+'\n'}}if((d.vpns||[]).length){const b=vpnGen(v,d);if(b){const j=['junos','vyos','fortios','routeros'].includes(v);if(!j&&/\nend\s*$/.test(t))t=t.replace(/\nend\s*$/,'\n'+b+'\nend\n');else t=t.replace(/\s*$/,'\n')+b+'\n'}}return t}
const safeName=n=>String(n||'equipamento').replace(/[^\w.-]+/g,'_').slice(0,64);
function exportFiles(vendor){const files=[];S.devices.forEach(d=>{if(d.type==='chassis'){files.push({name:`chassis/${safeName(d.name)}.txt`,text:genChassis(d)});return}const v=vendor==='auto'?osOf(d):vendor;files.push({name:isHost(d.type)?`hosts/${safeName(d.name)}.${d.os?(isWin(d)?'ps1':'sh'):'txt'}`:d.type==='cloud'?`nuvens/${safeName(d.name)}.txt`:`${vendor}/${safeName(d.name)}.txt`,text:gen(v,d)})});
  files.push({name:'topologia.json',text:JSON.stringify(S,null,2)});
  const inv=['Equipamento;Fabricante;Modelo;Tipo;Sistema;Rack;U;Consumo (W)',...S.devices.map(d=>{const m=modelOf(d),r=(S.racks||[]).find(x=>x.id===d.rack);return[d.name,m?m.vendor:'genérico',m?m.name:TYPES[d.type].label,TYPES[d.type].label,VN[vendor==='auto'?osOf(d):(isHost(d.type)?'linux':vendor)]||'',r?r.name:'',d.ru||'',wattsOf(d)].join(';')})];
  files.push({name:'inventario.csv',text:inv.join('\n')+'\n'});
  files.push({name:'LEIAME.txt',text:`Bancada de Rede — ${S.name||'lab'}\nExportado em ${today()} para ${VN[vendor]}.\n\n${vendor}/  um arquivo por equipamento de rede${vendor==='auto'?' (cada um no sistema nativo do modelo)':''}\nhosts/   netplan, iproute2 e BMC para servidores e PCs\ninventario.csv  equipamentos, modelos, rack, U e consumo\ntopologia.json  reabra o lab com "Importar .json"\n\nMapa de portas:\n`+S.devices.filter(d=>!isHost(d.type)&&d.type!=='chassis').map(d=>{const v=vendor==='auto'?osOf(d):vendor;return`${d.name}: `+d.ports.map((p,k)=>usedPort(d,k)?`${spn(d,k)}=${pn(v,d,k)}`:null).filter(Boolean).join(', ')}).join('\n')+'\n'});
  return files}

function genCluster(c){const k=c.k8s,ocp=k.dist==='openshift',ns=k8sNodes(c);const cp=ns.filter(isCP),w=ns.filter(n=>!isCP(n));const nip=n=>{const f=l3ifs(n).find(f=>!f.mgmt);return f?i2ip(f.c.ip):'?'};const base=(k.domain||'').split('.').slice(1).join('.')||'lab';
  const L=[`# ${c.name} — ${ocp?'OpenShift':'Kubernetes'} ${k.version}`,`# Gerado pela Bancada de Rede em ${today()}.`,`# Nós: ${ns.map(n=>`${n.name} (${n.k8sRole}, ${nip(n)})`).join(', ')}`,''];
  if(ocp){L.push('# ---- install-config.yaml (instalação agent-based / bare metal) ----','apiVersion: v1',`baseDomain: ${base}`,'metadata:',`  name: ${(k.domain||'').split('.')[0]}`,'compute:','- name: worker',`  replicas: ${w.length}`,'controlPlane:','  name: master',`  replicas: ${cp.length}`,'networking:','  networkType: OVNKubernetes','  clusterNetwork:',`  - cidr: ${k.podCidr}`,'    hostPrefix: 23','  serviceNetwork:',`  - ${k.svcCidr}`,'  machineNetwork:',`  - cidr: ${k.nodeNet||''}`,'platform:','  baremetal:','    apiVIPs:',`    - ${k.apiVip}`,'    ingressVIPs:',`    - ${k.ingressVip}`,'pullSecret: \'{"auths": {}}\'','sshKey: ssh-ed25519 AAAA... admin@bancada','',
    '# ---- DNS necessário ----',`api.${k.domain}.        A  ${k.apiVip}`,`api-int.${k.domain}.    A  ${k.apiVip}`,`*.apps.${k.domain}.     A  ${k.ingressVip}`)}
  else{L.push('# ---- kubeadm-config.yaml (rode no primeiro control-plane: kubeadm init --config kubeadm-config.yaml) ----','apiVersion: kubeadm.k8s.io/v1beta3','kind: ClusterConfiguration',`kubernetesVersion: ${k.version.replace(/\+.*/,'')}`,`controlPlaneEndpoint: "${nip(cp[0]||ns[0])}:6443"`,'networking:',`  podSubnet: ${k.podCidr}`,`  serviceSubnet: ${k.svcCidr}`,'---','apiVersion: kubeadm.k8s.io/v1beta3','kind: InitConfiguration','localAPIEndpoint:',`  advertiseAddress: ${nip(cp[0]||ns[0])}`,'',
    '# nos workers: kubeadm join '+nip(cp[0]||ns[0])+':6443 --token <token> --discovery-token-ca-cert-hash sha256:<hash>');
    if(k.lbPool)L.push('','# ---- MetalLB (LoadBalancer) ----','apiVersion: metallb.io/v1beta1','kind: IPAddressPool','metadata:','  name: bancada','  namespace: metallb-system','spec:','  addresses:',`  - ${k.lbPool}`,'---','apiVersion: metallb.io/v1beta1','kind: L2Advertisement','metadata:','  name: bancada','  namespace: metallb-system')}
  const objs=[];(k.ns||[]).filter(n=>!/^(default|kube-|openshift)/.test(n)).forEach(n=>objs.push(['apiVersion: v1',`kind: ${ocp?'Namespace':'Namespace'}`,'metadata:',`  name: ${n}`].join('\n')));
  (k.deploys||[]).forEach(dp=>objs.push(dp.kind==='pod'?['apiVersion: v1','kind: Pod','metadata:',`  name: ${dp.name}`,`  namespace: ${dp.ns}`,`  labels: {app: ${dp.labels.app}}`,'spec:','  containers:',`  - name: ${dp.name}`,`    image: ${dp.image}`].join('\n'):['apiVersion: apps/v1','kind: Deployment','metadata:',`  name: ${dp.name}`,`  namespace: ${dp.ns}`,'spec:',`  replicas: ${dp.replicas}`,'  selector:','    matchLabels:',`      app: ${dp.labels.app}`,'  template:','    metadata:','      labels:',`        app: ${dp.labels.app}`,'    spec:','      containers:',`      - name: ${dp.name}`,`        image: ${dp.image}`,...(dp.port?['        ports:',`        - containerPort: ${dp.port}`]:[])].join('\n')));
  (k.svcs||[]).forEach(s=>objs.push(['apiVersion: v1','kind: Service','metadata:',`  name: ${s.name}`,`  namespace: ${s.ns}`,'spec:',`  type: ${s.type}`,'  selector:',`    app: ${s.sel}`,'  ports:',`  - port: ${s.port}`,`    targetPort: ${s.targetPort||s.port}`,...(s.nodePort?[`    nodePort: ${s.nodePort}`]:[]),...(s.lbIp?[`  loadBalancerIP: ${s.lbIp}`]:[])].join('\n')));
  (k.ings||[]).forEach(r=>objs.push(r.kind==='route'?['apiVersion: route.openshift.io/v1','kind: Route','metadata:',`  name: ${r.name}`,`  namespace: ${r.ns}`,'spec:',`  host: ${r.host}`,'  to:','    kind: Service',`    name: ${r.svc}`].join('\n'):['apiVersion: networking.k8s.io/v1','kind: Ingress','metadata:',`  name: ${r.name}`,`  namespace: ${r.ns}`,'spec:','  rules:',`  - host: ${r.host}`,'    http:','      paths:','      - path: /','        pathType: Prefix','        backend:','          service:',`            name: ${r.svc}`,'            port:',`              number: ${r.port||80}`].join('\n')));
  if(objs.length)L.push('','# ---- workloads (kubectl apply -f) ----',objs.join('\n---\n'));return L.join('\n')}

/* ---------- importação de configuração ---------- */
const FMT_NAMES={cisco:'Cisco IOS / IOS-XE',nxos:'Cisco NX-OS',eos:'Arista EOS',os10:'Dell OS10',aoscx:'HPE Aruba AOS-CX',junos:'Juniper Junos (formato set)',huawei:'Huawei VRP',vyos:'VyOS (formato set)',routeros:'MikroTik RouterOS',fortios:'Fortinet FortiOS'};
function detectFormat(t){
  if(/^\s*config system (global|interface)\b/m.test(t))return'fortios';
  if(/^\s*\/(interface|ip address|system identity|ip route)\b/m.test(t))return'routeros';
  if(/^\s*set\s+interfaces\s+(ethernet|bonding|bridge|loopback\s+lo)\b/m.test(t)||/^\s*set\s+system\s+host-name\s+'/m.test(t)||/^\s*set protocols static route\b/m.test(t))return'vyos';
  if(/^\s*set\s+(system|interfaces|vlans|protocols|routing-options)\b/m.test(t))return'junos';
  if(/^\s*(sysname|vlan batch|interface Vlanif|port link-type|ip route-static)\b/m.test(t))return'huawei';
  if(/^\s*(vlan (access|trunk)|interface lag \d|apply access-list|ip static \d)/m.test(t)||/^interface \d+\/\d+\/\d+\s*$/m.test(t))return'aoscx';
  if(/^\s*interface ethernet\s?\d+\/\d+\/\d+/mi.test(t)||/^\s*interface vlan\d+\s*$/m.test(t)&&/OS10|ethernet1\/1\//i.test(t))return'os10';
  if(/^\s*feature\s+\w+/m.test(t)||/^\s*vrf context /m.test(t)||/^\s*interface Ethernet\d+\/\d+\s*$/m.test(t))return'nxos';
  if(/^\s*interface Ethernet\d+\s*$/m.test(t)||/^\s*interface Management1/m.test(t))return'eos';
  return'cisco'}
const blankCfg=()=>({hostname:'',vlans:[],ifaces:[],svis:[],routes:[],gw:'',mgmtGw:'',ospf:null,rules:[],aclName:'',lags:{},warnings:[],vrfs:[],vrfOspf:{},bgp:null,loops:[],pfx:[],clists:[],rmaps:[],vx:null});
const cVrf=(cfg,n)=>{if(!n||isMgmtVrfName(n))return null;let v=cfg.vrfs.find(x=>x.name===n);if(!v){v={name:n,rd:'',rtImp:'',rtExp:'',l3vni:0};cfg.vrfs.push(v)}return v};
const cBgp=(cfg,asn)=>cfg.bgp||(cfg.bgp={asn:+asn||0,rid:'',neighbors:[],networks:[],redist:[],noDefV4:false});
const cNb=(cfg,ip,vrf)=>{const b=cBgp(cfg);let n=b.neighbors.find(x=>x.ip===ip&&(x.vrf||'')===(vrf||''));if(!n){n={ip,ras:0,vrf:vrf||'',desc:'',dio:false,nhs:false,shut:false,us:'',mh:false,rrc:false,sc:false,vpnv4:false,evpn:false,noV4:false,rmIn:'',rmOut:''};b.neighbors.push(n)}if(vrf)cVrf(cfg,vrf);return n};
const cNet=(cfg,c,vrf,rm)=>{if(!c)return;const b=cBgp(cfg),k=netStr(c);if(!b.networks.some(n=>n.pfx===k&&(n.vrf||'')===(vrf||'')))b.networks.push({pfx:k,vrf:vrf||'',...(rm?{rm}:{})});if(vrf)cVrf(cfg,vrf)};
const cRed=(cfg,src,vrf,rm)=>{src=({direct:'connected',connected:'connected',static:'static',ospf:'ospf'})[String(src).toLowerCase()];if(!src)return;const b=cBgp(cfg);if(rm==='BANCADA-REDIST')rm='';if(!b.redist.some(r=>r.src===src&&(r.vrf||'')===(vrf||'')))b.redist.push({src,vrf:vrf||'',...(rm?{rm}:{})});if(vrf)cVrf(cfg,vrf)};
const cOspfV=(cfg,v)=>{cVrf(cfg,v);return cfg.vrfOspf[v]||(cfg.vrfOspf[v]={on:true,area:0,rid:'',dio:false})};
const cLoop=(cfg,id)=>{id=+id;let l=cfg.loops.find(x=>x.id===id);if(!l){l={id,ip:'',vrf:'',desc:''};cfg.loops.push(l)}return l};
const cVx=cfg=>cfg.vx||(cfg.vx={src:null,vnis:[]});
const cVni=(cfg,vni,vlan)=>{const vx=cVx(cfg);vni=+vni;let x=vx.vnis.find(y=>+y.vni===vni);if(!x){x={vlan:vlan==null?null:+vlan,vni,rt:'',peers:''};vx.vnis.push(x)}else if(vlan!=null)x.vlan=+vlan;return x};
const cPeer=(x,ip)=>{if(ip2i(ip)===null)return;const L=String(x.peers||'').split(/\s+/).filter(Boolean);if(!L.includes(ip))L.push(ip);x.peers=L.join(' ')};
const cPl=(cfg,name,r)=>{let p=cfg.pfx.find(x=>x.name===name);if(!p){p={name,rules:[]};cfg.pfx.push(p)}if(r){if(r.seq==null)r.seq=Math.max(0,...p.rules.map(x=>+x.seq||0))+5;p.rules=p.rules.filter(x=>+x.seq!==+r.seq);p.rules.push(r)}return p};
const cCl=(cfg,name,act,comm)=>{let c=cfg.clists.find(x=>x.name===name);if(!c){c={name,rules:[]};cfg.clists.push(c)}const cm=commList(comm).join(' ');if(cm&&!c.rules.some(r=>r.act===act&&r.comm===cm))c.rules.push({act,comm:cm});return c};
const cRm=(cfg,name,act,seq)=>{let m=cfg.rmaps.find(x=>x.name===name);if(!m){m={name,rules:[]};cfg.rmaps.push(m)}seq=+seq||10;let r=m.rules.find(x=>+x.seq===seq);if(!r){r={seq,act:act==='deny'?'deny':'permit',mPfx:'',mComm:'',sLp:'',sMed:'',sComm:'',sAdd:false,sPre:''};m.rules.push(r)}return r};
const plLine=s=>{const m=s.match(/^(permit|deny)\s+(\S+)(.*)$/i);if(!m)return null;const c=pc(m[2]);if(!c)return null;const ge=(m[3].match(/\bge\s+(\d+)/)||[])[1]||'',le=(m[3].match(/\ble\s+(\d+)/)||[])[1]||'';return{act:m[1].toLowerCase(),pfx:netStr(c),ge:ge?+ge:'',le:le?+le:''}};
function rmSetLine(r,t){let m;if(m=t.match(/^match ip address prefix-list\s+(\S+)/i)){r.mPfx=m[1];return true}if(m=t.match(/^match community\s+(\S+)/i)){r.mComm=m[1];return true}
  if(m=t.match(/^set local-preference\s+(\d+)/i)){r.sLp=m[1];return true}if(m=t.match(/^set metric\s+(\d+)/i)){r.sMed=m[1];return true}
  if(m=t.match(/^set community\s+(.+)$/i)){r.sAdd=/\badditive\b/i.test(m[1]);r.sComm=commList(m[1].replace(/\badditive\b/i,'')).join(' ');return true}if(m=t.match(/^set as-path prepend\s+(.+)$/i)){r.sPre=m[1].split(/\s+/).filter(x=>/^\d+$/.test(x)).join(' ');return true}return false}
const loopNum=n=>{const m=String(n).replace(/\s+/g,'').match(/^(?:loopback|lo)(\d+)$/i);return m?+m[1]:null};
const classNet=a=>{const ip=ip2i(a);if(ip===null)return null;const f=ip>>>24;return pc(`${a}/${f<128?8:f<192?16:24}`)};
function ifObj(cfg,name){let f=cfg.ifaces.find(x=>x.name===name);if(!f){f={name,desc:'',shut:false,mode:null,vlan:null,allowed:null,native:null,ip:'',vip:'',lag:0,routed:null,subs:[],nat:null,mpls:false};cfg.ifaces.push(f)}return f}
function svObj(cfg,v){let s=cfg.svis.find(x=>x.vlan===v);if(!s){s={vlan:v,ip:'',vip:''};cfg.svis.push(s)}return s}
const ipMask=(a,m)=>{if(!a)return'';if(a.includes('/'))return pc(a)?a:'';const l=maskLen(m);return ip2i(a)!==null&&l!==null?`${a}/${l}`:''};
const lagNumOf=n=>{let m=n.match(/^(?:port-channel|po|eth-trunk|lag\s*|bond)\s*(\d+)$/i);if(m)return+m[1]+(/^bond/i.test(n)?1:0);m=n.match(/^ae(\d+)$/i);return m?+m[1]+1:0};

/* família Cisco (IOS, NX-OS, EOS, OS10) e AOS-CX */
function parseCiscoLike(text,fmt){const cfg=blankCfg();const CRYPTO_ACL=new Set([...String(text).matchAll(/^\s*match address (\S+)/gm)].map(x=>x[1]));let ctx=null,cur=null,acl=null,ospf=false,oc=null,bv='',bvInd=-1,bnb=null,bnbInd=-1,baf='v4',bnbAf='',bnbAfInd=-1,bvlan=null,bvlanInd=-1,evVni=null,nveVni=null,evVrf=null;
  const fam=s=>/vpnv4|vpn-ipv4/i.test(s)?'vpnv4':/evpn/i.test(s)?'evpn':'v4';
  text.split(/\r?\n/).forEach(raw=>{const line=raw.replace(/\s+$/,'');if(!line.trim())return;if(/^\s*!\s*anycast gateway/i.test(line)&&ctx==='svi'&&cur){cur.agw=true;return}if(/^\s*[!#]/.test(line))return;const ind=/^\s/.test(line),t=line.trim(),lw=t.toLowerCase(),w=t.split(/\s+/);const indent=line.length-line.trimStart().length;
    if(!ind){ctx=null;cur=null;
      let m;
      if(m=t.match(/^(?:vrf definition|ip vrf|vrf context|vrf instance|vrf)\s+(\S+)$/i)){if(isMgmtVrfName(m[1])){ctx='vrfmgmt';return}cur=cVrf(cfg,m[1]);ctx='vrfdef';return}
      if(/^ip routing vrf/i.test(t))return;
      if(m=t.match(/^ip\s+route\s+(\S+)\s+(\S+)\s+vrf\s+(\S+)$/i)){const dst=pc(m[1]);if(/^blackhole$/i.test(m[2]))m[2]='Null0';if(!dst||(ip2i(m[2])===null&&!isNull(m[2])))return;if(isMgmtVrfName(m[3])){if(dst.len===0)cfg.mgmtGw=m[2];return}cVrf(cfg,m[3]);cfg.routes.push({dst:netStr(dst),nh:m[2],vrf:m[3]});return}
      if(m=t.match(/^router ospf\s+\S+\s+vrf\s+(\S+)/i)){oc=cOspfV(cfg,m[1]);ctx='ospf';return}
      if(m=t.match(/^router bgp\s+(\d+)/i)){cBgp(cfg,m[1]).asn=+m[1];ctx='bgp';bv='';bvInd=-1;bnb=null;bnbInd=-1;baf='v4';bnbAf='';bvlan=null;return}
      if(m=t.match(/^hostname\s+(\S+)/i)){cfg.hostname=m[1].replace(/"/g,'');return}
      if(m=t.match(/^ip prefix-list\s+(\S+)\s+(?:seq\s+(\d+)\s+)?(.+)$/i)){const r=plLine(m[3]);if(r){r.seq=m[2]?+m[2]:null;cPl(cfg,m[1],r)}return}
      if(m=t.match(/^ip community-list\s+(?:standard\s+)?(\S+)\s+(?:seq\s+\d+\s+)?(permit|deny)\s+(.+)$/i)){cCl(cfg,m[1],m[2].toLowerCase(),m[3]);return}
      if(m=t.match(/^route-map\s+(\S+)\s+(permit|deny)(?:\s+seq)?\s+(\d+)/i)){if(m[1]==='BANCADA-REDIST'){ctx='skip';return}cur=cRm(cfg,m[1],m[2].toLowerCase(),m[3]);ctx='rmap';return}
      if(m=t.match(/^vlan configuration\s+(\d+)/i)){cur=+m[1];ctx='vlancfg';return}
      if(m=t.match(/^l2vpn evpn instance\s+(\d+)/i)){cur=+m[1];ctx='evi';return}
      if(/^l2vpn evpn$/i.test(t)){ctx='l2evpn';return}
      if(/^evpn$/i.test(t)){ctx='evpn';evVni=null;evVrf=null;return}
      if(/^nve$/i.test(t)){ctx='nve';nveVni=null;return}
      if(m=t.match(/^virtual-network\s+(\d+)/i)){cur=cVni(cfg,m[1],null);ctx='vn';return}
      if(m=t.match(/^vlan\s+([\d,\-\s]+)$/i)){const ids=parseList(m[1]);ids.forEach(id=>{if(!cfg.vlans.some(x=>x.id===id))cfg.vlans.push({id,name:''})});ctx='vlan';cur=ids.length===1?cfg.vlans.find(x=>x.id===ids[0]):null;return}
      if(m=t.match(/^interface\s+(?:vlan\s*|Vlan)(\d+)$/i)){ctx='svi';cur=svObj(cfg,+m[1]);if(fmt==='os10'&&!cfg.vlans.some(x=>x.id===+m[1]))cfg.vlans.push({id:+m[1],name:''});return}
      if(m=t.match(/^interface\s+(?:nve\s*\d*|vxlan\s*\d*)$/i)){ctx='nve';nveVni=null;cVx(cfg);return}
      if(m=t.match(/^interface\s+(.+)$/i)){const n=m[1].trim();const lo=loopNum(n);if(lo!==null){cur=cLoop(cfg,lo);ctx='loop';return}const sub=n.match(/^(.+?)\.(\d+)$/);ctx='if';
        if(sub){const base=ifObj(cfg,sub[1]);cur={sub:true,base,vlan:+sub[2],ip:'',vip:'',nat:null};base.subs.push(cur)}else cur=ifObj(cfg,n);return}
      if(m=t.match(/^ip\s+route\s+(?:vrf\s+(\S+)\s+)?(\S+)\s+(\S+)(?:\s+(\S+))?/i)){const vrf=m[1];let dst,nh;if(m[2].includes('/')){dst=m[2];nh=m[3]}else{dst=ipMask(m[2],m[3]);nh=m[4]}
        if(isNull(nh))nh='Null0';if(!dst||(ip2i(nh)===null&&!isNull(nh)))return;if(vrf){if(isMgmtVrfName(vrf)){if(pc(dst).len===0)cfg.mgmtGw=nh;return}cVrf(cfg,vrf);cfg.routes.push({dst:netStr(pc(dst)),nh,vrf});return}cfg.routes.push({dst:netStr(pc(dst)),nh});return}
      if(m=t.match(/^management route\s+(\S+)\s+(\S+)/i)){if(ip2i(m[2])!==null)cfg.mgmtGw=m[2];return}
      if(m=t.match(/^ip default-gateway\s+(\S+)/i)){cfg.gw=m[1];return}
      if(/^vrf context management/i.test(t)){ctx='vrfmgmt';return}
      if(m=t.match(/^router ospf\s+\S+/i)){ospf=true;cfg.ospf=cfg.ospf||{on:true,area:0};oc=cfg.ospf;ctx='ospf';return}
      if(m=t.match(/^ip\s+access-list\s+(?:extended\s+)?(\S+)/i)||t.match(/^access-list\s+ip\s+(\S+)/i)){if(CRYPTO_ACL.has(m[1])){ctx='skip';return}acl=m[1];cfg.aclName=acl;ctx='acl';return}
      if(m=t.match(/^access-list\s+(\d+)\s+(permit|deny)\s+(.+)$/i)){const r=parseAce(m[3].split(/\s+/));if(typeof r!=='string'){r.act=m[2].toLowerCase();cfg.rules.push(r);cfg.aclName=m[1]}return}
      if(/^ip nat inside source/i.test(t)){const mm=t.match(/interface\s+(\S+)/i);if(mm)ifObj(cfg,mm[1]).nat=true;return}
      return}
    if(ctx==='rmap'&&cur){rmSetLine(cur,t);return}
    if(ctx==='vlan'&&cur){let m;if(m=t.match(/^name\s+(.+)$/i))cur.name=m[1].replace(/\s+/g,'_');if(m=t.match(/^vn-segment\s+(\d+)/i))cVni(cfg,m[1],cur.id);return}
    if(ctx==='vlancfg'){let m;if(m=t.match(/^member evpn-instance\s+\d+\s+vni\s+(\d+)/i))cVni(cfg,m[1],cur);return}
    if(ctx==='evi'){let m;if(m=t.match(/^route-target\s+(?:both|import|export)\s+(\S+)/i)){(cfg._eviRt=cfg._eviRt||{})[cur]=m[1]}return}
    if(ctx==='l2evpn'){let m;if(m=t.match(/^router-id\s+(\S+)/i)){const lo=loopNum(m[1]);if(lo!==null)cVx(cfg).src=lo}return}
    if(ctx==='vn'&&cur){let m;if(m=t.match(/^remote-vtep\s+(\S+)/i))cPeer(cur,m[1]);return}
    if(ctx==='nve'){let m;const t2=t.replace(/^vxlan\s+(?=source-interface)/i,'');
      if(m=t2.match(/^source-interface\s+(.+)$/i)){const lo=loopNum(m[1]);if(lo!==null)cVx(cfg).src=lo;return}
      if(m=t.match(/^member vni\s+(\d+)\s+(?:associate-vrf|vrf\s+(\S+))/i)){if(m[2])cVrf(cfg,m[2]).l3vni=+m[1];else(cfg._assoc=cfg._assoc||[]).push(+m[1]);nveVni=null;return}
      if(m=t.match(/^member vni\s+(\d+)(?:\s+ingress-replication(?:\s+([\d.]+))?)?/i)){nveVni=+m[1];const x=cVni(cfg,m[1],null);if(m[2])cPeer(x,m[2]);return}
      if(m=t.match(/^peer-ip\s+(\S+)/i)){if(nveVni)cPeer(cVni(cfg,nveVni,null),m[1]);return}
      if(m=t.match(/^vxlan vlan\s+(\d+)\s+vni\s+(\d+)/i)){cVni(cfg,m[2],m[1]);return}
      if(m=t.match(/^vxlan vrf\s+(\S+)\s+vni\s+(\d+)/i)){cVrf(cfg,m[1]).l3vni=+m[2];return}
      if(m=t.match(/^vxlan flood vtep\s+(.+)$/i)){(cfg._flood=cfg._flood||[]).push(...m[1].split(/\s+/));return}
      if(m=t.match(/^source ip\s+(\S+)/i)){cfg._vtepIp=m[1];return}
      if(m=t.match(/^vni\s+(\d+)$/i)){nveVni=+m[1];return}
      if(nveVni&&(m=t.match(/^vlan\s+(\d+)$/i))){cVni(cfg,nveVni,m[1]);return}
      if(nveVni&&(m=t.match(/^vrf\s+(\S+)$/i))){cVrf(cfg,m[1]).l3vni=nveVni;return}
      if(nveVni&&(m=t.match(/^vtep-peer\s+(\S+)/i))){cPeer(cVni(cfg,nveVni,null),m[1]);return}return}
    if(ctx==='evpn'){let m;if(m=t.match(/^vlan\s+(\d+)$/i)){cfg._evVlan=+m[1];evVni=null;evVrf=null;return}if(cfg._evVlan&&!evVni&&!evVrf&&(m=t.match(/^route-target\s+(?:import|export|both)\s+(\S+)/i))){if(!/^auto$/i.test(m[1]))(cfg._evRtVlan=cfg._evRtVlan||{})[cfg._evVlan]=m[1];return}if(m=t.match(/^vni\s+(\d+)(?:\s+l2)?$/i)){if(evVrf)cVrf(cfg,evVrf).l3vni=+m[1];else evVni=+m[1];return}if(m=t.match(/^evi\s+(\d+)/i)){evVni=+m[1];evVrf=null;return}if(m=t.match(/^vrf\s+(\S+)/i)){evVrf=m[1];evVni=null;cVrf(cfg,evVrf);return}
      if(m=t.match(/^route-target\s+(?:(import|export|both)\s+)?(\S+)(?:\s+(import|export|both))?/i)){const dir=(m[1]||m[3]||'both').toLowerCase(),v=m[2];if(/^auto$/i.test(v))return;
        if(evVrf){const x=cVrf(cfg,evVrf);if(dir!=='export')x.rtImp=[...new Set([...rtList(x.rtImp),v])].join(' ');if(dir!=='import')x.rtExp=[...new Set([...rtList(x.rtExp),v])].join(' ')}else if(evVni)(cfg._evRt=cfg._evRt||{})[evVni]=v}return}
    if(ctx==='vrfmgmt'){const m=t.match(/^ip route\s+0\.0\.0\.0\/0\s+(\S+)/i);if(m)cfg.mgmtGw=m[1];return}
    if(ctx==='vrfdef'&&cur){let m;if(m=t.match(/^rd\s+(\S+)/i)){cur.rd=/^auto$/i.test(m[1])?'':m[1]}if(m=t.match(/^vni\s+(\d+)/i))cur.l3vni=+m[1];
      if(m=t.match(/^route-target\s+(import|export|both)\s+(\S+)(?:\s+(\S+))?/i)){if(/^auto$/i.test(m[2]))return;const dir=m[1].toLowerCase();if(/stitching|evpn/i.test(m[3]||'')){(cur._evrt=cur._evrt||{imp:[],exp:[]});if(dir!=='export')cur._evrt.imp.push(m[2]);if(dir!=='import')cur._evrt.exp.push(m[2]);return}
        if(dir!=='export')cur.rtImp=[...new Set([...rtList(cur.rtImp),m[2]])].join(' ');if(dir!=='import')cur.rtExp=[...new Set([...rtList(cur.rtExp),m[2]])].join(' ')}
      if(m=t.match(/^ip route\s+(\S+)\s+(\S+)/i)){const c=pc(m[1]);if(c&&(ip2i(m[2])!==null||isNull(m[2])))cfg.routes.push({dst:netStr(c),nh:isNull(m[2])?'Null0':m[2],vrf:cur.name})}return}
    if(ctx==='ospf'){let m;if(m=t.match(/^vrf\s+(\S+)/i)){oc=cOspfV(cfg,m[1]);if(cfg.ospf&&!cfg.ospf._used)cfg.ospf=null;return}if(!oc)return;oc._used=true;if(m=t.match(/^router-id\s+(\S+)/i))oc.rid=m[1];if(m=t.match(/area\s+(\S+)/i)){const a=m[1].includes('.')?(ip2i(m[1])||0):+m[1];oc.area=a}if(/default-information originate/i.test(t))oc.dio=true;return}
    if(ctx==='bgp'){let m;if(bnbAf&&indent<=bnbAfInd)bnbAf='';if(bnb&&indent<=bnbInd){bnb=null;bnbAf=''}if(bvlan!=null&&indent<=bvlanInd)bvlan=null;if(bv&&bvInd>=0&&indent<=bvInd&&!/^vrf\s/i.test(t)){bv='';bvInd=-1}
      if(/^exit-address-family/i.test(t)){if(bvInd<0)bv='';baf='v4';return}
      if(m=t.match(/^vlan\s+(\d+)$/i)){bvlan=+m[1];bvlanInd=indent;return}
      if(bvlan!=null){if(m=t.match(/^route-target\s+(?:both|import|export)\s+(\S+)/i))(cfg._evRtVlan=cfg._evRtVlan||{})[bvlan]=m[1];return}
      if(bnb&&(m=t.match(/^address-family\s+(.+)$/i))){bnbAf=fam(m[1]);bnbAfInd=indent;if(bnbAf==='v4')bnb._v4af=true;else bnb[bnbAf]=true;return}
      if(m=t.match(/^address-family ipv4(?: unicast)? vrf\s+(\S+)/i)){bv=m[1];bvInd=-1;baf='v4';cVrf(cfg,bv);return}
      if(m=t.match(/^address-family\s+(.+)$/i)){baf=fam(m[1]);return}
      if(m=t.match(/^vrf\s+(\S+)/i)){bv=m[1];bvInd=indent;cVrf(cfg,bv);return}
      if(bv&&(m=t.match(/^route-target\s+(import|export)\s+(?:vpn-ipv4\s+|evpn\s+)?(\S+)/i))){const x=cVrf(cfg,bv);const k=/evpn/i.test(t)?(x._evrt=x._evrt||{imp:[],exp:[]}):null;if(k){(m[1].toLowerCase()==='import'?k.imp:k.exp).push(m[2]);return}if(m[1].toLowerCase()==='import')x.rtImp=[...new Set([...rtList(x.rtImp),m[2]])].join(' ');else x.rtExp=[...new Set([...rtList(x.rtExp),m[2]])].join(' ');return}
      if(bv&&(m=t.match(/^rd\s+(\S+)/i))){const x=cVrf(cfg,bv);if(!x.rd&&!/^auto$/i.test(m[1]))x._bgprd=m[1];return}
      if(/^no bgp default ipv4-unicast/i.test(t)){cfg.bgp.noDefV4=true;return}
      if(m=t.match(/^(?:bgp )?router-id\s+(\S+)/i)){cfg.bgp.rid=m[1];return}
      const nbA=(n,r,af)=>{let x;const neg=/^no\s+/i.test(r);r=r.replace(/^no\s+/i,'');
        if(x=r.match(/^remote-as\s+(\d+)/i))n.ras=+x[1];else if(x=r.match(/^description\s+(.+)$/i))n.desc=x[1];else if(/^next-hop-self/i.test(r))n.nhs=true;else if(/^default-originate/i.test(r))n.dio=true;else if(/^shutdown$/i.test(r))n.shut=!neg;
        else if(x=r.match(/^update-source\s+(.+)$/i)){const lo=loopNum(x[1]);if(lo!==null)n.us=String(lo)}else if(/^ebgp-multihop/i.test(r))n.mh=true;else if(/^send-community/i.test(r))n.sc=true;else if(/^route-reflector-client/i.test(r))n.rrc=true;
        else if(x=r.match(/^route-map\s+(\S+)\s+(in|out)/i)){if(x[2].toLowerCase()==='in')n.rmIn=x[1];else n.rmOut=x[1]}
        else if(/^activate/i.test(r)){if(af==='v4'){if(neg)n._nov4=true;else n._v4=true}else if(!neg)n[af]=true}};
      if(m=t.match(/^(no\s+)?neighbor\s+([\d.]+)\s*(.*)$/i)){const n=cNb(cfg,m[2],bv),r=(m[1]||'')+m[3];if(!m[3]){bnb=n;bnbInd=indent;bnbAf='';return}nbA(n,r,baf);return}
      if(bnb){nbA(bnb,t,bnbAf||'v4');return}
      if(m=t.match(/^network\s+(\S+)(?:\s+mask\s+(\S+))?(?:.*route-map\s+(\S+))?/i)){cNet(cfg,m[1].includes('/')?pc(m[1]):m[2]?pc(ipMask(m[1],m[2])):classNet(m[1]),bv,m[3]);return}
      if(m=t.match(/^redistribute\s+(\S+)(?:.*route-map\s+(\S+))?/i)){cRed(cfg,m[1],bv,m[2]);return}
      return}
    if(ctx==='acl'){const x=t.replace(/^(seq\s+)?\d+\s+/i,'');const m=x.match(/^(permit|deny)\s+(.+)$/i);if(!m)return;let rest=m[2].split(/\s+/);if(rest[0]==='any'&&fmt==='aoscx'&&rest.length===3&&rest[1]==='any')rest=['ip','any','any'];
      if(fmt==='aoscx')rest=rest.map(z=>{const mm=z.match(/^([\d.]+)\/([\d.]+)$/);if(mm&&mm[2].includes('.')){const l=maskLen(mm[2]);return l!==null?`${mm[1]}/${l}`:z}return z});
      const r=parseAce(rest);if(typeof r==='string')return;r.act=m[1].toLowerCase();if(r.act==='deny'&&r.proto==='any'&&isAny(r.src)&&isAny(r.dst))return;cfg.rules.push(r);return}
    const vrfM=t.match(/^(?:ip vrf forwarding|vrf forwarding|vrf member|vrf attach|vrf)\s+(\S+)$/i);
    if(vrfM&&(ctx==='svi'||ctx==='if'||ctx==='loop')&&cur){if(!isMgmtVrfName(vrfM[1])){cVrf(cfg,vrfM[1]);cur.vrf=vrfM[1]}return}
    if(ctx==='loop'&&cur){let m;if(m=t.match(/^ip address\s+(\S+)(?:\s+(\S+))?/i))cur.ip=ipMask(m[1],m[2]||'255.255.255.255');if(m=t.match(/^description\s+(.+)$/i))cur.desc=m[1];return}
    if(ctx==='svi'&&cur){let m;
      if(m=t.match(/^ip address virtual\s+(\S+)/i)){cur.ip=m[1];cur.agw=true;return}
      if(m=t.match(/^ip address\s+(\S+)(?:\s+(\S+))?/i)){if(!/dhcp/i.test(m[1]))cur.ip=ipMask(m[1],m[2]);return}
      if(/^fabric forwarding mode anycast-gateway/i.test(t)||/^ip virtual-router address/i.test(t)||/^active-gateway/i.test(t)){cur.agw=true;return}
      if(m=t.match(/^virtual-network\s+(\d+)/i)){cVni(cfg,m[1],cur.vlan);return}
      if(/^mpls ip/i.test(t)){cur.mpls=true;return}
      if(m=t.match(/^description\s+(.+)$/i)){if(fmt==='os10'){const v=cfg.vlans.find(x=>x.id===cur.vlan);if(v&&!v.name)v.name=m[1].replace(/\s+/g,'_')}return}
      if(m=t.match(/^(?:vrrp\s+\d+\s+ip(?:v4)?|standby\s+\d+\s+ip|address|virtual-address|vrrp vrid \d+ virtual-ip)\s+([\d.]+)/i)){cur.vip=m[1];return}
      if(m=t.match(/^vrrp\s+\d+\s+(?:ip|ipv4)\s+([\d.]+)/i)){cur.vip=m[1];return}
      return}
    if(ctx==='if'&&cur){let m;
      if(/^mpls ip$/i.test(t)){cur.mpls=true;return}
      if(cur.sub){if(m=t.match(/^ip address\s+(\S+)(?:\s+(\S+))?/i))cur.ip=ipMask(m[1],m[2]);if(m=t.match(/^encapsulation dot1q\s+(?:vlan\s+)?(\d+)/i))cur.vlan=+m[1];if(m=t.match(/(?:vrrp\s+\d+\s+ip(?:v4)?|address)\s+([\d.]+)$/i))cur.vip=m[1];if(/ip nat outside/i.test(t))cur.nat=true;return}
      if(m=t.match(/^description\s+(.+)$/i)){cur.desc=m[1];return}
      if(/^no shutdown$/i.test(t)){cur.shut=false;return}if(/^shutdown$/i.test(t)){cur.shut=true;return}
      if(/^no switchport$/i.test(t)||/^routing$/i.test(t)){cur.routed=true;return}
      if(/^switchport$/i.test(t)||/^no routing$/i.test(t)){cur.routed=false;return}
      if(m=t.match(/^switchport mode\s+(access|trunk)/i)){cur.mode=m[1].toLowerCase();cur.routed=false;return}
      if(m=t.match(/^switchport access vlan\s+(\d+)/i)){if(cur.mode==='trunk')cur.native=+m[1];else{cur.vlan=+m[1];cur.mode=cur.mode||'access'}cur.routed=false;return}
      if(m=t.match(/^switchport trunk allowed vlan\s+(?:add\s+)?(.+)$/i)){cur.allowed=/^all$/i.test(m[1])?'':(cur.allowed&&/add/i.test(t)?cur.allowed+',':'')+m[1].replace(/\s+/g,'');cur.mode='trunk';cur.routed=false;return}
      if(m=t.match(/^switchport trunk native vlan\s+(\d+)/i)){cur.native=+m[1];return}
      if(m=t.match(/^vlan access\s+(\d+)/i)){cur.mode='access';cur.vlan=+m[1];cur.routed=false;return}
      if(m=t.match(/^vlan trunk allowed\s+(.+)$/i)){cur.mode='trunk';cur.allowed=/^all$/i.test(m[1])?'':m[1].replace(/\s+/g,'');cur.routed=false;return}
      if(m=t.match(/^vlan trunk native\s+(\d+)/i)){cur.mode='trunk';cur.native=+m[1];return}
      if(m=t.match(/^ip address\s+(\S+)(?:\s+(\S+))?/i)){if(!/dhcp/i.test(m[1])){cur.ip=ipMask(m[1],m[2]);if(cur.routed===null)cur.routed=true}return}
      if(m=t.match(/^ip static\s+(\S+)/i)){cur.ip=m[1];return}
      if(m=t.match(/^default-gateway\s+(\S+)/i)){cfg.mgmtGw=m[1];return}
      if(m=t.match(/^(?:channel-group|lag)\s+(\d+)/i)){cur.lag=+m[1];return}
      if(m=t.match(/^(?:vrrp\s+\d+\s+ip(?:v4)?|standby\s+\d+\s+ip)\s+([\d.]+)/i)){cur.vip=m[1];return}
      if(/^ip nat outside/i.test(t)){cur.nat=true;return}if(/^ip nat inside/i.test(t)){cur.nat=false;return}
      return}});
  postParse(cfg,fmt);return cfg}
/* acabamento comum: VNIs sem VLAN, RTs de EVPN, famílias IPv4 dos vizinhos */
function postParse(cfg,fmt){const vx=cfg.vx;if(vx&&cfg._vtepIp&&vx.src==null){const l=cfg.loops.find(x=>pc(x.ip)&&pc(x.ip).ip===ip2i(cfg._vtepIp));if(l)vx.src=l.id}
  if(vx){(cfg._flood||[]).forEach(ip=>vx.vnis.forEach(x=>cPeer(x,ip)));Object.entries(cfg._evRt||{}).forEach(([vni,rt])=>{const x=vx.vnis.find(y=>+y.vni===+vni);if(x)x.rt=rt});
    Object.entries(cfg._evRtVlan||{}).forEach(([vl,rt])=>{const x=vx.vnis.find(y=>+y.vlan===+vl);if(x)x.rt=rt});Object.entries(cfg._eviRt||{}).forEach(([vl,rt])=>{const x=vx.vnis.find(y=>+y.vlan===+vl);if(x)x.rt=rt});
    const l3=new Set([...cfg.vrfs.map(v=>+v.l3vni).filter(Boolean),...(cfg._assoc||[])]);vx.vnis=vx.vnis.filter(x=>x.vlan!=null&&!l3.has(+x.vni));}
  cfg.vrfs.forEach(v=>{if(v._evrt){if(!v.l3vni){v.rtImp=[...new Set([...rtList(v.rtImp),...v._evrt.imp])].join(' ');v.rtExp=[...new Set([...rtList(v.rtExp),...v._evrt.exp])].join(' ')}else{if(v._evrt.imp.length)v.rtImp=[...new Set(v._evrt.imp)].join(' ');if(v._evrt.exp.length)v.rtExp=[...new Set(v._evrt.exp)].join(' ')}delete v._evrt}if(v._bgprd){if(!v.rd)v.rd=v._bgprd;delete v._bgprd}});
  if(cfg.bgp){const b=cfg.bgp;b.neighbors.forEach(n=>{if(fmt==='huawei'||fmt==='routeros'||fmt==='vyos')return;if(!n.vrf){if(fmt==='nxos')n.noV4=!n._v4af;else if(fmt==='aoscx')n.noV4=!n._v4;else if(fmt==='os10')n.noV4=!!n._nov4;else n.noV4=!!n._nov4||(b.noDefV4&&!n._v4)}else n.noV4=false;delete n._v4;delete n._nov4;delete n._v4af});
    const asn=b.asn;if(vx)vx.vnis.forEach(x=>{if(x.rt===`${asn}:${x.vni}`)x.rt=''});cfg.vrfs.forEach(v=>{if(+v.l3vni>0){const a=`${asn}:${v.l3vni}`;if(v.rtImp===a&&v.rtExp===a){v.rtImp='';v.rtExp=''}}})}}

/* Junos (formato set) */
function parseJunos(text){const cfg=blankCfg();const vlanByName={};const terms={};const riIf=[],pol={},grp={},nbExp=[],rfl={},comms={},rmPol={},nbImp=[],irbMac=[],vxVl=[],vxPeer=[],vniRt={};let vtepSrc=null;
  const unq=s=>String(s||'').replace(/^"|"$/g,'');
  text.split(/\r?\n/).forEach(raw=>{const t=raw.trim();if(!/^(set|deactivate)\s/.test(t))return;let m;
    if(m=t.match(/^set system host-name\s+(\S+)/)){cfg.hostname=unq(m[1]);return}
    if(m=t.match(/^set vlans\s+(\S+)\s+vlan-id\s+(\d+)/)){vlanByName[m[1]]=+m[2];cfg.vlans.push({id:+m[2],name:m[1]});return}
    if(m=t.match(/^set vlans\s+(\S+)\s+vxlan vni\s+(\d+)/)){vxVl.push([m[1],+m[2]]);return}
    if(m=t.match(/^set vlans\s+(\S+)\s+vxlan static-remote-vtep-list\s+(\S+)/)){vxPeer.push([m[1],m[2]]);return}
    if(m=t.match(/^set switch-options vtep-source-interface lo0\.(\d+)/)){vtepSrc=+m[1];return}
    if(m=t.match(/^set protocols evpn vni-options vni\s+(\d+)\s+vrf-target\s+(?:export\s+|import\s+)?target:(\S+)/)){vniRt[m[1]]=m[2];return}
    if(m=t.match(/^set interfaces lo0 unit\s+(\d+)\s+family inet address\s+(\S+)/)){cLoop(cfg,m[1]).ip=m[2];return}
    if(m=t.match(/^set interfaces lo0 unit\s+(\d+)\s+description\s+(.+)$/)){cLoop(cfg,m[1]).desc=unq(m[2]);return}
    if(m=t.match(/^set interfaces irb unit\s+(\d+)\s+mac\s/)){irbMac.push(+m[1]);return}
    if(m=t.match(/^set interfaces\s+(\S+)\s+unit\s+(\d+)\s+family mpls/)){const f=ifObj(cfg,m[1]);const u=+m[2];if(u===0)f.mpls=true;else{let s=f.subs.find(x=>x.unit===u);if(!s){s={sub:true,unit:u,vlan:u,ip:'',vip:''};f.subs.push(s)}s.mpls=true}return}
    if(m=t.match(/^set policy-options route-filter-list\s+(\S+)\s+(\S+)\s+(.+)$/)){const c=pc(m[2]);if(!c)return;const r=m[3];let ge='',le='',x;if(x=r.match(/upto \/(\d+)/))le=+x[1];if(x=r.match(/prefix-length-range \/(\d+)-\/(\d+)/)){ge=+x[1];le=+x[2]}
      const p=cPl(cfg,m[1]);p.rules.push({seq:5*(p.rules.length+1),act:/reject/.test(r)?'deny':'permit',pfx:netStr(c),ge,le});return}
    if(m=t.match(/^set policy-options community\s+(\S+)\s+members\s+(.+)$/)){comms[m[1]]=m[2].replace(/[\[\]]/g,' ').trim();return}
    if(m=t.match(/^set policy-options policy-statement\s+(\S+)\s+term\s+rm-(\d+)\s+(from|then)\s+(.+)$/)){const R=(rmPol[m[1]]=rmPol[m[1]]||{});const r=R[m[2]]||(R[m[2]]={seq:+m[2],act:'permit',mPfx:'',mComm:'',sLp:'',sMed:'',sComm:'',sAdd:false,sPre:''});const v=m[4];let x;
      if(x=v.match(/^route-filter-list\s+(\S+)/))r.mPfx=x[1];else if(x=v.match(/^community\s+(add|set)\s+(\S+)/)){r.sAdd=x[1]==='add';r._sc=x[2]}else if(x=v.match(/^community\s+(\S+)/))r.mComm=x[1];else if(x=v.match(/^local-preference\s+(\d+)/))r.sLp=x[1];else if(x=v.match(/^metric\s+(\d+)/))r.sMed=x[1];else if(x=v.match(/^as-path-prepend\s+(.+)$/))r.sPre=unq(x[1]);else if(/^reject/.test(v))r.act='deny';return}
    if(/^set policy-options policy-statement\s+\S+\s+term\s+implicit-deny/.test(t)){const n=t.split(/\s+/)[3];rmPol[n]=rmPol[n]||{};return}
    if(m=t.match(/^set interfaces\s+(\S+)\s+(?:ether-options|gigether-options)\s+802\.3ad\s+(ae\d+)/)){ifObj(cfg,m[1]).lag=lagNumOf(m[2]);return}
    if(m=t.match(/^set interfaces\s+(\S+)\s+description\s+(.+)$/)){ifObj(cfg,m[1]).desc=unq(m[2]);return}
    if(m=t.match(/^set interfaces\s+(\S+)\s+disable$/)){ifObj(cfg,m[1]).shut=true;return}
    if(m=t.match(/^set interfaces\s+(\S+)\s+native-vlan-id\s+(\d+)/)){ifObj(cfg,m[1]).native=+m[2];return}
    if(m=t.match(/^set interfaces irb unit\s+(\d+)\s+family inet address\s+(\S+)(?:\s+vrrp-group\s+\d+\s+virtual-address\s+(\S+))?/)){const s=svObj(cfg,+m[1]);s.ip=m[2];if(m[3])s.vip=m[3];return}
    if(m=t.match(/^set interfaces\s+(\S+)\s+unit\s+(\d+)\s+family ethernet-switching interface-mode\s+(access|trunk)/)){const f=ifObj(cfg,m[1]);f.mode=m[3];f.routed=false;return}
    if(m=t.match(/^set interfaces\s+(\S+)\s+unit\s+(\d+)\s+family ethernet-switching vlan members\s+(.+)$/)){const f=ifObj(cfg,m[1]);f.routed=false;const list=m[3].replace(/[\[\]]/g,' ').trim().split(/\s+/);f._members=(f._members||[]).concat(list);return}
    if(m=t.match(/^set interfaces\s+(\S+)\s+unit\s+(\d+)\s+vlan-id\s+(\d+)/)){const f=ifObj(cfg,m[1]);let s=f.subs.find(x=>x.unit===+m[2]);if(!s){s={sub:true,unit:+m[2],vlan:+m[3],ip:'',vip:''};f.subs.push(s)}else s.vlan=+m[3];return}
    if(m=t.match(/^set interfaces\s+(\S+)\s+unit\s+(\d+)\s+family inet address\s+(\S+)(?:\s+vrrp-group\s+\d+\s+virtual-address\s+(\S+))?/)){const f=ifObj(cfg,m[1]);const u=+m[2];
      if(u===0){f.ip=m[3];f.routed=true;if(m[4])f.vip=m[4]}else{let s=f.subs.find(x=>x.unit===u);if(!s){s={sub:true,unit:u,vlan:u,ip:'',vip:''};f.subs.push(s)}s.ip=m[3];if(m[4])s.vip=m[4]}return}
    if(m=t.match(/^set routing-options static route\s+(\S+)\s+discard/)){if(pc(m[1]))cfg.routes.push({dst:netStr(pc(m[1])),nh:'Null0'});return}
    if(m=t.match(/^set routing-options static route\s+(\S+)\s+next-hop\s+(\S+)/)){if(pc(m[1]))cfg.routes.push({dst:netStr(pc(m[1])),nh:m[2]});return}
    if(m=t.match(/^set routing-instances\s+mgmt_junos\s+routing-options static route\s+0\.0\.0\.0\/0\s+next-hop\s+(\S+)/)){cfg.mgmtGw=m[1];return}
    let ri=null,tt=t;if(m=t.match(/^set routing-instances\s+(\S+)\s+(.*)$/)){if(isMgmtVrfName(m[1]))return;ri=m[1];tt='set '+m[2];const V=cVrf(cfg,ri);
      let x;if(x=m[2].match(/^interface\s+(\S+)/)){riIf.push([x[1],ri]);return}if(x=m[2].match(/^route-distinguisher\s+(\S+)/)){V.rd=x[1];return}if(/^instance-type|^vrf-table-label/.test(m[2]))return;
      if(x=m[2].match(/^vrf-target\s+(?:(import|export)\s+)?target:(\S+)/)){if(x[1]!=='export')V.rtImp=[...new Set([...rtList(V.rtImp),x[2]])].join(' ');if(x[1]!=='import')V.rtExp=[...new Set([...rtList(V.rtExp),x[2]])].join(' ');return}
      if(x=m[2].match(/^protocols evpn ip-prefix-routes vni\s+(\d+)/)){V.l3vni=+x[1];return}if(x=m[2].match(/^vrf-export\s+(\S+)/)){(cfg._vexp=cfg._vexp||[]).push([ri,x[1]]);return}if(/^protocols evpn/.test(m[2]))return;
      if(x=m[2].match(/^routing-options static route\s+(\S+)\s+(?:next-hop\s+(\S+)|discard)/)){if(pc(x[1]))cfg.routes.push({dst:netStr(pc(x[1])),nh:x[2]||'Null0',vrf:ri});return}
      if(x=m[2].match(/^protocols ospf area\s+(\S+)\s+interface/)){const o=cOspfV(cfg,ri);o.area=x[1].includes('.')?(ip2i(x[1])||0):+x[1];return}
      if(/^protocols ospf export/.test(m[2])){cOspfV(cfg,ri).dio=true;return}}
    if(m=tt.match(/^set routing-options autonomous-system\s+(\d+)/)){cBgp(cfg).asn=+m[1];return}
    if(m=tt.match(/^set protocols bgp group\s+(\S+)\s+(.*)$/)){const gk=(ri||'')+'|'+m[1],g=grp[gk]||(grp[gk]={type:'external',peer:0,vrf:ri||'',nbs:[],fam:[]});const r=m[2];let x;
      if(x=r.match(/^type\s+(\S+)/)){g.type=x[1];return}if(x=r.match(/^peer-as\s+(\d+)/)){g.peer=+x[1];return}if(x=r.match(/^export\s+(.+)$/)){g.exp=x[1];return}if(x=r.match(/^import\s+(\S+)/)){g.imp=x[1];return}if(/^cluster\s/.test(r)){g.rr=true;return}if(x=r.match(/^family\s+(.+)$/)){g.fam.push(x[1]);return}
      if(x=r.match(/^neighbor\s+([\d.]+)\s*(.*)$/)){const n=cNb(cfg,x[1],ri||'');n.sc=true;if(!g.nbs.includes(n))g.nbs.push(n);const y=x[2];let z;
        if(z=y.match(/^peer-as\s+(\d+)/))n._peer=+z[1];else if(z=y.match(/^description\s+(.+)$/))n.desc=unq(z[1]);else if(z=y.match(/^export\s+(.+)$/))nbExp.push([n,z[1]]);else if(z=y.match(/^import\s+(\S+)/))nbImp.push([n,z[1]]);
        else if(z=y.match(/^local-address\s+(\S+)/))n._la=z[1];else if(/^multihop/.test(y))n.mh=true;else if(z=y.match(/^family\s+(.+)$/))(n._fam=n._fam||[]).push(z[1]);return}return}
    if(m=t.match(/^deactivate (?:routing-instances \S+ )?protocols bgp group \S+ neighbor\s+([\d.]+)/)){cfg.bgp&&cfg.bgp.neighbors.filter(n=>n.ip===m[1]).forEach(n=>n.shut=true);return}
    if(m=t.match(/^set policy-options policy-statement\s+(\S+)\s+term\s+\S+\s+(from|then)\s+(.+)$/)){const P=pol[m[1]]||(pol[m[1]]={nets:[],red:[],nhs:false,def:false});const r=m[3];let x;
      if(x=r.match(/^route-filter\s+(\S+)/)){if(x[1]==='0.0.0.0/0')P.def=true;else if(pc(x[1]))P.nets.push(pc(x[1]))}else if(x=r.match(/^protocol\s+(\S+)/))P.red.push(x[1]);else if(/next-hop self/.test(r))P.nhs=true;return}
    if(m=t.match(/^set routing-options router-id\s+(\S+)/)){cfg._rid=m[1];return}
    if(m=t.match(/^set protocols ospf area\s+(\S+)\s+interface/)){cfg.ospf=cfg.ospf||{on:true,area:0};cfg.ospf.on=true;const a=m[1].includes('.')?(ip2i(m[1])||0):+m[1];cfg.ospf.area=a;return}
    if(/^set protocols ospf export/.test(t)){cfg.ospf=cfg.ospf||{on:true,area:0};cfg.ospf.dio=true;return}
    if(m=t.match(/^set firewall (?:family inet )?filter\s+(\S+)\s+term\s+(\S+)\s+(from|then)\s+(.+)$/)){cfg.aclName=m[1];const key=m[2];const r=terms[key]||(terms[key]={act:'permit',proto:'any',src:'any',dst:'any',port:'',desc:'',_order:Object.keys(terms).length});
      const v=m[4].trim().split(/\s+/);if(m[3]==='then'){r.act=/discard|reject/.test(v[0])?'deny':'permit';r._then=true}else{if(v[0]==='source-address')r.src=v[1];if(v[0]==='destination-address')r.dst=v[1];if(v[0]==='protocol')r.proto=v[1];if(v[0]==='destination-port')r.port=String(portNum(v[1])||'')}return}});
  cfg.ifaces.forEach(f=>{if(f._members){const ids=f._members.flatMap(x=>/^all$/.test(x)?['all']:[vlanByName[x]??(/^\d+$/.test(x)?+x:null)]).filter(x=>x!==null);
    if(f.mode==='trunk')f.allowed=ids.includes('all')?'':ids.join(',');else f.vlan=ids[0]||1;delete f._members}});
  riIf.forEach(([n,ri])=>{const mm=n.match(/^(.+?)\.(\d+)$/);const base=mm?mm[1]:n,u=mm?+mm[2]:0;if(base==='irb'){svObj(cfg,u).vrf=ri;return}if(base==='lo0'){cLoop(cfg,u).vrf=ri;return}const f=ifObj(cfg,base);if(u===0)f.vrf=ri;else{const sb=f.subs.find(x=>x.unit===u);if(sb)sb.vrf=ri}});
  irbMac.forEach(u=>{const s=cfg.svis.find(x=>x.vlan===u);if(s)s.agw=true});
  const vid=n=>vlanByName[n]??(/^VLAN(\d+)$/.test(n)?+n.slice(4):null);
  if(vtepSrc!==null||vxVl.length){const vx=cVx(cfg);vx.src=vtepSrc;vxVl.forEach(([n,vni])=>{const v=vid(n);if(v!=null)cVni(cfg,vni,v)});vxPeer.forEach(([n,ip])=>{const x=vx.vnis.find(y=>+y.vlan===vid(n));if(x)cPeer(x,ip)});Object.entries(vniRt).forEach(([vni,rt])=>{const x=vx.vnis.find(y=>+y.vni===+vni);if(x)x.rt=rt})}
  Object.entries(rmPol).forEach(([name,R])=>{const m={name,rules:Object.values(R).map(r=>{if(r._sc){r.sComm=commList(comms[r._sc]||'').join(' ');delete r._sc}return r})};cfg.rmaps.push(m)});
  Object.entries(comms).forEach(([name,mem])=>{if(/^BANCADA-/.test(name))return;cCl(cfg,name,'permit',mem)});
  const applyPol=(n,list)=>String(list).replace(/[\[\]]/g,' ').trim().split(/\s+/).forEach(pn=>{if(rmPol[pn]){n.rmOut=pn;return}const P=pol[pn];if(!P){if(/NHS/i.test(pn))n.nhs=true;if(/DEFAULT/i.test(pn))n.dio=true;return}
    if(P.nhs)n.nhs=true;if(P.def&&!P.nets.length&&!P.red.length)n.dio=true;P.nets.forEach(c=>cNet(cfg,c,n.vrf));P.red.forEach(r=>cRed(cfg,r,n.vrf))});
  const famSet=(n,list)=>{if(!list||!list.length)return;n.noV4=!list.some(f=>/^inet unicast/.test(f));if(list.some(f=>/^inet-vpn/.test(f)))n.vpnv4=true;if(list.some(f=>/^evpn/.test(f)))n.evpn=true};
  Object.values(grp).forEach(g=>g.nbs.forEach(n=>{n.ras=n._peer||(g.type==='internal'?(cfg.bgp?cfg.bgp.asn:0):g.peer);delete n._peer;if(g.exp)applyPol(n,g.exp);if(g.imp&&rmPol[g.imp])n.rmIn=g.imp;if(g.rr)n.rrc=true;famSet(n,n._fam||g.fam);delete n._fam}));
  nbExp.forEach(([n,l])=>applyPol(n,l));(cfg._vexp||[]).forEach(([ri,pn])=>{const P=pol[pn];if(P){P.nets.forEach(c=>cNet(cfg,c,ri));P.red.forEach(r=>cRed(cfg,r,ri))}});delete cfg._vexp;nbImp.forEach(([n,x])=>{if(rmPol[x])n.rmIn=x});
  if(cfg.bgp)cfg.bgp.neighbors.forEach(n=>{if(n._la){const l=cfg.loops.find(x=>pc(x.ip)&&pc(x.ip).ip===ip2i(n._la));if(l)n.us=String(l.id);delete n._la}});
  if(cfg._rid){if(cfg.ospf)cfg.ospf.rid=cfg._rid;if(cfg.bgp&&!cfg.bgp.rid)cfg.bgp.rid=cfg._rid;delete cfg._rid}if(cfg.bgp)cfg.bgp.neighbors.forEach(n=>{if(!n.ras&&cfg.bgp.asn)n.ras=cfg.bgp.asn;delete n._peer});
  Object.values(terms).sort((a,b)=>a._order-b._order).forEach(r=>{if(r.act==='deny'&&r.proto==='any'&&r.src==='any'&&r.dst==='any')return;delete r._order;delete r._then;cfg.rules.push(r)});
  if(cfg.bgp){const asn=cfg.bgp.asn;if(cfg.vx)cfg.vx.vnis.forEach(x=>{if(x.rt===`${asn}:${x.vni}`)x.rt=''});cfg.vrfs.forEach(v=>{if(+v.l3vni>0){const a=`${asn}:${v.l3vni}`;if(v.rtImp===a&&v.rtExp===a){v.rtImp='';v.rtExp=''}}})}
  return cfg}

/* Huawei VRP */
function parseHuawei(text){const cfg=blankCfg();const CRYPTO_ACL=new Set([...String(text).matchAll(/^\s*security acl (\d+)/gm)].map(x=>x[1]));let cur=null,ctx=null,acl=null,oc=null,bv='',baf='v4';
  text.split(/\r?\n/).forEach(raw=>{const line=raw.replace(/\s+$/,'');const t=line.trim();if(!t||t==='#'||t==='return')return;const ind=/^\s/.test(line);let m;
    if(!ind){cur=null;ctx=null;
      if(m=t.match(/^sysname\s+(\S+)/)){cfg.hostname=m[1];return}
      if(m=t.match(/^ip vpn-instance\s+(\S+)/)){if(isMgmtVrfName(m[1]))return;cur=cVrf(cfg,m[1]);ctx='vpn';return}
      if(m=t.match(/^ospf\s+\d+(?:\s+router-id\s+(\S+))?\s+vpn-instance\s+(\S+)/)){oc=cOspfV(cfg,m[2]);if(m[1])oc.rid=m[1];ctx='ospf';return}
      if(m=t.match(/^bgp\s+(\d+)/)){cBgp(cfg).asn=+m[1];ctx='bgp';bv='';baf='v4';return}
      if(m=t.match(/^ip ip-prefix\s+(\S+)\s+index\s+(\d+)\s+(permit|deny)\s+(\S+)\s+(\d+)(.*)$/)){const c=pc(`${m[4]}/${m[5]}`);if(c){const ge=(m[6].match(/greater-equal\s+(\d+)/)||[])[1],le=(m[6].match(/less-equal\s+(\d+)/)||[])[1];cPl(cfg,m[1],{seq:+m[2],act:m[3],pfx:netStr(c),ge:ge?+ge:'',le:le?+le:''})}return}
      if(m=t.match(/^ip community-filter\s+(?:basic\s+)?(\S+)\s+(?:index\s+\d+\s+)?(permit|deny)\s+(.+)$/)){cCl(cfg,m[1],m[2],m[3]);return}
      if(m=t.match(/^route-policy\s+(\S+)\s+(permit|deny)\s+node\s+(\d+)/)){cur=cRm(cfg,m[1],m[2],m[3]);ctx='rmap';return}
      if(m=t.match(/^bridge-domain\s+(\d+)/)){cur={bd:+m[1],vlan:+m[1]};ctx='bd';return}
      if(m=t.match(/^vlan batch\s+(.+)$/)){parseList(m[1]).forEach(id=>{if(!cfg.vlans.some(x=>x.id===id))cfg.vlans.push({id,name:''})});return}
      if(m=t.match(/^vlan\s+(\d+)$/)){ctx='vlan';cur=cfg.vlans.find(x=>x.id===+m[1])||(cfg.vlans.push({id:+m[1],name:''}),cfg.vlans[cfg.vlans.length-1]);return}
      if(m=t.match(/^interface Vlanif(\d+)/i)){ctx='svi';cur=svObj(cfg,+m[1]);return}
      if(m=t.match(/^interface LoopBack(\d+)/i)){ctx='loop';cur=cLoop(cfg,m[1]);return}
      if(m=t.match(/^interface Nve\d+/i)){ctx='nve';cVx(cfg);return}
      if(m=t.match(/^interface\s+(\S+)/)){const n=m[1],sub=n.match(/^(.+?)\.(\d+)$/);ctx='if';if(sub){const b=ifObj(cfg,sub[1]);cur={sub:true,base:b,vlan:+sub[2],ip:'',vip:''};b.subs.push(cur)}else cur=ifObj(cfg,n);return}
      if(m=t.match(/^ip route-static\s+(?:vpn-instance\s+(\S+)\s+)?(\S+)\s+(\S+)\s+(\S+)/)){const dst=/^\d+$/.test(m[3])?`${m[2]}/${m[3]}`:ipMask(m[2],m[3]);if(isNull(m[4]))m[4]='Null0';if(!pc(dst)||(ip2i(m[4])===null&&!isNull(m[4])))return;if(m[1]){if(isMgmtVrfName(m[1])){if(pc(dst).len===0)cfg.mgmtGw=m[4];return}cVrf(cfg,m[1]);cfg.routes.push({dst:netStr(pc(dst)),nh:m[4],vrf:m[1]});return}cfg.routes.push({dst:netStr(pc(dst)),nh:m[4]});return}
      if(m=t.match(/^ospf\s+\d+(?:\s+router-id\s+(\S+))?/)){cfg.ospf={on:true,area:0,rid:m[1]||''};oc=cfg.ospf;ctx='ospf';return}
      if(m=t.match(/^acl (?:number )?(3\d{3})/)){if(CRYPTO_ACL.has(m[1])){ctx='skip';return}ctx='acl';acl=m[1];cfg.aclName=m[1];return}
      return}
    if(ctx==='rmap'&&cur){if(m=t.match(/^if-match ip-prefix\s+(\S+)/))cur.mPfx=m[1];else if(m=t.match(/^if-match community-filter\s+(\S+)/))cur.mComm=m[1];else if(m=t.match(/^apply local-preference\s+(\d+)/))cur.sLp=m[1];else if(m=t.match(/^apply cost\s+(\d+)/))cur.sMed=m[1];
      else if(m=t.match(/^apply community\s+(.+)$/)){cur.sAdd=/additive/.test(m[1]);cur.sComm=commList(m[1].replace(/additive/,'')).join(' ')}else if(m=t.match(/^apply as-path\s+(.+?)(?:\s+additive)?$/))cur.sPre=m[1].split(/\s+/).filter(x=>/^\d+$/.test(x)).join(' ');return}
    if(ctx==='bd'&&cur){if(m=t.match(/^l2 binding vlan\s+(\d+)/))cur.vlan=+m[1];if(m=t.match(/^vxlan vni\s+(\d+)/))cur.x=cVni(cfg,m[1],cur.vlan);if(m=t.match(/^vpn-target\s+(\S+)\s+(?:export|import)-extcommunity/)){if(cur.x)cur.x.rt=m[1];else cur.rt=m[1]}if(cur.x&&cur.rt&&!cur.x.rt)cur.x.rt=cur.rt;if(cur.x)cur.x.vlan=cur.vlan;return}
    if(ctx==='nve'){if(m=t.match(/^source\s+(\S+)/))cfg._vtepIp=m[1];if(m=t.match(/^vni\s+(\d+)\s+head-end peer-list\s+(.+)$/)){const x=cVni(cfg,m[1],null);if(!/protocol bgp/.test(m[2]))m[2].split(/\s+/).forEach(ip=>cPeer(x,ip))}return}
    if(ctx==='vlan'&&cur){if(m=t.match(/^description\s+(.+)$/))cur.name=m[1].replace(/\s+/g,'_');return}
    if(ctx==='ospf'&&oc){if(m=t.match(/^area\s+(\S+)/))oc.area=m[1].includes('.')?(ip2i(m[1])||0):+m[1];if(/default-route-advertise/.test(t))oc.dio=true;return}
    if(ctx==='vpn'&&cur){if(m=t.match(/^route-distinguisher\s+(\S+)/))cur.rd=m[1];if(m=t.match(/^vxlan vni\s+(\d+)/))cur.l3vni=+m[1];
      if(m=t.match(/^vpn-target\s+(\S+)\s+(export|import)-extcommunity/)){const k=m[2]==='import'?'rtImp':'rtExp';cur[k]=[...new Set([...rtList(cur[k]),m[1]])].join(' ')}return}
    if(ctx==='bgp'){if(m=t.match(/^router-id\s+(\S+)/)){cfg.bgp.rid=m[1];return}if(/^ipv4-family unicast/.test(t)){bv='';baf='v4';return}if(m=t.match(/^ipv4-family vpn-instance\s+(\S+)/)){bv=m[1];baf='v4';cVrf(cfg,bv);return}
      if(/^ipv4-family vpnv4/.test(t)){bv='';baf='vpnv4';return}if(/^l2vpn-family evpn/.test(t)){bv='';baf='evpn';return}
      if(m=t.match(/^(undo\s+)?peer\s+([\d.]+)\s+(.+)$/)){const n=cNb(cfg,m[2],bv),r=m[3],neg=!!m[1];let x;if(x=r.match(/^as-number\s+(\d+)/))n.ras=+x[1];else if(x=r.match(/^description\s+(.+)$/))n.desc=x[1];else if(/next-hop-local/.test(r))n.nhs=true;else if(/default-route-advertise/.test(r))n.dio=true;else if(/^ignore/.test(r))n.shut=true;
        else if(x=r.match(/^connect-interface\s+LoopBack(\d+)/i))n.us=x[1];else if(/^ebgp-max-hop/.test(r))n.mh=true;else if(/^advertise-community/.test(r))n.sc=true;else if(/^reflect-client/.test(r))n.rrc=true;
        else if(x=r.match(/^route-policy\s+(\S+)\s+(import|export)/)){if(x[2]==='import')n.rmIn=x[1];else n.rmOut=x[1]}else if(/^enable/.test(r)){if(baf==='v4'){if(neg)n._nov4=true}else if(!neg)n[baf]=true}return}
      if(m=t.match(/^network\s+(\S+)(?:\s+(\S+))?(?:\s+route-policy\s+(\S+))?/)){cNet(cfg,m[2]&&m[2]!=='route-policy'?pc(/^\d+$/.test(m[2])?`${m[1]}/${m[2]}`:ipMask(m[1],m[2])):classNet(m[1]),bv,m[3]);return}
      if(m=t.match(/^import-route\s+(\S+)(?:\s+\d+)?(?:\s+route-policy\s+(\S+))?/)){cRed(cfg,m[1],bv,m[2]);return}return}
    if(ctx==='acl'){if(m=t.match(/^rule\s+\d+\s+(permit|deny)\s+(\S+)(.*)$/)){const r={act:m[1],proto:m[2]==='ip'?'any':m[2],src:'any',dst:'any',port:'',desc:''};const rest=m[3];
      const a=(kw)=>{const mm=rest.match(new RegExp(kw+'\\s+(\\S+)\\s+(\\S+)'));if(!mm)return'any';const w=ip2i(mm[2]);if(mm[2]==='0')return mm[1]+'/32';if(w===null)return'any';const l=maskLen(i2ip((~w)>>>0));return l===null?'any':`${mm[1]}/${l}`};
      r.src=a('source');r.dst=a('destination');const pp=rest.match(/destination-port eq\s+(\S+)/);if(pp)r.port=String(portNum(pp[1])||'');if(r.act==='deny'&&r.proto==='any'&&r.src==='any'&&r.dst==='any')return;cfg.rules.push(r)}return}
    if((ctx==='svi'||ctx==='if'||ctx==='loop')&&cur&&(m=t.match(/^ip binding vpn-instance\s+(\S+)/))){if(!isMgmtVrfName(m[1])){cVrf(cfg,m[1]);cur.vrf=m[1]}return}
    if(ctx==='loop'&&cur){if(m=t.match(/^ip address\s+(\S+)\s+(\S+)/))cur.ip=ipMask(m[1],m[2]);if(m=t.match(/^description\s+(.+)$/))cur.desc=m[1];return}
    if(ctx==='svi'&&cur){if(m=t.match(/^ip address\s+(\S+)\s+(\S+)/))cur.ip=ipMask(m[1],m[2]);if(m=t.match(/^vrrp vrid\s+\d+\s+virtual-ip\s+(\S+)/))cur.vip=m[1];if(/^mac-address/.test(t))cur.agw=true;if(t==='mpls')cur.mpls=true;return}
    if(ctx==='if'&&cur){if(t==='mpls'){cur.mpls=true;return}
      if(cur.sub){if(m=t.match(/^ip address\s+(\S+)\s+(\S+)/))cur.ip=ipMask(m[1],m[2]);if(m=t.match(/^dot1q termination vid\s+(\d+)/))cur.vlan=+m[1];if(m=t.match(/^vrrp vrid\s+\d+\s+virtual-ip\s+(\S+)/))cur.vip=m[1];return}
      if(m=t.match(/^description\s+(.+)$/)){cur.desc=m[1];return}
      if(t==='shutdown'){cur.shut=true;return}if(t==='undo shutdown'){cur.shut=false;return}
      if(t==='undo portswitch'){cur.routed=true;return}
      if(m=t.match(/^port link-type\s+(access|trunk)/)){cur.mode=m[1];cur.routed=false;return}
      if(m=t.match(/^port default vlan\s+(\d+)/)){cur.vlan=+m[1];cur.mode=cur.mode||'access';return}
      if(m=t.match(/^port trunk allow-pass vlan\s+(.+)$/)){const all=/2 to 4094|all/.test(m[1]);cur.allowed=all?'':parseList(m[1]).join(',');cur.mode='trunk';return}
      if(m=t.match(/^port trunk pvid vlan\s+(\d+)/)){cur.native=+m[1];return}
      if(m=t.match(/^ip address\s+(\S+)\s+(\S+)/)){cur.ip=ipMask(m[1],m[2]);if(cur.routed===null)cur.routed=true;return}
      if(m=t.match(/^eth-trunk\s+(\d+)/)){cur.lag=+m[1];return}
      if(m=t.match(/^vrrp vrid\s+\d+\s+virtual-ip\s+(\S+)/)){cur.vip=m[1];return}
      if(/nat outbound/.test(t)){cur.nat=true;return}}});
  cfg.bgp&&cfg.bgp.neighbors.forEach(n=>{n.noV4=!n.vrf&&!!n._nov4;delete n._nov4});
  postParse(cfg,'huawei');return cfg}

function parseConfig(text,fmt){fmt=fmt&&fmt!=='auto'?fmt:detectFormat(text);const cfg=fmt==='junos'?parseJunos(text):fmt==='huawei'?parseHuawei(text):fmt==='vyos'?parseVyos(text):fmt==='routeros'?parseRouterOS(text):fmt==='fortios'?parseFortios(text):parseCiscoLike(text,fmt);cfg.format=fmt;
  cfg.ifaces.forEach(f=>{const n=lagNumOf(f.name);if(n){f.isLag=n}});try{cfg.vpns=parseVpns(text,fmt)}catch(e){cfg.vpns=[]}try{cfg.dnat=parseNat(text,fmt)}catch(e){cfg.dnat=[]}return cfg}

/* VyOS (formato set) */
function parseVyos(text){const cfg=blankCfg();const q=s=>String(s||'').replace(/^'|'$/g,'');const vrrp={};const vxi={};let srcIp=null;
  text.split(/\r?\n/).forEach(raw=>{let t=raw.trim();if(!t||t[0]==='#')return;let m;let vr='';
    if(m=t.match(/^set vrf name\s+(\S+)\s+(.*)$/)){if(isMgmtVrfName(m[1])){const x=m[2].match(/^protocols static route\s+0\.0\.0\.0\/0\s+next-hop\s+(\S+)/);if(x)cfg.mgmtGw=q(x[1]);return}vr=m[1];const V=cVrf(cfg,vr);if(/^table/.test(m[2]))return;let y;if(y=m[2].match(/^vni\s+(\d+)/)){V.l3vni=+y[1];return}
      if(y=m[2].match(/^protocols bgp address-family (?:ipv4-unicast|l2vpn-evpn) (rd vpn export|rd)\s+(\S+)/)){V.rd=q(y[2]);return}if(y=m[2].match(/^protocols bgp address-family (?:ipv4-unicast route-target vpn|l2vpn-evpn route-target) (import|export)\s+(.+)$/)){V[y[1]==='import'?'rtImp':'rtExp']=rtList(q(y[2])).join(' ');return}if(/^protocols bgp address-family (ipv4-unicast (label|export|import) vpn|l2vpn-evpn advertise)/.test(m[2]))return;t='set '+m[2];
      let x;if(x=t.match(/^set protocols static route\s+(\S+)\s+blackhole/)){const c=pc(q(x[1]));if(c)cfg.routes.push({dst:netStr(c),nh:'Null0',vrf:vr});return}
      if(x=t.match(/^set protocols static route\s+(\S+)\s+next-hop\s+(\S+)/)){const c=pc(q(x[1]));if(c&&ip2i(q(x[2]))!==null)cfg.routes.push({dst:netStr(c),nh:q(x[2]),vrf:vr});return}
      if(x=t.match(/^set protocols ospf area\s+(\S+)/)){cOspfV(cfg,vr).area=+x[1]||0;return}if(x=t.match(/^set protocols ospf parameters router-id\s+(\S+)/)){cOspfV(cfg,vr).rid=q(x[1]);return}if(/^set protocols ospf default-information originate/.test(t)){cOspfV(cfg,vr).dio=true;return}}
    if(m=t.match(/^set protocols bgp\s+(.*)$/)){const r=m[1];let x;
      if(x=r.match(/^(?:system-as|local-as)\s+(\S+)/)){cBgp(cfg).asn=+q(x[1]);return}if(x=r.match(/^\d+\s/)){}
      if(x=r.match(/^parameters router-id\s+(\S+)/)){cBgp(cfg).rid=q(x[1]);return}
      if(x=r.match(/^address-family l2vpn-evpn vni\s+(\d+)\s+route-target\s+\S+\s+(\S+)/)){(cfg._evRt=cfg._evRt||{})[x[1]]=q(x[2]);return}if(/^address-family l2vpn-evpn/.test(r))return;
      if(x=r.match(/^neighbor\s+([\d.]+)\s+(.*)$/)){const n=cNb(cfg,x[1],vr),y=x[2];let z;n.sc=true;if(/^address-family ipv4-unicast/.test(y))n._v4=true;if(/^address-family ipv4-vpn/.test(y))n.vpnv4=true;if(/^address-family l2vpn-evpn/.test(y))n.evpn=true;if(/route-reflector-client/.test(y))n.rrc=true;if(z=y.match(/route-map import\s+(\S+)/))n.rmIn=q(z[1]);if(z=y.match(/route-map export\s+(\S+)/))n.rmOut=q(z[1]);if(z=y.match(/^update-source\s+dum(\d+)/))n.us=z[1];if(/^ebgp-multihop/.test(y))n.mh=true;if(z=y.match(/^remote-as\s+(\S+)/))n.ras=+q(z[1]);else if(z=y.match(/^description\s+(.+)$/))n.desc=q(z[1]);else if(/nexthop-self/.test(y))n.nhs=true;else if(/default-originate/.test(y))n.dio=true;else if(/^shutdown/.test(y))n.shut=true;return}
      if(x=r.match(/^address-family ipv4-unicast network\s+(\S+)(?:\s+route-map\s+(\S+))?/)){cNet(cfg,pc(q(x[1])),vr,x[2]);return}if(x=r.match(/^address-family ipv4-unicast redistribute\s+(\S+)(?:\s+route-map\s+(\S+))?/)){cRed(cfg,x[1],vr,x[2]);return}return}
    if(m=t.match(/^set interfaces dummy dum(\d+)\s+(address|description|vrf)\s+(.+)$/)){const l=cLoop(cfg,m[1]);if(m[2]==='address')l.ip=q(m[3]);else if(m[2]==='description')l.desc=q(m[3]);else l.vrf=q(m[3]);return}
    if(m=t.match(/^set interfaces vxlan\s+(\S+)\s+(vni|source-address|remote)\s+(\S+)/)){const o=vxi[m[1]]=vxi[m[1]]||{peers:[]};if(m[2]==='vni')o.vni=+m[3];else if(m[2]==='source-address')srcIp=m[3];else o.peers.push(m[3]);return}if(/^set interfaces vxlan/.test(t))return;
    if(m=t.match(/^set interfaces bridge\s+\S+\s+member interface\s+(vxlan\S+)\s+native-vlan\s+(\d+)/)){(vxi[m[1]]=vxi[m[1]]||{peers:[]}).vlan=+m[2];return}
    if(m=t.match(/^set interfaces bridge\s+\S+\s+vif\s+(\d+)\s+mac\s/)){svObj(cfg,+m[1]).agw=true;return}
    if(m=t.match(/^set protocols mpls (?:ldp )?interface\s+(\S+)/)){const n=m[1],sm=n.match(/^(.+)\.(\d+)$/);if(sm){const b=ifObj(cfg,sm[1]);let sb=b.subs.find(x=>x.vlan===+sm[2]);if(!sb){sb={vlan:+sm[2],ip:'',vip:'',nat:null};b.subs.push(sb)}sb.mpls=true}else ifObj(cfg,n).mpls=true;return}if(/^set protocols mpls/.test(t))return;
    if(m=t.match(/^set policy prefix-list\s+(\S+)\s+rule\s+(\d+)\s+(action|prefix|ge|le)\s+(\S+)/)){const p=cPl(cfg,m[1]);let r=p.rules.find(x=>+x.seq===+m[2]);if(!r){r={seq:+m[2],act:'permit',pfx:'',ge:'',le:''};p.rules.push(r)}const v=q(m[4]);if(m[3]==='action')r.act=v;if(m[3]==='prefix')r.pfx=pc(v)?netStr(pc(v)):'';if(m[3]==='ge')r.ge=+v;if(m[3]==='le')r.le=+v;return}
    if(m=t.match(/^set policy community-list\s+(\S+)\s+rule\s+(\d+)\s+(action|regex)\s+(.+)$/)){const c=(cfg._cl=cfg._cl||{});const k=m[1]+'|'+m[2];const o=c[k]=c[k]||{name:m[1],act:'permit',comm:''};if(m[3]==='action')o.act=q(m[4]);else o.comm=q(m[4]);return}
    if(m=t.match(/^set policy route-map\s+(\S+)\s+rule\s+(\d+)\s+(.+)$/)){const r=cRm(cfg,m[1],'permit',m[2]);const y=m[3];let z;if(z=y.match(/^action\s+(\S+)/))r.act=q(z[1]);else if(z=y.match(/^match ip address prefix-list\s+(\S+)/))r.mPfx=q(z[1]);else if(z=y.match(/^match community community-list\s+(\S+)/))r.mComm=q(z[1]);
      else if(z=y.match(/^set local-preference\s+(\S+)/))r.sLp=q(z[1]);else if(z=y.match(/^set metric\s+(\S+)/))r.sMed=q(z[1]);else if(z=y.match(/^set community (add|replace)\s+(.+)$/)){r.sAdd=z[1]==='add';r.sComm=commList(q(z[2])).join(' ')}else if(z=y.match(/^set as-path prepend\s+(.+)$/))r.sPre=q(z[1]);return}
    if(m=t.match(/^set system host-name\s+(\S+)/)){cfg.hostname=q(m[1]);return}
    if(m=t.match(/^set interfaces (?:ethernet|bonding)\s+(\S+)\s+vif\s+(\d+)\s+address\s+(\S+)/)){const b=ifObj(cfg,m[1]);let s=b.subs.find(x=>x.vlan===+m[2]);if(!s){s={vlan:+m[2],ip:'',vip:'',nat:null};b.subs.push(s)}if(pc(q(m[3])))s.ip=q(m[3]);b.routed=true;return}
    if(m=t.match(/^set interfaces bonding\s+(\S+)\s+member interface\s+(\S+)/)){ifObj(cfg,m[2]).lag=lagNumOf(m[1]);ifObj(cfg,m[1]);return}
    if(m=t.match(/^set interfaces (?:ethernet|bonding)\s+(\S+)\s+description\s+(.+)$/)){ifObj(cfg,m[1]).desc=q(m[2]);return}
    if(m=t.match(/^set interfaces (?:ethernet|bonding)\s+(\S+)\s+address\s+(\S+)/)){const f=ifObj(cfg,m[1]);if(pc(q(m[2]))){f.ip=q(m[2]);f.routed=true}return}
    if(m=t.match(/^set interfaces (?:ethernet|bonding)\s+(\S+)\s+vif\s+(\d+)\s+vrf\s+(\S+)/)){const b=ifObj(cfg,m[1]);let sb=b.subs.find(x=>x.vlan===+m[2]);if(!sb){sb={vlan:+m[2],ip:'',vip:'',nat:null};b.subs.push(sb)}if(!isMgmtVrfName(m[3])){cVrf(cfg,m[3]);sb.vrf=m[3]}return}
    if(m=t.match(/^set interfaces bridge\s+\S+\s+vif\s+(\d+)\s+vrf\s+(\S+)/)){if(!isMgmtVrfName(m[2])){cVrf(cfg,m[2]);svObj(cfg,+m[1]).vrf=m[2]}return}
    if(m=t.match(/^set interfaces (?:ethernet|bonding)\s+(\S+)\s+vrf\s+(\S+)/)){if(!isMgmtVrfName(m[2])){cVrf(cfg,m[2]);ifObj(cfg,m[1]).vrf=m[2]}return}
    if(m=t.match(/^set interfaces (?:ethernet|bonding)\s+(\S+)\s+disable/)){ifObj(cfg,m[1]).shut=true;return}
    if(m=t.match(/^set interfaces bridge\s+\S+\s+member interface\s+(\S+)\s+allowed-vlan\s+(\d+)/)){const f=ifObj(cfg,m[1]);f.mode='trunk';f.routed=false;f.allowed=f.allowed?f.allowed+','+m[2]:m[2];if(!cfg.vlans.some(v=>v.id===+m[2]))cfg.vlans.push({id:+m[2],name:''});return}
    if(m=t.match(/^set interfaces bridge\s+\S+\s+member interface\s+(\S+)\s+native-vlan\s+(\d+)/)){const f=ifObj(cfg,m[1]);f.routed=false;if(!f.mode)f.mode='access';f.vlan=+m[2];f.native=+m[2];if(!cfg.vlans.some(v=>v.id===+m[2]))cfg.vlans.push({id:+m[2],name:''});return}
    if(m=t.match(/^set interfaces bridge\s+\S+\s+vif\s+(\d+)\s+address\s+(\S+)/)){svObj(cfg,+m[1]).ip=q(m[2]);if(!cfg.vlans.some(v=>v.id===+m[1]))cfg.vlans.push({id:+m[1],name:''});return}
    if(m=t.match(/^set high-availability vrrp group\s+(\S+)\s+interface\s+(\S+)/)){(vrrp[m[1]]=vrrp[m[1]]||{}).ifc=m[2];return}
    if(m=t.match(/^set high-availability vrrp group\s+(\S+)\s+(?:address|virtual-address)\s+(\S+)/)){(vrrp[m[1]]=vrrp[m[1]]||{}).vip=q(m[2]).split('/')[0];return}
    if(m=t.match(/^set protocols static route\s+(\S+)\s+blackhole/)){const c=pc(q(m[1]));if(c)cfg.routes.push({dst:netStr(c),nh:'Null0'});return}
    if(m=t.match(/^set protocols static route\s+(\S+)\s+next-hop\s+(\S+)/)){const dst=q(m[1]),nh=q(m[2]);if(pc(dst)&&ip2i(nh)!==null)cfg.routes.push({dst:netStr(pc(dst)),nh});return}
    if(m=t.match(/^set vrf name\s+\S+\s+protocols static route\s+0\.0\.0\.0\/0\s+next-hop\s+(\S+)/)){cfg.mgmtGw=q(m[1]);return}
    if(m=t.match(/^set protocols ospf parameters router-id\s+(\S+)/)){cfg.ospf=cfg.ospf||{on:true,area:0};cfg.ospf.rid=m[1];return}
    if(m=t.match(/^set protocols ospf area\s+(\S+)/)){cfg.ospf=cfg.ospf||{on:true,area:0};cfg.ospf.area=m[1].includes('.')?(ip2i(m[1])||0):+m[1];return}
    if(/^set protocols ospf default-information originate/.test(t)){cfg.ospf=cfg.ospf||{on:true,area:0};cfg.ospf.dio=true;return}
    if(m=t.match(/^set nat source rule\s+\d+\s+outbound-interface(?: name)?\s+(\S+)/)){ifObj(cfg,q(m[1])).nat=true;return}});
  Object.values(vrrp).forEach(g=>{if(!g.ifc||!g.vip)return;const sm=g.ifc.match(/^(br\d+|bridge\d*)\.(\d+)$/);if(sm){svObj(cfg,+sm[2]).vip=g.vip;return}
    const im=g.ifc.match(/^(.+)\.(\d+)$/);if(im){const s=ifObj(cfg,im[1]).subs.find(x=>x.vlan===+im[2]);if(s)s.vip=g.vip;return}ifObj(cfg,g.ifc).vip=g.vip});
  cfg.ifaces.forEach(f=>{if(f.allowed)f.allowed=[...new Set(f.allowed.split(','))].join(',')});
  Object.values(cfg._cl||{}).forEach(o=>cCl(cfg,o.name,o.act,o.comm));delete cfg._cl;cfg.ifaces=cfg.ifaces.filter(f=>!/^vxlan/.test(f.name));
  Object.values(vxi).forEach(o=>{if(o.vni&&o.vlan!=null){const x=cVni(cfg,o.vni,o.vlan);o.peers.forEach(p=>cPeer(x,p))}});if(cfg.vx&&srcIp)cfg._vtepIp=srcIp;
  if(cfg.bgp)cfg.bgp.neighbors.forEach(n=>{if(!n.vrf)n.noV4=!n._v4&&(n.vpnv4||n.evpn);delete n._v4});postParse(cfg,'vyos');return cfg}

/* MikroTik RouterOS (export) */
function parseRouterOS(text){const cfg=blankCfg();let sec='';const kv=s=>{const o={};(s.match(/([\w.-]+)=("[^"]*"|\[[^\]]*\]|\S+)/g)||[]).forEach(x=>{const i=x.indexOf('=');o[x.slice(0,i)]=x.slice(i+1).replace(/^"|"$/g,'')});return o};
  const lagOf={},vlanIf={},vrrpIf={},bridges=new Set(),vrfIfs=[],alist={},ospfInst={},vxI={},mplsIf=[],vpnL=[];let tpl={};const lagName=n=>{const m=n.match(/^bond(?:ing)?(\d+)$/);return m?'port-channel'+m[1]:n};
  const lines=text.replace(/\\\r?\n\s*/g,'').split(/\r?\n/);
  lines.forEach(raw=>{const t=raw.trim();if(!t||t[0]==='#')return;if(t[0]==='/'){const m=t.match(/^(\/[a-z\- \/]+?)(?:\s+(add|set)\s+(.*))?$/i);sec=m?m[1].trim():t;if(m&&m[2])handle(m[2],m[3]);return}
    const m=t.match(/^(add|set)\s+(.*)$/);if(m)handle(m[1],m[2])});
  function handle(op,rest){const o=kv(rest);
    if(sec==='/interface vxlan'&&o.name&&o.vni){vxI[o.name]={vni:+o.vni,rt:((o.comment||'').match(/rt=(\S+)/)||[])[1]||''};if(o['local-address'])cfg._vtepIp=o['local-address'];cVx(cfg);return}
    if(sec==='/interface vxlan vteps'&&o.interface&&o['remote-ip']){if(/EVPN/i.test(o.comment||''))return;(vxI[o.interface]=vxI[o.interface]||{}).peers=[...((vxI[o.interface]||{}).peers||[]),o['remote-ip']];return}
    if(sec==='/interface bridge port'&&o.interface&&vxI[o.interface]){vxI[o.interface].vlan=+o.pvid;return}
    if(sec==='/mpls ldp interface'&&o.interface){mplsIf.push(o.interface);return}
    if(sec==='/mpls ldp')return;
    if(sec==='/routing bgp vpn'&&o.vrf){vpnL.push(o);return}
    if(sec==='/routing filter rule'&&o.chain){const meta={};String(o.comment||'').split(/\s+/).forEach(x=>{const i=x.indexOf('=');if(i>0)meta[x.slice(0,i)]=x.slice(i+1)});if(!meta.rm||!meta.seq)return;const rule=o.rule||'';
      const r=cRm(cfg,meta.rm,/reject/.test(rule)?'deny':'permit',meta.seq);let x;if(x=rule.match(/set bgp-local-pref (\d+)/))r.sLp=x[1];if(x=rule.match(/set bgp-med (\d+)/))r.sMed=x[1];if(x=rule.match(/(append|set) bgp-communities ([\w:,.-]+)/)){r.sAdd=x[1]==='append';r.sComm=commList(x[2]).join(' ')}if(meta.pre)r.sPre=meta.pre.split('.').join(' ');
      if(meta.pl){r.mPfx=meta.pl;const dm=rule.match(/dst in ([\d.\/]+)/);if(dm&&pc(dm[1])){const c=pc(dm[1]);let ge='',le='';const lr=rule.match(/dst-len in (\d+)-(\d+)/);if(lr){ge=+lr[1]===c.len?'':+lr[1];le=+lr[2]}cPl(cfg,meta.pl,{seq:+meta.ple||null,act:'permit',pfx:netStr(c),ge,le})}}
      if(meta.cl){r.mComm=meta.cl;const cm=rule.match(/bgp-communities includes ([\w:,.-]+)/);if(cm)cCl(cfg,meta.cl,'permit',cm[1].replace(/,/g,' '))}return}
    if(sec==='/system identity'&&o.name){cfg.hostname=o.name;return}
    if(sec==='/ip vrf'&&o.name){if(isMgmtVrfName(o.name))return;const V=cVrf(cfg,o.name);const l3=(o.comment||'').match(/l3vni=(\d+)/);if(l3)V.l3vni=+l3[1];const rr=(o.comment||'').match(/redistribute=(\S+)/);if(rr)rr[1].split(',').forEach(r=>cRed(cfg,r,o.name));(o.interfaces||'').split(',').filter(x=>x&&x!=='none').forEach(i=>vrfIfs.push([i,o.name]));return}
    if(sec==='/ip firewall address-list'&&o.list&&o.address){(alist[o.list]=alist[o.list]||[]).push(o.address);return}
    if(sec==='/routing bgp template'){if(o.as)tpl.as=+o.as;if(o['router-id'])tpl.rid=o['router-id'];return}
    if(sec==='/routing bgp connection'&&o['remote.address']){const ip=o['remote.address'].split('/')[0];const vr=o.vrf&&!isMgmtVrfName(o.vrf)&&o.vrf!=='main'?o.vrf:'';const b=cBgp(cfg);const as=+(o.as||o['local.as']||0);if(as)b.asn=as;
      const n=cNb(cfg,ip,vr);n.ras=+o['remote.as']||0;n.sc=true;if(o['address-families']){const af=o['address-families'].split(',');n.noV4=!af.includes('ip');n.vpnv4=af.includes('vpnv4');n.evpn=af.includes('evpn')}if(o['local.address'])n._la=o['local.address'];if(o.multihop==='yes')n.mh=true;if(/rr$/.test(o['local.role']||''))n.rrc=true;if(o['input.filter'])n.rmIn=o['input.filter'];if(o['output.filter-chain'])n.rmOut=o['output.filter-chain'];if(o.comment)n.desc=o.comment;if(o['output.default-originate']&&o['output.default-originate']!=='never')n.dio=true;if(/force-self/.test(o['nexthop-choice']||''))n.nhs=true;if(o.disabled==='yes')n.shut=true;
      (o['output.redistribute']||'').split(',').filter(Boolean).forEach(r=>cRed(cfg,r,vr));if(o['output.network'])n._nl=o['output.network'];return}
    if(sec==='/interface ethernet'){const dn=(rest.match(/default-name=(\S+?)\s*\]/)||[])[1]||o.name;if(dn){const f=ifObj(cfg,dn);if(o.comment)f.desc=o.comment;if(o.disabled==='yes')f.shut=true}return}
    if(sec==='/interface bonding'&&o.name){const ln=lagName(o.name);ifObj(cfg,ln);(o.slaves||'').split(',').filter(Boolean).forEach(s=>{ifObj(cfg,s).lag=lagNumOf(ln)});lagOf[o.name]=ln;return}
    if(sec==='/interface bridge'&&o.name){const lo=loopNum(o.name);if(lo!==null){const dm=(o.comment||'').match(/^loopback: (.+)$/);if(dm)cLoop(cfg,lo).desc=dm[1];return}bridges.add(o.name);return}
    if(sec==='/interface bridge port'&&o.interface){const f=ifObj(cfg,lagOf[o.interface]||o.interface);f.routed=false;if(o.pvid&&o['frame-types']!=='admit-only-vlan-tagged'){f.mode=f.mode||'access';f.vlan=+o.pvid}else f.mode='trunk';return}
    if(sec==='/interface bridge vlan'&&o['vlan-ids']){['tagged','untagged'].forEach(k=>{if(o[k])o[k]=o[k].split(',').filter(x=>!vxI[x]).join(',')});parseList(o['vlan-ids']).forEach(v=>{if(!cfg.vlans.some(x=>x.id===v))cfg.vlans.push({id:v,name:''});(o.tagged||'').split(',').filter(x=>x&&!bridges.has(x)).forEach(n=>{const f=ifObj(cfg,lagOf[n]||n);f.mode='trunk';f.routed=false;f.allowed=f.allowed?f.allowed+','+v:String(v)});
      (o.untagged||'').split(',').filter(x=>x&&!bridges.has(x)).forEach(n=>{const f=ifObj(cfg,lagOf[n]||n);if(f.mode!=='trunk')f.mode='access';f.routed=false;f.vlan=v})});return}
    if(sec==='/interface vlan'&&o.name&&o.interface){vlanIf[o.name]={base:o.interface,vlan:+o['vlan-id']};return}
    if(sec==='/interface vrrp'&&o.name&&o.interface){vrrpIf[o.name]=o.interface;return}
    if(sec==='/ip address'&&o.address&&/^wg|wireguard/i.test(o.interface||''))return;
    if(sec==='/ip address'&&o.address&&o.interface){const a=o.address;if(!pc(a))return;const n=o.interface;const lo=loopNum(n);if(lo!==null){cLoop(cfg,lo).ip=a;const dsc=(o.comment||'').match(/^loopback: (.+)$/);return}
      if(/anycast/i.test(o.comment||'')){const vi0=vlanIf[n];if(vi0&&bridges.has(vi0.base)){const sv=svObj(cfg,vi0.vlan);sv.ip=a;sv.agw=true;if(!cfg.vlans.some(x=>x.id===vi0.vlan))cfg.vlans.push({id:vi0.vlan,name:''});return}}
      if(vrrpIf[n]){const base=vrrpIf[n],vi=vlanIf[base],ip=a.split('/')[0];if(vi&&bridges.has(vi.base))svObj(cfg,vi.vlan).vip=ip;else if(vi){const s=ifObj(cfg,lagOf[vi.base]||vi.base).subs.find(x=>x.vlan===vi.vlan);if(s)s.vip=ip}else ifObj(cfg,lagOf[base]||base).vip=ip;return}
      const vi=vlanIf[n];if(vi&&bridges.has(vi.base)){svObj(cfg,vi.vlan).ip=a;if(!cfg.vlans.some(x=>x.id===vi.vlan))cfg.vlans.push({id:vi.vlan,name:''});return}
      if(vi){const b=ifObj(cfg,lagOf[vi.base]||vi.base);b.routed=true;b.subs.push({vlan:vi.vlan,ip:a,vip:'',nat:null});return}
      const f=ifObj(cfg,lagOf[n]||n);f.ip=a;f.routed=true;return}
    if(sec==='/ip route'&&o['dst-address']&&/(^|\s)blackhole(\s|$)/.test(rest)){const x=pc(o['dst-address']);if(x){const r={dst:netStr(x),nh:'Null0'};if(o['routing-table']&&o['routing-table']!=='main'&&!isMgmtVrfName(o['routing-table'])){r.vrf=o['routing-table'];cVrf(cfg,r.vrf)}cfg.routes.push(r)}return}
    if(sec==='/ip route'&&o['dst-address']&&o.gateway&&/@/.test(o.gateway)){const x=pc(o['dst-address']);const [gw,vr]=o.gateway.split('@');if(x&&ip2i(gw)!==null){if(isMgmtVrfName(vr)){if(x.len===0)cfg.mgmtGw=gw}else{cVrf(cfg,vr);cfg.routes.push({dst:netStr(x),nh:gw,vrf:vr})}}return}
    if(sec==='/ip route'&&o['dst-address']&&o.gateway){const x=pc(o['dst-address']);if(x&&ip2i(o.gateway)!==null){if(o['routing-table']&&/mgmt|gerencia/i.test(o['routing-table'])){if(x.len===0)cfg.mgmtGw=o.gateway;return}cfg.routes.push({dst:netStr(x),nh:o.gateway})}return}
    if(sec==='/ip firewall nat'&&o.action==='masquerade'&&o['out-interface']){ifObj(cfg,o['out-interface']).nat=true;return}
    if(sec==='/routing ospf instance'){let oc;if(o.vrf&&o.vrf!=='main'&&!isMgmtVrfName(o.vrf)){oc=cOspfV(cfg,o.vrf);if(o.name)ospfInst[o.name]=oc}else{cfg.ospf=cfg.ospf||{on:true,area:0};oc=cfg.ospf;if(o.name)ospfInst[o.name]=oc}if(o['router-id'])oc.rid=o['router-id'];if((o['originate-default']&&o['originate-default']!=='never')||(o.originate&&/default/.test(rest)))oc.dio=true;return}
    if(sec==='/routing ospf area'&&o['area-id']){const oc=(o.instance&&ospfInst[o.instance])||(cfg.ospf=cfg.ospf||{on:true,area:0});oc.area=ip2i(o['area-id'])||0;return}}
  vrfIfs.forEach(([i,vr])=>{const lo=loopNum(i);if(lo!==null){cLoop(cfg,lo).vrf=vr;return}const vi=vlanIf[i];if(vi&&bridges.has(vi.base)){svObj(cfg,vi.vlan).vrf=vr;return}if(vi){const b=ifObj(cfg,lagOf[vi.base]||vi.base);const sb=b.subs.find(x=>x.vlan===vi.vlan);if(sb)sb.vrf=vr;return}ifObj(cfg,lagOf[i]||i).vrf=vr});
  Object.values(vxI).forEach(x=>{if(!x.vni||x.vlan==null)return;const y=cVni(cfg,x.vni,x.vlan);y.rt=x.rt||'';(x.peers||[]).forEach(ip=>cPeer(y,ip))});
  mplsIf.forEach(i=>{const vi=vlanIf[i];if(vi){const b=ifObj(cfg,lagOf[vi.base]||vi.base);const sb=b.subs.find(x=>x.vlan===vi.vlan);if(sb)sb.mpls=true;return}ifObj(cfg,lagOf[i]||i).mpls=true});
  vpnL.forEach(o=>{const V=cVrf(cfg,o.vrf);if(o['route-distinguisher'])V.rd=o['route-distinguisher'];if(o['import.route-targets'])V.rtImp=rtList(o['import.route-targets']).join(' ');if(o['export.route-targets'])V.rtExp=rtList(o['export.route-targets']).join(' ');(o['export.redistribute']||'').split(',').filter(Boolean).forEach(r=>cRed(cfg,r,o.vrf))});
  if(cfg.bgp)cfg.bgp.neighbors.forEach(n=>{if(n._la){const l=cfg.loops.find(x=>pc(x.ip)&&pc(x.ip).ip===ip2i(n._la));if(l)n.us=String(l.id);delete n._la}});
  if(cfg.bgp){if(!cfg.bgp.asn&&tpl.as)cfg.bgp.asn=tpl.as;if(tpl.rid)cfg.bgp.rid=tpl.rid;cfg.bgp.neighbors.forEach(n=>{if(n._nl){(alist[n._nl]||[]).forEach(a=>cNet(cfg,pc(a),n.vrf));delete n._nl}})}
  cfg.ifaces.forEach(f=>{if(f.allowed)f.allowed=[...new Set(f.allowed.split(','))].join(',')});postParse(cfg,'routeros');return cfg}

/* Fortinet FortiOS */
function parseFortios(text){const cfg=blankCfg();const stack=[];let cur=null,rt=null,bn=null,bnet=null;const q=s=>String(s||'').replace(/^"|"$/g,'');const subs=[];
  const vmap={},l3m={};let pl=null,cl=null,rmo=null,rr=null,vf=null,red=null;
  text.split(/\r?\n/).forEach(raw=>{const t=raw.trim();let m;if(m=t.match(/^#\s*VRF\s+(\d+)\s*=\s*(\S+)(?:\s+l3vni=(\d+))?/)){vmap[m[1]]=m[2];if(m[3])l3m[m[2]]=+m[3];return}if(m=t.match(/^#\s*redistribute\s+(\S+)\s+na VRF\s+(\S+)/)){cRed(cfg,m[1],m[2]);return}if(m=t.match(/^#\s*vizinho na VRF\s+(\S+)/)){if(bn)bn._vrf=m[1];return}if(!t||t[0]==='#')return;
    if(m=t.match(/^config\s+(.+)$/)){stack.push(q(m[1].replace(/"/g,'')));return}if(t==='end'){stack.pop();cur=null;rt=null;return}
    const sec=stack[stack.length-1]||'',par=stack[stack.length-2]||'';
    if(m=t.match(/^edit\s+(.+)$/)){const n=q(m[1]);if(sec==='router prefix-list'){pl=n;cPl(cfg,n);return}if(sec==='router community-list'){cl=n;return}if(sec==='router route-map'){rmo=n;return}
      if(sec==='rule'&&par==='router prefix-list'){rr={seq:+n,act:'permit',pfx:'',ge:'',le:''};return}if(sec==='rule'&&par==='router community-list'){rr={act:'permit',comm:''};return}if(sec==='rule'&&par==='router route-map'){rr=cRm(cfg,rmo,'permit',n);return}
      if(sec==='vrf'&&par==='router bgp'){vf=cVrf(cfg,'VRF'+n);return}}
    if(sec==='rule'&&rr&&(m=t.match(/^set\s+(\S+)\s+(.+)$/))){const k=m[1],v=q(m[2]);
      if(par==='router prefix-list'){if(k==='action')rr.act=v;if(k==='prefix'){const p=m[2].split(/\s+/).map(q);rr.pfx=ipMask(p[0],p[1]||'255.255.255.255')}if(k==='ge')rr.ge=+v;if(k==='le')rr.le=+v}
      if(par==='router community-list'){if(k==='action')rr.act=v;if(k==='match')rr.comm=v}
      if(par==='router route-map'){if(k==='action')rr.act=v;if(k==='match-ip-address')rr.mPfx=v;if(k==='match-community')rr.mComm=v;if(k==='set-local-preference')rr.sLp=v;if(k==='set-metric')rr.sMed=v;if(k==='set-community')rr.sComm=commList(v).join(' ');if(k==='set-community-additive')rr.sAdd=v==='enable';if(k==='set-aspath')rr.sPre=v}return}
    if(sec==='rule'&&t==='next'&&rr){if(par==='router prefix-list'&&pc(rr.pfx)){rr.pfx=netStr(pc(rr.pfx));cPl(cfg,pl,rr)}if(par==='router community-list')cCl(cfg,cl,rr.act,rr.comm);rr=null;return}
    if(sec==='vrf'&&vf&&(m=t.match(/^set\s+(rd|export-rt|import-rt)\s+(.+)$/))){if(m[1]==='rd')vf.rd=q(m[2]);else vf[m[1]==='export-rt'?'rtExp':'rtImp']=rtList(m[2].replace(/"/g,'')).join(' ');return}
    if(sec==='vrf'&&t==='next'){vf=null;return}
    if(/^redistribute/.test(sec)&&(m=t.match(/^set route-map\s+(.+)$/))){const b=cBgp(cfg);const r=b.redist.find(x=>x.src===({connected:'connected',static:'static',ospf:'ospf'})[q(sec.replace(/^redistribute\s+/,''))]&&!x.vrf);if(r)r.rm=q(m[1]);return}
    if(sec==='network'&&bnet&&(m=t.match(/^set route-map\s+(.+)$/))){const b=cBgp(cfg);const n=b.networks[b.networks.length-1];if(n)n.rm=q(m[1]);return}
    if(m=t.match(/^edit\s+(.+)$/)){const n=q(m[1]);if(sec==='system interface')cur={name:n,ip:'',alias:'',vlanid:0,parent:'',type:'',members:[],down:false,vrf:0};else if(sec==='router static')rt={dst:'0.0.0.0/0',gw:'',vrf:0};else if(sec==='neighbor'&&ip2i(n)!==null)bn=cNb(cfg,n,'');else if(sec==='network'&&par==='router bgp')bnet={};return}
    if(sec==='router bgp'&&(m=t.match(/^set\s+(as|router-id)\s+(\S+)/))){if(m[1]==='as')cBgp(cfg).asn=+m[2];else cBgp(cfg).rid=m[2];return}
    if(sec==='neighbor'&&bn&&(m=t.match(/^set\s+(\S+)\s+(.+)$/))){const v=q(m[2]);if(m[1]==='remote-as')bn.ras=+v;if(m[1]==='description')bn.desc=v;if(m[1]==='next-hop-self'&&v==='enable')bn.nhs=true;if(m[1]==='capability-default-originate'&&v==='enable')bn.dio=true;if(m[1]==='shutdown'&&v==='enable')bn.shut=true;if(m[1]==='update-source'){const lo=loopNum(v);if(lo!==null)bn.us=String(lo)}if(m[1]==='ebgp-enforce-multihop'&&v==='enable')bn.mh=true;if(m[1]==='activate'&&v==='disable')bn.noV4=true;if(m[1]==='activate-vpnv4'&&v==='enable')bn.vpnv4=true;if(m[1]==='activate-evpn'&&v==='enable')bn.evpn=true;if(m[1]==='send-community'&&v!=='disable')bn.sc=true;if(m[1]==='route-reflector-client'&&v==='enable')bn.rrc=true;if(m[1]==='route-map-in')bn.rmIn=v;if(m[1]==='route-map-out')bn.rmOut=v;return}
    if(sec==='network'&&par==='router bgp'&&bnet&&(m=t.match(/^set prefix\s+(\S+)\s+(\S+)/))){cNet(cfg,pc(ipMask(m[1],m[2])),'');return}
    if(/^redistribute/.test(sec)&&/^set status enable/.test(t)){cRed(cfg,q(sec.replace(/^redistribute\s+/,'')),'');return}
    if(t==='next'){if(sec==='system interface'&&cur){const lo=cur.type==='loopback'?loopNum(cur.name):null;if(lo!==null){const l=cLoop(cfg,lo);l.ip=cur.ip;if(cur.vrf)l.vrf='VRF'+cur.vrf;if(cur.alias)l.desc=cur.alias}else if(cur.vlanid&&cur.parent)subs.push(cur);else{const f=ifObj(cfg,cur.name);if(cur.ip){f.ip=cur.ip;f.routed=true}if(cur.vrf){f.vrf='VRF'+cur.vrf;cVrf(cfg,f.vrf)}if(cur.alias)f.desc=cur.alias;if(cur.down)f.shut=true;
        if(cur.type==='aggregate'){const n=cur.name.match(/(\d+)$/);const ln='port-channel'+(n?+n[1]:1);const lf=ifObj(cfg,ln);Object.assign(lf,{ip:f.ip,routed:f.routed,desc:f.desc});cfg.ifaces.splice(cfg.ifaces.indexOf(f),1);cur.members.forEach(x=>ifObj(cfg,x).lag=lagNumOf(ln))}}}
      if(sec==='router static'&&rt){if((ip2i(rt.gw)!==null||isNull(rt.gw))&&pc(rt.dst)){const r={dst:netStr(pc(rt.dst)),nh:rt.gw};if(rt.vrf){r.vrf='VRF'+rt.vrf;cVrf(cfg,r.vrf)}cfg.routes.push(r)}}
      if(sec==='neighbor')bn=null;if(sec==='network')bnet=null;cur=null;rt=null;return}
    if(sec==='system global'&&(m=t.match(/^set hostname\s+(.+)$/))){cfg.hostname=q(m[1]);return}
    if(sec==='system interface'&&cur&&(m=t.match(/^set\s+(\S+)\s+(.+)$/))){const k=m[1],v=m[2];
      if(k==='vrf'){cur.vrf=+v||0}else if(k==='ip'){const p=v.split(/\s+/).map(q);cur.ip=ipMask(p[0],p[1]||'255.255.255.255')}else if(k==='alias'||k==='description')cur.alias=q(v);else if(k==='vlanid')cur.vlanid=+v;else if(k==='interface')cur.parent=q(v);else if(k==='type')cur.type=v;else if(k==='member')cur.members=v.split(/\s+/).map(q);else if(k==='status'&&v==='down')cur.down=true;return}
    if(sec==='router static'&&rt&&(m=t.match(/^set\s+(\S+)\s+(.+)$/))){const p=m[2].split(/\s+/).map(q);if(m[1]==='dst')rt.dst=ipMask(p[0],p[1]||'255.255.255.255')||p[0];if(m[1]==='gateway')rt.gw=p[0];if(m[1]==='blackhole'&&p[0]==='enable')rt.gw='Null0';if(m[1]==='vrf')rt.vrf=+p[0]||0;return}
    if(sec==='firewall policy'&&/^set nat enable/.test(t)){cfg.warnings.push('Política com NAT encontrada — marque a interface externa como NAT.');return}
    if(sec==='router ospf'&&(m=t.match(/^set router-id\s+(\S+)/))){cfg.ospf=cfg.ospf||{on:true,area:0};cfg.ospf.rid=m[1];return}
    if(sec==='router ospf'&&/^set default-information-originate enable/.test(t)){cfg.ospf=cfg.ospf||{on:true,area:0};cfg.ospf.dio=true;return}});
  const ren=n=>{const m=/^VRF(\d+)$/.exec(n||'');return m&&vmap[m[1]]?vmap[m[1]]:n};
  subs.forEach(s=>{const b=ifObj(cfg,s.parent);b.routed=true;const x={vlan:s.vlanid,ip:s.ip,vip:'',nat:null};if(s.vrf){x.vrf='VRF'+s.vrf;cVrf(cfg,x.vrf)}b.subs.push(x)});
  if(Object.keys(vmap).length){cfg.vrfs.forEach(v=>v.name=ren(v.name));cfg.ifaces.forEach(f=>{if(f.vrf)f.vrf=ren(f.vrf);(f.subs||[]).forEach(x=>{if(x.vrf)x.vrf=ren(x.vrf)})});cfg.routes.forEach(r=>{if(r.vrf)r.vrf=ren(r.vrf)});cfg.loops.forEach(l=>{if(l.vrf)l.vrf=ren(l.vrf)});Object.values(vmap).forEach(n=>cVrf(cfg,n))}
  const seen={};cfg.vrfs=cfg.vrfs.filter(v=>{if(seen[v.name]){const o=seen[v.name];['rd','rtImp','rtExp'].forEach(k=>{if(v[k]&&!o[k])o[k]=v[k]});return false}seen[v.name]=v;return true});cfg.vrfs.forEach(v=>{if(l3m[v.name])v.l3vni=l3m[v.name]});
  if(cfg.bgp)cfg.bgp.neighbors.forEach(n=>{if(n._vrf){n.vrf=n._vrf;cVrf(cfg,n._vrf);cfg.bgp.redist.filter(r=>!r.vrf).length;delete n._vrf}});return cfg}

/* casa o nome de interface do arquivo com uma porta do equipamento */
const sig=n=>{const m=String(n).toLowerCase().replace(/\.\d+$/,'').match(/\d+/g);return m?m.join('/'):''};
const pfx=n=>String(n).toLowerCase().replace(/[\d\/.\-:\s]+/g,'').replace(/^(gigabitethernet|gi|ge|g)$/,'ge').replace(/^(tengigabitethernet|te|xe|10ge)$/,'xe').replace(/^(ethernet|eth|et)$/,'eth');
function portMap(d,fmt){const map={};const add=(name,k)=>{const s=sig(name);if(!s)return;const key=pfx(name)+'|'+s;if(!(key in map))map[key]=k;if(!(('|'+s) in map))map['|'+s]=k};
  const order=[fmt,'auto',...VENDORS.map(v=>v[0])];if(fmt)d.ports.forEach((p,k)=>add(pn(fmt,d,k),k));d.ports.forEach((p,k)=>add(spn(d,k),k));order.forEach(v=>{if(v)d.ports.forEach((p,k)=>add(pn(v,d,k),k))});return map}
function findPort(d,map,name){if(/^(mgmt|management|em0|fxp0|meth|ma|eth-mgmt|ether-mgmt)\S*/i.test(name)){const k=d.ports.findIndex((p,j)=>isMgmt(d,j));if(k>=0)return k}
  const s=sig(name);if(!s)return-1;const k1=map[pfx(name)+'|'+s];if(k1!==undefined)return k1;const k2=map['|'+s];return k2===undefined?-1:k2}

/* aplica a configuração lida num equipamento */
function applyConfig(d,cfg,opt={}){const rep={applied:[],missing:[],renamed:'',notes:[]};const replace=opt.replace!==false;const map=portMap(d,cfg.format);
  if(cfg.hostname&&cfg.hostname!==d.name){const nm=cfg.hostname.replace(/[^\w.-]/g,'-');if(!byName(nm)){d.name=nm;rep.renamed=nm}else rep.notes.push(`Já existe um equipamento chamado ${nm}; o nome foi mantido.`)}
  if(replace){d.ports.forEach((p,k)=>{Object.assign(p,mkPort(d.type,isMgmt(d,k)?'mgmt':''));delete p.mpls;delete p.vrf;delete p.vip});d.vlans=[];d.svis=[];d.routes=[];d.vrfs=[];d.loops=[];d.pfx=[];d.clists=[];d.rmaps=[];delete d.vxlan;delete d.bgp;if(cfg.rules.length){d.rules=[];d.aclName=''}}
  const fw=fwd(d.type);const okV=n=>fw&&n&&!isMgmtVrfName(n)?n:'';if(fw)(cfg.vrfs||[]).forEach(v=>{let x=vrfObj(d,v.name);if(!x){x={name:v.name,rd:''};(d.vrfs=d.vrfs||[]).push(x)}if(v.rd)x.rd=v.rd;if(v.rtImp)x.rtImp=rtList(v.rtImp).join(' ');if(v.rtExp)x.rtExp=rtList(v.rtExp).join(' ');if(+v.l3vni>0)x.l3vni=+v.l3vni});
  if(fw){(cfg.loops||[]).forEach(l=>{if(!pc(l.ip))return;d.loops=(d.loops||[]).filter(x=>+x.id!==+l.id);d.loops.push({id:+l.id,ip:l.ip,vrf:okV(l.vrf),desc:l.desc||''})});(d.loops||[]).sort((a,b)=>a.id-b.id);
    ['pfx','clists','rmaps'].forEach(k=>{(cfg[k]||[]).forEach(x=>{d[k]=(d[k]||[]).filter(y=>y.name!==x.name);d[k].push(JSON.parse(JSON.stringify(x)))})})}
  if(d.type==='sw3'&&cfg.vx&&(cfg.vx.vnis.length||cfg.vx.src!=null))d.vxlan={src:cfg.vx.src,vnis:cfg.vx.vnis.map(x=>({vlan:+x.vlan,vni:+x.vni,rt:x.rt||'',peers:x.peers||''}))};else if(cfg.vx&&cfg.vx.vnis.length)rep.notes.push('VXLAN ignorado: nesta bancada só switches L3 fazem VTEP.');
  if(!fw&&(cfg.vrfs||[]).length)rep.notes.push('VRFs ignoradas: este equipamento não roteia.');
  if(isSw(d.type))cfg.vlans.forEach(v=>{if(v.id<2||v.id>4094)return;const ex=d.vlans.find(x=>+x.id===v.id);if(ex){if(v.name)ex.name=v.name}else d.vlans.push({id:v.id,name:v.name||'VLAN'+String(v.id).padStart(4,'0')})});d.vlans.sort((a,b)=>a.id-b.id);
  const lagCfg={};cfg.ifaces.filter(f=>f.isLag).forEach(f=>lagCfg[f.isLag]=f);
  const setPort=(k,f)=>{const p=d.ports[k];if(f.desc)p.desc=f.desc;p.shut=!!f.shut;
    const routed=f.routed===true||(f.routed===null&&f.mode===null&&!!f.ip);
    if(isMgmt(d,k)){p.mode='routed';if(f.ip&&pc(f.ip))p.ip=f.ip;return}
    if(isSw(d.type)&&!routed){p.mode=f.mode||'access';if(f.vlan)p.vlan=f.vlan;if(f.allowed!==null&&f.allowed!==undefined)p.allowed=f.allowed;if(f.native)p.native=f.native}
    else{if(isSw(d.type)&&d.type==='sw2'&&!isMgmt(d,k)){rep.notes.push(`${spn(d,k)}: switch L2 não aceita porta roteada; IP ignorado.`);return}p.mode='routed';if(f.ip&&pc(f.ip))p.ip=f.ip;if(f.vip)p.vip=f.vip;if(f.nat!==null&&f.nat!==undefined)p.nat=!!f.nat;p.vrf=okV(f.vrf);if(f.mpls&&fw)p.mpls=true;
      p.subs=(f.subs||[]).filter(s=>s.vlan).map(s=>({vlan:s.vlan,ip:s.ip&&pc(s.ip)?s.ip:'',nat:!!s.nat,vip:s.vip||'',vrf:okV(s.vrf),...(s.mpls&&fw?{mpls:true}:{})}))}};
  cfg.ifaces.forEach(f=>{if(f.isLag)return;const k=findPort(d,map,f.name);if(k<0){rep.missing.push(f.name);return}
    const lc=f.lag?lagCfg[f.lag]:null;const merged=lc?{...lc,desc:f.desc||lc.desc,shut:f.shut,subs:lc.subs}:f;setPort(k,merged);d.ports[k].lag=+f.lag||0;rep.applied.push(`${f.name} → ${spn(d,k)}${f.lag?' (LAG '+f.lag+')':''}`)});
  Object.keys(lagCfg).forEach(n=>{if(!lagMembers(d,n).length)rep.notes.push(`${lagCfg[n].name}: nenhum membro encontrado neste equipamento.`)});
  cfg.svis.forEach(s=>{if(!isSw(d.type)){rep.notes.push(`Vlan${s.vlan} ignorada (equipamento não é switch).`);return}if(!pc(s.ip))return;d.svis.push({vlan:s.vlan,ip:s.ip,vip:s.vip||'',vrf:okV(s.vrf),...(s.agw?{agw:true}:{}),...(s.mpls?{mpls:true}:{})});if(s.vlan!==1&&!d.vlans.some(x=>+x.id===s.vlan))d.vlans.push({id:s.vlan,name:'VLAN'+String(s.vlan).padStart(4,'0')})});
  d.svis.sort((a,b)=>a.vlan-b.vlan);
  if(fwd(d.type)||isHost(d.type))cfg.routes.forEach(r=>{if(r.vrf&&!fw)return;const rr={dst:r.dst,nh:r.nh,...(r.vrf?{vrf:r.vrf}:{})};if(!d.routes.some(x=>x.dst===rr.dst&&x.nh===rr.nh&&(x.vrf||'')===(rr.vrf||'')))d.routes.push(rr)});
  if(fw)Object.entries(cfg.vrfOspf||{}).forEach(([n,o])=>{const x=vrfObj(d,n);if(x)x.ospf={on:true,area:o.area||0,rid:o.rid||'',dio:!!o.dio}});
  if(cfg.bgp&&cfg.bgp.asn){if(!fw)rep.notes.push('BGP ignorado: este equipamento não roteia.');else{const b=cfg.bgp;d.bgp={asn:+b.asn,rid:b.rid||'',...(b.noDefV4?{noDefV4:true}:{}),neighbors:b.neighbors.filter(n=>+n.ras>0).map(n=>({ip:n.ip,ras:+n.ras,vrf:okV(n.vrf),desc:n.desc||'',dio:!!n.dio,nhs:!!n.nhs,shut:!!n.shut,us:n.us||'',mh:!!n.mh,rrc:!!n.rrc,sc:!!n.sc,vpnv4:!n.vrf&&!!n.vpnv4,evpn:!n.vrf&&!!n.evpn,noV4:!n.vrf&&!!n.noV4,rmIn:n.rmIn||'',rmOut:n.rmOut||''})),networks:b.networks.map(n=>({pfx:n.pfx,vrf:okV(n.vrf),...(n.rm?{rm:n.rm}:{})})),redist:b.redist.map(r=>({src:r.src,vrf:okV(r.vrf),...(r.rm?{rm:r.rm}:{})}))};
    const sem=b.neighbors.filter(n=>!(+n.ras>0));if(sem.length)rep.notes.push(`Vizinhos BGP sem remote-as ignorados: ${sem.map(n=>n.ip).join(', ')}`)}}
  if(cfg.gw)d.gw=cfg.gw;else if(!fwd(d.type)){const def=cfg.routes.find(r=>pc(r.dst).len===0);if(def)d.gw=def.nh}
  if(cfg.mgmtGw){const k=d.ports.findIndex((p,j)=>isMgmt(d,j));if(k>=0)d.ports[k].gw=cfg.mgmtGw}
  if(cfg.ospf&&fwd(d.type))d.ospf={on:true,area:cfg.ospf.area||0,rid:cfg.ospf.rid||'',dio:!!cfg.ospf.dio};
  if(cfg.rules.length&&fwd(d.type)){d.rules=cfg.rules.map(r=>({act:r.act,proto:r.proto,src:r.src,dst:r.dst,port:r.port||'',desc:r.desc||''}));d.aclName=cfg.aclName||''}
  if((d.type==='fw'||d.type==='rtr')&&(cfg.dnat||[]).length){d.dnat=JSON.parse(JSON.stringify(cfg.dnat));rep.applied.push(`${cfg.dnat.length} encaminhamento(s) de porta`)}
  if(fwd(d.type)&&(cfg.vpns||[]).length){d.vpns=JSON.parse(JSON.stringify(cfg.vpns));rep.applied.push(`${cfg.vpns.length} túnel(is) VPN`)}else if(replace&&fwd(d.type)&&d.vpns&&!(cfg.vpns||[]).length&&opt.keepVpn!==true){}
  return rep}
function summarize(cfg){return{loops:(cfg.loops||[]).length,vnis:cfg.vx?cfg.vx.vnis.length:0,rmaps:(cfg.rmaps||[]).length,mpls:cfg.ifaces.some(f=>f.mpls||(f.subs||[]).some(x=>x.mpls)),format:FMT_NAMES[cfg.format]||cfg.format,hostname:cfg.hostname,vlans:cfg.vlans.length,ifaces:cfg.ifaces.filter(f=>!f.isLag).length,lags:cfg.ifaces.filter(f=>f.isLag).length,svis:cfg.svis.length,routes:cfg.routes.length,rules:cfg.rules.length,ospf:!!cfg.ospf||Object.keys(cfg.vrfOspf||{}).length>0,vrfs:(cfg.vrfs||[]).length,bgp:cfg.bgp&&cfg.bgp.asn?{asn:cfg.bgp.asn,neighbors:cfg.bgp.neighbors.length}:null}}

/* ---------- validação (servidor e importação) ---------- */
function validate(t){if(!t||typeof t!=='object')return'conteúdo vazio';if(!Array.isArray(t.devices)||!Array.isArray(t.links))return'faltam devices/links';
  const ids=new Set();for(const d of t.devices){if(!d||typeof d.id!=='string'||!TYPES[d.type]||!Array.isArray(d.ports))return'equipamento inválido';if(ids.has(d.id))return'id duplicado';ids.add(d.id);
    if(d.model&&!CAT.BY[d.model])return`modelo desconhecido: ${d.model}`;
    d.vlans=d.vlans||[];d.svis=d.svis||[];d.routes=d.routes||[];d.rules=d.rules||[];d.ospf=d.ospf||{on:false,area:0};d.gw=d.gw||'';d.vrfs=Array.isArray(d.vrfs)?d.vrfs.filter(v=>v&&typeof v.name==='string'&&v.name):[];if(d.bgp&&typeof d.bgp==='object'){d.bgp.neighbors=Array.isArray(d.bgp.neighbors)?d.bgp.neighbors:[];d.bgp.networks=Array.isArray(d.bgp.networks)?d.bgp.networks:[];d.bgp.redist=Array.isArray(d.bgp.redist)?d.bgp.redist:[]}else delete d.bgp;d.ports.forEach(p=>{p.subs=p.subs||[];p.lag=+p.lag||0;p.gw=p.gw||''});
    d.loops=Array.isArray(d.loops)?d.loops.filter(l=>l&&l.id!=null):[];['pfx','clists','rmaps'].forEach(k=>{d[k]=Array.isArray(d[k])?d[k].filter(x=>x&&x.name).map(x=>({...x,rules:Array.isArray(x.rules)?x.rules:[]})):[]});
    if(d.vxlan&&typeof d.vxlan==='object')d.vxlan.vnis=Array.isArray(d.vxlan.vnis)?d.vxlan.vnis:[];else delete d.vxlan;
    if(d.os&&!OSES[d.os])delete d.os;if(d.os){d.pkgs=Array.isArray(d.pkgs)?d.pkgs.filter(x=>typeof x==='string'):[];d.svcs=d.svcs&&typeof d.svcs==='object'?d.svcs:{};if(d.hfw&&typeof d.hfw==='object')d.hfw.allow=Array.isArray(d.hfw.allow)?d.hfw.allow:[];d.fs=d.fs&&typeof d.fs==='object'?d.fs:{};d.listen=Array.isArray(d.listen)?d.listen:[];d.dockers=Array.isArray(d.dockers)?d.dockers:[]}
    if(d.dnat!==undefined)d.dnat=Array.isArray(d.dnat)?d.dnat.filter(r=>r&&+r.port):[];
    if(d.vpns!==undefined)d.vpns=Array.isArray(d.vpns)?d.vpns.filter(t=>t&&(t.kind==='ipsec'||t.kind==='wireguard')&&typeof t.name==='string'):[];
    if(d.type==='cloud'){d.cloud=d.cloud&&typeof d.cloud==='object'?d.cloud:{kind:'fake',pool:'200.10.0.0/16',dns:[]};d.cloud.dns=Array.isArray(d.cloud.dns)?d.cloud.dns.filter(r=>r&&r.name&&r.ip):[]}
    if(d.k8s&&typeof d.k8s==='object'){const k=d.k8s;['ns','deploys','svcs','ings'].forEach(x=>{k[x]=Array.isArray(k[x])?k[x]:[]});if(!k.ns.length)k.ns=['default']}else delete d.k8s}
  for(const l of t.links){if(!l||!l.a||!l.b||!ids.has(l.a.dev)||!ids.has(l.b.dev))return'enlace inválido'}
  t.racks=Array.isArray(t.racks)?t.racks:[];
  if(t.devices.length>800)return'limite de 800 equipamentos';return null}

/* ---------- labs prontos ---------- */
function blank(name){return{devices:[],links:[],racks:[],seq:0,guide:null,exported:false,name:name||'Novo lab'}}
function sampleCampus(){S=blank('Campus de exemplo');
  const V=[{id:10,name:'VENDAS'},{id:20,name:'FINANCEIRO'},{id:30,name:'TI'}];
  const fw=mkDev('fw','FW-01',520,120,{ports:[[1,{ip:'203.0.113.2/30',nat:true,desc:'WAN ISP'}],[2,{ip:'10.0.0.2/30',desc:'LAN SW-CORE'}]],routes:[{dst:'10.10.0.0/16',nh:'10.0.0.1'},{dst:'0.0.0.0/0',nh:'203.0.113.1'}],
    rules:[{act:'permit',proto:'icmp',src:'10.10.0.0/16',dst:'any',port:'',desc:'ping de saida'},{act:'permit',proto:'tcp',src:'10.10.0.0/16',dst:'any',port:'443',desc:'HTTPS'},{act:'permit',proto:'tcp',src:'10.10.0.0/16',dst:'any',port:'80',desc:'HTTP'},{act:'permit',proto:'udp',src:'10.10.0.0/16',dst:'any',port:'53',desc:'DNS'}]});
  const isp=mkDev('rtr','R-ISP',870,120,{ports:[[1,{ip:'203.0.113.1/30',desc:'cliente FW-01'}],[2,{ip:'198.51.100.1/24',desc:'datacenter'}]]});
  const web=mkDev('srv','SRV-WEB',1170,120,{ports:[[1,{ip:'198.51.100.10/24'}]],gw:'198.51.100.1'});
  const core=mkDev('sw3','SW-CORE',520,330,{vlans:[...V,{id:40,name:'SERVIDORES'}].map(v=>({...v})),svis:[{vlan:10,ip:'10.10.10.1/24'},{vlan:20,ip:'10.10.20.1/24'},{vlan:30,ip:'10.10.30.1/24'},{vlan:40,ip:'10.10.40.1/24'}],
    routes:[{dst:'0.0.0.0/0',nh:'10.0.0.2'}],ports:[[1,{mode:'trunk',allowed:'10,20,30',desc:'SW-ACC-01'}],[2,{vlan:40,desc:'SRV-ERP'}],[24,{mode:'routed',ip:'10.0.0.1/30',desc:'FW-01'}]]});
  const erp=mkDev('srv','SRV-ERP',870,330,{ports:[[1,{ip:'10.10.40.10/24'}]],gw:'10.10.40.1'});
  const acc=mkDev('sw2','SW-ACC-01',520,540,{vlans:V.map(v=>({...v})),svis:[{vlan:30,ip:'10.10.30.2/24'}],gw:'10.10.30.1',
    ports:[[1,{vlan:10,desc:'PC-VENDAS'}],[2,{vlan:20,desc:'PC-FIN'}],[3,{vlan:30,desc:'PC-TI'}],[24,{mode:'trunk',allowed:'10,20,30',desc:'uplink SW-CORE'}]]});
  const p1=mkDev('pc','PC-VENDAS',280,750,{ports:[[1,{ip:'10.10.10.10/24'}]],gw:'10.10.10.1'});
  const p2=mkDev('pc','PC-FIN',520,750,{ports:[[1,{ip:'10.10.20.10/24'}]],gw:'10.10.20.1'});
  const p3=mkDev('pc','PC-TI',760,750,{ports:[[1,{ip:'10.10.30.10/24'}]],gw:'10.10.30.1'});
  addLink(fw,1,isp,1);addLink(isp,2,web,1);addLink(core,24,fw,2);addLink(core,2,erp,1);addLink(acc,24,core,1);addLink(p1,1,acc,1);addLink(p2,1,acc,2);addLink(p3,1,acc,3);return S}
function guideTopo(){S=blank('Guia: VLANs por departamento');S.guide='department-vlan-build';
  const core=mkDev('sw3','SW-CORE',620,200),and=mkDev('sw2','SW-ANDAR1',620,430);
  const a=mkDev('pc','PC-VENDAS',380,680,{ports:[[1,{ip:'10.10.10.10/24'}]],gw:'10.10.10.1'});
  const b=mkDev('pc','PC-FIN',620,680,{ports:[[1,{ip:'10.10.20.10/24'}]],gw:'10.10.20.1'});
  const c=mkDev('pc','PC-TI',860,680,{ports:[[1,{ip:'10.10.30.10/24'}]],gw:'10.10.30.1'});
  addLink(a,1,and,1);addLink(b,1,and,2);addLink(c,1,and,3);addLink(and,24,core,24);return S}

/* POP de Telco Cloud: borda, firewall, spine-leaf com par de leafs (vPC + VRRP), servidores com bond LACP, chassis blade e rede de gerência fora de banda */
function samplePOP(){S=blank('POP Telco Cloud');
  const rNet=addRack('R01-REDE',42,6),rCmp=addRack('R02-COMPUTE',42,15);
  const K=(d,n)=>{const k=d.ports.findIndex((p,j)=>spn(d,j)===n);if(k<0)throw new Error(`porta ${n} não existe em ${d.name}`);return k};
  const L=(a,an,b,bn)=>S.links.push({id:uid('l'),a:{dev:a.id,k:K(a,an)},b:{dev:b.id,k:K(b,bn)}});
  const set=(d,n,o)=>Object.assign(d.ports[K(d,n)],o);
  const VL=[{id:100,name:'OAM_API'},{id:200,name:'PROVIDER'},{id:300,name:'STORAGE'}];
  // internet e trânsito
  const isp=mkDev('rtr','TRANSITO',1080,60,{bgp:{asn:64500,rid:'198.51.100.1',neighbors:[{ip:'203.0.113.2',ras:65010,vrf:'',desc:'POP-FW-01',dio:true,nhs:false,shut:false}],networks:[{pfx:'198.51.100.0/24',vrf:''}],redist:[]},ports:[[1,{ip:'203.0.113.1/30',desc:'cliente POP'}],[2,{ip:'198.51.100.1/24',desc:'internet'}]]});
  const web=mkDev('srv','INTERNET',1300,60,{ports:[[1,{ip:'198.51.100.10/24'}]],gw:'198.51.100.1'});
  // firewall de borda
  const fw=mkDev('fw','FW-01',840,60,{model:'fortinet-fg-600f',bgp:{asn:65010,rid:'10.255.255.254',neighbors:[{ip:'203.0.113.1',ras:64500,vrf:'',desc:'TRANSITO',dio:false,nhs:false,shut:false},{ip:'172.16.0.2',ras:65020,vrf:'',desc:'PE-01',dio:true,nhs:false,shut:false}],networks:[],redist:[]},
    rules:[{act:'permit',proto:'icmp',src:'10.0.0.0/8',dst:'any',port:'',desc:'ping'},{act:'permit',proto:'tcp',src:'10.0.0.0/8',dst:'any',port:'443',desc:'HTTPS'},{act:'permit',proto:'tcp',src:'10.0.0.0/8',dst:'any',port:'80',desc:'HTTP'},{act:'permit',proto:'udp',src:'10.0.0.0/8',dst:'any',port:'53',desc:'DNS'}]});
  set(fw,'x1',{ip:'203.0.113.2/30',nat:true,desc:'WAN transito'});set(fw,'x2',{ip:'172.16.0.1/30',desc:'PE-01'});set(fw,'mgmt',{ip:'10.254.0.5/24'});
  // PE
  const pe=mkDev('rtr','PE-01',560,60,{model:'juniper-mx204',ospf:{on:true,area:0,rid:'10.255.255.1',dio:true},
    bgp:{asn:65020,rid:'10.255.255.1',neighbors:[{ip:'172.16.0.1',ras:65010,vrf:'',desc:'FW-01',dio:false,nhs:false,shut:false}],networks:[],redist:[{src:'connected',vrf:''},{src:'ospf',vrf:''}]}});
  set(pe,'xe-0/1/0',{ip:'172.16.0.2/30',desc:'FW-01'});set(pe,'et-0/0/1',{ip:'10.0.0.1/30',desc:'SPINE-01'});set(pe,'et-0/0/2',{ip:'10.0.0.5/30',desc:'SPINE-02'});set(pe,'fxp0',{ip:'10.254.0.4/24'});
  // spines
  const sp=[1,2].map(i=>mkDev('sw3',`SPINE-0${i}`,i===1?380:740,230,{model:'arista-7060cx-32s',ospf:{on:true,area:0,rid:`10.255.255.1${i}`}}));
  sp.forEach((s,i)=>{const n=i+1;set(s,'Et32',{mode:'routed',ip:`10.0.0.${n===1?2:6}/30`,desc:'PE-01'});set(s,'Et1',{mode:'routed',ip:`10.0.${n}.1/30`,desc:'LEAF-01'});set(s,'Et2',{mode:'routed',ip:`10.0.${n}.5/30`,desc:'LEAF-02'});set(s,'Ma1',{ip:`10.254.0.1${n}/24`})});
  // leafs (par vPC com VRRP)
  const lf=[1,2].map(i=>mkDev('sw3',`LEAF-0${i}`,i===1?380:740,420,{model:'cisco-n9k-93180yc-fx',vlans:VL.map(v=>({...v})),ospf:{on:true,area:0,rid:`10.255.255.2${i}`},vrfs:[{name:'STORAGE',rd:''}],
    svis:[{vlan:100,ip:`10.100.0.${i+1}/24`,vip:'10.100.0.1'},{vlan:200,ip:`10.200.0.${i+1}/24`,vip:'10.200.0.1'},{vlan:300,ip:`10.30.0.${i+1}/24`,vip:'10.30.0.1',vrf:'STORAGE'}]}));
  lf.forEach((l,i)=>{const n=i+1;set(l,'Eth1/49',{mode:'routed',ip:`10.0.1.${n===1?2:6}/30`,desc:'SPINE-01'});set(l,'Eth1/50',{mode:'routed',ip:`10.0.2.${n===1?2:6}/30`,desc:'SPINE-02'});
    ['Eth1/53','Eth1/54'].forEach(p=>set(l,p,{mode:'trunk',allowed:'100,200,300',lag:1,desc:'peer-link'}));
    set(l,'Eth1/1',{mode:'trunk',allowed:'100,200,300',lag:11,desc:'COMPUTE-01'});set(l,'Eth1/2',{mode:'trunk',allowed:'100,200,300',lag:12,desc:'CTRL-01'});set(l,'Eth1/51',{mode:'trunk',allowed:'100,200,300',desc:'BLADE-01'});
    set(l,'mgmt0',{ip:`10.254.0.2${n}/24`})});
  // servidores de rack com bond LACP
  const cmp=mkDev('srv','COMPUTE-01',240,640,{model:'dell-r750',gw:'10.100.0.1'});
  set(cmp,'ens1f0',{lag:1,subs:[{vlan:100,ip:'10.100.0.11/24',nat:false},{vlan:200,ip:'10.200.0.11/24',nat:false}]});set(cmp,'ens1f1',{lag:1});set(cmp,'iDRAC',{ip:'10.254.0.101/24'});
  const ctl=mkDev('srv','CTRL-01',470,640,{model:'hpe-dl380-gen11',gw:'10.100.0.1'});
  set(ctl,'ens1f0',{lag:1,subs:[{vlan:100,ip:'10.100.0.21/24',nat:false},{vlan:300,ip:'10.30.0.21/24',nat:false}]});set(ctl,'ens1f1',{lag:1});set(ctl,'iLO',{ip:'10.254.0.102/24'});
  // chassis blade
  const ch=addChassis('dell-mx7000','BLADE-01',700,560,4);
  const ioms=membersOf(ch).filter(d=>modelOf(d).form==='iom'),blades=membersOf(ch).filter(d=>modelOf(d).form==='blade');
  ioms.forEach((io,i)=>{io.vlans=VL.map(v=>({...v}));io.ports.forEach((p,k)=>{if(isInternal(io,k)){p.mode='trunk';p.allowed='100,200,300';if(k<blades.length)p.lag=k+1}});
    set(io,'eth1/1/37',{mode:'trunk',allowed:'100,200,300',desc:`LEAF-0${i+1}`});set(io,'mgmt1/1/1',{ip:`10.254.0.3${i+1}/24`})});
  blades.forEach(b=>{const s=+b.slot;b.gw='10.100.0.1';set(b,'ens3f0',{lag:1,subs:[{vlan:100,ip:`10.100.0.${40+s}/24`,nat:false},{vlan:200,ip:`10.200.0.${40+s}/24`,nat:false}]});set(b,'ens3f1',{lag:1})});
  // gerência fora de banda
  const oob=mkDev('sw2','OOB-01',1120,300,{model:'dell-n3248te-on',svis:[{vlan:1,ip:'10.254.0.2/24'}]});
  const jump=mkDev('pc','JUMP-01',1320,300,{gw:'10.254.0.2',ports:[[1,{ip:'10.254.0.10/24'}]]});
  // cabos
  L(isp,'Gi0/1',web,'eth0');L(fw,'x1',isp,'Gi0/0');L(pe,'xe-0/1/0',fw,'x2');
  L(sp[0],'Et32',pe,'et-0/0/1');L(sp[1],'Et32',pe,'et-0/0/2');
  L(sp[0],'Et1',lf[0],'Eth1/49');L(sp[0],'Et2',lf[1],'Eth1/49');L(sp[1],'Et1',lf[0],'Eth1/50');L(sp[1],'Et2',lf[1],'Eth1/50');
  L(lf[0],'Eth1/53',lf[1],'Eth1/53');L(lf[0],'Eth1/54',lf[1],'Eth1/54');
  L(cmp,'ens1f0',lf[0],'Eth1/1');L(cmp,'ens1f1',lf[1],'Eth1/1');L(ctl,'ens1f0',lf[0],'Eth1/2');L(ctl,'ens1f1',lf[1],'Eth1/2');
  L(ioms[0],'eth1/1/37',lf[0],'Eth1/51');L(ioms[1],'eth1/1/37',lf[1],'Eth1/51');
  [[jump,'eth0'],[pe,'fxp0'],[fw,'mgmt'],[sp[0],'Ma1'],[sp[1],'Ma1'],[lf[0],'mgmt0'],[lf[1],'mgmt0'],[cmp,'iDRAC'],[ctl,'iLO'],[ioms[0],'mgmt1/1/1'],[ioms[1],'mgmt1/1/1']]
    .forEach(([d,n],i)=>{set(oob,`eth1/1/${i+1}`,{desc:`${d.name} ${n}`});L(oob,`eth1/1/${i+1}`,d,n)});
  // racks
  [[pe,rNet,40],[fw,rNet,39],[sp[0],rNet,37],[sp[1],rNet,36],[oob,rNet,34],[lf[0],rCmp,42],[lf[1],rCmp,41],[ctl,rCmp,38],[cmp,rCmp,35],[ch,rCmp,20]].forEach(([d,r,u])=>rackPlace(d,r,u));
  return S}


/* helpers dos labs de exemplo */
function kit(){const K=(d,n)=>{const k=d.ports.findIndex((p,j)=>spn(d,j)===n);if(k<0)throw new Error(`porta ${n} não existe em ${d.name}`);return k};
  return{K,L:(a,an,b,bn)=>S.links.push({id:uid('l'),a:{dev:a.id,k:K(a,an)},b:{dev:b.id,k:K(b,bn)}}),set:(d,n,o)=>Object.assign(d.ports[K(d,n)],o)}}
const NB=(ip,ras,o={})=>({ip,ras,vrf:'',desc:'',dio:false,nhs:false,shut:false,us:'',mh:false,rrc:false,sc:true,vpnv4:false,evpn:false,noV4:false,rmIn:'',rmOut:'',...o});

/* Backbone de operadora: MPLS/LDP no core, route reflector e L3VPN para dois clientes com endereços sobrepostos */
function sampleMPLS(){S=blank('Backbone MPLS L3VPN');const{L,set}=kit();
  const core=(d,ifs)=>ifs.forEach(([n,ip,desc])=>set(d,n,{mode:'routed',ip,desc,mpls:true}));
  const ibgp=(peers,rrc)=>peers.map(([ip,desc])=>NB(ip,65000,{desc,us:'0',vpnv4:true,noV4:true,rrc:!!rrc}));
  const vrfA={name:'CLIENTE-A',rd:'65000:101',rtImp:'65000:101',rtExp:'65000:101'},vrfB={name:'CLIENTE-B',rd:'65000:102',rtImp:'65000:102',rtExp:'65000:102'};
  const pe1=mkDev('rtr','PE-SP',300,260,{model:'cisco-asr1001-x',loops:[{id:0,ip:'10.255.0.1/32',vrf:'',desc:'router-id / LDP / iBGP'}],ospf:{on:true,area:0,rid:'10.255.0.1'},vrfs:[{...vrfA},{...vrfB}],
    routes:[{dst:'192.168.10.0/24',nh:'172.16.2.2',vrf:'CLIENTE-B'}],
    bgp:{asn:65000,rid:'10.255.0.1',neighbors:[...ibgp([['10.255.0.2','RR P-01']]),NB('172.16.1.2',65101,{vrf:'CLIENTE-A',desc:'CE-A-SP'})],networks:[],redist:[{src:'static',vrf:'CLIENTE-B'},{src:'connected',vrf:'CLIENTE-B'}]}});
  const p1=mkDev('rtr','P-01',620,120,{model:'juniper-mx204',loops:[{id:0,ip:'10.255.0.2/32',vrf:'',desc:'router-id / RR'}],ospf:{on:true,area:0,rid:'10.255.0.2'},
    bgp:{asn:65000,rid:'10.255.0.2',neighbors:ibgp([['10.255.0.1','PE-SP'],['10.255.0.4','PE-RJ']],true),networks:[],redist:[]}});
  const p2=mkDev('rtr','P-02',620,400,{model:'arista-7280cr3-32p4',loops:[{id:0,ip:'10.255.0.3/32',vrf:'',desc:'router-id / LDP'}],ospf:{on:true,area:0,rid:'10.255.0.3'}});
  const pe2=mkDev('rtr','PE-RJ',940,260,{model:'huawei-ne40e-m2k',loops:[{id:0,ip:'10.255.0.4/32',vrf:'',desc:'router-id / LDP / iBGP'}],ospf:{on:true,area:0,rid:'10.255.0.4'},vrfs:[{...vrfA},{...vrfB}],
    routes:[{dst:'192.168.30.0/24',nh:'172.16.2.6',vrf:'CLIENTE-B'}],
    pfx:[{name:'PL-CLIENTE-A',rules:[{seq:5,act:'permit',pfx:'192.168.0.0/16',ge:'',le:'24'}]}],
    rmaps:[{name:'RM-CE-A-IN',rules:[{seq:10,act:'permit',mPfx:'PL-CLIENTE-A',mComm:'',sLp:'200',sMed:'',sComm:'65000:102',sAdd:true,sPre:''}]}],
    bgp:{asn:65000,rid:'10.255.0.4',neighbors:[...ibgp([['10.255.0.2','RR P-01']]),NB('172.16.1.6',65102,{vrf:'CLIENTE-A',desc:'CE-A-RJ',rmIn:'RM-CE-A-IN'})],networks:[],redist:[{src:'static',vrf:'CLIENTE-B'},{src:'connected',vrf:'CLIENTE-B'}]}});
  core(pe1,[['Gi0/0/0','10.1.0.1/30','P-01'],['Gi0/0/1','10.1.0.13/30','P-02']]);core(p1,[['xe-0/1/0','10.1.0.2/30','PE-SP'],['et-0/0/0','10.1.0.5/30','P-02'],['xe-0/1/1','10.1.0.17/30','PE-RJ']]);
  core(p2,[['Et1','10.1.0.6/30','P-01'],['Et2','10.1.0.9/30','PE-RJ'],['Et3','10.1.0.14/30','PE-SP']]);core(pe2,[['GE0/1/0','10.1.0.10/30','P-02'],['GE0/1/1','10.1.0.18/30','P-01']]);
  set(pe1,'Gi0/0/2',{ip:'172.16.1.1/30',vrf:'CLIENTE-A',desc:'CE-A-SP'});set(pe1,'Gi0/0/3',{ip:'172.16.2.1/30',vrf:'CLIENTE-B',desc:'CE-B-SP'});
  set(pe2,'GE0/1/2',{ip:'172.16.1.5/30',vrf:'CLIENTE-A',desc:'CE-A-RJ'});set(pe2,'GE0/1/3',{ip:'172.16.2.5/30',vrf:'CLIENTE-B',desc:'CE-B-RJ'});
  const ce=(name,x,y,wan,lan,o)=>mkDev('rtr',name,x,y,{ports:[[1,{ip:wan,desc:'PE'}],[2,{ip:lan,desc:'LAN'}]],...o});
  const ceA1=ce('CE-A-SP',80,80,'172.16.1.2/30','192.168.10.1/24',{bgp:{asn:65101,rid:'',neighbors:[NB('172.16.1.1',65000,{desc:'PE-SP'})],networks:[{pfx:'192.168.10.0/24',vrf:''}],redist:[]}});
  const ceB1=ce('CE-B-SP',80,440,'172.16.2.2/30','192.168.10.1/24',{routes:[{dst:'0.0.0.0/0',nh:'172.16.2.1'}]});
  const ceA2=ce('CE-A-RJ',1160,80,'172.16.1.6/30','192.168.20.1/24',{bgp:{asn:65102,rid:'',neighbors:[NB('172.16.1.5',65000,{desc:'PE-RJ'})],networks:[{pfx:'192.168.20.0/24',vrf:''}],redist:[]}});
  const ceB2=ce('CE-B-RJ',1160,440,'172.16.2.6/30','192.168.30.1/24',{routes:[{dst:'0.0.0.0/0',nh:'172.16.2.5'}]});
  const pc_=(n,x,y,ip,gw)=>mkDev('pc',n,x,y,{ports:[[1,{ip}]],gw});
  const a1=pc_('PC-A-SP',-120,80,'192.168.10.10/24','192.168.10.1'),b1=pc_('PC-B-SP',-120,440,'192.168.10.10/24','192.168.10.1'),a2=pc_('PC-A-RJ',1380,80,'192.168.20.10/24','192.168.20.1'),b2=pc_('PC-B-RJ',1380,440,'192.168.30.10/24','192.168.30.1');
  L(pe1,'Gi0/0/0',p1,'xe-0/1/0');L(p1,'et-0/0/0',p2,'Et1');L(p2,'Et2',pe2,'GE0/1/0');L(pe1,'Gi0/0/1',p2,'Et3');L(p1,'xe-0/1/1',pe2,'GE0/1/1');
  L(pe1,'Gi0/0/2',ceA1,'Gi0/0');L(pe1,'Gi0/0/3',ceB1,'Gi0/0');L(pe2,'GE0/1/2',ceA2,'Gi0/0');L(pe2,'GE0/1/3',ceB2,'Gi0/0');
  L(ceA1,'Gi0/1',a1,'eth0');L(ceB1,'Gi0/1',b1,'eth0');L(ceA2,'Gi0/1',a2,'eth0');L(ceB2,'Gi0/1',b2,'eth0');return S}

/* Fabric EVPN/VXLAN: underlay OSPF, spines como route reflectors, VNIs L2 estendidas, anycast gateway e L3VNI (IRB simétrico) */
function sampleEVPN(){S=blank('Fabric EVPN/VXLAN');const{L,set}=kit();
  const sps=[1,2].map(i=>mkDev('sw3',`SPINE-0${i}`,i===1?420:820,100,{model:'cisco-n9k-9364c',loops:[{id:0,ip:`10.250.0.${i}/32`,vrf:'',desc:'router-id'}],ospf:{on:true,area:0,rid:`10.250.0.${i}`},
    bgp:{asn:65000,rid:`10.250.0.${i}`,neighbors:[1,2,3].map(n=>NB(`10.250.0.1${n}`,65000,{desc:`LEAF-0${n}`,us:'0',evpn:true,noV4:true,rrc:true})),networks:[],redist:[]}}));
  const LV={10:{name:'WEB',vni:10010,ip:'10.10.10.1/24'},20:{name:'APP',vni:10020,ip:'10.20.20.1/24'},30:{name:'DB',vni:10030,ip:'10.30.30.1/24'}};
  const mk=(n,model,x,vls,up)=>{const d=mkDev('sw3',`LEAF-0${n}`,x,330,{model,vlans:vls.map(v=>({id:v,name:LV[v].name})),loops:[{id:0,ip:`10.250.0.1${n}/32`,vrf:'',desc:'router-id / BGP'},{id:1,ip:`10.251.0.1${n}/32`,vrf:'',desc:'VTEP'}],
      ospf:{on:true,area:0,rid:`10.250.0.1${n}`},vrfs:[{name:'TENANT-A',rd:'',rtImp:'',rtExp:'',l3vni:50001}],svis:vls.map(v=>({vlan:v,ip:LV[v].ip,vip:'',vrf:'TENANT-A',agw:true})),
      vxlan:{src:1,vnis:vls.map(v=>({vlan:v,vni:LV[v].vni,rt:'',peers:''}))},
      bgp:{asn:65000,rid:`10.250.0.1${n}`,neighbors:[1,2].map(i=>NB(`10.250.0.${i}`,65000,{desc:`SPINE-0${i}`,us:'0',evpn:true,noV4:true})),networks:[],redist:[{src:'connected',vrf:'TENANT-A'}]}});
    up.forEach(([p,i,ip])=>set(d,p,{mode:'routed',ip,desc:`SPINE-0${i}`}));return d};
  const lf=[mk(1,'cisco-n9k-93180yc-fx',220,[10],[['Eth1/49',1,'10.10.1.2/30'],['Eth1/50',2,'10.10.2.2/30']]),mk(2,'arista-7050sx3-48yc8',620,[10,20],[['Et49',1,'10.10.1.6/30'],['Et50',2,'10.10.2.6/30']]),
    mk(3,'juniper-qfx5120-48y',1020,[20,30],[['xe-0/0/46',1,'10.10.1.10/30'],['xe-0/0/47',2,'10.10.2.10/30']])];
  const dn=[['Et1','Et2','Et3'],['Et1','Et2','Et3']];sps.forEach((s,i)=>[0,1,2].forEach(n=>set(s,['Eth1/1','Eth1/2','Eth1/3'][n],{mode:'routed',ip:`10.10.${i+1}.${4*n+1}/30`,desc:`LEAF-0${n+1}`})));
  [['Eth1/49','Eth1/50'],['Et49','Et50'],['xe-0/0/46','xe-0/0/47']].forEach((ps,n)=>ps.forEach((p,i)=>L(sps[i],['Eth1/1','Eth1/2','Eth1/3'][n],lf[n],p)));
  const host=(name,x,ip,gw,leaf,port,vlan)=>{const h=mkDev('srv',name,x,560,{ports:[[1,{ip}]],gw});set(leaf,port,{mode:'access',vlan,desc:name});L(leaf,port,h,'eth0');return h};
  host('WEB-01',120,'10.10.10.11/24','10.10.10.1',lf[0],'Eth1/1',10);host('WEB-02',520,'10.10.10.12/24','10.10.10.1',lf[1],'Et1',10);host('APP-01',720,'10.20.20.11/24','10.20.20.1',lf[1],'Et2',20);
  host('APP-02',920,'10.20.20.12/24','10.20.20.1',lf[2],'xe-0/0/0',20);host('DB-01',1120,'10.30.30.11/24','10.30.30.1',lf[2],'xe-0/0/1',30);return S}

const GUIDES={'department-vlan-build':{title:'VLANs por departamento',intro:'Separe Vendas, Financeiro e TI em VLANs próprias e faça o SW-CORE rotear entre elas. Clique num switch para abrir o console, ou use o inspetor.',steps:[
  {t:'Crie as VLANs 10 (VENDAS), 20 (FINANCEIRO) e 30 (TI) no SW-ANDAR1 e no SW-CORE',ck:()=>['SW-ANDAR1','SW-CORE'].every(n=>{const d=byName(n);return d&&[10,20,30].every(v=>d.vlans.some(x=>+x.id===v))}),sol:'conf t\nvlan 10\n name VENDAS\nvlan 20\n name FINANCEIRO\nvlan 30\n name TI'},
  {t:'Coloque a porta de cada PC na VLAN do seu departamento',ck:()=>[['PC-VENDAS',10],['PC-FIN',20],['PC-TI',30]].every(([n,v])=>{const pd=byName(n);if(!pd)return false;const L=linkAt(pd.id,0);if(!L)return false;const sw=dev(L.peer),p=sw.ports[L.peerK];return isSw(sw.type)&&p.mode==='access'&&+p.vlan===v}),sol:'! no SW-ANDAR1\ninterface Gi1/0/1\n switchport mode access\n switchport access vlan 10\ninterface Gi1/0/2\n switchport access vlan 20\ninterface Gi1/0/3\n switchport access vlan 30'},
  {t:'Transforme o uplink SW-ANDAR1 ↔ SW-CORE em trunk levando as VLANs 10, 20 e 30',ck:()=>{const a=byName('SW-ANDAR1'),b=byName('SW-CORE');if(!a||!b)return false;const l=S.links.find(l=>(l.a.dev===a.id&&l.b.dev===b.id)||(l.a.dev===b.id&&l.b.dev===a.id));if(!l)return false;return[l.a,l.b].every(e=>{const p=dev(e.dev).ports[e.k];return p.mode==='trunk'&&[10,20,30].every(v=>allowedHas(p,v))})},sol:'! nos dois switches\ninterface Gi1/0/24\n switchport mode trunk\n switchport trunk allowed vlan 10,20,30'},
  {t:'Crie as SVIs no SW-CORE: 10.10.10.1/24, 10.10.20.1/24 e 10.10.30.1/24',ck:()=>{const d=byName('SW-CORE');return!!d&&[[10,'10.10.10.1'],[20,'10.10.20.1'],[30,'10.10.30.1']].every(([v,ip])=>d.svis.some(s=>+s.vlan===v&&pc(s.ip)&&pc(s.ip).ip===ip2i(ip)&&pc(s.ip).len===24))},sol:'! no SW-CORE\ninterface Vlan10\n ip address 10.10.10.1 255.255.255.0\ninterface Vlan20\n ip address 10.10.20.1 255.255.255.0\ninterface Vlan30\n ip address 10.10.30.1 255.255.255.0'},
  {t:'Teste: o PC-VENDAS precisa alcançar o PC-TI (10.10.30.10)',ck:()=>{const a=byName('PC-VENDAS');return!!a&&simulate(a.id,'10.10.30.10','icmp').ok},sol:'! no console do PC-VENDAS\nping 10.10.30.10'},
  {t:'Salve o lab e exporte as configurações',ck:()=>!!S.exported,sol:'Ctrl+S (ou "write memory" no console) e depois "Exportar .zip" no topo.'}]}};

/* Dois sites ligados por IPsec pela Internet fake + WireGuard entre hosts com IP público */
function sampleVPN(){S=blank('Sites com IPsec e WireGuard (Internet fake)');const{K,L,set}=kit();
  const inet=mkDev('cloud','INTERNET',560,90,{model:'cloud-fake'});cloudNew(inet,'fake');
  const fw=mkDev('fw','FW-SP',260,250,{model:'fortinet-fg-600f',rules:[{act:'permit',proto:'any',src:'10.10.0.0/16',dst:'any',port:'',desc:'LAN SP para qualquer destino'},{act:'permit',proto:'any',src:'10.20.0.0/16',dst:'10.10.0.0/16',port:'',desc:'filial RJ via IPsec'}]});
  const rt=mkDev('rtr','RTR-RJ',860,250,{model:'cisco-asr1001-x'});
  const att=(c,ck,d,dk)=>{const l={id:uid('l'),a:{dev:c.id,k:ck},b:{dev:d.id,k:K(d,dk)}};S.links.push(l);return cloudAttach(l)};
  att(inet,0,fw,'port1');att(inet,1,rt,'Gi0/0/0');
  set(fw,'port1',{nat:true,desc:'WAN — Internet'});set(fw,'port2',{mode:'routed',ip:'10.10.0.1/24',desc:'LAN SP'});
  set(rt,'Gi0/0/0',{nat:true,desc:'WAN — Internet'});set(rt,'Gi0/0/1',{mode:'routed',ip:'10.20.0.1/24',desc:'LAN RJ'});
  const swA=mkDev('sw2','SW-SP',260,420),swB=mkDev('sw2','SW-RJ',860,420);
  L(fw,'port2',swA,'Gi1/0/1');L(rt,'Gi0/0/1',swB,'Gi1/0/1');
  const web=mkDev('srv','WEB-SP',150,590,{ports:[[1,{mode:'routed',ip:'10.10.0.10/24'}]],gw:'10.10.0.1'});osSetup(web,'ubuntu-24.04');
  web.pkgs.push('nginx');web.svcs.nginx={active:true,enabled:true};web.hfw={on:true,allow:[['tcp',22,''],['tcp',80,'']],icmp:true};web.aptUpd=true;
  web.fs={'/var/www/html/index.html':'<h1>Matriz SP</h1>\n<p>Servido por WEB-SP (Ubuntu 24.04 + nginx)</p>\n'};
  const pcA=mkDev('pc','PC-SP',370,590,{ports:[[1,{mode:'routed',ip:'10.10.0.50/24'}]],gw:'10.10.0.1'});osSetup(pcA,'windows-11');
  const app=mkDev('srv','APP-RJ',760,590,{ports:[[1,{mode:'routed',ip:'10.20.0.10/24'}]],gw:'10.20.0.1'});osSetup(app,'rocky-9');
  const pcB=mkDev('pc','PC-RJ',970,590,{ports:[[1,{mode:'routed',ip:'10.20.0.50/24'}]],gw:'10.20.0.1'});osSetup(pcB,'ubuntu-24.04');
  L(swA,'Gi1/0/2',web,'eth0');L(swA,'Gi1/0/3',pcA,'eth0');L(swB,'Gi1/0/2',app,'eth0');L(swB,'Gi1/0/3',pcB,'eth0');
  const fwIp=fw.ports[K(fw,'port1')].ip.split('/')[0],rtIp=rt.ports[K(rt,'Gi0/0/0')].ip.split('/')[0];
  fw.vpns=[{name:'VPN-RJ',kind:'ipsec',peer:rtIp,psk:'Bancada@2026',ike:'v2',enc:'aes256',hash:'sha256',dh:'14',lnets:'10.10.0.0/24',rnets:'10.20.0.0/24'}];
  rt.vpns=[{name:'VPN-SP',kind:'ipsec',peer:fwIp,psk:'Bancada@2026',ike:'v2',enc:'aes256',hash:'sha256',dh:'14',lnets:'10.20.0.0/24',rnets:'10.10.0.0/24'}];
  // WireGuard entre dois hosts com IP público (home office ↔ VPS)
  const nb=mkDev('pc','NOTE-HOME',420,40),vps=mkDev('srv','VPS-01',720,-40);osSetup(nb,'ubuntu-24.04');osSetup(vps,'debian-12');
  const a1=att(inet,2,nb,'eth0'),a2=att(inet,3,vps,'eth0');const k1=wgKey(),k2=wgKey();
  [nb,vps].forEach(h=>{h.pkgs.push('wireguard-tools');h.aptUpd=true});
  nb.vpns=[{name:'wg0',kind:'wireguard',key:k1,addr:'10.99.0.2/24',port:51820,peer:a2.peer,pport:51820,peerKey:wgPub(k2),rnets:'10.99.0.1/32',lnets:'10.99.0.2/24'}];
  vps.vpns=[{name:'wg0',kind:'wireguard',key:k2,addr:'10.99.0.1/24',port:51820,peer:a1.peer,pport:51820,peerKey:wgPub(k1),rnets:'10.99.0.2/32',lnets:'10.99.0.1/24'}];
  nb.svcs['wg-quick@wg0']={active:true,enabled:true};vps.svcs['wg-quick@wg0']={active:true,enabled:true};
  S.notes='IPsec IKEv2 entre FW-SP (FortiGate) e RTR-RJ (Cisco) pela Internet fake; WireGuard entre NOTE-HOME e VPS-01. Experimente: ping 10.10.0.10 no PC-RJ, curl http://10.10.0.10, ipsec/show crypto, wg show.';
  return S}
/* Kubernetes (kubeadm) e OpenShift atrás de um roteador de borda, com Internet fake */
function sampleK8s(){S=blank('Kubernetes e OpenShift');const{K,L,set}=kit();
  const inet=mkDev('cloud','INTERNET',560,60,{model:'cloud-fake'});cloudNew(inet,'fake');
  const edge=mkDev('rtr','EDGE',560,250,{model:'vyos-virtual'});const l0={id:uid('l'),a:{dev:inet.id,k:0},b:{dev:edge.id,k:K(edge,'eth0')}};S.links.push(l0);cloudAttach(l0);
  set(edge,'eth0',{nat:true,desc:'WAN'});set(edge,'eth1',{mode:'routed',ip:'10.50.0.1/24',desc:'cluster K8S'});set(edge,'eth2',{mode:'routed',ip:'10.51.0.1/24',desc:'cluster OCP'});set(edge,'eth3',{mode:'routed',ip:'10.9.9.1/24',desc:'admin'});
  const k=clusterNew('k8s-kubeadm','K8S',80,380,{net:'10.50.0.0/24'}),o=clusterNew('ocp-4','OCP',760,380,{net:'10.51.0.0/24'});
  const sk=S.devices.find(d=>d.name==='K8S-SW'),so=S.devices.find(d=>d.name==='OCP-SW');L(sk,'uplink1',edge,'eth1');L(so,'uplink1',edge,'eth2');
  const adm=mkDev('pc','ADMIN',330,200,{ports:[[1,{mode:'routed',ip:'10.9.9.10/24'}]],gw:'10.9.9.1'});osSetup(adm,'fedora-40');L(edge,'eth3',adm,'eth0');
  adm.fs={'/etc/hosts':`127.0.0.1 localhost\n127.0.1.1 ADMIN\n10.51.0.5 api.${o.k8s.domain}\n10.51.0.7 hello-demo.apps.${o.k8s.domain} console-openshift-console.apps.${o.k8s.domain}\n`};
  k.k8s.deploys.push({ns:'default',name:'web',image:'nginx:1.27',replicas:3,port:80,labels:{app:'web'},kind:'deploy'});k.k8s.svcs.push({ns:'default',name:'web',type:'NodePort',port:80,targetPort:80,sel:'web',cip:'10.96.0.11',nodePort:30080});
  k.k8s.svcs.push({ns:'default',name:'web-lb',type:'LoadBalancer',port:80,targetPort:80,sel:'web',cip:'10.96.0.18',nodePort:31080,lbIp:'10.50.0.200'});
  o.k8s.ns.push('demo');o.k8s.deploys.push({ns:'demo',name:'hello',image:'nginxinc/nginx-unprivileged',replicas:2,port:8080,labels:{app:'hello'},kind:'deploy'});o.k8s.svcs.push({ns:'demo',name:'hello',type:'ClusterIP',port:8080,targetPort:8080,sel:'hello',cip:'172.30.0.11'});
  o.k8s.ings.push({ns:'demo',name:'hello',host:`hello-demo.apps.${o.k8s.domain}`,svc:'hello',kind:'route',port:'8080-tcp'});
  S.notes='Cluster kubeadm (1 CP + 3 workers) e OpenShift 4.16 (3 masters + 2 workers). Abra o console de K8S-cp1 (kubectl) ou OCP-master1 (oc). Do ADMIN: curl http://10.50.0.21:30080, curl http://10.50.0.200, curl http://hello-demo.apps.ocp.lab.';
  return S}

/* ---------- clusters Kubernetes / OpenShift ---------- */
const isCluster=d=>!!(d&&d.type==='chassis'&&d.k8s);
const clusterOf=d=>{if(!d)return null;if(isCluster(d))return d;const p=d.parent&&dev(d.parent);return isCluster(p)?p:null};
const k8sNodes=c=>S.devices.filter(x=>x.parent===c.id&&isHost(x.type));
const nodeRole=n=>n.k8sRole||'worker';
const isCP=n=>/control|master/.test(nodeRole(n));
const nodeIp=n=>{const f=l3ifs(n).find(f=>!f.mgmt&&f.kind!=='loop');return f?f.c.ip:null};
function k8sApiIp(c){const k=c.k8s;if(ip2i(k.apiVip)!==null)return ip2i(k.apiVip);const cp=k8sNodes(c).find(isCP);return cp?nodeIp(cp):null}
const k8sReadyCache={};
function nodeReady(c,n){const ip=nodeIp(n);if(ip===null)return{ok:false,why:'sem endereço IP na interface do nó'};if(isCP(n))return{ok:true};const api=k8sApiIp(c);if(api===null)return{ok:false,why:'sem control-plane com IP'};
  if(SIMDEPTH>1)return{ok:true};const r=simulate(n.id,i2ip(api),'tcp',6443);return r.ok?{ok:true}:{ok:false,why:`kubelet não alcança a API ${i2ip(api)}:6443 — ${r.why}`}}
function schedNodes(c){const ns=k8sNodes(c);const w=ns.filter(n=>!isCP(n));const pool=(w.length?w:ns);return pool.filter(n=>nodeReady(c,n).ok)}
function podsOf(c){const k=c.k8s,out=[];const sn=schedNodes(c);let i=0;const all=k8sNodes(c);
  (k.deploys||[]).forEach(dp=>{for(let r=0;r<(+dp.replicas||0);r++){const h=hsh(dp.ns+'/'+dp.name+'/'+r).toString(36);const node=sn.length?sn[i++%sn.length]:null;const ni=node?all.indexOf(node):-1;
    const pc0=pc(k.podCidr||'10.244.0.0/16');const ip=node&&pc0?((pc0.net+(ni<<8)+10+((hsh(h)%200)))>>>0):null;
    out.push({ns:dp.ns,name:dp.kind==='pod'?dp.name:`${dp.name}-${(hsh(dp.name+dp.image)>>>0).toString(16).slice(0,9).padStart(9,'5')}-${('0000'+(hsh(h+'x')).toString(36)).slice(-5)}`,dp,node,ip,status:node?'Running':'Pending',ready:node?'1/1':'0/1'})}});return out}
const svcEndpoints=(c,sv)=>podsOf(c).filter(p=>p.dp.ns===sv.ns&&p.dp.labels&&p.dp.labels.app===sv.sel&&p.status==='Running');
function k8sOwner(c){const ns=k8sNodes(c);return ns.find(n=>!isCP(n))||ns[0]}
function k8sVips(c){const k=c.k8s,v=[];(k.svcs||[]).forEach(s=>{if(s.type==='LoadBalancer'&&ip2i(s.lbIp)!==null)v.push(ip2i(s.lbIp))});if(ip2i(k.ingressVip)!==null)v.push(ip2i(k.ingressVip));return v}
function secIps(d,k,c0,vlan){const c=clusterOf(d);if(!c||!c.k8s)return[];const out=[];const own=k8sOwner(c);
  if(own&&own.id===d.id)k8sVips(c).forEach(ip=>{if(inNet(ip,c0)&&ip!==c0.ip)out.push(ip)});
  if(ip2i(c.k8s.apiVip)!==null){const cp=k8sNodes(c).find(isCP);if(cp&&cp.id===d.id&&inNet(ip2i(c.k8s.apiVip),c0))out.push(ip2i(c.k8s.apiVip))}return out}
function k8sPorts(d,dstIp){const c=clusterOf(d);if(!c||!c.k8s||c.id===d.id)return[];const k=c.k8s,o=[];const ip=nodeIp(d);
  o.push({proto:'tcp',port:10250,svc:'kubelet',k8s:true});if(isCP(d))o.push({proto:'tcp',port:6443,svc:'kube-apiserver',k8s:true,web:'k8sapi'});if(isCP(d)&&dstIp===ip){o.push({proto:'udp',port:53,svc:'dns (cluster)',dns:true,k8s:true})}
  (k.svcs||[]).forEach(s=>{const eps=svcEndpoints(c,s);if(!eps.length)return;const info={svc:'k8s',k8s:true,web:'k8s',ksvc:s,eps};
    if((s.type==='NodePort'||s.type==='LoadBalancer')&&+s.nodePort&&dstIp===ip)o.push({proto:'tcp',port:+s.nodePort,...info});
    if(s.type==='LoadBalancer'&&ip2i(s.lbIp)===dstIp)o.push({proto:'tcp',port:+s.port,...info})});
  const allCp=k8sNodes(c).every(isCP);if(ip2i(k.ingressVip)===dstIp||(dstIp===ip&&(k.dist==='openshift'||(k.ings||[]).length)&&(!isCP(d)||allCp))){o.push({proto:'tcp',port:80,svc:'router',k8s:true,web:'ingress',c});o.push({proto:'tcp',port:443,svc:'router',k8s:true,web:'ingress',c})}
  return o}
/* nomes que o DNS de dentro do cluster (CoreDNS) resolve: services, nós, api e *.apps */
function k8sLocalName(c,n){const k=c.k8s;n=String(n).toLowerCase();const m=n.match(/^([a-z0-9-]+)\.([a-z0-9-]+)(?:\.svc(?:\.cluster\.local)?)?$/);
  if(m){const sv=(k.svcs||[]).find(s=>s.name===m[1]&&s.ns===m[2]);if(sv&&ip2i(sv.cip)!==null)return ip2i(sv.cip)}
  if(n==='kubernetes.default.svc'||n==='kubernetes.default.svc.cluster.local'||n==='kubernetes'||n==='kubernetes.default'){const p=pc(k.svcCidr||'');if(p)return(p.net+1)>>>0}
  const nd=k8sNodes(c).find(x=>x.name.toLowerCase()===n||x.name.toLowerCase()+'.'+(k.domain||'')===n);if(nd)return nodeIp(nd);
  const r=k8sName(n);if(r!=null)return r;const sv2=(k.svcs||[]).find(s=>s.name===n);return sv2&&ip2i(sv2.cip)!==null?ip2i(sv2.cip):null}
function k8sName(n){for(const c of S.devices.filter(isCluster)){const k=c.k8s,dom=(k.domain||'').toLowerCase();if(!dom)continue;
  if(n==='api.'+dom||n==='api-int.'+dom)return k8sApiIp(c);
  if(n.endsWith('.apps.'+dom)||(k.ings||[]).some(i=>i.host.toLowerCase()===n)){if(ip2i(k.ingressVip)!==null)return ip2i(k.ingressVip);const w=k8sOwner(c);return w?nodeIp(w):null}}return null}

/* PC/servidor ligado na rede do cluster: recebe IP da rede dos nós e usa o DNS do cluster */
const clusterSwitch=c=>S.devices.find(x=>x.parent===c.id&&isSw(x.type));
function clusterAttach(l){const pairs=[[l.a,l.b],[l.b,l.a]];for(const[sa,ha]of pairs){const sw=dev(sa.dev),h=dev(ha.dev);if(!sw||!h||!isSw(sw.type))continue;const c=sw.parent&&dev(sw.parent);if(!isCluster(c)||!isHost(h.type)||clusterOf(h))continue;
    const k=c.k8s,net=pc(k.nodeNet||'');if(!net)return null;const p=h.ports[ha.k];if(!p)return null;if(p.mode==='routed'&&pc(p.ip))return{cluster:c.name,ip:p.ip.split('/')[0],kept:true};
    const used=new Set();S.devices.forEach(x=>l3ifs(x,true).forEach(f=>used.add(f.c.ip)));[k.apiVip,k.ingressVip].forEach(v=>{if(ip2i(v)!==null)used.add(ip2i(v))});
    let ip=null;for(let i=100;i<200;i++){const x=(net.net+i)>>>0;if(!used.has(x)){ip=x;break}}if(ip===null)return null;
    p.mode='routed';p.ip=`${i2ip(ip)}/${net.len}`;p.desc=p.desc||'rede do cluster '+c.name;
    const gw=(net.net+1)>>>0;if(!h.gw&&S.devices.some(x=>l3ifs(x).some(f=>f.c.ip===gw)))h.gw=i2ip(gw);
    const cp=k8sNodes(c).find(isCP);const dns=cp?nodeIp(cp):null;const dom=k.domain||'';
    if(dns!=null){if(isWin(h))h.dns=i2ip(dns);else{h.fs=h.fs||{};h.fs['/etc/resolv.conf']=`# rede do cluster ${c.name}\nnameserver ${i2ip(dns)}\nsearch ${dom}\n`}}
    return{cluster:c.name,ip:i2ip(ip),dns:dns!=null?i2ip(dns):'',domain:dom}}return null}
/* resposta HTTP de um serviço do cluster (para o curl) */
function k8sHttp(svc,host){if(svc.web==='ingress'){const c=svc.c,k=c.k8s;const ing=(k.ings||[]).find(i=>i.host.toLowerCase()===String(host||'').toLowerCase());
    if(!ing)return{code:503,body:k.dist==='openshift'?'<h1>Application is not available</h1>\n<p>The application is currently not serving requests at this endpoint. It may not have been started or is still starting.</p>':'<html><head><title>404 Not Found</title></head><body><center><h1>404 Not Found</h1></center><hr><center>nginx</center></body></html>'};
    const sv=(k.svcs||[]).find(s=>s.ns===ing.ns&&s.name===ing.svc);if(!sv)return{code:503,body:'<h1>Application is not available</h1>'};const eps=svcEndpoints(c,sv);if(!eps.length)return{code:503,body:'<h1>Application is not available</h1>\n(nenhum pod pronto atrás do service)'};
    return appBody(eps[hsh(host)%eps.length])}
  if(svc.web==='k8sapi')return{code:403,body:'{"kind":"Status","apiVersion":"v1","status":"Failure","message":"forbidden: User \\"system:anonymous\\" cannot get path \\"/\\"","reason":"Forbidden","code":403}'};
  const eps=svc.eps||[];if(!eps.length)return{code:503,body:''};const sv=svc.ksvc||{};sv._rr=((sv._rr||0)+1)%eps.length;return appBody(eps[sv._rr])}
function appBody(p){const img=String(p.dp.image||'');if(/nginx/.test(img))return{code:200,body:`<!DOCTYPE html>\n<html><head><title>Welcome to nginx!</title></head><body><h1>Welcome to nginx!</h1>\n<p>pod ${p.name} (${p.ip?i2ip(p.ip):''}) no nó ${p.node?p.node.name:'?'}</p></body></html>`};
  if(/httpd|apache/.test(img))return{code:200,body:`<html><body><h1>It works!</h1><p>pod ${p.name}</p></body></html>`};
  return{code:200,body:`Hello from ${p.dp.name}! pod=${p.name} ip=${p.ip?i2ip(p.ip):''} node=${p.node?p.node.name:'?'} image=${img}`}}
/* YAML mínimo (mapas, listas, escalares, múltiplos documentos) */
function yamlParse(text){const docs=[];String(text).split(/^---\s*$/m).forEach(chunk=>{const lines=chunk.split('\n').map(l=>l.replace(/\s+#.*$/,'').replace(/\t/g,'  ')).filter(l=>l.trim()&&!/^\s*#/.test(l));if(!lines.length)return;let i=0;
  const ind=l=>l.length-l.trimStart().length;const sc=v=>{v=v.trim();if(/^".*"$|^'.*'$/.test(v))return v.slice(1,-1);if(/^-?\d+$/.test(v))return+v;if(v==='true')return true;if(v==='false')return false;if(v==='{}')return{};if(v==='[]')return[];
    if(/^\[.*\]$/.test(v))return v.slice(1,-1).split(',').map(x=>sc(x)).filter(x=>x!=='');return v};
  function block(lvl){const first=lines[i];if(!first)return null;if(first.trimStart().startsWith('- '))return list(ind(first));return map(ind(first))}
  function map(lvl){const o={};while(i<lines.length){const l=lines[i];const n=ind(l);if(n<lvl)break;if(n>lvl){i++;continue}const t=l.trim();if(t.startsWith('- '))break;const m=t.match(/^([^:]+):\s*(.*)$/);i++;if(!m)continue;
      if(m[2]==='|'||m[2]==='>'){const b=[];while(i<lines.length&&ind(lines[i])>n){b.push(lines[i].trim());i++}o[m[1].trim()]=b.join('\n');continue}
      if(m[2]!=='')o[m[1].trim()]=sc(m[2]);else{const nx=lines[i];if(nx&&(ind(nx)>n||(ind(nx)===n&&nx.trim().startsWith('- '))))o[m[1].trim()]=nx.trim().startsWith('- ')?list(ind(nx)):map(ind(nx));else o[m[1].trim()]=null}}return o}
  function list(lvl){const a=[];while(i<lines.length){const l=lines[i];const n=ind(l);if(n<lvl||!l.trim().startsWith('- ')||n>lvl)break;const rest=l.trim().slice(2);
      if(/^[^:\s][^:]*:\s*/.test(rest)&&!/^".*"$/.test(rest)){lines[i]=' '.repeat(n+2)+rest;a.push(map(n+2))}else{i++;a.push(sc(rest))}}return a}
  docs.push(block(0))});return docs}
function k8sNew(c,dist){const ocp=dist==='openshift';c.k8s={dist,version:ocp?'4.16.12':'v1.30.4',domain:ocp?`${c.name.toLowerCase()}.lab`:`${c.name.toLowerCase()}.lab`,podCidr:ocp?'10.128.0.0/14':'10.244.0.0/16',svcCidr:ocp?'172.30.0.0/16':'10.96.0.0/12',lbPool:'',ingressVip:'',apiVip:'',
  ns:ocp?['default','openshift','openshift-ingress','openshift-console','openshift-monitoring','kube-system']:['default','kube-system','kube-public','kube-node-lease'],deploys:[],svcs:[],ings:[]};return c}
function k8sCmd(c,st,argv,raw,readFile){const k=c.k8s,ocp=k.dist==='openshift';const tool=argv[0];const a=argv.slice(1);const out=[];const say=s=>out.push(s);
  const flag=(n,def)=>{for(let i=0;i<a.length;i++){if(a[i]===n||a[i]==='-'+n.replace(/^--/,'')&&n.length===2)return a[i+1];if(a[i].startsWith(n+'='))return a[i].slice(n.length+1)}return def};
  const has=n=>a.includes(n);let ns=flag('-n')||flag('--namespace')||st.ns||'default';const allNs=has('-A')||has('--all-namespaces');
  const pos=a.filter((x,i)=>!x.startsWith('-')&&!(i>0&&/^-(n|o|f|l|c)$|^--(namespace|image|port|replicas|type|name|target-port|output|rule|hostname|selector|from-literal|to-replicas)$/.test(a[i-1])));
  const age=s=>s;const nodesAll=k8sNodes(c);
  const nsOk=n=>(k.ns||[]).includes(n);const needNs=()=>{if(!nsOk(ns)){say(`Error from server (NotFound): namespaces "${ns}" not found`);return false}return true};
  const findDp=n=>(k.deploys||[]).find(d=>d.ns===ns&&d.name===n);
  const nextNodePort=()=>{let p=30000+(hsh((k.svcs||[]).length+'np')%2000);while((k.svcs||[]).some(s=>+s.nodePort===p))p++;return p};
  const nextLb=()=>{const pool=String(k.lbPool||'').split('-');const a0=ip2i(pool[0]),a1=ip2i(pool[1]||pool[0]);if(a0===null)return'';for(let x=a0;x<=(a1??a0);x++){const s=i2ip(x);if(!(k.svcs||[]).some(v=>v.lbIp===s)&&s!==k.ingressVip)return s}return''};
  const clusterIp=()=>{const p=pc(k.svcCidr||'10.96.0.0/12');return i2ip((p.net+10+((k.svcs||[]).length*7)+1)>>>0)};
  const res=r=>({no:'nodes',node:'nodes',nodes:'nodes',po:'pods',pod:'pods',pods:'pods',deploy:'deployments',deployment:'deployments',deployments:'deployments',svc:'services',service:'services',services:'services',ns:'namespaces',namespace:'namespaces',namespaces:'namespaces',project:'namespaces',projects:'namespaces',ing:'ingress',ingress:'ingress',ingresses:'ingress',route:'routes',routes:'routes',ep:'endpoints',endpoints:'endpoints',all:'all'})[String(r||'').toLowerCase().split('/')[0]];
  const tbl=(hd,rows)=>{const w=hd.map((h,i)=>Math.max(h.length,...rows.map(r=>String(r[i]).length))+3);return[hd.map((h,i)=>h.padEnd(w[i])).join('').trimEnd(),...rows.map(r=>r.map((x,i)=>String(x).padEnd(w[i])).join('').trimEnd())].join('\n')};
  const podsNs=()=>podsOf(c).filter(p=>allNs||p.dp.ns===ns);
  function get(r,name){const wide=/wide/.test(flag('-o','')||'');switch(res(r)){
    case'nodes':return tbl(['NAME','STATUS','ROLES','AGE','VERSION',...(wide?['INTERNAL-IP','OS-IMAGE','KERNEL-VERSION','CONTAINER-RUNTIME']:[])],nodesAll.map(n=>{const rd=nodeReady(c,n);const o=osInfo(n)||OSES['ubuntu-22.04'];return[n.name.toLowerCase(),rd.ok?'Ready':'NotReady',isCP(n)?(ocp?'control-plane,master':'control-plane'):(ocp?'worker':'<none>'),'3d',ocp?'v1.29.8+f10c92d':k.version,...(wide?[nodeIp(n)!=null?i2ip(nodeIp(n)):'<none>',o.name,o.kernel,ocp?'cri-o://1.29.8':'containerd://1.7.12']:[])]}));
    case'pods':{const ps=podsNs().filter(p=>!name||p.name===name);if(!ps.length)return allNs?'No resources found':`No resources found in ${ns} namespace.`;return tbl([...(allNs?['NAMESPACE']:[]),'NAME','READY','STATUS','RESTARTS','AGE',...(wide?['IP','NODE']:[])],ps.map(p=>[...(allNs?[p.dp.ns]:[]),p.name,p.ready,p.status,0,'12m',...(wide?[p.ip!=null?i2ip(p.ip):'<none>',p.node?p.node.name.toLowerCase():'<none>']:[])]))}
    case'deployments':{const ds=(k.deploys||[]).filter(d=>d.kind!=='pod'&&(allNs||d.ns===ns)&&(!name||d.name===name));if(!ds.length)return`No resources found in ${ns} namespace.`;const ps=podsOf(c);return tbl([...(allNs?['NAMESPACE']:[]),'NAME','READY','UP-TO-DATE','AVAILABLE','AGE'],ds.map(d=>{const r=ps.filter(p=>p.dp===d&&p.status==='Running').length;return[...(allNs?[d.ns]:[]),d.name,`${r}/${d.replicas}`,d.replicas,r,'12m']}))}
    case'services':{const ss=(k.svcs||[]).filter(s=>(allNs||s.ns===ns)&&(!name||s.name===name));const base=(allNs||ns==='default')&&(!name||name==='kubernetes')?[{ns:'default',name:'kubernetes',type:'ClusterIP',cip:i2ip((pc(k.svcCidr).net+1)>>>0),port:443}]:[];const all2=[...base,...ss];if(!all2.length)return`No resources found in ${ns} namespace.`;
      return tbl([...(allNs?['NAMESPACE']:[]),'NAME','TYPE','CLUSTER-IP','EXTERNAL-IP','PORT(S)','AGE'],all2.map(s=>[...(allNs?[s.ns]:[]),s.name,s.type,s.cip,s.type==='LoadBalancer'?(s.lbIp||'<pending>'):'<none>',`${s.port}${s.nodePort?':'+s.nodePort:''}/TCP`,'10m']))}
    case'namespaces':return tbl(['NAME','STATUS','AGE'],(k.ns||[]).map(n=>[n,'Active','3d']));
    case'ingress':{const is=(k.ings||[]).filter(i=>i.kind!=='route'&&(allNs||i.ns===ns));if(!is.length)return`No resources found in ${ns} namespace.`;return tbl(['NAME','CLASS','HOSTS','ADDRESS','PORTS','AGE'],is.map(i=>[i.name,'nginx',i.host,k.ingressVip||'','80','5m']))}
    case'routes':{if(!ocp)return'error: the server doesn\'t have a resource type "routes"';const is=(k.ings||[]).filter(i=>i.kind==='route'&&(allNs||i.ns===ns));if(!is.length)return`No resources found in ${ns} namespace.`;return tbl(['NAME','HOST/PORT','PATH','SERVICES','PORT','TERMINATION','WILDCARD'],is.map(i=>[i.name,i.host,'',i.svc,i.port||'8080-tcp','','None']))}
    case'endpoints':return tbl(['NAME','ENDPOINTS','AGE'],(k.svcs||[]).filter(s=>s.ns===ns).map(s=>[s.name,svcEndpoints(c,s).map(p=>`${i2ip(p.ip)}:${s.targetPort||s.port}`).join(',')||'<none>','10m']));
    case'all':return[get('pods'),'',get('services'),'',get('deployments')].join('\n');
    default:return`error: the server doesn't have a resource type "${r}"`}}
  function createDeploy(name,image,replicas,port,kind){if(!needNs())return;if(findDp(name)){say(`error: failed to create deployment: deployments.apps "${name}" already exists`);return}
    (k.deploys=k.deploys||[]).push({ns,name,image:image||'nginx',replicas:+replicas||1,port:+port||0,labels:{app:name},kind:kind||'deploy'});return true}
  function expose(kindName,o){const nm=kindName.includes('/')?kindName.split('/')[1]:kindName;const dp=findDp(nm);const sv0=(k.svcs||[]).find(s=>s.ns===ns&&s.name===nm);
    if(!dp&&!sv0){say(`Error from server (NotFound): deployments.apps "${nm}" not found`);return}
    if(/^(svc|service)\//.test(kindName)&&ocp&&tool==='oc'){const host=o.hostname||`${nm}-${ns}.apps.${k.domain}`;(k.ings=k.ings||[]).push({ns,name:o.name||nm,host,svc:nm,kind:'route',port:`${sv0?sv0.port:8080}-tcp`});say(`route.route.openshift.io/${o.name||nm} exposed`);return}
    const port=+o.port||(dp&&dp.port)||80;const type=o.type||'ClusterIP';const name=o.name||nm;if((k.svcs||[]).some(s=>s.ns===ns&&s.name===name)){say(`Error from server (AlreadyExists): services "${name}" already exists`);return}
    const s={ns,name,type,port,targetPort:+o.targetPort||(dp&&dp.port)||port,sel:dp?dp.labels.app:nm,cip:clusterIp()};if(type==='NodePort'||type==='LoadBalancer')s.nodePort=nextNodePort();if(type==='LoadBalancer')s.lbIp=nextLb();(k.svcs=k.svcs||[]).push(s);say(`service/${name} exposed`);
    if(type==='LoadBalancer'&&!s.lbIp)say('(EXTERNAL-IP fica <pending>: configure um pool MetalLB no cluster — aba Geral do cluster)')}
  function apply(text){const docs=yamlParse(text);let n=0;docs.forEach(o=>{if(!o||!o.kind)return;const md=o.metadata||{};const nsx=md.namespace||ns;const nm=md.name;n++;
    if(o.kind==='Namespace'||o.kind==='Project'){if(!(k.ns||[]).includes(nm))k.ns.push(nm);say(`namespace/${nm} created`);return}
    if(!(k.ns||[]).includes(nsx)){say(`Error from server (NotFound): namespaces "${nsx}" not found`);return}const ns0=ns;ns=nsx;
    if(o.kind==='Deployment'||o.kind==='Pod'){const spec=o.kind==='Pod'?o.spec||{}:((o.spec||{}).template||{}).spec||{};const ct=(spec.containers||[])[0]||{};const port=((ct.ports||[])[0]||{}).containerPort;const ex=findDp(nm);
      const labels=o.kind==='Pod'?(md.labels||{app:nm}):(((o.spec||{}).template||{}).metadata||{}).labels||{app:nm};
      if(ex){ex.image=ct.image||ex.image;ex.replicas=o.kind==='Pod'?1:+((o.spec||{}).replicas??ex.replicas);ex.port=port||ex.port;ex.labels=labels;say(`${o.kind==='Pod'?'pod':'deployment.apps'}/${nm} configured`)}
      else{(k.deploys=k.deploys||[]).push({ns,name:nm,image:ct.image||'nginx',replicas:o.kind==='Pod'?1:+((o.spec||{}).replicas??1),port:+port||0,labels,kind:o.kind==='Pod'?'pod':'deploy'});say(`${o.kind==='Pod'?'pod':'deployment.apps'}/${nm} created`)}}
    else if(o.kind==='Service'){const sp=o.spec||{};const p=(sp.ports||[])[0]||{};const type=sp.type||'ClusterIP';const sel=(sp.selector||{}).app||nm;const ex=(k.svcs||[]).find(s=>s.ns===ns&&s.name===nm);
      const s=ex||{ns,name:nm,cip:clusterIp()};Object.assign(s,{type,port:+p.port||80,targetPort:+p.targetPort||+p.port||80,sel});if(type!=='ClusterIP'&&!s.nodePort)s.nodePort=+p.nodePort||nextNodePort();if(type==='LoadBalancer'&&!s.lbIp)s.lbIp=nextLb();if(!ex)(k.svcs=k.svcs||[]).push(s);say(`service/${nm} ${ex?'configured':'created'}`)}
    else if(o.kind==='Ingress'){const r=((o.spec||{}).rules||[])[0]||{};const be=((((r.http||{}).paths||[])[0]||{}).backend||{}).service||{};(k.ings=k.ings||[]).push({ns,name:nm,host:r.host||'',svc:be.name,port:(be.port||{}).number,kind:'ingress'});say(`ingress.networking.k8s.io/${nm} created`)}
    else if(o.kind==='Route'){const sp=o.spec||{};(k.ings=k.ings||[]).push({ns,name:nm,host:sp.host||`${nm}-${ns}.apps.${k.domain}`,svc:(sp.to||{}).name,kind:'route'});say(`route.route.openshift.io/${nm} created`)}
    else say(`error: resource mapping not found for kind "${o.kind}" (a bancada simula Namespace, Deployment, Pod, Service, Ingress e Route)`);ns=ns0});if(!n)say('error: no objects passed to apply')}
  const sub=pos[0];
  if(!sub||sub==='help'){say(`${tool} controla o cluster ${c.name} (${ocp?'OpenShift '+k.version:'Kubernetes '+k.version}).\nComandos: get, describe, create, apply -f, delete, expose, scale, run, logs, rollout status, cluster-info, version, debug node/<nó>${ocp?', new-project, project, new-app, login, whoami, status':''}`);return out.join('\n')}
  if(sub==='version'){say(ocp&&tool==='oc'?`Client Version: 4.16.12\nKustomize Version: v5.0.4\nServer Version: ${k.version}\nKubernetes Version: v1.29.8+f10c92d`:`Client Version: ${ocp?'v1.29.8':k.version}\nKustomize Version: v5.0.4\nServer Version: ${ocp?'v1.29.8+f10c92d':k.version}`);return out.join('\n')}
  if(sub==='cluster-info'){const api=k8sApiIp(c);say(`Kubernetes control plane is running at https://${ocp?'api.'+k.domain:i2ip(api)}:6443\nCoreDNS is running at https://${i2ip(api)}:6443/api/v1/namespaces/kube-system/services/kube-dns:dns/proxy`);return out.join('\n')}
  if(tool==='oc'&&sub==='login'){say(`Login successful.\n\nYou have access to ${(k.ns||[]).length} projects, the list has been suppressed. You can list all projects with 'oc projects'\n\nUsing project "${ns}".`);return out.join('\n')}
  if(tool==='oc'&&sub==='whoami'){say(has('--show-console')?`https://console-openshift-console.apps.${k.domain}`:'kube:admin');return out.join('\n')}
  if((tool==='oc'&&(sub==='new-project'||sub==='project'))){const n=pos[1];if(sub==='project'&&!n){say(`Using project "${ns}" on server "https://api.${k.domain}:6443".`);return out.join('\n')}if(sub==='new-project'){if(!(k.ns||[]).includes(n))k.ns.push(n);say(`Now using project "${n}" on server "https://api.${k.domain}:6443".`)}else{if(!(k.ns||[]).includes(n)){say(`error: A project named "${n}" does not exist on "https://api.${k.domain}:6443".`);return out.join('\n')}say(`Now using project "${n}" on server "https://api.${k.domain}:6443".`)}st.ns=n;return out.join('\n')}
  if(tool==='oc'&&sub==='projects'){say(`You have access to the following projects and can switch between them with 'oc project <projectname>':\n\n${(k.ns||[]).map(n=>(n===ns?'  * ':'    ')+n).join('\n')}`);return out.join('\n')}
  if(tool==='oc'&&sub==='new-app'){const img=flag('--image')||pos[1];if(!img){say('error: you must specify an image, e.g. oc new-app --image=nginxinc/nginx-unprivileged');return out.join('\n')}const name=flag('--name')||img.split('/').pop().split(':')[0];
    if(createDeploy(name,img,1,8080)){(k.svcs=k.svcs||[]).push({ns,name,type:'ClusterIP',port:8080,targetPort:8080,sel:name,cip:clusterIp()});say(`--> Found container image for "${img}"\n--> Creating resources ...\n    deployment.apps "${name}" created\n    service "${name}" created\n--> Success\n    Application is not exposed. You can expose services to the outside world by executing one or more of the commands below:\n     'oc expose service/${name}'\n    Run 'oc status' to view your app.`)}return out.join('\n')}
  if(tool==='oc'&&sub==='status'){say(`In project ${ns} on server https://api.${k.domain}:6443\n`);(k.svcs||[]).filter(s=>s.ns===ns).forEach(s=>{const r=(k.ings||[]).find(i=>i.svc===s.name&&i.ns===ns);say(`${r?'http://'+r.host+' to pod port '+(s.targetPort)+' ':''}svc/${s.name} - ${s.cip}:${s.port}\n  deployment/${s.sel} deploys ${(findDp(s.sel)||{}).image||'?'}\n`)});return out.join('\n')}
  if(sub==='get'){if(pos[1]&&pos[1].includes('/'))say(get(pos[1].split('/')[0],pos[1].split('/')[1]));else say(get(pos[1],pos[2]));return out.join('\n')}
  if(sub==='create'){const what=pos[1];if(has('-f')){const f=flag('-f');const t=readFile(f);if(t==null){say(`error: the path "${f}" does not exist`);return out.join('\n')}apply(t);return out.join('\n')}
    if(res(what)==='namespaces'){const n=pos[2];if((k.ns||[]).includes(n)){say(`Error from server (AlreadyExists): namespaces "${n}" already exists`)}else{k.ns.push(n);say(`namespace/${n} created`)}return out.join('\n')}
    if(res(what)==='deployments'){const n=pos[2],img=flag('--image');if(!img){say('error: required flag(s) "image" not set');return out.join('\n')}if(createDeploy(n,img,flag('--replicas',1),flag('--port',0)))say(`deployment.apps/${n} created`);return out.join('\n')}
    if(res(what)==='ingress'){const n=pos[2],rule=flag('--rule')||'';const m=rule.match(/^([^/]+)\/[^=]*=([^:]+):(\d+)/);if(!m){say('error: --rule="host/*=service:port"');return out.join('\n')}(k.ings=k.ings||[]).push({ns,name:n,host:m[1],svc:m[2],port:+m[3],kind:'ingress'});say(`ingress.networking.k8s.io/${n} created`);return out.join('\n')}
    if(what==='route'&&ocp){const n=pos[3]||pos[2],svc=flag('--service')||n;(k.ings=k.ings||[]).push({ns,name:n,host:flag('--hostname')||`${n}-${ns}.apps.${k.domain}`,svc,kind:'route'});say(`route.route.openshift.io/${n} created`);return out.join('\n')}
    say(`error: unknown resource "${what}"`);return out.join('\n')}
  if(sub==='apply'){const f=flag('-f');const t=f&&readFile(f);if(t==null){say(`error: the path "${f||''}" does not exist`);return out.join('\n')}apply(t);return out.join('\n')}
  if(sub==='run'){const n=pos[1],img=flag('--image');if(!img){say('error: required flag(s) "image" not set');return out.join('\n')}if(createDeploy(n,img,1,flag('--port',0),'pod'))say(`pod/${n} created`);return out.join('\n')}
  if(sub==='expose'){expose(pos[2]?pos[1]+'/'+pos[2]:pos[1],{port:flag('--port'),targetPort:flag('--target-port'),type:flag('--type'),name:flag('--name'),hostname:flag('--hostname')});return out.join('\n')}
  if(sub==='scale'){const t=pos[1].includes('/')?pos[1].split('/')[1]:pos[2];const dp=findDp(t);const r=flag('--replicas');if(!dp){say(`Error from server (NotFound): deployments.apps "${t}" not found`);return out.join('\n')}if(r==null){say('error: --replicas=COUNT is required');return out.join('\n')}dp.replicas=Math.max(0,+r||0);say(`deployment.apps/${dp.name} scaled`);return out.join('\n')}
  if(sub==='delete'){let r=pos[1],n=pos[2];if(r&&r.includes('/'))[r,n]=r.split('/');const R2=res(r);
    if(R2==='deployments'||R2==='pods'){const dp=findDp(n)||(R2==='pods'?(podsOf(c).find(p=>p.name===n)||{}).dp:null);if(!dp){say(`Error from server (NotFound): ${R2} "${n}" not found`);return out.join('\n')}if(R2==='pods'&&dp.kind!=='pod'){say(`pod "${n}" deleted\n(o deployment ${dp.name} recria o pod)`);return out.join('\n')}k.deploys=k.deploys.filter(x=>x!==dp);say(`${R2==='pods'?'pod':'deployment.apps'} "${n}" deleted`);return out.join('\n')}
    if(R2==='services'){const b=(k.svcs||[]).length;k.svcs=(k.svcs||[]).filter(s=>!(s.ns===ns&&s.name===n));say(b===k.svcs.length?`Error from server (NotFound): services "${n}" not found`:`service "${n}" deleted`);return out.join('\n')}
    if(R2==='namespaces'){k.ns=(k.ns||[]).filter(x=>x!==n);k.deploys=(k.deploys||[]).filter(x=>x.ns!==n);k.svcs=(k.svcs||[]).filter(x=>x.ns!==n);k.ings=(k.ings||[]).filter(x=>x.ns!==n);say(`namespace "${n}" deleted`);return out.join('\n')}
    if(R2==='ingress'||R2==='routes'){k.ings=(k.ings||[]).filter(x=>!(x.ns===ns&&x.name===n));say(`${R2==='routes'?'route.route.openshift.io':'ingress.networking.k8s.io'} "${n}" deleted`);return out.join('\n')}
    say(`error: the server doesn't have a resource type "${r}"`);return out.join('\n')}
  if(sub==='describe'){let r=pos[1],n=pos[2];if(r&&r.includes('/'))[r,n]=r.split('/');const R2=res(r);
    if(R2==='nodes'){const nd=nodesAll.find(x=>x.name.toLowerCase()===String(n).toLowerCase());if(!nd){say(`Error from server (NotFound): nodes "${n}" not found`);return out.join('\n')}const rd=nodeReady(c,nd);say(`Name:               ${nd.name.toLowerCase()}\nRoles:              ${isCP(nd)?'control-plane':'worker'}\nAddresses:\n  InternalIP:  ${nodeIp(nd)!=null?i2ip(nodeIp(nd)):'<none>'}\n  Hostname:    ${nd.name.toLowerCase()}\nConditions:\n  Ready   ${rd.ok?'True    KubeletReady   kubelet is posting ready status':'False   KubeletNotReady   '+rd.why}\nNon-terminated Pods: ${podsOf(c).filter(p=>p.node===nd).length}`);return out.join('\n')}
    if(R2==='services'){const s=(k.svcs||[]).find(x=>x.ns===ns&&x.name===n);if(!s){say(`Error from server (NotFound): services "${n}" not found`);return out.join('\n')}const eps=svcEndpoints(c,s);say(`Name:              ${s.name}\nNamespace:         ${s.ns}\nSelector:          app=${s.sel}\nType:              ${s.type}\nIP:                ${s.cip}\n${s.lbIp?'LoadBalancer Ingress:   '+s.lbIp+'\n':''}Port:              <unset>  ${s.port}/TCP\nTargetPort:        ${s.targetPort}/TCP\n${s.nodePort?'NodePort:          <unset>  '+s.nodePort+'/TCP\n':''}Endpoints:         ${eps.map(p=>i2ip(p.ip)+':'+s.targetPort).join(',')||'<none>'}`);return out.join('\n')}
    if(R2==='pods'){const p=podsOf(c).find(x=>x.name===n);if(!p){say(`Error from server (NotFound): pods "${n}" not found`);return out.join('\n')}say(`Name:         ${p.name}\nNamespace:    ${p.dp.ns}\nNode:         ${p.node?p.node.name.toLowerCase()+'/'+i2ip(nodeIp(p.node)):'<none>'}\nStatus:       ${p.status}\nIP:           ${p.ip!=null?i2ip(p.ip):''}\nContainers:\n  ${p.dp.name}:\n    Image:   ${p.dp.image}\n${p.status==='Pending'?'Events:\n  Warning  FailedScheduling  0/'+nodesAll.length+' nodes are available: nodes not ready.':''}`);return out.join('\n')}
    if(R2==='deployments'){const dp=findDp(n);if(!dp){say(`Error from server (NotFound): deployments.apps "${n}" not found`);return out.join('\n')}say(`Name:     ${dp.name}\nNamespace: ${dp.ns}\nReplicas: ${dp.replicas} desired\nImage:    ${dp.image}\nSelector: app=${dp.labels.app}`);return out.join('\n')}
    say(`error: describe ${r}: use node, pod, svc ou deployment`);return out.join('\n')}
  if(sub==='logs'){const p=podsOf(c).find(x=>x.name===pos[1]);if(!p){say(`error: pods "${pos[1]}" not found`);return out.join('\n')}say(/nginx/.test(p.dp.image)?`/docker-entrypoint.sh: Configuration complete; ready for start up\n2026/10/15 12:00:01 [notice] 1#1: nginx/1.27.2\n2026/10/15 12:00:01 [notice] 1#1: start worker processes`:`${p.dp.name} listening on :${p.dp.port||8080}`);return out.join('\n')}
  if(sub==='rollout'){if(!pos[2]){say('error: required resource not specified (ex.: rollout status deployment/<nome>)');return out.join('\n')}say(`deployment "${(pos[2]||'').replace(/^.*\//,'')}" successfully rolled out`);return out.join('\n')}
  if(sub==='top'){say(tbl(['NAME','CPU(cores)','CPU(%)','MEMORY(bytes)','MEMORY(%)'],nodesAll.map(n=>[n.name.toLowerCase(),`${120+hsh(n.id)%400}m`,`${3+hsh(n.id)%12}%`,`${2000+hsh(n.id+'m')%6000}Mi`,`${15+hsh(n.id)%40}%`])));return out.join('\n')}
  if(sub==='config'){say(`apiVersion: v1\nclusters:\n- cluster:\n    server: https://${ocp?'api.'+k.domain:i2ip(k8sApiIp(c)||0)}:6443\n  name: ${c.name.toLowerCase()}\ncurrent-context: admin@${c.name.toLowerCase()}`);return out.join('\n')}
  if(sub==='exec'){say('error: a bancada não abre shell dentro de pods (use curl no IP do service ou do nó)');return out.join('\n')}
  if(tool==='oc'&&sub==='adm'){say('(aceito)');return out.join('\n')}
  say(`error: unknown command "${sub}" for "${tool}"`);return out.join('\n')}
/* cria um cluster pronto (chassis lógico + switch do cluster + nós) */
function clusterNew(modelId,name,x,y,opt={}){const m=CAT.BY[modelId];if(!m||!m.k8s)return null;const ch=addChassis(modelId,name,x,y,(m.cp||1)+(m.workers||0));
  k8sNew(ch,m.k8s==='openshift'?'openshift':'kubernetes');const k=ch.k8s;if(m.k8s==='k3s')k.version='v1.30.4+k3s1';
  let net=opt.net;if(!net){let i=50;const used=new Set(S.devices.flatMap(d=>l3ifs(d,true).filter(f=>(f.c.ip>>>24)===10).map(f=>(f.c.ip>>>16)&0xff)));while(used.has(i)&&i<250)i++;net=`10.${i}.0.0/24`}const c=pc(net);k.nodeNet=netStr(c);
  const base=c.net;const gw=i2ip(base+1);if(m.k8s==='openshift'){k.apiVip=i2ip(base+5);k.ingressVip=i2ip(base+7)}k.lbPool=`${i2ip(base+200)}-${i2ip(base+220)}`;
  const nodes=bladeSlots(ch).sort((a,b)=>a.slot-b.slot);let ci=0,wi=0;
  nodes.forEach((n,i)=>{const cp=i<(m.cp||1);n.k8sRole=cp?(m.k8s==='openshift'?'master':'control-plane'):'worker';n.name=`${name}-${cp?(m.k8s==='openshift'?'master':'cp')+(++ci):'worker'+(++wi)}`;
    osSetup(n,m.nodeOs||'ubuntu-22.04');const p=n.ports.findIndex((q,j)=>!isMgmt(n,j));if(p>=0){n.ports[p].mode='routed';n.ports[p].ip=`${i2ip(base+(cp?11+ci-1:21+wi-1))}/${c.len}`}n.gw=gw;
    const add=m.k8s==='openshift'?['cri-o','kubelet','openshift-clients']:['containerd','kubelet','kubectl'];n.pkgs=[...new Set([...(n.pkgs||[]),...add])];
    n.svcs=n.svcs||{};n.svcs.kubelet={active:true,enabled:true};n.svcs[m.k8s==='openshift'?'crio':'containerd']={active:true,enabled:true};
    if(n.hfw&&n.hfw.on)n.hfw.on=false});
  placeMembers(ch);return ch}

/* ====================================================================
   Sistemas operacionais simulados dos hosts (Linux e Windows)
   ==================================================================== */
/* ---------- pacotes ---------- */
/* f: famílias onde existe (d=deb r=rpm a=apk); svc: serviço criado; bins: comandos */
const PKGS={nginx:{svc:'nginx',d:'small, powerful, scalable web/proxy server'},apache2:{f:'da',svc:'apache2',bins:['apache2ctl'],d:'Apache HTTP Server'},httpd:{f:'r',svc:'httpd',bins:['httpd','apachectl'],d:'Apache HTTP Server'},
  'openssh-server':{f:'dr',svc:{d:'ssh',r:'sshd'},bins:['sshd'],d:'secure shell (SSH) server'},openssh:{f:'a',svc:'sshd',bins:['ssh','scp','sshd'],d:'Port of OpenBSD\'s free SSH release'},'openssh-client':{f:'d',bins:['ssh','scp','ssh-keygen'],d:'secure shell (SSH) client'},'openssh-clients':{f:'r',bins:['ssh','scp','ssh-keygen'],d:'OpenSSH client applications'},
  dnsutils:{f:'d',bins:['dig','nslookup','host'],d:'Clients provided with BIND 9'},'bind9-dnsutils':{f:'d',bins:['dig','nslookup','host'],d:'Clients provided with BIND 9'},'bind-utils':{f:'r',bins:['dig','nslookup','host'],d:'Utilities for querying DNS name servers'},'bind-tools':{f:'a',bins:['dig','nslookup','host'],d:'The ISC DNS tools'},
  bind9:{f:'d',svc:'named',bins:['named','rndc'],d:'Internet Domain Name Server'},bind:{f:'ra',svc:'named',bins:['named','rndc'],d:'The Berkeley Internet Name Domain (BIND) DNS server'},
  traceroute:{d:'Traces the route taken by packets over an IPv4/IPv6 network'},'net-tools':{bins:['ifconfig','netstat','route','arp'],d:'NET-3 networking toolkit'},tcpdump:{d:'command-line network traffic analyzer'},nmap:{d:'The Network Mapper'},
  'netcat-openbsd':{f:'da',bins:['nc','netcat'],d:'TCP/IP swiss army knife'},'nmap-ncat':{f:'r',bins:['nc','ncat'],d:'Nmap\'s Netcat replacement'},iperf3:{d:'Internet Protocol bandwidth measuring tool'},curl:{d:'command line tool for transferring data with URL syntax'},wget:{d:'retrieves files from the web'},
  'iputils-ping':{f:'d',bins:['ping'],d:'Tools to test the reachability of network hosts'},iputils:{f:'r',bins:['ping','tracepath','arping'],d:'Network monitoring tools including ping'},iproute2:{f:'da',bins:['ip','ss','bridge'],d:'networking and traffic control tools'},iproute:{f:'r',bins:['ip','ss'],d:'Advanced IP routing and network device configuration tools'},
  strongswan:{svc:{d:'strongswan-starter',r:'strongswan',a:'strongswan'},bins:['ipsec','swanctl'],d:'IPsec VPN solution metapackage'},libreswan:{f:'r',svc:'ipsec',bins:['ipsec'],d:'IPsec implementation with IKEv1 and IKEv2 keying protocols'},
  wireguard:{f:'d',deps:['wireguard-tools'],d:'fast, modern, secure kernel VPN tunnel (metapackage)'},'wireguard-tools':{bins:['wg','wg-quick'],d:'fast, modern, secure kernel VPN tunnel (userland utilities)'},
  'docker.io':{f:'d',svc:'docker',bins:['docker'],d:'Linux container runtime'},'docker-ce':{f:'dr',svc:'docker',bins:['docker'],d:'Docker: the open-source application container engine'},docker:{f:'a',svc:'docker',bins:['docker'],d:'Pack, ship and run any application as a lightweight container'},podman:{bins:['podman'],d:'tool for managing OCI containers and pods'},
  'mariadb-server':{svc:'mariadb',bins:['mariadb','mysql'],d:'MariaDB database server'},'mysql-server':{f:'d',svc:'mysql',bins:['mysql'],d:'MySQL database server'},postgresql:{f:'da',svc:'postgresql',bins:['psql'],d:'object-relational SQL database'},'postgresql-server':{f:'r',svc:'postgresql',bins:['psql','postgresql-setup'],d:'The programs needed to create and run a PostgreSQL server'},
  'redis-server':{f:'d',svc:'redis-server',bins:['redis-server','redis-cli'],d:'Persistent key-value database with network interface'},redis:{f:'ra',svc:'redis',bins:['redis-server','redis-cli'],d:'A persistent key-value database'},
  haproxy:{svc:'haproxy',d:'fast and reliable load balancing reverse proxy'},squid:{svc:'squid',d:'Full featured Web Proxy cache'},vsftpd:{svc:'vsftpd',d:'lightweight, efficient FTP server'},samba:{svc:{d:'smbd',r:'smb',a:'smbd'},bins:['smbpasswd','testparm'],d:'SMB/CIFS file, print, and login server'},
  'nfs-kernel-server':{f:'d',svc:'nfs-server',bins:['exportfs'],d:'support for NFS kernel server'},'nfs-utils':{f:'ra',svc:'nfs-server',bins:['exportfs'],d:'NFS utilities'},
  'isc-dhcp-server':{f:'d',svc:'isc-dhcp-server',bins:['dhcpd'],d:'ISC DHCP server for automatic IP address assignment'},'dhcp-server':{f:'r',svc:'dhcpd',bins:['dhcpd'],d:'Provides the ISC DHCP server'},
  chrony:{svc:{d:'chrony',r:'chronyd',a:'chronyd'},bins:['chronyc'],d:'Versatile implementation of the Network Time Protocol'},frr:{f:'dr',svc:'frr',bins:['vtysh'],d:'FRRouting suite of internet protocols (BGP, OSPF, IS-IS, ...)'},
  prometheus:{svc:'prometheus',d:'monitoring system and time series database'},'prometheus-node-exporter':{f:'d',svc:'prometheus-node-exporter',d:'Prometheus exporter for machine metrics'},node_exporter:{f:'r',svc:'node_exporter',bins:['node_exporter'],d:'Prometheus exporter for machine metrics'},
  grafana:{f:'dr',svc:'grafana-server',bins:['grafana-cli'],d:'Feature rich metrics dashboard and graph editor'},cockpit:{f:'dr',svc:'cockpit',d:'Web Console for Linux servers'},
  ufw:{f:'d',bins:['ufw'],d:'program for managing a Netfilter firewall'},firewalld:{f:'r',svc:'firewalld',bins:['firewall-cmd'],d:'A firewall daemon with D-Bus interface providing a dynamic firewall'},iptables:{bins:['iptables','iptables-save'],d:'administration tools for packet filtering and NAT'},nftables:{bins:['nft'],d:'Program to control packet filtering rules by Netfilter project'},
  htop:{d:'interactive processes viewer'},vim:{bins:['vim','vi'],d:'Vi IMproved - enhanced vi editor'},nano:{d:'small, friendly text editor'},git:{d:'fast, scalable, distributed revision control system'},python3:{bins:['python3'],d:'interactive high-level object-oriented language'},
  tmux:{d:'terminal multiplexer'},jq:{d:'lightweight and flexible command-line JSON processor'},unzip:{d:'De-archiver for .zip files'},tree:{d:'displays an indented directory tree'},lsof:{d:'utility to list open files'},'mtr-tiny':{f:'d',bins:['mtr'],d:'Full screen ncurses traceroute tool'},mtr:{f:'ra',bins:['mtr'],d:'Network diagnostic tool'},
  ethtool:{d:'display or change Ethernet device settings'},telnet:{d:'basic telnet client'},kubectl:{f:'dr',bins:['kubectl'],d:'Kubernetes command line client'},'openshift-clients':{f:'r',bins:['oc','kubectl'],d:'OpenShift client binaries'},
  'cloud-utils':{d:'cloud image management utilities'},'bash-completion':{d:'programmable completion for the bash shell'},'ca-certificates':{d:'Common CA certificates'},sudo:{d:'Provide limited super user privileges'},rsync:{d:'fast, versatile, remote (and local) file-copying tool'}};
const famKey=o=>({deb:'d',rpm:'r',apk:'a'})[o.fam]||'d';
const pkgDef=(o,n)=>{const p=PKGS[n];if(!p)return null;if(p.f&&!p.f.includes(famKey(o)))return null;return p};
const pkgSvc=(o,p)=>p&&p.svc?(typeof p.svc==='string'?p.svc:p.svc[famKey(o)]):null;
const pkgBins=(n,p)=>p.bins||[n];
/* comandos que vêm de pacotes (os demais são builtins sempre presentes) */
const BIN_PKG={};Object.entries(PKGS).forEach(([n,p])=>pkgBins(n,p).forEach(b=>{(BIN_PKG[b]=BIN_PKG[b]||[]).push(n)}));
const BASE_BINS={deb:['ip','ss','ping','curl','ufw'],rpm:['ip','ss','ping','curl','firewall-cmd','tracepath'],apk:['ip','ping','wget','nc','traceroute','nslookup','ifconfig','route','netstat','arp']};
function hasBin(d,b){const o=osInfo(d);if(!BIN_PKG[b]||/^(vi|vim|nano)$/.test(b))return true;if((BASE_BINS[o.fam]||[]).includes(b))return true;
  return(d.pkgs||[]).some(n=>{const p=PKGS[n];return p&&pkgBins(n,p).includes(b)})}
function pkgFor(d,b){const o=osInfo(d);return(BIN_PKG[b]||[]).find(n=>pkgDef(o,n))}
const PKGV={nginx:'1.24.0-2ubuntu7',apache2:'2.4.58-1ubuntu8',httpd:'2.4.62-1',strongswan:'5.9.13-2ubuntu4','wireguard-tools':'1.0.20210914-1',curl:'8.5.0-2ubuntu10',dnsutils:'1:9.18.28-0ubuntu0.24.04.1','bind-utils':'9.16.23-18',haproxy:'2.8.5-1ubuntu3','docker.io':'24.0.7-0ubuntu4','mariadb-server':'1:10.11.8-0ubuntu0.24.04.1',postgresql:'16+257build1',iperf3:'3.16-1build2',tcpdump:'4.99.4-3ubuntu4',traceroute:'1:2.1.5-1',bind9:'1:9.18.28-0ubuntu0.24.04.1',kubectl:'1.30.4-1.1',frr:'8.4.4-1.1ubuntu6'};
const PKGVER=n=>PKGV[n]||(()=>{const h=hsh(n);return`${1+h%4}.${h%23}.${h%7}-${1+h%3}`})();
const REPOHOST={deb:o=>o.code?(o.name.startsWith('Ubuntu')?'archive.ubuntu.com':'deb.debian.org'):'deb.debian.org',rpm:o=>o.name.startsWith('Fedora')?'mirrors.fedoraproject.org':o.name.startsWith('Rocky')?'dl.rockylinux.org':'cdn.redhat.com',apk:()=>'dl-cdn.alpinelinux.org'};
const MIRROR_IP='151.101.0.10';
const MIRROR_NAMES=['archive.ubuntu.com','security.ubuntu.com','deb.debian.org','mirrors.fedoraproject.org','dl.fedoraproject.org','dl.rockylinux.org','cdn.redhat.com','dl-cdn.alpinelinux.org','registry-1.docker.io','docker.io','download.docker.com','quay.io','registry.k8s.io','github.com','pkgs.k8s.io'];

/* ---------- sistema de arquivos ---------- */
const WIN_HOME='C:/Users/Administrador';
function fsNorm(d,p,cwd){p=String(p||'');if(isWin(d)){p=p.replace(/\\/g,'/').replace(/^~/,WIN_HOME).replace(/^\$env:USERPROFILE/i,WIN_HOME);if(/^[a-z]:/i.test(p))p=p[0].toUpperCase()+p.slice(1);else if(p.startsWith('/'))p='C:'+p;else p=(cwd||WIN_HOME)+'/'+p}
  else{p=p.replace(/^~(?=\/|$)/,'/root');if(!p.startsWith('/'))p=(cwd||'/root')+'/'+p}
  const root=isWin(d)?p.slice(0,2):'';const parts=[];(isWin(d)?p.slice(2):p).split('/').forEach(x=>{if(!x||x==='.')return;if(x==='..')parts.pop();else parts.push(x)});
  return isWin(d)?root+'/'+parts.join('/'):'/'+parts.join('/')}
function osSvcs(d){return d.svcs||(d.svcs={})}
const svcOn=(d,n)=>!!((d.svcs||{})[n]&&d.svcs[n].active);
const hasPkg=(d,n)=>(d.pkgs||[]).includes(n);
function netplanText(d){const L=['# Gerado pela Bancada de Rede — edite e rode "netplan apply"','network:','  version: 2','  ethernets:'];const vl=[];
  d.ports.forEach((p,k)=>{if(isMgmt(d,k)||+p.lag)return;const n=spn(d,k);L.push(`    ${n}:`);const c=pc(p.ip);if(c&&p.mode==='routed'){L.push('      addresses:',`        - ${cidrStr(c)}`)}else L.push('      dhcp4: false');
    if(c&&d.gw&&inNet(ip2i(d.gw)??0,c))L.push('      routes:','        - to: default',`          via: ${d.gw}`);
    (d.routes||[]).filter(r=>{const nh=ip2i(r.nh);return c&&nh!==null&&inNet(nh,c)}).forEach((r,i)=>{if(!L[L.length-1].includes('routes:')&&!L.slice(-6).some(x=>x.includes('routes:')))L.push('      routes:');L.push(`        - to: ${r.dst}`,`          via: ${r.nh}`)});
    if(c&&d.dns)L.push('      nameservers:',`        addresses: [${d.dns}]`);
    (p.subs||[]).forEach(s=>vl.push({n:`${n}.${s.vlan}`,id:s.vlan,link:n,ip:s.ip}))});
  if(vl.length){L.push('  vlans:');vl.forEach(v=>{L.push(`    ${v.n}:`,`      id: ${v.id}`,`      link: ${v.link}`);if(pc(v.ip))L.push('      addresses:',`        - ${v.ip}`)})}return L.join('\n')+'\n'}
function ifacesText(d){const L=['# /etc/network/interfaces — gerado pela Bancada (edite e rode "systemctl restart networking" / "ifup -a")','auto lo','iface lo inet loopback',''];
  d.ports.forEach((p,k)=>{if(isMgmt(d,k)||+p.lag)return;const n=spn(d,k),c=pc(p.ip);L.push(`auto ${n}`);if(c&&p.mode==='routed'){L.push(`iface ${n} inet static`,`    address ${cidrStr(c)}`);if(d.gw&&inNet(ip2i(d.gw)??0,c))L.push(`    gateway ${d.gw}`);if(d.dns)L.push(`    dns-nameservers ${d.dns}`)}else L.push(`iface ${n} inet manual`);
    (d.routes||[]).forEach(r=>{const nh=ip2i(r.nh);if(c&&nh!==null&&inNet(nh,c))L.push(`    up ip route add ${r.dst} via ${r.nh}`)});L.push('')});return L.join('\n')}
function nmText(d,k){const p=d.ports[k],c=pc(p.ip);return`[connection]\nid=${spn(d,k)}\ntype=ethernet\ninterface-name=${spn(d,k)}\n\n[ipv4]\n${c?`method=manual\naddress1=${cidrStr(c)}${d.gw&&inNet(ip2i(d.gw)??0,c)?','+d.gw:''}\n${d.dns?'dns='+d.dns.replace(/[ ,]+/g,';')+';\n':''}`:'method=disabled\n'}`}
function ipsecConfText(d){const L=['# /etc/ipsec.conf — strongSwan (gerado pela Bancada; edite e rode "ipsec restart")','config setup','    charondebug="ike 1, knl 1"',''];
  (d.vpns||[]).filter(t=>t.kind==='ipsec').forEach(t=>{const f=l3ifs(d).find(f=>!f.mgmt);L.push(`conn ${t.name}`,`    keyexchange=${t.ike==='v1'?'ikev1':'ikev2'}`,`    authby=secret`,`    left=${t.local||(f?i2ip(f.c.ip):'%defaultroute')}`,`    leftsubnet=${netsOf(t.lnets).map(netStr).join(',')}`,`    right=${t.peer}`,`    rightsubnet=${netsOf(t.rnets).map(netStr).join(',')}`,`    ike=${t.enc||'aes256'}-${t.hash||'sha256'}-${dhName(t.dh||'14')}!`,`    esp=${t.enc||'aes256'}-${t.hash||'sha256'}!`,`    auto=${t.shut?'ignore':'start'}`,'')});return L.join('\n')}
function ipsecSecretsText(d){return['# /etc/ipsec.secrets',...(d.vpns||[]).filter(t=>t.kind==='ipsec').map(t=>{const f=l3ifs(d).find(f=>!f.mgmt);return`${t.local||(f?i2ip(f.c.ip):'%any')} ${t.peer} : PSK "${t.psk||''}"`})].join('\n')+'\n'}
function wgConfText(d,name){const t=(d.vpns||[]).find(x=>x.kind==='wireguard'&&x.name===name);if(!t)return null;return`[Interface]\nPrivateKey = ${t.key||''}\n${t.addr?'Address = '+t.addr+'\n':''}ListenPort = ${t.port||51820}\n\n[Peer]\nPublicKey = ${t.peerKey||''}\nEndpoint = ${t.peer}:${t.pport||51820}\nAllowedIPs = ${netsOf(t.rnets).map(netStr).join(', ')}\nPersistentKeepalive = 25\n`}
const DHN={'1':'modp768','2':'modp1024','5':'modp1536','14':'modp2048','15':'modp3072','16':'modp4096','19':'ecp256','20':'ecp384','21':'ecp521'};
const dhName=g=>DHN[String(g)]||'modp2048';const dhNum=n=>{const e=Object.entries(DHN).find(([,v])=>v===n);return e?e[0]:null};
function osRelease(o){if(o.fam==='apk')return`NAME="Alpine Linux"\nID=alpine\nVERSION_ID=${o.ver}\nPRETTY_NAME="${o.name}"\nHOME_URL="https://alpinelinux.org/"`;
  const id=/Ubuntu/.test(o.name)?'ubuntu':/Debian/.test(o.name)?'debian':/Fedora/.test(o.name)?'fedora':/Rocky/.test(o.name)?'rocky':/CoreOS/.test(o.name)?'rhcos':'rhel';
  return`PRETTY_NAME="${o.name}"\nNAME="${o.name.replace(/ [\d.].*$/,'').replace(/ GNU\/Linux.*/,' GNU/Linux')}"\nVERSION_ID="${o.ver}"\nVERSION="${o.name.replace(/^\D+/,'')}"\n${o.code?'VERSION_CODENAME='+o.code+'\n':''}ID=${id}\n${o.fam==='deb'&&id==='ubuntu'?'ID_LIKE=debian\n':o.fam==='rpm'&&id!=='fedora'?'ID_LIKE="rhel centos fedora"\n':''}HOME_URL="https://www.${id==='rhel'||id==='rhcos'?'redhat.com':id+'.org'}/"`}
const NGINX_PAGE='<!DOCTYPE html>\n<html>\n<head>\n<title>Welcome to nginx!</title>\n</head>\n<body>\n<h1>Welcome to nginx!</h1>\n<p>If you see this page, the nginx web server is successfully installed and\nworking. Further configuration is required.</p>\n</body>\n</html>\n';
const APACHE_PAGE=n=>`<!DOCTYPE html>\n<html><head><title>Apache2 Default Page: It works</title></head>\n<body><h1>It works!</h1>\n<p>This is the default welcome page used to test the correct operation of the Apache2 server after installation on ${n} systems.</p></body></html>\n`;
const IIS_PAGE='<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN">\n<html><head><title>IIS Windows Server</title></head>\n<body><div id="container"><a href="http://go.microsoft.com/fwlink/?linkid=66138"><img src="iisstart.png" alt="IIS" width="960" height="600" /></a></div></body></html>\n';
/* arquivos que existem "de fábrica", derivados do estado do equipamento */
function baseFiles(d){const o=osInfo(d);const F={};if(!o)return F;
  if(o.fam==='win'){const W='C:/Windows/System32/drivers/etc/';F[W+'hosts']='# Copyright (c) 1993-2009 Microsoft Corp.\n#\n# This is a sample HOSTS file used by Microsoft TCP/IP for Windows.\n#\n# localhost name resolution is handled within DNS itself.\n#\t127.0.0.1       localhost\n';
    F['C:/Users/Administrador/Desktop/leia-me.txt']=`Bancada de Rede — ${o.name}\nUse ipconfig, Get-NetIPAddress, New-NetIPAddress, Test-NetConnection, Get-Service, Install-WindowsFeature...\n`;
    F['C:/Windows/System32/drivers/etc/networks']='';F['C:/Windows/win.ini']='; for 16-bit app support\n[fonts]\n[extensions]\n';
    if(svcOn(d,'W3SVC')||hasPkg(d,'Web-Server')||hasPkg(d,'IIS-WebServerRole')){F['C:/inetpub/wwwroot/iisstart.htm']=IIS_PAGE}return F}
  F['/etc/hostname']=d.name+'\n';F['/etc/hosts']=`127.0.0.1 localhost\n127.0.1.1 ${d.name}\n\n# The following lines are desirable for IPv6 capable hosts\n::1     ip6-localhost ip6-loopback\n`;
  F['/etc/os-release']=osRelease(o)+'\n';F['/etc/resolv.conf']=`# gerado — edite para trocar o DNS\nnameserver ${nameserverOf({...d,fs:{}})||'127.0.0.53'}\n`;
  F['/etc/passwd']='root:x:0:0:root:/root:/bin/bash\ndaemon:x:1:1:daemon:/usr/sbin:/usr/sbin/nologin\nnobody:x:65534:65534:nobody:/nonexistent:/usr/sbin/nologin\n'+(hasPkg(d,'nginx')?'www-data:x:33:33:www-data:/var/www:/usr/sbin/nologin\n':'');
  F['/etc/fstab']='# <file system> <mount point> <type> <options> <dump> <pass>\n/dev/sda1  /  ext4  defaults  0 1\n';F['/root/.bashrc']='# ~/.bashrc\nalias ll=\'ls -alF\'\nalias la=\'ls -A\'\n';F['/proc/version']=`Linux version ${o.kernel} (buildd@lab) (gcc 13.2.0) #1 SMP\n`;
  if(/Ubuntu/.test(o.name))F['/etc/netplan/50-cloud-init.yaml']=netplanText(d);
  else if(o.fam==='deb'||o.fam==='apk')F['/etc/network/interfaces']=ifacesText(d);
  else d.ports.forEach((p,k)=>{if(!isMgmt(d,k))F[`/etc/NetworkManager/system-connections/${spn(d,k)}.nmconnection`]=nmText(d,k)});
  if(o.fam==='deb')F['/etc/apt/sources.list']=`deb http://${REPOHOST.deb(o)}/${/Ubuntu/.test(o.name)?'ubuntu':'debian'} ${o.code} main restricted universe\n`;
  if(o.fam==='rpm')F[`/etc/yum.repos.d/${/Fedora/.test(o.name)?'fedora':'baseos'}.repo`]=`[baseos]\nname=${o.name} - BaseOS\nbaseurl=https://${REPOHOST.rpm(o)}/\nenabled=1\ngpgcheck=1\n`;
  if(o.fam==='apk')F['/etc/apk/repositories']=`https://dl-cdn.alpinelinux.org/alpine/v${o.ver.split('.').slice(0,2).join('.')}/main\nhttps://dl-cdn.alpinelinux.org/alpine/v${o.ver.split('.').slice(0,2).join('.')}/community\n`;
  if(hasPkg(d,'openssh-server')||hasPkg(d,'openssh'))F['/etc/ssh/sshd_config']='Include /etc/ssh/sshd_config.d/*.conf\n#Port 22\nPermitRootLogin prohibit-password\nPasswordAuthentication yes\nSubsystem sftp /usr/lib/openssh/sftp-server\n';
  if(hasPkg(d,'nginx')){F['/etc/nginx/nginx.conf']='user www-data;\nworker_processes auto;\nevents { worker_connections 768; }\nhttp {\n    include /etc/nginx/mime.types;\n    include /etc/nginx/conf.d/*.conf;\n    include /etc/nginx/sites-enabled/*;\n}\n';
    if(o.fam==='deb'){F['/etc/nginx/sites-available/default']='server {\n    listen 80 default_server;\n    root /var/www/html;\n    index index.html index.htm index.nginx-debian.html;\n    server_name _;\n    location / { try_files $uri $uri/ =404; }\n}\n';F['/etc/nginx/sites-enabled/default']=F['/etc/nginx/sites-available/default'];F['/var/www/html/index.nginx-debian.html']=NGINX_PAGE}
    else F['/usr/share/nginx/html/index.html']=NGINX_PAGE}
  if(hasPkg(d,'apache2')){F['/etc/apache2/apache2.conf']='ServerRoot "/etc/apache2"\nListen 80\nIncludeOptional sites-enabled/*.conf\n';F['/var/www/html/index.html']=APACHE_PAGE(o.name.split(' ')[0])}
  if(hasPkg(d,'httpd')){F['/etc/httpd/conf/httpd.conf']='ServerRoot "/etc/httpd"\nListen 80\nDocumentRoot "/var/www/html"\n'}
  if(hasPkg(d,'strongswan')){F['/etc/ipsec.conf']=ipsecConfText(d);F['/etc/ipsec.secrets']=ipsecSecretsText(d);F['/etc/swanctl/swanctl.conf']='# use /etc/ipsec.conf (modo legado) nesta bancada\n'}
  if(hasPkg(d,'wireguard-tools'))(d.vpns||[]).filter(t=>t.kind==='wireguard').forEach(t=>{F[`/etc/wireguard/${t.name}.conf`]=wgConfText(d,t.name)});
  if(hasPkg(d,'bind9'))F['/etc/bind/named.conf.local']='//\n// Zonas locais — ex.:\n// zone "lab.local" { type master; file "/etc/bind/db.lab.local"; };\n';
  if(hasPkg(d,'bind'))F['/etc/named.conf']='options {\n    listen-on port 53 { any; };\n    directory "/var/named";\n    allow-query { any; };\n    recursion yes;\n};\n';
  if(hasPkg(d,'haproxy'))F['/etc/haproxy/haproxy.cfg']='global\n    daemon\ndefaults\n    mode http\n    timeout connect 5s\n    timeout client 30s\n    timeout server 30s\nfrontend web\n    bind *:80\n    default_backend apps\nbackend apps\n    balance roundrobin\n    # server app1 10.0.0.11:80 check\n';
  if(hasPkg(d,'isc-dhcp-server'))F['/etc/dhcp/dhcpd.conf']='# subnet 10.10.10.0 netmask 255.255.255.0 { range 10.10.10.100 10.10.10.200; option routers 10.10.10.1; }\n';
  if(hasPkg(d,'frr'))F['/etc/frr/daemons']='bgpd=no\nospfd=no\nzebra=yes\n';
  const c=clusterOf(d);if(c&&c!==d){F['/root/.kube/config']=`apiVersion: v1\nclusters:\n- cluster:\n    server: https://${c.k8s.dist==='openshift'?'api.'+c.k8s.domain:i2ip(k8sApiIp(c)||0)}:6443\n  name: ${c.name.toLowerCase()}\ncontexts:\n- context: {cluster: ${c.name.toLowerCase()}, user: admin}\n  name: admin@${c.name.toLowerCase()}\ncurrent-context: admin@${c.name.toLowerCase()}\n`}
  return F}
const BASE_DIRS_LX=['/','/bin','/boot','/dev','/etc','/home','/lib','/media','/mnt','/opt','/proc','/root','/run','/sbin','/srv','/sys','/tmp','/usr','/usr/bin','/usr/local','/usr/local/bin','/usr/share','/var','/var/log','/var/tmp','/var/lib','/etc/ssh','/etc/systemd','/etc/systemd/system'];
const BASE_DIRS_WIN=['C:/','C:/Users','C:/Users/Administrador','C:/Users/Administrador/Desktop','C:/Users/Administrador/Documents','C:/Users/Administrador/Downloads','C:/Windows','C:/Windows/System32','C:/Program Files','C:/Program Files (x86)','C:/ProgramData','C:/Windows/System32/drivers','C:/Windows/System32/drivers/etc','C:/temp'];
function fsAll(d){const F=baseFiles(d);Object.entries(d.fs||{}).forEach(([p,v])=>{if(p.endsWith('/'))return;if(v===null)delete F[p];else F[p]=v});return F}
function fsRead(d,p){if(d.fs&&Object.prototype.hasOwnProperty.call(d.fs,p))return d.fs[p];const b=baseFiles(d)[p];return b===undefined?null:b}
function fsWrite(d,p,txt){(d.fs=d.fs||{})[p]=String(txt)}
function fsDirs(d){const s=new Set(isWin(d)?BASE_DIRS_WIN:BASE_DIRS_LX);const add=p=>{let q=p;while(true){const i=q.lastIndexOf('/');if(i<=0||(isWin(d)&&i<=2)){s.add(isWin(d)?q.slice(0,3):'/');break}q=q.slice(0,i);s.add(q)}};
  Object.keys(fsAll(d)).forEach(add);Object.entries(d.fs||{}).forEach(([p,v])=>{if(p.endsWith('/')&&v!==null){const q=p.slice(0,-1);s.add(q);add(q)}});
  Object.entries(d.fs||{}).forEach(([p,v])=>{if(p.endsWith('/')&&v===null)s.delete(p.slice(0,-1))});return s}
const fsIsDir=(d,p)=>fsDirs(d).has(p);
function fsList(d,dir){const pre=dir.endsWith('/')?dir:dir+'/';const items=new Map();Object.entries(fsAll(d)).forEach(([p,v])=>{if(p.startsWith(pre)){const r=p.slice(pre.length);if(!r.includes('/'))items.set(r,{n:r,dir:false,size:v.length})}});
  fsDirs(d).forEach(p=>{if(p.startsWith(pre)&&p!==dir){const r=p.slice(pre.length);if(r&&!r.includes('/'))items.set(r,{n:r,dir:true,size:4096})}});return[...items.values()].sort((a,b)=>a.n.localeCompare(b.n))}
function fsRm(d,p){d.fs=d.fs||{};if(baseFiles(d)[p]!==undefined)d.fs[p]=null;else delete d.fs[p]}
function fsMkdir(d,p){(d.fs=d.fs||{})[p+'/']=true}
function fsRmdir(d,p){const pre=p+'/';Object.keys(fsAll(d)).forEach(f=>{if(f.startsWith(pre))fsRm(d,f)});Object.keys(d.fs||{}).forEach(k=>{if(k.startsWith(pre)&&k.endsWith('/'))delete d.fs[k]});d.fs[pre]=null}

/* zonas DNS de um servidor do lab (bind: arquivos com "IN A"; Windows DNS: d.dnsRecs) */
function zoneLookup(srv,name){if(!srv||!srv.os)return null;name=String(name).toLowerCase().replace(/\.$/,'');
  if(isWin(srv)){if(!svcOn(srv,'DNS'))return null;const r=(srv.dnsRecs||[]).find(r=>`${r.name==='@'?'':r.name+'.'}${r.zone}`.toLowerCase()===name);return r?ip2i(r.ip):null}
  if(!svcOn(srv,'named'))return null;const F=fsAll(srv);for(const[p,t]of Object.entries(F)){if(!/^\/(etc\/bind|var\/named)\//.test(p)||!/\bIN\s+A\b/.test(t))continue;
    const org=((t.match(/^\$ORIGIN\s+(\S+)/m)||[])[1]||(p.match(/db\.(.+)$/)||p.match(/\/([^/]+)\.zone$/)||[])[1]||'').replace(/\.$/,'').toLowerCase();
    for(const l of t.split('\n')){const m=l.replace(/;.*/,'').match(/^(\S+)\s+(?:\d+\s+)?IN\s+A\s+([\d.]+)/i);if(!m)continue;let n=m[1].toLowerCase();n=n==='@'?org:n.endsWith('.')?n.slice(0,-1):org?n+'.'+org:n;if(n===name)return ip2i(m[2])}}return null}

/* ---------- shell: análise da linha ---------- */
function shLex(line,env,sub){const T=[];let i=0,cur=null,q=false;const push=()=>{if(cur!==null){T.push({w:cur,q});cur=null;q=false}};
  const varx=()=>{const em=line.slice(i).match(/^\$env:(\w+)/i);if(em){i+=em[0].length;return env['env:'+em[1].toUpperCase()]??''}let m=line.slice(i).match(/^\$(\{(\w+)\}|(\w+|\?))/);if(m){i+=m[0].length;return env[m[2]||m[3]]??''}
    if(line[i+1]==='('){let dep=0,j=i+1;for(;j<line.length;j++){if(line[j]==='(')dep++;else if(line[j]===')'){dep--;if(!dep)break}}const s=line.slice(i+2,j);i=j+1;return sub?sub(s).replace(/\n+$/,''):''}
    i++;return'$'};
  while(i<line.length){const ch=line[i];
    if(ch==="'"){const j=line.indexOf("'",i+1);cur=(cur||'')+line.slice(i+1,j<0?undefined:j);q=true;i=j<0?line.length:j+1;continue}
    if(ch==='"'){i++;cur=cur||'';q=true;while(i<line.length&&line[i]!=='"'){if(line[i]==='\\'&&/["\\$`]/.test(line[i+1]||'')){cur+=line[i+1];i+=2;continue}if(line[i]==='$'){cur+=varx();continue}cur+=line[i++]}i++;continue}
    if(ch==='\\'){cur=(cur||'')+(line[i+1]||'');i+=2;continue}
    if(ch==='$'){cur=(cur||'')+varx();continue}
    if(/\s/.test(ch)){push();i++;continue}
    if(ch==='#'&&cur===null){break}
    const op=line.slice(i).match(/^(2>&1|&&|\|\||>>|<<-?|2>>|2>|&>|[|;><&])/);if(op){push();T.push({op:op[1]});i+=op[1].length;continue}
    cur=(cur||'')+ch;i++}push();return T}
function shParse(T){const list=[];let pipe=[],cmd={argv:[],redir:[]};const endCmd=()=>{pipe.push(cmd);cmd={argv:[],redir:[]}};
  for(let i=0;i<T.length;i++){const t=T[i];if(t.w!==undefined){cmd.argv.push(t.w);continue}
    if(t.op==='|'){endCmd();continue}if(t.op===';'||t.op==='&&'||t.op==='||'||t.op==='&'){endCmd();list.push({pipe,op:t.op==='&'?';':t.op,bg:t.op==='&'});pipe=[];continue}
    if(t.op==='2>&1'){cmd.redir.push({fd:2,to1:true});continue}
    if(/^(>|>>|2>|2>>|&>)$/.test(t.op)){const f=T[i+1];i++;if(!f||f.w===undefined)return{err:'bash: syntax error near unexpected token `newline\''};cmd.redir.push({fd:t.op.startsWith('2')?2:t.op==='&>'?3:1,file:f.w,append:t.op.endsWith('>>')});continue}
    if(t.op==='<'){const f=T[i+1];i++;if(f)cmd.stdinFile=f.w;continue}
    if(t.op.startsWith('<<')){const f=T[i+1];i++;if(!f)return{err:'bash: syntax error'};cmd.here={end:f.w,strip:t.op==='<<-'};continue}}
  if(cmd.argv.length||cmd.redir.length||cmd.here)endCmd();if(pipe.length)list.push({pipe,op:';'});return{list}}
const isP=v=>v&&typeof v.then==='function';
const M=(v,f)=>isP(v)?v.then(f):f(v);
function osPrompt(d,st){if(st.here)return'>';const o=osInfo(d);if(o.fam==='win')return`PS ${(st.cwd||WIN_HOME).replace(/\//g,'\\').replace(/^C:\\$/,'C:\\')}>`;
  const cwd=st.cwd||'/root';const sh=cwd==='/root'?'~':cwd.startsWith('/root/')?'~'+cwd.slice(5):cwd;
  if(o.fam==='rpm')return`[root@${d.name} ${sh==='~'?'~':sh.split('/').pop()||'/'}]#`;if(o.fam==='apk')return`${d.name}:${sh}#`;return`root@${d.name}:${sh}#`}
function osBanner(d){const o=osInfo(d);if(o.fam==='win')return[`Windows PowerShell — ${o.name} (${d.name})`,'Copyright (C) Microsoft Corporation. Todos os direitos reservados.','Digite help para ver os comandos simulados.'];
  return[`${o.fam==='apk'?'Welcome to Alpine!':`Welcome to ${o.name} (GNU/Linux ${o.kernel} x86_64)`}`,'',` * Bancada de Rede — ${d.name}${d.ct&&d.ctOn?` · container real ${o.img} (comandos de rede continuam simulados)`:''}`,' * Digite help para ver o que está disponível.','']}

/* executa uma linha no shell do SO */
function osRun(d,line,st,ctx){st.env=st.env||{};const o=osInfo(d);
  if(st.here){const h=st.here;const l=h.strip?line.replace(/^\t+/,''):line;if(l.trim()===h.end){st.here=null;return osExec(d,h.line,st,ctx,h.buf.join('\n')+'\n')}h.buf.push(line);return{}}
  return osExec(d,line,st,ctx,null)}
const SIMCMDS=new Set(['ip','ifconfig','route','arp','ping','traceroute','tracepath','mtr','nc','netcat','ncat','curl','wget','dig','nslookup','host','ssh','scp','iperf3','ipsec','swanctl','wg','wg-quick','kubectl','oc','hostname','hostnamectl','netplan','nmcli','ufw','firewall-cmd','iptables','systemctl','service','rc-service','rc-update','journalctl','ss','netstat','help','clear','exit','logout','reboot','shutdown','poweroff','tcpdump','ipmitool','nano','vi','vim','edit']);
function osExec(d,line,st,ctx,hereBody){const fm=!isWin(d)&&String(line).match(/^\s*for\s+(\w+)\s+in\s+(.+?)\s*;\s*do\s+(.+?)\s*;?\s*done\s*$/);
  if(fm){st.env=st.env||{};const items=shLex(fm[2],st.env).filter(t=>t.w!==undefined).map(t=>t.w);const exp=items.length===1&&/^\{(\d+)\.\.(\d+)\}$/.test(items[0])?(()=>{const m=items[0].match(/(\d+)\.\.(\d+)/);const a=[];for(let i=+m[1];i<=+m[2]&&a.length<200;i++)a.push(String(i));return a})():items;
    let ch=null;for(const it of exp){const run=()=>{st.env[fm[1]]=it;const r=osExec(d,fm[3],st,{...ctx,sub:true},null);return r&&r.async?r.async:null};ch=ch?ch.then(run):run()}return ch?{async:ch}:{}}const env=st.env=st.env||{};if(isWin(d)){env['env:COMPUTERNAME']=d.name.toUpperCase();env['env:USERPROFILE']=WIN_HOME;env['env:USERNAME']='Administrador';env['env:OS']='Windows_NT';env.null='/dev/null';env.true='True';env.false='False';env.HOME=WIN_HOME}else{env.HOME='/root';env.USER='root';env.HOSTNAME=d.name;env.PWD=st.cwd||'/root';env.SHELL='/bin/bash'}
  const sub=s=>{const tmp={log:[],env,cwd:st.cwd};const r=osExec(d,s,tmp,{...ctx,sub:true},null);return tmp.log.filter(x=>x.t!=='err'&&x.t!=='dim').map(x=>x.s).join('\n')};
  const P=shParse(shLex(line,env,sub));if(P.err){st.log.push({t:'err',s:P.err});return{}}
  if(!hereBody&&P.list.some(x=>x.pipe.some(c=>c.here))){const c=P.list.flatMap(x=>x.pipe).find(c=>c.here);st.here={line,end:c.here.end,strip:c.here.strip,buf:[]};return{}}
  /* container real: comandos que não são de rede vão para o container */
  if(d.ct&&d.ctOn&&ctx.ctExec&&!ctx.sub){const w0=(P.list[0]&&P.list[0].pipe[0]&&P.list[0].pipe[0].argv.filter(x=>x!=='sudo')[0])||'';
    if(w0&&!SIMCMDS.has(w0)&&w0!=='cd'){const pr=ctx.ctExec(d,line,st.cwd||'/root',hereBody).then(r=>{String(r.out||'').replace(/\n$/,'').split('\n').forEach(s=>{if(s!==''||r.out)st.log.push({t:'out',s})});if(r.err)String(r.err).replace(/\n$/,'').split('\n').forEach(s=>st.log.push({t:'err',s}));if(r.ports)d.ctPorts=r.ports;if(ctx.onChange)ctx.onChange()});return{async:pr}}
    if(w0==='cd'){/* segue local */}}
  let last=0;const res={};
  const step=i=>{if(i>=P.list.length)return res;const it=P.list[i];if(i>0){const prev=P.list[i-1].op;if(prev==='&&'&&last!==0)return step(i+1);if(prev==='||'&&last===0)return step(i+1)}
    return M(runPipe(d,it.pipe,st,ctx,hereBody,res),code=>{last=code;env['?']=String(code);return step(i+1)})};
  const r=step(0);if(isP(r)){res.async=r.then(()=>{});return res}return res}
function runPipe(d,pipe,st,ctx,hereBody,res){let stdin=null;let code=0;
  const step=i=>{if(i>=pipe.length)return code;const c=pipe[i];const lastCmd=i===pipe.length-1;const buf=[];const io=mkIo(d,st,ctx,buf,c,stdin,hereBody,res);
    if(c.stdinFile){const p=fsNorm(d,c.stdinFile,st.cwd);const t=fsRead(d,p);if(t==null){st.log.push({t:'err',s:`bash: ${c.stdinFile}: No such file or directory`});return 1}io.stdin=t}
    return M(runCmd(io),cd=>{code=cd||0;const text=buf.filter(x=>x.t!=='err2').map(x=>x.s);const r1=c.redir.find(r=>r.fd===1||r.fd===3);const r2=c.redir.find(r=>r.fd===2||r.fd===3);
      const errOut=x=>{if(r2&&r2.file)return;if(c.redir.some(r=>r.to1)&&!lastCmd)text.push(x.s);else st.log.push({t:'err',s:x.s})};if(!lastCmd||r1)buf.filter(x=>x.t==='err2').forEach(errOut);
      if(r1){if(r1.file!=='/dev/null'){const p=fsNorm(d,r1.file,st.cwd);if(fsIsDir(d,p)){st.log.push({t:'err',s:`bash: ${r1.file}: Is a directory`});return step(i+1)}const prev=r1.append?(fsRead(d,p)||''):'';fsWrite(d,p,prev+(text.length?text.join('\n')+'\n':''));ctx.onChange&&ctx.onChange()}stdin='';return step(i+1)}
      if(lastCmd)buf.forEach(x=>x.t==='err2'?errOut(x):st.log.push(x));else stdin=text.join('\n')+(text.length?'\n':'');return step(i+1)})};
  return step(0)}
function mkIo(d,st,ctx,buf,c,stdin,hereBody,res){const argv=c.argv.slice();while(argv[0]==='sudo'){argv.shift();while(argv[0]&&argv[0].startsWith('-'))argv.shift()}
  return{d,st,ctx,argv,c,res,o:osInfo(d),stdin:c.here?hereBody:stdin,
    out:(s,t='out')=>{String(s).split('\n').forEach(x=>buf.push({t,s:x}))},err:s=>String(s).split('\n').forEach(x=>buf.push({t:'err2',s:x})),
    raw:s=>String(s).split('\n').forEach(x=>buf.push({t:'out',s:x})),changed:()=>{ctx.onChange&&ctx.onChange()},path:p=>fsNorm(d,p,st.cwd)}}
function runCmd(io){const a=io.argv;if(!a.length)return 0;if(isWin(io.d))return winCmd(io);let cmd=a[0];const al={ll:['ls','-alF'],la:['ls','-A'],l:['ls','-CF'],'vim.tiny':['vim'],python:['python3'],dnf5:['dnf'],yum:['dnf'],ncat:['nc'],netcat:['nc'],'apt-get':['apt'],'apt-cache':['apt'],tracepath:['traceroute'],podman:['docker'],'.':['source'],'swanctl':['ipsec']};
  if(al[cmd]&&!(cmd==='podman'&&!hasBin(io.d,'podman'))){io.argv=[...al[cmd],...a.slice(1)];if(cmd==='podman')io.podman=true;if(cmd==='apt-cache')io.aptCache=true;cmd=io.argv[0]}
  if(/^\.?\.?\//.test(cmd)||cmd.endsWith('.sh')&&!LX[cmd]){return runScript(io,cmd,io.argv.slice(1))}
  const f=LX[cmd];const realBin=cmd==='ping'||cmd==='traceroute'?cmd:cmd;
  if(f&&!hasBin(io.d,realBin)){const p=pkgFor(io.d,realBin);const o=io.o;io.err(o.fam==='apk'?`sh: ${cmd}: not found`:`bash: ${cmd}: command not found`);if(p&&o.fam==='deb')io.out(`Comando '${cmd}' não encontrado, mas pode ser instalado com:\napt install ${p}`,'dim');else if(p)io.out(`(instale com: ${o.pm==='apk'?'apk add':o.pm+' install'} ${p})`,'dim');return 127}
  if(!f){const p=pkgFor(io.d,cmd);io.err(io.o.fam==='apk'?`sh: ${cmd}: not found`:`bash: ${cmd}: command not found`);if(p)io.out(io.o.fam==='deb'?`Comando '${cmd}' não encontrado, mas pode ser instalado com:\napt install ${p}`:`(instale com: ${io.o.pm==='apk'?'apk add':io.o.pm+' install'} ${p})`,'dim');else if(['show','conf','configure','enable','interface','router','display','vlan'].includes(cmd))io.out('(isto é um shell Linux, não a CLI de um switch — digite help)','dim');return 127}
  return f(io)}
function runScript(io,file,args){const p=io.path(file.replace(/^(bash|sh)\s+/,''));const t=fsRead(io.d,p);if(t==null){io.err(`bash: ${file}: No such file or directory`);return 127}
  const lines=t.split('\n').filter(l=>l.trim()&&!/^\s*#/.test(l));let i=0;const env=io.st.env;args.forEach((x,j)=>env[String(j+1)]=x);
  const nxt=()=>{while(i<lines.length){const ln=lines[i++];const tmp={log:[],env,cwd:io.st.cwd,here:null};const r=osExec(io.d,ln,tmp,io.ctx,null);io.st.cwd=tmp.cwd;tmp.log.forEach(x=>io.out(x.s,x.t==='err'?'err':x.t));if(r&&r.async)return r.async.then(()=>{tmp.log.splice(0).forEach(x=>io.out(x.s,x.t));return nxt()})}return 0};return nxt()}
/* roda um comando da bancada "antiga" (hostRun) capturando a saída */
function legacy(io,line){const tmp={log:[]};const r=hostRun(io.d,line,tmp,io.ctx)||{};tmp.log.forEach(x=>io.out(x.s,x.t==='err'?'err':x.t));if(r.sim)io.res.sim=r.sim;return tmp.log.some(x=>x.t==='err')?1:0}
const flagsOf=(a,spec)=>{const f={},pos=[];for(let i=1;i<a.length;i++){const x=a[i];if(x==='--'){pos.push(...a.slice(i+1));break}if(/^--?[A-Za-z]/.test(x)&&!/^-\d+$/.test(x)){if(x.startsWith('--')){const[k,v]=x.slice(2).split('=');if(v!==undefined)f[k]=v;else if(spec&&spec.includes(k+'='))f[k]=a[++i];else f[k]=true}else{const cs=x.slice(1);for(let j=0;j<cs.length;j++){const ch=cs[j];if(spec&&spec.includes(ch+'=')){f[ch]=cs.slice(j+1)||a[++i];break}f[ch]=true}}}else pos.push(x)}return{f,pos}};
const readIn=(io,files)=>{if(!files.length)return io.stdin??'';let s='';for(const fn of files){const p=io.path(fn);if(fsIsDir(io.d,p)){io.err(`${io.argv[0]}: ${fn}: Is a directory`);continue}const t=fsRead(io.d,p);if(t==null){io.err(`${io.argv[0]}: ${fn}: No such file or directory`);continue}s+=t}return s};
const linesOf=s=>{const L=String(s).split('\n');if(L[L.length-1]==='')L.pop();return L};
const hsz=n=>n>=1<<30?(n/(1<<30)).toFixed(1)+'G':n>=1<<20?(n/(1<<20)).toFixed(1)+'M':n>=1024?(n/1024).toFixed(1)+'K':String(n);

/* ---------- comandos Linux ---------- */
const LX={};
LX.help=io=>{io.out(`Shell ${io.o.name} simulado — principais comandos:
  arquivos   ls cd pwd cat echo > >> touch mkdir rm cp mv head tail grep wc sort uniq cut awk sed -i tee find tree
             nano/vi <arquivo> (abre o editor) · cat <<EOF > arquivo · bash script.sh
  sistema    uname -a · cat /etc/os-release · hostnamectl · free -h · df -h · ps aux · top · uptime · reboot
  pacotes    ${io.o.pm==='apt'?'apt update · apt install nginx · apt remove · apt list --installed · dpkg -l':io.o.pm==='apk'?'apk update · apk add nginx · apk del · apk info':'dnf install nginx · dnf remove · dnf list installed · rpm -qa'}
  serviços   systemctl status|start|stop|restart|enable|disable <svc> · systemctl list-units --type=service · journalctl -u <svc>
  firewall   ${io.o.fw==='firewalld'?'firewall-cmd --state · --list-all · --add-port=80/tcp --permanent · --add-service=http · --reload':io.o.fw==='ufw'?'ufw status · ufw enable · ufw allow 22/tcp · ufw allow "Nginx Full" · ufw deny 80':'iptables -L · iptables -P INPUT DROP · iptables -A INPUT -p tcp --dport 80 -j ACCEPT'}
  rede       ip a · ip route · ping · traceroute · ss -tulpn · curl http://nome-ou-ip · dig nome · nc -zv ip porta · ssh host · scp
             ${/Ubuntu/.test(io.o.name)?'netplan (edite /etc/netplan/50-cloud-init.yaml e rode netplan apply)':io.o.fam==='rpm'?'nmcli con mod eth0 ipv4.addresses 10.0.0.5/24 ipv4.gateway 10.0.0.1 ipv4.method manual · nmcli con up eth0':'edite /etc/network/interfaces e rode ifup -a / systemctl restart networking'}
  vpn        ipsec (strongSwan: /etc/ipsec.conf + /etc/ipsec.secrets, ipsec restart, ipsec status) · wg genkey | wg pubkey · wg-quick up wg0 · wg show
  outros     docker run -d -p 8080:80 nginx · iperf3 -s / -c · python3 -m http.server 8000 · nc -l 9000 · kubectl/oc (nós de cluster)`);return 0};
LX.clear=io=>{io.st.log.length=0;return 0};LX.exit=LX.logout=io=>{io.out('logout','dim');return 0};LX.true=()=>0;LX.false=()=>1;LX[':']=()=>0;
LX.pwd=io=>{io.out(io.st.cwd||'/root');return 0};
LX.cd=io=>{const t=io.argv[1]&&io.argv[1]!=='~'?io.argv[1]==='-'?(io.st.oldcwd||'/root'):io.argv[1]:'/root';const p=io.path(t);if(!fsIsDir(io.d,p)){io.err(fsRead(io.d,p)!=null?`bash: cd: ${t}: Not a directory`:`bash: cd: ${t}: No such file or directory`);return 1}io.st.oldcwd=io.st.cwd;io.st.cwd=p;return 0};
LX.ls=io=>{const{f,pos}=flagsOf(io.argv);const tg=pos.length?pos:['.'];let rc=0;const long=f.l,all=f.a||f.A;
  tg.forEach((t,ti)=>{const p=io.path(t);if(!fsIsDir(io.d,p)){const c=fsRead(io.d,p);if(c==null){io.err(`ls: cannot access '${t}': No such file or directory`);rc=2;return}io.out(long?`-rw-r--r-- 1 root root ${String(c.length).padStart(6)} Oct 15 12:00 ${t}`:t);return}
    if(tg.length>1)io.out((ti?'\n':'')+t+':');let it=fsList(io.d,p);if(all&&f.a)it=[{n:'.',dir:true,size:4096},{n:'..',dir:true,size:4096},...it];if(!all)it=it.filter(x=>!x.n.startsWith('.'));
    if(long){io.out(`total ${it.length*4}`);it.forEach(x=>io.out(`${x.dir?'drwxr-xr-x':'-rw-r--r--'} ${x.dir?2:1} root root ${(f.h?hsz(x.size):String(x.size)).padStart(6)} Oct 15 12:00 ${x.n}${x.dir&&f.F?'/':''}`))}
    else if(it.length)io.out(f['1']?it.map(x=>x.n).join('\n'):it.map(x=>x.n+(f.F&&x.dir?'/':'')).join('  '))});return rc};
LX.cat=io=>{const{f,pos}=flagsOf(io.argv);const s=readIn(io,pos);if(s){const L=linesOf(s);L.forEach((x,i)=>io.raw(f.n?String(i+1).padStart(6)+'  '+x:x))}return 0};
LX.less=LX.more=LX.cat;
LX.echo=io=>{let a=io.argv.slice(1),nl=true,e=false;while(a[0]&&/^-[neE]+$/.test(a[0])){if(a[0].includes('n'))nl=false;if(a[0].includes('e'))e=true;a.shift()}let s=a.join(' ');if(e)s=s.replace(/\\n/g,'\n').replace(/\\t/g,'\t');io.out(s);return 0};
LX.printf=io=>{const fm=io.argv[1]||'';let k=2;const s=fm.replace(/%[sd]/g,()=>io.argv[k++]??'').replace(/\\n/g,'\n').replace(/\\t/g,'\t');io.out(s.replace(/\n$/,''));return 0};
LX.touch=io=>{flagsOf(io.argv).pos.forEach(t=>{const p=io.path(t);if(fsRead(io.d,p)==null&&!fsIsDir(io.d,p))fsWrite(io.d,p,'')});io.changed();return 0};
LX.mkdir=io=>{const{f,pos}=flagsOf(io.argv);let rc=0;pos.forEach(t=>{const p=io.path(t);if(fsIsDir(io.d,p)){if(!f.p){io.err(`mkdir: cannot create directory '${t}': File exists`);rc=1}return}const par=p.slice(0,p.lastIndexOf('/'))||'/';if(!f.p&&!fsIsDir(io.d,par)){io.err(`mkdir: cannot create directory '${t}': No such file or directory`);rc=1;return}fsMkdir(io.d,p)});io.changed();return rc};
LX.rm=io=>{const{f,pos}=flagsOf(io.argv);let rc=0;pos.forEach(t=>{const p=io.path(t);if(fsIsDir(io.d,p)){if(!(f.r||f.R)){io.err(`rm: cannot remove '${t}': Is a directory`);rc=1;return}if(p==='/'){io.err("rm: it is dangerous to operate recursively on '/'");rc=1;return}fsRmdir(io.d,p);return}if(fsRead(io.d,p)==null){if(!f.f){io.err(`rm: cannot remove '${t}': No such file or directory`);rc=1}return}fsRm(io.d,p)});io.changed();return rc};
LX.rmdir=io=>{flagsOf(io.argv).pos.forEach(t=>{const p=io.path(t);if(fsList(io.d,p).length)io.err(`rmdir: failed to remove '${t}': Directory not empty`);else fsRmdir(io.d,p)});io.changed();return 0};
function cpmv(io,mv){const{f,pos}=flagsOf(io.argv);if(pos.length<2){io.err(`${io.argv[0]}: missing destination file operand`);return 1}const dst=io.path(pos.pop());let rc=0;
  pos.forEach(t=>{const p=io.path(t);const target=fsIsDir(io.d,dst)?dst.replace(/\/$/,'')+'/'+p.split('/').pop():dst;
    if(fsIsDir(io.d,p)){if(!mv&&!(f.r||f.R||f.a)){io.err(`cp: -r not specified; omitting directory '${t}'`);rc=1;return}const pre=p+'/';Object.entries(fsAll(io.d)).forEach(([k,v])=>{if(k.startsWith(pre))fsWrite(io.d,target+'/'+k.slice(pre.length),v)});fsMkdir(io.d,target);if(mv)fsRmdir(io.d,p);return}
    const c=fsRead(io.d,p);if(c==null){io.err(`${io.argv[0]}: cannot stat '${t}': No such file or directory`);rc=1;return}fsWrite(io.d,target,c);if(mv)fsRm(io.d,p)});io.changed();return rc}
LX.cp=io=>cpmv(io,false);LX.mv=io=>cpmv(io,true);LX.ln=io=>{const{pos}=flagsOf(io.argv);if(pos.length<2)return 1;const c=fsRead(io.d,io.path(pos[0]));if(c!=null)fsWrite(io.d,io.path(pos[1]),c);io.changed();return 0};
LX.head=LX.tail=io=>{const tail=io.argv[0]==='tail';let n=10;const a=io.argv.slice(1).filter((x,i,arr)=>{if(/^-\d+$/.test(x)){n=+x.slice(1);return false}if(x==='-n'){n=+arr[i+1];arr[i+1]='\0';return false}if(/^-n\d+$/.test(x)){n=+x.slice(2);return false}if(x==='-f'||x==='-F')return false;return x!=='\0'});
  const L=linesOf(readIn(io,a));(tail?L.slice(-n):L.slice(0,n)).forEach(x=>io.raw(x));return 0};
LX.grep=io=>{const{f,pos}=flagsOf(io.argv,'e=');let pat=f.e||pos.shift();if(pat==null){io.err('Usage: grep [OPTION]... PATTERNS [FILE]...');return 2}let re;try{re=new RegExp((f.F?pat.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'):(f.E?pat:pat.replace(/\\\|/g,'|').replace(/\\\(/g,'(').replace(/\\\)/g,')'))),f.i?'i':'')}catch(e){re=new RegExp(pat.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),f.i?'i':'')}
  let files=pos;if(f.r||f.R){const base=io.path(pos[0]||'.');files=Object.keys(fsAll(io.d)).filter(k=>k.startsWith(base+'/')||k===base)}let n=0;
  const one=(name,txt)=>linesOf(txt).forEach((l,i)=>{const m=re.test(l);if(m!==!!f.v){n++;if(!f.c&&!f.q&&!f.l)io.raw(`${files.length>1||f.r?name+':':''}${f.n?(i+1)+':':''}${l}`)}});
  if(!files.length)one('',io.stdin??'');else files.forEach(fn=>{const t=f.r?fsRead(io.d,fn):fsRead(io.d,io.path(fn));if(t==null){if(!f.s)io.err(`grep: ${fn}: No such file or directory`);return}const b=n;one(fn,t);if(f.l&&n>b)io.raw(fn)});if(f.c)io.raw(String(n));return n?0:1};
LX.egrep=io=>{io.argv=['grep','-E',...io.argv.slice(1)];return LX.grep(io)};
LX.wc=io=>{const{f,pos}=flagsOf(io.argv);const s=readIn(io,pos);const l=(s.match(/\n/g)||[]).length,w=(s.match(/\S+/g)||[]).length,c=s.length;io.raw(f.l?String(l):f.w?String(w):f.c?String(c):`${String(l).padStart(7)} ${String(w).padStart(7)} ${String(c).padStart(7)}${pos[0]?' '+pos[0]:''}`);return 0};
LX.sort=io=>{const{f,pos}=flagsOf(io.argv);let L=linesOf(readIn(io,pos));L.sort(f.n?(a,b)=>parseFloat(a)-parseFloat(b):(a,b)=>a.localeCompare(b));if(f.r)L.reverse();if(f.u)L=[...new Set(L)];L.forEach(x=>io.raw(x));return 0};
LX.uniq=io=>{const{f,pos}=flagsOf(io.argv);const L=linesOf(readIn(io,pos));const o=[];L.forEach(x=>{if(o.length&&o[o.length-1].s===x)o[o.length-1].n++;else o.push({s:x,n:1})});o.forEach(x=>io.raw(f.c?`${String(x.n).padStart(7)} ${x.s}`:x.s));return 0};
LX.cut=io=>{const{f,pos}=flagsOf(io.argv,'d=f=c=');const dl=f.d||'\t';const fs=String(f.f||'1').split(',').flatMap(x=>{const[a,b]=x.split('-').map(Number);return b?Array.from({length:b-a+1},(_,i)=>a+i):[a]});linesOf(readIn(io,pos)).forEach(l=>{if(f.c){const[a,b]=String(f.c).split('-').map(Number);io.raw(l.slice(a-1,b||a))}else{const p=l.split(dl);io.raw(fs.map(i=>p[i-1]??'').join(dl))}});return 0};
LX.tr=io=>{const a=io.argv.slice(1);const s=io.stdin??'';if(a[0]==='-d'){io.out(s.split('').filter(ch=>!a[1].includes(ch)).join('').replace(/\n$/,''));return 0}const A=a[0]||'',B=a[1]||'';const exp=x=>x.replace(/(\w)-(\w)/g,(m,p,q)=>{let r='';for(let c=p.charCodeAt(0);c<=q.charCodeAt(0);c++)r+=String.fromCharCode(c);return r});const xa=exp(A),xb=exp(B);io.out(s.split('').map(ch=>{const i=xa.indexOf(ch);return i<0?ch:xb[Math.min(i,xb.length-1)]||''}).join('').replace(/\n$/,''));return 0};
LX.awk=io=>{const{f,pos}=flagsOf(io.argv,'F=');const prog=pos.shift()||'';const fsep=f.F;const m=prog.match(/^\s*(?:\/(.*)\/\s*)?\{\s*print\s*(.*?)\s*\}\s*$/);if(!m){io.err('awk: a bancada entende só  awk [-F sep] \'[/regex/] {print $1, $3}\'');return 2}
  const re=m[1]?new RegExp(m[1]):null;linesOf(readIn(io,pos)).forEach(l=>{if(re&&!re.test(l))return;const F=fsep?l.split(fsep):l.trim().split(/\s+/);const ex=(m[2]||'$0').split(',').map(x=>x.trim()).map(x=>x==='$0'?l:/^\$\d+$/.test(x)?F[+x.slice(1)-1]??'':x==='NF'?String(F.length):x==='$NF'?F[F.length-1]:x.replace(/^"|"$/g,''));io.raw(ex.join(' '))});return 0};
LX.sed=io=>{const{f,pos}=flagsOf(io.argv,'e=');const sc=f.e||pos.shift()||'';const files=pos;const m=sc.match(/^s(.)(.*?)\1(.*?)\1(g?i?)$/);const dm=sc.match(/^\/(.*)\/d$/)||sc.match(/^(\d+)d$/);
  if(!m&&!dm&&!f.n){io.err(`sed: a bancada entende 's/antigo/novo/g' e '/padrão/d'`);return 1}
  const ap=t=>{if(m){let re;try{re=new RegExp(m[2],m[4].includes('g')?'g'+(m[4].includes('i')?'i':''):(m[4].includes('i')?'i':''))}catch(e){return t}return t.split('\n').map(l=>l.replace(re,m[3].replace(/\\\//g,'/').replace(/&/g,'$&'))).join('\n')}
    if(dm){return t.split('\n').filter((l,i)=>/^\d+$/.test(dm[1])?i+1!==+dm[1]:!new RegExp(dm[1]).test(l)).join('\n')}return t};
  if(f.i){files.forEach(fn=>{const p=io.path(fn);const t=fsRead(io.d,p);if(t==null){io.err(`sed: can't read ${fn}: No such file or directory`);return}fsWrite(io.d,p,ap(t))});io.changed();return 0}
  const s=ap(readIn(io,files));linesOf(s).forEach(x=>io.raw(x));return 0};
LX.tee=io=>{const{f,pos}=flagsOf(io.argv);const s=io.stdin??'';pos.forEach(fn=>{const p=io.path(fn);fsWrite(io.d,p,(f.a?(fsRead(io.d,p)||''):'')+s)});linesOf(s).forEach(x=>io.raw(x));io.changed();return 0};
LX.find=io=>{const a=io.argv.slice(1);const base=io.path(a[0]&&!a[0].startsWith('-')?a[0]:'.');const ni=a.indexOf('-name')>=0?a.indexOf('-name'):a.indexOf('-iname');const pat=ni>=0?a[ni+1]:null;const re=pat?new RegExp('^'+pat.replace(/[.+^${}()|[\]\\]/g,'\\$&').replace(/\*/g,'.*').replace(/\?/g,'.')+'$',a.includes('-iname')?'i':''):null;const ty=a[a.indexOf('-type')+1];
  const all=[...(ty==='f'?[]:[...fsDirs(io.d)]).map(p=>({p,dir:true})),...(ty==='d'?[]:Object.keys(fsAll(io.d)).map(p=>({p})))].filter(x=>x.p===base||x.p.startsWith(base==='/'?'/':base+'/'));
  all.sort((x,y)=>x.p.localeCompare(y.p)).forEach(x=>{if(!re||re.test(x.p.split('/').pop()))io.raw(x.p)});return 0};
LX.tree=io=>{const base=io.path(flagsOf(io.argv).pos[0]||'.');let nd=0,nf=0;const walk=(p,pre)=>{const it=fsList(io.d,p);it.forEach((x,i)=>{const lastx=i===it.length-1;io.raw(pre+(lastx?'└── ':'├── ')+x.n);if(x.dir){nd++;walk(p.replace(/\/$/,'')+'/'+x.n,pre+(lastx?'    ':'│   '))}else nf++})};io.raw(flagsOf(io.argv).pos[0]||'.');walk(base,'');io.raw(`\n${nd} directories, ${nf} files`);return 0};
LX.stat=io=>{const p=io.path(io.argv[1]||'');const c=fsRead(io.d,p);if(c==null&&!fsIsDir(io.d,p)){io.err(`stat: cannot statx '${io.argv[1]}': No such file or directory`);return 1}io.out(`  File: ${io.argv[1]}\n  Size: ${c?c.length:4096}\t\tBlocks: 8          IO Block: 4096   ${c!=null?'regular file':'directory'}\nAccess: (0644/-rw-r--r--)  Uid: (    0/    root)   Gid: (    0/    root)`);return 0};
LX.file=io=>{const p=io.path(io.argv[1]||'');const c=fsRead(io.d,p);io.out(`${io.argv[1]}: ${fsIsDir(io.d,p)?'directory':c==null?'cannot open (No such file or directory)':/^#!/.test(c)?'Bourne-Again shell script, ASCII text executable':c.length?'ASCII text':'empty'}`);return 0};
LX.du=io=>{const p=io.path(flagsOf(io.argv).pos[0]||'.');let n=0;Object.entries(fsAll(io.d)).forEach(([k,v])=>{if(k.startsWith(p))n+=v.length});io.out(`${hsz(n+4096)}\t${flagsOf(io.argv).pos[0]||'.'}`);return 0};
LX.chmod=LX.chown=LX.chgrp=LX.sync=LX.alias=LX.unalias=LX.set=LX.ulimit=LX.umask=LX.wait=LX.trap=()=>0;
LX.which=io=>{let rc=0;io.argv.slice(1).filter(x=>!x.startsWith('-')).forEach(b=>{if((LX[b]&&hasBin(io.d,b))){io.out(`/usr/${/^(ip|ss|ufw|iptables|sshd|nginx|named|ifconfig|route|arp|haproxy|squid|vsftpd|smbd|dhcpd|reboot|netplan|firewall-cmd|wg-quick|ipsec|tcpdump|iperf3|httpd)$/.test(b)?'s':''}bin/${b}`)}else rc=1});return rc};
LX.type=io=>{io.argv.slice(1).forEach(b=>io.out(LX[b]&&hasBin(io.d,b)?`${b} is /usr/bin/${b}`:`bash: type: ${b}: not found`));return 0};LX.command=io=>{if(io.argv[1]==='-v'){io.argv=['which',...io.argv.slice(2)];return LX.which(io)}io.argv=io.argv.slice(1);return runCmd(io)};
LX.man=io=>{io.out(`${io.argv[1]||'man'}: manual não incluído na bancada. Tente "${io.argv[1]||'comando'} --help" ou digite help.`,'dim');return 0};
LX.history=io=>{(io.st.hist||[]).forEach((h,i)=>io.raw(`${String(i+1).padStart(5)}  ${h}`));return 0};
LX.env=LX.printenv=io=>{const e=io.st.env;const v={...e,PATH:'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',LANG:'C.UTF-8',TERM:'xterm-256color'};delete v['?'];if(io.argv[1]){io.out(v[io.argv[1]]??'');return 0}Object.entries(v).filter(([k])=>!/^\d+$/.test(k)).forEach(([k,x])=>io.raw(`${k}=${x}`));return 0};
LX.export=io=>{io.argv.slice(1).forEach(x=>{const m=x.match(/^(\w+)=(.*)$/);if(m)io.st.env[m[1]]=m[2]});return 0};LX.unset=io=>{io.argv.slice(1).forEach(x=>delete io.st.env[x]);return 0};
LX.source=io=>runScript(io,io.argv[1]||'',io.argv.slice(2));LX.bash=LX.sh=io=>{if(io.argv[1]==='-c'){const tmp={log:[],env:io.st.env,cwd:io.st.cwd};osExec(io.d,io.argv.slice(2).join(' '),tmp,io.ctx,null);tmp.log.forEach(x=>io.out(x.s,x.t==='err'?'err':x.t));return 0}if(io.argv[1])return runScript(io,io.argv[1],io.argv.slice(2));io.out('(já está no bash)','dim');return 0};
LX.sleep=()=>0;LX.date=io=>{const n=new Date();io.out(io.argv[1]==='+%s'?String(Math.floor(n/1000)):n.toUTCString().replace('GMT','UTC'));return 0};
LX.whoami=io=>{io.out('root');return 0};LX.id=io=>{io.out('uid=0(root) gid=0(root) groups=0(root)');return 0};LX.su=()=>0;
LX.uname=io=>{const{f}=flagsOf(io.argv);const o=io.o;io.out(f.a?`Linux ${io.d.name} ${o.kernel} #1 SMP PREEMPT_DYNAMIC x86_64 x86_64 x86_64 GNU/Linux`:f.r?o.kernel:f.n?io.d.name:f.m?'x86_64':'Linux');return 0};
LX.hostname=io=>{const a=io.argv.slice(1);if(a[0]==='-I'||a[0]==='-i'){io.out(l3ifs(io.d).filter(f=>!f.mgmt).map(f=>i2ip(f.c.ip)).join(' '));return 0}if(a[0]&&!a[0].startsWith('-'))return legacy(io,'hostname '+a[0]);io.out(io.d.name);return 0};
LX.hostnamectl=io=>{const a=io.argv;if(a[1]==='set-hostname'&&a[2])return legacy(io,'hostname '+a[2]);const o=io.o;io.out(` Static hostname: ${io.d.name}\n       Icon name: computer-server\n         Chassis: server\n  Virtualization: kvm\nOperating System: ${o.name}\n          Kernel: Linux ${o.kernel}\n    Architecture: x86-64\n  Hardware Model: ${(modelOf(io.d)||{}).name||'Virtual Machine'}`);return 0};
LX.lsb_release=io=>{const o=io.o;io.out(`No LSB modules are available.\nDistributor ID:\t${o.name.split(' ')[0]}\nDescription:\t${o.name}\nRelease:\t${o.ver}\nCodename:\t${o.code||'n/a'}`);return 0};
const memOf=d=>{const m=modelOf(d);const g=(m&&m.ram)||(d.type==='pc'?16:64);return g};
LX.free=io=>{const g=memOf(io.d),t=g*1024,u=Math.round(t*(0.12+(hsh(io.d.id)%20)/100)),h=flagsOf(io.argv).f.h;const fm=x=>h?(x>=1024?(x/1024).toFixed(1)+'Gi':x+'Mi'):String(x*1024);
  io.out(`               total        used        free      shared  buff/cache   available\nMem:     ${fm(t).padStart(11)} ${fm(u).padStart(11)} ${fm(t-u-512).padStart(11)} ${fm(12).padStart(11)} ${fm(512).padStart(11)} ${fm(t-u).padStart(11)}\nSwap:    ${fm(2048).padStart(11)} ${fm(0).padStart(11)} ${fm(2048).padStart(11)}`);return 0};
LX.df=io=>{io.out('Filesystem      Size  Used Avail Use% Mounted on\n/dev/sda1        98G  6.2G   87G   7% /\ntmpfs           3.2G  1.1M  3.2G   1% /run\n/dev/sda15      105M  6.1M   99M   6% /boot/efi');return 0};
LX.lsblk=io=>{io.out('NAME    MAJ:MIN RM  SIZE RO TYPE MOUNTPOINTS\nsda       8:0    0  100G  0 disk\n├─sda1    8:1    0 99.9G  0 part /\n└─sda15   8:15   0  105M  0 part /boot/efi');return 0};
LX.nproc=io=>{io.out(String((modelOf(io.d)||{}).cpu||8));return 0};LX.lscpu=io=>{io.out(`Architecture:            x86_64\nCPU(s):                  ${(modelOf(io.d)||{}).cpu||8}\nModel name:              Intel(R) Xeon(R) Gold 6338 CPU @ 2.00GHz\nVirtualization:          VT-x`);return 0};
LX.uptime=io=>{io.out(` 12:00:01 up 3 days,  4:12,  1 user,  load average: 0.08, 0.03, 0.01`);return 0};
function procs(d){const P=[['1','/sbin/init'],['412','/lib/systemd/systemd-journald'],['618','/lib/systemd/systemd-networkd']];let pid=700;
  Object.entries(d.svcs||{}).forEach(([n,s])=>{if(s.active)P.push([String(pid+=hsh(n)%97+3),n==='nginx'?'nginx: master process /usr/sbin/nginx':n==='ssh'||n==='sshd'?'sshd: /usr/sbin/sshd -D':n==='docker'?'/usr/bin/dockerd -H fd://':'/usr/sbin/'+n])});
  (d.listen||[]).forEach(l=>P.push([String(pid+=11),l.cmd||l.svc]));(d.dockers||[]).filter(c=>c.state==='running').forEach(c=>P.push([String(pid+=13),`/usr/bin/containerd-shim-runc-v2 -id ${c.id}`]));P.push([String(pid+=5),'-bash']);return P}
LX.ps=io=>{const P=procs(io.d);io.out('USER         PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND');P.forEach(([p,c])=>io.raw(`root     ${p.padStart(7)}  0.0  0.${hsh(c)%9} ${String(10000+hsh(c)%90000).padStart(6)} ${String(4000+hsh(c+'r')%9000).padStart(5)} ?        Ss   09:00   0:00 ${c}`));return 0};
LX.top=LX.htop=io=>{const P=procs(io.d);io.out(`top - 12:00:01 up 3 days,  1 user,  load average: 0.08, 0.03, 0.01\nTasks: ${P.length} total,   1 running, ${P.length-1} sleeping\n%Cpu(s):  1.2 us,  0.4 sy, 98.3 id\nMiB Mem : ${memOf(io.d)*1024}.0 total\n\n    PID USER      PR  NI    VIRT    RES  %CPU  %MEM     TIME+ COMMAND`);P.forEach(([p,c])=>io.raw(`${p.padStart(7)} root      20   0  ${String(10000+hsh(c)%90000).padStart(6)}   ${String(4000+hsh(c+'r')%9000).padStart(5)}   0.0   0.1   0:00.12 ${c.split(' ')[0].split('/').pop()}`));io.out('(instantâneo — top interativo não é simulado)','dim');return 0};
LX.kill=LX.pkill=LX.killall=io=>{const a=io.argv.slice(1).filter(x=>!x.startsWith('-'));let n=0;a.forEach(x=>{const b=(io.d.listen||[]).length;io.d.listen=(io.d.listen||[]).filter(l=>!(String(l.cmd||'').includes(x)||String(l.pid)===x));n+=b-io.d.listen.length;
  Object.entries(io.d.svcs||{}).forEach(([k,s])=>{if(k===x&&s.active){s.active=false;n++}})});io.changed();if(!n&&io.argv[0]!=='kill'){return 1}return 0};
LX.reboot=LX.shutdown=LX.poweroff=io=>{Object.values(io.d.svcs||{}).forEach(s=>s.active=!!s.enabled);io.d.listen=[];(io.d.dockers||[]).forEach(c=>{if(c.restart!=='always'&&c.restart!=='unless-stopped')c.state='exited'});io.changed();
  io.out(`Broadcast message from root@${io.d.name}: The system will ${io.argv[0]==='reboot'||/-r/.test(io.argv.join(' '))?'reboot':'power off'} now!`,'dim');io.out('… o equipamento reiniciou: serviços com "enable" voltaram, os iniciados só com "start" ficaram parados.','dim');return 0};
LX.timedatectl=io=>{io.out(`               Local time: ${new Date().toUTCString()}\n           Universal time: ${new Date().toUTCString()}\n                Time zone: Etc/UTC (UTC, +0000)\nSystem clock synchronized: ${svcOn(io.d,'chrony')||svcOn(io.d,'chronyd')?'yes':'no'}\n              NTP service: ${svcOn(io.d,'chrony')||svcOn(io.d,'chronyd')?'active':'inactive'}`);return 0};
LX.dmesg=io=>{io.out(`[    0.000000] Linux version ${io.o.kernel}\n[    1.204411] e1000e: Intel(R) PRO/1000 Network Driver\n`+io.d.ports.map((p,k)=>isMgmt(io.d,k)?null:`[    3.${String(100000+k*7311).slice(1)}] ${spn(io.d,k)}: NIC Link is ${linkAt(io.d.id,k)&&!p.shut?'Up 10000 Mbps Full Duplex':'Down'}`).filter(Boolean).join('\n'));return 0};
LX.nano=LX.vi=LX.vim=LX.edit=io=>{const fn=io.argv.slice(1).find(x=>!x.startsWith('-')&&!x.startsWith('+'));if(!fn){io.err(`${io.argv[0]}: informe o arquivo (ex.: ${io.argv[0]} /etc/hosts)`);return 1}const p=io.path(fn);if(fsIsDir(io.d,p)){io.err(`${fn} é um diretório`);return 1}
  if(io.ctx.sub){io.err('editor não disponível em script');return 1}io.res.edit={dev:io.d.id,path:p,content:fsRead(io.d,p)??''};io.out(`(abrindo ${p} no editor da bancada — salve para gravar no equipamento)`,'dim');return 0};
LX.base64=io=>{const s=io.stdin??'';io.out(io.argv[1]==='-d'?(typeof atob!=='undefined'?atob(s.trim()):Buffer.from(s.trim(),'base64').toString()):(typeof btoa!=='undefined'?btoa(s):Buffer.from(s).toString('base64')));return 0};
LX.xargs=io=>{const a=io.argv.slice(1);const items=String(io.stdin||'').split(/\s+/).filter(Boolean);io.argv=[...(a.length?a:['echo']),...items];return runCmd(io)};
LX.yes=io=>{io.out('y\ny\ny');return 0};LX.seq=io=>{const a=io.argv.slice(1).map(Number);const[s,e]=a.length>1?a:[1,a[0]];for(let i=s;i<=e&&i-s<1000;i++)io.raw(String(i));return 0};
LX.python3=io=>{const a=io.argv.slice(1);if(a[0]==='-m'&&a[1]==='http.server'){const port=+a[2]||8000;(io.d.listen=io.d.listen||[]).push({proto:'tcp',port,svc:'python3',web:'pyhttp',cmd:`python3 -m http.server ${port}`,dir:io.st.cwd||'/root'});io.changed();io.out(`Serving HTTP on 0.0.0.0 port ${port} (http://0.0.0.0:${port}/) ... (rodando em segundo plano — pare com: pkill python3)`);return 0}
  if(a[0]==='--version'||a[0]==='-V'){io.out('Python 3.12.3');return 0}if(a[0]==='-c'){const m=(a[1]||'').match(/print\((["'])(.*)\1\)/);io.out(m?m[2]:'(a bancada só entende python3 -c "print(...)")');return 0}io.out('Python 3.12.3 — o interpretador interativo não é simulado. Use: python3 -m http.server 8000','dim');return 0};
LX.git=io=>{io.out(io.argv[1]==='--version'?'git version 2.43.0':'git: os repositórios remotos não são simulados (sem acesso real ao GitHub a partir do shell)','dim');return 0};
LX.jq=io=>{try{const j=JSON.parse(io.stdin||'null');const pth=(io.argv[1]||'.').replace(/^\./,'').split('.').filter(Boolean);let v=j;pth.forEach(k=>{v=v==null?null:v[k.replace(/\[\]$/,'')]});io.out(JSON.stringify(v,null,2))}catch(e){io.err('jq: error: entrada não é JSON');return 2}return 0};

/* ---------- serviços (systemd / OpenRC) ---------- */
const SVC_ALIAS={sshd:{d:'ssh'},ssh:{r:'sshd',a:'sshd'},apache2:{r:'httpd'},httpd:{d:'apache2',a:'apache2'},strongswan:{d:'strongswan-starter'},'strongswan-starter':{r:'strongswan',a:'strongswan'},ipsec:{d:'strongswan-starter',r:'strongswan',a:'strongswan'},bind9:{d:'named',r:'named'},mysqld:{r:'mariadb'},chronyd:{d:'chrony'},chrony:{r:'chronyd'},smb:{d:'smbd'},dhcpd:{d:'isc-dhcp-server'},'docker.socket':{d:'docker',r:'docker',a:'docker'}};
function svcName(d,n){n=String(n||'').replace(/\.service$/,'');const o=osInfo(d);const a=SVC_ALIAS[n];if(a&&a[famKey(o)]&&!(d.svcs||{})[n])return a[famKey(o)];return n}
function svcKnown(d,n){if((d.svcs||{})[n])return true;const o=osInfo(d);return(d.pkgs||[]).some(p=>pkgSvc(o,pkgDef(o,p))===n)||(n==='containerd'&&(d.pkgs||[]).some(p=>/docker/.test(p)))||(n==='wg-quick@wg0'&&hasPkg(d,'wireguard-tools'))}
const SYS_UNITS=['networking','systemd-networkd','NetworkManager','systemd-resolved','cron','crond','rsyslog','systemd-journald','dbus'];
function svcSet(io,n,on){const d=io.d;const s=osSvcs(d)[n]||(d.svcs[n]={active:false,enabled:false});
  if(on&&n==='nginx'&&/listen\s+(\d+)/.test(fsRead(d,'/etc/nginx/sites-enabled/default')||'')){const p=+RegExp.$1;if(p!==80){s.port=p}else delete s.port}
  if(/strongswan|^ipsec$/.test(n)&&on){const r=ipsecLoad(io,true);if(r)return r}
  if(n==='wg-quick@wg0'){if(on){const r=wgUp(io,'wg0',true);if(r)return r}else wgDown(io,'wg0')}
  if(n==='firewalld'){const fw=hostFwW(d);fw.on=on;if(on)fw.allow=(fw.perm||fw.allow).slice()}
  if(n==='docker'&&!on)(d.dockers||[]).forEach(c=>c.state='exited');
  s.active=on;return 0}
const hostFwW=d=>{if(!d.hfw)d.hfw=JSON.parse(JSON.stringify(osDefaults(d.os,d.type).hfw));if(!d.hfw.perm)d.hfw.perm=(d.hfw.allow||[]).map(x=>x.slice());return d.hfw};
LX.systemctl=io=>{const a=io.argv.slice(1).filter(x=>!/^--(no-pager|quiet|now|full|plain|all|no-legend)$|^-[aq]$/.test(x)||x==='--now');const now=a.includes('--now');const args=a.filter(x=>x!=='--now');const op=args[0]||'list-units';const units=args.slice(1).map(u=>svcName(io.d,u));const d=io.d;
  if(io.o.fam==='apk'){io.err('systemctl: command not found');io.out('Alpine usa OpenRC: rc-service <svc> start|stop|restart|status · rc-update add <svc>','dim');return 127}
  if(op==='list-units'||op==='list-unit-files'||op==='--type=service'){io.out(op==='list-unit-files'?'UNIT FILE                             STATE':'  UNIT                                  LOAD   ACTIVE SUB     DESCRIPTION');
    const all=[...new Set([...Object.keys(d.svcs||{}),...SYS_UNITS.filter(u=>io.o.fam==='rpm'?!/^(networking|systemd-networkd|cron)$/.test(u):!/^(NetworkManager|crond)$/.test(u))])].sort();
    all.forEach(n=>{const s=(d.svcs||{})[n]||{active:true,enabled:true};io.raw(op==='list-unit-files'?`${(n+'.service').padEnd(38)}${s.enabled?'enabled':'disabled'}`:`  ${(n+'.service').padEnd(38)}loaded ${s.active?'active ':'inactive'} ${s.active?'running':'dead   '} ${(SVCDEF[n]||{}).desc||n}`)});return 0}
  if(op==='daemon-reload'||op==='reset-failed')return 0;
  if(!units.length){io.err(`Too few arguments.`);return 1}let rc=0;
  for(const n of units){const sys=SYS_UNITS.includes(n);
    if(!sys&&!svcKnown(d,n)){io.err(`${op==='status'?'Unit':'Failed to '+op+' '+n+'.service: Unit'} ${n}.service ${op==='status'?'could not be found.':'not found.'}`);const p=Object.entries(PKGS).find(([k,v])=>pkgDef(io.o,k)&&pkgSvc(io.o,v)===n);if(p)io.out(`(instale antes: ${io.o.pm} install ${p[0]})`,'dim');rc=op==='status'?4:5;continue}
    const s=(d.svcs||{})[n]||(sys?{active:true,enabled:true}:{active:false,enabled:false});
    if(op==='status'){const port=(SVCDEF[n]||{}).ports;io.out(`${s.active?'●':'○'} ${n}.service - ${(SVCDEF[n]||{}).desc||n}\n     Loaded: loaded (/usr/lib/systemd/system/${n}.service; ${s.enabled?'enabled':'disabled'}; preset: enabled)\n     Active: ${s.active?'active (running) since Thu 2026-10-15 09:00:00 UTC; 3h ago':'inactive (dead)'}${s.active?`\n   Main PID: ${1000+hsh(n)%8000} (${n.split('@')[0]})\n      Tasks: ${2+hsh(n)%6}\n     Memory: ${4+hsh(n)%60}.2M`:''}${s.active&&port&&port.length?`\n     (escutando em ${port.map(([p,n2])=>n2+'/'+p).join(', ')})`:''}`);if(!s.active)rc=3;continue}
    if(op==='is-active'){io.out(s.active?'active':'inactive');if(!s.active)rc=3;continue}
    if(op==='is-enabled'){io.out(s.enabled?'enabled':'disabled');if(!s.enabled)rc=1;continue}
    if(sys){if(/restart|reload/.test(op)&&n==='networking')rc=netApplyIfaces(io)||0;else if(/restart|reload/.test(op)&&n==='systemd-networkd')rc=netplanApply(io)||0;continue}
    if(op==='start'||op==='restart'||op==='reload'||op==='try-restart'){const r=svcSet(io,n,true);if(r){rc=r;continue}if(svcOn(d,'firewalld')||true){}}
    else if(op==='stop'){svcSet(io,n,false)}
    else if(op==='enable'){const x=osSvcs(d)[n]||(d.svcs[n]={active:false,enabled:false});if(!x.enabled)io.out(`Created symlink /etc/systemd/system/multi-user.target.wants/${n}.service → /usr/lib/systemd/system/${n}.service.`,'dim');x.enabled=true;if(now)svcSet(io,n,true)}
    else if(op==='disable'){const x=osSvcs(d)[n]||(d.svcs[n]={active:false,enabled:false});if(x.enabled)io.out(`Removed "/etc/systemd/system/multi-user.target.wants/${n}.service".`,'dim');x.enabled=false;if(now)svcSet(io,n,false)}
    else if(op==='mask'||op==='unmask'){}
    else{io.err(`Unknown command verb '${op}'.`);return 1}}
  io.changed();return rc};
LX.service=io=>{const[n,op]=io.argv.slice(1);if(!n||!op){io.err('Usage: service < option > | --status-all | [ service_name [ command | --full-restart ] ]');return 1}io.argv=['systemctl',op==='--full-restart'?'restart':op,n];return LX.systemctl(io)};
LX['rc-service']=io=>{const[n0,op]=io.argv.slice(1);const n=svcName(io.d,n0);if(!svcKnown(io.d,n)&&n!=='networking'){io.err(` * rc-service: service \`${n0}' does not exist`);return 1}
  if(n==='networking'){if(/restart|start/.test(op))return netApplyIfaces(io)||0;return 0}const s=osSvcs(io.d)[n]||(io.d.svcs[n]={active:false,enabled:false});
  if(op==='status'){io.out(` * status: ${s.active?'started':'stopped'}`);return s.active?0:3}if(op==='start'||op==='restart'){const r=svcSet(io,n,true);if(r)return r;io.out(` * Starting ${n} ...\n [ ok ]`)}else if(op==='stop'){svcSet(io,n,false);io.out(` * Stopping ${n} ...\n [ ok ]`)}io.changed();return 0};
LX['rc-update']=io=>{const[op,n0]=io.argv.slice(1);const n=svcName(io.d,n0);if(!n0){Object.entries(io.d.svcs||{}).forEach(([k,s])=>io.raw(`${k.padStart(20)} | ${s.enabled?'default':''}`));return 0}const s=osSvcs(io.d)[n]||(io.d.svcs[n]={active:false,enabled:false});s.enabled=op==='add';io.out(` * service ${n} ${op==='add'?'added to':'removed from'} runlevel default`);io.changed();return 0};
LX['rc-status']=io=>{io.out('Runlevel: default');Object.entries(io.d.svcs||{}).forEach(([k,s])=>io.raw(` ${k.padEnd(40)}[  ${s.active?'started':'stopped'}  ]`));return 0};
LX.journalctl=io=>{const ui=io.argv.indexOf('-u');const n=ui>0?svcName(io.d,io.argv[ui+1]):null;const s=n&&(io.d.svcs||{})[n];
  if(n&&!s){io.out('-- No entries --');return 0}const L=[];const ts='Oct 15 09:00:0';if(!n){L.push(`${ts}1 ${io.d.name} kernel: Linux version ${io.o.kernel}`,`${ts}2 ${io.d.name} systemd[1]: Started systemd-journald.service.`);Object.keys(io.d.svcs||{}).forEach((k,i)=>L.push(`${ts}${3+i%6} ${io.d.name} systemd[1]: ${io.d.svcs[k].active?'Started':'Stopped'} ${k}.service - ${(SVCDEF[k]||{}).desc||k}.`))}
  else{L.push(`${ts}1 ${io.d.name} systemd[1]: Starting ${n}.service - ${(SVCDEF[n]||{}).desc||n}...`);if(/strongswan|ipsec/.test(n)){vpnStates();(VPNS[io.d.id]||[]).forEach(v=>L.push(`${ts}3 ${io.d.name} charon[${1200}]: ${v.state==='UP'?`IKE_SA ${v.t.name}[1] established between ${l3ifs(io.d)[0]?i2ip(l3ifs(io.d)[0].c.ip):'?'}...${v.t.peer}`:`${v.t.name}: ${v.why}`}`))}
    L.push(`${ts}2 ${io.d.name} systemd[1]: ${s.active?'Started':'Stopped'} ${n}.service.`)}L.forEach(x=>io.raw(x));return 0};

/* ---------- pacotes ---------- */
function repoReach(io){const d=io.d;if(!S.devices.some(x=>x.type==='cloud'))return{ok:true,note:'(lab sem nuvem/Internet: pacotes vêm do cache offline da bancada — adicione uma Nuvem para exigir acesso real)'};
  const host=REPOHOST[io.o.fam](io.o);const r=resolveName(d,host);if(r.err)return{ok:false,why:r.err,host};
  const ip=r.ext?'91.189.91.81':i2ip(r.ip);const q=simulate(d.id,ip,'tcp',80);if(io.ctx.onSim)io.ctx.onSim(q);if(!q.ok)return{ok:false,why:q.why,host,conn:true};return{ok:true}}
function pkgResolve(io,names){const o=io.o;const out=[],bad=[];names.forEach(n=>{const p=pkgDef(o,n);if(!p){bad.push(n);return}out.push(n);(p.deps||[]).forEach(x=>out.push(x))});return{all:[...new Set(out)],bad}}
function pkgInstall(io,names,yes){const d=io.d,o=io.o;const{all,bad}=pkgResolve(io,names);
  if(bad.length){if(o.pm==='apt'){io.out('Reading package lists... Done\nBuilding dependency tree... Done');io.err(`E: Unable to locate package ${bad[0]}`);const alt=Object.keys(PKGS).find(k=>PKGS[k].f&&!PKGS[k].f.includes('d')&&k===bad[0]);const sug=bad[0]==='httpd'?'apache2':bad[0]==='bind-utils'?'dnsutils':bad[0]==='nmap-ncat'?'netcat-openbsd':null;if(sug)io.out(`(no ${o.name.split(' ')[0]} o pacote se chama ${sug})`,'dim')}
    else if(o.pm==='apk')io.err(`ERROR: unable to select packages:\n  ${bad[0]} (no such package):\n    required by: world[${bad[0]}]`);
    else{io.out(`Last metadata expiration check: 0:12:01 ago.`);io.err(`No match for argument: ${bad[0]}\nError: Unable to find a match: ${bad.join(' ')}`);const sug=bad[0]==='apache2'?'httpd':bad[0]==='dnsutils'?'bind-utils':bad[0]==='netcat-openbsd'?'nmap-ncat':bad[0]==='ufw'?'firewalld (firewall-cmd)':null;if(sug)io.out(`(no ${o.name.split(' ')[0]} o pacote se chama ${sug})`,'dim')}return 100}
  if(o.pm==='apt'&&!d.aptUpd&&S.devices.some(x=>x.type==='cloud')){io.out('Reading package lists... Done\nBuilding dependency tree... Done');io.err(`E: Unable to locate package ${all[0]}`);io.out('(a lista de pacotes está vazia: rode "apt update" antes — como numa imagem docker do Ubuntu)','dim');return 100}
  const net=repoReach(io);const host=net.host;
  if(!net.ok){if(o.pm==='apt'){io.err(`E: Failed to fetch http://${host}/pool/main/${all[0][0]}/${all[0]}/${all[0]}_${PKGVER(all[0])}_amd64.deb  ${net.conn?'Could not connect to '+host+':80, connection timed out':"Temporary failure resolving '"+host+"'"}\nE: Unable to fetch some archives, maybe run apt-get update or try with --fix-missing?`)}
    else if(o.pm==='apk')io.err(`WARNING: fetching https://${host}/alpine: ${net.conn?'network error':'DNS lookup error'}\nERROR: unable to select packages`);
    else io.err(`Errors during downloading metadata for repository 'baseos':\n  - Curl error (${net.conn?'28): Timeout was reached':'6): Couldn\'t resolve host name'}) for https://${host}/\nError: Failed to download metadata for repo 'baseos'`);
    io.out('motivo: '+net.why,'err');return 100}
  const nw=all.filter(n=>!hasPkg(d,n));if(!nw.length){io.out(o.pm==='apt'?`${all[0]} is already the newest version (${PKGVER(all[0])}).\n0 upgraded, 0 newly installed, 0 to remove and 0 not upgraded.`:o.pm==='apk'?'OK: 0 MiB in 0 packages':`Package ${all[0]}-${PKGVER(all[0])} is already installed.\nDependencies resolved.\nNothing to do.\nComplete!`);return 0}
  if(o.pm==='apt'){io.out(`Reading package lists... Done\nBuilding dependency tree... Done\nReading state information... Done\nThe following NEW packages will be installed:\n  ${nw.join(' ')}\n0 upgraded, ${nw.length} newly installed, 0 to remove and 0 not upgraded.\nNeed to get ${(nw.length*1.3).toFixed(1)} MB of archives.`);if(!yes)io.out('Do you want to continue? [Y/n] Y','dim');nw.forEach((n,i)=>io.out(`Get:${i+1} http://${REPOHOST.deb(o)}/ubuntu ${o.code||'stable'}/main amd64 ${n} amd64 ${PKGVER(n)} [${300+hsh(n)%900} kB]`));nw.forEach(n=>io.out(`Setting up ${n} (${PKGVER(n)}) ...`))}
  else if(o.pm==='apk'){nw.forEach((n,i)=>io.out(`(${i+1}/${nw.length}) Installing ${n} (${PKGVER(n)}-r0)`));io.out(`OK: ${20+nw.length*3} MiB in ${40+nw.length} packages`)}
  else{io.out(`Last metadata expiration check: 0:00:12 ago.\nDependencies resolved.\n${'='.repeat(60)}\n Package          Arch      Version          Repository\n${'='.repeat(60)}\nInstalling:\n${nw.map(n=>` ${n.padEnd(17)}x86_64    ${(PKGVER(n)+'-1').padEnd(17)}appstream`).join('\n')}\n\nTransaction Summary\n${'='.repeat(60)}\nInstall  ${nw.length} Packages\n`);if(!yes)io.out('Is this ok [y/N]: y','dim');nw.forEach((n,i)=>io.out(`  Installing       : ${n}-${PKGVER(n)}-1.x86_64   ${i+1}/${nw.length}`));io.out('\nComplete!')}
  if(net.note)io.out(net.note,'dim');
  const started=[];nw.forEach(n=>{d.pkgs=d.pkgs||[];d.pkgs.push(n);const p=pkgDef(o,n);const sv=pkgSvc(o,p);if(sv){const auto=o.fam==='deb';const s=osSvcs(d)[sv]||(d.svcs[sv]={active:false,enabled:false});if(auto){s.active=true;s.enabled=true;started.push(sv)}if(sv==='firewalld'){s.active=true;s.enabled=true}}
    if(/docker/.test(n)&&o.fam==='deb')osSvcs(d).containerd={active:true,enabled:true}});
  if(started.length)io.out(`Created symlink /etc/systemd/system/multi-user.target.wants/${started[0]}.service → /usr/lib/systemd/system/${started[0]}.service.`,'dim');
  const svcs=nw.map(n=>pkgSvc(o,pkgDef(o,n))).filter(Boolean);if(svcs.length&&o.fam!=='deb')io.out(`(no ${o.name.split(' ')[0]} o serviço não sobe sozinho: ${o.fam==='apk'?`rc-service ${svcs[0]} start && rc-update add ${svcs[0]}`:`systemctl enable --now ${svcs[0]}`}${o.fw==='firewalld'&&svcs.some(s=>(SVCDEF[s]||{}).ports&&SVCDEF[s].ports.length)?` — e libere no firewalld: firewall-cmd --add-service=${svcs[0]==='nginx'||svcs[0]==='httpd'?'http':svcs[0]} --permanent && firewall-cmd --reload`:''})`,'dim');
  io.changed();return 0}
function pkgRemove(io,names){const d=io.d,o=io.o;const rm=names.filter(n=>hasPkg(d,n));if(!rm.length){io.out(o.pm==='apt'?`Package '${names[0]}' is not installed, so not removed`:`No match for argument: ${names[0]}\nNo packages marked for removal.`);return 0}
  rm.forEach(n=>{d.pkgs=d.pkgs.filter(x=>x!==n);const sv=pkgSvc(o,pkgDef(o,n));if(sv&&!d.pkgs.some(x=>pkgSvc(o,pkgDef(o,x))===sv)){if(d.svcs)delete d.svcs[sv]}});
  io.out(o.pm==='apt'?`The following packages will be REMOVED:\n  ${rm.join(' ')}\n0 upgraded, 0 newly installed, ${rm.length} to remove and 0 not upgraded.\n${rm.map(n=>`Removing ${n} (${PKGVER(n)}) ...`).join('\n')}`:o.pm==='apk'?rm.map((n,i)=>`(${i+1}/${rm.length}) Purging ${n} (${PKGVER(n)}-r0)`).join('\n')+'\nOK':`Removing:\n${rm.map(n=>' '+n).join('\n')}\n\nComplete!`);io.changed();return 0}
LX.apt=io=>{const{f,pos}=flagsOf(io.argv);const op=pos[0];const names=pos.slice(1);const o=io.o;if(o.pm!=='apt'){io.err(`bash: ${io.argv[0]}: command not found`);io.out(`(este é ${o.name}: use ${o.pm})`,'dim');return 127}
  if(io.aptCache&&op!=='search'&&op!=='policy'&&op!=='show'){io.err('E: comando apt-cache não simulado');return 1}
  if(op==='update'){const net=repoReach(io);const host=net.host||REPOHOST.deb(o);if(!net.ok){io.out(`Ign:1 http://${host}/ubuntu ${o.code} InRelease`);io.err(`Err:1 http://${host}/ubuntu ${o.code} InRelease\n  ${net.conn?`Could not connect to ${host}:80 — connection timed out`:`Temporary failure resolving '${host}'`}\nW: Failed to fetch http://${host}/ubuntu/dists/${o.code}/InRelease\nW: Some index files failed to download. They have been ignored, or old ones used instead.`);io.out('motivo: '+net.why,'err');return 100}
    io.out(`Get:1 http://${host}/ubuntu ${o.code} InRelease [256 kB]\nGet:2 http://${host}/ubuntu ${o.code}-updates InRelease [126 kB]\nGet:3 http://${host}/ubuntu ${o.code}/main amd64 Packages [1401 kB]\nFetched 19.4 MB in 3s (6512 kB/s)\nReading package lists... Done\nBuilding dependency tree... Done\nAll packages are up to date.`);if(net.note)io.out(net.note,'dim');io.d.aptUpd=true;io.changed();return 0}
  if(op==='upgrade'||op==='full-upgrade'||op==='dist-upgrade'){io.out('Reading package lists... Done\nCalculating upgrade... Done\n0 upgraded, 0 newly installed, 0 to remove and 0 not upgraded.');return 0}
  if(op==='install'){if(!names.length){io.out('0 upgraded, 0 newly installed, 0 to remove and 0 not upgraded.');return 0}return pkgInstall(io,names,f.y||f.yes||f['assume-yes'])}
  if(op==='remove'||op==='purge'||op==='autoremove')return names.length?pkgRemove(io,names):(io.out('0 upgraded, 0 newly installed, 0 to remove and 0 not upgraded.'),0);
  if(op==='list'){(f.installed?(io.d.pkgs||[]):Object.keys(PKGS).filter(k=>pkgDef(o,k))).sort().forEach(n=>io.raw(`${n}/${o.code},now ${PKGVER(n)} amd64${hasPkg(io.d,n)?' [installed]':''}`));return 0}
  if(op==='search'){const q=(names[0]||'').toLowerCase();io.out('Sorting... Done\nFull Text Search... Done');Object.entries(PKGS).filter(([k,v])=>pkgDef(o,k)&&(k.includes(q)||(v.d||'').toLowerCase().includes(q))).forEach(([k,v])=>io.raw(`${k}/${o.code} ${PKGVER(k)} amd64\n  ${v.d||''}\n`));return 0}
  if(op==='show'||op==='policy'){const n=names[0];const p=pkgDef(o,n);if(!p){io.err(`N: Unable to locate package ${n}`);return 100}io.out(op==='policy'?`${n}:\n  Installed: ${hasPkg(io.d,n)?PKGVER(n):'(none)'}\n  Candidate: ${PKGVER(n)}`:`Package: ${n}\nVersion: ${PKGVER(n)}\nPriority: optional\nSection: net\nDescription: ${p.d||n}`);return 0}
  io.out('apt 2.7.14 (amd64)\nUsage: apt [options] command\n\n  update · upgrade · install · remove · purge · list --installed · search · show','dim');return 1};
LX.dpkg=io=>{const a=io.argv;if(a[1]==='-l'){io.out('Desired=Unknown/Install/Remove/Purge/Hold\n||/ Name                 Version       Architecture Description\n+++-====================-=============-============-=================================');(io.d.pkgs||[]).filter(n=>!a[2]||n.includes(a[2].replace(/\*/g,''))).sort().forEach(n=>io.raw(`ii  ${n.padEnd(21)}${PKGVER(n).padEnd(14)}amd64        ${((PKGS[n]||{}).d||n).slice(0,45)}`));return 0}
  if(a[1]==='-s'||a[1]==='--status'){if(!hasPkg(io.d,a[2])){io.err(`dpkg-query: package '${a[2]}' is not installed and no information is available`);return 1}io.out(`Package: ${a[2]}\nStatus: install ok installed\nVersion: ${PKGVER(a[2])}`);return 0}
  if(a[1]==='-L'){io.out(`/usr/bin/${a[2]}\n/usr/share/doc/${a[2]}`);return 0}io.out('dpkg: use -l, -s <pacote>, -L <pacote>','dim');return 1};
LX.dnf=io=>{const{f,pos}=flagsOf(io.argv);const op=pos[0];const names=pos.slice(1);const o=io.o;if(o.pm==='rpm-ostree'){io.err('error: dnf não existe no RHCOS (imutável) — use rpm-ostree install <pacote> (requer reboot) ou rode a carga como pod');return 1}
  if(o.pm!=='dnf'){io.err(`bash: ${io.argv[0]}: command not found`);io.out(`(este é ${o.name}: use ${o.pm})`,'dim');return 127}
  if(op==='install'||op==='in'){return pkgInstall(io,names.filter(n=>!n.startsWith('@')),f.y||f.assumeyes)}
  if(op==='remove'||op==='erase'||op==='rm')return pkgRemove(io,names);
  if(op==='list'){io.out(f.installed||names[0]==='installed'?'Installed Packages':'Available Packages');(names[0]==='installed'||f.installed?(io.d.pkgs||[]):Object.keys(PKGS).filter(k=>pkgDef(o,k))).sort().forEach(n=>io.raw(`${(n+'.x86_64').padEnd(40)}${(PKGVER(n)+'-1').padEnd(18)}${hasPkg(io.d,n)?'@anaconda':'appstream'}`));return 0}
  if(op==='search'){const q=(names[0]||'').toLowerCase();Object.entries(PKGS).filter(([k,v])=>pkgDef(o,k)&&(k.includes(q)||(v.d||'').toLowerCase().includes(q))).forEach(([k,v])=>io.raw(`${k}.x86_64 : ${v.d||''}`));return 0}
  if(op==='info'){const p=pkgDef(o,names[0]);if(!p){io.err('Error: No matching Packages to list');return 1}io.out(`Name         : ${names[0]}\nVersion      : ${PKGVER(names[0])}\nArchitecture : x86_64\nSummary      : ${p.d||''}`);return 0}
  if(op==='makecache'||op==='update'||op==='upgrade'||op==='check-update'){const net=repoReach(io);if(!net.ok){io.err(`Curl error: ${net.why}\nError: Failed to download metadata for repo 'baseos'`);return 1}io.out(op==='makecache'?'Metadata cache created.':'Last metadata expiration check: 0:00:03 ago.\nDependencies resolved.\nNothing to do.\nComplete!');return 0}
  if(op==='repolist'){io.out(`repo id                 repo name\nappstream               ${o.name} - AppStream\nbaseos                  ${o.name} - BaseOS`);return 0}
  io.out('dnf: install · remove · list installed · search · info · repolist · makecache','dim');return 1};
LX.rpm=io=>{const a=io.argv;if(a[1]==='-qa'){(io.d.pkgs||[]).forEach(n=>io.raw(`${n}-${PKGVER(n)}-1.x86_64`));return 0}if(a[1]==='-q'){if(!hasPkg(io.d,a[2])){io.out(`package ${a[2]} is not installed`);return 1}io.out(`${a[2]}-${PKGVER(a[2])}-1.x86_64`);return 0}io.out('rpm: -qa | -q <pacote>','dim');return 1};
LX['rpm-ostree']=io=>{io.out('State: idle\nDeployments:\n● ostree-unverified-registry:quay.io/openshift-release-dev/ocp-v4.0-art-dev\n   (RHCOS é imutável: alterações de SO são feitas pelo MachineConfig do cluster)');return 0};
LX.apk=io=>{const{pos}=flagsOf(io.argv);const op=pos[0];const names=pos.slice(1);const o=io.o;if(o.pm!=='apk'){io.err(`bash: apk: command not found`);return 127}
  if(op==='update'){const net=repoReach(io);if(!net.ok){io.err(`WARNING: fetching https://dl-cdn.alpinelinux.org/alpine/v3.20/main: ${net.conn?'network error':'DNS lookup error'}\nmotivo: ${net.why}`);return 1}io.out(`fetch https://dl-cdn.alpinelinux.org/alpine/v3.20/main/x86_64/APKINDEX.tar.gz\nv3.20.3 [https://dl-cdn.alpinelinux.org/alpine/v3.20/main]\nOK: 24164 distinct packages available`);return 0}
  if(op==='add')return pkgInstall(io,names,true);if(op==='del')return pkgRemove(io,names);
  if(op==='info'){(io.d.pkgs||[]).forEach(n=>io.raw(n));return 0}if(op==='search'){Object.keys(PKGS).filter(k=>pkgDef(o,k)&&k.includes(names[0]||'')).forEach(k=>io.raw(`${k}-${PKGVER(k)}-r0`));return 0}
  io.out('apk: update · add · del · info · search','dim');return 1};
LX.snap=io=>{io.err('error: snapd não está disponível nesta imagem (use apt)');return 1};

/* ---------- firewall local ---------- */
const FW_APPS={openssh:[['tcp',22]],ssh:[['tcp',22]],'nginx full':[['tcp',80],['tcp',443]],'nginx http':[['tcp',80]],'nginx https':[['tcp',443]],apache:[['tcp',80]],'apache full':[['tcp',80],['tcp',443]],'apache secure':[['tcp',443]],www:[['tcp',80]],'www full':[['tcp',80],['tcp',443]],
  http:[['tcp',80]],https:[['tcp',443]],dns:[['udp',53],['tcp',53]],mysql:[['tcp',3306]],postgresql:[['tcp',5432]],cockpit:[['tcp',9090]],'dhcpv6-client':[['udp',546]],dhcp:[['udp',67]],ntp:[['udp',123]],ipsec:[['udp',500],['udp',4500]],wireguard:[['udp',51820]],'kube-apiserver':[['tcp',6443]],samba:[['tcp',445],['tcp',139]],ftp:[['tcp',21]],'redis':[['tcp',6379]],prometheus:[['tcp',9090]],grafana:[['tcp',3000]],nfs:[['tcp',2049]],squid:[['tcp',3128]]};
function fwSpec(s,src){s=String(s||'').toLowerCase();if(FW_APPS[s])return FW_APPS[s].map(x=>[...x,src||'']);const m=s.match(/^(\d+)(?::(\d+))?(?:\/(tcp|udp))?$/);if(!m)return null;const r=[];const a=+m[1],b=+(m[2]||m[1]);for(let p=a;p<=b&&p-a<200;p++)(m[3]?[m[3]]:['tcp','udp']).forEach(pr=>r.push([pr,p,src||'']));return r}
const fwHas=(L,x)=>L.some(y=>y[0]===x[0]&&String(y[1])===String(x[1])&&(y[2]||'')===(x[2]||''));
LX.ufw=io=>{const d=io.d;const fw=hostFwW(d);const a=io.argv.slice(1);const op=(a[0]||'').toLowerCase();
  const show=v=>{if(!fw.on){io.out('Status: inactive');return 0}io.out(`Status: active${v?'\nLogging: on (low)\nDefault: deny (incoming), allow (outgoing), disabled (routed)\nNew profiles: skip':''}\n\nTo                         Action      From\n--                         ------      ----`);const seen=new Set();(fw.allow||[]).forEach((x,i)=>{const k=x[1]+'/'+x[0]+(x[2]||'');if(seen.has(k))return;seen.add(k);io.raw(`${op==='status'&&a[1]==='numbered'?`[${String(i+1).padStart(2)}] `:''}${(x[1]==='any'?'Anywhere':x[1]+'/'+x[0]).padEnd(27)}ALLOW IN    ${x[2]||'Anywhere'}`)});return 0};
  if(!op||op==='status')return show(a[1]==='verbose');
  if(op==='enable'){if(!fw.on&&!(fw.allow||[]).some(x=>+x[1]===22))io.out('Command may disrupt existing ssh connections. Proceed with operation (y|n)? y','dim');fw.on=true;io.out('Firewall is active and enabled on system startup');io.changed();return 0}
  if(op==='disable'){fw.on=false;io.out('Firewall stopped and disabled on system startup');io.changed();return 0}
  if(op==='reset'){fw.on=false;fw.allow=[];io.out('Resetting all rules to installed defaults. Proceed with operation (y|n)? y\nBacking up \'user.rules\'');io.changed();return 0}
  if(op==='reload'){io.out(fw.on?'Firewall reloaded':'Firewall not enabled (skipping reload)');return 0}
  if(op==='app'&&a[1]==='list'){io.out('Available applications:\n  OpenSSH'+(hasPkg(d,'nginx')?'\n  Nginx Full\n  Nginx HTTP\n  Nginx HTTPS':'')+(hasPkg(d,'apache2')?'\n  Apache\n  Apache Full\n  Apache Secure':''));return 0}
  if(op==='default'){if(a[1]==='allow'&&/incoming/.test(a[2]||''))fw.allow=[...(fw.allow||[]),['any','any','']];io.out(`Default incoming policy changed to '${a[1]}'`);io.changed();return 0}
  let del=false,i=0;if(op==='delete'){del=true;i=1;if(/^\d+$/.test(a[1])){const n=+a[1];if(!fw.allow[n-1]){io.err('ERROR: Could not find rule');return 1}fw.allow.splice(n-1,1);io.out('Rule deleted');io.changed();return 0}}
  const act=(a[i]||'').toLowerCase();if(!/^(allow|deny|reject|limit)$/.test(act)){io.err(`ERROR: Invalid syntax\n\nUsage: ufw COMMAND\n  enable · disable · status [verbose|numbered] · allow|deny <porta>[/proto] · allow from <rede> [to any port N] · delete allow <regra>`);return 1}
  let rest=a.slice(i+1);let src='';let spec=null;const pi=rest.indexOf('proto');const proto=pi>=0?rest[pi+1]:null;
  if(rest[0]==='in'){rest=rest.slice(1);if(rest[0]==='on')rest=rest.slice(2)}
  if(rest[0]==='from'){src=rest[1]==='any'?'':rest[1];const port=rest.indexOf('port');spec=port>=0?fwSpec(rest[port+1]+(proto?'/'+proto:''),src):[['any','any',src]]}else spec=fwSpec(rest.join(' '),'');
  if(!spec){io.err(`ERROR: Could not find a profile matching '${rest.join(' ')}'`);return 1}
  if(act==='allow'||act==='limit'){if(del)fw.allow=fw.allow.filter(x=>!fwHas(spec,x));else spec.forEach(x=>{if(!fwHas(fw.allow,x))fw.allow.push(x)});io.out(del?'Rule deleted':'Rule added')}else{fw.allow=fw.allow.filter(x=>!fwHas(spec,x)&&!(spec[0][0]==='tcp'&&x[1]===spec[0][1]&&!x[2]));io.out('Rule updated')}
  if(!fw.on&&!del)io.out('(lembrete: o ufw está inativo — "ufw enable" para valer)','dim');io.changed();return 0};
LX['firewall-cmd']=io=>{const d=io.d;const fw=hostFwW(d);const a=io.argv.slice(1);const perm=a.includes('--permanent');const running=svcOn(d,'firewalld');
  if(a.includes('--state')){io.out(running?'running':'not running');return running?0:252}
  if(!running){io.err('FirewallD is not running');return 252}
  const L=perm?fw.perm:fw.allow;let did=false;const svcs=()=>{const s=[];['ssh','dhcpv6-client','http','https','dns','cockpit','mysql','postgresql','ntp','ipsec','wireguard','samba','nfs','ftp','squid','kube-apiserver'].forEach(k=>{if(FW_APPS[k].every(x=>fwHas(L,[...x,''])))s.push(k)});return s};
  for(const x of a){let m;
    if(x==='--reload'){fw.allow=fw.perm.map(y=>y.slice());io.out('success');did=true;continue}
    if(x==='--list-all'||x==='--list-all-zones'){const ports=L.filter(y=>!svcs().some(s=>FW_APPS[s].some(z=>z[0]===y[0]&&z[1]===y[1]))&&y[1]!=='any').map(y=>y[1]+'/'+y[0]);
      io.out(`public (active)\n  target: default\n  icmp-block-inversion: no\n  interfaces: ${d.ports.map((p,k)=>isMgmt(d,k)?null:spn(d,k)).filter(Boolean).join(' ')}\n  sources: \n  services: ${svcs().join(' ')}\n  ports: ${ports.join(' ')}\n  protocols: \n  forward: yes\n  masquerade: no\n  forward-ports: \n  source-ports: \n  icmp-blocks: ${fw.icmp===false?'echo-request':''}\n  rich rules: ${L.filter(y=>y[2]).map(y=>`\n\trule family="ipv4" source address="${y[2]}" ${y[1]==='any'?'':`port port="${y[1]}" protocol="${y[0]}" `}accept`).join('')}`);did=true;continue}
    if(x==='--list-ports'){io.out(L.filter(y=>y[1]!=='any'&&!y[2]).map(y=>y[1]+'/'+y[0]).join(' '));did=true;continue}
    if(x==='--list-services'){io.out(svcs().join(' '));did=true;continue}
    if(x==='--get-default-zone'||x==='--get-active-zones'){io.out(x==='--get-default-zone'?'public':`public\n  interfaces: ${d.ports.map((p,k)=>isMgmt(d,k)?null:spn(d,k)).filter(Boolean).join(' ')}`);did=true;continue}
    if(x==='--runtime-to-permanent'){fw.perm=fw.allow.map(y=>y.slice());io.out('success');did=true;continue}
    if((m=x.match(/^--(add|remove)-(port|service)=(.+)$/))){const sp=m[2]==='port'?fwSpec(m[3]):FW_APPS[m[3].toLowerCase()]?FW_APPS[m[3].toLowerCase()].map(y=>[...y,'']):null;if(!sp){io.err(`Error: INVALID_${m[2].toUpperCase()}: ${m[3]}`);return 1}
      sp.forEach(y=>{if(m[1]==='add'){if(!fwHas(L,y))L.push(y)}else{const i=L.findIndex(z=>fwHas([y],z));if(i>=0)L.splice(i,1)}});io.out('success');did=true;
      if(perm&&!a.includes('--reload'))io.out('(--permanent grava só a configuração permanente: rode firewall-cmd --reload para aplicar agora)','dim');continue}
    if((m=x.match(/^--(add|remove)-icmp-block=(.+)$/))){fw.icmp=m[1]==='remove';io.out('success');did=true;continue}
    if((m=x.match(/^--(add|remove)-rich-rule=(.+)$/))){const r=m[2];const sa=(r.match(/source address="?([\d./]+)/)||[])[1]||'';const pp=r.match(/port port="?(\d+)"? protocol="?(tcp|udp)/);const y=pp?[pp[2],+pp[1],sa]:['any','any',sa];if(/\baccept\b/.test(r)){if(m[1]==='add'){if(!fwHas(L,y))L.push(y)}else{const i=L.findIndex(z=>fwHas([y],z));if(i>=0)L.splice(i,1)}}io.out('success');did=true;continue}
    if(/^--(add|remove)-masquerade$/.test(x)){io.out('success');io.out('(masquerade aceito — hosts não roteiam nesta bancada; use um roteador/firewall para NAT)','dim');did=true;continue}
    if(/^--(zone|permanent)/.test(x))continue;
    io.err(`firewall-cmd: error: unrecognized arguments: ${x}`);return 2}
  if(!did)io.out('Uso: firewall-cmd --state | --list-all | --add-port=80/tcp | --add-service=http [--permanent] | --reload','dim');io.changed();return 0};
LX.iptables=io=>{const d=io.d;const fw=hostFwW(d);const a=io.argv.slice(1);const g=(k)=>{const i=a.indexOf(k);return i>=0?a[i+1]:null};
  if(a.includes('-L')||a.includes('-S')||!a.length){if(a.includes('-S')){io.out(`-P INPUT ${fw.on?'DROP':'ACCEPT'}\n-P FORWARD ACCEPT\n-P OUTPUT ACCEPT\n-A INPUT -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT${fw.icmp?'\n-A INPUT -p icmp -j ACCEPT':''}`);(fw.allow||[]).forEach(x=>io.raw(`-A INPUT ${x[2]?'-s '+x[2]+' ':''}${x[0]!=='any'?`-p ${x[0]} -m ${x[0]} --dport ${x[1]} `:''}-j ACCEPT`));return 0}
    io.out(`Chain INPUT (policy ${fw.on?'DROP':'ACCEPT'})\ntarget     prot opt source               destination\nACCEPT     all  --  0.0.0.0/0            0.0.0.0/0            ctstate RELATED,ESTABLISHED`);if(fw.icmp)io.raw('ACCEPT     icmp --  0.0.0.0/0            0.0.0.0/0');(fw.allow||[]).forEach(x=>io.raw(`ACCEPT     ${(x[0]==='any'?'all':x[0]).padEnd(5)}--  ${(x[2]||'0.0.0.0/0').padEnd(21)}0.0.0.0/0            ${x[1]!=='any'?x[0]+' dpt:'+x[1]:''}`));io.out('\nChain FORWARD (policy ACCEPT)\n\nChain OUTPUT (policy ACCEPT)');return 0}
  if(a.includes('-t')&&g('-t')==='nat'){io.out('(NAT aceito — hosts não roteiam nesta bancada; faça NAT no roteador/firewall de borda)','dim');return 0}
  if(a.includes('-P')){const ch=g('-P'),pol=a[a.indexOf('-P')+2];if(ch==='INPUT'){fw.on=pol==='DROP'||pol==='REJECT';if(fw.on&&!(fw.allow||[]).length)io.out('(atenção: política DROP sem regras — tudo que chega foi bloqueado)','dim')}io.changed();return 0}
  if(a.includes('-F')){fw.allow=[];io.changed();return 0}
  const add=a.includes('-A')||a.includes('-I'),del=a.includes('-D');if((add||del)&&(g('-A')||g('-I')||g('-D'))==='INPUT'){const pr=g('-p')||'any',port=g('--dport'),src=g('-s')||'',j=g('-j');
    if(pr==='icmp'){fw.icmp=j==='ACCEPT'?!del:del;io.changed();return 0}const y=[pr==='all'?'any':pr,port?+port:'any',src];
    if(j==='ACCEPT'){if(add&&!fwHas(fw.allow,y))fw.allow.push(y);if(del)fw.allow=fw.allow.filter(z=>!fwHas([y],z))}else if(j==='DROP'||j==='REJECT'){fw.allow=fw.allow.filter(z=>!fwHas([y],z));if(!fw.on){io.out('(regra DROP específica: a bancada só filtra quando a política INPUT é DROP — iptables -P INPUT DROP)','dim')}}io.changed();return 0}
  if(g('-A')==='FORWARD'||g('-A')==='OUTPUT'){io.out('(aceito — a bancada filtra só INPUT nos hosts)','dim');return 0}
  io.err('iptables v1.8.10: a bancada entende -L, -S, -P INPUT DROP|ACCEPT, -A/-D INPUT [-s rede] [-p tcp|udp|icmp] [--dport N] -j ACCEPT|DROP, -F');return 2};
LX['iptables-save']=io=>{io.argv=['iptables','-S'];return LX.iptables(io)};
LX.nft=io=>{io.out('(nftables: use iptables, ufw ou firewall-cmd nesta bancada)','dim');return 0};

/* ---------- DNS ---------- */
function dnsQuery(d,name,nsOverride,depth){const ip=ip2i(name);if(ip!==null)return{ip};const n=String(name||'').toLowerCase().replace(/\.$/,'');if(!n)return{err:'nome vazio'};
  if(!nsOverride){if(n==='localhost')return{ip:ip2i('127.0.0.1'),local:true};if(n===d.name.toLowerCase()){const f=l3ifs(d).find(f=>!f.mgmt);return{ip:f?f.c.ip:ip2i('127.0.1.1'),local:true}}const hf=hostsFile(d);if(hf[n]!=null)return{ip:hf[n],local:true}}
  if(!nsOverride){const kc=clusterOf(d);if(kc&&kc!==d){const kk=k8sLocalName(kc,n);if(kk!=null)return{ip:kk,local:true,ns:'CoreDNS (cluster)'}}}
  let ns=nsOverride||nameserverOf(d);if(ns&&ip2i(ns)===null){if(/^localhost$/i.test(ns))ns='127.0.0.1';else{const r0=dnsQuery(d,ns,null,1);if(r0.ip==null)return{err:`servidor DNS ${ns} não resolvido`};ns=i2ip(r0.ip)}}
  if(!ns||ip2i(ns)===null)return{err:'Temporary failure in name resolution (nenhum servidor DNS configurado)',noNs:true};
  const nsi=ip2i(ns);if((nsi>>>24)===127||l3ifs(d).some(f=>ownsIp(f,nsi))){if(!(svcOn(d,'named')||svcOn(d,'DNS')||svcOn(d,'systemd-resolved')||(nsi>>>24)===127&&!nsOverride))return{err:`connection refused (nada escutando em ${ns}:53)`,ns,timeout:true,refused:true};
    const z=zoneLookup(d,n);if(z!=null)return{ip:z,ns,auth:true};if(svcOn(d,'named')||svcOn(d,'DNS')){const lab=labName(n);if(lab!=null)return{ip:lab,ns};const up=d.dns||(S.devices.some(x=>x.type==='cloud')?'8.8.8.8':'');if(up&&!(depth>0)){const r=dnsQuery(d,n,up,1);if(r.ip!=null||r.ext)return{...r,ns}}return{nx:true,ns,err:`Name or service not known (${n})`}}}
  const q=simulate(d.id,ns,'udp',53);if(!q.ok)return{err:`Temporary failure in name resolution — o DNS ${ns} não responde: ${q.why}`,ns,timeout:true,refused:q.refused};
  if(q.ext)return{ext:true,ns};const srv=dev(q.at);if(cloudKind(srv)==='real')return{ext:true,ns};
  if(srv&&isHost(srv.type)){const z=zoneLookup(srv,n);if(z!=null)return{ip:z,ns,auth:true}}
  const lab=labName(n);if(lab!=null)return{ip:lab,ns};
  if(srv&&srv.os&&!(depth>0)&&nameserverOf(srv)&&nameserverOf(srv)!==ns){const r=dnsQuery(srv,n,null,1);if(r.ip!=null||r.ext)return{...r,ns}}
  if(cloudKind(srv)==='fake'||S.devices.some(x=>cloudKind(x)==='fake')&&!S.devices.some(x=>cloudKind(x)==='real'))return{nx:true,ns,err:`Name or service not known (${n} não existe na Internet fake — cadastre na nuvem)`};
  return{nx:true,ns,err:`Name or service not known (o DNS ${ns} não conhece ${n})`}}
/* resolve com fallback assíncrono para a Internet real */
function resolveAsync(io,name,ns){const r=dnsQuery(io.d,name,ns);if(!r.ext)return r;if(!io.ctx.resolve)return{err:`a resolução real de ${name} precisa do app/servidor da bancada (Internet real indisponível neste modo)`,noReal:true};
  return io.ctx.resolve(name).then(x=>x&&x.ips&&x.ips.length?{ip:ip2i(x.ips[0]),ips:x.ips,ns:r.ns,real:true}:{nx:true,ns:r.ns,err:`Name or service not known${x&&x.err?' ('+x.err+')':''}`}).catch(e=>({err:'falha na resolução real: '+e.message}))}
const DIGHDR=(n,st)=>`\n; <<>> DiG 9.18.28 <<>> ${n}\n;; global options: +cmd\n;; Got answer:\n;; ->>HEADER<<- opcode: QUERY, status: ${st}, id: ${1000+hsh(n)%60000}\n;; flags: qr rd ra; QUERY: 1, ANSWER: ${st==='NOERROR'?1:0}, AUTHORITY: 0, ADDITIONAL: 1\n\n;; QUESTION SECTION:\n;${n}.\t\t\tIN\tA\n`;
function dnsCmd(io,kind){const a=io.argv.slice(1);const at=a.find(x=>x.startsWith('@'));const short=a.includes('+short');let name=a.find(x=>!x.startsWith('@')&&!x.startsWith('+')&&!x.startsWith('-')&&!/^(A|AAAA|MX|NS|TXT|ANY|IN)$/i.test(x));let srv=at?at.slice(1):null;
  if(kind==='nslookup'){const p=a.filter(x=>!x.startsWith('-'));name=p[0];srv=p[1]||null}if(kind==='host'){const p=a.filter(x=>!x.startsWith('-'));name=p[0];srv=p[1]||null}
  if(!name){io.err(kind==='dig'?'(use: dig nome [@servidor] [+short])':`Usage: ${kind} nome [servidor]`);return 1}
  const ns0=srv||nameserverOf(io.d)||'?';
  return M(resolveAsync(io,name,srv),r=>{if(io.ctx.onSim&&r.ns){}const ns=r.ns||ns0;
    if(r.ip!=null&&!r.local||r.ip!=null&&srv){const ips=(r.ips||[i2ip(r.ip)]).filter(x=>/^\d+\.\d+\.\d+\.\d+$/.test(x));
      if(kind==='dig'){if(short){ips.forEach(x=>io.raw(x));return 0}io.out(DIGHDR(name,'NOERROR')+`\n;; ANSWER SECTION:\n${ips.map(x=>`${name}.\t\t300\tIN\tA\t${x}`).join('\n')}\n\n;; Query time: ${3+hsh(name)%40} msec\n;; SERVER: ${ns}#53(${ns}) (UDP)\n;; WHEN: ${new Date().toUTCString()}\n;; MSG SIZE  rcvd: 56${r.real?'\n;; (resposta real da Internet, via servidor da bancada)':''}`);return 0}
      if(kind==='nslookup'){io.out(`Server:\t\t${ns}\nAddress:\t${ns}#53\n\n${r.auth?'':'Non-authoritative answer:\n'}${ips.map(x=>`Name:\t${name}\nAddress: ${x}`).join('\n')}`);return 0}
      io.out(ips.map(x=>`${name} has address ${x}`).join('\n'));return 0}
    if(r.ip!=null&&r.local){if(kind==='dig'){if(short)io.raw(i2ip(r.ip));else io.out(`(${name} vem do /etc/hosts — o dig consulta só o DNS; use getent hosts ${name})`,'dim');return 0}io.out(`${kind==='host'?name+' has address '+i2ip(r.ip):`Server:\t\t${ns}\nAddress:\t${ns}#53\n\nName:\t${name}\nAddress: ${i2ip(r.ip)}`}`);return 0}
    if(r.nx){if(kind==='dig'){if(!short)io.out(DIGHDR(name,'NXDOMAIN')+`\n;; Query time: 4 msec\n;; SERVER: ${ns}#53(${ns}) (UDP)`);}else if(kind==='nslookup')io.out(`Server:\t\t${ns}\nAddress:\t${ns}#53\n\n** server can't find ${name}: NXDOMAIN`);else io.out(`Host ${name} not found: 3(NXDOMAIN)`);io.out(r.err,'dim');return 1}
    if(kind==='dig')io.err(r.timeout?`;; communications error to ${ns}#53: ${r.refused?'connection refused':'timed out'}\n;; no servers could be reached`:`;; ${r.err}`);else if(kind==='nslookup')io.err(r.timeout?`;; communications error to ${ns}#53: ${r.refused?'connection refused':'timed out'}\n;; no servers could be reached`:`;; ${r.err}`);else io.err(`;; connection timed out; no servers could be reached`);if(r.err)io.out('motivo: '+r.err,'err');return 9})}
LX.dig=io=>dnsCmd(io,'dig');LX.nslookup=io=>dnsCmd(io,'nslookup');LX.host=io=>dnsCmd(io,'host');
LX.getent=io=>{if(io.argv[1]!=='hosts'||!io.argv[2])return 2;const r=dnsQuery(io.d,io.argv[2]);if(r.ip!=null){io.out(`${i2ip(r.ip)}       ${io.argv[2]}`);return 0}return 2};
LX.resolvectl=io=>{io.out(`Global\n       Protocols: +LLMNR -mDNS -DNSOverTLS DNSSEC=no/unsupported\nresolv.conf mode: stub\n\nLink 2 (eth0)\n    Current Scopes: DNS\n         DNS Servers: ${nameserverOf(io.d)||'(nenhum)'}`);return 0};

/* ---------- rede: ping / traceroute / ss / nc / curl / ssh ---------- */
function localSim(d,ip,proto,port){const kc=clusterOf(d);if(kc&&kc!==d&&kc.k8s){const k=kc.k8s;const api=pc(k.svcCidr||'');const sv=(k.svcs||[]).find(s=>ip2i(s.cip)===ip);const isApi=api&&ip===((api.net+1)>>>0);
    if(sv||isApi){const R={ok:true,lines:[`→ ${proto.toUpperCase()} para o ClusterIP ${i2ip(ip)} — kube-proxy/OVN no próprio nó encaminha para os pods`],f:[],r:[],hops:[],at:d.id,srcAtDst:nodeIp(d)??ip,dstIp:ip,local:true};if(proto==='icmp'){R.ok=false;R.why=`ClusterIP ${i2ip(ip)} não responde ping (é um IP virtual — teste com curl na porta do service)`;return R}
      if(isApi){if(+port!==443){R.ok=false;R.refused=true;R.why='o service kubernetes só atende a porta 443';return R}R.svc={proto:'tcp',port:443,svc:'kube-apiserver',k8s:true,web:'k8sapi'};return R}
      if(+port!==+sv.port){R.ok=false;R.refused=true;R.why=`o service ${sv.ns}/${sv.name} (${i2ip(ip)}) atende a porta ${sv.port}, não ${port}`;return R}
      const eps=svcEndpoints(kc,sv);if(!eps.length){R.ok=false;R.refused=true;R.why=`o service ${sv.ns}/${sv.name} não tem endpoints (nenhum pod pronto com app=${sv.sel})`;return R}
      R.svc={proto:'tcp',port:+sv.port,svc:'k8s',k8s:true,web:'k8s',ksvc:sv,eps};return R}}
  const lo=(ip>>>24)===127;const own=lo||l3ifs(d).some(f=>ownsIp(f,ip));if(!own)return null;const R={ok:true,lines:[`→ ${proto.toUpperCase()} local (${i2ip(ip)}) — não sai do equipamento`],f:[],r:[],hops:[],at:d.id,srcAtDst:ip,dstIp:ip,local:true};
  if(proto==='icmp')return R;const fw0=d.hfw;d.hfw={on:false,allow:[],icmp:true};let a;try{a=hostAccept(d,proto,port,lo?((l3ifs(d).find(f=>!f.mgmt)||{c:{ip}}).c.ip):ip,ip)}finally{d.hfw=fw0}if(!a.ok){R.ok=false;R.refused=true;R.why=a.why;return R}R.svc=a.svc;return R}
function simIo(io,ip,proto,port){const ipn=typeof ip==='number'?ip:ip2i(ip);const loc=localSim(io.d,ipn,proto,port);if(loc){io.res.sim=loc;return loc}const r=simulate(io.d.id,typeof ip==='number'?i2ip(ip):ip,proto,port);if(io.ctx.onSim)io.ctx.onSim(r);io.res.sim=r;return r}
function withTarget(io,name,fn){if(!name){io.err(`${io.argv[0]}: informe o destino`);return 2}return M(resolveAsync(io,name),r=>{if(r.ip==null){io.err(`${io.argv[0]}: ${name}: ${r.nx?'Name or service not known':'Temporary failure in name resolution'}`);if(r.err)io.out('motivo: '+r.err,'err');return 2}return fn(r.ip,r)})}
LX.ping=io=>{const{f,pos}=flagsOf(io.argv,'c=i=W=w=s=I=t=');const n=Math.max(1,Math.min(10,+f.c||4));const name=pos[0];
  return withTarget(io,name,(ip,rr)=>{const r=simIo(io,ip,'icmp',0);const ips=i2ip(ip);const src=l3ifs(io.d).find(x=>!x.mgmt);io.out(`PING ${name} (${ips}) 56(84) bytes of data.`);
    if(r.ok){const ttl=(r.ext?52:64)-Math.max(0,r.hops.length-1);const base=r.ext?11+hsh(ips)%30:0.4+r.hops.length*0.21;for(let i=1;i<=n;i++)io.out(`64 bytes from ${name!==ips?name+' ('+ips+')':ips}: icmp_seq=${i} ttl=${ttl} time=${(base+i*0.03+(hsh(ips+i)%10)/100).toFixed(r.ext?1:2)} ms`);io.out(`\n--- ${name} ping statistics ---\n${n} packets transmitted, ${n} received, 0% packet loss, time ${n*1000-1}ms`);io.out('✓ alcançável'+(r.ext?' (fora do lab — trajeto até a Internet real simulado)':''),'ok');return 0}
    const silent=r.refused||/firewall|descarta/.test(r.why||'');if(!silent)for(let i=1;i<=Math.min(n,3);i++)io.out(`From ${src?i2ip(src.c.ip):'0.0.0.0'} icmp_seq=${i} Destination Host Unreachable`,'err');io.out(`\n--- ${name} ping statistics ---\n${n} packets transmitted, 0 received,${silent?'':' +'+Math.min(n,3)+' errors,'} 100% packet loss, time ${n*1000-1}ms`);io.out('motivo: '+r.why,'err');return 1})};
LX.traceroute=LX.mtr=io=>{const{pos}=flagsOf(io.argv,'m=q=w=');return withTarget(io,pos[0],(ip)=>legacy(io,'traceroute '+i2ip(ip)))};
LX.ip=io=>{const a=io.argv.slice(1);const br=a[0]==='-br'||a[0]==='-brief';const b=br?a.slice(1):a.filter(x=>!/^-(4|c|color|s)$/.test(x));const sub=(b[0]||'').toLowerCase();
  const tun=(io.d.vpns||[]).filter(t=>t.kind==='wireguard'&&!t.shut&&pc(t.addr||''));
  if(br&&/^a/.test(sub)){l3ifs(io.d,true).filter(f=>!f.mgmt&&f.kind!=='loop').forEach(f=>io.raw(`${(f.kind==='sub'?spn(io.d,f.k)+'.'+f.vlan:f.lag?'bond'+(f.lag-1):spn(io.d,f.k)).padEnd(16)} ${(io.d.ports[f.k].shut?'DOWN':linkAt(io.d.id,f.k)?'UP':'DOWN').padEnd(14)} ${cidrStr(f.c)}`));tun.forEach(t=>io.raw(`${t.name.padEnd(16)} UNKNOWN        ${t.addr}`));return 0}
  if(br&&/^l/.test(sub)){io.d.ports.forEach((p,k)=>{if(!isMgmt(io.d,k))io.raw(`${spn(io.d,k).padEnd(16)} ${(p.shut?'DOWN':linkAt(io.d.id,k)?'UP':'DOWN').padEnd(14)} ${macLinux(mac(io.d.id,'p'+k))} <BROADCAST,MULTICAST,UP,LOWER_UP>`)});return 0}
  const rc=legacy(io,['ip',...b].join(' '));
  if((!sub||/^a/.test(sub))&&(!b[1]||/^(show|s|list)$/.test(b[1]))&&tun.length){let n=10+io.d.ports.length;tun.forEach(t=>io.out(`${n++}: ${t.name}: <POINTOPOINT,NOARP,UP,LOWER_UP> mtu 1420 qdisc noqueue state UNKNOWN group default qlen 1000\n    link/none\n    inet ${t.addr} scope global ${t.name}\n       valid_lft forever preferred_lft forever`))}
  if(/^r/.test(sub)&&(!b[1]||/^(show|list)$/.test(b[1]))){tun.forEach(t=>netsOf(t.rnets).forEach(c=>io.out(`${netStr(c)} dev ${t.name} scope link`)));(io.d.vpns||[]).filter(t=>t.kind==='ipsec'&&!t.shut).forEach(t=>netsOf(t.rnets).forEach(c=>io.out(`${netStr(c)} via ${io.d.gw||'?'} dev ${spn(io.d,0)} proto static src ${(l3ifs(io.d).find(f=>!f.mgmt)||{c:{ip:0}}).c.ip?i2ip(l3ifs(io.d).find(f=>!f.mgmt).c.ip):''} table 220  (política IPsec)`)))}
  if(/^(a|l|r)/.test(sub)&&/^(add|del|set|replace|flush|delete)$/.test(b[1]||''))io.changed();return rc};
LX.ifconfig=io=>legacy(io,io.argv.join(' '));LX.route=io=>legacy(io,'route');LX.arp=io=>legacy(io,'arp');LX.ipmitool=io=>legacy(io,io.argv.join(' '));
LX.ethtool=io=>{const k=io.d.ports.findIndex((p,j)=>spn(io.d,j)===io.argv[1]);if(k<0){io.err(`netlink error: no device matches name (offset 24)\nnetlink error: No such device`);return 1}const up=linkAt(io.d.id,k)&&!io.d.ports[k].shut;io.out(`Settings for ${io.argv[1]}:\n\tSupported ports: [ FIBRE ]\n\tSpeed: ${up?'10000Mb/s':'Unknown!'}\n\tDuplex: ${up?'Full':'Unknown! (255)'}\n\tAuto-negotiation: off\n\tLink detected: ${up?'yes':'no'}`);return 0};
function listenRows(d){const ip0=(l3ifs(d).find(f=>!f.mgmt)||{c:{}}).c.ip;const L=hostSvcPorts(d,ip0);const seen=new Set();return L.filter(x=>{const k=x.proto+x.port+(x.k8s?'k':'');if(seen.has(k))return false;seen.add(k);return true})}
LX.ss=LX.netstat=io=>{const{f}=flagsOf(io.argv);const ns=io.argv[0]==='netstat';const rows=listenRows(io.d).filter(r=>(f.t&&r.proto==='tcp')||(f.u&&r.proto==='udp')||(!f.t&&!f.u));
  if(!f.l&&!ns&&!f.a){io.out('Netid State  Recv-Q Send-Q   Local Address:Port    Peer Address:Port  Process\n(nenhuma conexão estabelecida — use ss -tulpn para ver as portas em escuta)');return 0}
  io.out(ns?'Active Internet connections (only servers)\nProto Recv-Q Send-Q Local Address           Foreign Address         State       PID/Program name':'Netid State  Recv-Q Send-Q   Local Address:Port    Peer Address:Port  Process');
  rows.forEach(r=>{const nm=r.k8s?'kubelet':r.svc==='docker-proxy'?'docker-proxy':r.svc.split('@')[0];const pid=1000+hsh(nm)%8000;const la=`0.0.0.0:${r.port}`;
    io.raw(ns?`${r.proto.padEnd(6)}0      0 ${la.padEnd(24)}0.0.0.0:*               ${r.proto==='tcp'?'LISTEN     ':'           '} ${f.p?pid+'/'+nm:'-'}`:`${r.proto.padEnd(6)}${r.proto==='tcp'?'LISTEN':'UNCONN'} 0      ${r.proto==='tcp'?'4096':'0   '}   ${la.padStart(17)}         0.0.0.0:*    ${f.p?`users:(("${nm}",pid=${pid},fd=6))`:''}`)});return 0};
LX.lsof=io=>{io.out('COMMAND   PID USER   FD   TYPE DEVICE SIZE/OFF NODE NAME');listenRows(io.d).forEach(r=>io.raw(`${r.svc.slice(0,9).padEnd(9)} ${1000+hsh(r.svc)%8000} root    6u  IPv4  ${20000+r.port}      0t0  ${r.proto.toUpperCase()} *:${r.port} (LISTEN)`));return 0};
LX.nc=io=>{const{f,pos}=flagsOf(io.argv,'p=w=s=');const udp=!!f.u;if(f.l){const port=+(f.p||pos[pos.length-1]);if(!port){io.err('nc: missing port with option -l');return 1}(io.d.listen=io.d.listen||[]).push({proto:udp?'udp':'tcp',port,svc:'nc',cmd:`nc -l ${port}`});io.changed();io.out(`Listening on 0.0.0.0 ${port} (em segundo plano — pare com: pkill nc)`);return 0}
  const host=pos[0],port=portNum(pos[1]);if(!host||!port){io.err('usage: nc [-46CDdFhklNnrStUuvZz] [-p source_port] [-w timeout] [destination] [port]');return 1}
  return withTarget(io,host,ip=>{const r=simIo(io,ip,udp?'udp':'tcp',port);if(r.ok){if(f.v||f.z)io.out(`Connection to ${host} (${i2ip(ip)}) ${port} port [${udp?'udp':'tcp'}/${Object.keys(PORTS).find(k=>PORTS[k]===port)||'*'}] succeeded!`);if(!f.z&&r.svc&&r.svc.svc==='ssh'||r.svc&&(r.svc.svc==='sshd'))io.out('SSH-2.0-OpenSSH_9.6p1 Ubuntu-3ubuntu13');return 0}
    io.err(`nc: connect to ${host} port ${port} (${udp?'udp':'tcp'}) failed: ${r.refused?'Connection refused':'Connection timed out'}`);io.out('motivo: '+r.why,'err');return 1})};
LX.telnet=io=>{const host=io.argv[1],port=portNum(io.argv[2]||'23')||23;return withTarget(io,host,ip=>{io.out(`Trying ${i2ip(ip)}...`);const r=simIo(io,ip,'tcp',port);if(r.ok){io.out(`Connected to ${host}.\nEscape character is '^]'.\nConnection closed by foreign host.`);return 0}io.err(`telnet: Unable to connect to remote host: ${r.refused?'Connection refused':'Connection timed out'}`);io.out('motivo: '+r.why,'err');return 1})};
function parseUrl(u){const m=String(u).match(/^(?:(https?):\/\/)?([^/:?#]+)(?::(\d+))?([^#]*)?/i);if(!m)return null;const sc=(m[1]||'http').toLowerCase();return{sc,host:m[2],port:+m[3]||(sc==='https'?443:80),path:m[4]||'/',url:`${sc}://${m[2]}${m[3]?':'+m[3]:''}${m[4]||'/'}`}}
/* resposta HTTP do serviço que atendeu a conexão */
function httpServe(dst,svc,u,depth){const d=dst;const H=(code,body,server,ctype='text/html')=>({code,body,server,ctype});const nf=s=>H(404,`<html>\n<head><title>404 Not Found</title></head>\n<body>\n<center><h1>404 Not Found</h1></center>\n<hr><center>${s}</center>\n</body>\n</html>\n`,s);
  if(!d)return H(200,'',null);if(d.type==='cloud'){const n=String(u.host).toLowerCase();if(/exemplo/.test(n)||u.host==='93.184.216.34')return H(200,`<!doctype html>\n<html><head><title>Exemplo — Internet fake</title></head>\n<body><h1>Exemplo de site</h1><p>Servido pela nuvem "${d.name}" (Internet fake, fechada no lab).</p></body></html>\n`,'ECAcc (fake)');
    if(MIRROR_NAMES.includes(n)||u.host===MIRROR_IP)return H(200,'<html><body><h1>Index of /</h1><a href="ubuntu/">ubuntu/</a> <a href="debian/">debian/</a> <a href="fedora/">fedora/</a> <a href="alpine/">alpine/</a></body></html>\n','Apache (mirror fake)');
    return H(200,`<html><body><h1>${u.host}</h1><p>Site fake na nuvem ${d.name}.</p></body></html>\n`,'nginx (fake)')}
  if((svc&&svc.web==='bmc')||(!svc&&(fwd(d.type)||isSw(d.type)))){const r=webUI(d,{method:'GET',path:u.path,bmc:!!svc,client:'lab'});const sv={idrac:'Apache',ilo:'HPE-iLO-Server/1.30',xcc:'lighttpd',cimc:'nginx',bmc:'lighttpd',fortios:'xxxxxxxx-xxxxx',junos:'Embedthis-http',cisco:'openresty',routeros:'Mikrotik HttpProxy'}[webSkinOf(d,!!svc)]||'httpd';return H(r.status,r.body,sv,(r.headers||{})['Content-Type']||'text/html')}
  if(!svc)return H(200,`Resposta de ${d.name} na porta ${u.port}\n`,'bancada');
  if(svc.k8s){const r=k8sHttp(svc,u.host);return H(r.code,r.body+'\n',svc.web==='ingress'?(dst&&clusterOf(dst)&&clusterOf(dst).k8s.dist==='openshift'?'openshift-router (haproxy)':'ingress-nginx'):'kube',svc.web==='k8sapi'?'application/json':'text/html')}
  if(svc.ct&&svc.ct.image&&svc.ct.real&&svc.ct.real!=='ok'){const c=svc.ct;const why=c.real==='iniciando'?`O container real está subindo no Docker deste computador (a primeira vez baixa a imagem ${c.image}, pode levar alguns minutos). Recarregue em instantes.`:c.real==='parado'?'O container real está parado (docker start '+c.name+').':`Não foi possível rodar o container de verdade: ${c.realErr||'erro desconhecido'}`;
    return H(c.real==='iniciando'?503:502,`<!doctype html><meta charset=utf-8><title>${c.name} — ${c.real==='iniciando'?'subindo':'não está rodando'}</title><body style="font:15px Arial;margin:40px;max-width:760px"><h2>${c.image} em ${d.name}</h2><p>${why.replace(/</g,'&lt;')}</p><p style="color:#777">Bancada de Rede — container "${c.name}" na porta ${u.port}. Depois de resolver, rode no servidor: <code>docker restart ${c.name}</code></p></body>\n`,'bancada')}
  if(svc.ct&&svc.ct.image&&!svc.ct.real&&!/nginx|httpd|apache/.test(svc.ct.image))return H(200,`<!doctype html><meta charset=utf-8><title>${svc.ct.name} (simulado)</title><body style="font:15px Arial;margin:40px;max-width:760px"><h2>${svc.ct.image} em ${d.name} — container simulado</h2><p>Este container foi criado sem o Docker deste computador, então a aplicação não roda de verdade (só esta resposta).</p><p>Para rodar a aplicação real: abra o Docker Desktop, abra a bancada pelo executável e rode no servidor <code>docker restart ${svc.ct.name}</code> (ou recrie o container).</p></body>\n`,'bancada');
  if(svc.ct&&svc.ct.image){const img=svc.ct.image;return/nginx/.test(img)?H(200,NGINX_PAGE,'nginx/1.27.2'):/httpd|apache/.test(img)?H(200,'<html><body><h1>It works!</h1></body></html>\n','Apache/2.4.62 (Unix)'):H(200,`Container ${svc.ct.name} (${img}) respondeu na porta ${u.port}\n`,'docker')}
  const o=osInfo(d);const read=p=>fsRead(d,p);const path=decodeURIComponent(u.path.split('?')[0]);
  const fileFrom=(root,idx)=>{let p=(root+path).replace(/\/+/g,'/');if(fsIsDir(d,p.replace(/\/$/,''))||p.endsWith('/')){p=p.replace(/\/$/,'');for(const i of idx){const t=read(p+'/'+i);if(t!=null)return t}return null}return read(p)};
  if(svc.web==='nginx'){const conf=Object.entries(fsAll(d)).filter(([p])=>/^\/etc\/nginx\/(sites-enabled|conf\.d)\//.test(p)).map(([,t])=>t).join('\n');const px=conf.match(/proxy_pass\s+(https?:\/\/[^;\s]+)/);
      if(px&&!(depth>2)){const up=upstreamOf(conf,px[1]);const r=httpReq(d,up,depth+1);return r.ok?{...r.http,server:'nginx/1.24.0 → '+(r.http.server||'')}:H(502,'<html><head><title>502 Bad Gateway</title></head><body><center><h1>502 Bad Gateway</h1></center><hr><center>nginx/1.24.0</center></body></html>\n','nginx/1.24.0')}
      const root=(conf.match(/root\s+([^;\s]+)/)||[])[1]||(o.fam==='deb'?'/var/www/html':'/usr/share/nginx/html');const t=fileFrom(root,['index.html','index.htm','index.nginx-debian.html']);return t!=null?H(200,t,'nginx/1.24.0 ('+o.name.split(' ')[0]+')'):nf('nginx/1.24.0')}
  if(svc.web==='apache'){const t=fileFrom('/var/www/html',['index.html','index.php']);if(t!=null)return H(200,t,'Apache/2.4.58');if(path==='/'||path==='')return H(o.fam==='rpm'?403:200,o.fam==='rpm'?`<html><head><title>HTTP Server Test Page powered by: ${o.name.split(' ')[0]}</title></head><body><h1>HTTP Server Test Page</h1><p>This page is used to test the proper operation of an HTTP server after it has been installed on a ${o.name.split(' ')[0]} system.</p></body></html>\n`:APACHE_PAGE(o.name.split(' ')[0]),'Apache/2.4.58');return nf('Apache/2.4.58')}
  if(svc.web==='haproxy'){const cfg=read('/etc/haproxy/haproxy.cfg')||'';const sv=[...cfg.matchAll(/^\s*server\s+\S+\s+([\w.-]+):(\d+)/gm)].map(m=>({h:m[1],p:+m[2]}));if(!sv.length)return H(503,'<html><body><h1>503 Service Unavailable</h1>\nNo server is available to handle this request.\n</body></html>\n','haproxy');
    d._rr=((d._rr||0)+1)%sv.length;for(let i=0;i<sv.length;i++){const s=sv[(d._rr+i)%sv.length];const r=httpReq(d,{sc:'http',host:s.h,port:s.p,path:u.path},(depth||0)+1);if(r.ok)return{...r.http,server:(r.http.server||'')+' (via haproxy → '+s.h+':'+s.p+')'}}return H(503,'<html><body><h1>503 Service Unavailable</h1>\nNo server is available to handle this request.\n</body></html>\n','haproxy')}
  if(svc.web==='iis'){const t=fileFrom('C:/inetpub/wwwroot',['index.html','index.htm','default.htm','iisstart.htm']);return t!=null?H(200,t,'Microsoft-IIS/10.0'):H(404,'<h2>404 - File or directory not found.</h2>','Microsoft-IIS/10.0')}
  if(svc.web==='pyhttp'){const L=(d.listen||[]).find(l=>l.web==='pyhttp'&&+l.port===+u.port);const root=L?L.dir:'/root';const t=fileFrom(root,['index.html','index.htm']);if(t!=null)return H(200,t,'SimpleHTTP/0.6 Python/3.12.3');const it=fsList(d,(root+path).replace(/\/+$/,'')||'/');return H(200,`<!DOCTYPE HTML>\n<html><head><title>Directory listing for ${path}</title></head>\n<body><h1>Directory listing for ${path}</h1><hr><ul>\n${it.map(x=>`<li><a href="${x.n}${x.dir?'/':''}">${x.n}${x.dir?'/':''}</a></li>`).join('\n')}\n</ul><hr></body></html>\n`,'SimpleHTTP/0.6 Python/3.12.3')}
  if(svc.web==='grafana')return H(302,'<a href="/login">Found</a>.\n','grafana');if(svc.web==='prometheus')return H(302,'<a href="/query">Found</a>.\n','prometheus');if(svc.web==='cockpit')return H(200,'<html><head><title>Cockpit</title></head><body>Cockpit — login</body></html>\n','cockpit-ws');
  if(svc.web==='metrics')return H(200,'# HELP node_cpu_seconds_total Seconds the CPUs spent in each mode.\n# TYPE node_cpu_seconds_total counter\nnode_cpu_seconds_total{cpu="0",mode="idle"} 112233.4\n','node_exporter','text/plain');
  if(svc.svc==='nc')return H(200,'','');if(svc.web==='cloud')return httpServe({type:'cloud',name:'Internet'},null,u);
  return{code:0,body:'',server:'',nohttp:true,proto:svc.svc}}
function upstreamOf(conf,url){const u=parseUrl(url);const up=conf.match(new RegExp('upstream\\s+'+u.host.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\s*\\{([^}]*)\\}'));if(up){const sv=[...up[1].matchAll(/server\s+([\w.-]+)(?::(\d+))?/g)];if(sv.length){const s=sv[hsh(String(Date.now()))%sv.length];return{...u,host:s[1],port:+s[2]||80}}}return u}
/* requisição HTTP simulada a partir de um equipamento (usada por proxy/haproxy) */
function httpReq(src,u,depth){const r=dnsQuery(src,u.host);if(r.ip==null)return{ok:false};const q=simulate(src.id,i2ip(r.ip),'tcp',u.port);if(!q.ok||q.ext)return{ok:false};return{ok:true,http:httpServe(dev(q.at),q.svc,u,depth)}}
function curlCmd(io){const wget=io.argv[0]==='wget';const{f,pos}=flagsOf(io.argv,wget?'O=T=t=':'o=X=H=d=m=A=u=w=-connect-timeout=e=');const url=pos.find(x=>/^(https?:\/\/)?[\w.-]+(:\d+)?(\/.*)?$/i.test(x));
  if(!url){io.err(wget?'wget: missing URL':'curl: try \'curl --help\' for more information');return 2}const u=parseUrl(url);if(!u){io.err(`curl: (3) URL rejected: Malformed input`);return 3}
  const head=f.I||f.head,inc=f.i,verbose=f.v;const silent=f.s||f.q;
  const done=(ip,h,real)=>{const st=h.code;const reason={200:'OK',301:'Moved Permanently',302:'Found',403:'Forbidden',404:'Not Found',502:'Bad Gateway',503:'Service Unavailable'}[st]||'';
    if(h.nohttp){io.err(`curl: (1) Received HTTP/0.9 when not allowed — a porta ${u.port} é de ${h.proto}, não HTTP`);return 1}
    if(verbose)io.out(`*   Trying ${i2ip(ip)}:${u.port}...\n* Connected to ${u.host} (${i2ip(ip)}) port ${u.port}\n> ${head?'HEAD':'GET'} ${u.path} HTTP/1.1\n> Host: ${u.host}\n> User-Agent: curl/8.5.0\n>\n< HTTP/1.1 ${st} ${reason}`,'dim');
    const hdr=`HTTP/1.1 ${st} ${reason}\n${h.server?'Server: '+h.server+'\n':''}Date: ${new Date().toUTCString()}\nContent-Type: ${h.ctype||'text/html'}\nContent-Length: ${(h.body||'').length}\nConnection: keep-alive`;
    if(wget){const fn=f.O||((u.path.split('/').pop()||'index.html').split('?')[0]||'index.html');if(!silent)io.out(`--${new Date().toISOString().slice(0,19).replace('T',' ')}--  ${u.url}\nResolving ${u.host} (${u.host})... ${i2ip(ip)}\nConnecting to ${u.host} (${u.host})|${i2ip(ip)}|:${u.port}... connected.\nHTTP request sent, awaiting response... ${st} ${reason}`);
      if(st>=400){io.err(`${new Date().toISOString().slice(0,19).replace('T',' ')} ERROR ${st}: ${reason}.`);return 8}if(fn==='-'){io.out((h.body||'').replace(/\n$/,''));return 0}fsWrite(io.d,io.path(fn),h.body||'');io.changed();if(!silent)io.out(`Length: ${(h.body||'').length} [${h.ctype||'text/html'}]\nSaving to: '${fn}'\n\n'${fn}' saved [${(h.body||'').length}/${(h.body||'').length}]`);return 0}
    if(head){io.out(hdr);return 0}const body=(inc?hdr+'\n\n':'')+(h.body||'');
    if(f.o){fsWrite(io.d,io.path(f.o),h.body||'');io.changed();if(!silent)io.out(`  % Total    % Received % Xferd  Average Speed   Time\n100  ${String((h.body||'').length).padStart(5)}  100  ${String((h.body||'').length).padStart(5)}    0     0   ${real?'48k':'512k'}      0 --:--:--`,'dim');return 0}
    if(body)io.out(body.replace(/\n$/,''));if(f.f&&st>=400)return 22;return 0};
  return M(resolveAsync(io,u.host),rr=>{if(rr.ip==null){io.err(wget?`wget: unable to resolve host address '${u.host}'`:`curl: (6) Could not resolve host: ${u.host}`);if(rr.err)io.out('motivo: '+rr.err,'err');return 6}
    const ip=rr.ip;const r=simIo(io,ip,'tcp',u.port);
    if(!r.ok){io.err(wget?`Connecting to ${u.host} (${u.host})|${i2ip(ip)}|:${u.port}... failed: ${r.refused?'Connection refused':'Connection timed out'}.`:r.refused?`curl: (7) Failed to connect to ${u.host} port ${u.port} after 3 ms: Couldn't connect to server`:`curl: (28) Failed to connect to ${u.host} port ${u.port} after 30001 ms: Timeout was reached`);io.out('motivo: '+r.why,'err');return r.refused?7:28}
    if(r.ext){if(!io.ctx.fetch){io.err(`curl: (7) a requisição real para ${u.host} precisa do app/servidor da bancada (o caminho até a Internet está ok)`);return 7}
      return io.ctx.fetch(u.url,{head}).then(x=>{if(x.err){io.err(`curl: (${x.code||7}) ${x.err}`);return x.code||7}return done(ip,{code:x.status,body:x.body,server:x.server,ctype:x.ctype},true)}).catch(e=>{io.err('curl: (7) '+e.message);return 7})}
    if(r.svc&&r.svc.ct&&r.svc.ct.image&&r.svc.ct.real){const c=r.svc.ct;const cp=((c.ports||[]).find(([h])=>+h===+u.port)||[])[1];const tg=c.rmap&&c.rmap[cp];
      if(c.real==='iniciando'){io.err(`curl: (7) Failed to connect to ${u.host} port ${u.port}: Connection refused`);io.out('(o container real ainda está subindo — a primeira vez baixa a imagem)','dim');return 7}
      if(tg&&io.ctx.ctAppFetch)return io.ctx.ctAppFetch(tg,u.path).then(x=>{if(x.err){io.err(`curl: (56) Recv failure: ${x.err}`);return 56}return done(ip,{code:x.status,body:x.body,server:x.server,ctype:x.ctype},true)})}
    if(r.svc&&r.svc.ct&&!r.svc.ct.image&&io.ctx.ctHttp){return io.ctx.ctHttp(dev(r.at),u.port,u.path).then(x=>done(ip,x,false))}
    if(u.sc==='https'&&!f.k&&!f.insecure&&!(r.svc&&(r.svc.k8s||r.svc.web==='cloud'))&&dev(r.at).type!=='cloud'){io.err(`curl: (60) SSL certificate problem: self-signed certificate\nMore details here: https://curl.se/docs/sslcerts.html`);io.out('(use -k para ignorar o certificado autoassinado)','dim');return 60}
    return done(ip,httpServe(dev(r.at),r.svc,u,0),false)})}
LX.curl=curlCmd;LX.wget=curlCmd;
LX.ssh=io=>{const{f,pos}=flagsOf(io.argv,'p=i=l=o=F=');if(!pos[0]){io.err('usage: ssh [-p port] [user@]hostname [command]');return 255}const tgt=pos[0].replace(/^[^@]*@/,'');const user=pos[0].includes('@')?pos[0].split('@')[0]:(f.l||'root');const port=+f.p||22;
  return withTarget(io,tgt,ip=>{const r=simIo(io,ip,'tcp',port);if(!r.ok){io.err(`ssh: connect to host ${tgt} port ${port}: ${r.refused?'Connection refused':'Connection timed out'}`);io.out('motivo: '+r.why,'err');return 255}
    if(r.ext){io.out(`(${tgt} está fora do lab — a bancada não abre sessões SSH reais)`,'dim');return 0}const td=dev(r.at);
    if(pos.length>1){const cmd=pos.slice(1).join(' ');if(!td.os){io.err(`(${td.name} não tem SO simulado para executar "${cmd}")`);return 1}const tmp={log:[],env:{},cwd:isWin(td)?WIN_HOME:'/root'};const rr=osRun(td,cmd,tmp,{...io.ctx,sub:true});const fin=()=>{tmp.log.forEach(x=>io.out(x.s,x.t==='err'?'err':x.t));return 0};return rr&&rr.async?rr.async.then(fin):fin()}
    io.out(`The authenticity of host '${tgt} (${i2ip(ip)})' can't be established.\nED25519 key fingerprint is SHA256:${(wgPub('ssh'+td.id)).slice(0,43)}.\nAre you sure you want to continue connecting (yes/no)? yes\nWarning: Permanently added '${tgt}' (ED25519) to the list of known hosts.\n${user}@${tgt}'s password: ********`,'dim');
    io.res.open={dev:td.id,host:tgt,user,from:i2ip(r.srcAtDst)};return 0})};
LX.scp=io=>{const{pos}=flagsOf(io.argv,'P=i=');if(pos.length<2){io.err('usage: scp [-P port] source ... target');return 1}const[srcS,dstS]=[pos[0],pos[pos.length-1]];const rem=s=>{const m=s.match(/^(?:[^@]+@)?([^:/]+):(.*)$/);return m?{host:m[1],path:m[2]||'.'}:null};
  const rs=rem(srcS),rd=rem(dstS);if(!!rs===!!rd){io.err('scp: um lado deve ser remoto (user@host:/caminho)');return 1}const R=rs||rd;
  return withTarget(io,R.host,ip=>{const r=simIo(io,ip,'tcp',22);if(!r.ok){io.err(`ssh: connect to host ${R.host} port 22: ${r.refused?'Connection refused':'Connection timed out'}\nscp: Connection closed`);io.out('motivo: '+r.why,'err');return 255}const td=dev(r.at);if(!td||!td.os){io.err('scp: destino sem SO simulado');return 1}
    const tpath=p=>fsNorm(td,p.startsWith('/')||/^[a-z]:/i.test(p)?p:(isWin(td)?WIN_HOME:'/root')+'/'+p,null);
    if(rd){const t=fsRead(io.d,io.path(srcS));if(t==null){io.err(`scp: ${srcS}: No such file or directory`);return 1}let dp=tpath(rd.path);if(fsIsDir(td,dp))dp+='/'+srcS.split('/').pop();fsWrite(td,dp,t);io.out(`${srcS.split('/').pop().padEnd(40)}100%  ${String(t.length).padStart(5)}   ${(t.length/1024).toFixed(1)}KB/s   00:00`)}
    else{const t=fsRead(td,tpath(rs.path));if(t==null){io.err(`scp: ${rs.path}: No such file or directory`);return 1}let dp=io.path(dstS);if(fsIsDir(io.d,dp))dp+='/'+rs.path.split('/').pop();fsWrite(io.d,dp,t);io.out(`${rs.path.split('/').pop().padEnd(40)}100%  ${String(t.length).padStart(5)}   ${(t.length/1024).toFixed(1)}KB/s   00:00`)}io.changed();return 0})};
LX['ssh-keygen']=io=>{fsWrite(io.d,'/root/.ssh/id_ed25519','-----BEGIN OPENSSH PRIVATE KEY-----\n(simulada)\n-----END OPENSSH PRIVATE KEY-----\n');fsWrite(io.d,'/root/.ssh/id_ed25519.pub',`ssh-ed25519 ${wgPub('k'+io.d.id).replace(/=/g,'')}AAAA root@${io.d.name}\n`);io.out(`Generating public/private ed25519 key pair.\nYour identification has been saved in /root/.ssh/id_ed25519\nYour public key has been saved in /root/.ssh/id_ed25519.pub`);io.changed();return 0};
LX['ssh-copy-id']=io=>{io.out('Number of key(s) added: 1\n\nNow try logging into the machine, with:   "ssh '+(io.argv[io.argv.length-1]||'')+'"');return 0};
LX.iperf3=io=>{const{f,pos}=flagsOf(io.argv,'c=t=p=P=b=');const port=+f.p||5201;if(f.s){(io.d.listen=io.d.listen||[]).push({proto:'tcp',port,svc:'iperf3',cmd:`iperf3 -s -p ${port}`});io.changed();io.out(`-----------------------------------------------------------\nServer listening on ${port} (test #1)   (segundo plano — pare com: pkill iperf3)\n-----------------------------------------------------------`);return 0}
  const host=f.c;if(!host){io.err('iperf3: parameter error - must either be a client (-c) or server (-s)');return 1}const t=+f.t||10;
  return withTarget(io,host,ip=>{const r=simIo(io,ip,f.u?'udp':'tcp',port);if(!r.ok){io.err(`iperf3: error - unable to connect to server - server may not be running: ${r.refused?'Connection refused':'Connection timed out'}`);io.out('motivo: '+r.why,'err');return 1}
    const vpn=r.lines.some(x=>/IPsec|WireGuard/.test(x)),inet=r.lines.some(x=>/nuvem|Internet/.test(x))||r.ext;const bw=f.u?(+String(f.b||'1').replace(/[^\d.]/g,'')||1):vpn?1.21:inet?0.48:9.41;const un=f.u||bw<1?'Mbits':'Gbits';const v=bw<1?bw*1000:bw;
    io.out(`Connecting to host ${host}, port ${port}\n[  5] local ${i2ip(r.srcAtDst||0)} port ${40000+hsh(host)%20000} connected to ${i2ip(ip)} port ${port}\n[ ID] Interval           Transfer     Bitrate`);for(let i=0;i<Math.min(t,5);i++)io.raw(`[  5]   ${(i+'.00').padStart(5)}-${((i+1)+'.00').padStart(5)}  sec  ${(v*0.125*(0.97+(hsh(host+i)%5)/100)).toFixed(2)} ${un==='Gbits'?'GBytes':'MBytes'}  ${(v*(0.97+(hsh(host+i)%5)/100)).toFixed(2)} ${un}/sec`);
    io.out(`- - - - - - - - - - - - - - - - - - - - - - - - -\n[  5]   0.00-${t}.00  sec  ${(v*0.125*t).toFixed(1)} ${un==='Gbits'?'GBytes':'MBytes'}  ${v.toFixed(2)} ${un}/sec                  sender\n\niperf Done.${vpn?'\n(banda limitada pela cifragem do túnel)':''}`);return 0})};
LX.tcpdump=io=>{io.out(`tcpdump: verbose output suppressed, use -v[v]... for full protocol decode\nlistening on ${io.argv[io.argv.indexOf('-i')+1]||spn(io.d,0)}, link-type EN10MB (Ethernet), snapshot length 262144 bytes`);io.out('(a captura ao vivo não é simulada — use "Simular" no canvas para ver o caminho e os encapsulamentos de cada pacote)','dim');return 0};

/* ---------- configuração de rede pelos arquivos do SO ---------- */
function applyIfCfg(io,cfg){const d=io.d;const errs=[];const touched=new Set();let gw=null,dns=null;const routes=[];
  cfg.forEach(c=>{const k=d.ports.findIndex((p,j)=>!isMgmt(d,j)&&spn(d,j)===c.dev);if(k<0){errs.push(`interface ${c.dev} não existe (há: ${d.ports.map((p,j)=>isMgmt(d,j)?null:spn(d,j)).filter(Boolean).join(', ')})`);return}const p=d.ports[k];
    if(c.vlan){p.mode='routed';const s=(p.subs=p.subs||[]).find(x=>+x.vlan===+c.vlan)||(p.subs.push({vlan:+c.vlan,ip:'',nat:false,vip:''}),p.subs[p.subs.length-1]);s.ip=c.addr||'';return}
    touched.add(k);if(c.addr){if(!pc(c.addr)||!c.addr.includes('/')){errs.push(`endereço inválido em ${c.dev}: ${c.addr} (use CIDR, ex.: 10.0.0.5/24)`);return}p.ip=c.addr;p.mode='routed'}else if(c.clear)p.ip='';if(c.gw)gw=c.gw;if(c.dns)dns=c.dns;(c.routes||[]).forEach(r=>routes.push(r))});
  if(errs.length){errs.forEach(e=>io.err(e));return 1}
  if(gw!==null){d.gw=gw==='default'?'':gw}else if(touched.size)d.gw=d.gw&&l3ifs(d).some(f=>inNet(ip2i(d.gw)??0,f.c))?d.gw:'';if(dns)d.dns=dns;
  if(routes.length||touched.size)d.routes=routes.filter(r=>pc(r.dst)&&ip2i(r.nh)!==null).map(r=>({dst:netStr(pc(r.dst)),nh:r.nh}));io.changed();return 0}
function netplanApply(io){const F=fsAll(io.d);const files=Object.keys(F).filter(p=>/^\/etc\/netplan\/.+\.ya?ml$/.test(p)).sort();if(!files.length){io.err('netplan: nenhum arquivo em /etc/netplan');return 1}
  const cfg=[];for(const fn of files){let y;try{y=yamlParse(F[fn])[0]||{}}catch(e){io.err(`${fn}: erro de YAML`);return 1}const net=y.network;if(!net){io.err(`${fn}: falta a chave "network:"`);return 1}
    Object.entries(net.ethernets||{}).forEach(([n,e])=>{e=e||{};const r=(e.routes||[]).map(x=>({dst:x.to==='default'?'0.0.0.0/0':x.to,nh:x.via}));const def=r.find(x=>x.dst==='0.0.0.0/0');cfg.push({dev:n,addr:(e.addresses||[])[0]||'',clear:!(e.addresses||[]).length,gw:e.gateway4||(def?def.nh:null),dns:((e.nameservers||{}).addresses||[])[0]||null,routes:r.filter(x=>x.dst!=='0.0.0.0/0')})});
    Object.entries(net.vlans||{}).forEach(([n,v])=>{v=v||{};cfg.push({dev:v.link,vlan:v.id,addr:(v.addresses||[])[0]||''})})}
  const rc=applyIfCfg(io,cfg);if(!rc){files.forEach(fn=>{if(io.d.fs&&io.d.fs[fn]!=null&&fn==='/etc/netplan/50-cloud-init.yaml')delete io.d.fs[fn]})}return rc}
LX.netplan=io=>{const op=io.argv[1]||'';if(op==='apply'||op==='try'){const rc=netplanApply(io);if(!rc&&op==='try')io.out('Configuration accepted.');return rc}if(op==='get'){io.out(fsRead(io.d,'/etc/netplan/50-cloud-init.yaml')||'');return 0}if(op==='generate')return 0;if(op==='status'){return LX.ip({...io,argv:['ip','-br','a']})}io.out('usage: netplan [apply|try|get|generate|status]','dim');return 1};
function netApplyIfaces(io){const t=fsRead(io.d,'/etc/network/interfaces')||'';const cfg=[];let cur=null;t.split('\n').forEach(l=>{const w=l.replace(/#.*/,'').trim().split(/\s+/);if(!w[0])return;
    if(w[0]==='iface'){if(w[1]==='lo'){cur=null;return}const vm=w[1].match(/^(.+)\.(\d+)$/);cur={dev:vm?vm[1]:w[1],vlan:vm?+vm[2]:null,clear:w[3]!=='static',routes:[]};cfg.push(cur);return}
    if(!cur)return;if(w[0]==='address')cur.addr=w[1].includes('/')?w[1]:cur.mask?`${w[1]}/${maskLen(cur.mask)}`:w[1]+'/24';if(w[0]==='netmask'){cur.mask=w[1];if(cur.addr&&!/\/\d+$/.test(cur.addr.split('/')[1]?'':'x'))cur.addr=cur.addr.split('/')[0]+'/'+maskLen(w[1])}
    if(w[0]==='gateway')cur.gw=w[1];if(w[0]==='dns-nameservers')cur.dns=w[1];if(w[0]==='up'&&w[1]==='ip'&&w[2]==='route'&&w[3]==='add')cur.routes.push({dst:w[4],nh:w[6]})});
  const rc=applyIfCfg(io,cfg);if(!rc&&io.d.fs)delete io.d.fs['/etc/network/interfaces'];return rc}
LX.ifup=io=>netApplyIfaces(io);LX.ifdown=io=>{const k=io.d.ports.findIndex((p,j)=>spn(io.d,j)===io.argv[1]);if(k>=0){io.d.ports[k].shut=true;io.changed()}return 0};LX.ifreload=io=>netApplyIfaces(io);
LX.nmcli=io=>{const d=io.d;const a=io.argv.slice(1).filter(x=>!/^-(t|p|f)$/.test(x));const obj=(a[0]||'').toLowerCase(),op=(a[1]||'').toLowerCase();d.nmStage=d.nmStage||{};
  const devs=d.ports.map((p,k)=>isMgmt(d,k)?null:k).filter(x=>x!==null);
  if(!obj||/^(d|dev|device)$/.test(obj)&&(!op||op==='status')){io.out('DEVICE  TYPE      STATE                   CONNECTION');devs.forEach(k=>io.raw(`${spn(d,k).padEnd(8)}ethernet  ${(linkAt(d.id,k)&&!d.ports[k].shut?(pc(d.ports[k].ip)?'connected':'connecting (getting IP configuration)'):'unavailable').padEnd(24)}${pc(d.ports[k].ip)?spn(d,k):'--'}`));io.raw('lo      loopback  connected (externally)  lo');return 0}
  if(/^(g|general)$/.test(obj)){io.out('STATE      CONNECTIVITY  WIFI-HW  WIFI\nconnected  full          missing  enabled');return 0}
  if(/^(c|con|connection)$/.test(obj)){const name=a[2];const k=devs.find(k=>spn(d,k)===name);
    if(!op||op==='show'){if(name){if(k===undefined){io.err(`Error: ${name} - no such connection profile.`);return 10}const p=d.ports[k],c=pc(p.ip);const sg=d.nmStage[name]||{};io.out(`connection.id:                          ${name}\nconnection.interface-name:              ${name}\nipv4.method:                            ${sg.method||(c?'manual':'disabled')}\nipv4.addresses:                         ${sg.addr||(c?cidrStr(c):'--')}\nipv4.gateway:                           ${sg.gw||(c&&d.gw&&inNet(ip2i(d.gw)??0,c)?d.gw:'--')}\nipv4.dns:                               ${sg.dns||d.dns||'--'}\nipv4.routes:                            ${(sg.routes||[]).map(r=>r.dst+' '+r.nh).join('; ')||'--'}${Object.keys(sg).length?'\n(alterações pendentes — rode: nmcli con up '+name+')':''}`);return 0}
      io.out('NAME  UUID                                  TYPE      DEVICE');devs.forEach(k=>io.raw(`${spn(d,k).padEnd(6)}${('5fb06bd0-0bb0-7ffb-45f1-d6edd65f3e'+String(10+k)).padEnd(38)}ethernet  ${pc(d.ports[k].ip)?spn(d,k):'--'}`));return 0}
    if(op==='mod'||op==='modify'||op==='add'){let nm=name;let i=3;if(op==='add'){const ci=a.indexOf('con-name'),ii=a.indexOf('ifname');nm=a[ii+1]||a[ci+1];i=2}const kk=devs.find(k=>spn(d,k)===nm);if(kk===undefined){io.err(`Error: unknown connection '${nm}'.`);return 10}const sg=d.nmStage[nm]=d.nmStage[nm]||{};
      for(;i<a.length;i+=2){const key=a[i].replace(/^\+/,''),v=a[i+1];if(key==='ipv4.addresses')sg.addr=v;else if(key==='ipv4.gateway')sg.gw=v;else if(key==='ipv4.dns')sg.dns=v.split(/[ ,]/)[0];else if(key==='ipv4.method')sg.method=v;else if(key==='ipv4.routes'){const[dst,nh]=v.split(/\s+/);(sg.routes=sg.routes||[]).push({dst,nh})}else if(/^(type|con-name|ifname|autoconnect|connection\.autoconnect)$/.test(key)){}else{io.err(`Error: invalid property '${key}'.`);return 2}}
      if(op==='add'){io.out(`Connection '${nm}' (${'4a5b'+hsh(nm).toString(16)}) successfully added.`);return LX.nmcli({...io,argv:['nmcli','con','up',nm]})}io.changed();return 0}
    if(op==='up'||op==='reload'){if(op==='reload')return 0;if(k===undefined){io.err(`Error: unknown connection '${name}'.`);return 10}const sg=d.nmStage[name]||{};const p=d.ports[k];
      if(sg.method==='auto'){io.err('Error: Connection activation failed: IP configuration could not be reserved (no available address, timeout, etc.)\n(não há DHCP nesta bancada — use ipv4.method manual)');return 4}
      const r=applyIfCfg(io,[{dev:name,addr:sg.addr||(pc(p.ip)?p.ip:''),clear:sg.method==='disabled',gw:sg.gw||(d.gw||null),dns:sg.dns||null,routes:[...(d.routes||[]).filter(x=>{const c=pc(sg.addr||p.ip);return!c||!inNet(ip2i(x.nh)??0,c)}),...(sg.routes||[])]}]);if(r)return r;delete d.nmStage[name];p.shut=false;
      io.out(`Connection successfully activated (D-Bus active path: /org/freedesktop/NetworkManager/ActiveConnection/${k+2})`);return 0}
    if(op==='down'){if(k!==undefined){d.ports[k].shut=true;io.changed()}io.out(`Connection '${name}' successfully deactivated.`);return 0}}
  io.out('Uso: nmcli dev status | nmcli con show [eth0] | nmcli con mod eth0 ipv4.addresses 10.0.0.5/24 ipv4.gateway 10.0.0.1 ipv4.dns 8.8.8.8 ipv4.method manual | nmcli con up eth0','dim');return 2};
LX.nmtui=io=>{io.out('(nmtui é interativo — use nmcli nesta bancada)','dim');return 0};

/* ---------- strongSwan (ipsec.conf) ---------- */
function ikeParse(s){const p=String(s||'').replace(/!$/,'').split(',')[0].split('-');const r={};p.forEach(x=>{if(/^(aes|3des|des|chacha)/.test(x))r.enc=x.replace(/gcm\d+$/,'');else if(/^(sha|md5)/.test(x))r.hash=x.replace(/^sha1$/,'sha1');else if(/^(modp|ecp|curve)/.test(x))r.dh=dhNum(x)||'14'});return r}
function ipsecLoad(io,quiet){const d=io.d;if(!hasPkg(d,'strongswan')){if(!quiet)io.err('ipsec: command not found');return 127}const conf=fsRead(d,'/etc/ipsec.conf')||'';const sec=fsRead(d,'/etc/ipsec.secrets')||'';
  const conns=[];let cur=null,def={};conf.split('\n').forEach(l=>{const t=l.replace(/#.*/,'');if(/^conn\s+/.test(t)){const n=t.trim().split(/\s+/)[1];cur=n==='%default'?def:{name:n,...def};if(n!=='%default')conns.push(cur);return}if(/^\S/.test(t)){cur=null;return}const m=t.trim().match(/^([\w-]+)\s*=\s*(.*)$/);if(m&&cur)cur[m[1]]=m[2].trim()});
  const psks=[];sec.split('\n').forEach(l=>{const m=l.replace(/#.*/,'').match(/^\s*(.*?)\s*:\s*PSK\s+"?([^"]*)"?\s*$/);if(m)psks.push({ids:m[1].split(/\s+/).filter(Boolean),psk:m[2]})});
  const own=l3ifs(d).filter(f=>!f.mgmt).map(f=>f.c.ip);const warn=[];
  const out=conns.map(c=>{const peer=c.right;let peerIp=ip2i(peer);if(peerIp===null&&peer&&!/^%/.test(peer)){const r=dnsQuery(d,peer);peerIp=r.ip??null}const left=c.left&&!/^%/.test(c.left)?c.left:'';
    if(left&&!own.includes(ip2i(left)))warn.push(`${c.name}: left=${left} não é um IP deste host (${own.map(i2ip).join(', ')||'sem IP'}) — o IKE sai com o IP da interface de saída`);
    const ps=(psks.find(p=>p.ids.includes(peer)||p.ids.includes(i2ip(peerIp||0)))||psks.find(p=>!p.ids.length||p.ids.includes('%any'))||{}).psk||'';const ik=ikeParse(c.ike);
    return{name:c.name,kind:'ipsec',peer:peerIp!==null?i2ip(peerIp):String(peer||''),local:left,psk:ps,ike:/ikev1/.test(c.keyexchange||'')?'v1':'v2',enc:ik.enc||'aes256',hash:ik.hash||'sha256',dh:ik.dh||'14',lnets:(c.leftsubnet||'').replace(/,/g,' '),rnets:(c.rightsubnet||'').replace(/,/g,' '),shut:c.auto==='ignore',auto:c.auto||'start'}});
  d.vpns=[...(d.vpns||[]).filter(t=>t.kind!=='ipsec'),...out];warn.forEach(w=>io.out(w,'dim'));io.changed();return 0}
function ipsecStatus(io,all){vpnStates();const L=(VPNS[io.d.id]||[]).filter(s=>s.t.kind==='ipsec');const up=L.filter(s=>s.state==='UP');const me=l3ifs(io.d).find(f=>!f.mgmt);const mi=me?i2ip(me.c.ip):'%any';
  if(all){io.out(`Status of IKE charon daemon (strongSwan 5.9.13, Linux ${io.o.kernel}, x86_64):\n  uptime: 3 minutes, since Oct 15 12:00:00 2026\nListening IP addresses:\n  ${l3ifs(io.d).filter(f=>!f.mgmt).map(f=>i2ip(f.c.ip)).join('\n  ')}\nConnections:`);L.forEach(s=>io.raw(`${s.t.name.padStart(12)}:  ${s.t.local||mi}...${s.t.peer}  IKE${s.t.ike==='v1'?'v1':'v2'}\n${s.t.name.padStart(12)}:   local:  [${s.t.local||mi}] uses pre-shared key authentication\n${s.t.name.padStart(12)}:   remote: [${s.t.peer}] uses pre-shared key authentication\n${s.t.name.padStart(12)}:   child:  ${netsOf(s.t.lnets).map(netStr).join(' ')} === ${netsOf(s.t.rnets).map(netStr).join(' ')} TUNNEL`))}
  io.out(`Security Associations (${up.length} up, ${L.length-up.length} connecting):`);if(!L.length)io.raw('  none');
  L.forEach((s,i)=>{const n=s.t.name;if(s.state==='UP'){io.raw(`${n.padStart(12)}[${i+1}]: ESTABLISHED 3 minutes ago, ${s.t.local||mi}[${s.t.local||mi}]...${s.t.peer}[${s.t.peer}]\n${n.padStart(12)}{${i+1}}:  INSTALLED, TUNNEL, reqid ${i+1}, ESP SPIs: c${(hsh(n)>>>0).toString(16).slice(0,7)}_i c${(hsh(n+'o')>>>0).toString(16).slice(0,7)}_o\n${n.padStart(12)}{${i+1}}:   ${netsOf(s.t.lnets).map(netStr).join(' ')} === ${netsOf(s.t.rnets).map(netStr).join(' ')}`)}
    else{io.raw(`${n.padStart(12)}[${i+1}]: CONNECTING, ${s.t.local||mi}[%any]...${s.t.peer}[%any]`);io.out(`   ↳ ${s.why}`,'err')}});return 0}
LX.ipsec=io=>{const d=io.d;const a=io.argv.slice(1);const op=(a[0]||'').replace(/^--/,'');
  if(io.argv[0]==='ipsec'&&op==='')return(io.out('Usage: ipsec start|stop|restart|reload|up <conn>|down <conn>|status|statusall|version'),0);
  if(/^(list-sas|list-conns)$/.test(op))return ipsecStatus(io,op==='list-conns');
  if(op==='version'){io.out(`Linux strongSwan U5.9.13/K${io.o.kernel}\nUniversity of Applied Sciences Rapperswil, Switzerland`);return 0}
  const ss=Object.keys(d.svcs||{}).find(n=>/strongswan|^ipsec$/.test(n))||'strongswan-starter';
  if(/^(start|restart|reload|rereadall|rereadsecrets|update|load-all|load-conns)$/.test(op)){const r=ipsecLoad(io);if(r)return r;osSvcs(d)[ss]=Object.assign(osSvcs(d)[ss]||{enabled:true},{active:true});if(/start/.test(op))io.out(`Starting strongSwan 5.9.13 IPsec [starter]...`);io.changed();return 0}
  if(op==='stop'){if(d.svcs&&d.svcs[ss])d.svcs[ss].active=false;io.out('Stopping strongSwan IPsec...');io.changed();return 0}
  if(!svcOn(d,ss)){io.err('connecting to \'unix:///var/run/charon.ctl\' failed: No such file or directory\nfailed to connect to stroke socket \'/var/run/charon.ctl\'');io.out(`(o daemon está parado: ipsec start  ou  systemctl start ${ss})`,'dim');return 7}
  if(op==='status'||op==='statusall'||op==='initiate')return ipsecStatus(io,op==='statusall');
  if(op==='up'||op==='down'){const t=(d.vpns||[]).find(x=>x.kind==='ipsec'&&x.name===a[1]);if(!t){io.err(`no config named '${a[1]}'`);return 1}t.shut=op==='down';io.changed();if(op==='down'){io.out(`closing CHILD_SA ${t.name}{1}\nIKE_SA [1] closed successfully`);return 0}
    vpnStates();const s=(VPNS[d.id]||[]).find(x=>x.t===t);const me=l3ifs(d).find(f=>!f.mgmt);io.out(`initiating IKE_SA ${t.name}[1] to ${t.peer}\ngenerating IKE_SA_INIT request 0 [ SA KE No N(NATD_S_IP) N(NATD_D_IP) N(FRAG_SUP) ]\nsending packet: from ${me?i2ip(me.c.ip):'?'}[500] to ${t.peer}[500]`);
    if(s&&s.state==='UP'){io.out(`received packet: from ${t.peer}[500] to ${me?i2ip(me.c.ip):'?'}[500]\nauthentication of '${t.peer}' with pre-shared key successful\nIKE_SA ${t.name}[1] established between ${me?i2ip(me.c.ip):'?'}...${t.peer}\nCHILD_SA ${t.name}{1} established with SPIs c1a2b3c4_i c5d6e7f8_o and TS ${netsOf(t.lnets).map(netStr).join(' ')} === ${netsOf(t.rnets).map(netStr).join(' ')}\nconnection '${t.name}' established successfully`);return 0}
    const w=s?s.why:'?';io.out(/AUTH/.test(w)?`received AUTHENTICATION_FAILED notify error\nestablishing connection '${t.name}' failed`:/PROPOSAL/.test(w)?`received NO_PROPOSAL_CHOSEN notify error\nestablishing connection '${t.name}' failed`:/TS_UN/.test(w)?`received TS_UNACCEPTABLE notify, no CHILD_SA built\nestablishing connection '${t.name}' failed`:`retransmit 1 of request with message ID 0\nretransmit 2 of request with message ID 0\ngiving up after 5 retransmits\nestablishing IKE_SA failed, peer not responding\nestablishing connection '${t.name}' failed`,'err');io.out('motivo: '+w,'err');return 1}
  io.err(`ipsec: unknown command '${op}'`);return 1};
/* ---------- WireGuard ---------- */
function wgKey(){let s='';for(let i=0;i<32;i++)s+=String.fromCharCode(Math.floor(Math.random()*256));return typeof btoa!=='undefined'?btoa(s):Buffer.from(s,'binary').toString('base64')}
function wgUp(io,name,quiet){const d=io.d;if(!hasPkg(d,'wireguard-tools')){io.err('wg-quick: command not found');return 127}const p=`/etc/wireguard/${name}.conf`;const t=fsRead(d,p);if(t==null){io.err(`wg-quick: \`${p}' does not exist`);return 1}
  let sec='',I={},Pe={};t.split('\n').forEach(l=>{const x=l.replace(/#.*/,'').trim();if(!x)return;const s=x.match(/^\[(\w+)\]$/);if(s){sec=s[1].toLowerCase();return}const m=x.match(/^(\w+)\s*=\s*(.+)$/);if(!m)return;(sec==='peer'?Pe:I)[m[1].toLowerCase()]=m[2].trim()});
  if(!I.privatekey){io.err(`Line unrecognized / PrivateKey ausente em ${p}`);return 1}if(!Pe.publickey){io.err(`[Peer] sem PublicKey em ${p}`);return 1}
  const ep=String(Pe.endpoint||'');const[eh,epp]=ep.split(':');let peer=eh;if(eh&&ip2i(eh)===null){const r=dnsQuery(d,eh);peer=r.ip!=null?i2ip(r.ip):eh}
  const v={name,kind:'wireguard',key:I.privatekey,addr:(I.address||'').split(',')[0].trim(),port:+I.listenport||51820,peer:peer||'',pport:+epp||51820,peerKey:Pe.publickey,rnets:(Pe.allowedips||'').replace(/,/g,' '),lnets:(I.address||'').split(',')[0].trim(),shut:false};
  d.vpns=[...(d.vpns||[]).filter(x=>!(x.kind==='wireguard'&&x.name===name)),v];osSvcs(d)[`wg-quick@${name}`]=Object.assign(osSvcs(d)[`wg-quick@${name}`]||{enabled:false},{active:true});
  if(!quiet)io.out(`[#] ip link add ${name} type wireguard\n[#] wg setconf ${name} /dev/fd/63\n${v.addr?`[#] ip -4 address add ${v.addr} dev ${name}\n`:''}[#] ip link set mtu 1420 up dev ${name}\n${netsOf(v.rnets).map(c=>`[#] ip -4 route add ${netStr(c)} dev ${name}`).join('\n')}`);if(!peer)io.out('(sem Endpoint: este lado só responde — o outro precisa ter o Endpoint)','dim');io.changed();return 0}
function wgDown(io,name){const t=(io.d.vpns||[]).find(x=>x.kind==='wireguard'&&x.name===name);if(t)t.shut=true;const s=(io.d.svcs||{})[`wg-quick@${name}`];if(s)s.active=false;io.changed()}
LX['wg-quick']=io=>{const[op,n]=io.argv.slice(1);const name=(n||'wg0').replace(/^.*\//,'').replace(/\.conf$/,'');if(op==='up'){const t=(io.d.vpns||[]).find(x=>x.kind==='wireguard'&&x.name===name&&!x.shut&&svcOn(io.d,'wg-quick@'+name));if(t){io.err(`wg-quick: \`${name}' already exists`);return 1}return wgUp(io,name)}
  if(op==='down'){if(!(io.d.vpns||[]).some(x=>x.kind==='wireguard'&&x.name===name&&!x.shut)){io.err(`wg-quick: \`${name}' is not a WireGuard interface`);return 1}wgDown(io,name);io.out(`[#] ip link delete dev ${name}`);return 0}io.out('Usage: wg-quick [ up | down ] [ CONFIG_FILE | INTERFACE ]','dim');return 1};
LX.wg=io=>{const a=io.argv.slice(1);const op=a[0]||'show';if(op==='genkey'){io.out(wgKey());return 0}if(op==='genpsk'){io.out(wgKey());return 0}if(op==='pubkey'){const k=String(io.stdin||'').trim();if(!k){io.err('wg: Failed to read private key from stdin (use: wg genkey | wg pubkey  ou  wg pubkey < privatekey)');return 1}io.out(wgPub(k));return 0}
  if(op==='show'||op==='showconf'){vpnStates();const L=(VPNS[io.d.id]||[]).filter(s=>s.t.kind==='wireguard'&&!s.t.shut&&(!a[1]||s.t.name===a[1]));if(!L.length)return 0;
    L.forEach(s=>{const t=s.t;if(op==='showconf'){io.out(wgConfText(io.d,t.name));return}io.out(`interface: ${t.name}\n  public key: ${wgPub(t.key||'')}\n  private key: (hidden)\n  listening port: ${t.port||51820}\n\npeer: ${t.peerKey||'(sem chave)'}\n  endpoint: ${t.peer}:${t.pport||51820}\n  allowed ips: ${netsOf(t.rnets).map(netStr).join(', ')}${s.state==='UP'?`\n  latest handshake: ${5+hsh(t.name)%50} seconds ago\n  transfer: ${(1+hsh(t.key||'')%90)/10} KiB received, ${(1+hsh(t.peerKey||'')%90)/10} KiB sent\n  persistent keepalive: every 25 seconds`:''}`);if(s.state!=='UP')io.out(`  (sem handshake: ${s.why})`,'err')});return 0}
  io.out('Usage: wg <cmd> [<args>]\n  show · showconf · genkey · genpsk · pubkey','dim');return 1};
/* endereços de túnel (WireGuard Address) ficam como IP secundário da 1ª interface */
function tunAddrs(d){return(d.vpns||[]).filter(t=>t.kind==='wireguard'&&!t.shut&&t.addr&&pc(t.addr)).map(t=>pc(t.addr).ip)}

/* ---------- Docker (simulado) ---------- */
LX.docker=io=>{const d=io.d;const a=io.argv.slice(1);const op=a[0]||'';const P=io.podman?'podman':'docker';
  if(op==='version'||op==='-v'||op==='--version'){io.out(io.podman?'podman version 4.9.3':'Docker version 26.1.3, build b72abbb');return 0}
  if(!io.podman&&!svcOn(d,'docker')){io.err('Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?');io.out('(systemctl start docker)','dim');return 1}
  const C=d.dockers=d.dockers||[];const find=x=>C.find(c=>c.name===x||c.id.startsWith(x));
  const imgOf=s=>s.includes(':')?s:s+':latest';
  if(op==='ps'){const all=a.includes('-a')||a.includes('--all');io.out('CONTAINER ID   IMAGE          COMMAND                  CREATED         STATUS          PORTS                                   NAMES');C.filter(c=>all||c.state==='running').forEach(c=>io.raw(`${c.id.slice(0,12)}   ${c.image.padEnd(14)} "${(c.cmd||'/docker-entrypoint.…').slice(0,22)}"   2 minutes ago   ${(c.state==='running'?'Up 2 minutes':'Exited (0) 1 minute ago').padEnd(15)} ${(c.ports||[]).map(([h,ct,pr])=>`0.0.0.0:${h}->${ct}/${pr||'tcp'}`).join(', ').padEnd(39)} ${c.name}`));C.filter(c=>(all||c.state==='running')&&c.real&&c.real!=='ok').forEach(c=>io.out(`(${c.name}: ${c.real==='iniciando'?'subindo de verdade no Docker deste computador — baixando a imagem…':c.real==='parado'?'container real parado':'NÃO está rodando de verdade — '+(c.realErr||'erro')})`,c.real==='erro'?'err':'dim'));C.filter(c=>(all||c.state==='running')&&!c.real&&(c.ports||[]).length).forEach(c=>io.out(`(${c.name}: simulado — docker restart ${c.name} para rodar de verdade)`,'dim'));return 0}
  if(op==='images'){io.out('REPOSITORY   TAG       IMAGE ID       CREATED       SIZE');(d.dimages||[]).forEach(i=>io.raw(`${i.split(':')[0].padEnd(12)} ${i.split(':')[1].padEnd(9)} ${(hsh(i)>>>0).toString(16).padEnd(12,'0').slice(0,12)}   2 weeks ago   ${50+hsh(i)%150}MB`));return 0}
  const pull=img=>{img=imgOf(img);if((d.dimages||[]).includes(img))return 0;const net=repoReach({...io,o:{...io.o,fam:'apk'}});if(!net.ok){io.err(`Error response from daemon: Get "https://registry-1.docker.io/v2/": ${net.conn?'dial tcp: i/o timeout':'dial tcp: lookup registry-1.docker.io: Temporary failure in name resolution'}`);io.out('motivo: '+net.why,'err');return 125}
    io.out(`Unable to find image '${img}' locally\n${img.split(':')[1]}: Pulling from library/${img.split(':')[0]}\n${(hsh(img)>>>0).toString(16).slice(0,12)}: Pull complete\nDigest: sha256:${(hsh(img+'d')>>>0).toString(16)}${(hsh(img+'e')>>>0).toString(16)}\nStatus: Downloaded newer image for ${img}`);(d.dimages=d.dimages||[]).push(img);return 0};
  if(op==='pull'){const r=pull(a[1]||'');return r}
  if(op==='run'){const{f,pos}=flagsOf(['run',...a.slice(1)],'p=-name=e=v=-restart=-network=h=w=-publish=u=-user=-entrypoint=-workdir=-mount=-hostname=-env=-volume=-net=-env-file=-memory=m=-cpus=-label=l=');const img=pos[0];if(!img){io.err(`"${P} run" requires at least 1 argument.`);return 125}const r=pull(img);if(r)return r;
    const ports=[];const addP=spec=>{const m=String(spec||'').match(/^(?:\d+\.\d+\.\d+\.\d+:|\[[^\]]*\]:)?(?:(\d+)(?:-(\d+))?:)?(\d+)(?:-(\d+))?(?:\/(tcp|udp))?$/);if(!m)return;const c0=+m[3],c1=+(m[4]||m[3]);const h0=m[1]?+m[1]:c0;const pr=m[5]||'tcp';for(let k=0;k<=c1-c0&&k<1000;k++)ports.push(pr==='udp'?[h0+k,c0+k,'udp']:[h0+k,c0+k])};
    a.forEach((x,i)=>{if(x==='-p'||x==='--publish')addP(a[i+1]);else if(/^--publish=/.test(x))addP(x.slice(10));else if(/^-p\d/.test(x))addP(x.slice(2))});
    const pubAll=a.includes('-P')||a.includes('--publish-all')||a.some((x,i)=>(x==='--network'||x==='--net')&&a[i+1]==='host')||a.includes('--network=host')||a.includes('--net=host');
    for(const[h,,pr]of ports){if(listenRows(d).some(x=>x.proto===(pr||'tcp')&&+x.port===h)){io.err(`docker: Error response from daemon: driver failed programming external connectivity: Bind for 0.0.0.0:${h} failed: port is already allocated.`);return 125}}
    const name=f.name||(['bold','eager','happy','jolly','brave'][hsh(img+C.length)%5]+'_'+['turing','hopper','lovelace','knuth','ritchie'][hsh(img)%5]);if(find(name)){io.err(`docker: Error response from daemon: Conflict. The container name "/${name}" is already in use.`);return 125}
    const id=Array.from({length:8},(_,i)=>(hsh(name+img+i)>>>0).toString(16).padStart(8,'0')).join('');const env=[];a.forEach((x,i)=>{if(x==='-e'||x==='--env'){if(a[i+1])env.push(String(a[i+1]))}else if(/^--env=/.test(x))env.push(x.slice(6))});
    const vols=[];a.forEach((x,i)=>{if(x==='-v'||x==='--volume'){if(a[i+1])vols.push(String(a[i+1]))}else if(/^--volume=/.test(x))vols.push(x.slice(9))});
    const c={id,name,image:imgOf(img),ports,env,pubAll,vols,user:f.u||f.user||'',entry:f.entrypoint||'',workdir:f.w||f.workdir||'',state:'running',restart:f.restart||'no',cmd:pos.slice(1).join(' '),args:pos.slice(1)};C.push(c);io.out(id);
    if(io.ctx.ctApp){c.real='iniciando';io.ctx.ctApp('run',d,c);io.out(`(subindo o container DE VERDADE no Docker deste computador — a primeira vez baixa a imagem ${c.image}; acompanhe com "docker ps")`,'dim')}
    else if(ports.length)io.out('(container simulado: responde, mas não roda a aplicação. Com o Docker instalado neste computador, abra a bancada pelo executável e ele roda de verdade)','dim');if(!f.d&&!f.detach&&!f.rm)io.out('(rodando em segundo plano)','dim');if(io.o.fw==='ufw'&&hostFw(d).on&&ports.length)io.out('(atenção: portas publicadas pelo Docker passam por fora do ufw)','dim');io.changed();return 0}
  if(/^(stop|start|restart|kill|rm|logs|inspect|exec|port)$/.test(op)){const ids=a.slice(1).filter(x=>!x.startsWith('-'));const force=a.includes('-f');let rc=0;
    for(const x of ids){const c=find(x);if(!c){io.err(`Error response from daemon: No such container: ${x}`);rc=1;continue}
      if(op==='stop'||op==='kill'){c.state='exited';if(c.real&&io.ctx.ctApp)io.ctx.ctApp('stop',d,c);io.out(x)}else if(op==='start'||op==='restart'){c.state='running';if(io.ctx.ctApp){const fresh=!c.real||c.real==='erro'||c.real==='iniciando';if(fresh)c.real='iniciando';io.ctx.ctApp(fresh?'run':'start',d,c);if(fresh)io.out('(subindo o container DE VERDADE no Docker deste computador — a primeira vez baixa a imagem)','dim')}io.out(x)}else if(op==='rm'){if(c.state==='running'&&!force){io.err(`Error response from daemon: cannot remove container "/${c.name}": container is running: stop the container before removing or force remove`);rc=1;continue}if(c.real&&io.ctx.ctApp)io.ctx.ctApp('rm',d,c);d.dockers=C.splice(C.indexOf(c),1)&&C;io.out(x)}
      else if(op==='logs')io.out(c.real?`(container real: ${c.real==='ok'?'rodando no Docker deste computador — veja os logs com docker logs '+(c.rname||c.name)+' no seu PC':c.real==='erro'?'erro: '+(c.realErr||''):'iniciando (baixando a imagem)…'})`:/nginx/.test(c.image)?'/docker-entrypoint.sh: Configuration complete; ready for start up\n2026/10/15 12:00:00 [notice] 1#1: start worker processes':`(${c.image}: sem logs)`);
      else if(op==='inspect')io.out(JSON.stringify([{Id:c.id,Name:'/'+c.name,State:{Status:c.state,Running:c.state==='running'},Config:{Image:c.image},NetworkSettings:{IPAddress:`172.17.0.${2+C.indexOf(c)}`,Ports:Object.fromEntries((c.ports||[]).map(([h,ct,pr])=>[ct+'/'+(pr||'tcp'),[{HostIp:'0.0.0.0',HostPort:String(h)}]]))}}],null,2));
      else if(op==='port')(c.ports||[]).forEach(([h,ct,pr])=>io.raw(`${ct}/${pr||'tcp'} -> 0.0.0.0:${h}`));
      else if(op==='exec')io.out('(exec dentro de container simulado não é suportado — ative o "container real" no host para isso)','dim');break}io.changed();return rc}
  if(op==='network'){io.out('NETWORK ID     NAME      DRIVER    SCOPE\n2b7c8a1f0e3d   bridge    bridge    local\n9f3e2d1c0b4a   host      host      local\n1a2b3c4d5e6f   none      null      local');return 0}
  if(op==='info'){io.out(`Server:\n Containers: ${C.length}\n  Running: ${C.filter(c=>c.state==='running').length}\n Images: ${(d.dimages||[]).length}\n Server Version: 26.1.3\n Storage Driver: overlay2\n Operating System: ${io.o.name}\n Kernel Version: ${io.o.kernel}`);return 0}
  if(op==='compose'){io.out('(docker compose não é simulado — use docker run)','dim');return 1}
  io.out(`Usage:  ${P} [OPTIONS] COMMAND\n  run · ps [-a] · images · pull · stop · start · rm · logs · inspect · port · network ls`,'dim');return 1};

/* ---------- Kubernetes / OpenShift ---------- */
function kubeCmd(io){const d=io.d;const c=clusterOf(d);const tool=io.argv[0];
  if(!c||c===d){io.err(`E1015 12:00:00.000000    1234 memcache.go:265] couldn't get current server API group list: Get "http://localhost:8080/api?timeout=32s": dial tcp 127.0.0.1:8080: connect: connection refused\nThe connection to the server localhost:8080 was refused - did you specify the right host or port?`);io.out('(rode kubectl/oc em um nó de um cluster Kubernetes/OpenShift da bancada)','dim');return 1}
  if(!isCP(d)){const api=k8sApiIp(c);if(api!=null&&!['version','help'].includes(io.argv[1])){const r=simulate(d.id,i2ip(api),'tcp',6443);if(!r.ok){io.err(`Unable to connect to the server: dial tcp ${i2ip(api)}:6443: i/o timeout`);io.out('motivo: '+r.why,'err');return 1}}}
  if(io.argv[1]==='debug'){const tg=String(io.argv.slice(2).find(x=>/^(node\/|no\/)/.test(x))||'').replace(/^(node|no)\//,'');if(!tg){io.err('error: debug requer um alvo, ex.: '+tool+' debug node/'+(k8sNodes(c)[0]||{name:'no'}).name.toLowerCase());return 1}
    const nd=k8sNodes(c).find(n=>n.name.toLowerCase()===tg.toLowerCase());if(!nd){io.err(`Error from server (NotFound): nodes "${tg}" not found`);return 1}
    const pod=`${nd.name.toLowerCase()}-debug-${(hsh(nd.name+Date.now())>>>0).toString(36).slice(0,5)}`;io.out(`Temporary namespace openshift-debug-${pod.slice(-5)} is created for debugging node...\nStarting pod/${pod} ...\nTo use host binaries, run \`chroot /host\`\nPod IP: ${i2ip(nodeIp(nd)??0)}\nIf you don't see a command prompt, try pressing enter.`);
    io.res.open={dev:nd.id,host:nd.name,user:'root',from:i2ip(nodeIp(d)??0)};return 0}
  const out=k8sCmd(c,io.st,io.argv,io.argv.join(' '),p=>p==='-'?(io.stdin??null):fsRead(d,io.path(p)));if(out)out.split('\n').forEach(l=>/^(error|Error)/.test(l)?io.err(l):io.raw(l));io.changed();return/^(error|Error)/m.test(out||'')?1:0}
LX.kubectl=kubeCmd;LX.oc=kubeCmd;LX.k=kubeCmd;
LX.crictl=io=>{const c=clusterOf(io.d);io.out('CONTAINER           IMAGE               CREATED             STATE               NAME');if(c)podsOf(c).filter(p=>p.node===io.d).forEach(p=>io.raw(`${(hsh(p.name)>>>0).toString(16).padEnd(20,'0').slice(0,13)}       ${p.dp.image.slice(0,18).padEnd(20)}12 minutes ago      Running             ${p.dp.name}`));return 0};

/* ====================== Windows / PowerShell ====================== */
const winIfs=d=>d.ports.map((p,k)=>isMgmt(d,k)?null:k).filter(k=>k!==null);
const winAlias=(d,k)=>{const i=winIfs(d).indexOf(k);return i<=0?'Ethernet':'Ethernet '+(i+1)};
const winK=(d,alias)=>{alias=String(alias||'').replace(/^["']|["']$/g,'').toLowerCase();return winIfs(d).find(k=>winAlias(d,k).toLowerCase()===alias||spn(d,k).toLowerCase()===alias||String(10+winIfs(d).indexOf(k))===alias)};
const WSVC={Dhcp:'DHCP Client',Dnscache:'DNS Client',EventLog:'Windows Event Log',LanmanServer:'Server',LanmanWorkstation:'Workstation',MpsSvc:'Windows Defender Firewall',W32Time:'Windows Time',Spooler:'Print Spooler',TermService:'Remote Desktop Services',WinRM:'Windows Remote Management (WS-Management)',W3SVC:'World Wide Web Publishing Service',DNS:'DNS Server',DHCPServer:'DHCP Server',sshd:'OpenSSH SSH Server','ssh-agent':'OpenSSH Authentication Agent',WireGuardTunnel:'WireGuard Tunnel'};
const WFEAT={'web-server':{n:'Web-Server',dn:'Web Server (IIS)',svc:'W3SVC',srv:true},'iis-webserverrole':{n:'IIS-WebServerRole',dn:'Internet Information Services',svc:'W3SVC'},'iis-webserver':{n:'IIS-WebServerRole',dn:'Internet Information Services',svc:'W3SVC'},dns:{n:'DNS',dn:'DNS Server',svc:'DNS',srv:true},dhcp:{n:'DHCP',dn:'DHCP Server',svc:'DHCPServer',srv:true},'rsat-ad-tools':{n:'RSAT-AD-Tools',dn:'AD DS and AD LDS Tools',srv:true},'ad-domain-services':{n:'AD-Domain-Services',dn:'Active Directory Domain Services',srv:true},'telnet-client':{n:'Telnet-Client',dn:'Telnet Client'},'hyper-v':{n:'Hyper-V',dn:'Hyper-V',srv:true}};
function wArgs(argv){const named={},pos=[];for(let i=1;i<argv.length;i++){const x=argv[i];const m=x.match(/^-([A-Za-z][\w]*)(?::(.*))?$/);if(m){const k=m[1].toLowerCase();if(m[2]!==undefined){named[k]=m[2];continue}const nx=argv[i+1];if(nx!==undefined&&!/^-[A-Za-z]/.test(nx)){const vals=[nx];i++;while(argv[i]&&argv[i].endsWith(',')&&argv[i+1]!==undefined){vals.push(argv[++i])}named[k]=vals.join('').replace(/,$/,'')}else named[k]=true}else pos.push(x)}return{n:named,pos}}
const wTable=(io,hd,rows)=>{if(!rows.length)return;const w=hd.map((h,i)=>Math.max(h.length,...rows.map(r=>String(r[i]).length)));io.raw('');io.raw(hd.map((h,i)=>h.padEnd(w[i])).join(' '));io.raw(hd.map((h,i)=>'-'.repeat(h.length).padEnd(w[i])).join(' '));rows.forEach(r=>io.raw(r.map((x,i)=>String(x).padEnd(w[i])).join(' ').trimEnd()));io.raw('')};
const wList=(io,objs)=>{io.raw('');objs.forEach(o=>{const w=Math.max(...Object.keys(o).map(k=>k.length));Object.entries(o).forEach(([k,v])=>io.raw(`${k.padEnd(w)} : ${v}`));io.raw('')})};
const wErr=(io,cmd,msg,cat='InvalidArgument')=>{io.err(`${cmd} : ${msg}\n    + CategoryInfo          : ${cat}: (:) [${cmd}], Exception\n    + FullyQualifiedErrorId : ${cat},${cmd}`);return 1};
const WX={};const WAL={ls:'get-childitem',dir:'get-childitem',gci:'get-childitem',cd:'set-location',sl:'set-location',chdir:'set-location',pwd:'get-location',gl:'get-location',type:'get-content',cat:'get-content',gc:'get-content',echo:'write-output','write-host':'write-output',write:'write-output',del:'remove-item',rm:'remove-item',erase:'remove-item',rmdir:'remove-item',rd:'remove-item',copy:'copy-item',cp:'copy-item',move:'move-item',mv:'move-item',ren:'rename-item',md:'mkdir',ni:'new-item',cls:'clear-host',clear:'clear-host',
  iwr:'invoke-webrequest',curl:'invoke-webrequest',wget:'invoke-webrequest',irm:'invoke-restmethod',tnc:'test-netconnection',gsv:'get-service',sasv:'start-service',spsv:'stop-service',ps:'get-process',gps:'get-process',tasklist:'get-process',sls:'select-string',findstr:'select-string',ft:'format-table',fl:'format-list','format-table':'passthru','format-list':'passthru','select-object':'passthru',select:'passthru','sort-object':'passthru',sort:'passthru','out-host':'passthru',more:'passthru','out-string':'passthru',where:'passthru','where-object':'passthru','?':'passthru','measure-object':'passthru',
  'get-help':'help',man:'help','ping.exe':'ping','tracert.exe':'tracert','nslookup.exe':'nslookup','ipconfig.exe':'ipconfig','hostname.exe':'hostname','whoami.exe':'whoami','route.exe':'route','netsh.exe':'netsh','notepad.exe':'notepad','curl.exe':'curl.exe','ssh.exe':'ssh','exit':'exit','restart-computer':'restart-computer','shutdown':'restart-computer','gip':'get-netipconfiguration','tracert':'tracert','tree':'tree'};
function winCmd(io){let c=io.argv[0].toLowerCase();if(WAL[c])c=WAL[c];if(WAL[c]&&!WX[c])c=WAL[c];const f=WX[c];
  if(!f){io.err(`${io.argv[0]} : O termo '${io.argv[0]}' não é reconhecido como nome de cmdlet, função, arquivo de script ou programa operável.\nVerifique a grafia do nome ou, se um caminho tiver sido incluído, veja se o caminho está correto e tente novamente.\n    + CategoryInfo          : ObjectNotFound: (${io.argv[0]}:String) [], CommandNotFoundException`);if(/^(apt|apt-get|dnf|yum|systemctl|ip|ifconfig|sudo|grep|ls)$/.test(c))io.out('(isto é PowerShell no Windows — digite help)','dim');return 1}
  return f(io)}
WX.help=io=>{io.out(`PowerShell simulado — ${io.o.name}
  rede     ipconfig [/all] · Get-NetIPAddress · Get-NetAdapter · Get-NetIPConfiguration
           New-NetIPAddress -InterfaceAlias "Ethernet" -IPAddress 10.0.0.10 -PrefixLength 24 -DefaultGateway 10.0.0.1
           Remove-NetIPAddress -InterfaceAlias "Ethernet" -Confirm:$false · Set-DnsClientServerAddress -InterfaceAlias "Ethernet" -ServerAddresses 8.8.8.8
           netsh interface ip set address "Ethernet" static 10.0.0.10 255.255.255.0 10.0.0.1 · route print · route add 10.2.0.0 mask 255.255.0.0 10.0.0.254
           ping · tracert · Test-NetConnection host -Port 80 · nslookup · Resolve-DnsName · Invoke-WebRequest http://… · curl.exe · ssh · netstat -an
  firewall Get-NetFirewallProfile · Set-NetFirewallProfile -Profile Domain,Public,Private -Enabled False
           New-NetFirewallRule -DisplayName "Web" -Direction Inbound -Protocol TCP -LocalPort 80 -Action Allow
           New-NetFirewallRule -DisplayName "ICMP" -Protocol ICMPv4 -IcmpType 8 -Action Allow · Get-NetFirewallRule · Remove-NetFirewallRule -DisplayName X
  serviços Get-Service · Start-Service · Stop-Service · Set-Service -Name X -StartupType Automatic
  recursos ${io.d.os==='windows-server-2022'?'Install-WindowsFeature Web-Server -IncludeManagementTools · Install-WindowsFeature DNS,DHCP · Get-WindowsFeature\n           Add-DnsServerPrimaryZone -Name lab.local -ZoneFile lab.local.dns · Add-DnsServerResourceRecordA -ZoneName lab.local -Name www -IPv4Address 10.0.0.20':'Enable-WindowsOptionalFeature -Online -FeatureName IIS-WebServerRole'}
           Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0 · winget install WireGuard.WireGuard · wireguard /installtunnelservice C:\\wg0.conf
  arquivos dir · cd · type · Set-Content arq -Value "texto" · New-Item · Remove-Item · notepad arquivo
  sistema  hostname · Rename-Computer -NewName X · systeminfo · whoami · Get-Process · Restart-Computer`);return 0};
WX['clear-host']=io=>{io.st.log.length=0;return 0};WX.exit=()=>0;WX.passthru=io=>{if(io.stdin)linesOf(io.stdin).forEach(x=>io.raw(x));return 0};
WX['select-string']=io=>{const{n,pos}=wArgs(io.argv);const pat=n.pattern||pos[0]||'';const re=new RegExp(String(pat).replace(/^["']|["']$/g,''),'i');linesOf(io.stdin||'').filter(l=>re.test(l)).forEach(l=>io.raw(l));return 0};
WX['out-file']=io=>{const{n,pos}=wArgs(io.argv);const p=io.path(n.filepath||n.path||pos[0]);fsWrite(io.d,p,(n.append?fsRead(io.d,p)||'':'')+(io.stdin||''));io.changed();return 0};
WX['write-output']=io=>{io.out(io.argv.slice(1).filter(x=>!/^-(NoNewline|ForegroundColor)$/i.test(x)).join(' '));return 0};
WX['get-location']=io=>{io.out(`\nPath\n----\n${(io.st.cwd||WIN_HOME).replace(/\//g,'\\')}\n`);return 0};
WX['set-location']=io=>{const t=wArgs(io.argv).pos[0]||wArgs(io.argv).n.path||WIN_HOME;const p=io.path(t==='\\'?'C:/':t);if(!fsIsDir(io.d,p))return wErr(io,'Set-Location',`Não é possível localizar o caminho '${p.replace(/\//g,'\\')}' porque ele não existe.`,'ObjectNotFound');io.st.cwd=p;return 0};
WX['get-childitem']=io=>{const{n,pos}=wArgs(io.argv);const p=io.path(n.path||pos[0]||'.');if(!fsIsDir(io.d,p)){const t=fsRead(io.d,p);if(t==null)return wErr(io,'Get-ChildItem',`Não é possível localizar o caminho '${p.replace(/\//g,'\\')}' porque ele não existe.`,'ObjectNotFound')}
  const it=fsIsDir(io.d,p)?fsList(io.d,p):[{n:p.split('/').pop(),dir:false,size:fsRead(io.d,p).length}];io.raw(`\n    Diretório: ${p.replace(/\//g,'\\')}\n\nMode                 LastWriteTime         Length Name\n----                 -------------         ------ ----`);it.forEach(x=>io.raw(`${x.dir?'d-----':'-a----'}        15/10/2026     12:00     ${x.dir?'      ':String(x.size).padStart(14)} ${x.n}`));io.raw('');return 0};
WX['get-content']=io=>{const{n,pos}=wArgs(io.argv);const fn=n.path||pos[0];const t=fsRead(io.d,io.path(fn||''));if(t==null)return wErr(io,'Get-Content',`Não é possível localizar o caminho '${io.path(fn||'').replace(/\//g,'\\')}' porque ele não existe.`,'ObjectNotFound');linesOf(t).forEach(l=>io.raw(l));return 0};
WX['set-content']=WX['add-content']=io=>{const{n,pos}=wArgs(io.argv);const p=io.path(n.path||pos[0]);const v=n.value??pos.slice(1).join(' ')??io.stdin;const add=io.argv[0].toLowerCase()==='add-content';fsWrite(io.d,p,(add?(fsRead(io.d,p)||''):'')+String(v)+'\n');io.changed();return 0};
WX['new-item']=io=>{const{n,pos}=wArgs(io.argv);const p=io.path(n.path||pos[0]||n.name);if(String(n.itemtype||'file').toLowerCase()==='directory')fsMkdir(io.d,p);else fsWrite(io.d,p,n.value||'');io.changed();io.raw(`\n    Diretório: ${p.slice(0,p.lastIndexOf('/')).replace(/\//g,'\\')}\n\nMode                 LastWriteTime         Length Name\n----                 -------------         ------ ----\n${String(n.itemtype||'').toLowerCase()==='directory'?'d-----':'-a----'}        15/10/2026     12:00                ${p.split('/').pop()}\n`);return 0};
WX.mkdir=io=>{io.argv=['New-Item','-ItemType','Directory','-Path',...io.argv.slice(1)];return WX['new-item'](io)};
WX['remove-item']=io=>{const{n,pos}=wArgs(io.argv);const p=io.path(n.path||pos[0]);if(fsIsDir(io.d,p))fsRmdir(io.d,p);else if(fsRead(io.d,p)!=null)fsRm(io.d,p);else return wErr(io,'Remove-Item',`Não é possível localizar o caminho '${p.replace(/\//g,'\\')}' porque ele não existe.`,'ObjectNotFound');io.changed();return 0};
WX['copy-item']=io=>{const{pos}=wArgs(io.argv);const t=fsRead(io.d,io.path(pos[0]));if(t==null)return wErr(io,'Copy-Item','arquivo não encontrado','ObjectNotFound');let dp=io.path(pos[1]);if(fsIsDir(io.d,dp))dp+='/'+pos[0].replace(/\\/g,'/').split('/').pop();fsWrite(io.d,dp,t);io.changed();return 0};
WX['move-item']=io=>{const r=WX['copy-item'](io);if(!r)fsRm(io.d,io.path(wArgs(io.argv).pos[0]));return r};WX['rename-item']=io=>{const{pos}=wArgs(io.argv);const p=io.path(pos[0]);const t=fsRead(io.d,p);if(t==null)return 1;fsWrite(io.d,p.slice(0,p.lastIndexOf('/'))+'/'+pos[1],t);fsRm(io.d,p);io.changed();return 0};
WX.notepad=io=>{const fn=wArgs(io.argv).pos[0];if(!fn){io.err('notepad: informe o arquivo');return 1}const p=io.path(fn);io.res.edit={dev:io.d.id,path:p,content:fsRead(io.d,p)??''};io.out(`(abrindo ${p.replace(/\//g,'\\')} no editor da bancada)`,'dim');return 0};
WX.tree=io=>{const walk=(p,pre)=>{fsList(io.d,p).filter(x=>x.dir).forEach((x,i,a)=>{io.raw(pre+(i===a.length-1?'└───':'├───')+x.n);walk(p.replace(/\/$/,'')+'/'+x.n,pre+(i===a.length-1?'    ':'│   '))})};io.raw((io.st.cwd||WIN_HOME).replace(/\//g,'\\'));walk(io.st.cwd||WIN_HOME,'');return 0};
WX.hostname=io=>{io.out(io.d.name.toUpperCase());return 0};WX.whoami=io=>{io.out(`${io.d.name.toLowerCase()}\\administrador`);return 0};
WX['rename-computer']=io=>{const{n,pos}=wArgs(io.argv);const nm=n.newname||pos[0];if(!nm)return wErr(io,'Rename-Computer','informe -NewName');const tmp={log:[]};hostRun(io.d,'hostname '+nm,tmp,io.ctx);if(tmp.log.length){tmp.log.forEach(x=>io.err(x.s));return 1}io.changed();if(!n.restart)io.out(`AVISO: As alterações entrarão em vigor depois que você reiniciar o computador ${nm.toUpperCase()}.`,'dim');return 0};
WX['restart-computer']=io=>{Object.values(io.d.svcs||{}).forEach(s=>s.active=!!s.enabled);io.changed();io.out('(o Windows reiniciou: serviços com inicialização Automática voltaram)','dim');return 0};
WX.systeminfo=WX['get-computerinfo']=io=>{const o=io.o;io.out(`\nNome do host:                              ${io.d.name.toUpperCase()}\nNome do sistema operacional:               Microsoft ${o.name}\nVersão do sistema operacional:             ${o.ver} N/A compilação ${o.ver.split('.').pop()}\nFabricante do sistema:                     ${(modelOf(io.d)||{}).vendor||'Microsoft Corporation'}\nMemória física total:                      ${memOf(io.d)*1024} MB\nPlaca(s) de Rede:                          ${winIfs(io.d).length} NIC(s) instalado(s).\n${winIfs(io.d).map((k,i)=>`                                           [0${i+1}]: Intel(R) Ethernet ${winAlias(io.d,k)}${pc(io.d.ports[k].ip)?'\n                                                 Endereço(s) IP: '+pc(io.d.ports[k].ip)&&i2ip(pc(io.d.ports[k].ip).ip):''}`).join('\n')}`);return 0};
WX.winver=io=>{io.out(io.o.name);return 0};WX['get-date']=io=>{io.out(new Date().toString());return 0};
WX['get-process']=io=>{wTable(io,['Handles','NPM(K)','PM(K)','WS(K)','CPU(s)','Id','SI','ProcessName'],['csrss','lsass','services','svchost','explorer','powershell',...Object.entries(io.d.svcs||{}).filter(([,s])=>s.active).map(([n])=>({W3SVC:'w3wp',DNS:'dns',sshd:'sshd',DHCPServer:'svchost'})[n]).filter(Boolean)].map(p=>[200+hsh(p)%900,10+hsh(p)%30,2000+hsh(p)%9000,8000+hsh(p+'w')%30000,(hsh(p)%100)/10,400+hsh(p)%9000,0,p]));return 0};
WX['get-netadapter']=io=>{wTable(io,['Name','InterfaceDescription','ifIndex','Status','MacAddress','LinkSpeed'],winIfs(io.d).map(k=>[winAlias(io.d,k),'Intel(R) Ethernet Controller X710',10+winIfs(io.d).indexOf(k),io.d.ports[k].shut?'Disabled':linkAt(io.d.id,k)?'Up':'Disconnected',macLinux(mac(io.d.id,'p'+k)).toUpperCase().replace(/:/g,'-'),linkAt(io.d.id,k)?'10 Gbps':'0 bps']));return 0};
WX['enable-netadapter']=WX['disable-netadapter']=io=>{const{n,pos}=wArgs(io.argv);const k=winK(io.d,n.name||pos[0]);if(k===undefined)return wErr(io,io.argv[0],'adaptador não encontrado','ObjectNotFound');io.d.ports[k].shut=/^disable/i.test(io.argv[0]);io.changed();return 0};
function winIpRows(d){return winIfs(d).map(k=>{const p=d.ports[k],c=pc(p.ip);return{k,alias:winAlias(d,k),c}})}
WX.ipconfig=io=>{const all=io.argv.some(x=>/^[/-]all$/i.test(x));if(io.argv.some(x=>/^[/-](renew|release)$/i.test(x))){io.out('Ocorreu um erro ao renovar a interface Ethernet: Não foi possível contatar o servidor DHCP. (a bancada usa IP estático)');return 1}
  if(io.argv.some(x=>/^[/-]flushdns$/i.test(x))){io.out('\nConfiguração de IP do Windows\n\nCache do DNS Resolver liberado com êxito.');return 0}
  io.out(`\nConfiguração de IP do Windows\n${all?`\n   Nome do host. . . . . . . . . . . . . . . : ${io.d.name.toUpperCase()}\n   Tipo de nó. . . . . . . . . . . . . . . . : híbrido\n   Roteamento de IP ativado. . . . . . . . . : não\n`:''}`);
  winIpRows(io.d).forEach(r=>{const up=linkAt(io.d.id,r.k)&&!io.d.ports[r.k].shut;io.raw(`\nAdaptador Ethernet ${r.alias}:\n`);if(!up){io.raw('   Estado da mídia. . . . . . . . . . . . . . : mídia desconectada');return}
    if(all)io.raw(`   Descrição . . . . . . . . . . . . . . . . : Intel(R) Ethernet Controller X710\n   Endereço Físico . . . . . . . . . . . . . : ${macLinux(mac(io.d.id,'p'+r.k)).toUpperCase().replace(/:/g,'-')}\n   DHCP Habilitado . . . . . . . . . . . . . : Não`);
    if(r.c)io.raw(`   Endereço IPv4. . . . . . . .  . . . . . . . : ${i2ip(r.c.ip)}${all?'(Preferencial)':''}\n   Máscara de Sub-rede . . . . . . . . . . . . : ${msk(r.c)}`);else io.raw('   Endereço IPv4 de Configuração Automática: 169.254.'+(hsh(io.d.id)%250+1)+'.'+(hsh(io.d.id+'x')%250+1));
    io.raw(`   Gateway Padrão. . . . . . . . . . . . . . . : ${r.c&&io.d.gw&&inNet(ip2i(io.d.gw)??0,r.c)?io.d.gw:''}`);if(all)io.raw(`   Servidores DNS. . . . . . . . . . . . . . . : ${io.d.dns||''}`)});tunAddrs(io.d).forEach(a=>{const t=(io.d.vpns||[]).find(x=>x.kind==='wireguard'&&!x.shut);io.raw(`\nAdaptador desconhecido ${t.name}:\n\n   Endereço IPv4. . . . . . . .  . . . . . . . : ${t.addr.split('/')[0]}\n   Máscara de Sub-rede . . . . . . . . . . . . : ${msk(pc(t.addr))}`)});return 0};
WX['get-netipaddress']=io=>{const{n}=wArgs(io.argv);const rows=winIpRows(io.d).filter(r=>r.c&&(!n.interfacealias||r.alias.toLowerCase()===String(n.interfacealias).toLowerCase()));wList(io,[...rows.map(r=>({IPAddress:i2ip(r.c.ip),InterfaceIndex:10+winIfs(io.d).indexOf(r.k),InterfaceAlias:r.alias,AddressFamily:'IPv4',Type:'Unicast',PrefixLength:r.c.len,PrefixOrigin:'Manual',SuffixOrigin:'Manual',AddressState:'Preferred'})),{IPAddress:'127.0.0.1',InterfaceIndex:1,InterfaceAlias:'Loopback Pseudo-Interface 1',AddressFamily:'IPv4',PrefixLength:8}]);return 0};
WX['get-netipconfiguration']=io=>{wList(io,winIpRows(io.d).map(r=>({InterfaceAlias:r.alias,InterfaceIndex:10+winIfs(io.d).indexOf(r.k),InterfaceDescription:'Intel(R) Ethernet Controller X710',IPv4Address:r.c?i2ip(r.c.ip):'',IPv4DefaultGateway:r.c&&io.d.gw&&inNet(ip2i(io.d.gw)??0,r.c)?io.d.gw:'',DNSServer:io.d.dns||''})));return 0};
WX['new-netipaddress']=io=>{const{n}=wArgs(io.argv);const k=winK(io.d,n.interfacealias||n.interfaceindex);if(k===undefined)return wErr(io,'New-NetIPAddress',`Nenhum objeto MSFT_NetIPInterface encontrado com a propriedade 'InterfaceAlias' igual a '${n.interfacealias||n.interfaceindex}'.`,'ObjectNotFound');
  const ip=n.ipaddress,len=+n.prefixlength;if(ip2i(ip)===null||!(len>=1&&len<=32))return wErr(io,'New-NetIPAddress','Parâmetros inválidos: informe -IPAddress e -PrefixLength (ex.: 24).');const p=io.d.ports[k];if(pc(p.ip)&&pc(p.ip).ip===ip2i(ip))return wErr(io,'New-NetIPAddress','O objeto já existe.','ResourceExists');
  if(n.defaultgateway&&io.d.gw&&io.d.gw!==n.defaultgateway)return wErr(io,'New-NetIPAddress','Instance DefaultGateway already exists (remova a rota 0.0.0.0/0 antes: Remove-NetRoute -DestinationPrefix 0.0.0.0/0)','ResourceExists');
  p.ip=`${ip}/${len}`;p.mode='routed';if(n.defaultgateway)io.d.gw=n.defaultgateway;io.changed();wList(io,[{IPAddress:ip,InterfaceIndex:10+winIfs(io.d).indexOf(k),InterfaceAlias:winAlias(io.d,k),AddressFamily:'IPv4',Type:'Unicast',PrefixLength:len,PrefixOrigin:'Manual',AddressState:'Tentative'}]);return 0};
WX['remove-netipaddress']=io=>{const{n,pos}=wArgs(io.argv);let k=n.interfacealias||n.interfaceindex?winK(io.d,n.interfacealias||n.interfaceindex):winIfs(io.d).find(k=>pc(io.d.ports[k].ip)&&i2ip(pc(io.d.ports[k].ip).ip)===(n.ipaddress||pos[0]));if(k===undefined)return wErr(io,'Remove-NetIPAddress','Nenhum objeto correspondente encontrado.','ObjectNotFound');const c=pc(io.d.ports[k].ip);io.d.ports[k].ip='';if(c&&io.d.gw&&inNet(ip2i(io.d.gw)??0,c)&&!l3ifs(io.d).some(f=>inNet(ip2i(io.d.gw),f.c)))io.d.gw='';io.changed();return 0};
WX['set-netipinterface']=WX['set-netipaddress']=io=>{if(/dhcp/i.test(io.argv.join(' '))&&/enabled/i.test(io.argv.join(' ')))io.out('(não há DHCP nesta bancada — configure IP estático)','dim');return 0};
WX['set-dnsclientserveraddress']=io=>{const{n}=wArgs(io.argv);const k=winK(io.d,n.interfacealias||n.interfaceindex);if(k===undefined)return wErr(io,'Set-DnsClientServerAddress','interface não encontrada','ObjectNotFound');if(n.resetserveraddresses){io.d.dns='';io.changed();return 0}const s=String(n.serveraddresses||'').replace(/[()"']/g,'').split(/[,\s]+/).filter(Boolean);if(!s.length||ip2i(s[0])===null)return wErr(io,'Set-DnsClientServerAddress','informe -ServerAddresses 8.8.8.8');io.d.dns=s[0];io.changed();return 0};
WX['get-dnsclientserveraddress']=io=>{wTable(io,['InterfaceAlias','Interface Index','Address Family','ServerAddresses'],winIpRows(io.d).map(r=>[r.alias,10+winIfs(io.d).indexOf(r.k),'IPv4',`{${io.d.dns||''}}`]));return 0};
WX['clear-dnsclientcache']=()=>0;
function winRoutes(d){const R=[];if(d.gw){const gf=l3ifs(d).find(f=>inNet(ip2i(d.gw)??0,f.c));R.push({dst:'0.0.0.0/0',nh:d.gw,k:gf?gf.k:null,m:256})}(d.routes||[]).forEach(r=>{const nh=ip2i(r.nh);const f=l3ifs(d).find(f=>nh!==null&&inNet(nh,f.c));R.push({dst:r.dst,nh:r.nh,k:f?f.k:null,m:256})});l3ifs(d).filter(f=>!f.mgmt).forEach(f=>R.push({dst:netStr(f.c),nh:'0.0.0.0',k:f.k,m:256,conn:true}));return R}
WX['get-netroute']=io=>{wTable(io,['ifIndex','DestinationPrefix','NextHop','RouteMetric','ifMetric','PolicyStore'],winRoutes(io.d).map(r=>[r.k!=null?10+winIfs(io.d).indexOf(r.k):1,r.dst,r.nh,r.m,25,'ActiveStore']));return 0};
WX['new-netroute']=io=>{const{n}=wArgs(io.argv);const x=pc(n.destinationprefix||'');if(!x||ip2i(n.nexthop)===null)return wErr(io,'New-NetRoute','informe -DestinationPrefix 10.2.0.0/16 -NextHop 10.0.0.254 -InterfaceAlias "Ethernet"');if(!l3ifs(io.d).some(f=>inNet(ip2i(n.nexthop),f.c)))return wErr(io,'New-NetRoute','O próximo salto não está em nenhuma rede conectada.');
  if(x.len===0){io.d.gw=n.nexthop}else{io.d.routes=(io.d.routes||[]).filter(r=>!(pc(r.dst)&&netStr(pc(r.dst))===netStr(x)));io.d.routes.push({dst:netStr(x),nh:n.nexthop})}io.changed();return 0};
WX['remove-netroute']=io=>{const{n}=wArgs(io.argv);const x=pc(n.destinationprefix||'');if(x&&x.len===0)io.d.gw='';else if(x)io.d.routes=(io.d.routes||[]).filter(r=>!(pc(r.dst)&&netStr(pc(r.dst))===netStr(x)));io.changed();return 0};
WX.route=io=>{const a=io.argv.slice(1).map(x=>x.toLowerCase());if(a[0]==='print'||!a[0]){io.out(`===========================================================================\nLista de interfaces\n${winIfs(io.d).map(k=>` ${10+winIfs(io.d).indexOf(k)}...${macLinux(mac(io.d.id,'p'+k)).replace(/:/g,' ')} ......Intel(R) Ethernet Controller X710`).join('\n')}\n  1...........................Software Loopback Interface 1\n===========================================================================\n\nTabela de rotas IPv4\n===========================================================================\nRotas ativas:\nDestino de rede    Máscara de rede      Gateway      Interface  Métrica`);
    winRoutes(io.d).forEach(r=>{const c=pc(r.dst);const f=r.k!=null&&l3ifs(io.d).find(f=>f.k===r.k);io.raw(`${i2ip(c.net).padStart(18)} ${msk(c).padStart(18)} ${(r.conn?'No vínculo':r.nh).padStart(16)} ${(f?i2ip(f.c.ip):'').padStart(15)}    ${r.m+25}`)});io.raw('===========================================================================\nRotas persistentes:\n'+((io.d.routes||[]).map(r=>`  ${r.dst}  ${r.nh}`).join('\n')||'  Nenhuma'));return 0}
  if(a[0]==='add'||(a[0]==='-p'&&a[1]==='add')){const b=a[0]==='-p'?a.slice(2):a.slice(1);const dst=b[0],mk=b[1]==='mask'?b[2]:'255.255.255.255',gw=b[1]==='mask'?b[3]:b[1];const l=maskLen(mk);if(ip2i(dst)===null||l===null||ip2i(gw)===null){io.err('A rota: parâmetro inválido.');return 1}if(!l3ifs(io.d).some(f=>inNet(ip2i(gw),f.c))){io.err('A adição da rota falhou: O parâmetro está incorreto.');return 1}
    if(l===0)io.d.gw=gw;else{const x=pc(`${dst}/${l}`);io.d.routes=(io.d.routes||[]).filter(r=>!(pc(r.dst)&&netStr(pc(r.dst))===netStr(x)));io.d.routes.push({dst:netStr(x),nh:gw})}io.out(' OK!');io.changed();return 0}
  if(a[0]==='delete'){const dst=a[1];if(dst==='0.0.0.0')io.d.gw='';else io.d.routes=(io.d.routes||[]).filter(r=>!(pc(r.dst)&&i2ip(pc(r.dst).net)===dst));io.out(' OK!');io.changed();return 0}io.out('route print | route [-p] add <rede> mask <máscara> <gateway> | route delete <rede>','dim');return 1};
WX.netsh=io=>{const a=io.argv.slice(1).map(x=>x.replace(/^name=/i,'').replace(/^"|"$/g,''));const L=a.map(x=>x.toLowerCase());const d=io.d;
  if(L[0]==='interface'&&/^ip(v4)?$/.test(L[1])&&L[2]==='set'&&L[3]==='address'){const k=winK(d,a[4]);if(k===undefined){io.err(`O nome de interface "${a[4]}" não é válido.`);return 1}const rest=L.slice(5).map(x=>x.replace(/^(source|address|mask|gateway)=/,''));if(rest[0]==='dhcp'){io.out('(não há DHCP nesta bancada)','dim');return 1}const ip=rest[1],mk=rest[2],gw=rest[3];const l=maskLen(mk);if(ip2i(ip)===null||l===null){io.err('Parâmetros inválidos.');return 1}d.ports[k].ip=`${ip}/${l}`;d.ports[k].mode='routed';if(gw&&ip2i(gw)!==null)d.gw=gw;io.changed();return 0}
  if(L[0]==='interface'&&/^ip(v4)?$/.test(L[1])&&L[2]==='set'&&/^dns(servers)?$/.test(L[3])){const s=L.slice(5).map(x=>x.replace(/^address=/,'')).find(x=>ip2i(x)!==null);if(s){d.dns=s;io.changed()}return 0}
  if(L[0]==='interface'&&/^ip(v4)?$/.test(L[1])&&L[2]==='show'){winIpRows(d).forEach(r=>io.raw(`\nConfiguração para interface "${r.alias}"\n    DHCP habilitado:                       Não\n    Endereço IP:                           ${r.c?i2ip(r.c.ip):''}\n    Prefixo de sub-rede:                   ${r.c?netStr(r.c)+' (máscara '+msk(r.c)+')':''}\n    Gateway padrão:                        ${r.c&&d.gw&&inNet(ip2i(d.gw)??0,r.c)?d.gw:''}`));return 0}
  if(L[0]==='advfirewall'&&L[1]==='set'&&/profiles?$/.test(L[2])&&L[3]==='state'){hostFwW(d).on=L[4]==='on';io.out('Ok.');io.changed();return 0}
  if(L[0]==='advfirewall'&&L[1]==='show'){io.out(`\nConfigurações de Perfil de Domínio/Particular/Público:\n----------------------------------------------------------------------\nEstado                                ${hostFw(d).on?'ATIVADO':'DESATIVADO'}\nPolítica de Firewall                  BlockInbound,AllowOutbound`);return 0}
  if(L[0]==='advfirewall'&&L[1]==='firewall'&&(L[2]==='add'||L[2]==='delete')&&L[3]==='rule'){const kv={};a.slice(4).forEach(x=>{const m=x.match(/^(\w+)=(.*)$/);if(m)kv[m[1].toLowerCase()]=m[2]});if(L[2]==='add'&&!kv.name&&a[4])kv.name=a[4];const fw=hostFwW(d);
    if(/icmpv4/i.test(kv.protocol||'')){fw.icmp=L[2]==='add'&&!/block/i.test(kv.action||'');io.out('Ok.');io.changed();return 0}const pr=String(kv.protocol||'tcp').toLowerCase();const ports=String(kv.localport||'any').split(',');
    if(L[2]==='add'){if(!/allow/i.test(kv.action||'allow')){io.out('Ok.');return 0}ports.forEach(p=>fw.allow.push([pr==='any'?'any':pr,p==='any'?'any':+p,kv.remoteip&&kv.remoteip!=='any'?kv.remoteip:'',kv.name||'Regra']))}else fw.allow=fw.allow.filter(x=>x[3]!==kv.name);io.out('Ok.');io.changed();return 0}
  io.out('netsh interface ip set address "Ethernet" static <ip> <máscara> <gw> · netsh interface ip set dns "Ethernet" static <dns> · netsh advfirewall set allprofiles state on|off · netsh advfirewall firewall add rule name=X dir=in action=allow protocol=TCP localport=80','dim');return 1};
WX['get-netfirewallprofile']=io=>{const on=hostFw(io.d).on;wList(io,['Domain','Private','Public'].map(p=>({Name:p,Enabled:on?'True':'False',DefaultInboundAction:'NotConfigured',DefaultOutboundAction:'NotConfigured',AllowInboundRules:'NotConfigured',LogAllowed:'False'})));return 0};
WX['set-netfirewallprofile']=io=>{const{n}=wArgs(io.argv);if(n.enabled!==undefined){hostFwW(io.d).on=/true|1/i.test(String(n.enabled).replace(/^\$/,''));io.changed()}return 0};
WX['new-netfirewallrule']=io=>{const{n}=wArgs(io.argv);const fw=hostFwW(io.d);const name=n.displayname||n.name||'Regra';const pr=String(n.protocol||'Any').toLowerCase();const dir=String(n.direction||'Inbound').toLowerCase();const act=String(n.action||'Allow').toLowerCase();
  if(dir!=='inbound'){io.out('(regras de saída não são filtradas nesta bancada)','dim')}else if(pr==='icmpv4'){if(act==='allow')fw.icmp=true;else fw.icmp=false}else if(act==='allow'){String(n.localport||'Any').split(/[,\s]+/).forEach(p=>fw.allow.push([pr==='any'?'any':pr,/^any$/i.test(p)?'any':+p,n.remoteaddress&&!/^any$/i.test(n.remoteaddress)?n.remoteaddress:'',name]))}
  else fw.allow=fw.allow.filter(x=>!(String(x[1])===String(n.localport)&&x[0]===pr));
  wList(io,[{Name:'{'+(hsh(name)>>>0).toString(16)+'-0000-4000-8000-'+(hsh(name+'b')>>>0).toString(16)+'}',DisplayName:name,Enabled:'True',Profile:'Any',Direction:dir==='inbound'?'Inbound':'Outbound',Action:act==='allow'?'Allow':'Block',PrimaryStatus:'OK'}]);io.changed();return 0};
WX['get-netfirewallrule']=io=>{const fw=hostFw(io.d);const R=(fw.allow||[]).map(x=>({DisplayName:x[3]||`Porta ${x[1]}/${x[0]}`,Enabled:'True',Direction:'Inbound',Action:'Allow',Protocol:String(x[0]).toUpperCase(),LocalPort:x[1]}));if(fw.icmp)R.push({DisplayName:'Compartilhamento de Arquivo e Impressora (Solicitação de Eco - ICMPv4-In)',Enabled:'True',Direction:'Inbound',Action:'Allow',Protocol:'ICMPv4',LocalPort:'RPC'});
  const{n}=wArgs(io.argv);wList(io,R.filter(r=>!n.displayname||r.DisplayName.toLowerCase()===String(n.displayname).toLowerCase()));return 0};
WX['remove-netfirewallrule']=io=>{const{n}=wArgs(io.argv);const fw=hostFwW(io.d);const b=fw.allow.length;fw.allow=fw.allow.filter(x=>(x[3]||'').toLowerCase()!==String(n.displayname||n.name||'').toLowerCase());if(b===fw.allow.length)return wErr(io,'Remove-NetFirewallRule','Nenhum objeto MSFT_NetFirewallRule encontrado.','ObjectNotFound');io.changed();return 0};
WX['enable-netfirewallrule']=WX['disable-netfirewallrule']=io=>{const{n}=wArgs(io.argv);const fw=hostFwW(io.d);const on=/^enable/i.test(io.argv[0]);const g=String(n.displaygroup||n.name||n.displayname||'').toLowerCase();
  if(/file and printer|compartilhamento|fps|icmp/.test(g)){fw.icmp=on;if(on&&!fwHas(fw.allow,['tcp',445,'']))fw.allow.push(['tcp',445,'','Compartilhamento de Arquivo e Impressora (SMB-In)']);if(!on)fw.allow=fw.allow.filter(x=>+x[1]!==445)}
  else if(/remote desktop|área de trabalho remota|rdp/.test(g)){if(on){if(!fwHas(fw.allow,['tcp',3389,'']))fw.allow.push(['tcp',3389,'','Área de Trabalho Remota (TCP-In)'])}else fw.allow=fw.allow.filter(x=>+x[1]!==3389)}
  else if(/windows remote management|winrm/.test(g)){if(on){if(!fwHas(fw.allow,['tcp',5985,'']))fw.allow.push(['tcp',5985,'','WinRM (HTTP-In)'])}else fw.allow=fw.allow.filter(x=>+x[1]!==5985)}
  else if(/world wide web|http/.test(g)){if(on)fw.allow.push(['tcp',80,'','World Wide Web Services (HTTP Traffic-In)'])}
  else{const x=fw.allow.find(y=>(y[3]||'').toLowerCase()===g);if(!x)return wErr(io,io.argv[0],'Nenhum objeto MSFT_NetFirewallRule encontrado.','ObjectNotFound');if(!on)fw.allow=fw.allow.filter(y=>y!==x)}io.changed();return 0};
WX['set-itemproperty']=io=>{const s=io.argv.join(' ');if(/fDenyTSConnections/i.test(s)){const v=/-value\s+0/i.test(s);const x=osSvcs(io.d).TermService||(io.d.svcs.TermService={active:false,enabled:false});x.active=v;x.enabled=v;io.changed();if(v)io.out('(RDP habilitado — libere a porta: Enable-NetFirewallRule -DisplayGroup "Remote Desktop")','dim')}return 0};
const winSvcAll=d=>{const base={Dhcp:1,Dnscache:1,EventLog:1,LanmanServer:1,LanmanWorkstation:1,MpsSvc:1,W32Time:1,Spooler:1,TermService:0};const o={};Object.entries(base).forEach(([k,v])=>o[k]={active:!!v,enabled:!!v});Object.entries(d.svcs||{}).forEach(([k,v])=>o[k]=v);return o};
WX['get-service']=io=>{const{n,pos}=wArgs(io.argv);const q=String(n.name||pos[0]||'').replace(/\*/g,'.*');const all=winSvcAll(io.d);const re=q?new RegExp('^'+q+'$','i'):null;const rows=Object.entries(all).filter(([k])=>!re||re.test(k)||re.test(WSVC[k]||''));
  if(q&&!rows.length)return wErr(io,'Get-Service',`Não é possível localizar nenhum serviço com o nome de serviço '${n.name||pos[0]}'.`,'ObjectNotFound');wTable(io,['Status','Name','DisplayName'],rows.map(([k,v])=>[v.active?'Running':'Stopped',k,WSVC[k]||k]));return 0};
WX['start-service']=WX['stop-service']=WX['restart-service']=io=>{const{n,pos}=wArgs(io.argv);const nm=n.name||pos[0];const all=winSvcAll(io.d);const k=Object.keys(all).find(x=>x.toLowerCase()===String(nm).toLowerCase()||(WSVC[x]||'').toLowerCase()===String(nm).toLowerCase());
  if(!k)return wErr(io,io.argv[0],`Não é possível localizar nenhum serviço com o nome de serviço '${nm}'.`,'ObjectNotFound');const s=osSvcs(io.d)[k]||(io.d.svcs[k]={...all[k]});s.active=!/^stop/i.test(io.argv[0]);if(k==='MpsSvc'&&!s.active){s.active=true;return wErr(io,'Stop-Service','O serviço Firewall do Windows Defender não pode ser parado (use Set-NetFirewallProfile -Enabled False).','InvalidOperation')}io.changed();return 0};
WX['set-service']=io=>{const{n,pos}=wArgs(io.argv);const nm=n.name||pos[0];const all=winSvcAll(io.d);const k=Object.keys(all).find(x=>x.toLowerCase()===String(nm).toLowerCase());if(!k)return wErr(io,'Set-Service','serviço não encontrado','ObjectNotFound');const s=osSvcs(io.d)[k]||(io.d.svcs[k]={...all[k]});if(n.startuptype)s.enabled=/automatic/i.test(n.startuptype);if(n.status)s.active=/running/i.test(n.status);io.changed();return 0};
function winFeat(io,names,add){const d=io.d;const srv=d.os==='windows-server-2022';const res=[];for(const x of names){const f=WFEAT[x.toLowerCase()];if(!f||(f.srv&&!srv)){if(f&&f.srv&&!srv)return wErr(io,io.argv[0],`O recurso ${f.n} só existe no Windows Server (no Windows 11 use Enable-WindowsOptionalFeature -Online -FeatureName IIS-WebServerRole).`);return wErr(io,io.argv[0],`ArgumentNotValid: O nome de função, serviço de função ou recurso não é válido: '${x}'.`)}
    d.pkgs=d.pkgs||[];if(add){if(!d.pkgs.includes(f.n))d.pkgs.push(f.n);if(f.svc){osSvcs(d)[f.svc]={active:true,enabled:true}}if(f.svc==='W3SVC'){const fw=hostFwW(d);if(!fwHas(fw.allow,['tcp',80,'']))fw.allow.push(['tcp',80,'','World Wide Web Services (HTTP Traffic-In)'])}if(f.svc==='DNS'){const fw=hostFwW(d);[['udp',53],['tcp',53]].forEach(p=>{if(!fwHas(fw.allow,[...p,'']))fw.allow.push([...p,'','DNS (UDP/TCP, Incoming)'])})}}
    else{d.pkgs=d.pkgs.filter(y=>y!==f.n);if(f.svc&&d.svcs)delete d.svcs[f.svc]}res.push(f)}
  io.changed();if(/optional/i.test(io.argv[0])){wList(io,[{Path:'',Online:'True',RestartNeeded:'False'}]);return 0}wTable(io,['Success','Restart Needed','Exit Code','Feature Result'],[['True','No','Success',`{${res.map(f=>f.dn).join(', ')}}`]]);return 0}
WX['install-windowsfeature']=WX['add-windowsfeature']=io=>{const{n,pos}=wArgs(io.argv);return winFeat(io,String(n.name||pos.join(',')).split(/[,\s]+/).filter(Boolean),true)};WX['uninstall-windowsfeature']=WX['remove-windowsfeature']=io=>{const{n,pos}=wArgs(io.argv);return winFeat(io,String(n.name||pos.join(',')).split(/[,\s]+/).filter(Boolean),false)};
WX['enable-windowsoptionalfeature']=io=>{const{n}=wArgs(io.argv);return winFeat(io,String(n.featurename||'').split(/[,\s]+/).filter(Boolean),true)};WX['disable-windowsoptionalfeature']=io=>{const{n}=wArgs(io.argv);return winFeat(io,String(n.featurename||'').split(/[,\s]+/).filter(Boolean),false)};
WX['get-windowsfeature']=io=>{if(io.d.os!=='windows-server-2022')return wErr(io,'Get-WindowsFeature','O comando Get-WindowsFeature só existe no Windows Server.','ObjectNotFound');io.raw('Display Name                                            Name                       Install State\n------------                                            ----                       -------------');Object.values(WFEAT).filter((f,i,a)=>f.srv&&a.findIndex(y=>y.n===f.n)===i).forEach(f=>io.raw(`[${(io.d.pkgs||[]).includes(f.n)?'X':' '}] ${f.dn.padEnd(52)}${f.n.padEnd(27)}${(io.d.pkgs||[]).includes(f.n)?'Installed':'Available'}`));return 0};
WX['add-windowscapability']=io=>{const{n}=wArgs(io.argv);if(/openssh\.server/i.test(n.name||'')){osSvcs(io.d).sshd={active:false,enabled:false};(io.d.pkgs=io.d.pkgs||[]).push('OpenSSH.Server');io.changed();wList(io,[{Path:'',Online:'True',RestartNeeded:'False'}]);io.out('(agora: Start-Service sshd; Set-Service -Name sshd -StartupType Automatic — e a regra de firewall "OpenSSH-Server-In-TCP" porta 22 foi criada)','dim');const fw=hostFwW(io.d);if(!fwHas(fw.allow,['tcp',22,'']))fw.allow.push(['tcp',22,'','OpenSSH SSH Server (sshd)']);return 0}wList(io,[{Path:'',Online:'True',RestartNeeded:'False'}]);return 0};
WX['get-windowscapability']=io=>{io.out(`Name  : OpenSSH.Server~~~~0.0.1.0\nState : ${(io.d.pkgs||[]).includes('OpenSSH.Server')?'Installed':'NotPresent'}\n\nName  : OpenSSH.Client~~~~0.0.1.0\nState : Installed`);return 0};
WX.winget=io=>{const a=io.argv.slice(1);if((a[0]||'').toLowerCase()!=='install'){io.out('winget install <id>  (ex.: winget install WireGuard.WireGuard)','dim');return 1}const id=a.find((x,i)=>i>0&&!x.startsWith('-'))||'';const net=repoReach({...io,o:{fam:'apk'}});if(!net.ok){io.err(`Falha ao abrir a fonte; tente o comando 'source reset' se o problema persistir.\n0x8a15000f : Os dados necessários para a fonte estão faltando`);io.out('motivo: '+net.why,'err');return 1}
  io.out(`Encontrado ${id} [${id}] Versão 1.0\nEste aplicativo é licenciado para você pelo proprietário.\nBaixando...\n  ██████████████████████████████  100%\nInstalado com êxito`);(io.d.pkgs=io.d.pkgs||[]).push(/wireguard/i.test(id)?'wireguard':id);if(net.note)io.out(net.note,'dim');io.changed();return 0};
WX.wireguard=WX['wireguard.exe']=io=>{const a=io.argv.slice(1);if(!(io.d.pkgs||[]).includes('wireguard')){io.err('wireguard : O termo não é reconhecido (instale: winget install WireGuard.WireGuard)');return 1}
  if(/installtunnelservice/i.test(a[0]||'')){const p=io.path(a[1]||'');const t=fsRead(io.d,p);if(t==null){io.err(`Arquivo não encontrado: ${a[1]}`);return 1}const name=p.split('/').pop().replace(/\.conf$/,'');const tmp='/etc/wireguard/'+name+'.conf';const fs0=io.d.fs||{};const had=fs0[tmp];fsWrite(io.d,tmp,t);const pk=io.d.pkgs.includes('wireguard-tools');if(!pk)io.d.pkgs.push('wireguard-tools');const r=wgUp(io,name,true);if(!pk)io.d.pkgs=io.d.pkgs.filter(x=>x!=='wireguard-tools');if(had===undefined)delete io.d.fs[tmp];if(!r){osSvcs(io.d)['WireGuardTunnel$'+name]={active:true,enabled:true};io.out(`(túnel ${name} instalado e ativo)`,'dim')}return r}
  if(/uninstalltunnelservice/i.test(a[0]||'')){wgDown(io,a[1]||'wg0');return 0}io.out('wireguard /installtunnelservice C:\\caminho\\wg0.conf · wireguard /uninstalltunnelservice wg0','dim');return 1};
WX.wg=io=>{if(!(io.d.pkgs||[]).includes('wireguard')){io.err('wg : O termo não é reconhecido');return 1}return LX.wg(io)};
WX['add-dnsserverprimaryzone']=io=>{if(!svcOn(io.d,'DNS'))return wErr(io,'Add-DnsServerPrimaryZone','O servidor DNS não está instalado/ativo (Install-WindowsFeature DNS).','ObjectNotFound');const{n}=wArgs(io.argv);(io.d.dnsZones=io.d.dnsZones||[]);if(!io.d.dnsZones.includes(n.name))io.d.dnsZones.push(n.name);io.changed();return 0};
WX['add-dnsserverresourcerecorda']=io=>{if(!svcOn(io.d,'DNS'))return wErr(io,'Add-DnsServerResourceRecordA','O servidor DNS não está instalado/ativo.','ObjectNotFound');const{n}=wArgs(io.argv);if(!(io.d.dnsZones||[]).includes(n.zonename))return wErr(io,'Add-DnsServerResourceRecordA',`A zona ${n.zonename} não existe (Add-DnsServerPrimaryZone -Name ${n.zonename} -ZoneFile ${n.zonename}.dns).`,'ObjectNotFound');if(ip2i(n.ipv4address)===null)return wErr(io,'Add-DnsServerResourceRecordA','-IPv4Address inválido');(io.d.dnsRecs=io.d.dnsRecs||[]).push({zone:n.zonename,name:n.name,ip:n.ipv4address});io.changed();return 0};
WX['get-dnsserverresourcerecord']=io=>{const{n}=wArgs(io.argv);wTable(io,['HostName','RecordType','Type','Timestamp','TimeToLive','RecordData'],(io.d.dnsRecs||[]).filter(r=>!n.zonename||r.zone===n.zonename).map(r=>[r.name,'A',1,'0','01:00:00',r.ip]));return 0};
WX['get-dnsserverzone']=io=>{wTable(io,['ZoneName','ZoneType','IsAutoCreated','IsDsIntegrated'],(io.d.dnsZones||[]).map(z=>[z,'Primary','False','False']));return 0};
function wPing(io,count,tgt){return withTarget(io,tgt,ip=>{const r=simIo(io,ip,'icmp',0);const ips=i2ip(ip);io.out(`\nDisparando ${tgt}${tgt!==ips?' ['+ips+']':''} com 32 bytes de dados:`);const src=l3ifs(io.d).find(f=>!f.mgmt);
  for(let i=0;i<count;i++){if(r.ok)io.raw(`Resposta de ${ips}: bytes=32 tempo${r.ext?'='+(11+hsh(ips+i)%20)+'ms':'<1ms'} TTL=${(r.ext?116:isWin(dev(r.at))?128:64)-Math.max(0,r.hops.length-1)}`);else if(r.refused||/firewall|descarta/.test(r.why||''))io.raw('Esgotado o tempo limite do pedido.');else io.raw(`Resposta de ${src?i2ip(src.c.ip):'0.0.0.0'}: Host de destino inacessível.`)}
  io.out(`\nEstatísticas do Ping para ${ips}:\n    Pacotes: Enviados = ${count}, Recebidos = ${r.ok?count:r.refused?0:count}, Perdidos = ${r.ok?0:r.refused?count:0} (${r.ok?0:r.refused?100:0}% de perda),`);if(r.ok)io.out(`Aproximar um número redondo de vezes em milissegundos:\n    Mínimo = 0ms, Máximo = 1ms, Média = 0ms\n✓ alcançável`,'ok');else io.out('motivo: '+r.why,'err');return r.ok?0:1},true)}
WX.ping=io=>{const a=io.argv.slice(1);const ni=a.findIndex(x=>/^[-/]n$/i.test(x));const c=ni>=0?Math.max(1,Math.min(10,+a[ni+1]||4)):4;const tgt=a.filter((x,i)=>!/^[-/]/.test(x)&&(ni<0||i!==ni+1)).pop();return wPing(io,c,tgt)};
WX['test-connection']=io=>{const{n,pos}=wArgs(io.argv);const tgt=n.targetname||n.computername||pos[0];const cnt=+n.count||4;return withTarget(io,tgt,ip=>{const r=simIo(io,ip,'icmp',0);if(n.quiet){io.out(r.ok?'True':'False');return 0}if(!r.ok){io.err(`Test-Connection: Testando conexão com o computador '${tgt}' falhou: ${r.refused?'Tempo limite esgotado':'Host de destino inacessível'}`);io.out('motivo: '+r.why,'err');return 1}
  wTable(io,['Ping','Source','Address','Latency(ms)','BufferSize(B)','Status'],Array.from({length:cnt},(_,i)=>[i+1,io.d.name.toUpperCase(),i2ip(ip),r.ext?12:0,32,'Success']));return 0})};
WX.tracert=io=>{const tgt=io.argv.slice(1).filter(x=>!/^[-/]/.test(x)).pop();return withTarget(io,tgt,ip=>{const r=simIo(io,ip,'icmp',0);io.out(`\nRastreando a rota para ${tgt} [${i2ip(ip)}]\ncom no máximo 30 saltos:\n`);r.hops.forEach((h,i)=>io.raw(`  ${String(i+1).padStart(2)}    <1 ms    <1 ms    <1 ms  ${h.ip}`));if(!r.ok)io.raw(`  ${String(r.hops.length+1).padStart(2)}     *        *        *     Esgotado o tempo limite do pedido.   (${r.why})`);io.out('\nRastreamento concluído.');return 0})};
WX['test-netconnection']=io=>{const{n,pos}=wArgs(io.argv);const tgt=n.computername||pos[0]||'internetbeacon.msedge.net';const port=n.port?+n.port:n.commontcpport?({http:80,rdp:3389,smb:445,winrm:5985})[String(n.commontcpport).toLowerCase()]:0;
  return withTarget(io,tgt,ip=>{const r=simIo(io,ip,port?'tcp':'icmp',port);const src=l3ifs(io.d).find(f=>!f.mgmt);const o={ComputerName:tgt,RemoteAddress:i2ip(ip)};if(port)o.RemotePort=port;o.InterfaceAlias=src?winAlias(io.d,src.k):'';o.SourceAddress=src?i2ip(src.c.ip):'';
    if(port){o.TcpTestSucceeded=r.ok?'True':'False'}else{o.PingSucceeded=r.ok?'True':'False';if(r.ok)o['PingReplyDetails (RTT)']=(r.ext?12:0)+' ms'}
    if(!r.ok)io.out(`AVISO: ${port?`TCP connect to (${i2ip(ip)} : ${port}) failed`:`Ping to ${i2ip(ip)} failed with status: TimedOut`}`,'err');wList(io,[o]);if(!r.ok)io.out('motivo: '+r.why,'err');return r.ok?0:1})};
WX.nslookup=io=>{io.argv=['nslookup',...io.argv.slice(1)];return dnsCmd(io,'nslookup')};
WX['resolve-dnsname']=io=>{const{n,pos}=wArgs(io.argv);const nm=n.name||pos[0];return M(resolveAsync(io,nm,n.server||null),r=>{if(r.ip==null){io.err(`Resolve-DnsName : ${nm} : ${r.nx?'Nome DNS não existe':'Esta operação retornou porque o tempo limite expirou'}\n    + CategoryInfo          : ResourceUnavailable: (${nm}:String) [Resolve-DnsName], Win32Exception`);if(r.err)io.out('motivo: '+r.err,'err');return 1}wTable(io,['Name','Type','TTL','Section','IPAddress'],(r.ips||[i2ip(r.ip)]).map(x=>[nm,'A',300,'Answer',x]));return 0})};
WX['invoke-webrequest']=WX['invoke-restmethod']=io=>{const{n,pos}=wArgs(io.argv);const url=n.uri||pos[0];if(!url)return wErr(io,io.argv[0],'informe -Uri');const tmp=[];const io2={...io,argv:['curl','-i',url],out:(s,t='out')=>String(s).split('\n').forEach(x=>tmp.push({t,s:x})),err:s=>String(s).split('\n').forEach(x=>tmp.push({t:'e',s:x})),raw:s=>tmp.push({t:'out',s})};
  return M(curlCmd(io2),rc=>{if(rc){const msg=tmp.filter(x=>x.t==='e').map(x=>x.s).join(' ');io.err(`${io.argv[0]} : ${/resolve/.test(msg)?'O nome remoto não pôde ser resolvido: \''+parseUrl(url).host+'\'':/refused|Couldn't connect/.test(msg)?'Não é possível se conectar ao servidor remoto':/Timeout|timed out/.test(msg)?'A operação expirou':msg}`);tmp.filter(x=>x.t==='err'||x.t==='dim').forEach(x=>io.out(x.s,x.t));return 1}
    const txt=tmp.filter(x=>x.t==='out').map(x=>x.s);const hi=txt.indexOf('');const hd=txt.slice(0,hi),body=txt.slice(hi+1).join('\n');const code=(hd[0]||'').split(' ')[1];
    if(/restmethod/i.test(io.argv[0])){io.out(body);return 0}wList(io,[{StatusCode:code,StatusDescription:(hd[0]||'').split(' ').slice(2).join(' '),Content:body.slice(0,120).replace(/\n/g,' ')+(body.length>120?'...':''),RawContent:hd.slice(0,2).join(' ')+'...',Headers:'{'+hd.slice(1,4).map(x=>x.replace(': ','=')).join(', ')+'}',RawContentLength:body.length}]);return 0})};
WX['curl.exe']=io=>{io.argv=['curl',...io.argv.slice(1)];return curlCmd(io)};WX.ssh=io=>{io.argv=['ssh',...io.argv.slice(1)];return LX.ssh(io)};WX.scp=io=>{io.argv=['scp',...io.argv.slice(1)];return LX.scp(io)};
WX.netstat=io=>{io.out('\nConexões ativas\n\n  Proto  Endereço local         Endereço externo       Estado');listenRows(io.d).forEach(r=>io.raw(`  ${r.proto.toUpperCase().padEnd(6)} 0.0.0.0:${String(r.port).padEnd(15)}0.0.0.0:0              ${r.proto==='tcp'?'LISTENING':''}`));return 0};
WX['get-nettcpconnection']=io=>{wTable(io,['LocalAddress','LocalPort','RemoteAddress','RemotePort','State','OwningProcess'],listenRows(io.d).filter(r=>r.proto==='tcp').map(r=>['0.0.0.0',r.port,'0.0.0.0',0,'Listen',1000+hsh(r.svc)%8000]));return 0};
WX['$psversiontable']=io=>{io.out('\nName                           Value\n----                           -----\nPSVersion                      5.1.'+io.o.ver.split('.').pop()+'.1\nPSEdition                      Desktop\nBuildVersion                   '+io.o.ver);return 0};
WX.kubectl=kubeCmd;WX.arp=io=>{const rows=arpRows(io.d).filter(r=>r.age!=='-');io.out(`\nInterface: ${(l3ifs(io.d).find(f=>!f.mgmt)||{c:{ip:0}}).c.ip?i2ip(l3ifs(io.d).find(f=>!f.mgmt).c.ip):'?'} --- 0x${(10).toString(16)}\n  Endereço IP           Endereço físico       Tipo`);rows.forEach(r=>io.raw(`  ${i2ip(r.ip).padEnd(22)}${macLinux(r.m).replace(/:/g,'-').padEnd(22)}dinâmico`));return 0};
/* autocompletar (Tab) no shell do SO */
function osComplete(d,line,st){const m=line.match(/^(.*?)(\S*)$/);const pre=m[1],part=m[2];const win=isWin(d);
  if(!pre.trim()){const names=win?[...Object.keys(WX),...Object.keys(WAL)].map(x=>x.replace(/(^|-)(\w)/g,(a,b,c)=>b+c.toUpperCase())):Object.keys(LX).filter(b=>hasBin(d,b));const opts=[...new Set(names)].filter(x=>x.toLowerCase().startsWith(part.toLowerCase())).sort();
    if(opts.length===1)return{line:pre+opts[0]+' ',opts:[]};return{line,opts:opts.slice(0,40)}}
  const base=part.includes('/')?part.slice(0,part.lastIndexOf('/')+1):'';const dir=fsNorm(d,base||'.',st.cwd);const leaf=part.slice(base.length);
  const it=fsList(d,dir).filter(x=>x.n.startsWith(leaf));if(it.length===1)return{line:pre+base+it[0].n+(it[0].dir?'/':' '),opts:[]};
  let lcp=leaf;if(it.length){lcp=it[0].n;it.forEach(x=>{while(!x.n.startsWith(lcp))lcp=lcp.slice(0,-1)})}return{line:pre+base+(lcp.length>leaf.length?lcp:leaf),opts:it.map(x=>x.n+(x.dir?'/':'')).slice(0,40)}}
/* instalação direta (painel): sem rede, já com serviços ativos */
function pkgAddDirect(d,names){const o=osInfo(d);const res={ok:[],bad:[]};d.pkgs=d.pkgs||[];
  if(o.fam==='win'){names.forEach(n=>{const f=WFEAT[String(n).toLowerCase()]||(/openssh/i.test(n)?{n:'OpenSSH.Server',svc:'sshd'}:/wireguard/i.test(n)?{n:'wireguard'}:null);if(!f||(f.srv&&d.os!=='windows-server-2022')){res.bad.push(n);return}
    if(!d.pkgs.includes(f.n))d.pkgs.push(f.n);if(f.svc)osSvcs(d)[f.svc]={active:true,enabled:true};if(f.svc==='W3SVC'||f.svc==='sshd'||f.svc==='DNS'){const fw=hostFwW(d);(f.svc==='W3SVC'?[['tcp',80]]:f.svc==='sshd'?[['tcp',22]]:[['udp',53],['tcp',53]]).forEach(p=>{if(!fwHas(fw.allow,[...p,'']))fw.allow.push([...p,'',f.n])})}res.ok.push(f.n)});return res}
  const{all,bad}=pkgResolve({o},names);all.forEach(n=>{if(!hasPkg(d,n)){d.pkgs.push(n);const sv=pkgSvc(o,pkgDef(o,n));if(sv)osSvcs(d)[sv]={active:true,enabled:true};if(/docker/.test(n))osSvcs(d).containerd={active:true,enabled:true}}});res.ok=all;res.bad=bad;d.aptUpd=true;return res}

/* ====================================================================
   VPN em roteadores/firewalls: configuração por fabricante, importação,
   comandos show e verificação (lint)
   ==================================================================== */
const VPN_ENC={aes128:{c:'aes-cbc-128',c1:'aes 128',ts:'esp-aes 128',j:'aes-128-cbc',h:'aes-128',r:'aes-128-cbc',f:'aes128'},aes192:{c:'aes-cbc-192',c1:'aes 192',ts:'esp-aes 192',j:'aes-192-cbc',h:'aes-192',r:'aes-192-cbc',f:'aes192'},aes256:{c:'aes-cbc-256',c1:'aes 256',ts:'esp-aes 256',j:'aes-256-cbc',h:'aes-256',r:'aes-256-cbc',f:'aes256'},'3des':{c:'3des',c1:'3des',ts:'esp-3des',j:'3des-cbc',h:'3des',r:'3des-cbc',f:'3des'}};
const VPN_HASH={sha1:{c:'sha1',ts:'esp-sha-hmac',j:'sha1',jh:'hmac-sha1-96',h:'sha1',f:'sha1'},sha256:{c:'sha256',ts:'esp-sha256-hmac',j:'sha-256',jh:'hmac-sha-256-128',h:'sha2-256',f:'sha256'},sha384:{c:'sha384',ts:'esp-sha384-hmac',j:'sha-384',jh:'hmac-sha-384',h:'sha2-384',f:'sha384'},sha512:{c:'sha512',ts:'esp-sha512-hmac',j:'sha-512',jh:'hmac-sha-512',h:'sha2-512',f:'sha512'},md5:{c:'md5',ts:'esp-md5-hmac',j:'md5',jh:'hmac-md5-96',h:'md5',f:'md5'}};
const vEnc=t=>VPN_ENC[t.enc||'aes256']||VPN_ENC.aes256,vHash=t=>VPN_HASH[t.hash||'sha256']||VPN_HASH.sha256,vDh=t=>String(t.dh||'14');
const vpnIps=t=>t.kind==='ipsec'?(d=>d.vpns||[]):null;
function vpnEgress(d,t){const p=ip2i(t.peer);if(p===null)return null;computeOspf();const r=lookup(d,p,{});return r&&r.ifc?r.ifc:null}
function vpnLocalIp(d,t){if(t.local&&ip2i(t.local)!==null)return t.local;const f=vpnEgress(d,t);return f?i2ip(f.c.ip):''}
const nMask=c=>`${i2ip(c.net)} ${msk(c)}`,nWild=c=>`${i2ip(c.net)} ${wc(c)}`;
/* bloco de VPN anexado à configuração exportada */
function vpnGen(v,d){const T=(d.vpns||[]);if(!T.length)return'';const ips=T.filter(t=>t.kind==='ipsec'),wgs=T.filter(t=>t.kind==='wireguard');const L=[];const ifn=f=>f?pn(v,d,f.k)+(f.kind==='sub'?'.'+f.vlan:''):'?';
  const pairs=t=>{const a=netsOf(t.lnets),b=netsOf(t.rnets);const o=[];a.forEach(x=>b.forEach(y=>o.push([x,y])));return o};
  if(['nxos','eos','os10','aoscx'].includes(v)){L.push('!',`! VPN (${T.map(t=>t.name).join(', ')}): ${VN[v]} não termina IPsec/WireGuard — use um roteador ou firewall de borda.`);return L.join('\n')}
  if(v==='cisco'){if(!ips.length&&wgs.length)return`!\n! WireGuard (${wgs.map(t=>t.name).join(', ')}) não existe no IOS-XE — exporte este túnel em VyOS, RouterOS ou Linux.`;
    L.push('!','! ---- VPN IPsec (Bancada) ----');const byIf={};
    ips.forEach((t,i)=>{const e=vEnc(t),h=vHash(t),n=t.name;
      if(t.ike==='v1'){L.push(`crypto isakmp policy ${10+i*10}`,` encryption ${e.c1}`,` hash ${h.c}`,' authentication pre-share',` group ${vDh(t)}`,`crypto isakmp key ${t.psk||''} address ${t.peer}`)}
      else{L.push(`crypto ikev2 proposal BANCADA-${n}`,` encryption ${e.c}`,` integrity ${h.c}`,` group ${vDh(t)}`,`crypto ikev2 policy BANCADA-${n}`,` proposal BANCADA-${n}`,`crypto ikev2 keyring BANCADA-${n}`,` peer ${n}`,`  address ${t.peer}`,`  pre-shared-key ${t.psk||''}`,`crypto ikev2 profile BANCADA-${n}`,` match identity remote address ${t.peer} 255.255.255.255`,' authentication remote pre-share',' authentication local pre-share',` keyring local BANCADA-${n}`)}
      L.push(`crypto ipsec transform-set TS-${n} ${e.ts} ${h.ts}`,' mode tunnel',`ip access-list extended VPN-${n}`,...pairs(t).map(([a,b])=>` permit ip ${nWild(a)} ${nWild(b)}`),
        `crypto map BANCADA-VPN ${10+i*10} ipsec-isakmp`,` description ${n}`,` set peer ${t.peer}`,` set transform-set TS-${n}`,...(t.ike!=='v1'?[` set ikev2-profile BANCADA-${n}`]:[]),...(+vDh(t)?[` set pfs group${vDh(t)}`]:[]),` match address VPN-${n}`);
      const f=vpnEgress(d,t);if(f)byIf[ifn(f)]=1;if(t.shut)L.push(`! (túnel ${n} desativado na bancada)`)});
    Object.keys(byIf).forEach(x=>L.push(`interface ${x}`,' crypto map BANCADA-VPN'));if(wgs.length)L.push(`! WireGuard (${wgs.map(t=>t.name).join(', ')}) não existe no IOS-XE.`);return L.join('\n')}
  if(v==='junos'){ips.forEach((t,i)=>{const e=vEnc(t),h=vHash(t),n=t.name,f=vpnEgress(d,t);const P=`BANCADA-${n}`;
      L.push(`set security ike proposal ${P} authentication-method pre-shared-keys`,`set security ike proposal ${P} dh-group group${vDh(t)}`,`set security ike proposal ${P} authentication-algorithm ${h.j}`,`set security ike proposal ${P} encryption-algorithm ${e.j}`,
        `set security ike policy ${P} proposals ${P}`,`set security ike policy ${P} pre-shared-key ascii-text "${t.psk||''}"`,`set security ike gateway ${n} ike-policy ${P}`,`set security ike gateway ${n} address ${t.peer}`,`set security ike gateway ${n} external-interface ${f?ifn(f):'ge-0/0/0'}`,`set security ike gateway ${n} version ${t.ike==='v1'?'v1-only':'v2-only'}`,
        `set security ipsec proposal ${P} protocol esp`,`set security ipsec proposal ${P} authentication-algorithm ${h.jh}`,`set security ipsec proposal ${P} encryption-algorithm ${e.j}`,`set security ipsec policy ${P} proposals ${P}`,
        `set interfaces st0 unit ${i} family inet`,`set security ipsec vpn ${n} bind-interface st0.${i}`,`set security ipsec vpn ${n} ike gateway ${n}`,`set security ipsec vpn ${n} ike ipsec-policy ${P}`,`set security ipsec vpn ${n} establish-tunnels immediately`,
        ...pairs(t).flatMap(([a,b],j)=>[`set security ipsec vpn ${n} traffic-selector ts${j+1} local-ip ${netStr(a)}`,`set security ipsec vpn ${n} traffic-selector ts${j+1} remote-ip ${netStr(b)}`]),...(t.shut?[`deactivate security ipsec vpn ${n}`]:[]))});
    if(wgs.length)L.push(`# WireGuard (${wgs.map(t=>t.name).join(', ')}) não existe no Junos.`);return L.join('\n')}
  if(v==='huawei'){L.push('#');ips.forEach((t,i)=>{const e=vEnc(t),h=vHash(t),n=t.name;L.push(`ike proposal ${10+i}`,` encryption-algorithm ${e.h}`,` authentication-algorithm ${h.h}`,` dh group${vDh(t)}`,'#',`ike peer ${n}`,` version ${t.ike==='v1'?1:2}`,` pre-shared-key cipher ${t.psk||''}`,` ike-proposal ${10+i}`,` remote-address ${t.peer}`,'#',
      `acl number ${3900+i}`,` description VPN-${n}`,...pairs(t).map(([a,b],j)=>` rule ${5+j*5} permit ip source ${nWild(a)} destination ${nWild(b)}`),'#',`ipsec proposal ${n}`,` esp authentication-algorithm ${h.h}`,` esp encryption-algorithm ${e.h}`,'#',`ipsec policy BANCADA ${10+i} isakmp`,` security acl ${3900+i}`,` ike-peer ${n}`,` proposal ${n}`,'#')});
    const ifs=[...new Set(ips.map(t=>vpnEgress(d,t)).filter(Boolean).map(ifn))];ifs.forEach(x=>L.push(`interface ${x}`,' ipsec policy BANCADA','#'));if(wgs.length)L.push(`# WireGuard (${wgs.map(t=>t.name).join(', ')}) não existe no VRP.`);return L.join('\n')}
  if(v==='fortios'){if(ips.length){L.push('config vpn ipsec phase1-interface');ips.forEach(t=>{const f=vpnEgress(d,t);L.push(`    edit "${t.name}"`,`        set interface "${f?ifn(f):'port1'}"`,`        set ike-version ${t.ike==='v1'?1:2}`,'        set peertype any','        set net-device disable',`        set proposal ${vEnc(t).f}-${vHash(t).f}`,`        set dhgrp ${vDh(t)}`,`        set remote-gw ${t.peer}`,`        set psksecret ${t.psk||''}`,...(t.shut?['        set status disable']:[]),'    next')});L.push('end');
      L.push('config vpn ipsec phase2-interface');ips.forEach(t=>pairs(t).forEach(([a,b],j)=>L.push(`    edit "${t.name}${j?'-'+(j+1):''}"`,`        set phase1name "${t.name}"`,`        set proposal ${vEnc(t).f}-${vHash(t).f}`,`        set dhgrp ${vDh(t)}`,`        set src-subnet ${nMask(a)}`,`        set dst-subnet ${nMask(b)}`,'    next')));L.push('end',
        '# rotas e políticas: crie "config router static" com "set device <túnel>" para as redes remotas e políticas LAN↔túnel (na bancada, as Políticas do firewall valem para o tráfego decifrado)')}
    if(wgs.length)L.push(`# WireGuard (${wgs.map(t=>t.name).join(', ')}) não existe no FortiOS.`);return L.join('\n')}
  if(v==='vyos'){ips.forEach(t=>{const n=t.name,P=`BANCADA-${n}`,f=vpnEgress(d,t);L.push(`set vpn ipsec ike-group ${P} key-exchange ${t.ike==='v1'?'ikev1':'ikev2'}`,`set vpn ipsec ike-group ${P} proposal 1 encryption ${vEnc(t).f}`,`set vpn ipsec ike-group ${P} proposal 1 hash ${vHash(t).f}`,`set vpn ipsec ike-group ${P} proposal 1 dh-group ${vDh(t)}`,
      `set vpn ipsec esp-group ${P} proposal 1 encryption ${vEnc(t).f}`,`set vpn ipsec esp-group ${P} proposal 1 hash ${vHash(t).f}`,...(f?[`set vpn ipsec interface ${ifn(f)}`]:[]),`set vpn ipsec authentication psk ${n} id ${t.peer}`,`set vpn ipsec authentication psk ${n} secret '${t.psk||''}'`,
      `set vpn ipsec site-to-site peer ${n} remote-address ${t.peer}`,`set vpn ipsec site-to-site peer ${n} authentication mode pre-shared-secret`,`set vpn ipsec site-to-site peer ${n} ike-group ${P}`,`set vpn ipsec site-to-site peer ${n} default-esp-group ${P}`,`set vpn ipsec site-to-site peer ${n} local-address ${vpnLocalIp(d,t)||'any'}`,
      ...pairs(t).flatMap(([a,b],j)=>[`set vpn ipsec site-to-site peer ${n} tunnel ${j+1} local prefix ${netStr(a)}`,`set vpn ipsec site-to-site peer ${n} tunnel ${j+1} remote prefix ${netStr(b)}`]),...(t.shut?[`set vpn ipsec site-to-site peer ${n} disable`]:[]))});
    wgs.forEach((t,i)=>{const w=t.name&&/^wg\d+$/.test(t.name)?t.name:'wg'+i;L.push(...(t.addr?[`set interfaces wireguard ${w} address ${t.addr}`]:[]),`set interfaces wireguard ${w} private-key '${t.key||''}'`,`set interfaces wireguard ${w} port ${t.port||51820}`,`set interfaces wireguard ${w} peer ${t.name}-peer public-key '${t.peerKey||''}'`,...(t.peer?[`set interfaces wireguard ${w} peer ${t.name}-peer address ${t.peer}`,`set interfaces wireguard ${w} peer ${t.name}-peer port ${t.pport||51820}`]:[]),...netsOf(t.rnets).map(c=>`set interfaces wireguard ${w} peer ${t.name}-peer allowed-ips ${netStr(c)}`),...(t.shut?[`set interfaces wireguard ${w} disable`]:[])) });return L.join('\n')}
  if(v==='routeros'){ips.forEach(t=>{const n=t.name;L.push(`/ip ipsec profile add name=${n} hash-algorithm=${vHash(t).f} enc-algorithm=${vEnc(t).h} dh-group=${dhName(vDh(t))}`,`/ip ipsec peer add name=${n} address=${t.peer}/32 profile=${n} exchange-mode=${t.ike==='v1'?'main':'ike2'}${t.shut?' disabled=yes':''}`,`/ip ipsec identity add peer=${n} secret="${t.psk||''}"`,
      `/ip ipsec proposal add name=${n} auth-algorithms=${vHash(t).f} enc-algorithms=${vEnc(t).r} pfs-group=${dhName(vDh(t))}`,...pairs(t).map(([a,b])=>`/ip ipsec policy add src-address=${netStr(a)} dst-address=${netStr(b)} tunnel=yes peer=${n} proposal=${n}`))});
    wgs.forEach((t,i)=>{const w=/^wg\d+$/.test(t.name)?t.name:'wg'+i;L.push(`/interface wireguard add name=${w} private-key="${t.key||''}" listen-port=${t.port||51820}${t.shut?' disabled=yes':''}`,`/interface wireguard peers add interface=${w} public-key="${t.peerKey||''}"${t.peer?` endpoint-address=${t.peer} endpoint-port=${t.pport||51820}`:''} allowed-address=${netsOf(t.rnets).map(netStr).join(',')} comment="${t.name}"`,...(t.addr?[`/ip address add address=${t.addr} interface=${w}`]:[]))});return L.join('\n')}
  return''}
/* importação: lê blocos de VPN do texto de configuração */
function parseVpns(text,fmt){const T=[];const t=String(text||'').replace(/\r/g,'');const mk=o=>({kind:'ipsec',ike:'v2',enc:'aes256',hash:'sha256',dh:'14',psk:'',lnets:'',rnets:'',peer:'',...o});
  const encOf=s=>{s=String(s||'').toLowerCase();return/3des/.test(s)?'3des':/128/.test(s)?'aes128':/192/.test(s)?'aes192':'aes256'};const hashOf=s=>{s=String(s||'').toLowerCase();return/md5/.test(s)?'md5':/512/.test(s)?'sha512':/384/.test(s)?'sha384':/256/.test(s)?'sha256':/sha/.test(s)?'sha1':'sha256'};
  const w2c=(a,m)=>{const l=maskLen(i2ip((~ip2i(m))>>>0));return l===null?null:`${a}/${l}`};const m2c=(a,m)=>{const l=maskLen(m);return l===null?null:`${a}/${l}`};
  if(fmt==='junos'){const g={},pol={},prop={},vpn={},ipol={};t.split('\n').forEach(l=>{let m;
      if((m=l.match(/^set security ike proposal (\S+) (dh-group group(\d+)|authentication-algorithm (\S+)|encryption-algorithm (\S+))/))){const p=prop[m[1]]=prop[m[1]]||{};if(m[3])p.dh=m[3];if(m[4])p.hash=hashOf(m[4]);if(m[5])p.enc=encOf(m[5])}
      if((m=l.match(/^set security ike policy (\S+) (proposals (\S+)|pre-shared-key ascii-text "?([^"]*)"?)/))){const p=pol[m[1]]=pol[m[1]]||{};if(m[3])p.prop=m[3];if(m[4]!==undefined&&m[2].startsWith('pre'))p.psk=m[4]}
      if((m=l.match(/^set security ike gateway (\S+) (ike-policy (\S+)|address (\S+)|version (\S+))/))){const x=g[m[1]]=g[m[1]]||{};if(m[3])x.pol=m[3];if(m[4])x.peer=m[4];if(m[5])x.ike=/v1/.test(m[5])?'v1':'v2'}
      if((m=l.match(/^set security ipsec vpn (\S+) (ike gateway (\S+)|traffic-selector \S+ (local|remote)-ip (\S+))/))){const x=vpn[m[1]]=vpn[m[1]]||{l:[],r:[]};if(m[3])x.gw=m[3];if(m[4])x[m[4][0]].push(m[5])}
      if((m=l.match(/^deactivate security ipsec vpn (\S+)/))){(vpn[m[1]]=vpn[m[1]]||{l:[],r:[]}).shut=true}});
    Object.entries(vpn).forEach(([n,x])=>{const G=g[x.gw]||{};const P=pol[G.pol]||{};const R=prop[P.prop]||{};T.push(mk({name:n,peer:G.peer||'',ike:G.ike||'v2',psk:P.psk||'',enc:R.enc||'aes256',hash:R.hash||'sha256',dh:R.dh||'14',lnets:[...new Set(x.l)].join(' '),rnets:[...new Set(x.r)].join(' '),shut:!!x.shut}))});return T}
  if(fmt==='vyos'){const ig={},pe={},psk={},wg={};const q=s=>String(s||'').replace(/^'|'$/g,'');t.split('\n').forEach(l=>{let m;
      if((m=l.match(/^set vpn ipsec ike-group (\S+) (key-exchange (\S+)|proposal \d+ (encryption|hash|dh-group) (\S+))/))){const x=ig[m[1]]=ig[m[1]]||{};if(m[3])x.ike=m[3]==='ikev1'?'v1':'v2';if(m[4]==='encryption')x.enc=encOf(m[5]);if(m[4]==='hash')x.hash=hashOf(m[5]);if(m[4]==='dh-group')x.dh=m[5]}
      if((m=l.match(/^set vpn ipsec authentication psk (\S+) (id (\S+)|secret (.+))$/))){const x=psk[m[1]]=psk[m[1]]||{};if(m[3])x.id=m[3];if(m[4])x.s=q(m[4])}
      if((m=l.match(/^set vpn ipsec site-to-site peer (\S+) (remote-address (\S+)|ike-group (\S+)|local-address (\S+)|tunnel (\d+) (local|remote) prefix (\S+)|(disable))/))){const x=pe[m[1]]=pe[m[1]]||{l:[],r:[]};if(m[3])x.peer=m[3];if(m[4])x.ig=m[4];if(m[5]&&m[5]!=='any')x.local=m[5];if(m[7])x[m[7][0]].push(m[8]);if(m[9])x.shut=true}
      if((m=l.match(/^set vpn ipsec site-to-site peer (\S+) authentication pre-shared-secret (.+)$/))){(psk[m[1]]=psk[m[1]]||{}).s=q(m[2])}
      if((m=l.match(/^set interfaces wireguard (\S+) (address (\S+)|private-key (\S+)|port (\d+)|peer (\S+) (public-key (\S+)|address (\S+)|port (\d+)|allowed-ips (\S+))|(disable))$/))){const x=wg[m[1]]=wg[m[1]]||{r:[]};if(m[3])x.addr=m[3];if(m[4])x.key=q(m[4]);if(m[5])x.port=+m[5];if(m[6]){x.pn=m[6];if(m[8])x.peerKey=q(m[8]);if(m[9])x.peer=m[9];if(m[10])x.pport=+m[10];if(m[11])x.r.push(m[11])}if(m[12])x.shut=true}});
    Object.entries(pe).forEach(([n,x])=>{const G=ig[x.ig]||{};const P=psk[n]||Object.values(psk).find(p=>p.id===x.peer)||{};T.push(mk({name:n,peer:x.peer||'',local:x.local||'',ike:G.ike||'v2',enc:G.enc||'aes256',hash:G.hash||'sha256',dh:G.dh||'14',psk:P.s||'',lnets:x.l.join(' '),rnets:x.r.join(' '),shut:!!x.shut}))});
    Object.entries(wg).forEach(([w,x])=>T.push({kind:'wireguard',name:(x.pn||w).replace(/-peer$/,''),key:x.key||'',addr:x.addr||'',port:x.port||51820,peer:x.peer||'',pport:x.pport||51820,peerKey:x.peerKey||'',rnets:x.r.join(' '),lnets:x.addr||'',shut:!!x.shut}));return T}
  if(fmt==='fortios'){const p1={},p2=[];let sec='',cur=null;t.split('\n').forEach(l=>{const s=l.trim();let m;if(/^config vpn ipsec phase1-interface/.test(s)){sec='p1';return}if(/^config vpn ipsec phase2-interface/.test(s)){sec='p2';return}if(s==='end'){sec='';cur=null;return}if(!sec)return;
      if((m=s.match(/^edit "?([^"]+)"?/))){cur={name:m[1]};if(sec==='p1')p1[m[1]]=cur;else p2.push(cur);return}if(!cur)return;if((m=s.match(/^set (\S+) (.+)$/)))cur[m[1]]=m[2].replace(/^"|"$/g,'')});
    Object.values(p1).forEach(x=>{const ph=p2.filter(y=>(y.phase1name||y.name)===x.name);const pr=String(x.proposal||'aes256-sha256').split(' ')[0].split('-');const nets=k=>ph.map(y=>{const a=String(y[k]||'').split(/\s+/);return a.length>1?m2c(a[0],a[1]):null}).filter(Boolean);
      T.push(mk({name:x.name,peer:x['remote-gw']||'',ike:x['ike-version']==='1'?'v1':'v2',psk:x.psksecret||'',enc:encOf(pr[0]),hash:hashOf(pr[1]),dh:String(x.dhgrp||'14').split(' ')[0],lnets:[...new Set(nets('src-subnet'))].join(' '),rnets:[...new Set(nets('dst-subnet'))].join(' '),shut:x.status==='disable'}))});return T}
  if(fmt==='routeros'){const kv=s=>{const o={};(s.match(/([\w.-]+)=("[^"]*"|\S+)/g)||[]).forEach(x=>{const i=x.indexOf('=');o[x.slice(0,i)]=x.slice(i+1).replace(/^"|"$/g,'')});return o};const prof={},peer={},id={},pol=[],wgi={},wgp=[],addr={};let sec='';
    t.split('\n').forEach(l=>{const s=l.trim();const m=s.match(/^(\/[\w /-]+?)\s+add\s+(.*)$/);let sc=sec,body=null;if(m){sc=m[1].trim();body=m[2]}else if(/^\//.test(s)){sec=s;return}else if(/^add /.test(s)){body=s.slice(4)}if(body===null)return;if(m)sec=sec;const o=kv(body);
      if(sc==='/ip ipsec profile')prof[o.name]=o;else if(sc==='/ip ipsec peer')peer[o.name]=o;else if(sc==='/ip ipsec identity')id[o.peer]=o;else if(sc==='/ip ipsec policy')pol.push(o);else if(sc==='/interface wireguard')wgi[o.name]=o;else if(sc==='/interface wireguard peers')wgp.push(o);else if(sc==='/ip address')addr[o.interface]=o.address});
    Object.entries(peer).forEach(([n,p])=>{const pr=prof[p.profile]||{};const ps=pol.filter(x=>x.peer===n);T.push(mk({name:n,peer:String(p.address||'').split('/')[0],ike:p['exchange-mode']==='main'?'v1':'v2',psk:(id[n]||{}).secret||'',enc:encOf(pr['enc-algorithm']),hash:hashOf(pr['hash-algorithm']),dh:dhNum(pr['dh-group']||'modp2048')||'14',lnets:[...new Set(ps.map(x=>x['src-address']))].join(' '),rnets:[...new Set(ps.map(x=>x['dst-address']))].join(' '),shut:p.disabled==='yes'}))});
    wgp.forEach(p=>{const i=wgi[p.interface]||{};T.push({kind:'wireguard',name:p.comment||p.interface,key:i['private-key']||'',port:+i['listen-port']||51820,addr:addr[p.interface]||'',lnets:addr[p.interface]||'',peer:p['endpoint-address']||'',pport:+p['endpoint-port']||51820,peerKey:p['public-key']||'',rnets:String(p['allowed-address']||'').replace(/,/g,' '),shut:i.disabled==='yes'})});return T}
  if(fmt==='huawei'){const prop={},peer={},acl={},ipp={},pol=[];let cur=null;t.split('\n').forEach(l=>{const s=l.trim();let m;if(/^#/.test(s)||!s){cur=null;return}
      if((m=s.match(/^ike proposal (\d+)/))){cur={k:'prop',o:prop[m[1]]={}};return}if((m=s.match(/^ike peer (\S+)/))){cur={k:'peer',o:peer[m[1]]={name:m[1]}};return}if((m=s.match(/^acl number (\d+)/))&&+m[1]>=3900){cur={k:'acl',o:acl[m[1]]=[]};return}
      if((m=s.match(/^ipsec policy (\S+) (\d+) isakmp/))){cur={k:'pol',o:{}};pol.push(cur.o);return}if(/^\S/.test(l)&&!/^ /.test(l)){cur=null}if(!cur)return;
      if(cur.k==='prop'){if((m=s.match(/^encryption-algorithm (\S+)/)))cur.o.enc=encOf(m[1]);if((m=s.match(/^authentication-algorithm (\S+)/)))cur.o.hash=hashOf(m[1]);if((m=s.match(/^dh group(\d+)/)))cur.o.dh=m[1]}
      if(cur.k==='peer'){if((m=s.match(/^version (\d)/)))cur.o.ike='v'+m[1];if((m=s.match(/^pre-shared-key (?:cipher|simple) (\S+)/)))cur.o.psk=m[1];if((m=s.match(/^ike-proposal (\d+)/)))cur.o.prop=m[1];if((m=s.match(/^remote-address (\S+)/)))cur.o.peer=m[1]}
      if(cur.k==='acl'&&(m=s.match(/permit ip source (\S+) (\S+) destination (\S+) (\S+)/)))cur.o.push([w2c(m[1],m[2]),w2c(m[3],m[4])]);
      if(cur.k==='pol'){if((m=s.match(/^security acl (\d+)/)))cur.o.acl=m[1];if((m=s.match(/^ike-peer (\S+)/)))cur.o.peer=m[1]}});
    pol.forEach(p=>{const P=peer[p.peer]||{};const R=prop[P.prop]||{};const A=acl[p.acl]||[];T.push(mk({name:p.peer,peer:P.peer||'',ike:P.ike||'v2',psk:P.psk||'',enc:R.enc||'aes256',hash:R.hash||'sha256',dh:R.dh||'14',lnets:[...new Set(A.map(x=>x[0]))].join(' '),rnets:[...new Set(A.map(x=>x[1]))].join(' ')}))});return T}
  if(fmt==='cisco'||fmt==='ios'||!fmt){const isk={},keys={},kr={},pr={},prof={},ts={},acl={},maps={};let cur=null;
    t.split('\n').forEach(l=>{const s=l.trim();let m;if(!/^\s/.test(l)){cur=null;
        if((m=s.match(/^crypto isakmp policy (\d+)/))){cur={k:'isk',o:isk[m[1]]={}};return}if((m=s.match(/^crypto isakmp key (\S+) address (\S+)/))){keys[m[2]]=m[1];return}
        if((m=s.match(/^crypto ikev2 proposal (\S+)/))){cur={k:'pr',o:pr[m[1]]={}};return}if((m=s.match(/^crypto ikev2 keyring (\S+)/))){cur={k:'kr',o:kr[m[1]]={}};return}if((m=s.match(/^crypto ikev2 profile (\S+)/))){cur={k:'prof',o:prof[m[1]]={}};return}
        if((m=s.match(/^crypto ipsec transform-set (\S+) (.+)$/))){ts[m[1]]=m[2];return}if((m=s.match(/^ip access-list extended (\S+)/))){cur={k:'acl',o:acl[m[1]]=[]};return}if((m=s.match(/^crypto map \S+ (\d+) ipsec-isakmp/))){cur={k:'map',o:maps[m[1]]={}};return}return}
      if(!cur)return;const o=cur.o;
      if(cur.k==='isk'){if((m=s.match(/^encryption (.+)$/)))o.enc=encOf(m[1]);if((m=s.match(/^hash (\S+)/)))o.hash=hashOf(m[1]);if((m=s.match(/^group (\d+)/)))o.dh=m[1]}
      if(cur.k==='pr'){if((m=s.match(/^encryption (\S+)/)))o.enc=encOf(m[1]);if((m=s.match(/^integrity (\S+)/)))o.hash=hashOf(m[1]);if((m=s.match(/^group (\d+)/)))o.dh=m[1]}
      if(cur.k==='kr'){if((m=s.match(/^address (\S+)/)))o.cur=m[1];if((m=s.match(/^pre-shared-key (\S+)/))&&o.cur)o[o.cur]=m[1]}
      if(cur.k==='prof'){if((m=s.match(/^keyring local (\S+)/)))o.kr=m[1]}
      if(cur.k==='acl'&&(m=s.match(/^permit ip (\S+) (\S+) (\S+) (\S+)/)))o.push([w2c(m[1],m[2]),w2c(m[3],m[4])]);
      if(cur.k==='map'){if((m=s.match(/^description (.+)$/)))o.name=m[1].trim();if((m=s.match(/^set peer (\S+)/)))o.peer=m[1];if((m=s.match(/^set transform-set (\S+)/)))o.ts=m[1];if((m=s.match(/^set ikev2-profile (\S+)/)))o.prof=m[1];if((m=s.match(/^match address (\S+)/)))o.acl=m[1]}});
    const isks=Object.keys(isk).sort((a,b)=>a-b);
    Object.entries(maps).forEach(([seq,x],i)=>{const v2=!!x.prof;let enc,hash,dh,psk='';if(v2){const P=prof[x.prof]||{};const K=kr[P.kr]||{};psk=K[x.peer]||'';const R=pr[x.prof]||Object.values(pr)[i]||{};enc=R.enc;hash=R.hash;dh=R.dh}else{psk=keys[x.peer]||'';const I=isk[isks[i]]||isk[isks[0]]||{};enc=I.enc;hash=I.hash;dh=I.dh}
      const tsS=ts[x.ts]||'';const A=acl[x.acl]||[];T.push(mk({name:x.name||('vpn'+seq),peer:x.peer||'',ike:v2?'v2':'v1',psk,enc:enc||encOf(tsS),hash:hash||hashOf(tsS),dh:dh||'14',lnets:[...new Set(A.map(y=>y[0]).filter(Boolean))].join(' '),rnets:[...new Set(A.map(y=>y[1]).filter(Boolean))].join(' ')}))});return T}
  return T}
/* saídas "show" de VPN nos equipamentos de rede */
function vpnShowNet(d,what,vendor){vpnStates();const L=(VPNS[d.id]||[]);if(!L.length)return'% Nenhum túnel VPN configurado neste equipamento (aba VPN).';const loc=t=>vpnLocalIp(d,t);const v=vendor==='auto'?osOf(d):vendor;
  if(what==='ike'){if(v==='fortios')return['Name              Remote-gw         Status    IKE','----------------  ----------------  --------  ---',...L.filter(s=>s.t.kind==='ipsec').map(s=>`${s.t.name.padEnd(18)}${s.t.peer.padEnd(18)}${(s.state==='UP'?'up':'down').padEnd(10)}${s.t.ike}`)].join('\n');
    if(v==='junos')return['Index   State  Initiator cookie  Responder cookie  Mode           Remote Address',...L.filter(s=>s.t.kind==='ipsec').map((s,i)=>`${String(5000000+i).padEnd(8)}${(s.state==='UP'?'UP':'DOWN').padEnd(7)}${(hsh(s.t.name)>>>0).toString(16).padEnd(18,'0').slice(0,16)}  ${(hsh(s.t.peer)>>>0).toString(16).padEnd(18,'0').slice(0,16)}  ${(s.t.ike==='v1'?'Main':'IKEv2').padEnd(15)}${s.t.peer}`)].join('\n');
    return[`IPv4 Crypto ${'IKE'}v2  SA`,'',...L.filter(s=>s.t.kind==='ipsec').map((s,i)=>`Tunnel-id Local                 Remote                fvrf/ivrf            Status\n${String(i+1).padEnd(10)}${(loc(s.t)+'/500').padEnd(22)}${(s.t.peer+'/500').padEnd(22)}none/none            ${s.state==='UP'?'READY':'DELETED'}\n      Encr: ${vEnc(s.t).c}, PRF: ${vHash(s.t).c}, Hash: ${vHash(s.t).c}, DH Grp:${vDh(s.t)}, Auth sign: PSK, Auth verify: PSK${s.state==='UP'?'':'\n      ↳ '+s.why}`)].join('\n')}
  const rows=L.map(s=>{const t=s.t;if(t.kind==='wireguard')return`interface: ${t.name}  peer ${t.peer||'(sem endpoint)'}:${t.pport||51820}  allowed ${netsOf(t.rnets).map(netStr).join(',')}  ${s.state==='UP'?'handshake ok':'sem handshake — '+s.why}`;
    return`interface: ${(vpnEgress(d,t)?ifName(d,vpnEgress(d,t)):'?')}\n    Crypto map tag: BANCADA-VPN, local addr ${loc(t)}\n   protected vrf: (none)\n   local  ident (addr/mask/prot/port): ${netsOf(t.lnets).map(c=>`(${i2ip(c.net)}/${msk(c)}/0/0)`).join(' ')}\n   remote ident (addr/mask/prot/port): ${netsOf(t.rnets).map(c=>`(${i2ip(c.net)}/${msk(c)}/0/0)`).join(' ')}\n   current_peer ${t.peer} port 500\n     #pkts encaps: ${s.state==='UP'?100+hsh(t.name)%900:0}, #pkts decaps: ${s.state==='UP'?100+hsh(t.peer)%900:0}\n     current outbound spi: ${s.state==='UP'?'0x'+(hsh(t.name+'o')>>>0).toString(16).toUpperCase():'0x0(0)'}\n     status: ${s.state==='UP'?'ACTIVE':'DOWN — '+s.why}`});
  if(v==='fortios')return L.map(s=>`'${s.t.name}' ${s.t.peer}:0  selectors(total,up): ${netsOf(s.t.lnets).length*Math.max(1,netsOf(s.t.rnets).length)}/${s.state==='UP'?netsOf(s.t.lnets).length*Math.max(1,netsOf(s.t.rnets).length):0}  rx(pkt,err): ${s.state==='UP'?42:0}/0  tx(pkt,err): ${s.state==='UP'?42:0}/0${s.state==='UP'?'':'  ('+s.why+')'}`).join('\n');
  if(v==='vyos')return['Connection          State    Uptime    Bytes In/Out    Packets In/Out    Remote address    Remote ID    Proposal','------------------  -------  --------  --------------  ----------------  ----------------  -----------  ----------',...L.map(s=>`${(s.t.name+'-tunnel-1').padEnd(20)}${(s.state==='UP'?'up':'down').padEnd(9)}${(s.state==='UP'?'3m12s':'').padEnd(10)}${(s.state==='UP'?'8K/8K':'0B/0B').padEnd(16)}${(s.state==='UP'?'100/100':'0/0').padEnd(18)}${s.t.peer.padEnd(18)}${s.t.peer.padEnd(13)}${s.t.kind==='ipsec'?vEnc(s.t).f.toUpperCase()+'_CBC/'+vHash(s.t).f.toUpperCase():'WireGuard'}${s.state==='UP'?'':'\n   ↳ '+s.why}`)].join('\n');
  return rows.join('\n\n')}
function vpnLint(out){vpnStates();Object.entries(VPNS).forEach(([id,L])=>{const d=dev(id);(L||[]).forEach(s=>{if(s.state!=='UP'&&!s.t.shut)out.push(['warn',`${d.name}: VPN ${s.t.name} (${s.t.kind==='wireguard'?'WireGuard':'IPsec'} → ${s.t.peer||'?'}) DOWN — ${s.why}`])})})}
/* configuração do SO dos hosts (script de provisionamento) */
function genHostOs(d){const o=osInfo(d);const L=[];const F=fsAll(d);const base=baseFiles({...d,fs:{}});
  if(o.fam==='win'){L.push(`# ${d.name} — ${o.name}`,`# Script PowerShell gerado pela Bancada de Rede em ${today()} (rode como Administrador).`,'');
    winIfs(d).forEach(k=>{const c=pc(d.ports[k].ip);if(!c)return;L.push(`New-NetIPAddress -InterfaceAlias "${winAlias(d,k)}" -IPAddress ${i2ip(c.ip)} -PrefixLength ${c.len}${d.gw&&inNet(ip2i(d.gw)??0,c)?' -DefaultGateway '+d.gw:''}`)});
    if(d.dns)L.push(`Set-DnsClientServerAddress -InterfaceAlias "Ethernet" -ServerAddresses ${d.dns}`);(d.routes||[]).forEach(r=>L.push(`New-NetRoute -DestinationPrefix ${r.dst} -NextHop ${r.nh} -InterfaceAlias "Ethernet"`));
    const feats=(d.pkgs||[]).filter(p=>Object.values(WFEAT).some(f=>f.n===p));if(feats.length)L.push('',d.os==='windows-server-2022'?`Install-WindowsFeature ${feats.join(',')} -IncludeManagementTools`:`Enable-WindowsOptionalFeature -Online -FeatureName ${feats.join(',')}`);
    if((d.pkgs||[]).includes('OpenSSH.Server'))L.push('Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0');
    const dw=osDefaults(d.os,d.type).svcs;Object.entries(d.svcs||{}).forEach(([n,s])=>{if(dw[n]&&dw[n].active===s.active&&dw[n].enabled===s.enabled)return;L.push(s.active?`Set-Service -Name ${n} -StartupType ${s.enabled?'Automatic':'Manual'}; Start-Service ${n}`:`Stop-Service ${n}; Set-Service -Name ${n} -StartupType Disabled`)});
    const fw=hostFw(d);L.push('',`Set-NetFirewallProfile -Profile Domain,Public,Private -Enabled ${fw.on?'True':'False'}`);if(fw.icmp)L.push('New-NetFirewallRule -DisplayName "ICMPv4-In" -Protocol ICMPv4 -IcmpType 8 -Action Allow');
    (fw.allow||[]).forEach(x=>L.push(`New-NetFirewallRule -DisplayName "${x[3]||'Porta '+x[1]}" -Direction Inbound -Protocol ${String(x[0]).toUpperCase()==='ANY'?'Any':String(x[0]).toUpperCase()}${x[1]!=='any'?' -LocalPort '+x[1]:''}${x[2]?' -RemoteAddress '+x[2]:''} -Action Allow`));
    (d.dnsZones||[]).forEach(z=>L.push(`Add-DnsServerPrimaryZone -Name ${z} -ZoneFile ${z}.dns`));(d.dnsRecs||[]).forEach(r=>L.push(`Add-DnsServerResourceRecordA -ZoneName ${r.zone} -Name ${r.name} -IPv4Address ${r.ip}`));
    Object.entries(F).filter(([p,v])=>base[p]!==v&&!/drivers\/etc\/hosts$/.test(p)||/drivers\/etc\/hosts$/.test(p)&&base[p]!==v).forEach(([p,v])=>L.push('',`Set-Content -Path "${p.replace(/\//g,'\\')}" -Value @'\n${v.replace(/\n$/,'')}\n'@`));
    return L.join('\n')}
  const pm=o.pm==='apt'?'apt-get install -y':o.pm==='apk'?'apk add':o.pm==='dnf'?'dnf install -y':'rpm-ostree install';const def=osDefaults(d.os,d.type);const extra=(d.pkgs||[]).filter(p=>!def.pkgs.includes(p));
  L.push('#!/bin/sh',`# ${d.name} — ${o.name}${clusterOf(d)&&clusterOf(d)!==d?' — nó '+nodeRole(d)+' do cluster '+clusterOf(d).name:''}`,`# Script de provisionamento gerado pela Bancada de Rede em ${today()}.`,`# Imagem de container equivalente: ${o.img||'(não há imagem oficial)'}`,'set -e','');
  L.push(`hostnamectl set-hostname ${d.name} 2>/dev/null || echo ${d.name} > /etc/hostname`);
  if(extra.length)L.push('',`# ---- pacotes ----`,...(o.pm==='apt'?['apt-get update']:o.pm==='apk'?['apk update']:[]),`${pm} ${extra.join(' ')}`);
  const net=Object.keys(base).filter(p=>/^\/etc\/(netplan|network\/interfaces|NetworkManager)/.test(p));net.forEach(p=>L.push('',`# ---- rede: ${p} ----`,`cat > ${p} <<'EOF'`,(F[p]||base[p]).replace(/\n$/,''),'EOF'));
  if(/Ubuntu/.test(o.name))L.push('netplan apply');else if(o.fam==='rpm')L.push('nmcli con reload && nmcli con up '+spn(d,0));else L.push('ifup -a || systemctl restart networking');
  if(d.dns&&!/Ubuntu/.test(o.name))L.push(`echo "nameserver ${d.dns}" > /etc/resolv.conf`);
  const changed=Object.entries(F).filter(([p,v])=>base[p]!==v&&!net.includes(p)&&!/^\/(proc|root\/\.bashrc)/.test(p));if(changed.length){L.push('','# ---- arquivos ----');changed.forEach(([p,v])=>L.push(`mkdir -p ${p.slice(0,p.lastIndexOf('/'))||'/'}`,`cat > ${p} <<'EOF'`,v.replace(/\n$/,''),'EOF'))}
  const S2=Object.entries(d.svcs||{}).filter(([n,s])=>!(def.svcs[n]&&def.svcs[n].active===s.active&&def.svcs[n].enabled===s.enabled));if(S2.length){L.push('','# ---- serviços ----');S2.forEach(([n,s])=>L.push(o.fam==='apk'?`rc-update ${s.enabled?'add':'del'} ${n}; rc-service ${n} ${s.active?'start':'stop'}`:`systemctl ${s.enabled?'enable':'disable'} ${s.active?'--now ':''}${n}${!s.active?' && systemctl stop '+n:''}`))}
  const fw=hostFw(d);if(o.fw==='ufw'&&(fw.on||(fw.allow||[]).length)){L.push('','# ---- firewall (ufw) ----');(fw.allow||[]).forEach(x=>L.push(x[2]?`ufw allow from ${x[2]}${x[1]!=='any'?' to any port '+x[1]+' proto '+x[0]:''}`:`ufw allow ${x[1]}${x[0]!=='any'?'/'+x[0]:''}`));if(fw.on)L.push('ufw --force enable')}
  else if(o.fw==='firewalld'){L.push('','# ---- firewall (firewalld) ----');(fw.perm||fw.allow||[]).forEach(x=>L.push(x[2]?`firewall-cmd --permanent --add-rich-rule='rule family="ipv4" source address="${x[2]}"${x[1]!=='any'?` port port="${x[1]}" protocol="${x[0]}"`:''} accept'`:`firewall-cmd --permanent --add-port=${x[1]}/${x[0]}`));if(fw.icmp===false)L.push('firewall-cmd --permanent --add-icmp-block=echo-request');L.push('firewall-cmd --reload',...(fw.on?[]:['systemctl disable --now firewalld']))}
  else if(fw.on){L.push('','# ---- firewall (iptables) ----','iptables -A INPUT -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT','iptables -A INPUT -i lo -j ACCEPT',...(fw.icmp?['iptables -A INPUT -p icmp -j ACCEPT']:[]),...(fw.allow||[]).map(x=>`iptables -A INPUT ${x[2]?'-s '+x[2]+' ':''}${x[0]!=='any'?`-p ${x[0]} --dport ${x[1]} `:''}-j ACCEPT`),'iptables -P INPUT DROP')}
  const ip=(d.vpns||[]).filter(t=>t.kind==='ipsec'),wg=(d.vpns||[]).filter(t=>t.kind==='wireguard');
  if(ip.length&&!F['/etc/ipsec.conf']){L.push('','# ---- IPsec (strongSwan) ----',`${pm} strongswan`,`cat > /etc/ipsec.conf <<'EOF'`,ipsecConfText(d).replace(/\n$/,''),'EOF',`cat > /etc/ipsec.secrets <<'EOF'`,ipsecSecretsText(d).replace(/\n$/,''),'EOF','ipsec restart')}
  else if(ip.length)L.push('ipsec restart');
  wg.forEach(t=>{if(!F[`/etc/wireguard/${t.name}.conf`]||base[`/etc/wireguard/${t.name}.conf`])L.push('',`# ---- WireGuard ${t.name} ----`,`cat > /etc/wireguard/${t.name}.conf <<'EOF'`,wgConfText(d,t.name).replace(/\n$/,''),'EOF');L.push(`systemctl enable --now wg-quick@${t.name}`)});
  (d.dockers||[]).forEach(c=>L.push('',`docker run -d --name ${c.name}${(c.ports||[]).map(([h,p])=>` -p ${h}:${p}`).join('')}${c.restart&&c.restart!=='no'?' --restart '+c.restart:''} ${c.image}${c.cmd?' '+c.cmd:''}`));
  (d.listen||[]).forEach(l=>L.push(`# em execução: ${l.cmd}`));
  return L.join('\n')}
function genCloud(d){const c=d.cloud||{};const L=[`# ${d.name} — ${cloudKind(d)==='real'?'Internet real (o tráfego que não pertence ao lab sai pelo servidor da bancada)':'Internet fake (fechada dentro do lab)'}`,c.mode==='host'?`# Ponte com a rede do computador: ${c.lan}, gateway ${c.gw}, IP público ${c.pub||'(não detectado)'}`:`# Pool de IPs públicos para os enlaces: ${c.pool||'-'}`,''];
  d.ports.forEach((p,k)=>{const L2=linkAt(d.id,k);if(!pc(p.ip)&&!L2)return;L.push(`${spn(d,k).padEnd(8)} ${String(p.ip||'').padEnd(18)} ${L2?'→ '+dev(L2.peer).name+' '+spn(dev(L2.peer),L2.peerK):''}`)});
  if((d.loops||[]).length){L.push('','# Endereços de serviço (respondem ping, DNS e HTTP):');d.loops.forEach(l=>L.push(`  ${l.ip.padEnd(20)} ${l.desc||''}`))}
  if((c.dns||[]).length){L.push('','# DNS da nuvem:');c.dns.forEach(r=>L.push(`  ${r.name.padEnd(28)} A ${r.ip}`))}
  if((d.routes||[]).length){L.push('','# Rotas para blocos públicos atrás dos clientes:');d.routes.forEach(r=>L.push(`  ${r.dst} via ${r.nh}`))}return L.join('\n')}
/* ---------- encaminhamento de portas (NAT de destino) ---------- */
function natWan(d){const f=l3ifs(d).find(f=>f.nat&&!f.mgmt)||l3ifs(d).find(f=>!f.mgmt&&isPublic(f.c.ip))||l3ifs(d).find(f=>!f.mgmt);return f||null}
function natGen(v,d){const R=(d.dnat||[]).filter(r=>ip2i(r.to)!==null&&+r.port);if(!R.length)return'';const f=natWan(d);const ifn=f?pn(v,d,f.k)+(f.kind==='sub'?'.'+f.vlan:''):'?';const wip=f?i2ip(f.c.ip):'0.0.0.0';const L=[];
  if(v==='cisco'||v==='nxos'||v==='eos'||v==='os10'||v==='aoscx'){if(v!=='cisco')return`!\n! Encaminhamento de portas (${R.map(r=>r.port).join(', ')}) — ${VN[v]} não faz NAT nesta bancada.`;L.push('!');R.forEach(r=>L.push(`ip nat inside source static ${r.proto||'tcp'} ${r.to} ${r.toPort||r.port} interface ${ifn} ${r.port}`));return L.join('\n')}
  if(v==='junos'){L.push(`set security nat destination pool BANCADA-DUMMY address 0.0.0.0/32`);R.forEach((r,i)=>{const n=`PF-${r.port}`;L.push(`set security nat destination pool ${n} address ${r.to}/32 port ${r.toPort||r.port}`,`set security nat destination rule-set BANCADA-DNAT from interface ${ifn}`,`set security nat destination rule-set BANCADA-DNAT rule ${n} match destination-address ${wip}/32`,`set security nat destination rule-set BANCADA-DNAT rule ${n} match destination-port ${r.port}`,`set security nat destination rule-set BANCADA-DNAT rule ${n} match protocol ${r.proto||'tcp'}`,`set security nat destination rule-set BANCADA-DNAT rule ${n} then destination-nat pool ${n}`)});return L.filter(l=>!/DUMMY/.test(l)).join('\n')}
  if(v==='huawei'){L.push('#',`interface ${ifn}`);R.forEach(r=>L.push(` nat server protocol ${r.proto||'tcp'} global current-interface ${r.port} inside ${r.to} ${r.toPort||r.port}`));L.push('#');return L.join('\n')}
  if(v==='fortios'){L.push('config firewall vip');R.forEach(r=>L.push(`    edit "PF-${r.proto||'tcp'}-${r.port}"`,`        set extip ${wip}`,`        set mappedip "${r.to}"`,`        set extintf "${ifn}"`,'        set portforward enable',...(r.proto==='udp'?['        set protocol udp']:[]),`        set extport ${r.port}`,`        set mappedport ${r.toPort||r.port}`,'    next'));L.push('end');return L.join('\n')}
  if(v==='vyos'){R.forEach((r,i)=>{const n=100+i*10;L.push(`set nat destination rule ${n} description 'PF-${r.port}'`,`set nat destination rule ${n} destination port ${r.port}`,`set nat destination rule ${n} inbound-interface name ${ifn}`,`set nat destination rule ${n} protocol ${r.proto||'tcp'}`,`set nat destination rule ${n} translation address ${r.to}`,`set nat destination rule ${n} translation port ${r.toPort||r.port}`)});return L.join('\n')}
  if(v==='routeros'){R.forEach(r=>L.push(`/ip firewall nat add chain=dstnat in-interface=${ifn} protocol=${r.proto||'tcp'} dst-port=${r.port} action=dst-nat to-addresses=${r.to} to-ports=${r.toPort||r.port} comment="PF-${r.port}"`));return L.join('\n')}
  return''}
function parseNat(text,fmt){const t=String(text||'');const R=[];let m;
  if(fmt==='junos'){const pool={},rule={};t.split('\n').forEach(l=>{if((m=l.match(/^set security nat destination pool (\S+) address ([\d.]+)\/32(?: port (\d+))?/)))pool[m[1]]={to:m[2],toPort:+m[3]||0};if((m=l.match(/rule (\S+) match destination-port (\d+)/)))(rule[m[1]]=rule[m[1]]||{}).port=+m[2];if((m=l.match(/rule (\S+) match protocol (\S+)/)))(rule[m[1]]=rule[m[1]]||{}).proto=m[2];if((m=l.match(/rule (\S+) then destination-nat pool (\S+)/)))(rule[m[1]]=rule[m[1]]||{}).pool=m[2]});
    Object.values(rule).forEach(r=>{const p=pool[r.pool];if(p&&r.port)R.push({proto:r.proto||'tcp',port:r.port,to:p.to,toPort:p.toPort||r.port,desc:''})});return R}
  if(fmt==='fortios'){const re=/edit "?([^"\n]+)"?\n([\s\S]*?)\n\s*next/g;const sec=(t.match(/config firewall vip\n([\s\S]*?)\nend/)||[])[1]||'';while((m=re.exec(sec))){const b=m[2];const g=k=>(b.match(new RegExp('set '+k+' "?([^"\\n]+)"?'))||[])[1];if(g('portforward')==='enable'&&g('mappedip'))R.push({proto:g('protocol')||'tcp',port:+g('extport'),to:g('mappedip'),toPort:+g('mappedport')||+g('extport'),desc:''})}return R}
  if(fmt==='vyos'){const r={};t.split('\n').forEach(l=>{if((m=l.match(/^set nat destination rule (\d+) (destination port|protocol|translation address|translation port) '?([^'\s]+)/))){const x=r[m[1]]=r[m[1]]||{};x[m[2]]=m[3]}});Object.values(r).forEach(x=>{if(x['translation address']&&x['destination port'])R.push({proto:x.protocol||'tcp',port:+x['destination port'],to:x['translation address'],toPort:+x['translation port']||+x['destination port'],desc:''})});return R}
  if(fmt==='routeros'){const re=/chain=dstnat[^\n]*/g;while((m=re.exec(t))){const l=m[0];const g=k=>(l.match(new RegExp(k+'=("[^"]*"|\\S+)'))||[])[1];if(g('action')==='dst-nat'&&g('to-addresses'))R.push({proto:g('protocol')||'tcp',port:+g('dst-port'),to:g('to-addresses'),toPort:+g('to-ports')||+g('dst-port'),desc:''})}return R}
  if(fmt==='huawei'){const re=/nat server protocol (tcp|udp) global (?:current-interface|\S+) (\d+) inside ([\d.]+) (\d+)/g;while((m=re.exec(t)))R.push({proto:m[1],port:+m[2],to:m[3],toPort:+m[4],desc:''});return R}
  const re=/ip nat inside source static (tcp|udp) ([\d.]+) (\d+) (?:interface \S+|[\d.]+) (\d+)/g;while((m=re.exec(t)))R.push({proto:m[1],port:+m[4],to:m[2],toPort:+m[3],desc:''});return R}

/* ====================================================================
   Interfaces web dos equipamentos (GUI de gerência simulada)
   Mesmo motor atende: curl de dentro do lab, janela do app e acesso de fora.
   webUI(d, req) → {status, headers, body, changed}
   req: {method, path, form, cookies, app (true = janela do app, já autenticado)}
   ==================================================================== */
const WEBSESS={};
const WEBST={};
const hx=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
/* "pele" de cada sistema: nome do produto, menus e credenciais padrão de laboratório */
const WEBSKIN={
  fortios:{product:'FortiGate',sub:'FortiOS 7.4 (simulado)',user:'admin',pass:'admin',top:'#1d2733',nav:'#26313d',navTx:'#c8d1da',acc:'#da291c',font:'"Segoe UI",Arial,sans-serif',
    menu:[['dash','Dashboard','Status'],['ifs','Network','Interfaces'],['routes','Network','Static Routes'],['pol','Policy & Objects','Firewall Policy'],['vip','Policy & Objects','Virtual IPs'],['vpn','VPN','IPsec Tunnels'],['sys','System','Settings'],['cli','','CLI Console']]},
  junos:{product:'J-Web',sub:'Junos OS 23.4R1 (simulado)',user:'root',pass:'lab123',top:'#2b2f33',nav:'#f2f2f2',navTx:'#333',acc:'#0a7a3e',font:'Arial,Helvetica,sans-serif',
    menu:[['dash','Monitor','Dashboard'],['ifs','Network','Interfaces'],['vlans','Network','VLANs'],['routes','Network','Routing › Static Routing'],['pol','Security Policies & Objects','Security Policies'],['vip','Security Services','NAT › Destination NAT'],['vpn','Network','VPN › IPsec VPN'],['sys','Device Administration','Basic Settings'],['cli','Device Administration','CLI Tools']]},
  cisco:{product:'Cisco IOS XE',sub:'WebUI 17.12 (simulado)',user:'admin',pass:'admin',top:'#0d274d',nav:'#1b3b6f',navTx:'#dfe8f5',acc:'#049fd9',font:'Arial,Helvetica,sans-serif',
    menu:[['dash','Monitoring','Dashboard'],['ifs','Configuration','Interface › Ethernet'],['vlans','Configuration','Layer2 › VLAN'],['routes','Configuration','Routing › Static Routing'],['pol','Configuration','Security › ACL'],['vip','Configuration','Security › NAT'],['vpn','Monitoring','Security › VPN'],['sys','Administration','Device'],['cli','Administration','Command Line Interface']]},
  nxos:{product:'NX-OS Device Manager',sub:'NX-OS 10.3 (simulado)',user:'admin',pass:'admin',top:'#0d274d',nav:'#1b3b6f',navTx:'#dfe8f5',acc:'#049fd9',font:'Arial,Helvetica,sans-serif',
    menu:[['dash','Summary','Device'],['ifs','Interfaces','Physical'],['vlans','Layer 2','VLANs'],['routes','Layer 3','Static Routes'],['pol','Security','ACLs'],['sys','Admin','General'],['cli','Admin','NX-API Sandbox']]},
  eos:{product:'Arista EOS',sub:'eAPI / Command Explorer — EOS 4.31 (simulado)',user:'admin',pass:'admin',top:'#222',nav:'#333',navTx:'#ddd',acc:'#4fa3d8',font:'Helvetica,Arial,sans-serif',
    menu:[['dash','System','Overview'],['ifs','Interfaces','Ethernet'],['vlans','Switching','VLANs'],['routes','Routing','Static Routes'],['pol','Security','ACLs'],['sys','System','Settings'],['cli','eAPI','Command Explorer']]},
  aoscx:{product:'Aruba CX',sub:'AOS-CX 10.13 Web UI (simulado)',user:'admin',pass:'admin',top:'#ffffff',topTx:'#333',nav:'#f5f5f5',navTx:'#333',acc:'#ff8300',font:'"Helvetica Neue",Arial,sans-serif',
    menu:[['dash','','Overview'],['ifs','','Interfaces'],['vlans','','VLANs'],['routes','','Routing'],['pol','','ACLs'],['sys','','System'],['cli','','CLI']]},
  huawei:{product:'Huawei Web',sub:'VRP V800R022 (simulado)',user:'admin',pass:'Admin@123',top:'#3a3a3a',nav:'#ececec',navTx:'#333',acc:'#c7000b',font:'Arial,"Microsoft YaHei",sans-serif',
    menu:[['dash','Monitoring','Device Information'],['ifs','Configuration','Interface Management'],['vlans','Configuration','VLAN'],['routes','Configuration','Route › Static Route'],['pol','Configuration','ACL'],['vip','Configuration','NAT › Server Mapping'],['vpn','Monitoring','IPsec'],['sys','Maintenance','System'],['cli','Maintenance','Command Line']]},
  routeros:{product:'WebFig',sub:'RouterOS v7.15 (simulado)',user:'admin',pass:'',top:'#2a2a2a',nav:'#393939',navTx:'#eee',acc:'#3d6ca6',font:'Verdana,Arial,sans-serif',
    menu:[['dash','','System › Resources'],['ifs','','Interfaces'],['routes','IP','Routes'],['pol','IP','Firewall › Filter Rules'],['vip','IP','Firewall › NAT'],['vpn','','IPsec / WireGuard'],['sys','','System › Identity'],['cli','','Terminal']]},
  generic:{product:'Web Management',sub:'(simulado)',user:'admin',pass:'admin',top:'#333',nav:'#eee',navTx:'#333',acc:'#3a7bd5',font:'Arial,sans-serif',
    menu:[['dash','','Status'],['ifs','','Ports'],['vlans','','VLANs'],['sys','','System']]},
  idrac:{product:'Integrated Dell Remote Access Controller 9',sub:'iDRAC9 7.10 Enterprise (simulado)',user:'root',pass:'calvin',top:'#0b2742',nav:'#ffffff',navTx:'#0b2742',acc:'#0672cb',font:'Roboto,Arial,sans-serif',bmc:true,
    menu:[['dash','','Dashboard'],['inv','System','Overview'],['power','System','Power'],['net','iDRAC Settings','Connectivity'],['logs','Maintenance','System Event Log'],['vcon','','Virtual Console']]},
  ilo:{product:'iLO 6',sub:'HPE iLO 6 v1.60 (simulado)',user:'Administrator',pass:'password',top:'#01a982',nav:'#263040',navTx:'#d8dde3',acc:'#01a982',font:'Arial,sans-serif',bmc:true,
    menu:[['dash','','Information'],['inv','','System Information'],['power','','Power & Thermal'],['net','','iLO Dedicated Network Port'],['logs','','Integrated Management Log'],['vcon','','Remote Console']]},
  xcc:{product:'XClarity Controller',sub:'Lenovo XCC2 (simulado)',user:'USERID',pass:'PASSW0RD',top:'#1a1a1a',nav:'#f4f4f4',navTx:'#333',acc:'#e2231a',font:'Arial,sans-serif',bmc:true,
    menu:[['dash','','Home'],['inv','','Inventory'],['power','','Server Power'],['net','BMC Configuration','Network'],['logs','','Events'],['vcon','','Remote Console']]},
  cimc:{product:'Cisco Integrated Management Controller',sub:'CIMC 4.3 (simulado)',user:'admin',pass:'password',top:'#0d274d',nav:'#1b3b6f',navTx:'#dfe8f5',acc:'#049fd9',font:'Arial,sans-serif',bmc:true,
    menu:[['dash','Chassis','Summary'],['inv','Chassis','Inventory'],['power','Chassis','Power'],['net','Admin','Networking'],['logs','Chassis','Faults and Logs'],['vcon','','KVM Console']]},
  bmc:{product:'BMC Web',sub:'Supermicro BMC (simulado)',user:'ADMIN',pass:'ADMIN',top:'#004a8f',nav:'#eef2f6',navTx:'#123',acc:'#004a8f',font:'Arial,sans-serif',bmc:true,
    menu:[['dash','','Dashboard'],['inv','System','Component Info'],['power','Remote Control','Power Control'],['net','Configuration','Network'],['logs','Maintenance','Event Log'],['vcon','Remote Control','iKVM/HTML5']]}};
function webSkinOf(d,bmc){if(bmc){const b=String((modelOf(d)||{}).bmc||'BMC').toLowerCase();return b.includes('idrac')?'idrac':b.includes('ilo')?'ilo':b.includes('xcc')?'xcc':b.includes('cimc')?'cimc':'bmc'}
  const o=osOf(d);if(o==='os10'||o==='vyos')return null;return WEBSKIN[o]?o:'generic'}
function webCreds(d,bmc){const k=webSkinOf(d,bmc);const s=WEBSKIN[k];const o=(bmc?d.bmcWeb:d.web)||{};return{user:o.user||s.user,pass:o.pass!==undefined?o.pass:s.pass}}
const serialOf=d=>(hsh('sn'+d.id)>>>0).toString(36).toUpperCase().padStart(7,'0').slice(0,7);
function webCss(s){return`*{box-sizing:border-box}body{margin:0;font:13px/1.45 ${s.font};color:#222;background:#f4f6f8}a{color:${s.acc}}
header{display:flex;align-items:center;gap:16px;height:46px;padding:0 16px;background:${s.top};color:${s.topTx||'#fff'};border-bottom:3px solid ${s.acc}}header b{font-size:15px}header .d{opacity:.8;flex:1}header a{color:inherit}
.wrap{display:flex;min-height:calc(100vh - 46px)}nav{width:215px;background:${s.nav};color:${s.navTx};padding:8px 0;flex:none}nav .g{font-size:11px;text-transform:uppercase;letter-spacing:.06em;opacity:.65;padding:10px 16px 3px}
nav a{display:block;padding:6px 16px;color:inherit;text-decoration:none;border-left:3px solid transparent}nav a.on{border-left-color:${s.acc};background:rgba(127,127,127,.18);font-weight:600}nav a:hover{background:rgba(127,127,127,.12)}
main{flex:1;padding:16px 22px;min-width:0}h1{font-size:19px;margin:2px 0 14px}h2{font-size:14px;margin:18px 0 8px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px}.card{background:#fff;border:1px solid #d9dee3;border-radius:4px;padding:12px}.card .k{font-size:11px;color:#666;text-transform:uppercase}.card .v{font-size:18px;font-weight:600;margin-top:2px}
table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #d9dee3}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #e6e9ec;vertical-align:top}th{background:#eef1f4;font-weight:600;font-size:12px}tr:hover td{background:#f9fbfc}
.up{color:#1a8a3a;font-weight:600}.down{color:#c0392b;font-weight:600}.mute{color:#888}form.inl{display:flex;flex-wrap:wrap;gap:6px;align-items:end;background:#fff;border:1px solid #d9dee3;padding:10px;margin-top:8px}
label{display:flex;flex-direction:column;font-size:11px;color:#555;gap:2px}input,select,textarea{font:inherit;padding:5px 7px;border:1px solid #b9c1c9;border-radius:3px;background:#fff}button,.btn{font:inherit;padding:5px 12px;border:1px solid ${s.acc};background:${s.acc};color:#fff;border-radius:3px;cursor:pointer;text-decoration:none;display:inline-block}
button.sec{background:#fff;color:${s.acc}}.msg{padding:8px 12px;margin-bottom:12px;border-radius:3px;background:#e7f5ec;border:1px solid #9bd3ad}.err{background:#fdecea;border-color:#f1a39b}pre{background:#1e1e1e;color:#e8e8e8;padding:10px;overflow:auto;font:12px/1.4 Consolas,monospace;max-height:60vh}
.bar{height:8px;background:#e3e7eb;border-radius:4px;overflow:hidden}.bar i{display:block;height:100%;background:${s.acc}}.note{color:#666;font-size:12px}
.login{max-width:380px;margin:9vh auto;background:#fff;border:1px solid #d9dee3;border-top:4px solid ${s.acc};padding:26px}.login h2{margin:0 0 4px;font-size:20px}.login form{display:flex;flex-direction:column;gap:10px;margin-top:16px}
@media(max-width:700px){.wrap{flex-direction:column}nav{width:auto}}`}
function webPage(d,skin,cur,title,content,o={}){const s=WEBSKIN[skin];const m=modelOf(d);let menu='',g=null;s.menu.forEach(([k,grp,l])=>{if(k==='vlans'&&!isSw(d.type))return;if((k==='pol'||k==='vip'||k==='vpn')&&!fwd(d.type))return;if((k==='vip'||k==='vpn')&&!(d.type==='fw'||d.type==='rtr'))return;
    if(grp!==g){if(grp)menu+=`<div class="g">${hx(grp)}</div>`;g=grp}menu+=`<a href="/p/${k}"${k===cur?' class="on"':''}>${hx(l)}</a>`});
  return`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${hx(title)} — ${hx(d.name)}</title><style>${webCss(s)}</style></head><body>
<header><b>${hx(s.product)}</b><span class="d">${hx(d.name)} · ${hx(m?m.vendor+' '+m.name:TYPES[d.type].label)}${o.bmc?' · host '+hx(d.name):''}</span><span>${hx(o.user||s.user)} · <a href="/logout">${skin==='fortios'?'Logout':skin==='idrac'?'Log Out':'Sair'}</a></span></header>
<div class="wrap"><nav>${menu}</nav><main><h1>${hx(title)}</h1>${o.msg?`<div class="msg${o.err?' err':''}">${hx(o.msg)}</div>`:''}${content}<p class="note" style="margin-top:22px">${hx(s.sub)} · Bancada de Rede — interface de laboratório; as mudanças valem no lab.</p></main></div></body></html>`}
function loginPage(d,skin,o={}){const s=WEBSKIN[skin];const c=webCreds(d,s.bmc);const m=modelOf(d);
  return`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${hx(s.product)} — ${hx(d.name)}</title><style>${webCss(s)}</style></head><body style="background:${s.top}">
<div class="login"><h2>${hx(s.product)}</h2><div class="note">${hx(d.name)} · ${hx(m?m.vendor+' '+m.name:TYPES[d.type].label)}${s.bmc?' · Service Tag '+serialOf(d):''}</div>${o.err?`<div class="msg err" style="margin-top:12px">${hx(o.err)}</div>`:''}
<form method="post" action="/login"><label>${skin==='routeros'?'Login':'Username'}<input name="u" autocomplete="username" value=""></label><label>Password<input name="p" type="password" autocomplete="current-password"></label><button>${skin==='fortios'?'Login':skin==='idrac'?'Log In':'Entrar'}</button></form>
<p class="note">Lab: usuário <b>${hx(c.user)}</b> / senha <b>${hx(c.pass||'(vazia)')}</b></p></div></body></html>`}
const webRedir=(path,msg,err)=>({status:303,headers:{Location:path+(msg?(path.includes('?')?'&':'?')+(err?'err=':'msg=')+encodeURIComponent(msg):'')},body:''});
const webHtml=(body,status=200,headers={})=>({status,headers:{'Content-Type':'text/html; charset=utf-8',...headers},body});
function webQuery(p){const i=p.indexOf('?');const q={};if(i>=0)p.slice(i+1).split('&').forEach(kv=>{const[a,b]=kv.split('=');if(a)q[decodeURIComponent(a)]=decodeURIComponent((b||'').replace(/\+/g,' '))});return{path:i>=0?p.slice(0,i):p,q}}
/* ---- páginas ---- */
function wDash(d,skin){const L=l3ifs(d,true);const ups=d.ports.filter((p,k)=>!isInternal(d,k)&&linkAt(d.id,k)&&!portDown(d,k)).length;const tot=d.ports.filter((p,k)=>!isInternal(d,k)).length;const m=modelOf(d);
  const cpu=3+hsh(d.id+'c')%25,mem=20+hsh(d.id+'m')%45;const warn=lint().filter(x=>x[1].startsWith(d.name+':')||x[1].startsWith(d.name+' '));
  return`<div class="cards"><div class="card"><div class="k">Hostname</div><div class="v">${hx(d.name)}</div></div><div class="card"><div class="k">Model</div><div class="v" style="font-size:14px">${hx(m?m.vendor+' '+m.name:TYPES[d.type].label)}</div></div>
<div class="card"><div class="k">Serial</div><div class="v">${serialOf(d)}</div></div><div class="card"><div class="k">Firmware</div><div class="v" style="font-size:14px">${hx(WEBSKIN[skin].sub.replace(' (simulado)',''))}</div></div>
<div class="card"><div class="k">Ports up</div><div class="v">${ups} / ${tot}</div></div><div class="card"><div class="k">Uptime</div><div class="v" style="font-size:14px">3d 04:12:51</div></div>
<div class="card"><div class="k">CPU</div><div class="bar"><i style="width:${cpu}%"></i></div>${cpu}%</div><div class="card"><div class="k">Memory</div><div class="bar"><i style="width:${mem}%"></i></div>${mem}%</div></div>
<h2>Addresses</h2><table><tr><th>Interface</th><th>IP</th><th>VRF</th></tr>${L.map(f=>`<tr><td>${hx(ifName(d,f))}</td><td>${hx(cidrStr(f.c))}</td><td>${hx(f.vrf||'')}</td></tr>`).join('')||'<tr><td colspan=3 class="mute">No IP configured</td></tr>'}</table>
<h2>Alerts</h2>${warn.length?`<table>${warn.map(w=>`<tr><td class="${w[0]==='bad'?'down':''}">${hx(w[0]==='bad'?'Critical':w[0]==='warn'?'Warning':'Info')}</td><td>${hx(w[1])}</td></tr>`).join('')}</table>`:'<p class="mute">No alerts.</p>'}`}
function wIfs(d,skin,q){const sw=isSw(d.type);const rows=d.ports.map((p,k)=>({p,k})).filter(x=>!isInternal(d,x.k));const ed=q.edit!=null?rows.find(x=>x.k===+q.edit):null;
  let h=`<table><tr><th>Name</th><th>Status</th><th>${sw?'Mode / VLAN':'Mode'}</th><th>IP/Netmask</th><th>Description</th><th></th></tr>${rows.map(({p,k})=>{const L=linkAt(d.id,k);const st=p.shut?'<span class="down">admin down</span>':portDown(d,k)?'<span class="down">down</span>':L?'<span class="up">up</span>':'<span class="mute">no link</span>';
    return`<tr><td>${hx(spn(d,k))}${isMgmt(d,k)?' <span class="mute">(mgmt)</span>':''}</td><td>${st}</td><td>${hx(p.mode==='routed'?'routed':p.mode==='trunk'?'trunk '+(p.allowed||'all'):'access '+(p.vlan||1))}${+p.lag?' · LAG '+p.lag:''}</td><td>${hx(p.ip||'')}${(p.subs||[]).map(s=>`<br><span class="mute">.${s.vlan} ${hx(s.ip||'')}</span>`).join('')}</td><td>${hx(p.desc||'')}${L?` <span class="mute">→ ${hx(dev(L.peer).name)}</span>`:''}</td><td><a href="/p/ifs?edit=${k}">Edit</a></td></tr>`}).join('')}</table>`;
  if(ed){const p=ed.p;h+=`<h2>Edit ${hx(spn(d,ed.k))}</h2><form class="inl" method="post" action="/a/if"><input type="hidden" name="k" value="${ed.k}">${sw?`<label>Mode<select name="mode">${['access','trunk','routed'].map(m=>`<option${p.mode===m?' selected':''}>${m}</option>`).join('')}</select></label><label>Access VLAN<input name="vlan" value="${hx(p.vlan||1)}" size="5"></label><label>Allowed VLANs<input name="allowed" value="${hx(p.allowed||'')}" size="10"></label>`:''}
<label>IP/prefix<input name="ip" value="${hx(p.ip||'')}" placeholder="10.0.0.1/24"></label><label>Description<input name="desc" value="${hx(p.desc||'')}"></label><label>Admin status<select name="shut"><option value="0">up</option><option value="1"${p.shut?' selected':''}>down</option></select></label>${d.type==='fw'||d.type==='rtr'?`<label>Source NAT (outside)<select name="nat"><option value="0">disable</option><option value="1"${p.nat?' selected':''}>enable</option></select></label>`:''}<button>OK</button></form>`}
  return h}
function wVlans(d){return`<table><tr><th>ID</th><th>Name</th><th>Access ports</th><th></th></tr><tr><td>1</td><td>default</td><td>${hx(d.ports.map((p,k)=>p.mode!=='routed'&&p.mode!=='trunk'&&+(p.vlan||1)===1&&!isInternal(d,k)?spn(d,k):null).filter(Boolean).length)} ports</td><td></td></tr>${(d.vlans||[]).map((v,i)=>`<tr><td>${v.id}</td><td>${hx(v.name)}</td><td>${hx(d.ports.map((p,k)=>p.mode==='access'&&+p.vlan===+v.id?spn(d,k):null).filter(Boolean).join(', ')||'—')}</td><td><form method="post" action="/a/vdel" style="margin:0"><input type="hidden" name="i" value="${i}"><button class="sec">Delete</button></form></td></tr>`).join('')}</table>
<form class="inl" method="post" action="/a/vadd"><label>VLAN ID<input name="id" size="6"></label><label>Name<input name="name"></label><button>Create</button></form>`}
function wRoutes(d){return`<h2>Static routes</h2><table><tr><th>Destination</th><th>Gateway</th><th>VRF</th><th></th></tr>${(d.routes||[]).map((r,i)=>`<tr><td>${hx(r.dst)}</td><td>${hx(r.nh)}</td><td>${hx(r.vrf||'')}</td><td><form method="post" action="/a/rdel" style="margin:0"><input type="hidden" name="i" value="${i}"><button class="sec">Delete</button></form></td></tr>`).join('')||'<tr><td colspan=4 class="mute">No static routes</td></tr>'}</table>
<form class="inl" method="post" action="/a/radd"><label>Destination<input name="dst" placeholder="0.0.0.0/0"></label><label>Gateway<input name="nh" placeholder="203.0.113.1"></label><button>Create New</button></form><h2>Routing table</h2><pre>${hx(routeTable(d))}</pre>`}
function wPol(d,skin){const rs=d.rules||[];return`<p class="note">${d.type==='fw'?'Policies are evaluated top-down; anything not allowed is denied.':'ACL applied to routed traffic; implicit deny at the end once there is any entry.'}</p><table><tr><th>#</th><th>Action</th><th>Protocol</th><th>Source</th><th>Destination</th><th>Port</th><th>Comment</th><th>Hits</th><th></th></tr>${rs.map((r,i)=>`<tr><td>${i+1}</td><td class="${r.act==='permit'?'up':'down'}">${skin==='fortios'?(r.act==='permit'?'ACCEPT':'DENY'):r.act}</td><td>${hx(r.proto)}</td><td>${hx(r.src)}</td><td>${hx(r.dst)}</td><td>${hx(r.port||'any')}</td><td>${hx(r.desc||'')}</td><td>${(HITS[d.id]||[])[i]||0}</td><td style="white-space:nowrap"><form method="post" action="/a/pup" style="display:inline;margin:0"><input type="hidden" name="i" value="${i}"><button class="sec">↑</button></form> <form method="post" action="/a/pdel" style="display:inline;margin:0"><input type="hidden" name="i" value="${i}"><button class="sec">Delete</button></form></td></tr>`).join('')||'<tr><td colspan=9 class="mute">No entries</td></tr>'}</table>
<form class="inl" method="post" action="/a/padd"><label>Action<select name="act"><option value="permit">${skin==='fortios'?'ACCEPT':'permit'}</option><option value="deny">${skin==='fortios'?'DENY':'deny'}</option></select></label><label>Protocol<select name="proto"><option>any</option><option>tcp</option><option>udp</option><option>icmp</option></select></label><label>Source<input name="src" value="any"></label><label>Destination<input name="dst" value="any"></label><label>Port<input name="port" size="6"></label><label>Comment<input name="desc"></label><button>Create New</button></form>`}
function wVip(d){const R=d.dnat||[];const w=natWan(d);return`<p class="note">Destination NAT / port forwarding on ${w?hx(ifName(d,w))+' ('+i2ip(w.c.ip)+')':'the outside interface'}. ${d.type==='fw'?'Remember to allow the translated traffic in the firewall policy.':''}</p><table><tr><th>Protocol</th><th>External port</th><th>Mapped IP</th><th>Mapped port</th><th></th></tr>${R.map((r,i)=>`<tr><td>${hx(r.proto||'tcp')}</td><td>${r.port}</td><td>${hx(r.to)}</td><td>${r.toPort||r.port}</td><td><form method="post" action="/a/ndel" style="margin:0"><input type="hidden" name="i" value="${i}"><button class="sec">Delete</button></form></td></tr>`).join('')||'<tr><td colspan=5 class="mute">No entries</td></tr>'}</table>
<form class="inl" method="post" action="/a/nadd"><label>Protocol<select name="proto"><option>tcp</option><option>udp</option></select></label><label>External port<input name="port" size="6"></label><label>Mapped IP<input name="to"></label><label>Mapped port<input name="toPort" size="6"></label><button>Create New</button></form>
<h2>Source NAT</h2><p>${d.ports.some(p=>p.nat)?'Overload/masquerade on '+hx(d.ports.map((p,k)=>p.nat?spn(d,k):null).filter(Boolean).join(', ')):'<span class="mute">Disabled — enable it on the outside interface.</span>'}</p>`}
function wVpn(d){vpnStates();const L=VPNS[d.id]||[];return`<table><tr><th>Name</th><th>Type</th><th>Remote gateway</th><th>Local / remote networks</th><th>Status</th></tr>${L.map(s=>`<tr><td>${hx(s.t.name)}</td><td>${s.t.kind==='wireguard'?'WireGuard':'IPsec '+(s.t.ike==='v1'?'IKEv1':'IKEv2')}</td><td>${hx(s.t.peer)}</td><td>${hx(netsOf(s.t.lnets).map(netStr).join(' '))} ↔ ${hx(netsOf(s.t.rnets).map(netStr).join(' '))}</td><td class="${s.state==='UP'?'up':'down'}">${s.state==='UP'?'Up':'Down'}${s.state==='UP'?'':'<br><span class="mute">'+hx(s.why)+'</span>'}</td></tr>`).join('')||'<tr><td colspan=5 class="mute">No tunnels — configure in the lab (VPN tab or CLI).</td></tr>'}</table>`}
function wSys(d,skin){const c=webCreds(d,false);return`<form class="inl" method="post" action="/a/host"><label>Hostname<input name="name" value="${hx(d.name)}"></label><button>Apply</button></form>
<h2>Administrator</h2><form class="inl" method="post" action="/a/pass"><label>Username<input name="u" value="${hx(c.user)}"></label><label>New password<input name="p" type="password"></label><button>Change</button></form>
<h2>Configuration</h2><p><a class="btn" href="/download/config">Backup configuration</a></p>`}
function wCli(d,skin,o){const st=WEBST[d.id]||(WEBST[d.id]={mode:'exec',ifc:null,vlan:null,log:[],hist:[],hi:0});
  return`<pre id="out">${hx(st.log.slice(-200).map(x=>x.s).join('\n'))||'(sem saída)'}</pre><form class="inl" method="post" action="/a/cli"><label style="flex:1">${hx(promptOf(d,st))}<input name="c" autofocus style="font-family:monospace"></label><button>Run</button></form><script>var o=document.getElementById('out');o.scrollTop=o.scrollHeight</script>`}
/* ---- BMC ---- */
const bmcPort=d=>d.ports.findIndex((p,k)=>isMgmt(d,k));
function wBDash(d,skin){const m=modelOf(d)||{};const on=d.power!=='off';const o=osInfo(d);const k=bmcPort(d);const bp=k>=0?d.ports[k]:{};
  return`<div class="cards"><div class="card"><div class="k">System</div><div class="v" style="font-size:14px">${hx((m.vendor||'')+' '+(m.name||'Server'))}</div></div><div class="card"><div class="k">${skin==='idrac'?'Service Tag':'Serial Number'}</div><div class="v">${serialOf(d)}</div></div>
<div class="card"><div class="k">Power State</div><div class="v ${on?'up':'down'}">${on?'ON':'OFF'}</div></div><div class="card"><div class="k">System Health</div><div class="v up">Healthy</div></div>
<div class="card"><div class="k">Host OS</div><div class="v" style="font-size:14px">${hx(o?o.name:'Linux')}</div></div><div class="card"><div class="k">Host Name</div><div class="v" style="font-size:14px">${hx(d.name)}</div></div>
<div class="card"><div class="k">${hx(m.bmc||'BMC')} IP</div><div class="v" style="font-size:14px">${hx(bp.ip||'—')}</div></div><div class="card"><div class="k">Firmware</div><div class="v" style="font-size:14px">${hx(WEBSKIN[skin].sub.replace(' (simulado)',''))}</div></div></div>
<h2>Quick actions</h2><form class="inl" method="post" action="/a/power"><select name="op"><option value="on">Power On</option><option value="off">Power Off (graceful)</option><option value="cycle">Power Cycle</option><option value="reset">Reset (warm boot)</option></select><button>Apply</button></form>`}
function wBInv(d){const m=modelOf(d)||{};const g=memOf(d);return`<table><tr><th>Component</th><th>Details</th></tr><tr><td>Model</td><td>${hx((m.vendor||'')+' '+(m.name||''))}</td></tr><tr><td>Processors</td><td>2 × Intel Xeon Gold 6338 (32C)</td></tr><tr><td>Memory</td><td>${g} GB DDR4-3200 (${Math.max(2,g/32)} DIMMs)</td></tr><tr><td>Storage</td><td>RAID 1 · 2 × 960 GB SSD</td></tr>
${d.ports.map((p,k)=>`<tr><td>NIC ${hx(spn(d,k))}</td><td>${hx(macLinux(mac(d.id,'p'+k)).toUpperCase())} · ${linkAt(d.id,k)&&!portDown(d,k)?'<span class="up">Link Up</span>':'<span class="mute">Link Down</span>'}${isMgmt(d,k)?' · dedicated management':''}</td></tr>`).join('')}</table>`}
function wBPower(d){const on=d.power!=='off';return`<p>Current state: <b class="${on?'up':'down'}">${on?'On':'Off'}</b></p><form class="inl" method="post" action="/a/power">${['on','off','cycle','reset'].map(o=>`<button name="op" value="${o}"${(o==='on'&&on)||(o!=='on'&&!on)?' class="sec"':''}>${({on:'Power On',off:'Power Off',cycle:'Power Cycle',reset:'Reset'})[o]}</button>`).join(' ')}</form><h2>Power consumption</h2><p>${on?wattsOf(d)||450:0} W</p>`}
function wBNet(d){const k=bmcPort(d);if(k<0)return'<p class="mute">Sem porta de gerência.</p>';const p=d.ports[k];const c=pc(p.ip);
  return`<form class="inl" method="post" action="/a/bnet"><label>Static IP Address<input name="ip" value="${hx(c?i2ip(c.ip):'')}"></label><label>Subnet Mask<input name="mask" value="${hx(c?msk(c):'255.255.255.0')}"></label><label>Gateway<input name="gw" value="${hx(p.gw||'')}"></label><button>Apply</button></form><p class="note">Port ${hx(spn(d,k))} · MAC ${hx(macLinux(mac(d.id,'p'+k)).toUpperCase())} · ${linkAt(d.id,k)?'connected to '+hx(dev(linkAt(d.id,k).peer).name):'no link'}</p>`}
function wBLogs(d){const L=(d.sel||[]).slice(-40).reverse();return`<table><tr><th>Date/Time</th><th>Severity</th><th>Description</th></tr>${L.map(e=>`<tr><td>${hx(e.t)}</td><td>${hx(e.sev)}</td><td>${hx(e.msg)}</td></tr>`).join('')}<tr><td>2026-10-12 09:00:00</td><td>Info</td><td>The system booted.</td></tr></table>`}
function wBCon(d,skin,o){return(o.app?`<p><a class="btn" href="/__term">Launch Virtual Console</a></p>`:'')+`<p class="note">Console texto do sistema operacional do host:</p>`+wCli(d,skin,o)}
const bselLog=(d,msg,sev='Info')=>{(d.sel=d.sel||[]).push({t:new Date().toISOString().replace('T',' ').slice(0,19),sev,msg});if(d.sel.length>100)d.sel.shift()};
/* ---- ações (POST) ---- */
function webAct(d,act,f,bmc){const bad=m=>({err:m});const ch={ok:true};
  if(act==='cli'){const st=WEBST[d.id]||(WEBST[d.id]={mode:'exec',ifc:null,vlan:null,log:[],hist:[],hi:0});let changed=false;const r=cliRun(d,String(f.c||''),{vendor:'auto',st,onChange:()=>{changed=true}});if(st.log.length>400)st.log.splice(0,st.log.length-400);return{ok:true,changed,async:r&&r.async}}
  if(act==='power'&&bmc){const op=f.op;if(op==='on'){d.power='on';bselLog(d,'The power state of the server is changed to on.')}else if(op==='off'){d.power='off';bselLog(d,'The power state of the server is changed to off.','Warning')}else{d.power='on';bselLog(d,op==='cycle'?'The server power was cycled.':'The server was reset.')}
    if(op!=='off'){Object.values(d.svcs||{}).forEach(s=>s.active=!!s.enabled)}return{ok:true,changed:true,msg:'Power action completed'}}
  if(act==='bnet'&&bmc){const k=bmcPort(d);const l=maskLen(f.mask||'');if(ip2i(f.ip)===null||l===null)return bad('Invalid IP address or subnet mask');if(f.gw&&ip2i(f.gw)===null)return bad('Invalid gateway');d.ports[k].ip=`${f.ip}/${l}`;d.ports[k].mode='routed';d.ports[k].gw=f.gw||'';return{ok:true,changed:true,msg:'Network settings applied — reconnect to the new address if it changed.'}}
  if(act==='if'){const k=+f.k;const p=d.ports[k];if(!p)return bad('Interface not found');if(f.ip&&!pc(f.ip))return bad('Invalid IP/prefix');
    if(isSw(d.type)&&f.mode){p.mode=f.mode;if(f.mode==='access')p.vlan=Math.max(1,Math.min(4094,+f.vlan||1));if(f.mode==='trunk')p.allowed=f.allowed||''}
    if(f.ip!==undefined){p.ip=f.ip;if(f.ip&&!isSw(d.type))p.mode='routed'}p.desc=f.desc||'';p.shut=f.shut==='1';if(f.nat!==undefined){if(f.nat==='1')d.ports.forEach((q,j)=>q.nat=j===k);else p.nat=false}return{ok:true,changed:true,msg:`${spn(d,k)} updated`}}
  if(act==='vadd'){const id=+f.id;if(!(id>=2&&id<=4094))return bad('VLAN ID must be 2–4094');if(d.vlans.some(v=>+v.id===id))return bad('VLAN already exists');d.vlans.push({id,name:(f.name||'VLAN'+String(id).padStart(4,'0')).replace(/\s+/g,'_')});d.vlans.sort((a,b)=>a.id-b.id);return{ok:true,changed:true,msg:`VLAN ${id} created`}}
  if(act==='vdel'){d.vlans.splice(+f.i,1);return{ok:true,changed:true,msg:'VLAN deleted'}}
  if(act==='radd'){const x=pc(f.dst||'');if(!x||ip2i(f.nh)===null)return bad('Invalid destination or gateway');(d.routes=d.routes||[]).push({dst:netStr(x),nh:f.nh});return{ok:true,changed:true,msg:'Route created'}}
  if(act==='rdel'){d.routes.splice(+f.i,1);return{ok:true,changed:true,msg:'Route deleted'}}
  if(act==='padd'){const r={act:f.act==='deny'?'deny':'permit',proto:f.proto||'any',src:(f.src||'any').trim()||'any',dst:(f.dst||'any').trim()||'any',port:/^(tcp|udp)$/.test(f.proto)?String(+f.port||''):'',desc:f.desc||''};for(const x of[r.src,r.dst])if(x!=='any'&&!pc(x))return bad('Invalid address: '+x);(d.rules=d.rules||[]).push(r);return{ok:true,changed:true,msg:'Policy created'}}
  if(act==='pdel'){d.rules.splice(+f.i,1);return{ok:true,changed:true,msg:'Policy deleted'}}
  if(act==='pup'){const i=+f.i;if(i>0)[d.rules[i-1],d.rules[i]]=[d.rules[i],d.rules[i-1]];return{ok:true,changed:true}}
  if(act==='nadd'){const port=+f.port,tp=+f.toPort||port;if(!(port>=1&&port<=65535)||ip2i(f.to)===null)return bad('Invalid port or mapped IP');d.dnat=(d.dnat||[]).filter(r=>!(r.proto===f.proto&&+r.port===port));d.dnat.push({proto:f.proto==='udp'?'udp':'tcp',port,to:f.to,toPort:tp,desc:''});return{ok:true,changed:true,msg:'Virtual IP created'}}
  if(act==='ndel'){d.dnat.splice(+f.i,1);return{ok:true,changed:true,msg:'Entry deleted'}}
  if(act==='host'){const n=String(f.name||'').replace(/[^\w.-]/g,'');if(!n)return bad('Invalid hostname');if(S.devices.some(x=>x!==d&&x.name===n))return bad('Name already used in the lab');d.name=n;return{ok:true,changed:true,msg:'Hostname changed'}}
  if(act==='pass'){d.web={user:String(f.u||'admin'),pass:String(f.p||'')};return{ok:true,changed:true,msg:'Credentials changed'}}
  return bad('Unknown action')}
/* ponto de entrada */
function webUI(d,req){req=req||{};const bmc=!!req.bmc;const skin=webSkinOf(d,bmc);
  if(!skin)return{status:404,headers:{'Content-Type':'text/plain'},body:`${osOf(d)==='vyos'?'VyOS':'Dell OS10'} não tem interface web — use SSH/CLI ou a API REST.\n`};
  const s=WEBSKIN[skin];const{path,q}=webQuery(req.path||'/');const method=(req.method||'GET').toUpperCase();const ck=`BANCADA_${skin}_${d.id}`;
  const tok=(req.cookies||{})[ck];const user=req.app?webCreds(d,bmc).user:(tok&&WEBSESS[tok]&&WEBSESS[tok].dev===d.id&&WEBSESS[tok].bmc===bmc?WEBSESS[tok].user:null);
  if(path==='/login'&&method==='POST'){const c=webCreds(d,bmc);const f=req.form||{};if(String(f.u||'')===c.user&&String(f.p||'')===String(c.pass)){const t=Math.random().toString(36).slice(2)+Math.random().toString(36).slice(2);WEBSESS[t]={dev:d.id,bmc,user:c.user};if(bmc)bselLog(d,`Successfully logged in using ${c.user}, from ${req.client||'web'}.`);return{status:303,headers:{Location:'/','Set-Cookie':`${ck}=${t}; Path=/; HttpOnly; SameSite=Lax`},body:''}}
    if(bmc)bselLog(d,`Login failed from ${req.client||'web'}: ${f.u||''}.`,'Warning');return webHtml(loginPage(d,skin,{err:skin==='fortios'?'Authentication failure':'Invalid username or password'}),401)}
  if(path==='/logout'){if(tok)delete WEBSESS[tok];return{status:303,headers:{Location:'/login','Set-Cookie':`${ck}=; Path=/; Max-Age=0`},body:''}}
  if(!user){if(path==='/login'||path==='/'||method==='GET')return webHtml(loginPage(d,skin),path==='/'||path==='/login'?200:401);return{status:401,headers:{'Content-Type':'text/plain'},body:'401 Unauthorized\n'}}
  if(path==='/download/config'&&!bmc){const v=osOf(d);return{status:200,headers:{'Content-Type':'text/plain; charset=utf-8','Content-Disposition':`attachment; filename="${d.name}-config.txt"`},body:gen(v,d)}}
  if(method==='POST'&&path.startsWith('/a/')){const act=path.slice(3);const r=webAct(d,act,req.form||{},bmc);const back=act==='cli'?'/p/'+(bmc?'vcon':'cli'):(req.form&&req.form._back)||('/p/'+({if:'ifs',vadd:'vlans',vdel:'vlans',radd:'routes',rdel:'routes',padd:'pol',pdel:'pol',pup:'pol',nadd:'vip',ndel:'vip',host:'sys',pass:'sys',power:bmc?'power':'dash',bnet:'net'})[act]||'/p/dash');
    const res=webRedir(back,r.err||r.msg,!!r.err);res.changed=!!r.changed;if(r.async)res.async=r.async;return res}
  const page=path==='/'||path==='/p/'?'dash':path.replace(/^\/p\//,'');const titles=Object.fromEntries(s.menu.map(([k,,l])=>[k,l]));if(!titles[page])return webHtml(webPage(d,skin,'','404',`<p>Page not found.</p>`,{user}),404);
  const o={user,msg:q.msg||q.err,err:!!q.err,app:req.app,bmc};
  const body=bmc?({dash:wBDash,inv:wBInv,power:wBPower,net:wBNet,logs:wBLogs,vcon:wBCon})[page](d,skin,o):({dash:wDash,ifs:(d2,sk)=>wIfs(d2,sk,q),vlans:wVlans,routes:wRoutes,pol:wPol,vip:wVip,vpn:wVpn,sys:wSys,cli:wCli})[page](d,skin,o);
  return webHtml(webPage(d,skin,page,titles[page],body,o))}
/* existe interface web neste IP/porta? */
function webTarget(d,ip){if(!d)return null;if(isHost(d.type)){const k=bmcPort(d);if(k>=0&&pc(d.ports[k].ip)&&pc(d.ports[k].ip).ip===ip)return{bmc:true};return null}if(fwd(d.type)||isSw(d.type))return webSkinOf(d,false)?{bmc:false}:null;return null}
/* ---------- CLI ---------- */
const CLI={};
const cs=id=>CLI[id]||(CLI[id]={mode:'exec',ifc:null,vlan:null,log:[],hist:[],hi:0});
function cliReset(){for(const k in CLI)delete CLI[k];for(const k in HITS)delete HITS[k];for(const k in NATT)delete NATT[k]}
function promptOf(d,st){if(st&&st.ssh){const tg=dev(st.ssh.dev);if(tg)return promptOf(tg,st.ssh.st)}if(isHost(d.type))return d.os?osPrompt(d,st):`root@${d.name}:~#`;if(d.type==='cloud')return`${d.name}>`;
  if(st.mode==='if'&&st.ifc&&st.ifc.range)return d.name+'(config-if-range)#';
  return d.name+({exec:'#',config:'(config)#',if:'(config-if)#',sub:'(config-subif)#',vlan:'(config-vlan)#',ospf:'(config-router)#',acl:'(config-ext-nacl)#',vrf:'(config-vrf)#',rmap:'(config-route-map)#',nve:st.nveVni?'(config-if-nve-vni)#':'(config-if-nve)#',evpn:st.evVni?'(config-evpn-evi)#':'(config-evpn)#',
    bgp:st.bgpNbAf?'(config-router-neighbor-af)#':st.bgpNb?'(config-router-neighbor)#':st.bgpAf?'(config-router-af)#':st.bgpVlan!=null?`(config-macvrf-${st.bgpVlan})#`:st.bgpVrfCtx?'(config-router-vrf)#':'(config-router)#'})[st.mode]}
function clearBgp(st){st.bgpNb=null;st.bgpVrf='';st.bgpAf='';st.bgpNbAf='';st.bgpVlan=null;st.bgpVrfCtx='';st.nveVni=null;st.evVni=null}
const vxEnsure=d=>{if(!d.vxlan||!Array.isArray(d.vxlan.vnis))d.vxlan={src:null,vnis:[]};return d.vxlan};

/* árvore de comandos para Tab e ? ("_" = argumento livre) */
const IFARG={_:'<interface | port-channel N | vlan N>'};
const SHOWT={'running-config':{interface:IFARG},'startup-config':{},vlan:{brief:{}},
  ip:{interface:{brief:{}},route:{static:{},connected:{},ospf:{},bgp:{},vrf:{_:'<nome>'},_:'<A.B.C.D>'},ospf:{neighbor:{},interface:{brief:{}}},bgp:{summary:{},neighbors:{},vrf:{_:'<nome> [summary]'}},vrf:{brief:{}},nat:{translations:{}},arp:{},'access-lists':{}},
  bgp:{summary:{},neighbors:{},vrf:{_:'<nome> [summary]'},ipv4:{unicast:{summary:{}}}},vrf:{brief:{}},
  interfaces:{trunk:{},status:{},...IFARG},'mac':{'address-table':{}},cdp:{neighbors:{}},lldp:{neighbors:{}},arp:{},'access-lists':{},
  etherchannel:{summary:{}},'port-channel':{summary:{}},lacp:{neighbor:{}},vrrp:{brief:{}},inventory:{},environment:{power:{}},version:{},clock:{},history:{}};
SHOWT.mpls={ldp:{neighbor:{}},'forwarding-table':{},interfaces:{}};SHOWT.bgp.vpnv4={unicast:{all:{summary:{}}}};SHOWT.bgp.l2vpn={evpn:{summary:{}}};SHOWT.bgp.evpn={summary:{}};SHOWT.ip.bgp.vpnv4={all:{summary:{}}};SHOWT.ip.bgp._='<rede> (detalhe com communities)';
SHOWT.nve={peers:{},vni:{}};SHOWT.vxlan={vtep:{},vni:{}};SHOWT.l2route={evpn:{mac:{all:{}}}};SHOWT['route-map']={_:'[nome]'};SHOWT.ip['prefix-list']={};SHOWT.ip['community-list']={};
const T_EXEC={show:SHOWT,ping:{vrf:{_:'<nome> <A.B.C.D>'},_:'<A.B.C.D> [vrf <nome>] [tcp|udp <porta>]'},traceroute:{vrf:{_:'<nome> <A.B.C.D>'},_:'<A.B.C.D> [vrf <nome>]'}};
const NOOP={banner:{},username:{},line:{},service:{},logging:{},ntp:{},'snmp-server':{},'spanning-tree':{mode:{}},aaa:{},crypto:{},clock:{},'enable':{secret:{}},feature:{_:'<recurso>'}};
const T_CONF={hostname:{_:'<nome>'},vlan:{_:'<2-4094> ou lista 10,20,30'},interface:{range:{_:'<Eth1/1 - 8 | Gi1/0/1-3,Gi1/0/7>'},'port-channel':{_:'<n>'},...IFARG},
  ip:{route:{vrf:{_:'<nome> <rede> <máscara> <próximo-salto>'},_:'<rede> <máscara> <próximo-salto>'},vrf:{_:'<nome>'},'prefix-list':{_:'<nome> [seq N] permit|deny <rede>/<len> [ge N] [le N]'},'community-list':{standard:{_:'<nome> permit|deny <ASN:nn>'}},'default-gateway':{_:'<A.B.C.D>'},'access-list':{extended:{_:'<nome>'}},nat:{inside:{source:{list:{_:'<acl> interface <if> overload'}}}},routing:{},'domain-name':{_:'<nome>'},'name-server':{_:'<ip>'}},
  'route-map':{_:'<nome> permit|deny <seq>'},mpls:{ip:{},label:{protocol:{ldp:{}}},ldp:{'router-id':{_:'Loopback0 [force]'}}},evpn:{},nv:{overlay:{evpn:{}}},fabric:{forwarding:{'anycast-gateway-mac':{_:'<mac>'}}},
  'access-list':{_:'<100-199> permit|deny <proto> <origem> <destino> [eq <porta>]'},router:{ospf:{_:'<id> [vrf <nome>]'},bgp:{_:'<ASN>'}},vrf:{context:{_:'<nome>'},definition:{_:'<nome>'},instance:{_:'<nome>'},_:'<nome>'},management:{route:{_:'0.0.0.0/0 <gw>'}},
  no:{vlan:{_:'<id>'},ip:{route:{_:'<rede> <máscara> <próximo-salto>'},'access-list':{extended:{_:'<nome>'}},'default-gateway':{}},router:{ospf:{},bgp:{_:'<ASN>'}},vrf:{context:{_:'<nome>'},definition:{_:'<nome>'}},'access-list':{_:'<n>'},interface:IFARG},
  do:T_EXEC,end:{},exit:{},...NOOP};
const T_IF={description:{_:'<texto>'},switchport:{mode:{access:{},trunk:{}},access:{vlan:{_:'<1-4094>'}},trunk:{allowed:{vlan:{_:'<lista> | add <lista> | remove <lista> | all'}},native:{vlan:{_:'<1-4094>'}},encapsulation:{dot1q:{}}}},
  mpls:{ip:{}},fabric:{forwarding:{mode:{'anycast-gateway':{}}}},ip:{address:{_:'<ip> <máscara> | <ip>/<len> | virtual <ip>/<len>'},nat:{inside:{},outside:{}},'access-group':{_:'<nome> in|out'},'helper-address':{_:'<ip>'}},shutdown:{},
  'channel-group':{_:'<n> mode active'},vrrp:{_:'<grupo> ip <A.B.C.D>'},vrf:{forwarding:{_:'<nome>'},member:{_:'<nome>'},_:'<nome>'},standby:{_:'<grupo> ip <A.B.C.D>'},lacp:{rate:{fast:{}}},vpc:{_:'<n> | peer-link'},
  no:{shutdown:{},switchport:{},ip:{address:{},nat:{}},description:{},'channel-group':{},vrrp:{}},'spanning-tree':{portfast:{}},encapsulation:{dot1Q:{_:'<vlan>'}},speed:{_:'auto|1000'},duplex:{_:'auto|full'},mtu:{_:'<bytes>'},end:{},exit:{}};
const T_ACL={permit:{_:'<ip|icmp|tcp|udp> <origem> <destino> [eq <porta>]'},deny:{_:'<ip|icmp|tcp|udp> <origem> <destino> [eq <porta>]'},remark:{_:'<texto>'},no:{_:'<sequência>'},end:{},exit:{}};
const T_OSPF={network:{_:'<rede> <wildcard> area <n>'},'router-id':{_:'<A.B.C.D>'},'passive-interface':{_:'<interface>'},'default-information':{originate:{}},no:{'default-information':{originate:{}}},end:{},exit:{}};
const T_HOST={ip:{a:{},addr:{show:{},add:{_:'<ip>/<len> dev <if>'},del:{_:'<ip>/<len> dev <if>'},flush:{dev:{_:'<if>'}}},r:{},route:{show:{},add:{_:'default via <ip> | <rede>/<len> via <ip>'},del:{_:'default | <rede>/<len>'}},
    link:{show:{},set:{_:'<if> up | down | master bond0 | nomaster'},add:{_:'link <if> name <if>.<vlan> type vlan id <vlan>'},del:{_:'<if>.<vlan>'}},neigh:{}},
  ifconfig:{},route:{_:'-n'},arp:{_:'-n'},ping:{_:'[-c N] <ip>'},traceroute:{_:'<ip>'},nc:{_:'-zv [-u] <ip> <porta>'},curl:{_:'http://<ip>[:porta]'},hostname:{_:'[novo-nome]'},
  ipmitool:{lan:{print:{},set:{_:'1 ipaddr <ip> | 1 netmask <máscara> | 1 defgw ipaddr <gw>'}}},ipconfig:{},clear:{},help:{},exit:{}};
function merge(a,b){const o={...a};for(const k in b){o[k]=(o[k]&&typeof o[k]==='object'&&typeof b[k]==='object')?merge(o[k],b[k]):(k in o?o[k]:b[k])}return o}
const TREES={exec:{...T_EXEC,configure:{terminal:{}},clear:{},write:{memory:{}},copy:{'running-config':{'startup-config':{}}},enable:{},exit:{},display:{}},
  config:{...T_CONF,...T_EXEC}};
TREES.if=merge(T_IF,{...T_CONF,...T_EXEC});TREES.sub=TREES.if;TREES.vlan=merge({name:{_:'<nome>'},end:{},exit:{}},{...T_CONF,...T_EXEC});
TREES.ospf=merge(T_OSPF,{...T_CONF,...T_EXEC});TREES.acl=merge(T_ACL,{...T_EXEC});TREES.host=T_HOST;TREES.vrf=merge({rd:{_:'<ASN:nn>'},'route-target':{_:'import|export|both <ASN:nn>'},'address-family':{ipv4:{}},'exit-address-family':{},ip:{route:{_:'<rede>/<len> <próximo-salto>'}},end:{},exit:{}},{...T_CONF,...T_EXEC});
const T_BGP={'bgp':{'router-id':{_:'<A.B.C.D>'},'log-neighbor-changes':{}},'router-id':{_:'<A.B.C.D>'},neighbor:{_:'<A.B.C.D> remote-as <ASN> | description <txt> | next-hop-self | default-originate | shutdown'},
  network:{_:'<rede> mask <máscara> | <rede>/<len>'},redistribute:{connected:{},static:{},ospf:{_:'<id>'}},'address-family':{ipv4:{unicast:{vrf:{_:'<nome>'}},vrf:{_:'<nome>'}}},'exit-address-family':{},vrf:{_:'<nome>'},
  'remote-as':{_:'<ASN> (depois de "neighbor <ip>")'},description:{_:'<texto>'},'next-hop-self':{},'default-originate':{},shutdown:{},
  no:{neighbor:{_:'<A.B.C.D>'},network:{_:'<rede>'},redistribute:{connected:{},static:{},ospf:{}}},end:{},exit:{}};
T_BGP['address-family']={ipv4:{unicast:{vrf:{_:'<nome>'}},vrf:{_:'<nome>'}},vpnv4:{unicast:{}},l2vpn:{evpn:{}}};T_BGP.neighbor={_:'<A.B.C.D> remote-as <ASN> | update-source Loopback0 | ebgp-multihop | activate | send-community both | route-reflector-client | route-map <nome> in|out | next-hop-self | default-originate | shutdown'};
Object.assign(T_BGP,{activate:{},'update-source':{_:'Loopback<n>'},'ebgp-multihop':{_:'[ttl]'},'send-community':{both:{},extended:{},standard:{}},'route-reflector-client':{},'route-map':{_:'<nome> in|out'}});T_BGP.bgp.default={'ipv4-unicast':{}};
TREES.bgp=merge(T_BGP,{...T_CONF,...T_EXEC});
TREES.rmap=merge({match:{ip:{address:{'prefix-list':{_:'<nome>'}}},community:{_:'<community-list>'}},set:{'local-preference':{_:'<0-4294967295>'},metric:{_:'<MED>'},community:{_:'<ASN:nn ...> [additive] | no-export | no-advertise'},'as-path':{prepend:{_:'<ASN> [<ASN> ...]'}}},description:{_:'<texto>'},end:{},exit:{}},{...T_CONF,...T_EXEC});
TREES.nve=merge({'source-interface':{_:'loopback<n>'},'host-reachability':{protocol:{bgp:{}}},member:{vni:{_:'<vni> [associate-vrf]'}},'ingress-replication':{protocol:{bgp:{},static:{}}},'peer-ip':{_:'<A.B.C.D>'},vxlan:{'source-interface':{_:'Loopback<n>'},vlan:{_:'<vlan> vni <vni>'},vrf:{_:'<nome> vni <vni>'},flood:{vtep:{_:'<A.B.C.D> ...'}}},shutdown:{},end:{},exit:{}},{...T_CONF,...T_EXEC});
TREES.evpn=merge({vni:{_:'<vni> l2'},rd:{auto:{}},'route-target':{import:{auto:{}},export:{auto:{}},both:{auto:{}}},end:{},exit:{}},{...T_CONF,...T_EXEC});
TREES.vlan['vn-segment']={_:'<vni>'};TREES.vrf.vni={_:'<L3VNI>'};
const DESC_VB={mpls:'MPLS / LDP',ldp:'Label Distribution Protocol','forwarding-table':'Tabela de rótulos (LFIB)',vpnv4:'VPNv4 (MPLS L3VPN)',l2vpn:'L2VPN',evpn:'EVPN',nve:'Interface NVE (VTEP VXLAN)',vxlan:'VXLAN',l2route:'Rotas MAC EVPN','route-map':'Route-map (política BGP)','prefix-list':'Lista de prefixos','community-list':'Lista de communities',match:'Condição',set:'Ação','local-preference':'LOCAL_PREF',community:'Community BGP','as-path':'AS_PATH',prepend:'Prepend de AS','update-source':'Origem da sessão (loopback)','ebgp-multihop':'eBGP fora da rede conectada','send-community':'Envia communities (e route-targets)','route-reflector-client':'Cliente do route reflector',activate:'Ativa a família para o vizinho','vn-segment':'VNI desta VLAN',vni:'VNI',member:'VNI na NVE','source-interface':'Loopback do VTEP','peer-ip':'VTEP remoto estático','ingress-replication':'Replicação de BUM',fabric:'Anycast gateway','host-reachability':'Aprendizado via BGP EVPN',
  vrf:'VRF (tabela de roteamento isolada)',bgp:'BGP',summary:'Resumo das sessões',neighbors:'Vizinhos',definition:'Cria uma VRF (IOS-XE)',context:'Cria/edita uma VRF (NX-OS)',instance:'Cria uma VRF (EOS)',forwarding:'Coloca a interface na VRF',member:'Coloca a interface na VRF (NX-OS)',rd:'Route distinguisher','route-target':'Route target (import/export entre VRFs)',
  'remote-as':'AS do vizinho',redistribute:'Redistribui rotas no BGP','next-hop-self':'Anuncia com next-hop próprio','default-originate':'Envia 0.0.0.0/0 ao vizinho','address-family':'Família de endereços','exit-address-family':'Sai da address-family',unicast:'Unicast',ipv4:'IPv4'};
const DESC={...DESC_VB,show:'Mostra informações do equipamento',ping:'Envia pacote de teste (ICMP, TCP ou UDP)',traceroute:'Mostra o caminho até o destino',configure:'Entra no modo de configuração',clear:'Limpa a tela',write:'Salva o lab',copy:'Salva o lab',enable:'Modo privilegiado',exit:'Sai do modo atual',end:'Volta ao modo exec',
  hostname:'Nome do equipamento',vlan:'Cria ou edita VLANs',interface:'Configura uma interface ou um grupo (range)',ip:'Comandos IP',router:'Protocolo de roteamento',no:'Desfaz um comando',do:'Executa um comando exec',description:'Descrição da interface',switchport:'Porta de switch',shutdown:'Desliga a interface',
  'spanning-tree':'Opções de STP',encapsulation:'Encapsulamento 802.1Q',name:'Nome da VLAN',network:'Rede (OSPF: define a área · BGP: anuncia)','running-config':'Configuração atual','startup-config':'Configuração salva',brief:'Resumo',route:'Rotas',access:'Porta access',trunk:'Porta trunk',mode:'Modo da porta',address:'Endereço IP',
  nat:'NAT',inside:'Interface interna / origem interna',outside:'Interface externa',allowed:'VLANs permitidas',native:'Native VLAN',interfaces:'Estado das interfaces',version:'Modelo e versão',terminal:'Configurar pelo terminal','default-gateway':'Gateway de gerência',ospf:'OSPF',memory:'Salva o lab',status:'Status das portas',
  portfast:'Porta de borda','router-id':'ID do roteador',dot1q:'802.1Q',dot1Q:'802.1Q',range:'Várias interfaces de uma vez','access-list':'Lista de acesso (ACL)','access-lists':'ACLs e contadores',extended:'ACL estendida','access-group':'Aplica ACL na interface',static:'Só estáticas',connected:'Só conectadas',neighbor:'Vizinhos (OSPF/BGP)',
  translations:'Traduções NAT',arp:'Tabela ARP','mac':'Tabela MAC','address-table':'Tabela MAC',cdp:'Vizinhos físicos',lldp:'Vizinhos físicos',neighbors:'Vizinhos',clock:'Data e hora',history:'Histórico de comandos',permit:'Permite',deny:'Nega',remark:'Comentário','default-information':'Propaga a rota padrão',originate:'Anunciar 0.0.0.0/0',
  'passive-interface':'Interface sem vizinhança',source:'Origem',list:'ACL de origem',routing:'Roteamento IP','helper-address':'Relay DHCP (não simulado)',speed:'Velocidade (não simulado)',duplex:'Duplex (não simulado)',mtu:'MTU (não simulado)',display:'Comandos estilo Huawei',
  a:'Endereços',addr:'Endereços',r:'Rotas',add:'Adiciona',del:'Remove',flush:'Limpa',link:'Interface',set:'Altera',neigh:'Vizinhos ARP',ifconfig:'Interfaces',nc:'Teste TCP/UDP',curl:'Requisição HTTP',ipconfig:'Interfaces (Windows)',help:'Ajuda',up:'Liga',down:'Desliga',eth0:'Interface',etherchannel:'Port-channels (LACP)','port-channel':'Port-channel (LACP)',lacp:'LACP',vrrp:'Gateway virtual VRRP',inventory:'Modelo e componentes',environment:'Energia',power:'Consumo estimado',summary:'Resumo','channel-group':'Coloca a porta num port-channel',standby:'Gateway virtual (HSRP → VRRP)',vpc:'vPC (aceito, não simulado)',ipmitool:'BMC (iDRAC/iLO) via IPMI',lan:'Rede do BMC',print:'Mostra',management:'Gerência fora de banda',context:'Contexto de VRF',feature:'Recurso NX-OS (aceito)'};
const treeOf=(d,st)=>isHost(d.type)?TREES.host:TREES[st.mode]||TREES.exec;
function walk(tree,toks){let node=tree;for(const t of toks){if(!node||typeof node!=='object')return null;const lt=t.toLowerCase();const ks=Object.keys(node).filter(k=>k!=='_'&&k.toLowerCase().startsWith(lt));const ex=ks.find(k=>k.toLowerCase()===lt);const k=ex||(ks.length===1?ks[0]:null);
    if(k){node=node[k];continue}if(node._)return{_arg:true,hint:node._};return null}return node}
function cliHelp(d,line){const st=cs(d.id),tree=treeOf(d,st);const sp=/\s$/.test(line)||!line.trim();const toks=line.trim()?line.trim().split(/\s+/):[];const part=sp?'':toks.pop();
  const node=walk(tree,toks);if(!node)return['% Comando não reconhecido'];if(node._arg)return['  <cr>'];
  const ks=Object.keys(node).filter(k=>k!=='_'&&k.toLowerCase().startsWith(part.toLowerCase()));const out=ks.map(k=>`  ${k.padEnd(20)}${DESC[k]||''}`);
  if(node._&&!part)out.push(`  ${node._}`);if(!ks.length&&!node._)out.push('  <cr>');return out}
function cliComplete(d,line){{let x=cs(d.id),dd=d;while(x.ssh&&dev(x.ssh.dev)){dd=dev(x.ssh.dev);x=x.ssh.st}if(dd!==d)return isHost(dd.type)&&dd.os?osComplete(dd,line,x):{line,opts:[]}}if(isHost(d.type)&&d.os)return osComplete(d,line,cs(d.id));const st=cs(d.id),tree=treeOf(d,st);if(/\s$/.test(line)||!line.trim())return{line,opts:[]};const toks=line.trim().split(/\s+/);const part=toks.pop();
  const node=walk(tree,toks);if(!node||node._arg)return{line,opts:[]};const ks=Object.keys(node).filter(k=>k!=='_'&&k.toLowerCase().startsWith(part.toLowerCase()));
  if(ks.length===1)return{line:[...toks,ks[0]].join(' ')+' ',opts:[]};if(!ks.length)return{line,opts:[]};
  let pre=ks[0];for(const k of ks)while(!k.toLowerCase().startsWith(pre.toLowerCase()))pre=pre.slice(0,-1);
  return{line:pre.length>part.length?[...toks,pre].join(' '):line,opts:ks}}

/* ---------- utilidades da CLI ---------- */
function subOk(d,k,sub){if(isSw(d.type))return{err:'% Subinterfaces só em roteadores, firewalls e servidores'};return{k:lagMaster(d,k),sub}}
function parseIf(d,arg){const raw=String(arg||'').trim();const a=raw.replace(/\s+/g,'');let m;
  if(m=a.match(/^(?:lo|loopback|lo0\.)(\d+)$/i))return fwd(d.type)?{loop:+m[1]}:{err:'% Loopbacks só em switch L3, roteador e firewall'};
  if(/^(nve\d*|vxlan\d*)$/i.test(a))return d.type==='sw3'?{nve:true}:{err:'% VXLAN (interface NVE / Vxlan1) só em switch L3 nesta bancada'};
  if(m=a.match(/^vlan(?:if)?(\d+)$/i)){if(!isSw(d.type))return{err:'% Interfaces Vlan só existem em switches'};return{svi:+m[1]}}
  const sm=a.match(/^(.*\D)\.(\d+)$/),base=sm?sm[1]:a,sub=sm?+sm[2]:null;
  const ln=lagNumOf(base);if(ln){if(sub!==null){const mk=lagMembers(d,ln)[0];if(mk===undefined)return{err:`% ${lagShort(d,ln)} ainda não tem membros`};return subOk(d,mk,sub)}return{lag:ln}}
  let k=findPort(d,portMap(d,osOf(d)),base);
  if(k<0&&!modelOf(d)){const mm=base.match(/(\d+)$/);if(mm){const last=+mm[1],kk=isSw(d.type)?last-1:last;if(kk>=0&&kk<d.ports.length)k=kk}}
  if(k<0)return{err:`% A interface ${raw} não existe em ${d.name}. Portas: ${spn(d,0)} até ${spn(d,d.ports.length-1)} (Tab completa, "show interfaces status" lista todas)`};
  return sub!==null?subOk(d,k,sub):{k}}
function parseRange(d,arg){const ks=[];for(const piece of String(arg).replace(/\s*-\s*/g,'-').split(/\s*,\s*/)){if(!piece)continue;const m=piece.match(/^(.*?)(\d+)(?:-(\d+))?$/);if(!m)return{err:'% Faixa inválida. Ex.: interface range Gi1/0/1 - 8'};
    const a=+m[2],b=m[3]?+m[3]:a;if(b<a||b-a>64)return{err:'% Faixa inválida'};for(let n=a;n<=b;n++){const r=parseIf(d,m[1]+n);if(r.err)return r;if(r.svi!==undefined||r.sub!==undefined||r.loop!==undefined||r.nve)return{err:'% Use range só com portas físicas'};if(!ks.includes(r.k))ks.push(r.k)}}
  return ks.length?{ks}:{err:'% Informe as portas'}}
function addrArg(w1,w2){if(!w1)return null;if(w1.includes('/'))return pc(w1)?w1:null;const l=maskLen(w2);if(ip2i(w1)===null||l===null)return null;return`${w1}/${l}`}
function ensureVlan(d,v,out){if(v===1||d.vlans.some(x=>+x.id===v))return;d.vlans.push({id:v,name:'VLAN'+String(v).padStart(4,'0')});d.vlans.sort((a,b)=>a.id-b.id);out(`% A VLAN ${v} não existia. Criando vlan ${v}`)}
const PORTS={www:80,http:80,https:443,domain:53,dns:53,ssh:22,telnet:23,smtp:25,ftp:21,snmp:161,ntp:123,bgp:179,ldap:389,rdp:3389,syslog:514};
const portNum=w=>{if(!w)return 0;const n=PORTS[w.toLowerCase()]||+w;return n>=1&&n<=65535?n:0};
function parseAce(t){let i=0;const proto=({ip:'any',icmp:'icmp',tcp:'tcp',udp:'udp',any:'any'})[(t[i]||'').toLowerCase()];if(!proto)return'% Protocolo deve ser ip, icmp, tcp ou udp';i++;
  const addr=()=>{const w=(t[i]||'').toLowerCase();if(!w)return null;if(w==='any'){i++;return'any'}if(w==='host'){if(ip2i(t[i+1])===null)return null;i+=2;return t[i-1]+'/32'}
    if(w.includes('/')){const c=pc(w);if(!c)return null;i++;return netStr(c)}const ip=ip2i(w);if(ip===null)return null;const wm=ip2i(t[i+1]);if(wm===null){i++;return i2ip(ip)+'/32'}
    const m=(~wm)>>>0,l=maskLen(i2ip(m));if(l===null)return null;i+=2;return i2ip((ip&m)>>>0)+'/'+l};
  const src=addr();if(!src)return'% Origem inválida. Use any, host <ip>, <rede> <wildcard> ou <rede>/<len>';
  if((t[i]||'').toLowerCase()==='eq')i+=2;
  const dst=addr();if(!dst)return'% Destino inválido. Use any, host <ip>, <rede> <wildcard> ou <rede>/<len>';
  let port='';if((t[i]||'').toLowerCase()==='eq'){port=portNum(t[i+1]);if(!port)return'% Porta inválida';i+=2;if(proto!=='tcp'&&proto!=='udp')return'% "eq" só vale para tcp ou udp'}
  return{proto,src,dst,port:port?String(port):'',desc:''}}
function aceText(r){const a=x=>{if(isAny(x))return'any';const c=pc(x);return c.len===32?`host ${i2ip(c.ip)}`:`${i2ip(c.net)} ${wc(c)}`};return`${r.act} ${r.proto==='any'?'ip':r.proto} ${a(r.src)} ${a(r.dst)}${rp(r)?' eq '+r.port:''}`}
function mac(id,key){let h=2166136261;for(const ch of id+'|'+key){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0}const b=[0x0c,0x5e,(h>>>24)&255,(h>>>16)&255,(h>>>8)&255,h&255];return b.map(x=>x.toString(16).padStart(2,'0'))}
const macCisco=m=>`${m[0]}${m[1]}.${m[2]}${m[3]}.${m[4]}${m[5]}`,macLinux=m=>m.join(':');
function pipe(text,f){if(!f)return text;const m=f.trim().match(/^(\w+)\s*(.*)$/);if(!m)return text;const kind=m[1].toLowerCase(),pat=m[2].trim();
  const ok=w=>w.startsWith(kind)&&kind.length>=1;let re;try{re=new RegExp(pat,'i')}catch(_){re={test:x=>x.toLowerCase().includes(pat.toLowerCase())}}
  const L=text.split('\n');if(ok('include'))return L.filter(x=>re.test(x)).join('\n');if(ok('exclude'))return L.filter(x=>!re.test(x)).join('\n');
  if(ok('begin')){const i=L.findIndex(x=>re.test(x));return i<0?'':L.slice(i).join('\n')}if(ok('count'))return'Number of lines which match regexp = '+L.filter(x=>re.test(x)).length;
  if(ok('section')){const o=[];let on=false;for(const x of L){if(/^\S/.test(x)){on=re.test(x);if(on)o.push(x)}else if(on)o.push(x)}return o.join('\n')}
  return'% Filtro inválido. Use include, exclude, begin, section ou count'}
const MODEL={sw2:'BR-2400 (switch L2, 24×1G)',sw3:'BR-2400L3 (switch L3, 24×1G, roteamento IP)',rtr:'BR-R400 (roteador, 4×1G)',fw:'BR-F800 (firewall stateful, 8×1G)',pc:'host Linux',srv:'servidor Linux'};
function modelText(d){const m=modelOf(d);return m?`${m.vendor} ${m.name}${m.role?' — '+m.role:''}`:MODEL[d.type]}
function portStatus(d,k){const p=d.ports[k];return p.shut?'administratively down':linkAt(d.id,k)?'up':'down'}

/* ---------- comandos show ---------- */
function showVlan(d){if(!isSw(d.type))return'% Este equipamento não tem banco de VLANs';const L=['VLAN Name                             Status    Ports','---- -------------------------------- --------- -------------------------------'];
  [{id:1,name:'default'},...d.vlans].forEach(v=>{const ps=d.ports.map((p,k)=>p.mode==='access'&&+p.vlan===+v.id?spn(d,k):null).filter(Boolean);const ch=[];for(let i=0;i<ps.length;i+=4)ch.push(ps.slice(i,i+4).join(', '));
    L.push(`${String(v.id).padEnd(5)}${String(v.name).padEnd(33)}active    ${ch[0]||''}`);ch.slice(1).forEach(c=>L.push(' '.repeat(48)+c))});return L.join('\n')}
function showIpBr(d){const L=['Interface              IP-Address      OK? Method Status                Protocol'];
  d.ports.forEach((p,k)=>{const c=p.mode==='routed'?pc(p.ip):null;const s=portStatus(d,k);L.push(`${spn(d,k).padEnd(23)}${(c?i2ip(c.ip):'unassigned').padEnd(16)}YES ${(c?'manual':'unset ').padEnd(7)}${s.padEnd(22)}${s==='up'?'up':'down'}`);
    (p.subs||[]).forEach(x=>{const c=pc(x.ip);L.push(`${(spn(d,k)+'.'+x.vlan).padEnd(23)}${(c?i2ip(c.ip):'unassigned').padEnd(16)}YES ${(c?'manual':'unset ').padEnd(7)}${s.padEnd(22)}${s==='up'?'up':'down'}`)})});
  (d.svis||[]).forEach(x=>{const c=pc(x.ip);L.push(`${('Vlan'+x.vlan).padEnd(23)}${(c?i2ip(c.ip):'unassigned').padEnd(16)}YES ${(c?'manual':'unset ').padEnd(7)}${'up'.padEnd(22)}up`)});return L.join('\n')}
function showStatus(d){const L=['Port            Name               Status       Vlan       Speed   Type'];d.ports.forEach((p,k)=>{const s=p.shut?'disabled':linkAt(d.id,k)?'connected':'notconnect';
  const vl=+p.lag?lagShort(d,p.lag):(p.mode==='trunk'?'trunk':p.mode==='routed'?'routed':String(p.vlan));const ty=isMgmt(d,k)?'gerência':isInternal(d,k)?'backplane':'';
  L.push(`${spn(d,k).padEnd(16)}${String(p.desc||'').slice(0,18).padEnd(19)}${s.padEnd(13)}${vl.padEnd(11)}${portSpeed(d,k).padEnd(8)}${ty}`)});return L.join('\n')}
function lagFlag(d,k){const p=d.ports[k],L=linkAt(d.id,k);if(p.shut||!L)return'D';const pd=dev(L.peer);return pd&&+pd.ports[L.peerK].lag?'P':'I'}
function showLag(d){const ns=[...new Set(d.ports.map(p=>+p.lag).filter(Boolean))].sort((a,b)=>a-b);if(!ns.length)return'Nenhum port-channel configurado. Use "channel-group N mode active" nas interfaces.';
  const L=['Flags: D - down  P - agregado (LACP)  I - individual  S - camada 2  R - camada 3  U - em uso','','Group  Port-channel   Protocol   Ports','-----  -------------  ---------  -------------------------------------'];
  ns.forEach(n=>{const ms=lagMembers(d,n),p=d.ports[ms[0]],up=ms.some(k=>lagFlag(d,k)==='P');L.push(`${String(n).padEnd(7)}${(lagShort(d,n)+'('+(p.mode==='routed'?'R':'S')+(up?'U':'D')+')').padEnd(15)}LACP       ${ms.map(k=>`${spn(d,k)}(${lagFlag(d,k)})`).join(' ')}`)});return L.join('\n')}
function showLacp(d){const ms=d.ports.map((p,k)=>k).filter(k=>+d.ports[k].lag);if(!ms.length)return'Nenhuma porta em LACP.';const L=['Port            Grupo  Vizinho              Porta do vizinho   Estado'];
  ms.forEach(k=>{const x=linkAt(d.id,k),pd=x&&dev(x.peer);L.push(`${spn(d,k).padEnd(16)}${String(d.ports[k].lag).padEnd(7)}${(pd?pd.name:'—').padEnd(21)}${(pd?spn(pd,x.peerK):'—').padEnd(19)}${lagFlag(d,k)==='P'?'bundled':lagFlag(d,k)==='I'?'sem LACP do outro lado':'down'}`)});return L.join('\n')}
function vipPeers(vip){const out=[];S.devices.forEach(d=>l3ifs(d).forEach(f=>{if(f.vip===vip)out.push({d,f})}));return out}
function showVrrp(d){const vs=l3ifs(d).filter(f=>f.vip!=null);if(!vs.length)return'Nenhum grupo VRRP configurado.';const L=['Interface   Grp  Pri  Estado   IP virtual        IP real           Master'];
  vs.forEach(f=>{const peers=vipPeers(f.vip),m=vipMasterOf(f.vip);L.push(`${ifName(d,f).padEnd(12)}${String(vrid(f.vlan||f.k+1)).padEnd(5)}100  ${(m&&m.d.id===d.id?'Master':'Backup').padEnd(9)}${i2ip(f.vip).padEnd(18)}${i2ip(f.c.ip).padEnd(18)}${m?m.d.name:'—'}${peers.length<2?'  (sem par)':''}`)});return L.join('\n')}
function serial(d){let h=7;for(const c of d.id+d.name)h=Math.imul(h^c.charCodeAt(0),16777619)>>>0;return'BR'+h.toString(36).toUpperCase().padStart(8,'0').slice(0,9)}
function showInventory(d){const m=modelOf(d),r=(S.racks||[]).find(x=>x.id===d.rack),L=[`NAME: "Chassis", DESCR: "${modelText(d)}"`,`PID: ${m?m.id.toUpperCase():d.type.toUpperCase()}, SN: ${serial(d)}`];
  if(m)L.push(`Portas: ${m.speeds||'—'}${m.names.some(n=>n.role==='mgmt')?' + gerência '+m.names.filter(n=>n.role==='mgmt').map(n=>n.s).join(', '):''}`,`Altura: ${m.u?m.u+'U':'componente de chassis'}   Consumo típico: ${m.w||0} W`);
  if(r)L.push(`Instalado em: rack ${r.name}, U${d.ru}${unitsOf(d)>1?'–U'+(d.ru+unitsOf(d)-1):''}`);if(d.parent){const ch=dev(d.parent);if(ch)L.push(`Instalado no chassis ${ch.name}, baia ${d.slot}`)}
  if(d.type==='chassis')membersOf(d).forEach(x=>L.push(`  baia ${String(x.slot).padEnd(5)} ${x.name.padEnd(18)} ${modelText(x)}`));return L.join('\n')}
function showPower(d){const w=wattsOf(d),r=(S.racks||[]).find(x=>x.id===d.rack);const L=[`Consumo estimado de ${d.name}: ${w} W`];if(r){const t=rackPower(r);L.push(`Rack ${r.name}: ${(t/1000).toFixed(2)} kW de ${r.kw} kW (${Math.round(t/(r.kw*10))}%)`)}return L.join('\n')}
function showTrunk(d){const t=d.ports.map((p,k)=>({p,k})).filter(x=>x.p.mode==='trunk');if(!t.length)return'Nenhuma porta em modo trunk.';
  const L=['Port        Mode    Encapsulation  Status      Native vlan'];t.forEach(({p,k})=>L.push(`${spn(d,k).padEnd(12)}on      802.1q         ${(p.shut?'disabled':linkAt(d.id,k)?'trunking':'notconnect').padEnd(12)}${p.native||1}`));
  L.push('','Port        Vlans allowed on trunk');t.forEach(({p,k})=>L.push(`${spn(d,k).padEnd(12)}${allAllowed(p)?'1-4094':p.allowed}`));
  L.push('','Port        Vlans allowed and active in management domain');t.forEach(({p,k})=>L.push(`${spn(d,k).padEnd(12)}${[1,...d.vlans.map(v=>+v.id)].filter(v=>allowedHas(p,v)).join(',')}`));return L.join('\n')}
function showIf(d,arg){const r=parseIf(d,arg);if(r.err)return r.err;if(r.loop!==undefined){const l=(d.loops||[]).find(x=>+x.id===r.loop);if(!l)return`% Loopback${r.loop} não existe`;return[`Loopback${r.loop} is up, line protocol is up`,'  Hardware is Loopback',l.desc?`  Description: ${l.desc}`:null,pc(l.ip)?`  Internet address is ${cidrStr(pc(l.ip))}`:'  Sem endereço IP',l.vrf?`  VRF ${l.vrf}`:null].filter(Boolean).join('\n')}if(r.nve)return showNve(d,'vni');if(r.lag){const ms=lagMembers(d,r.lag);if(!ms.length)return`% ${lagShort(d,r.lag)} sem membros`;return[`${lagShort(d,r.lag)} is ${ms.some(k=>lagFlag(d,k)==='P')?'up':'down'}, ${ms.length} membro(s): ${ms.map(k=>spn(d,k)).join(', ')}`,`  Modo: ${d.ports[ms[0]].mode}`].join('\n')}
  if(r.svi!==undefined){const s=d.svis.find(x=>+x.vlan===r.svi);if(!s)return`% Interface Vlan${r.svi} não existe`;const c=pc(s.ip);return[`Vlan${r.svi} is up, line protocol is up`,`  Hardware is EtherSVI, address is ${macCisco(mac(d.id,'v'+r.svi))}`,c?`  Internet address is ${cidrStr(c)}`:'  Sem endereço IP','  MTU 1500 bytes, BW 1000000 Kbit/sec'].join('\n')}
  const p=d.ports[r.k],s=portStatus(d,r.k),L=linkAt(d.id,r.k),name=spn(d,r.k)+(r.sub!==undefined?'.'+r.sub:'');const c=r.sub!==undefined?pc((p.subs.find(x=>+x.vlan===r.sub)||{}).ip):p.mode==='routed'?pc(p.ip):null;
  const o=[`${name} is ${s}, line protocol is ${s==='up'?'up':'down'}${s==='up'?' (connected)':''}`,`  Hardware is ${isMgmt(d,r.k)?'Management':(portSpeed(d,r.k)||'1G')+' Ethernet'}, address is ${macCisco(mac(d.id,'p'+r.k))}`];
  if(p.desc)o.push(`  Description: ${p.desc}`);if(c)o.push(`  Internet address is ${cidrStr(c)}`);
  if(isSw(d.type)&&p.mode!=='routed')o.push(`  Switchport mode: ${p.mode}${p.mode==='access'?`, access VLAN ${p.vlan}`:`, allowed ${allAllowed(p)?'all':p.allowed}, native ${p.native||1}`}`);
  if(r.sub!==undefined)o.push(`  Encapsulation 802.1Q Virtual LAN, Vlan ID ${r.sub}`);
  o.push(`  Vizinho: ${L?dev(L.peer).name+' '+spn(dev(L.peer),L.peerK):'nenhum'}`,`  MTU 1500 bytes, BW ${spBw(portSpeed(d,r.k))} Kbit/sec, Full-duplex, ${portSpeed(d,r.k)||'1G'}b/s`);return o.join('\n')}
const spBw=sp=>{const m=String(sp||'1G').match(/^(\d+)(G|M)/);return m?(+m[1]*(m[2]==='G'?1000000:1000)):1000000};
function vrfArg(d,n){if(n==null||n==='')return'';if(isMgmtVrfName(n))return MGV;return vrfObj(d,n)?n:null}
function routeTable(d,filter,vrf){computeOspf();vrf=vrf||'';const rows=[];
  if(vrf===true)vrf=MGV;
  if(vrf===MGV){const ifs=l3ifs(d).filter(f=>f.mgmt);if(!ifs.length)return`% Nenhuma interface na VRF de gerência (${mgmtName('cisco',d)})`;ifs.forEach(f=>rows.push(['C',`${netStr(f.c)} is directly connected, ${ifName(d,f)}`],['L',`${cidrStr({ip:f.c.ip,len:32})} is directly connected, ${ifName(d,f)}`]));const gw=d.ports.map((p,k)=>isMgmt(d,k)&&p.gw).find(Boolean);if(gw)rows.push(['S*',`0.0.0.0/0 [1/0] via ${gw}`]);return['Routing Table: management',...rows.map(([c,t])=>`${c.padEnd(6)}${t}`)].join('\n')}
  if(vrf&&!vrfObj(d,vrf))return`% VRF ${vrf} não existe em ${d.name} (show vrf lista as VRFs)`;
  const ifs=ifsIn(d,vrf);
  ifs.forEach(f=>rows.push(['C',`${netStr(f.c)} is directly connected, ${ifName(d,f)}`],['L',`${cidrStr({ip:f.c.ip,len:32})} is directly connected, ${ifName(d,f)}`]));
  routesIn(d,vrf).forEach(r=>{const c=pc(r.dst),nh=ip2i(r.nh);if(c&&isNull(r.nh)){rows.push(['S',`${netStr(c)} is directly connected, Null0`]);return}if(!c||nh===null)return;const ok=ifs.some(f=>inNet(nh,f.c));rows.push([c.len===0?'S*':'S',`${netStr(c)} [1/0] via ${r.nh}${ok?'':' (próximo salto inalcançável — rota inativa)'}`])});
  if(!vrf&&!fwd(d.type)&&d.gw)rows.push(['S*',`0.0.0.0/0 [1/0] via ${d.gw} (gateway padrão)`]);
  (OSPF[vrfKey(d,vrf)]||[]).forEach(r=>rows.push([r.ext?'O*E2':'O',`${netStr(r.c)} [110/${r.cost}] via ${i2ip(r.nh)}, ${ifName(d,r.ifc)}`]));
  (BGP[vrfKey(d,vrf)]||[]).forEach(r=>{if(r.local)return;rows.push([r.c.len===0?'B*':'B',`${netStr(r.c)} [${r.ebgp?20:200}/0] via ${i2ip(r.nh)}${r.imp?` (${r.imp.fam==='evpn'?'VXLAN VNI '+r.imp.vni:'VPNv4, rótulo '+r.imp.label}${r.imp.eg&&dev(r.imp.eg.dev)?', '+dev(r.imp.eg.dev).name:''})`:''}${r.ifc?(r.ebgp?', '+ifName(d,r.ifc):''):' (next-hop inalcançável)'}`])});
  const want=filter&&({static:'S',connected:'C',ospf:'O',bgp:'B'})[filter];const sel=want?rows.filter(r=>r[0].startsWith(want)||(want==='C'&&r[0]==='L')):rows;
  const def=lookup(d,0,{vrf});const L=[...(vrf?[`Routing Table: ${vrf}`]:[]),'Codes: L - local, C - connected, S - static, O - OSPF, B - BGP, E2 - OSPF external type 2, * - candidate default',''];
  L.push(def&&def.len===0?`Gateway of last resort is ${i2ip(def.nh)} to network 0.0.0.0`:'Gateway of last resort is not set','');
  sel.forEach(([c,t])=>L.push(`${c.padEnd(6)}${t}`));if(!sel.length)L.push('(nenhuma rota)');return L.join('\n')}
function routeFor(d,ip,vrf){computeOspf();const t=ip2i(ip);if(t===null)return'% IP inválido';const r=lookup(d,t,{vrf:vrf||''});if(!r)return`% Rede ${ip} não está na tabela de roteamento${vrf?' da VRF '+vrfLabel(vrf):''}`;if(r.blackhole)return`Routing entry for ${r.label}\n  Known via "static", distance 1\n  Routing Descriptor Blocks:\n  * directly connected, via Null0`;
  const KV={C:'connected',S:'static',O:'ospf 1',G:'static (gateway padrão)',M:'static (gerência)',B:'bgp '+(d.bgp?d.bgp.asn:'')};
  return[`Routing entry for ${r.label}`,`  Known via "${KV[r.src]}", distance ${r.ad}`,`  Routing Descriptor Blocks:`,`  * ${r.src==='C'?'directly connected':i2ip(r.bgpNh!=null?r.bgpNh:r.nh)}, via ${ifName(d,r.ifc)}${r.bgpNh!=null&&r.bgpNh!==r.nh?` (recursivo via ${i2ip(r.nh)})`:''}`].join('\n')}
function ospfNodes(d){return['',...vrfList(d)].filter(v=>ospfCfg(d,v))}
function showOspfNei(d){const vs=ospfNodes(d);if(!vs.length)return'% OSPF não está ativo neste equipamento';computeOspf();const n=vs.flatMap(v=>(OADJ[vrfKey(d,v)]||[]).map(x=>({...x,v})));if(!n.length)return'Nenhum vizinho OSPF. Confira se o outro lado tem OSPF ligado, mesma área e mesma sub-rede (e a mesma VRF na interface).';
  const L=['Neighbor ID     Pri   State           Dead Time   Address         Interface'];n.forEach(x=>L.push(`${ridOf(dev(x.dev)).padEnd(16)}1     FULL/DR         00:00:3${Math.abs(x.nh%10)}    ${i2ip(x.nh).padEnd(16)}${ifName(d,x.ifc)}${x.v?'  (vrf '+x.v+')':''}`));return L.join('\n')}
function showVrf(d){const vs=d.vrfs||[];const L=['  Name                             Default RD            Protocols   Interfaces'];
  const ifsOf=v=>{const o=[];d.ports.forEach((p,k)=>{if(isMgmt(d,k))return;if((p.vrf||'')===v&&p.mode==='routed'&&!(+p.lag&&lagMaster(d,k)!==k))o.push(+p.lag?lagShort(d,p.lag):spn(d,k));(p.subs||[]).forEach(s=>{if((s.vrf||'')===v)o.push((+p.lag?lagShort(d,p.lag):spn(d,k))+'.'+s.vlan)})});(d.svis||[]).forEach(s=>{if((s.vrf||'')===v)o.push('Vlan'+s.vlan)});return o};
  const mg=d.ports.findIndex((p,k)=>isMgmt(d,k));if(mg>=0)L.push(`  ${'management'.padEnd(33)}${'<not set>'.padEnd(22)}ipv4        ${spn(d,mg)}`);
  vs.forEach(v=>L.push(`  ${v.name.padEnd(33)}${(v.rd||'<not set>').padEnd(22)}ipv4        ${ifsOf(v.name).join(', ')||'—'}`));
  if(!vs.length)L.push('  (nenhuma VRF de serviço — crie com "vrf definition NOME" ou "vrf context NOME")');return L.join('\n')}
function bgpSessions(d,vrf){computeOspf();return(BSESS[d.id]||[]).filter(s=>vrf===undefined||s.vrf===vrf)}
function showBgpSum(d,vrf){if(!bgpOn(d))return'% BGP não está ativo (router bgp <ASN>)';const ss=bgpSessions(d,vrf);const groups=vrf!==undefined?[vrf]:[...new Set(['',...ss.map(s=>s.vrf)])];const L=[];
  groups.forEach(v=>{const t=BGPT[vrfKey(d,v)];const rows=ss.filter(s=>s.vrf===v);if(v&&!rows.length&&!t)return;
    L.push(`BGP router identifier ${bgpRid(d)}, local AS number ${d.bgp.asn}${v?' vrf '+v:''}`,`BGP table version is ${t?t.all.size+1:1}, main routing table version ${t?t.all.size+1:1}`,`${t?t.all.size:0} network entries using ${(t?t.all.size:0)*144} bytes of memory`,'',
      'Neighbor        V           AS MsgRcvd MsgSent   TblVer  InQ OutQ Up/Down  State/PfxRcd');
    rows.forEach(s=>{const up=s.state==='Established';const ms=10+((ip2i(s.nb.ip)||0)%40);L.push(`${String(s.nb.ip).padEnd(16)}4 ${String(s.nb.ras).padStart(12)} ${String(up?ms:0).padStart(7)} ${String(up?ms:0).padStart(7)} ${String(up?(t?t.all.size+1:1):0).padStart(8)}    0    0 ${up?'00:1'+(ms%6)+':2'+(ms%10):'never'.padEnd(8)} ${up?s.rcv:s.state}`)});
    if(!rows.length)L.push('(nenhum vizinho configurado)');L.push('')});
  const down=ss.filter(s=>s.state!=='Established'&&s.why);if(down.length)down.forEach(s=>L.push(`% ${s.nb.ip}${s.vrf?' (vrf '+s.vrf+')':''}: ${s.why}`));return L.join('\n').replace(/\n+$/,'')}
function showBgp(d,vrf){if(!bgpOn(d))return'% BGP não está ativo (router bgp <ASN>)';computeOspf();vrf=vrf||'';const t=BGPT[vrfKey(d,vrf)];
  const L=[`BGP table version is ${t?t.all.size+1:1}, local router ID is ${bgpRid(d)}${vrf?', vrf '+vrf:''}`,'Status codes: * valid, > best, i - internal','Origin codes: i - IGP, ? - incomplete','','     Network            Next Hop            Metric LocPrf Weight Path'];
  if(!t||!t.all.size){L.push('(tabela BGP vazia)');return L.join('\n')}
  [...t.all.keys()].sort((a,b)=>{const x=pc(a),y=pc(b);return x.net-y.net||x.len-y.len}).forEach(k=>{const best=t.best.get(k);t.all.get(k).slice().sort(bgpBetter).forEach((p,i)=>{
    const ok=p.local||!!lookup(d,p.nh,{vrf,noBgp:true});const st=(ok?'*':' ')+(p===best?'>':' ')+(p.local||p.ebgp?' ':'i');
    L.push(` ${st} ${(i?'':k).padEnd(18)} ${(p.local?'0.0.0.0':i2ip(p.nh)).padEnd(19)} ${'0'.padStart(6)} ${String(p.local||!p.ebgp?p.lp:'').padStart(6)} ${String(p.local?32768:0).padStart(6)} ${[...p.asPath,p.origin].join(' ')}`)})});return L.join('\n')}
function showBgpNei(d){if(!bgpOn(d))return'% BGP não está ativo';const ss=bgpSessions(d);if(!ss.length)return'% Nenhum vizinho BGP configurado';
  return ss.map(s=>[`BGP neighbor is ${s.nb.ip},${s.vrf?'  vrf '+s.vrf+',':''}  remote AS ${s.nb.ras}, ${s.ebgp||(s.state!=='Established'&&+s.nb.ras!==+d.bgp.asn)?'external':'internal'} link`,s.nb.desc?` Description: ${s.nb.desc}`:null,
    `  BGP version 4, remote router ID ${s.pd?bgpRid(s.pd):'0.0.0.0'}`,`  BGP state = ${s.state}${s.state==='Established'?', up for 00:12:00':''}`,s.why?`  Motivo: ${s.why}`:null,
    `  Address families: ${nbFams(s.nb).map(f=>AFN[f]+(s.state==='Established'?(s.fams.includes(f)?' (negociada)':' (o outro lado não ativou)'):'')).join(', ')||'nenhuma'}`,
    s.state==='Established'?`  Prefixos recebidos: ${s.rcv}   enviados: ${s.sent}`:null,[hasUs(s.nb)?`  update-source Loopback${s.nb.us}`:null,s.nb.mh?'  ebgp-multihop':null,s.nb.rrc?'  Route-Reflector Client':null,s.nb.sc?'  send-community both':null,s.nb.rmIn?`  route-map de entrada: ${s.nb.rmIn}`:null,s.nb.rmOut?`  route-map de saída: ${s.nb.rmOut}`:null].filter(Boolean).join('\n')||null,`  Local host: ${s.local!=null?i2ip(s.local):'—'}, Foreign host: ${s.nb.ip}${s.nb.nhs?'\n  next-hop-self':''}${s.nb.dio?'\n  default-originate':''}`].filter(x=>x!==null).join('\n')).join('\n\n')}
function vrfCreate(d,n){n=String(n||'').replace(/[^\w.:-]/g,'').slice(0,32);if(!n)return null;if(!vrfObj(d,n))(d.vrfs=d.vrfs||[]).push({name:n,rd:''});return n}
function vrfDelete(d,n){d.vrfs=(d.vrfs||[]).filter(v=>v.name!==n);const clr=o=>{if(o.vrf===n){o.vrf='';o.ip=''}};d.ports.forEach(p=>{clr(p);(p.subs||[]).forEach(clr)});(d.svis||[]).forEach(clr);
  d.routes=(d.routes||[]).filter(r=>(r.vrf||'')!==n);if(d.bgp){['neighbors','networks','redist'].forEach(k=>d.bgp[k]=(d.bgp[k]||[]).filter(x=>(x.vrf||'')!==n))}}
function setIfVrf(d,o,n,say){if(n&&isMgmtVrfName(n)){say('% A VRF de gerência fica só na porta de gerência dedicada');return false}if(n&&!vrfObj(d,n)){say(`% A VRF ${n} não existe. Crie antes: vrf definition ${n}`);return false}
  if((o.vrf||'')===n)return false;o.vrf=n;if(o.ip){o.ip='';say(`% IP removido ao ${n?'colocar a interface na VRF '+n:'tirar a interface da VRF'} (como no equipamento real); configure o endereço de novo`)}return true}
const afOf=(la,i)=>{const x=la[i]||'',y=la[i+1]||'';if(/^vpnv4/.test(x)||x==='vpn-ipv4'||(x==='ipv4'&&/^vpn/.test(y)))return'vpnv4';if(x==='l2vpn'||x==='evpn')return'evpn';if(x==='ipv4')return'v4';return null};
const AFN={v4:'ipv4 unicast',vpnv4:'vpnv4 unicast',evpn:'l2vpn evpn'};
function nbActivate(n,af,on){if(af==='v4')n.noV4=!on;else n[af]=!!on}
function bgpCmd(d,st,a,la,neg,isA,out,changed,NS){const b=d.bgp;const vrf=st.bgpVrf||'';
  const nb=ip=>(b.neighbors||[]).find(n=>n.ip===ip&&(n.vrf||'')===vrf);
  const mkNb=(ip,ras)=>{const n={ip,ras,vrf,desc:'',dio:false,nhs:false,shut:false,us:'',mh:false,rrc:false,sc:false,vpnv4:false,evpn:false,noV4:!!(b.noDefV4&&!vrf),rmIn:'',rmOut:''};(b.neighbors=b.neighbors||[]).push(n);return n};
  if(isA(0,'exit-address-family',6)){st.bgpAf='';if(!st.bgpNb)st.bgpVrf=st.bgpVrfCtx||'';st.bgpNbAf='';return}
  if(st.bgpVlan!=null){if(isA(0,'route-target',3)){const vx=vxOf(d,st.bgpVlan);if(!vx){out(`% A VLAN ${st.bgpVlan} não tem VNI (vxlan vlan ${st.bgpVlan} vni <n> na interface Vxlan1)`);return}const v=a[a.length-1];vx.rt=neg||/^auto$/i.test(v)?'':v;changed();return}
    if(isA(0,'rd',2)||isA(0,'redistribute',3)){return}if(isA(0,'vlan',3)&&/^\d+$/.test(a[1]||'')){st.bgpVlan=+a[1];return}st.bgpVlan=null}
  if(isA(0,'vlan',3)&&/^\d+$/.test(a[1]||'')&&!neg){st.bgpVlan=+a[1];st.bgpNb=null;return}
  if(isA(0,'address-family',3)){const af=afOf(la,1);if(!af){out('% Use: address-family ipv4 unicast [vrf X] | vpnv4 unicast | l2vpn evpn');return}const vi=la.indexOf('vrf');
    if(st.bgpNb){const n=nb(st.bgpNb);if(n){if(neg){nbActivate(n,af,false);changed();return}nbActivate(n,af,true);changed()}st.bgpNbAf=af;return}
    if(vi>0){const v=a[vi+1];if(!vrfObj(d,v)){out(`% A VRF ${v} não existe`);return}st.bgpVrf=v}else if(!st.bgpVrfCtx)st.bgpVrf='';st.bgpAf=vi>0?'v4':af;st.bgpNb=null;return}
  if(isA(0,'vrf',3)&&a[1]&&!neg){if(!vrfObj(d,a[1])){out(`% A VRF ${a[1]} não existe`);return}st.bgpVrf=a[1];st.bgpVrfCtx=a[1];st.bgpNb=null;st.bgpAf='';return}
  if(st.bgpVrfCtx&&!st.bgpNb&&(isA(0,'rd',2)||isA(0,'route-target',3))){const v=vrfObj(d,st.bgpVrfCtx);if(v)vrfRtCmd(v,a,la,neg,out);changed();return}
  if(isA(0,'bgp',3)&&isA(1,'default',3)){b.noDefV4=neg;changed();return}
  if((isA(0,'bgp',3)&&isA(1,'router-id',3))||isA(0,'router-id',3)){const v=isA(0,'bgp',3)?a[2]:a[1];if(neg){b.rid='';changed();return}if(ip2i(v)===null){out('% Uso: bgp router-id 1.1.1.1');return}b.rid=v;changed();return}
  if(isA(0,'bgp',3)||isA(0,'advertise',3)||isA(0,'advertise-all-vni',5)||isA(0,'retain',3)){out(isA(0,'bgp',3)?NS:'');return}
  if(isA(0,'neighbor',3)){const ip=a[1];if(ip2i(ip)===null){out('% Uso: neighbor <A.B.C.D> remote-as <ASN>');return}let n=nb(ip);
    if(neg&&!a[2]){b.neighbors=(b.neighbors||[]).filter(x=>x!==n);changed();return}
    if(!a[2]){if(!n){n=mkNb(ip,0);changed()}st.bgpNb=ip;st.bgpNbAf='';return}
    if(isA(2,'remote-as',3)){const as=+a[3];if(!(as>=1&&as<=4294967295)){out('% ASN inválido');return}if(!n)n=mkNb(ip,as);else n.ras=as;changed();return}
    if(!n){out(`% Vizinho ${ip} não existe: comece com "neighbor ${ip} remote-as <ASN>"`);return}
    return nbAttr(d,n,a.slice(2),la.slice(2),neg,out,changed,NS,st.bgpAf||'v4')}
  if(st.bgpNb&&!isA(0,'network',3)&&!isA(0,'redistribute',3)&&!isA(0,'router-id',3)){const n=nb(st.bgpNb);if(!n){st.bgpNb=null;return}
    if(isA(0,'remote-as',3)){const as=+a[1];if(!(as>=1)){out('% ASN inválido');return}n.ras=as;changed();return}return nbAttr(d,n,a,la,neg,out,changed,NS,st.bgpNbAf||'v4')}
  if(isA(0,'network',3)){let c=null;if(a[1]&&a[1].includes('/'))c=pc(a[1]);else{const mi=la.indexOf('mask');c=pc(mi>0?addrArg(a[1],a[mi+1]):(a[1]?addrArg(a[1],i2ip(classMask(ip2i(a[1])))):null))}
    if(!c){out('% Uso: network 10.10.0.0 mask 255.255.0.0  (ou network 10.10.0.0/16)');return}const k=netStr(c);const ri=la.indexOf('route-map');b.networks=(b.networks||[]).filter(n=>!(n.pfx===k&&(n.vrf||'')===vrf));if(!neg){b.networks.push({pfx:k,vrf,...(ri>0&&a[ri+1]?{rm:a[ri+1]}:{})});
      const ok=ifsIn(d,vrf).some(f=>netStr(f.c)===k)||routesIn(d,vrf).some(r=>pc(r.dst)&&netStr(pc(r.dst))===k)||(OSPF[vrfKey(d,vrf)]||[]).some(r=>netStr(r.c)===k);if(!ok)out(`% Atenção: ${k} não está na tabela de roteamento${vrf?' da VRF '+vrf:''}; o BGP só anuncia quando existir a rota exata`)}changed();return}
  if(isA(0,'redistribute',3)){const src=['connected','direct','static','ospf'].find(x=>la[1]&&x.startsWith(la[1]));if(!src){out('% Uso: redistribute connected | static | ospf <id> [route-map NOME]');return}const s2=src==='direct'?'connected':src;const ri=la.indexOf('route-map');
    b.redist=(b.redist||[]).filter(r=>!(r.src===s2&&(r.vrf||'')===vrf));if(!neg)b.redist.push({src:s2,vrf,...(ri>0&&a[ri+1]?{rm:a[ri+1]}:{})});changed();return}
  if(isA(0,'timers',3)||isA(0,'maximum-paths',3)||isA(0,'default-information',3)||isA(0,'synchronization',3)||isA(0,'auto-summary',3)||isA(0,'log-neighbor-changes',3)||isA(0,'rd',2)){out(NS);return}
  out('% Comando inválido no modo BGP. Digite ?')}
function nbAttr(d,n,a,la,neg,out,changed,NS,af){const isB=(i,w,m=3)=>!!la[i]&&w.startsWith(la[i])&&la[i].length>=Math.min(m,w.length);
  if(isB(0,'description',3)){n.desc=neg?'':a.slice(1).join(' ');changed();return}if(isB(0,'next-hop-self',3)){n.nhs=!neg;changed();return}if(isB(0,'default-originate',3)){n.dio=!neg;changed();return}
  if(isB(0,'shutdown',2)){n.shut=!neg;changed();return}
  if(isB(0,'activate',3)){if(n.vrf&&af!=='v4'){out('% Vizinhos de VRF só trocam IPv4');return}nbActivate(n,af,!neg);changed();return}
  if(isB(0,'update-source',3)){if(neg){n.us='';changed();return}const m=(a.slice(1).join('')).match(/^(?:lo|loopback|lo0\.)(\d+)$/i);if(!m){out('% Use: update-source Loopback0');return}if(!(d.loops||[]).some(l=>+l.id===+m[1]))out(`% Atenção: Loopback${m[1]} ainda não existe`);n.us=String(+m[1]);changed();return}
  if(isB(0,'ebgp-multihop',3)){n.mh=!neg;changed();return}
  if(isB(0,'send-community',3)){n.sc=!neg;changed();return}
  if(isB(0,'route-reflector-client',3)){n.rrc=!neg;changed();return}
  if(isB(0,'route-map',3)){const dir=la[2]==='out'?'rmOut':la[2]==='in'?'rmIn':null;if(!dir){out('% Uso: neighbor X route-map NOME in|out');return}n[dir]=neg?'':a[1];if(!neg&&!(d.rmaps||[]).some(r=>r.name===a[1]))out(`% Atenção: a route-map ${a[1]} não existe — enquanto não existir, nada passa`);changed();return}
  if(isB(0,'password',3)||isB(0,'timers',3)||isB(0,'soft-reconfiguration',3)||isB(0,'next-hop-unchanged',8)||isB(0,'allowas-in',3)||isB(0,'maximum-routes',4)||isB(0,'bfd',3)){out(NS);return}
  out('% Atributo de vizinho: remote-as, description, update-source, ebgp-multihop, activate, send-community, route-reflector-client, route-map, next-hop-self, default-originate, shutdown')}
function vrfRtCmd(v,a,la,neg,out){if(la[0]==='rd'){v.rd=neg||/^auto$/i.test(a[1]||'')?'':(a[1]||'');return}
  const dir=['import','export','both'].find(x=>la[1]&&x.startsWith(la[1]));if(!dir){out('% Uso: route-target import|export|both <ASN:nn>');return}const vals=a.slice(2).filter(x=>!/^(evpn|vpn-ipv4|auto|stitching|mvpn)$/i.test(x));
  const set=(k)=>{const cur=rtList(v[k]);const nw=neg?cur.filter(x=>!vals.includes(x)):[...new Set([...cur,...rtList(vals.join(' '))])];v[k]=nw.join(' ')};
  if(!vals.length&&!/auto/i.test(la.join(' '))){out('% Informe o route-target, ex.: 65000:101');return}if(dir!=='export')set('rtImp');if(dir!=='import')set('rtExp')}
/* ---------- shows de MPLS, VPN, EVPN/VXLAN e políticas ---------- */
function showLdp(d){if(!mplsOn(d))return'% MPLS/LDP não está habilitado em nenhuma interface (use "mpls ip" na interface)';computeOspf();const ns=ldpNbrs(d);if(!ns.length)return`LDP ID local ${i2ip(ldpRid(d))}:0 — nenhum vizinho LDP. O outro lado também precisa de "mpls ip" na interface.`;
  return ns.map(n=>[`    Peer LDP Ident: ${i2ip(n.rid)}:0; Local LDP Ident ${i2ip(ldpRid(d))}:0`,`        TCP connection: ${i2ip(n.rid)}.646 - ${i2ip(ldpRid(d))}.${20000+(n.rid%9000)}`,`        State: ${n.up?'Oper':'Non-existent'}; Msgs sent/rcvd: ${n.up?42:0}/${n.up?41:0}; Downstream`,n.up?'        Up time: 00:12:31':`        Motivo: sem rota para o LSR-ID ${i2ip(n.rid)} (anuncie a loopback no IGP)`,`        LDP discovery sources:`,...n.ifs.map(x=>`          ${ifName(d,x.f)}, Src IP addr: ${i2ip(x.nh)}`),`        Addresses bound to peer LDP Ident:`,`          ${l3ifs(n.pd).filter(f=>!f.mgmt&&!f.vrf).map(f=>i2ip(f.c.ip)).join('  ')}`].join('\n')).join('\n')}
function lfib(d){computeOspf();const rows=[];const ns=ldpNbrs(d).filter(n=>n.up);const fecs=new Map();
  ifsIn(d,'').forEach(f=>{fecs.set(netStr(f.c),{c:f.c,own:true})});(OSPF[vrfKey(d,'')]||[]).forEach(r=>{const k=netStr(r.c);if(!fecs.has(k))fecs.set(k,{c:r.c,r})});
  fecs.forEach((x,k)=>{if(x.c.len===0)return;const local=ldpLabel(d,x.c.net);if(x.own){rows.push({local,out:'No Label',k,ifc:'',nh:'',own:true});return}
    const r=x.r,n=ns.find(n=>n.ifs.some(y=>y.nh===r.nh&&y.f.key===r.ifc.key));if(!n||!r.ifc.mpls){rows.push({local,out:'No Label',k,ifc:ifName(d,r.ifc),nh:i2ip(r.nh)});return}
    const pOwn=l3ifs(n.pd).some(f=>!f.mgmt&&!f.vrf&&netStr({...f.c,ip:f.c.net})===k&&(f.c.len===32||f.kind==='loop'))||ifsIn(n.pd,'').some(f=>netStr(f.c)===k);
    rows.push({local,out:pOwn?'Pop Label':String(ldpLabel(n.pd,x.c.net)),k,ifc:ifName(d,r.ifc),nh:i2ip(r.nh)})});
  vrfList(d).forEach(v=>{if(rtList((vrfObj(d,v)||{}).rtExp).length)rows.push({local:vpnLabel(d,v),out:'No Label',k:`VRF ${v} (rótulo por VRF)`,ifc:'aggregate/'+v,nh:''})});return rows}
function showLfib(d){if(!mplsOn(d)&&!vrfList(d).some(v=>rtList((vrfObj(d,v)||{}).rtExp).length))return'% MPLS não está habilitado';const L=['Local      Outgoing   Prefix                  Outgoing interface   Next Hop','Label      Label      or Tunnel Id'];
  lfib(d).filter(r=>!r.own).forEach(r=>L.push(`${String(r.local).padEnd(11)}${r.out.padEnd(11)}${r.k.padEnd(24)}${r.ifc.padEnd(21)}${r.nh}`));return L.join('\n')}
function showMplsIf(d){const fs=l3ifs(d).filter(f=>f.mpls);if(!fs.length)return'% Nenhuma interface com MPLS';const L=['Interface              IP            Tunnel   BGP Static Operational'];fs.forEach(f=>L.push(`${ifName(d,f).padEnd(23)}Yes (ldp)     No       No  No     Yes`));return L.join('\n')}
const evKey=p=>p.type===3?`[3]:[0]:[32]:[${i2ip(p.vtep)}]`:p.type===2?`[2]:[0]:[0]:[48]:[${p.mac.match(/../g).join('')}]:[32]:[${i2ip(p.c.ip)}]`:`[5]:[0]:[0]:[${p.c.len}]:[${i2ip(p.c.net)}]`;
function showVpn(d,fam,sum){if(!bgpOn(d))return'% BGP não está ativo';computeOspf();const ss=(BSESS[d.id]||[]).filter(s=>!s.vrf&&nbFams(s.nb).includes(fam));
  const t=BGPT[d.id+'#'+fam];const nm=fam==='vpnv4'?'VPNv4 Unicast':'L2VPN EVPN';
  if(sum){const L=[`BGP router identifier ${bgpRid(d)}, local AS number ${d.bgp.asn}`,`${nm}: ${t?t.all.size:0} entradas`,'','Neighbor        V           AS MsgRcvd MsgSent   TblVer  InQ OutQ Up/Down  State/PfxRcd'];
    ss.forEach(s=>{const up=s.state==='Established'&&s.fams.includes(fam);L.push(`${String(s.nb.ip).padEnd(16)}4 ${String(s.nb.ras).padStart(12)} ${String(up?30:0).padStart(7)} ${String(up?30:0).padStart(7)} ${String(up?(t?t.all.size+1:1):0).padStart(8)}    0    0 ${(up?'00:14:02':'never').padEnd(8)} ${up?((s.rcvF||{})[fam]||0):s.state==='Established'?'(família não negociada)':s.state}`)});
    if(!ss.length)L.push(`(nenhum vizinho com address-family ${AFN[fam]} ativada)`);ss.filter(s=>s.state!=='Established'&&s.why).forEach(s=>L.push(`% ${s.nb.ip}: ${s.why}`));
    ss.filter(s=>s.state==='Established'&&!s.fams.includes(fam)).forEach(s=>L.push(`% ${s.nb.ip}: o outro lado não ativou ${AFN[fam]} para esta sessão`));return L.join('\n')}
  const L=[`BGP table version is ${t?t.all.size+1:1}, local router ID is ${bgpRid(d)}`,'Status codes: * valid, > best, i - internal','Origin codes: i - IGP, ? - incomplete',''];
  if(!t||!t.all.size){L.push(`(tabela ${nm} vazia)`);return L.join('\n')}
  L.push(fam==='vpnv4'?'     Network            Next Hop            Metric LocPrf Weight Path':'   Network                                        Next Hop            Metric LocPrf Weight Path');
  const byRd={};t.all.forEach((ps,k)=>{const rd=ps[0].rd||'?';(byRd[rd]=byRd[rd]||[]).push(k)});
  Object.keys(byRd).sort().forEach(rd=>{const own=vrfList(d).find(v=>rdFor(d,v)===rd);L.push(`Route Distinguisher: ${rd}${own?` (default for vrf ${own})`:''}${fam==='evpn'&&/:\d+$/.test(rd)&&!own?'':''}`);
    byRd[rd].sort().forEach(k=>{const best=t.best.get(k);t.all.get(k).slice().sort(bgpBetter).forEach((p,i)=>{const ok=p.local||!!lookup(d,p.nh,{});const st=(ok?'*':' ')+(p===best?'>':' ')+(p.local||p.ebgp?' ':'i');
      const net=fam==='vpnv4'?(i?'':p.pfx):(i?'':evKey(p));const nh=p.local?(fam==='evpn'?i2ip(p.vtep):'0.0.0.0'):i2ip(p.nh);
      L.push(` ${st} ${net.padEnd(fam==='vpnv4'?18:46)} ${nh.padEnd(19)} ${String(p.med||0).padStart(6)} ${String(p.lp).padStart(6)} ${String(p.local?32768:0).padStart(6)} ${[...p.asPath,p.origin].join(' ')}`);
      if(i===0&&(p.rts||[]).length&&process_rt)L.push(`      RT:${p.rts.join(' RT:')}${p.label?' rótulo '+p.label:''}${p.vni?' VNI '+p.vni:''}`)})})});return L.join('\n')}
const process_rt=true;
function showNve(d,what){if(!vxOn(d))return'% VXLAN não configurado (interface nve1 / Vxlan1)';computeOspf();const vt=vtepIp(d);
  if(what==='peers'){const L=['Interface Peer-IP                                 State LearnType Uptime   Router-Mac','--------- --------------------------------------- ----- --------- -------- -----------------'];const seen=new Set();
    Object.entries(EVX[d.id]||{}).forEach(([vni,ps])=>ps.forEach(p=>{if(seen.has(p.ip))return;seen.add(p.ip);const up=underPath(d,p.ip).ok;L.push(`nve1      ${i2ip(p.ip).padEnd(40)}${(up?'Up':'Down').padEnd(6)}${(p.how==='static'?'CP(st)':'CP').padEnd(10)}00:10:41 ${macCisco(mac(p.dev,'nve'))}`)}));if(L.length===2)L.push('(nenhum VTEP remoto — confira as sessões EVPN e as VNIs dos outros leafs)');return L.join('\n')}
  const L=[`Interface nve1: source-interface loopback${d.vxlan.src??'?'} (${vt!=null?i2ip(vt):'sem IP'})`,'','Interface VNI      Multicast-group   State Mode Type [BD/VRF]      Flags','--------- -------- ----------------- ----- ---- ------------------ -----'];
  l2vnis(d).forEach(x=>L.push(`nve1      ${String(x.vni).padEnd(9)}${'UnicastBGP'.padEnd(18)}${(vt!=null?'Up':'Down').padEnd(6)}CP   L2 [${x.vlan}]${' '.repeat(Math.max(1,13-String(x.vlan).length))}${x.peers?'SA':''}   peers: ${((EVX[d.id]||{})[x.vni]||[]).map(p=>i2ip(p.ip)).join(', ')||'—'}`));
  (d.vrfs||[]).filter(v=>+v.l3vni>0).forEach(v=>L.push(`nve1      ${String(v.l3vni).padEnd(9)}${'n/a'.padEnd(18)}${(vt!=null?'Up':'Down').padEnd(6)}CP   L3 [${v.name}]`));return L.join('\n')}
function showRmap(d,name){const rs=(d.rmaps||[]).filter(r=>!name||r.name===name);if(!rs.length)return name?`% route-map ${name} não existe`:'Nenhuma route-map configurada.';
  return rs.map(rm=>seqd(rm.rules).map(r=>[`route-map ${rm.name}, ${r.act}, sequence ${r.seq}`,'  Match clauses:',r.mPfx?`    ip address prefix-lists: ${r.mPfx}`:null,r.mComm?`    community (community-list filter): ${r.mComm}`:null,'  Set clauses:',r.sLp!==''&&r.sLp!=null?`    local-preference ${r.sLp}`:null,r.sMed!==''&&r.sMed!=null?`    metric ${r.sMed}`:null,r.sComm?`    community ${r.sComm}${r.sAdd?' additive':''}`:null,r.sPre?`    as-path prepend ${r.sPre}`:null].filter(x=>x!==null).join('\n')).join('\n')).join('\n')}
function showPl(d){const ps=d.pfx||[];if(!ps.length)return'Nenhuma prefix-list configurada.';return ps.map(p=>[`ip prefix-list ${p.name}: ${p.rules.length} entries`,...seqd(p.rules).map(r=>`   seq ${r.seq} ${r.act} ${r.pfx}${r.ge?' ge '+r.ge:''}${r.le?' le '+r.le:''}`)].join('\n')).join('\n')}
function showCl(d){const cs=d.clists||[];if(!cs.length)return'Nenhuma community-list configurada.';return cs.map(c=>[`Community standard list ${c.name}`,...(c.rules||[]).map(r=>`    ${r.act} ${r.comm}`)].join('\n')).join('\n')}
function showBgpPfx(d,ip,vrf){computeOspf();const t=BGPT[vrfKey(d,vrf||'')];const x=ip2i(ip.split('/')[0]);if(!t)return'% Tabela BGP vazia';const keys=[...t.all.keys()].filter(k=>{const c=pc(k);return ip.includes('/')?k===netStr(pc(ip)):inNet(x,c)}).sort((a,b)=>pc(b).len-pc(a).len);
  if(!keys.length)return`% Rede ${ip} não está na tabela BGP`;const k=keys[0];const best=t.best.get(k);const ps=t.all.get(k).slice().sort(bgpBetter);
  const L=[`BGP routing table entry for ${k}${vrf?', vrf '+vrf:''}`,`Paths: (${ps.length} available, best #${ps.indexOf(best)+1})`];
  ps.forEach(p=>{L.push(`  ${p.asPath.length?p.asPath.join(' '):'Local'}${p.imp?`, imported from ${p.imp.rd}:${k}`:''}`,`    ${p.local?'0.0.0.0':i2ip(p.nh)} from ${p.from?i2ip(p.from.ip)+' ('+p.from.name+')':'0.0.0.0'}`,`      Origin ${p.origin==='i'?'IGP':'incomplete'}, metric ${p.med||0}, localpref ${p.lp}, ${p.local?'sourced, local':p.ebgp?'external':'internal'}${p===best?', best':''}`);
    if((p.comm||[]).length)L.push(`      Community: ${p.comm.join(' ')}`);if(p.imp)L.push(`      Extended Community: ${p.imp.fam==='evpn'?'Encapsulation:8 (VXLAN) VNI '+p.imp.vni:'mpls labels in/out nolabel/'+p.imp.label}`)});return L.join('\n')}
function classMask(ip){if(ip===null)return 0;const a=ip>>>24;return a<128?0xff000000:a<192?0xffff0000:0xffffff00}
function showOspfIf(d){if(!d.ospf?.on)return'% OSPF não está ativo neste equipamento';computeOspf();const L=['Interface    PID   Area            IP Address/Mask    Cost  State Nbrs F/C'];
  l3ifs(d).forEach(f=>{const n=(OADJ[d.id]||[]).filter(x=>x.ifc.key===f.key).length;L.push(`${ifName(d,f).padEnd(13)}1     ${String(d.ospf.area||0).padEnd(16)}${cidrStr(f.c).padEnd(19)}1     ${n?'DR   ':'WAIT '} ${n}/${n}`)});return L.join('\n')}
function arpRows(d){const rows=[];l3ifs(d).forEach(f=>{rows.push({ip:f.c.ip,m:mac(d.id,f.key),ifc:ifName(d,f),age:'-'});l2Reach(d.id,f).eps.forEach(ep=>{const pd=dev(ep.dev),pf=getIf(pd,ep.key);if(pf&&inNet(pf.c.ip,f.c))rows.push({ip:pf.c.ip,m:mac(pd.id,pf.key),ifc:ifName(d,f),age:String(1+(pf.c.ip%9)),name:pd.name})})});return rows}
function showArp(d){const L=['Protocol  Address          Age (min)  Hardware Addr   Type   Interface'];arpRows(d).forEach(r=>L.push(`Internet  ${i2ip(r.ip).padEnd(17)}${r.age.padStart(4).padEnd(11)}${macCisco(r.m)}  ARPA   ${r.ifc}`));return L.length>1?L.join('\n'):'Tabela ARP vazia (nenhuma interface com IP).'}
function showMac(d){if(!isSw(d.type))return'% Tabela MAC só existe em switches';const L=['          Mac Address Table','-------------------------------------------','Vlan    Mac Address       Type        Ports','----    -----------       --------    -----'];let n=0;
  d.ports.forEach((p,k)=>{if(p.shut||p.mode==='routed'||!linkAt(d.id,k))return;const vl=p.mode==='access'?[+p.vlan]:[1,...d.vlans.map(v=>+v.id)].filter(v=>allowedHas(p,v));
    vl.forEach(v=>{const tag=p.mode==='trunk'&&v!==(+p.native||1)?v:null;l2FromPort(d.id,k,tag).eps.forEach(ep=>{if(ep.dev===d.id)return;L.push(`${String(v).padEnd(8)}${macCisco(mac(ep.dev,ep.key)).padEnd(18)}DYNAMIC     ${spn(d,k)}`);n++})})});
  L.push(`Total Mac Addresses for this criterion: ${n}`);return L.join('\n')}
function showNei(d,lldp){const ls=d.ports.map((p,k)=>({k,L:linkAt(d.id,k)})).filter(x=>x.L);if(!ls.length)return'Nenhum vizinho.';
  const cap=t=>({sw2:'S I',sw3:'R S I',rtr:'R',fw:'R',pc:'H',srv:'H'})[t];const L=[lldp?'Device ID           Local Intf     Hold-time  Capability      Port ID':'Device ID        Local Intrfce     Holdtme    Capability  Platform    Port ID'];
  ls.forEach(({k,L:x})=>{const pd=dev(x.peer);L.push(lldp?`${pd.name.padEnd(20)}${spn(d,k).padEnd(15)}120        ${cap(pd.type).padEnd(16)}${spn(pd,x.peerK)}`:`${pd.name.padEnd(17)}${spn(d,k).padEnd(18)}${String(150+k%30).padEnd(11)}${cap(pd.type).padEnd(12)}${(TYPES[pd.type].pre).padEnd(12)}${spn(pd,x.peerK)}`)});
  L.push('',`Total de entradas: ${ls.length}`);return L.join('\n')}
function showAcl(d){if(!fwd(d.type))return'% Este equipamento não filtra tráfego roteado';const rs=d.rules||[];if(!rs.length)return d.type==='fw'?'Nenhuma política: o firewall bloqueia todo tráfego roteado.':'Nenhuma ACL configurada.';
  const h=HITS[d.id]||[];const L=[`Extended IP access list ${d.aclName||'LAB-FILTER'}`];rs.forEach((r,i)=>L.push(`    ${10*(i+1)} ${aceText(r)}${h[i]?` (${h[i]} match${h[i]>1?'es':''})`:''}${r.desc?'   ! '+r.desc:''}`));
  L.push(`    ${10*(rs.length+1)} deny ip any any (implícito)`);return L.join('\n')}
function showNat(d){const t=NATT[d.id]||[];if(!l3ifs(d,true).some(f=>f.nat))return'% NAT não configurado (marque a interface externa com "ip nat outside")';if(!t.length)return'Nenhuma tradução ainda. Gere tráfego com ping a partir de um host interno.';
  const L=['Pro  Inside global         Inside local          Outside local         Outside global'];t.forEach(x=>{const pr=x.proto==='icmp'?'icmp':x.proto;const pt=x.proto==='icmp'?':1':':'+(49152+(x.inLocal%1000));const op=x.proto==='icmp'?':1':':'+x.port;
    L.push(`${pr.padEnd(5)}${(i2ip(x.inGlobal)+pt).padEnd(22)}${(i2ip(x.inLocal)+pt).padEnd(22)}${(i2ip(x.out)+op).padEnd(22)}${i2ip(x.out)+op}`)});return L.join('\n')}
function runIf(d,arg,vendor){const r=parseIf(d,arg);if(r.err)return r.err;const txt=GEN.cisco(d).split('\n');const name=r.loop!==undefined?`interface Loopback${r.loop}`:r.nve?'interface nve1':r.svi!==undefined?`interface Vlan${r.svi}`:r.lag?`interface ${lagName('cisco',d,r.lag)}`:`interface ${pn('cisco',d,r.k)}${r.sub!==undefined?'.'+r.sub:''}`;
  const i=txt.indexOf(name);if(i<0)return`${name}\n (configuração padrão)`;const o=[];for(let j=i;j<txt.length&&txt[j]!=='!';j++)o.push(txt[j]);return o.join('\n')+'\n!'}

/* ---------- shell dos hosts (PCs e servidores) ---------- */
function hostIf(d,name){name=String(name||'');const sm=name.match(/^(.+)\.(\d+)$/),base=sm?sm[1]:name;let k,lag=0;const bm=base.match(/^bond(\d+)$/);
  if(bm){lag=+bm[1]+1;k=lagMembers(d,lag)[0];if(k===undefined)return{err:`Cannot find device "${base}"`}}
  else{k=d.ports.findIndex((p,j)=>!isMgmt(d,j)&&spn(d,j).toLowerCase()===base.toLowerCase());if(k<0)return{err:`Cannot find device "${base}"`};if(+d.ports[k].lag&&sm){lag=+d.ports[k].lag;k=lagMaster(d,k)}}
  return{k,sub:sm?+sm[2]:null,lag,base}}
function hostRun(d,line,st,ctx){const out=s=>String(s).split('\n').forEach(x=>st.log.push({t:/^(bash|RTNETLINK|nc:|curl:|Error|Cannot|From .* Unreachable|ipmitool:)/.test(x)?'err':'out',s:x}));
  const w=line.trim().split(/\s+/),lw=w.map(x=>x.toLowerCase()),c=lw[0];const changed=()=>{ctx.onChange&&ctx.onChange()};
  const sim=(ip,proto,port)=>{const r=simulate(d.id,ip,proto,port);ctx.onSim&&ctx.onSim(r);return r};
  const ifs=l3ifs(d,true).filter(f=>!f.mgmt),first=ifs[0];
  const stOf=k=>d.ports[k].shut?'DOWN':linkAt(d.id,k)?'UP':'NO-CARRIER';
  const bcast=cc=>i2ip((cc.net|(~cc.mask))>>>0);
  const ipA=()=>{const L=['1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN','    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00','    inet 127.0.0.1/8 scope host lo'];let n=2;
    d.ports.forEach((p,k)=>{if(isMgmt(d,k))return;const lag=+p.lag;L.push(`${n++}: ${spn(d,k)}: <BROADCAST,MULTICAST${lag?',SLAVE':''}${p.shut?'':',UP'}${stOf(k)==='UP'?',LOWER_UP':''}> mtu 1500 qdisc mq ${lag?'master bond'+(lag-1)+' ':''}state ${stOf(k)}`,`    link/ether ${macLinux(mac(d.id,'p'+(lag?lagMaster(d,k):k)))} brd ff:ff:ff:ff:ff:ff`);
      const f=ifs.find(x=>x.kind==='port'&&x.k===k&&!x.lag);if(f)L.push(`    inet ${cidrStr(f.c)} brd ${bcast(f.c)} scope global ${spn(d,k)}`)});
    [...new Set(d.ports.map(p=>+p.lag).filter(Boolean))].forEach(lag=>{const b=lagName('linux',d,lag),up=lagUp(d,lag)!==undefined;L.push(`${n++}: ${b}: <BROADCAST,MULTICAST,MASTER${up?',UP,LOWER_UP':''}> mtu 1500 qdisc noqueue state ${up?'UP':'DOWN'}`,`    link/ether ${macLinux(mac(d.id,'p'+lagMembers(d,lag)[0]))} brd ff:ff:ff:ff:ff:ff`);
      const f=ifs.find(x=>x.kind==='port'&&x.lag===lag);if(f)L.push(`    inet ${cidrStr(f.c)} brd ${bcast(f.c)} scope global ${b}`)});
    ifs.filter(f=>f.kind==='sub').forEach(f=>{const base=f.lag?lagName('linux',d,f.lag):spn(d,f.k);L.push(`${n++}: ${base}.${f.vlan}@${base}: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc noqueue state UP`,`    link/ether ${macLinux(mac(d.id,f.key))} brd ff:ff:ff:ff:ff:ff`,`    inet ${cidrStr(f.c)} brd ${bcast(f.c)} scope global ${base}.${f.vlan}`)});
    d.ports.forEach((p,k)=>{(p.subs||[]).forEach(s=>{if(!pc(s.ip)){const base=+p.lag?lagName('linux',d,p.lag):spn(d,k);L.push(`${n++}: ${base}.${s.vlan}@${base}: <BROADCAST,MULTICAST,UP> mtu 1500 state UP   (sem IP)`)}})});
    return L.join('\n')};
  const nameOf=f=>{const b=f.lag?lagName('linux',d,f.lag):spn(d,f.k);return f.kind==='sub'?`${b}.${f.vlan}`:b};
  const ipR=()=>{const o=[];const g=ip2i(d.gw),gf=g!==null&&ifs.find(f=>inNet(g,f.c));if(d.gw)o.push(`default via ${d.gw} dev ${gf?nameOf(gf):'?'}`);
    (d.routes||[]).forEach(r=>{const x=pc(r.dst),nh=ip2i(r.nh),f=nh!==null&&ifs.find(y=>inNet(nh,y.c));if(x)o.push(`${netStr(x)} via ${r.nh} dev ${f?nameOf(f):'?'}`)});
    ifs.forEach(f=>o.push(`${netStr(f.c)} dev ${nameOf(f)} proto kernel scope link src ${i2ip(f.c.ip)}`));return o.join('\n')};
  const bmcK=d.ports.findIndex((p,k)=>isMgmt(d,k)),bmcName=(modelOf(d)&&modelOf(d).bmc)||'BMC';
  if(!c)return{};
  if(c==='help'||c==='?'){out(`Comandos:
  ip a | ip addr add <ip>/<len> dev <if> | ip addr del <ip>/<len> dev <if> | ip addr flush dev <if>
  ip link | ip link set <if> up|down | ip link set <if> master bond0 | ip link set <if> nomaster
  ip link add link <if> name <if>.<vlan> type vlan id <vlan> | ip link del <if>.<vlan>
  ip route | ip route add default via <ip> | ip route add <rede>/<len> via <ip> | ip route del …
  ip neigh | ifconfig | route -n | arp -n
  ping [-c N] <ip> | traceroute <ip> | nc -zv [-u] <ip> <porta> | curl http://<ip>[:porta]
  ipmitool lan print | ipmitool lan set 1 ipaddr|netmask|defgw ipaddr <valor>   (${bmcName})
  hostname [nome] | clear
Interfaces: ${d.ports.map((p,k)=>isMgmt(d,k)?null:spn(d,k)).filter(Boolean).join(', ')}${d.ports.some(p=>+p.lag)?' + bond0…':''}`);return{}}
  if(c==='clear'){st.log=[];return{}}
  if(c==='exit'||c==='logout')return{};
  if(c==='hostname'){if(!w[1]){out(d.name);return{}}const nm=w[1].replace(/[^\w.-]/g,'-');if(byName(nm)&&byName(nm)!==d){out('hostname: já existe um equipamento com esse nome');return{}}d.name=nm;changed();return{}}
  if(c==='ifconfig'){const L=[];ifs.forEach(f=>{L.push(`${nameOf(f)}: flags=4163<UP,BROADCAST,RUNNING,MULTICAST>  mtu 1500`,`        inet ${i2ip(f.c.ip)}  netmask ${msk(f.c)}  broadcast ${bcast(f.c)}`,`        ether ${macLinux(mac(d.id,f.key))}  txqueuelen 1000  (Ethernet)`,'')});L.push('lo: flags=73<UP,LOOPBACK,RUNNING>  mtu 65536','        inet 127.0.0.1  netmask 255.0.0.0');out(L.join('\n'));return{}}
  if(c==='ipconfig'){out(ifs.map(f=>`Adaptador ${nameOf(f)}:\n   Endereço IPv4. . . . . . . . . . : ${i2ip(f.c.ip)}\n   Máscara de Sub-rede. . . . . . . : ${msk(f.c)}\n   Gateway Padrão . . . . . . . . . : ${d.gw&&inNet(ip2i(d.gw)??0,f.c)?d.gw:''}`).join('\n\n')||'Nenhum adaptador com IP.');return{}}
  if(c==='route'){out('Kernel IP routing table\nDestination     Gateway         Genmask         Flags Metric Ref    Use Iface');const g=ip2i(d.gw),gf=g!==null&&ifs.find(f=>inNet(g,f.c));if(d.gw)out(`0.0.0.0         ${d.gw.padEnd(16)}0.0.0.0         UG    0      0        0 ${gf?nameOf(gf):'?'}`);
    (d.routes||[]).forEach(r=>{const x=pc(r.dst);if(x)out(`${i2ip(x.net).padEnd(16)}${r.nh.padEnd(16)}${msk(x).padEnd(16)}UG    0      0        0`)});ifs.forEach(f=>out(`${i2ip(f.c.net).padEnd(16)}0.0.0.0         ${msk(f.c).padEnd(16)}U     0      0        0 ${nameOf(f)}`));return{}}
  if(c==='arp'||(c==='ip'&&/^n/.test(lw[1]||''))){const rows=arpRows(d).filter(r=>r.age!=='-'&&!/^(iDRAC|iLO|XCC|BMC|CIMC)$/.test(r.ifc));if(c==='arp'){out('Address                  HWtype  HWaddress           Flags Mask            Iface');rows.forEach(r=>out(`${i2ip(r.ip).padEnd(25)}ether   ${macLinux(r.m)}   C                     ${r.ifc}`))}else rows.forEach(r=>out(`${i2ip(r.ip)} dev ${r.ifc} lladdr ${macLinux(r.m)} REACHABLE`));if(!rows.length&&c==='arp')out('(nenhum vizinho alcançável)');return{}}
  if(c==='ipmitool'){if(bmcK<0){out('ipmitool: este equipamento não tem BMC');return{}}const p=d.ports[bmcK],cc=pc(p.ip);
    if(lw[1]==='lan'&&lw[2]==='print'){out(`Set in Progress         : Set Complete\nIP Address Source       : Static Address\nIP Address              : ${cc?i2ip(cc.ip):'0.0.0.0'}\nSubnet Mask             : ${cc?msk(cc):'0.0.0.0'}\nMAC Address             : ${macLinux(mac(d.id,'p'+bmcK))}\nDefault Gateway IP      : ${p.gw||'0.0.0.0'}\n(${bmcName} — porta ${spn(d,bmcK)}${linkAt(d.id,bmcK)?', conectada a '+dev(linkAt(d.id,bmcK).peer).name:', sem cabo'})`);return{}}
    if(lw[1]==='lan'&&lw[2]==='set'){const f=lw[4],v=w[5];
      if(f==='ipsrc')return{};
      if(f==='ipaddr'){if(ip2i(v)===null){out('ipmitool: IP inválido');return{}}p.ip=`${v}/${cc?cc.len:24}`;p.mode='routed';changed();out(`Setting LAN IP Address to ${v}`);return{}}
      if(f==='netmask'){const l=maskLen(v);if(l===null||!cc){out(cc?'ipmitool: máscara inválida':'ipmitool: defina o ipaddr antes da máscara');return{}}p.ip=`${i2ip(cc.ip)}/${l}`;changed();out(`Setting LAN Subnet Mask to ${v}`);return{}}
      if(f==='defgw'&&lw[5]==='ipaddr'){if(ip2i(w[6])===null){out('ipmitool: gateway inválido');return{}}p.gw=w[6];changed();out(`Setting LAN Default Gateway IP to ${w[6]}`);return{}}}
    out('Uso: ipmitool lan print | ipmitool lan set 1 ipaddr <ip> | netmask <máscara> | defgw ipaddr <gw>');return{}}
  if(c==='ip'){const sub=lw[1]||'';
    if(!sub||/^(a|ad|add|addr|addre|addres|address)$/.test(sub)){const op=lw[2]||'show';
      if(op==='show'||op==='s'||op==='list'){out(ipA());return{}}
      const di=lw.indexOf('dev'),dn=di>0?w[di+1]:null;
      if(op==='add'){const x=pc(w[3]);if(!x||!w[3].includes('/')){out('Error: informe o endereço com prefixo, ex.: ip addr add 10.10.10.10/24 dev eth0');return{}}if(!dn){out('Error: falta "dev <interface>"');return{}}
        const r=hostIf(d,dn);if(r.err){out(r.err);return{}}const p=d.ports[r.k];
        if(r.sub!==null){const s=(p.subs||[]).find(y=>+y.vlan===r.sub);if(!s){out(`Cannot find device "${dn}" (crie antes com ip link add link ${r.base} name ${dn} type vlan id ${r.sub})`);return{}}s.ip=w[3]}
        else{if(+p.lag&&!r.lag){out(`Error: ${spn(d,r.k)} é escrava do bond${+p.lag-1}; configure o IP no bond`);return{}}p.ip=w[3];p.mode='routed'}changed();return{}}
      if(op==='del'||op==='flush'){if(!dn){out('Error: falta "dev <interface>"');return{}}const r=hostIf(d,dn);if(r.err){out(r.err);return{}}const p=d.ports[r.k];if(r.sub!==null){const s=(p.subs||[]).find(y=>+y.vlan===r.sub);if(s)s.ip=''}else p.ip='';changed();return{}}
      out('Uso: ip addr [show | add <ip>/<len> dev <if> | del <ip>/<len> dev <if> | flush dev <if>]');return{}}
    if(/^(r|ro|rou|rout|route)$/.test(sub)){const op=lw[2]||'show';
      if(op==='show'||op==='list'){out(ipR()||'(sem rotas)');return{}}
      const vi=lw.indexOf('via');const dst=lw[3];const nh=vi>0?w[vi+1]:null;
      if(op==='add'||op==='replace'){if(!dst||!nh||ip2i(nh)===null){out('Uso: ip route add default via 10.10.10.1 | ip route add 10.20.0.0/16 via 10.10.10.254');return{}}
        if(!ifs.some(f=>inNet(ip2i(nh),f.c))){out('Error: Nexthop has invalid gateway.');return{}}
        if(dst==='default'||dst==='0.0.0.0/0'){if(d.gw&&op==='add'){out('RTNETLINK answers: File exists');return{}}d.gw=nh;changed();return{}}
        const x=pc(dst);if(!x){out('Error: rede inválida');return{}}const key=netStr(x);d.routes=(d.routes||[]).filter(r=>!(pc(r.dst)&&netStr(pc(r.dst))===key));d.routes.push({dst:key,nh});changed();return{}}
      if(op==='del'||op==='delete'){if(dst==='default'||dst==='0.0.0.0/0'){if(!d.gw){out('RTNETLINK answers: No such process');return{}}d.gw='';changed();return{}}
        const x=pc(dst);const before=(d.routes||[]).length;d.routes=(d.routes||[]).filter(r=>!(x&&pc(r.dst)&&netStr(pc(r.dst))===netStr(x)));if(d.routes.length===before)out('RTNETLINK answers: No such process');else changed();return{}}
      out('Uso: ip route [show | add … | del …]');return{}}
    if(sub==='link'||sub==='l'){const op=lw[2]||'show';
      if(op==='show'){out(ipA().split('\n').filter(x=>!/^\s+inet/.test(x)).join('\n'));return{}}
      if(op==='set'){const r=hostIf(d,w[3]);if(r.err){out(r.err);return{}}const rest=lw.slice(4);
        if(rest[0]==='up'||rest[0]==='down'){const down=rest[0]==='down';if(r.lag&&r.sub===null)lagMembers(d,r.lag).forEach(k=>d.ports[k].shut=down);else if(r.sub===null)d.ports[r.k].shut=down;changed();return{}}
        if(rest[0]==='master'){const bm=(w[5]||'').match(/^bond(\d+)$/);if(!bm){out('Uso: ip link set <if> master bond0');return{}}if(r.lag||r.sub!==null){out('Error: só interfaces físicas entram no bond');return{}}const n=+bm[1]+1;const ms=lagMembers(d,n);const p=d.ports[r.k];
          p.lag=n;if(ms.length&&r.k<ms[0]){const src=d.ports[ms[0]];p.ip=src.ip;p.subs=src.subs;src.ip='';src.subs=[]}changed();return{}}
        if(rest[0]==='nomaster'){const p=d.ports[r.k];if(+p.lag&&lagMaster(d,r.k)===r.k&&lagMembers(d,p.lag).length>1){const nx=lagMembers(d,p.lag)[1];d.ports[nx].ip=p.ip;d.ports[nx].subs=p.subs;p.ip='';p.subs=[]}p.lag=0;changed();return{}}
        out('Uso: ip link set <if> up | down | master bond0 | nomaster');return{}}
      if(op==='add'){const li=lw.indexOf('link',3),ni=lw.indexOf('name',3),ii=lw.indexOf('id',3);
        if(lw.includes('bond')&&li<0){out(`% ${w[3]} pronto: agora use "ip link set <if> master ${w[3]}"`);return{}}
        if(li<0||ni<0||ii<0){out('Uso: ip link add link <if> name <if>.<vlan> type vlan id <vlan>');return{}}const r=hostIf(d,w[li+1]);if(r.err){out(r.err);return{}}const v=+w[ii+1];if(!(v>=1&&v<=4094)){out('Error: id de VLAN inválido');return{}}
        const k=r.lag?lagMembers(d,r.lag)[0]:r.k,p=d.ports[k];if(+p.lag&&!r.lag){out(`Error: ${spn(d,k)} é escrava do bond; crie a VLAN em bond${+p.lag-1}`);return{}}p.mode='routed';if((p.subs||[]).some(s=>+s.vlan===v)){out('RTNETLINK answers: File exists');return{}}(p.subs=p.subs||[]).push({vlan:v,ip:'',nat:false,vip:''});changed();return{}}
      if(op==='del'||op==='delete'){const r=hostIf(d,w[3]);if(r.err){out(r.err);return{}}if(r.sub===null){out('Error: só dá para remover subinterfaces de VLAN');return{}}const p=d.ports[r.k];p.subs=(p.subs||[]).filter(s=>+s.vlan!==r.sub);changed();return{}}
      out('Uso: ip link [show | set … | add … | del …]');return{}}
    out(`Object "${w[1]}" is unknown, try "ip help".`);return{}}
  if(c==='ping'){const ci=lw.indexOf('-c');const n=ci>=0?Math.max(1,Math.min(10,+w[ci+1]||4)):4;const ip=w.filter((x,i)=>i>0&&x[0]!=='-'&&(ci<0||i!==ci+1)).pop();if(ip2i(ip)===null){out('ping: informe um IPv4. Ex.: ping 10.10.30.10');return{}}
    const r=sim(ip,'icmp',0);out(`PING ${ip} (${ip}) 56(84) bytes of data.`);
    if(r.ok){const ttl=64-Math.max(0,r.hops.length-1);for(let i=1;i<=n;i++)out(`64 bytes from ${ip}: icmp_seq=${i} ttl=${ttl} time=${(0.4+r.hops.length*0.21+i*0.03).toFixed(2)} ms`);out(`\n--- ${ip} ping statistics ---\n${n} packets transmitted, ${n} received, 0% packet loss`);st.log.push({t:'ok',s:'✓ alcançável'})}
    else{out(`From ${first?i2ip(first.c.ip):'0.0.0.0'} icmp_seq=1 Destination Host Unreachable\n\n--- ${ip} ping statistics ---\n${n} packets transmitted, 0 received, 100% packet loss`);st.log.push({t:'err',s:'motivo: '+r.why})}return{sim:r}}
  if(c==='traceroute'||c==='tracert'){const ip=w[1];if(ip2i(ip)===null){out('Uso: traceroute <ip>');return{}}const r=sim(ip,'icmp',0);out(`traceroute to ${ip} (${ip}), 30 hops max, 60 byte packets`);
    r.hops.forEach((h,i)=>out(` ${String(i+1).padStart(2)}  ${h.name} (${h.ip})  ${(0.3+i*0.4).toFixed(3)} ms  ${(0.35+i*0.4).toFixed(3)} ms  ${(0.33+i*0.4).toFixed(3)} ms`));if(!r.ok)out(` ${String(r.hops.length+1).padStart(2)}  * * *   (${r.why})`);return{sim:r}}
  if(c==='nc'||c==='netcat'){const udp=lw.some(x=>/^-\w*u/.test(x));const args=w.slice(1).filter(x=>x[0]!=='-');const ip=args[0],port=portNum(args[1]);if(ip2i(ip)===null||!port){out('Uso: nc -zv <ip> <porta>   (use -u para UDP)');return{}}
    const r=sim(ip,udp?'udp':'tcp',port);if(r.ok)out(`Connection to ${ip} ${port} port [${udp?'udp':'tcp'}/*] succeeded!`);else{out(`nc: connect to ${ip} port ${port} (${udp?'udp':'tcp'}) failed: Connection timed out`);st.log.push({t:'err',s:'motivo: '+r.why})}return{sim:r}}
  if(c==='curl'||c==='wget'){const u=(w.find((x,i)=>i>0&&x[0]!=='-')||'').match(/^(https?):\/\/([\d.]+)(?::(\d+))?/i);if(!u){out('Uso: curl http://<ip>[:porta]');return{}}const port=+u[3]||(u[1].toLowerCase()==='https'?443:80);
    const r=sim(u[2],'tcp',port);if(r.ok)out(`HTTP/1.1 200 OK\nServer: bancada-de-rede\nContent-Type: text/plain\n\nResposta de ${E_lastAt(r)||u[2]} na porta ${port}`);else{out(`curl: (28) Failed to connect to ${u[2]} port ${port}: Connection timed out`);st.log.push({t:'err',s:'motivo: '+r.why})}return{sim:r}}
  if(['show','conf','configure','enable','interface','vlan','router','display'].includes(c)){out(`bash: ${w[0]}: comando não encontrado — este é um host Linux. Digite help.`);return{}}
  out(`bash: ${w[0]}: comando não encontrado`);return{}}

const E_lastAt=r=>r.hops.length?r.hops[r.hops.length-1].name:null;

const INFO=/^% (Recurso aceito|Atenção|IP removido|VRF \S+ removida|A VLAN \d+ não existia|Interfaces na área|NAT de saída|Atenção|Aceito, mas|Nesta bancada|As redes conectadas|A bancada usa|\S+ entrou n|\S+ saiu d|VRRP|Gateway de gerência|Rota de gerência)/;
/* executa uma linha. ctx: {vendor, onChange(), onSim(r), onSave()} */
const newSt=()=>({mode:'exec',ifc:null,vlan:null,log:[],hist:[],hi:0});
/* sessão SSH aninhada: o console continua o mesmo, os comandos vão para o equipamento remoto */
function sshEnter(st,tg,o){const x=newSt();st.ssh={dev:tg.id,host:o.host||tg.name,user:o.user||'root',st:x,prev:st.ssh||null,from:o.from||''};
  const L=isHost(tg.type)&&tg.os?osBanner(tg).filter(l=>l.trim()&&!/Digite help|Bancada de Rede/.test(l)):[banner(tg)[0]];L.forEach(s=>st.log.push({t:'dim',s}));st.log.push({t:'dim',s:`Last login: ${new Date().toUTCString().replace(' GMT','')}${o.from?' from '+o.from:''}`})}
function sshRelay(d,line,st,ctx){const S2=st.ssh;const tg=dev(S2.dev);if(!tg){st.ssh=S2.prev;st.log.push({t:'err',s:'Connection closed (o equipamento remoto foi removido).'});return{}}
  const tst=S2.st;const t=String(line||'').trim();if(t&&st.hist[st.hist.length-1]!==t){st.hist.push(t);st.hi=st.hist.length}
  if(/^(exit|logout|quit)$/i.test(t)&&!tst.ssh&&!tst.here&&(isHost(tg.type)||!tst.mode||tst.mode==='exec')){st.log.push({t:'in',s:promptOf(tg,tst)+' '+line},{t:'dim',s:'logout'},{t:'dim',s:`Connection to ${S2.host} closed.`});st.ssh=S2.prev;return{}}
  const r=cliRun(tg,line,{...ctx,st:tst})||{};const flush=()=>{st.log.push(...tst.log.splice(0))};flush();if(r.async)r.async=r.async.then(flush);return r}
function cliRun(d,line,ctx={}){const st=ctx.st||cs(d.id);if(st.ssh)return sshRelay(d,line,st,ctx);
  const r=cliRun0(d,line,{...ctx,st})||{};const go=()=>{if(r.open){const tg=dev(r.open.dev);if(tg)sshEnter(st,tg,r.open);delete r.open}};go();if(r.async)r.async=r.async.then(go);return r}
function cliRun0(d,line,ctx={}){const st=ctx.st||cs(d.id);const vendor=ctx.vendor||'cisco';
  line=String(line||'').replace(/\s+$/,'');
  if(isHost(d.type)&&d.os){st.log.push({t:'in',s:promptOf(d,st)+' '+line});line=String(line||'');if(!st.here&&line.trim()){if(st.hist[st.hist.length-1]!==line.trim())st.hist.push(line.trim());if(st.hist.length>300)st.hist.shift();st.hi=st.hist.length}const r=osRun(d,line,st,ctx)||{};if(r.sim&&ctx.onSim){}return r}
  if(/\?$/.test(line)&&!/\|/.test(line)){st.log.push({t:'in',s:promptOf(d,st)+' '+line});cliHelp(d,line.slice(0,-1)).forEach(s=>st.log.push({t:'dim',s}));return{keep:line.slice(0,-1)}}
  st.log.push({t:'in',s:promptOf(d,st)+' '+line});
  const out=s=>{String(s).split('\n').forEach(x=>st.log.push({t:/^%/.test(x)?(INFO.test(x)?'dim':'err'):'out',s:x}))};
  line=line.trim();if(!line)return{};if(st.hist[st.hist.length-1]!==line)st.hist.push(line);if(st.hist.length>300)st.hist.shift();st.hi=st.hist.length;
  if(isHost(d.type))return hostRun(d,line,st,ctx);
  let filt=null;const pi=line.indexOf('|');if(pi>0){filt=line.slice(pi+1);line=line.slice(0,pi).trim()}
  const show=t=>out(pipe(t,filt));
  let w=line.split(/\s+/),lw=w.map(x=>x.toLowerCase());if(lw[0]==='do'){w=w.slice(1);lw=lw.slice(1)}
  const is=(i,word,min=2)=>!!lw[i]&&word.startsWith(lw[i])&&lw[i].length>=Math.min(min,word.length);
  const changed=()=>{ctx.onChange&&ctx.onChange()};
  const NS='% Aceito, mas não é simulado nesta bancada (não entra na configuração exportada).';
  if(is(0,'help',1)){out(cliHelp(d,'').join('\n'));return{}}
  if((lw[0]==='ssh'||lw[0]==='telnet')&&st.mode==='exec'){let user='admin',tgt=null;for(let i=1;i<w.length;i++){if(lw[i]==='-l'){user=w[++i];continue}if(/^-/.test(w[i])){if(/^-(v|vrf|p|c|m)$/.test(lw[i]))i++;continue}tgt=w[i]}if(tgt&&tgt.includes('@'))[user,tgt]=tgt.split('@');
    if(!tgt||ip2i(tgt)===null){out('% Uso: ssh -l <usuário> <ip>');return{}}const port=lw[0]==='telnet'?23:22;const r=simulate(d.id,tgt,'tcp',port);ctx.onSim&&ctx.onSim(r);
    if(!r.ok){out(`% Connection refused by remote host — ${r.why}`);return{sim:r}}const tg=dev(r.at);if(!tg||r.ext){out('% (destino fora do lab — a bancada não abre sessões reais)');return{}}
    out(`Trying ${tgt}... Open`);if(isHost(tg.type)&&tg.os)out(`Password: ********`);return{sim:r,open:{dev:tg.id,host:tgt,user,from:i2ip(r.srcAtDst)}}}
  if(is(0,'clear',2)&&st.mode==='exec'){st.log=[];return{}}
  if(is(0,'end',2)){st.mode='exec';st.ifc=null;clearBgp(st);return{}}
  if(is(0,'exit',2)){if(st.mode==='bgp'){if(st.bgpNbAf){st.bgpNbAf='';return{}}if(st.bgpNb){st.bgpNb=null;return{}}if(st.bgpAf){st.bgpAf='';st.bgpVrf=st.bgpVrfCtx||'';return{}}if(st.bgpVlan!=null){st.bgpVlan=null;return{}}if(st.bgpVrfCtx||st.bgpVrf){st.bgpVrfCtx='';st.bgpVrf='';return{}}}
    if(st.mode==='nve'&&st.nveVni){st.nveVni=null;return{}}if(st.mode==='evpn'&&st.evVni){st.evVni=null;return{}}
    st.mode=['if','sub','vlan','ospf','acl','vrf','bgp','rmap','nve','evpn'].includes(st.mode)?'config':'exec';clearBgp(st);return{}}
  if(is(0,'write',2)||lw[0]==='wr'||(is(0,'copy',2)&&is(1,'running-config',3))){if(ctx.onSave){ctx.onSave();out('Building configuration...\n[OK]')}else out('% Salvamento indisponível aqui');return{}}
  // VPN (IPsec / WireGuard)
  {const r=lw.join(' ');let vw=null;
    if(/^(show|sh) crypto (ikev2|isakmp|ike)/.test(r)||/^show security ike/.test(r)||/^(display|dis) ike sa/.test(r)||/^show vpn ike/.test(r)||/^get vpn ike/.test(r))vw='ike';
    else if(/^(show|sh) crypto (ipsec|session|map)/.test(r)||/^show security ipsec/.test(r)||/^(display|dis) ipsec/.test(r)||/^show vpn ipsec/.test(r)||/^get vpn ipsec/.test(r)||/^diagnose vpn tunnel/.test(r)||/^show interfaces wireguard/.test(r)||/^\/(ip ipsec|interface wireguard)/.test(r)||/^show (vpn|wireguard)/.test(r))vw='sa';
    if(vw&&fwd(d.type)){show(vpnShowNet(d,vw,vendor));return{}}}
  // aliases de outros fabricantes
  if(lw[0]==='display'||lw[0]==='dis'){const r=lw.slice(1).join(' ');
    if(/^ip rout/.test(r)){const m=r.match(/vpn-instance\s+(\S+)/);if(m){const v=vrfArg(d,w[w.map(x=>x.toLowerCase()).indexOf('vpn-instance')+1]);return show(v===null?'% vpn-instance não existe':routeTable(d,null,v)),{}}return show(routeTable(d)),{}}
    if(/^mpls ldp (sess|peer)/.test(r))return show(showLdp(d)),{};if(/^mpls lsp/.test(r))return show(showLfib(d)),{};if(/^bgp vpnv4.*peer/.test(r))return show(showVpn(d,'vpnv4',true)),{};if(/^bgp vpnv4/.test(r))return show(showVpn(d,'vpnv4')),{};if(/^bgp evpn.*peer/.test(r))return show(showVpn(d,'evpn',true)),{};if(/^bgp evpn/.test(r))return show(showVpn(d,'evpn')),{};if(/^vxlan (tunnel|peer)/.test(r))return show(showNve(d,'peers')),{};if(/^vxlan vni/.test(r))return show(showNve(d,'vni')),{};if(/^route-policy/.test(r))return show(showRmap(d,w[2])),{};if(/^ip ip-prefix/.test(r))return show(showPl(d)),{};if(/^ip community-filter/.test(r))return show(showCl(d)),{};
    if(/^bgp peer/.test(r))return show(showBgpSum(d)),{};if(/^bgp rout/.test(r))return show(showBgp(d,'')),{};if(/^ip vpn-instance/.test(r))return show(showVrf(d)),{};if(/^vlan/.test(r))return show(showVlan(d)),{};if(/^ip int/.test(r))return show(showIpBr(d)),{};if(/^(cur|current)/.test(r))return show(gen('huawei',d)),{};
    if(/^arp/.test(r))return show(showArp(d)),{};if(/^mac/.test(r))return show(showMac(d)),{};if(/^lldp/.test(r))return show(showNei(d,true)),{};out('% display suporta: ip routing-table [vpn-instance X], bgp peer, bgp routing-table, ip vpn-instance, vlan, ip interface brief, current-configuration, arp, mac-address, lldp neighbor');return{}}
  if(is(0,'show',2)){
    if(is(1,'running-config',3)||is(1,'configuration',4)){if(is(2,'interface',3)){show(runIf(d,w.slice(3).join(''),vendor));return{}}st.log.push({t:'dim',s:`! exibindo em ${VN[vendor==='auto'?osOf(d):vendor]} — troque o sistema de destino no topo`});show(gen(vendor,d));return{}}
    if(is(1,'startup-config',3)){st.log.push({t:'dim',s:'! a bancada salva o lab inteiro com "write memory"; mostrando a configuração atual'});show(gen(vendor,d));return{}}
    if(is(1,'mpls',2)){if(is(2,'ldp',2)){show(showLdp(d));return{}}if(is(2,'forwarding-table',3)){show(showLfib(d));return{}}if(is(2,'interfaces',3)){show(showMplsIf(d));return{}}out('% show mpls ldp neighbor | forwarding-table | interfaces');return{}}
    if((is(1,'bgp',2)||(is(1,'ip',2)&&is(2,'bgp',2)))&&lw.some(x=>/^(vpnv4|vpn-ipv4|l2vpn|evpn)$/.test(x))){const fam=lw.some(x=>/^(l2vpn|evpn)$/.test(x))?'evpn':'vpnv4';show(showVpn(d,fam,lw.some(x=>/^su/.test(x))));return{}}
    if(is(1,'nve',3)){show(showNve(d,is(2,'peers',2)?'peers':'vni'));return{}}
    if(is(1,'vxlan',3)){show(showNve(d,is(2,'vtep',2)||is(2,'flood',2)||is(2,'address-table',2)?'peers':'vni'));return{}}
    if(is(1,'l2route',3)){computeOspf();const t=BGPT[d.id+'#evpn'];const L=['Topology    Mac Address    Prod   Flags         Seq No     Next-Hops'];if(t)t.best.forEach(p=>{if(p.type===2){const v=vxVlan(d,p.vni);L.push(`${String(v??p.vni).padEnd(12)}${macCisco(p.mac.match(/../g)).padEnd(15)}${(p.local?'Local':'BGP').padEnd(7)}${(p.local?'L,':'Rcv').padEnd(14)}0          ${p.local?'(porta local)':i2ip(p.nh)}`)}});show(L.length>1?L.join('\n'):'Nenhuma rota MAC em EVPN.');return{}}
    if(is(1,'route-map',3)){show(showRmap(d,w[2]));return{}}
    if(is(1,'ip',2)&&is(2,'prefix-list',3)){show(showPl(d));return{}}
    if(is(1,'ip',2)&&is(2,'community-list',3)){show(showCl(d));return{}}
    if(is(1,'vlan',2)){show(showVlan(d));return{}}
    if(is(1,'ip',2)){
      if(is(2,'interface',3)){show(showIpBr(d));return{}}
      if(is(2,'route',2)){let r=lw.slice(3),wr=w.slice(3),vrf='';const vi=r.indexOf('vrf');if(vi>=0){const v=vrfArg(d,wr[vi+1]);if(v===null){out(`% VRF ${wr[vi+1]||''} não existe em ${d.name}`);return{}}vrf=v;r.splice(vi,2);wr.splice(vi,2)}
        if(r[0]&&ip2i(wr[0])!==null){show(routeFor(d,wr[0],vrf));return{}}const f=r[0]?['static','connected','ospf','bgp'].find(x=>x.startsWith(r[0])):null;if(r[0]&&!f){out('% Use: show ip route [vrf <nome>] [static | connected | ospf | bgp | <ip>]');return{}}show(routeTable(d,f,vrf));return{}}
      if(is(2,'bgp',2)){const vi=lw.indexOf('vrf');let v;if(vi>0){v=vrfArg(d,w[vi+1]);if(v===null||v===MGV){out(`% VRF ${w[vi+1]||''} não existe`);return{}}}
        if(lw.some(x=>/^su/.test(x))){show(showBgpSum(d,v));return{}}if(lw.some(x=>/^nei/.test(x))){show(showBgpNei(d));return{}}const px=w.slice(3).find(x=>pc(x)&&/^\d/.test(x));if(px){show(showBgpPfx(d,px,v||''));return{}}show(showBgp(d,v||''));return{}}
      if(is(2,'vrf',2)){show(showVrf(d));return{}}
      if(is(2,'ospf',2)){if(is(3,'neighbor',2)){show(showOspfNei(d));return{}}if(is(3,'interface',2)){show(showOspfIf(d));return{}}const ov=ospfNodes(d).filter(Boolean);if(ov.length&&!d.ospf?.on){show(ov.map(v=>` Routing Process "ospf 1" vrf ${v}, area ${vrfObj(d,v).ospf.area||0}`).join('\n'));return{}}show(d.ospf?.on?` Routing Process "ospf 1" with ID ${ridOf(d)}\n Area ${d.ospf.area||0}: ${l3ifs(d).length} interfaces${d.ospf.dio?'\n Originating default route':''}`:'% OSPF não está ativo');return{}}
      if(is(2,'nat',2)){show(showNat(d));return{}}
      if(is(2,'arp',2)){show(showArp(d));return{}}
      if(is(2,'access-lists',2)){show(showAcl(d));return{}}}
    if(is(1,'interfaces',3)){if(is(2,'trunk',2)){show(showTrunk(d));return{}}if(is(2,'status',2)){show(showStatus(d));return{}}if(w[2]){show(showIf(d,w.slice(2).join('')));return{}}show(d.ports.map((p,k)=>showIf(d,spn(d,k))).join('\n'));return{}}
    if(is(1,'mac',2)||is(1,'mac-address-table',4)){show(showMac(d));return{}}
    if(is(1,'cdp',2)){show(showNei(d,false));return{}}
    if(is(1,'lldp',2)){show(showNei(d,true));return{}}
    if(is(1,'arp',2)){show(showArp(d));return{}}
    if(is(1,'access-lists',2)){show(showAcl(d));return{}}
    if(is(1,'route',2)){show(routeTable(d));return{}}
    if(is(1,'bgp',2)){const vi=lw.indexOf('vrf');let v;if(vi>0){v=vrfArg(d,w[vi+1]);if(v===null||v===MGV){out(`% VRF ${w[vi+1]||''} não existe`);return{}}}
      if(lw.some(x=>/^su/.test(x))){show(showBgpSum(d,v));return{}}if(lw.some(x=>/^nei/.test(x))){show(showBgpNei(d));return{}}show(showBgp(d,v||''));return{}}
    if(is(1,'vrf',3)){show(showVrf(d));return{}}
    if(is(1,'etherchannel',3)||is(1,'port-channel',3)){show(showLag(d));return{}}
    if(is(1,'lacp',2)){show(showLacp(d));return{}}
    if(is(1,'vrrp',2)||is(1,'standby',3)){show(showVrrp(d));return{}}
    if(is(1,'inventory',3)){show(showInventory(d));return{}}
    if(is(1,'environment',3)||is(1,'power',3)){show(showPower(d));return{}}
    if(is(1,'version',2)){show(`Bancada de Rede — ${modelText(d)}\nHostname: ${d.name}\nInterfaces: ${d.ports.length}\nSistema nativo: ${VN[osOf(d)]||'—'}   Exportação atual: ${VN[vendor==='auto'?osOf(d):vendor]}`);return{}}
    if(is(1,'clock',2)){out(new Date().toUTCString());return{}}
    if(is(1,'history',2)){show(st.hist.slice(-30).map(x=>'  '+x).join('\n'));return{}}
    out('% Comando show incompleto. Digite "show ?"');return{}}
  if(is(0,'ping',2)||is(0,'traceroute',3)){const tr=lw[0].startsWith('tr');let ww=w.slice(1),lww=lw.slice(1),vrf='';const vi=lww.indexOf('vrf');
    if(vi>=0){const v=vrfArg(d,ww[vi+1]);if(v===null){out(`% VRF ${ww[vi+1]||''} não existe em ${d.name}`);return{}}vrf=v===MGV?'management':v;ww.splice(vi,2);lww.splice(vi,2)}
    const ip=ww[0];if(ip2i(ip)===null){out('% Informe um IPv4 de destino');return{}}
    let proto='icmp',port=0;if(lww[1]==='tcp'||lww[1]==='udp'){proto=lww[1];port=portNum(ww[2]);if(!port){out('% Informe a porta: ping <ip> tcp 443');return{}}}
    const r=simulate(d.id,ip,proto,port,{vrf});ctx.onSim&&ctx.onSim(r);
    if(tr){out(`Type escape sequence to abort.\nTracing the route to ${ip}\n`);r.hops.forEach((h,i)=>out(`  ${String(i+1).padStart(2)} ${h.ip.padEnd(16)} ${(1+i)} msec ${(1+i)} msec ${(2+i)} msec   ${h.name}`));if(!r.ok)st.log.push({t:'err',s:`  ${String(r.hops.length+1).padStart(2)}  *  *  *   ${r.why}`})}
    else{out(`Type escape sequence to abort.\nSending 5, 100-byte ${proto==='icmp'?'ICMP Echos':proto.toUpperCase()+'/'+port+' probes'} to ${ip}, timeout is 2 seconds:`);if(r.ok)st.log.push({t:'ok',s:'!!!!!'},{t:'out',s:`Success rate is 100 percent (5/5), round-trip min/avg/max = 1/${1+r.hops.length}/${2+r.hops.length} ms`});else st.log.push({t:'out',s:'.....'},{t:'out',s:'Success rate is 0 percent (0/5)'},{t:'err',s:'% '+r.why})}
    return{sim:r}}
  if(st.mode==='exec'){if(is(0,'configure',4)||lw[0]==='conf'){st.mode='config';out('Enter configuration commands, one per line.  End with CNTL/Z.');return{}}if(is(0,'enable',2)||is(0,'disable',3))return{};
    if(lw[0]==='ip'||lw[0]==='interface'||lw[0]==='vlan'||lw[0]==='hostname'||lw[0]==='router'||lw[0]==='vrf'){out('% Comando de configuração: entre antes com "configure terminal" (conf t)');return{}}
    out('% Comando inválido. Digite ? para ajuda.');return{}}

  const neg=lw[0]==='no';const a=neg?w.slice(1):w,la=neg?lw.slice(1):lw;const isA=(i,word,min=2)=>!!la[i]&&word.startsWith(la[i])&&la[i].length>=Math.min(min,word.length);
  const globalCmd=isA(0,'interface',3)||isA(0,'hostname',3)||(isA(0,'vlan',2)&&st.mode!=='bgp')||isA(0,'router',2)||isA(0,'access-list',3)||(isA(0,'vrf',3)&&st.mode!=='nve')||isA(0,'management',4)||isA(0,'route-map',3)||(la[0]==='evpn'&&!a[1])||(isA(0,'mpls',3)&&!['if','sub'].includes(st.mode))||(isA(0,'ip',2)&&(isA(1,'route',2)||isA(1,'default-gateway',3)||isA(1,'access-list',3)||isA(1,'prefix-list',3)||isA(1,'community-list',3)||(isA(1,'nat',2)&&isA(2,'inside',2)&&isA(3,'source',2))||isA(1,'routing',3)));
  if(st.mode!=='config'&&globalCmd&&!(st.mode==='vrf'&&isA(0,'ip',2)&&isA(1,'route',2))&&!(st.mode==='bgp'&&isA(0,'vrf',3)&&!isA(1,'context',3)&&!isA(1,'definition',3))&&!(['if','sub'].includes(st.mode)&&isA(0,'vrf',3)&&(isA(1,'forwarding',3)||isA(1,'member',3)||(la[1]&&!isA(1,'context',3)&&!isA(1,'definition',3)&&!isA(1,'instance',3))))&&!(['if','sub'].includes(st.mode)&&isA(0,'ip',2)&&isA(1,'vrf',3))){st.mode='config';clearBgp(st)}
  const vrfRoute=(vn,dst,gw)=>{if(!fwd(d.type)){out('% Este equipamento não roteia');return{}}if(!dst){out('% Uso: ip route vrf <nome> <rede> <máscara> <próximo-salto>');return{}}const key=netStr(pc(dst));
    if(neg){const before=d.routes.length;d.routes=d.routes.filter(r=>!((r.vrf||'')===vn&&pc(r.dst)&&netStr(pc(r.dst))===key&&(!gw||r.nh===gw)));if(before===d.routes.length)out('% Rota não encontrada');else changed();return{}}
    if(isNull(gw))gw='Null0';if(ip2i(gw)===null&&!isNull(gw)){out('% Próximo salto inválido');return{}}if(d.routes.some(r=>(r.vrf||'')===vn&&pc(r.dst)&&netStr(pc(r.dst))===key&&r.nh===gw))return{};
    if(!isNull(gw)&&!ifsIn(d,vn).some(f=>inNet(ip2i(gw),f.c)))out(`% Atenção: ${gw} não está em nenhuma rede conectada da VRF ${vn}; a rota fica inativa`);d.routes.push({dst:key,nh:gw,vrf:vn});changed();return{}};
  const mgK=d.ports.findIndex((p,j)=>isMgmt(d,j));const setMgGw=gw=>{if(mgK<0){out('% Este equipamento não tem porta de gerência dedicada');return{}}if(ip2i(gw)===null){out('% Gateway inválido');return{}}d.ports[mgK].gw=gw;changed();out(`% Gateway de gerência (${spn(d,mgK)}) definido para ${gw}`);return{}};
  if(st.mode==='vrf'){const vn=st.vrfName;
    if(isA(0,'ip',2)&&isA(1,'route',2)){const dst=a[2]&&a[2].includes('/')?a[2]:addrArg(a[2],a[3]),gw=a[2]&&a[2].includes('/')?a[3]:a[4];
      if(!vn){if(!dst||pc(dst).len!==0){out(NS);return{}}if(neg){if(mgK>=0){d.ports[mgK].gw='';changed()}return{}}return setMgGw(gw)}
      return vrfRoute(vn,dst,gw)}
    if(!vn){out('% Comando inválido no contexto de VRF de gerência. Digite ?');return{}}const v=vrfObj(d,vn);if(!v){st.mode='config';return{}}
    if(isA(0,'rd',2)||isA(0,'route-target',3)){vrfRtCmd(v,a,la,neg,out);changed();return{}}
    if(isA(0,'vni',3)){v.l3vni=neg?0:(+a[1]||0);changed();return{}}
    if(isA(0,'address-family',3)||isA(0,'exit-address-family',6)||isA(0,'description',3))return{};
    out('% Comando inválido no modo VRF. Digite ?');return{}}
  if(st.mode==='bgp'){if(!d.bgp){st.mode='config';return{}}bgpCmd(d,st,a,la,neg,isA,out,changed,NS);return{}}
  if(st.mode==='rmap'){const rm=(d.rmaps||[]).find(x=>x.name===st.rm.name);const r=rm&&rm.rules.find(x=>+x.seq===st.rm.seq);if(!r){st.mode='config';return{}}
    if(isA(0,'match',2)){if(isA(1,'ip',2)&&isA(2,'address',3)){const pi=la.indexOf('prefix-list');if(pi<0){out('% Nesta bancada o match de rede é por prefix-list: match ip address prefix-list NOME');return{}}r.mPfx=neg?'':(a[pi+1]||'');if(!neg&&!(d.pfx||[]).some(x=>x.name===r.mPfx))out(`% Atenção: a prefix-list ${r.mPfx} ainda não existe`);changed();return{}}
      if(isA(1,'community',3)){r.mComm=neg?'':(a[2]||'');if(!neg&&!(d.clists||[]).some(x=>x.name===r.mComm))out(`% Atenção: a community-list ${r.mComm} ainda não existe`);changed();return{}}out('% match suportado: ip address prefix-list NOME | community NOME');return{}}
    if(isA(0,'set',2)){if(isA(1,'local-preference',3)){r.sLp=neg?'':String(+a[2]||0);changed();return{}}if(isA(1,'metric',3)){r.sMed=neg?'':String(+a[2]||0);changed();return{}}
      if(isA(1,'community',3)){if(neg){r.sComm='';r.sAdd=false;changed();return{}}const cm=commList(a.slice(2).filter(x=>!/^additive$/i.test(x)).join(' '));if(!cm.length){out('% Uso: set community 65000:100 [additive]  (ou no-export, no-advertise)');return{}}r.sComm=cm.join(' ');r.sAdd=la.includes('additive');changed();return{}}
      if(isA(1,'as-path',3)&&isA(2,'prepend',3)){if(neg){r.sPre='';changed();return{}}const ns=a.slice(3).map(Number).filter(n=>n>0);if(!ns.length){out('% Uso: set as-path prepend 65010 65010');return{}}r.sPre=ns.join(' ');changed();return{}}
      out('% set suportado: local-preference, metric, community [additive], as-path prepend');return{}}
    if(isA(0,'description',3)||isA(0,'continue',3)){out(NS);return{}}out('% Comando inválido em route-map. Digite ?');return{}}
  if(st.mode==='evpn'){if(isA(0,'vni',3)&&a[1]){st.evVni=+a[1];return{}}
    if(isA(0,'route-target',3)&&st.evVni){const x=vxOn(d)&&d.vxlan.vnis.find(y=>+y.vni===st.evVni);if(!x){out(`% A VNI ${st.evVni} não está mapeada em nenhuma VLAN (vlan N / vn-segment ${st.evVni})`);return{}}const v=a[a.length-1];x.rt=neg||/^auto$/i.test(v)?'':v;changed();return{}}
    if(isA(0,'rd',2)||isA(0,'vlan',3)||isA(0,'evi',3)||isA(0,'auto-evi',3)||isA(0,'arp',3))return{};out('% No modo evpn: vni N l2 · rd auto · route-target import|export|both auto|<ASN:nn>');return{}}
  if(st.mode==='nve'){const vx=vxEnsure(d);const j=la[0]==='vxlan'?1:0;
    if(isA(j,'source-interface',3)){if(neg){vx.src=null;changed();return{}}const mm=(a.slice(j+1).join('')).match(/^(?:lo|loopback)(\d+)$/i);if(!mm){out('% Use: source-interface loopback1');return{}}vx.src=+mm[1];if(!(d.loops||[]).some(l=>+l.id===+mm[1]))out(`% Atenção: loopback${mm[1]} ainda não existe`);changed();return{}}
    if(j&&isA(1,'vlan',2)&&la[3]==='vni'){const v=+a[2],n=+a[4];if(!(v>=1&&v<=4094)||!(n>=1)){out('% Uso: vxlan vlan 10 vni 10010');return{}}vx.vnis=vx.vnis.filter(x=>+x.vlan!==v);if(!neg){ensureVlan(d,v,out);vx.vnis.push({vlan:v,vni:n,rt:'',peers:''})}changed();return{}}
    if(j&&isA(1,'vrf',3)&&la[3]==='vni'){const v=vrfObj(d,a[2]);if(!v){out(`% A VRF ${a[2]} não existe`);return{}}v.l3vni=neg?0:+a[4];changed();return{}}
    if(j&&isA(1,'flood',3)){const ips=a.slice(2).filter(x=>ip2i(x)!==null);vx.vnis.forEach(x=>{x.peers=neg?'':[...new Set([...String(x.peers||'').split(/\s+/).filter(Boolean),...ips])].join(' ')});changed();return{}}
    if(isA(0,'member',3)&&isA(1,'vni',3)){const n=+a[2];if(neg){vx.vnis=vx.vnis.filter(x=>+x.vni!==n);st.nveVni=null;changed();return{}}if(la.includes('associate-vrf')){if(!(d.vrfs||[]).some(v=>+v.l3vni===n))out(`% Atenção: nenhuma VRF com "vni ${n}" (vrf context X / vni ${n})`);st.nveVni=null;return{}}
      if(!vx.vnis.some(x=>+x.vni===n))out(`% Atenção: a VNI ${n} não está mapeada em nenhuma VLAN (vlan N / vn-segment ${n})`);st.nveVni=n;return{}}
    if(isA(0,'peer-ip',3)){const x=st.nveVni&&vx.vnis.find(y=>+y.vni===st.nveVni);if(!x||ip2i(a[1])===null){out('% Uso: peer-ip <A.B.C.D> (dentro de member vni N, com ingress-replication protocol static)');return{}}const L=String(x.peers||'').split(/\s+/).filter(Boolean).filter(q=>q!==a[1]);if(!neg)L.push(a[1]);x.peers=L.join(' ');changed();return{}}
    if(isA(0,'ingress-replication',3)||isA(0,'host-reachability',3)||isA(0,'shutdown',2)||j||isA(0,'suppress-arp',3)||isA(0,'mcast-group',3)||isA(0,'description',3)||isA(0,'source',3))return{};
    out('% Interface NVE: source-interface loopbackN · member vni N [associate-vrf] · ingress-replication protocol bgp|static · peer-ip X\n% Arista (Vxlan1): vxlan source-interface LoopbackN · vxlan vlan V vni N · vxlan vrf X vni N · vxlan flood vtep A B');return{}}
  const NOOPS=['banner','username','line','service','logging','ntp','snmp-server','aaa','crypto','clock','enable','spanning-tree','cdp','lldp','vpc','lacp','port-channel'];

  if(st.mode==='config'){
    if((isA(0,'vrf',3)&&(isA(1,'context',3)||isA(1,'definition',3)||isA(1,'instance',3)))||(isA(0,'vrf',3)&&a[1]&&!isA(1,'context',3))||(isA(0,'ip',2)&&isA(1,'vrf',3)&&a[2])){
      const n=(isA(0,'ip',2)||isA(1,'context',3)||isA(1,'definition',3)||isA(1,'instance',3))?a[2]:a[1];if(!n){out('% Uso: vrf definition <nome>');return{}}
      if(isMgmtVrfName(n)){if(neg)return{};st.mode='vrf';st.vrfName='';return{}}
      if(!fwd(d.type)){out('% VRFs só em switch L3, roteador e firewall');return{}}
      if(neg){if(!vrfObj(d,n)){out(`% VRF ${n} não existe`);return{}}vrfDelete(d,n);changed();out(`% VRF ${n} removida; as interfaces dela voltaram para a tabela global sem IP`);return{}}
      const nn=vrfCreate(d,n);if(!nn){out('% Nome de VRF inválido');return{}}changed();st.mode='vrf';st.vrfName=nn;return{}}
    if(isA(0,'mpls',3)){if(!fwd(d.type)){out('% MPLS só em roteador, switch L3 e firewall');return{}}if(isA(1,'ip',2)&&!la[2])out('% MPLS/LDP liga por interface nesta bancada: use "mpls ip" em cada interface do core');return{}}
    if(la[0]==='evpn'&&!a[1]){if(d.type!=='sw3'){out('% EVPN/VXLAN só em switch L3 nesta bancada');return{}}st.mode='evpn';st.evVni=null;return{}}
    if(isA(0,'nv',2)||isA(0,'fabric',3)||isA(0,'install',3)||isA(0,'feature-set',8)||(isA(0,'ip',2)&&(isA(1,'virtual-router',3)||isA(1,'bgp-community',5)))){return{}}
    if(isA(0,'ip',2)&&isA(1,'prefix-list',3)){if(!fwd(d.type)){out('% Prefix-lists só em equipamentos L3');return{}}const nm=a[2];if(!nm){out('% Uso: ip prefix-list NOME [seq N] permit|deny <rede>/<len> [ge N] [le N]');return{}}let i=3,seq=null;if(la[i]==='seq'){seq=+a[i+1];i+=2}
      if(la[i]==='description')return{};
      if(neg&&!la[i]){if(seq!=null){const pl=(d.pfx||[]).find(x=>x.name===nm);if(pl)pl.rules=pl.rules.filter(r=>+r.seq!==seq)}else d.pfx=(d.pfx||[]).filter(x=>x.name!==nm);changed();return{}}
      const act=la[i];if(act!=='permit'&&act!=='deny'){out('% Uso: ip prefix-list NOME [seq N] permit|deny <rede>/<len> [ge N] [le N]');return{}}const c=pc(a[i+1]);if(!c||!String(a[i+1]).includes('/')){out('% Informe a rede com prefixo, ex.: 10.0.0.0/8');return{}}
      let ge='',le='';for(let j=i+2;j<la.length;j+=2){if(la[j]==='ge')ge=+a[j+1]||'';if(la[j]==='le')le=+a[j+1]||''}if((ge&&ge<c.len)||(le&&le<(ge||c.len))||ge>32||le>32){out('% Faixa inválida: precisa len ≤ ge ≤ le ≤ 32');return{}}
      let pl=(d.pfx=d.pfx||[]).find(x=>x.name===nm);if(!pl){pl={name:nm,rules:[]};d.pfx.push(pl)}
      if(neg){pl.rules=pl.rules.filter(r=>!(r.pfx===netStr(c)&&r.act===act));changed();return{}}
      if(seq==null)seq=Math.max(0,...pl.rules.map(r=>+r.seq||0))+5;pl.rules=pl.rules.filter(r=>+r.seq!==seq);pl.rules.push({seq,act,pfx:netStr(c),ge,le});pl.rules.sort((x,y)=>x.seq-y.seq);changed();return{}}
    if(isA(0,'ip',2)&&isA(1,'community-list',3)){if(!fwd(d.type)){out('% Community-lists só em equipamentos L3');return{}}let i=2;if(/^(standard|expanded)$/.test(la[i]||''))i++;const nm=a[i];i++;if(!nm){out('% Uso: ip community-list standard NOME permit 65000:100');return{}}if(la[i]==='seq')i+=2;
      if(neg){d.clists=(d.clists||[]).filter(x=>x.name!==nm);changed();return{}}const act=la[i];if(act!=='permit'&&act!=='deny'){out('% Uso: ip community-list standard NOME permit|deny 65000:100');return{}}
      const cm=commList(a.slice(i+1).join(' '));if(!cm.length){out('% Communities no formato ASN:nn (ou no-export, no-advertise, internet, local-as)');return{}}
      let cl=(d.clists=d.clists||[]).find(x=>x.name===nm);if(!cl){cl={name:nm,rules:[]};d.clists.push(cl)}cl.rules.push({act,comm:cm.join(' ')});changed();return{}}
    if(isA(0,'route-map',3)){if(!fwd(d.type)){out('% Route-maps só em equipamentos L3');return{}}const nm=a[1];if(!nm){out('% Uso: route-map NOME permit|deny <seq>');return{}}const act=la[2]==='deny'?'deny':'permit';const sq=/^\d+$/.test(la[2]||'')?+la[2]:/^\d+$/.test(la[3]||'')?+la[3]:null;
      if(neg){if(sq!=null){const rm=(d.rmaps||[]).find(x=>x.name===nm);if(rm)rm.rules=rm.rules.filter(r=>+r.seq!==sq);if(rm&&!rm.rules.length)d.rmaps=d.rmaps.filter(x=>x!==rm)}else d.rmaps=(d.rmaps||[]).filter(x=>x.name!==nm);changed();return{}}
      const seq=sq??10;let rm=(d.rmaps=d.rmaps||[]).find(x=>x.name===nm);if(!rm){rm={name:nm,rules:[]};d.rmaps.push(rm)}let r=rm.rules.find(x=>+x.seq===seq);
      if(!r){r={seq,act,mPfx:'',mComm:'',sLp:'',sMed:'',sComm:'',sAdd:false,sPre:''};rm.rules.push(r);rm.rules.sort((x,y)=>x.seq-y.seq)}else r.act=act;changed();st.mode='rmap';st.rm={name:nm,seq};return{}}
    if(isA(0,'management',4)&&isA(1,'route',2)){const dst=pc(a[2]);if(!dst||dst.len!==0){out(NS);return{}}return setMgGw(a[3])}
    if(isA(0,'feature',3)){out('% Recurso aceito (nesta bancada os recursos já vêm ligados)');return{}}
    if(isA(0,'hostname',3)){if(neg){out('% O equipamento precisa de um nome');return{}}if(!a[1]){out('% Informe o nome');return{}}const nm=a[1].replace(/[^\w.-]/g,'-');if(byName(nm)&&byName(nm)!==d){out('% Já existe um equipamento com esse nome');return{}}d.name=nm;changed();return{}}
    if(isA(0,'vlan',2)){if(!isSw(d.type)){out('% VLANs só em switches');return{}}const ids=parseList((a.slice(1).join(',')));if(!ids.length||ids.some(v=>v<2||v>4094)){out('% VLAN deve estar entre 2 e 4094 (ex.: vlan 10 ou vlan 10,20,30)');return{}}
      if(neg){d.vlans=d.vlans.filter(x=>!ids.includes(+x.id));changed();return{}}ids.forEach(v=>ensureVlan(d,v,()=>{}));changed();if(ids.length===1){st.vlan=ids[0];st.mode='vlan'}return{}}
    if(isA(0,'interface',3)){
      if(isA(1,'range',2)){const r=parseRange(d,a.slice(2).join(' '));if(r.err){out(r.err);return{}}st.ifc={range:r.ks};st.mode='if';return{}}
      if(/\d\s*-\s*\d|,/.test(a.slice(1).join(' '))&&!/^(vlan|port-channel|po)/i.test(a[1]||'')){const r=parseRange(d,a.slice(1).join(' '));if(r.err){out(r.err);return{}}st.ifc={range:r.ks};st.mode='if';return{}}
      const r=parseIf(d,a.slice(1).join(''));if(r.err){out(r.err);return{}}
      if(r.loop!==undefined){if(neg){d.loops=(d.loops||[]).filter(l=>+l.id!==r.loop);changed();return{}}if(!(d.loops||[]).some(l=>+l.id===r.loop)){(d.loops=d.loops||[]).push({id:r.loop,ip:'',vrf:'',desc:''});d.loops.sort((x,y)=>x.id-y.id);changed()}st.ifc={loop:r.loop};st.mode='if';return{}}
      if(r.nve){if(neg){delete d.vxlan;changed();return{}}vxEnsure(d);changed();st.mode='nve';st.nveVni=null;return{}}
      if(r.lag){const ms=lagMembers(d,r.lag);if(neg){ms.forEach(k=>d.ports[k].lag=0);changed();return{}}if(!ms.length)out(`% ${lagShort(d,r.lag)} ainda não tem membros. Entre nas portas físicas e use "channel-group ${r.lag} mode active".`);st.ifc={lag:r.lag};st.mode='if';return{}}
      if(r.svi!==undefined){if(neg){d.svis=d.svis.filter(s=>+s.vlan!==r.svi);changed();return{}}if(!d.svis.some(s=>+s.vlan===r.svi)){d.svis.push({vlan:r.svi,ip:''});d.svis.sort((x,y)=>x.vlan-y.vlan);changed()}st.ifc={svi:r.svi};st.mode='if';return{}}
      if(r.sub!==undefined){const p=d.ports[r.k];if(neg){p.subs=p.subs.filter(s=>+s.vlan!==r.sub);changed();return{}}if(p.mode!=='routed'){out('% A porta física precisa ser roteada');return{}}if(!p.subs.some(s=>+s.vlan===r.sub)){p.subs.push({vlan:r.sub,ip:'',nat:false,vip:''});changed()}st.ifc={k:r.k,sub:r.sub};st.mode='sub';return{}}
      st.ifc={k:r.k};st.mode='if';return{}}
    if(isA(0,'ip',2)&&isA(1,'route',2)&&la[2]==='vrf'&&!isMgmtVrfName(a[3])){const r=a.slice(4);const vn=a[3];if(!vrfObj(d,vn)){out(`% A VRF ${vn} não existe. Crie com: vrf definition ${vn}`);return{}}
      const dst=r[0]&&r[0].includes('/')?r[0]:addrArg(r[0],r[1]),gw=r[0]&&r[0].includes('/')?r[1]:r[2];return vrfRoute(vn,dst,gw)}
    if(isA(0,'ip',2)&&isA(1,'route',2)&&la[2]==='vrf'){const r=a.slice(4);const dst=r[0]&&r[0].includes('/')?r[0]:addrArg(r[0],r[1]),gw=r[0]&&r[0].includes('/')?r[1]:r[2];if(!dst||pc(dst).len!==0){out('% Nesta bancada a VRF de gerência só aceita a rota padrão: ip route vrf <nome> 0.0.0.0 0.0.0.0 <gw>');return{}}if(neg){if(mgK>=0){d.ports[mgK].gw='';changed()}return{}}return setMgGw(gw)}
    if(isA(0,'ip',2)&&isA(1,'route',2)){if(!fwd(d.type)){out(d.type==='sw2'?'% Switch L2 não roteia. Use ip default-gateway para a gerência':'% Este equipamento não roteia');return{}}
      const rest=a.slice(2);if(rest.length&&/^(gi|gigabit|fa|eth|vlan)/i.test(rest[rest.length-1])&&ip2i(rest[rest.length-1])===null){out('% Informe o próximo salto em IP (ex.: ip route 0.0.0.0 0.0.0.0 203.0.113.1)');return{}}
      const cidr=rest[0]&&rest[0].includes('/');const dst=addrArg(rest[0],rest[1]);let nh=cidr?rest[1]:rest[2];if(nh&&ip2i(nh)===null&&ip2i(cidr?rest[2]:rest[3])!==null)nh=cidr?rest[2]:rest[3];
      if(!dst){out('% Uso: ip route <rede> <máscara> <próximo-salto>  (ou <rede>/<len> <próximo-salto>)');return{}}const key=netStr(pc(dst));
      if(neg){const before=d.routes.length;d.routes=d.routes.filter(r=>!(pc(r.dst)&&netStr(pc(r.dst))===key&&(!nh||r.nh===nh)));if(before===d.routes.length)out('% Rota não encontrada');else changed();return{}}
      if(isNull(nh))nh='Null0';if(ip2i(nh)===null&&!isNull(nh)){out('% Próximo salto inválido');return{}}if(d.routes.some(r=>(r.vrf||'')===''&&pc(r.dst)&&netStr(pc(r.dst))===key&&r.nh===nh))return{};
      if(!isNull(nh)&&!ifsIn(d,'').some(f=>inNet(ip2i(nh),f.c)))out(`% Atenção: ${nh} não está em nenhuma rede conectada; a rota fica inativa até existir uma interface nessa sub-rede`);
      d.routes.push({dst:key,nh});changed();return{}}
    if(isA(0,'ip',2)&&isA(1,'default-gateway',3)){if(fwd(d.type)){out('% Este equipamento roteia: use ip route 0.0.0.0 0.0.0.0 <próximo-salto>');return{}}if(!neg&&ip2i(a[2])===null){out('% Uso: ip default-gateway 10.10.10.1');return{}}d.gw=neg?'':a[2];changed();return{}}
    if(isA(0,'ip',2)&&isA(1,'routing',3)){if(d.type==='sw3'){if(neg)out('% Nesta bancada o switch L3 sempre roteia');return{}}out('% ip routing só se aplica a switch L3');return{}}
    if(isA(0,'ip',2)&&isA(1,'access-list',3)){if(!fwd(d.type)){out('% ACLs só em switch L3, roteador e firewall');return{}}const nm=a[3]||a[2];if(!nm||!isA(2,'extended',2)&&!isA(2,'standard',2)){out('% Uso: ip access-list extended <nome>');return{}}
      if(neg){d.rules=[];d.aclName='';changed();return{}}if(d.aclName&&d.aclName!==nm&&d.rules.length)out(`% A bancada usa uma ACL por equipamento: "${d.aclName}" passa a se chamar "${nm}"`);d.aclName=nm;st.mode='acl';st.lastAce=null;changed();return{}}
    if(isA(0,'access-list',3)){if(!fwd(d.type)){out('% ACLs só em switch L3, roteador e firewall');return{}}const nm=a[1];if(neg){d.rules=[];d.aclName='';changed();return{}}
      if(!/^\d+$/.test(nm||'')||!/^(permit|deny)$/i.test(a[2]||'')){out('% Uso: access-list 101 permit tcp any host 10.10.40.10 eq 443');return{}}let r=parseAce(a.slice(3));
      if(typeof r==='string'&&+nm<100){const x=a[3]==='any'?'any':(a[3]==='host'?a[4]+'/32':(ip2i(a[3])!==null?addrArg(a[3],i2ip((~ip2i(a[4]||'0.0.0.0'))>>>0)):null));if(x)r={proto:'any',src:x==='any'?'any':netStr(pc(x)),dst:'any',port:'',desc:''}}
      if(typeof r==='string'){out(r);return{}}r.act=a[2].toLowerCase();if(d.aclName&&d.aclName!==nm&&d.rules.length)out(`% A bancada usa uma ACL por equipamento: "${d.aclName}" passa a se chamar "${nm}"`);d.aclName=nm;d.rules.push(r);changed();return{}}
    if(isA(0,'ip',2)&&isA(1,'nat',2)&&la.includes('static')&&/^(tcp|udp)$/.test(la[la.indexOf('static')+1]||'')){const i=la.indexOf('static');const pr=la[i+1],ip=a[i+2],ip2=+a[i+3];let ext=null,ep=null;if(la[i+4]==='interface'){ext=a[i+5];ep=+a[i+6]}else{ext=a[i+4];ep=+a[i+5]}
      if(ip2i(ip)===null||!(ip2>0)||!(ep>0)){out('% Uso: ip nat inside source static tcp <ip-interno> <porta> interface <if-externa> <porta-externa>');return{}}if(!(d.type==='rtr'||d.type==='fw')){out('% NAT só em roteadores e firewalls');return{}}
      d.dnat=(d.dnat||[]).filter(r=>!(r.proto===pr&&+r.port===ep));if(!neg){d.dnat.push({proto:pr,port:ep,to:ip,toPort:ip2,desc:''});out(`% Encaminhamento de porta: ${pr}/${ep} → ${ip}:${ip2}`)}changed();return{}}
    if(isA(0,'ip',2)&&isA(1,'nat',2)){const li=la.indexOf('interface');if(li<0||!la.includes('overload')){out('% Uso: ip nat inside source list <acl> interface <if-externa> overload');return{}}
      const r=parseIf(d,a[li+1]);if(r.err){out(r.err);return{}}if(!(d.type==='rtr'||d.type==='fw')){out('% NAT só em roteadores e firewalls');return{}}const p=d.ports[r.k];
      if(neg){p.nat=false;changed();return{}}d.ports.forEach((q,j)=>q.nat=j===r.k);changed();out(`% NAT de saída por ${spn(d,r.k)} ativado (overload). A ACL de origem é gerada a partir das redes internas.`);return{}}
    if(isA(0,'router',2)&&isA(1,'ospf',2)){if(!fwd(d.type)){out('% OSPF só em equipamentos L3');return{}}const vi=la.indexOf('vrf');
      if(vi>0){const v=vrfObj(d,a[vi+1]);if(!v){out(`% A VRF ${a[vi+1]||''} não existe`);return{}}v.ospf={area:0,...(v.ospf||{}),on:!neg};changed();if(!neg){st.mode='ospf';st.ospfVrf=v.name}return{}}
      d.ospf={...d.ospf,on:!neg};changed();if(!neg){st.mode='ospf';st.ospfVrf=''}return{}}
    if(isA(0,'router',2)&&isA(1,'bgp',2)){if(!fwd(d.type)){out('% BGP só em switch L3, roteador e firewall');return{}}const as=+a[2];
      if(neg){if(d.bgp&&(!a[2]||+d.bgp.asn===as)){delete d.bgp;changed()}return{}}if(!(as>=1&&as<=4294967295)){out('% Uso: router bgp <ASN>');return{}}
      if(d.bgp&&+d.bgp.asn!==as){out(`% BGP já está rodando com AS ${d.bgp.asn} (use "no router bgp ${d.bgp.asn}" antes)`);return{}}
      if(!d.bgp){d.bgp={asn:as,rid:'',neighbors:[],networks:[],redist:[]};changed()}st.mode='bgp';clearBgp(st);return{}}
    if(NOOPS.some(x=>isA(0,x,3))||(isA(0,'ip',2)&&(isA(1,'domain-name',3)||isA(1,'name-server',3)||isA(1,'ssh',2)||isA(1,'http',2)))){out(NS);return{}}
    out('% Comando inválido no modo configuração. Digite ?');return{}}

  if(st.mode==='vlan'){if(isA(0,'vn-segment',3)){if(d.type!=='sw3'){out('% VXLAN só em switch L3 nesta bancada');return{}}const vx=vxEnsure(d);const n=+a[1];if(!neg&&!(n>=1&&n<=16777214)){out('% VNI entre 1 e 16777214');return{}}vx.vnis=vx.vnis.filter(x=>+x.vlan!==st.vlan&&(neg||+x.vni!==n));if(!neg)vx.vnis.push({vlan:st.vlan,vni:n,rt:'',peers:''});changed();return{}}
    if(isA(0,'name',2)){const v=d.vlans.find(x=>+x.id===st.vlan);if(v){v.name=a.slice(1).join('_')||v.name;changed()}return{}}if(isA(0,'state',3)||isA(0,'shutdown',2)){out(NS);return{}}out('% Comando inválido. Digite ?');return{}}
  if(st.mode==='ospf'){const oc=st.ospfVrf?(vrfObj(d,st.ospfVrf)||{}).ospf:d.ospf;if(!oc){st.mode='config';return{}}
    if(isA(0,'network',2)){const ai=la.indexOf('area');if(ai<0){out('% Uso: network 10.0.0.0 0.0.0.255 area 0');return{}}const ar=String(a[ai+1]||'0');const n=ar.includes('.')?(ip2i(ar)??0):+ar;oc.area=n||0;changed();
      const ip=ip2i(a[1]),wm=ip2i(a[2]);if(ip!==null&&wm!==null){const m=(~wm)>>>0;const hit=ifsIn(d,st.ospfVrf||'').filter(f=>((f.c.ip&m)>>>0)===((ip&m)>>>0));out(hit.length?`% Interfaces na área ${oc.area}: ${hit.map(f=>ifName(d,f)).join(', ')}`:'% Nenhuma interface casa com essa rede (nesta bancada todas as redes conectadas são anunciadas)')}return{}}
    if(isA(0,'router-id',3)){if(neg){oc.rid='';changed();return{}}if(ip2i(a[1])===null){out('% Uso: router-id 1.1.1.1');return{}}oc.rid=a[1];changed();return{}}
    if(isA(0,'default-information',3)){oc.dio=!neg;changed();if(!neg&&!routesIn(d,st.ospfVrf||'').some(r=>{const c=pc(r.dst);return c&&c.len===0})&&!d.bgp)out('% Atenção: este roteador não tem rota padrão; nada será anunciado até existir uma (estática ou aprendida por BGP)');return{}}
    if(isA(0,'passive-interface',3)||isA(0,'auto-cost',3)||isA(0,'log-adjacency-changes',3)){out(NS);return{}}
    out('% Comando inválido. Digite ?');return{}}
  if(st.mode==='acl'){
    let i=0,seq=null;if(/^\d+$/.test(la[0]||'')&&!neg){seq=+la[0];i=1}
    if(neg){const s=+la[0];const idx=s/10-1;if(!Number.isInteger(idx)||!d.rules[idx]){out('% Sequência não encontrada (veja show access-lists)');return{}}d.rules.splice(idx,1);changed();return{}}
    if(isA(i,'remark',3)){const txt=a.slice(i+1).join(' ');const ix=st.lastAce!=null&&d.rules[st.lastAce]?st.lastAce:d.rules.length-1;if(ix>=0)d.rules[ix].desc=txt;else out('% O comentário vale para a regra anterior; crie uma regra primeiro');changed();return{}}
    if(isA(i,'permit',2)||isA(i,'deny',2)){const r=parseAce(a.slice(i+1));if(typeof r==='string'){out(r);return{}}r.act=la[i].startsWith('p')?'permit':'deny';
      if(seq){const pos=Math.max(0,Math.min(d.rules.length,Math.ceil(seq/10)-1));d.rules.splice(pos,0,r);st.lastAce=pos}else{d.rules.push(r);st.lastAce=d.rules.length-1}changed();return{}}
    out('% Uso: [seq] permit|deny <proto> <origem> <destino> [eq <porta>]  ·  no <seq>  ·  remark <texto>');return{}}

  // modo interface (porta, faixa, subinterface ou SVI)
  const f=st.ifc||{};
  const ifVrfCmd=()=>(isA(0,'vrf',3)&&!!(la[1]))||(isA(0,'ip',2)&&isA(1,'vrf',3)&&isA(2,'forwarding',3));
  const ifVrfName=()=>{if(isA(0,'ip',2))return a[3];if(isA(1,'forwarding',3)||isA(1,'member',3))return a[2];return a[1]};
  if(f.loop!==undefined){const l=(d.loops||[]).find(x=>+x.id===f.loop);if(!l){st.mode='config';return{}}
    if(isA(0,'ip',2)&&isA(1,'address',2)){if(neg){l.ip='';changed();return{}}const v=addrArg(a[2],a[3]);if(!v){out('% Uso: ip address 10.255.0.1 255.255.255.255');return{}}l.ip=v;changed();return{}}
    if(ifVrfCmd()){const n=neg?'':ifVrfName();if(n===undefined){out('% Uso: vrf forwarding <nome>');return{}}if(setIfVrf(d,l,n,out))changed();return{}}
    if(isA(0,'description',3)){l.desc=neg?'':a.slice(1).join(' ');changed();return{}}
    if(isA(0,'shutdown',2)){out(NS);return{}}if((isA(0,'ip',2)&&(isA(1,'ospf',2)||isA(1,'router',3)||isA(1,'pim',3)))||isA(0,'mpls',3))return{};
    out('% Comando inválido em loopback. Digite ?');return{}}
  if(f.svi!==undefined){const s=d.svis.find(x=>+x.vlan===f.svi);if(!s){st.mode='config';return{}}
    if(isA(0,'ip',2)&&isA(1,'address',2)&&la[2]==='virtual'){if(neg){s.ip='';s.agw=false;changed();return{}}const v=addrArg(a[3],a[4]);if(!v){out('% Uso: ip address virtual 10.10.10.1/24');return{}}s.ip=v;s.agw=true;if(f.svi!==1)ensureVlan(d,f.svi,out);changed();return{}}
    if(isA(0,'fabric',3)){s.agw=!neg;changed();return{}}
    if(isA(0,'mpls',3)){s.mpls=!neg;changed();return{}}
    if(isA(0,'active-gateway',3)){const ip=a.find((x,i)=>i>0&&ip2i(x)!==null);if(neg){s.agw=false;changed();return{}}if(ip&&pc(s.ip)){s.ip=ip+'/'+pc(s.ip).len;s.agw=true;changed()}else out('% Configure antes o ip address da SVI');return{}}
    if(isA(0,'ip',2)&&(isA(1,'ospf',2)||isA(1,'router',3)||isA(1,'forward',3)))return{};
    if(isA(0,'ip',2)&&isA(1,'address',2)){if(neg){s.ip='';changed();return{}}const v=addrArg(a[2],a[3]);if(!v){out('% Uso: ip address 10.10.10.1 255.255.255.0');return{}}s.ip=v;if(f.svi!==1)ensureVlan(d,f.svi,out);changed();return{}}
    if(isA(0,'ip',2)&&isA(1,'access-group',3)){out('% Nesta bancada a ACL do equipamento vale para todo o tráfego roteado');return{}}
    if(ifVrfCmd()){const n=neg?'':ifVrfName();if(n===undefined){out('% Uso: vrf forwarding <nome>');return{}}if(setIfVrf(d,s,n,out))changed();return{}}
    if(isA(0,'vrrp',3)||isA(0,'standby',3)){if(neg){s.vip='';changed();return{}}const ip=a.find((x,i)=>i>0&&ip2i(x)!==null);if(!ip){if(isA(0,'vrrp',3)&&/^\d+$/.test(a[1]||'')&&a.length===2){st.ifc.vrrpWait=true;return{}}out('% Uso: vrrp 1 ip 10.100.0.1');return{}}s.vip=ip;changed();if(isA(0,'standby',3))out('% HSRP é representado como VRRP nesta bancada');return{}}
    if(st.ifc.vrrpWait&&(isA(0,'address',3)||isA(0,'virtual-address',3))&&ip2i(a[1])!==null){s.vip=a[1];changed();return{}}
    if(isA(0,'shutdown',2)||isA(0,'description',3)||isA(0,'ip',2)&&isA(1,'helper-address',3)||isA(0,'mtu',2)){out(NS);return{}}out('% Comando não suportado em interface Vlan');return{}}
  if(st.mode==='sub'){const p=d.ports[f.k],s=p.subs.find(x=>+x.vlan===f.sub);if(!s){st.mode='config';return{}}
    if(isA(0,'encapsulation',3)){const v=+a[2];if(v>=1&&v<=4094){if(p.subs.some(x=>x!==s&&+x.vlan===v)){out('% Já existe subinterface com essa VLAN');return{}}s.vlan=v;f.sub=v;changed()}else out('% Uso: encapsulation dot1Q 10');return{}}
    if(isA(0,'ip',2)&&isA(1,'address',2)){if(neg){s.ip='';changed();return{}}const v=addrArg(a[2],a[3]);if(!v){out('% Uso: ip address 10.10.10.1 255.255.255.0');return{}}s.ip=v;changed();return{}}
    if(isA(0,'ip',2)&&isA(1,'nat',2)){s.nat=!neg&&la[2]==='outside';changed();return{}}
    if(isA(0,'mpls',3)){s.mpls=!neg;changed();return{}}
    if(ifVrfCmd()){const n=neg?'':ifVrfName();if(n===undefined){out('% Uso: vrf forwarding <nome>');return{}}if(setIfVrf(d,s,n,out))changed();return{}}
    if(isA(0,'ip',2)&&isA(1,'access-group',3)){out('% Nesta bancada a ACL do equipamento vale para todo o tráfego roteado');return{}}
    if(isA(0,'vrrp',3)||isA(0,'standby',3)){if(neg){s.vip='';changed();return{}}const ip=a.find((x,i)=>i>0&&ip2i(x)!==null);if(!ip){out('% Uso: vrrp 1 ip 10.10.10.1');return{}}s.vip=ip;changed();return{}}
    if(isA(0,'description',3)||isA(0,'shutdown',2)){out(NS);return{}}out('% Comando inválido. Digite ?');return{}}
  if(ifVrfCmd()){if(f.range){out('% Configure a VRF em cada interface roteada separadamente');return{}}const k0=f.lag?lagMembers(d,f.lag)[0]:f.k;if(k0===undefined){out('% Port-channel sem membros');return{}}const p=d.ports[k0];
    if(isMgmt(d,k0)){if(isMgmtVrfName(ifVrfName()))return{};out('% A porta de gerência fica sempre na VRF de gerência');return{}}
    if(p.mode!=='routed'){out(isSw(d.type)?'% Use "no switchport" antes de colocar a porta numa VRF (ou use a interface Vlan)':'% A interface precisa ser roteada');return{}}
    const n=neg?'':ifVrfName();if(n===undefined){out('% Uso: vrf forwarding <nome>');return{}}if(setIfVrf(d,p,n,out))changed();return{}}
  const ks=f.range||(f.lag?lagMembers(d,f.lag):[f.k]);if(!ks.length){out(`% ${lagShort(d,f.lag)} sem membros; nada para configurar ainda`);return{}}let any=false;const once=new Set();const say=m=>{if(!once.has(m)){once.add(m);out(m)}};
  for(const k of ks){const r=portCmd(d,d.ports[k],k,a,la,neg,isA,say,!!f.range,f.lag?(k===ks[0]?'master':'member'):'');if(r==='changed')any=true;if(r==='stop')break}
  if(any)changed();return{}}

function portCmd(d,p,k,a,la,neg,isA,say,range,lagRole){const NS='% Aceito, mas não é simulado nesta bancada (não entra na configuração exportada).';
  const l3only=lagRole==='member'&&((isA(0,'ip',2)&&(isA(1,'address',2)||isA(1,'nat',2)))||isA(0,'vrrp',3)||isA(0,'standby',3)||isA(0,'encapsulation',3)||isA(0,'mpls',3));if(l3only)return'ok';
  if(isA(0,'channel-group',3)||(isA(0,'lag',3)&&/^\d+$/.test(la[1]||''))||(isA(0,'eth-trunk',3)&&/^\d+$/.test(la[1]||''))){if(lagRole){say('% Use channel-group nas interfaces físicas, não no port-channel');return'stop'}if(isMgmt(d,k)){say('% A porta de gerência não entra em agregação');return'stop'}
    if(neg){p.lag=0;return'changed'}const n=+a[1];if(!(n>=1&&n<=4096)){say('% Uso: channel-group 1 mode active');return'stop'}if(la[3]&&la[3]!=='active'&&la[3]!=='passive'&&la[3]!=='on'){say('% Modo: active, passive ou on');return'stop'}
    const ms=lagMembers(d,n).filter(j=>j!==k);if(ms.length){const src=d.ports[ms[0]];['mode','vlan','allowed','native'].forEach(x=>p[x]=src[x])}p.lag=n;say(`% ${spn(d,k)} entrou no ${lagShort(d,n)}${ms.length?' (configuração copiada do port-channel)':''}`);return'changed'}
  if(isA(0,'vrrp',3)||isA(0,'standby',3)){if(p.mode!=='routed'){say('% VRRP vai na interface roteada ou na interface Vlan');return'stop'}if(neg){p.vip='';return'changed'}const ip=a.find((x,i)=>i>0&&ip2i(x)!==null);if(!ip){say('% Uso: vrrp 1 ip 10.0.0.1');return'stop'}p.vip=ip;return'changed'}
  if(isA(0,'mpls',3)){if(!fwd(d.type)){say('% MPLS só em equipamentos L3');return'stop'}if(p.mode!=='routed'){say('% MPLS vai em interface roteada (ou na interface Vlan)');return'stop'}if(la[1]&&!/^(ip|ldp)/.test(la[1])){say(NS);return'ok'}p.mpls=!neg;return'changed'}
  if(isA(0,'ip',2)&&(isA(1,'ospf',2)||isA(1,'router',3)||isA(1,'pim',3)))return'ok';
  if(isA(0,'vpc',3)||isA(0,'lacp',3)){say(isA(0,'vpc',3)?'% vPC aceito: nesta bancada o par de switches funciona como um LAG distribuído':NS);return'ok'}
  if(isA(0,'description',3)){p.desc=neg?'':a.slice(1).join(' ');return'changed'}
  if(isA(0,'shutdown',2)){p.shut=!neg;return'changed'}
  if(isA(0,'spanning-tree',3)||isA(0,'speed',2)||isA(0,'duplex',2)||isA(0,'mtu',2)||isA(0,'storm-control',3)||isA(0,'cdp',2)||isA(0,'lldp',2)||(isA(0,'ip',2)&&isA(1,'helper-address',3))){say(NS);return'ok'}
  if(isA(0,'ip',2)&&isA(1,'access-group',3)){say(fwd(d.type)?'% Nesta bancada a ACL do equipamento vale para todo o tráfego roteado':'% Este equipamento não filtra tráfego roteado');return'ok'}
  if(isA(0,'switchport',2)){if(!isSw(d.type)){say('% Esta interface não é de switch');return'stop'}
    if(!la[1]){if(neg){if(d.type!=='sw3'){say('% Switch L2 não suporta portas roteadas');return'stop'}p.mode='routed';return'changed'}p.mode='access';p.subs=[];return'changed'}
    if(p.mode==='routed'&&!isA(1,'mode',2)){say('% A porta está roteada; use "switchport" antes');return'stop'}
    if(isA(1,'mode',2)){if(la[2]&&'access'.startsWith(la[2])){p.mode='access';return'changed'}if(la[2]&&'trunk'.startsWith(la[2])){p.mode='trunk';return'changed'}if(la[2]&&/^dyn/.test(la[2])){say('% DTP não é simulado; use access ou trunk');return'stop'}say('% Uso: switchport mode access|trunk');return'stop'}
    if(isA(1,'access',2)){const v=+a[3];if(!(v>=1&&v<=4094)&&!neg){say('% Uso: switchport access vlan 10');return'stop'}p.vlan=neg?1:v;if(!neg)ensureVlan(d,v,say);return'changed'}
    if(isA(1,'trunk',2)){if(isA(2,'encapsulation',3))return'ok';
      if(isA(2,'native',2)){p.native=neg?1:(+a[4]||1);return'changed'}
      if(isA(2,'allowed',2)){const rest=a.slice(4),op=(la[4]||'');
        if(op==='add'){const cur=allAllowed(p)?[]:parseList(p.allowed);p.allowed=[...new Set([...cur,...parseList(rest.slice(1).join(','))])].sort((x,y)=>x-y).join(',')}
        else if(op==='remove'||op==='except'){const rm=parseList(rest.slice(1).join(','));const base=allAllowed(p)?[1,...d.vlans.map(v=>+v.id)]:parseList(p.allowed);p.allowed=base.filter(x=>!rm.includes(x)).join(',')||'none'}
        else if(op==='none')p.allowed='none';else p.allowed=(neg||op==='all')?'':rest.join(',');return'changed'}}
    if(isA(1,'nonegotiate',3)||isA(1,'port-security',3)){say(NS);return'ok'}
    say('% Comando switchport inválido. Digite ?');return'stop'}
  if(isA(0,'ip',2)&&isA(1,'address',2)){if(range){say('% Não dá para pôr o mesmo IP em várias portas');return'stop'}if(isSw(d.type)&&p.mode!=='routed'&&!isMgmt(d,k)){say(d.type==='sw3'?'% Use "no switchport" antes de dar IP na porta':'% Switch L2: use uma interface Vlan para gerência');return'stop'}
    if(neg){p.ip='';return'changed'}const v=addrArg(a[2],a[3]);if(!v){say('% Uso: ip address 10.0.0.1 255.255.255.252');return'stop'}p.ip=v;return'changed'}
  if(isA(0,'ip',2)&&isA(1,'nat',2)){if(!(d.type==='rtr'||d.type==='fw')){say('% NAT só em roteadores e firewalls');return'stop'}const outside=!neg&&la[2]==='outside';if(outside)d.ports.forEach((q,j)=>{if(j!==k)q.nat=false});p.nat=outside;return'changed'}
  if(isA(0,'encapsulation',3)){say('% Entre numa subinterface primeiro: interface Gi0/0.10');return'stop'}
  if(isA(0,'default',3)){Object.assign(p,mkPort(d.type,isMgmt(d,k)?'mgmt':''));return'changed'}
  say('% Comando inválido no modo interface. Digite ?');return'stop'}
function banner(d){if(isHost(d.type)&&d.os)return osBanner(d);if(d.type==='cloud')return[`${d.name} — ${cloudKind(d)==='real'?'Internet real (sai do lab pelo servidor da bancada)':'Internet fake (fechada no lab)'}`,'Comandos: show ip route · show ip interface brief · ping <ip> · traceroute <ip>'];return isHost(d.type)?[`Bancada de Rede — ${modelText(d)} (${d.name})`,'Shell Linux. Digite help para ver os comandos (ip a, ip route, ip link, ping, nc, ipmitool…).']
  :[`Bancada de Rede — ${modelText(d)}`,`Console de ${d.name}. Tab completa comandos, ? mostra as opções, | include filtra a saída.`]}

const E={listenRows,clusterOf,clusterSwitch,clusterAttach,TYPES,VENDORS,VN,CAT,isSw,isHost,fwd,use,state,ip2i,i2ip,pc,inNet,netStr,cidrStr,maskLen,parseList,allAllowed,allowedHas,
  dev,byName,uid,mkDev,mkPort,addLink,linkAt,linkCount,uniqName,freePort,prefixFor,spn,pn,ifName,ifFull,mgmtName,l3ifs,getIf,l2Reach,computeOspf,lookup,simulate,lint,
  modelOf,pinfo,isMgmt,isInternal,portSpeed,osOf,unitsOf,wattsOf,lagMembers,lagMaster,lagName,lagShort,lagUp,vipMasterOf,vrid,lports,
  addChassis,addBlade,membersOf,placeMembers,bladeSlots,addRack,rackFree,rackPlace,rackPower,
  usedPort,gen,exportFiles,safeName,validate,blank,sampleCampus,samplePOP,sampleMPLS,sampleEVPN,sampleVPN,sampleK8s,guideTopo,GUIDES,routeTable,
  parseConfig,applyConfig,summarize,detectFormat,FMT_NAMES,
  MGV,vrfList,vrfObj,vrfKey,isMgmtVrfName,ifsIn,routesIn,bgpOn,bgpRid,ospfCfg,bgpState:()=>({BGP,BGPT,BSESS}),showBgpSum,showBgp,showVrf,ldpNbrs,ldpRid,vtepIp,vxOn,mplsOn,rtList,commList,rmApply,EVX:()=>EVX,loName,showVpn,showLdp,showLfib,showNve,l2vnis,showRmap,
  CLI,cs,cliReset,promptOf,cliRun,cliHelp,cliComplete,banner,osRun,osPrompt,newSt,
  OSES,OS_LIST,osInfo,isWin,osSetup,osDefaults,fsRead,fsWrite,fsAll,PKGS,SVCDEF,hostFw,cloudNew,cloudSetHost,cloudAttach,cloudKind,isPublic,vpnState,vpnStates,wgPub,wgKey,netsOf,dnsQuery,
  k8sNew,clusterNew,pkgAddDirect,webUI,webTarget,webSkinOf,WEBSKIN,httpServe,parseUrl,fsNorm,isCluster,clusterOf,k8sNodes,podsOf,nodeReady,k8sApiIp,isCP,yamlParse,k8sCmd,MIRROR_IP,MIRROR_NAMES,ipsecConfText,wgConfText};
if(typeof module!=='undefined'&&module.exports)module.exports=E;else root.Engine=E;
})(typeof window!=='undefined'?window:globalThis);
