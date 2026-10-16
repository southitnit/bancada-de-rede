// Equipamentos do lab presentes de verdade na rede do computador.
//
// Cada IP do lab ligado à nuvem Internet real vira um "aparelho" a mais na sua LAN:
// a bancada fala direto com a placa de rede (Npcap no Windows, AF_PACKET no Linux),
// pega IP automático no DHCP do roteador (ou usa o IP do lab, se fixo), responde ARP,
// ping e aceita conexões TCP com uma pilha TCP/IP em espaço de usuário (gVisor netstack).
// A configuração de rede do computador NÃO é alterada.
package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"fmt"
	"math/rand"
	"net"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"gvisor.dev/gvisor/pkg/buffer"
	"gvisor.dev/gvisor/pkg/tcpip"
	"gvisor.dev/gvisor/pkg/tcpip/adapters/gonet"
	"gvisor.dev/gvisor/pkg/tcpip/header"
	"gvisor.dev/gvisor/pkg/tcpip/link/channel"
	"gvisor.dev/gvisor/pkg/tcpip/link/ethernet"
	"gvisor.dev/gvisor/pkg/tcpip/network/arp"
	"gvisor.dev/gvisor/pkg/tcpip/network/ipv4"
	"gvisor.dev/gvisor/pkg/tcpip/stack"
	"gvisor.dev/gvisor/pkg/tcpip/transport/icmp"
	"gvisor.dev/gvisor/pkg/tcpip/transport/tcp"
	"gvisor.dev/gvisor/pkg/tcpip/transport/udp"
	"gvisor.dev/gvisor/pkg/waiter"
)

// placa de rede crua (envia e recebe quadros Ethernet inteiros)
type rawNIC interface {
	Read() ([]byte, error) // nil, nil = tempo esgotado (tenta de novo)
	Write([]byte) error
	Close()
}

// pedido do navegador: um IP do lab que deve existir na rede real
type lanReq struct {
	Key   string            `json:"key"`   // dispositivo|interface
	Name  string            `json:"name"`  // hostname enviado ao DHCP
	Mode  string            `json:"mode"`  // dhcp | static
	IP    string            `json:"ip"`    // IP do lab (modo static)
	Len   int               `json:"len"`   // prefixo da rede da nuvem
	GW    string            `json:"gw"`    // gateway da nuvem (modo static)
	Iface string            `json:"iface"` // placa escolhida (vazio = automática)
	MAC   string            `json:"mac"`   // auto | own | host
	Ports []int             `json:"ports"` // portas TCP atendidas neste IP (22, 80, 443, encaminhamentos)
	Pass  string            `json:"pass"`  // senha SSH de fora
	Real  map[string]string `json:"real"`  // porta → 127.0.0.1:porta de container real
}

type lanStat struct {
	Key   string `json:"key"`
	State string `json:"state"` // pedindo | ok | erro
	IP    string `json:"ip,omitempty"`
	Len   int    `json:"len,omitempty"`
	GW    string `json:"gw,omitempty"`
	DNS   string `json:"dns,omitempty"`
	MAC   string `json:"mac,omitempty"`
	Iface string `json:"iface,omitempty"`
	Err   string `json:"err,omitempty"`
	Seq   uint64 `json:"seq"`
}

var lanSeq atomic.Uint64

type lanNIC struct {
	name     string
	raw      rawNIC
	hostMAC  net.HardwareAddr
	hostIP   net.IP
	wireless bool
	refs     int
	mu       sync.Mutex
	hooks    map[int]func([]byte)
	hookN    int
	closed   chan struct{}
}

type lanHost struct {
	req    lanReq
	nic    *lanNIC
	mac    net.HardwareAddr // MAC usado nos quadros (próprio ou o do PC)
	cid    net.HardwareAddr // identificador do cliente DHCP (sempre próprio)
	ip     net.IP
	plen   int
	gw     net.IP
	dns    net.IP
	srvIP  net.IP
	srvMAC net.HardwareAddr
	lease  time.Duration
	st     *stack.Stack
	ch     *channel.Endpoint
	ctx    context.Context
	cancel context.CancelFunc
	stat   lanStat
	ready  bool
}

var lanMgr = struct {
	sync.Mutex
	nics  map[string]*lanNIC
	hosts map[string]*lanHost
}{nics: map[string]*lanNIC{}, hosts: map[string]*lanHost{}}

var lanDataDir = "."

