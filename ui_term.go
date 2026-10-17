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
	fmt.Printf("\n  Bancada de Rede %s\n  %s\n\n", version, cmdsHelp())
	if err := m.Start(); err == nil && !noBrowser {
		openURL(m.AppURL())
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
					openURL(m.AppURL())
				} else {
					fmt.Println("  " + T("O servidor está parado. Use: iniciar"))
				}
			case "pasta", "folder":
				openFolder(m.Settings().DataDir)
			case "en", "english", "pt", "portugues", "português":
				if strings.HasPrefix(l, "en") {
					m.SetLang("en")
				} else {
					m.SetLang("pt")
				}
				setLang(m.Settings().Lang)
				fmt.Println("  " + cmdsHelp())
			case "status", "":
				st := m.Status()
				if st["running"] == true {
					fmt.Printf("  "+T("Rodando em %v — dados em %v — %v labs")+"\n", st["url"], st["dataDir"], st["labs"])
				} else {
					fmt.Printf("  %s %v\n", T("Parado."), T(fmt.Sprint(st["error"])))
				}
			case "sair", "exit", "quit":
				m.Stop()
				return
			default:
				fmt.Println("  " + cmdsHelp())
			}
		}
	}
}

func cmdsHelp() string {
	if Lang() == "en" {
		return "Commands: start | stop | restart | open | folder | status | pt (português) | exit"
	}
	return "Comandos: iniciar | parar | reiniciar | abrir | pasta | status | en (English) | sair"
}
