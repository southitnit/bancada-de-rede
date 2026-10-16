// Acesso de fora ao lab: servidor SSH real que entrega a sessão para a bancada aberta no navegador.
//
// O motor de rede roda no navegador. Quando alguém conecta numa porta publicada (ex.: ssh -p 2222 usuario@este-pc),
// o servidor avisa a aba aberta (/api/bridge/poll), que simula o caminho Internet → NAT → host e executa os
// comandos no console simulado; a saída volta por /api/bridge/out.
package main

import (
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/binary"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"golang.org/x/crypto/ssh"
)

type bridgeEvt struct {
	Type   string            `json:"type"` // open | line | close | http
	Sess   string            `json:"sess"`
	Line   string            `json:"line,omitempty"`
	Port   int               `json:"port,omitempty"`
	Bind   string            `json:"bind,omitempty"`
	Target string            `json:"target,omitempty"`
	User   string            `json:"user,omitempty"`
	Client string            `json:"client,omitempty"`
	Exec   bool              `json:"exec,omitempty"`
	Method string            `json:"method,omitempty"`
	Path   string            `json:"path,omitempty"`
	Head   map[string]string `json:"head,omitempty"`
	Body   string            `json:"body,omitempty"`
	TLS    bool              `json:"tls,omitempty"`
	Lan    *lanStat          `json:"lan,omitempty"`
	Local  map[string]string `json:"local,omitempty"`
}

type bridgeOut struct {
	Sess    string            `json:"sess"`
	Lines   []string          `json:"lines"`
	Prompt  string            `json:"prompt"`
	Close   bool              `json:"close"`
	Status  int               `json:"status"`
	Headers map[string]string `json:"headers"`
	Body    string            `json:"body"`
}

type pubPort struct {
	Bind   string `json:"bind"` // vazio = endereço do servidor; ou um IP do lab criado na placa de rede
	Port   int    `json:"port"`
	Pass   string `json:"pass"`
	Target string `json:"target"`
	Real   string `json:"real,omitempty"` // 127.0.0.1:porta de um container real: encaminha TCP direto
}

func (p pubPort) key() string { return net.JoinHostPort(p.Bind, strconv.Itoa(p.Port)) }

type pubListener struct {
	ln   net.Listener
	conf pubPort
	http *chanListener
	tls  *chanListener
}

var bridge = struct {
	sync.Mutex
	q        []bridgeEvt
	wake     chan struct{}
	lastPoll time.Time
	sess     map[string]chan bridgeOut
	lns      map[string]*pubListener
	errs     map[string]string
	app      *App
	pubs     []pubPort
	key      ssh.Signer
	bind     string
}{wake: make(chan struct{}, 1), sess: map[string]chan bridgeOut{}, lns: map[string]*pubListener{}, errs: map[string]string{}}

// bridgeBind: endereço onde as portas publicadas escutam (o mesmo do servidor web).
func setBridgeBind(h string) { bridge.Lock(); bridge.bind = h; bridge.Unlock() }

func bridgePush(e bridgeEvt) {
	bridge.Lock()
	bridge.q = append(bridge.q, e)
	bridge.Unlock()
	select {
	case bridge.wake <- struct{}{}:
	default:
	}
}

func browserAlive() bool {
	bridge.Lock()
	defer bridge.Unlock()
	return time.Since(bridge.lastPoll) < 40*time.Second
}

func hostKey(dir string) (ssh.Signer, error) {
	bridge.Lock()
	defer bridge.Unlock()
	if bridge.key != nil {
		return bridge.key, nil
	}
	p := filepath.Join(dir, "ssh_host_ed25519_key")
	if b, err := os.ReadFile(p); err == nil {
		if s, err := ssh.ParsePrivateKey(b); err == nil {
			bridge.key = s
			return s, nil
		}
	}
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, err
	}
	blk, err := ssh.MarshalPrivateKey(priv, "bancada")
	if err != nil {
		return nil, err
	}
	_ = os.MkdirAll(dir, 0o755)
	_ = os.WriteFile(p, pem.EncodeToMemory(blk), 0o600)
	s, err := ssh.NewSignerFromKey(priv)
	if err != nil {
		return nil, err
	}
	bridge.key = s
	return s, nil
}

