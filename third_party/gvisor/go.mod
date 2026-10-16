module gvisor.dev/gvisor

go 1.24

require (
	github.com/google/btree v1.1.2
	golang.org/x/sys v0.28.0
	golang.org/x/time v0.5.0
)

replace golang.org/x/sys => github.com/golang/sys v0.28.0

replace golang.org/x/time => github.com/golang/time v0.5.0
