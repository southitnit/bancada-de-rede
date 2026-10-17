# Bancada de Rede

Lab de redes que roda no navegador, a partir de um único executável. Você monta a topologia com modelos reais de switches, roteadores, firewalls, servidores e chassis blade, configura pelo console ou pelo inspetor, testa o tráfego e exporta as configs para o sistema de cada fabricante.

- **Fabricantes:** Cisco (IOS/NX-OS), Juniper, Arista, HPE Aruba, Dell, Huawei, MikroTik, Fortinet e VyOS. Também importa a config de equipamentos reais.
- **Protocolos:** VLAN, LAG, VRRP, VRF, OSPF, BGP, MPLS/L3VPN, EVPN/VXLAN, ACL/NAT, IPsec e WireGuard.
- **Hosts:** Ubuntu, Debian, Fedora, Rocky, RHEL, Alpine e Windows simulados. Com Docker/Podman, viram containers de verdade.
- **Clusters:** Kubernetes, k3s e OpenShift prontos para usar.
- **Rede real:** os equipamentos do lab pegam IP no DHCP do seu roteador e podem ser acessados de qualquer PC da rede (ping, SSH, HTTP, apps em containers).
- **Interfaces web:** telas no estilo do fabricante para firewalls, roteadores, switches e iDRAC/iLO.
- **Idiomas:** português e inglês.

## Começar

| Sistema | Arquivo |
|---|---|
| Windows x64 / ARM | `BancadaDeRede-windows-x64.exe` / `-arm64.exe` |
| Linux x64 / ARM64 | `bancada-de-rede-linux-x64` / `-linux-arm64` |
| macOS Intel / Apple | `bancada-de-rede-macos-intel` / `-macos-apple` |

**Windows:** abra o `.exe`, clique em **Iniciar servidor** e depois em **Abrir no navegador** (`http://localhost:8080`). O painel tem porta, acesso pela rede, senha opcional, log e o botão **English / Português**. O `.exe` não é assinado; no SmartScreen use *Mais informações → Executar assim mesmo*.

**Linux/macOS:** `chmod +x` e execute. O terminal aceita `iniciar`, `parar`, `abrir`, `status`, `en`/`pt` e `sair`.

Os labs ficam em `bancada-dados/`, ao lado do executável. Cada lab tem a topologia (`lab.json`) e as configs geradas para cada sistema.

## Docker / Podman

```bash
docker compose up -d --build
# ou
docker run -d -p 8080:8080 -v bancada-data:/data bancada-de-rede
```

| Variável | Padrão | Uso |
|---|---|---|
| `PORT` / `HOST` | `8080` / `0.0.0.0` | Endereço do servidor |
| `DATA_DIR` | `/data` | Pasta dos labs |
| `BASIC_AUTH` | — | `usuario:senha` para exigir login |
| `BANCADA_CONTAINERS` | — | `1` libera containers reais nos hosts |
| `BANCADA_LANG` | sistema | `pt` ou `en` (log do servidor) |

Para expor fora da rede local, use um proxy reverso com TLS e ative a senha.

## Lab na rede de verdade

Na nuvem **Internet real**, marque **Colocar na minha rede**. Cada equipamento ligado à nuvem ganha um MAC próprio e pega IP no DHCP do seu roteador, sem mudar nada na placa de rede do computador.

- **Windows:** instale o [Npcap](https://npcap.com). Para acessar os IPs do lab pelo próprio PC, abra a Bancada como administrador; ela usa o WinDivert, baixado automaticamente.
- **Linux:** rode como root (ou com `CAP_NET_RAW`).
- **Sem pôr na rede:** use **Portas publicadas**, por exemplo `192.168.1.154:8082 → 192.168.1.201:22`.
- **Containers reais:** com Docker/Podman no PC, um `docker run` num servidor do lab sobe o container de verdade. Todas as portas (`-p`, faixas, UDP, `-P`) e os volumes (`-v`) funcionam.
- **SSH:** funciona dentro do lab (`ssh usuario@ip`) e de fora, pelo IP do equipamento ou por uma porta publicada.

## Idiomas

No navegador, o botão **EN / PT** troca a interface toda, e o endereço também aceita `?lang=en`. No `.exe`, o botão **English / Português** troca o painel e abre o navegador no mesmo idioma. As traduções ficam em `i18n/en.json` e `i18n/en-extra.json`.

## Compilar

Precisa só do Go 1.24+. As dependências estão em `vendor/`, então compila sem internet:

```bash
./build.sh   # todos os binários em dist/
```

O motor de rede fica em `engine-src/` e a interface em `public/`; os dois vão embutidos no binário.

## Limites

A simulação é lógica: não roda o sistema real dos equipamentos e não cobre STP, IS-IS, Segment Routing, multicast nem ECMP. Os clusters simulam a API e os serviços, mas não executam imagens. O limite é de 800 equipamentos por lab. Revise as configs exportadas antes de aplicar em produção.

`third_party/gvisor`: pilha TCP/IP do gVisor (Apache 2.0).