var bcastMAC = net.HardwareAddr{0xff, 0xff, 0xff, 0xff, 0xff, 0xff}

func virtMAC(key string) net.HardwareAddr {
	h := sha256.Sum256([]byte("bancada-lan|" + key))
	return net.HardwareAddr{0x02, 0xbd, h[0], h[1], h[2], h[3]}
}

func (h *lanHost) setStat(s lanStat) {
	s.Key = h.req.Key
	s.Seq = lanSeq.Add(1)
	s.MAC = h.mac.String()
	s.Iface = h.nic.name
	lanMgr.Lock()
	h.stat = s
	h.ready = s.State == "ok"
	lanMgr.Unlock()
	localRefresh()
	bridgePush(bridgeEvt{Type: "lan", Sess: h.req.Key, Lan: &s})
}

// ---------- placa ----------

func openLanNIC(iface string) (*lanNIC, error) {
	if n := lanMgr.nics[iface]; n != nil {
		n.refs++
		return n, nil
	}
	it, err := net.InterfaceByName(iface)
	if err != nil {
		return nil, fmt.Errorf("placa %q não encontrada", iface)
	}
	var hip net.IP
	addrs, _ := it.Addrs()
	for _, a := range addrs {
		if n, ok := a.(*net.IPNet); ok && n.IP.To4() != nil && !n.IP.IsLinkLocalUnicast() {
			hip = n.IP.To4()
			break
		}
	}
	raw, wl, err := openRaw(it, hip)
	if err != nil {
		return nil, err
	}
	n := &lanNIC{name: iface, raw: raw, hostMAC: it.HardwareAddr, hostIP: hip, wireless: wl, refs: 1, hooks: map[int]func([]byte){}, closed: make(chan struct{})}
	lanMgr.nics[iface] = n
	go n.readLoop()
	logf("Placa %s aberta em modo bruto (%s, MAC %s%s)", iface, hip, it.HardwareAddr, map[bool]string{true: ", Wi-Fi", false: ""}[wl])
	return n, nil
}

func (n *lanNIC) release() {
	n.refs--
	if n.refs > 0 {
		return
	}
	delete(lanMgr.nics, n.name)
	close(n.closed)
	n.raw.Close()
}

func (n *lanNIC) hook(f func([]byte)) func() {
	n.mu.Lock()
	n.hookN++
	id := n.hookN
	n.hooks[id] = f
	n.mu.Unlock()
	return func() { n.mu.Lock(); delete(n.hooks, id); n.mu.Unlock() }
}

func (n *lanNIC) readLoop() {
	for {
		select {
		case <-n.closed:
			return
		default:
		}
		fr, err := n.raw.Read()
		if err != nil {
			select {
			case <-n.closed:
				return
			default:
			}
			time.Sleep(200 * time.Millisecond)
			continue
		}
		if len(fr) < 14 {
			continue
		}
		src := net.HardwareAddr(fr[6:12])
		if bytes.Equal(src, n.hostMAC) {
			continue // quadros que o próprio computador (ou nós, no modo Wi-Fi) mandou
		}
		type tgt struct {
			ip  net.IP
			mac net.HardwareAddr
			ch  *channel.Endpoint
		}
		lanMgr.Lock()
		var hs []tgt
		own := false
		for _, h := range lanMgr.hosts {
			if h.nic != n {
				continue
			}
			if bytes.Equal(src, h.mac) {
				own = true
			}
			if h.ready && h.ch != nil {
				hs = append(hs, tgt{h.ip, h.mac, h.ch})
			}
		}
		lanMgr.Unlock()
		if own {
			continue
		}
		n.mu.Lock()
		hk := make([]func([]byte), 0, len(n.hooks))
		for _, f := range n.hooks {
			hk = append(hk, f)
		}
		n.mu.Unlock()
		for _, f := range hk {
			f(fr)
		}
		dst := net.HardwareAddr(fr[0:6])
		et := binary.BigEndian.Uint16(fr[12:14])
		var tip net.IP
		switch {
		case et == 0x0806 && len(fr) >= 42:
			tip = net.IP(fr[38:42])
		case et == 0x0800 && len(fr) >= 34:
			tip = net.IP(fr[30:34])
		default:
			continue
		}
		for _, h := range hs {
			if !tip.Equal(h.ip) || !(bytes.Equal(dst, h.mac) || bytes.Equal(dst, bcastMAC)) {
				continue
			}
			pkt := stack.NewPacketBuffer(stack.PacketBufferOptions{Payload: buffer.MakeWithData(append([]byte(nil), fr...))})
			h.ch.InjectInbound(0, pkt)
			pkt.DecRef()
		}
	}
}

