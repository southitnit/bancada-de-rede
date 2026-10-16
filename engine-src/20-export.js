
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
