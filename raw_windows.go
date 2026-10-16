//go:build windows

package main

import (
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

// GUID ({...}) e tipo da placa pelo índice do Windows (o Npcap nomeia as placas pelo GUID)
func adapterGUID(it *net.Interface) (string, uint32, string) {
	size := uint32(15000)
	for i := 0; i < 3; i++ {
		buf := make([]byte, size)
		aa := (*windows.IpAdapterAddresses)(unsafe.Pointer(&buf[0]))
		err := windows.GetAdaptersAddresses(windows.AF_UNSPEC, windows.GAA_FLAG_INCLUDE_ALL_INTERFACES, 0, aa, &size)
		if err == windows.ERROR_BUFFER_OVERFLOW {
			continue
		}
		if err != nil {
			return "", 0, ""
		}
		for a := aa; a != nil; a = a.Next {
			if int(a.IfIndex) == it.Index || windows.UTF16PtrToString(a.FriendlyName) == it.Name {
				return windows.BytePtrToString(a.AdapterName), a.IfType, windows.UTF16PtrToString(a.Description)
			}
		}
		return "", 0, ""
	}
	return "", 0, ""
}

// Acesso à placa pelo Npcap (o mesmo driver do Wireshark), carregado em tempo de execução.
var npcap struct {
	once                                                     sync.Once
	err                                                      error
	findall, freeall, create, snaplen, promisc, timeout, imm *syscall.Proc
	activate, geterr, nextEx, send, closeP                   *syscall.Proc
}

func loadNpcap() error {
	npcap.once.Do(func() {
		dir := filepath.Join(os.Getenv("SystemRoot"), "System32", "Npcap")
		if k, err := syscall.LoadDLL("kernel32.dll"); err == nil {
			if p, err := k.FindProc("SetDllDirectoryW"); err == nil {
				d, _ := syscall.UTF16PtrFromString(dir)
				p.Call(uintptr(unsafe.Pointer(d)))
			}
		}
		dll, err := syscall.LoadDLL(filepath.Join(dir, "wpcap.dll"))
		if err != nil {
			dll, err = syscall.LoadDLL("wpcap.dll")
		}
		if err != nil {
			npcap.err = errors.New("o Npcap não está instalado — instale em https://npcap.com (o mesmo driver do Wireshark; deixe marcado “WinPcap API-compatible mode”) e abra a bancada de novo")
			return
		}
		get := func(n string) *syscall.Proc {
			p, e := dll.FindProc(n)
			if e != nil && npcap.err == nil {
				npcap.err = fmt.Errorf("Npcap incompleto (%s): reinstale em https://npcap.com", n)
			}
			return p
		}
		npcap.findall, npcap.freeall, npcap.create = get("pcap_findalldevs"), get("pcap_freealldevs"), get("pcap_create")
		npcap.snaplen, npcap.promisc, npcap.timeout = get("pcap_set_snaplen"), get("pcap_set_promisc"), get("pcap_set_timeout")
		npcap.imm, npcap.activate, npcap.geterr = get("pcap_set_immediate_mode"), get("pcap_activate"), get("pcap_geterr")
		npcap.nextEx, npcap.send, npcap.closeP = get("pcap_next_ex"), get("pcap_sendpacket"), get("pcap_close")
	})
	return npcap.err
}

type pcapIf struct {
	next        *pcapIf
	name        *byte
	description *byte
	addresses   *pcapAddr
	flags       uint32
}

type pcapAddr struct {
	next      *pcapAddr
	addr      *sockaddrIn
	netmask   *sockaddrIn
	broadaddr *sockaddrIn
	dstaddr   *sockaddrIn
}

type sockaddrIn struct {
	family uint16
	port   [2]byte
	addr   [4]byte
}

func cstr(p *byte) string {
	if p == nil {
		return ""
	}
	var b []byte
	for i := uintptr(0); ; i++ {
		c := *(*byte)(unsafe.Add(unsafe.Pointer(p), i))
		if c == 0 {
			break
		}
		b = append(b, c)
	}
	return string(b)
}

const pcapIfWireless = 0x00000008

// struct pcap_pkthdr no Windows: timeval com dois long de 32 bits, depois caplen e len
type pcapPkthdr struct {
	sec, usec int32
	caplen    uint32
	length    uint32
}

type npcapNIC struct {
	h      uintptr
	closed atomic.Bool
	wmu    sync.Mutex
	life   sync.RWMutex // Close espera leituras/escritas em andamento
}

func openRaw(it *net.Interface, hostIP net.IP) (rawNIC, bool, error) {
	if err := loadNpcap(); err != nil {
		return nil, false, err
	}
	if hostIP == nil {
		return nil, false, fmt.Errorf("a placa %s não tem IPv4", it.Name)
	}
	errbuf := make([]byte, 512)
	var all *pcapIf
	if r, _, _ := npcap.findall.Call(uintptr(unsafe.Pointer(&all)), uintptr(unsafe.Pointer(&errbuf[0]))); int32(r) != 0 || all == nil {
		return nil, false, fmt.Errorf("Npcap não listou as placas: %s", cstr(&errbuf[0]))
	}
	defer npcap.freeall.Call(uintptr(unsafe.Pointer(all)))
	// 1) pelo GUID da placa (\Device\NPF_{GUID}) — não depende da lista de IPs do Npcap
	guid, ifType, desc := adapterGUID(it)
	dev, wl := "", ifType == 71 // IF_TYPE_IEEE80211
	var seen []string
	for d := all; d != nil; d = d.next {
		nm := cstr(d.name)
		var ips []string
		for a := d.addresses; a != nil; a = a.next {
			if a.addr != nil && a.addr.family == 2 {
				ips = append(ips, net.IP(a.addr.addr[:]).String())
			}
		}
		dd := cstr(d.description)
		seen = append(seen, fmt.Sprintf("%s “%s” %v", strings.TrimPrefix(nm, `\Device\NPF_`), dd, ips))
		hit := guid != "" && strings.Contains(strings.ToUpper(nm), strings.ToUpper(guid))
		if !hit && desc != "" && dd != "" && (strings.Contains(dd, desc) || strings.Contains(desc, dd)) {
			hit = true
		}
		for _, ip := range ips {
			if ip == hostIP.String() {
				hit = true
			}
		}
		if hit && dev == "" {
			dev = nm
			if d.flags&pcapIfWireless != 0 {
				wl = true
			}
		}
	}
	if dev == "" && guid != "" {
		dev = `\Device\NPF_` + guid // não listada, mas tenta abrir direto
	}
	if dev == "" {
		logf("Npcap: placas vistas: %s", strings.Join(seen, " | "))
		return nil, false, fmt.Errorf("o Npcap não enxerga a placa %s (%s) — reinstale o Npcap ou escolha outra placa. Placas que o Npcap vê: %s", it.Name, hostIP, strings.Join(seen, "; "))
	}
	logf("Npcap: usando %s para a placa %s", dev, it.Name)
	name := append([]byte(dev), 0)
	open := func(promisc uintptr) (uintptr, error) {
		h, _, _ := npcap.create.Call(uintptr(unsafe.Pointer(&name[0])), uintptr(unsafe.Pointer(&errbuf[0])))
		if h == 0 {
			return 0, fmt.Errorf("Npcap: %s", cstr(&errbuf[0]))
		}
		npcap.snaplen.Call(h, 65535)
		npcap.promisc.Call(h, promisc)
		npcap.timeout.Call(h, 200)
		npcap.imm.Call(h, 1)
		if r, _, _ := npcap.activate.Call(h); int32(r) < 0 {
			e, _, _ := npcap.geterr.Call(h)
			msg := cstr((*byte)(unsafe.Pointer(e)))
			npcap.closeP.Call(h)
			return 0, errors.New(msg)
		}
		return h, nil
	}
	h, err := open(1)
	if err != nil {
		// algumas placas Wi-Fi não aceitam modo promíscuo
		if h2, err2 := open(0); err2 == nil {
			return &npcapNIC{h: h2}, true, nil
		}
		logf("Npcap: placas vistas: %s", strings.Join(seen, " | "))
		hint := "Reinstale o Npcap (npcap.com) e reinicie o computador"
		listed := false
		for _, x := range seen {
			if guid != "" && strings.Contains(strings.ToUpper(x), strings.ToUpper(guid)) {
				listed = true
			}
		}
		if !listed {
			hint = fmt.Sprintf("O driver do Npcap está desligado nesta placa. No PowerShell como administrador: Get-NetAdapterBinding -Name '%s' | Where-Object DisplayName -like '*Npcap*' | Enable-NetAdapterBinding  (se não aparecer nada, reinstale o Npcap e reinicie)", it.Name)
		}
		if !isAdmin() {
			hint = "Se o Npcap foi instalado com “Restrict Npcap driver's access to Administrators only”, abra a bancada como administrador (ou reinstale o Npcap sem essa opção)"
		}
		return nil, false, fmt.Errorf("o Npcap não conseguiu abrir a placa %s (%s, %s): %v. %s. Placas que o Npcap vê: %s", it.Name, hostIP, desc, err, hint, strings.Join(seen, "; "))
	}
	return &npcapNIC{h: h}, wl, nil
}

func (n *npcapNIC) Read() ([]byte, error) {
	n.life.RLock()
	defer n.life.RUnlock()
	if n.closed.Load() {
		return nil, errors.New("fechada")
	}
	var hdr *pcapPkthdr
	var data *byte
	r, _, _ := npcap.nextEx.Call(n.h, uintptr(unsafe.Pointer(&hdr)), uintptr(unsafe.Pointer(&data)))
	switch int32(r) {
	case 1:
		if hdr == nil || data == nil || hdr.caplen == 0 || hdr.caplen > 65535 {
			return nil, nil
		}
		return append([]byte(nil), unsafe.Slice(data, hdr.caplen)...), nil
	case 0:
		return nil, nil
	default:
		return nil, errors.New("erro de captura")
	}
}

func (n *npcapNIC) Write(b []byte) error {
	n.life.RLock()
	defer n.life.RUnlock()
	if n.closed.Load() || len(b) == 0 {
		return errors.New("fechada")
	}
	n.wmu.Lock()
	defer n.wmu.Unlock()
	if r, _, _ := npcap.send.Call(n.h, uintptr(unsafe.Pointer(&b[0])), uintptr(len(b))); int32(r) != 0 {
		return errors.New("pcap_sendpacket falhou")
	}
	return nil
}

func (n *npcapNIC) Close() {
	if n.closed.CompareAndSwap(false, true) {
		n.life.Lock()
		npcap.closeP.Call(n.h)
		n.life.Unlock()
	}
}
