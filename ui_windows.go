//go:build windows

// Janela nativa do Windows (Win32 puro, sem dependências) para controlar o servidor da Bancada.
package main

import (
	"encoding/binary"
	"fmt"
	"runtime"
	"strconv"
	"strings"
	"unsafe"

	"golang.org/x/sys/windows"
)

func init() { runtime.LockOSThread() } // a janela precisa viver na thread principal

var (
	user32   = windows.NewLazySystemDLL("user32.dll")
	gdi32    = windows.NewLazySystemDLL("gdi32.dll")
	kernel32 = windows.NewLazySystemDLL("kernel32.dll")
	comctl32 = windows.NewLazySystemDLL("comctl32.dll")

	pRegisterClassEx     = user32.NewProc("RegisterClassExW")
	pCreateWindowEx      = user32.NewProc("CreateWindowExW")
	pDefWindowProc       = user32.NewProc("DefWindowProcW")
	pGetMessage          = user32.NewProc("GetMessageW")
	pTranslateMessage    = user32.NewProc("TranslateMessage")
	pDispatchMessage     = user32.NewProc("DispatchMessageW")
	pIsDialogMessage     = user32.NewProc("IsDialogMessageW")
	pPostQuitMessage     = user32.NewProc("PostQuitMessage")
	pPostMessage         = user32.NewProc("PostMessageW")
	pSendMessage         = user32.NewProc("SendMessageW")
	pSetWindowText       = user32.NewProc("SetWindowTextW")
	pGetWindowText       = user32.NewProc("GetWindowTextW")
	pGetWindowTextLength = user32.NewProc("GetWindowTextLengthW")
	pEnableWindow        = user32.NewProc("EnableWindow")
	pShowWindow          = user32.NewProc("ShowWindow")
	pUpdateWindow        = user32.NewProc("UpdateWindow")
	pDestroyWindow       = user32.NewProc("DestroyWindow")
	pLoadCursor          = user32.NewProc("LoadCursorW")
	pMessageBox          = user32.NewProc("MessageBoxW")
	pGetDC               = user32.NewProc("GetDC")
	pReleaseDC           = user32.NewProc("ReleaseDC")
	pGetSystemMetrics    = user32.NewProc("GetSystemMetrics")
	pAdjustWindowRectEx  = user32.NewProc("AdjustWindowRectEx")
	pSetTimer            = user32.NewProc("SetTimer")
	pFindWindow          = user32.NewProc("FindWindowW")
	pSetForeground       = user32.NewProc("SetForegroundWindow")
	pGetSysColor         = user32.NewProc("GetSysColor")
	pGetSysColorBrush    = user32.NewProc("GetSysColorBrush")
	pLookupIconId        = user32.NewProc("LookupIconIdFromDirectoryEx")
	pCreateIconFromRes   = user32.NewProc("CreateIconFromResourceEx")
	pInvalidateRect      = user32.NewProc("InvalidateRect")
	pCreateFont          = gdi32.NewProc("CreateFontW")
	pGetDeviceCaps       = gdi32.NewProc("GetDeviceCaps")
	pSetTextColor        = gdi32.NewProc("SetTextColor")
	pSetBkColor          = gdi32.NewProc("SetBkColor")
	pGetModuleHandle     = kernel32.NewProc("GetModuleHandleW")
	pCreateMutex         = kernel32.NewProc("CreateMutexW")
	pInitCommonControls  = comctl32.NewProc("InitCommonControlsEx")
)

const (
	wsOverlapped  = 0x00000000
	wsCaption     = 0x00C00000
	wsSysMenu     = 0x00080000
	wsMinimizeBox = 0x00020000
	wsChild       = 0x40000000
	wsVisible     = 0x10000000
	wsTabStop     = 0x00010000
	wsVScroll     = 0x00200000
	wsExClient    = 0x00000200

	bsPush     = 0x0
	bsDefPush  = 0x1
	bsCheckBox = 0x3
	bsGroupBox = 0x7

	esAutoHScroll = 0x80
	esMultiline   = 0x4
	esReadOnly    = 0x800
	esNumber      = 0x2000
	esAutoVScroll = 0x40

	ssNoPrefix     = 0x80
	ssRight        = 0x2
	ssEndEllipsis  = 0x4000
	ssPathEllipsis = 0x8000
	ssCenterImage  = 0x200

	wmDestroy        = 0x0002
	wmClose          = 0x0010
	wmSetFont        = 0x0030
	wmCommand        = 0x0111
	wmTimer          = 0x0113
	wmCtlColorEdit   = 0x0133
	wmCtlColorStatic = 0x0138
	wmRefresh        = 0x8001

	bmGetCheck    = 0x00F0
	bmSetCheck    = 0x00F1
	emSetSel      = 0x00B1
	emReplaceSel  = 0x00C2
	emSetLimit    = 0x00C5
	emSetCue      = 0x1501
	wmSetText     = 0x000C
	mbOK          = 0x0
	mbIconError   = 0x10
	mbIconWarn    = 0x30
	mbIconInfo    = 0x40
	mbYesNo       = 0x4
	mbIconQuest   = 0x20
	idYes         = 6
	colorWindow   = 5
	colorGrayText = 17
)

