//go:build windows && amd64

// Acesso aos IPs do lab a partir do PRÓPRIO computador (Windows).
//
// Quadros que a bancada injeta na placa saem para a rede e não voltam ao Windows, então
// o computador não enxergaria os equipamentos do lab. Com o WinDivert (driver assinado,
// usado só enquanto há equipamentos na rede), os pacotes que o Windows manda para esses
// IPs são desviados antes de sair, entregues à pilha do equipamento, e as respostas são
// devolvidas ao Windows como se tivessem chegado pela placa. Nada da configuração de rede
// do computador é alterado; se a bancada fechar, tudo volta ao normal na hora.
package main

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"syscall"
	"time"
	"unsafe"
)

const (
	wdURL    = "https://github.com/basil00/WinDivert/releases/download/v2.2.2/WinDivert-2.2.2-A.zip"
	wdSHA256 = "63cb41763bb4b20f600b6de04e991a9c2be73279e317d4d82f237b150c5f3f15"
)

var loc struct {
	sync.Mutex
	h        uintptr
	ips      string
	tmpl     [80]byte // WINDIVERT_ADDRESS de um pacote real (interface), com Outbound=0
	haveTmpl bool
	state    string
	err      string
	smu      sync.Mutex
}

var wd struct {
	once                                    sync.Once
	err                                     error
	open, recv, send, close, shutdown, csum *syscall.Proc
}

