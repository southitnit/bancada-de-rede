
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