// reconcilia IPs reais e portas publicadas com o que a aba do navegador pediu
func (a *App) bridgeConfig(ports []pubPort, lan []lanReq) (map[string]string, map[string]lanStat) {
	lanDataDir = a.st.dir
	bridge.Lock()
	bridge.app = a
	bridge.Unlock()
	lst := lanSync(lan)
	return a.syncListeners(ports, true), lst
}

// reconcilia os listeners: portas publicadas no computador (do navegador) + portas dos
// equipamentos do lab presentes na rede real (do servidor). full=false só acrescenta.
func (a *App) syncListeners(ports []pubPort, full bool) map[string]string {
	want := map[string]pubPort{}
	bridge.Lock()
	defer bridge.Unlock()
	if full {
		bridge.pubs = nil
		for _, p := range ports {
			if p.Bind == "" && p.Port >= 1 && p.Port <= 65535 {
				bridge.pubs = append(bridge.pubs, p)
			}
		}
	}
	for _, p := range bridge.pubs {
		want[p.key()] = p
	}
	for k, l := range bridge.lns {
		if w, ok := want[k]; !ok {
			l.ln.Close()
			delete(bridge.lns, k)
		} else {
			l.conf = w
		}
	}
	def := bridge.bind
	if def == "" {
		def = "127.0.0.1"
	}
	if full {
		bridge.errs = map[string]string{}
	}
	for k, p := range want {
		if _, ok := bridge.lns[k]; ok {
			continue
		}
		var ln net.Listener
		var err error
		bind := p.Bind
		if bind == "" {
			bind = def
			ln, err = net.Listen("tcp", net.JoinHostPort(bind, strconv.Itoa(p.Port)))
		} else if h := lanHostByIP(p.Bind); h != nil {
			ln, err = h.listen(p.Port)
		} else {
			continue
		}
		if err != nil {
			bridge.errs[k] = err.Error()
			continue
		}
		delete(bridge.errs, k)
		pl := &pubListener{ln: ln, conf: p}
		bridge.lns[k] = pl
		go a.acceptLoop(pl)
		logf("Publicado %s:%d → lab %s", bind, p.Port, p.Target)
	}
	errs := map[string]string{}
	for k, v := range bridge.errs {
		errs[k] = v
	}
	return errs
}

func (a *App) plInit(pl *pubListener, addr net.Addr) {
	pl.http = newChanListener(addr)
	pl.tls = newChanListener(addr)
	h := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { a.httpBridge(w, r, pl) })
	go (&http.Server{Handler: h, ReadHeaderTimeout: 15 * time.Second}).Serve(pl.http)
	if cert, err := tlsCert(a.st.dir); err == nil {
		go (&http.Server{Handler: h, ReadHeaderTimeout: 15 * time.Second}).Serve(tls.NewListener(pl.tls, &tls.Config{Certificates: []tls.Certificate{cert}, MinVersion: tls.VersionTLS12}))
	}
}

func (a *App) acceptLoop(pl *pubListener) {
	a.plInit(pl, pl.ln.Addr())
	defer pl.http.Close()
	defer pl.tls.Close()
	for {
		c, err := pl.ln.Accept()
		if err != nil {
			return
		}
		bridge.Lock()
		real := pl.conf.Real
		bridge.Unlock()
		if real != "" {
			go rawProxy(c, real)
			continue
		}
		go a.handleConn(pl, c)
	}
}

// descobre o protocolo pelos primeiros bytes: TLS (0x16), HTTP (texto) ou SSH (padrão)
func (a *App) handleConn(pl *pubListener, c net.Conn) {
	_ = c.SetReadDeadline(time.Now().Add(400 * time.Millisecond))
	b := make([]byte, 1)
	n, _ := c.Read(b)
	_ = c.SetReadDeadline(time.Time{})
	pc := &prefConn{Conn: c, pre: b[:n]}
	switch {
	case n == 1 && b[0] == 0x16:
		pl.tls.ch <- pc
	case n == 1 && b[0] >= 'A' && b[0] <= 'Z' && b[0] != 'S':
		pl.http.ch <- pc
	default:
		a.sshConn(pc, pl)
	}
}

// conexão TCP de fora para um equipamento do lab na rede real (qualquer porta)
var lanPLs = struct {
	sync.Mutex
	m map[string]*pubListener
}{m: map[string]*pubListener{}}

