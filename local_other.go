//go:build !(windows && amd64)

package main

// Acesso do próprio computador aos IPs do lab: só no Windows x64 (WinDivert).
func localRefresh()                          {}
func localDeliver(_ *lanHost, _ []byte) bool { return false }
func localStatus() map[string]string         { return nil }
