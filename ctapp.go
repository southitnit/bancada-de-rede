// Containers que os servidores do lab sobem com "docker run" rodando DE VERDADE no Docker
// deste computador (quando houver). A porta do container fica só em 127.0.0.1 com porta
// aleatória; a bancada encaminha para ela o acesso ao IP:porta do servidor no lab.
package main

import (
	"context"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

var (
	ctImageRe = regexp.MustCompile(`^[a-z0-9][a-z0-9._/-]{0,200}(:[A-Za-z0-9._-]{1,128})?(@sha256:[a-f0-9]{64})?$`)
	ctEnvRe   = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]{0,63}=[^\x00\n]{0,1000}$`)
	loopTgtRe = regexp.MustCompile(`^127\.0\.0\.1:\d{1,5}$`)
)

type appResult struct {
	Name    string            `json:"name"`
	State   string            `json:"state"` // ok | erro | parado | removido
	Ports   map[string]string `json:"ports,omitempty"`
	Exposed []string          `json:"exposed,omitempty"`
	Err     string            `json:"err,omitempty"`
}

func appPush(r appResult) {
	b, _ := json.Marshal(r)
	bridgePush(bridgeEvt{Type: "app", Sess: r.Name, Body: string(b)})
}

// specs: "3000" (tcp) ou "53/udp" → "127.0.0.1:porta" no computador
func appPorts(ctx context.Context, name string, specs []string) map[string]string {
	m := map[string]string{}
	for _, sp := range specs {
		q := sp
		if !strings.Contains(q, "/") {
			q += "/tcp"
		}
		out, _, err := runEngine(ctx, nil, "port", name, q)
		if err != nil {
			continue
		}
		for _, l := range strings.Split(strings.TrimSpace(out), "\n") {
			l = strings.TrimSpace(l)
			if strings.HasPrefix(l, "127.0.0.1:") {
				m[strings.TrimSuffix(sp, "/tcp")] = l
				break
			}
		}
	}
	return m
}

var (
	portSpecRe = regexp.MustCompile(`^\d{1,5}(/(tcp|udp))?$`)
	mapSpecRe  = regexp.MustCompile(`^\d{1,5}:\d{1,5}(/(tcp|udp))?$`)
)

// registro dos containers reais: dispositivo do lab → "porta[/udp]" no lab → 127.0.0.1:porta
var appReg = struct {
	sync.Mutex
	m  map[string]map[string]string
	at time.Time
}{}

func appDevOf(name string) string {
	s := strings.TrimPrefix(name, "bancada-app")
	if i := strings.IndexByte(s, '-'); i > 0 {
		return s[:i]
	}
	return ""
}

func appScan() {
	if ctEngine() == "" {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	out, _, err := runEngine(ctx, nil, "ps", "--filter", "label=bancada.app=1", "--format", "{{.Names}}")
	if err != nil {
		return
	}
	m := map[string]map[string]string{}
	for _, name := range strings.Fields(out) {
		dev := appDevOf(name)
		if dev == "" {
			continue
		}
		lb, _, _ := runEngine(ctx, nil, "inspect", "-f", `{{index .Config.Labels "bancada.map"}}`, name)
		pt, _, _ := runEngine(ctx, nil, "port", name)
		host := map[string]string{} // "3000/tcp" → 127.0.0.1:x
		for _, l := range strings.Split(pt, "\n") {
			if f := strings.Fields(l); len(f) >= 3 && strings.HasPrefix(f[2], "127.0.0.1:") {
				host[f[0]] = f[2]
			}
		}
		specs := strings.Split(strings.TrimSpace(lb), ",")
		if strings.TrimSpace(lb) == "" || strings.Contains(lb, "no value") {
			// container de versão anterior, sem o mapa: mesma porta no lab e no container
			specs = nil
			for k := range host {
				pp := strings.SplitN(k, "/", 2)
				if len(pp) == 2 {
					sp := pp[0] + ":" + pp[0]
					if pp[1] == "udp" {
						sp += "/udp"
					}
					specs = append(specs, sp)
				}
			}
		}
		for _, sp := range specs {
			if !mapSpecRe.MatchString(sp) {
				continue
			}
			hc := strings.SplitN(sp, ":", 2)
			proto := "tcp"
			c := hc[1]
			if strings.HasSuffix(c, "/udp") {
				proto, c = "udp", strings.TrimSuffix(c, "/udp")
			}
			c = strings.TrimSuffix(c, "/tcp")
			if addr := host[c+"/"+proto]; addr != "" {
				if m[dev] == nil {
					m[dev] = map[string]string{}
				}
				k := hc[0]
				if proto == "udp" {
					k += "/udp"
				}
				m[dev][k] = addr
			}
		}
	}
	appReg.Lock()
	appReg.m, appReg.at = m, time.Now()
	appReg.Unlock()
}

// endereço atual de um destino que mudou (mesma porta do lab no mesmo container)
var appLast = struct {
	sync.Mutex
	m map[string][2]string // destino antigo → {dev, chave}
}{m: map[string][2]string{}}

func appRemap(old string) string {
	appLast.Lock()
	k, ok := appLast.m[old]
	appLast.Unlock()
	if !ok {
		return ""
	}
	appReg.Lock()
	defer appReg.Unlock()
	return appReg.m[k[0]][k[1]]
}

// destino real de uma porta de um dispositivo do lab (atualiza o registro se estiver velho)
func appLookup(dev, key string) string {
	dev = strings.ToLower(regexp.MustCompile(`[^A-Za-z0-9]`).ReplaceAllString(dev, ""))
	appReg.Lock()
	old := time.Since(appReg.at) > 15*time.Second
	v := appReg.m[dev][key]
	appReg.Unlock()
	if v == "" && old {
		appScan()
		appReg.Lock()
		v = appReg.m[dev][key]
		appReg.Unlock()
	}
	if v != "" {
		appLast.Lock()
		appLast.m[v] = [2]string{dev, key}
		appLast.Unlock()
	}
	return v
}

func cleanSpecs(in []string) []string {
	var out []string
	seen := map[string]bool{}
	for _, p := range in {
		p = strings.TrimSuffix(strings.TrimSpace(p), "/tcp")
		if portSpecRe.MatchString(p) && !seen[p] {
			seen[p] = true
			out = append(out, p)
		}
	}
	return out
}

func (a *App) ctApp(w http.ResponseWriter, op, name, image string, ports, env, args []string, path string, pubAll bool, pmap []string, o appOpts) {
	_ = a
	switch op {
	case "run":
		if !ctImageRe.MatchString(image) {
			writeErr(w, 400, "imagem inválida")
			return
		}
		ps := cleanSpecs(ports)
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
			defer cancel()
			if out, _, err := runEngine(ctx, nil, "inspect", "-f", "{{.State.Running}}", name); err == nil {
				if strings.TrimSpace(out) != "true" {
					if _, e2, err := runEngine(ctx, nil, "start", name); err != nil {
						appPush(appResult{Name: name, State: "erro", Err: strings.TrimSpace(e2)})
						return
					}
				}
			} else {
				var exposed []string
				if pubAll {
					// -P / --network host: publica (só em 127.0.0.1) todas as portas que a imagem declara
					if _, e2, err := runEngine(ctx, nil, "pull", image); err != nil {
						appPush(appResult{Name: name, State: "erro", Err: strings.TrimSpace(e2)})
						return
					}
					out, _, _ := runEngine(ctx, nil, "image", "inspect", "--format", "{{range $p, $v := .Config.ExposedPorts}}{{$p}} {{end}}", image)
					for _, x := range strings.Fields(out) {
						exposed = append(exposed, x)
					}
					ps = cleanSpecs(append(ps, exposed...))
				}
				// mapa porta-do-servidor-do-lab:porta-do-container, guardado no próprio container
				var mp []string
				for _, x := range pmap {
					if mapSpecRe.MatchString(x) {
						mp = append(mp, x)
					}
				}
				for _, x := range exposed {
					c := strings.TrimSuffix(x, "/tcp")
					if portSpecRe.MatchString(c) {
						pn := strings.SplitN(c, "/", 2)
						mp = append(mp, pn[0]+":"+c)
					}
				}
				cmd := []string{"run", "-d", "--name", name, "--label", "bancada=1", "--label", "bancada.app=1", "--label", "bancada.map=" + strings.Join(mp, ","), "--restart", "unless-stopped"}
				cmd = append(cmd, appRunOpts(ctx, name, image, o)...)
				for _, p := range ps {
					cmd = append(cmd, "-p", "127.0.0.1::"+p)
				}
				for _, e := range env {
					if ctEnvRe.MatchString(e) {
						cmd = append(cmd, "-e", e)
					}
				}
				cmd = append(cmd, image)
				for _, x := range args {
					if !strings.ContainsAny(x, "\x00\n") && len(x) < 500 {
						cmd = append(cmd, x)
					}
				}
				logf("Container real: %s (%s) — baixando/iniciando…", name, image)
				if _, e2, err := runEngine(ctx, nil, cmd...); err != nil {
					appPush(appResult{Name: name, State: "erro", Err: strings.TrimSpace(e2)})
					return
				}
			}
			if pubAll {
				out, _, _ := runEngine(ctx, nil, "port", name)
				for _, l := range strings.Split(out, "\n") {
					if f := strings.Fields(l); len(f) >= 3 && strings.HasPrefix(f[2], "127.0.0.1:") {
						ps = cleanSpecs(append(ps, f[0]))
					}
				}
			}
			m := appPorts(ctx, name, ps)
			var ex []string
			for k := range m {
				ex = append(ex, k)
			}
			logf("Container real %s rodando: %v", name, m)
			appScan()
			appPush(appResult{Name: name, State: "ok", Ports: m, Exposed: ex})
		}()
		writeJSON(w, 200, map[string]any{"state": "iniciando"})
	case "stop", "start", "rm":
		ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
		defer cancel()
		arg := []string{op, name}
		if op == "rm" {
			arg = []string{"rm", "-f", name}
		}
		if _, e2, err := runEngine(ctx, nil, arg...); err != nil && op != "rm" {
			writeErr(w, 500, strings.TrimSpace(e2))
			return
		}
		go appScan()
		res := appResult{Name: name, State: map[string]string{"stop": "parado", "start": "ok", "rm": "removido"}[op]}
		if op == "start" {
			res.Ports = appPorts(ctx, name, cleanSpecs(ports))
		}
		writeJSON(w, 200, res)
	case "fetch": // curl de dentro do lab para o container real
		if !loopTgtRe.MatchString(name) {
			writeErr(w, 400, "destino inválido")
			return
		}
		if path == "" || !strings.HasPrefix(path, "/") {
			path = "/"
		}
		cl := &http.Client{Timeout: 15 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
		resp, err := cl.Get("http://" + name + path)
		if err != nil {
			writeJSON(w, 200, map[string]any{"err": err.Error()})
			return
		}
		defer resp.Body.Close()
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 256<<10))
		writeJSON(w, 200, map[string]any{"status": resp.StatusCode, "server": resp.Header.Get("Server"), "ctype": resp.Header.Get("Content-Type"), "body": string(body)})
	default:
		writeErr(w, 400, "operação inválida")
	}
}

type appOpts struct {
	Vols    []string
	User    string
	Entry   string
	Workdir string
}

var (
	volDstRe  = regexp.MustCompile(`^/[A-Za-z0-9._/-]{0,200}$`)
	volNameRe = regexp.MustCompile(`[^a-z0-9_.-]+`)
	userRe    = regexp.MustCompile(`^[A-Za-z0-9._-]{1,32}(:[A-Za-z0-9._-]{1,32})?$`)
)

func isPodman() bool { return strings.Contains(strings.ToLower(filepath.Base(ctEngine())), "podman") }

// -v do servidor do lab: o caminho do lab não existe neste computador, então cada volume vira
// um volume nomeado do Docker/Podman (os dados persistem entre recriações do container)
func appRunOpts(ctx context.Context, name, image string, o appOpts) []string {
	var out []string
	if o.User != "" && userRe.MatchString(o.User) {
		out = append(out, "--user", o.User)
	}
	if o.Workdir != "" && volDstRe.MatchString(o.Workdir) {
		out = append(out, "-w", o.Workdir)
	}
	if o.Entry != "" && !strings.ContainsAny(o.Entry, "\x00\n") && len(o.Entry) < 300 {
		out = append(out, "--entrypoint", o.Entry)
	}
	imgUser := ""
	if len(o.Vols) > 0 {
		u, _, err := runEngine(ctx, nil, "image", "inspect", "--format", "{{.Config.User}}", image)
		if err != nil {
			_, _, _ = runEngine(ctx, nil, "pull", image)
			u, _, _ = runEngine(ctx, nil, "image", "inspect", "--format", "{{.Config.User}}", image)
		}
		imgUser = strings.TrimSpace(u)
		if o.User != "" {
			imgUser = o.User
		}
		if imgUser == "0" || imgUser == "root" || strings.HasPrefix(imgUser, "0:") || strings.HasPrefix(imgUser, "root:") {
			imgUser = ""
		}
	}
	dev := appDevOf(name)
	for _, v := range o.Vols {
		pp := strings.Split(v, ":")
		if len(pp) < 2 {
			continue
		}
		src, dst := pp[0], pp[1]
		ro := len(pp) > 2 && strings.Contains(pp[2], "ro")
		if !volDstRe.MatchString(dst) {
			continue
		}
		vn := strings.Trim(volNameRe.ReplaceAllString(strings.ToLower(strings.TrimLeft(src, "~/.")), "-"), "-.")
		if vn == "" {
			vn = "dados"
		}
		if len(vn) > 40 {
			vn = vn[:40]
		}
		vol := "bancada-" + dev + "-" + vn
		spec := vol + ":" + dst
		switch {
		case ro:
			spec += ":ro"
		case isPodman():
			spec += ":U" // o Podman ajusta o dono do volume para o usuário do container
		case imgUser != "":
			// Docker: volume novo nasce do root; a imagem roda como outro usuário → ajusta o dono
			_, _, _ = runEngine(ctx, nil, "run", "--rm", "--user", "0", "--entrypoint", "chown", "-v", vol+":/bancada-vol", image, "-R", imgUser, "/bancada-vol")
		}
		out = append(out, "-v", spec)
	}
	return out
}

// conexão de fora → container real (TCP puro: serve HTTP, websockets, qualquer protocolo)
func rawProxy(c net.Conn, target string) {
	defer c.Close()
	if !loopTgtRe.MatchString(target) {
		return
	}
	u, err := net.DialTimeout("tcp", target, 5*time.Second)
	if err != nil {
		// porta antiga (container reiniciado)? relê o registro e tenta o endereço novo
		old := target
		appScan()
		if nt := appRemap(old); nt != "" && nt != old {
			u, err = net.DialTimeout("tcp", nt, 5*time.Second)
		}
		if err != nil {
			logf("Container real: não consegui conectar em %s (%v)", old, err)
			return
		}
	}
	defer u.Close()
	done := make(chan struct{}, 2)
	go func() { _, _ = io.Copy(u, c); done <- struct{}{} }()
	go func() { _, _ = io.Copy(c, u); done <- struct{}{} }()
	<-done
}