func lanServeConn(c net.Conn, conf pubPort) {
	bridge.Lock()
	a := bridge.app
	bridge.Unlock()
	if a == nil {
		c.Close()
		return
	}
	k := conf.key()
	lanPLs.Lock()
	pl := lanPLs.m[k]
	if pl == nil {
		pl = &pubListener{conf: conf}
		a.plInit(pl, &net.TCPAddr{IP: net.ParseIP(conf.Bind), Port: conf.Port})
		lanPLs.m[k] = pl
	}
	lanPLs.Unlock()
	bridge.Lock()
	pl.conf = conf
	bridge.Unlock()
	a.handleConn(pl, c)
}

type prefConn struct {
	net.Conn
	pre []byte
}

func (p *prefConn) Read(b []byte) (int, error) {
	if len(p.pre) > 0 {
		n := copy(b, p.pre)
		p.pre = p.pre[n:]
		return n, nil
	}
	return p.Conn.Read(b)
}

type chanListener struct {
	ch   chan net.Conn
	addr net.Addr
	once sync.Once
	done chan struct{}
}

func newChanListener(a net.Addr) *chanListener {
	return &chanListener{ch: make(chan net.Conn, 16), addr: a, done: make(chan struct{})}
}
func (l *chanListener) Accept() (net.Conn, error) {
	select {
	case c := <-l.ch:
		return c, nil
	case <-l.done:
		return nil, net.ErrClosed
	}
}
func (l *chanListener) Close() error   { l.once.Do(func() { close(l.done) }); return nil }
func (l *chanListener) Addr() net.Addr { return l.addr }

var (
	certMu  sync.Mutex
	certTLS *tls.Certificate
)

func tlsCert(dir string) (tls.Certificate, error) {
	certMu.Lock()
	defer certMu.Unlock()
	if certTLS != nil {
		return *certTLS, nil
	}
	cp, kp := filepath.Join(dir, "web_cert.pem"), filepath.Join(dir, "web_key.pem")
	if c, err := tls.LoadX509KeyPair(cp, kp); err == nil {
		certTLS = &c
		return c, nil
	}
	priv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return tls.Certificate{}, err
	}
	tmpl := &x509.Certificate{SerialNumber: big.NewInt(time.Now().UnixNano()), Subject: pkix.Name{CommonName: "bancada-de-rede", Organization: []string{"Bancada de Rede (lab)"}},
		NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().AddDate(5, 0, 0), KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}, DNSNames: []string{"localhost"}}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, priv.Public(), priv)
	if err != nil {
		return tls.Certificate{}, err
	}
	kb, _ := x509.MarshalPKCS8PrivateKey(priv)
	cpem := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	kpem := pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: kb})
	_ = os.WriteFile(cp, cpem, 0o644)
	_ = os.WriteFile(kp, kpem, 0o600)
	c, err := tls.X509KeyPair(cpem, kpem)
	if err != nil {
		return tls.Certificate{}, err
	}
	certTLS = &c
	return c, nil
}

// requisição HTTP/HTTPS de fora → interface web simulada (ou site de um host do lab)
func (a *App) httpBridge(w http.ResponseWriter, r *http.Request, pl *pubListener) {
	if !browserAlive() {
		http.Error(w, "A Bancada de Rede precisa estar aberta no navegador para atender este acesso ao lab.", 503)
		return
	}
	body, _ := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	head := map[string]string{"cookie": r.Header.Get("Cookie"), "content-type": r.Header.Get("Content-Type"), "host": r.Host, "user-agent": r.Header.Get("User-Agent")}
	client, _, _ := net.SplitHostPort(r.RemoteAddr)
	bridge.Lock()
	conf := pl.conf
	bridge.Unlock()
	id := randHex(8)
	out := make(chan bridgeOut, 1)
	bridge.Lock()
	bridge.sess[id] = out
	bridge.Unlock()
	defer func() { bridge.Lock(); delete(bridge.sess, id); bridge.Unlock() }()
	bridgePush(bridgeEvt{Type: "http", Sess: id, Port: conf.Port, Bind: conf.Bind, Target: conf.Target, Client: client, Method: r.Method, Path: r.URL.RequestURI(), Head: head, Body: string(body), TLS: r.TLS != nil})
	select {
	case o := <-out:
		for k, v := range o.Headers {
			w.Header().Set(k, v)
		}
		if o.Status == 0 {
			o.Status = 200
		}
		w.WriteHeader(o.Status)
		_, _ = io.WriteString(w, o.Body)
	case <-time.After(30 * time.Second):
		http.Error(w, "sem resposta da bancada", 504)
	}
}

