// Bancada de Rede — executável único: servidor do lab + painel de controle.
package main

import (
	"crypto/rand"
	"embed"
	"encoding/hex"
	"flag"
	"fmt"
	"io/fs"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"syscall"
	"time"
)

var version = "5.0.0"

//go:embed public
var publicFS embed.FS

//go:embed assets/icon.ico
var iconICO []byte

func staticFS() fs.FS { sub, _ := fs.Sub(publicFS, "public"); return sub }

func envOr(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}

// baseDir: ao lado do executável se der para escrever lá (modo portátil), senão na pasta de configuração do usuário.
func baseDir() string {
	if exe, err := os.Executable(); err == nil {
		if real, err := filepath.EvalSymlinks(exe); err == nil {
			exe = real
		}
		dir := filepath.Dir(exe)
		probe := filepath.Join(dir, ".bancada-teste")
		if f, err := os.Create(probe); err == nil {
			f.Close()
			os.Remove(probe)
			return filepath.Join(dir, "bancada-dados")
		}
	}
	if d, err := os.UserConfigDir(); err == nil {
		return filepath.Join(d, "BancadaDeRede")
	}
	return "bancada-dados"
}

func randHex(n int) string { b := make([]byte, n); _, _ = rand.Read(b); return hex.EncodeToString(b) }

func main() {
	headless := flag.Bool("headless", false, "só o servidor, sem painel (para Docker e servidores)")
	port := flag.Int("port", 0, "porta do servidor (padrão 8080 ou variável PORT)")
	host := flag.String("host", "", "endereço de escuta no modo headless (padrão 0.0.0.0)")
	data := flag.String("data", "", "pasta de dados (padrão: ao lado do executável)")
	noBrowser := flag.Bool("no-browser", false, "Linux/macOS: não abrir o navegador ao iniciar")
	health := flag.Bool("healthcheck", false, "verifica se o servidor responde e sai (usado pelo Docker)")
	showVer := flag.Bool("version", false, "mostra a versão")
	ctFlag := flag.Bool("containers", false, "permite containers reais (Docker/Podman) nos hosts, mesmo fora do localhost")
	flag.Parse()
	if *ctFlag {
		containersFlag = true
	}

	if *showVer {
		fmt.Println("Bancada de Rede", version)
		return
	}
	if *health {
		p := *port
		if p == 0 {
			p, _ = strconv.Atoi(envOr("PORT", "8080"))
		}
		c := http.Client{Timeout: 3 * time.Second}
		r, err := c.Get(fmt.Sprintf("http://127.0.0.1:%d/api/health", p))
		if err != nil || r.StatusCode != 200 {
			os.Exit(1)
		}
		return
	}
	if *headless {
		runHeadless(*port, *host, *data)
		return
	}
	runDesktop(*port, *data, *noBrowser)
}

func runHeadless(port int, host, data string) {
	if port == 0 {
		port, _ = strconv.Atoi(envOr("PORT", "8080"))
	}
	if host == "" {
		host = envOr("HOST", "0.0.0.0")
	}
	if data == "" {
		data = envOr("DATA_DIR", filepath.Join(baseDir()))
	}
	abs, _ := filepath.Abs(data)
	m := &Manager{set: Settings{Port: port, DataDir: abs, Auth: os.Getenv("BASIC_AUTH")}, bindHost: host}
	if err := m.Start(); err != nil {
		os.Exit(1)
	}
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
	s := <-sig
	logf("Encerrando (%v)", s)
	m.Stop()
}

func runDesktop(port int, data string, noBrowser bool) {
	base := baseDir()
	cfgPath := filepath.Join(base, "configuracao.json")
	set := loadSettings(cfgPath, Settings{Port: 8080, DataDir: base})
	if port != 0 {
		set.Port = port
	}
	if data != "" {
		set.DataDir, _ = filepath.Abs(data)
	}
	m := &Manager{set: set, cfgPath: cfgPath}
	_ = saveSettings(cfgPath, set)
	logf("Bancada de Rede %s pronta. Dados em %s", version, set.DataDir)
	runUI(m, noBrowser)
}