// IDs dos controles
const (
	idStart = 101 + iota
	idStop
	idRestart
	idOpen
	idFolder
	idSave
	idQuit
	idPort
	idLan
	idData
	idAuth
	idAuto
	idOpenApp
	idLang
)

type wndClassEx struct {
	cbSize        uint32
	style         uint32
	lpfnWndProc   uintptr
	cbClsExtra    int32
	cbWndExtra    int32
	hInstance     uintptr
	hIcon         uintptr
	hCursor       uintptr
	hbrBackground uintptr
	lpszMenuName  *uint16
	lpszClassName *uint16
	hIconSm       uintptr
}
type winMsg struct {
	hwnd    uintptr
	message uint32
	wParam  uintptr
	lParam  uintptr
	time    uint32
	ptX     int32
	ptY     int32
	private uint32
}
type rect struct{ left, top, right, bottom int32 }

func u16(s string) *uint16                           { p, _ := windows.UTF16PtrFromString(s); return p }
func u16p(s string) uintptr                          { return uintptr(unsafe.Pointer(u16(s))) }
func call(p *windows.LazyProc, a ...uintptr) uintptr { r, _, _ := p.Call(a...); return r }

type gui struct {
	m                                     *Manager
	hwnd, inst                            uintptr
	dpi                                   int
	fUI, fBold, fTitle, fMono, fStatus    uintptr
	ctl                                   map[int]uintptr
	status, addr, info, logBox, hint, ver uintptr
	lastLog                               int
	logLen                                int
	running                               bool
	errored                               bool
	prevRun, prevErr                      bool
	labels                                map[uintptr]string // texto original (português) de cada controle
}

var G *gui

func (g *gui) s(v int) int32 { return int32(v * g.dpi / 96) }

func (g *gui) font(pt int, weight int, face string) uintptr {
	h := -(pt * g.dpi / 72)
	return call(pCreateFont, uintptr(int32(h)), 0, 0, 0, uintptr(weight), 0, 0, 0, 1, 0, 0, 5, 0, u16p(face))
}

func (g *gui) add(class, text string, style, ex uint32, x, y, w, h, id int, font uintptr) uintptr {
	hw := call(pCreateWindowEx, uintptr(ex), u16p(class), u16p(text), uintptr(style|wsChild|wsVisible),
		uintptr(g.s(x)), uintptr(g.s(y)), uintptr(g.s(w)), uintptr(g.s(h)), g.hwnd, uintptr(id), g.inst, 0)
	call(pSendMessage, hw, wmSetFont, font, 1)
	if class != "EDIT" && text != "" {
		g.labels[hw] = text
		call(pSetWindowText, hw, u16p(T(text)))
	}
	if id != 0 {
		g.ctl[id] = hw
	}
	return hw
}

var lastText = map[uintptr]string{}

func setText(hw uintptr, s string) {
	if v, ok := lastText[hw]; ok && v == s {
		return
	}
	lastText[hw] = s
	call(pSetWindowText, hw, u16p(s))
}
func getText(hw uintptr) string {
	n := call(pGetWindowTextLength, hw)
	buf := make([]uint16, n+1)
	call(pGetWindowText, hw, uintptr(unsafe.Pointer(&buf[0])), n+1)
	return windows.UTF16ToString(buf)
}
func checked(hw uintptr) bool { return call(pSendMessage, hw, bmGetCheck, 0, 0) == 1 }
func setCheck(hw uintptr, v bool) {
	var c uintptr
	if v {
		c = 1
	}
	call(pSendMessage, hw, bmSetCheck, c, 0)
}
func (g *gui) msgBox(text string, flags uintptr) uintptr {
	return call(pMessageBox, g.hwnd, u16p(T(text)), u16p("Bancada de Rede"), flags)
}

