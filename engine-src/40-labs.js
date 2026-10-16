
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
