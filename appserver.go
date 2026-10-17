package main

import (
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"mime"
	"net/http"
	"path"
	"regexp"
	"strings"
)

const htmlHead = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>`

var exportNameRe = regexp.MustCompile(`^((auto|cisco|nxos|junos|eos|aoscx|os10|huawei|routeros|fortios|vyos|hosts|chassis|nuvens)/[A-Za-z0-9_.-]{1,80}\.(txt|sh|ps1)|topologia\.json|inventario\.csv|LEIAME\.txt)$`)

// App é o servidor HTTP da Bancada: interface embutida + API de labs.
type App struct {
	st     *Store
	auth   string
	static fs.FS
}

func NewApp(st *Store, auth string, static fs.FS) *App {
	return &App{st: st, auth: auth, static: static}
}

func secHeaders(w http.ResponseWriter) {
	h := w.Header()
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Referrer-Policy", "same-origin")
	h.Set("X-Frame-Options", "SAMEORIGIN")
	h.Set("Content-Security-Policy", "default-src 'self'; script-src 'self' https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'self'")
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}
func writeErr(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}

func (a *App) authOK(r *http.Request) bool {
	if a.auth == "" {
		return true
	}
	u, p, ok := r.BasicAuth()
	if !ok {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(u+":"+p), []byte(a.auth)) == 1
}

func (a *App) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	secHeaders(w)
	p := r.URL.Path
	if p == "/api/health" && r.Method == http.MethodGet {
		writeJSON(w, 200, map[string]any{"ok": true, "version": version, "storage": a.st.dir, "labs": a.st.Count(), "lang": Lang()})
		return
	}
	if !a.authOK(r) {
		w.Header().Set("WWW-Authenticate", `Basic realm="Bancada de Rede", charset="UTF-8"`)
		http.Error(w, "autenticação necessária", http.StatusUnauthorized)
		return
	}
	if strings.HasPrefix(p, "/api/") {
		r.Body = http.MaxBytesReader(w, r.Body, 96<<20)
		a.api(w, r)
		return
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "método não permitido", http.StatusMethodNotAllowed)
		return
	}
	a.serveStatic(w, r)
}

func (a *App) serveStatic(w http.ResponseWriter, r *http.Request) {
	name := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
	if name == "" {
		name = "index.html"
	}
	if !fs.ValidPath(name) {
		http.NotFound(w, r)
		return
	}
	data, err := fs.ReadFile(a.static, name)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	ext := path.Ext(name)
	ct := mime.TypeByExtension(ext)
	if ext == ".js" {
		ct = "text/javascript; charset=utf-8"
	}
	if ct == "" {
		ct = "application/octet-stream"
	}
	if ext == ".html" {
		data = append(append([]byte(htmlHead), data...), []byte("</body></html>")...)
		w.Header().Set("Cache-Control", "no-cache")
	} else {
		w.Header().Set("Cache-Control", "no-cache")
	}
	w.Header().Set("Content-Type", ct)
	if r.Method == http.MethodHead {
		return
	}
	_, _ = w.Write(data)
}

type saveBody struct {
	Name     string            `json:"name"`
	Topology json.RawMessage   `json:"topology"`
	Configs  map[string]string `json:"configs"`
}
type exportBody struct {
	Topology json.RawMessage `json:"topology"`
	Files    []zipFile       `json:"files"`
}

func (a *App) fail(w http.ResponseWriter, err error) {
	var br badRequest
	var mb *http.MaxBytesError
	switch {
	case errors.As(err, &br):
		writeErr(w, 400, br.msg)
	case errors.Is(err, errNotFound):
		writeErr(w, 404, err.Error())
	case errors.As(err, &mb):
		writeErr(w, 413, "conteúdo maior que o limite")
	default:
		logf("erro interno: %v", err)
		writeErr(w, 500, "erro interno")
	}
}

func decode(r *http.Request, v any) error {
	if err := json.NewDecoder(r.Body).Decode(v); err != nil {
		var mb *http.MaxBytesError
		if errors.As(err, &mb) {
			return err
		}
		return badRequest{"JSON inválido"}
	}
	return nil
}

func sendZip(w http.ResponseWriter, b []byte, name string) {
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, name))
	_, _ = w.Write(b)
}

func (a *App) api(w http.ResponseWriter, r *http.Request) {
	parts := strings.Split(strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/"), "/"), "/")
	m := r.Method
	if parts[0] == "export" && m == http.MethodPost {
		var body exportBody
		if err := decode(r, &body); err != nil {
			a.fail(w, err)
			return
		}
		obj, _, err := validateTopo(body.Topology)
		if err != nil {
			a.fail(w, err)
			return
		}
		vendor := r.URL.Query().Get("vendor")
		if !validVendor(vendor) {
			writeErr(w, 400, "fabricante desconhecido")
			return
		}
		if len(body.Files) == 0 || len(body.Files) > 2000 {
			writeErr(w, 400, "nenhum arquivo para exportar")
			return
		}
		for _, f := range body.Files {
			if !exportNameRe.MatchString(f.Name) {
				writeErr(w, 400, "nome de arquivo inválido: "+f.Name)
				return
			}
		}
		b, err := buildZip(body.Files)
		if err != nil {
			a.fail(w, err)
			return
		}
		name, _ := obj["name"].(string)
		sendZip(w, b, zipName(name, vendor))
		return
	}
	if parts[0] == "net" || parts[0] == "ct" || parts[0] == "bridge" {
		a.netAPI(w, r, parts)
		return
	}
	if parts[0] != "labs" {
		writeErr(w, 404, "rota inexistente")
		return
	}
	if len(parts) == 1 {
		switch m {
		case http.MethodGet:
			list, err := a.st.List()
			if err != nil {
				a.fail(w, err)
				return
			}
			writeJSON(w, 200, map[string]any{"labs": list})
		case http.MethodPost:
			var body saveBody
			if err := decode(r, &body); err != nil {
				a.fail(w, err)
				return
			}
			meta, err := a.st.Save(newID(), body.Name, body.Topology, body.Configs)
			if err != nil {
				a.fail(w, err)
				return
			}
			logf("Lab criado: %s (%d equipamentos)", meta.Name, meta.Devices)
			writeJSON(w, 201, meta)
		default:
			writeErr(w, 405, "método não permitido")
		}
		return
	}
	id := parts[1]
	if !idRe.MatchString(id) {
		writeErr(w, 400, "id inválido")
		return
	}
	if len(parts) == 2 {
		switch m {
		case http.MethodGet:
			meta, topo, err := a.st.Get(id)
			if err != nil {
				a.fail(w, err)
				return
			}
			writeJSON(w, 200, map[string]any{"meta": meta, "topology": topo})
		case http.MethodPut:
			if _, err := a.st.readMeta(id); err != nil {
				a.fail(w, errNotFound)
				return
			}
			var body saveBody
			if err := decode(r, &body); err != nil {
				a.fail(w, err)
				return
			}
			meta, err := a.st.Save(id, body.Name, body.Topology, body.Configs)
			if err != nil {
				a.fail(w, err)
				return
			}
			logf("Lab salvo: %s (%d equipamentos)", meta.Name, meta.Devices)
			writeJSON(w, 200, meta)
		case http.MethodDelete:
			if err := a.st.Delete(id); err != nil {
				a.fail(w, err)
				return
			}
			logf("Lab excluído: %s", id)
			writeJSON(w, 200, map[string]bool{"ok": true})
		default:
			writeErr(w, 405, "método não permitido")
		}
		return
	}
	if parts[2] == "export.zip" && m == http.MethodGet {
		b, name, err := a.st.ExportZip(id, r.URL.Query().Get("vendor"))
		if err != nil {
			a.fail(w, err)
			return
		}
		sendZip(w, b, name)
		return
	}
	if parts[2] == "configs" && m == http.MethodGet {
		if len(parts) == 3 {
			l, err := a.st.ConfigList(id)
			if err != nil {
				a.fail(w, err)
				return
			}
			writeJSON(w, 200, l)
			return
		}
		b, err := a.st.ConfigFile(id, strings.Join(parts[3:], "/"))
		if err != nil {
			a.fail(w, err)
			return
		}
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		_, _ = w.Write(b)
		return
	}
	writeErr(w, 404, "rota inexistente")
}
