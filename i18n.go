// Idiomas do executável (português / English). O texto original é em português; em inglês
// usa o mesmo dicionário do navegador (i18n/en.json + en-extra.json), embutido no executável.
package main

import (
	"embed"
	"encoding/json"
	"os"
	"regexp"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
)

//go:embed i18n/en.json i18n/en-extra.json
var i18nFS embed.FS

var curLang atomic.Value // "pt" | "en"

func Lang() string {
	if v, ok := curLang.Load().(string); ok && v != "" {
		return v
	}
	return "pt"
}
func setLang(l string) {
	if l != "en" {
		l = "pt"
	}
	curLang.Store(l)
}

// defaultLang: idioma do sistema (Windows: idioma da interface; outros: LANG/LC_ALL).
func defaultLang() string {
	if l := sysUILang(); l != "" {
		return l
	}
	for _, k := range []string{"LC_ALL", "LC_MESSAGES", "LANG", "LANGUAGE"} {
		if v := os.Getenv(k); v != "" && v != "C" && v != "POSIX" {
			if strings.HasPrefix(strings.ToLower(v), "pt") {
				return "pt"
			}
			return "en"
		}
	}
	return "pt"
}

type fmtKey struct {
	re    *regexp.Regexp
	parts []string // texto em inglês entre os marcadores
}

var (
	i18nOnce  sync.Once
	i18nExact map[string]string
	i18nFmt   []fmtKey
	i18nRep   *strings.Replacer
)

var verbRe = regexp.MustCompile(`%[svdq]`)

func i18nLoad() {
	i18nExact = map[string]string{}
	for _, f := range []string{"i18n/en.json", "i18n/en-extra.json"} {
		b, err := i18nFS.ReadFile(f)
		if err != nil {
			continue
		}
		m := map[string]string{}
		if json.Unmarshal(b, &m) != nil {
			continue
		}
		for k, v := range m {
			k, v = strings.TrimSpace(k), strings.TrimSpace(v)
			if k != "" && k != v {
				i18nExact[k] = v
			}
		}
	}
	keys := []string{}
	for k, v := range i18nExact {
		if verbRe.MatchString(k) {
			kv, vv := verbRe.FindAllString(k, -1), verbRe.FindAllString(v, -1)
			if len(kv) != len(vv) {
				continue
			}
			var re strings.Builder
			re.WriteString("^")
			last := 0
			for _, ix := range verbRe.FindAllStringIndex(k, -1) {
				re.WriteString(regexp.QuoteMeta(k[last:ix[0]]))
				if k[ix[0]+1] == 'd' {
					re.WriteString(`(-?\d+)`)
				} else {
					re.WriteString(`([\s\S]+?)`)
				}
				last = ix[1]
			}
			re.WriteString(regexp.QuoteMeta(k[last:]) + "$")
			if r, err := regexp.Compile(re.String()); err == nil {
				i18nFmt = append(i18nFmt, fmtKey{r, verbRe.Split(v, -1)})
			}
			continue
		}
		if len([]rune(k)) >= 6 {
			keys = append(keys, k)
		}
	}
	sort.Slice(keys, func(i, j int) bool {
		if len(keys[i]) != len(keys[j]) {
			return len(keys[i]) > len(keys[j])
		}
		return keys[i] < keys[j]
	})
	pairs := make([]string, 0, 2*len(keys))
	for _, k := range keys {
		pairs = append(pairs, k, i18nExact[k])
	}
	i18nRep = strings.NewReplacer(pairs...)
	sort.Slice(i18nFmt, func(i, j int) bool { return len(i18nFmt[i].re.String()) > len(i18nFmt[j].re.String()) })
}

// T traduz um texto (frase inteira, frase com valores no meio ou trechos conhecidos) quando o idioma é inglês.
func T(s string) string {
	if Lang() != "en" {
		return s
	}
	return toEN(s)
}

func toEN(s string) string {
	i18nOnce.Do(i18nLoad)
	t := strings.TrimSpace(s)
	if t == "" {
		return s
	}
	if e, ok := i18nExact[t]; ok {
		return strings.Replace(s, t, e, 1)
	}
	for _, f := range i18nFmt {
		if m := f.re.FindStringSubmatch(t); m != nil {
			var b strings.Builder
			for i, p := range f.parts {
				b.WriteString(p)
				if i+1 < len(m) && i < len(f.parts)-1 {
					if v := m[i+1]; strings.ContainsAny(v, `/\`) || !strings.Contains(v, " ") {
						b.WriteString(v) // caminhos, endereços, nomes: ficam como estão
					} else {
						b.WriteString(toEN(v))
					}
				}
			}
			return strings.Replace(s, t, b.String(), 1)
		}
	}
	return i18nRep.Replace(s)
}
