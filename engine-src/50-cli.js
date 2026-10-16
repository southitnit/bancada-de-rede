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
