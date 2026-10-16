# Bancada de Rede

Lab de redes no navegador, pensado para montar um **POP físico de telco cloud**: modelos reais de switches, roteadores e firewalls (Cisco, Juniper, Arista, HPE Aruba, Dell, Huawei, Fortinet), servidores de rack (Dell, HPE, Lenovo, Supermicro), chassis blade (Dell MX7000, HPE Synergy, Cisco UCS) e a elevação dos racks com consumo de energia. Configure pelo console ou pelo inspetor, simule tráfego, **importe a config de equipamentos reais** e exporte para **Cisco IOS/IOS-XE, Cisco NX-OS, Juniper Junos, Arista EOS, HPE Aruba AOS-CX, Dell OS10, Huawei VRP, MikroTik RouterOS 7, Fortinet FortiOS e VyOS 1.4** — ou deixe em “Automático” para cada modelo sair no seu sistema nativo.

Os servidores e PCs rodam **sistemas operacionais simulados** (Ubuntu 24.04/22.04, Debian 12, Fedora 40, Rocky Linux 9, RHEL 9, Alpine 3.20, Windows 11 e Windows Server 2022) com pacotes, serviços, arquivos e firewall local — ou, com Docker/Podman instalado, **num container real** da imagem correspondente. Há **clusters Kubernetes e OpenShift prontos**, uma **nuvem Internet real** (o lab sai para DNS e HTTP de verdade) e uma **Internet fake** fechada no lab, com IPs públicos, DNS e sites próprios, para montar **IPsec e WireGuard** entre sites.

Tudo roda a partir de **um único executável**, sem instalar nada: a janela de controle, o servidor e a aplicação web vão dentro dele.

## Executável (Windows, Linux, macOS)

Os binários prontos ficam em `dist/`:

| Sistema | Arquivo |
|---|---|
| Windows 10/11 (x64) | `BancadaDeRede-windows-x64.exe` |
| Windows on ARM | `BancadaDeRede-windows-arm64.exe` |
| Linux x64 / ARM64 | `bancada-de-rede-linux-x64` / `bancada-de-rede-linux-arm64` |
| macOS Intel / Apple Silicon | `bancada-de-rede-macos-intel` / `bancada-de-rede-macos-apple` |

**Windows:** dê dois cliques no `.exe`. Abre a janela **Bancada de Rede — Painel de controle** (programa de desktop, nada de instalar):

- **Servidor:** status (Parado / Rodando / Parado com erro), endereço, labs salvos e pasta de dados.
- **Botões:** Iniciar servidor, Parar, Reiniciar, Abrir no navegador e Pasta de dados.
- **Configurações:** porta, permitir acesso de outros computadores da rede, pasta de dados, senha opcional (`usuario:senha`), iniciar o servidor ao abrir o programa e abrir a Bancada ao iniciar. “Salvar configurações” reinicia o servidor se ele estiver rodando.
- **Log** do servidor e botão **Sair**. Fechar a janela pergunta se pode parar o servidor e encerra o programa.

O servidor e toda a aplicação web estão dentro do `.exe`: clique em **Iniciar servidor** e depois em **Abrir no navegador** (ou acesse `http://localhost:8080`). Abrir o `.exe` de novo com ele aberto só traz a janela para a frente. Se a porta estiver ocupada, aparece um aviso e você troca a porta nas configurações.

> **Smart App Control / SmartScreen:** o `.exe` não é assinado digitalmente. Com o Smart App Control ligado (Windows 11), o Windows bloqueia sem opção de executar; desligue em *Segurança do Windows → Controle de aplicativos e navegador → Smart App Control* ou assine o executável com um certificado de assinatura de código. Com só o SmartScreen, clique em *Mais informações → Executar assim mesmo*.

**Linux/macOS:** `chmod +x bancada-de-rede-linux-x64 && ./bancada-de-rede-linux-x64`. O servidor sobe, o navegador abre e o terminal aceita os comandos `iniciar`, `parar`, `reiniciar`, `abrir`, `pasta`, `status` e `sair`. No macOS, na primeira vez, clique com o botão direito → *Abrir* (ou `xattr -d com.apple.quarantine bancada-de-rede-macos-apple`).

### Onde ficam os dados

Modo portátil, como o XAMPP: na pasta `bancada-dados/` ao lado do executável (configuração em `bancada-dados/configuracao.json`). Se não der para escrever ali (por exemplo, dentro de *Arquivos de Programas*), usa `%APPDATA%\BancadaDeRede` no Windows, `~/.config/BancadaDeRede` no Linux e `~/Library/Application Support/BancadaDeRede` no macOS.

```
bancada-dados/labs/<id>/
  lab.json          topologia completa (reimportável)
  meta.json         nome, datas, contagem de equipamentos
  configs/
    cisco/SW-CORE.txt
    junos/ … eos/ … huawei/ … routeros/ … fortios/ … vyos/
    hosts/PC-VENDAS.txt      comandos Linux e Windows
```

As configs dos 7 sistemas são geradas pela interface a cada salvamento e gravadas junto do lab.

### Opções de linha de comando

| Opção | Uso |
|---|---|
| `--port 8080` | Porta do servidor |
| `--data <pasta>` | Pasta de dados |
| `--no-browser` | Linux/macOS: não abre o navegador ao iniciar |
| `--headless` | Só o servidor, sem painel (servidores e containers). Lê `PORT`, `HOST`, `DATA_DIR` e `BASIC_AUTH` |
| `--healthcheck` | Testa se o servidor responde (código de saída 0/1) |
| `--containers` | Permite containers reais (Docker/Podman) mesmo com o servidor aberto na rede. Sem a opção, só funcionam quando o acesso é pelo próprio computador (localhost). Equivale a `BANCADA_CONTAINERS=1` |
| `--version` | Mostra a versão |

## Docker e Podman