// ---------- quadros ----------

func csum(b []byte) uint16 {
	var s uint32
	for i := 0; i+1 < len(b); i += 2 {
		s += uint32(b[i])<<8 | uint32(b[i+1])
	}
	if len(b)%2 == 1 {
		s += uint32(b[len(b)-1]) << 8
	}
	for s>>16 != 0 {
		s = s&0xffff + s>>16
	}
	return ^uint16(s)
}

func udpFrame(srcMAC, dstMAC net.HardwareAddr, src, dst net.IP, sp, dp uint16, payload []byte) []byte {
	ip := make([]byte, 20)
	ul := 8 + len(payload)
	ip[0] = 0x45
	binary.BigEndian.PutUint16(ip[2:], uint16(20+ul))
	binary.BigEndian.PutUint16(ip[4:], uint16(rand.Intn(65535)))
	ip[8] = 64
	ip[9] = 17
	copy(ip[12:16], src.To4())
	copy(ip[16:20], dst.To4())
	binary.BigEndian.PutUint16(ip[10:], csum(ip))
	u := make([]byte, 8)
	binary.BigEndian.PutUint16(u[0:], sp)
	binary.BigEndian.PutUint16(u[2:], dp)
	binary.BigEndian.PutUint16(u[4:], uint16(ul))
	fr := append(append(append([]byte{}, dstMAC...), srcMAC...), 0x08, 0x00)
	return append(append(append(fr, ip...), u...), payload...)
}

func arpFrame(op uint16, srcMAC net.HardwareAddr, sip net.IP, dstMAC, tha net.HardwareAddr, tip net.IP) []byte {
	fr := append(append(append([]byte{}, dstMAC...), srcMAC...), 0x08, 0x06)
	a := []byte{0, 1, 8, 0, 6, 4, byte(op >> 8), byte(op)}
	a = append(append(a, srcMAC...), sip.To4()...)
	a = append(append(a, tha...), tip.To4()...)
	fr = append(fr, a...)
	for len(fr) < 60 {
		fr = append(fr, 0)
	}
	return fr
}

// alguém já responde por este IP na rede? (sonda ARP, RFC 5227)
func (h *lanHost) arpProbe(ip net.IP) bool {
	got := make(chan struct{}, 1)
	un := h.nic.hook(func(fr []byte) {
		if len(fr) >= 42 && binary.BigEndian.Uint16(fr[12:14]) == 0x0806 && binary.BigEndian.Uint16(fr[20:22]) == 2 && net.IP(fr[28:32]).Equal(ip) {
			select {
			case got <- struct{}{}:
			default:
			}
		}
	})
	defer un()
	for i := 0; i < 3; i++ {
		_ = h.nic.raw.Write(arpFrame(1, h.mac, net.IPv4zero, bcastMAC, make(net.HardwareAddr, 6), ip))
		select {
		case <-got:
			return true
		case <-time.After(400 * time.Millisecond):
		case <-h.ctx.Done():
			return false
		}
	}
	return false
}

// ---------- DHCP ----------

type dhcpMsg struct {
	op       byte
	xid      uint32
	yiaddr   net.IP
	opts     map[byte][]byte
	srcMAC   net.HardwareAddr
	typ      byte
	serverIP net.IP
}

func (h *lanHost) dhcpPacket(typ byte, xid uint32, ciaddr net.IP, extra map[byte][]byte) []byte {
	b := make([]byte, 240)
	b[0], b[1], b[2] = 1, 1, 6
	binary.BigEndian.PutUint32(b[4:], xid)
	if ciaddr == nil {
		binary.BigEndian.PutUint16(b[10:], 0x8000) // respostas em broadcast
	} else {
		copy(b[12:16], ciaddr.To4())
	}
	copy(b[28:34], h.mac)
	copy(b[236:240], []byte{99, 130, 83, 99})
	b = append(b, 53, 1, typ)
	b = append(b, 61, 7, 1)
	b = append(b, h.cid...)
	if hn := dhcpHostname(h.req.Name); hn != "" && typ != 7 {
		b = append(b, 12, byte(len(hn)))
		b = append(b, hn...)
	}
	if typ == 1 || typ == 3 {
		b = append(b, 55, 6, 1, 3, 6, 15, 51, 54)
	}
	for _, k := range []byte{50, 54} {
		if v, ok := extra[k]; ok {
			b = append(b, k, byte(len(v)))
			b = append(b, v...)
		}
	}
	b = append(b, 255)
	for len(b) < 300 {
		b = append(b, 0)
	}
	return b
}