// langLabel: o botão mostra o outro idioma (o que será usado ao clicar).
func langLabel() string {
	if Lang() == "en" {
		return "Português"
	}
	return "English"
}

// relabel troca todos os textos da janela para o idioma atual.
func (g *gui) relabel() {
	for hw, pt := range g.labels {
		setText(hw, T(pt))
	}
	setText(g.ctl[idLang], langLabel())
	setText(g.hwnd, T("Bancada de Rede — Painel de controle"))
	call(pSendMessage, g.ctl[idAuth], emSetCue, 1, u16p(T("usuario:senha")))
	all := LOGS.Since(0)
	var nb strings.Builder
	for _, l := range all[max(0, len(all)-200):] {
		nb.WriteString(l.T + "  " + l.Text() + "\r\n")
	}
	delete(lastText, g.logBox)
	setText(g.logBox, nb.String())
	g.logLen = nb.Len()
	n := uintptr(0x7fffffff)
	call(pSendMessage, g.logBox, emSetSel, n, n)
	g.refresh()
}

func (g *gui) toggleLang() {
	s := g.m.Settings()
	if Lang() == "en" {
		s.Lang = "pt"
	} else {
		s.Lang = "en"
	}
	setLang(s.Lang)
	g.m.SetLang(s.Lang)
	g.relabel()
}

// iconFromICO cria um HICON a partir do .ico embutido, no tamanho pedido.
func iconFromICO(ico []byte, size int) uintptr {
	if len(ico) < 6 {
		return 0
	}
	off := call(pLookupIconId, uintptr(unsafe.Pointer(&ico[0])), 1, uintptr(size), uintptr(size), 0)
	if off == 0 || int(off) >= len(ico) {
		return 0
	}
	n := int(binary.LittleEndian.Uint16(ico[4:6]))
	length := 0
	for i := 0; i < n; i++ {
		e := ico[6+16*i : 6+16*i+16]
		if int(binary.LittleEndian.Uint32(e[12:16])) == int(off) {
			length = int(binary.LittleEndian.Uint32(e[8:12]))
		}
	}
	if length == 0 || int(off)+length > len(ico) {
		return 0
	}
	return call(pCreateIconFromRes, uintptr(unsafe.Pointer(&ico[off])), uintptr(length), 1, 0x00030000, uintptr(size), uintptr(size), 0)
}

