//go:build linux

package main

import (
	"fmt"
	"net"
	"os"
	"sync/atomic"

	"golang.org/x/sys/unix"
)

type afPacket struct {
	fd     int
	closed atomic.Bool
	buf    []byte
}

func htons(v uint16) uint16 { return v<<8 | v>>8 }

func openRaw(it *net.Interface, _ net.IP) (rawNIC, bool, error) {
	fd, err := unix.Socket(unix.AF_PACKET, unix.SOCK_RAW, int(htons(unix.ETH_P_ALL)))
	if err != nil {
		return nil, false, fmt.Errorf("sem acesso direto à placa (%v) — rode a bancada como root ou com a capacidade CAP_NET_RAW", err)
	}
	if err := unix.Bind(fd, &unix.SockaddrLinklayer{Protocol: htons(unix.ETH_P_ALL), Ifindex: it.Index}); err != nil {
		unix.Close(fd)
		return nil, false, fmt.Errorf("placa %s: %v", it.Name, err)
	}
	_ = unix.SetsockoptPacketMreq(fd, unix.SOL_PACKET, unix.PACKET_ADD_MEMBERSHIP, &unix.PacketMreq{Ifindex: int32(it.Index), Type: unix.PACKET_MR_PROMISC})
	tv := unix.Timeval{Usec: 300000}
	_ = unix.SetsockoptTimeval(fd, unix.SOL_SOCKET, unix.SO_RCVTIMEO, &tv)
	_, werr := os.Stat("/sys/class/net/" + it.Name + "/wireless")
	return &afPacket{fd: fd, buf: make([]byte, 65536)}, werr == nil, nil
}

func (a *afPacket) Read() ([]byte, error) {
	n, from, err := unix.Recvfrom(a.fd, a.buf, 0)
	if err != nil {
		if a.closed.Load() {
			return nil, err
		}
		if err == unix.EAGAIN || err == unix.EINTR {
			return nil, nil
		}
		return nil, err
	}
	if ll, ok := from.(*unix.SockaddrLinklayer); ok && ll.Pkttype == unix.PACKET_OUTGOING {
		return nil, nil
	}
	return append([]byte(nil), a.buf[:n]...), nil
}

func (a *afPacket) Write(b []byte) error {
	_, err := unix.Write(a.fd, b)
	return err
}

func (a *afPacket) Close() {
	if a.closed.CompareAndSwap(false, true) {
		unix.Close(a.fd)
	}
}