A imagem compila o mesmo binário (dependências em `vendor/`) e roda em modo headless sobre a `distroless/static`.

```bash
docker compose up -d --build                    # ou: podman compose up -d --build
# abra http://localhost:8080
```

Sem compose:

```bash
docker build -t bancada-de-rede .
docker run -d --name bancada-de-rede -p 8080:8080 -v bancada-data:/data --restart unless-stopped bancada-de-rede

podman build --format docker -t localhost/bancada-de-rede:latest .
podman run -d --name bancada-de-rede -p 8080:8080 -v bancada-data:/data localhost/bancada-de-rede:latest
```

Quadlet (Podman + systemd): copie `deploy/bancada-de-rede.container` para `~/.config/containers/systemd/`, rode `systemctl --user daemon-reload` e `systemctl --user start bancada-de-rede`.

Pasta do host em vez de volume: a imagem roda com UID 65532. Em Docker, `sudo chown -R 65532:65532 ./data`; em Podman rootless com SELinux, `--userns=keep-id:uid=65532,gid=65532 -v ./data:/data:Z`.

Variáveis: `PORT` (8080), `HOST` (0.0.0.0), `DATA_DIR` (/data), `BASIC_AUTH` (`usuario:senha`, opcional). Para expor fora da rede local, use um proxy reverso com TLS e ative a senha.

## Usando uma pasta do host em vez de volume

A imagem roda como o usuário `node` (UID 1000). Em Podman rootless com SELinux:

```bash
mkdir -p ./data
podman run -d -p 8080:8080 --userns=keep-id:uid=1000,gid=1000 -v ./data:/data:Z localhost/bancada-de-rede:latest
```

Em Docker: `sudo chown -R 1000:1000 ./data` e `-v ./data:/data`.

## Variáveis de ambiente

| Variável | Padrão | Uso |
|---|---|---|
| `PORT` | `8080` | Porta HTTP |
| `HOST` | `0.0.0.0` | Endereço de escuta |
| `DATA_DIR` | `/data` | Onde os labs são gravados |
| `BASIC_AUTH` | vazio | `usuario:senha` para exigir login HTTP Basic |
| `MAX_BODY_MB` | `5` | Tamanho máximo de um lab enviado |
| `BANCADA_CONTAINERS` | vazio | `1` libera containers reais nos hosts (precisa de Docker ou Podman na máquina; no container oficial, monte o socket do Docker) |

Para expor fora da rede local, coloque atrás de um proxy reverso com TLS (Caddy, Traefik, nginx) e ative `BASIC_AUTH` ou a autenticação do proxy. A interface usa caminhos relativos, então funciona também num subcaminho (`/bancada/`).

## Catálogo, racks e chassis

- **Catálogo:** a gaveta da esquerda lista os modelos por categoria (data center, acesso/OOB, roteadores, firewalls, servidores de rack, chassis blade), com busca. Cada modelo tem as portas reais (nomes, velocidades e a porta de gerência), altura em U e consumo típico. Os equipamentos genéricos continuam disponíveis.
  - Switches DC: Nexus 93180YC-FX / 9364C, QFX5120-48Y / 32C, Arista 7050SX3 / 7060CX, Aruba CX 8325, Dell S5248F / Z9264F, Huawei CE6881. Acesso/OOB: Catalyst 9300 / 9200L, EX4300, Aruba 6300M, Dell N3248TE. Roteadores: MX204, ASR 1001-X, Arista 7280CR3, NE40E-M2K, VyOS. Firewalls: FortiGate 600F, SRX4100.
  - Servidores: PowerEdge R650/R750, ProLiant DL360/DL380 Gen11, ThinkSystem SR650 V3, Supermicro 1U — cada um com BMC (iDRAC, iLO, XCC, IPMI).
  - Blade: Dell MX7000 (MX750c + MX9116n), HPE Synergy 12000 (SY480 + Virtual Connect), Cisco UCS 5108 (B200 M6 + IOM 2408) e Fabric Interconnect 6454. O chassi aparece como uma moldura; arraste pelo título para mover tudo. Lâminas entram pelas baias no inspetor e já saem ligadas aos módulos de I/O pelo backplane.