var hnRe = regexp.MustCompile(`[^A-Za-z0-9-]+`)

func dhcpHostname(s string) string {
	s = strings.Trim(hnRe.ReplaceAllString(s, "-"), "-")
	if len(s) > 32 {
		s = s[:32]
	}
	return s
}

func parseDHCP(fr []byte) *dhcpMsg {
	if len(fr) < 14+20+8+240 || binary.BigEndian.Uint16(fr[12:14]) != 0x0800 || fr[23] != 17 {
		return nil
	}
	ihl := int(fr[14]&0x0f) * 4
	u := 14 + ihl
	if len(fr) < u+8+240 || binary.BigEndian.Uint16(fr[u+2:u+4]) != 68 {
		return nil
	}
	d := fr[u+8:]
	if d[0] != 2 || !bytes.Equal(d[236:240], []byte{99, 130, 83, 99}) {
		return nil
	}
	m := &dhcpMsg{op: d[0], xid: binary.BigEndian.Uint32(d[4:8]), yiaddr: net.IP(append([]byte(nil), d[16:20]...)), opts: map[byte][]byte{}, srcMAC: append(net.HardwareAddr(nil), fr[6:12]...)}
	o := d[240:]
	for i := 0; i < len(o); {
		k := o[i]
		if k == 255 {
			break
		}
		if k == 0 {
			i++
			continue
		}
		if i+1 >= len(o) || i+2+int(o[i+1]) > len(o) {
			break
		}
		m.opts[k] = o[i+2 : i+2+int(o[i+1])]
		i += 2 + int(o[i+1])
	}
	if v := m.opts[53]; len(v) == 1 {
		m.typ = v[0]
	}
	if v := m.opts[54]; len(v) == 4 {
		m.serverIP = net.IP(append([]byte(nil), v...))
	}
	return m
}

func (h *lanHost) dhcpExchange(typ byte, xid uint32, ciaddr net.IP, extra map[byte][]byte, want func(*dhcpMsg) bool, tries int, wait time.Duration, dstMAC net.HardwareAddr, dstIP net.IP) *dhcpMsg {
	ch := make(chan *dhcpMsg, 4)
	un := h.nic.hook(func(fr []byte) {
		if m := parseDHCP(fr); m != nil && m.xid == xid && want(m) {
			select {
			case ch <- m:
			default:
			}
		}
	})
	defer un()
	src := net.IPv4zero
	if ciaddr != nil {
		src = ciaddr
	}
	if dstMAC == nil {
		dstMAC, dstIP = bcastMAC, net.IPv4bcast
	}
	for i := 0; i < tries; i++ {
		_ = h.nic.raw.Write(udpFrame(h.mac, dstMAC, src, dstIP, 68, 67, h.dhcpPacket(typ, xid, ciaddr, extra)))
		select {
		case m := <-ch:
			return m
		case <-time.After(wait):
		case <-h.ctx.Done():
			return nil
		}
	}
	return nil
}

func (h *lanHost) dhcpAcquire() error {
	for round := 0; round < 3; round++ {
		xid := rand.Uint32()
		off := h.dhcpExchange(1, xid, nil, nil, func(m *dhcpMsg) bool { return m.typ == 2 }, 4, 3*time.Second, nil, nil)
		if off == nil {
			if h.ctx.Err() != nil {
				return h.ctx.Err()
			}
			return errors.New("o roteador não respondeu ao DHCP (sem servidor DHCP nesta rede, ou a placa Wi-Fi descarta quadros com outro MAC — tente o modo de endereço “IP do lab” ou o MAC do computador)")
		}
		if err := h.checkOffer(off.yiaddr); err != nil {
			return err
		}
		ack := h.dhcpExchange(3, xid, nil, map[byte][]byte{50: off.yiaddr.To4(), 54: off.serverIP.To4()}, func(m *dhcpMsg) bool { return m.typ == 5 || m.typ == 6 }, 3, 3*time.Second, nil, nil)
		if ack == nil {
			continue
		}
		if ack.typ == 6 {
			continue
		}
		h.applyLease(ack)
		return nil
	}
	return errors.New("o servidor DHCP não confirmou o endereço")
}

