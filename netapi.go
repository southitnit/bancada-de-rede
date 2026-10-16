// Internet real e containers reais para a Bancada de Rede.
//
//	/api/net/status   — o que está disponível (Internet, Docker/Podman)
//	/api/net/resolve  — DNS real (usado pela nuvem "Internet real")
//	/api/net/fetch    — requisição HTTP/HTTPS real (só para endereços públicos)
//	/api/ct/*         — containers reais por host (Docker ou Podman)
//
// Todas as rotas exigem o cabeçalho X-Bancada: 1 (bloqueia chamadas de outras origens).
package main

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

// containersFlag: -containers na linha de comando ou BANCADA_CONTAINERS=1.
var containersFlag = os.Getenv("BANCADA_CONTAINERS") == "1"

var (
	ctNameRe  = regexp.MustCompile(`^bancada-[a-z0-9-]{1,40}-[a-z0-9-]{1,40}$`)
	ctHostRe  = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9.-]{0,62}$`)
	ctImages  = map[string]bool{"ubuntu:24.04": true, "ubuntu:22.04": true, "debian:12": true, "fedora:40": true, "rockylinux:9": true, "redhat/ubi9": true, "alpine:3.20": true}
	engineMu  sync.Mutex
	engineBin string
	engineOK  bool
)

var (
	engineAt  time.Time
	engineWhy string
)

// Docker/Podman deste computador. Sucesso fica guardado; falha é testada de novo a cada 10 s
// (o Docker Desktop pode ser aberto depois da bancada).
func ctEngine() string {
	engineMu.Lock()
	defer engineMu.Unlock()
	if engineOK && engineBin != "" {
		return engineBin
	}
	if engineOK && time.Since(engineAt) < 10*time.Second {
		return ""
	}
	engineBin, engineWhy = "", "Docker não encontrado neste computador — instale o Docker Desktop (docker.com)"
	cands := []string{"docker", "podman"}
	if isWindows() {
		cands = append(cands, `C:\Program Files\Docker\Docker\resources\bin\docker.exe`, `C:\Program Files\RedHat\Podman\podman.exe`)
	}
	for _, b := range cands {
		p, err := exec.LookPath(b)
		if err != nil {
			continue
		}
		ctx, cancel := context.WithTimeout(context.Background(), 6*time.Second)
		vc := exec.CommandContext(ctx, p, "version", "--format", "{{.Server.Version}}")
		hideWindow(vc)
		out, err := vc.CombinedOutput()
		cancel()
		if err == nil {
			engineBin = p
			break
		}
		if strings.Contains(strings.ToLower(filepath.Base(p)), "docker") {
			engineWhy = "o Docker está instalado mas não está rodando — abra o Docker Desktop e espere ele ficar pronto"
			if l := strings.TrimSpace(firstLine(string(out))); l != "" {
				engineWhy += " (" + l + ")"
			}
		}
	}
	engineOK, engineAt = true, time.Now()
	return engineBin
}

func engineProblem() string {
	engineMu.Lock()
	defer engineMu.Unlock()
	if engineBin != "" {
		return ""
	}
	return engineWhy
}

func firstLine(s string) string {
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		return s[:i]
	}
	return s
}

func (a *App) ctAllowed(r *http.Request) bool {
	if containersFlag {
		return true
	}
	// sem a opção explícita, só quando o servidor atende apenas esta máquina
	h, _, err := net.SplitHostPort(r.Host)
	if err != nil {
		h = r.Host
	}
	ra, _, _ := net.SplitHostPort(r.RemoteAddr)
	ip := net.ParseIP(ra)
	return (h == "localhost" || h == "127.0.0.1" || h == "[::1]" || h == "::1") && ip != nil && ip.IsLoopback()
}

func runEngine(ctx context.Context, stdin []byte, args ...string) (string, string, error) {
	bin := ctEngine()
	if bin == "" {
		return "", "", errors.New("Docker/Podman não encontrado nesta máquina")
	}
	cmd := exec.CommandContext(ctx, bin, args...)
	hideWindow(cmd)
	var o, e bytes.Buffer
	cmd.Stdout, cmd.Stderr = &limitW{b: &o, n: 256 << 10}, &limitW{b: &e, n: 64 << 10}
	if stdin != nil {
		cmd.Stdin = bytes.NewReader(stdin)
	}
	err := cmd.Run()
	return o.String(), e.String(), err
}

type limitW struct {
	b *bytes.Buffer
	n int
}

func (l *limitW) Write(p []byte) (int, error) {
	if room := l.n - l.b.Len(); room > 0 {
		if len(p) > room {
			l.b.Write(p[:room])
		} else {
			l.b.Write(p)
		}
	}
	return len(p), nil
}

type ctPort struct {
	Proto string `json:"proto"`
	Port  int    `json:"port"`
}

// portas em escuta dentro do container (lê /proc/net, não depende de ss/netstat)
func ctPorts(ctx context.Context, name string) []ctPort {
	out, _, err := runEngine(ctx, nil, "exec", name, "sh", "-c", "for f in /proc/net/tcp /proc/net/tcp6 /proc/net/udp /proc/net/udp6; do [ -r $f ] && sed \"s|^|$f |\" $f; done")
	if err != nil {
		return nil
	}
	seen := map[string]bool{}
	ports := []ctPort{}
	for _, l := range strings.Split(out, "\n") {
		f := strings.Fields(l)
		if len(f) < 5 || !strings.HasPrefix(f[0], "/proc/net/") {
			continue
		}
		proto := "tcp"
		if strings.Contains(f[0], "udp") {
			proto = "udp"
		}
		st := f[4]
		if (proto == "tcp" && st != "0A") || (proto == "udp" && st != "07") {
			continue
		}
		la := f[2]
		i := strings.LastIndex(la, ":")
		if i < 0 {
			continue
		}
		p, err := strconv.ParseUint(la[i+1:], 16, 16)
		if err != nil || p == 0 {
			continue
		}
		k := fmt.Sprintf("%s/%d", proto, p)
		if !seen[k] {
			seen[k] = true
			ports = append(ports, ctPort{proto, int(p)})
		}
	}
	return ports
}

func isPublicIP(ip net.IP) bool {
	return ip != nil && !(ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsUnspecified() || ip.IsMulticast() || ip.To4() != nil && ip.To4()[0] == 100 && ip.To4()[1]&0xc0 == 64)
}

func (a *App) netAPI(w http.ResponseWriter, r *http.Request, parts []string) {
	if r.Header.Get("X-Bancada") != "1" {
		writeErr(w, 403, "cabeçalho X-Bancada ausente")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 70*time.Second)
	defer cancel()
	sub := ""
	if len(parts) > 1 {
		sub = parts[1]
	}
	if parts[0] == "bridge" {
		a.bridgeAPI(w, r, sub)
		return
	}
	if parts[0] == "net" {
		switch sub {
		case "status":
			eng := ""
			if a.ctAllowed(r) {
				eng = ctEngine()
				if i := strings.LastIndexAny(eng, `/\`); i >= 0 {
					eng = eng[i+1:]
				}
			}
			writeJSON(w, 200, map[string]any{"internet": true, "containers": eng != "", "engine": strings.TrimSuffix(eng, ".exe"), "engineWhy": engineProblem(), "allowed": a.ctAllowed(r), "host": hostNetwork(), "ifaces": hostIfaces()})
		case "publicip":
			writeJSON(w, 200, map[string]any{"ip": publicIP(ctx)})
		case "resolve":
			name := strings.TrimSuffix(strings.TrimSpace(r.URL.Query().Get("name")), ".")
			if name == "" || len(name) > 253 {
				writeErr(w, 400, "nome inválido")
				return
			}
			c2, cc := context.WithTimeout(ctx, 6*time.Second)
			defer cc()
			addrs, err := net.DefaultResolver.LookupIPAddr(c2, name)
			if err != nil {
				writeJSON(w, 200, map[string]any{"err": "NXDOMAIN ou sem resposta"})
				return
			}
			ips := []string{}
			for _, x := range addrs {
				if v4 := x.IP.To4(); v4 != nil {
					ips = append(ips, v4.String())
				}
			}
			writeJSON(w, 200, map[string]any{"ips": ips})
		case "fetch":
			var b struct {
				URL  string `json:"url"`
				Head bool   `json:"head"`
			}
			if err := decode(r, &b); err != nil {
				a.fail(w, err)
				return
			}
			u, err := url.Parse(b.URL)
			if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Hostname() == "" {
				writeJSON(w, 200, map[string]any{"err": "URL inválida", "code": 3})
				return
			}
			c2, cc := context.WithTimeout(ctx, 6*time.Second)
			addrs, err := net.DefaultResolver.LookupIPAddr(c2, u.Hostname())
			cc()
			if err != nil || len(addrs) == 0 {
				writeJSON(w, 200, map[string]any{"err": "Could not resolve host: " + u.Hostname(), "code": 6})
				return
			}
			for _, x := range addrs {
				if !isPublicIP(x.IP) {
					writeJSON(w, 200, map[string]any{"err": "a Internet real da bancada só acessa endereços públicos", "code": 7})
					return
				}
			}
			cl := &http.Client{Timeout: 15 * time.Second, Transport: &http.Transport{Proxy: http.ProxyFromEnvironment, TLSClientConfig: &tls.Config{MinVersion: tls.VersionTLS12}},
				CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
			method := http.MethodGet
			if b.Head {
				method = http.MethodHead
			}
			req, _ := http.NewRequestWithContext(ctx, method, u.String(), nil)
			req.Header.Set("User-Agent", "curl/8.5.0 (Bancada de Rede)")
			resp, err := cl.Do(req)
			if err != nil {
				msg := err.Error()
				code := 7
				if strings.Contains(msg, "timeout") || strings.Contains(msg, "deadline") {
					code = 28
				}
				writeJSON(w, 200, map[string]any{"err": msg, "code": code})
				return
			}
			defer resp.Body.Close()
			body, _ := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
			writeJSON(w, 200, map[string]any{"status": resp.StatusCode, "server": resp.Header.Get("Server"), "ctype": resp.Header.Get("Content-Type"), "body": string(body), "location": resp.Header.Get("Location")})
		default:
			writeErr(w, 404, "rota inexistente")
		}
		return
	}
	// ---- containers ----
	if !a.ctAllowed(r) {
		writeErr(w, 403, "containers reais desativados: rode a bancada com -containers (ou BANCADA_CONTAINERS=1)")
		return
	}
	if ctEngine() == "" {
		writeErr(w, 503, engineProblem())
		return
	}
	var b struct {
		Name  string   `json:"name"`
		Image string   `json:"image"`
		Host  string   `json:"host"`
		Cmd   string   `json:"cmd"`
		Cwd   string   `json:"cwd"`
		Stdin string   `json:"stdin"`
		Port  int      `json:"port"`
		Path  string   `json:"path"`
		Op    string   `json:"op"`
		Ports []string `json:"ports"`
		Env   []string `json:"env"`
		Args  []string `json:"args"`
		All   bool     `json:"all"`
		Map   []string `json:"map"`
		Vols  []string `json:"vols"`
		User  string   `json:"user"`
		Entry string   `json:"entry"`
		Wd    string   `json:"workdir"`
	}
	if r.Method == http.MethodPost {
		if err := decode(r, &b); err != nil {
			a.fail(w, err)
			return
		}
	} else {
		b.Name = r.URL.Query().Get("name")
	}
	if sub != "list" && !(sub == "app" && b.Op == "fetch") && !ctNameRe.MatchString(b.Name) {
		writeErr(w, 400, "nome de container inválido")
		return
	}
	switch sub {
	case "app":
		a.ctApp(w, b.Op, b.Name, b.Image, b.Ports, b.Env, b.Args, b.Path, b.All, b.Map, appOpts{Vols: b.Vols, User: b.User, Entry: b.Entry, Workdir: b.Wd})
	case "list":
		out, _, err := runEngine(ctx, nil, "ps", "-a", "--filter", "label=bancada=1", "--format", "{{.Names}}\t{{.Image}}\t{{.Status}}")
		if err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		writeJSON(w, 200, map[string]any{"containers": strings.Split(strings.TrimSpace(out), "\n")})
	case "status":
		out, _, err := runEngine(ctx, nil, "inspect", "-f", "{{.State.Running}}", b.Name)
		running := err == nil && strings.TrimSpace(out) == "true"
		resp := map[string]any{"exists": err == nil, "running": running}
		if running {
			resp["ports"] = ctPorts(ctx, b.Name)
		}
		writeJSON(w, 200, resp)
	case "start":
		if !ctImages[b.Image] {
			writeErr(w, 400, "imagem não permitida")
			return
		}
		if !ctHostRe.MatchString(b.Host) {
			b.Host = "bancada"
		}
		if out, _, err := runEngine(ctx, nil, "inspect", "-f", "{{.State.Running}}", b.Name); err == nil {
			if strings.TrimSpace(out) != "true" {
				if _, e2, err := runEngine(ctx, nil, "start", b.Name); err != nil {
					writeErr(w, 500, strings.TrimSpace(e2))
					return
				}
			}
		} else if _, e2, err := runEngine(ctx, nil, "run", "-d", "--name", b.Name, "--hostname", b.Host, "--label", "bancada=1", b.Image, "sleep", "infinity"); err != nil {
			writeErr(w, 500, "não foi possível criar o container: "+strings.TrimSpace(e2))
			return
		}
		writeJSON(w, 200, map[string]any{"ok": true, "ports": ctPorts(ctx, b.Name)})
	case "exec":
		if len(b.Cmd) > 8000 {
			writeErr(w, 400, "comando grande demais")
			return
		}
		cwd := b.Cwd
		if cwd == "" || !strings.HasPrefix(cwd, "/") || strings.ContainsAny(cwd, "\x00\n") {
			cwd = "/root"
		}
		args := []string{"exec"}
		var in []byte
		if b.Stdin != "" {
			args = append(args, "-i")
			in = []byte(b.Stdin)
		}
		args = append(args, "-w", cwd, b.Name, "sh", "-c", b.Cmd)
		c2, cc := context.WithTimeout(ctx, 60*time.Second)
		out, er, err := runEngine(c2, in, args...)
		cc()
		code := 0
		var ee *exec.ExitError
		if errors.As(err, &ee) {
			code = ee.ExitCode()
		} else if err != nil {
			er += err.Error()
			code = 1
		}
		writeJSON(w, 200, map[string]any{"out": out, "err": er, "code": code, "ports": ctPorts(ctx, b.Name)})
	case "http":
		path := b.Path
		if path == "" || !strings.HasPrefix(path, "/") || strings.ContainsAny(path, "'\"\\ \n`$") {
			path = "/"
		}
		cmd := fmt.Sprintf("(curl -s -i --max-time 5 http://127.0.0.1:%d%s || wget -q -S -O - http://127.0.0.1:%d%s) 2>&1", b.Port, path, b.Port, path)
		out, _, _ := runEngine(ctx, nil, "exec", b.Name, "sh", "-c", cmd)
		writeJSON(w, 200, map[string]any{"raw": out})
	case "stop":
		_, _, _ = runEngine(ctx, nil, "rm", "-f", b.Name)
		writeJSON(w, 200, map[string]any{"ok": true})
	default:
		writeErr(w, 404, "rota inexistente")
	}
}

