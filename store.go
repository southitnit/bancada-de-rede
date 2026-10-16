package main

import (
	"archive/zip"
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

var (
	idRe        = regexp.MustCompile(`^[a-f0-9]{12}$`)
	cfgRe       = regexp.MustCompile(`^(auto|cisco|nxos|junos|eos|aoscx|os10|huawei|routeros|fortios|vyos|hosts|chassis|nuvens)/[A-Za-z0-9_.-]{1,80}\.(txt|sh|ps1)$`)
	vendors     = []string{"auto", "cisco", "nxos", "junos", "eos", "aoscx", "os10", "huawei", "routeros", "fortios", "vyos"}
	devTypes    = map[string]bool{"sw2": true, "sw3": true, "rtr": true, "fw": true, "pc": true, "srv": true, "chassis": true, "cloud": true}
	errNotFound = errors.New("lab não encontrado")
)

type Meta struct {
	ID      string         `json:"id"`
	Name    string         `json:"name"`
	Created string         `json:"created"`
	Updated string         `json:"updated"`
	Devices int            `json:"devices"`
	Links   int            `json:"links"`
	Types   map[string]int `json:"types,omitempty"`
}

type badRequest struct{ msg string }

func (e badRequest) Error() string { return e.msg }

type Store struct{ dir string }

func NewStore(dir string) *Store { return &Store{dir: dir} }
func (s *Store) labs() string    { return filepath.Join(s.dir, "labs") }

func newID() string { b := make([]byte, 6); _, _ = rand.Read(b); return hex.EncodeToString(b) }

// validateTopo confere a estrutura mínima de uma topologia e devolve o objeto decodificado.
func validateTopo(raw json.RawMessage) (map[string]any, Meta, error) {
	var m Meta
	var obj map[string]any
	if len(raw) == 0 {
		return nil, m, badRequest{"topologia ausente"}
	}
	if err := json.Unmarshal(raw, &obj); err != nil || obj == nil {
		return nil, m, badRequest{"topologia não é um JSON válido"}
	}
	devs, ok1 := obj["devices"].([]any)
	links, ok2 := obj["links"].([]any)
	if !ok1 || !ok2 {
		return nil, m, badRequest{"faltam devices/links"}
	}
	if len(devs) > 800 {
		return nil, m, badRequest{"limite de 800 equipamentos"}
	}
	ids := map[string]bool{}
	m.Types = map[string]int{}
	for _, x := range devs {
		d, ok := x.(map[string]any)
		if !ok {
			return nil, m, badRequest{"equipamento inválido"}
		}
		id, _ := d["id"].(string)
		t, _ := d["type"].(string)
		_, hasPorts := d["ports"].([]any)
		if id == "" || !devTypes[t] || !hasPorts {
			return nil, m, badRequest{"equipamento inválido"}
		}
		if ids[id] {
			return nil, m, badRequest{"id de equipamento duplicado"}
		}
		ids[id] = true
		m.Types[t]++
	}
	for _, x := range links {
		l, ok := x.(map[string]any)
		if !ok {
			return nil, m, badRequest{"enlace inválido"}
		}
		for _, end := range []string{"a", "b"} {
			e, _ := l[end].(map[string]any)
			dv, _ := e["dev"].(string)
			if !ids[dv] {
				return nil, m, badRequest{"enlace aponta para equipamento inexistente"}
			}
		}
	}
	m.Devices, m.Links = len(devs), len(links)
	return obj, m, nil
}

func writeAtomic(path string, data []byte) error {
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func (s *Store) readMeta(id string) (Meta, error) {
	var m Meta
	b, err := os.ReadFile(filepath.Join(s.labs(), id, "meta.json"))
	if err != nil {
		return m, errNotFound
	}
	err = json.Unmarshal(b, &m)
	return m, err
}

func (s *Store) Count() int {
	ents, _ := os.ReadDir(s.labs())
	n := 0
	for _, e := range ents {
		if e.IsDir() && idRe.MatchString(e.Name()) {
			n++
		}
	}
	return n
}

func (s *Store) List() ([]Meta, error) {
	out := []Meta{}
	ents, err := os.ReadDir(s.labs())
	if err != nil {
		if os.IsNotExist(err) {
			return out, nil
		}
		return nil, err
	}
	for _, e := range ents {
		if !e.IsDir() || !idRe.MatchString(e.Name()) {
			continue
		}
		if m, err := s.readMeta(e.Name()); err == nil {
			out = append(out, m)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Updated > out[j].Updated })
	return out, nil
}

func (s *Store) Get(id string) (Meta, json.RawMessage, error) {
	if !idRe.MatchString(id) {
		return Meta{}, nil, badRequest{"id inválido"}
	}
	m, err := s.readMeta(id)
	if err != nil {
		return m, nil, errNotFound
	}
	b, err := os.ReadFile(filepath.Join(s.labs(), id, "lab.json"))
	if err != nil {
		return m, nil, errNotFound
	}
	return m, json.RawMessage(b), nil
}

// Save grava lab.json, meta.json e, se vierem, as configs geradas pelo navegador.
func (s *Store) Save(id, name string, topo json.RawMessage, configs map[string]string) (Meta, error) {
	obj, m, err := validateTopo(topo)
	if err != nil {
		return m, err
	}
	name = strings.TrimSpace(name)
	if name == "" {
		name, _ = obj["name"].(string)
	}
	name = strings.TrimSpace(name)
	if name == "" {
		name = "Lab sem nome"
	}
	if r := []rune(name); len(r) > 120 {
		name = string(r[:120])
	}
	obj["name"] = name
	dir := filepath.Join(s.labs(), id)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return m, err
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	m.ID, m.Name, m.Updated, m.Created = id, name, now, now
	if prev, err := s.readMeta(id); err == nil {
		m.Created = prev.Created
	}
	lab, _ := json.MarshalIndent(obj, "", "  ")
	if err := writeAtomic(filepath.Join(dir, "lab.json"), lab); err != nil {
		return m, err
	}
	mb, _ := json.MarshalIndent(m, "", "  ")
	if err := writeAtomic(filepath.Join(dir, "meta.json"), mb); err != nil {
		return m, err
	}
	if configs != nil {
		cdir := filepath.Join(dir, "configs")
		_ = os.RemoveAll(cdir)
		total := 0
		for k, v := range configs {
			if !cfgRe.MatchString(k) {
				continue
			}
			total += len(v)
			if total > 64<<20 {
				break
			}
			p := filepath.Join(cdir, filepath.FromSlash(k))
			if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
				return m, err
			}
			if err := os.WriteFile(p, []byte(v), 0o644); err != nil {
				return m, err
			}
		}
	}
	return m, nil
}

func (s *Store) Delete(id string) error {
	if !idRe.MatchString(id) {
		return badRequest{"id inválido"}
	}
	if _, err := s.readMeta(id); err != nil {
		return errNotFound
	}
	return os.RemoveAll(filepath.Join(s.labs(), id))
}

// ConfigList devolve os arquivos de config gravados de um lab, por pasta.
func (s *Store) ConfigList(id string) (map[string][]string, error) {
	if _, err := s.readMeta(id); err != nil {
		return nil, errNotFound
	}
	out := map[string][]string{}
	base := filepath.Join(s.labs(), id, "configs")
	ents, _ := os.ReadDir(base)
	for _, e := range ents {
		if !e.IsDir() {
			continue
		}
		fs, _ := os.ReadDir(filepath.Join(base, e.Name()))
		names := []string{}
		for _, f := range fs {
			names = append(names, f.Name())
		}
		out[e.Name()] = names
	}
	return out, nil
}

func (s *Store) ConfigFile(id, rel string) ([]byte, error) {
	if !idRe.MatchString(id) || !cfgRe.MatchString(rel) {
		return nil, badRequest{"arquivo inválido"}
	}
	b, err := os.ReadFile(filepath.Join(s.labs(), id, "configs", filepath.FromSlash(rel)))
	if err != nil {
		return nil, errNotFound
	}
	return b, nil
}

type zipFile struct {
	Name string `json:"name"`
	Text string `json:"text"`
}

func buildZip(files []zipFile) ([]byte, error) {
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	now := time.Now()
	for _, f := range files {
		w, err := zw.CreateHeader(&zip.FileHeader{Name: f.Name, Method: zip.Deflate, Modified: now})
		if err != nil {
			return nil, err
		}
		if _, err := w.Write([]byte(f.Text)); err != nil {
			return nil, err
		}
	}
	if err := zw.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// ExportZip monta o zip de um lab salvo a partir das configs gravadas em disco.
func (s *Store) ExportZip(id, vendor string) ([]byte, string, error) {
	if !validVendor(vendor) {
		return nil, "", badRequest{"fabricante desconhecido"}
	}
	m, topo, err := s.Get(id)
	if err != nil {
		return nil, "", err
	}
	files := []zipFile{}
	base := filepath.Join(s.labs(), id, "configs")
	for _, dir := range []string{vendor, "hosts", "chassis", "nuvens"} {
		fs, _ := os.ReadDir(filepath.Join(base, dir))
		for _, f := range fs {
			b, err := os.ReadFile(filepath.Join(base, dir, f.Name()))
			if err == nil {
				files = append(files, zipFile{dir + "/" + f.Name(), string(b)})
			}
		}
	}
	files = append(files, zipFile{"topologia.json", string(topo)})
	note := fmt.Sprintf("Bancada de Rede — %s\nExportado em %s para %s.\n\n%s/  um arquivo por equipamento de rede\nhosts/   script de provisionamento de cada host (.sh Linux / .ps1 Windows) e BMC\nnuvens/  Internet real/fake: pool público, DNS e enlaces\nchassis/ composição dos chassis blade\ntopologia.json  reabra o lab com \"Importar .json\"\n",
		m.Name, time.Now().Format("2006-01-02"), vendor, vendor)
	if len(files) == 1 {
		note += "\nEste lab foi salvo sem as configurações geradas. Abra-o na Bancada e salve de novo.\n"
	}
	files = append(files, zipFile{"LEIAME.txt", note})
	b, err := buildZip(files)
	return b, zipName(m.Name, vendor), err
}

func validVendor(v string) bool {
	for _, x := range vendors {
		if x == v {
			return true
		}
	}
	return false
}

var accents = strings.NewReplacer("á", "a", "à", "a", "ã", "a", "â", "a", "ä", "a", "é", "e", "ê", "e", "è", "e", "ë", "e", "í", "i", "ì", "i", "î", "i", "ï", "i",
	"ó", "o", "ò", "o", "õ", "o", "ô", "o", "ö", "o", "ú", "u", "ù", "u", "û", "u", "ü", "u", "ç", "c", "ñ", "n")
var nonWord = regexp.MustCompile(`[^a-z0-9]+`)

func slug(s string) string {
	s = nonWord.ReplaceAllString(accents.Replace(strings.ToLower(s)), "-")
	s = strings.Trim(s, "-")
	if s == "" {
		return "rede"
	}
	return s
}
func zipName(name, vendor string) string { return "lab-" + slug(name) + "-" + vendor + ".zip" }