func (h *lanHost) checkOffer(ip net.IP) error {
	if ip.Equal(h.nic.hostIP) {
		return errors.New("o roteador ofereceu o mesmo IP do computador (ele identifica os aparelhos só pelo MAC e na Wi-Fi todos usam o MAC do PC) — use o endereço “IP do lab” (fixo) para este equipamento")
	}
	lanMgr.Lock()
	defer lanMgr.Unlock()
	for _, o := range lanMgr.hosts {
		if o != h && o.ip != nil && o.ip.Equal(ip) {
			return fmt.Errorf("o roteador ofereceu %s, que já está com %s — use o endereço “IP do lab” (fixo)", ip, o.req.Name)
		}
	}
	return nil
}

func (h *lanHost) applyLease(m *dhcpMsg) {
	h.ip = m.yiaddr.To4()
	h.plen = 24
	if v := m.opts[1]; len(v) == 4 {
		h.plen, _ = net.IPMask(v).Size()
	}
	if v := m.opts[3]; len(v) >= 4 {
		h.gw = net.IP(append([]byte(nil), v[:4]...))
	}
	if v := m.opts[6]; len(v) >= 4 {
		h.dns = net.IP(append([]byte(nil), v[:4]...))
	}
	h.srvIP = m.serverIP
	h.srvMAC = m.srcMAC
	h.lease = leaseTime(m)
}

func leaseTime(m *dhcpMsg) time.Duration {
	if v := m.opts[51]; len(v) == 4 {
		if s := binary.BigEndian.Uint32(v); s > 0 && s < 0xffffffff {
			return time.Duration(s) * time.Second
		}
	}
	return 24 * time.Hour
}

func (h *lanHost) renewLoop(lease time.Duration) {
	for {
		t1 := lease / 2
		if t1 < 30*time.Second {
			t1 = 30 * time.Second
		}
		select {
		case <-h.ctx.Done():
			return
		case <-time.After(t1):
		}
		ack := h.dhcpExchange(3, rand.Uint32(), h.ip, nil, func(m *dhcpMsg) bool { return m.typ == 5 || m.typ == 6 }, 3, 4*time.Second, h.srvMAC, h.srvIP)
		if ack == nil {
			ack = h.dhcpExchange(3, rand.Uint32(), nil, map[byte][]byte{50: h.ip.To4()}, func(m *dhcpMsg) bool { return m.typ == 5 || m.typ == 6 }, 3, 4*time.Second, nil, nil)
		}
		if ack != nil && ack.typ == 5 && ack.yiaddr.Equal(h.ip) {
			lease = leaseTime(ack)
			continue
		}
		if ack != nil && ack.typ == 6 {
			h.setStat(lanStat{State: "erro", Err: "o roteador recusou a renovação do IP (DHCPNAK)"})
			return
		}
		lease = t1 // tenta de novo na metade do tempo que sobrou
	}
}

func (h *lanHost) release() {
	if h.req.Mode == "static" || h.ip == nil || h.srvIP == nil || h.srvMAC == nil {
		return
	}
	pkt := h.dhcpPacket(7, rand.Uint32(), h.ip, map[byte][]byte{54: h.srvIP.To4()})
	_ = h.nic.raw.Write(udpFrame(h.mac, h.srvMAC, h.ip, h.srvIP, 68, 67, pkt))
}

// ---------- pilha TCP/IP ----------

