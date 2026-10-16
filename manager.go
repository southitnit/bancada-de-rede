package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// ---------- log em memória (mostrado no painel) ----------

type LogLine struct {
	N   int    `json:"n"`
	T   string `json:"t"`
	Msg string `json:"msg"`
}
type LogBuf struct {
	mu    sync.Mutex
	lines []LogLine
	n     int
}

var LOGS = &LogBuf{}

func (b *LogBuf) Add(msg string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.n++
	b.lines = append(b.lines, LogLine{b.n, time.Now().Format("15:04:05"), msg})
	if len(b.lines) > 600 {
		b.lines = b.lines[len(b.lines)-600:]
	}
}
func (b *LogBuf) Since(n int) []LogLine {
	b.mu.Lock()
	defer b.mu.Unlock()
	out := []LogLine{}
	for _, l := range b.lines {
		if l.N > n {
			out = append(out, l)
		}
	}
	return out
}

func logf(format string, a ...any) {
	msg := fmt.Sprintf(format, a...)
	LOGS.Add(msg)
	fmt.Fprintf(os.Stderr, "%s %s\n", time.Now().Format("2006-01-02 15:04:05"), msg)
}

// ---------- configurações ----------

type Settings struct {
	Port      int    `json:"port"`
	LAN       bool   `json:"lan"`
	DataDir   string `json:"dataDir"`
	AutoStart bool   `json:"autoStart"`
	OpenApp   bool   `json:"openApp"`
	Auth      string `json:"auth"`
}

func loadSettings(path string, def Settings) Settings {
	s := def
	if b, err := os.ReadFile(path); err == nil {
		_ = json.Unmarshal(b, &s)
	}
	if s.Port < 1 || s.Port > 65535 {
		s.Port = def.Port
	}
	if strings.TrimSpace(s.DataDir) == "" {
		s.DataDir = def.DataDir
	}
	return s
}

func saveSettings(path string, s Settings) error {
	if path == "" {
		return nil
	}
	_ = os.MkdirAll(filepath.Dir(path), 0o755)
	b, _ := json.MarshalIndent(s, "", "  ")
	return writeAtomic(path, b)
}

// ---------- gerenciador do servidor ----------

type Manager struct {
	mu        sync.Mutex
	set       Settings
	cfgPath   string
	bindHost  string // sobrescreve o endereço (modo headless)
	srv       *http.Server
	started   time.Time
	lastErr   string
	listeners []func()
}

func (m *Manager) OnChange(f func()) {
	m.mu.Lock()
	m.listeners = append(m.listeners, f)
	m.mu.Unlock()
}
func (m *Manager) notify() {
	m.mu.Lock()
	ls := append([]func(){}, m.listeners...)
	m.mu.Unlock()
	for _, f := range ls {
		go f()
	}
}

func (m *Manager) host() string {
	if m.bindHost != "" {
		return m.bindHost
	}
	if m.set.LAN {
		return "0.0.0.0"
	}
	return "127.0.0.1"
}

func (m *Manager) Settings() Settings { m.mu.Lock(); defer m.mu.Unlock(); return m.set }
func (m *Manager) Running() bool      { m.mu.Lock(); defer m.mu.Unlock(); return m.srv != nil }
func (m *Manager) URL() string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return fmt.Sprintf("http://localhost:%d/", m.set.Port)
}

func friendlyListenErr(err error, port int) string {
	s := err.Error()
	if strings.Contains(s, "address already in use") || strings.Contains(s, "Only one usage") || strings.Contains(s, "normally permitted") {
		return fmt.Sprintf("A porta %d já está em uso por outro programa. Escolha outra porta nas configurações.", port)
	}
	if strings.Contains(s, "permission denied") || strings.Contains(s, "access permissions") {
		return fmt.Sprintf("Sem permissão para usar a porta %d. Use uma porta acima de 1024.", port)
	}
	return s
}