var _ = json.Marshal

// ---- rede do computador (para a nuvem "Internet real" em modo ponte) ----

type hostNetInfo struct {
	IP    string `json:"ip"`
	LAN   string `json:"lan"`
	GW    string `json:"gw"`
	Iface string `json:"iface"`
}

func defaultGateway() string {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	switch {
	case fileExists("/proc/net/route"):
		b, _ := os.ReadFile("/proc/net/route")
		for _, l := range strings.Split(string(b), "\n")[1:] {
			f := strings.Fields(l)
			if len(f) > 2 && f[1] == "00000000" {
				v, err := strconv.ParseUint(f[2], 16, 32)
				if err == nil && v != 0 {
					return net.IPv4(byte(v), byte(v>>8), byte(v>>16), byte(v>>24)).String()
				}
			}
		}
	default:
		var out []byte
		if _, err := exec.LookPath("route"); err == nil {
			if isWindows() {
				rc := exec.CommandContext(ctx, "route", "print", "-4", "0.0.0.0")
				hideWindow(rc)
				out, _ = rc.Output()
			} else {
				out, _ = exec.CommandContext(ctx, "route", "-n", "get", "default").Output()
			}
		}
		re := regexp.MustCompile(`(?m)^\s*0\.0\.0\.0\s+0\.0\.0\.0\s+(\d+\.\d+\.\d+\.\d+)|gateway:\s*(\d+\.\d+\.\d+\.\d+)`)
		if m := re.FindStringSubmatch(string(out)); m != nil {
			if m[1] != "" {
				return m[1]
			}
			return m[2]
		}
	}
	return ""
}