- **Racks:** o botão **Racks** (tecla `R`) mostra a elevação. Arraste equipamentos da lista “Fora do rack” para uma posição de U, mova entre racks, acompanhe U ocupados e kW contra o orçamento do rack. O diagnóstico avisa quando um rack passa do orçamento.
- **LAG / LACP / bond:** número de LAG por porta (inspetor ou `channel-group N mode active`, `interface port-channel N`, `ip link set ens1f0 master bond0`). A simulação usa o primeiro membro ativo e exporta `port-channel`, `ae`, `Eth-Trunk`, `lag`, `bonding` ou netplan `bonds` conforme o sistema.
- **VRRP:** IP virtual em SVIs, portas e subinterfaces (`vrrp 10 ip X`, `standby 10 ip X` ou `vrrp 10` → `address X`). O de IP real maior é o master e responde pelo VIP.
- **VRF-lite:** VRFs com nome por equipamento (`vrf definition`, `ip vrf`, `vrf context`, `vrf instance`), interfaces, subinterfaces e SVIs em VRF (`vrf forwarding`, `vrf member`, `ip vrf forwarding`), rotas estáticas por VRF (`ip route vrf X …`), OSPF por VRF (`router ospf N vrf X`) e BGP por VRF. Cada VRF tem tabela própria e isolada; endereços podem se repetir entre VRFs. `show vrf`, `show ip route vrf X`, `ping vrf X …`, `traceroute vrf X …`.
- **BGP:** eBGP e iBGP (`router bgp`, `neighbor … remote-as`, `description`, `next-hop-self`, `default-originate`, `shutdown`, `network … mask …`, `redistribute connected|static|ospf`, `address-family ipv4 vrf X`, e o estilo NX-OS/OS10 com `neighbor X` → `remote-as`). A sessão só sobe se o vizinho existir, tiver o `neighbor` de volta, os AS baterem e houver alcance — senão `show ip bgp summary` mostra Idle/Active e o motivo. Melhor caminho por local-pref, AS-path, origem e eBGP sobre iBGP; split horizon do iBGP, prevenção de loop por AS-path, next-hop recursivo pelo IGP. Distâncias administrativas: conectada 0, estática 1, eBGP 20, OSPF 110, iBGP 200. `show ip bgp`, `show ip bgp summary`, `show ip bgp neighbors`, `show ip route bgp`, `display bgp peer`. Rotas para `Null0` servem para anunciar agregados (blackhole).
- **Loopbacks:** `interface Loopback0` (ou pelo inspetor, aba Geral). Servem de router-ID, origem de sessão iBGP (`update-source`), LSR-ID do LDP e VTEP do VXLAN; entram no OSPF como /32.
- **MPLS / LDP:** `mpls ip` na interface (ou a caixa “MPLS (LDP)” na aba Portas). O LDP sobe entre vizinhos diretos com MPLS dos dois lados e LSR-ID alcançável; cada rota do IGP ganha rótulo, com penultimate hop popping. `show mpls ldp neighbor`, `show mpls forwarding-table`, `show mpls interfaces`. Se faltar MPLS numa interface do caminho, o teste de conectividade mostra “LSP quebrado” e onde.
- **MPLS L3VPN:** VRF com RD e route-targets (`rd`, `route-target import|export|both`), iBGP VPNv4 entre PEs pelas loopbacks (`address-family vpnv4` → `neighbor X activate` + `send-community extended`), route reflector (`route-reflector-client`). As rotas da VRF (aprendidas do CE ou redistribuídas) saem com RD, RT e rótulo VPN e entram nas VRFs dos outros PEs cujo RT de importação casa. O pacote atravessa o core com dois rótulos (LDP + VPN) e o simulador mostra cada um. Sem `send-community extended`, sem `update-source` ou com RT diferente, a VPN não fecha — como no equipamento real. `show bgp vpnv4 unicast all [summary]`, `show ip route vrf X`, `show ip bgp vrf X <rede>`.
- **EVPN / VXLAN:** VLAN → VNI (`vlan 10` / `vn-segment 10010` no NX-OS, `vxlan vlan 10 vni 10010` no EOS, ou a seção VXLAN da aba VLANs), interface NVE com origem numa loopback, BGP EVPN (`address-family l2vpn evpn`). Rotas tipo 3 montam a lista de VTEPs por VNI (também dá para listar VTEPs estáticos), tipo 2 mostra os MACs/IPs dos hosts, tipo 5 leva os prefixos das VRFs com L3VNI (IRB simétrico). SVIs com anycast gateway (`fabric forwarding mode anycast-gateway`, `ip address virtual`). Quadros L2 atravessam o underlay entre leafs e o teste mostra o túnel e a VNI. `show nve peers`, `show nve vni`, `show bgp l2vpn evpn [summary]`, `show l2route evpn mac all`, `show vxlan vtep`.
- **Route-maps e communities:** `ip prefix-list NOME seq N permit|deny <rede>/<len> [ge N] [le N]`, `ip community-list standard NOME permit 65000:100`, `route-map NOME permit|deny N` → `match ip address prefix-list`, `match community`, `set local-preference`, `set metric`, `set community … [additive]` (inclusive `no-export` e `no-advertise`), `set as-path prepend`. Aplicação em `neighbor X route-map NOME in|out` e em `redistribute … route-map`. MED entra na escolha do melhor caminho; communities só viajam com `send-community`. Também pela aba Route-maps do inspetor. `show route-map`, `show ip prefix-list`, `show ip community-list`, `show ip bgp <rede>` (mostra communities).
- **Gerência fora de banda:** portas mgmt0 / Management1 / fxp0 / iDRAC / iLO ficam numa VRF separada, com gateway próprio (`vrf context management` → `ip route 0.0.0.0/0 X`, `ip route vrf management …`, `management route …`).
- **Lab pronto “Backbone MPLS L3VPN”:** PE Cisco ASR (SP) e PE Huawei NE40E (RJ), P Juniper MX204 como route reflector e P Arista 7280, OSPF + LDP no core, iBGP VPNv4 pelas loopbacks, dois clientes com a mesma rede 192.168.10.0/24 isolados em VRFs (um com eBGP PE-CE e route-map de entrada, outro com rotas estáticas).
- **Lab pronto “Fabric EVPN/VXLAN”:** dois spines Nexus como route reflectors EVPN, leafs Nexus, Arista e QFX, underlay OSPF, VNIs L2 10010/10020/10030 com anycast gateway e L3VNI 50001 na VRF TENANT-A.
- **Lab pronto “POP Telco Cloud”:** trânsito IP (AS 64500, eBGP com default) → FortiGate com NAT (AS 65010) → PE MX204 (AS 65020, eBGP com o firewall, redistribui OSPF e propaga a default no OSPF) → spines Arista → leafs Nexus em par com VRRP e peer-link, servidores Dell/HPE em bond LACP com VLANs OAM/Provider/Storage (Storage isolada na VRF STORAGE), chassi MX7000 com 4 lâminas, rede OOB com jump host e dois racks.

## Importar ou colar configuração

**Importar config** (barra de cima, ou no equipamento selecionado) aceita a configuração colada ou um arquivo de backup:

| Sistema | Formato |
|---|---|
| Cisco IOS/IOS-XE, NX-OS, Arista EOS, Dell OS10 | `show running-config` |
| HPE Aruba AOS-CX | `show running-config` |
| Juniper Junos | `show configuration \| display set` |
| Huawei VRP | `display current-configuration` |
| VyOS | `show configuration commands` |
| MikroTik RouterOS | `/export` |
| Fortinet FortiOS | `show full-configuration` |

