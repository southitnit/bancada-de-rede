//go:build !windows

package main

import (
	"bufio"
	"fmt"
	"os"
	"os/signal"
	"strings"
	"syscall"
)

// runUI no Linux/macOS: controle pelo terminal (iniciar, parar, reiniciar, abrir, pasta, status, sair).
func runUI(m *Manager, noBrowser bool) {
	fmt.Printf("\n  Bancada de Rede %s\n  Comandos: iniciar | parar | reiniciar | abrir | pasta | status | sair\n\n", version)
	if err := m.Start(); err == nil && !noBrowser {
		openURL(m.URL())
	}
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
	lines := make(chan string)
	go func() {
		sc := bufio.NewScanner(os.Stdin)
		for sc.Scan() {
			lines <- strings.ToLower(strings.TrimSpace(sc.Text()))
		}
	}()
	for {
		select {
		case <-sig:
			m.Stop()
			return
		case l := <-lines:
			switch l {
			case "iniciar", "start":
				_ = m.Start()
			case "parar", "stop":
				m.Stop()
			case "reiniciar", "restart":
				_ = m.Restart()
			case "abrir", "open":
				if m.Running() {
					openURL(m.URL())
				} else {
					fmt.Println("  O servidor está parado. Use: iniciar")
				}
			case "pasta":
				openFolder(m.Settings().DataDir)
			case "status", "":
				st := m.Status()
				if st["running"] == true {
					fmt.Printf("  Rodando em %v — dados em %v — %v labs\n", st["url"], st["dataDir"], st["labs"])
				} else {
					fmt.Printf("  Parado. %v\n", st["error"])
				}
			case "sair", "exit", "quit":
				m.Stop()
				return
			default:
				fmt.Println("  Comandos: iniciar | parar | reiniciar | abrir | pasta | status | sair")
			}
		}
	}
}