func (a *App) sshConn(nc net.Conn, pl *pubListener) {
	defer nc.Close()
	key, err := hostKey(a.st.dir)
	if err != nil {
		return
	}
	cfg := &ssh.ServerConfig{
		PasswordCallback: func(c ssh.ConnMetadata, pw []byte) (*ssh.Permissions, error) {
			bridge.Lock()
			want := pl.conf.Pass
			bridge.Unlock()
			if want == "" || string(pw) == want {
				return &ssh.Permissions{}, nil
			}
			time.Sleep(600 * time.Millisecond)
			return nil, errors.New("senha incorreta")
		},
		ServerVersion: "SSH-2.0-OpenSSH_9.6p1 Bancada",
	}
	cfg.AddHostKey(key)
	_ = nc.SetDeadline(time.Now().Add(30 * time.Second))
	sc, chans, reqs, err := ssh.NewServerConn(nc, cfg)
	if err != nil {
		return
	}
	_ = nc.SetDeadline(time.Time{})
	defer sc.Close()
	go ssh.DiscardRequests(reqs)
	client, _, _ := net.SplitHostPort(sc.RemoteAddr().String())
	for nch := range chans {
		if nch.ChannelType() != "session" {
			_ = nch.Reject(ssh.UnknownChannelType, "só sessões")
			continue
		}
		ch, rq, err := nch.Accept()
		if err != nil {
			continue
		}
		bridge.Lock()
		conf := pl.conf
		bridge.Unlock()
		go a.sshSession(ch, rq, conf, sc.User(), client)
	}
}

func readStr(b []byte) string {
	if len(b) < 4 {
		return ""
	}
	n := binary.BigEndian.Uint32(b)
	if int(n) > len(b)-4 {
		return ""
	}
	return string(b[4 : 4+n])
}

func (a *App) sshSession(ch ssh.Channel, reqs <-chan *ssh.Request, conf pubPort, user, client string) {
	defer ch.Close()
	started := make(chan string, 1)
	go func() {
		for r := range reqs {
			switch r.Type {
			case "pty-req", "env", "window-change":
				_ = r.Reply(true, nil)
			case "shell":
				_ = r.Reply(true, nil)
				select {
				case started <- "":
				default:
				}
			case "exec":
				_ = r.Reply(true, nil)
				select {
				case started <- "\x00" + readStr(r.Payload):
				default:
				}
			default:
				_ = r.Reply(false, nil)
			}
		}
	}()
	var mode string
	select {
	case mode = <-started:
	case <-time.After(20 * time.Second):
		return
	}
	nl := func(s string) string { return strings.ReplaceAll(strings.ReplaceAll(s, "\r\n", "\n"), "\n", "\r\n") }
	if !browserAlive() {
		fmt.Fprint(ch, nl("A Bancada de Rede precisa estar aberta no navegador para atender conexões SSH ao lab.\n"))
		_, _ = ch.SendRequest("exit-status", false, ssh.Marshal(struct{ C uint32 }{1}))
		return
	}
	id := randHex(8)
	out := make(chan bridgeOut, 8)
	bridge.Lock()
	bridge.sess[id] = out
	bridge.Unlock()
	defer func() {
		bridge.Lock()
		delete(bridge.sess, id)
		bridge.Unlock()
		bridgePush(bridgeEvt{Type: "close", Sess: id})
	}()
	exec := strings.HasPrefix(mode, "\x00")
	bridgePush(bridgeEvt{Type: "open", Sess: id, Port: conf.Port, Bind: conf.Bind, Target: conf.Target, User: user, Client: client, Exec: exec, Line: strings.TrimPrefix(mode, "\x00")})
	wait := func(d time.Duration) (bridgeOut, bool) {
		select {
		case o := <-out:
			return o, true
		case <-time.After(d):
			return bridgeOut{}, false
		}
	}
	write := func(o bridgeOut) {
		for _, l := range o.Lines {
			fmt.Fprint(ch, nl(l)+"\r\n")
		}
	}
	o, ok := wait(15 * time.Second)
	if !ok {
		fmt.Fprint(ch, nl("A bancada no navegador não respondeu.\n"))
		return
	}
	write(o)
	if exec || o.Close {
		code := uint32(0)
		if o.Close && !exec {
			code = 255
		}
		_, _ = ch.SendRequest("exit-status", false, ssh.Marshal(struct{ C uint32 }{code}))
		return
	}
	prompt := o.Prompt
	fmt.Fprint(ch, prompt+" ")
	buf := []byte{}
	rd := make([]byte, 1024)
	esc := 0
	for {
		n, err := ch.Read(rd)
		if err != nil {
			return
		}
		for _, c := range rd[:n] {
			if esc > 0 {
				esc--
				if esc == 1 && c != '[' && c != 'O' {
					esc = 0
				}
				continue
			}
			switch {
			case c == 0x1b:
				esc = 2
			case c == '\r' || c == '\n':
				if c == '\n' && len(buf) == 0 {
					continue
				}
				fmt.Fprint(ch, "\r\n")
				line := string(buf)
				buf = buf[:0]
				bridgePush(bridgeEvt{Type: "line", Sess: id, Line: line})
				o, ok := wait(90 * time.Second)
				if !ok {
					fmt.Fprint(ch, "(sem resposta da bancada)\r\n")
					return
				}
				write(o)
				if o.Close {
					_, _ = ch.SendRequest("exit-status", false, ssh.Marshal(struct{ C uint32 }{0}))
					return
				}
				prompt = o.Prompt
				fmt.Fprint(ch, prompt+" ")
			case c == 0x7f || c == 0x08:
				if len(buf) > 0 {
					_, sz := utf8.DecodeLastRune(buf)
					buf = buf[:len(buf)-sz]
					fmt.Fprint(ch, "\b \b")
				}
			case c == 0x03:
				buf = buf[:0]
				fmt.Fprint(ch, "^C\r\n"+prompt+" ")
			case c == 0x04:
				if len(buf) == 0 {
					fmt.Fprint(ch, "\r\n")
					bridgePush(bridgeEvt{Type: "line", Sess: id, Line: "exit"})
					if o, ok := wait(10 * time.Second); ok {
						write(o)
					}
					return
				}
			case c == 0x15:
				for range utf8.RuneCount(buf) {
					fmt.Fprint(ch, "\b \b")
				}
				buf = buf[:0]
			case c == '\t' || c < 0x20:
			default:
				buf = append(buf, c)
				_, _ = ch.Write([]byte{c})
			}
		}
	}
}