func (g *gui) build() {
	g.fUI = g.font(9, 400, "Segoe UI")
	g.fBold = g.font(9, 600, "Segoe UI")
	g.fStatus = g.font(13, 700, "Segoe UI")
	g.fTitle = g.font(16, 700, "Segoe UI Semibold")
	g.fMono = g.font(9, 400, "Consolas")
	S := g.m.Settings()

	g.add("STATIC", "Bancada de Rede", ssNoPrefix, 0, 18, 12, 400, 32, 0, g.fTitle)
	g.ver = g.add("STATIC", "versão "+version, ssNoPrefix|ssRight, 0, 380, 20, 194, 20, 0, g.fUI)
	g.add("BUTTON", "", bsPush|wsTabStop, 0, 582, 14, 86, 28, idLang, g.fUI)
	setText(g.ctl[idLang], langLabel())
	g.add("STATIC", "Inicie o servidor e abra a Bancada no navegador. Tudo roda a partir deste programa.", ssNoPrefix, 0, 18, 46, 646, 20, 0, g.fUI)

	g.add("BUTTON", "Servidor", bsGroupBox, 0, 12, 72, 656, 150, 0, g.fBold)
	g.status = g.add("STATIC", "●  Parado", ssNoPrefix, 0, 28, 94, 620, 30, 0, g.fStatus)
	g.addr = g.add("STATIC", "Endereço: —", ssNoPrefix|ssEndEllipsis, 0, 28, 126, 620, 20, 0, g.fUI)
	g.info = g.add("STATIC", "", ssNoPrefix|ssPathEllipsis, 0, 28, 148, 620, 20, 0, g.fUI)
	g.add("BUTTON", "Iniciar servidor", bsDefPush|wsTabStop, 0, 28, 176, 150, 32, idStart, g.fBold)
	g.add("BUTTON", "Parar", bsPush|wsTabStop, 0, 186, 176, 96, 32, idStop, g.fUI)
	g.add("BUTTON", "Reiniciar", bsPush|wsTabStop, 0, 290, 176, 104, 32, idRestart, g.fUI)
	g.add("BUTTON", "Abrir no navegador", bsPush|wsTabStop, 0, 402, 176, 144, 32, idOpen, g.fUI)
	g.add("BUTTON", "Pasta de dados", bsPush|wsTabStop, 0, 554, 176, 100, 32, idFolder, g.fUI)

	g.add("BUTTON", "Configurações", bsGroupBox, 0, 12, 232, 656, 160, 0, g.fBold)
	g.add("STATIC", "Porta", ssNoPrefix, 0, 28, 259, 100, 20, 0, g.fUI)
	g.add("EDIT", strconv.Itoa(S.Port), esNumber|esAutoHScroll|wsTabStop, wsExClient, 134, 255, 80, 24, idPort, g.fUI)
	call(pSendMessage, g.ctl[idPort], emSetLimit, 5, 0)
	g.add("BUTTON", "Permitir acesso de outros computadores da rede", bsCheckBox|wsTabStop, 0, 236, 256, 420, 22, idLan, g.fUI)
	g.add("STATIC", "Pasta de dados", ssNoPrefix, 0, 28, 293, 100, 20, 0, g.fUI)
	g.add("EDIT", S.DataDir, esAutoHScroll|wsTabStop, wsExClient, 134, 289, 520, 24, idData, g.fUI)
	g.add("STATIC", "Senha (opcional)", ssNoPrefix, 0, 28, 327, 104, 20, 0, g.fUI)
	g.add("EDIT", S.Auth, esAutoHScroll|wsTabStop, wsExClient, 134, 323, 200, 24, idAuth, g.fUI)
	call(pSendMessage, g.ctl[idAuth], emSetCue, 1, u16p(T("usuario:senha")))
	g.add("BUTTON", "Iniciar o servidor ao abrir o programa", bsCheckBox|wsTabStop, 0, 350, 324, 304, 22, idAuto, g.fUI)
	g.add("BUTTON", "Salvar configurações", bsPush|wsTabStop, 0, 28, 354, 160, 28, idSave, g.fUI)
	g.add("BUTTON", "Abrir a Bancada ao iniciar o servidor", bsCheckBox|wsTabStop, 0, 350, 356, 304, 22, idOpenApp, g.fUI)
	setCheck(g.ctl[idLan], S.LAN)
	setCheck(g.ctl[idAuto], S.AutoStart)
	setCheck(g.ctl[idOpenApp], S.OpenApp)

	g.add("STATIC", "Log", ssNoPrefix, 0, 14, 402, 100, 18, 0, g.fBold)
	g.logBox = g.add("EDIT", "", esMultiline|esReadOnly|esAutoVScroll|wsVScroll|wsTabStop, wsExClient, 12, 422, 656, 132, 0, g.fMono)
	g.hint = g.add("STATIC", "Fechar a janela para o servidor e encerra o programa.", ssNoPrefix, 0, 14, 572, 500, 20, 0, g.fUI)
	g.add("BUTTON", "Sair", bsPush|wsTabStop, 0, 568, 564, 100, 32, idQuit, g.fUI)
}

func (g *gui) refresh() {
	st := g.m.Status()
	running, _ := st["running"].(bool)
	errMsg, _ := st["error"].(string)
	g.running, g.errored = running, errMsg != "" && !running
	switch {
	case running:
		setText(g.status, T("●  Rodando"))
		addr := T("Endereço:") + " " + st["url"].(string)
		if lan, ok := st["lanUrls"].([]string); ok && len(lan) > 0 {
			addr += "     " + T("Na rede:") + " " + strings.Join(lan, "   ")
		}
		setText(g.addr, addr)
	case errMsg != "":
		setText(g.status, T("●  Parado com erro"))
		setText(g.addr, T(errMsg))
	default:
		setText(g.status, T("●  Parado"))
		setText(g.addr, T("Clique em “Iniciar servidor” para subir a Bancada."))
	}
	setText(g.info, fmt.Sprintf(T("Labs salvos: %v     Dados em: %v"), st["labs"], st["dataDir"]))
	if g.prevRun != running || g.prevErr != g.errored {
		g.prevRun, g.prevErr = running, g.errored
		call(pInvalidateRect, g.status, 0, 1)
	}
	en := func(id int, v bool) {
		var b uintptr
		if v {
			b = 1
		}
		call(pEnableWindow, g.ctl[id], b)
	}
	en(idStart, !running)
	en(idStop, running)
	en(idRestart, running)
	en(idOpen, running)
	g.pullLogs()
}