func fileExists(p string) bool { _, err := os.Stat(p); return err == nil }

// placas IPv4 ativas do computador (inclusive vEthernet/Hyper-V: no Windows a placa
// física pode estar atrás de um switch virtual externo e quem tem o IP é a vEthernet)
func hostIfaces() []hostNetInfo {
	var res []hostNetInfo
	ifs, _ := net.Interfaces()
	for _, it := range ifs {
		if it.Flags&net.FlagUp == 0 || it.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, _ := it.Addrs()
		for _, a := range addrs {
			ipn, ok := a.(*net.IPNet)
			if !ok || ipn.IP.To4() == nil || ipn.IP.IsLoopback() || ipn.IP.IsLinkLocalUnicast() {
				continue
			}
			ones, _ := ipn.Mask.Size()
			res = append(res, hostNetInfo{IP: ipn.IP.To4().String(), LAN: fmt.Sprintf("%s/%d", ipn.IP.Mask(ipn.Mask).String(), ones), Iface: it.Name})
		}
	}
	return res
}

func virtualIface(name string) bool {
	n := strings.ToLower(name)
	for _, k := range []string{"docker", "br-", "veth", "vethernet (wsl", "vethernet (default", "virtualbox", "vmware", "podman", "vmnet", "vboxnet", "tailscale", "zerotier", "wireguard", "tun", "tap", "utun", "hyper-v"} {
		if strings.Contains(n, k) {
			return true
		}
	}
	return false
}

