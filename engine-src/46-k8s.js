
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
