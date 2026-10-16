//go:build ignore

// Gera assets/icon.png e assets/icon.ico (16, 24, 32, 48 em BMP e 256 em PNG).
// Uso: go run tools/genicon.go
package main

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/color"
	"image/png"
	"os"
)

type rgba struct{ r, g, b, a float64 }

func draw(s int) *image.NRGBA {
	const ss = 4
	S := s * ss
	big := make([]rgba, S*S)
	fs := float64(S)
	inRound := func(x, y, x0, y0, x1, y1, r float64) bool {
		if x < x0 || x > x1 || y < y0 || y > y1 {
			return false
		}
		cx, cy := x, y
		if x < x0+r {
			cx = x0 + r
		} else if x > x1-r {
			cx = x1 - r
		}
		if y < y0+r {
			cy = y0 + r
		} else if y > y1-r {
			cy = y1 - r
		}
		dx, dy := x-cx, y-cy
		return dx*dx+dy*dy <= r*r
	}
	body := rgba{0x14, 0x20, 0x2A, 255}
	port := rgba{0xE3, 0xE8, 0xEC, 255}
	green := rgba{0x2E, 0xB8, 0x72, 255}
	amber := rgba{0xE3, 0x9A, 0x08, 255}
	for py := 0; py < S; py++ {
		for px := 0; px < S; px++ {
			x, y := (float64(px)+.5)/fs, (float64(py)+.5)/fs
			var c rgba
			if inRound(x, y, .04, .20, .96, .80, .11) {
				c = body
				for i := 0; i < 4; i++ {
					x0 := .15 + float64(i)*.19
					if inRound(x, y, x0, .50, x0+.13, .68, .02) {
						c = port
					}
				}
				if (x-.20)*(x-.20)+(y-.34)*(y-.34) < .055*.055 {
					c = green
				}
				if (x-.37)*(x-.37)+(y-.34)*(y-.34) < .055*.055 {
					c = amber
				}
			}
			big[py*S+px] = c
		}
	}
	img := image.NewNRGBA(image.Rect(0, 0, s, s))
	for y := 0; y < s; y++ {
		for x := 0; x < s; x++ {
			var r, g, b, a float64
			for j := 0; j < ss; j++ {
				for i := 0; i < ss; i++ {
					c := big[(y*ss+j)*S+x*ss+i]
					r += c.r * c.a
					g += c.g * c.a
					b += c.b * c.a
					a += c.a
				}
			}
			if a > 0 {
				r, g, b = r/a, g/a, b/a
			}
			img.SetNRGBA(x, y, color.NRGBA{uint8(r), uint8(g), uint8(b), uint8(a / ss / ss)})
		}
	}
	return img
}

func bmpEntry(img *image.NRGBA) []byte {
	s := img.Bounds().Dx()
	var buf bytes.Buffer
	hdr := []any{uint32(40), int32(s), int32(s * 2), uint16(1), uint16(32), uint32(0), uint32(0), int32(0), int32(0), uint32(0), uint32(0)}
	for _, v := range hdr {
		_ = binary.Write(&buf, binary.LittleEndian, v)
	}
	for y := s - 1; y >= 0; y-- {
		for x := 0; x < s; x++ {
			c := img.NRGBAAt(x, y)
			buf.Write([]byte{c.B, c.G, c.R, c.A})
		}
	}
	rowBytes := ((s + 31) / 32) * 4
	buf.Write(make([]byte, rowBytes*s))
	return buf.Bytes()
}

func main() {
	var p256 bytes.Buffer
	_ = png.Encode(&p256, draw(256))
	_ = os.WriteFile("assets/icon.png", p256.Bytes(), 0o644)
	type ent struct {
		size int
		data []byte
	}
	ents := []ent{}
	for _, s := range []int{16, 24, 32, 48} {
		ents = append(ents, ent{s, bmpEntry(draw(s))})
	}
	ents = append(ents, ent{256, p256.Bytes()})
	var ico bytes.Buffer
	_ = binary.Write(&ico, binary.LittleEndian, []uint16{0, 1, uint16(len(ents))})
	off := 6 + 16*len(ents)
	for _, e := range ents {
		w := byte(e.size)
		if e.size >= 256 {
			w = 0
		}
		ico.Write([]byte{w, w, 0, 0})
		_ = binary.Write(&ico, binary.LittleEndian, []uint16{1, 32})
		_ = binary.Write(&ico, binary.LittleEndian, []uint32{uint32(len(e.data)), uint32(off)})
		off += len(e.data)
	}
	for _, e := range ents {
		ico.Write(e.data)
	}
	_ = os.WriteFile("assets/icon.ico", ico.Bytes(), 0o644)
}