func (a *App) bridgeAPI(w http.ResponseWriter, r *http.Request, sub string) {
	switch sub {
	case "poll":
		bridge.Lock()
		bridge.lastPoll = time.Now()
		bridge.Unlock()
		deadline := time.After(25 * time.Second)
		for {
			bridge.Lock()
			if len(bridge.q) > 0 {
				q := bridge.q
				bridge.q = nil
				bridge.lastPoll = time.Now()
				bridge.Unlock()
				writeJSON(w, 200, map[string]any{"events": q})
				return
			}
			bridge.Unlock()
			select {
			case <-bridge.wake:
			case <-deadline:
				writeJSON(w, 200, map[string]any{"events": []bridgeEvt{}})
				return
			case <-r.Context().Done():
				return
			}
		}
	case "out":
		var o bridgeOut
		if err := decode(r, &o); err != nil {
			a.fail(w, err)
			return
		}
		bridge.Lock()
		ch := bridge.sess[o.Sess]
		bridge.Unlock()
		if ch != nil {
			select {
			case ch <- o:
			default:
			}
		}
		writeJSON(w, 200, map[string]any{"ok": ch != nil})
	case "config":
		var b struct {
			Ports []pubPort `json:"ports"`
			Lan   []lanReq  `json:"lan"`
		}
		if err := decode(r, &b); err != nil {
			a.fail(w, err)
			return
		}
		errs, lst := a.bridgeConfig(b.Ports, b.Lan)
		bridge.Lock()
		bind := bridge.bind
		bridge.Unlock()
		writeJSON(w, 200, map[string]any{"errors": errs, "bind": bind, "lan": lst, "local": localStatus(), "admin": isAdmin()})
	default:
		writeErr(w, 404, "rota inexistente")
	}
}

func closeBridge() {
	bridge.Lock()
	for p, l := range bridge.lns {
		l.ln.Close()
		delete(bridge.lns, p)
	}
	bridge.Unlock()
	lanSync(nil)
}