func (h *lanHost) startStack() error {
	s := stack.New(stack.Options{
		NetworkProtocols:   []stack.NetworkProtocolFactory{ipv4.NewProtocol, arp.NewProtocol},
		TransportProtocols: []stack.TransportProtocolFactory{tcp.NewProtocol, udp.NewProtocol, icmp.NewProtocol4},
	})
	ch := channel.New(1024, 1500, tcpip.LinkAddress(h.mac))
	// quadros capturados podem vir com checksum por fazer (offload da placa): não descarta por isso
	ch.LinkEPCapabilities |= stack.CapabilityRXChecksumOffload
	if err := s.CreateNIC(1, ethernet.New(ch)); err != nil {
		return fmt.Errorf("pilha: %s", err)
	}
	addr := tcpip.AddrFrom4Slice(h.ip.To4())
	if err := s.AddProtocolAddress(1, tcpip.ProtocolAddress{Protocol: ipv4.ProtocolNumber, AddressWithPrefix: tcpip.AddressWithPrefix{Address: addr, PrefixLen: h.plen}}, stack.AddressProperties{}); err != nil {
		return fmt.Errorf("pilha: %s", err)
	}
	sub := tcpip.AddressWithPrefix{Address: addr, PrefixLen: h.plen}.Subnet()
	rt := []tcpip.Route{{Destination: sub, NIC: 1}}
	if h.gw != nil {
		rt = append(rt, tcpip.Route{Destination: header.IPv4EmptySubnet, Gateway: tcpip.AddrFrom4Slice(h.gw.To4()), NIC: 1})
	}
	s.SetRouteTable(rt)
	// qualquer porta: decide na hora (lab escutando → atende; container real → encaminha; senão RST)
	s.SetTransportProtocolHandler(tcp.ProtocolNumber, tcp.NewForwarder(s, 0, 1024, h.onTCP).HandlePacket)
	s.SetTransportProtocolHandler(udp.ProtocolNumber, udp.NewForwarder(s, h.onUDP).HandlePacket)
	if h.nic.hostIP != nil && len(h.nic.hostMAC) == 6 {
		// respostas para o próprio computador não podem sair pelo cabo (não voltam a ele):
		// vão pelo acesso local (localDeliver), sem precisar de ARP
		_ = s.AddStaticNeighbor(1, ipv4.ProtocolNumber, tcpip.AddrFrom4Slice(h.nic.hostIP.To4()), tcpip.LinkAddress(h.nic.hostMAC))
	}
	lanMgr.Lock()
	h.st, h.ch = s, ch
	lanMgr.Unlock()
	go func() {
		for {
			pkt := ch.ReadContext(h.ctx)
			if pkt == nil {
				return
			}
			v := pkt.ToView()
			b := append([]byte(nil), v.AsSlice()...)
			v.Release()
			pkt.DecRef()
			if localDeliver(h, b) {
				continue
			}
			_ = h.nic.raw.Write(b)
		}
	}()
	// ARP gratuito: avisa a rede (e o roteador) que este IP está neste MAC
	for i := 0; i < 2; i++ {
		_ = h.nic.raw.Write(arpFrame(1, h.mac, h.ip, bcastMAC, make(net.HardwareAddr, 6), h.ip))
	}
	return nil
}

func (h *lanHost) listen(port int) (net.Listener, error) {
	lanMgr.Lock()
	s := h.st
	lanMgr.Unlock()
	if s == nil {
		return nil, errors.New("IP ainda não está pronto")
	}
	return gonet.ListenTCP(s, tcpip.FullAddress{NIC: 1, Addr: tcpip.AddrFrom4Slice(h.ip.To4()), Port: uint16(port)}, ipv4.ProtocolNumber)
}

func (h *lanHost) run() {
	h.setStat(lanStat{State: "pedindo"})
	if h.req.Mode == "static" {
		ip := net.ParseIP(h.req.IP).To4()
		if ip == nil {
			h.setStat(lanStat{State: "erro", Err: "IP do lab inválido"})
			return
		}
		if ip.Equal(h.nic.hostIP) {
			h.setStat(lanStat{State: "erro", Err: "este é o IP do próprio computador"})
			return
		}
		if h.arpProbe(ip) {
			h.setStat(lanStat{State: "erro", Err: "conflito: outro aparelho da sua rede já usa " + ip.String()})
			return
		}
		h.ip, h.plen, h.gw = ip, h.req.Len, net.ParseIP(h.req.GW).To4()
		if h.plen <= 0 || h.plen > 30 {
			h.plen = 24
		}
	} else {
		if err := h.dhcpAcquire(); err != nil {
			if h.ctx.Err() == nil {
				h.setStat(lanStat{State: "erro", Err: err.Error()})
			}
			return
		}
	}
	if h.ctx.Err() != nil {
		h.release()
		return
	}
	if err := h.startStack(); err != nil {
		h.setStat(lanStat{State: "erro", Err: err.Error()})
		return
	}
	s := lanStat{State: "ok", IP: h.ip.String(), Len: h.plen}
	if h.gw != nil {
		s.GW = h.gw.String()
	}
	if h.dns != nil {
		s.DNS = h.dns.String()
	}
	h.setStat(s)
	logf("%s na rede real: %s/%d (MAC %s, %s)", h.req.Name, h.ip, h.plen, h.mac, map[string]string{"static": "IP do lab", "dhcp": "DHCP"}[h.req.Mode])
	if h.req.Mode != "static" {
		go h.renewLoop(h.lease)
	}
}

