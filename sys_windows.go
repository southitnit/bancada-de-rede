//go:build windows

package main

import (
	"os/exec"
	"syscall"
)

func hideWindow(cmd *exec.Cmd) {
	// sem janela de console (o executável é GUI; cada docker/podman/route/ping abriria um cmd)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000} // CREATE_NO_WINDOW
}

// sysUILang: idioma da interface do Windows (português → "pt", outros → "en").
func sysUILang() string {
	r, _, _ := syscall.NewLazyDLL("kernel32.dll").NewProc("GetUserDefaultUILanguage").Call()
	if r == 0 {
		return ""
	}
	if r&0x3ff == 0x16 { // LANG_PORTUGUESE
		return "pt"
	}
	return "en"
}