func (g *gui) pullLogs() {
	lines := LOGS.Since(g.lastLog)
	if len(lines) == 0 {
		return
	}
	var b strings.Builder
	for _, l := range lines {
		g.lastLog = l.N
		b.WriteString(l.T + "  " + l.Text() + "\r\n")
	}
	add := b.String()
	if g.logLen+len(add) > 60000 { // mantém o log leve
		all := LOGS.Since(0)
		var nb strings.Builder
		for _, l := range all[max(0, len(all)-200):] {
			nb.WriteString(l.T + "  " + l.Text() + "\r\n")
		}
		delete(lastText, g.logBox)
		setText(g.logBox, nb.String())
		g.logLen = nb.Len()
	} else {
		n := uintptr(0x7fffffff)
		call(pSendMessage, g.logBox, emSetSel, n, n)
		call(pSendMessage, g.logBox, emReplaceSel, 0, u16p(add))
		g.logLen += len(add)
	}
}

func (g *gui) start() {
	if err := g.m.Start(); err != nil {
		g.msgBox(T("Não foi possível iniciar o servidor.")+"\n\n"+T(err.Error()), mbOK|mbIconError)
		return
	}
	if g.m.Settings().OpenApp {
		openURL(g.m.AppURL())
	}
}

func (g *gui) save() {
	cur := g.m.Settings()
	port, err := strconv.Atoi(strings.TrimSpace(getText(g.ctl[idPort])))
	if err != nil || port < 1 || port > 65535 {
		g.msgBox("A porta deve ser um número entre 1 e 65535.", mbOK|mbIconWarn)
		return
	}
	data := strings.TrimSpace(getText(g.ctl[idData]))
	if data == "" {
		g.msgBox("Informe a pasta de dados.", mbOK|mbIconWarn)
		return
	}
	auth := strings.TrimSpace(getText(g.ctl[idAuth]))
	if auth != "" && (!strings.Contains(auth, ":") || strings.HasPrefix(auth, ":") || strings.HasSuffix(auth, ":")) {
		g.msgBox("A senha deve estar no formato usuario:senha (ou deixe em branco).", mbOK|mbIconWarn)
		return
	}
	s := Settings{Port: port, LAN: checked(g.ctl[idLan]), DataDir: data, Auth: auth, AutoStart: checked(g.ctl[idAuto]), OpenApp: checked(g.ctl[idOpenApp]), Lang: Lang()}
	wasRunning := g.m.Running()
	if err := g.m.Apply(s); err != nil {
		g.msgBox(T("As configurações foram salvas, mas o servidor não subiu de novo.")+"\n\n"+T(err.Error()), mbOK|mbIconError)
		return
	}
	if wasRunning && (cur.Port != s.Port || cur.LAN != s.LAN || cur.DataDir != s.DataDir || cur.Auth != s.Auth) {
		g.msgBox("Configurações salvas. O servidor foi reiniciado com os novos valores.", mbOK|mbIconInfo)
	}
}

func (g *gui) confirmQuit() bool {
	if g.m.Running() {
		if g.msgBox("O servidor está rodando. Parar o servidor e fechar a Bancada de Rede?", mbYesNo|mbIconQuest) != idYes {
			return false
		}
	}
	g.m.Stop()
	call(pDestroyWindow, g.hwnd)
	return true
}