O formato é detectado sozinho. Entram hostname, VLANs, interfaces (access/trunk/roteada), LAGs, subinterfaces, SVIs, VRRP, VRFs (vrf definition, vrf context, routing-instances, vpn-instance, vrf name…), rotas estáticas (inclusive por VRF e Null0/discard/blackhole), gateway de gerência, OSPF (inclusive por VRF), BGP (vizinhos, AS, network, redistribute, next-hop-self, default-originate, update-source, multihop, route reflector, famílias VPNv4/EVPN, route-maps, por VRF), loopbacks, MPLS/LDP por interface, route-targets e L3VNI das VRFs, VXLAN (VNIs, VTEP, peers estáticos, RT por VNI), anycast gateway, prefix-lists, community-lists, route-maps, ACLs e NAT. Os nomes de porta são convertidos para o modelo de destino (por exemplo, `Ethernet1/49` de um Nexus vira `Et49` num Arista ou `xe-0/0/48` num QFX); o relatório mostra o que foi mapeado e o que não tem porta correspondente. Dá para aplicar no equipamento selecionado ou criar um novo a partir do modelo sugerido.

No console, colar várias linhas executa cada uma delas — prático para colar um trecho de config em modo `conf t`.

## O que fica em disco

```
/data/labs/<id>/
  lab.json          topologia completa (reimportável)
  meta.json         nome, datas, contagem de equipamentos
  configs/
    auto/LEAF-01.txt         cada equipamento no sistema nativo do modelo
    cisco/LEAF-01.txt
    nxos/ … junos/ … eos/ … aoscx/ … os10/ … huawei/ … routeros/ … fortios/ … vyos/
    hosts/COMPUTE-01.txt     netplan + iproute2 + BMC (racadm / ilorest / ipmitool)
    chassis/BLADE-01.txt     composição do chassi blade
```

As configs são regeneradas a cada salvamento. Para backup, copie o volume:

```bash
docker run --rm -v bancada-data:/data -v "$PWD":/backup alpine tar czf /backup/bancada-backup.tgz -C /data .
```

## Sistemas operacionais dos hosts

Cada servidor ou PC tem um SO escolhido na aba **Geral** (padrão: Ubuntu 24.04 nos servidores e Windows 11 nos PCs; labs antigos continuam com o shell Linux genérico). A aba **Sistema** mostra pacotes, serviços (ativo/no boot), portas em escuta, firewall local, arquivos alterados e o modo container.

- **Linux** (bash): arquivos (`ls cd cat echo > >> cp mv rm mkdir find grep sed -i awk cut sort uniq head tail tee wc`, heredoc `cat <<EOF > arquivo`, `for … do … done`, `bash script.sh`), `nano`/`vi` abrem um editor; `uname`, `/etc/os-release`, `hostnamectl`, `free`, `df`, `ps`, `top`, `reboot` (só volta o que está com *enable*).
- **Pacotes:** `apt`/`apt-get` (precisa de `apt update`, como numa imagem Docker), `dnf`/`yum`, `apk`, `dpkg -l`, `rpm -qa`. Com uma nuvem no lab, o repositório precisa ser alcançável (rota, NAT e DNS) — a Internet fake tem um espelho de pacotes. Os nomes seguem cada distro (`apache2` × `httpd`, `dnsutils` × `bind-utils`) e o comando inexistente sugere o pacote.
- **Serviços:** `systemctl start|stop|restart|enable|disable|status`, `service`, `journalctl -u`, OpenRC no Alpine (`rc-service`, `rc-update`). No Debian/Ubuntu o serviço sobe ao instalar; no Fedora/Rocky/RHEL não. Serviços abrem portas de verdade no lab: nginx, apache/httpd, bind (zonas em `/etc/bind/db.*` ou `/var/named/*.zone`), haproxy (balanceia entre os `server` do `haproxy.cfg`), nginx com `proxy_pass`, MariaDB, PostgreSQL, Redis, Samba, NFS, Prometheus, Grafana, Cockpit, SSH…
- **Firewall local:** `ufw` (Ubuntu), `firewall-cmd` (Fedora/Rocky/RHEL, com a diferença entre runtime e `--permanent` + `--reload`), `iptables`; no Windows, `New-NetFirewallRule`, `Set-NetFirewallProfile`, `netsh advfirewall` — e o Windows bloqueia ping de entrada por padrão, como o real.
- **Rede pelo SO:** `netplan apply` (Ubuntu), `nmcli con mod … && nmcli con up` (Fedora/Rocky/RHEL), `/etc/network/interfaces` + `ifup -a` (Debian/Alpine), `/etc/resolv.conf`, `/etc/hosts`; `ip -br a`, `ss -tulpn`, `dig`, `nslookup`, `host`, `curl`/`wget` (mostram a página que o servidor serve de verdade), `nc -l` / `nc -zv`, `ssh host` (abre o console do outro host) e `ssh host comando`, `scp`, `iperf3 -s/-c`, `python3 -m http.server`, `docker run -d -p 8080:80 nginx` (simulado).
- **Windows (PowerShell):** `ipconfig [/all]`, `Get-NetIPAddress`, `New-NetIPAddress`, `Remove-NetIPAddress`, `Set-DnsClientServerAddress`, `netsh interface ip set address`, `route print/add`, `Get-NetRoute`/`New-NetRoute`, `ping`, `tracert`, `Test-NetConnection -Port`, `Resolve-DnsName`, `nslookup`, `Invoke-WebRequest`, `curl.exe`, `Get/Start/Stop/Set-Service`, `Install-WindowsFeature Web-Server, DNS, DHCP` (Server), `Enable-WindowsOptionalFeature` (11), `Add-WindowsCapability OpenSSH.Server`, `Add-DnsServerPrimaryZone`/`Add-DnsServerResourceRecordA`, `Rename-Computer`, `dir`, `type`, `Set-Content`, `notepad`.
- **Container real:** com Docker ou Podman na máquina, marque “Rodar em ubuntu:24.04” (ou a imagem do SO) na aba Sistema. O console passa a executar os comandos comuns dentro do container (apt com Internet real, arquivos, processos, serviços iniciados direto, sem systemd). Comandos de rede do lab — `ip`, `ping`, `curl`, `ssh`, `dig`, `systemctl`, `ufw`, VPN — continuam simulados, e as portas que o container abre passam a valer no lab (um `curl` de outro host chega no serviço real).
- **Exportação:** cada host sai como script de provisionamento `.sh` (pacotes, arquivo de rede, arquivos alterados, serviços, firewall, strongSwan/WireGuard, containers) ou `.ps1` no Windows.