func (h *lanHost) stop() {
	h.cancel()
	lanMgr.Lock()
	h.ready = false
	lanMgr.Unlock()
	localRefresh()
	h.release()
	if h.st != nil {
		h.st.Close()
	}
}

// pacote IP que o próprio computador mandou para um IP do lab (capturado antes de sair)
func localInject(dst net.IP, ippkt []byte) bool {
	lanMgr.Lock()
	var h *lanHost
	for _, x := range lanMgr.hosts {
		if x.ready && x.ch != nil && x.ip.Equal(dst) {
			h = x
		}
	}
	lanMgr.Unlock()
	if h == nil {
		return false
	}
	src := h.nic.hostMAC
	if len(src) != 6 {
		src = net.HardwareAddr{2, 0, 0, 0, 0, 1}
	}
	fr := append(append(append(make([]byte, 0, 14+len(ippkt)), h.mac...), src...), 0x08, 0x00)
	fr = append(fr, ippkt...)
	pkt := stack.NewPacketBuffer(stack.PacketBufferOptions{Payload: buffer.MakeWithData(fr)})
	h.ch.InjectInbound(0, pkt)
	pkt.DecRef()
	return true
}

func lanReadyIPs() []string {
	lanMgr.Lock()
	defer lanMgr.Unlock()
	var out []string
	for _, h := range lanMgr.hosts {
		if h.ready && h.ip != nil {
			out = append(out, h.ip.String())
		}
	}
	return out
}

// destino de uma conexão de fora: container real, porta escutando no lab, ou nada (RST)
func (h *lanHost) portTarget(port int, proto string) (real string, listen bool) {
	lanMgr.Lock()
	k := strconv.Itoa(port)
	if proto == "udp" {
		k += "/udp"
	}
	fromUI := h.req.Real[k]
	ports := h.req.Ports
	dev := strings.SplitN(h.req.Key, "|", 2)[0]
	lanMgr.Unlock()
	// container real deste equipamento: o registro do próprio Docker/Podman manda (a porta no
	// computador muda quando o container reinicia); o que veio do navegador é só reserva
	real = appLookup(dev, k)
	if real == "" {
		real = fromUI
	}
	if proto == "udp" {
		return real, false
	}
	if real != "" {
		return real, true
	}
	if len(ports) == 0 {
		ports = []int{22, 80, 443}
	}
	for _, p := range ports {
		if p == port {
			return "", true
		}
	}
	return "", false
}

func (h *lanHost) onTCP(r *tcp.ForwarderRequest) { go h.onTCP2(r) }

func (h *lanHost) onTCP2(r *tcp.ForwarderRequest) {
	id := r.ID()
	port := int(id.LocalPort)
	real, ok := h.portTarget(port, "tcp")
	src := net.IP(id.RemoteAddress.AsSlice()).String()
	if !ok {
		logf("Rede real: %s → %s:%d recusada (nada escutando nessa porta no lab)", src, h.req.Name, port)
		r.Complete(true) // porta fechada no lab: RST, como um servidor de verdade
		return
	}
	if real != "" {
		logf("Rede real: %s → %s:%d → container real %s", src, h.req.Name, port, real)
	}
	var wq waiter.Queue
	ep, err := r.CreateEndpoint(&wq)
	if err != nil {
		r.Complete(true)
		return
	}
	r.Complete(false)
	c := gonet.NewTCPConn(&wq, ep)
	if real != "" {
		go rawProxy(c, real)
		return
	}
	ip := h.ip.String()
	lanMgr.Lock()
	pass := h.req.Pass
	lanMgr.Unlock()
	if pass == "" {
		pass = "bancada"
	}
	go lanServeConn(c, pubPort{Bind: ip, Port: port, Pass: pass, Target: fmt.Sprintf("%s:%d", ip, port)})
}

func (h *lanHost) onUDP(r *udp.ForwarderRequest) bool {
	id := r.ID()
	real, _ := h.portTarget(int(id.LocalPort), "udp")
	if real == "" {
		return false
	}
	var wq waiter.Queue
	ep, err := r.CreateEndpoint(&wq)
	if err != nil {
		return false
	}
	c := gonet.NewUDPConn(&wq, ep)
	go udpRelay(c, real)
	return true
}