func hostNetwork() hostNetInfo {
	gw := net.ParseIP(defaultGateway())
	all := hostIfaces()
	if gw != nil {
		for _, h := range all {
			if _, n, err := net.ParseCIDR(h.LAN); err == nil && n.Contains(gw) {
				h.GW = gw.String()
				return h
			}
		}
	}
	var best hostNetInfo
	for _, h := range all {
		ip := net.ParseIP(h.IP)
		if ip == nil || !ip.IsPrivate() {
			continue
		}
		if best.IP == "" || (virtualIface(best.Iface) && !virtualIface(h.Iface)) {
			best = h
		}
	}
	if best.IP != "" && best.GW == "" {
		_, n, _ := net.ParseCIDR(best.LAN)
		g := n.IP.To4()
		best.GW = net.IPv4(g[0], g[1], g[2], g[3]+1).String()
	}
	return best
}

var (
	pubMu sync.Mutex
	pubIP string
	pubAt time.Time
)

func publicIP(ctx context.Context) string {
	pubMu.Lock()
	defer pubMu.Unlock()
	if pubIP != "" && time.Since(pubAt) < 10*time.Minute {
		return pubIP
	}
	cl := &http.Client{Timeout: 6 * time.Second, Transport: &http.Transport{Proxy: http.ProxyFromEnvironment}}
	for _, u := range []string{"https://api.ipify.org", "https://ifconfig.me/ip", "https://icanhazip.com"} {
		req, _ := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
		req.Header.Set("User-Agent", "curl/8.5.0")
		r, err := cl.Do(req)
		if err != nil {
			continue
		}
		b, _ := io.ReadAll(io.LimitReader(r.Body, 64))
		r.Body.Close()
		ip := net.ParseIP(strings.TrimSpace(string(b)))
		if ip != nil && ip.To4() != nil {
			pubIP, pubAt = ip.String(), time.Now()
			return pubIP
		}
	}
	return ""
}