func wdFiles() (string, error) {
	dir := filepath.Join(lanDataDir, "windivert")
	dll, sys := filepath.Join(dir, "WinDivert.dll"), filepath.Join(dir, "WinDivert64.sys")
	if fileExists(dll) && fileExists(sys) {
		return dll, nil
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	cl := &http.Client{Timeout: 60 * time.Second, Transport: &http.Transport{Proxy: http.ProxyFromEnvironment}}
	r, err := cl.Get(wdURL)
	if err != nil {
		return "", fmt.Errorf("não consegui baixar o WinDivert (%v). Baixe %s e copie WinDivert.dll e WinDivert64.sys (pasta x64) para %s", err, wdURL, dir)
	}
	defer r.Body.Close()
	b, err := io.ReadAll(io.LimitReader(r.Body, 8<<20))
	if err != nil || r.StatusCode != 200 {
		return "", fmt.Errorf("não consegui baixar o WinDivert (HTTP %d). Baixe %s e copie WinDivert.dll e WinDivert64.sys (pasta x64) para %s", r.StatusCode, wdURL, dir)
	}
	sum := sha256.Sum256(b)
	if hex.EncodeToString(sum[:]) != wdSHA256 {
		return "", errors.New("o arquivo do WinDivert baixado não confere (sha256) — não vou usar")
	}
	zr, err := zip.NewReader(bytes.NewReader(b), int64(len(b)))
	if err != nil {
		return "", err
	}
	for _, f := range zr.File {
		base := filepath.Base(f.Name)
		if !strings.Contains(f.Name, "/x64/") || (base != "WinDivert.dll" && base != "WinDivert64.sys") {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			return "", err
		}
		data, _ := io.ReadAll(rc)
		rc.Close()
		if err := os.WriteFile(filepath.Join(dir, base), data, 0o644); err != nil {
			return "", err
		}
	}
	if !fileExists(dll) || !fileExists(sys) {
		return "", errors.New("pacote do WinDivert incompleto")
	}
	return dll, nil
}

func wdLoad() error {
	wd.once.Do(func() {
		p, err := wdFiles()
		if err != nil {
			wd.err = err
			return
		}
		dll, err := syscall.LoadDLL(p)
		if err != nil {
			wd.err = fmt.Errorf("WinDivert.dll não carregou (%v) — o antivírus pode ter bloqueado o arquivo em %s", err, filepath.Dir(p))
			return
		}
		get := func(n string) *syscall.Proc {
			x, e := dll.FindProc(n)
			if e != nil && wd.err == nil {
				wd.err = fmt.Errorf("WinDivert incompleto (%s)", n)
			}
			return x
		}
		wd.open, wd.recv, wd.send = get("WinDivertOpen"), get("WinDivertRecv"), get("WinDivertSend")
		wd.close, wd.shutdown, wd.csum = get("WinDivertClose"), get("WinDivertShutdown"), get("WinDivertHelperCalcChecksums")
	})
	return wd.err
}

func setLocal(state, err string) {
	loc.smu.Lock()
	loc.state, loc.err = state, err
	loc.smu.Unlock()
	bridgePush(bridgeEvt{Type: "local", Local: map[string]string{"state": state, "err": err}})
}

func localStatus() map[string]string {
	loc.smu.Lock()
	defer loc.smu.Unlock()
	if loc.state == "" {
		return nil
	}
	return map[string]string{"state": loc.state, "err": loc.err}
}

var locApplyMu sync.Mutex

func localRefresh() { go localApply(lanReadyIPs()) }

func localApply(ips []string) {
	locApplyMu.Lock()
	defer locApplyMu.Unlock()
	sort.Strings(ips)
	key := strings.Join(ips, ",")
	loc.Lock()
	same := key == loc.ips && (loc.h != 0 || key == "")
	loc.Unlock()
	if same {
		return
	}
	loc.Lock()
	old := loc.h
	loc.h, loc.ips, loc.haveTmpl = 0, key, false
	loc.Unlock()
	if old != 0 {
		wd.shutdown.Call(old, 3)
		wd.close.Call(old)
	}
	if len(ips) == 0 {
		setLocal("", "")
		return
	}
	if !isAdmin() {
		setLocal("erro", "para acessar os equipamentos a partir deste computador, abra a bancada como administrador")
		return
	}
	if err := wdLoad(); err != nil {
		setLocal("erro", err.Error())
		return
	}
	parts := make([]string, len(ips))
	for i, ip := range ips {
		parts[i] = "ip.DstAddr == " + ip
	}
	filter := append([]byte("outbound and !loopback and ip and ("+strings.Join(parts, " or ")+")"), 0)
	h, _, e := wd.open.Call(uintptr(unsafe.Pointer(&filter[0])), 0, 0, 0)
	if h == 0 || h == ^uintptr(0) {
		setLocal("erro", fmt.Sprintf("WinDivert não abriu (%v)", e))
		loc.Lock()
		loc.ips = ""
		loc.Unlock()
		return
	}
	loc.Lock()
	loc.h = h
	loc.Unlock()
	setLocal("ok", "")
	logf("Acesso deste computador aos IPs do lab ativo: %s", key)
	go localRecv(h)
}

func localRecv(h uintptr) {
	buf := make([]byte, 65535)
	var addr [80]byte
	for {
		var n uint32
		r, _, _ := wd.recv.Call(h, uintptr(unsafe.Pointer(&buf[0])), uintptr(len(buf)), uintptr(unsafe.Pointer(&n)), uintptr(unsafe.Pointer(&addr[0])))
		if r == 0 {
			loc.Lock()
			cur := loc.h
			loc.Unlock()
			if cur != h {
				return
			}
			time.Sleep(50 * time.Millisecond)
			continue
		}
		if n < 20 || buf[0]>>4 != 4 {
			continue
		}
		pkt := append([]byte(nil), buf[:n]...)
		dst := net.IP(pkt[16:20])
		t := addr
		w := binary.LittleEndian.Uint32(t[8:12])
		w &^= 1 << 17 // Outbound = 0 → entregue ao Windows como recebido
		binary.LittleEndian.PutUint32(t[8:12], w)
		loc.Lock()
		loc.tmpl, loc.haveTmpl = t, true
		loc.Unlock()
		if pkt[9] == 6 && len(pkt) >= 40 {
			ihl := int(pkt[0]&0x0f) * 4
			if len(pkt) >= ihl+14 && pkt[ihl+13]&0x12 == 0x02 { // SYN sem ACK: uma linha por conexão no log
				logf("Deste computador → %s:%d (TCP)", dst, binary.BigEndian.Uint16(pkt[ihl+2:ihl+4]))
			}
		}
		if !localInject(dst, pkt) {
			logf("Deste computador → %s: nenhum equipamento do lab pronto com este IP; o pacote seguiu para a rede", dst)
			// ninguém do lab com este IP agora: deixa o pacote seguir normalmente
			wd.send.Call(h, uintptr(unsafe.Pointer(&pkt[0])), uintptr(len(pkt)), 0, uintptr(unsafe.Pointer(&addr[0])))
		}
	}
}

// resposta de um equipamento do lab para o próprio computador
func localDeliver(h *lanHost, fr []byte) bool {
	if len(fr) < 34 || binary.BigEndian.Uint16(fr[12:14]) != 0x0800 || h.nic.hostIP == nil || !net.IP(fr[30:34]).Equal(h.nic.hostIP) {
		return false
	}
	loc.Lock()
	hd, t, ok := loc.h, loc.tmpl, loc.haveTmpl
	loc.Unlock()
	if hd == 0 || !ok {
		return true // não adianta mandar pelo cabo: não voltaria ao computador
	}
	ip := append([]byte(nil), fr[14:]...)
	wd.csum.Call(uintptr(unsafe.Pointer(&ip[0])), uintptr(len(ip)), uintptr(unsafe.Pointer(&t[0])), 0)
	wd.send.Call(hd, uintptr(unsafe.Pointer(&ip[0])), uintptr(len(ip)), 0, uintptr(unsafe.Pointer(&t[0])))
	return true
}