func wndProc(hwnd uintptr, msg uint32, wp, lp uintptr) uintptr {
	g := G
	switch msg {
	case wmCommand:
		if g == nil {
			break
		}
		if (wp>>16)&0xffff == 0 { // BN_CLICKED
			switch int(wp & 0xffff) {
			case idStart:
				g.start()
			case idStop:
				g.m.Stop()
			case idRestart:
				if err := g.m.Restart(); err != nil {
					g.msgBox(T("Não foi possível reiniciar.")+"\n\n"+T(err.Error()), mbOK|mbIconError)
				}
			case idOpen:
				openURL(g.m.AppURL())
			case idFolder:
				openFolder(g.m.Settings().DataDir)
			case idSave:
				g.save()
			case idQuit:
				g.confirmQuit()
			case idLang:
				g.toggleLang()
			}
			return 0
		}
	case wmRefresh:
		if g != nil {
			g.refresh()
		}
		return 0
	case wmTimer:
		if g != nil {
			g.refresh()
		}
		return 0
	case wmCtlColorStatic, wmCtlColorEdit:
		if g != nil {
			col := call(pGetSysColor, 8) // COLOR_WINDOWTEXT
			if lp == g.status {
				switch {
				case g.running:
					col = 0x00488A1D // verde (BGR)
				case g.errored:
					col = 0x002731BE // vermelho
				default:
					col = 0x00776A5A // cinza
				}
			} else if lp == g.hint || lp == g.ver {
				col = call(pGetSysColor, colorGrayText)
			}
			call(pSetTextColor, wp, col)
			call(pSetBkColor, wp, call(pGetSysColor, colorWindow))
			return call(pGetSysColorBrush, colorWindow)
		}
	case wmClose:
		if g != nil {
			g.confirmQuit()
		}
		return 0
	case wmDestroy:
		call(pPostQuitMessage, 0)
		return 0
	}
	return call(pDefWindowProc, hwnd, uintptr(msg), wp, lp)
}

const className = "BancadaDeRedeJanela"

func runUI(m *Manager, noBrowser bool) {
	// instância única: se já estiver aberta, traz a janela para a frente
	if _, _, e := pCreateMutex.Call(0, 0, u16p("Local\\BancadaDeRedeInstancia")); e == windows.ERROR_ALREADY_EXISTS {
		if hw := call(pFindWindow, u16p(className), 0); hw != 0 {
			call(pShowWindow, hw, 9) // SW_RESTORE
			call(pSetForeground, hw)
		}
		return
	}
	icc := [2]uint32{8, 0x4000 | 0xFF}
	call(pInitCommonControls, uintptr(unsafe.Pointer(&icc)))

	g := &gui{m: m, ctl: map[int]uintptr{}, labels: map[uintptr]string{}}
	g.inst = call(pGetModuleHandle, 0)
	hdc := call(pGetDC, 0)
	g.dpi = int(call(pGetDeviceCaps, hdc, 88)) // LOGPIXELSX
	call(pReleaseDC, 0, hdc)
	if g.dpi < 96 {
		g.dpi = 96
	}
	bigIcon, smallIcon := iconFromICO(iconICO, 32*g.dpi/96), iconFromICO(iconICO, 16*g.dpi/96)

	wc := wndClassEx{lpfnWndProc: windows.NewCallback(wndProc), hInstance: g.inst, hIcon: bigIcon, hIconSm: smallIcon,
		hCursor: call(pLoadCursor, 0, 32512), hbrBackground: colorWindow + 1, lpszClassName: u16(className)}
	wc.cbSize = uint32(unsafe.Sizeof(wc))
	call(pRegisterClassEx, uintptr(unsafe.Pointer(&wc)))

	style := uint32(wsOverlapped | wsCaption | wsSysMenu | wsMinimizeBox)
	r := rect{0, 0, g.s(680), g.s(606)}
	call(pAdjustWindowRectEx, uintptr(unsafe.Pointer(&r)), uintptr(style), 0, 0)
	w, h := r.right-r.left, r.bottom-r.top
	sw, sh := int32(call(pGetSystemMetrics, 0)), int32(call(pGetSystemMetrics, 1))
	G = g
	g.hwnd = call(pCreateWindowEx, 0, u16p(className), u16p(T("Bancada de Rede — Painel de controle")), uintptr(style),
		uintptr((sw-w)/2), uintptr((sh-h)/2), uintptr(w), uintptr(h), 0, 0, g.inst, 0)
	if g.hwnd == 0 {
		return
	}
	g.build()
	m.OnChange(func() { call(pPostMessage, g.hwnd, wmRefresh, 0, 0) })
	call(pSetTimer, g.hwnd, 1, 1000, 0)
	call(pShowWindow, g.hwnd, 5)
	call(pUpdateWindow, g.hwnd)
	g.refresh()

	if m.Settings().AutoStart {
		g.start()
	}

	var msg winMsg
	for {
		r := int32(call(pGetMessage, uintptr(unsafe.Pointer(&msg)), 0, 0, 0))
		if r <= 0 {
			break
		}
		if call(pIsDialogMessage, g.hwnd, uintptr(unsafe.Pointer(&msg))) != 0 {
			continue
		}
		call(pTranslateMessage, uintptr(unsafe.Pointer(&msg)))
		call(pDispatchMessage, uintptr(unsafe.Pointer(&msg)))
	}
	m.Stop()
}