func (m *Manager) Start() error {
	m.mu.Lock()
	if m.srv != nil {
		m.mu.Unlock()
		return nil
	}
	set := m.set
	addr := net.JoinHostPort(m.host(), fmt.Sprint(set.Port))
	if err := os.MkdirAll(filepath.Join(set.DataDir, "labs"), 0o755); err != nil {
		m.lastErr = "Não foi possível criar a pasta de dados: " + err.Error()
		m.mu.Unlock()
		logf("%s", m.lastErr)
		m.notify()
		return errors.New(m.lastErr)
	}
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		m.lastErr = friendlyListenErr(err, set.Port)
		m.mu.Unlock()
		logf("Falha ao iniciar: %s", m.lastErr)
		m.notify()
		return errors.New(m.lastErr)
	}
	app := NewApp(NewStore(set.DataDir), set.Auth, staticFS())
	setBridgeBind(m.host())
	srv := &http.Server{Handler: app, ReadHeaderTimeout: 15 * time.Second}
	m.srv, m.started, m.lastErr = srv, time.Now(), ""
	m.mu.Unlock()
	go func() {
		if err := srv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
			m.mu.Lock()
			if m.srv == srv {
				m.srv, m.lastErr = nil, err.Error()
			}
			m.mu.Unlock()
			logf("Servidor caiu: %v", err)
			m.notify()
		}
	}()
	auth := ""
	if set.Auth != "" {
		auth = " — com senha"
	}
	logf("Servidor iniciado em http://localhost:%d/ (escutando em %s)%s", set.Port, addr, auth)
	logf("Dados em %s", set.DataDir)
	m.notify()
	return nil
}

func (m *Manager) Stop() {
	closeBridge()
	m.mu.Lock()
	srv := m.srv
	m.srv = nil
	m.mu.Unlock()
	if srv == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	_ = srv.Shutdown(ctx)
	logf("Servidor parado")
	m.notify()
}

func (m *Manager) Restart() error { m.Stop(); return m.Start() }

// Apply troca as configurações e reinicia o servidor se algo que importa mudou.
func (m *Manager) Apply(s Settings) error {
	m.mu.Lock()
	old := m.set
	m.set = s
	running := m.srv != nil || m.lastErr != ""
	path := m.cfgPath
	m.mu.Unlock()
	if err := saveSettings(path, s); err != nil {
		logf("Não consegui gravar as configurações: %v", err)
	}
	logf("Configurações salvas")
	if running && (old.Port != s.Port || old.LAN != s.LAN || old.DataDir != s.DataDir || old.Auth != s.Auth) {
		return m.Restart()
	}
	m.notify()
	return nil
}

func lanIPs() []string {
	out := []string{}
	ifs, _ := net.Interfaces()
	for _, i := range ifs {
		if i.Flags&net.FlagUp == 0 || i.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, _ := i.Addrs()
		for _, a := range addrs {
			if ipn, ok := a.(*net.IPNet); ok && ipn.IP.To4() != nil {
				out = append(out, ipn.IP.String())
			}
		}
	}
	return out
}

func (m *Manager) Status() map[string]any {
	m.mu.Lock()
	defer m.mu.Unlock()
	st := map[string]any{"version": version, "running": m.srv != nil, "port": m.set.Port, "lan": m.set.LAN, "dataDir": m.set.DataDir,
		"error": m.lastErr, "pid": os.Getpid(), "url": fmt.Sprintf("http://localhost:%d/", m.set.Port), "settings": m.set,
		"labs": NewStore(m.set.DataDir).Count(), "configFile": m.cfgPath}
	if m.srv != nil {
		st["since"] = m.started.Format(time.RFC3339)
		st["uptime"] = int(time.Since(m.started).Seconds())
		if m.set.LAN {
			urls := []string{}
			for _, ip := range lanIPs() {
				urls = append(urls, fmt.Sprintf("http://%s:%d/", ip, m.set.Port))
			}
			st["lanUrls"] = urls
		}
	}
	return st
}
