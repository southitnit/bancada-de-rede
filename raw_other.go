//go:build !linux && !windows

package main

import (
	"errors"
	"net"
)

func openRaw(_ *net.Interface, _ net.IP) (rawNIC, bool, error) {
	return nil, false, errors.New("colocar equipamentos do lab na rede real ainda não funciona neste sistema — use as portas publicadas (NAT)")
}
