module bancada-de-rede

go 1.24

require (
	golang.org/x/crypto v0.31.0
	golang.org/x/sys v0.28.0
)

require (
	github.com/google/btree v1.1.2 // indirect
	golang.org/x/time v0.5.0 // indirect
	gvisor.dev/gvisor v0.0.0-00010101000000-000000000000
)

replace golang.org/x/sys => github.com/golang/sys v0.28.0

replace golang.org/x/crypto => github.com/golang/crypto v0.31.0

replace golang.org/x/term => github.com/golang/term v0.27.0

replace golang.org/x/text => github.com/golang/text v0.21.0

replace golang.org/x/net => github.com/golang/net v0.33.0

replace gvisor.dev/gvisor => ./third_party/gvisor

replace golang.org/x/time => github.com/golang/time v0.5.0
