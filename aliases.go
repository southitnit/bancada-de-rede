// Utilidades de rede do computador (placa, administrador).
package main

import (
	"context"
	"net"
	"os/exec"
	"runtime"
	"strings"
	"sync"
	"time"
)

func runCmd(name string, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, name, args...)
	hideWindow(cmd)
	out, err := cmd.CombinedOutput()
	return strings.TrimSpace(string(out)), err
}

var adminOnce struct {
	sync.Once
	v bool
}

// administrador? (verificado uma vez: o resultado não muda com o programa aberto)
func isAdmin() bool {
	adminOnce.Do(func() { adminOnce.v = isAdmin0() })
	return adminOnce.v
}

func isAdmin0() bool {
	switch runtime.GOOS {
	case "windows":
		_, err := runCmd("net", "session")
		return err == nil
	default:
		out, _ := runCmd("id", "-u")
		return out == "0"
	}
}

// placa cuja rede contém o IP (para quando a interface não veio do navegador)
func ifaceFor(ip string) (string, string) {
	x := net.ParseIP(ip)
	for _, h := range hostIfaces() {
		if _, n, err := net.ParseCIDR(h.LAN); err == nil && x != nil && n.Contains(x) {
			return h.Iface, net.IP(n.Mask).String()
		}
	}
	return "", ""
}
