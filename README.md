# Bancada de Rede


A network lab that runs in your browser from a single executable. Build a topology with real switch, router, firewall, server and blade-chassis models. Configure it from the console or the inspector, test the traffic, and export the configs for each vendor's OS.

- **Vendors:** Cisco (IOS/NX-OS), Juniper, Arista, HPE Aruba, Dell, Huawei, MikroTik, Fortinet and VyOS. It can also import configs from real devices.
- **Protocols:** VLAN, LAG, VRRP, VRF, OSPF, BGP, MPLS/L3VPN, EVPN/VXLAN, ACL/NAT, IPsec and WireGuard.
- **Hosts:** simulated Ubuntu, Debian, Fedora, Rocky, RHEL, Alpine and Windows. With Docker/Podman, they become real containers.
- **Clusters:** ready-to-use Kubernetes, k3s and OpenShift.
- **Real network:** lab devices get an IP from your router's DHCP and can be reached from any PC on the network (ping, SSH, HTTP, containerized apps).
- **Web UIs:** vendor-style pages for firewalls, routers, switches and iDRAC/iLO.
- **Languages:** English and Portuguese.

## Getting started

| System | File | Lab on the real network | Reach the lab from the same PC |
|---|---|---|---|
| Windows x64 | `BancadaDeRede-windows-x64.exe` | yes (Npcap) | yes (admin) |
| Windows ARM | `BancadaDeRede-windows-arm64.exe` | yes (Npcap) | published ports only |
| Linux x64 / ARM64 | `bancada-de-rede-linux-x64` / `-linux-arm64` | yes (root) | published ports only |
| macOS Intel / Apple | `bancada-de-rede-macos-intel` / `-macos-apple` | no | published ports only |

Everything else (labs, simulation, export, SSH, published ports, web UIs) works the same on every platform. You only need Docker/Podman to run real containers on the lab servers.

**Windows:** open the `.exe`, click **Start server**, then **Open in browser** (`http://localhost:8080`). The control panel has the port, network access, an optional password, the log and an **English / Português** button. The `.exe` is not signed; if SmartScreen blocks it, choose *More info → Run anyway*.

**Linux/macOS:** `chmod +x` the file and run it. The terminal accepts `start`, `stop`, `open`, `status`, `en`/`pt` and `exit`.

Labs are saved in `bancada-dados/`, next to the executable. Each lab holds its topology (`lab.json`) and the configs generated for each OS.

## Docker / Podman

```bash
docker compose up -d --build
# or
docker run -d -p 8080:8080 -v bancada-data:/data bancada-de-rede
```

| Variable | Default | Purpose |
|---|---|---|
| `PORT` / `HOST` | `8080` / `0.0.0.0` | Server address |
| `DATA_DIR` | `/data` | Lab folder |
| `BASIC_AUTH` | — | `user:password` to require a login |
| `BANCADA_CONTAINERS` | — | `1` enables real containers on hosts |
| `BANCADA_LANG` | system | `pt` or `en` (server log) |

To expose it outside your local network, put it behind a reverse proxy with TLS and turn on the password.

## Lab on your real network

On the **Real Internet** cloud, tick **Put on my network**. Each device connected to the cloud gets its own MAC and takes an IP from your router's DHCP. Your PC's network settings are not changed.

- **Windows:** install [Npcap](https://npcap.com). To reach lab IPs from the same PC, run Bancada as administrator; it uses WinDivert, which is downloaded automatically.
- **Linux:** run as root (or with `CAP_NET_RAW`). **macOS:** not supported yet; use published ports.
- **Without joining the network:** use **Published ports**, for example `192.168.1.154:8082 → 192.168.1.201:22`.
- **Real containers:** with Docker/Podman on the PC, `docker run` on a lab server starts the real container. All ports (`-p`, ranges, UDP, `-P`) and volumes (`-v`) work.
- **SSH:** works inside the lab (`ssh user@ip`) and from outside, through the device's IP or a published port.

## Languages

In the browser, the **EN / PT** button switches the whole interface, and the URL also accepts `?lang=en`. In the `.exe`, the **English / Português** button switches the control panel and opens the browser in the same language. Translations live in `i18n/en.json` and `i18n/en-extra.json`.

## Building

Only Go 1.24+ is required. Dependencies are in `vendor/`, so it builds offline:

```bash
./build.sh   # all binaries in dist/
```

The network engine lives in `engine-src/` and the UI in `public/`; both are embedded in the binary.

## Limits

The simulation is logical: it does not run the devices' real OS and does not cover STP, IS-IS, Segment Routing, multicast or ECMP. Clusters simulate the API and services but do not run images. A lab can have up to 800 devices. Review exported configs before applying them in production.

`third_party/gvisor`: gVisor TCP/IP stack (Apache 2.0).