// UDP de fora ↔ container real (um fluxo por cliente; fecha após 2 min parado)
func udpRelay(c net.Conn, target string) {
	defer c.Close()
	if !loopTgtRe.MatchString(target) {
		return
	}
	u, err := net.Dial("udp", target)
	if err != nil {
		return
	}
	defer u.Close()
	done := make(chan struct{}, 2)
	pump := func(dst, src net.Conn) {
		buf := make([]byte, 65535)
		for {
			_ = src.SetReadDeadline(time.Now().Add(2 * time.Minute))
			n, err := src.Read(buf)
			if err != nil {
				break
			}
			if _, err := dst.Write(buf[:n]); err != nil {
				break
			}
		}
		done <- struct{}{}
	}
	go pump(u, c)
	go pump(c, u)
	<-done
}

// ---------- sincronização com o navegador ----------

func lanHostByIP(ip string) *lanHost {
	lanMgr.Lock()
	defer lanMgr.Unlock()
	for _, h := range lanMgr.hosts {
		if h.ready && h.ip != nil && h.ip.String() == ip {
			return h
		}
	}
	return nil
}

func lanSync(reqs []lanReq) map[string]lanStat {
	want := map[string]lanReq{}
	for _, r := range reqs {
		if r.Key == "" {
			continue
		}
		if r.Mode != "static" {
			r.Mode = "dhcp"
		}
		if r.Iface == "" || r.Iface == "auto" {
			if r.Mode == "static" {
				r.Iface, _ = ifaceFor(r.IP)
			}
			if r.Iface == "" {
				r.Iface = hostNetwork().Iface
			}
		}
		want[r.Key] = r
	}
	var stopped []*lanHost
	lanMgr.Lock()
	for k, h := range lanMgr.hosts {
		w, ok := want[k]
		if ok && w.Mode == h.req.Mode && w.Iface == h.req.Iface && w.MAC == h.req.MAC && (w.Mode == "dhcp" || w.IP == h.req.IP) {
			h.req.Name, h.req.Ports, h.req.Pass, h.req.Real = w.Name, w.Ports, w.Pass, w.Real
			continue
		}
		delete(lanMgr.hosts, k)
		stopped = append(stopped, h)
	}
	lanMgr.Unlock()
	for _, h := range stopped {
		h.stop()
		closeListenersFor(h)
		lanMgr.Lock()
		h.nic.release()
		lanMgr.Unlock()
	}
	res := map[string]lanStat{}
	for k, r := range want {
		lanMgr.Lock()
		if h := lanMgr.hosts[k]; h != nil {
			res[k] = h.stat
			lanMgr.Unlock()
			continue
		}
		if r.Iface == "" {
			lanMgr.Unlock()
			res[k] = lanStat{Key: k, State: "erro", Err: "não achei a placa de rede deste computador — escolha a placa no painel da nuvem"}
			continue
		}
		nic, err := openLanNIC(r.Iface)
		if err != nil {
			lanMgr.Unlock()
			res[k] = lanStat{Key: k, State: "erro", Iface: r.Iface, Err: err.Error()}
			continue
		}
		ctx, cancel := context.WithCancel(context.Background())
		h := &lanHost{req: r, nic: nic, cid: virtMAC(k), ctx: ctx, cancel: cancel}
		h.mac = h.cid
		if r.MAC == "host" { // MAC do computador só quando escolhido (padrão: um MAC próprio por equipamento)
			h.mac = append(net.HardwareAddr(nil), nic.hostMAC...)
		}
		h.stat = lanStat{Key: k, State: "pedindo", MAC: h.mac.String(), Iface: nic.name, Seq: lanSeq.Add(1)}
		lanMgr.hosts[k] = h
		lanMgr.Unlock()
		res[k] = h.stat
		go h.run()
	}
	return res
}

func closeListenersFor(h *lanHost) {
	if h.ip == nil {
		return
	}
	ip := h.ip.String()
	bridge.Lock()
	for k, l := range bridge.lns {
		if l.conf.Bind == ip {
			l.ln.Close()
			delete(bridge.lns, k)
		}
	}
	bridge.Unlock()
	lanPLs.Lock()
	for k, pl := range lanPLs.m {
		if pl.conf.Bind == ip {
			pl.http.Close()
			pl.tls.Close()
			delete(lanPLs.m, k)
		}
	}
	lanPLs.Unlock()
}

func lanStats() map[string]lanStat {
	lanMgr.Lock()
	defer lanMgr.Unlock()
	m := map[string]lanStat{}
	for k, h := range lanMgr.hosts {
		m[k] = h.stat
	}
	return m
}

func init() { rand.Seed(time.Now().UnixNano()) }