## Nuvens: Internet real e Internet fake

Na categoria **Nuvens** do catálogo. Ao conectar um firewall, roteador ou host numa porta da nuvem, os dois lados recebem um /30 do pool público e o equipamento ganha rota padrão.

- **Internet real — ponte com a sua rede (padrão):** a nuvem representa o roteador da sua casa/empresa. O executável detecta a rede do computador (ex.: `192.168.1.0/24`, gateway `192.168.1.1`) e o IP público da sua conexão; quem liga na nuvem recebe um IP livre dessa rede (a partir do .200), com gateway e DNS = seu roteador, e o tráfego para a Internet sai com NAT do roteador e o seu IP público real. Os IPs do lab não ocupam endereços de verdade na LAN. No modo “IP público direto”, os enlaces usam um pool público próprio.
- **Internet real:** o que não pertence ao lab sai pelo servidor da bancada — DNS real e HTTP/HTTPS real em `curl`, `wget`, `Invoke-WebRequest`, `dig`, `ping` por nome. Origem privada é descartada: é preciso NAT na borda, como na vida real. A bancada só acessa endereços públicos.
- **Internet fake:** fechada no lab. Tem 8.8.8.8 e 1.1.1.1 respondendo DNS, `www.exemplo.com`, um espelho de pacotes/registry e uma tabela de DNS editável — dá para publicar `vpn.empresa.com` apontando para o IP público do seu firewall.

## SSH e acesso de fora

- **Dentro do lab:** `ssh usuario@ip` (Linux/Windows com OpenSSH) ou `ssh -l usuario ip` (switches, roteadores e firewalls) abre a sessão no mesmo console, como no real: o prompt muda para o host remoto, dá para encadear (`ssh` de dentro do `ssh`) e `exit` volta. O destino precisa ter o sshd ativo, a porta 22 liberada no firewall local e caminho pela rede. `ssh host comando` e `scp` também funcionam.
- **Encaminhamento de portas (NAT de destino):** na aba Políticas/ACL de firewalls e roteadores, ou no console (`ip nat inside source static tcp 10.10.0.10 22 interface Gi0/0 2222`). Sai na configuração de cada sistema (Cisco, FortiOS VIP, Junos destination NAT, Huawei nat server, VyOS e RouterOS dst-nat) e é importado de volta.
- **De fora para dentro:** na nuvem Internet real, em **Acesso de fora (SSH no lab)**, publique uma porta deste computador apontando para um IP:porta do lab (normalmente a WAN do seu firewall do lab, que faz o port forward para o servidor). O executável abre um servidor SSH de verdade nessa porta: `ssh -p 2222 root@localhost` (senha definida no painel) entra pelo caminho simulado — nuvem → NAT de destino → políticas → host — e cai no shell do servidor/PC. Funciona com OpenSSH, PuTTY, Termius… A bancada precisa estar aberta no navegador (é ela que executa a sessão). Por padrão escuta só neste computador; com “Acesso pela rede” ligado no painel, outras máquinas (e a Internet, se você encaminhar a porta no seu roteador) também conectam.

### Equipamentos do lab na sua rede de verdade

Na nuvem Internet real (modo ponte), marque **Colocar na minha rede**. Cada equipamento ligado à nuvem aparece na sua LAN como um aparelho a mais, com MAC próprio, e **pega IP automático no DHCP do seu roteador** (aparece na lista de aparelhos do roteador com o nome do equipamento). O IP recebido passa a ser o IP da interface no lab. Qualquer aparelho da casa faz `ping`, `ssh` e abre `http/https` nesse IP; a conexão entra no lab pela nuvem e passa pelo NAT e pelas políticas simuladas.

