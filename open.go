package main

import (
	"os/exec"
	"runtime"
)

func startDetached(name string, args ...string) error {
	cmd := exec.Command(name, args...)
	hideWindow(cmd)
	if err := cmd.Start(); err != nil {
		return err
	}
	go func() { _ = cmd.Wait() }()
	return nil
}

// openURL abre um endereço no navegador padrão.
func openURL(u string) {
	var err error
	switch runtime.GOOS {
	case "windows":
		err = startDetached("rundll32", "url.dll,FileProtocolHandler", u)
	case "darwin":
		err = startDetached("open", u)
	default:
		err = startDetached("xdg-open", u)
	}
	if err != nil {
		logf("Não consegui abrir o navegador (%v). Abra %s manualmente.", err, u)
	}
}

// openFolder abre uma pasta no gerenciador de arquivos.
func openFolder(p string) {
	var err error
	switch runtime.GOOS {
	case "windows":
		err = startDetached("explorer", p)
	case "darwin":
		err = startDetached("open", p)
	default:
		err = startDetached("xdg-open", p)
	}
	if err != nil {
		logf("Não consegui abrir a pasta (%v): %s", err, p)
	}
}