- **A configuração de rede do computador não é alterada** — nada de IP fixo, `netsh` ou IP extra na placa. A bancada fala direto com a placa (Npcap no Windows, AF_PACKET no Linux) e tem uma pilha TCP/IP própria para esses IPs (gVisor netstack). Ao fechar, os IPs são devolvidos ao roteador (DHCP release).
- **Windows:** instale o [Npcap](https://npcap.com) (o mesmo driver do Wireshark). Não precisa abrir como administrador, a não ser que o Npcap tenha sido instalado “só para administradores”. **Linux:** rode como root (ou com CAP_NET_RAW). macOS: ainda não; use as portas publicadas.
- **Endereço:** *Automático (DHCP)* ou *IP do lab (fixo)* — no fixo a bancada confere com ARP se o IP está livre antes de usá-lo.
- **MAC:** por padrão cada equipamento tem um MAC próprio (02:bd:…, fixo por equipamento, então o roteador devolve sempre o mesmo IP). Se a sua Wi-Fi bloquear MACs diferentes do computador, escolha “O MAC do computador”: os equipamentos se diferenciam no DHCP pelo client-id; se o roteador entregar o mesmo IP do PC, a bancada avisa — use o IP do lab (fixo).
- Erro do Npcap? A mensagem lista as placas que o Npcap enxerga. Se ele foi instalado “só para administradores”, abra a bancada como administrador.
- **Do próprio computador (Windows x64):** quadros injetados na placa não voltam ao Windows, então a bancada usa o [WinDivert](https://github.com/basil00/WinDivert) (driver assinado, baixado do GitHub na primeira vez e conferido por sha256) para desviar o que o PC manda para os IPs do lab direto para a pilha do equipamento e devolver as respostas ao Windows. Precisa abrir a bancada como administrador. Só os IPs do lab são desviados; ao fechar a bancada o desvio some. Linux/macOS: do próprio computador use as portas publicadas.

Sem colocar na rede, use **Portas publicadas neste computador**: `192.168.1.154:8082 → 192.168.1.201:22` faz um NAT do IP do computador para dentro do lab (SSH, HTTP ou HTTPS detectados sozinhos).

### Containers de verdade dentro dos servidores do lab

Com o Docker (ou Podman) instalado e rodando neste computador, um `docker run` feito num servidor do lab sobe **o container de verdade** no Docker do PC (nome `bancada-app<id>-<nome>`, porta só em 127.0.0.1). A porta publicada no servidor (`-p 3000:3000`) passa a ser a aplicação real:

- `curl localhost:3000` dentro do servidor, ou de outro equipamento do lab;
- de fora, pelo IP que o servidor pegou na sua rede (`http://192.168.1.x:3000`) ou por uma porta publicada no computador (`192.168.1.154:8082 → IP-do-servidor:3000`, inclusive através do NAT de um firewall do lab);
- o tráfego de fora vai direto (TCP) ao container: páginas grandes, websockets, qualquer protocolo.

**Todas as portas:** o equipamento na sua rede atende qualquer porta em que esteja escutando no lab, sem lista fixa — serviços do sistema, cada `-p` do Docker (inclusive faixas como `-p 9000-9010:9000-9010` e UDP como `-p 5000:5000/udp`), `nc -l`, etc. Portas fechadas recusam na hora (RST), como num servidor de verdade. Com `docker run -P` (ou `--network host`) a bancada publica todas as portas que a imagem declara (EXPOSE), com o mesmo número no servidor do lab.

**Volumes:** `-v caminho:/destino` vira um volume nomeado `bancada-<id>-<nome>` no Docker/Podman do computador (o caminho do servidor do lab não existe no PC); os dados ficam guardados entre recriações. O dono do volume é ajustado para o usuário da imagem (Podman `:U`; Docker com um `chown` antes de subir), então imagens que rodam sem root (ex.: Metabase com `MB_DB_FILE=/metabase-data/metabase.db`) conseguem gravar. `--user`, `-w` e `--entrypoint` também são repassados.

`docker stop/start/rm` no servidor fazem o mesmo no container real. Um container criado antes desta versão continua simulado: rode `docker restart <nome>` (ou recrie) para subir o real. Sem Docker no computador, o container continua simulado (responde, mas não roda a aplicação).

## Interfaces web dos equipamentos

Firewalls, roteadores, switches e os BMCs dos servidores têm interface web com o leiaute e a terminologia de cada sistema: FortiOS (FortiGate), J-Web (Junos), WebUI do IOS-XE, NX-OS Device Manager, Arista, Aruba CX, Huawei, WebFig (RouterOS) e, nos servidores, iDRAC9, iLO 6, XClarity (XCC), CIMC e BMC Supermicro (sem logotipos dos fabricantes). VyOS e Dell OS10 não têm GUI, como os reais.

- Login com as credenciais padrão de laboratório (mostradas na tela: admin/admin, root/calvin no iDRAC, Administrator/password no iLO, USERID/PASSW0RD no XCC…).
- Funcionam de verdade sobre o lab: interfaces (IP, descrição, shutdown, modo/VLAN), VLANs, rotas estáticas e tabela de rotas, políticas/ACL (com contadores), Virtual IPs / NAT de destino, status das VPNs, hostname, troca de senha, backup da configuração e uma CLI na própria página. No BMC: painel, inventário, liga/desliga/reinicia o servidor (desligado, ele some da rede), rede do BMC, log de eventos e console virtual.
- Três jeitos de abrir: o botão **Web**/**iDRAC**/**iLO** no inspetor (janela dentro do app), `curl -k https://<ip>` de dentro do lab, ou de fora pelo IP que o equipamento pegou na sua rede ou por uma porta publicada.

## VPN: IPsec e WireGuard

Aba **VPN** nos firewalls, roteadores e hosts. IPsec com IKEv1/IKEv2, PSK, cifra, hash, grupo DH e redes protegidas; WireGuard com chaves (gera e mostra a pública), endereço do túnel e AllowedIPs. O botão **↔ outro lado** cria o túnel espelhado no equipamento do peer. O túnel só sobe se o IKE/handshake alcançar o peer e se PSK, versão do IKE, proposta e redes baterem — senão o status mostra o motivo (`AUTHENTICATION_FAILED`, `NO_PROPOSAL_CHOSEN`, `TS_UNACCEPTABLE`, chave pública errada, peer sem rota…). O tráfego entre as redes vai cifrado (aparece `| ESP` / `| WireGuard` no caminho) e o NAT não se aplica a ele.

- **Console:** `show crypto ikev2 sa`, `show crypto ipsec sa`, `show security ike security-associations` (Junos), `get vpn ipsec tunnel summary` / `diagnose vpn tunnel list` (FortiOS), `display ike sa` (Huawei), `show vpn ipsec sa` (VyOS); nos hosts `ipsec up|status|statusall` (strongSwan com `/etc/ipsec.conf` e `/etc/ipsec.secrets`), `wg genkey | wg pubkey`, `wg-quick up wg0`, `wg show`.
- **Exportação e importação:** Cisco IOS-XE (IKEv1 ou IKEv2 + crypto map), Junos (st0 + traffic selectors), FortiOS (phase1/phase2-interface), Huawei (ike peer + ipsec policy), RouterOS (`/ip ipsec`, `/interface wireguard`) e VyOS (site-to-site e `interfaces wireguard`). WireGuard só existe em VyOS, RouterOS e nos hosts; NX-OS, EOS, OS10 e AOS-CX recebem um aviso.

## Kubernetes e OpenShift

Na categoria **Kubernetes / OpenShift**: cluster kubeadm v1.30 (1 control-plane + 3 workers Ubuntu 22.04), k3s de nó único e OpenShift 4.16 (3 masters + 2 workers RHCOS, VIPs de API e Ingress). O cluster vem com o switch interno; ligue a porta `uplink1` a um roteador com o gateway da rede dos nós (o painel mostra qual).

- `kubectl`/`oc` no console de qualquer nó: `get nodes|pods|svc|deploy|ns|ingress|routes [-o wide] [-A]`, `create deployment … --image`, `apply -f arquivo.yaml` (ou `cat <<EOF | kubectl apply -f -`), `expose`, `scale`, `delete`, `describe`, `logs`, `run`, `top nodes`, `oc new-project`, `oc new-app --image`, `oc expose svc/x`, `oc status`.
- Nó só fica **Ready** se o kubelet alcança a API (porta 6443). Pods são distribuídos nos workers prontos; NodePort responde em todos os nós; LoadBalancer recebe IP do pool (papel do MetalLB); Ingress/Routes respondem pelo VIP com o host certo — `curl` mostra qual pod atendeu.
- A aba **Workloads** cria deployments, services e ingress/routes sem digitar; o **Resumo** exporta `install-config.yaml` (OpenShift) ou `kubeadm-config.yaml` + MetalLB, mais os manifestos.

### Acessar os serviços do cluster

- **De dentro dos nós:** `curl http://<ClusterIP>` e `curl http://<svc>.<ns>.svc.cluster.local` funcionam no próprio nó (kube-proxy/OVN e CoreDNS simulados localmente — não precisam de roteador). `*.apps.<domínio>` e `api.<domínio>` também resolvem dentro do cluster.
- **Um PC/servidor na rede do cluster:** use Conectar (C) do PC para qualquer nó do cluster (ou para o switch do cluster): ele é ligado num uplink livre do switch, recebe um IP da rede dos nós (a partir do .100) e o DNS do cluster (o primeiro control-plane responde DNS para `api.` e `*.apps.`). Daí: `curl http://webapp-test.apps.ocp.lab` (Route/Ingress), `curl http://<IP-do-nó>:<NodePort>`, ou o IP do LoadBalancer.
- Kubernetes e k3s também atendem Ingress (porta 80/443) nos workers (no k3s de nó único, no próprio nó).
- `oc debug node/<nó>` / `kubectl debug node/<nó>` abre um shell no nó.


## Usando

- **Console:** clique num equipamento para abrir o console dele (o botão “Console ao clicar” desliga isso; duplo clique sempre abre). Várias janelas ao mesmo tempo, arrastáveis e redimensionáveis; duplo clique no título maximiza.
  - `Tab` completa, `?` mostra as opções na hora, `↑/↓` histórico, `Ctrl+L` limpa, `Ctrl+C` cancela a linha, `Ctrl+Z` volta ao exec.
  - Qualquer `show` aceita filtro: `| include`, `| exclude`, `| begin`, `| section`, `| count`.
  - **Exec (switches, roteadores, firewalls):** `show running-config [interface X]`, `show vlan brief`, `show ip interface brief`, `show interfaces [X | status | trunk]`, `show ip route [static | connected | ospf | <ip>]`, `show ip ospf [neighbor | interface]`, `show ip arp`, `show mac address-table`, `show cdp/lldp neighbors`, `show access-lists` (com contadores), `show ip nat translations`, `show version | clock | history`, `ping <ip> [tcp|udp <porta>]`, `traceroute <ip>`, `write memory` (salva o lab). Também aceita `display ip routing-table`, `display vlan`, `display current-configuration` (estilo Huawei).
  - **Configuração:** `hostname`, `vlan 10` / `vlan 10,20,30` / `name`, `interface Gi1/0/1 | Gi0/0.10 | vlan 10`, `interface range Gi1/0/1 - 8`, `switchport mode/access/trunk allowed [add|remove]/native`, `no switchport`, `ip address`, `encapsulation dot1Q`, `shutdown`, `default interface`, `ip route <rede> <máscara> <nh>` / `no ip route …`, `ip default-gateway`, `router ospf 1` → `network … area N`, `router-id`, `default-information originate`, `ip access-list extended NOME` → `[seq] permit|deny <proto> <origem> <destino> [eq <porta>]`, `no <seq>`, `remark`, `access-list 101 …`, `ip nat inside|outside`, `ip nat inside source list … interface … overload`.
  - **POP / data center:** `show port-channel summary` (`show etherchannel summary`), `show lacp neighbor`, `show vrrp [brief]`, `show inventory`, `show environment power`, `show ip route vrf management`; `interface port-channel N`, `interface ethernet1/1-4` (faixa estilo NX-OS/EOS), `channel-group N mode active`, `vrrp N ip X`, `standby N ip X`, `vrf context management`, `management route …`, `feature …`.
  - **PCs e servidores (shell Linux):** `ip a` (todas as NICs, bonds e VLANs), `ip addr add|del|flush … dev <if>`, `ip link add link bond0 name bond0.100 type vlan id 100`, `ip link set ens1f0 master bond0 | nomaster | up | down`, `ip link del`, `ip route [add|del]`, `ip neigh`, `ifconfig`, `route -n`, `arp -n`, `ipmitool lan print`, `ipmitool lan set 1 ipaddr|netmask|defgw ipaddr …` (BMC), `ping [-c N]`, `traceroute`, `nc -zv [-u] <ip> <porta>`, `curl http://<ip>[:porta]`, `hostname`, `ipconfig`.
- **Teste de conectividade:** mostra salto a salto, ARP, regra de firewall, NAT e a volta. Quando falha, diz o motivo.
- **Diagnóstico:** IP duplicado, VLAN divergente, VLAN não criada, gateway fora da sub-rede, rota com próximo salto inalcançável, membros de LAG divergentes, LACP de um lado só, velocidades incompatíveis no cabo, gateway de gerência fora da sub-rede, rack acima do orçamento de energia, sessão BGP fora do ar (com o motivo), vizinho VPNv4/EVPN sem send-community, route-map, prefix-list ou community-list inexistente, LDP sem vizinho ou sem rota para o LSR-ID, VXLAN sem VTEP ou VNI sem VTEP remoto.
- **Labs:** abrir, duplicar, baixar `.json`, excluir; começar do POP Telco Cloud, do backbone MPLS L3VPN, do fabric EVPN/VXLAN, dos sites com IPsec/WireGuard pela Internet fake, do lab Kubernetes + OpenShift, de um lab vazio, do campus de exemplo ou do guia de VLANs.
- **Exportar .zip:** configs de todos os equipamentos no sistema escolhido (ou no nativo de cada modelo, em “Automático”), mais `topologia.json`, `inventario.csv` (fabricante, modelo, rack, U, consumo) e um mapa de portas.

Atalhos: `C` conectar, `V` mover, `F` enquadrar, `R` racks, `Del` remove, `Ctrl+S` salva, `Ctrl+Z`/`Ctrl+Shift+Z` desfaz/refaz.

## API

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/health` | Estado do servidor (sem senha, para healthcheck) |
| GET | `/api/labs` | Lista os labs |
| POST | `/api/labs` | Cria `{name, topology, configs}` |
| GET | `/api/labs/:id` | `{meta, topology}` |
| PUT | `/api/labs/:id` | Atualiza `{name, topology, configs}` |
| DELETE | `/api/labs/:id` | Remove o lab |
| GET | `/api/labs/:id/export.zip?vendor=cisco` | Zip das configs gravadas do lab |
| GET | `/api/labs/:id/configs[/<vendor>/<arquivo>.txt]` | Lista ou lê uma config gravada |
| POST | `/api/export?vendor=junos` | Zip a partir de `{topology, files:[{name,text}]}` sem salvar |
| GET | `/api/net/status` | Internet real e containers disponíveis |
| GET | `/api/net/resolve?name=` | DNS real (nuvem Internet real) |
| POST | `/api/net/fetch` | HTTP/HTTPS real `{url, head}` — só endereços públicos, corpo até 64 KB |
| POST | `/api/ct/start` `exec` `http` `stop`, GET `/api/ct/status` `list` | Containers reais dos hosts |
| GET | `/api/net/publicip` | IP público desta conexão |
| GET/POST | `/api/bridge/poll` `out` `config` | Ponte entre as portas SSH publicadas e a bancada aberta no navegador |

As rotas `/api/net/*`, `/api/ct/*` e `/api/bridge/*` exigem o cabeçalho `X-Bancada: 1`.

`configs` é um objeto `{"cisco/SW-CORE.txt": "...", "hosts/WEB-01.sh": "...", "hosts/PC-01.ps1": "...", "nuvens/INTERNET.txt": "..."}`. Valores de `vendor`: `auto`, `cisco`, `nxos`, `junos`, `eos`, `aoscx`, `os10`, `huawei`, `routeros`, `fortios`, `vyos`.

## Compilar

Precisa só do Go 1.24+; as dependências já estão em `vendor/`, então compila sem internet:

```bash
./build.sh            # gera todos os binários em dist/
go build -o bancada . # só para o sistema atual
```

O ícone e o manifesto do `.exe` vêm de `rsrc_windows_*.syso` (gerados a partir de `assets/` com a ferramenta `rsrc`). Para regerar o ícone: `go run tools/genicon.go`.

Estrutura: `main.go` (executável e modos), `manager.go` (iniciar/parar/configurações/log), `ui_windows.go` (janela nativa Win32), `ui_term.go` (controle pelo terminal no Linux/macOS), `appserver.go` + `store.go` (API e gravação), `public/` (interface, catálogo e motor de rede em JavaScript, embutidos no binário). O motor é editado em `engine-src/` e juntado em `public/engine.js` com `tools/bundle-engine.sh`.

## Limites

A simulação é lógica: VLANs, trunks 802.1Q, SVIs, subinterfaces, LAG/LACP, VRRP, VRF, VRF de gerência, rotas estáticas, OSPF (com rota padrão), BGP (eBGP/iBGP, route reflector, route-maps, communities), MPLS/LDP, L3VPN (VPNv4), EVPN/VXLAN, ACL/políticas com firewall stateful, NAT de origem, IPsec/WireGuard e os SOs dos hosts. Não roda o sistema operacional real dos equipamentos de rede e não simula STP, DHCP, IS-IS, RSVP-TE/Segment Routing, Inter-AS (options A/B/C), multicast, ECMP (escolhe um caminho), timers de convergência nem vPC/MLAG de verdade (o peer-link é tratado como um LAG comum). Alguns sistemas não implementam tudo: Dell OS10 e Aruba AOS-CX não têm MPLS/L3VPN (a exportação avisa em comentário); FortiOS e RouterOS fazem VXLAN só com VTEPs estáticos (a lista sai pronta a partir do EVPN do lab); FortiOS não participa de LDP. Números de portas, U e consumo dos modelos são aproximados, para planejamento de laboratório. Nos hosts, o SO é uma simulação de alto nível (sem processos reais, a não ser no modo container); Kubernetes/OpenShift simulam a API, o agendamento e a publicação de serviços, não executam imagens. Até 800 equipamentos por lab. Revise as configs exportadas antes de aplicar em produção.

## Terceiros

`third_party/gvisor`: pilha TCP/IP do gVisor (Apache 2.0), só os pacotes de `pkg/tcpip` usados pela bancada.
